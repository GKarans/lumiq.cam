-- Queue support notifications with the case so a mail-provider outage cannot lose a request.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_support_owner') then
    raise exception 'lumiq_support_owner is required before applying migration 048';
  end if;
  if not exists(select 1 from pg_roles where rolname='lumiq_job_owner') then
    raise exception 'lumiq_job_owner is required before applying migration 048';
  end if;

  alter table public.deliveries add column if not exists reply_to text;
  grant insert(id,account_id,recipient,subject,body,reply_to,dedupe_key) on public.deliveries to lumiq_support_owner;
  grant select(reply_to) on public.deliveries to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='deliveries' and policyname='support_owner_deliveries_insert') then
    create policy support_owner_deliveries_insert on public.deliveries for insert to lumiq_support_owner with check(true);
  end if;

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
      returning d.id,d.account_id,d.recipient,d.subject,d.body,d.reply_to,d.dedupe_key
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'account_id',account_id,'recipient',recipient,
      'subject',subject,'body',body,'reply_to',reply_to,'dedupe_key',dedupe_key) order by id),'[]'::jsonb)
      into v_messages from claimed;
    return v_messages;
  end
  $function$;

  create or replace function public.create_support_case(p_email text,p_subject text,p_message text,p_support_recipient text)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();v_email text;v_support_recipient text:=lower(btrim(p_support_recipient));v_id uuid:=gen_random_uuid();
  begin
    if p_subject is null or length(btrim(p_subject))<1 or length(btrim(p_subject))>120 or p_subject ~ E'[\r\n]'
      or p_message is null or length(btrim(p_message))<1 or length(btrim(p_message))>4000 then
      raise exception 'Invalid support request' using errcode='22023';
    end if;
    if v_support_recipient is null or length(v_support_recipient)>254
      or v_support_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Support notification is unavailable' using errcode='22023';
    end if;
    if v_owner is not null then
      select email into v_email from public.accounts where id=v_owner;
      if not found then raise exception 'Account is unavailable' using errcode='42501'; end if;
    else
      v_email:=lower(btrim(p_email));
      if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'A valid email address is required' using errcode='22023';
      end if;
    end if;
    insert into public.support_cases(id,owner_id,email,subject,message)
      values(v_id,v_owner,v_email,btrim(p_subject),btrim(p_message));
    insert into public.deliveries(id,account_id,recipient,subject,body,reply_to,dedupe_key)
      values(gen_random_uuid(),v_owner,v_support_recipient,'Lumiq support: '||btrim(p_subject),
        'Request: '||v_id::text||E'\nFrom: '||v_email||E'\n\n'||btrim(p_message),v_email,'support-case:'||v_id::text);
    return jsonb_build_object('id',v_id,'message','Your request has been recorded.');
  end
  $function$;

  revoke all on function public.create_support_case(text,text,text,text) from public;
  alter function public.create_support_case(text,text,text,text) owner to lumiq_support_owner;
  revoke create on schema public from lumiq_support_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.create_support_case(text,text,text,text) to anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.create_support_case(text,text,text,text) to authenticated;
  end if;
end
$migration$;
