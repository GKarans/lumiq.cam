-- Apply signed provider events transactionally without granting runtime table access.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_payment_owner') then
    create role lumiq_payment_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_payment_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_payment_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_payment_owner;
  grant select(id,deleted_at) on public.accounts to lumiq_payment_owner;
  grant select(account_id,plan,status,period_start,period_end,cancel_at_end,provider_id,provider_updated_at,provider_customer),
    update(plan,status,period_start,period_end,cancel_at_end,provider_id,provider_updated_at,provider_customer,updated_at)
    on public.subscriptions to lumiq_payment_owner;
  grant select(id,owner_id,plan,amount,status,provider_id),update(status,provider_id) on public.orders to lumiq_payment_owner;
  grant select(id,created),insert(id,created) on public.payment_events to lumiq_payment_owner;
  grant insert(id,owner_id,order_id,entitlement) on public.event_passes to lumiq_payment_owner;
  grant insert(id,actor_id,action,target_id) on public.audit to lumiq_payment_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='payment_owner_accounts') then
    create policy payment_owner_accounts on public.accounts for select to lumiq_payment_owner using(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='payment_owner_subscriptions') then
    create policy payment_owner_subscriptions on public.subscriptions for all to lumiq_payment_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='payment_owner_orders') then
    create policy payment_owner_orders on public.orders for all to lumiq_payment_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='payment_events' and policyname='payment_owner_events') then
    create policy payment_owner_events on public.payment_events for all to lumiq_payment_owner using(true) with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_passes' and policyname='payment_owner_passes') then
    create policy payment_owner_passes on public.event_passes for insert to lumiq_payment_owner with check(true);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='audit' and policyname='payment_owner_audit') then
    create policy payment_owner_audit on public.audit for insert to lumiq_payment_owner with check(true);
  end if;
  grant create on schema public to lumiq_payment_owner;

  create or replace function public.resolve_billing_owner(p_provider_id text)
  returns uuid language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select account_id from public.subscriptions where provider_id=p_provider_id limit 1
  $function$;

  create or replace function public.get_billing_subscription_id(p_owner_id uuid)
  returns text language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select provider_id from public.subscriptions where account_id=p_owner_id limit 1
  $function$;

  create or replace function public.reconcile_provider_subscription_state(p_owner_id uuid,p_snapshot jsonb)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_sub record;v_plan text:=p_snapshot->>'plan';v_status text:=p_snapshot->>'status';
    v_start timestamptz:=nullif(p_snapshot->>'period_start','')::timestamptz;
    v_end timestamptz:=nullif(p_snapshot->>'period_end','')::timestamptz;
  begin
    if p_owner_id is null or p_snapshot->>'provider_id' is null
      or v_plan is null or v_plan not in ('gathering','studio')
      or v_status is null or v_status not in ('active','trialing','overdue','ended','incomplete')
      or v_start is null or v_end is null or v_start>=v_end then
      raise exception 'Invalid subscription snapshot' using errcode='22023';
    end if;
    select account_id,provider_id into v_sub from public.subscriptions where account_id=p_owner_id for update;
    if not found or v_sub.provider_id is distinct from p_snapshot->>'provider_id' then
      raise exception 'Subscription does not match this account' using errcode='42501';
    end if;
    update public.subscriptions set plan=v_plan,status=v_status,period_start=v_start,period_end=v_end,
      cancel_at_end=coalesce((p_snapshot->>'cancel_at_end')::boolean,false),
      provider_customer=nullif(p_snapshot->>'provider_customer',''),updated_at=now()
      where account_id=p_owner_id;
    return true;
  end
  $function$;

  create or replace function public.apply_provider_payment_event(p_event jsonb)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare
    v_type text:=p_event->>'type';v_event_id text:=p_event->>'id';v_created bigint;
    v_owner uuid;v_order_id uuid;v_provider_id text;v_order record;v_sub record;
    v_inserted text;v_status text;v_plan text;v_start timestamptz;v_end timestamptz;v_provider_updated bigint;
    v_amount integer;v_payment_status text;
  begin
    if jsonb_typeof(p_event)<>'object' or v_event_id is null or length(v_event_id)>255
      or v_type is null or v_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
        'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed')
      or (p_event->>'created') !~ '^[0-9]{1,12}$' then
      raise exception 'Invalid provider event' using errcode='22023';
    end if;
    v_created:=(p_event->>'created')::bigint;
    v_owner:=nullif(p_event->>'owner_id','')::uuid;
    v_order_id:=nullif(p_event->>'order_id','')::uuid;
    v_provider_id:=nullif(p_event->>'subscription_id','');
    v_payment_status:=p_event->>'payment_status';
    insert into public.payment_events(id,created) values(v_event_id,v_created) on conflict do nothing returning id into v_inserted;
    if v_inserted is null then return jsonb_build_object('duplicate',true); end if;

    if v_type like 'checkout.%' then
      if v_owner is null or v_order_id is null then raise exception 'Payment account metadata is missing' using errcode='22023'; end if;
      perform 1 from public.accounts where id=v_owner and deleted_at is null;
      if not found then raise exception 'Payment account not found' using errcode='P0002'; end if;
      select id,owner_id,plan,amount,status,provider_id into v_order
        from public.orders where id=v_order_id and owner_id=v_owner for update;
      if not found then raise exception 'Payment does not match the order' using errcode='23514'; end if;
      if p_event->>'checkout_id' is null
        or (v_order.provider_id is not null and v_order.provider_id is distinct from p_event->>'checkout_id') then
        raise exception 'Payment does not match the order' using errcode='23514';
      end if;
      if v_type like '%failed' then
        update public.orders set status='failed' where id=v_order_id and status='pending';
        return jsonb_build_object('failed',true);
      end if;
      if v_payment_status<>'paid' then return jsonb_build_object('pending',true); end if;
      v_amount:=nullif(p_event->>'amount_total','')::integer;
      if v_amount is null or p_event->>'currency' is distinct from 'eur' or v_amount<>v_order.amount
        or p_event->>'checkout_id' is null
        or (v_order.provider_id is not null and v_order.provider_id is distinct from p_event->>'checkout_id') then
        raise exception 'Payment does not match the order' using errcode='23514';
      end if;
      if v_order.status='paid' then return jsonb_build_object('duplicate',true); end if;
      update public.orders set status='paid',provider_id=p_event->>'checkout_id' where id=v_order_id;
      if v_order.plan='single' then
        if p_event->>'mode' is distinct from 'payment' then raise exception 'Single Event requires a one-time payment' using errcode='23514'; end if;
        insert into public.event_passes(id,owner_id,order_id,entitlement) values(gen_random_uuid(),v_owner,v_order_id,
          '{"id":"single","name":"Single Event","price":1500,"billing":"one_time","events":1,"photos":500,"bytes":1048576000,"retentionDays":14,"shareDays":7,"durationDays":3,"description":"One occasion. One payment. No subscription."}'::jsonb);
        insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'pass.purchased',v_order_id::text);
        return jsonb_build_object('ok',true,'pass',true);
      end if;
      if p_event->>'mode' is distinct from 'subscription' then
        raise exception 'Monthly plans require a subscription payment' using errcode='23514';
      end if;
    else
      if v_owner is null then
        select account_id into v_owner from public.subscriptions where provider_id=v_provider_id;
      end if;
      if v_owner is null or v_provider_id is null or not exists(select 1 from public.accounts where id=v_owner and deleted_at is null) then
        raise exception 'Payment account not found' using errcode='P0002';
      end if;
    end if;

    if v_provider_id is null or v_provider_id !~ '^sub_[A-Za-z0-9_]+$' then
      raise exception 'Invalid subscription reference' using errcode='22023';
    end if;
    v_plan:=p_event->>'plan';v_status:=p_event->>'subscription_status';
    v_start:=nullif(p_event->>'period_start','')::timestamptz;v_end:=nullif(p_event->>'period_end','')::timestamptz;
    v_provider_updated:=coalesce(nullif(p_event->>'provider_updated_at','')::bigint,v_created);
    if v_plan is null or v_plan not in ('gathering','studio') or v_status is null or v_status not in ('active','trialing','overdue','ended','incomplete')
      or v_start is null or v_end is null or v_start>=v_end then
      raise exception 'Invalid subscription snapshot' using errcode='22023';
    end if;
    select account_id,plan,status,provider_updated_at,provider_id into v_sub
      from public.subscriptions where account_id=v_owner for update;
    if not found then raise exception 'Billing account not found' using errcode='P0002'; end if;
    if v_sub.provider_id is not null and v_sub.provider_id<>v_provider_id and v_sub.status not in ('ended','incomplete') then
      raise exception 'Resolve the existing subscription before activating another' using errcode='23505';
    end if;
    if v_sub.provider_updated_at>v_provider_updated then return jsonb_build_object('stale',true); end if;
    update public.subscriptions set plan=v_plan,status=v_status,period_start=v_start,period_end=v_end,
      cancel_at_end=coalesce((p_event->>'cancel_at_end')::boolean,false),provider_id=v_provider_id,
      provider_customer=nullif(p_event->>'customer_id',''),provider_updated_at=v_provider_updated,updated_at=now()
      where account_id=v_owner;
    insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,v_type,v_event_id);
    return jsonb_build_object('ok',true);
  end
  $function$;

  revoke all on function public.resolve_billing_owner(text) from public;
  revoke all on function public.get_billing_subscription_id(uuid) from public;
  revoke all on function public.reconcile_provider_subscription_state(uuid,jsonb) from public;
  revoke all on function public.apply_provider_payment_event(jsonb) from public;
  alter function public.resolve_billing_owner(text) owner to lumiq_payment_owner;
  alter function public.get_billing_subscription_id(uuid) owner to lumiq_payment_owner;
  alter function public.reconcile_provider_subscription_state(uuid,jsonb) owner to lumiq_payment_owner;
  alter function public.apply_provider_payment_event(jsonb) owner to lumiq_payment_owner;
  revoke create on schema public from lumiq_payment_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.resolve_billing_owner(text) to lumiq_restore_runtime;
    grant execute on function public.get_billing_subscription_id(uuid) to lumiq_restore_runtime;
    grant execute on function public.reconcile_provider_subscription_state(uuid,jsonb) to lumiq_restore_runtime;
    grant execute on function public.apply_provider_payment_event(jsonb) to lumiq_restore_runtime;
  end if;
  if to_regprocedure('auth.uid()') is not null and exists(select 1 from pg_roles where rolname='lumiq_admin_owner') then
    create or replace function public.record_admin_billing_reconcile(p_provider_id text)
    returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
    as $function$
    declare v_actor uuid:=auth.uid();
    begin
      if v_actor is null or p_provider_id is null or p_provider_id !~ '^sub_[A-Za-z0-9_]+$'
        or not exists(select 1 from public.accounts where id=v_actor and role='admin') then
        raise exception 'Administrator access is required' using errcode='42501';
      end if;
      insert into public.audit(id,actor_id,action,target_id)
        values(gen_random_uuid(),v_actor,'admin.billing.reconcile',p_provider_id);
      return true;
    end
    $function$;
    revoke all on function public.record_admin_billing_reconcile(text) from public;
    grant create on schema public to lumiq_admin_owner;
    alter function public.record_admin_billing_reconcile(text) owner to lumiq_admin_owner;
    revoke create on schema public from lumiq_admin_owner;
    grant execute on function public.record_admin_billing_reconcile(text) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then revoke all on function public.record_admin_billing_reconcile(text) from anon; end if;
  end if;
end
$migration$;
