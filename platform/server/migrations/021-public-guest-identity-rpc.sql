-- Keep public guest creation and token lookup off the shared runtime SQL role.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    create role lumiq_guest_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  elsif exists(select 1 from pg_roles where rolname='lumiq_guest_owner' and
    (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then
    raise exception 'lumiq_guest_owner must remain non-login and non-bypass';
  end if;

  grant usage on schema public to lumiq_guest_owner;
  grant select(id,status,paused,starts_at,ends_at,retention_at,storage_prefix) on public.events to lumiq_guest_owner;
  grant insert(id,event_id,name,token_hash,storage_prefix) on public.guests to lumiq_guest_owner;
  grant select(id,event_id,name,token_hash) on public.guests to lumiq_guest_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='guest_owner_live_event_select') then
    create policy guest_owner_live_event_select on public.events for select to lumiq_guest_owner
      using(status='published' and retention_at>now());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='guests' and policyname='guest_owner_public_insert') then
    create policy guest_owner_public_insert on public.guests for insert to lumiq_guest_owner
      with check(exists(select 1 from public.events e where e.id=event_id and e.status='published' and e.retention_at>now()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='guests' and policyname='guest_owner_token_select') then
    create policy guest_owner_token_select on public.guests for select to lumiq_guest_owner
      using(exists(select 1 from public.events e where e.id=event_id and e.status='published' and e.retention_at>now()));
  end if;

  create or replace function public.join_public_event(p_event_id uuid,p_guest_id uuid,p_name text,p_token_hash text)
  returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_event record; v_name text:=btrim(coalesce(p_name,''));
  begin
    if p_event_id is null or p_guest_id is null or p_token_hash !~ '^[a-f0-9]{64}$' or length(v_name)<1 or length(v_name)>80 then
      raise exception 'Invalid guest details' using errcode='22023';
    end if;
    select id,status,paused,starts_at,ends_at,retention_at,storage_prefix into v_event
      from public.events where id=p_event_id and status='published' and retention_at>now();
    if not found or v_event.paused or v_event.starts_at>now() or v_event.ends_at<=now() then
      raise exception 'Photo upload is not available for this event' using errcode='23514';
    end if;
    insert into public.guests(id,event_id,name,token_hash,storage_prefix)
      values(p_guest_id,p_event_id,v_name,p_token_hash,v_event.storage_prefix);
    return jsonb_build_object('id',p_guest_id,'name',v_name);
  end
  $function$;

  create or replace function public.get_public_guest_identity(p_event_id uuid,p_token_hash text)
  returns jsonb language sql stable security definer
  set search_path=pg_catalog,public
  as $function$
    select jsonb_build_object('id',g.id,'event_id',g.event_id,'name',g.name)
    from public.guests g join public.events e on e.id=g.event_id
    where g.event_id=p_event_id and g.token_hash=p_token_hash and p_token_hash ~ '^[a-f0-9]{64}$'
      and e.status='published' and e.retention_at>now()
    limit 1
  $function$;

  revoke all on function public.join_public_event(uuid,uuid,text,text) from public;
  revoke all on function public.get_public_guest_identity(uuid,text) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.join_public_event(uuid,uuid,text,text) owner to lumiq_guest_owner;
  alter function public.get_public_guest_identity(uuid,text) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.join_public_event(uuid,uuid,text,text) to anon;
    grant execute on function public.get_public_guest_identity(uuid,text) to anon;
  end if;
end
$migration$;
