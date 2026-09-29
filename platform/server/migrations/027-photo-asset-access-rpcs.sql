-- Authorize photo object reads and delivery metrics at the database boundary.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_guest_owner')
    and exists(select 1 from pg_roles where rolname='lumiq_api_owner') then

  grant select(id,event_id,guest_id,object_key,thumbnail_key,bytes,thumbnail_bytes,status,hidden)
    on public.media to lumiq_guest_owner;
  grant select(id,event_id,guest_id,object_key,thumbnail_key,bytes,thumbnail_bytes,status,hidden)
    on public.media to lumiq_api_owner;
  grant select(id,owner_id,status,starts_at,ends_at,paused,retention_at,share_enabled,share_expires)
    on public.events to lumiq_api_owner;
  grant insert(id,event_id,kind,amount) on public.metrics to lumiq_api_owner,lumiq_guest_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='metrics' and policyname='api_owner_photo_metric_insert') then
    create policy api_owner_photo_metric_insert on public.metrics for insert to lumiq_api_owner
      with check(kind in ('photo-bytes','thumbnail-bytes') and amount>0 and exists(
        select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='metrics' and policyname='guest_owner_photo_metric_insert') then
    create policy guest_owner_photo_metric_insert on public.metrics for insert to lumiq_guest_owner
      with check(kind in ('photo-bytes','thumbnail-bytes') and amount>0 and exists(
        select 1 from public.events e where e.id=event_id and e.status='published' and e.retention_at>now()));
  end if;

  create or replace function public.get_own_photo_asset(p_photo_id uuid,p_thumbnail boolean)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_media record;v_event record;v_kind text;v_bytes bigint;
  begin
    if auth.uid() is null or p_photo_id is null then raise exception 'Photo is unavailable' using errcode='42501'; end if;
    select m.id,m.event_id,m.guest_id,m.object_key,m.thumbnail_key,m.bytes,m.thumbnail_bytes,m.status,m.hidden
      into v_media from public.media m join public.events e on e.id=m.event_id
      where m.id=p_photo_id and m.status='uploaded' and e.owner_id=auth.uid() and e.status<>'deleted' and e.retention_at>now();
    if not found then return null; end if;
    select id,owner_id,status,starts_at,ends_at,paused,retention_at,share_enabled,share_expires
      into v_event from public.events where id=v_media.event_id;
    v_kind:=case when p_thumbnail then 'thumbnail-bytes' else 'photo-bytes' end;
    v_bytes:=case when p_thumbnail then v_media.thumbnail_bytes else v_media.bytes end;
    insert into public.metrics(id,event_id,kind,amount) values(gen_random_uuid(),v_media.event_id,v_kind,v_bytes);
    return jsonb_build_object('media',to_jsonb(v_media),'event',to_jsonb(v_event));
  end
  $function$;

  create or replace function public.get_public_photo_asset(p_photo_id uuid,p_thumbnail boolean)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_media record;v_event record;v_kind text;v_bytes bigint;
  begin
    if p_photo_id is null then raise exception 'Photo is unavailable' using errcode='42501'; end if;
    select m.id,m.event_id,m.guest_id,m.object_key,m.thumbnail_key,m.bytes,m.thumbnail_bytes,m.status,m.hidden,
      e.id as asset_event_id,e.owner_id,e.status as event_status,e.starts_at,e.ends_at,e.paused,e.retention_at,e.share_enabled,e.share_expires
      into v_media from public.media m join public.events e on e.id=m.event_id
      where m.id=p_photo_id and m.status='uploaded' and m.hidden=false and e.status='published'
        and e.ends_at<=now() and e.share_enabled=true and e.share_expires>now() and e.retention_at>now();
    if not found then raise exception 'Photo is unavailable' using errcode='42501'; end if;
    perform public.consume_public_gallery_share(v_media.asset_event_id);
    select id,owner_id,status,starts_at,ends_at,paused,retention_at,share_enabled,share_expires into v_event
      from public.events where id=v_media.asset_event_id;
    v_kind:=case when p_thumbnail then 'thumbnail-bytes' else 'photo-bytes' end;
    v_bytes:=case when p_thumbnail then v_media.thumbnail_bytes else v_media.bytes end;
    insert into public.metrics(id,event_id,kind,amount) values(gen_random_uuid(),v_media.asset_event_id,v_kind,v_bytes);
    return jsonb_build_object('media',jsonb_build_object('id',v_media.id,'event_id',v_media.event_id,'guest_id',v_media.guest_id,
      'object_key',v_media.object_key,'thumbnail_key',v_media.thumbnail_key,'bytes',v_media.bytes,'thumbnail_bytes',v_media.thumbnail_bytes,
      'status',v_media.status,'hidden',v_media.hidden),'event',jsonb_build_object('id',v_event.id,'owner_id',v_event.owner_id,
      'status',v_event.status,'starts_at',v_event.starts_at,'ends_at',v_event.ends_at,'paused',v_event.paused,
      'retention_at',v_event.retention_at,'share_enabled',v_event.share_enabled,'share_expires',v_event.share_expires));
  end
  $function$;

  revoke all on function public.get_own_photo_asset(uuid,boolean) from public;
  revoke all on function public.get_public_photo_asset(uuid,boolean) from public;
  grant create on schema public to lumiq_api_owner,lumiq_guest_owner;
  alter function public.get_own_photo_asset(uuid,boolean) owner to lumiq_api_owner;
  alter function public.get_public_photo_asset(uuid,boolean) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_api_owner,lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.get_own_photo_asset(uuid,boolean) to authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.get_public_photo_asset(uuid,boolean) to anon;
  end if;
  end if;
end
$migration$;
