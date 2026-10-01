import { openDatabase } from '../server/db.mjs';

const projectRef = 'baqebydtinysosueksgr';
const expectedHost = 'aws-0-eu-central-1.pooler.supabase.com';
const password = process.env.LUMIQ_PRODUCTION_DB_PASSWORD;
if (!password) throw new Error('Production database credential is unavailable from the DPAPI vault.');

const connection = new URL(`postgresql://postgres.${projectRef}@${expectedHost}:5432/postgres`);
connection.password = password;
connection.searchParams.set('sslmode', 'require');
let db;
try {
  db = await openDatabase({ connection: connection.toString(), skipMigrations: true, maxConnections: 1 });
  const [identity] = (await db.query(`
    select current_database() as database_name,current_user as database_user,
      r.rolcreaterole,pg_get_userbyid(n.nspowner) as auth_schema_owner,
      n.nspacl::text as auth_schema_acl,
      has_schema_privilege(current_user,'auth','usage') as grantor_has_usage,
      has_schema_privilege(current_user,'auth','usage with grant option') as grantor_can_grant_usage,
      has_schema_privilege('lumiq_api_owner','auth','usage') as api_owner_has_usage,
      pg_has_role(current_user,'supabase_admin','set') as can_set_schema_owner,
      to_regclass('public.platform_migrations') is not null as has_migration_ledger
    from pg_roles r cross join pg_namespace n
    where r.rolname=current_user and n.nspname='auth'
  `)).rows;
  if (identity?.database_name !== 'postgres' || identity.database_user !== 'postgres' || !identity.rolcreaterole) {
    throw new Error('Connected identity does not match the pinned Production database admin.');
  }
  const [ledger] = (await db.query(`
    select count(*)::integer as count,min(version) as first_version,max(version) as last_version,
      bool_or(version='047-sync-account-auth-schema-usage') as has_047
    from public.platform_migrations
  `)).rows;
  const memberships = (await db.query(`
    select role.rolname as granted_role,m.admin_option,m.inherit_option,m.set_option
    from pg_auth_members m join pg_roles role on role.oid=m.roleid
    join pg_roles member on member.oid=m.member
    where member.rolname=current_user and role.rolname in ('supabase_admin','supabase_auth_admin','lumiq_api_owner')
    order by role.rolname
  `)).rows;
  const authSchemaRoles = (await db.query(`
    select r.rolname,r.rolcanlogin,r.rolinherit,r.rolbypassrls,
      has_schema_privilege(r.rolname,'auth','usage') as auth_schema_usage,
      has_function_privilege(r.rolname,'auth.uid()','execute') as auth_uid_execute
    from pg_roles r
    where r.rolname like 'lumiq\\_%\\_owner' escape '\\'
    order by r.rolname
  `)).rows;
  const authUidDependencies = (await db.query(`
    select
      (select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname not in ('pg_catalog','information_schema')
         and p.prosrc ilike '%auth.uid(%') as function_count,
      (select count(*)::integer from pg_policies
       where coalesce(qual,'') ilike '%auth.uid(%' or coalesce(with_check,'') ilike '%auth.uid(%') as policy_count,
      (select coalesce(jsonb_agg(format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) order by n.nspname,p.proname),'[]'::jsonb)
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname not in ('pg_catalog','information_schema') and p.prosrc ilike '%auth.uid(%') as functions,
      (select coalesce(jsonb_agg(format('%I.%I:%I',schemaname,tablename,policyname) order by schemaname,tablename,policyname),'[]'::jsonb)
       from pg_policies where coalesce(qual,'') ilike '%auth.uid(%' or coalesce(with_check,'') ilike '%auth.uid(%') as policies
  `)).rows[0];
  console.log(JSON.stringify({ targetProject: projectRef, identity, migrationLedger: ledger, memberships, authSchemaRoles, authUidDependencies }));
} catch (error) {
  console.error(`Production Auth-grant inspection failed (${typeof error?.code === 'string' ? error.code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) : 'CHECK_FAILED'}). No database changes were made.`);
  process.exitCode = 1;
} finally {
  if (db) await db.close();
}
