-- Reserve photo rows and object keys under a guest capability, enforcing limits in PostgreSQL.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    raise exception 'Apply migration 021 before guest photo reservation';
  end if;
  grant select(id,owner_id,status,paused,starts_at,ends_at,retention_at,storage_prefix,entitlement) on public.events to lumiq_guest_owner;
  grant select(id,event_id,name,token_hash) on public.guests to lumiq_guest_owner;
  grant select(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,checksum,thumbnail_checksum,status,created_at,deleted_at,captured_at,favorite,hidden),
    insert(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,checksum,thumbnail_checksum,captured_at) on public.media to lumiq_guest_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='guest_owner_media_select') then
    create policy guest_owner_media_select on public.media for select to lumiq_guest_owner
      using(exists(select 1 from public.guests g join public.events e on e.id=g.event_id
        where g.id=media.guest_id and g.event_id=media.event_id and e.status='published' and e.retention_at>now()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='guest_owner_media_insert') then
    create policy guest_owner_media_insert on public.media for insert to lumiq_guest_owner
      with check(exists(select 1 from public.guests g join public.events e on e.id=g.event_id
        where g.id=media.guest_id and g.event_id=media.event_id and e.status='published' and e.paused=false
          and e.starts_at<=now() and e.ends_at>now() and e.retention_at>now()));
  end if;

  create or replace function public.reserve_guest_photo(
    p_event_id uuid,p_photo_id uuid,p_guest_token_hash text,p_guest_folder text,p_filename_prefix text,p_name text,p_bytes bigint,p_thumbnail_bytes bigint,
    p_checksum text,p_thumbnail_checksum text,p_captured_at_ms bigint
  ) returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare
    v_event record; v_guest record; v_previous record; v_used record;
    v_id text:=replace(p_photo_id::text,'-',''); v_suffix text; v_capture timestamptz;
    v_stamp text; v_prefix text; v_filename text; v_object_key text; v_thumbnail_key text;
    v_offset integer; v_candidate integer[]:=array[26,0,6,12,18,24];
  begin
    if p_event_id is null or p_photo_id is null or p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
      or p_name is null or length(p_name)<1 or length(p_name)>180
      or p_bytes is null or p_bytes<1 or p_bytes>6291456
      or p_thumbnail_bytes is null or p_thumbnail_bytes<1 or p_thumbnail_bytes>1048576
      or p_checksum is null or p_thumbnail_checksum is null or p_checksum !~ '^[a-f0-9]{64}$' or p_thumbnail_checksum !~ '^[a-f0-9]{64}$'
      or p_guest_folder is null or p_guest_folder !~ '^[a-z0-9-]{1,60}-[a-f0-9]{6}$'
      or p_filename_prefix is null or p_filename_prefix !~ '^[a-z0-9-]{1,60}-[0-9]{8}T[0-9]{6}Z$' then
      raise exception 'Invalid photo metadata' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
    select id,status,paused,starts_at,ends_at,retention_at,storage_prefix,entitlement into v_event
      from public.events where id=p_event_id and status='published' and retention_at>now();
    if not found or v_event.paused or v_event.starts_at>now() or v_event.ends_at<=now() then
      raise exception 'This event is closed for uploads' using errcode='23514';
    end if;
    select id,event_id,name,token_hash into v_guest from public.guests
      where event_id=p_event_id and token_hash=p_guest_token_hash;
    if not found then raise exception 'Guest identity is invalid' using errcode='42501'; end if;
    select * into v_previous from public.media where id=p_photo_id;
    if found then
      if v_previous.event_id<>p_event_id or v_previous.guest_id<>v_guest.id or v_previous.bytes<>p_bytes
        or v_previous.thumbnail_bytes<>p_thumbnail_bytes or v_previous.checksum<>p_checksum
        or v_previous.thumbnail_checksum<>p_thumbnail_checksum or v_previous.status='deleted' then
        raise exception 'This upload cannot be replaced' using errcode='23514';
      end if;
      return to_jsonb(v_previous);
    end if;
    select count(*)::integer as photos,coalesce(sum(bytes+thumbnail_bytes),0)::bigint as bytes
      into v_used from public.media where event_id=p_event_id and status in ('pending','uploaded');
    if v_used.photos>=coalesce((v_event.entitlement->>'photos')::integer,0)
      or v_used.bytes+p_bytes+p_thumbnail_bytes>coalesce((v_event.entitlement->>'bytes')::bigint,0) then
      raise exception 'This event has reached its photo or storage allowance' using errcode='23514';
    end if;
    if v_event.storage_prefix is null or v_event.storage_prefix !~ '^[a-z0-9/-]{1,240}$' then
      raise exception 'Event storage path is unavailable' using errcode='23514';
    end if;
    if right(p_guest_folder,6)<>substr(replace(v_guest.id::text,'-',''),27,6) then
      raise exception 'Guest storage path is invalid' using errcode='42501';
    end if;
    v_prefix:=v_event.storage_prefix||'/'||p_guest_folder;
    if p_captured_at_ms>=315532800000 and p_captured_at_ms<=floor(extract(epoch from now()+interval '1 day')*1000) then
      v_capture:=to_timestamp(p_captured_at_ms::numeric/1000);
    else v_capture:=now(); end if;
    v_stamp:=to_char(v_capture at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"');
    foreach v_offset in array v_candidate loop
      v_suffix:=substr(v_id,v_offset+1,6);
      if split_part(p_filename_prefix,'-',array_length(regexp_split_to_array(p_filename_prefix,'-'),1))<>v_stamp then
        raise exception 'Photo filename timestamp is invalid' using errcode='22023';
      end if;
      v_filename:=p_filename_prefix||'-'||v_suffix||'.webp';
      v_object_key:=v_prefix||'/'||v_filename;
      v_thumbnail_key:=v_prefix||'/thumb/'||v_filename;
      exit when not exists(select 1 from public.media m where m.object_key in (v_object_key,v_thumbnail_key) or m.thumbnail_key in (v_object_key,v_thumbnail_key));
      v_filename:=null;
    end loop;
    if v_filename is null then raise exception 'Could not allocate a unique photo filename' using errcode='23514'; end if;
    insert into public.media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,checksum,thumbnail_checksum,captured_at)
      values(p_photo_id,p_event_id,v_guest.id,v_object_key,v_thumbnail_key,p_name,p_bytes,p_thumbnail_bytes,p_checksum,p_thumbnail_checksum,v_capture)
      returning * into v_previous;
    return to_jsonb(v_previous);
  end
  $function$;
  revoke all on function public.reserve_guest_photo(uuid,uuid,text,text,text,text,bigint,bigint,text,text,bigint) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.reserve_guest_photo(uuid,uuid,text,text,text,text,bigint,bigint,text,text,bigint) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.reserve_guest_photo(uuid,uuid,text,text,text,text,bigint,bigint,text,text,bigint) to anon;
  end if;
end
$migration$;
