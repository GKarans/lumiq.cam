-- Give the isolated job owner only the columns and policies needed by cleanup RPCs.
do $migration$
begin
  grant select(id,event_id,guest_id,object_key,thumbnail_key,thumbnail_bytes,thumbnail_checksum,name,bytes,captured_at,created_at,status,deleted_at) on public.media to lumiq_job_owner;
  grant update(thumbnail_bytes,thumbnail_checksum) on public.media to lumiq_job_owner;
  grant select(id,owner_id,appearance,ends_at,retention_at,status,slug,description,storage_prefix,entitlement,paused,share_enabled,share_expires,share_used,share_limit,gallery_cover_id) on public.events to lumiq_job_owner;
  grant update(status,slug,description,appearance,storage_prefix,entitlement,paused,share_enabled,share_expires,share_used,share_limit,gallery_cover_id) on public.events to lumiq_job_owner;
  grant select(id,event_id,name) on public.guests to lumiq_job_owner;
  grant delete on public.media,public.guests to lumiq_job_owner;
  grant select(id,owner_id,event_id,type,status,payload,result) on public.jobs to lumiq_job_owner;
  grant delete on public.jobs to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='job_owner_media_cleanup') then
    create policy job_owner_media_cleanup on public.media for all to lumiq_job_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='job_owner_events_cleanup') then
    create policy job_owner_events_cleanup on public.events for all to lumiq_job_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='guests' and policyname='job_owner_guests_cleanup') then
    create policy job_owner_guests_cleanup on public.guests for all to lumiq_job_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='job_owner_jobs_cleanup') then
    create policy job_owner_jobs_cleanup on public.jobs for all to lumiq_job_owner using(true) with check(true);
  end if;

  create or replace function public.get_platform_cleanup_manifest(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;v_result jsonb;v_event record;
  begin
    select * into v_job from public.jobs where id=p_job_id and status='processing'
      and type in ('object-cleanup','media-cleanup','cleanup','retention-cleanup','thumbnail-repair');
    if not found then raise exception 'Cleanup job is not being processed' using errcode='55000'; end if;
    if v_job.type='object-cleanup' then
      select jsonb_build_object('type',v_job.type,'owner_id',v_job.owner_id,'keys',coalesce(jsonb_agg(k.key),'[]'::jsonb)) into v_result
      from jsonb_array_elements_text(coalesce(v_job.payload->'keys','[]'::jsonb)) as k(key)
      where length(k.key)<=1024 and k.key !~ '(^/|(^|/)\.\.(/|$))'
        and not exists(select 1 from public.events e where e.owner_id=v_job.owner_id and
          (e.appearance->>'cover_key'=k.key or e.appearance->>'camera_cover_key'=k.key or e.appearance->>'cover_base_key'=k.key or e.appearance->>'qr_background_key'=k.key or e.appearance->>'qr_base_key'=k.key));
      return coalesce(v_result,jsonb_build_object('type',v_job.type,'owner_id',v_job.owner_id,'keys','[]'::jsonb));
    elsif v_job.type='thumbnail-repair' then
      select jsonb_build_object('type',v_job.type,'photo',jsonb_build_object('id',m.id,'object_key',m.object_key,'thumbnail_key',m.thumbnail_key)) into v_result
      from public.media m where m.id=(v_job.payload->>'id')::uuid and m.event_id=v_job.event_id and m.status='uploaded';
      if v_result is null then raise exception 'Photo no longer available' using errcode='P0002'; end if;
      return v_result;
    elsif v_job.type='media-cleanup' then
      select jsonb_build_object('type',v_job.type,'photos',coalesce(jsonb_agg(jsonb_build_object('id',m.id,'object_key',m.object_key,'thumbnail_key',m.thumbnail_key)),'[]'::jsonb)) into v_result
      from public.media m where m.event_id=v_job.event_id and m.id=any(array(select jsonb_array_elements_text(coalesce(v_job.payload->'ids','[]'::jsonb))::uuid)) and m.status='deleted';
      return v_result;
    end if;
    select id,owner_id,appearance into v_event from public.events where id=v_job.event_id;
    if not found then raise exception 'Event no longer exists' using errcode='P0002'; end if;
    select jsonb_build_object(
      'type',v_job.type,'owner_id',v_event.owner_id,
      'photos',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'object_key',m.object_key,'thumbnail_key',m.thumbnail_key)) from public.media m where m.event_id=v_job.event_id),'[]'::jsonb),
      'cover_keys',coalesce((select jsonb_agg(value) from jsonb_each_text(v_event.appearance) where key in ('cover_key','camera_cover_key','cover_base_key','qr_background_key','qr_base_key')),'[]'::jsonb),
      'exports',coalesce((select jsonb_agg(jsonb_build_object('result',j.result)) from public.jobs j where j.event_id=v_job.event_id and j.type in ('export','export-part')),'[]'::jsonb),
      'appearance',v_event.appearance
    ) into v_result;
    return v_result;
  end
  $function$;

  create or replace function public.can_delete_platform_asset(p_job_id uuid,p_key text)
  returns boolean language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select exists(select 1 from public.jobs j where j.id=p_job_id and j.status='processing' and (
      (j.type='object-cleanup' and p_key=any(array(select jsonb_array_elements_text(coalesce(j.payload->'keys','[]'::jsonb))))
        and not exists(select 1 from public.events e where e.owner_id=j.owner_id and
         (e.appearance->>'cover_key'=p_key or e.appearance->>'camera_cover_key'=p_key or e.appearance->>'cover_base_key'=p_key or e.appearance->>'qr_background_key'=p_key or e.appearance->>'qr_base_key'=p_key)))
      or (j.type in ('cleanup','retention-cleanup') and exists(select 1 from public.events current_event where current_event.id=j.event_id and
        p_key=any(array(select value from jsonb_each_text(current_event.appearance) where key in ('cover_key','camera_cover_key','cover_base_key','qr_background_key','qr_base_key'))))
        and not exists(select 1 from public.events other_event where other_event.owner_id=j.owner_id and other_event.id<>j.event_id and
         (other_event.appearance->>'cover_key'=p_key or other_event.appearance->>'camera_cover_key'=p_key or other_event.appearance->>'cover_base_key'=p_key or other_event.appearance->>'qr_background_key'=p_key or other_event.appearance->>'qr_base_key'=p_key))
      )
    ))
  $function$;

  create or replace function public.save_platform_thumbnail_details(p_job_id uuid,p_photo_id uuid,p_bytes integer,p_checksum text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    if p_bytes is null or p_bytes<1 or p_bytes>1048576 or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid thumbnail metadata' using errcode='22023'; end if;
    update public.media m set thumbnail_bytes=p_bytes,thumbnail_checksum=p_checksum from public.jobs j
      where j.id=p_job_id and j.status='processing' and j.type='thumbnail-repair' and m.id=p_photo_id and m.id=(j.payload->>'id')::uuid and m.event_id=j.event_id and m.status='uploaded';
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  create or replace function public.platform_media_cleanup_should_defer(p_job_id uuid)
  returns boolean language plpgsql stable security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;v_event record;v_selected uuid[];v_has_auto boolean;v_waiting boolean;
  begin
    select * into v_job from public.jobs where id=p_job_id and status='processing' and type='media-cleanup';
    if not found then raise exception 'Media cleanup is not being processed' using errcode='55000'; end if;
    select id,ends_at,retention_at into v_event from public.events where id=v_job.event_id;
    if not found or v_event.ends_at>now() or v_event.retention_at<=now() then return false; end if;
    select coalesce(array_agg(m.id),'{}'::uuid[]) into v_selected from public.media m
      where m.event_id=v_event.id and m.id=any(array(select jsonb_array_elements_text(coalesce(v_job.payload->'ids','[]'::jsonb))::uuid))
        and m.status='deleted' and m.deleted_at>v_event.ends_at;
    if cardinality(v_selected)=0 then return false; end if;
    select exists(select 1 from public.jobs j where j.event_id=v_event.id and j.type='export' and j.payload->>'automatic'='true') into v_has_auto;
    if not v_has_auto then return true; end if;
    select exists(select 1 from public.jobs j where j.event_id=v_event.id and j.type='export' and j.payload->>'automatic'='true'
      and j.status<>'ready' and exists(select 1 from jsonb_array_elements_text(coalesce(j.payload->'ids','[]'::jsonb)) export_id where export_id::uuid=any(v_selected))) into v_waiting;
    return v_waiting;
  end
  $function$;

  create or replace function public.finalize_platform_event_cleanup(p_job_id uuid,p_removed integer)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;v_event record;v_count integer;
  begin
    select * into v_job from public.jobs where id=p_job_id and status='processing' and type in ('cleanup','retention-cleanup') for update;
    if not found then raise exception 'Event cleanup is not being processed' using errcode='55000'; end if;
    select id into v_event from public.events where id=v_job.event_id for update;
    if not found then return jsonb_build_object('removed',greatest(coalesce(p_removed,0),0)); end if;
    delete from public.media where event_id=v_event.id;
    get diagnostics v_count=row_count;
    delete from public.guests where event_id=v_event.id;
    delete from public.jobs where event_id=v_event.id and id<>p_job_id;
    update public.events set status=case when v_job.type='cleanup' then 'deleted' else 'archived' end,
      slug='expired-'||id::text,description='',appearance='{}',storage_prefix='expired/events/'||id::text,
      entitlement=jsonb_build_object('retentionDays',coalesce((entitlement->>'retentionDays')::integer,14)),
      paused=true,share_enabled=false,share_expires=null,share_used=0,share_limit=0,gallery_cover_id=null where id=v_event.id;
    return jsonb_build_object('removed',v_count);
  end
  $function$;

  revoke all on function public.get_platform_cleanup_manifest(uuid) from public;
  revoke all on function public.can_delete_platform_asset(uuid,text) from public;
  revoke all on function public.save_platform_thumbnail_details(uuid,uuid,integer,text) from public;
  revoke all on function public.platform_media_cleanup_should_defer(uuid) from public;
  revoke all on function public.finalize_platform_event_cleanup(uuid,integer) from public;
  alter function public.get_platform_cleanup_manifest(uuid) owner to lumiq_job_owner;
  alter function public.can_delete_platform_asset(uuid,text) owner to lumiq_job_owner;
  alter function public.save_platform_thumbnail_details(uuid,uuid,integer,text) owner to lumiq_job_owner;
  alter function public.platform_media_cleanup_should_defer(uuid) owner to lumiq_job_owner;
  alter function public.finalize_platform_event_cleanup(uuid,integer) owner to lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.get_platform_cleanup_manifest(uuid) to lumiq_restore_runtime;
    grant execute on function public.can_delete_platform_asset(uuid,text) to lumiq_restore_runtime;
    grant execute on function public.save_platform_thumbnail_details(uuid,uuid,integer,text) to lumiq_restore_runtime;
    grant execute on function public.platform_media_cleanup_should_defer(uuid) to lumiq_restore_runtime;
    grant execute on function public.finalize_platform_event_cleanup(uuid,integer) to lumiq_restore_runtime;
  end if;
end
$migration$;
