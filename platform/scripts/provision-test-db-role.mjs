import postgres from 'postgres';
import {createHash, createHmac, pbkdf2Sync, randomBytes} from 'node:crypto';

const connection = process.env.PLATFORM_DATABASE_URL;
const password = process.env.PLATFORM_RUNTIME_PASSWORD;
const projectRef = process.env.PLATFORM_TARGET_PROJECT_REF;
if (process.env.PLATFORM_MODE !== 'staging' || process.env.PLATFORM_PROVISION_TEST_ROLE !== '1' || !connection || !password || !projectRef) {
  throw new Error('Explicit closed-test database role configuration is required.');
}
if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) {
  throw new Error('Use a random URL-safe runtime password of at least 32 characters.');
}

const uri = new URL(connection);
const username = decodeURIComponent(uri.username);
const targetRef = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(uri.hostname)?.[1]
  ?? /^postgres\.([a-z0-9]+)$/.exec(username)?.[1];
if (!targetRef || targetRef !== projectRef) {
  throw new Error('The admin connection URL does not match the confirmed Supabase project.');
}
if (username !== 'postgres' && username !== `postgres.${projectRef}`) {
  throw new Error('Use the new project postgres admin connection for role provisioning.');
}

const sql = postgres(connection, {database:'postgres', ssl:'require', max:1, prepare:false, fetch_types:false});
try {
  const [settings] = await sql`show password_encryption`;
  if (settings.password_encryption !== 'scram-sha-256') {
    throw new Error('The test project must use scram-sha-256 password encryption. No role was created.');
  }
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  const verifier = `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;

  await sql.begin(async tx => {
    const prior = await tx`select rolname from pg_roles where rolname = 'lumiq_runtime'`;
    if (prior.length) throw new Error('lumiq_runtime already exists; refusing to alter an existing role.');

    const [statement] = await tx`
      select format(
        'create role lumiq_runtime login noinherit bypassrls password %L',
        ${verifier}::text
      ) as ddl
    `;
    await tx.unsafe(statement.ddl);
    await tx.unsafe('grant connect on database postgres to lumiq_runtime');
    await tx.unsafe('grant usage on schema public to lumiq_runtime');
    await tx.unsafe('grant select, insert, update, delete on all tables in schema public to lumiq_runtime');
    await tx.unsafe('revoke insert, update, delete on table public.accounts from lumiq_runtime');
    await tx.unsafe('grant insert (id,email,name,password_hash,profile,preferences,verified) on table public.accounts to lumiq_runtime');
    await tx.unsafe('grant update (email,name,password_hash,profile,preferences,verified,storage_prefix,design_defaults) on table public.accounts to lumiq_runtime');
    await tx.unsafe('alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to lumiq_runtime');
  });

  const [role] = await sql`
    select rolcanlogin, rolinherit, rolbypassrls, rolcreatedb, rolcreaterole, rolsuper,
      has_table_privilege('lumiq_runtime', 'public.accounts', 'select') as can_read_accounts,
      has_table_privilege('lumiq_runtime', 'public.accounts', 'delete') as can_delete_accounts,
      has_column_privilege('lumiq_runtime', 'public.accounts', 'role', 'insert') as can_insert_account_role,
      has_column_privilege('lumiq_runtime', 'public.accounts', 'role', 'update') as can_update_account_role
    from pg_roles where rolname = 'lumiq_runtime'
  `;
  if (!role?.rolcanlogin || role.rolinherit || !role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolsuper || !role.can_read_accounts || role.can_delete_accounts || role.can_insert_account_role || role.can_update_account_role) {
    throw new Error('Runtime DB role verification failed. Do not attach it to a Worker.');
  }
  console.log(`Closed-test DB role ready: lumiq_runtime.${projectRef}; login-only, table-scoped, BYPASSRLS, not owner/superuser.`);
} finally {
  await sql.end();
}
