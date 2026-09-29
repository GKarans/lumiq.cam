-- Keep organizer export metadata, downloads, and retries owner-scoped.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,owner_id,event_id,type,status,payload,result,error,attempts,created_at,updated_at,available_at,lease_until,dispatched_at)
      on public.jobs to lumiq_api_owner;
    grant update(status,error,attempts,available_at,lease_until,dispatched_at) on public.jobs to lumiq_api_owner;
    grant select(id,owner_id,name,retention_at) on public.events to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_jobs_select') then
      create policy api_owner_jobs_select on public.jobs for select to lumiq_api_owner using(owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_jobs_update') then
      create policy api_owner_jobs_update on public.jobs for update to lumiq_api_owner
        using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
    end if;

    create or replace function public.list_own_event_exports(p_event_id uuid)
    returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth
    as $function$
    declare v_owner uuid:=auth.uid();v_result jsonb;
    begin
      if v_owner is null or p_event_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if not exists(select 1 from public.events where id=p_event_id and owner_id=v_owner and retention_at>now()) then
        raise exception 'Event not found' using errcode='42501';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',j.id,'event_id',j.event_id,'type',j.type,'status',j.status,
        'payload',jsonb_build_object('automatic',coalesce((j.payload->>'automatic')::boolean,false),'ids',coalesce(j.payload->'ids','[]'::jsonb)),
        'result',jsonb_build_object('expires_at',j.result->'expires_at','parts',coalesce((
          select jsonb_agg(jsonb_build_object('bytes',p.value->'bytes') order by p.ordinality)
          from jsonb_array_elements(case when jsonb_typeof(j.result->'parts')='array' then j.result->'parts' else '[]'::jsonb end) with ordinality p(value,ordinality)
        ),'[]'::jsonb)),
        'error',j.error,'attempts',j.attempts,'created_at',j.created_at,'updated_at',j.updated_at
      ) order by j.created_at desc),'[]'::jsonb) into v_result
      from public.jobs j where j.event_id=p_event_id and j.owner_id=v_owner and j.type='export';
      return v_result;
    end
    $function$;

    create or replace function public.get_own_export_job(p_job_id uuid)
    returns jsonb language sql stable security definer set search_path=pg_catalog,public,auth
    as $function$
      select x.value from public.jobs j
      cross join lateral jsonb_array_elements(public.list_own_event_exports(j.event_id)) x(value)
      where j.id=p_job_id and j.owner_id=auth.uid() and j.type='export' and x.value->>'id'=j.id::text
    $function$;

    create or replace function public.get_own_export_part(p_job_id uuid,p_part_index integer)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
    as $function$
    declare v_job record;v_part jsonb;
    begin
      if auth.uid() is null or p_job_id is null or p_part_index is null or p_part_index<0 then
        raise exception 'Archive is unavailable' using errcode='42501';
      end if;
      select j.id,j.result,e.name as event_name,e.retention_at into v_job
        from public.jobs j join public.events e on e.id=j.event_id
        where j.id=p_job_id and j.owner_id=auth.uid() and e.owner_id=auth.uid() and j.type='export'
          and j.status='ready' and (j.result->>'expires_at')::timestamptz>now() and e.retention_at>now();
      if not found then raise exception 'Archive is unavailable' using errcode='42501'; end if;
      v_part:=v_job.result->'parts'->p_part_index;
      if v_part is null or v_part->>'key' is null then raise exception 'Archive part is unavailable' using errcode='P0002'; end if;
      return jsonb_build_object('key',v_part->>'key','bytes',v_part->'bytes','event_name',v_job.event_name,'retention_at',v_job.retention_at);
    end
    $function$;

    create or replace function public.retry_own_export(p_job_id uuid)
    returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
    as $function$
    declare v_owner uuid:=auth.uid();v_job record;v_has_children boolean;
    begin
      if v_owner is null or p_job_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
      select id,event_id,payload into v_job from public.jobs
        where id=p_job_id and owner_id=v_owner and type='export' and status='failed' for update;
      if not found then return jsonb_build_object('ok',false); end if;
      select exists(select 1 from public.jobs where owner_id=v_owner and type='export-part' and payload->>'parent_id'=p_job_id::text) into v_has_children;
      if v_has_children then
        update public.jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null
          where owner_id=v_owner and type='export-part' and payload->>'parent_id'=p_job_id::text and status='failed';
        update public.jobs set status='processing',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=p_job_id;
      else
        update public.jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=p_job_id;
      end if;
      return jsonb_build_object('ok',true);
    end
    $function$;

    revoke all on function public.list_own_event_exports(uuid) from public;
    revoke all on function public.get_own_export_job(uuid) from public;
    revoke all on function public.get_own_export_part(uuid,integer) from public;
    revoke all on function public.retry_own_export(uuid) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.list_own_event_exports(uuid) owner to lumiq_api_owner;
    alter function public.get_own_export_job(uuid) owner to lumiq_api_owner;
    alter function public.get_own_export_part(uuid,integer) owner to lumiq_api_owner;
    alter function public.retry_own_export(uuid) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.list_own_event_exports(uuid) to authenticated;
    grant execute on function public.get_own_export_job(uuid) to authenticated;
    grant execute on function public.get_own_export_part(uuid,integer) to authenticated;
    grant execute on function public.retry_own_export(uuid) to authenticated;
  end if;
end
$migration$;
