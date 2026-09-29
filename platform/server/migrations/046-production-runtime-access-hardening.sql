-- Give the dedicated Production Worker role only the internal RPC surface.
do $migration$
declare v_creator record; v_column record;
begin
  if to_regclass('public.platform_migrations') is null then
    raise exception 'platform_migrations is required before applying migration 046';
  end if;
  if not exists(select 1 from pg_roles where rolname='lumiq_production_runtime') then
    return;
  end if;
  if exists(
    select 1 from pg_roles
    where rolname='lumiq_production_runtime'
      and (not rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole or rolreplication)
  ) then
    raise exception 'lumiq_production_runtime must be LOGIN, NOINHERIT, NOBYPASSRLS and non-administrative';
  end if;

  grant usage on schema public to lumiq_production_runtime;
  revoke all privileges on all tables in schema public from lumiq_production_runtime;
  revoke all privileges on all sequences in schema public from lumiq_production_runtime;

  for v_column in
    select n.nspname,c.relname,a.attname,
      case acl.privilege_type
        when 'SELECT' then 'select'
        when 'INSERT' then 'insert'
        when 'UPDATE' then 'update'
        when 'REFERENCES' then 'references'
      end as privilege
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname='public' and c.relkind in ('r','p')
      and a.attnum>0 and not a.attisdropped
      and acl.grantee=(select oid from pg_roles where rolname='lumiq_production_runtime')
      and acl.privilege_type in ('SELECT','INSERT','UPDATE','REFERENCES')
  loop
    execute format('revoke %s (%I) on table %I.%I from lumiq_production_runtime',
      v_column.privilege,v_column.attname,v_column.nspname,v_column.relname);
  end loop;

  grant select(version) on public.platform_migrations to lumiq_production_runtime;
  if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='platform_migrations' and policyname='production_runtime_migration_version_read') then
    create policy production_runtime_migration_version_read on public.platform_migrations
      for select to lumiq_production_runtime using(true);
  end if;

  for v_creator in
    select distinct d.defaclrole,d.defaclobjtype
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace='public'::regnamespace
      and d.defaclobjtype in ('r','S')
      and a.grantee=(select oid from pg_roles where rolname='lumiq_production_runtime')
  loop
    if v_creator.defaclobjtype='r' then
      execute format('alter default privileges for role %I in schema public revoke all privileges on tables from lumiq_production_runtime',
        (select rolname from pg_roles where oid=v_creator.defaclrole));
    elsif v_creator.defaclobjtype='S' then
      execute format('alter default privileges for role %I in schema public revoke all privileges on sequences from lumiq_production_runtime',
        (select rolname from pg_roles where oid=v_creator.defaclrole));
    end if;
  end loop;

end
$migration$;

-- Execute grants as the least-privilege owner of each internal RPC.
-- lumiq:requires-role lumiq_production_runtime
set local role lumiq_job_owner;
grant execute on function public.claim_platform_job(uuid[]) to lumiq_production_runtime;
grant execute on function public.claim_platform_queue_batch(integer) to lumiq_production_runtime;
grant execute on function public.reset_platform_queue_dispatch(uuid[]) to lumiq_production_runtime;
grant execute on function public.recover_stale_platform_jobs() to lumiq_production_runtime;
grant execute on function public.renew_platform_job(uuid) to lumiq_production_runtime;
grant execute on function public.settle_platform_job(uuid,text,jsonb,text,integer,boolean) to lumiq_production_runtime;
grant execute on function public.dead_letter_platform_job(uuid) to lumiq_production_runtime;
grant execute on function public.prepare_platform_export(uuid) to lumiq_production_runtime;
grant execute on function public.get_platform_export_part(uuid) to lumiq_production_runtime;
grant execute on function public.complete_platform_export_part(uuid,jsonb) to lumiq_production_runtime;
grant execute on function public.get_platform_export_notice(uuid) to lumiq_production_runtime;
grant execute on function public.get_platform_cleanup_manifest(uuid) to lumiq_production_runtime;
grant execute on function public.can_delete_platform_asset(uuid,text) to lumiq_production_runtime;
grant execute on function public.save_platform_thumbnail_details(uuid,uuid,integer,text) to lumiq_production_runtime;
grant execute on function public.platform_media_cleanup_should_defer(uuid) to lumiq_production_runtime;
grant execute on function public.finalize_platform_event_cleanup(uuid,integer) to lumiq_production_runtime;
grant execute on function public.prepare_platform_event_end(uuid) to lumiq_production_runtime;
grant execute on function public.expire_platform_event(uuid) to lumiq_production_runtime;
grant execute on function public.run_platform_retention_cycle(integer) to lumiq_production_runtime;
grant execute on function public.list_platform_retention_reminders(integer) to lumiq_production_runtime;
grant execute on function public.collect_platform_notices() to lumiq_production_runtime;
grant execute on function public.queue_platform_message(uuid,text,text,text,text) to lumiq_production_runtime;
grant execute on function public.claim_platform_deliveries(integer) to lumiq_production_runtime;
grant execute on function public.settle_platform_delivery(uuid,boolean) to lumiq_production_runtime;
reset role;

set local role lumiq_payment_owner;
grant execute on function public.resolve_billing_owner(text) to lumiq_production_runtime;
grant execute on function public.get_billing_subscription_id(uuid) to lumiq_production_runtime;
grant execute on function public.reconcile_provider_subscription_state(uuid,jsonb) to lumiq_production_runtime;
grant execute on function public.apply_provider_payment_event(jsonb) to lumiq_production_runtime;
reset role;

set local role lumiq_storage_owner;
grant execute on function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) to lumiq_production_runtime;
reset role;
