-- Keep customer support writes and administrator job retries behind narrow RPCs.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_support_owner') then
    create role lumiq_support_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole;
  elsif exists(select 1 from pg_roles where rolname='lumiq_support_owner' and (rolcanlogin or rolinherit or rolbypassrls or rolsuper or rolcreatedb or rolcreaterole)) then
    raise exception 'lumiq_support_owner must remain a locked, non-bypass role';
  end if;
  grant usage on schema public to lumiq_support_owner;
  if to_regprocedure('auth.uid()') is not null then
    grant usage on schema auth to lumiq_support_owner;
    grant execute on function auth.uid() to lumiq_support_owner;
  end if;
  grant select(id,email) on public.accounts to lumiq_support_owner;
  grant insert(id,owner_id,email,subject,message) on public.support_cases to lumiq_support_owner;
  grant select(id,owner_id,email,subject,message,status,reply,created_at) on public.support_cases to lumiq_support_owner;
  if to_regprocedure('auth.uid()') is not null then
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='support_owner_account_read') then
      create policy support_owner_account_read on public.accounts for select to lumiq_support_owner using(id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_cases' and policyname='support_owner_case_insert') then
      create policy support_owner_case_insert on public.support_cases for insert to lumiq_support_owner
        with check(true);
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_cases' and policyname='support_owner_case_read') then
      create policy support_owner_case_read on public.support_cases for select to lumiq_support_owner
        using((select auth.uid()) is not null and owner_id=(select auth.uid()));
    end if;
  end if;

  create or replace function public.create_support_case(p_email text,p_subject text,p_message text)
  returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_owner uuid:=auth.uid();v_email text;v_id uuid:=gen_random_uuid();
  begin
    if p_subject is null or length(btrim(p_subject))<1 or length(p_subject)>120
      or p_message is null or length(btrim(p_message))<1 or length(p_message)>4000 then
      raise exception 'Invalid support request' using errcode='22023';
    end if;
    if v_owner is not null then
      select email into v_email from public.accounts where id=v_owner;
      if not found then raise exception 'Account is unavailable' using errcode='42501'; end if;
    else
      v_email:=lower(btrim(p_email));
      if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'A valid email address is required' using errcode='22023';
      end if;
    end if;
    insert into public.support_cases(id,owner_id,email,subject,message)
      values(v_id,v_owner,v_email,btrim(p_subject),btrim(p_message));
    return jsonb_build_object('id',v_id,'message','Your request has been recorded.');
  end
  $function$;

  create or replace function public.list_own_support_cases()
  returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth
  as $function$
  begin
    return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'email',s.email,'subject',s.subject,
      'message',s.message,'status',s.status,'reply',s.reply,'created_at',s.created_at) order by s.created_at desc)
      from public.support_cases s where auth.uid() is not null and s.owner_id=auth.uid()),'[]'::jsonb);
  end
  $function$;

  if not exists(select 1 from pg_roles where rolname='lumiq_admin_owner') then
    raise exception 'lumiq_admin_owner is required before applying migration 037';
  end if;
  grant select on public.jobs to lumiq_admin_owner;
  grant update(status,error,attempts,available_at,lease_until,dispatched_at) on public.jobs to lumiq_admin_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='admin_owner_jobs_update') then
    create policy admin_owner_jobs_update on public.jobs for update to lumiq_admin_owner using(true) with check(true);
  end if;

  create or replace function public.retry_admin_job(p_id uuid)
  returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth
  as $function$
  declare v_actor uuid:=auth.uid();v_job public.jobs;v_children boolean;
  begin
    if not exists(select 1 from public.accounts where id=v_actor and role='admin') then
      raise exception 'Administrator access is required' using errcode='42501';
    end if;
    select * into v_job from public.jobs where id=p_id and status='failed' for update;
    if not found then return false; end if;
    if v_job.type='export' then
      select exists(select 1 from public.jobs where type='export-part' and payload->>'parent_id'=p_id::text) into v_children;
      if v_children then
        update public.jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null
          where type='export-part' and payload->>'parent_id'=p_id::text and status='failed';
        update public.jobs set status='processing',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=p_id;
      else
        update public.jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=p_id;
      end if;
    else
      update public.jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=p_id;
    end if;
    insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_actor,'admin.job.retry',p_id::text);
    return true;
  end
  $function$;

  revoke all on function public.create_support_case(text,text,text) from public;
  revoke all on function public.list_own_support_cases() from public;
  revoke all on function public.retry_admin_job(uuid) from public;
  alter function public.create_support_case(text,text,text) owner to lumiq_support_owner;
  alter function public.list_own_support_cases() owner to lumiq_support_owner;
  alter function public.retry_admin_job(uuid) owner to lumiq_admin_owner;
  revoke create on schema public from lumiq_support_owner,lumiq_admin_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.create_support_case(text,text,text) to anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant execute on function public.create_support_case(text,text,text) to authenticated;
    grant execute on function public.list_own_support_cases() to authenticated;
    grant execute on function public.retry_admin_job(uuid) to authenticated;
  end if;
end
$migration$;
