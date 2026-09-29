-- Keep organizer lifecycle transitions and allowance consumption atomic under the verified JWT.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,verified,deleted_at) on public.accounts to lumiq_api_owner;
    grant select(id,owner_id,name,starts_at,ends_at,status,paused,entitlement,retention_at,share_enabled,share_expires,share_used,share_limit),
      update(status,paused,entitlement,retention_at,share_enabled,share_expires) on public.events to lumiq_api_owner;
    grant select(event_id,owner_id,source,pass_id,entitlement,period_start,period_end,consumed_at,schedule_deadline),
      insert(event_id,owner_id,source,pass_id,entitlement,period_start,period_end) on public.event_publications to lumiq_api_owner;
    grant select(account_id,plan,status,period_start,period_end),update(plan) on public.subscriptions to lumiq_api_owner;
    grant select(id,owner_id,entitlement,redeemed_event_id,revoked_at,created_at),update(redeemed_event_id) on public.event_passes to lumiq_api_owner;
    grant select(event_id,status,bytes,thumbnail_bytes) on public.media to lumiq_api_owner;
    grant insert(id,owner_id,event_id,type,payload) on public.jobs to lumiq_api_owner;
    grant insert(id,actor_id,action,target_id) on public.audit to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_passes' and policyname='api_owner_passes_select') then
      create policy api_owner_passes_select on public.event_passes for select to lumiq_api_owner using(owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_passes' and policyname='api_owner_passes_update') then
      create policy api_owner_passes_update on public.event_passes for update to lumiq_api_owner
        using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='api_owner_subscription_update') then
      create policy api_owner_subscription_update on public.subscriptions for update to lumiq_api_owner
        using(account_id=(select auth.uid())) with check(account_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_publications' and policyname='api_owner_publications_insert') then
      create policy api_owner_publications_insert on public.event_publications for insert to lumiq_api_owner
        with check(owner_id=(select auth.uid()) and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_event_cleanup_insert') then
      create policy api_owner_event_cleanup_insert on public.jobs for insert to lumiq_api_owner
        with check(owner_id=(select auth.uid()) and type in ('cleanup','object-cleanup')
          and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
    end if;

    create or replace function public.act_on_own_event(p_event_id uuid,p_action text,p_funding text default 'plan',p_confirm text default null,p_enabled boolean default null,p_days integer default null)
    returns jsonb language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_event record;
      v_account record;
      v_sub record;
      v_pass record;
      v_publication record;
      v_entitlement jsonb;
      v_source text;
      v_days integer;
      v_used integer;
      v_bytes bigint;
      v_max_days integer;
      v_pass_id uuid;
      v_period_start timestamptz;
      v_period_end timestamptz;
      v_action text:=coalesce(p_action,'');
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_event_id is null or v_action not in ('publish','pause','resume','archive','restore','delete','share') then
        raise exception 'Invalid event action' using errcode='22023';
      end if;
      select id,verified,deleted_at into v_account from public.accounts where id=v_owner for update;
      if not found or not v_account.verified or v_account.deleted_at is not null then raise exception 'Account unavailable' using errcode='42501'; end if;
      select id,owner_id,name,starts_at,ends_at,status,paused,entitlement,retention_at,share_enabled,share_expires,share_used,share_limit
        into v_event from public.events where id=p_event_id and owner_id=v_owner for update;
      if not found then raise exception 'Event not found' using errcode='P0002'; end if;

      if v_action='publish' then
        if v_event.status<>'draft' or v_event.ends_at<=now() then raise exception 'Only a future or live draft can be published' using errcode='23514'; end if;
        select event_id,entitlement into v_publication from public.event_publications where event_id=p_event_id and owner_id=v_owner;
        if found then
          v_entitlement:=v_publication.entitlement;
        else
          if coalesce(p_funding,'plan') not in ('plan','pass') then raise exception 'Invalid event allowance' using errcode='22023'; end if;
          if coalesce(p_funding,'plan')='pass' then
            select id,entitlement into v_pass from public.event_passes
              where owner_id=v_owner and redeemed_event_id is null and revoked_at is null order by created_at,id for update limit 1;
            if not found then raise exception 'No Single Event pass is available' using errcode='23514'; end if;
            v_entitlement:=v_pass.entitlement;v_source:='pass';v_pass_id:=v_pass.id;
          else
            select account_id,plan,status,period_start,period_end into v_sub from public.subscriptions where account_id=v_owner for update;
            if not found then raise exception 'Subscription unavailable' using errcode='23514'; end if;
            if v_sub.plan not in ('trial','gathering','studio') then raise exception 'Choose an active plan or use a Single Event pass' using errcode='23514'; end if;
            if v_sub.status not in ('active','trialing') or v_sub.period_start>now() or v_sub.period_end<=now() then raise exception 'Choose an active plan or use a Single Event pass' using errcode='23514'; end if;
            v_period_start:=v_sub.period_start;v_period_end:=v_sub.period_end;
            if v_sub.plan='trial' then
              select count(*)::integer into v_used from public.event_publications where owner_id=v_owner and source='trial';
              if v_used>=1 then raise exception 'Your trial event has been used. Choose a plan or a Single Event pass.' using errcode='23514'; end if;
              v_entitlement:='{"id":"trial","name":"Explore","price":0,"billing":"trial","events":1,"photos":50,"bytes":104857600,"retentionDays":7,"shareDays":4,"durationDays":1,"description":"A small gathering, a proper test."}'::jsonb;
              v_source:='trial';
            else
              select count(*)::integer into v_used from public.event_publications where owner_id=v_owner and source='subscription'
                and consumed_at>=v_sub.period_start and consumed_at<v_sub.period_end;
              if v_used>=(case when v_sub.plan='gathering' then 4 else 12 end) then raise exception 'Your publication allowance for this billing period is used. Buy a Single Event pass or wait for renewal.' using errcode='23514'; end if;
              if v_sub.plan='gathering' then
                v_entitlement:='{"id":"gathering","name":"Gathering","price":3000,"billing":"monthly","events":4,"photos":500,"bytes":1048576000,"retentionDays":14,"shareDays":7,"durationDays":3,"description":"Four gatherings in every paid billing period."}'::jsonb;
              else
                v_entitlement:='{"id":"studio","name":"Studio","price":7000,"billing":"monthly","events":12,"photos":1000,"bytes":2097152000,"retentionDays":30,"shareDays":14,"durationDays":3,"description":"For people who bring people together."}'::jsonb;
              end if;
              v_source:='subscription';
            end if;
          end if;
          if v_event.ends_at>now()+interval '366 days' then raise exception 'Schedule the event to end within the next year' using errcode='22023'; end if;
          if v_event.ends_at-v_event.starts_at>make_interval(days=>coalesce(nullif(v_entitlement->>'durationDays','')::integer,3)) then
            raise exception 'Event exceeds its plan duration' using errcode='23514';
          end if;
          select count(*)::integer,coalesce(sum(bytes+thumbnail_bytes),0)::bigint into v_used,v_bytes from public.media
            where event_id=p_event_id and status in ('pending','uploaded');
          if v_used>coalesce((v_entitlement->>'photos')::integer,0) or v_bytes>coalesce((v_entitlement->>'bytes')::bigint,0) then
            raise exception 'This draft exceeds the selected allowance' using errcode='23514';
          end if;
          insert into public.event_publications(event_id,owner_id,source,pass_id,entitlement,period_start,period_end)
            values(p_event_id,v_owner,v_source,v_pass_id,v_entitlement,v_period_start,v_period_end);
          if v_source='pass' then update public.event_passes set redeemed_event_id=p_event_id where id=v_pass_id; end if;
        end if;
        update public.events set status='published',paused=false,entitlement=v_entitlement,
          retention_at=ends_at+make_interval(days=>coalesce(nullif(v_entitlement->>'retentionDays','')::integer,30)) where id=p_event_id;
      elsif v_action in ('pause','resume') then
        if v_event.status<>'published' or v_event.retention_at<=now() or v_event.ends_at<=now() then raise exception 'Uploads cannot be changed after the event' using errcode='23514'; end if;
        update public.events set paused=(v_action='pause') where id=p_event_id;
      elsif v_action='archive' then
        update public.events set status='archived',share_enabled=false where id=p_event_id;
      elsif v_action='restore' then
        if v_event.status<>'archived' or v_event.retention_at<=now() then raise exception 'This event can no longer be restored' using errcode='23514'; end if;
        update public.events set status=case when ends_at<=now() and exists(select 1 from public.event_publications where event_id=p_event_id) then 'published' else 'draft' end,paused=true where id=p_event_id;
      elsif v_action='delete' then
        if p_confirm is distinct from v_event.name then raise exception 'Type the event name to confirm permanent deletion' using errcode='22023'; end if;
        update public.events set status='deleted',share_enabled=false where id=p_event_id;
        insert into public.jobs(id,owner_id,event_id,type) values(gen_random_uuid(),v_owner,p_event_id,'cleanup');
      elsif v_action='share' then
        if v_event.status<>'published' or v_event.ends_at>now() or v_event.retention_at<=now() then raise exception 'Sharing becomes available when the event ends' using errcode='23514'; end if;
        v_days:=p_days;
        v_max_days:=least(coalesce(nullif(v_event.entitlement->>'shareDays','')::integer,0),floor(extract(epoch from (v_event.retention_at-now()))/86400)::integer);
        if v_days is null or v_days<1 or v_days>v_max_days then raise exception 'Sharing duration exceeds the remaining photo-retention period' using errcode='22023'; end if;
        update public.events set share_enabled=coalesce(p_enabled,false),share_expires=now()+make_interval(days=>v_days) where id=p_event_id;
      end if;
      insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'event.'||v_action,p_event_id::text);
      return jsonb_build_object('ok',true);
    end
    $function$;

    revoke all on function public.act_on_own_event(uuid,text,text,text,boolean,integer) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.act_on_own_event(uuid,text,text,text,boolean,integer) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.act_on_own_event(uuid,text,text,text,boolean,integer) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      revoke all on function public.act_on_own_event(uuid,text,text,text,boolean,integer) from anon;
    end if;
  end if;
end
$migration$;
