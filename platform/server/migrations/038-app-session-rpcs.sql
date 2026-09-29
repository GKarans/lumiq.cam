-- Session hashes are server-held capabilities; account-bound writes still use auth.uid().
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_session_owner') then
    create role lumiq_session_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_session_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_session_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_session_owner;
  grant select(id) on public.accounts to lumiq_session_owner;
  grant select(token_hash,account_id,expires_at,provider_session),insert(token_hash,account_id,expires_at,provider_session),
    update(provider_session),delete on public.sessions to lumiq_session_owner;
  if to_regprocedure('auth.uid()') is not null then
    grant usage on schema auth to lumiq_session_owner;
    grant execute on function auth.uid() to lumiq_session_owner;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='sessions' and policyname='session_owner_session_access') then
      create policy session_owner_session_access on public.sessions for all to lumiq_session_owner using(true) with check(true);
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='session_owner_account_read') then
      create policy session_owner_account_read on public.accounts for select to lumiq_session_owner using(id=(select auth.uid()));
    end if;
  end if;

  create or replace function public.create_own_app_session(p_hash text,p_provider_session text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();
  begin
    if v_owner is null or p_hash !~ '^[0-9a-f]{64}$' or p_provider_session is null
      or length(p_provider_session)>32768 or not exists(select 1 from public.accounts where id=v_owner) then
      raise exception 'Invalid application session' using errcode='42501';
    end if;
    insert into public.sessions(token_hash,account_id,expires_at,provider_session)
      values(p_hash,v_owner,now()+interval '7 days',p_provider_session);
    return true;
  end
  $function$;

  create or replace function public.get_app_session(p_hash text)
  returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_result jsonb;
  begin
    if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
    select jsonb_build_object('account_id',s.account_id,'provider_session',s.provider_session,'expires_at',s.expires_at)
      into v_result from public.sessions s where s.token_hash=p_hash and s.expires_at>now();
    return v_result;
  end
  $function$;

  create or replace function public.update_app_session(p_hash text,p_provider_session text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_provider_session is null or length(p_provider_session)>32768 then
      raise exception 'Invalid application session' using errcode='22023';
    end if;
    update public.sessions set provider_session=p_provider_session
      where token_hash=p_hash and expires_at>now();
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  create or replace function public.delete_app_session(p_hash text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
    delete from public.sessions where token_hash=p_hash;
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  create or replace function public.delete_own_app_sessions()
  returns integer language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();v_count integer;
  begin
    if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
    delete from public.sessions where account_id=v_owner;
    get diagnostics v_count=row_count;
    return v_count;
  end
  $function$;

  revoke all on function public.create_own_app_session(text,text) from public;
  revoke all on function public.get_app_session(text) from public;
  revoke all on function public.update_app_session(text,text) from public;
  revoke all on function public.delete_app_session(text) from public;
  revoke all on function public.delete_own_app_sessions() from public;
  alter function public.create_own_app_session(text,text) owner to lumiq_session_owner;
  alter function public.get_app_session(text) owner to lumiq_session_owner;
  alter function public.update_app_session(text,text) owner to lumiq_session_owner;
  alter function public.delete_app_session(text) owner to lumiq_session_owner;
  alter function public.delete_own_app_sessions() owner to lumiq_session_owner;
  revoke create on schema public from lumiq_session_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.get_app_session(text) to anon;
    grant execute on function public.update_app_session(text,text) to anon;
    grant execute on function public.delete_app_session(text) to anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.create_own_app_session(text,text) to authenticated;
    grant execute on function public.get_app_session(text) to authenticated;
    grant execute on function public.update_app_session(text,text) to authenticated;
    grant execute on function public.delete_app_session(text) to authenticated;
    grant execute on function public.delete_own_app_sessions() to authenticated;
  end if;
end
$migration$;
