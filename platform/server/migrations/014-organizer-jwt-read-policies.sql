-- Initial JWT/RLS slice. Direct organizer writes remain server-owned until
-- their transactional flows have dedicated RPCs.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='authenticated') and to_regnamespace('auth') is not null then
  if not exists(select 1 from pg_roles where rolname='lumiq_api_owner') then
    create role lumiq_api_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  elsif exists(select 1 from pg_roles where rolname='lumiq_api_owner' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then
    raise exception 'lumiq_api_owner must remain a non-login, non-inheriting, non-bypass role';
  end if;
  grant usage on schema public to lumiq_api_owner;
  grant usage on schema auth to lumiq_api_owner;
  grant execute on function auth.uid() to lumiq_api_owner;
  grant select(id,email,email_confirmed_at) on auth.users to lumiq_api_owner;
  grant select(id,email,name,role,verified,preferences,profile,design_defaults,deleted_at) on public.accounts to lumiq_api_owner;
  grant insert(id,email,name,verified,preferences,profile) on public.accounts to lumiq_api_owner;
  grant update(email,name,verified,preferences,profile) on public.accounts to lumiq_api_owner;
  grant select(account_id) on public.subscriptions to lumiq_api_owner;
  grant insert on public.subscriptions to lumiq_api_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='api_owner_account_select') then
    create policy api_owner_account_select on public.accounts
      for select to lumiq_api_owner using (id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='api_owner_account_insert') then
    create policy api_owner_account_insert on public.accounts
      for insert to lumiq_api_owner with check (id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='api_owner_account_update') then
    create policy api_owner_account_update on public.accounts
      for update to lumiq_api_owner using (id=(select auth.uid()) and deleted_at is null)
      with check (id=(select auth.uid()) and deleted_at is null);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='api_owner_subscription_insert') then
    create policy api_owner_subscription_insert on public.subscriptions
      for insert to lumiq_api_owner with check (account_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='api_owner_subscription_select') then
    create policy api_owner_subscription_select on public.subscriptions
      for select to lumiq_api_owner using (account_id=(select auth.uid()));
  end if;
  end if;

  if exists(select 1 from pg_roles where rolname='authenticated') then

  grant select (id,email,name,verified,preferences,profile,design_defaults)
    on public.accounts to authenticated;
  grant select (id,owner_id,slug,name,description,starts_at,ends_at,time_zone,status,paused,appearance,entitlement,retention_at,share_enabled,share_expires,share_used,share_limit,gallery_cover_id,created_at)
    on public.events to authenticated;
  grant select (id,event_id,status,bytes,thumbnail_bytes) on public.media to authenticated;
  grant select (event_id,owner_id,source,consumed_at) on public.event_publications to authenticated;
  grant select (owner_id,redeemed_event_id,revoked_at) on public.event_passes to authenticated;
  grant select (account_id,plan,status,period_start,period_end,cancel_at_end,updated_at)
    on public.subscriptions to authenticated;
  grant select (id,owner_id,plan,amount,status,created_at)
    on public.orders to authenticated;
  grant select (id,owner_id,event_id,type,status,created_at,updated_at)
    on public.jobs to authenticated;
  grant select (id,owner_id,email,subject,message,status,reply,created_at)
    on public.support_cases to authenticated;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='organizer_account_select') then
    create policy organizer_account_select on public.accounts
      for select to authenticated using (id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='organizer_events_select') then
    create policy organizer_events_select on public.events
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='organizer_media_select') then
    create policy organizer_media_select on public.media
      for select to authenticated using (exists(select 1 from public.events as e where e.id=media.event_id and e.owner_id=(select auth.uid())));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_publications' and policyname='organizer_publications_select') then
    create policy organizer_publications_select on public.event_publications
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_passes' and policyname='organizer_passes_select') then
    create policy organizer_passes_select on public.event_passes
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='organizer_subscription_select') then
    create policy organizer_subscription_select on public.subscriptions
      for select to authenticated using (account_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='organizer_orders_select') then
    create policy organizer_orders_select on public.orders
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='organizer_jobs_select') then
    create policy organizer_jobs_select on public.jobs
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_cases' and policyname='organizer_support_select') then
    create policy organizer_support_select on public.support_cases
      for select to authenticated using (owner_id=(select auth.uid()));
  end if;
  grant create on schema public to lumiq_api_owner;
  create or replace function public.sync_own_account(p_name text,p_profile jsonb,p_locale text,p_marketing boolean)
  returns table(account_id uuid,email text,name text,role text,preferences jsonb,profile jsonb,design_defaults jsonb)
  language plpgsql security definer
  set search_path=pg_catalog,public,auth
  as $function$
  declare
    v_account_id uuid:=auth.uid();
    v_email text;
    v_confirmed_at timestamptz;
    v_name text:=btrim(coalesce(p_name,''));
    v_profile jsonb:=coalesce(p_profile,'{}'::jsonb);
    v_preferences jsonb;
  begin
    if v_account_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if length(v_name)<2 or length(v_name)>80 then raise exception 'Invalid account name' using errcode='22023'; end if;
    if jsonb_typeof(v_profile)<>'object' or pg_column_size(v_profile)>16384 then raise exception 'Invalid profile' using errcode='22023'; end if;
    if p_locale is null or p_locale not in ('lv','en') then raise exception 'Invalid locale' using errcode='22023'; end if;

    select u.email,u.email_confirmed_at into v_email,v_confirmed_at
      from auth.users as u where u.id=v_account_id;
    if v_email is null or v_confirmed_at is null then raise exception 'Verified account required' using errcode='42501'; end if;

    v_preferences:=jsonb_build_object('service',true,'marketing',coalesce(p_marketing,false),'locale',p_locale);
    insert into public.accounts(id,email,name,verified,preferences,profile)
      values(v_account_id,v_email,v_name,true,v_preferences,v_profile)
      on conflict(id) do update set email=excluded.email,verified=true,name=excluded.name,
        preferences=excluded.preferences,profile=excluded.profile
      where public.accounts.deleted_at is null;
    if not found then raise exception 'Account unavailable' using errcode='42501'; end if;

    insert into public.subscriptions(account_id) values(v_account_id) on conflict on constraint subscriptions_pkey do nothing;
    return query select a.id,a.email,a.name,a.role,a.preferences,a.profile,a.design_defaults
      from public.accounts as a where a.id=v_account_id and a.deleted_at is null;
  end
  $function$;
  revoke all on function public.sync_own_account(text,jsonb,text,boolean) from public;
  alter function public.sync_own_account(text,jsonb,text,boolean) owner to lumiq_api_owner;
  revoke create on schema public from lumiq_api_owner;
  end if;
end
$migration$;

do $migration$
begin
  if exists(select 1 from pg_roles where rolname='authenticated') then
  grant execute on function public.sync_own_account(text,jsonb,text,boolean) to authenticated;
  create or replace function public.list_own_events()
  returns setof jsonb
  language sql stable security invoker
  set search_path=pg_catalog,public,auth
  as $function$
    select jsonb_build_object(
      'id',e.id,'owner_id',e.owner_id,'slug',e.slug,'name',e.name,'description',e.description,
      'starts_at',e.starts_at,'ends_at',e.ends_at,'time_zone',e.time_zone,'status',e.status,
      'paused',e.paused,'appearance',e.appearance,'entitlement',e.entitlement,
      'retention_at',e.retention_at,'share_enabled',e.share_enabled,'share_expires',e.share_expires,
      'share_used',e.share_used,'share_limit',e.share_limit,'created_at',e.created_at,
      'photo_count',count(m.id) filter(where m.status='uploaded' and e.retention_at>now())::int,
      'bytes',coalesce(sum(m.bytes+m.thumbnail_bytes) filter(where m.status in ('uploaded','pending') and e.retention_at>now()),0)::bigint
    )
    from public.events as e
    left join public.media as m on m.event_id=e.id
    where e.owner_id=(select auth.uid()) and e.status<>'deleted'
    group by e.id
    order by e.created_at desc
  $function$;
  revoke all on function public.list_own_events() from public;
  grant execute on function public.list_own_events() to authenticated;
  create or replace function public.get_own_billing()
  returns jsonb
  language sql stable security invoker
  set search_path=pg_catalog,public,auth
  as $function$
    select jsonb_build_object(
      'subscription',(select jsonb_build_object('account_id',s.account_id,'plan',s.plan,'status',s.status,
        'period_start',s.period_start,'period_end',s.period_end,'cancel_at_end',s.cancel_at_end,'updated_at',s.updated_at)
        from public.subscriptions as s where s.account_id=(select auth.uid())),
      'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'owner_id',o.owner_id,'plan',o.plan,
        'amount',o.amount,'status',o.status,'created_at',o.created_at) order by o.created_at desc)
        from public.orders as o where o.owner_id=(select auth.uid())),'[]'::jsonb),
      'used',coalesce((select count(p.event_id)::int from public.event_publications as p
        join public.subscriptions as s on s.account_id=(select auth.uid())
        where p.owner_id=(select auth.uid()) and ((s.plan='trial' and p.source='trial') or
          (s.plan<>'trial' and p.source='subscription' and p.consumed_at>=s.period_start and p.consumed_at<s.period_end))),0),
      'passes',coalesce((select count(p.owner_id)::int from public.event_passes as p
        where p.owner_id=(select auth.uid()) and p.redeemed_event_id is null and p.revoked_at is null),0)
    )
  $function$;
  revoke all on function public.get_own_billing() from public;
  grant execute on function public.get_own_billing() to authenticated;
  create or replace function public.get_own_event(p_event_id uuid)
  returns jsonb
  language sql stable security invoker
  set search_path=pg_catalog,public,auth
  as $function$
    select jsonb_build_object(
      'id',e.id,'owner_id',e.owner_id,'slug',e.slug,'name',e.name,'description',e.description,
      'starts_at',e.starts_at,'ends_at',e.ends_at,'time_zone',e.time_zone,'status',e.status,
      'paused',e.paused,'appearance',e.appearance,'entitlement',e.entitlement,
      'retention_at',e.retention_at,'share_enabled',e.share_enabled,'share_expires',e.share_expires,
      'share_used',e.share_used,'share_limit',e.share_limit,'gallery_cover_id',e.gallery_cover_id,
      'created_at',e.created_at,
      'published_before',exists(select 1 from public.event_publications as p where p.event_id=e.id)
    )
    from public.events as e
    where e.id=p_event_id and e.owner_id=(select auth.uid()) and e.status<>'deleted'
  $function$;
  revoke all on function public.get_own_event(uuid) from public;
  grant execute on function public.get_own_event(uuid) to authenticated;
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.sync_own_account(text,jsonb,text,boolean) from anon;
    revoke all on function public.list_own_events() from anon;
    revoke all on function public.get_own_event(uuid) from anon;
    revoke all on function public.get_own_billing() from anon;
  end if;
  end if;
end
$migration$;
