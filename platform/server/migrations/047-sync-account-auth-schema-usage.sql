-- The SECURITY DEFINER account-sync RPC needs schema lookup for auth.uid()
-- and auth.users. Keep this grant on its dedicated, non-login function owner.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    or to_regnamespace('auth') is null then
    return;
  end if;

  if not has_schema_privilege('lumiq_api_owner','auth','usage') then
    if not has_schema_privilege(current_user,'auth','usage with grant option') then
      raise exception 'Supabase must grant USAGE on schema auth to lumiq_api_owner before migration 047 can be applied';
    end if;
    execute 'grant usage on schema auth to lumiq_api_owner';
  end if;
end
$migration$;
