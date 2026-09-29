import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { assertEmptyAuthUsers, ensureProductionCompatibilityRole, inspectPublicRestoreState, libpqConnectionForCli, provisionRestoredRuntimeRole, validateRestoreTarget, waitForChildExit } from './restore-safety.mjs';
import {assertObjectInventory,assertTableInventory} from './restore-verification.mjs';

if (process.env.PLATFORM_RESTORE_DRILL !== 'EMPTY-ISOLATED-TARGET') {
  throw new Error('Set PLATFORM_RESTORE_DRILL=EMPTY-ISOLATED-TARGET only for a new empty drill environment.');
}

const backupDirectory = process.argv[2];
if (!backupDirectory) throw new Error('Usage: node platform/scripts/restore-drill.mjs <backup-directory>');

const database = process.env.PLATFORM_DATABASE_URL;
const bucket = process.env.PLATFORM_R2_BUCKET;
const endpoint = process.env.PLATFORM_R2_ENDPOINT;
if (!database || !bucket || !endpoint || !process.env.PLATFORM_R2_ACCESS_KEY_ID || !process.env.PLATFORM_R2_SECRET_ACCESS_KEY || !process.env.PLATFORM_RUNTIME_PASSWORD) throw new Error('Load the isolated restore target credentials and runtime-role password.');
const targetProjectRef=validateRestoreTarget(database, process.env.PLATFORM_RESTORE_TARGET_REF);
const cliConnection=libpqConnectionForCli(database),cliEnvironment={...process.env,PGPASSWORD:cliConnection.password};
for(const name of ['PLATFORM_DATABASE_URL','PLATFORM_R2_ACCESS_KEY_ID','PLATFORM_R2_SECRET_ACCESS_KEY','PLATFORM_RUNTIME_PASSWORD','PLATFORM_RESTORE_TARGET_REF','PLATFORM_RESTORE_DRILL','PLATFORM_RESTORE_ALLOW_PARTIAL'])delete cliEnvironment[name];

const root = path.resolve(backupDirectory);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const verification = spawn(process.execPath, [path.join(scripts, 'verify-backup.mjs'), root], {
  stdio: 'inherit',
  windowsHide: true
});
if (await waitForChildExit(verification) !== 0) {
  throw new Error('Backup integrity verification failed; restore was not started.');
}
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const migrationFirstRestore=manifest.format_version===4;
if (targetProjectRef === manifest.database.source_project_ref) throw new Error('Restore target must be a different Supabase project from the source.');
if (bucket === manifest.bucket) throw new Error('Restore target R2 bucket must be different from the source bucket.');

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.PLATFORM_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.PLATFORM_R2_SECRET_ACCESS_KEY
  }
});
const existing = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
if (existing.KeyCount) throw new Error('Restore target bucket is not empty.');

const sql = postgres(database, { ssl: 'require', max: 1 });
let partialRestore = false;
try {
  if(migrationFirstRestore){
    const applied=(await sql`select version from public.platform_migrations order by version`).map(row=>row.version);
    const expected=manifest.database.migrations.map(entry=>entry.version);
    if(JSON.stringify(applied)!==JSON.stringify(expected))throw new Error('Version 4 restore target migration ledger does not match the verified backup chain.');
    const [tables]=await sql`select count(*)::integer as count from information_schema.tables where table_schema='public' and table_name not in ('spatial_ref_sys','geometry_columns','geography_columns')`;
    if(tables.count!==manifest.database.tables.filter(table=>table.schema==='public').length)throw new Error('Version 4 restore target schema does not match the applied migration chain.');
  }else{
    partialRestore = await inspectPublicRestoreState(sql, manifest.database.tables, { allowPartial: process.env.PLATFORM_RESTORE_ALLOW_PARTIAL === '1' });
  }
  await assertEmptyAuthUsers(sql);
  await ensureProductionCompatibilityRole(sql);
} finally {
  await sql.end();
}
if (partialRestore) console.log('Confirmed retry: cleaning only objects listed in this verified Lumiq backup.');

const restoreArgs = [
  '--exit-on-error',
  '--no-owner',
  '--no-privileges',
  ...(migrationFirstRestore ? ['--data-only'] : []),
  '--single-transaction',
  ...(partialRestore ? ['--clean', '--if-exists'] : []),
  '--dbname',
  cliConnection.connectionString,
  path.join(root, 'database.dump')
];
const pgRestore = spawn('pg_restore', restoreArgs, { stdio: 'inherit', windowsHide: true, env:cliEnvironment });
if (await waitForChildExit(pgRestore) !== 0) {
  throw new Error('Database restore failed. The public-schema restore used one transaction; investigate the cause before retrying.');
}

const authRestore = spawn('pg_restore', [
  '--data-only',
  '--exit-on-error',
  '--no-owner',
  '--no-privileges',
  '--single-transaction',
  '--dbname',
  cliConnection.connectionString,
  path.join(root, manifest.database.auth_file)
], { stdio: 'inherit', windowsHide: true, env:cliEnvironment });
if (await waitForChildExit(authRestore) !== 0) {
  throw new Error('Supabase Auth user/identity restore failed.');
}

const restoredDb=postgres(database,{ssl:'require',max:1});
let restoredTables;
try{
 await provisionRestoredRuntimeRole(restoredDb,process.env.PLATFORM_RUNTIME_PASSWORD);
 restoredTables=await assertTableInventory(restoredDb,manifest.database.tables);
}finally{await restoredDb.end();}

for (const object of manifest.objects) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: object.key,
    Body: createReadStream(path.join(root, object.file))
  }));
}
const restoredObjects=await assertObjectInventory({s3,bucket,expected:manifest.objects});
console.log(`Restore verified: ${restoredTables} public tables match row counts; all ${restoredObjects} R2 objects match keys, sizes and SHA-256 checksums.`);
console.log('Still run the migration verifier, application smoke tests and a sample ZIP extraction before recording the full drill as complete.');
