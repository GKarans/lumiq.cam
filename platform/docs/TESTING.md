# Local testing report

> For the current Lumiq Production QA status, including the recorded
> 2026-10-01 local verification and explicitly untested live flows, see
> [PRODUCTION-QA-REPORT-LV.md](PRODUCTION-QA-REPORT-LV.md).

Baseline date: 2026-09-13. Repository: `gala-produkts-saas`.
Environment: Windows, Node, PGlite PostgreSQL engine, local files and headless Chromium.
Scope: new `platform/` product only. This is not a re-certification of the original MVP or its live services.

## Repeatable commands

```powershell
npm test
npm run build
npm run browser
```

`npm run check` runs secret/dependency security checks, backend tests, build validation and the browser suite. Browser verification starts a temporary loopback server on a free port, uses an in-memory database and temporary objects, and stops the process afterward. The existing preview on port 5700 is not used or reset.

Use `npm run browser` for the complete isolated Chromium suite. Prefer `npm run check` before every commit or pull request.

## Executed evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Backend integration and unit tests | PASS; 51 tests, zero failures on 2026-09-18 | `tests/*.test.mjs` |
| Public build boundary | PASS, public asset allowlist; no deployment | `scripts/build.mjs` |
| Responsive browser checks | PASS at 320, 390, 768 and 1440px | `tests/browser.cjs` |
| Customer journey | PASS, register/verify/login, draft/publish, 20 successful photos including transient retry | `tests/journey.cjs` |
| Guest designer | PASS, no sliders, direct manipulation, text/style edits, save/reload, mobile and real guest output | `tests/designer.cjs` |
| External browser requests in upload journey | None observed | Request assertion in journey test |
| Cloud/provider deployment | NOT RUN | New resources intentionally absent |
| Physical camera and Safari | NOT RUN for this product branch | Chromium viewport testing is not a physical-device test |

Screenshots and `browser-report.json` are generated in `platform/test-results/` (ignored by Git). Images were visually reviewed for page framing, text overflow, controls and cover rendering. They are local evidence, not production screenshots.

Publication allowances verified: Explore once per account, Gathering four and Studio twelve new publications per paid period. Ending, deleting or changing plans in the same period does not reset consumption. Single Event checkout grants exactly one separate pass without replacing a subscription. Invalid publication rolls consumption back. All five browser suites passed, including the one-time checkout and explicit pass-publication journey. These use isolated local data and simulated/mocked providers, not real payments.

## Refinement evidence, 2026-09-14

- Pricing actions aligned at 390/768/1100/1440px; equal heights and row positions asserted.
- Shared viewer portrait/landscape frame and arrows remain fixed; backdrop and swipe tested.
- Custom label/color saved and reloaded; five bundled covers decode successfully.
- LV preference and translated public, legal and workspace routes survive reload; customer-authored event content remains unchanged.
- Local profile and password-change tests reject incorrect credentials and revoke all sessions/reset links.
- Gathering-derived Lumiq public pages checked at mobile and desktop sizes.
- Dependency installation audit reported zero vulnerabilities on 2026-09-14; not an independent penetration test.

## Backend coverage

Publication regression additions: two simultaneous requests for the last subscription slot produce only one success; two requests for one Single Event pass produce only one publication; another account cannot consume that pass; restoring an ended unpublished draft keeps it private and does not consume the trial. These run against the isolated PGlite engine; multi-process target PostgreSQL concurrency must still be validated in staging.

- Authentication: verified account, one-use links, cookie session, logout, CSRF and wrong-owner denial.
- Lifecycle: hidden IANA-to-UTC conversion, invalid/ambiguous DST times, publish/pause/resume, closed-event reservations.
- Upload: forged bytes, paired checksums, missing file, quota enforcement, stable ID retry and no duplicate finalization.
- Gallery: 25 photos across 24+1 pages, no original object keys in grid metadata, viewer-zone date filtering.
- Sharing: disabled, expired, exhausted allowance, archive and restore boundaries.
- Export: all 25 IDs in the manifest, expired worker lease recovery, reusable persisted ZIP.
- Cleanup: metadata-first deletion, abandoned reservations, delayed discard, retry after storage failure, thumbnail repair.
- Cover: old file removed only after replacement attachment; failed attachment remains tracked for cleanup.
- Billing: signed/expired/tampered webhook, duplicate and delayed delivery, canonical subscription state and correct customer portal identifier.
- Auth adapter: provider access/refresh tokens encrypted in DB and absent from browser cookies; Google PKCE parameters and tampered-state rejection.
- Draft preview: 15-minute owner QR opens a read-only design and rejects guest actions.
- Capacity: stable cursor traversal across a Studio-sized 1,000-photo dataset.
- Limits: shared database allowance and spoofed forwarded-address rejection.
- Migrations: fresh apply, idempotent rerun, checksum mismatch refusal and forward upgrade.
- Mail: notice deduplication, backoff, crash lease recovery, stable provider idempotency key and failed final attempt.

The expected `processing-failed` log in the storage-outage test is intentional fault injection, not a failed test.

## Problems found and corrected during local verification

1. Desktop/mobile header and long unbroken title overflow: constrained layouts and mobile action stacking.
2. Different editor versus guest appearance: shared cover geometry and style normalization.
3. Font selection reset during a generic input handler: limited text handling to text controls.
4. Floating zoom rounding: normalized persisted values.
5. Sample event becoming permanently closed: only the known local demo event receives a refreshed demo period.
6. Repeated support replies not sent to an inbox: transactional reply/outbox insertion.
7. Cover upload followed by failed DB update leaving untracked data: pre-reserved cleanup job.
8. Concurrent service-email workers picking the same rows: DB leases and provider idempotency.
9. Date labels and filter using different zones: viewer zone supplied invisibly and validated server-side.

## Manual tests and remaining risk

Follow the exact physical-device script and target-environment gates in [LAUNCH-GATES.md](LAUNCH-GATES.md). Use [SETUP.md](SETUP.md) only for NEW isolated services.

- Browser tests use tiny synthetic JPEGs. They do not establish 20 high-resolution camera photos on a low-memory phone.
- R2 signatures and Supabase/Stripe adapters exist, but mocks/local files do not prove live provider behavior.
- Prepared ZIPs are bounded in source-byte batches; maximum advertised capacity still needs measured CPU/memory testing.
- Refresh restores bounded pending source photos from IndexedDB. Closing the browser still has no background-upload guarantee.
- Read-time revocation cannot retract files already downloaded or response bytes already in flight.
- No independent legal/security approval, real cloud backup restore, real feedback or paid pilot has occurred.

## New result template

Record: date, working-tree version, environment, tester/device, steps, expected result, actual result, screenshot/log path, severity, fix and rerun. Do not record passwords, auth links, signed URLs, secrets or confidential photo contents in public reports.
