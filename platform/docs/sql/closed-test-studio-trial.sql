-- Closed-test-only, owner-approved Studio test entitlement.
-- Before running, confirm the Supabase project ref is cpweowosocjuccjsyyic.
-- This preserves the current trial period and never creates a provider charge.
-- Existing published events retain their saved entitlement snapshots.
begin;

do $$
declare
  updated_rows integer;
begin
  update public.subscriptions as s
     set plan = 'studio', updated_at = now()
   where s.account_id = (
           select e.owner_id
             from public.events as e
             join public.event_publications as p on p.event_id = e.id
            where e.id = 'cc8d61dd-9b02-4c68-a4a3-0069f098bf6a'::uuid
         )
     and s.plan = 'gathering'
     and s.status = 'trialing'
     and s.provider_id is null
     and s.provider_customer is null
     and s.period_end > now();

  get diagnostics updated_rows = row_count;
  if updated_rows <> 1 then
    raise exception 'Expected exactly one active, unpaid Gathering test subscription for the approved event; changed % rows.', updated_rows;
  end if;
end $$;

select s.plan, s.status, s.period_start, s.period_end,
       s.provider_id, s.provider_customer
  from public.subscriptions as s
 where s.account_id = (
         select e.owner_id
           from public.events as e
           join public.event_publications as p on p.event_id = e.id
          where e.id = 'cc8d61dd-9b02-4c68-a4a3-0069f098bf6a'::uuid
       );

commit;
