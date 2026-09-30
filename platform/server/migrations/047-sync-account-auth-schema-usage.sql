-- Restore auth schema lookup for the JWT-bound SECURITY DEFINER RPC owners.
-- Function/table privileges remain separately scoped by their migrations.
do $migration$
declare
  role_name text;
  auth_roles text[] := array[
    'lumiq_api_owner',
    'lumiq_admin_owner',
    'lumiq_billing_owner',
    'lumiq_support_owner',
    'lumiq_session_owner',
    'lumiq_preview_owner'
  ];
begin
  if to_regnamespace('auth') is null then
    return;
  end if;

  foreach role_name in array auth_roles loop
    if not exists(select 1 from pg_roles where rolname=role_name) then
      raise exception 'Required Auth RPC owner % is missing before migration 047 can be applied',role_name;
    end if;
  end loop;

  if exists(
    select 1 from unnest(auth_roles) as target(role_name)
    where not has_schema_privilege(target.role_name,'auth','usage')
  ) and not has_schema_privilege(current_user,'auth','usage with grant option') then
    raise exception 'Supabase must grant USAGE ON SCHEMA auth with grant option before migration 047 can be applied';
  end if;

  foreach role_name in array auth_roles loop
    if not has_schema_privilege(role_name,'auth','usage') then
      execute format('grant usage on schema auth to %I',role_name);
    end if;
  end loop;
end
$migration$;
