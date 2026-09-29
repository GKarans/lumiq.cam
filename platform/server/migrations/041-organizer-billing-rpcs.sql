-- Organizer checkout and subscription mutations derive identity from auth.uid().
do $migration$
begin
  if to_regprocedure('auth.uid()') is null or not exists(select 1 from pg_roles where rolname='authenticated') then return; end if;
  if not exists(select 1 from pg_roles where rolname='lumiq_billing_owner') then
    create role lumiq_billing_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_billing_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_billing_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public,auth to lumiq_billing_owner;
  grant execute on function auth.uid() to lumiq_billing_owner;
  grant select(id,verified,deleted_at) on public.accounts to lumiq_billing_owner;
  grant select(account_id,plan,status,period_end,cancel_at_end,provider_id,provider_customer),
    update(cancel_at_end,updated_at) on public.subscriptions to lumiq_billing_owner;
  grant select(id,owner_id,plan,amount,status,provider_id),
    insert(id,owner_id,plan,amount),update(provider_id) on public.orders to lumiq_billing_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='billing_owner_account_read') then
    create policy billing_owner_account_read on public.accounts for select to lumiq_billing_owner
      using(id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='billing_owner_subscription_access') then
    create policy billing_owner_subscription_access on public.subscriptions for all to lumiq_billing_owner
      using(account_id=(select auth.uid())) with check(account_id=(select auth.uid()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='billing_owner_order_access') then
    create policy billing_owner_order_access on public.orders for all to lumiq_billing_owner
      using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
  end if;
  grant create on schema public to lumiq_billing_owner;

  create or replace function public.create_own_order(p_order_id uuid,p_plan text)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();v_amount integer;v_subscription record;
  begin
    if v_owner is null or p_order_id is null then raise exception 'Invalid checkout request' using errcode='42501'; end if;
    v_amount:=case p_plan when 'single' then 1500 when 'gathering' then 3000 when 'studio' then 7000 else null end;
    if v_amount is null then raise exception 'Choose a paid plan' using errcode='22023'; end if;
    if not exists(select 1 from public.accounts where id=v_owner and verified and deleted_at is null) then
      raise exception 'Verified account required' using errcode='42501';
    end if;
    select account_id,plan,status,period_end,cancel_at_end,provider_id,provider_customer into v_subscription
      from public.subscriptions where account_id=v_owner for update;
    if not found then raise exception 'Billing account not found' using errcode='P0002'; end if;
    if p_plan<>'single' and v_subscription.provider_id is not null
      and v_subscription.status not in ('ended','incomplete') then
      raise exception 'Manage the existing subscription before starting another' using errcode='23505';
    end if;
    insert into public.orders(id,owner_id,plan,amount) values(p_order_id,v_owner,p_plan,v_amount);
    return jsonb_build_object('id',p_order_id,'plan',p_plan,'amount',v_amount,
      'provider_id',v_subscription.provider_id,'provider_customer',v_subscription.provider_customer);
  end
  $function$;

  create or replace function public.set_own_order_provider(p_order_id uuid,p_provider_id text)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_count integer;
  begin
    if auth.uid() is null or p_provider_id !~ '^cs_[A-Za-z0-9_]{5,200}$' then
      raise exception 'Invalid checkout session' using errcode='42501';
    end if;
    update public.orders set provider_id=p_provider_id where id=p_order_id and owner_id=auth.uid() and status='pending';
    get diagnostics v_count=row_count;
    return v_count=1;
  end
  $function$;

  create or replace function public.cancel_own_subscription()
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_subscription record;
  begin
    if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
    select provider_id,period_end into v_subscription from public.subscriptions where account_id=auth.uid() for update;
    if not found or v_subscription.provider_id is null then raise exception 'Subscription not found' using errcode='P0002'; end if;
    update public.subscriptions set cancel_at_end=true,updated_at=now() where account_id=auth.uid();
    return jsonb_build_object('provider_id',v_subscription.provider_id,'period_end',v_subscription.period_end);
  end
  $function$;

  create or replace function public.get_own_subscription_payment_details()
  returns jsonb language sql stable security definer set search_path=pg_catalog,public,auth
  as $function$
    select jsonb_build_object('provider_id',provider_id,'provider_customer',provider_customer,
      'period_end',period_end,'cancel_at_end',cancel_at_end)
    from public.subscriptions where account_id=(select auth.uid())
  $function$;

  revoke all on function public.create_own_order(uuid,text) from public;
  revoke all on function public.set_own_order_provider(uuid,text) from public;
  revoke all on function public.cancel_own_subscription() from public;
  revoke all on function public.get_own_subscription_payment_details() from public;
  alter function public.create_own_order(uuid,text) owner to lumiq_billing_owner;
  alter function public.set_own_order_provider(uuid,text) owner to lumiq_billing_owner;
  alter function public.cancel_own_subscription() owner to lumiq_billing_owner;
  alter function public.get_own_subscription_payment_details() owner to lumiq_billing_owner;
  revoke create on schema public from lumiq_billing_owner;
  grant execute on function public.create_own_order(uuid,text) to authenticated;
  grant execute on function public.set_own_order_provider(uuid,text) to authenticated;
  grant execute on function public.cancel_own_subscription() to authenticated;
  grant execute on function public.get_own_subscription_payment_details() to authenticated;
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.create_own_order(uuid,text) from anon;
    revoke all on function public.set_own_order_provider(uuid,text) from anon;
    revoke all on function public.cancel_own_subscription() from anon;
    revoke all on function public.get_own_subscription_payment_details() from anon;
  end if;
end
$migration$;
