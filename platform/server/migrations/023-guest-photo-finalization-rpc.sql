-- Keep guest photo reads and completion behind the event-scoped capability.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    raise exception 'Apply migration 021 before guest photo finalization';
  end if;

  grant select(id,owner_id,status,paused,starts_at,ends_at,retention_at) on public.events to lumiq_guest_owner;
  grant select(id,event_id,name,token_hash) on public.guests to lumiq_guest_owner;
  grant select(id,event_id,guest_id,object_key,thumbnail_key,bytes,thumbnail_bytes,checksum,thumbnail_checksum,status)
    on public.media to lumiq_guest_owner;
  grant update(status,deleted_at) on public.media to lumiq_guest_owner;
  grant insert(id,owner_id,event_id,type,payload,available_at) on public.jobs to lumiq_guest_owner;
  grant insert(id,event_id,kind,amount) on public.metrics to lumiq_guest_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='guest_owner_media_update') then
    create policy guest_owner_media_update on public.media for update to lumiq_guest_owner
      using(status='pending' and exists(select 1 from public.guests g join public.events e on e.id=g.event_id
        where g.id=media.guest_id and g.event_id=media.event_id and e.status='published' and e.retention_at>now()))
      with check(status in ('uploaded','deleted') and exists(select 1 from public.guests g join public.events e on e.id=g.event_id
        where g.id=media.guest_id and g.event_id=media.event_id and e.status='published' and e.retention_at>now()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='guest_owner_photo_cleanup_insert') then
    create policy guest_owner_photo_cleanup_insert on public.jobs for insert to lumiq_guest_owner
      with check(type='media-cleanup' and jsonb_array_length(payload->'ids')=1 and exists(
        select 1 from public.events e join public.media m on m.event_id=e.id
        where e.id=jobs.event_id and e.owner_id=jobs.owner_id and e.status='published' and e.retention_at>now()
          and m.id=(payload->'ids'->>0)::uuid and m.status='deleted'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='metrics' and policyname='guest_owner_upload_metric_insert') then
    create policy guest_owner_upload_metric_insert on public.metrics for insert to lumiq_guest_owner
      with check(kind='upload-completed' and amount=1 and exists(select 1 from public.events e
        where e.id=event_id and e.status='published' and e.retention_at>now()));
  end if;

  create or replace function public.get_guest_photo_upload(p_event_id uuid,p_photo_id uuid,p_token_hash text)
  returns jsonb language plpgsql stable security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_photo record;
  begin
    if p_event_id is null or p_photo_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid photo capability' using errcode='22023';
    end if;
    select m.id,m.event_id,m.guest_id,m.object_key,m.thumbnail_key,m.bytes,m.thumbnail_bytes,m.checksum,m.thumbnail_checksum,m.status
      into v_photo from public.media m join public.guests g on g.id=m.guest_id join public.events e on e.id=m.event_id
      where m.id=p_photo_id and m.event_id=p_event_id and g.token_hash=p_token_hash and e.status='published'
        and e.retention_at>now() and e.paused=false and e.starts_at<=now() and e.ends_at>now()
        and m.status in ('pending','uploaded');
    if not found then raise exception 'Photo upload is unavailable' using errcode='42501'; end if;
    return to_jsonb(v_photo);
  end
  $function$;

  create or replace function public.finalize_guest_photo(p_event_id uuid,p_photo_id uuid,p_token_hash text)
  returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_photo record;
  begin
    if p_event_id is null or p_photo_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid photo capability' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
    select m.id,m.event_id,m.guest_id,m.status,e.owner_id into v_photo
      from public.media m join public.guests g on g.id=m.guest_id join public.events e on e.id=m.event_id
      where m.id=p_photo_id and m.event_id=p_event_id and g.token_hash=p_token_hash and e.status='published'
        and e.retention_at>now() and e.paused=false and e.starts_at<=now() and e.ends_at>now()
        and m.status in ('pending','uploaded') for update of m;
    if not found then raise exception 'Photo upload is unavailable' using errcode='42501'; end if;
    if v_photo.status='pending' then
      update public.media set status='uploaded' where id=v_photo.id;
      insert into public.metrics(id,event_id,kind,amount) values(gen_random_uuid(),p_event_id,'upload-completed',1);
    end if;
    return jsonb_build_object('ok',true);
  end
  $function$;

  create or replace function public.discard_guest_photo(p_event_id uuid,p_photo_id uuid,p_token_hash text)
  returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_photo record;
  begin
    if p_event_id is null or p_photo_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid photo capability' using errcode='22023';
    end if;
    select m.id,m.event_id,m.status,e.owner_id into v_photo
      from public.media m join public.guests g on g.id=m.guest_id join public.events e on e.id=m.event_id
      where m.id=p_photo_id and m.event_id=p_event_id and g.token_hash=p_token_hash and e.status='published'
        and e.retention_at>now() and m.status='pending' for update of m;
    if found then
      update public.media set status='deleted',deleted_at=now() where id=v_photo.id;
      insert into public.jobs(id,owner_id,event_id,type,payload,available_at)
        values(gen_random_uuid(),v_photo.owner_id,v_photo.event_id,'media-cleanup',jsonb_build_object('ids',jsonb_build_array(v_photo.id)),now()+interval '6 minutes');
    end if;
    return jsonb_build_object('ok',true);
  end
  $function$;

  revoke all on function public.get_guest_photo_upload(uuid,uuid,text) from public;
  revoke all on function public.finalize_guest_photo(uuid,uuid,text) from public;
  revoke all on function public.discard_guest_photo(uuid,uuid,text) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.get_guest_photo_upload(uuid,uuid,text) owner to lumiq_guest_owner;
  alter function public.finalize_guest_photo(uuid,uuid,text) owner to lumiq_guest_owner;
  alter function public.discard_guest_photo(uuid,uuid,text) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.get_guest_photo_upload(uuid,uuid,text) to anon;
    grant execute on function public.finalize_guest_photo(uuid,uuid,text) to anon;
    grant execute on function public.discard_guest_photo(uuid,uuid,text) to anon;
  end if;
end
$migration$;
