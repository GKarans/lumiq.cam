-- The SECURITY DEFINER account-sync RPC needs schema lookup for auth.uid()
-- and auth.users. Keep this grant on its dedicated, non-login function owner.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and to_regnamespace('auth') is not null then
    execute 'grant usage on schema auth to lumiq_api_owner';
  end if;
end
$migration$;
