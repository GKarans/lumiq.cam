import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../server/db.mjs';
import {migrate} from '../server/migrations.mjs';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const projectRef = 'baqebydtinysosueksgr';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== projectRef || args[1] !== '--confirm-empty-production') {
  throw new Error(`Usage: node platform/scripts/migrate-production-empty.mjs ${projectRef} --confirm-empty-production`);
}

function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this from an interactive terminal so the password can be entered without echo.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    function cleanup() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    process.stdin.on('data', onData);
  });
}

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server');
let database;
let stage = 'waiting for password';
let password = '';
let connectionUrl;
try {
  password = await readSecret('Production postgres admin password (hidden; migrations only): ');
  if (!password) throw new Error('Password was empty.');

  const uri = new URL('postgres://postgres@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
  uri.username = `postgres.${projectRef}`;
  uri.password = password;
  uri.searchParams.set('sslmode', 'require');
  connectionUrl = uri.toString();
  password = '';

  stage = 'connecting to pinned production pooler';
  database = await openDatabase({connection: connectionUrl, skipMigrations: true, maxConnections: 1, fetchTypes: false});
  connectionUrl = '';

  stage = 'verifying empty production target';
  const identity = (await database.query(`
    select current_database() as database_name,
      (select count(*) from information_schema.tables where table_schema='public')::int as public_object_count,
      (select count(*) from auth.users)::int as auth_user_count,
      exists(select 1 from pg_roles where rolname='lumiq_runtime') as runtime_role_exists
  `)).rows[0];
  if (identity.database_name !== 'postgres' || identity.public_object_count !== 0 || identity.auth_user_count !== 0 || identity.runtime_role_exists) {
    throw new Error('Production target is not empty or already has a runtime role; refusing to migrate.');
  }

  stage = 'applying the ordered platform migrations';
  const entries = await Promise.all(PLATFORM_MIGRATIONS.map(async entry => ({
    ...entry,
    sql: await readFile(path.join(moduleRoot, entry.file), 'utf8'),
  })));
  const expected = PLATFORM_MIGRATIONS.map(entry => entry.version).sort();
  let applied;
  let security;
  await database.transaction(async tx => {
    const atomicDatabase = {query: tx.query, transaction: callback => callback(tx)};
    await migrate(atomicDatabase, entries);

    stage = 'verifying migration ledger and browser-role isolation';
    applied = (await tx.query('select version from platform_migrations order by version')).rows.map(row => row.version);
    if (JSON.stringify(applied) !== JSON.stringify(expected)) throw new Error('Migration ledger did not match the manifest.');

    security = (await tx.query(`
      select count(*)::int as table_count,
        count(*) filter (where not c.relrowsecurity)::int as missing_rls,
        count(*) filter (where has_table_privilege('anon', c.oid, 'SELECT'))::int as anon_readable,
        count(*) filter (where has_table_privilege('authenticated', c.oid, 'SELECT'))::int as authenticated_readable
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
    `)).rows[0];
    if (!security.table_count || security.missing_rls || security.anon_readable || security.authenticated_readable) {
      throw new Error('Post-migration RLS or browser-role access verification failed.');
    }
  });
  console.log(`Production schema initialized: ${applied.length} migrations; ${security.table_count} public tables have RLS; browser roles have no direct SELECT. No runtime credential was created.`);
} catch (error) {
  console.error(`Production migration stopped during ${stage}. No credential was printed. ${error.message === 'Cancelled.' ? 'Cancelled.' : 'Review the error locally before retrying.'}`);
  process.exitCode = 1;
} finally {
  password = '';
  connectionUrl = '';
  if (database) await database.close();
}
