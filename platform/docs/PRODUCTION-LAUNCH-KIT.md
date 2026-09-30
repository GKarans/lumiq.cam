# Lumiq Production Launch Kit

## Current status (2026-09-29)

The complete application is deployed to the private Production candidate at
`https://lumiq-production-candidate.gkarans-events.workers.dev`, Worker version
`37314545-a149-416a-837b-ea5efbb8f6b0`. Its release gate is approved for
Production use behind Cloudflare Access; anonymous requests to the candidate
are redirected to the Access login. The candidate uses the independent
Production Supabase, Hyperdrive, private photo bucket in the explicit EU
jurisdiction, Queue and DLQ. The owner-authenticated browser rendered the full
registration form.

The Production runtime and RLS verifier passed migrations 001-046, all 19
public tables under RLS, no direct table SELECT for browser roles, and the
least-privilege `lumiq_production_runtime` identity/RPC allow-list. On the
current source tree, `npm run check` passed 166 tests, security scan,
dependency audit, build, responsive/browser flows and accessibility checks.
This does not yet prove a real user signup, photo lifecycle, ZIP export, phone
compatibility, production backup restore or load limits.

`lumiq.cam` is still routed to the Closed Test Worker. This PC's default DNS
resolver sends the host to TET Tīkla Vairogs STOP (`81.198.92.113`); a
diagnostic request pinned to Cloudflare's edge returns the existing owner-only
Access HTTP 302. This is network DNS filtering, not a broken Lumiq route or
missing Access application. Allowlist `lumiq.cam` in Mans Tet/Tīkla Vairogs or
request a false-positive review. After Production signup/photo/ZIP smoke
checks, move the domain route to Production while preserving its Access
policy. Do not disable Access. Keep the dated provisioning evidence below as
history, not as the current state.

The three empty default-jurisdiction Production R2 duplicates were deleted
after the Worker was rebound to the matching EU photo bucket. The remaining
EU buckets are photos (0 objects), backups (18 objects) and recovery (0).
`app-images` was explicitly left untouched.

Live backups/restore, signup and full photo/gallery/ZIP/delete tests,
max-size/load checks, alert ownership and physical-phone sign-off remain open.
Checkout is simulated and this is not approval for a public or paid launch.

## Production provisioning evidence (2026-09-27)

- Supabase project `Lumiq Production` (`baqebydtinysosueksgr`) exists in
  `eu-central-1` (Frankfurt), Free plan, and reports `Healthy`. A fresh
  read-only SQL Editor query on 2026-09-27 confirmed the app migration ledger
  contains exactly 001-013; all 19 public tables have RLS enabled, with zero
  direct SELECT privileges for `anon` and `authenticated`. The `lumiq_runtime`
  login role exists, is not superuser/CREATEDB/CREATEROLE, and has
  `BYPASSRLS=true`. The Supabase dashboard's separate CLI migration tracker
  still says no migrations; the app ledger is authoritative for the schema.
  This project is distinct from closed-test (`cpweowosocjuccjsyyic`) and
  restore-drill (`sprzlvywzpeyuzbsyplz`). No production backup is configured
  or reported yet.
- Private EU R2 bucket `lumiq-production-photos` exists with Standard storage,
  public access disabled, and currently 0 B. It is separate from both
  closed-test and restore-drill buckets.
- A second private EU R2 bucket `lumiq-production-backups` now exists for
  backup isolation. It is Standard, has public access disabled and is empty;
  no schedule, retention rule or backup credential has been configured.
- Queue `lumiq-production-jobs` (`3a42c2ad64f44db1a4cf2644358eaf40`) and DLQ
  `lumiq-production-jobs-dlq` (`ef90891585d2471f8c567e7ba8e7b6cc`) exist and
  are both inactive with zero queued messages/operations. They are not yet
  bound to a Worker.
- Production Hyperdrive `lumiq-production`
  (`287181f11f734b63844bcda5eb7fe90c`) currently targets the production
  Frankfurt session pooler (`aws-0-eu-central-1.pooler.supabase.com:5432`),
  database `postgres`, as `lumiq_runtime.baqebydtinysosueksgr`; caching is
  disabled. The owner reports changing the password in Cloudflare, but a
  successful database connection has not been verified. Do not bind this
  connection until migrations 014-045, isolated Supabase security checks and a
  verified production backup/restore pass. Never reuse or edit the closed-test Hyperdrive
  (`6823aef81a314970bd3da962c2a62966`) or paused restore-drill Hyperdrive
  (`7dce888394a3484bafbbe58d3ac329b4`).
- Workers Paid is active on the Cloudflare account. The $5/month base plus
  usage-based overages was explicitly approved; monitor variable usage and set
  budget alerts before attaching production traffic.
- Supabase Pro is active with Spend Cap enabled. Pro daily backups are available;
  the separate production R2 backup was read back and checksum-verified on
  2026-09-29. Compute is excluded from Spend Cap, so monitor the invoice before
  creating additional always-on projects. Production stays behind owner-only
  Access until backup/restore, security, monitoring and release gates pass.
  Production stays behind an owner-only PIN/Access boundary until backup,
  restore, security, monitoring and release gates have evidence.

The fail-closed Wrangler template passed Wrangler `deploy --dry-run` on
2026-09-26: Wrangler bundled 61 static files and reported only the production
template's placeholder bindings. It remains `NOT_APPROVED` and deliberately has
no cron schedule, so preparing the template cannot start automatic retention
cleanup. This validates config shape/bundling only; it does not validate actual
resource IDs, secrets, production project identity, Access, network
connectivity or deployment.

On 2026-09-27 a separate read-only static preflight was run in memory with the
actual production Hyperdrive/R2/Queue/DLQ IDs and the verified remote
Hyperdrive metadata. It passed project/user identity and disabled-caching
checks, while keeping `NOT_APPROVED`. It used a placeholder publishable key;
no local config was written, no Access policy was verified, and no Worker was
deployed.

## Current evidence and open gates

- Closed-test `lumiq.cam` remains a separate environment and is not production.
  Supabase, private EU R2, Queue/DLQ and production Hyperdrive exist as recorded
  above. The production app schema and `lumiq_runtime` role now exist, but
  migrations 014 onward are local-only; production Worker deployment, bindings,
  route, Access policy and Auth configuration remain incomplete.
- Cloudflare inventory on 2026-09-26 now shows two distinct Hyperdrive configs.
  `lumiq-closed-test` remains connected to closed-test ref
  `cpweowosocjuccjsyyic`; the newly created `lumiq-restore-drill` config ID is
  `7dce888394a3484bafbbe58d3ac329b4` and its origin user/ref is
  `lumiq_runtime.sprzlvywzpeyuzbsyplz`, session pooler port 5432, database
  `postgres`, caching disabled. Never repoint or alter the closed-test config.
  Production Queue/DLQ were subsequently provisioned separately (see the
  current resource inventory above). The separate restore candidate Worker is deployed and
  Access-protected for the restore drill. The account has the restore-drill R2
  bucket and `lumiq-closed-test-photos`; `app-images` remains explicitly out
  of scope.
- Restore drill target: Supabase `sprzlvywzpeyuzbsyplz`; private R2
  `lumiq-restore-drill-20260925`. The restore tool verified the database
  inventory and three object keys, sizes and SHA-256 values.
- The ZIP was fetched from the restored R2 bucket using Wrangler's default
  jurisdiction lookup. Its 446,164 bytes and SHA-256 matched the backup
  manifest; extraction found two WebP files and two matching manifest rows.
- Read-only SQL verification passed in the isolated target: the initial restore
  had migrations `001-platform` through `012-tier-photo-capacity`; migration
  `013-runtime-account-column-grants` was subsequently applied only to this
  isolated project. A fresh SQL Editor check on 2026-09-26 returned exactly all
  13 manifest versions, no public table with RLS disabled, and no direct
  `SELECT` privilege for either `anon` or `authenticated`. `lumiq_runtime`
  flags and expected CRUD grants verified. Forward migration
  `013-runtime-account-column-grants` is locally tested and was applied on
  2026-09-26 only to isolated restore project `sprzlvywzpeyuzbsyplz`. A
  read-only privilege check confirmed account DELETE, role INSERT and role
  UPDATE are denied, while profile UPDATE remains allowed; the migration
  ledger contains the version once. It removes
  runtime INSERT/UPDATE on `accounts.role` and DELETE on `accounts`, while
  retaining the account columns used by application flows. The runtime role intentionally has
  `BYPASSRLS` in the current server-side direct-PostgreSQL architecture; the
  Worker enforces ownership in its SQL. This is not RLS-enforced least
  privilege and remains an explicit independent-review risk. The restored
  Auth dashboard lists the restored test accounts.
- Candidate verification history on 2026-09-26: versions
  `18799a67-9955-4ece-b3d9-3e10e7314092` and
  `cd060ed9-f3a0-472f-86e3-1739a73ce604` were temporarily approved as
  `staging`, still behind owner-only Access and bound only to restore
  Hyperdrive/R2, without cron or Queue. Owner authenticated and reached the
  restore workspace. One profile-save attempt on the distinct
  `lumiq-closed-test` hostname returned HTTP 400 and is not candidate evidence.
  In the later owner-approved candidate session, the owner reported the
  profile-save success message. This confirms the app accepted that save, but
  does not prove a changed email was confirmed or delivered; mailbox
  confirmation remains unverified. A fresh Wrangler deployment listing on
  2026-09-26 shows version `3e30cb80-97f0-4c33-8882-6ee87ca8ebfb` at 100%,
  following the temporary profile-test version `235849ea-f705-471c-95cb-58f45c9ab6bd`.
  At that checkpoint the release was locked, and Cloudflare Access remained
  the required owner-only boundary. Do not infer safety from the
  `NOT_APPROVED` release flag alone; preserve Access as well. The later
  lifecycle run and current locked deployment are recorded below.
- On 2026-09-26, the restore project's Auth URL Configuration was updated and
  re-read after reload: Site URL is
  `https://lumiq-restore-drill-candidate.gkarans-events.workers.dev`; exactly
  four redirects are allowed on that host: `/auth/verify`, `/auth/reset`,
  `/auth/email`, and `/api/auth/google/callback`. There is no wildcard. This
  change applies only to the isolated restore project, is not production
  configuration, and does not change `lumiq.cam`. Default Supabase email
  templates are active; custom SMTP and real mailbox delivery remain
  unverified.
- On 2026-09-26, the isolated restore candidate Worker
  `lumiq-restore-drill-candidate` was smoke-tested and then locked again in
  version `c27d5132-c08d-49c7-b662-258df2d0edd1`, bound only to restore Hyperdrive
  `7dce888394a3484bafbbe58d3ac329b4` and bucket
  `lumiq-restore-drill-20260925`. Cloudflare Access protects all traffic with
  only the owner email allowlisted. Anonymous `/healthz` returned 302 to
  Access. The owner confirmed Access login and the session-encryption Worker
  Secret appears encrypted in the dashboard. The candidate is now
  `PLATFORM_RELEASE_APPROVED=NOT_APPROVED`; an anonymous `/app` probe returned
  Access HTTP 302 after redeploy. No cron or Queue is configured. Keep this
  candidate isolated and Access-protected.
- Read-only R2 checks on 2026-09-26 report the restore bucket in EEUR/Standard,
  with 3 objects, `r2.dev` public access disabled, and no custom domains. An
  unsigned, one-byte-range request to a synthetic ZIP through the EU S3
  endpoint returned `InvalidArgument / Authorization` and no object bytes.
  This verifies the bucket's public boundary at test time; authenticated
  candidate reads for the photo and ZIP were later confirmed in the owner
  smoke test below.
- Follow-up read-only check on 2026-09-26 found inconsistent post-expiry R2
  inventory: the Cloudflare bucket `Objects` tab showed an empty list after
  refresh, while `wrangler r2 bucket info` reported `object_count: 3` and
  `bucket_size: 567 kB`; the dashboard's last-24-hours metric showed average
  storage of `566.54 kB`. Cloudflare documents that account-level R2 metrics
  may not immediately reflect the latest data, and the dashboard metric is a
  24-hour window. The verified backup manifest contains exactly three
  keys, all belonging to the expired event: its ZIP, one original and one
  thumbnail. A remote Wrangler GET for each exact key returned “The specified
  key does not exist”; no bytes were written locally. Thus all three restored
  event objects are confirmed absent and the live R2 object list is empty. The
  aggregate count/storage values are delayed-window indicators, not an
  immediate per-key existence check; they do not contradict those direct
  results. No objects were changed during these checks.
- The owner-provided screenshots confirm candidate homepage rendering after
  Access and, on 2026-09-26, successful entry to the organizer dashboard with
  two synthetic events and the Studio plan visible. The owner then opened the
  `Synthetic R2 Verification` gallery and the full-size synthetic apple photo,
  confirming one authenticated original-photo read. A subsequent screenshot
  shows the 107 KB WebP photo download completed. Unauthenticated shell requests
  to `/app` and `/healthz` returned Access redirects. The owner downloaded the
  446,164-byte event ZIP; archive inspection found two unique WebP photos and a
  manifest, while the gallery had one photo after the owner confirmed deleting
  one only after ZIP creation. Thus the event-end ZIP snapshot is unchanged by
  later gallery deletion. The owner also completed a sign-out and sign-in cycle
  successfully. In the second restored organizer account, the dashboard showed
  no events and the primary event URL returned “Event not found”, confirming
  cross-owner event isolation. Password-recovery email arrived in Gmail, the
  callback opened the candidate reset screen, the new password was saved and
  the owner returned to the dashboard. This verifies one default-template
  recovery delivery; custom SMTP and other email callbacks remain unverified.
  The owner screenshot also shows a red “Dangerous” browser badge on the
  candidate hostname; its provider and classification have not been identified.
  SQL
  migration, RLS and runtime-role checks are recorded above and in
  `LAUNCH-GATES.md`; `BYPASSRLS` remains an explicit independent-review risk.
  Candidate app/Auth smoke testing is complete. On 2026-09-26, the isolated
  retention drill first expired event `cc8d61dd-9b02-4c68-a4a3-0069f098bf6a`;
  its original cleanup removed three R2 objects but retained excessive event
  metadata. A second isolated candidate run on 2026-09-26 verified the updated
  minimization code on event `1e4008bd-c76f-4491-83f2-795bc645271e`. A missing
  `PLATFORM_R2_BUCKET` in the ignored local drill config caused the first
  targeted scheduler calls to fail closed (`prepared:false`); after adding the
  exact restore bucket name, a six-minute event window (start one minute
  before the update, end five minutes after it) ended naturally and
  scheduler logs reported `prepared:true`, export `ready`, one part. The
  resulting ZIP was 337,495 bytes (SHA-256
  `AF478CF366CB580B142302418F1168BB08CBA978AFE16B14FC892ED3784FCA57`);
  extraction found one WebP and one manifest row for the exact snapshotted media
  ID. After expiry, scheduler logged `expired:true`, cleanup `ready`,
  `removedMedia:1`; read-only SQL showed zero media/guest rows, terminal slug
  and storage prefix, empty description/appearance, only `{"retentionDays":1}`
  entitlement, and sharing disabled with counters cleared. Event name, start,
  end and retention timestamps remain. Remote GETs of the exact original,
  thumbnail and ZIP keys all returned missing. The candidate was then redeployed
  as locked version `18690778-8dff-4ad4-8c9c-2de0a7fb822c`: release
  `NOT_APPROVED`, no drill variables or cron, and anonymous `/app` returned
  Cloudflare Access HTTP 302. Access policy itself was not changed. Local tests
  cover injected cleanup failure/retry and cross-organizer object preservation;
  live failure injection remains unverified. Keep production cleanup disabled
  and retain the independent lifecycle/security review gates.
- A separate `cloudflare/worker/wrangler.restore-drill.template.jsonc` is now
  prepared for that future candidate: it names only Supabase project
  `sprzlvywzpeyuzbsyplz` and bucket `lumiq-restore-drill-20260925`, uses only
  its separate candidate `workers.dev` hostname (no custom route), has no
  Queue or cron trigger, and remains `PLATFORM_RELEASE_APPROVED=NOT_APPROVED`
  with a placeholder Hyperdrive ID. Requests return unavailable until someone
  deliberately approves staging; omitting cron prevents an accidental
  retention sweep of restored evidence. Structural isolation assertions and
  Wrangler `deploy --dry-run` passed on 2026-09-25. On 2026-09-26 the actual
  Hyperdrive ID was wired into the Git-ignored local copy
  `cloudflare/worker/wrangler.restore-drill.local.jsonc`; the owner supplied
  the restore project's publishable key and configured the Worker session
  Secret in Cloudflare. Access was enabled and verified before the candidate
  release gate was temporarily set to `staging`; never modify closed-test
  bindings.
- Automatic ZIP creation at event end and later gallery deletion preserving
  the immutable archive were exercised in closed test and in the restored
  candidate. The targeted live expiry and metadata-retention path also passed
  in the isolated restore stack. Automated tests cover injected storage
  failures, retries and cross-organizer preservation. Live R2 post-expiry
  inventory confirmed all three manifest keys absent and an empty object list;
  the remaining aggregate-metric delay is documented by Cloudflare. Live
  failure/retry injection is not separately evidenced. Do not enable
  production cleanup before the independent review and the remaining release
  gates pass.

## Readiness and owner decision register

**Launch-kit status: NOT READY FOR PRODUCTION.** The preparation artifacts are
in place, but this is not a launch approval. Production now uses the separately
provisioned `lumiq_production_runtime` with `NOBYPASSRLS`; migrations 001-046,
RLS coverage and its narrow grants/RPC allowlist were checked against Production
on 2026-09-29. The former `lumiq_runtime` role was left unchanged. Remaining
live user-flow, Access-policy, email-delivery, operations and owner/legal gates
still prevent a launch decision.

| Decision or gate | Status | Required before production |
|---|---|---|
| Restore evidence and candidate isolation | VERIFIED for the documented synthetic drill; candidate remains owner-only behind Access | Preserve the drill evidence and recheck bindings before any further candidate deploy |
| Runtime DB least privilege / `BYPASSRLS` | VERIFIED for current Production runtime: `lumiq_production_runtime` is `LOGIN/NOINHERIT/NOBYPASSRLS`; Production migration chain 001-046 and least-privilege verifier passed 2026-09-29. The former `lumiq_runtime` remains unchanged. | Re-run the read-only verifier after future role, migration or Hyperdrive changes; test app workflows under the active runtime |
| Company/operator identity, support contact, privacy notice and terms | WAITING: company/legal details are not approved | Complete after company registration and qualified legal review |
| Data region, subprocessors, retention and deletion/backup interaction | WAITING: proposed, not approved | Owner/legal decision with customer-market and residency requirements |
| Backup cadence, encrypted destination, retention, RPO/RTO and restore operator | PROPOSED, NOT APPROVED OR IMPLEMENTED | Approve policy, then configure, alert and measure a real restore |
| Production resource costs and capacity | PARTIAL: Workers Paid is approved and active; the EU photo/backup buckets and production Queue/DLQ exist but are unbound and empty | Review actual usage, set account/resource budget alerts and approve capacity limits before traffic |
| Prices, taxes and payment launch mode | WAITING: no live pricing/tax approval | Approve commercial and tax treatment; keep Stripe disabled until then |
| Restore-drill resource deletion | WAITING: evidence is preserved; nothing was deleted | Make a separate owner decision; do not delete as part of production preparation |
| Candidate browser `Dangerous` warning | OPEN: source/classification not identified | Identify and clear through the relevant security/browser provider; do not assume false positive |

Until the open items are resolved, keep `lumiq.cam` closed/Access-protected,
keep the production template locked, and do not enable public registration,
real guest uploads, or automatic production cleanup.

## Provisioned resources and remaining plan

| Resource | Required isolation | Candidate naming/location |
|---|---|---|
| Supabase PostgreSQL + Auth | `Lumiq Production` (`baqebydtinysosueksgr`) is active in Frankfurt on Pro; migrations 001-046 and a fresh R2 backup were verified 2026-09-29 | Keep migrations and backup verification current; remaining end-to-end application tests are separate gates |
| Runtime DB role | Production uses `lumiq_production_runtime` with `LOGIN/NOINHERIT/NOBYPASSRLS`; verifier confirmed no admin attributes, 19 RLS tables, no anonymous/authenticated direct SELECT and the explicit RPC allowlist | Re-run verifier after changes; test real application workflows with the active role |
| Cloudflare Hyperdrive | Live config `287181f11f734b63844bcda5eb7fe90c` uses `lumiq_production_runtime.baqebydtinysosueksgr`, Frankfurt session pooler, port 5432, database `postgres`, caching disabled | `lumiq-production`; preserve the DPAPI-managed runtime credential and pass candidate preflight |
| R2 photos / backups | Separate private EU-jurisdiction buckets exist and are empty; no backup cadence/restore drill yet | `lumiq-production-photos`; `lumiq-production-backups` |
| Queues | Production Queue and DLQ exist with zero producers/consumers; currently unbound | `lumiq-production-jobs` and `lumiq-production-jobs-dlq` |
| Worker | Not yet deployed; when created, use distinct `workers.dev` origin and owner-only Access, no custom domain until cutover | `lumiq-production-candidate` |
| Email | Verified sender/domain and deliverability checks | Provider and sender remain owner decisions |

## Production recovery project capacity check (updated 2026-09-29)

The organization is now on Supabase Pro with Spend Cap enabled. `Lumiq Production`
(`baqebydtinysosueksgr`) and `Lumiq Restore Drill 2026-09-25`
(`sprzlvywzpeyuzbsyplz`) are active; `Lumiq.cam - test`
(`cpweowosocjuccjsyyic`) is paused. The separate Recovery project does not yet
exist. Billing shows `$25` current and `$34` projected for Sep 29-Oct 29; the
Spend Cap does not cover compute. Obtain the invoice's compute breakdown and
owner approval for the additional project's ongoing compute before creating it.
Do not pause, delete, or repurpose Restore Drill. Production migrations and
candidate Worker attachment remain gated until a separate Recovery restore is
verified.

The region choices above are proposals, not approved legal or commercial
decisions. Record account, project, bucket, queue and Hyperdrive IDs only in a
restricted operations record; never place credentials there.

## Auth URL matrix

Configure only after creating the production Supabase project and validating
the candidate origin and routes against code. At cutover:

- Site URL: `https://lumiq.cam`
- Allowed redirects: `https://lumiq.cam/auth/verify`,
  `https://lumiq.cam/auth/reset`, `https://lumiq.cam/auth/email`, and
  `https://lumiq.cam/api/auth/google/callback`.
- Google OAuth provider callback URI in Google Cloud Console:
  `https://<production-project-ref>.supabase.co/auth/v1/callback`.
- Do not use wildcard redirects. Before cutover, use the isolated candidate
  origin and exact same route suffixes; do not send auth links to the root
  domain while it still serves the closed-test Worker.
- Verify registration/confirmation, login, logout, session refresh, password
  reset, email change, expired/reused links and Google sign-in if enabled.
- Supabase Auth SMTP/email templates and app transactional email sender are
  separate configuration surfaces. Test both; keep production credentials out
  of browser config and source control.
- Lumiq-branded Supabase Auth templates are saved in the Production Auth
  dashboard. Worker transactional notices render branded HTML plus plain text.
  Verify actual delivery and rendering in Gmail and a second mail client before
  declaring email QA complete. The candidate Worker currently has
  `PLATFORM_EMAIL_REPLY_TO=support@lumiq.cam`; verify a real message header too.
  Supabase Auth SMTP has no documented Reply-To setting. Its Send Email Hook
  replaces SMTP, so keep the Production hook disabled until every auth action,
  security notification, delivery failure, and rollback path has been verified
  in isolation.
- In the production project's Supabase **Authentication → URL Configuration**,
  set the Site URL to `https://lumiq.cam`; add only the four exact redirect URLs
  in the matrix, with no wildcard. Before cutover, use only the candidate's
  exact `workers.dev` host with those same route suffixes.
- In **Authentication → Emails**, review and test confirmation, password
  recovery, and email-change templates with test mailboxes. Confirm each link
  returns to its allowed route and that expired/reused links fail safely.
  Verify deliverability and sender identity separately from the templates.

## Worker configuration and secrets inventory

The non-deployable starting template is
`cloudflare/worker/wrangler.production.template.json`. It contains fake IDs,
an invalid origin placeholder, 1-byte/1-operation R2 caps and
`PLATFORM_RELEASE_APPROVED=NOT_APPROVED`; it is not a working deployment
config. Make an owner-controlled copy only after provisioning. Replace every
placeholder, approve real caps, run preflight and inspect every binding; never
change the release approval pair until all gates pass. Do not copy the
closed-test config and deploy it unchanged. Required invariants:

- Unique production candidate name; `workers_dev: true`,
  `preview_urls: false`, no routes/custom domain before cutover.
- Explicit `PLATFORM_MODE=production` and
  `PLATFORM_RELEASE_APPROVED=production` only after gates pass.
- `PLATFORM_ORIGIN` is the candidate's exact HTTPS `workers.dev` origin during
  testing; `PLATFORM_SUPABASE_URL` and
  `PLATFORM_SUPABASE_PROJECT_REF` identify the same production project.
- Bind only the new production Hyperdrive (`HYPERDRIVE`), private R2 bucket
  (`R2_PHOTOS`) and production Queue/DLQ. Do not bind closed-test resources.
- Enable `R2_BUDGET_ENABLED=true`; set reviewed positive caps for Class A/B
  operations, lifetime write bytes and one streaming write. Do not blindly
  inherit the closed-test budget values.
- Turn on observability, low-concurrency Queue processing, bounded retries,
  and a distinct DLQ. The starter template has no cron trigger. Add an approved
  production cleanup schedule only after the isolated expiry, object-inventory,
  failure/retry and isolation gates pass; never copy a drill schedule.

Configure these values as Cloudflare Worker secrets, not Wrangler `vars`:

- Required: `PLATFORM_SESSION_ENCRYPTION_KEY` (32 random bytes encoded as 64
  hex characters).
- Optional integrations, only when enabled: `PLATFORM_ALERT_WEBHOOK`,
  `PLATFORM_EMAIL_KEY`, `PLATFORM_STRIPE_SECRET`,
  `PLATFORM_STRIPE_WEBHOOK_SECRET`.
- Stripe price IDs, if payments are approved, are non-secret configuration;
  use only live product/price IDs in production and separately verify webhook
  signing.
- `PLATFORM_SUPABASE_PUBLISHABLE_KEY` is a public project key, but must still
  match the production Auth project. Supabase service-role keys are not needed
  by this app and must not be added.
- R2 application access uses the Worker bucket binding; do not inject S3
  access-key credentials into the Worker.
- `PLATFORM_DATABASE_URL` is for controlled local admin/migration tools only;
  the deployed Worker uses Hyperdrive and must not receive the admin URL.

| Name | Purpose | Where configured | Rotation procedure |
|---|---|---|---|
| `PLATFORM_SESSION_ENCRYPTION_KEY` | AES-256-GCM key for encrypted Supabase provider sessions and OAuth PKCE state | Candidate Worker's encrypted secret store | Generate a random 32-byte key locally; schedule a controlled rotation, update the secret and redeploy, verify OAuth/login, and expect existing encrypted sessions to be invalidated and users to sign in again. The current code has no dual-key migration. |
| `PLATFORM_EMAIL_KEY` | Transactional email provider API credential | Candidate Worker's encrypted secret store | Create a replacement at the provider, update the Worker secret, send and verify a test email, then revoke the old key. |
| `PLATFORM_ALERT_WEBHOOK` | Operations alert destination/credential | Candidate Worker's encrypted secret store | Rotate the receiving endpoint credential, update the Worker secret, trigger a controlled test alert, then revoke the old credential. |
| `PLATFORM_STRIPE_SECRET` | Stripe API access, only if payments are approved | Candidate Worker's encrypted secret store | Rotate at Stripe, update the Worker secret, verify mode and one controlled API operation, then revoke the old key using Stripe's current rotation workflow. |
| `PLATFORM_STRIPE_WEBHOOK_SECRET` | Verify signed Stripe webhook requests | Candidate Worker's encrypted secret store | Rotate the endpoint signing secret, update the Worker secret, deliver a signed test event, and retire the prior secret only after verification succeeds. |
| `PLATFORM_SUPABASE_PUBLISHABLE_KEY` | Public Supabase Auth API key; must match production project | Wrangler `vars`, not a secret | Issue/rotate in the production Supabase project, update the candidate variable, deploy and smoke-test Auth, then revoke the prior key only after clients use the new one. Never substitute a service-role key. |
| Runtime DB password | Hyperdrive origin authentication for `lumiq_runtime` | Dedicated Hyperdrive connection string; never a Worker variable | Provision a new runtime password and Hyperdrive config; test health and app flows against it; switch the candidate binding, then revoke the prior DB credential/config. Never print the URL in shell history or logs. |
| R2 backup access keys | Backup/restore automation only; not used by the application Worker | Masked local prompts or approved secret manager | Create a replacement bucket-scoped token, verify a read/backup or isolated restore, update the secret manager, then revoke the old token. Never embed S3 credentials in the Worker. |

`PLATFORM_EMAIL_FROM` and Stripe price IDs are configuration, not secrets.
Keep them in Wrangler vars only after sender/domain and payment decisions are
approved. Session-key rotation invalidates encrypted provider sessions; do
not promise a zero-logout rotation.

## Migration and backup/recovery procedure

Current owner-run commands for each approved backup/restore window:

```powershell
.\platform\scripts\backup-local.ps1
npm run backup:verify -- "$env:LOCALAPPDATA\Lumiq\backups\<backup-folder>"
```

Use the backup helper's masked prompts; do not put credentials on the command
line. The existing `restore-local.ps1` is deliberately pinned to the named
restore-drill project and bucket; it is not a production restore command.
Before production, prepare and review a separately pinned empty recovery
target procedure rather than weakening the drill helper's target checks.

1. Create an empty project and verify the exact project reference before
   entering credentials into an approved local prompt.
2. Keep the server runtime role separate from the admin-only migration
   connection. The selected target is RLS/RPC with `lumiq_runtime`
   `NOBYPASSRLS`; never use the runtime role for schema migrations or run an
   unreviewed SQL Editor snippet.
3. Take a fresh DB/Auth + R2 backup, verify its manifest/checksums, and prove
   restoration into a separate empty drill project/bucket before production
   schema changes.
4. Production already has versions 001-013. Apply only the reviewed forward
   migrations `014-organizer-jwt-read-policies` through
   `045-runtime-table-access-hardening` from
   `platform/server/migration-manifest.mjs`, using the restricted admin
   connection after the isolated restore/security drill passes. Never replay
   the MVP schema against the live project. Verify the complete migration
   ledger, RLS, runtime `NOBYPASSRLS`, exact RPC EXECUTE allow-list, absence of
   broad table/sequence grants, and anon/authenticated denial afterward.
5. Set the actual backup cadence, encrypted destination, retention, restore
   operator, RPO and RTO only after the owner approves them. Record a proposed
   policy and actual measured restore time; do not claim a policy is active
   before automation and alerting are configured.

Proposed starting policy for review: daily DB/Auth and R2 backup, plus a
verified backup before every production migration/release; retain seven daily
and four weekly restore points in an encrypted, access-restricted location
separate from the live account where practical. Initial objectives to review:
RPO no worse than 24 hours and RTO within 8 hours. This is not yet approved or
implemented. Because archives include personal photo data, legal/privacy review
must explicitly decide how backup retention interacts with event photo
deletion requests and the advertised gallery retention period; do not silently
retain expired guest photos in backups beyond a disclosed and approved window.

## Observability, capacity, and release evidence

- Verify live Worker request/error logs, scheduled cleanup/ZIP job outcomes,
  DB/Hyperdrive usage and quota, R2 usage caps, Queue backlog/retries/DLQ,
  Auth/email delivery and alert-webhook receipt.
- Run realistic isolated load tests for uploads, image reads, event-end ZIPs,
  concurrent organizers and Queue dispatch. Capture CPU time, request/query
  volume, R2 operations/bytes, latency, failures and recovery. Local tests are
  not a Cloudflare capacity measurement.
- Run an independent security review covering cross-account access/IDOR,
  Auth recovery/session handling, RLS/runtime-role grants, guest link revoke,
  private R2 reads, malformed images, quotas, XSS/CSRF and admin operations.
- Test on physical iPhone Safari and Android Chrome, including poor network,
  camera/file chooser, retry behavior and safe-area layout.
- Keep operator/legal details, privacy/terms, retention, support, prices,
  payment/tax treatment and subprocessors as explicit owner/legal decisions.

## Preflight, cutover, and rollback

Before cutover, build and run the candidate-only gates:

```powershell
npm run production:preflight -- <production-config.jsonc> --closed-test-hyperdrive-id=<current-test-id> [--runtime-role=lumiq_runtime|lumiq_production_runtime]
npx wrangler deploy --dry-run --config <production-config.jsonc>
```

Independently verify each remote binding and the Cloudflare Access allowlist.
These checks do not deploy or prove secret values, resource existence, TLS,
Auth delivery, retention behavior or capacity.

Cut over only in an approved window after every required gate has dated
evidence. Pause writes, take a final verified production backup, detach
`lumiq.cam` from the closed-test Worker, attach it to the tested production
candidate, set exact production Auth URLs, verify TLS/health/login and run a
synthetic end-to-end smoke test. Keep registration closed until results and
alerts are reviewed. Do not split traffic between test and production data.

Rollback before customer writes: contain with Access/maintenance and fix
forward; the closed-test Worker is only a closed-test fallback with Access and
its own bindings. After customer writes, roll back only to a known-good Worker
version bound to the same production DB/R2 and compatible schema. A Worker
rollback never rewinds database or object data.

## SQL Editor restore audit (read-only)

Run only in the isolated restore project. The first query should return no
rows; it detects missing or unexpected migration versions:

```sql
with expected(version) as (values
 ('001-platform'), ('002-delivery-leases'), ('003-publication-allowances'),
 ('004-account-profile'), ('005-gallery-curation'), ('006-r2-usage-guard'),
 ('007-jsonb-parameter-encoding'), ('008-organized-r2-keys'),
 ('009-organizer-design-defaults'), ('010-event-isolated-designs'),
 ('011-queue-job-dispatch'), ('012-tier-photo-capacity'),
 ('013-runtime-account-column-grants')
), actual(version) as (
 select version from public.platform_migrations
)
select 'missing' as issue, version from expected
except select 'missing', version from actual
union all
select 'unexpected', version from actual
except select 'unexpected', version from expected
order by issue, version;
```

Then verify all 17 protected public tables exist, have RLS enabled, and deny
direct SELECT to both browser roles:

```sql
with protected(name) as (values
 ('accounts'), ('sessions'), ('auth_tokens'), ('subscriptions'), ('events'),
 ('guests'), ('media'), ('jobs'), ('orders'), ('payment_events'),
 ('deliveries'), ('support_cases'), ('audit'), ('metrics'),
 ('request_limits'), ('r2_usage_guard'), ('platform_migrations')
)
select p.name,
       c.relrowsecurity as rls_enabled,
       coalesce(has_table_privilege('anon', c.oid, 'SELECT'), false) as anon_can_select,
       coalesce(has_table_privilege('authenticated', c.oid, 'SELECT'), false) as authenticated_can_select
from protected p
left join pg_class c on c.relname = p.name
  and c.relnamespace = 'public'::regnamespace
left join pg_namespace n on n.oid = c.relnamespace
where c.oid is null or n.oid is null
   or not c.relrowsecurity
   or has_table_privilege('anon', c.oid, 'SELECT')
   or has_table_privilege('authenticated', c.oid, 'SELECT')
order by p.name;
```

The second query should also return no rows. Separately inspect role flags and
effective `lumiq_runtime` DML access; do not paste role password or connection
URL into query history. A SQL result is necessary but not sufficient: the
application smoke tests must still pass against the same isolated target.

Check that the application role can log in, is not a superuser or database/role
administrator, and cannot promote accounts or delete them:

```sql
select r.rolname, r.rolcanlogin, r.rolinherit, r.rolbypassrls,
       r.rolcreatedb, r.rolcreaterole, r.rolsuper,
       has_table_privilege(r.rolname, 'public.accounts', 'SELECT') as can_read_accounts,
       has_table_privilege(r.rolname, 'public.accounts', 'DELETE') as can_delete_accounts,
       has_column_privilege(r.rolname, 'public.accounts', 'role', 'INSERT') as can_insert_role,
       has_column_privilege(r.rolname, 'public.accounts', 'role', 'UPDATE') as can_update_role,
       has_column_privilege(r.rolname, 'public.accounts', 'profile', 'UPDATE') as can_update_profile
from pg_roles r
where r.rolname = 'lumiq_runtime';
```

Expected after migration 045: one row; login and `NOINHERIT` true;
`BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `SUPERUSER`, direct account SELECT/DELETE,
and account role/profile INSERT/UPDATE all false. Runtime can read only the
migration version ledger under its RLS policy and execute the explicitly
granted internal RPC allow-list. Verify application workflows through their
JWT/capability RPCs using real non-bypass roles; do not restore broad table DML
grants to make a failing workflow pass.
