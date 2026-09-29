-- Remove direct application-table access from the shared Worker database role.
do $migration$
declare v_creator record;
begin
  if to_regclass('public.platform_migrations') is null then
    raise exception 'platform_migrations is required before applying migration 045';
  end if;
  if not exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    return;
  end if;

  if exists(
    select 1 from pg_roles
    where rolname='lumiq_restore_runtime'
      and (not rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)
  ) then
    raise exception 'lumiq_restore_runtime must be a non-inheriting login role without bypass or administrative privileges';
  end if;
  grant usage on schema public to lumiq_restore_runtime;
  revoke all privileges on all tables in schema public from lumiq_restore_runtime;
  revoke all privileges on all sequences in schema public from lumiq_restore_runtime;

  grant select(version) on public.platform_migrations to lumiq_restore_runtime;
  if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='platform_migrations' and policyname='runtime_migration_version_read') then
    create policy runtime_migration_version_read on public.platform_migrations
      for select to lumiq_restore_runtime using(true);
  end if;

  for v_creator in
    select distinct d.defaclrole
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace='public'::regnamespace
      and d.defaclobjtype='r'
      and a.grantee=(select oid from pg_roles where rolname='lumiq_restore_runtime')
  loop
    execute format('alter default privileges for role %I in schema public revoke all privileges on tables from lumiq_restore_runtime',
      (select rolname from pg_roles where oid=v_creator.defaclrole));
  end loop;
end
$migration$;
