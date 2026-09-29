-- Queue one already-composed service message without granting runtime table DML.
do $migration$
begin
  grant insert(id,account_id,recipient,subject,body,dedupe_key) on public.deliveries to lumiq_job_owner;
  grant select(dedupe_key) on public.deliveries to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='deliveries' and policyname='job_owner_deliveries_insert') then
    create policy job_owner_deliveries_insert on public.deliveries for all to lumiq_job_owner using(true) with check(true);
  end if;

  create or replace function public.queue_platform_message(p_account_id uuid,p_recipient text,p_subject text,p_body text,p_dedupe_key text default null)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    if p_recipient is null or length(p_recipient)>320 or position('@' in p_recipient)<2
      or p_subject is null or length(p_subject)>240 or p_subject ~ E'[\r\n]'
      or p_body is null or length(p_body)>12000
      or (p_dedupe_key is not null and length(p_dedupe_key)>500) then
      raise exception 'Invalid message' using errcode='22023';
    end if;
    insert into public.deliveries(id,account_id,recipient,subject,body,dedupe_key)
      values(gen_random_uuid(),p_account_id,p_recipient,p_subject,p_body,p_dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  revoke all on function public.queue_platform_message(uuid,text,text,text,text) from public;
  alter function public.queue_platform_message(uuid,text,text,text,text) owner to lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.queue_platform_message(uuid,text,text,text,text) to lumiq_restore_runtime;
  end if;
end
$migration$;
