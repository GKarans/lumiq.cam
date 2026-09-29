import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../server/db.mjs';
import { migrate } from '../server/migrations.mjs';
import { PLATFORM_MIGRATIONS } from '../server/migration-manifest.mjs';

const targetMode = process.env.LUMIQ_MIGRATION_TARGET || 'restore-drill';
if (!['restore-drill', 'recovery', 'production'].includes(targetMode)) throw new Error('Migration target must be explicitly restore-drill, recovery or production.');
const recoveryMode = targetMode === 'recovery';
const productionMode = targetMode === 'production';
const protectedProjects = new Set(['baqebydtinysosueksgr', 'sprzlvywzpeyuzbsyplz', 'cpweowosocjuccjsyyic']);
const projectRef = recoveryMode ? process.env.LUMIQ_RECOVERY_PROJECT_REF : productionMode ? 'baqebydtinysosueksgr' : 'sprzlvywzpeyuzbsyplz';
if (recoveryMode && (!/^[a-z0-9]{20}$/.test(projectRef || '') || protectedProjects.has(projectRef))) throw new Error('Recovery migration target must be a new Supabase project; existing Production, Restore Drill and closed-test references are forbidden.');
const host = recoveryMode ? 'aws-1-eu-central-1.pooler.supabase.com' : 'aws-0-eu-central-1.pooler.supabase.com';
const ownerRoles = [
  'lumiq_api_owner', 'lumiq_guest_owner', 'lumiq_job_owner', 'lumiq_preview_owner',
  'lumiq_admin_owner', 'lumiq_storage_owner', 'lumiq_limit_owner', 'lumiq_payment_owner',
  'lumiq_support_owner', 'lumiq_billing_owner', 'lumiq_session_owner'
];
const runtimeRole = productionMode ? 'lumiq_production_runtime' : 'lumiq_restore_runtime';
const productionRuntimeRpcAllowlist = [
  'apply_provider_payment_event', 'can_delete_platform_asset', 'claim_platform_deliveries', 'claim_platform_job',
  'claim_platform_queue_batch', 'collect_platform_notices', 'complete_platform_export_part', 'dead_letter_platform_job',
  'expire_platform_event', 'finalize_platform_event_cleanup', 'get_billing_subscription_id', 'get_platform_cleanup_manifest',
  'get_platform_export_notice', 'get_platform_export_part', 'list_platform_retention_reminders', 'platform_media_cleanup_should_defer',
  'prepare_platform_event_end', 'prepare_platform_export', 'queue_platform_message', 'reconcile_provider_subscription_state',
  'recover_stale_platform_jobs', 'renew_platform_job', 'reserve_r2_budget', 'reset_platform_queue_dispatch',
  'resolve_billing_owner', 'run_platform_retention_cycle', 'save_platform_thumbnail_details', 'settle_platform_delivery',
  'settle_platform_job'
];
const password = process.env[recoveryMode ? 'LUMIQ_RECOVERY_DB_PASSWORD' : productionMode ? 'LUMIQ_PRODUCTION_DB_PASSWORD' : 'LUMIQ_RESTORE_DRILL_DB_PASSWORD'];
const runtimePassword = process.env[recoveryMode ? 'LUMIQ_RECOVERY_RUNTIME_PASSWORD' : productionMode ? 'LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD' : 'LUMIQ_RESTORE_DRILL_SAFE_RUNTIME_PASSWORD'];
const targetLabel = recoveryMode ? 'Recovery' : productionMode ? 'Production' : 'Restore Drill';
if (!password || !runtimePassword) throw new Error(`${targetLabel} admin and runtime credentials are not available from the DPAPI vault.`);

const connection = new URL(`postgresql://postgres.${projectRef}@${host}:5432/postgres`);
connection.password = password;
connection.searchParams.set('sslmode', 'require');
let db;
let stage = 'target validation';
const cleanupRoles = [];
const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;

try {
  if (connection.hostname !== host || decodeURIComponent(connection.username) !== `postgres.${projectRef}` || connection.pathname !== '/postgres') {
    throw new Error(`Database URL does not match the selected ${targetLabel} target.`);
  }
  db = await openDatabase({ connection: connection.toString(), skipMigrations: true, maxConnections: 1 });
  stage = 'baseline identity and checksum validation';
  const [identity] = (await db.query('select current_database() as database_name,current_user as database_user,r.rolcreaterole from pg_roles r where r.rolname=current_user')).rows;
  if (identity?.database_name !== 'postgres' || identity.database_user !== 'postgres' || !identity.rolcreaterole) throw new Error(`Connected identity lacks the selected ${targetLabel} migration capability.`);

  const [ledgerState] = (await db.query(`
    select to_regclass('public.platform_migrations') is not null as has_ledger,
      (select count(*)::integer from information_schema.tables where table_schema='public'
        and table_name not in ('spatial_ref_sys','geometry_columns','geography_columns')) as public_tables
  `)).rows;
  if (!ledgerState.has_ledger) {
    if (!recoveryMode || ledgerState.public_tables !== 0) throw new Error('Migration ledger is absent and the selected target is not a new, empty Recovery project.');
    await db.transaction(async tx => {
      await tx.query('create table public.platform_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())');
      await tx.query('alter table public.platform_migrations enable row level security');
      await tx.query("do $$ begin if exists(select 1 from pg_roles where rolname='anon') then revoke all on public.platform_migrations from anon; end if; if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on public.platform_migrations from authenticated; end if; end $$;");
    });
  }

  const applied = (await db.query('select version,checksum from public.platform_migrations order by version')).rows;
  if (applied.length > PLATFORM_MIGRATIONS.length) throw new Error('Migration ledger contains unexpected versions.');
  for (let index = 0; index < applied.length; index++) {
    const entry = PLATFORM_MIGRATIONS[index];
    if (applied[index].version !== entry.version) throw new Error('Applied migration ledger is not an exact manifest prefix.');
    const source = await readFile(new URL(`../server/${entry.file}`, import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
    if (checksum !== applied[index].checksum) throw new Error(`Applied migration checksum differs at ${entry.version}.`);
  }

  const pending = PLATFORM_MIGRATIONS.slice(applied.length);
  const entries = await Promise.all(pending.map(async entry => ({
    version: entry.version,
    sql: await readFile(new URL(`../server/${entry.file}`, import.meta.url), 'utf8')
  })));
  stage = 'temporary helper-role membership preparation';
  await db.transaction(async tx => {
    const [existingRuntime] = (await tx.query('select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=$1', [runtimeRole])).rows;
    if (existingRuntime) {
      if (!existingRuntime.rolcanlogin || existingRuntime.rolinherit || existingRuntime.rolbypassrls || existingRuntime.rolsuper || existingRuntime.rolcreatedb || existingRuntime.rolcreaterole || existingRuntime.rolreplication) {
        throw new Error(`Existing ${runtimeRole} role has unexpected privileges.`);
      }
    } else {
      const [statement] = (await tx.query('select format(\'create role %I login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication password %L\', $1::text, $2::text) as ddl', [runtimeRole, runtimePassword])).rows;
      await tx.query(statement.ddl);
      await tx.query(`grant connect on database postgres to ${quoteIdentifier(runtimeRole)}`);
      await tx.query(`grant usage on schema public to ${quoteIdentifier(runtimeRole)}`);
    }
    for (const roleName of ownerRoles) {
      const [role] = (await tx.query('select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=$1', [roleName])).rows;
      if (!role) {
        await tx.query(`create role ${quoteIdentifier(roleName)} nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`);
      } else if (role.rolcanlogin || role.rolinherit || role.rolbypassrls || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication) {
        throw new Error(`Existing helper role ${roleName} has unexpected privileges.`);
      }
      await tx.query(`grant ${quoteIdentifier(roleName)} to ${quoteIdentifier(identity.database_user)} with admin false, inherit false, set true`);
      if (!cleanupRoles.includes(roleName)) cleanupRoles.push(roleName);
    }
  });

  stage = 'temporary helper-role SET ROLE preflight';
  await db.transaction(async tx => {
    for (const roleName of cleanupRoles) {
      await tx.query(`set local role ${quoteIdentifier(roleName)}`);
      await tx.query('reset role');
    }
  });

  stage = 'rollback-only function ownership transfer preflight';
  try {
    await db.transaction(async tx => {
      for (let index = 0; index < ownerRoles.length; index++) {
        const probe = `__lumiq_owner_transfer_probe_${index + 1}`;
        await tx.query(`grant create on schema public to ${quoteIdentifier(ownerRoles[index])}`);
        await tx.query(`create function public.${probe}() returns integer language sql immutable as $$ select 1 $$`);
        await tx.query(`alter function public.${probe}() owner to ${quoteIdentifier(ownerRoles[index])}`);
      }
      const rollback = new Error('rollback ownership preflight');
      rollback.code = 'LUMIQ_PROBE_ROLLBACK';
      throw rollback;
    });
  } catch (error) {
    if (error?.code !== 'LUMIQ_PROBE_ROLLBACK') throw error;
  }

  stage = 'atomic forward migrations and role cleanup';
  let finalState;
  await db.transaction(async tx => {
    let migrationIndex = 0;
    const migrationDb = {
      query: tx.query,
      transaction: callback => {
        stage = pending[migrationIndex++]?.version || 'migration ledger update';
        return callback(tx);
      }
    };
    if (entries.length) await migrate(migrationDb, entries);

    const expected = PLATFORM_MIGRATIONS.map(entry => entry.version);
    const finalVersions = (await tx.query('select version from public.platform_migrations order by version')).rows.map(row => row.version);
    if (JSON.stringify(finalVersions) !== JSON.stringify(expected)) throw new Error('Migration ledger is incomplete after applying the forward migrations.');
    const [runtime] = (await tx.query('select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname=$1', [runtimeRole])).rows;
    if (!runtime?.rolcanlogin || runtime.rolinherit || runtime.rolbypassrls || runtime.rolsuper || runtime.rolcreatedb || runtime.rolcreaterole || runtime.rolreplication) {
      throw new Error('Runtime role does not match the hardened migration state.');
    }
    const access = (await tx.query(`
      select count(*)::integer as public_tables,
        count(*) filter(where not c.relrowsecurity)::integer as tables_without_rls,
        count(*) filter(where has_table_privilege('anon',c.oid,'select'))::integer as anon_direct_select,
        count(*) filter(where has_table_privilege('authenticated',c.oid,'select'))::integer as authenticated_direct_select
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
    `)).rows[0];
    if (access.tables_without_rls || access.anon_direct_select || access.authenticated_direct_select) throw new Error('Post-migration RLS or browser-role access verification failed.');

    if (recoveryMode || productionMode) {
      const [productionRuntime] = (await tx.query(`
        select r.rolcanlogin,r.rolinherit,r.rolbypassrls,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
          has_column_privilege(r.rolname,'public.platform_migrations','version','select') as can_read_versions,
          has_column_privilege(r.rolname,'public.platform_migrations','checksum','select') as can_read_checksums,
          (select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind in ('r','p')
              and (has_table_privilege(r.rolname,c.oid,'select,insert,update,delete')
                or exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
                  and not(c.relname='platform_migrations' and a.attname='version')
                  and (has_column_privilege(r.rolname,c.oid,a.attnum,'select,insert,update,references'))))) as direct_table_access,
          (select count(*) filter(where case when c.relkind='S' then has_sequence_privilege(r.rolname,c.oid,'usage,select,update') else false end)::integer
            from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') as sequence_access,
          (select coalesce(array_agg(p.proname order by p.proname),'{}') from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.prosecdef and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
              and has_function_privilege(r.rolname,p.oid,'execute')) as security_definer_rpcs
        from pg_roles r where r.rolname='lumiq_production_runtime'
      `)).rows;
      if (!productionRuntime?.rolcanlogin || productionRuntime.rolinherit || productionRuntime.rolbypassrls || productionRuntime.rolsuper || productionRuntime.rolcreatedb || productionRuntime.rolcreaterole || productionRuntime.rolreplication
        || !productionRuntime.can_read_versions || productionRuntime.can_read_checksums || productionRuntime.direct_table_access || productionRuntime.sequence_access
        || JSON.stringify(productionRuntime.security_definer_rpcs) !== JSON.stringify(productionRuntimeRpcAllowlist)) {
        const actualRpcs = productionRuntime?.security_definer_rpcs || [];
        const missingRpcs = productionRuntimeRpcAllowlist.filter(name => !actualRpcs.includes(name)).length;
        const extraNames = actualRpcs.filter(name => !productionRuntimeRpcAllowlist.includes(name));
        const extraInfo = extraNames.length ? (await tx.query(`
          select p.proname,p.prorettype::regtype::text as return_type,pg_get_userbyid(p.proowner) as owner,coalesce(p.proacl::text,'default') as acl
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.prosecdef and p.proname=any($1::text[])
        `, [extraNames])).rows : [];
        throw new Error(`Production-runtime verification failed: table=${productionRuntime?.direct_table_access},sequence=${productionRuntime?.sequence_access},migrationVersionOnly=${Boolean(productionRuntime?.can_read_versions && !productionRuntime?.can_read_checksums)},rpcs=${actualRpcs.length},missing=${missingRpcs},extra=${JSON.stringify(extraInfo)}.`);
      }
    }

    for (const roleName of cleanupRoles) await tx.query(`revoke ${quoteIdentifier(roleName)} from ${quoteIdentifier(identity.database_user)}`);
    finalState = { finalVersions, runtime, access };
  });
  console.log(JSON.stringify({ target: targetLabel, targetProject: projectRef, appliedNow: pending.map(entry => entry.version), appliedCount: finalState.finalVersions.length, runtimeRole: finalState.runtime, access: finalState.access }));
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) : 'MIGRATION_FAILED';
  const detail = `${error?.message || ''} ${error?.where || ''}`.replaceAll(password, '[redacted]').replaceAll(runtimePassword || '', '[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]').replace(/\s+/g, ' ').slice(0, 220);
  console.error(`${targetLabel} migration failed during ${stage} (${code}): ${detail}. No credentials were printed; check the migration ledger before retrying.`);
  process.exitCode = 1;
} finally {
  if (db) {
    for (const roleName of cleanupRoles) {
      try {
        const [membership] = (await db.query(`select exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname=$1 and u.rolname=current_user) as is_member`, [roleName])).rows;
        if (membership?.is_member) await db.query(`revoke ${quoteIdentifier(roleName)} from ${quoteIdentifier('postgres')}`);
      } catch {
        console.error(`Temporary ${targetLabel} helper-role membership cleanup needs manual review. No credentials were printed.`);
        process.exitCode = 1;
      }
    }
    await db.close();
  }
}
