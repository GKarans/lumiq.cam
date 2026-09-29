-- Admin access stays JWT-bound and is rechecked inside PostgreSQL.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_admin_owner') then
    create role lumiq_admin_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_admin_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_admin_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_admin_owner;
  if to_regprocedure('auth.uid()') is not null then
    grant usage on schema auth to lumiq_admin_owner;
    grant execute on function auth.uid() to lumiq_admin_owner;
  end if;
  grant select(id,email,name,created_at,role) on public.accounts to lumiq_admin_owner;
  grant select on public.jobs,public.deliveries,public.support_cases,public.audit,public.metrics to lumiq_admin_owner;
  grant update(status,attempts,available_at,lease_until) on public.deliveries to lumiq_admin_owner;
  grant update(reply,status) on public.support_cases to lumiq_admin_owner;
  grant insert(id,account_id,recipient,subject,body,dedupe_key) on public.deliveries to lumiq_admin_owner;
  grant insert(id,actor_id,action,target_id) on public.audit to lumiq_admin_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='admin_owner_accounts_read') then create policy admin_owner_accounts_read on public.accounts for select to lumiq_admin_owner using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='admin_owner_jobs_read') then create policy admin_owner_jobs_read on public.jobs for select to lumiq_admin_owner using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='deliveries' and policyname='admin_owner_deliveries_access') then create policy admin_owner_deliveries_access on public.deliveries for all to lumiq_admin_owner using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_cases' and policyname='admin_owner_support_access') then create policy admin_owner_support_access on public.support_cases for all to lumiq_admin_owner using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='audit' and policyname='admin_owner_audit_access') then create policy admin_owner_audit_access on public.audit for all to lumiq_admin_owner using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='metrics' and policyname='admin_owner_metrics_read') then create policy admin_owner_metrics_read on public.metrics for select to lumiq_admin_owner using(true); end if;

  create or replace function public.get_admin_dashboard()
  returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth
  as $function$
  begin
    if not exists(select 1 from public.accounts where id=auth.uid() and role='admin') then raise exception 'Administrator access is required' using errcode='42501'; end if;
    return jsonb_build_object(
      'accounts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,email,name,created_at from public.accounts order by created_at desc) x),'[]'::jsonb),
      'jobs',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.jobs order by created_at desc limit 100) x),'[]'::jsonb),
      'deliveries',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,recipient,subject,status,attempts,created_at from public.deliveries order by created_at desc limit 100) x),'[]'::jsonb),
      'cases',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.support_cases order by created_at desc limit 100) x),'[]'::jsonb),
      'audit',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.audit order by created_at desc limit 100) x),'[]'::jsonb),
      'metrics',coalesce((select jsonb_agg(to_jsonb(x) order by x.kind) from (select kind,sum(amount)::bigint as amount from public.metrics group by kind) x),'[]'::jsonb));
  end
  $function$;

  create or replace function public.retry_admin_delivery(p_id uuid)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_actor uuid:=auth.uid();v_count integer;
  begin
    if not exists(select 1 from public.accounts where id=v_actor and role='admin') then raise exception 'Administrator access is required' using errcode='42501'; end if;
    update public.deliveries set status='queued',attempts=0,available_at=now(),lease_until=null where id=p_id and status='failed';
    get diagnostics v_count=row_count;
    if v_count=0 then return false; end if;
    insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_actor,'admin.email.retry',p_id::text);
    return true;
  end
  $function$;

  create or replace function public.reply_admin_support(p_id uuid,p_reply text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_actor uuid:=auth.uid();v_case public.support_cases;
  begin
    if not exists(select 1 from public.accounts where id=v_actor and role='admin') then raise exception 'Administrator access is required' using errcode='42501'; end if;
    if p_reply is null or length(p_reply)>4000 then raise exception 'Invalid support reply' using errcode='22023'; end if;
    select * into v_case from public.support_cases where id=p_id for update;
    if not found then return false; end if;
    update public.support_cases set reply=p_reply,status='answered' where id=p_id;
    insert into public.deliveries(id,account_id,recipient,subject,body) values(gen_random_uuid(),v_case.owner_id,v_case.email,'Reply to your Lumiq support request',p_reply);
    insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_actor,'admin.support.reply',p_id::text);
    return true;
  end
  $function$;

  revoke all on function public.get_admin_dashboard() from public;
  revoke all on function public.retry_admin_delivery(uuid) from public;
  revoke all on function public.reply_admin_support(uuid,text) from public;
  alter function public.get_admin_dashboard() owner to lumiq_admin_owner;
  alter function public.retry_admin_delivery(uuid) owner to lumiq_admin_owner;
  alter function public.reply_admin_support(uuid,text) owner to lumiq_admin_owner;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.get_admin_dashboard() to authenticated;
    grant execute on function public.retry_admin_delivery(uuid) to authenticated;
    grant execute on function public.reply_admin_support(uuid,text) to authenticated;
  end if;
end
$migration$;
