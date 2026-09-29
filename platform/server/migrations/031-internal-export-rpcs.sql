-- Keep export snapshotting and settlement behind the isolated job principal.
do $migration$
begin
  grant select(id,name,profile,email,preferences) on public.accounts to lumiq_job_owner;
  grant select(id,event_id,guest_id,object_key,bytes,captured_at,created_at,status,deleted_at) on public.media to lumiq_job_owner;
  grant select(id,name,owner_id,ends_at) on public.events to lumiq_job_owner;
  grant select(id,name) on public.guests to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='job_owner_accounts_read') then
    create policy job_owner_accounts_read on public.accounts for select to lumiq_job_owner using(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='job_owner_media_read') then
    create policy job_owner_media_read on public.media for select to lumiq_job_owner using(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='job_owner_events_read') then
    create policy job_owner_events_read on public.events for select to lumiq_job_owner using(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='guests' and policyname='job_owner_guests_read') then
    create policy job_owner_guests_read on public.guests for select to lumiq_job_owner using(true);
  end if;
  create or replace function public.prepare_platform_export(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;v_item record;v_ids uuid[];v_group uuid[];v_bytes bigint:=0;v_count integer:=0;v_parts integer:=0;v_existing integer;
  begin
    select * into v_job from public.jobs where id=p_job_id and type='export' and status='processing' for update;
    if not found then raise exception 'Export is not being processed' using errcode='55000'; end if;
    select count(*)::integer into v_existing from public.jobs where type='export-part' and payload->>'parent_id'=p_job_id::text;
    if v_existing>0 then return coalesce(v_job.result,'{}'::jsonb)||jsonb_build_object('parts',v_existing); end if;
    if jsonb_typeof(v_job.payload->'ids')<>'array' or jsonb_array_length(v_job.payload->'ids')<1 or jsonb_array_length(v_job.payload->'ids')>1000 then
      raise exception 'Invalid export snapshot' using errcode='22023';
    end if;
    select coalesce(array_agg(m.id order by m.created_at,m.id),'{}'::uuid[]) into v_ids
      from public.media m join public.events e on e.id=m.event_id
      where m.event_id=v_job.event_id and m.id=any(array(select jsonb_array_elements_text(v_job.payload->'ids')::uuid))
      and (m.status='uploaded' or (coalesce((v_job.payload->>'automatic')::boolean,false) and m.status='deleted' and m.deleted_at>e.ends_at));
    if cardinality(v_ids)<>jsonb_array_length(v_job.payload->'ids') then raise exception 'Export snapshot changed' using errcode='40001'; end if;
    v_group:='{}'::uuid[];
    for v_item in select m.id,m.bytes from public.media m where m.event_id=v_job.event_id and m.id=any(v_ids)
      and (m.status='uploaded' or (coalesce((v_job.payload->>'automatic')::boolean,false) and m.status='deleted' and m.deleted_at>(select ends_at from public.events where id=v_job.event_id)))
      order by m.created_at,m.id
    loop
      if v_item.bytes>67108864 then raise exception 'Export item exceeds part limit' using errcode='22023'; end if;
      if cardinality(v_group)>0 and v_bytes+v_item.bytes>67108864 then
        insert into public.jobs(id,owner_id,event_id,type,payload) values(gen_random_uuid(),v_job.owner_id,v_job.event_id,'export-part',jsonb_build_object('parent_id',p_job_id,'part_index',v_parts,'ids',to_jsonb(v_group),'automatic',coalesce((v_job.payload->>'automatic')::boolean,false)));
        v_parts:=v_parts+1;v_group:='{}'::uuid[];v_bytes:=0;
      end if;
      v_group:=array_append(v_group,v_item.id);v_bytes:=v_bytes+v_item.bytes;v_count:=v_count+1;
    end loop;
    if cardinality(v_group)>0 then
      insert into public.jobs(id,owner_id,event_id,type,payload) values(gen_random_uuid(),v_job.owner_id,v_job.event_id,'export-part',jsonb_build_object('parent_id',p_job_id,'part_index',v_parts,'ids',to_jsonb(v_group),'automatic',coalesce((v_job.payload->>'automatic')::boolean,false)));
      v_parts:=v_parts+1;
    end if;
    if v_parts=0 then raise exception 'No export items' using errcode='22023'; end if;
    update public.jobs set result=jsonb_build_object('count',v_count),updated_at=now() where id=p_job_id;
    return jsonb_build_object('count',v_count,'parts',v_parts);
  end
  $function$;

  create or replace function public.get_platform_export_part(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;v_items jsonb;
  begin
    select * into v_job from public.jobs where id=p_job_id and type='export-part' and status='processing';
    if not found or not exists(select 1 from public.jobs p where p.id=(v_job.payload->>'parent_id')::uuid and p.type='export' and p.status='processing') then
      raise exception 'Export part is not available' using errcode='55000';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'bytes',m.bytes,'object_key',m.object_key,'guest',g.name,'captured_at',m.captured_at,'created_at',m.created_at,'event_name',e.name,'organizer_name',a.name,'organizer_profile',a.profile) order by m.created_at,m.id),'[]'::jsonb)
      into v_items from public.media m join public.guests g on g.id=m.guest_id join public.events e on e.id=m.event_id join public.accounts a on a.id=e.owner_id
      where m.event_id=v_job.event_id and m.id=any(array(select jsonb_array_elements_text(v_job.payload->'ids')::uuid))
      and (m.status='uploaded' or (coalesce((v_job.payload->>'automatic')::boolean,false) and m.status='deleted' and m.deleted_at>e.ends_at));
    if jsonb_array_length(v_items)<>jsonb_array_length(v_job.payload->'ids') then raise exception 'Export snapshot changed' using errcode='40001'; end if;
    return v_items;
  end
  $function$;

  create or replace function public.complete_platform_export_part(p_job_id uuid,p_result jsonb)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_part public.jobs;v_parent public.jobs;v_total integer;v_ready integer;v_parts jsonb;v_result jsonb;
  begin
    if jsonb_typeof(p_result)<>'object' or length(coalesce(p_result->>'key',''))>1024 or (p_result->>'bytes')::bigint<0 or (p_result->>'bytes')::bigint>70000000 or (p_result->>'count')::integer<1 then
      raise exception 'Invalid export part result' using errcode='22023';
    end if;
    select * into v_part from public.jobs where id=p_job_id and type='export-part' and status='processing' for update;
    if not found or p_result->>'key'<>'exports/'||v_part.event_id::text||'/'||(v_part.payload->>'parent_id')||'/part-'||((v_part.payload->>'part_index')::integer+1)::text||'.zip'
      or (p_result->>'count')::integer<>jsonb_array_length(v_part.payload->'ids') then
      raise exception 'Export part result does not match the leased part' using errcode='22023';
    end if;
    update public.jobs set status='ready',result=p_result,error=null,lease_until=null,updated_at=now()
      where id=p_job_id and type='export-part' and status='processing' returning * into v_part;
    if not found then return null; end if;
    select * into v_parent from public.jobs where id=(v_part.payload->>'parent_id')::uuid and type='export' for update;
    if not found then raise exception 'Export parent not found' using errcode='23503'; end if;
    select count(*)::integer,count(*) filter(where status='ready')::integer into v_total,v_ready from public.jobs where type='export-part' and payload->>'parent_id'=v_parent.id::text;
    if v_total<>v_ready or v_parent.status<>'processing' then return null; end if;
    select jsonb_agg(result order by (payload->>'part_index')::integer) into v_parts from public.jobs where type='export-part' and payload->>'parent_id'=v_parent.id::text;
    select jsonb_build_object('parts',v_parts,'count',coalesce(sum((result->>'count')::integer),0),'expires_at',case when coalesce((v_parent.payload->>'automatic')::boolean,false) then v_parent.payload->>'retention_at' else (now()+interval '7 days')::text end)
      into v_result from public.jobs where type='export-part' and payload->>'parent_id'=v_parent.id::text;
    update public.jobs set status='ready',result=v_result,lease_until=null,error=null,updated_at=now() where id=v_parent.id and status='processing';
    return jsonb_build_object('id',v_parent.id,'owner_id',v_parent.owner_id,'result',v_result);
  end
  $function$;

  create or replace function public.get_platform_export_notice(p_job_id uuid)
  returns jsonb language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select jsonb_build_object('id',a.id,'email',a.email,'name',a.name,'preferences',a.preferences)
    from public.accounts a join public.jobs j on j.owner_id=a.id
    where j.id=p_job_id and j.type='export' and j.status='ready'
  $function$;

  revoke all on function public.prepare_platform_export(uuid) from public;
  revoke all on function public.get_platform_export_part(uuid) from public;
  revoke all on function public.complete_platform_export_part(uuid,jsonb) from public;
  revoke all on function public.get_platform_export_notice(uuid) from public;
  alter function public.prepare_platform_export(uuid) owner to lumiq_job_owner;
  alter function public.get_platform_export_part(uuid) owner to lumiq_job_owner;
  alter function public.complete_platform_export_part(uuid,jsonb) owner to lumiq_job_owner;
  alter function public.get_platform_export_notice(uuid) owner to lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.prepare_platform_export(uuid) to lumiq_restore_runtime;
    grant execute on function public.get_platform_export_part(uuid) to lumiq_restore_runtime;
    grant execute on function public.complete_platform_export_part(uuid,jsonb) to lumiq_restore_runtime;
    grant execute on function public.get_platform_export_notice(uuid) to lumiq_restore_runtime;
  end if;
end
$migration$;
