-- Keep organizer gallery mutations and cleanup scheduling inside an owner JWT transaction.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,event_id,status) on public.media to lumiq_api_owner;
    grant update(favorite,hidden,status,deleted_at) on public.media to lumiq_api_owner;
    grant select(gallery_cover_id),update(gallery_cover_id) on public.events to lumiq_api_owner;
    grant insert(id,owner_id,event_id,type,payload) on public.jobs to lumiq_api_owner;
    grant insert(id,actor_id,action,target_id,detail) on public.audit to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='api_owner_media_curate') then
      create policy api_owner_media_curate on public.media for update to lumiq_api_owner
        using(exists(select 1 from public.events e where e.id=media.event_id and e.owner_id=(select auth.uid())))
        with check(exists(select 1 from public.events e where e.id=media.event_id and e.owner_id=(select auth.uid())));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_media_cleanup_insert') then
      create policy api_owner_media_cleanup_insert on public.jobs for insert to lumiq_api_owner
        with check(owner_id=(select auth.uid()) and type='media-cleanup'
          and exists(select 1 from public.events e where e.id=jobs.event_id and e.owner_id=(select auth.uid())));
    end if;

    create or replace function public.curate_own_gallery(p_event_id uuid,p_photo_ids uuid[],p_action text)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
    as $function$
    declare v_owner uuid:=auth.uid();v_count integer;
    begin
      if v_owner is null or p_event_id is null or p_photo_ids is null or cardinality(p_photo_ids)<1
        or cardinality(p_photo_ids)>200 or cardinality(p_photo_ids)<>(select count(distinct id) from unnest(p_photo_ids) id)
        or p_action is null or p_action not in ('favorite','unfavorite','hide','restore','cover','delete') then
        raise exception 'Invalid gallery action' using errcode='22023';
      end if;
      perform 1 from public.events e where e.id=p_event_id and e.owner_id=v_owner
        and e.status<>'deleted' and e.retention_at>now() for update;
      if not found then raise exception 'Event not found' using errcode='42501'; end if;
      if p_action='cover' and cardinality(p_photo_ids)<>1 then
        raise exception 'Choose one gallery cover' using errcode='22023';
      end if;
      select count(*)::integer into v_count from public.media m
        where m.event_id=p_event_id and m.id=any(p_photo_ids) and m.status='uploaded';
      if v_count<>cardinality(p_photo_ids) then raise exception 'Some selected photos are unavailable' using errcode='P0002'; end if;

      if p_action='favorite' then update public.media set favorite=true where event_id=p_event_id and id=any(p_photo_ids);
      elsif p_action='unfavorite' then update public.media set favorite=false where event_id=p_event_id and id=any(p_photo_ids);
      elsif p_action='hide' then update public.media set hidden=true where event_id=p_event_id and id=any(p_photo_ids);
      elsif p_action='restore' then update public.media set hidden=false where event_id=p_event_id and id=any(p_photo_ids);
      elsif p_action='cover' then update public.events set gallery_cover_id=p_photo_ids[1] where id=p_event_id;
      else
        update public.media set status='deleted',deleted_at=now() where event_id=p_event_id and id=any(p_photo_ids);
        update public.events set gallery_cover_id=null where id=p_event_id and gallery_cover_id=any(p_photo_ids);
        insert into public.jobs(id,owner_id,event_id,type,payload)
          values(gen_random_uuid(),v_owner,p_event_id,'media-cleanup',jsonb_build_object('ids',to_jsonb(p_photo_ids)));
      end if;
      insert into public.audit(id,actor_id,action,target_id,detail)
        values(gen_random_uuid(),v_owner,'gallery.'||p_action,p_event_id::text,jsonb_build_object('ids',to_jsonb(p_photo_ids)));
      return jsonb_build_object('ok',true);
    end
    $function$;
    revoke all on function public.curate_own_gallery(uuid,uuid[],text) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.curate_own_gallery(uuid,uuid[],text) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.curate_own_gallery(uuid,uuid[],text) to authenticated;
  end if;
end
$migration$;
