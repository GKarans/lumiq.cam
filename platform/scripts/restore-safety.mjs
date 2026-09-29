import {once} from 'node:events';
import {createHash,createHmac,pbkdf2Sync,randomBytes} from 'node:crypto';

export async function waitForChildExit(child){return (await once(child,'close'))[0]??1;}

export function libpqConnectionForCli(connectionString){
 let url;try{url=new URL(connectionString);}catch{throw new Error('PostgreSQL connection URL is invalid.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password)throw new Error('PostgreSQL CLI connection must include a host, username and password.');
 let password;try{password=decodeURIComponent(url.password);}catch{throw new Error('PostgreSQL connection password encoding is invalid.');}
 url.password='';
 return{connectionString:url.toString(),password};
}

export function validateRestoreTarget(databaseUrl, expectedProjectRef){
 if(typeof expectedProjectRef!=='string'||! /^[a-z0-9-]{8,64}$/i.test(expectedProjectRef))throw new Error('Confirm the exact empty drill project reference in PLATFORM_RESTORE_TARGET_REF.');
 let url;try{url=new URL(databaseUrl);}catch{throw new Error('Restore target must be a valid PostgreSQL URL.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||(url.port&&url.port!=='5432'))throw new Error('Restore target must use the Supabase PostgreSQL endpoint on port 5432.');
 const username=decodeURIComponent(url.username),poolerRef=url.hostname.endsWith('.pooler.supabase.com')?username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1]:null,directRef=url.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1],actualRef=poolerRef||directRef;
 if(!actualRef||actualRef!==expectedProjectRef)throw new Error('Restore target URL does not match the confirmed Supabase project reference.');
 return actualRef;
}

export async function assertEmptyPublicSchema(sql){
 const existing=await sql`
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name not in ('spatial_ref_sys','geometry_columns','geography_columns')
  limit 1
 `;
 if(existing.length)throw new Error(`Restore target public schema is not empty (${existing[0].table_name}).`);
}

export async function inspectPublicRestoreState(sql,expectedTables,{allowPartial=false}={}){
 const actual=await sql`
  select t.tablename as table_name
  from pg_catalog.pg_tables t
  join pg_catalog.pg_class c on c.relname=t.tablename
  join pg_catalog.pg_namespace n on n.nspname=t.schemaname and n.oid=c.relnamespace
  where t.schemaname='public'
    and not exists (
     select 1 from pg_catalog.pg_depend d
     where d.classid='pg_catalog.pg_class'::regclass and d.objid=c.oid
       and d.refclassid='pg_catalog.pg_extension'::regclass and d.deptype='e'
    )
  order by t.tablename
 `;
 if(!actual.length)return false;
 const expected=new Set(expectedTables.filter(table=>table.schema==='public').map(table=>table.name));
 const unexpected=actual.map(table=>table.table_name).filter(name=>!expected.has(name));
 if(unexpected.length)throw new Error(`Restore target has public tables outside this backup (${unexpected.join(', ')}); refusing cleanup.`);
 if(!allowPartial)throw new Error('Restore target contains public tables from a prior attempt. Confirm the exact target to clean and retry.');
 return true;
}

export async function assertEmptyAuthUsers(sql){
 const existing=await sql`
  select 'users' as table_name where exists (select 1 from auth.users limit 1)
  union all
  select 'identities' as table_name where exists (select 1 from auth.identities limit 1)
 `;
 if(existing.length)throw new Error(`Restore target Auth data is not empty (${existing[0].table_name}).`);
}

export async function ensureProductionCompatibilityRole(sql){
 const roleName='lumiq_production_runtime';
 const valid=role=>role?.rolcanlogin&&!role.rolinherit&&!role.rolbypassrls&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolreplication&&!role.rolsuper;
 await sql.begin(async tx=>{
  const [existing]=await tx`select rolcanlogin,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolsuper from pg_roles where rolname=${roleName}`;
  if(existing){if(!valid(existing))throw new Error('Existing Recovery production-compatibility role is not least-privileged; refusing to alter it.');return;}
  await tx.unsafe('create role lumiq_production_runtime login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication');
 });
 const [verified]=await sql`select rolcanlogin,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolsuper from pg_roles where rolname=${roleName}`;
 if(!valid(verified))throw new Error('Recovery production-compatibility role failed its least-privilege verification.');
}

export async function provisionRestoredRuntimeRole(sql,password){
 if(typeof password!=='string'||!/^[A-Za-z0-9_-]{32,}$/.test(password))throw new Error('Use a random URL-safe lumiq_restore_runtime password of at least 32 characters.');
 const [settings]=await sql`show password_encryption`;
 if(settings.password_encryption!=='scram-sha-256')throw new Error('Restore target must use scram-sha-256 password encryption.');
 const roles=await sql`select rolname from pg_roles where rolname in ('anon','authenticated','service_role')`;
 const roleNames=new Set(roles.map(role=>role.rolname));
 for(const role of ['anon','authenticated','service_role'])if(!roleNames.has(role))throw new Error(`Supabase target is missing the required ${role} database role.`);

 const salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
 const clientKey=createHmac('sha256',salted).update('Client Key').digest();
 const storedKey=createHash('sha256').update(clientKey).digest('base64');
 const serverKey=createHmac('sha256',salted).update('Server Key').digest('base64');
 const verifier=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`;

 await sql.begin(async tx=>{
  const [existing]=await tx`select rolcanlogin,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolsuper from pg_roles where rolname='lumiq_restore_runtime'`;
  if(existing){
   if(!existing.rolcanlogin||existing.rolinherit||existing.rolbypassrls||existing.rolcreatedb||existing.rolcreaterole||existing.rolreplication||existing.rolsuper)throw new Error('Existing lumiq_restore_runtime role has unexpected privileges; refusing to alter it.');
   const [statement]=await tx`select format('alter role lumiq_restore_runtime password %L',${verifier}::text) as ddl`;
   await tx.unsafe(statement.ddl);
  }else{
   const [statement]=await tx`select format('create role lumiq_restore_runtime login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication password %L',${verifier}::text) as ddl`;
   await tx.unsafe(statement.ddl);
  }
  await tx.unsafe('grant connect on database postgres to lumiq_restore_runtime');
  await tx.unsafe('grant usage on schema public to lumiq_restore_runtime');
  await tx.unsafe('revoke all privileges on all tables in schema public from lumiq_restore_runtime');
  await tx.unsafe('revoke all privileges on all sequences in schema public from lumiq_restore_runtime');
 });

 const [verified]=await sql`
  select rolcanlogin,rolinherit,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolsuper,
   has_table_privilege('lumiq_restore_runtime','public.accounts','select') as can_read_accounts,
   has_table_privilege('lumiq_restore_runtime','public.accounts','insert') as can_insert_accounts,
   has_table_privilege('lumiq_restore_runtime','public.accounts','update') as can_update_accounts,
   has_table_privilege('lumiq_restore_runtime','public.accounts','delete') as can_delete_accounts,
   exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind in ('r','p') then (has_table_privilege('lumiq_restore_runtime',c.oid,'select') or has_table_privilege('lumiq_restore_runtime',c.oid,'insert') or has_table_privilege('lumiq_restore_runtime',c.oid,'update') or has_table_privilege('lumiq_restore_runtime',c.oid,'delete')) else false end) as has_any_table_privileges,
   exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind='S' then (has_sequence_privilege('lumiq_restore_runtime',c.oid,'usage') or has_sequence_privilege('lumiq_restore_runtime',c.oid,'select') or has_sequence_privilege('lumiq_restore_runtime',c.oid,'update')) else false end) as has_any_sequence_privileges,
   exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='lumiq_restore_runtime') as has_memberships,
   exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=(select oid from pg_roles where rolname='lumiq_restore_runtime') and d.deptype='o') as owns_objects,
   has_table_privilege('anon','public.accounts','select') as anon_can_read_accounts,
   has_table_privilege('authenticated','public.accounts','select') as authenticated_can_read_accounts
  from pg_roles where rolname='lumiq_restore_runtime'
 `;
 if(!verified?.rolcanlogin||verified.rolinherit||verified.rolbypassrls||verified.rolcreatedb||verified.rolcreaterole||verified.rolreplication||verified.rolsuper||verified.can_read_accounts||verified.can_insert_accounts||verified.can_update_accounts||verified.can_delete_accounts||verified.has_any_table_privileges||verified.has_any_sequence_privileges||verified.has_memberships||verified.owns_objects||verified.anon_can_read_accounts||verified.authenticated_can_read_accounts)throw new Error('Restored safe runtime-role attributes or public access verification failed.');
}
