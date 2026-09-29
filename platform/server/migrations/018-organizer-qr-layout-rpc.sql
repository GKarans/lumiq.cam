-- Persist only the normalized QR layout for an organizer-owned event.
do $migration$
begin
  if exists(select 1 from pg_roles where rolname='lumiq_api_owner')
    and exists(select 1 from pg_roles where rolname='authenticated')
    and to_regnamespace('auth') is not null then
    grant select(id,owner_id,status,appearance,retention_at) on public.events to lumiq_api_owner;
    grant update(appearance) on public.events to lumiq_api_owner;
    grant insert(id,actor_id,action,target_id) on public.audit to lumiq_api_owner;

    create or replace function public.save_own_qr_layout(p_event_id uuid,p_layout jsonb)
    returns jsonb language plpgsql security definer
    set search_path=pg_catalog,public,auth
    as $function$
    declare
      v_owner uuid:=auth.uid();
      v_event record;
      v_layout jsonb;
      v_scene jsonb;
      v_template text;
      v_font text;
    begin
      if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
      if p_event_id is null or p_layout is null or jsonb_typeof(p_layout)<>'object' then raise exception 'Invalid QR layout' using errcode='22023'; end if;
      v_template:=p_layout->>'template';
      if v_template is null or v_template not in ('garden','vintage','celebration','modern','custom') then raise exception 'Invalid QR template' using errcode='22023'; end if;
      v_font:=p_layout->>'font';
      if v_font is null or v_font not in ('roboto','open-sans','noto-sans','montserrat','poppins','lato','raleway','oswald','playfair-display','merriweather') then raise exception 'Invalid QR font' using errcode='22023'; end if;
      if jsonb_typeof(p_layout->'scene')='object' then
        v_scene:=p_layout->'scene';
        if jsonb_typeof(v_scene->'objects') is distinct from 'array' or jsonb_array_length(v_scene->'objects')>80 or pg_column_size(v_scene)>140000
          or exists(select 1 from jsonb_array_elements(v_scene->'objects') o where coalesce(o->>'type','') not in ('IText','Textbox','Text','Path','Image','Rect','Circle','Ellipse','Line','Triangle','Polygon')) then
          raise exception 'Invalid QR scene' using errcode='22023';
        end if;
      elsif p_layout ? 'scene' then
        raise exception 'Invalid QR scene' using errcode='22023';
      end if;

      select id,owner_id,status,appearance,retention_at into v_event
        from public.events where id=p_event_id and owner_id=v_owner for update;
      if not found then raise exception 'Event not found' using errcode='P0002'; end if;
      if v_event.status not in ('draft','published') or v_event.retention_at<=now() then raise exception 'This event can no longer be redesigned' using errcode='23514'; end if;
      if v_template='custom' and not (v_event.appearance ? 'qr_background_key') then raise exception 'Upload a custom QR background first' using errcode='23514'; end if;

      v_layout:=jsonb_build_object(
        'template',v_template,'font',v_font,
        'titleSize',round(least(104,greatest(48,case when jsonb_typeof(p_layout->'titleSize')='number' then (p_layout->>'titleSize')::numeric else 76 end))),
        'textX',least(.82,greatest(.18,case when jsonb_typeof(p_layout->'textX')='number' then (p_layout->>'textX')::numeric else .5 end)),
        'textY',least(.38,greatest(.10,case when jsonb_typeof(p_layout->'textY')='number' then (p_layout->>'textY')::numeric else .15 end)),
        'qrX',least(.82,greatest(.18,case when jsonb_typeof(p_layout->'qrX')='number' then (p_layout->>'qrX')::numeric else .5 end)),
        'qrY',least(.76,greatest(.34,case when jsonb_typeof(p_layout->'qrY')='number' then (p_layout->>'qrY')::numeric else .57 end)),
        'qrScale',round(least(1.18,greatest(.72,case when jsonb_typeof(p_layout->'qrScale')='number' then (p_layout->>'qrScale')::numeric else 1 end)),2)
      );
      if v_scene is not null then v_layout:=v_layout||jsonb_build_object('scene',v_scene); end if;
      update public.events set appearance=coalesce(appearance,'{}'::jsonb)||jsonb_build_object('qr_layout',v_layout) where id=p_event_id and owner_id=v_owner;
      insert into public.audit(id,actor_id,action,target_id) values(gen_random_uuid(),v_owner,'event.qr-layout.updated',p_event_id::text);
      return v_layout;
    end
    $function$;

    revoke all on function public.save_own_qr_layout(uuid,jsonb) from public;
    grant create on schema public to lumiq_api_owner;
    alter function public.save_own_qr_layout(uuid,jsonb) owner to lumiq_api_owner;
    revoke create on schema public from lumiq_api_owner;
    grant execute on function public.save_own_qr_layout(uuid,jsonb) to authenticated;
    if exists(select 1 from pg_roles where rolname='anon') then
      revoke all on function public.save_own_qr_layout(uuid,jsonb) from anon;
    end if;
  end if;
end
$migration$;
