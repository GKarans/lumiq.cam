-- Enforce public gallery share limits atomically without shared SQL writes.
do $migration$
begin
  if not exists(select 1 from pg_roles where rolname='lumiq_guest_owner') then
    raise exception 'Apply migration 021 before public gallery share';
  end if;
  grant select(id,status,ends_at,retention_at,share_enabled,share_expires,share_used,share_limit)
    on public.events to lumiq_guest_owner;
  grant update(share_used) on public.events to lumiq_guest_owner;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='guest_owner_share_counter_update') then
    create policy guest_owner_share_counter_update on public.events for update to lumiq_guest_owner
      using(status='published' and ends_at<=now() and share_enabled=true and share_expires>now() and retention_at>now() and share_used<share_limit)
      with check(status='published' and ends_at<=now() and share_enabled=true and share_expires>now() and retention_at>now());
  end if;

  create or replace function public.consume_public_gallery_share(p_event_id uuid)
  returns jsonb language plpgsql security definer
  set search_path=pg_catalog,public
  as $function$
  declare v_id uuid;
  begin
    update public.events set share_used=share_used+1
      where id=p_event_id and status='published' and ends_at<=now() and share_enabled=true
        and share_expires>now() and retention_at>now() and share_used<share_limit
      returning id into v_id;
    if not found then raise exception 'This gallery is not shared or its viewing allowance has ended' using errcode='42501'; end if;
    return jsonb_build_object('ok',true);
  end
  $function$;

  revoke all on function public.consume_public_gallery_share(uuid) from public;
  grant create on schema public to lumiq_guest_owner;
  alter function public.consume_public_gallery_share(uuid) owner to lumiq_guest_owner;
  revoke create on schema public from lumiq_guest_owner;
  if exists(select 1 from pg_roles where rolname='anon') then
    grant execute on function public.consume_public_gallery_share(uuid) to anon;
  end if;
end
$migration$;
