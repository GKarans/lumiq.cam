# Bezmaksas slēgtais tests

> **Vēsturiska vide; nav aktuālais `lumiq.cam` produkts (2026-10-01).** Saknes
> domēns tagad ir piesaistīts `lumiq-production`; `lumiq-closed-test` ir
> atsevišķa izolēta testa vide. Neizpildīt tālāk esošos soļus, kas iesaka
> mainīt `lumiq.cam` maršrutu. Aktuālais Production stāvoklis un darbi ir
> [PRODUCTION-GOAL-LV.md](PRODUCTION-GOAL-LV.md).

Updated: 2026-09-25. Current scope approved by the owner: $0 closed test only.
This is not production approval. Do not start paid plans, invite public users,
accept payments, or collect real guest photos.

## Current runtime status

- `lumiq.cam` and `lumiq-closed-test.gkarans-events.workers.dev` are served by
  the separate `lumiq-closed-test` Worker. Cloudflare Access protects both and
  its owner policy allows only `guntars.karans@gmail.com`. Cloudflare One now
  has both the Cloudflare login method and One-time PIN enabled; real OTP email
  delivery and a fresh login have not yet been verified.
- The closed-test Worker uses only project `cpweowosocjuccjsyyic`, Hyperdrive
  `6823aef81a314970bd3da962c2a62966`, and private bucket
  `lumiq-closed-test-photos`. Do not migrate, reset, or replace those resources.
- The owner reports that the closed-test bucket contained only disposable test
  images and emptied it accidentally. Direct remote R2 listing now confirms
  `0` objects; the Dashboard and Wrangler bucket-size/object-count summaries
  still show stale nonzero values. The bucket and closed-test database remain.
- The legacy `lumiq-cam` Worker, staging Hyperdrive `lumiq-supabase`, and both
  `lumiq-staging-photos` buckets (default and EU jurisdictions) were deleted
  on 2026-09-25. The owner reports that the Supabase staging project was also
  deleted; that deletion was not independently verified from Supabase.
  `app-images` was not touched and remains unrelated legacy storage.
- The old provisioning instructions below are historical. Do not follow steps
  that say to keep staging attached to `lumiq.cam`, deploy only to workers.dev,
  or create the already-existing closed-test resources again.

## Isolation boundaries

- Keep the closed-test Worker, Supabase project, Hyperdrive, empty R2 bucket and
  Cloudflare Access policy isolated. The production service does not exist yet.
- Both the custom domain and workers.dev hostname are Access protected. Keep
  Access enabled and keep preview URLs off. The old base Wrangler config is
  removed; use only the ignored closed-test config on the owner's machine.
- Do not create Render services, paid Supabase plans, Stripe resources, custom
  email, or any other paid add-on.
- Use only synthetic event names, test accounts and disposable images with
  consent. Supabase Free may pause and does not include automatic DB backups.

## Cost guardrails

“Free plan” does not mean an unconditional $0 bill. R2 usage above its free
allocation is metered, and account-level budget alerts are not hard caps. Keep
the test tiny and verify the Cloudflare account's current R2 usage before and
after it. Do not enable uploads until an application-side aggregate byte and
operation ceiling has been implemented and tested against retries and all
upload/read/export routes. If those limits cannot be proven, test auth and UI
without uploading to cloud storage.

Cloudflare Workers Free has hard daily request/CPU limits; exceeding them may
make the test unavailable. Supabase Free has database/storage quotas and
availability limitations. Review the current provider dashboards before
creating resources. Never upgrade a plan just to get past a quota prompt.
Hyperdrive is included on Workers Free for up to 100,000 database queries per
day; over-limit queries fail until the daily reset. Keep the test within that
limit.

## Provisioning sequence

1. Owner creates a new Supabase Free project in their authenticated account.
   Record its project reference privately. Do not send database passwords or
   keys in chat.
2. From a local PowerShell terminal at the repository root, run the checked-in
   forward migrations against only this new project's SSL database URL. This
   Windows/Node workstation could not resolve the new project's IPv6-only
   Direct host, so use Supabase **Connect → Session pooler** on port 5432.
   Copy the full Session pooler URI (username `postgres.<project-ref>`). Do not
   use Transaction pooler on port 6543. The script displays the project
   reference parsed from the URI, rejects any project other than the pinned
   closed-test project, and requires you to type only that reference at the
   confirmation prompt. Do not include `postgres.` or the pooler host.
   A blank or incomplete connection URI is rejected before any database access.
   Enter the connection URL only into the hidden terminal prompt below, never
   into chat, a file, or a screenshot:

   ```powershell
   .\platform\scripts\migrate-new-test.ps1
   ```

   The initial foundation run verified `001-platform` through
   `006-r2-usage-guard`; later forward migrations are tracked under Current
   status below. The output confirmed no MVP migration ran. The script clears
   temporary environment variables even if migration fails.
   Do not run MVP-specific SQL.
3. Create the restricted application DB login after migrations:

   ```powershell
   .\platform\scripts\provision-test-db-role.ps1
   ```

   Enter the same project's `postgres` admin URL in the hidden prompt and
   confirm the displayed project reference. At the second hidden prompt enter a
   random, URL-safe password of at least 32 characters from your password
   manager; keep it there for Hyperdrive configuration. The script creates
   `lumiq_runtime` with `BYPASSRLS` because the platform tables have RLS enabled
   without client policies. It grants only CRUD on public tables and future
   tables created by `postgres`; the login cannot create databases, roles,
   schemas or own tables. Keep its credential server-side only.
4. A separate Hyperdrive named `lumiq-closed-test` now exists. The authenticated
   Wrangler listing verified the test project's Session pooler host on port
   5432, database `postgres`, user `lumiq_runtime.<project-ref>`, caching
   disabled, and origin connection limit 5. Its ID is kept only in the ignored
   local Worker config. An owner-authenticated `/healthz` request later
   returned `database: ready`, confirming a query through the test Hyperdrive.
   The old staging Hyperdrive has been deleted; do not recreate it. The
   separate `lumiq-closed-test-photos` bucket is retained for synthetic tests;
   its disposable objects were deleted, as recorded above. Keep it private and
   do not enable `r2.dev`.
5. The owner's Cloudflare account shows the `gkarans-events.workers.dev`
   subdomain. The git-ignored `cloudflare/worker/wrangler.closed-test.jsonc`
   now uses `https://lumiq-closed-test.gkarans-events.workers.dev` as
   `PLATFORM_ORIGIN`, with the test Hyperdrive ID and test bucket. Keep
   `workers_dev: true`, `preview_urls:
   false`, no `routes`, the unique Worker name, and staging mode/approval pair.
   It must bind only the test Hyperdrive and test bucket. Never inherit or copy
   the public domain, staging IDs, or bucket. Wrangler dry-run resolved the
   bindings and read all 65 built assets without deploying.
6. The owner created the Cloudflare Access self-hosted application
   `Lumiq Closed Test` for `lumiq-closed-test.gkarans-events.workers.dev`,
   with the `Lumiq closed test - owner` allow policy. After deployment, an
   anonymous `GET /` and `GET /healthz` returned HTTP 302; `/healthz` included
   a `Www-Authenticate: Cloudflare-Access` header and redirected to the
   account's Access login on 2026-09-23. This verifies the website entry and
   health route are gated before the Worker runs. The owner then opened
   `/healthz` through Access and received
   `{"status":"ok","service":"lumiq-cam","database":"ready","storage":"bound"}`.
   After version `636cb1e2-2e0e-49d3-914e-47f335f0239f` was deployed, the owner
   rechecked `/healthz` through Access and confirmed `database: ready` and
   `storage: bound`. This verifies Worker startup/migration checks and a query
   through the test Hyperdrive; it does not prove isolation from future
   production resources. Keep
   only the owner and explicitly invited tester emails in the allow policy.
   Cloudflare's Access Free plan covers up to 50 users; do not upgrade if the
   dashboard offers a paid plan.
7. Add the new project's Supabase URL and publishable key and a newly generated
   session encryption key as Worker secrets for the closed-test Worker only.
   Keep all secrets out of the repository and chat. The session encryption
   key, Supabase URL and publishable key are configured. Set the non-secret
   `PLATFORM_SUPABASE_PROJECT_REF` in the ignored closed-test Wrangler config;
   verify that it matches the Supabase URL and the origin username reported by
   `npx wrangler hyperdrive get <test-hyperdrive-id>`. Hyperdrive's runtime
   connection string can contain generated credentials, so do not infer the
   origin project from its runtime username. The owner verified
   authenticated health and database readiness on 2026-09-23; the endpoint
   returned `status: ok`, `database: ready`, and `storage: bound`.
8. Build and deploy only with the separate test config, for example:

   For the current source, do not run the deployment until
   `migrate-new-test.ps1` reports all 12 migrations verified. Queue bindings
   are intentionally absent for this first deployment; scheduled database
   polling remains enabled. Then run the local checks and inspect the dry-run
   bindings before the command below. The base `npm run cloudflare:deploy`
   alias is intentionally blocked because it targets `lumiq.cam`.

   ```powershell
   npm run check
   npx wrangler deploy --dry-run --config cloudflare/worker/wrangler.closed-test.jsonc
   npx wrangler deploy --config cloudflare/worker/wrangler.closed-test.jsonc
   ```

   The separate Worker was deployed on 2026-09-23. Wrangler's first version
   `63aed221-8446-448a-bb40-46ddb503d10f` bound only the test Hyperdrive, test
   R2 bucket and static assets. The session-secret update created version
   `3a9efb3f-2bba-49b1-a24c-0dd1e7c3d717`. The session-key and Supabase-URL
   secret updates created versions `762163c4-d8c6-436f-bd07-d9c4bc7fc569`,
   `a51b9cf7-5f7a-4d46-b115-beef2518e8cc` and
   `6d2820c4-619e-46a6-8aee-49f3dab6139c`. After local full checks and a
   closed-test-only dry run, version `636cb1e2-2e0e-49d3-914e-47f335f0239f`
   was deployed at 20:30 UTC on 2026-09-23 and is at 100%. The deployment
   bindings showed only the test Hyperdrive and R2 bucket, with the R2 budget
   guard enabled. Anonymous `/` and `/healthz` still return Access 302 after
   deployment. The owner rechecked authenticated `/healthz` on this version
   and confirmed the draft event `Balle` remained available after returning to
   the app. A code audit confirmed the Worker passes configured
   `PLATFORM_ORIGIN` into Supabase Auth and the closed-test config uses only the
   test `workers.dev` origin. The local Supabase adapter regression suite passed
   14/14 tests on 2026-09-23, including signup, password-reset and OAuth redirect
   construction from the supplied origin. Supabase's actual redirect allowlist,
   email templates, live recovery/OAuth flows and production-isolation tests remain
   unverified.
9. Initially test registration, login, event creation, guest page and QR with
   no cloud photos. The Worker R2 adapter now has an app-side monthly operation
   ceiling and lifetime write-byte ceiling, including Class A object deletion;
   local tests cover concurrent reservations, normal photo/object paths and
   bounded streaming exports. The focused Worker R2 adapter suite passed 5/5
   tests on 2026-09-23. This is local adapter evidence only, not a live R2
   upload/read/delete integration check. This guard is now deployed in version
   `636cb1e2-2e0e-49d3-914e-47f335f0239f`. The owner has rechecked
   authenticated health and basic event persistence. The owner reviewed
   account-level R2 usage and explicitly authorized one synthetic photo test.
   A disposable event named `Synthetic R2 Upload Test 2026-09-23` was created
   and published on 2026-09-23; publication consumed the sole remaining
   Explore allowance. Its organizer gallery still reported 0 photos after a
   refresh, so the guest photo flow is not verified. The test event is live
   until 2026-09-24 00:15 Europe/Riga. Do not use `Balle` for the photo test.
   Read-only Wrangler bucket info on 2026-09-23 initially showed
   `lumiq-closed-test-photos`: 0 objects / 0 B and
   `lumiq-staging-photos`: 11 objects / 502 kB. These are per-bucket counts;
   they do not establish account-wide storage or Class A/B operation usage.
   The owner dashboard screenshot for `lumiq-closed-test-photos`, last 24 hours
   on 2026-09-23, showed average storage 0 B, data retrieved 0 B, 3 Class A
   operations, 12 Class B operations and request distribution 9. This is a
   one-bucket 24-hour baseline only, not the account/month total.
   A later owner screenshot for the same bucket with **Last 30 days** selected
   showed average storage 0 B, data retrieved 0 B, 5 Class A operations,
   15 Class B operations and request distribution 9. This remains per-bucket
   data. The same screenshot's Class A/B chart legends showed 0, conflicting
   with the summary cards; treat those operation counts as provisional until
   reconciled.
   The owner then provided the R2 account Overview screenshot for the current
   billing period, 2026-09-12 through 2026-10-12: total storage 34.62 MB,
   account Class A 378, Class B 1.13k, and billable usage `$0.00`. Its inventory
   listed `app-images` 116 objects / 34.11 MB, `lumiq-closed-test-photos` 0 / 0,
   `lumiq-staging-photos` 11 / 501.9 kB, and EU `lumiq-staging-photos` 0 / 0.
   A separate Last 30 days screenshot for the staging bucket showed average
   storage 501.9 kB, data retrieved 0 B, 48 Class A operations, 72 Class B
   operations and request distribution 28. Its chart legends also showed 0,
   inconsistent with the summary cards. The account Overview is the
   account-level baseline for that billing period; per-bucket operation cards
   remain provisional. A later read-only Wrangler check and Cloudflare
   dashboard inspection on 2026-09-23 showed the test bucket now has 2 objects
   / 144.71 kB. The object browser identifies both under the `Balle` event:
   one WebP in `covers/` (45.6 kB, modified 23:21 Riga time) and one WebP in
   `qr/` (99.06 kB, modified 23:20). These are saved design assets, not guest
   photos; the dashboard showed no `photos/` objects, and both the `Balle` and
   synthetic-test event galleries reported 0 photos. The latest account
   Overview still shows 34.62 MB total storage and `$0.00` billable usage;
   Class A rose from 378 to 388, while Class B remains 1.13k. No guest photo
   upload has been completed or verified. Preserve the two Balle design
   assets; do not delete them as part of the synthetic photo test.
   On 2026-09-24, the authorized synthetic guest upload attempt was rejected:
   the browser showed `0 uploaded · 1 need attention`, and DevTools recorded
   `POST /api/guest/<slug>/reserve` returning HTTP 409. The UI reported that
   the event had reached its photo or storage allowance; the organizer gallery
   remained at `0 of 0`. Code inspection confirms the reservation check counts
   both `pending` and `uploaded` media against the event's photo and byte
   entitlement. A read-only database query found no `pending` or `uploaded`
   media rows. A follow-up read-only query on 2026-09-24 confirmed both
   `events.entitlement` and `event_publications.entitlement` have
   `jsonb_typeof(...) = 'string'`, although their displayed contents are
   serialized plan objects; consequently `->>'id'`, `->>'photos'` and
   `->>'bytes'` return null. The root cause was JSONB parameters receiving
   `JSON.stringify(object)` through `postgres.js`, which stores a JSON string
   scalar instead of an object. Application JSONB writes now pass structured
   values directly. Added forward migration `007-jsonb-parameter-encoding`
   unwraps historical object/array JSON strings across JSONB columns. A focused
   local regression test passed: it verifies new trial entitlements are JSON
   objects, repairs a simulated legacy scalar, then confirms a trial guest
   upload reservation succeeds. On 2026-09-24, the owner ran the isolated
   migration script and it verified `007-jsonb-parameter-encoding` alongside
   migrations 001-006 on the closed-test database. The closed-test-only Worker
   was deployed as version `f5f4c65d-446f-49a4-a48c-9d1716d73d4e`; Wrangler
   reported only the separate test Hyperdrive and `lumiq-closed-test-photos`
   bindings. After reloading the existing guest page, it reported that uploads
   had ended: the synthetic event's scheduled end was 2026-09-24 00:15
   Europe/Riga. No retry was sent and no guest photo is completed or verified.
   The owner then explicitly approved a free, account-specific Gathering test
   exception for 30 days; this does not change the public Explore plan or
   create a paid subscription. No database entitlement has been changed yet.
   The owner must run the guarded SQL in the Supabase closed-test project,
   which targets the owner of this exact synthetic event and only a
   `trial`/`trialing` account without provider IDs. The Access-authenticated
   `/app/billing` page was verified after Worker version
   `b1b7fe9e-78a4-4e7a-a422-4a506d63608f` and reports the current account as
   `Explore`, `1 / 1` used, with payments disabled. Its former missing-button
   JavaScript error is fixed. Wait for the guarded update to return one row
   and the page to show `Gathering trialing` with four remaining before
   creating a fresh future synthetic event. Do not alter the expired event
   directly or use `Balle` for the photo test. The latest `/healthz` response
   was not rechecked after this static-asset deploy; the prior owner-verified
   response remains from the earlier Worker version.
   Local release checks on 2026-09-24 then passed: `npm test` (74/74),
   `npm run build` (60 public files), `npm run security` (160 tracked files,
   zero reported vulnerabilities), `npm run browser` (responsive journeys
   through accessibility), and Wrangler `--dry-run` with only the ignored
   closed-test config. The upload reservation test is local evidence only; the
   live R2 upload has not completed.

## Current status

This section supersedes earlier pending statements above where the test state
has since changed. It is still a closed test, not production approval.

- The test-only Supabase Free database has migrations `001-platform` through
  `012-tier-photo-capacity`; RLS is enabled on 17 platform tables and
  `anon`/`authenticated` SELECT is denied. `lumiq_runtime` and the separate
  test Hyperdrive were provisioned and checked. No MVP migration or production
  migration was run. The test project reference is pinned in the migration
  guard; database credentials must never be copied into this repo.
- Migration `012-tier-photo-capacity` raises per-event byte allowances to
  100 / 1000 / 1000 / 2000 MiB. The owner confirmed the guarded migrator
  verified all 12 versions, with RLS enabled and anon/authenticated SELECT
  denied on 17 tables; no MVP migration ran. The matching source was then
  deployed to the closed-test Worker. Production remains untouched.
- The separate closed-test Worker uses only its test Hyperdrive and private
  `lumiq-closed-test-photos` bucket. It remains behind the owner's Cloudflare
  Access policy. A fresh read-only Wrangler listing at 2026-09-25 16:54 UTC
  reports version `4fc5b617-5815-4c0e-bb2d-e0492279d683` at 100%. Payments
  remain disabled. The former `lumiq-cam` staging Worker and its Cloudflare
  resources were deleted; the closed-test Worker is not production.
- After migration 012 and Worker version `0d6c9cd2-3d03-44bc-8bb5-a4591bde7fc9`,
  the owner reported `/healthz` as `status: ok`, `database: ready`, and
  `storage: bound`. The `service: lumiq-cam` value came from a hard-coded
  handler label, so it did not identify which hostname served the response.
  The handler now uses the configured service name or request hostname; this
  diagnostic-only change and subsequent closed-test updates are included in
  the active version `4fc5b617-5815-4c0e-bb2d-e0492279d683`. The owner later
  confirmed that `lumiq.cam` opened the app; the owner-reported health response
  and CLI deployment record are separate evidence, not proof of production
  readiness.
- The owner applied the approved free, account-specific Gathering exception
  in the test database. The authenticated billing page showed `Gathering
  trialing`, `1 / 4` publications used and `3` remaining after the new test
  event was published. No paid plan or payment method is connected.
- On 2026-09-24, the owner created and published `Synthetic R2 Upload Test
  2026-09-24`, then supplied one test image. The guest page reported
  `1 uploaded · 0 need attention` and `Photo uploaded!` at 100%; the organizer
  gallery showed `1 of 1 photos` with a loaded thumbnail. Uploads were paused
  after verification. A later synthetic upload, legacy test-photo cleanup and
  automatic ZIP run are recorded below. These verify only the narrow closed-
  test paths described there, not the full R2 failure/retry, privacy,
  sharing-revocation or retention matrix.
- Post-upload Cloudflare R2 dashboard evidence on 2026-09-24: a later account
  overview showed `35.37 MB` total storage, `$0.00` billable usage for
  2026-09-12 through 2026-10-12, and account totals of 580 Class A / 1.29k
  Class B operations. The private `lumiq-closed-test-photos` bucket showed
  4 objects, with Public Access Disabled. Its overview listed `263.25 kB`,
  while bucket detail showed `265.03 KB`; this display discrepancy is
  unresolved. The synthetic event's guest prefix contains the uploaded
  `image/webp` original (`109.69 KB`) and its `image/webp` thumbnail
  (`10.57 KB`); the organizer gallery read that thumbnail. The bucket's other
  objects include the existing `Balle` assets. Account totals differ from the
  earlier screenshot baseline (`34.62 MB`, 388 Class A / 1.13k Class B), but
  other account activity may contribute, so that delta is not attributed only
  to this photo test. Preserve the `Balle` cover and QR design assets.
- An earlier source snapshot passed `npm run check` on 2026-09-24: secret scan
  across 162 tracked files, `npm audit` with 0 vulnerabilities, 78/78 Node
  tests, a 62-file public build, browser checks at 320/390/768/1440px,
  organizer/guest/designer/billing/refinement journeys, and
  accessibility/keyboard/reduced-motion/200% zoom checks. This verifies local
  source only, not the deployed closed-test bundle or production target. The
  latest source, including the Worker-edge release-approval check for static
  assets, API, health and scheduled work, is deployed only to the closed-test
  Worker as version `4be484be-e646-44e0-a861-f00022e6cdad`; Wrangler reports
  100% traffic. This deployment did not change `lumiq-cam` or `lumiq.cam`.
  Anonymous `GET /healthz` to the closed-test workers.dev host returned HTTP
  302 with `Www-Authenticate: Cloudflare-Access`; the authenticated health
  endpoint could not be reopened in the in-app browser in this check, so its
  current response is not claimed verified. No production deploy.
- Historical local source verification (2026-09-24): `npm run check` passed with
  85/85 Node tests, secret scan of 162 tracked files, 0 `npm audit`
  vulnerabilities, and a clean 53-file public build. The tests include the
  new optional Queue dispatch, duplicate/retry recovery and shared 11-version
  migration manifest. A Wrangler dry run against
  `wrangler.closed-test.jsonc` read 59 asset files and resolved only the test
  Hyperdrive and private test bucket; no Queue binding was added and no deploy
  occurred. The source now requires migration `011-queue-job-dispatch`, while
  the deployed closed-test Worker and database remain at the previously
  recorded state through migration `010`. This historical deployment note is
  superseded by the 2026-09-25 release and retest entries below. Queue bindings
  remain disabled; the database polling fallback is active. A separate
  reviewed capacity/cost decision is required before provisioning or enabling
  Cloudflare Queues or a paid plan.
- A later local change adds organizer/event R2 prefixes and a separate `thumb/`
  folder for new photo pairs. The planned key shape is
  `<organizer>-<6>/events/<event>-<6>/<guest>-<capture-time>-<6>.webp`, with
  thumbnails under that event's `thumb/`; event-bound cover and QR design
  uploads go under `<organizer>-<6>/cover/`. Each new event starts with its own
  selected bundled cover and a fresh QR layout. The organizer can replace
  either after creation. Uploaded covers and finished Canva posters remain
  attached only to their own event; a Canva poster already contains that
  event's QR code and must be edited in Canva and re-uploaded for another
  event. Photo time currently comes from the
  browser File `lastModified` metadata, with server receive time as fallback;
  it is not guaranteed to be the camera's EXIF capture time. Existing rows keep
  their full object keys. No legacy customer objects were re-keyed; the two
  obsolete synthetic event-root test photos were deleted during the later
  retest below. Forward
  migration `008-organized-r2-keys` adds the owner prefix and `captured_at`
  columns; `009-organizer-design-defaults` is retained for migration checksum
  compatibility but its column is no longer used; `010-event-isolated-designs`
  clears any saved cross-event defaults. On 2026-09-24 the owner confirmed the
  guarded migration script verified all ten migrations on the closed-test DB.
  Fresh read-only Wrangler output reports Worker version
  `5f6e4034-9b99-4567-b607-02472801a029` at 100%, using the test Hyperdrive
  and `lumiq-closed-test-photos` bucket. Re-keying old objects needs a separate
  copy and checksum-verified migration; preserve the existing `Balle` design
  assets. New key paths and event design isolation still need live R2
  verification.
- A QR editor regression check uploads two different finished Canva
  posters to one event without reloading the page and verifies that the
  rendered preview changes immediately. The fix gives each opened editor a
  fresh preview URL. The new-event form starts with a selected bundled cover;
  it no longer offers "Current photo" before an event has its own cover. These
  fix is deployed to the closed-test Worker. The workspace also now opens an
  event by clicking its row; mobile navigation uses one menu button for
  sections, language, theme and sign-out. The event-list return link has a
  mobile-sized touch target.
- Supabase Auth URL Configuration was updated on 2026-09-24 in the test
  project: Site URL is the closed-test workers.dev origin, and exactly
  `/auth/verify`, `/auth/reset`, `/auth/email`, and
  `/api/auth/google/callback` are allowed on that host. Signup and email
  confirmation are enabled; Google OAuth is disabled. Default email templates
  remain in use; Supabase requires custom SMTP to edit them, and no SMTP was
  configured. The reset screen now requires the new password twice and rejects
  a mismatch. Local browser journey tests mismatch and successful reset; fake
  Supabase adapter tests cover recovery access-token and token-hash links. The
  change is deployed only to closed-test Worker version
  `5f6e4034-9b99-4567-b607-02472801a029`; `lumiq-cam` remains at
  `4e9ace8c-dc93-4451-85e2-2e03bbe8138e`. No live signup, mailbox delivery,
  real Supabase reset, email-change or concurrent-refresh flow has been
  exercised.
- Still unverified for the closed test: proof that test requests cannot access future production data; complete R2
  denial/retry/revocation cases; multi-instance limiter and trusted proxy
  behavior; alerts, capacity, accessibility on physical devices, and a full
  backup/restore drill.
- ZIP export generation writes 64 KiB chunks and waits for stream backpressure; organizer ZIP downloads stream directly from object storage rather than buffering each full archive part in Worker memory. Local stress coverage exports the full 1,000-photo Studio limit into two ZIPs (72,056,284 bytes in the latest run), verifies every manifest ID and asserts queued stream data remains below 2 MiB with a throttled local sink. Optional Queue dispatch can publish up to 1,000 bounded job messages/minute (100 per API batch); without the Queue binding, cron polling falls back to 10 jobs/minute. Queue dispatch is implemented but no Cloudflare Queue binding is configured: this test Worker uses the database cron polling fallback. Workers Free allows 10 ms CPU per invocation. Verify actual ZIP CPU, memory, R2 behavior and load before enabling a Queue or paid plan.
- Closed-test Worker version `5f6e4034-9b99-4567-b607-02472801a029` is at 100%, confirmed by `wrangler deployments list` on 2026-09-24. The `lumiq-cam` Worker remains at `4e9ace8c-dc93-4451-85e2-2e03bbe8138e`.
- Production remains unprovisioned and unauthorized for spending. The test
  does not satisfy `LAUNCH-GATES.md`; production still requires separately
  approved infrastructure, production-only migrations and backup/restore,
  independent security review, reliability/capacity evidence and owner/legal
  decisions. Do not set production release flags or point `lumiq.cam` at the
  test stack.

## 2026-09-25 closed-test release

- The owner applied guarded migration `011-queue-job-dispatch` to Supabase
  project `cpweowosocjuccjsyyic`. Reported versions 001-011 verified, RLS is
  enabled, anonymous/authenticated SELECT is denied on 17 tables, and no MVP
  migration ran. This is evidence for the isolated test database only.
- `npm run check` passed after that confirmation: 85/85 tests, security scan
  across 162 tracked files, `npm audit` with 0 vulnerabilities, build of 53
  public files, browser checks at 320/390/768/1440 px, organizer/guest/billing/
  designer journeys and automated accessibility checks.
- Closed-test Wrangler dry-run resolved only Hyperdrive
  `6823aef81a314970bd3da962c2a62966`, bucket
  `lumiq-closed-test-photos`, and static assets. On 2026-09-25 version
  `c5f255b0-1f45-44a0-a9ba-b4d9128498c7` was deployed at 100% to
  `lumiq-closed-test`. Queue is intentionally not bound. Deployment listing
  confirmed the new version at 100%. `lumiq-cam` / `lumiq.cam` was not changed.
- Still required: owner-authenticated `/healthz` check (`database: ready`,
  `storage: bound`) and a fresh closed-test browser smoke test after this
  release. The automated checks are local; they do not establish live guest
  upload, end-of-event ZIP generation, Queue operation, backup/restore,
  physical-device or production readiness.

### 2026-09-25 guest-folder upload and automatic ZIP retest

- Uploaded one generated `party.webp` through the guest page of the synthetic
  R2 layout event. The organizer gallery showed one newly uploaded photo.
- Confirmed in the Cloudflare dashboard that the original and thumbnail use
  the event's `guntars-2cc156/` folder, with the thumbnail in its nested
  `thumb/` folder. Deleted the two prior event-root photos in the application;
  after background cleanup, their originals and the old event-root `thumb/`
  were absent from R2. The new guest-folder pair remained.
- The automatic event-end ZIP exposed a Cloudflare R2 runtime requirement:
  stream bodies must have a known content length. Updated ZIP sizing and R2
  stream writes to use a bounded `FixedLengthStream`; the archive then reached
  `ready` with one photo and is available until 2026-10-09 15:40 Europe/Riga.
- ZIP download filenames now use the organizer (or business) name, event name
  and part number, normalized for safe filenames (for example,
  `guntars-karans-balle-1.zip`) instead of the generic `event-photos-1.zip`.
  The download endpoint derives the name at request time, so already-prepared
  ZIPs also receive the new name without rebuilding their contents. Local test
  simulates an old saved `event-photos-1.zip` result and confirms the response
  header uses the current organizer/event filename.
- Local post-fix focused checks passed 32/32; the build validated 53 public
  files. The archive completed under closed-test Worker `bb1fa5ae-6a20-464f-8bb2-bbf75594e325`.
  Then temporary stack-trace logging was removed; final closed-test Worker
  `14201856-ee27-4ad7-b159-2903c93f8c6d` is verified at 100%. The `lumiq-cam`
  Worker remained on its separate version.
- This is one small closed-test upload and ZIP only, not production capacity,
  Queue, device, backup/restore or security-review evidence.

### 2026-09-25 full local check and latest closed-test state

- The current working tree passed `npm run check`: 88/88 Node tests, secret
  scan across 162 tracked files, `npm audit` with 0 vulnerabilities, build of
  53 public files, responsive checks at 320/360/375/390/430/500/768/1024/1440
  px, organizer/guest/designer/billing/refinement browser journeys, and axe,
  keyboard, reduced-motion and 200% zoom checks. The isolated browser suite
  used its own fixtures, not the live preview data.
- The latest closed-test Worker is `79cf3383-7f49-475b-a9b5-b4e7fa2e5b5a`
  at 100%; deployment dry-run resolved only the closed-test Hyperdrive and
  private test bucket. The new filename behavior is deployed; an authenticated
  live download response has not yet been manually inspected.
  `lumiq-cam` and the `lumiq.cam` route were not changed. The live synthetic
  event contains one new photo in its photographer folder with a nested
  `thumb/`; the two obsolete event-root synthetic pairs were removed and the
  automatic one-photo ZIP reached `ready`, retained until 2026-10-09 15:40
  Europe/Riga. This confirms a small closed-test success path, not load or
  production readiness.
- No new production resource was created, paid service approved, production
  migration run, or production Worker/domain changed. Queue bindings remain
  disabled. Auth email delivery, full privacy/revocation matrix, physical
  devices, load/cost limits, independent security review and a real isolated
  DB+R2 restore drill remain open.
