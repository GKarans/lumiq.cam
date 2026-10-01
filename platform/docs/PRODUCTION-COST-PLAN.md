# Production cost plan

## Current Production snapshot — 2026-10-01

This dated addendum supersedes the historical deployment/billing assumptions
below. The application is served by `lumiq-production` on `lumiq.cam`; do not
use the old candidate/closed-test estimates as the current architecture.

- Supabase organization currently has two ACTIVE projects: Production Nano and
  Production Recovery Micro. In paid organizations Nano bills at the Micro
  rate. Current published Pro price is USD 25/month and includes USD 10/month
  compute credits. At the published approximate USD 10/Micro rate for each of
  these two projects, the planning baseline is about USD 35/month before other
  metered usage, tax, or add-ons (25 + 10 + 10 - 10 credit). This is an
  estimate, not an invoice; the active invoice/cycle amount needs a fresh
  Dashboard check.
- Cloudflare dashboard snapshot: Workers Paid, R2 Paid, Images Stream Basic,
  Zero Trust Teams Free Base. Variable billable usage forecast was USD 0.00 in
  the checked period, but the latest visible paid invoice was USD 2.50. Do not
  describe the USD 0.00 usage forecast as a zero total bill. Check the next
  invoice and subscription line items in Cloudflare Billing.
- Resend dashboard snapshot: Free transactional, 16/3,000 monthly messages;
  Free marketing, 0/1,000 contacts; Team Free, 2/3 domains. No invoice/payment
  method; pay-as-you-go overage disabled. Published Free transactional limits
  are 3,000 per month and 100 per day. If a limit is reached, mail delivery
  must not be assumed to continue.
- No live payment processor has been selected/integrated. The checkout is a
  simulation. Stripe figures in the model below are scenario assumptions, not
  actual fees paid by Lumiq.
- Current reference scenario (`npm run cost -- 100 0.55 1.08 100 0 100 0 free-r2`):
  100 accounts, 20/60/20 plan mix, 55% event utilization, 1.08 MiB/photo pair,
  100 full-size and 100 thumbnail views/photo; 275 events, 203,500 photos,
  40.7M image requests, 284.9M modeled CPU-ms, 407,275 R2 writes and 40.9M
  R2 reads. Model: USD 16.46 R2, USD 19.40 Workers, USD 25 Supabase base,
  total USD 60.86 for the modeled monthly platform, plus EUR 73.23 payment
  fees under its Stripe-like assumption. The model omits the Recovery project's
  incremental compute and therefore understates the two-project Supabase
  planning baseline; it also uses no Resend cost and ignores tax, backup,
  support, refunds and actual invoice timing. Do not quote its margin as profit.
- The model currently fixes Supabase at USD 25 and payment fees at 1.5% + EUR
  0.25 per payment. These assumptions need code-level parameterization before
  the model can match the actual two-project baseline or a selected processor.

Primary current references: [Supabase pricing](https://supabase.com/pricing),
[Supabase compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute),
[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), and
[Resend transactional pricing](https://resend.com/pricing?product=transactional).

> **Vēsturisks izmaksu momentuzņēmums (2026-10-01).** Tālāk minētais “candidate”
> un pirms-maršrutēšanas lēmums vairs nav pašreizējā arhitektūra. `lumiq.cam`
> tiek apkalpots ar `lumiq-production`; šis dokuments nav atļauja mainīt dzīvos
> resursus vai atvērt publisku piekļuvi. Izmanto aktuālo statusu un atlikušās
> izmaksu pārbaudes [PRODUCTION-GOAL-LV.md](PRODUCTION-GOAL-LV.md).

## Historical owner decision — 2026-09-29

- Cloudflare Workers Paid at USD 5/month is approved for the isolated
  production candidate. The `lumiq.cam` domain and closed-test Worker remain
  separate; this approval is not permission to route production traffic or
  open public access.
- Supabase Pro is active for the organization, Spend Cap is enabled, and
  Restore Drill remains active. Billing showed USD 25 current and USD 34
  projected for Sep 29-Oct 29. Pro includes USD 10 monthly compute credits,
  but compute and explicit add-ons such as PITR are not covered by Spend Cap.
  Supabase currently bills Nano at the Micro rate in paid orgs (about USD
  10/month); the credit covers one project. An always-on Recovery project is
  therefore estimated to add about USD 10/month, taking the current projection
  to roughly USD 44 and a full-month total to about USD 45 before other usage.
  Review actual compute line items before creating it;
  no PITR, replica, log drain or larger compute add-on is approved.
- R2 overages, backups, email, payment processing, taxes and other account-wide
  usage are not included in the USD 5 approval. Cost alerts are not a hard cap;
  production limits still need measured, owner-approved values.
- The older decision history below records the state as of 2026-09-25. Where it
  conflicts with this dated update, this update is authoritative.

The following 2026-09-25 decision is historical and was superseded on
2026-09-29 by the current owner decision above. It is retained as decision
history only and does not override the current production-infrastructure goal.

## Current deployment facts

- `lumiq.cam` is currently attached to the closed-test Worker behind
  Cloudflare Access, not the former staging Worker. It uses the isolated
  closed-test Supabase project/Hyperdrive and `lumiq-closed-test-photos` bucket.
  The former `lumiq-cam` Worker, staging Hyperdrive, and both staging R2 buckets
  (default and EU) were deleted. The owner reports that the old staging
  Supabase project was also deleted; that part has not been independently
  verified. The closed-test R2 bucket remains, but its test objects were
  accidentally deleted; the owner confirmed they were disposable and no
  restore is needed. `app-images` was not touched.
- Production must use a fresh Supabase project and a separate private R2
  bucket. Staging data is not to be copied into production.
- The owner created a separate Supabase Free test project. The owner has since
  applied and verified migrations `001-platform` through
  `011-queue-job-dispatch` and `012-tier-photo-capacity`, RLS on all 17
  protected tables, denied
  anon/authenticated SELECT, and the
  restricted `lumiq_runtime` database role. No MVP migration was run. This
  closed-test project must not be described as production, and no staging
  records are to be copied into it.
- Supabase account access is not available in the local environment, and the
  Supabase CLI is not installed. Before provisioning production, the owner must
  create/authorize the production project and enter its database URL only in
  the hidden local migration prompt. Never put secret keys in chat or source
  control.
- The closed-test Hyperdrive/Worker and Access boundary are deployed. A
  synthetic photo upload, photographer-folder R2 layout, old synthetic-photo
  cleanup and one automatic ZIP were verified on 2026-09-25. This is closed
  test evidence only; use only synthetic events and disposable, consented
  images. Supabase Free may pause and has no automatic database backups.
- Worker uploads already pass through the Worker API (`uploadsViaApi: true`);
  browser clients do not receive direct R2 credentials or signed PUT targets.
- The Worker R2 adapter implements application-side operation and lifetime
  write-byte ceilings, with local tests for concurrent reservations, normal
  object paths and bounded streaming exports. R2 budget enforcement is enabled
  in the closed-test Worker, and a synthetic photo/thumbnail plus one automatic
  ZIP were successfully written there. The test does not prove aggregate
  account-level usage attribution or production load/overage behavior; retain
  synthetic-only uploads until those checks are complete.

## Lowest practical production candidate

| Service | Candidate | Price basis | Production caveat |
|---|---|---|---|
| PostgreSQL/Auth | One fresh Supabase Pro project, Micro compute | USD 25/month, about EUR 21.99 at the 2026-09-24 ECB reference rate, before tax/FX. The Pro plan includes USD 10 compute credits, enough for one Micro project. | Keep Micro and spend cap; compute and some add-ons are not covered by the cap. Check the actual organization invoice estimate before creating the project. |
| App/API/static assets | Cloudflare Workers Paid for the modeled high-usage Studio service | USD 5/month account minimum | Workers Paid includes 10M dynamic requests and 30M CPU-ms/month; excess is metered, with no bandwidth egress charge or overall bill hard cap. Hyperdrive has no separate Paid-plan fee. At 100 Studio accounts using all event/photo limits and 100 full-size plus 100 thumbnail views per photo, the model is about 240M image requests/month (about 8M/day), before uploads and other app requests. This is far above Workers Free's 100,000/day request limit. |
| Private photo objects | New private R2 Standard bucket | USD 0 only within 10 GB-month, 1 million Class A and 10 million Class B operations/month; egress is free. | Usage beyond free allocations is metered. An application-enforced aggregate storage/operation ceiling and account-level usage check are required before real guest uploads. |
| Transactional email | Defer custom sender decision; use no paid add-on initially | USD 0 candidate | Verify Supabase Auth delivery limits and recovery flow before inviting real organizers. |

For the candidate production service, the minimum fixed baseline is USD
30/month (Supabase Pro USD 25 plus Workers Paid USD 5; about EUR 26.39 at the
ECB reference rate in `BREAK-EVEN-PRICING.md`, before tax and payment conversion).
This is not a guarantee that the entire bill stays below EUR 60; the modeled
high-usage variable costs already exceed that baseline. R2 overages,
email, extra Supabase compute/projects, tax, FX fees, backups and existing
account-level subscriptions/usage are not included. Cloudflare budget alerts
are informational, not a billing hard stop. Supabase's spend cap excludes
compute and explicitly selected add-ons.

Cloudflare Queues include 1M operations/month on Workers Paid; the capacity
model's 9,600 monthly archive/job messages are about 28,800 normal operations
before retries, so Queue metering is estimated at USD 0 at that volume. Retries,
large messages and actual deployment usage still need measurement.

## Free-only alternative

Supabase Free costs USD 0, but is not the recommended service for real guest
photos: projects may pause after a week of inactivity, include no automatic DB
backups, and have a 500 MB database limit. It is suitable only for a closed,
disposable test where data loss and downtime are accepted, not the intended
production launch.

### Current decision and next step

The decisions below are historical and were superseded on 2026-09-29 when the
owner upgraded the Supabase organization to Pro and approved continuing without
pausing Restore Drill. The organization currently has Spend Cap enabled. This
keeps quota overages restricted, but does not cap compute, PITR, or other
explicitly provisioned add-ons. Billing showed `$25` current and `$34` projected
for Sep 29-Oct 29; inspect the compute line items before adding an always-on
Recovery project. Do not enable paid add-ons until their costs and benefit are
reviewed with the owner.

- [x] Historical: owner deferred paid production resources while Lumiq was a
      closed test. This is no longer the current plan.
- [x] Current scope remains closed and behind Access; this upgrade does not
      authorize public launch or collection of real guest photos.
- [x] Owner created a separate Supabase Free project for closed testing. The
      old staging resources have since been deleted; do not recreate them or
      copy their data.
- [x] Apply and verify the isolated platform schema on the new test project;
      verify all six expected migrations, RLS and denied anon/authenticated
      SELECT. The successful rerun may emit a harmless `platform_migrations
      already exists, skipping` notice.
- [x] Provision and verify the restricted test runtime DB role. Its password
      remains local to the owner and must only be configured as a server-side
      secret.
- [x] Create a separate private `lumiq-closed-test-photos` R2 bucket. Synthetic
      closed-test objects were uploaded and subsequently emptied by mistake;
      the owner confirmed they were disposable. Keep the bucket for future
      synthetic tests; no restoration is needed.
- [x] Create the separate closed-test Hyperdrive with caching disabled and
      origin connection limit 5; prepare the ignored test Worker config. A
      Wrangler dry-run resolved its Hyperdrive and R2 bindings.
- [x] Verify active Cloudflare Access for the exact test `workers.dev` host,
      set `PLATFORM_ORIGIN`, then deploy the separate test Worker. An anonymous
      `/healthz` request redirected to Access before Worker execution. Keep
      retired staging resources do not exist; do not recreate them or use them
      for rollback.
- [x] Attach `lumiq.cam` to the closed-test Worker behind Access. Tet's network
      security filter currently classifies the hostname as Malware; request
      provider review and do not bypass the warning or open public access until
      the classification and certificate warning are resolved.
- [ ] Configure the test environment using local secrets (never commit them),
      then verify Hyperdrive DB access, Auth, storage controls and core journeys.
- [ ] After company registration and the controlled `lumiq.cam` transition,
      return with current itemized estimates and obtain explicit approval
      before creating any paid production resource or subscription.

## Required cost gates

- [ ] Before creating Recovery, owner confirms the estimated additional USD
      10/month compute cost (roughly USD 44 projected for the current cycle,
      about USD 45 for a full month before other usage). Supabase Pro and
      Workers Paid are already approved.
- [ ] Keep Spend Cap enabled. Before any add-on not covered by it (compute
      upgrades, PITR, IPv4, log drains), state the recurring cost and obtain
      explicit owner approval.
- [ ] Measure current Cloudflare account R2 consumption. Set a production
      aggregate byte/object and operation budget below the available free
      allocation; fail new uploads closed before the cap.
- [ ] Verify the R2 application-side ceilings on the deployed closed-test
      Worker and compare them with live account-level R2 usage before enabling
      even test photo uploads. Local tests alone do not satisfy this gate.
- [ ] Verify every R2 write/read path, including cover replacement and export
      generation/download, is subject to the same meter and retries cannot
      bypass it.
- [ ] Set billing notifications, but do not treat notifications as a hard cap.
- [ ] Record the first month's actual database, Worker, R2, email and payment
      costs before raising product photo limits or inviting more customers.

## Pricing references

- [Supabase plans and included compute credits](https://supabase.com/pricing)
- [Supabase cost-control exclusions](https://supabase.com/docs/guides/platform/cost-control)
- [Cloudflare Workers pricing and Hyperdrive limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Workers Free request/CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare R2 pricing and free tier](https://developers.cloudflare.com/r2/pricing/)
- [ECB reference rates, 23 September 2026](https://www.ecb.europa.eu/stats/shared/pdf/eurofxref.pdf)
