-- Return only the selected cover object key, not the event row or storage prefix.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,owner_id,status,appearance,retention_at) on public.events to lumiq_api_owner;
    grant execute on function auth.uid() to lumiq_api_owner;

    if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='api_owner_published_cover_select') then
      create policy api_owner_published_cover_select on public.events for select to lumiq_api_owner
        using(status='published' and retention_at>now());
    end if;

    create or replace function public.get_event_cover_asset(p_event_id uuid,p_camera boolean default false,p_source boolean default false)
    returns text language plpgsql stable security definer
    set search_path=pg_catalog,public,auth
    as $function$
      declare
        v_appearance jsonb:='{}'::jsonb;
        v_item jsonb;
        v_event record;
      begin
        select e.id,e.owner_id,e.status,e.appearance into v_event from public.events e
        where e.id=p_event_id and e.status<>'deleted' and e.retention_at>now()
          and (e.owner_id=(select auth.uid()) or e.status='published') limit 1;
        if not found then return null; end if;
        if jsonb_typeof(v_event.appearance)='object' then
          v_appearance:=v_event.appearance;
        elsif jsonb_typeof(v_event.appearance)='array' then
          for v_item in select value from jsonb_array_elements(v_event.appearance) loop
            if jsonb_typeof(v_item)='string' then
              begin v_item:=(v_item#>>'{}')::jsonb; exception when others then continue; end;
            end if;
            if jsonb_typeof(v_item)='object' then v_appearance:=v_appearance||v_item; end if;
          end loop;
        end if;
        if p_source then return coalesce(v_appearance->>'cover_base_key',v_appearance->>'cover_key'); end if;
        if p_camera then return coalesce(v_appearance->>'camera_cover_key',v_appearance->>'cover_key'); end if;
        return v_appearance->>'cover_key';
      end
    $function$;
    revoke all on function public.get_event_cover_asset(uuid,boolean,boolean) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.get_event_cover_asset(uuid,boolean,boolean) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.get_event_cover_asset(uuid,boolean,boolean) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      grant execute on function public.get_event_cover_asset(uuid,boolean,boolean) to anon;
    end if;
  end if;
end
$migration$;
