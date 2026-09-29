-- Create organizer drafts through a JWT-scoped transaction, not shared SQL.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,name,profile,storage_prefix),update(storage_prefix) on public.accounts to lumiq_api_owner;
    grant select(id,owner_id,status,storage_prefix),insert(id,owner_id,slug,name,description,starts_at,ends_at,time_zone,appearance,storage_prefix,entitlement,retention_at)
      on public.events to lumiq_api_owner;
    grant insert(id,actor_id,action,target_id) on public.audit to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='api_owner_event_select') then
      create policy api_owner_event_select on public.events
        for select to lumiq_api_owner using (owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='api_owner_event_insert') then
      create policy api_owner_event_insert on public.events
        for insert to lumiq_api_owner with check (owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='audit' and policyname='api_owner_audit_insert') then
      create policy api_owner_audit_insert on public.audit
        for insert to lumiq_api_owner with check (actor_id=(select auth.uid()));
    end if;

    create or replace function public.create_own_event(
      p_event_id uuid,p_slug text,p_name text,p_description text,
      p_starts_at timestamptz,p_ends_at timestamptz,p_time_zone text,p_appearance jsonb
    ) returns jsonb
    language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_account record;
      v_event_name text;
      v_owner_name text;
      v_owner_prefix text;
      v_event_prefix text;
      v_suffix text;
      v_offset integer;
      v_appearance jsonb;
      v_entitlement jsonb:='{"id":"studio","name":"Studio","price":7000,"billing":"monthly","events":12,"photos":1000,"bytes":2097152000,"retentionDays":30,"shareDays":14,"durationDays":3,"description":"For people who bring people together."}'::jsonb;
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_event_id is null or p_slug is null or p_slug !~ '^[a-z0-9-]{12,32}$' then raise exception 'Invalid event identity' using errcode='22023'; end if;
      if p_name is null or length(btrim(p_name))<2 or length(p_name)>80 then raise exception 'Invalid event name' using errcode='22023'; end if;
      if p_description is not null and length(p_description)>500 then raise exception 'Invalid event description' using errcode='22023'; end if;
      if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '3 days' then raise exception 'Invalid event schedule' using errcode='22023'; end if;
      if p_time_zone is null or not exists(select 1 from pg_timezone_names where name=p_time_zone) then raise exception 'Invalid event time zone' using errcode='22023'; end if;
      if jsonb_typeof(coalesce(p_appearance,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_appearance,'{}'::jsonb))>160000 then raise exception 'Invalid event appearance' using errcode='22023'; end if;
      if jsonb_typeof(p_appearance->'guest_design')='object' then
        if jsonb_typeof(p_appearance->'guest_design'->'objects') is distinct from 'array' then raise exception 'Invalid guest design' using errcode='22023'; end if;
        if jsonb_array_length(p_appearance->'guest_design'->'objects')>80 or pg_column_size(p_appearance->'guest_design')>140000
          or exists(select 1 from jsonb_array_elements(p_appearance->'guest_design'->'objects') o where coalesce(o->>'type','') not in ('IText','Textbox','Text','Path','Image','Rect','Circle','Ellipse','Line','Triangle','Polygon')) then
          raise exception 'Invalid guest design' using errcode='22023';
        end if;
      elsif p_appearance ? 'guest_design' then
        raise exception 'Invalid guest design' using errcode='22023';
      end if;

      select id,name,profile,storage_prefix into v_account
        from public.accounts where id=v_owner and verified=true and deleted_at is null for update;
      if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
      if (select count(*) from public.events where owner_id=v_owner and status='draft')>=100 then
        raise exception 'Draft limit reached' using errcode='23514';
      end if;

      v_owner_name:=case when v_account.profile->>'account_type'='business' and nullif(btrim(v_account.profile->>'company_name'),'') is not null then v_account.profile->>'company_name' else v_account.name end;
      v_owner_name:=left(trim(both '-' from regexp_replace(regexp_replace(lower(translate(v_owner_name,'āčēģīķļņōŗšūž','acegiklnorsuz')),'[^a-z0-9]+','-','g'),'-+','-','g')),60);
      if v_owner_name='' then v_owner_name:='organizer'; end if;
      if v_account.storage_prefix is null then
        foreach v_offset in array array[0,6,12,18,24,26] loop
          v_suffix:=substr(replace(v_owner::text,'-',''),v_offset+1,6);
          v_owner_prefix:=v_owner_name||'-'||v_suffix;
          exit when not exists(select 1 from public.accounts where storage_prefix=v_owner_prefix and id<>v_owner);
          v_owner_prefix:=null;
        end loop;
        if v_owner_prefix is null then raise exception 'Could not allocate organizer storage path'; end if;
        update public.accounts set storage_prefix=v_owner_prefix where id=v_owner;
      else
        v_owner_prefix:=v_account.storage_prefix;
      end if;

      v_event_name:=left(trim(both '-' from regexp_replace(regexp_replace(lower(translate(btrim(p_name),'āčēģīķļņōŗšūž','acegiklnorsuz')),'[^a-z0-9]+','-','g'),'-+','-','g')),60);
      if v_event_name='' then v_event_name:='event'; end if;
      foreach v_offset in array array[0,6,12,18,24,26] loop
        v_suffix:=substr(replace(p_event_id::text,'-',''),v_offset+1,6);
        v_event_prefix:=v_owner_prefix||'/events/'||v_event_name||'-'||v_suffix;
        exit when not exists(select 1 from public.events where storage_prefix=v_event_prefix);
        v_event_prefix:=null;
      end loop;
      if v_event_prefix is null then raise exception 'Could not allocate event storage path'; end if;

      v_appearance:=jsonb_build_object(
        'title',left(coalesce(nullif(p_appearance->>'title',''),btrim(p_name)),80),
        'subtitle',left(coalesce(p_appearance->>'subtitle',''),180),
        'button',left(coalesce(nullif(p_appearance->>'button',''),'Take a photo'),28),
        'chooseButton',left(coalesce(nullif(p_appearance->>'chooseButton',''),'Choose photos'),28),
        'joinButton',left(coalesce(nullif(p_appearance->>'joinButton',''),'Join the gathering'),28),
        'showTitle',coalesce((p_appearance->>'showTitle')::boolean,true),
        'showDate',coalesce((p_appearance->>'showDate')::boolean,false),
        'cover',case when coalesce(p_appearance->>'cover','') ~ '^/assets/[a-z0-9-]+[.]webp$' then p_appearance->>'cover' else '/assets/garden-gathering.webp' end,
        'positionX',case when coalesce(p_appearance->>'positionX','') ~ '^-?[0-9]+([.][0-9]+)?$' then least(100,greatest(0,(p_appearance->>'positionX')::numeric)) else 50 end,
        'position',case when coalesce(p_appearance->>'position','') ~ '^-?[0-9]+([.][0-9]+)?$' then least(100,greatest(0,(p_appearance->>'position')::numeric)) else 50 end,
        'zoom',case when coalesce(p_appearance->>'zoom','') ~ '^-?[0-9]+([.][0-9]+)?$' then round(least(3,greatest(1,(p_appearance->>'zoom')::numeric)),2) else 1 end,
        'align',case when p_appearance->>'align' in ('left','center','right') then p_appearance->>'align' else 'center' end,
        'font',case when p_appearance->>'font' in ('roboto','open-sans','noto-sans','montserrat','poppins','lato','raleway','oswald','playfair-display','merriweather') then p_appearance->>'font' else 'roboto' end,
        'buttonTheme',case when p_appearance->>'buttonTheme' in ('white','forest','rose','custom') then p_appearance->>'buttonTheme' else 'white' end,
        'buttonColor',case when coalesce(p_appearance->>'buttonColor','') ~* '^#[0-9a-f]{6}$' then lower(p_appearance->>'buttonColor') else '#153e32' end
      );
      if jsonb_typeof(p_appearance->'guest_design')='object' then
        v_appearance:=v_appearance||jsonb_build_object('guest_design',p_appearance->'guest_design');
      end if;
      insert into public.events(id,owner_id,slug,name,description,starts_at,ends_at,time_zone,appearance,storage_prefix,entitlement,retention_at)
        values(p_event_id,v_owner,p_slug,btrim(p_name),left(coalesce(p_description,''),500),p_starts_at,p_ends_at,p_time_zone,v_appearance,v_event_prefix,v_entitlement,p_ends_at+interval '30 days');
      insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'event.created',p_event_id::text);
      return jsonb_build_object('id',p_event_id,'owner_id',v_owner,'slug',p_slug,'name',btrim(p_name),'description',left(coalesce(p_description,''),500),'starts_at',p_starts_at,'ends_at',p_ends_at,'time_zone',p_time_zone,'status','draft','paused',false,'appearance',v_appearance,'entitlement',v_entitlement,'retention_at',p_ends_at+interval '30 days','created_at',now());
    end
    $function$;

    revoke all on function public.create_own_event(uuid,text,text,text,timestamptz,timestamptz,text,jsonb) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.create_own_event(uuid,text,text,text,timestamptz,timestamptz,text,jsonb) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.create_own_event(uuid,text,text,text,timestamptz,timestamptz,text,jsonb) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      revoke all on function public.create_own_event(uuid,text,text,text,timestamptz,timestamptz,text,jsonb) from anon;
    end if;
  end if;
end
$migration$;
