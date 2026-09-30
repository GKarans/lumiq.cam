import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const [backup,wrapper,vaultWrapper,vaultTest,packageJson,verifyRuntime,rotateRuntime,rotateSafeRuntime,restoreAudit,restoreApply,checkRecoveryR2,provisionSafeRuntime,recoveryRestore,checkProductionBackup,putWorkerSecret,securityScan]=await Promise.all([
 readFile(new URL('../scripts/backup-production.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/backup-production.ps1',import.meta.url),'utf8'),
 readFile(new URL('../scripts/production-secrets.ps1',import.meta.url),'utf8'),
 readFile(new URL('./production-secrets-vault.ps1',import.meta.url),'utf8'),
 readFile(new URL('../../package.json',import.meta.url),'utf8'),
 readFile(new URL('../scripts/verify-production-runtime.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/rotate-runtime-password.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/rotate-production-safe-runtime.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/audit-restore-drill-migrations.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/apply-restore-drill-migrations.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/check-recovery-r2.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/provision-production-safe-runtime.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/restore-production-recovery.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/check-production-backup.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/put-production-worker-secret.mjs',import.meta.url),'utf8'),
 readFile(new URL('../scripts/security-scan.mjs',import.meta.url),'utf8')
]);

test('Production email key and session key use fixed Worker bindings and stdin only',()=>{
 assert.match(vaultWrapper,/save-production-email/);
 assert.match(vaultWrapper,/set-candidate-email-secret/);
 assert.match(vaultWrapper,/LUMIQ_PRODUCTION_EMAIL_KEY/);
 assert.match(putWorkerSecret,/PLATFORM_EMAIL_KEY/);
 assert.match(putWorkerSecret,/PLATFORM_SESSION_ENCRYPTION_KEY/);
 assert.match(putWorkerSecret,/--name',targetWorker\]/);
 assert.match(putWorkerSecret,/\['lumiq-production-candidate','lumiq-production'\]/);
 assert.match(putWorkerSecret,/child\.stdin\.end\(`\$\{secret\}\\n`\)/);
 assert.match(putWorkerSecret,/name!==source\.name/);
 assert.doesNotMatch(putWorkerSecret,/--text|console\.log\([^\n]*secret/);
});

test('secret scanner checks unignored local files as well as tracked repository files',()=>{
 assert.match(securityScan,/ls-files','--cached','--others','--exclude-standard/);
 assert.match(securityScan,/tracked and unignored workspace files/);
});

test('production backup is pinned to the independent production project and R2 buckets',()=>{
 assert.match(backup,/sourceProject='baqebydtinysosueksgr'/);
 assert.match(backup,/sourceBucket='lumiq-production-photos'/);
 assert.match(backup,/backupBucket='lumiq-production-backups'/);
 assert.match(backup,/endpoint='https:\/\/af664043db99694ff5a6ac88a7e7dc4d\.eu\.r2\.cloudflarestorage\.com'/);
 assert.doesNotMatch(backup,/cpweowosocjuccjsyyic|lumiq-closed-test-photos|sprzlvywzpeyuzbsyplz/);
 assert.match(backup,/PLATFORM_MIGRATIONS\.map\(entry=>entry\.version\)/);
 assert.match(backup,/Production migration ledger does not match the complete application manifest/);
 assert.match(backup,/lumiq_production_runtime state is not the reviewed least-privilege state/);
 assert.match(backup,/migrations\.length\} migrations/);
});

test('production backup validates and hashes a private R2 copy without changing database schema',()=>{
 assert.match(backup,/pg_export_snapshot\(\)/);
 assert.match(backup,/--format=custom','--data-only','--no-owner','--no-acl/);
 assert.match(backup,/--exclude-table-data=public\.platform_migrations/);
 assert.match(backup,/format_version:4/);
 assert.match(backup,/public_dump:'data-only'/);
 assert.match(backup,/migrations/);
 assert.match(backup,/--table=auth\.users/);
 assert.match(backup,/--table=auth\.identities/);
 assert.match(backup,/PutObjectCommand/);
 assert.match(backup,/GetObjectCommand/);
 assert.match(backup,/Uploaded backup checksum mismatch/);
 assert.match(backup,/await rm\(root,\{recursive:true\}\)/);
 assert.doesNotMatch(backup,/\b(?:alter|create|drop)\s+(?:table|role|schema)\b/i);
});

test('production backup secrets are collected via masked prompts and are not inherited by pg_dump',()=>{
 assert.match(wrapper,/Read-Host -Prompt \$Prompt -AsSecureString/);
 for(const name of ['LUMIQ_PRODUCTION_DB_PASSWORD','LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY','LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY']){
  assert.ok(wrapper.includes(name));
  assert.ok(backup.includes(name));
 }
 assert.match(backup,/delete cliEnvironment\[name\]/);
 assert.match(backup,/sourceS3=new S3Client/);
 assert.match(backup,/backupS3=new S3Client/);
 assert.match(backup,/sourceS3\.send\(new GetObjectCommand\(\{Bucket:sourceBucket/);
 assert.match(backup,/backupS3\.send\(new PutObjectCommand\(\{Bucket:backupBucket/);
 assert.match(packageJson,/"backup:production"/);
});

test('production credentials use a per-user DPAPI vault outside the repository',()=>{
 assert.match(vaultWrapper,/Join-Path \$env:APPDATA 'Lumiq'/);
 assert.match(vaultWrapper,/production-secrets\.clixml/);
 assert.match(vaultWrapper,/Export-Clixml/);
 assert.match(vaultWrapper,/Read-Host -Prompt .* -AsSecureString/);
 assert.match(vaultWrapper,/run-backup/);
 assert.match(vaultWrapper,/run-runtime-check/);
 assert.match(vaultWrapper,/run-safe-runtime-check/);
 assert.match(vaultWrapper,/run-safe-runtime-bootstrap-check/);
 assert.match(vaultWrapper,/provision-production-safe-runtime/);
 assert.match(vaultWrapper,/copy-production-safe-runtime/);
 assert.match(vaultWrapper,/Copied the Production safe-runtime password to the clipboard without printing it/);
 assert.match(vaultWrapper,/create-production-session-key/);
 assert.match(vaultWrapper,/RandomNumberGenerator\]::GetBytes\(32\)/);
 assert.match(vaultWrapper,/LUMIQ_PRODUCTION_SESSION_ENCRYPTION_KEY/);
 assert.match(vaultWrapper,/Generated a unique 256-bit Production session-encryption key/);
 assert.match(vaultWrapper,/save-recovery-r2/);
 assert.match(vaultWrapper,/check-recovery-r2/);
 assert.match(vaultWrapper,/save-recovery/);
 assert.match(vaultWrapper,/create-recovery-runtime/);
 assert.match(vaultWrapper,/create-recovery-db-password/);
 assert.match(vaultWrapper,/save-recovery-db-password/);
 assert.match(vaultWrapper,/A Recovery database password already exists in the DPAPI vault; refusing to replace it/);
 assert.match(vaultWrapper,/Set-Clipboard -Value/);
 assert.match(vaultWrapper,/Clear the clipboard after pasting/);
 assert.match(vaultWrapper,/A Recovery runtime password already exists in the DPAPI vault; refusing to replace it/);
 assert.match(vaultWrapper,/New-RandomSecurePassword/);
 assert.match(vaultWrapper,/run-recovery-restore/);
 assert.match(vaultWrapper,/apply-recovery-migrations/);
 assert.match(vaultWrapper,/save-restore-drill/);
 assert.match(vaultWrapper,/apply-restore-drill-runtime/);
 assert.match(vaultWrapper,/audit-restore-drill-migrations/);
 assert.match(vaultWrapper,/apply-restore-drill-migrations/);
 assert.match(vaultWrapper,/apply-production-runtime/);
 for(const name of ['LUMIQ_RECOVERY_DB_PASSWORD','LUMIQ_RECOVERY_R2_ACCESS_KEY_ID','LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY','LUMIQ_RECOVERY_RUNTIME_PASSWORD'])assert.ok(vaultWrapper.includes(name));
 assert.match(vaultTest,/serialized\.Contains\(\$probe\)/);
 assert.match(vaultTest,/DPAPI round-trip passed/);
});

test('Production safe runtime provisioning is pinned, least-privilege and preserves the legacy role',()=>{
 assert.match(provisionSafeRuntime,/projectRef = 'baqebydtinysosueksgr'/);
 assert.match(provisionSafeRuntime,/lumiq_production_runtime/);
 assert.match(provisionSafeRuntime,/PLATFORM_MIGRATIONS\.slice\(0, 13\)/);
 assert.match(provisionSafeRuntime,/pre-migration RLS baseline/);
 assert.match(provisionSafeRuntime,/rolbypassrls/);
 assert.match(provisionSafeRuntime,/noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication/);
 assert.match(provisionSafeRuntime,/rolreplication/);
 assert.match(provisionSafeRuntime,/grant select\(version\) on public\.platform_migrations/);
 assert.match(provisionSafeRuntime,/has_memberships/);
 assert.match(provisionSafeRuntime,/legacy lumiq_runtime was unchanged/i);
 assert.match(provisionSafeRuntime,/has_other_column_grants/);
 assert.match(provisionSafeRuntime,/has_function_grants/);
 assert.match(provisionSafeRuntime,/owns_objects/);
 assert.match(provisionSafeRuntime,/production_runtime_migration_version_read/);
 assert.match(provisionSafeRuntime,/case when c\.relkind='S' then has_sequence_privilege/);
 assert.match(provisionSafeRuntime,/No password values were printed/);
 assert.doesNotMatch(provisionSafeRuntime,/grant\s+(?:select|insert|update|delete)\s+on\s+all\s+tables/i);
 assert.doesNotMatch(provisionSafeRuntime,/alter role lumiq_runtime|drop role lumiq_runtime/i);
});

test('Production safe-runtime rotation is pinned, checks all migrations and never prints credentials',()=>{
 assert.match(rotateSafeRuntime,/projectRef='baqebydtinysosueksgr'/);
 assert.match(rotateSafeRuntime,/lumiq_production_runtime/);
 assert.match(rotateSafeRuntime,/PLATFORM_MIGRATIONS\.map\(entry=>entry\.version\)/);
 assert.match(rotateSafeRuntime,/rolbypassrls/);
 assert.match(rotateSafeRuntime,/new credential login verification/);
 assert.match(rotateSafeRuntime,/replaceAll\(runtimePassword,'\[redacted\]'\)/);
 assert.match(vaultWrapper,/rotate-production-safe-runtime/);
 assert.match(vaultWrapper,/LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD_PENDING/);
});

test('Recovery R2 credential check is EU-scoped, read-only, and never prints credentials',()=>{
 assert.match(checkRecoveryR2,/bucket = 'lumiq-production-recovery'/);
 assert.match(checkRecoveryR2,/\.eu\.r2\.cloudflarestorage\.com/);
 assert.match(checkRecoveryR2,/ListObjectsV2Command/);
 assert.match(checkRecoveryR2,/error\.Code.*?replace/);
 assert.match(checkRecoveryR2,/status === 401/);
 assert.match(checkRecoveryR2,/Access Key ID and Secret Access Key/);
 assert.match(checkRecoveryR2,/do not use its Token value/);
 assert.match(checkRecoveryR2,/A-Za-z0-9_-.*slice\(0, 48\)/);
 assert.doesNotMatch(checkRecoveryR2,/PutObjectCommand|DeleteObjectCommand|CreateBucketCommand/);
 assert.match(checkRecoveryR2,/No credentials were printed/);
 assert.doesNotMatch(checkRecoveryR2,/console\.(?:log|error)\([^\n]*(?:accessKeyId|secretAccessKey)/i);
});

test('Production recovery restore uses a new isolated target, verified latest backup and temporary local data',()=>{
 assert.match(recoveryRestore,/productionProject='baqebydtinysosueksgr'/);
 assert.match(recoveryRestore,/aws-1-eu-central-1\.pooler\.supabase\.com/);
 assert.doesNotMatch(recoveryRestore,/aws-0-eu-central-1\.pooler\.supabase\.com/);
 assert.match(recoveryRestore,/protectedProjects=new Set\(\[productionProject,'sprzlvywzpeyuzbsyplz','cpweowosocjuccjsyyic'\]\)/);
 assert.match(recoveryRestore,/backupBucket='lumiq-production-backups'/);
 assert.match(recoveryRestore,/recoveryBucket='lumiq-production-recovery'/);
 assert.ok(recoveryRestore.includes("Prefix:'production/',Delimiter:'/'"));
 assert.match(recoveryRestore,/CommonPrefixes/);
 assert.match(recoveryRestore,/prefixes\.sort\(\)\.at\(-1\)/);
 assert.match(recoveryRestore,/remote_prefix!==prefix/);
 assert.match(recoveryRestore,/\[3,4\]\.includes\(manifest\.format_version\)/);
 assert.match(recoveryRestore,/assertEmptyPublicSchema\(preflightDb\)/);
 assert.match(recoveryRestore,/apply-restore-drill-migrations\.mjs/);
 assert.match(recoveryRestore,/LUMIQ_MIGRATION_TARGET:'recovery'/);
 assert.match(recoveryRestore,/verify-backup\.mjs/);
 assert.match(recoveryRestore,/restore-drill\.mjs/);
 assert.match(recoveryRestore,/PLATFORM_RESTORE_TARGET_REF:projectRef/);
 assert.match(recoveryRestore,/await rm\(root,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(recoveryRestore,/console\.(?:log|error)\([^\n]*(?:databasePassword|runtimePassword|accessKeyId|secretAccessKey)/i);
});

test('latest Production backup verifier is bucket-pinned, read-only and runs through the DPAPI vault',()=>{
 assert.match(checkProductionBackup,/bucket='lumiq-production-backups'/);
 assert.match(checkProductionBackup,/endpoint='https:\/\/af664043db99694ff5a6ac88a7e7dc4d\.eu\.r2\.cloudflarestorage\.com'/);
 assert.match(checkProductionBackup,/source_project_ref!==project/);
 assert.match(checkProductionBackup,/remote_bucket!==bucket/);
 assert.match(checkProductionBackup,/ListObjectsV2Command/);
 assert.match(checkProductionBackup,/GetObjectCommand/);
 assert.match(checkProductionBackup,/verify-backup\.mjs/);
 assert.doesNotMatch(checkProductionBackup,/PutObjectCommand|DeleteObjectCommand|CreateBucketCommand/);
 assert.doesNotMatch(checkProductionBackup,/console\.(?:log|error)\([^\n]*(?:accessKeyId|secretAccessKey)/i);
 assert.match(checkProductionBackup,/No credentials were printed/);
 assert.match(vaultWrapper,/check-production-backup/);
 assert.match(vaultWrapper,/check-production-backup\.mjs/);
});

test('Restore Drill migration apply is pinned, checksum-gated, forward-only, and verifies hardened access',()=>{
 assert.match(restoreApply,/targetMode = process\.env\.LUMIQ_MIGRATION_TARGET \|\| 'restore-drill'/);
 assert.match(restoreApply,/\['restore-drill', 'recovery', 'production'\]/);
 assert.match(restoreApply,/productionMode \? 'baqebydtinysosueksgr'/);
 assert.match(vaultWrapper,/apply-production-migrations/);
 assert.match(restoreApply,/projectRef = recoveryMode \? process\.env\.LUMIQ_RECOVERY_PROJECT_REF : productionMode \? 'baqebydtinysosueksgr' : 'sprzlvywzpeyuzbsyplz'/);
 assert.match(restoreApply,/host = recoveryMode \? 'aws-1-eu-central-1\.pooler\.supabase\.com' : 'aws-0-eu-central-1\.pooler\.supabase\.com'/);
 assert.match(restoreApply,/protectedProjects = new Set\(\['baqebydtinysosueksgr', 'sprzlvywzpeyuzbsyplz', 'cpweowosocjuccjsyyic'\]\)/);
 assert.match(restoreApply,/skipMigrations: true/);
 assert.match(restoreApply,/ledgerState\.public_tables !== 0/);
 assert.match(restoreApply,/new, empty Recovery project/);
 assert.match(restoreApply,/exact manifest prefix/);
 assert.match(restoreApply,/checksum !== applied\[index\]\.checksum/);
 assert.match(restoreApply,/PLATFORM_MIGRATIONS\.slice\(applied\.length\)/);
 assert.match(restoreApply,/lumiq_api_owner','lumiq_admin_owner','lumiq_billing_owner','lumiq_support_owner','lumiq_session_owner','lumiq_preview_owner/);
 assert.match(restoreApply,/rolbypassrls/);
 assert.match(restoreApply,/rolreplication/);
 assert.match(restoreApply,/noreplication/);
 assert.match(restoreApply,/tables_without_rls/);
 assert.doesNotMatch(restoreApply,/\b(?:drop|truncate)\s+(?:table|role|schema)\b/i);
 assert.doesNotMatch(restoreApply,/console\.(?:log|error)\([^\n]*password|console\.(?:log|error)\([^\n]*connection/i);
});

test('Restore Drill migration audit is pinned, read-only, and reports manifest gaps without exposing credentials',()=>{
 assert.match(restoreAudit,/projectRef = 'sprzlvywzpeyuzbsyplz'/);
 assert.match(restoreAudit,/LUMIQ_RESTORE_DRILL_DB_PASSWORD/);
 assert.match(restoreAudit,/set transaction read only/);
 assert.match(restoreAudit,/PLATFORM_MIGRATIONS\s*\.filter\(entry\s*=>\s*entry\.version\s*!==\s*'046-production-runtime-access-hardening'\)/);
 assert.match(restoreAudit,/missing:/);
 assert.match(restoreAudit,/checksumMismatches/);
 assert.match(restoreAudit,/runtimeRoleMemberships/);
 assert.match(restoreAudit,/rolreplication/);
 assert.match(restoreAudit,/createHash\('sha256'\)/);
 assert.doesNotMatch(restoreAudit,/\b(?:alter|create|drop|insert|update|delete)\s+(?:table|role|schema|into|set)\b/i);
 assert.doesNotMatch(restoreAudit,/console\.(?:log|error)\([^\n]*password/);
});

test('runtime password rotation is pinned to Restore Drill and Production and preserves role flags',()=>{
 assert.match(rotateRuntime,/'restore-drill':\{ref:'sprzlvywzpeyuzbsyplz'/);
 assert.match(rotateRuntime,/ref:'baqebydtinysosueksgr'/);
 assert.match(rotateRuntime,/current_user as database_user/);
 assert.match(rotateRuntime,/database_user!=='postgres'/);
 assert.match(rotateRuntime,/select format\('alter role lumiq_runtime password %L',\$\{runtimePassword\}::text\)/);
 assert.match(rotateRuntime,/JSON\.stringify\(after\)!==JSON\.stringify\(role\)/);
 assert.match(rotateRuntime,/during \$\{stage\} \(\$\{code\}\)/);
 assert.match(rotateRuntime,/replaceAll\(adminPassword,'\[redacted\]'\)/);
 assert.match(rotateRuntime,/database URL redacted/);
 assert.doesNotMatch(rotateRuntime,/console\.(?:log|error)\([^\n]*runtimePassword/);
});

test('production runtime verifier is pinned read-only and masks the password',()=>{
 assert.match(verifyRuntime,/projectRef='baqebydtinysosueksgr'/);
 assert.match(verifyRuntime,/\$\{roleName\}\.\$\{projectRef\}/);
 assert.match(verifyRuntime,/setRawMode\(true\)/);
 assert.match(verifyRuntime,/PLATFORM_MIGRATIONS\.slice\(0,13\)/);
 assert.match(verifyRuntime,/lumiq_production_runtime/);
 assert.match(verifyRuntime,/LUMIQ_PRODUCTION_RUNTIME_ROLE/);
 assert.match(verifyRuntime,/LUMIQ_PRODUCTION_RUNTIME_PHASE/);
 assert.match(verifyRuntime,/safe runtime bootstrap grants check/);
 assert.match(verifyRuntime,/column_select/);
 assert.match(verifyRuntime,/column_write/);
 assert.match(verifyRuntime,/securityDefinerRpcAllowlist/);
 assert.match(verifyRuntime,/internalRpcAllowlist/);
 assert.match(verifyRuntime,/const authRpcOwners=\['lumiq_api_owner','lumiq_admin_owner','lumiq_billing_owner','lumiq_support_owner','lumiq_session_owner','lumiq_preview_owner'\]/);
 assert.match(verifyRuntime,/One or more JWT-bound Auth RPC owners are missing auth schema USAGE/);
 assert.match(verifyRuntime,/rolbypassrls/);
 assert.match(verifyRuntime,/rolreplication/);
 assert.match(verifyRuntime,/LUMIQ_PRODUCTION_RUNTIME_PASSWORD/);
 assert.match(verifyRuntime,/anon_direct_select/);
 assert.match(verifyRuntime,/authenticated_direct_select/);
 assert.match(verifyRuntime,/No database changes were made/);
 assert.match(verifyRuntime,/during \$\{stage\} \(\$\{code\}\)/);
 assert.doesNotMatch(verifyRuntime,/\b(?:alter|create|drop|insert|update|delete)\s+(?:table|role|schema|into|set)\b/i);
});

test('Production auth grant inspection is pinned, read-only, and uses the DPAPI secret wrapper',async()=>{
 const inspector=await readFile(new URL('../scripts/inspect-production-auth-grants.mjs',import.meta.url),'utf8');
 const wrapper=await readFile(new URL('../scripts/production-secrets.ps1',import.meta.url),'utf8');
 assert.match(inspector,/const projectRef = 'baqebydtinysosueksgr'/);
 assert.match(inspector,/has_schema_privilege\('lumiq_api_owner','auth','usage'\)/);
 assert.match(inspector,/const authSchemaRoles = \(await db\.query/);
 assert.match(inspector,/auth_uid_execute/);
 assert.match(inspector,/auth_schema_owner/);
 assert.match(inspector,/migrationLedger/);
 assert.doesNotMatch(inspector,/^\s*(?:grant|revoke|insert|update|delete|create|alter)\b/im);
 assert.match(wrapper,/inspect-production-auth-grants/);
 assert.match(wrapper,/Set-ProcessSecret 'LUMIQ_PRODUCTION_DB_PASSWORD'/);
});
