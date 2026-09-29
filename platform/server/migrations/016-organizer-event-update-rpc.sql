-- Update an owned event and enqueue replaced cover objects in the same transaction.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id) on public.accounts to lumiq_api_owner;
    grant select(id,owner_id,slug,name,description,starts_at,ends_at,time_zone,status,paused,appearance,entitlement,retention_at,created_at),
      update(name,description,starts_at,ends_at,time_zone,appearance,retention_at) on public.events to lumiq_api_owner;
    grant select(event_id,owner_id,schedule_deadline) on public.event_publications to lumiq_api_owner;
    grant select(event_id) on public.media to lumiq_api_owner;
    grant insert(id,owner_id,event_id,type,payload) on public.jobs to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='api_owner_event_update') then
      create policy api_owner_event_update on public.events
        for update to lumiq_api_owner using (owner_id=(select auth.uid()))
        with check (owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_publications' and policyname='api_owner_publications_select') then
      create policy api_owner_publications_select on public.event_publications
        for select to lumiq_api_owner using (owner_id=(select auth.uid()));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='api_owner_media_select') then
      create policy api_owner_media_select on public.media
        for select to lumiq_api_owner using (exists(select 1 from public.events e where e.id=media.event_id and e.owner_id=(select auth.uid())));
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='api_owner_cover_cleanup_insert') then
      create policy api_owner_cover_cleanup_insert on public.jobs
        for insert to lumiq_api_owner with check (
          owner_id=(select auth.uid()) and type='object-cleanup'
          and exists(select 1 from public.events e where e.id=jobs.event_id and e.owner_id=(select auth.uid()))
        );
    end if;

    create or replace function public.update_own_event(
      p_event_id uuid,p_name text,p_description text,p_starts_at timestamptz,
      p_ends_at timestamptz,p_time_zone text,p_appearance jsonb,p_use_preset boolean
    ) returns jsonb
    language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_event record;
      v_name text:=btrim(coalesce(p_name,''));
      v_starts timestamptz;
      v_ends timestamptz;
      v_zone text;
      v_duration integer;
      v_retention_days integer;
      v_schedule_deadline timestamptz;
      v_has_publication boolean:=false;
      v_has_media boolean:=false;
      v_state text;
      v_appearance jsonb;
      v_current_appearance jsonb:='{}'::jsonb;
      v_item jsonb;
      v_cleanup_keys jsonb;
      v_key text;
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_event_id is null or length(v_name)<2 or length(v_name)>80 then raise exception 'Invalid event values' using errcode='22023'; end if;
      if p_description is not null and length(p_description)>500 then raise exception 'Invalid event description' using errcode='22023'; end if;
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

      perform 1 from public.accounts where id=v_owner and verified=true and deleted_at is null for update;
      if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
      select id,owner_id,slug,name,description,starts_at,ends_at,time_zone,status,paused,appearance,entitlement,retention_at,created_at
        into v_event from public.events where id=p_event_id and owner_id=v_owner for update;
      if not found then raise exception 'Event not found' using errcode='P0002'; end if;
      if jsonb_typeof(v_event.appearance)='object' then
        v_current_appearance:=v_event.appearance;
      elsif jsonb_typeof(v_event.appearance)='array' then
        for v_item in select value from jsonb_array_elements(v_event.appearance) loop
          if jsonb_typeof(v_item)='string' then
            begin v_item:=(v_item#>>'{}')::jsonb; exception when others then v_item:='{}'::jsonb; end;
          end if;
          if jsonb_typeof(v_item)='object' then v_current_appearance:=v_current_appearance||v_item; end if;
        end loop;
      end if;
      if v_event.status in ('archived','deleted') then raise exception 'Archived events cannot be changed' using errcode='23514'; end if;
      if v_event.retention_at<=now() then raise exception 'Event retention has ended' using errcode='23514'; end if;

      v_starts:=coalesce(p_starts_at,v_event.starts_at);
      v_ends:=coalesce(p_ends_at,v_event.ends_at);
      v_zone:=coalesce(nullif(p_time_zone,''),v_event.time_zone);
      if v_ends<=v_starts then raise exception 'Invalid event schedule' using errcode='22023'; end if;
      v_duration:=coalesce(nullif(v_event.entitlement->>'durationDays','')::integer,3);
      v_retention_days:=coalesce(nullif(v_event.entitlement->>'retentionDays','')::integer,30);
      if v_ends-v_starts>make_interval(days=>v_duration) then raise exception 'Event exceeds its plan duration' using errcode='23514'; end if;
      if not exists(select 1 from pg_timezone_names where name=v_zone) then raise exception 'Invalid event time zone' using errcode='22023'; end if;
      select schedule_deadline into v_schedule_deadline from public.event_publications where event_id=p_event_id and owner_id=v_owner;
      v_has_publication:=found;
      if v_has_publication and v_ends>v_schedule_deadline then raise exception 'Event exceeds its scheduling window' using errcode='23514'; end if;
      select exists(select 1 from public.media where event_id=p_event_id) into v_has_media;
      if v_has_media and (v_starts is distinct from v_event.starts_at or v_ends is distinct from v_event.ends_at) then
        raise exception 'Event times cannot change after photos have been submitted' using errcode='23514';
      end if;
      if v_event.ends_at<=now() and (v_starts is distinct from v_event.starts_at or v_ends is distinct from v_event.ends_at) then
        raise exception 'Completed events cannot be rescheduled' using errcode='23514';
      end if;

      v_appearance:=jsonb_build_object(
        'title',left(coalesce(nullif(p_appearance->>'title',''),v_name),80),
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
      if p_appearance ? 'guest_design' then v_appearance:=v_appearance||jsonb_build_object('guest_design',p_appearance->'guest_design'); end if;
      foreach v_key in array array['camera_cover','camera_cover_key','qr_layout','qr_background_key','qr_base_key'] loop
        if v_current_appearance ? v_key then v_appearance:=v_appearance||jsonb_build_object(v_key,v_current_appearance->v_key); end if;
      end loop;
      if not coalesce(p_use_preset,false) then
        foreach v_key in array array['cover_key','cover_base_key'] loop
          if v_current_appearance ? v_key then v_appearance:=v_appearance||jsonb_build_object(v_key,v_current_appearance->v_key); end if;
        end loop;
      else
        select coalesce(jsonb_agg(value),'[]'::jsonb) into v_cleanup_keys
          from jsonb_each_text(v_current_appearance)
          where key in ('cover_key','cover_base_key') and value<>'';
        if jsonb_array_length(v_cleanup_keys)>0 then
          insert into public.jobs(id,owner_id,event_id,type,payload)
            values(gen_random_uuid(),v_owner,p_event_id,'object-cleanup',jsonb_build_object('keys',v_cleanup_keys));
        end if;
      end if;

      update public.events set name=v_name,description=coalesce(p_description,''),starts_at=v_starts,ends_at=v_ends,time_zone=v_zone,
        appearance=v_appearance,retention_at=v_ends+make_interval(days=>v_retention_days)
        where id=p_event_id and owner_id=v_owner;
      insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'event.updated',p_event_id::text);
      return jsonb_build_object('id',p_event_id,'owner_id',v_owner,'slug',v_event.slug,
        'name',v_name,'description',coalesce(p_description,''),'starts_at',v_starts,'ends_at',v_ends,'time_zone',v_zone,
        'status',v_event.status,'paused',v_event.paused,'appearance',v_appearance,
        'entitlement',v_event.entitlement,'retention_at',v_ends+make_interval(days=>v_retention_days),'created_at',v_event.created_at);
    end
    $function$;

    revoke all on function public.update_own_event(uuid,text,text,timestamptz,timestamptz,text,jsonb,boolean) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.update_own_event(uuid,text,text,timestamptz,timestamptz,text,jsonb,boolean) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.update_own_event(uuid,text,text,timestamptz,timestamptz,text,jsonb,boolean) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      revoke all on function public.update_own_event(uuid,text,text,timestamptz,timestamptz,text,jsonb,boolean) from anon;
    end if;
  end if;
end
$migration$;
