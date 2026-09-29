-- Isolate queue dispatch and job claiming behind a non-login, non-bypass owner.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_job_owner') then
    create role lumiq_job_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_job_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_job_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_job_owner;
  grant select,insert,update,delete on public.jobs to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='job_owner_jobs_all') then
    create policy job_owner_jobs_all on public.jobs for all to lumiq_job_owner using(true) with check(true);
  end if;
  grant create on schema public to lumiq_job_owner;

  create or replace function public.claim_platform_job(p_job_ids uuid[] default null)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job public.jobs;
  begin
    if p_job_ids is not null and cardinality(p_job_ids)>100 then raise exception 'Too many target jobs' using errcode='22023'; end if;
    select * into v_job from public.jobs where status='queued' and available_at<=now()
      and (p_job_ids is null or id=any(p_job_ids))
      order by created_at,case when type='export-part' then (payload->>'part_index')::integer else -1 end,id
      for update skip locked limit 1;
    if not found then return null; end if;
    update public.jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '10 minutes'
      where id=v_job.id returning * into v_job;
    return to_jsonb(v_job);
  end
  $function$;

  create or replace function public.claim_platform_queue_batch(p_limit integer)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_ids jsonb;
  begin
    if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid queue batch size' using errcode='22023'; end if;
    with candidates as (
      select id from public.jobs where status='queued' and available_at<=now()
        and (dispatched_at is null or dispatched_at<now()-interval '5 minutes')
      order by created_at,id for update skip locked limit p_limit
    ), updated as (
      update public.jobs j set dispatched_at=now() from candidates c where j.id=c.id and j.status='queued' returning j.id
    ) select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_ids from updated;
    return v_ids;
  end
  $function$;

  create or replace function public.reset_platform_queue_dispatch(p_job_ids uuid[])
  returns integer language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    if p_job_ids is null or cardinality(p_job_ids)>100 then raise exception 'Invalid queue job list' using errcode='22023'; end if;
    update public.jobs set dispatched_at=null where id=any(p_job_ids) and status='queued';
    get diagnostics v_count=row_count;
    return v_count;
  end
  $function$;

  create or replace function public.recover_stale_platform_jobs()
  returns integer language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    update public.jobs set status='queued',dispatched_at=null,lease_until=null,updated_at=now()
      where status='processing' and lease_until<now();
    get diagnostics v_count=row_count;
    return v_count;
  end
  $function$;

  create or replace function public.renew_platform_job(p_job_id uuid)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    update public.jobs set lease_until=now()+interval '10 minutes',updated_at=now()
      where id=p_job_id and status='processing';
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  create or replace function public.settle_platform_job(
    p_job_id uuid,p_outcome text,p_result jsonb default null,p_error text default null,
    p_delay_seconds integer default 0,p_decrement_attempt boolean default false
  ) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job record;v_status text;
  begin
    if p_job_id is null or p_outcome is null or p_outcome not in ('ready','retry','failed','defer') or p_delay_seconds is null
      or p_delay_seconds<0 or p_delay_seconds>3600 or length(coalesce(p_error,''))>500
      or (p_decrement_attempt and p_outcome<>'defer') then
      raise exception 'Invalid job settlement' using errcode='22023';
    end if;
    v_status:=case when p_outcome in ('retry','defer') then 'queued' else p_outcome end;
    update public.jobs set status=v_status,result=case when p_result is null then result else p_result end,
      error=case when p_outcome in ('retry','failed') then p_error else null end,
      available_at=now()+make_interval(secs=>p_delay_seconds),
      attempts=case when p_decrement_attempt then greatest(attempts-1,0) else attempts end,
      lease_until=null,dispatched_at=null,updated_at=now()
      where id=p_job_id and status='processing' returning id,type,payload into v_job;
    if not found then return jsonb_build_object('updated',false); end if;
    if p_outcome='failed' and v_job.type='export-part' then
      update public.jobs set status='failed',error='One export part failed after retries. Retry this export to continue.',lease_until=null,updated_at=now()
        where id=(v_job.payload->>'parent_id')::uuid and type='export' and status='processing';
    end if;
    return jsonb_build_object('updated',true,'type',v_job.type,'payload',v_job.payload);
  end
  $function$;

  create or replace function public.dead_letter_platform_job(p_job_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_job record;
  begin
    update public.jobs set status='failed',error='The background queue could not deliver this job. Retry it or contact support.',
      lease_until=null,dispatched_at=null,updated_at=now()
      where id=p_job_id and (status='queued' or (status='processing' and lease_until<now()))
      returning id,type,payload into v_job;
    if not found then return null; end if;
    if v_job.type='export-part' then
      update public.jobs set status='failed',error='An archive part could not be delivered. Retry this archive to continue.',lease_until=null,updated_at=now()
        where id=(v_job.payload->>'parent_id')::uuid and type='export' and status='processing';
    end if;
    return jsonb_build_object('id',v_job.id,'type',v_job.type);
  end
  $function$;

  revoke all on function public.claim_platform_job(uuid[]) from public;
  revoke all on function public.claim_platform_queue_batch(integer) from public;
  revoke all on function public.reset_platform_queue_dispatch(uuid[]) from public;
  revoke all on function public.recover_stale_platform_jobs() from public;
  revoke all on function public.renew_platform_job(uuid) from public;
  revoke all on function public.settle_platform_job(uuid,text,jsonb,text,integer,boolean) from public;
  revoke all on function public.dead_letter_platform_job(uuid) from public;
  alter function public.claim_platform_job(uuid[]) owner to lumiq_job_owner;
  alter function public.claim_platform_queue_batch(integer) owner to lumiq_job_owner;
  alter function public.reset_platform_queue_dispatch(uuid[]) owner to lumiq_job_owner;
  alter function public.recover_stale_platform_jobs() owner to lumiq_job_owner;
  alter function public.renew_platform_job(uuid) owner to lumiq_job_owner;
  alter function public.settle_platform_job(uuid,text,jsonb,text,integer,boolean) owner to lumiq_job_owner;
  alter function public.dead_letter_platform_job(uuid) owner to lumiq_job_owner;
  revoke create on schema public from lumiq_job_owner;

  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.claim_platform_job(uuid[]) to lumiq_restore_runtime;
    grant execute on function public.claim_platform_queue_batch(integer) to lumiq_restore_runtime;
    grant execute on function public.reset_platform_queue_dispatch(uuid[]) to lumiq_restore_runtime;
    grant execute on function public.recover_stale_platform_jobs() to lumiq_restore_runtime;
    grant execute on function public.renew_platform_job(uuid) to lumiq_restore_runtime;
    grant execute on function public.settle_platform_job(uuid,text,jsonb,text,integer,boolean) to lumiq_restore_runtime;
    grant execute on function public.dead_letter_platform_job(uuid) to lumiq_restore_runtime;
  end if;
end
$migration$;
