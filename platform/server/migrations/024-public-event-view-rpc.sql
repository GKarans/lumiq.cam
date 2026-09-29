-- Return only the fields required to render a public guest event page.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    raise exception 'Apply migration 021 before public event view';
  end if;
  grant select(id,slug,name,description,starts_at,ends_at,time_zone,appearance,status,paused,retention_at,share_enabled,share_expires)
    on public.events to lumiq_guest_owner;

  create or replace function public.get_public_event(p_slug text)
  returns jsonb language sql stable security definer
  set search_path=pg_catalog,public
  as $function$
    select jsonb_build_object(
      'id',e.id,'slug',e.slug,'name',e.name,'description',e.description,
      'starts_at',e.starts_at,'ends_at',e.ends_at,'time_zone',e.time_zone,
      'appearance',e.appearance,'status',e.status,'paused',e.paused,
      'retention_at',e.retention_at,'share_enabled',e.share_enabled,'share_expires',e.share_expires
    ) from public.events e
    where e.slug=p_slug and e.status='published' and e.retention_at>now()
    limit 1
  $function$;

  revoke all on function public.get_public_event(text) from public;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.get_public_event(text) to anon;
  end if;
end
$migration$;
