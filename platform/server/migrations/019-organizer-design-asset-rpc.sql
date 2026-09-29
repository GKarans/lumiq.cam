-- Reserve and attach uploaded design objects without granting organizer table DML.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,verified,deleted_at,storage_prefix) on public.accounts to lumiq_api_owner;
    grant select(id,owner_id,name,status,appearance,storage_prefix,retention_at),update(appearance) on public.events to lumiq_api_owner;
    grant insert(id,owner_id,event_id,type,payload,available_at),select(id,owner_id,event_id,type,status,payload),update(status),delete on public.jobs to lumiq_api_owner;
    grant insert(id,actor_id,action,target_id) on public.audit to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_design_job_select') then
      create policy api_owner_design_job_select on public.jobs for select to lumiq_api_owner
        using(owner_id=(select auth.uid()) and type='object-cleanup'
          and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_design_job_update') then
      create policy api_owner_design_job_update on public.jobs for update to lumiq_api_owner
        using(owner_id=(select auth.uid()) and type='object-cleanup' and status='queued'
          and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())))
        with check(owner_id=(select auth.uid()) and type='object-cleanup'
          and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_design_job_delete') then
      create policy api_owner_design_job_delete on public.jobs for delete to lumiq_api_owner
        using(owner_id=(select auth.uid()) and type='object-cleanup' and status='queued'
          and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
    end if;

    create or replace function public.reserve_own_design_asset(p_event_id uuid,p_asset_type text)
    returns jsonb language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_event record;
      v_account record;
      v_job_id uuid:=gen_random_uuid();
      v_object_key text;
      v_owner_prefix text;
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_asset_type is null or p_asset_type not in ('cover','camera_cover','cover_source','qr_source','qr_background') then raise exception 'Invalid design asset type' using errcode='22023'; end if;
      select id,verified,deleted_at,storage_prefix into v_account from public.accounts where id=v_owner for update;
      if not found or not v_account.verified or v_account.deleted_at is not null then raise exception 'Account unavailable' using errcode='42501'; end if;
      select id,owner_id,status,storage_prefix,retention_at into v_event from public.events
        where id=p_event_id and owner_id=v_owner for update;
      if not found then raise exception 'Event not found' using errcode='P0002'; end if;
      if v_event.status not in ('draft','published') or v_event.retention_at<=now() then raise exception 'This event can no longer be redesigned' using errcode='23514'; end if;
      if v_event.storage_prefix is null or v_event.storage_prefix !~ '^[a-z0-9-]{1,100}/events/[a-z0-9-]{1,120}-[a-f0-9]{6}$' then
        raise exception 'Event storage path is unavailable' using errcode='23514';
      end if;
      v_owner_prefix:=v_account.storage_prefix;
      if v_owner_prefix is null then
        v_owner_prefix:=split_part(v_event.storage_prefix,'/events/',1);
        update public.accounts set storage_prefix=v_owner_prefix where id=v_owner;
      elsif left(v_event.storage_prefix,length(v_owner_prefix||'/events/'))<>v_owner_prefix||'/events/' then
        raise exception 'Event storage path does not belong to this account' using errcode='42501';
      end if;
      v_object_key:=v_event.storage_prefix||'/'||p_asset_type||'-'||replace(v_job_id::text,'-','')||'.webp';
      insert into public.jobs(id,owner_id,event_id,type,payload,available_at)
        values(v_job_id,v_owner,p_event_id,'object-cleanup',jsonb_build_object('keys',jsonb_build_array(v_object_key)),now()+interval '10 minutes');
      return jsonb_build_object('reservation_id',v_job_id,'object_key',v_object_key);
    end
    $function$;

    create or replace function public.attach_own_design_asset(p_event_id uuid,p_asset_type text,p_object_key text,p_reservation_id uuid)
    returns jsonb language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_event record;
      v_job record;
      v_current jsonb:='{}'::jsonb;
      v_item jsonb;
      v_layout jsonb;
      v_previous text;
      v_appearance jsonb;
      v_account_prefix text;
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_event_id is null or p_reservation_id is null or p_asset_type is null or p_asset_type not in ('cover','camera_cover','cover_source','qr_source','qr_background') or p_object_key is null then
        raise exception 'Invalid design asset attachment' using errcode='22023';
      end if;
      perform 1 from public.accounts where id=v_owner and verified=true and deleted_at is null for update;
      if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
      select id,owner_id,name,status,appearance,storage_prefix,retention_at into v_event from public.events
        where id=p_event_id and owner_id=v_owner for update;
      if not found then raise exception 'Event not found' using errcode='P0002'; end if;
      if v_event.status not in ('draft','published') or v_event.retention_at<=now() then raise exception 'This event can no longer be redesigned' using errcode='23514'; end if;
      select storage_prefix into v_account_prefix from public.accounts where id=v_owner;
      if v_account_prefix is null or left(v_event.storage_prefix,length(v_account_prefix||'/events/'))<>v_account_prefix||'/events/' then
        raise exception 'Event storage path does not belong to this account' using errcode='42501';
      end if;
      if p_object_key !~ ('^'||v_event.storage_prefix||'/(cover|camera_cover|cover_source|qr_source|qr_background)-[a-f0-9]{32}[.]webp$') then
        raise exception 'Invalid design asset key' using errcode='42501';
      end if;
      select id,owner_id,event_id,type,status,payload into v_job from public.jobs
        where id=p_reservation_id and owner_id=v_owner and event_id=p_event_id and type='object-cleanup' for update;
      if not found or v_job.status<>'queued' or v_job.payload->'keys'<>jsonb_build_array(p_object_key) then
        raise exception 'Design upload reservation expired' using errcode='23514';
      end if;
      if jsonb_typeof(v_event.appearance)='object' then
        v_current:=v_event.appearance;
      elsif jsonb_typeof(v_event.appearance)='array' then
        for v_item in select value from jsonb_array_elements(v_event.appearance) loop
          if jsonb_typeof(v_item)='string' then begin v_item:=(v_item#>>'{}')::jsonb; exception when others then v_item:='{}'::jsonb; end; end if;
          if jsonb_typeof(v_item)='object' then v_current:=v_current||v_item; end if;
        end loop;
      end if;
      v_appearance:=v_current;
      if p_asset_type='cover' then
        v_previous:=v_current->>'cover_key';
        v_appearance:=v_current||jsonb_build_object('cover','/api/covers/'||p_event_id||case when v_current ? 'guest_design' then '?design=1' else '' end,'cover_key',p_object_key);
      elsif p_asset_type='camera_cover' then
        v_previous:=v_current->>'camera_cover_key';
        v_appearance:=v_current||jsonb_build_object('camera_cover','/api/covers/'||p_event_id||'?design=1&screen=camera','camera_cover_key',p_object_key);
      elsif p_asset_type='cover_source' then
        v_previous:=v_current->>'cover_base_key';v_appearance:=v_current||jsonb_build_object('cover_base_key',p_object_key);
      elsif p_asset_type='qr_source' then
        v_previous:=v_current->>'qr_base_key';v_layout:=case when jsonb_typeof(v_current->'qr_layout')='object' then v_current->'qr_layout' else '{}'::jsonb end;
        v_appearance:=v_current||jsonb_build_object('qr_base_key',p_object_key,'qr_layout',v_layout||jsonb_build_object('template','custom'));
      else
        v_previous:=v_current->>'qr_background_key';v_appearance:=v_current||jsonb_build_object('qr_background_key',p_object_key);
      end if;
      update public.events set appearance=v_appearance where id=p_event_id and owner_id=v_owner;
      delete from public.jobs where id=p_reservation_id and owner_id=v_owner and status='queued';
      if coalesce(v_previous,'')<>'' and v_previous<>p_object_key then
        insert into public.jobs(id,owner_id,event_id,type,payload) values(gen_random_uuid(),v_owner,p_event_id,'object-cleanup',jsonb_build_object('keys',jsonb_build_array(v_previous)));
      end if;
      insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'event.design-asset.updated',p_event_id::text);
      return jsonb_build_object('ok',true);
    end
    $function$;

    revoke all on function public.reserve_own_design_asset(uuid,text) from public;
    revoke all on function public.attach_own_design_asset(uuid,text,text,uuid) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.reserve_own_design_asset(uuid,text) owner to lumiq_api_owner;
    alter function public.attach_own_design_asset(uuid,text,text,uuid) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.reserve_own_design_asset(uuid,text) to authenticated;
    grant execute on function public.attach_own_design_asset(uuid,text,text,uuid) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      revoke all on function public.reserve_own_design_asset(uuid,text) from anon;
      revoke all on function public.attach_own_design_asset(uuid,text,text,uuid) from anon;
    end if;
  end if;
end
$migration$;
