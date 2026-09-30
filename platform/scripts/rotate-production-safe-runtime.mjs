import postgres from 'postgres';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const projectRef='baqebydtinysosueksgr';
const host='aws-0-eu-central-1.pooler.supabase.com';
const adminPassword=process.env.LUMIQ_PRODUCTION_DB_PASSWORD;
const runtimePassword=process.env.LUMIQ_PRODUCTION_SAFE_RUNTIME_PASSWORD;
if(!adminPassword||!runtimePassword)throw new Error('Load the pinned Production administrator and safe runtime passwords from DPAPI.');
if(!/^[A-Za-z0-9_-]{32,}$/.test(runtimePassword))throw new Error('The generated runtime password is not URL-safe or is too short.');

function connectionUrl(username,password){
 const url=new URL(`postgresql://${username}@${host}:5432/postgres`);
 url.password=password;
 url.searchParams.set('sslmode','require');
 return url.toString();
}

const sql=postgres(connectionUrl(`postgres.${projectRef}`,adminPassword),{ssl:'require',max:1,connect_timeout:10,idle_timeout:2});
let stage='administrator identity';
try{
 const [identity]=await sql`select current_database() as database_name,current_user as database_user`;
 if(identity?.database_name!=='postgres'||identity.database_user!=='postgres')throw new Error('Connected to the wrong database identity.');

 stage='migration ledger';
 const applied=(await sql`select version from public.platform_migrations order by version`).map(row=>row.version);
 const expected=PLATFORM_MIGRATIONS.map(entry=>entry.version).sort();
 if(JSON.stringify(applied)!==JSON.stringify(expected))throw new Error('Expected the complete Production migration manifest.');

 stage='safe role review';
 const [role]=await sql`select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname='lumiq_production_runtime'`;
 if(!role?.rolcanlogin||role.rolinherit||role.rolbypassrls||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication)throw new Error('The Production runtime role no longer matches the reviewed NOBYPASSRLS baseline.');
 const [membership]=await sql`select exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='lumiq_production_runtime')) as present`;
 if(membership.present)throw new Error('The Production runtime role has an unexpected role membership.');

 stage='password encryption';
 const [settings]=await sql`show password_encryption`;
 if(settings.password_encryption!=='scram-sha-256')throw new Error('Expected SCRAM-SHA-256 password storage.');

 stage='safe role password rotation';
 await sql.begin(async tx=>{
  const [statement]=await tx`select format('alter role lumiq_production_runtime password %L',${runtimePassword}::text) as ddl`;
  await tx.unsafe(statement.ddl);
 });

 stage='new credential login verification';
 const check=postgres(connectionUrl(`lumiq_production_runtime.${projectRef}`,runtimePassword),{ssl:'require',max:1,connect_timeout:10,idle_timeout:2});
 try{
  const [verified]=await check`select current_database() as database_name,current_user as database_user`;
  if(verified?.database_name!=='postgres'||verified.database_user!=='lumiq_production_runtime')throw new Error('The rotated role did not authenticate to the pinned Production database.');
 }finally{await check.end();}
 console.log('Production safe runtime password rotated and login verified; role privileges and grants were not changed.');
}catch(error){
 const code=typeof error?.code==='string'?error.code.replace(/[^A-Z0-9_]/g,'').slice(0,32):'ROTATION_FAILED';
 const detail=String(error?.message||'').replaceAll(adminPassword,'[redacted]').replaceAll(runtimePassword,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').replace(/\s+/g,' ').slice(0,180);
 console.error(`Production safe runtime rotation failed during ${stage} (${code}): ${detail}. No password values were printed.`);
 process.exitCode=1;
}finally{await sql.end();}
