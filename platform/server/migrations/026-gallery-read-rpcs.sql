-- Move organizer and public gallery listings behind identity-scoped RPCs.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    raise exception 'Apply migration 021 before gallery read RPCs';
  end if;
  grant select(id,slug,name,description,starts_at,ends_at,time_zone,appearance,status,paused,retention_at,share_enabled,share_expires,share_used,share_limit,gallery_cover_id)
    on public.events to lumiq_guest_owner;
  grant select(id,event_id,name,created_at,bytes,favorite,hidden,status) on public.media to lumiq_guest_owner;
  grant select(id,event_id,name) on public.guests to lumiq_guest_owner;

  if exists(select 1 from pg_roles where rolname='authenticated') then
    grant select(id,event_id,name) on public.guests to authenticated;
    grant select(id,event_id,guest_id,name,created_at,bytes,favorite,hidden,status) on public.media to authenticated;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='guests' and policyname='organizer_guests_select') then
      create policy organizer_guests_select on public.guests for select to authenticated
        using(exists(select 1 from public.events e where e.id=guests.event_id and e.owner_id=(select auth.uid())));
    end if;

    create or replace function public.list_own_gallery(
      p_event_id uuid,p_guest text,p_date text,p_time_zone text,p_oldest boolean,p_cursor_created timestamptz,p_cursor_id uuid
    ) returns jsonb language plpgsql stable security invoker
    set search_path=pg_catalog,public,auth
    as $function$
    declare v_photos jsonb;v_total integer;v_guests jsonb;v_zone text:=coalesce(nullif(p_time_zone,''),'UTC');
    begin
      if auth.uid() is null or p_event_id is null or (p_cursor_created is null)<>(p_cursor_id is null)
        or (p_date is not null and p_date<>'' and p_date !~ '^\d{4}-\d{2}-\d{2}$')
        or length(v_zone)>80 or not exists(select 1 from pg_timezone_names where name=v_zone) then
        raise exception 'Invalid gallery query' using errcode='22023';
      end if;
      if not exists(select 1 from public.events e where e.id=p_event_id and e.owner_id=auth.uid() and e.retention_at>now()) then
        raise exception 'Event not found' using errcode='42501';
      end if;
      select count(*)::integer into v_total from public.media m join public.guests g on g.id=m.guest_id
        where m.event_id=p_event_id and m.status='uploaded' and (coalesce(p_guest,'')='' or g.name=p_guest)
          and (coalesce(p_date,'')='' or (m.created_at at time zone v_zone)::date=p_date::date);
      select coalesce(jsonb_agg(row_to_json(page)::jsonb order by
        case when p_oldest then page.created_at end asc,case when not p_oldest then page.created_at end desc,
        case when p_oldest then page.id end asc,case when not p_oldest then page.id end desc),'[]'::jsonb)
        into v_photos from (
          select m.id,m.name,m.created_at,m.bytes,m.favorite,m.hidden,g.name as guest
          from public.media m join public.guests g on g.id=m.guest_id
          where m.event_id=p_event_id and m.status='uploaded' and (coalesce(p_guest,'')='' or g.name=p_guest)
            and (coalesce(p_date,'')='' or (m.created_at at time zone v_zone)::date=p_date::date)
            and (p_cursor_created is null or (p_oldest and (m.created_at,m.id)>(p_cursor_created,p_cursor_id))
              or (not p_oldest and (m.created_at,m.id)<(p_cursor_created,p_cursor_id)))
          order by case when p_oldest then m.created_at end asc,case when not p_oldest then m.created_at end desc,
            case when p_oldest then m.id end asc,case when not p_oldest then m.id end desc limit 25
        ) page;
      select coalesce(jsonb_agg(g.name order by g.name),'[]'::jsonb) into v_guests
        from (select distinct g.name from public.guests g join public.media m on m.guest_id=g.id
          where m.event_id=p_event_id and m.status='uploaded') g;
      return jsonb_build_object('photos',v_photos,'total',v_total,'guests',v_guests);
    end
    $function$;
    revoke all on function public.list_own_gallery(uuid,text,text,text,boolean,timestamptz,uuid) from public;
    grant execute on function public.list_own_gallery(uuid,text,text,text,boolean,timestamptz,uuid) to authenticated;
  end if;

  create or replace function public.list_public_gallery(
    p_event_id uuid,p_guest text,p_date text,p_time_zone text,p_oldest boolean,p_cursor_created timestamptz,p_cursor_id uuid
  ) returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_photos jsonb;v_total integer;v_guests jsonb;v_zone text:=coalesce(nullif(p_time_zone,''),'UTC');
  begin
    if p_event_id is null or (p_cursor_created is null)<>(p_cursor_id is null)
      or (p_date is not null and p_date<>'' and p_date !~ '^\d{4}-\d{2}-\d{2}$')
      or length(v_zone)>80 or not exists(select 1 from pg_timezone_names where name=v_zone) then
      raise exception 'Invalid gallery query' using errcode='22023';
    end if;
    perform public.consume_public_gallery_share(p_event_id);
    if not exists(select 1 from public.events e where e.id=p_event_id and e.status='published' and e.ends_at<=now()
      and e.share_enabled and e.share_expires>now() and e.retention_at>now()) then
      raise exception 'This gallery is not shared or its viewing period has ended' using errcode='42501';
    end if;
    select count(*)::integer into v_total from public.media m join public.guests g on g.id=m.guest_id
      where m.event_id=p_event_id and m.status='uploaded' and m.hidden=false and (coalesce(p_guest,'')='' or g.name=p_guest)
        and (coalesce(p_date,'')='' or (m.created_at at time zone v_zone)::date=p_date::date);
    select coalesce(jsonb_agg(row_to_json(page)::jsonb order by
      case when p_oldest then page.created_at end asc,case when not p_oldest then page.created_at end desc,
      case when p_oldest then page.id end asc,case when not p_oldest then page.id end desc),'[]'::jsonb)
      into v_photos from (
        select m.id,m.name,m.created_at,m.bytes,m.favorite,m.hidden,g.name as guest
        from public.media m join public.guests g on g.id=m.guest_id
        where m.event_id=p_event_id and m.status='uploaded' and m.hidden=false and (coalesce(p_guest,'')='' or g.name=p_guest)
          and (coalesce(p_date,'')='' or (m.created_at at time zone v_zone)::date=p_date::date)
          and (p_cursor_created is null or (p_oldest and (m.created_at,m.id)>(p_cursor_created,p_cursor_id))
            or (not p_oldest and (m.created_at,m.id)<(p_cursor_created,p_cursor_id)))
        order by case when p_oldest then m.created_at end asc,case when not p_oldest then m.created_at end desc,
          case when p_oldest then m.id end asc,case when not p_oldest then m.id end desc limit 25
      ) page;
    select coalesce(jsonb_agg(g.name order by g.name),'[]'::jsonb) into v_guests
      from (select distinct g.name from public.guests g join public.media m on m.guest_id=g.id
        where m.event_id=p_event_id and m.status='uploaded' and m.hidden=false) g;
    return jsonb_build_object('photos',v_photos,'total',v_total,'guests',v_guests);
  end
  $function$;

  revoke all on function public.list_public_gallery(uuid,text,text,text,boolean,timestamptz,uuid) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.list_public_gallery(uuid,text,text,text,boolean,timestamptz,uuid) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.list_public_gallery(uuid,text,text,text,boolean,timestamptz,uuid) to anon;
  end if;

  create or replace function public.get_public_event(p_slug text)
  returns jsonb language sql stable security definer set search_path=pg_catalog,public
  as $function$
    select jsonb_build_object('id',e.id,'slug',e.slug,'name',e.name,'description',e.description,'starts_at',e.starts_at,
      'ends_at',e.ends_at,'time_zone',e.time_zone,'appearance',e.appearance,'status',e.status,'paused',e.paused,
      'retention_at',e.retention_at,'share_enabled',e.share_enabled,'share_expires',e.share_expires,'gallery_cover_id',e.gallery_cover_id)
      from public.events e where e.slug=p_slug and e.status='published' and e.retention_at>now() limit 1
  $function$;
  revoke all on function public.get_public_event(text) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.get_public_event(text) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then grant execute on function public.get_public_event(text) to anon; end if;
end
$migration$;
