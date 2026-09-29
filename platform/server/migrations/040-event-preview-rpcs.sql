-- Keep preview tokens and draft event data behind narrow, expiring RPCs.
do $migration$
begin
  if to_regprocedure('auth.uid()') is null then return; end if;
  if not exists(select 1 from pg_roles where rolname='lumiq_preview_owner') then
    create role lumiq_preview_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_preview_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_preview_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_preview_owner;
  grant usage on schema auth to lumiq_preview_owner;
  grant execute on function auth.uid() to lumiq_preview_owner;
  grant select(id,owner_id,slug,name,description,starts_at,ends_at,time_zone,appearance,status,paused,retention_at,share_enabled,share_expires)
    on public.events to lumiq_preview_owner;
  grant select(token_hash,account_id,purpose,payload,expires_at),insert(token_hash,account_id,purpose,payload,expires_at)
    on public.auth_tokens to lumiq_preview_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='preview_owner_event_access') then
    create policy preview_owner_event_access on public.events for select to lumiq_preview_owner
      using(owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='auth_tokens' and policyname='preview_owner_token_access') then
    create policy preview_owner_token_access on public.auth_tokens for all to lumiq_preview_owner
      using(account_id=(select auth.uid())) with check(account_id=(select auth.uid()));
  end if;
  grant create on schema public to lumiq_preview_owner;

  create or replace function public.create_own_event_preview(p_event_id uuid,p_token_hash text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();
  begin
    if v_owner is null or p_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid preview request' using errcode='42501';
    end if;
    if not exists(select 1 from public.events where id=p_event_id and owner_id=v_owner and status<>'deleted') then
      raise exception 'Event not found' using errcode='P0002';
    end if;
    insert into public.auth_tokens(token_hash,account_id,purpose,payload,expires_at)
      values(p_token_hash,v_owner,'event-preview',jsonb_build_object('event_id',p_event_id),now()+interval '15 minutes');
    return true;
  end
  $function$;

  create or replace function public.get_event_preview(p_slug text,p_token_hash text)
  returns jsonb language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select jsonb_build_object(
      'id',e.id,'slug',e.slug,'name',e.name,'description',e.description,
      'starts_at',e.starts_at,'ends_at',e.ends_at,'time_zone',e.time_zone,
      'appearance',e.appearance,'status',e.status,'paused',e.paused,
      'retention_at',e.retention_at,'share_enabled',e.share_enabled,'share_expires',e.share_expires
    )
    from public.events e join public.auth_tokens t on t.account_id=e.owner_id
    where e.slug=p_slug and e.status<>'deleted' and t.token_hash=p_token_hash
      and t.purpose='event-preview' and t.expires_at>now() and t.payload->>'event_id'=e.id::text
    limit 1
  $function$;

  revoke all on function public.create_own_event_preview(uuid,text) from public;
  revoke all on function public.get_event_preview(text,text) from public;
  alter function public.create_own_event_preview(uuid,text) owner to lumiq_preview_owner;
  alter function public.get_event_preview(text,text) owner to lumiq_preview_owner;
  revoke create on schema public from lumiq_preview_owner;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.create_own_event_preview(uuid,text) to authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.get_event_preview(text,text) to anon;
  end if;
end
$migration$;
