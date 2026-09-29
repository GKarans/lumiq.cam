-- Let the Worker process the mail outbox without direct deliveries-table access.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_job_owner') then
    raise exception 'lumiq_job_owner is required before applying migration 044';
  end if;
  grant select(id,account_id,recipient,subject,body,status,attempts,available_at,lease_until,created_at)
    on public.deliveries to lumiq_job_owner;
  grant update(status,attempts,available_at,lease_until)
    on public.deliveries to lumiq_job_owner;

  create or replace function public.claim_platform_deliveries(p_limit integer)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_messages jsonb;
  begin
    if p_limit is null or p_limit<1 or p_limit>10 then
      raise exception 'Invalid delivery claim limit' using errcode='22023';
    end if;
    update public.deliveries
      set status=case when attempts>=5 then 'failed' else 'queued' end,lease_until=null
      where status='processing' and lease_until<now();
    with candidates as (
      select id from public.deliveries
      where status='queued' and attempts<5 and available_at<=now()
      order by created_at,id for update skip locked limit p_limit
    ), claimed as (
      update public.deliveries d set status='processing',lease_until=now()+interval '5 minutes',attempts=d.attempts+1
      from candidates c where d.id=c.id
      returning d.id,d.account_id,d.recipient,d.subject,d.body,d.dedupe_key
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'account_id',account_id,'recipient',recipient,
      'subject',subject,'body',body,'dedupe_key',dedupe_key) order by id),'[]'::jsonb)
      into v_messages from claimed;
    return v_messages;
  end
  $function$;

  create or replace function public.settle_platform_delivery(p_id uuid,p_sent boolean)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  begin
    if p_id is null or p_sent is null then
      raise exception 'Invalid delivery settlement' using errcode='22023';
    end if;
    update public.deliveries set
      status=case when p_sent then 'sent' when attempts>=5 then 'failed' else 'queued' end,
      lease_until=null,
      available_at=case when p_sent then available_at else now()+(power(2,attempts)*interval '1 minute') end
      where id=p_id and status='processing';
    return found;
  end
  $function$;

  revoke all on function public.claim_platform_deliveries(integer) from public;
  revoke all on function public.settle_platform_delivery(uuid,boolean) from public;
  grant create on schema public to lumiq_job_owner;
  alter function public.claim_platform_deliveries(integer) owner to lumiq_job_owner;
  alter function public.settle_platform_delivery(uuid,boolean) owner to lumiq_job_owner;
  revoke create on schema public from lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.claim_platform_deliveries(integer) to lumiq_restore_runtime;
    grant execute on function public.settle_platform_delivery(uuid,boolean) to lumiq_restore_runtime;
  end if;
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.claim_platform_deliveries(integer) from anon;
    revoke all on function public.settle_platform_delivery(uuid,boolean) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function public.claim_platform_deliveries(integer) from authenticated;
    revoke all on function public.settle_platform_delivery(uuid,boolean) from authenticated;
  end if;
end
$migration$;
