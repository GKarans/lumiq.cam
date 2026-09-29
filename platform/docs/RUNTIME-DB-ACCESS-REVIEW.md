# Runtime Database Access Review

Historical audit status: read-only design review of the isolated restore-drill project on 2026-09-26. This document's original recommendations were subsequently implemented in the local codebase through migrations 014-045 and exercised by local PostgreSQL-compatible integration tests; see `RLS-RPC-IMPLEMENTATION-PLAN.md` for the current gate. Those later local changes did not alter this historical restore-drill database or Production. No Production grants, role flags, RLS policies, or application code were changed by this audit.
Date: 2026-09-26
Scope: the isolated `Lumiq Restore Drill 2026-09-25` Supabase project (`sprzlvywzpeyuzbsyplz`) and the `lumiq-restore-drill-candidate` Worker source. This is not a production approval.

## Executive Summary

The Worker opens one `postgres.js` pool through Cloudflare Hyperdrive and uses it for authenticated HTTP requests, guest requests, webhook handling, and background work. The connection is `lumiq_runtime`; Cloudflare skips migrations at startup but reads the migration ledger.

The live restore database reports `lumiq_runtime` as `LOGIN`, `NOINHERIT`, `BYPASSRLS`, not superuser, and without `CREATEDB` or `CREATEROLE`. It has `SELECT` on 19 public tables and table-level `INSERT`, `UPDATE`, and `DELETE` on 18. `accounts` is the exception: migration 013 restricts writes to selected columns and denies account deletion and role mutation. Default privileges still grant future public tables all four table operations.

The four principal tenant tables (`accounts`, `events`, `guests`, `media`) have RLS enabled, `FORCE ROW LEVEL SECURITY` disabled, and no policies were returned from `pg_policies` for schema `public`. Because the runtime role has `BYPASSRLS`, those RLS flags do not constrain it. The current tenant boundary is therefore the Worker’s application authorization, not PostgreSQL RLS. A compromised runtime database credential can read and mutate data across organizers within its SQL grants.

## Evidence

Read-only checks were run in the isolated restore Supabase project:

- Runtime role: `rolcanlogin=true`, `rolbypassrls=true`, `rolsuper=false`, `rolcreaterole=false`, `rolcreatedb=false`.
- RLS: `accounts`, `events`, `guests`, and `media` each have `relrowsecurity=true`, `relforcerowsecurity=false`.
- `pg_policies`: zero rows for `public`.
- Table privileges: `SELECT` on 19 tables; each of `INSERT`, `UPDATE`, and `DELETE` on 18 tables. The latter set excludes `accounts` after migration 013.
- Profile persistence was independently verified in `accounts` after the profile save; that row check did not alter data.

Relevant implementation: `cloudflare/worker/src/index.js` opens Hyperdrive with `skipMigrations: true`; `platform/server/db.mjs` executes parameterized SQL through one pool. `platform/scripts/provision-test-db-role.mjs` creates `lumiq_runtime` with `BYPASSRLS`, broad table grants, and broad default privileges. `platform/server/migrations/013-runtime-account-column-grants.sql` narrows account writes only.

## Table and Action Matrix

`R/W/D` describes live runtime table-level grants, not a claim that every API route exposes that operation. All 19 tables have `R`; all rows marked `W/D` have table-level insert/update/delete grants unless otherwise noted.

| Table | Runtime grant | Worker use and entry points | Current application boundary |
|---|---|---|---|
| `accounts` | R; selected-column insert/update; no table delete; role insert/update denied | Supabase Auth sync/profile, event storage prefixes, billing and admin views | Auth identity, `mustUser`, `events.own`; admin requires `user.role === 'admin'` |
| `audit` | R/W/D | Event, gallery, billing, support/admin actions | Writes are issued by server code; admin reads are role-gated |
| `auth_tokens` | R/W/D | Event-preview token records; legacy local-auth flows | Owner session and hashed token checks; local-auth routes are disabled in Worker mode |
| `deliveries` | R/W/D | Email delivery queue and admin retry/listing | Internal delivery code; admin endpoints role-gated |
| `event_passes` | R/W/D | Single-event entitlement and redemption | Owner ID is selected from authenticated user in allowance logic |
| `event_publications` | R/W/D | Publication allowance and event scheduling entitlements | Owner ID is checked in allowance logic; event mutations start with `events.own` |
| `events` | R/W/D | Organizer dashboard/edit/actions; guest lookup by slug; retention and export jobs | Organizer queries filter by `owner_id`; guest routes require published state and retention window |
| `guests` | R/W/D | Guest join, guest-token identity, gallery attribution | Event ID plus hashed guest token; upload paths bind guest to event |
| `jobs` | R/W/D | ZIP, media cleanup, retention, thumbnail, queue dispatch/retry | Organizer job reads filter by owner; workers process internal job IDs; admin retries are role-gated |
| `media` | R/W/D | Upload reservations/finalization, gallery, deletion, export/cleanup | Event/guest IDs and organizer checks; owner gallery mutation starts with owned event |
| `metrics` | R/W/D | Photo bytes and upload measurements; admin aggregate | Server-generated writes; aggregate view is admin-only |
| `orders` | R/W/D | Checkout creation/result and billing history | User-facing reads filter by `owner_id`; webhook checks Stripe signature |
| `payment_events` | R/W/D | Stripe webhook idempotency | Webhook is non-local and signature-verified before applying event |
| `platform_migrations` | R/W/D | Worker startup reads applied migration versions; migration runner writes ledger outside Worker startup | Worker uses read only, but current role can mutate/delete the ledger |
| `r2_usage_guard` | R/W/D | R2 operation and byte-budget reservations | Server-generated quota accounting; not exposed as an organizer query |
| `request_limits` | R/W/D | Database-backed rate-limit counters and expiry cleanup | Server-generated keys; API limiter runs before route dispatch |
| `sessions` | R/W/D | HttpOnly application session and encrypted Supabase provider session | Cookie token is hashed for lookup; session ownership/expiry checked in auth service |
| `subscriptions` | R/W/D | Plan, allowance, checkout, webhook updates and expiry | User-facing reads filter by `account_id`; webhook is signature-verified |
| `support_cases` | R/W/D | Support request, account deletion request, user history and admin reply | User history filters by owner; admin reply/list requires admin role |

The matrix follows the current server SQL and route wiring. Background job methods share the same database object as HTTP routes in `createApp`; the candidate’s current deployment has no scheduled or queue trigger, but the source Worker exports both handlers.

## Current Application-Layer Controls

- API routes resolve an authenticated user and call `mustUser()` for organizer-only operations.
- `events.own(user, id)` queries with both event ID and `owner_id`; event routes invoke it before returning or changing an event.
- Guest paths resolve a published event by slug, then bind guest operations to the event and hashed guest token.
- Photo and ZIP download paths check the associated event/job owner before returning data.
- Admin and billing webhook paths have role and Stripe-signature checks respectively.
- `platform/tests/platform.test.mjs` checks that one organizer cannot fetch another organizer’s photo or ZIP by guessed IDs.

These are useful controls against ordinary API misuse and are worth retaining. Current tests do not demonstrate that PostgreSQL itself enforces tenant isolation for `lumiq_runtime`; restore-safety tests explicitly expect that role to have `BYPASSRLS`.

## Target Architecture

Do not simply run `ALTER ROLE lumiq_runtime NOBYPASSRLS`. With no `public` policies, normal RLS evaluation would default-deny protected table operations and break application flows. Do not use a caller-supplied PostgreSQL setting such as `app.user_id` as the trust root: anyone holding the shared raw database credential can set that value themselves.

Recommended target is to remove the shared, unrestricted SQL credential from the user-facing data path:

1. **Organizer and guest API data:** use Supabase PostgREST/RPC with the verified Supabase user JWT so policies can bind to the cryptographically verified `auth.uid()`. Define explicit policies for organizer-owned accounts/events/media and event-scoped guest access. Keep guest authorization based on a verified guest capability, not an organizer claim supplied by the browser.
2. **Transactional operations:** move multi-table atomic operations to narrowly scoped database functions or APIs that receive verified identity and validate ownership in the database. Grant execute on specific functions rather than arbitrary DML on every table. Review `SECURITY DEFINER` functions carefully: fixed safe `search_path`, explicit owner checks, and least-privilege owner.
3. **Background jobs and retention:** separate the queue/scheduled Worker and its credential from the public HTTP Worker. Give it only the operations needed to claim and complete jobs; prefer narrow functions for cross-tenant maintenance rather than general table access.
4. **Billing and support administration:** keep Stripe webhook signature verification and admin authorization, but move their writes behind dedicated narrow operations. Do not give the organizer API arbitrary write access to payment events, deliveries, audit, metrics, migration ledger, or quota internals.
5. **Migration identity:** keep DDL/migration credentials out of Worker bindings. Runtime needs only `SELECT` on `platform_migrations` for startup verification, if that check remains in the Worker.

This changes the current raw-SQL/transaction architecture and must be treated as a planned security milestone, not a quick role toggle. Supabase JWT/RLS calls, transactions, guest upload, billing webhook and background jobs need separate implementation paths and tests.

### Proposed Principal and Capability Boundaries

This is a design target, not a grant script. Exact per-table grants and policy
predicates must be derived from the route/query inventory and tested before any
credential or policy change.

| Principal | Identity source | Permitted database surface | Must not receive |
|---|---|---|---|
| `anon` / guest request | No organizer account; a short-lived event-scoped guest capability verified by a fixed function | Execute only guest entry, guest identity, upload reservation/finalization and published-gallery operations; every function binds the verified guest and event IDs | Direct table `SELECT`/DML, organizer functions, arbitrary SQL, or a caller-chosen owner ID |
| `authenticated` organizer | Supabase-verified user JWT; policies bind to `auth.uid()` | RLS-filtered reads/writes for the caller's account, events, guests, media, exports and billing view; transactions that span tables go through specific ownership-checking RPCs | `BYPASSRLS`, account-role mutation, other owners' data, direct writes to internal jobs/audit/payment/metrics tables |
| Admin application request | Same verified user JWT plus server-side admin check, enforced again by the privileged function/policy | Named support, delivery-retry and audit operations with explicit actor logging | General-purpose SQL or an admin claim accepted solely from browser input |
| Stripe webhook caller | No end-user JWT; signature verified by the Worker before dispatch | Execute one idempotent payment-event operation that validates event type/IDs and updates only the corresponding order/subscription state | Direct table DML, unsigned payload handling, organizer or admin routes |
| Queue/retention executor | Separate Worker binding and credential; job ID claimed from trusted queue/database state | Claim, heartbeat, complete and fail only known jobs; scoped maintenance functions validate job type, event ownership/state and object-key prefix before work | User-facing session access, account-role writes, arbitrary table DML, or a shared credential with the public HTTP path |
| Migration operator | Separate short-lived admin connection used only in a controlled migration window | Ordered DDL and migration-ledger writes after backup and target verification | Any deployed Worker secret/binding or ordinary application request path |

For guest, webhook, admin and maintenance capabilities, prefer
`SECURITY DEFINER` functions only where atomicity or non-user execution requires
them. Each such function needs a fixed safe `search_path`, a non-login and
least-privilege owner, explicit input validation, a narrowly scoped owner/event
check, and `EXECUTE` grants only to the intended caller role. Do not create a
generic table dispatcher or an owner-controlled SQL parameter.

Before claiming the restored role is least-privilege, the target tests must
prove both sides: the public HTTP Worker cannot run arbitrary SQL or cross-owner
queries with its credential, while each approved organizer/guest/job/webhook
workflow still succeeds through its intended JWT policy or named function.
The present `lumiq_runtime` role fails that criterion; this review does not
change its flags or grants.

## Safe Rollout Plan

1. Keep the restore candidate owner-only behind Cloudflare Access, release-locked after each smoke test, and bound only to restore resources. Do not reuse this database or role in production.
2. Build an exact per-table/per-operation inventory for organizer API, guest API, webhook, admin and background jobs. Split broad operations into specific server functions; mark unused grants, especially `platform_migrations` writes and broad default privileges.
3. Implement the user/guest identity transport and database policy model in isolated tests. Prove that clients cannot choose another `auth.uid()` and that a stolen shared DB password cannot set an arbitrary tenant identity; do not count app-set session variables as proof.
4. Add PostgreSQL integration tests using the intended non-bypass roles and JWT/RPC path. Cover cross-organizer SELECT/INSERT/UPDATE/DELETE, guest-token boundaries, admin-only actions, webhook signature failures, queue jobs, and account role protection.
5. Deploy the refactor only to the isolated restore candidate. Run auth, profile, event, guest photo, gallery, deletion, ZIP and retention smoke tests; verify data and bindings; then return the candidate to its locked release state.
6. Only after review and explicit approval, prepare a separate production migration/deployment plan. Do not carry restore secrets, Hyperdrive, R2, test data, or credentials into production.

## Completion Gates

- [x] Runtime tables, broad grants, and default privilege source identified.
- [x] Live role flags, core RLS flags, policy count, and table privilege totals checked read-only.
- [x] Worker SQL/application ownership boundaries mapped at table and subsystem level.
- [x] Target role and request-path design proposed without changing database state.
- [ ] Detailed policy/function schema and grant list reviewed before implementation.
- [ ] PostgreSQL integration tests pass using proposed identities and roles.
- [ ] Isolated candidate smoke tests pass after the refactor.
- [ ] Separate production security review and explicit release approval.
