# Backup and restore drill

## Scope

The backup contains the Lumiq public application tables, Supabase Auth user/identity rows, every private R2 object, and a manifest with database/object sizes and SHA-256 checksums. It deliberately excludes Supabase-managed schema definitions and extension-owned public tables. Verification rejects missing integrity metadata, altered files, size mismatches and paths escaping the backup directory. Credentials are read only from the process environment and never written to the archive.

## Backup

1. Install PostgreSQL 17 **Command Line Tools** only; a local PostgreSQL server is not required. The [official PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) links to the EDB installer, where Command Line Tools can be selected as a component. The helper checks `%LOCALAPPDATA%\Lumiq\postgresql17\bin`, `%USERPROFILE%\AppData\Local\Lumiq\postgresql17\bin`, `%ProgramFiles%\PostgreSQL\17\bin`, and the current `PATH`, then confirms both clients are major version 17.
2. Run `platform/scripts/backup-local.ps1`. It prompts for credentials locally, validates the source project and bucket, then verifies the archive.
3. Keep the verified backup directory outside the repository, encrypt it at rest, and record duration, dump size, object count and manifest checksum.

## Production backup

The closed-test backup command above is pinned to closed-test and must never be
used for production. The separate `npm run backup:production` command is pinned
to Supabase project `baqebydtinysosueksgr`, source bucket
`lumiq-production-photos`, and destination bucket
`lumiq-production-backups`. It only reads the production database and photo
objects; it does not apply migrations or change Worker bindings.

The PowerShell wrapper asks for the Supabase `postgres` administrator password
and two bucket-scoped R2 keys in masked prompts: a read-only key for
`lumiq-production-photos` and a read/write key for `lumiq-production-backups`.
Each S3 client uses only its own bucket-scoped key. The script makes a consistent PostgreSQL snapshot, captures
public tables and Supabase Auth users/identities, hashes every dump/photo,
uploads under a unique `production/<timestamp>` prefix, then reads every
uploaded object back and verifies size and SHA-256. Temporary local files are
removed only after all remote checks pass. On failure, the script warns that
the temporary directory remains and must be secured before investigation.

This command has not yet been run against production. It does not complete a
restore drill: do not reuse the closed-test restore project or bucket. First
create a separate empty recovery Supabase project and R2 bucket for Lumiq
Production, then download this exact R2 backup and restore/verify it there.

## Restore drill

1. Create a new empty Supabase drill project and a new empty private R2 bucket. Never target production or the source project.
2. Run `platform/scripts/restore-local.ps1` for the pinned Lumiq drill target. It verifies the project ref and backup before writes and refuses Auth users or any non-empty R2 bucket. A partial public-schema restore may be retried only after the script verifies every existing public table belongs to this backup and the operator types the exact target-specific reset phrase; it uses `pg_restore --clean --if-exists` only for objects in the verified archive.
3. Enter the DB URL, bucket-scoped R2 credentials and a separate random URL-safe password for the restricted `lumiq_runtime` role into the script's masked prompts. Public schema restore uses a single transaction, skips source ACL entries, then provisions the server runtime role and its table grants while revoking `anon`/`authenticated` table access. The role has `BYPASSRLS` in the current direct-PostgreSQL architecture, so database RLS does not constrain Worker queries; this is an explicit security-review risk, not tenant isolation. Database and R2 credentials are not retained after the script exits.
4. Run migrations, start web and worker services against the drill targets, then test login, event ownership, thumbnails, full photos and one ZIP export.
5. Compare database row counts and sampled object SHA-256 values with the manifest. Destroy the drill environment after evidence is retained.

Auth provider settings (OAuth, email templates, redirect allowlist and SMTP) are not database rows; configure them separately in the drill project. Existing sessions are not preserved, so users must sign in again. The cloud restore drill is not complete until an isolated target project/bucket exists and the restored app passes the listed smoke tests.
