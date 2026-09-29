-- Collect service/billing notices atomically without exposing delivery-table writes.
do $migration$
begin
  grant select(entitlement,share_enabled,share_expires) on public.events to lumiq_job_owner;
  grant select(account_id,plan,status,period_end,cancel_at_end) on public.subscriptions to lumiq_job_owner;
  grant select(id,email,preferences,deleted_at) on public.accounts to lumiq_job_owner;
  grant select(event_id,status,bytes,thumbnail_bytes) on public.media to lumiq_job_owner;
  grant insert(id,account_id,recipient,subject,body,dedupe_key) on public.deliveries to lumiq_job_owner;
  grant select(dedupe_key) on public.deliveries to lumiq_job_owner;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='deliveries' and policyname='job_owner_deliveries_insert') then
    create policy job_owner_deliveries_insert on public.deliveries for all to lumiq_job_owner using(true) with check(true);
  end if;

  create or replace function public.collect_platform_notices()
  returns integer language plpgsql security definer set search_path=pg_catalog,public
  as $function$
  declare v_count integer;
  begin
    with event_usage as (
      select e.id,e.owner_id,e.name,e.ends_at,e.share_enabled,e.share_expires,e.entitlement,a.email,a.preferences,
        count(m.id) filter(where m.status in ('pending','uploaded'))::integer as photo_count,
        coalesce(sum(m.bytes+m.thumbnail_bytes) filter(where m.status in ('pending','uploaded')),0)::bigint as used_bytes
      from public.events e join public.accounts a on a.id=e.owner_id left join public.media m on m.event_id=e.id
      where e.status='published' and e.retention_at>now() and a.deleted_at is null
      group by e.id,a.email,a.preferences
    ), notices as (
      select owner_id as account_id,email as recipient,
        case when preferences->>'locale'='lv' then 'Tava pasākuma foto ir gatavi' else 'Your event photos are ready' end as subject,
        case when preferences->>'locale'='lv' then name||' ir beidzies. Atver pasākuma darba vietu, lai apskatītu foto, sagatavotu eksportu vai ieslēgtu viesu galeriju. Kopīgošana paliek izslēgta, līdz to ieslēdz.'
          else name||' has ended. Open your event workspace to view photos, prepare an export or enable guest gallery sharing. Sharing remains off until you enable it.' end as body,
        'ended:'||id::text||':'||to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as dedupe_key
      from event_usage where ends_at<=now()
      union all
      select owner_id,email,
        case when preferences->>'locale'='lv' then 'Pasākums tuvojas foto limitam' else 'Your event is approaching its photo allowance' end,
        case when preferences->>'locale'='lv' then name||' ir izmantojis vismaz 80% foto vai glabāšanas limita. Pārbaudi lietojumu pasākuma darba vietā. Arī nepabeigtas augšupielādes rezervē vietu.'
          else name||' has used at least 80% of its photo or storage allowance. Review usage in the event workspace. Pending uploads also reserve capacity.' end,
        'allowance-80:'||id::text
      from event_usage where entitlement ? 'photos' and entitlement ? 'bytes'
        and greatest(photo_count::numeric/nullif((entitlement->>'photos')::numeric,0),used_bytes::numeric/nullif((entitlement->>'bytes')::numeric,0))>=0.8
      union all
      select owner_id,email,
        case when preferences->>'locale'='lv' then 'Viesu galerijas kopīgošana drīz beigsies' else 'Guest gallery sharing ends soon' end,
        case when preferences->>'locale'='lv' then name||': viesu piekļuve beigsies 24 stundu laikā. Organizatora piekļuve turpinās līdz foto glabāšanas termiņam.'
          else name||': guest access ends within 24 hours. Your organizer access continues until the photo retention deadline.' end,
        'share-ending:'||id::text||':'||to_char(share_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from event_usage where share_enabled and share_expires>now() and share_expires<now()+interval '24 hours'
      union all
      select s.account_id,a.email,
        case when a.preferences->>'locale'='lv' then 'Tava Lumiq plāna statuss' else 'Your Lumiq plan status' end,
        case when a.preferences->>'locale'='lv' then
          case when s.status='active' then s.plan||' ir aktīvs.'||case when s.cancel_at_end then ' Tas netiks atjaunots pēc pašreizējā perioda.' else '' end
            when s.status='past_due' then 'Maksājumam nepieciešama uzmanība. Atver sadaļu Maksājumi. Esošie pasākumu limiti saglabājas.'
            else 'Abonements vairs nav aktīvs. Esošo pasākumu glabāšanas termiņi nemainās.' end
          else case when s.status='active' then s.plan||' is active.'||case when s.cancel_at_end then ' It will not renew after the current period.' else '' end
            when s.status='past_due' then 'Your payment needs attention. Open Billing to review payment details. Existing event allowances are preserved.'
            else 'Your subscription is no longer active. Existing event retention deadlines remain unchanged.' end end,
        'plan:'||s.account_id::text||':'||s.plan||':'||s.status||':'||s.cancel_at_end::text||':'||to_char(coalesce(s.period_end,'epoch'::timestamptz) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from public.subscriptions s join public.accounts a on a.id=s.account_id where a.deleted_at is null and s.plan<>'trial'
    )
    insert into public.deliveries(id,account_id,recipient,subject,body,dedupe_key)
      select gen_random_uuid(),account_id,recipient,subject,body,dedupe_key from notices
      on conflict(dedupe_key) do nothing;
    get diagnostics v_count=row_count;
    return v_count;
  end
  $function$;

  revoke all on function public.collect_platform_notices() from public;
  alter function public.collect_platform_notices() owner to lumiq_job_owner;
  if exists(select 1 from pg_roles where rolname='lumiq_restore_runtime') then
    grant execute on function public.collect_platform_notices() to lumiq_restore_runtime;
  end if;
end
$migration$;
