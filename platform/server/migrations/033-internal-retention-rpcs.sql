-- Make periodic retention and expiry work available only through job-owner RPCs.
do $migration$
begin
  grant select(id,owner_id,ends_at,retention_at,status,name) on public.events to lumiq_job_owner;
  grant update(status,paused,share_enabled,gallery_cover_id) on public.events to lumiq_job_owner;
  grant select(id,event_id,bytes,status,deleted_at,created_at) on public.media to lumiq_job_owner;
  grant update(status,deleted_at) on public.media to lumiq_job_owner;
  grant select(account_id,plan,status,period_end,cancel_at_end) on public.subscriptions to lumiq_job_owner;
  grant update(status) on public.subscriptions to lumiq_job_owner;
  grant select(id,email,name,preferences,deleted_at) on public.accounts to lumiq_job_owner;
  grant select(expires_at),delete on public.sessions,public.request_limits to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='job_owner_subscriptions_maintenance') then
    create policy job_owner_subscriptions_maintenance on public.subscriptions for all to lumiq_job_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='sessions' and policyname='job_owner_sessions_maintenance') then
    create policy job_owner_sessions_maintenance on public.sessions for delete to lumiq_job_owner using(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='request_limits' and policyname='job_owner_request_limits_maintenance') then
    create policy job_owner_request_limits_maintenance on public.request_limits for delete to lumiq_job_owner using(true);
  end if;

  create or replace function public.prepare_platform_event_end(p_event_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_event record;v_ids uuid[];v_existing uuid;v_job_id uuid;
  begin
    select id,owner_id,ends_at,retention_at into v_event from public.events
      where id=p_event_id and status='published' and ends_at<=now() and retention_at>now() for update;
    if not found then return jsonb_build_object('prepared',false,'job_id',null); end if;
    select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_ids from public.media
      where event_id=p_event_id and (status='uploaded' or (status='deleted' and deleted_at>v_event.ends_at));
    if cardinality(v_ids)=0 then return jsonb_build_object('prepared',false,'job_id',null); end if;
    select id into v_existing from public.jobs where event_id=p_event_id and type='export' and payload->>'automatic'='true'
      order by created_at desc for update limit 1;
    if found then return jsonb_build_object('prepared',true,'job_id',v_existing,'existing',true); end if;
    v_job_id:=gen_random_uuid();
    insert into public.jobs(id,owner_id,event_id,type,payload) values(v_job_id,v_event.owner_id,p_event_id,'export',
      jsonb_build_object('ids',to_jsonb(v_ids),'automatic',true,'retention_at',v_event.retention_at));
    return jsonb_build_object('prepared',true,'job_id',v_job_id,'existing',false);
  end
  $function$;

  create or replace function public.expire_platform_event(p_event_id uuid)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_event record;v_existing uuid;v_job_id uuid;
  begin
    select id,owner_id into v_event from public.events where id=p_event_id and retention_at<=now() and status<>'deleted' for update;
    if not found then return jsonb_build_object('expired',false,'job_id',null); end if;
    select id into v_existing from public.jobs where event_id=p_event_id and type in ('cleanup','retention-cleanup')
      and status in ('queued','processing','ready') order by created_at desc limit 1;
    if found then return jsonb_build_object('expired',true,'job_id',v_existing,'existing',true); end if;
    update public.events set status='archived',paused=true,share_enabled=false,gallery_cover_id=null where id=p_event_id;
    v_job_id:=gen_random_uuid();
    insert into public.jobs(id,owner_id,event_id,type) values(v_job_id,v_event.owner_id,p_event_id,'retention-cleanup');
    return jsonb_build_object('expired',true,'job_id',v_job_id,'existing',false);
  end
  $function$;

  create or replace function public.run_platform_retention_cycle(p_limit integer default 250)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_event record;v_media record;v_export record;v_ids uuid[];v_keys jsonb;v_count integer;v_end_jobs integer:=0;v_pending integer:=0;v_zip_jobs integer:=0;v_expired integer:=0;v_subscriptions integer:=0;v_sessions integer:=0;v_limits integer:=0;
  begin
    if p_limit is null or p_limit<1 or p_limit>250 then raise exception 'Invalid retention batch size' using errcode='22023'; end if;
    for v_event in select id from public.events where status='published' and ends_at<=now() and retention_at>now()
      and (exists(select 1 from public.media m where m.event_id=events.id and (m.status='uploaded' or (m.status='deleted' and m.deleted_at>events.ends_at)))
        or exists(select 1 from public.jobs j where j.event_id=events.id and j.type='export' and j.payload->>'automatic'='true'))
      order by ends_at for update skip locked limit p_limit
    loop
      perform public.prepare_platform_event_end(v_event.id);
      v_end_jobs:=v_end_jobs+1;
    end loop;
    for v_media in select id,event_id from public.media where status='pending' and created_at<now()-interval '24 hours'
      order by created_at for update skip locked limit p_limit
    loop
      update public.media set status='deleted',deleted_at=now() where id=v_media.id and status='pending';
      insert into public.jobs(id,owner_id,event_id,type,payload)
        select gen_random_uuid(),e.owner_id,v_media.event_id,'media-cleanup',jsonb_build_object('ids',jsonb_build_array(v_media.id)) from public.events e where e.id=v_media.event_id;
      v_pending:=v_pending+1;
    end loop;
    for v_export in select j.id,j.owner_id,j.event_id,j.result from public.jobs j where j.type='export' and j.status='ready'
      and j.result->>'expires_at' is not null and (j.result->>'expires_at')::timestamptz<=now() and not(j.result?'cleaned')
      order by j.updated_at for update skip locked limit p_limit
    loop
      select coalesce(jsonb_agg(value->>'key') filter(where value->>'key' is not null),'[]'::jsonb) into v_keys
        from jsonb_array_elements(coalesce(v_export.result->'parts','[]'::jsonb)) as parts(value);
      if v_export.result->>'key' is not null then v_keys:=v_keys||jsonb_build_array(v_export.result->>'key'); end if;
      insert into public.jobs(id,owner_id,event_id,type,payload) values(gen_random_uuid(),v_export.owner_id,v_export.event_id,'object-cleanup',jsonb_build_object('keys',v_keys));
      update public.jobs set result=result||'{"cleaned":true}'::jsonb where id=v_export.id;
      v_zip_jobs:=v_zip_jobs+1;
    end loop;
    update public.subscriptions set status='ended' where period_end<=now() and (cancel_at_end=true or plan='trial') and status<>'ended';
    get diagnostics v_subscriptions=row_count;
    for v_event in select e.id from public.events e where e.retention_at<=now() and e.status<>'deleted'
      and not exists(select 1 from public.jobs j where j.event_id=e.id and j.type in ('cleanup','retention-cleanup') and j.status in ('queued','processing','ready'))
      order by e.retention_at for update skip locked limit p_limit
    loop
      if (public.expire_platform_event(v_event.id)->>'expired')::boolean then v_expired:=v_expired+1; end if;
    end loop;
    delete from public.sessions where expires_at<now();get diagnostics v_sessions=row_count;
    delete from public.request_limits where expires_at<now();get diagnostics v_limits=row_count;
    return jsonb_build_object('event_exports',v_end_jobs,'pending_uploads',v_pending,'expired_exports',v_zip_jobs,
      'expired_events',v_expired,'subscriptions_ended',v_subscriptions,'sessions_removed',v_sessions,'limits_removed',v_limits);
  end
  $function$;

  create or replace function public.list_platform_retention_reminders(p_limit integer default 250)
  returns jsonb language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select coalesce(jsonb_agg(jsonb_build_object('event_id',e.id,'owner_id',e.owner_id,'event_name',e.name,'retention_at',e.retention_at,
      'email',a.email,'preferences',a.preferences) order by e.retention_at),'[]'::jsonb)
    from (select id,owner_id,name,retention_at from public.events where retention_at between now() and now()+interval '7 days' and status<>'deleted'
      order by retention_at limit greatest(1,least(coalesce(p_limit,250),250))) e
    join public.accounts a on a.id=e.owner_id where a.deleted_at is null
  $function$;

  revoke all on function public.prepare_platform_event_end(uuid) from public;
  revoke all on function public.expire_platform_event(uuid) from public;
  revoke all on function public.run_platform_retention_cycle(integer) from public;
  revoke all on function public.list_platform_retention_reminders(integer) from public;
  alter function public.prepare_platform_event_end(uuid) owner to lumiq_job_owner;
  alter function public.expire_platform_event(uuid) owner to lumiq_job_owner;
  alter function public.run_platform_retention_cycle(integer) owner to lumiq_job_owner;
  alter function public.list_platform_retention_reminders(integer) owner to lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.prepare_platform_event_end(uuid) to lumiq_restore_runtime;
    grant execute on function public.expire_platform_event(uuid) to lumiq_restore_runtime;
    grant execute on function public.run_platform_retention_cycle(integer) to lumiq_restore_runtime;
    grant execute on function public.list_platform_retention_reminders(integer) to lumiq_restore_runtime;
  end if;
end
$migration$;
