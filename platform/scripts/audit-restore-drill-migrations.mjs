import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { PLATFORM_MIGRATIONS } from '../server/migration-manifest.mjs';

const projectRef = 'sprzlvywzpeyuzbsyplz';
const host = 'aws-0-eu-central-1.pooler.supabase.com';
const password = process.env.LUMIQ_RESTORE_DRILL_DB_PASSWORD;
if (!password) throw new Error('Restore Drill admin password is not available from the DPAPI vault.');

const connection = new URL(`postgresql://postgres.${projectRef}@${host}:5432/postgres`);
connection.password = password;
connection.searchParams.set('sslmode', 'require');
const sql = postgres(connection.toString(), { ssl: 'require', max: 1, connect_timeout: 10, idle_timeout: 2 });
let stage = 'read-only connection';

try {
  const result = await sql.begin(async tx => {
    await tx`set transaction read only`;
    const [identity] = await tx`select current_database() as database_name, current_user as database_user, r.rolcreaterole, r.rolsuper from pg_roles r where r.rolname=current_user`;
    if (identity?.database_name !== 'postgres' || identity.database_user !== 'postgres') {
      throw new Error('Connected identity is not the pinned Restore Drill administrator.');
    }
    stage = 'migration ledger read';
    const rows = await tx`select version, checksum from public.platform_migrations order by version`;
    stage = 'runtime role read';
    const roles = await tx`select rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolreplication from pg_roles where rolname in ('lumiq_runtime','lumiq_restore_runtime') or rolname like 'lumiq_%_owner' order by rolname`;
    const schemaAccess = await tx`select nspname, pg_get_userbyid(nspowner) as owner, has_schema_privilege(current_user,oid,'create') as admin_can_create from pg_namespace where nspname='public'`;
    const memberships = await tx`select target.rolname as role_name, m.admin_option, m.inherit_option, m.set_option, grantor.rolname as grantor from pg_auth_members m join pg_roles target on target.oid=m.roleid join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor where member.rolname=current_user and target.rolname like 'lumiq_%_owner' order by target.rolname, grantor.rolname`;
    const runtimeMemberships = await tx`select target.rolname as granted_role, m.admin_option, m.inherit_option, m.set_option from pg_auth_members m join pg_roles target on target.oid=m.roleid join pg_roles member on member.oid=m.member where member.rolname='lumiq_restore_runtime' order by target.rolname`;
    const runtimeMetadata = await tx`select target.rolname, owner.rolname as role_owner, target.rolcanlogin, target.rolinherit, target.rolbypassrls, target.rolsuper, target.rolcreatedb, target.rolcreaterole, target.rolreplication, membership.admin_option, membership.inherit_option, membership.set_option, grantor.rolname as membership_grantor from pg_roles target left join pg_shdepend dependency on dependency.classid='pg_authid'::regclass and dependency.objid=target.oid and dependency.deptype='o' left join pg_roles owner on owner.oid=dependency.refobjid left join pg_auth_members membership on membership.roleid=target.oid and membership.member=(select oid from pg_roles where rolname=current_user) left join pg_roles grantor on grantor.oid=membership.grantor where target.rolname='lumiq_restore_runtime'`;
    return { identity, applied: rows, roles, schemaAccess, memberships, runtimeMemberships, runtimeMetadata };
  });

  const expected = PLATFORM_MIGRATIONS
    .filter(entry => entry.version !== '046-production-runtime-access-hardening')
    .map(entry => entry.version);
  const appliedSet = new Set(result.applied.map(row => row.version));
  const expectedSet = new Set(expected);
  const checksumMismatches = [];
  for (const row of result.applied) {
    const migration = PLATFORM_MIGRATIONS.find(entry => entry.version === row.version);
    if (!migration) continue;
    const source = await readFile(new URL(`../server/${migration.file}`, import.meta.url), 'utf8');
    const localChecksum = createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
    if (localChecksum !== row.checksum) checksumMismatches.push(row.version);
  }
  console.log(JSON.stringify({
    targetProject: projectRef,
    database: result.identity.database_name,
    connectedAs: result.identity.database_user,
    adminCanCreateRoles: result.identity.rolcreaterole,
    adminIsSuperuser: result.identity.rolsuper,
    appliedCount: result.applied.length,
    expectedCount: expected.length,
    missing: expected.filter(version => !appliedSet.has(version)),
    unexpected: result.applied.filter(row => !expectedSet.has(row.version)).map(row => row.version),
    checksumMismatches,
    applied: result.applied.map(row => row.version),
    roles: result.roles,
    schemaAccess: result.schemaAccess,
    administratorMemberships: result.memberships,
    runtimeRoleMemberships: result.runtimeMemberships,
    runtimeRoleAuthority: result.runtimeMetadata
  }));
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) : 'AUDIT_FAILED';
  console.error(`Restore Drill migration audit failed during ${stage} (${code}). No database changes were made.`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
