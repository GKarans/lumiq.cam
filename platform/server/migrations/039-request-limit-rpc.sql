-- A single atomic RPC owns all shared HTTP request-limit counter writes.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_limit_owner') then
    create role lumiq_limit_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_limit_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_limit_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_limit_owner;
  grant select,insert,update on public.request_limits to lumiq_limit_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='request_limits' and policyname='limit_owner_counter_access') then
    create policy limit_owner_counter_access on public.request_limits for all to lumiq_limit_owner using(true) with check(true);
  end if;

  create or replace function public.consume_request_limit(p_key_hash text,p_window_id bigint,p_limit integer)
  returns integer language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_requests integer;
  begin
    if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_window_id is null
      or abs(p_window_id-floor(extract(epoch from clock_timestamp())/60)::bigint)>1
      or p_limit is null or p_limit<1 or p_limit>2000 then
      raise exception 'Invalid request limit' using errcode='22023';
    end if;
    insert into public.request_limits(key_hash,window_id,requests,expires_at)
      values(p_key_hash,p_window_id,1,now()+interval '2 minutes')
    on conflict(key_hash) do update set
      requests=case when public.request_limits.window_id=excluded.window_id then public.request_limits.requests+1 else 1 end,
      window_id=excluded.window_id,expires_at=excluded.expires_at
    returning requests into v_requests;
    return v_requests;
  end
  $function$;

  revoke all on function public.consume_request_limit(text,bigint,integer) from public;
  alter function public.consume_request_limit(text,bigint,integer) owner to lumiq_limit_owner;
  revoke create on schema public from lumiq_limit_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.consume_request_limit(text,bigint,integer) to anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.consume_request_limit(text,bigint,integer) to authenticated;
  end if;
end
$migration$;
