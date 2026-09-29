import postgres from 'postgres';
import { PLATFORM_MIGRATIONS } from '../server/migration-manifest.mjs';

const projectRef = 'baqebydtinysosueksgr';
const host = 'aws-0-eu-central-1.pooler.supabase.com';
const roleName = 'lumiq_production_runtime';
const adminPassword = process.env.LUMIQ_PRODUCTION_DB_PASSWORD;
const runtimePassword = process.env.LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD;
if (!adminPassword || !runtimePassword) throw new Error('Load the pinned Production admin and safe runtime passwords from the DPAPI vault.');
if (!/^[A-Za-z0-9_-]{32,}$/.test(runtimePassword)) throw new Error('The safe runtime password must be at least 32 URL-safe characters.');

const expectedVersions = PLATFORM_MIGRATIONS.slice(0, 13).map(entry => entry.version).sort();
const connection = new URL(`postgresql://postgres.${projectRef}@${host}:5432/postgres`);
connection.password = adminPassword;
connection.searchParams.set('sslmode', 'require');
const sql = postgres(connection.toString(), { ssl: 'require', max: 1, connect_timeout: 10, idle_timeout: 2 });
connection.password = '';

let stage = 'administrator identity';
try {
  const [identity] = await sql`
    select current_database() as database_name, current_user as database_user
  `;
  if (identity?.database_name !== 'postgres' || identity.database_user !== 'postgres') throw new Error('Wrong database identity.');

  stage = 'pre-migration ledger';
  const versions = (await sql`select version from public.platform_migrations order by version`).map(row => row.version);
  if (JSON.stringify(versions) !== JSON.stringify(expectedVersions)) throw new Error('Expected the exact Production migration ledger 001-013.');

  stage = 'pre-migration RLS baseline';
  const [baseline] = await sql`
    select count(*)::integer as table_count,
      count(*) filter(where not c.relrowsecurity)::integer as tables_without_rls,
      count(*) filter(where has_table_privilege('anon',c.oid,'select'))::integer as anon_select,
      count(*) filter(where has_table_privilege('authenticated',c.oid,'select'))::integer as authenticated_select
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  `;
  if (baseline.table_count !== 19 || baseline.tables_without_rls || baseline.anon_select || baseline.authenticated_select) {
    throw new Error('Production RLS or browser-role isolation no longer matches the verified 001-013 state.');
  }

  stage = 'password encryption';
  const [settings] = await sql`show password_encryption`;
  if (settings.password_encryption !== 'scram-sha-256') throw new Error('Database password encryption is not SCRAM-SHA-256.');

  stage = 'legacy role safety';
  const [oldRuntime] = await sql`select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname='lumiq_runtime'`;
  if (!oldRuntime?.rolcanlogin || oldRuntime.rolinherit || !oldRuntime.rolbypassrls || oldRuntime.rolsuper || oldRuntime.rolcreatedb || oldRuntime.rolcreaterole || oldRuntime.rolreplication) {
    throw new Error('The legacy lumiq_runtime role differs from the reviewed state; refusing to touch it.');
  }

  let [role] = await sql`
    select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication
    from pg_roles where rolname=${roleName}
  `;
  if (role) {
    const [unsafeState] = await sql`
      select
        exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=${roleName})) as has_memberships,
        exists(select 1 from pg_shdepend where refclassid='pg_authid'::regclass and refobjid=(select oid from pg_roles where rolname=${roleName}) and deptype='o') as owns_objects,
        exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where a.grantee=(select oid from pg_roles where rolname=${roleName})) as has_default_grants,
        exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='public' and a.grantee=(select oid from pg_roles where rolname=${roleName}) and a.privilege_type='EXECUTE') as has_function_grants,
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind in ('r','p') then has_table_privilege(${roleName},c.oid,'select,insert,update,delete') else false end) as has_table_grants,
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind='S' then has_sequence_privilege(${roleName},c.oid,'usage,select,update') else false end) as has_sequence_grants,
        exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and not(n.nspname='public' and c.relname='platform_migrations' and a.attname='version') then has_column_privilege(${roleName},c.oid,a.attnum,'select,insert,update,references') else false end) as has_column_grants
    `;
    if (!role.rolcanlogin || role.rolinherit || role.rolbypassrls || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || Object.values(unsafeState).some(Boolean)) {
      throw new Error('Existing lumiq_production_runtime has privileges or memberships outside the expected safe baseline.');
    }
  }

  stage = 'safe runtime role provisioning';
  await sql.begin(async tx => {
    if (!role) {
      const [statement] = await tx`
        select format('create role lumiq_production_runtime login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication password %L', ${runtimePassword}::text) as ddl
      `;
      await tx.unsafe(statement.ddl);
    } else {
      const [statement] = await tx`
        select format('alter role lumiq_production_runtime password %L', ${runtimePassword}::text) as ddl
      `;
      await tx.unsafe(statement.ddl);
    }
    await tx.unsafe('grant connect on database postgres to lumiq_production_runtime');
    await tx.unsafe('grant usage on schema public to lumiq_production_runtime');
    await tx.unsafe('grant select(version) on public.platform_migrations to lumiq_production_runtime');
    const [migrationTable] = await tx`select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='platform_migrations' and c.relkind in ('r','p')`;
    if (!migrationTable?.relrowsecurity) throw new Error('Production migration ledger must have RLS enabled before granting version visibility.');
    const [migrationPolicy] = await tx`select permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='platform_migrations' and policyname='production_runtime_migration_version_read'`;
    if (!migrationPolicy) {
      await tx.unsafe('create policy production_runtime_migration_version_read on public.platform_migrations for select to lumiq_production_runtime using (true)');
    } else if (migrationPolicy.permissive !== 'PERMISSIVE' || migrationPolicy.cmd !== 'SELECT' || !migrationPolicy.roles.includes('lumiq_production_runtime') || migrationPolicy.qual?.replace(/[()]/g, '').trim() !== 'true' || migrationPolicy.with_check !== null) {
      throw new Error('Existing Production runtime migration policy is broader or differs from the reviewed version-read policy.');
    }
  });

  stage = 'post-provision verification';
  const [verified] = await sql`
    select r.rolcanlogin,r.rolinherit,r.rolbypassrls,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
      has_column_privilege(${roleName},'public.platform_migrations','version','select') as can_read_version,
      has_column_privilege(${roleName},'public.platform_migrations','checksum','select') as can_read_checksum,
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind in ('r','p') then has_table_privilege(${roleName},c.oid,'select,insert,update,delete') else false end) as has_table_grants,
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind='S' then has_sequence_privilege(${roleName},c.oid,'usage,select,update') else false end) as has_sequence_grants,
      exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and not(n.nspname='public' and c.relname='platform_migrations' and a.attname='version') then has_column_privilege(${roleName},c.oid,a.attnum,'select,insert,update,references') else false end) as has_other_column_grants,
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='public' and a.grantee=r.oid and a.privilege_type='EXECUTE') as has_function_grants,
      exists(select 1 from pg_auth_members where member=r.oid) as has_memberships,
      exists(select 1 from pg_shdepend where refclassid='pg_authid'::regclass and refobjid=r.oid and deptype='o') as owns_objects,
      (select rolcanlogin from pg_roles where rolname='lumiq_runtime') as legacy_login,
      (select rolinherit from pg_roles where rolname='lumiq_runtime') as legacy_inherit,
      (select rolbypassrls from pg_roles where rolname='lumiq_runtime') as legacy_bypassrls,
      (select rolsuper from pg_roles where rolname='lumiq_runtime') as legacy_super,
      (select rolcreatedb from pg_roles where rolname='lumiq_runtime') as legacy_createdb,
      (select rolcreaterole from pg_roles where rolname='lumiq_runtime') as legacy_createrole,
      (select rolreplication from pg_roles where rolname='lumiq_runtime') as legacy_replication
    from pg_roles r where r.rolname=${roleName}
  `;
  if (!verified?.rolcanlogin || verified.rolinherit || verified.rolbypassrls || verified.rolsuper || verified.rolcreatedb || verified.rolcreaterole || verified.rolreplication || !verified.can_read_version || verified.can_read_checksum || verified.has_table_grants || verified.has_sequence_grants || verified.has_other_column_grants || verified.has_function_grants || verified.has_memberships || verified.owns_objects) {
    throw new Error('New runtime role does not match LOGIN/NOINHERIT/NOBYPASSRLS with version-only migration access.');
  }
  if (JSON.stringify([verified.legacy_login, verified.legacy_inherit, verified.legacy_bypassrls, verified.legacy_super, verified.legacy_createdb, verified.legacy_createrole, verified.legacy_replication]) !== JSON.stringify([oldRuntime.rolcanlogin, oldRuntime.rolinherit, oldRuntime.rolbypassrls, oldRuntime.rolsuper, oldRuntime.rolcreatedb, oldRuntime.rolcreaterole, oldRuntime.rolreplication])) {
    throw new Error('Legacy lumiq_runtime flags changed unexpectedly; stop and inspect the Production database.');
  }
  console.log(`Safe Production runtime role ${roleName} is ready on project ${projectRef}; no admin flags, BYPASSRLS, memberships, or application-table grants. Legacy lumiq_runtime was unchanged.`);
  console.log('Apply and verify the reviewed migrations before connecting this role to Production Hyperdrive.');
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) : 'PROVISION_FAILED';
  const detail = `${error?.message || ''} ${error?.where || ''}`
    .replaceAll(adminPassword, '[redacted]')
    .replaceAll(runtimePassword, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  console.error(`Safe runtime provisioning failed during ${stage} (${code}): ${detail}. No password values were printed.`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
