-- Keep the shared Worker role away from the R2 accounting table.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_storage_owner') then
    create role lumiq_storage_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_storage_owner'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then
    raise exception 'lumiq_storage_owner must remain a non-login, non-inheriting, non-bypass role';
  end if;

  grant usage on schema public to lumiq_storage_owner;
  grant select,insert,update on public.r2_usage_guard to lumiq_storage_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='r2_usage_guard'
    and policyname='storage_owner_budget_access') then
    create policy storage_owner_budget_access on public.r2_usage_guard for all to lumiq_storage_owner
      using(true) with check(true);
  end if;

  create or replace function public.reserve_r2_budget(
    p_class_a bigint,p_class_b bigint,p_bytes bigint,
    p_class_a_limit bigint,p_class_b_limit bigint,p_lifetime_bytes_limit bigint
  ) returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_reserved boolean;
  begin
    if p_class_a is null or p_class_b is null or p_bytes is null
      or p_class_a<0 or p_class_b<0 or p_bytes<0
      or p_class_a_limit is null or p_class_b_limit is null or p_lifetime_bytes_limit is null
      or p_class_a_limit<1 or p_class_b_limit<1 or p_lifetime_bytes_limit<1 then
      raise exception 'Invalid R2 budget reservation' using errcode='22023';
    end if;

    insert into public.r2_usage_guard(singleton,month_start,class_a_ops,class_b_ops,lifetime_write_bytes)
      select true,date_trunc('month',now() at time zone 'UTC')::date,p_class_a,p_class_b,p_bytes
      where p_class_a<=p_class_a_limit and p_class_b<=p_class_b_limit and p_bytes<=p_lifetime_bytes_limit
    on conflict(singleton) do update set
      month_start=excluded.month_start,
      class_a_ops=case when public.r2_usage_guard.month_start=excluded.month_start
        then public.r2_usage_guard.class_a_ops+excluded.class_a_ops else excluded.class_a_ops end,
      class_b_ops=case when public.r2_usage_guard.month_start=excluded.month_start
        then public.r2_usage_guard.class_b_ops+excluded.class_b_ops else excluded.class_b_ops end,
      lifetime_write_bytes=public.r2_usage_guard.lifetime_write_bytes+excluded.lifetime_write_bytes
    where
      (case when public.r2_usage_guard.month_start=excluded.month_start
        then public.r2_usage_guard.class_a_ops+excluded.class_a_ops else excluded.class_a_ops end)<=p_class_a_limit
      and (case when public.r2_usage_guard.month_start=excluded.month_start
        then public.r2_usage_guard.class_b_ops+excluded.class_b_ops else excluded.class_b_ops end)<=p_class_b_limit
      and public.r2_usage_guard.lifetime_write_bytes+excluded.lifetime_write_bytes<=p_lifetime_bytes_limit
    returning true into v_reserved;
    return coalesce(v_reserved,false);
  end
  $function$;

  revoke all on function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) from public;
  grant create on schema public to lumiq_storage_owner;
  alter function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) owner to lumiq_storage_owner;
  revoke create on schema public from lumiq_storage_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) to lumiq_restore_runtime;
  end if;
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function public.reserve_r2_budget(bigint,bigint,bigint,bigint,bigint,bigint) from authenticated;
  end if;
end
$migration$;
