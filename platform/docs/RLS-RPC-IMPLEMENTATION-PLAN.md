# RLS/RPC Implementation Plan

Status: implementation design, not a database migration or release approval.
Updated: 2026-09-27

## Decision

Do not attach the current `lumiq_runtime` connection to a Worker. The current
Worker sends arbitrary parameterized SQL through one Hyperdrive pool for
organizer, guest, webhook, and background-job requests. The runtime role has
`BYPASSRLS`, and the application currently relies on route-level owner checks.
Turning off `BYPASSRLS` alone would default-deny tables without policies and
break the application. Adding policies while retaining broad SQL grants would
not protect against a leaked shared database credential.

The target removes that shared SQL credential from user-facing data access:

- Organizer data requests use the user's Supabase access JWT against
  PostgREST. PostgreSQL policies use Supabase's verified `auth.uid()` claim;
  the Worker must never accept an owner ID from the browser as identity.
  Mutations that need server-owned or cross-table rules use named RPCs that
  derive identity from `auth.uid()` and validate verified provider data inside
  the database.
- Guest requests use the public/anon API surface and narrowly named RPC
  functions. Each function resolves a published event and validates the
  event-scoped guest capability/token in the database. No guest table grants.
- Webhooks, admin operations, and background jobs use separate server-side
  paths and narrowly scoped functions/credentials. They are not exposed to the
  organizer or guest database role.
- Public guest identity RPCs use a separate `lumiq_guest_owner` role with
  `NOLOGIN` and `NOBYPASSRLS`; this role is distinct from the authenticated
  organizer RPC owner.
- Schema migrations use an operator-only connection outside Worker bindings.
- The HTTP candidate Worker has no direct Hyperdrive binding when organizer
  and guest queries have moved to PostgREST/RPC. Any future job Worker gets a
  separate least-privilege binding.

Never use a caller-settable custom PostgreSQL setting as the tenant identity
for a shared raw SQL role. Never create a generic SQL/table-dispatch RPC or a
`SECURITY DEFINER` function that trusts a caller-supplied owner ID. Any definer
function must have a fixed safe `search_path`, a non-login least-privilege
owner, validated inputs, explicit event/owner checks, and EXECUTE grants only
to the intended API role.

## Existing Scope

The current Worker still opens a shared Hyperdrive SQL pool. Production
organizer/guest flows for events, galleries, exports, sessions, billing,
support and event design now use JWT/capability RPCs, but internal job RPCs
still run on that pool. Audit/debug and a few fallback/local-only branches
also retain direct SQL. Recount and classify reachable production SQL before
changing runtime grants; a source-wide call count overstates reachable
fallbacks and understates the shared-credential risk.

The following table families are present in `schema.sql` and numbered
migrations and must each receive an explicit access decision:

| Domain | Tables | Intended access |
|---|---|---|
| Organizer identity/profile | `accounts`, `subscriptions` | JWT-scoped own-row access; role fields and entitlement changes remain server-owned |
| Organizer event data | `events`, `event_publications`, `event_passes`, `accounts.design_defaults` | JWT-scoped owner rows; publication/allowance transitions via transactional RPC |
| Guest activity/gallery | `guests`, `media` | No direct anon table access; event-token validated RPC plus organizer JWT policies |
| Organizer exports | `jobs` | Owner-scoped reads; enqueue/retry/download authorization via RPC and Worker checks |
| Billing | `orders`, `subscriptions`, `payment_events` | Owner-scoped reads; webhook writes only through signature-verified server path |
| Support/admin | `support_cases`, `deliveries`, `audit` | Owner-only support history; named admin operations; no general table grants |
| Operations | `metrics`, `request_limits`, `r2_usage_guard`, `platform_migrations` | Internal-only narrow operations; Worker startup needs read-only migration verification or that check is removed |
| Authentication internals | `sessions`, `auth_tokens` | No browser/API-role table access; server auth path only, then eliminate custom sessions where Supabase Auth can own the flow |

The list must be reconciled against the actual applied production schema before
writing production SQL; optional tables differ by migration history.

## Ordered Work

1. **Freeze the target and inventory.** Reconcile every SQL operation with its
   route, identity source, transaction boundary, table, and read/write need.
   Verify the exact production project/database and current applied migration
   versions read-only. Confirm a recoverable production backup before any DDL.
2. **Build the JWT data-access boundary.** Expose the already verified and
   refreshed Supabase access JWT only to server-side request handling, never in
   JSON or logs. Add a PostgREST client with tests proving it sends that JWT and
   does not fall back to Hyperdrive for organizer data.
3. **Migrate organizer vertical slices.** Move profile/account, event list,
   event details, and event create/update to JWT-authenticated PostgREST/RPC.
   Add `auth.uid()` policies and cross-owner integration tests. Keep this
   slice unavailable until every query it needs has moved.
4. **Migrate event lifecycle and gallery.** Move publication allowances,
   cover/design, guest attribution, media listing/deletion, and exports through
   RLS or narrowly scoped transactional RPCs. Preserve atomic transactions and
   R2 cleanup behavior.
5. **Migrate guest capabilities.** Add anon-executable, event-scoped RPCs for
   guest join, upload reservation/finalization, and public gallery access.
   Prove guessed event IDs, forged guest IDs, and cross-event tokens fail.
6. **Split internal work.** Move billing webhooks, support/admin, mail,
   retention, ZIP, cleanup, queue, and metrics to isolated least-privilege
   operations. Do not bind a broad migration/runtime credential to the public
   HTTP Worker.
7. **Lock down roles and tables.** Only after all paths have migrated, remove
   `BYPASSRLS`, revoke direct table DML and broad default privileges, enforce
   policies, and grant only the explicit RPC execution surface. Test using the
   actual non-bypass roles, not the database owner.
8. **Verify then attach candidate.** Run the full local suite and Postgres
   integration suite, apply reviewed migrations to the isolated production
   project, then create/bind the Access-gated, release-locked candidate Worker.
   Exercise organizer, guest photo, gallery, delete, export, webhook and queue
   journeys. Do not add a public route, schedule, or queue consumer until each
   has a tested least-privilege principal and a separate release gate.

## Required Security Tests

- Two organizers: each can read/update only their own account, events, media,
  jobs, and billing view; direct guessed IDs fail for the other organizer.
- Changing request inputs, owner IDs, `app.*` settings, SQL parameters, or a
  guest token cannot change the JWT identity or cross event boundaries.
- An anon request has no direct table SELECT/INSERT/UPDATE/DELETE and can only
  execute the named guest RPCs.
- Runtime SQL credentials cannot `SET ROLE` into a privileged role, bypass
  policies, mutate account roles, alter migration history, or call unapproved
  functions.
- Job/webhook credentials cannot invoke organizer operations; failed webhook
  signatures cause no writes; job claims are type-scoped and idempotent.
- Every allowed application workflow passes with the non-bypass roles and
  transaction behavior is preserved.

## Current Gate

- [x] User selected RLS/RPC before candidate attachment.
- [x] Read-only source audit found the shared SQL pool and broad query surface.
- [x] Production project identity and database state checked read-only on 2026-09-27: Supabase project `baqebydtinysosueksgr` (`Lumiq Production`) is Healthy; the app ledger contains exactly versions 001-013; all 19 public tables have RLS enabled; direct SELECT privilege counts for `anon` and `authenticated` are zero. `lumiq_runtime` is LOGIN, not superuser/CREATEDB/CREATEROLE, but has `BYPASSRLS=true`. Supabase's dashboard migration tracker is a separate CLI ledger and still shows no entries.
- [x] Migration 013 is already present in the production app ledger; it must not be replayed as an empty-database bootstrap. The production role currently exists with the grants/security posture recorded above.
- [x] Read-only Cloudflare Hyperdrive identity preflight on 2026-09-27 confirms production config `287181f11f734b63844bcda5eb7fe90c` points to `baqebydtinysosueksgr` via the Frankfurt session pooler as `lumiq_runtime.baqebydtinysosueksgr`. Dashboard metadata shows caching disabled. This does not prove database authentication succeeds; the owner reports changing the password, but no live query through Hyperdrive has been observed.
- [x] Static production candidate preflight on 2026-09-27 with verified resource IDs confirms the isolated Worker origin, production Hyperdrive, `lumiq-production-photos`, production Queue and DLQ, and `NOT_APPROVED`. Remote Hyperdrive identity and disabled caching passed. The check used a placeholder publishable key, wrote no config and performed no deploy; Access enforcement and actual resource bindings remain to be verified after RLS/RPC and backup gates.
- [ ] Verified recoverable production backup confirmed. The Supabase dashboard currently reports no backups, so no production DDL may be applied yet.
- [x] A separate production-only backup command is prepared at `platform/scripts/backup-production.ps1` / `backup-production.mjs`. It is pinned to production Supabase/R2 resources, uses masked prompts, separate source-read and destination-read/write R2 tokens, uploads to a unique prefix and verifies remote read-back checksums. The complete local check passed 149/149 tests on 2026-09-28. Two bucket-scoped tokens were created; the owner confirmed saving the photo read-only token, while saving the backup write token still needs confirmation. The command has not been run: the production `postgres` password must be entered through the masked local prompt. The separate EU recovery R2 bucket exists, but the recovery Supabase project is not yet created and the recovery-bucket token is still needed before restore.
- [ ] Detailed function/policy SQL and grants reviewed.
- [ ] JWT/PostgREST boundary implemented and tested.
- [x] First JWT slice: profile updates use the freshly reauthenticated Supabase access token through PostgREST and only update the signed-in account's approved profile columns; no direct SQL profile write remains in this method. Other auth sync and application SQL paths still require migration.
- [x] Initial local migration 014 provides owner-only JWT read policies and `sync_own_account`, a narrow RPC that derives the ID from `auth.uid()` and reads the verified email from `auth.users`. The `SECURITY DEFINER` function is owned by `lumiq_api_owner`, a dedicated `NOLOGIN`, `NOBYPASSRLS` role with narrow account/subscription grants and JWT-bound RLS policies; authenticated callers cannot assume that role or change account roles.
- [x] Account sync/profile update paths use the user's Supabase JWT to call that RPC; auth/session bookkeeping still has direct SQL and the broader organizer/guest workflows have not yet migrated.
- [x] The local 014 slice also provides `list_own_events` and `get_own_event`; organizer event listing and event detail lookups use the Supabase JWT, event detail output omits `storage_prefix`, and the RPC returns `published_before` without exposing publication internals.
- [x] The local 014 slice adds `get_own_billing` and moves the billing read endpoint to it; only safe subscription/order columns and owner-scoped allowance/pass counts are returned. Provider IDs remain inaccessible. The function is `SECURITY INVOKER` and has been tested with two organizers.
- [x] Local migration 015 adds `create_own_event`; the production event-create path uses the verified JWT RPC, which derives the owner from `auth.uid()`, validates schedule/draft limits/design objects, allocates the organizer/event storage prefixes, and inserts the draft plus audit row atomically. The RLS test proves two-owner isolation, no direct authenticated event insert, no anon execute, and no storage-prefix exposure.
- [x] Local migration 016 adds `update_own_event`; event updates now use the verified organizer JWT RPC. The function derives ownership from `auth.uid()`, validates schedule/state/design data, preserves server-managed cover and QR keys, queues replaced cover objects transactionally, and writes its audit row atomically. Tests cover owner isolation, update constraints, cleanup enqueue, legacy appearance arrays, and the adapter's JWT-only RPC payload.
- [x] Local migration 017 adds `act_on_own_event`; publish allowance/pass consumption, pause/resume, archive/restore, delete plus cleanup enqueue, and gallery-sharing settings now use an owner-derived transactional RPC. Tests cover exhausted trial allowance, subscription publication, cross-owner denial, deletion confirmation/queueing, and anon execute denial.
- [x] Local migration 018 adds `save_own_qr_layout`; QR layout saves now use an owner-derived RPC that validates and clamps supported fields, preserves unrelated appearance keys, blocks custom backgrounds unless one is attached, and audits the save. RPC/adapter tests cover normalization, cross-owner denial, invalid fonts, and anon execute denial.
- [x] Local migration 019 adds `reserve_own_design_asset` and `attach_own_design_asset`; cover, camera cover, cover source, QR source, and QR background uploads now reserve owner/event-scoped cleanup jobs before R2 writes, then attach metadata and queue replacement cleanup atomically through verified JWT RPCs. Tests cover the five asset types, owner isolation, anon denial, expiry/archive cleanup, and the JWT adapter.
- [x] Local migration 020 adds `get_event_cover_asset`; the cover image GET route now asks for only the selected R2 key through an owner JWT or a public-event-limited RPC. It does not return event rows or storage prefixes and supports legacy appearance arrays.
- [x] Local migration 021 adds `join_public_event` and `get_public_guest_identity` under a separate non-login, non-bypass role. Guest creation and token-to-guest lookup use anonymous RPC calls; anon has no direct guest-table access.
- [x] Local migration 022 adds `reserve_guest_photo`; guest capability, live event state, file size/checksum, event quota, idempotent retries, collision-free readable object keys, and media insert are checked atomically under `lumiq_guest_owner`. It does not grant anon media-table access.
- [x] Local migration 023 moves guest upload metadata lookup, completion, and discard/cleanup enqueue behind event-token RPCs. The Worker still verifies R2 checksums and image content before it asks PostgreSQL to mark a photo uploaded; anon has no direct media/jobs/metrics table access.
- [x] Local migration 024 moves the guest landing-page event lookup to `get_public_event`, returning only safe page fields and no owner ID, storage prefix, or entitlement internals.
- [x] Local migration 025 moves the public gallery share-view counter to an anon RPC with an atomic expiry and allowance check; direct event-table reads/writes remain denied to anon.
- [x] Local migration 026 moves organizer and public gallery listing through distinct authenticated/anon RPCs, preserving filters and cursor paging. Public gallery reads consume the share allowance atomically; the guest function excludes hidden photos.
- [x] Local migration 027 moves photo asset authorization and byte accounting into separate owner-JWT and public-share RPCs. The public RPC consumes the gallery-view allowance in the same transaction, hides curated photos, and returns only the selected media/event metadata needed by the server to read R2. The production media route uses these RPCs and avoids separate direct-SQL share/metric writes.
- [x] Local migration 028 moves owner gallery favorite/hide/restore/cover/delete actions into one authenticated RPC. Photo deletion and its cleanup job plus audit entry are atomic; the API owner receives only the required column grants and owner-scoped RLS policies.
- [x] Local migration 029 moves organizer export listing, single-export status, part download authorization, and retry into authenticated owner RPCs. The client-facing listing omits R2 object keys; download checks job owner/status/expiry and event retention; retry resets failed child parts atomically.
- [x] Local migration 030 introduces a `lumiq_job_owner` NOLOGIN/NOBYPASSRLS principal and narrow queue claim/dispatch/recovery/lease/settlement/dead-letter RPCs. The queue adapter uses these RPCs when configured; local migration integration and adapter tests pass.
- [x] Local migration 031 moves export snapshot validation/part creation, leased part metadata reads, result completion, and completion-email recipient lookup behind internal RPCs. Runtime has only column-limited reads under role-scoped RLS policies; the integration test proves it cannot directly read `jobs` or `accounts`.
- [x] Local migration 032 moves object/media/event cleanup manifests, cross-event asset reference checks, thumbnail metadata writes, event cleanup finalization, and retention-time photo-cleanup deferral behind the non-bypass job owner. The integration test executes these RPCs as `lumiq_runtime`, confirms referenced cover objects are protected, and verifies event cleanup atomically archives the event and removes guest/photo rows.
- [x] Local migration 033 moves event-end export preparation, retention expiry, pending-upload cleanup scheduling, expired-export cleanup scheduling, subscription expiry, expired session/rate-limit cleanup and retention reminder lookup behind internal RPCs. The full retention cycle and targeted event-end/expiry RPCs pass under `lumiq_runtime`.
- [x] Local migration 034 moves periodic event/subscription notice selection and idempotent delivery insertion into `collect_platform_notices()`, owned by `lumiq_job_owner`. It preserves localized LV/EN copy and existing dedupe keys; runtime can call the RPC but cannot read `deliveries` directly. The PostgreSQL integration test verifies insertion, idempotency, and direct-read denial.
- [x] Local migration 035 adds `queue_platform_message()` and routes the shared `queueMessage` helper through it for both regular and transactional database handles. Message length/header checks, idempotency, internal-only EXECUTE, and runtime direct-write denial are covered by the database integration tests.
- [x] Local migration 036 adds a separate `lumiq_admin_owner` (`NOLOGIN`, `NOBYPASSRLS`) and JWT-bound admin dashboard, failed-email retry, and support-reply RPCs. Each function verifies `auth.uid()` has the database admin role; replies and audits are atomic. The migration integration test proves non-admin denial and that the runtime role cannot execute admin RPCs.
- [x] Local migration 037 adds a non-login, non-bypass support RPC owner. Support creation derives signed-in identity and verified account email from `auth.uid()`; anonymous callers can submit but cannot read support rows; signed-in users can list only their own cases. Admin job retry is admin-checked, repeat-safe and audited. PostgreSQL integration tests cover anonymous/signed-in support and admin retry.
- [x] Local migration 038 adds a non-login, non-bypass session RPC owner. Session creation and account-wide revocation derive identity from the verified Supabase JWT; per-session get/update/delete require the server-held SHA-256 of the HttpOnly cookie. The Supabase auth adapter now stores only encrypted provider session payloads through PostgREST RPCs, and integration tests verify cross-account revocation denial, zero direct browser-role table grants, and no raw-SQL fallback in the adapter path.
- [x] Local migration 039 adds an atomic request-limit RPC. Public roles can submit only a SHA-256 key, current minute window, and bounded limit; the RPC owner alone can access `request_limits`. Production limit counters no longer require direct SQL.
- [x] Local migration 040 moves event-preview token creation and lookup behind short-lived owner-JWT/anon RPCs. Anonymous preview responses contain only guest-page fields; direct `auth_tokens` access remains denied. Migration tests cover owner isolation, token lookup and sensitive-field exclusion.
- [x] Local migration 041 moves organizer checkout-order creation, Stripe session attachment, subscription cancellation and payment-portal detail lookup behind owner JWT RPCs. Plan amounts are selected in the database, identity is `auth.uid()`, and the RPC owner is `NOLOGIN`/`NOBYPASSRLS`. Migration and service tests cover plan tampering, cross-owner order writes and no shared-SQL fallback.
- [x] Local migration 042 moves signed Stripe webhook persistence and admin reconciliation into restricted payment/admin RPCs. The Worker verifies signatures and canonical provider subscription state first; PostgreSQL atomically checks order ownership/amount, issues Single Event entitlements, updates subscriptions and deduplicates events. `lumiq_runtime` gets named function `EXECUTE` grants rather than direct payment-table access. The admin reconciliation audit is checked against `auth.uid()` and the admin account role.
- [x] Local migration 043 moves the atomic R2 budget reservation to `reserve_r2_budget()`, owned by `lumiq_storage_owner` (`NOLOGIN`/`NOBYPASSRLS`). The Worker no longer writes `r2_usage_guard` directly; runtime can execute the RPC but cannot read that table. Integration tests exercise both the allowed reservation and limit rejection as `lumiq_runtime`.
- [x] Local migration 044 moves mail-outbox claiming and delivery settlement behind two `lumiq_job_owner` (`NOLOGIN`/`NOBYPASSRLS`) RPCs. The scheduled sender no longer directly updates or reads `deliveries`; integration tests prove runtime can process a message but cannot read the table.
- [x] Migration 045 hardens only the separately provisioned `lumiq_restore_runtime` role when it exists. It does not alter role flags and does not harden Production's existing `lumiq_runtime`; Restore Drill independently verified `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, and no administrative flags.
- [x] Local migration 046 adds a distinct `lumiq_production_runtime` grant target. It validates role flags, removes direct table/column/sequence access and matching existing table/sequence default grants, permits only migration-version reads, and grants an explicit internal RPC allowlist. An isolated PostgreSQL integration fixture seeds excessive table, column, sequence and default grants before 046, then proves the role cannot access existing or newly created objects. It does not modify `lumiq_runtime` or Restore Drill's role.
- [x] Production HTTP routes now fail closed if event publication state or photo authorization RPC data is missing; legacy raw-SQL fallback behavior is limited to local mode for these paths.
- [x] Photo-asset RPC misses now fail closed in the production adapter instead of falling through to a query through the shared SQL pool. A regression test verifies no DB query occurs on owner/public RPC misses.
- [x] Admin job retry and support create/list use the configured owner-JWT RPCs rather than HTTP raw SQL. Support submission also uses the narrow public RPC; account-deletion requests revoke the caller's sessions through the session RPC.
- [x] Session persistence/revocation and shared request-limit counters now use PostgREST RPCs; adapter tests fail if those paths try to use `db.query`.
- [ ] Internal job, storage-budget, mail, and payment RPCs still use the shared SQL connection. The local `SECURITY DEFINER` allow-list is verified, but the exact production function ACL and default privileges must be checked after migrations are applied to an isolated PostgreSQL environment.
- [ ] Production app ledger remains at 001-013; 014-046 are not applied. Production `lumiq_runtime` remains `BYPASSRLS` and must not be attached to a Worker. A dedicated `lumiq_production_runtime` must be provisioned and validated before applying forward migrations. Production DDL remains blocked until a fresh backup is restored and verified in an isolated Recovery project and the complete migration/function-grant review is approved.
- [ ] Re-audit every production SQL call after migration 045, including route-level fallbacks and scheduled job paths, against the exact roles and functions the candidate will receive.
- [x] Organizer event/design/gallery/export, guest join/upload/gallery, profile/session, support/admin, and billing/webhook vertical slices have local JWT/capability or named-RPC implementations and local integration coverage.
- [x] Local runtime role is non-bypass and has no direct public-table or sequence privileges; production role remains unchanged.
- [x] Local PGlite/PostgreSQL-compatible migration replay and role/RPC integration suite passes (154 tests on 2026-09-29); production build validates 60 public files and full browser/accessibility verification passes. This is not yet a run against an isolated Supabase PostgreSQL project.
- [ ] Isolated Supabase PostgreSQL integration security suite passes with the intended non-bypass principals.
- [ ] Candidate Worker is attached and isolated smoke tests pass.

No production grants, RLS policies, Worker bindings, or deployments were
changed while preparing this plan.
