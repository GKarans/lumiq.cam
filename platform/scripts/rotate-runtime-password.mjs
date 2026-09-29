import postgres from 'postgres';

const targets={
 'restore-drill':{ref:'sprzlvywzpeyuzbsyplz',host:'aws-0-eu-central-1.pooler.supabase.com'},
 production:{ref:'baqebydtinysosueksgr',host:'aws-0-eu-central-1.pooler.supabase.com'}
};
const target=process.env.LUMIQ_ROTATE_TARGET;
const config=targets[target];
const projectRef=process.env.LUMIQ_ROTATE_PROJECT_REF;
const adminPassword=process.env.LUMIQ_ROTATE_ADMIN_PASSWORD;
const runtimePassword=process.env.LUMIQ_ROTATE_RUNTIME_PASSWORD;
let stage='admin connection';

if(!config||projectRef!==config.ref||!adminPassword||!runtimePassword)throw new Error('A pinned project target and both encrypted-vault passwords are required.');
if(!/^[A-Za-z0-9_-]{32,}$/.test(runtimePassword))throw new Error('The new runtime password must be at least 32 URL-safe characters.');

function connectionUrl(username,password){
 const url=new URL(`postgresql://${username}@${config.host}:5432/postgres`);
 url.password=password;
 url.searchParams.set('sslmode','require');
 return url.toString();
}

const sql=postgres(connectionUrl(`postgres.${config.ref}`,adminPassword),{ssl:'require',max:1,connect_timeout:10,idle_timeout:2});
try{
 stage='admin identity check';
 const [identity]=await sql`select current_database() as database_name,current_user as database_user`;
 if(identity?.database_name!=='postgres'||identity.database_user!=='postgres')throw new Error('The session-pooler connection did not authenticate as the expected postgres administrator.');
 stage='runtime role review';
 const [role]=await sql`select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='lumiq_runtime'`;
 if(!role?.rolcanlogin||role.rolinherit||!role.rolbypassrls||role.rolsuper||role.rolcreatedb||role.rolcreaterole)throw new Error('The existing lumiq_runtime role does not match the reviewed role flags; no password was changed.');
 stage='password encryption check';
 const [settings]=await sql`show password_encryption`;
 if(settings.password_encryption!=='scram-sha-256')throw new Error('The database is not configured for the expected SCRAM-SHA-256 password storage; no password was changed.');
 stage='password change';
 const [statement]=await sql`select format('alter role lumiq_runtime password %L',${runtimePassword}::text) as ddl`;
 await sql.unsafe(statement.ddl);
 stage='role flags verification';
 const [after]=await sql`select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='lumiq_runtime'`;
 if(JSON.stringify(after)!==JSON.stringify(role))throw new Error('The password was changed, but role flags unexpectedly changed; stop and review before updating Hyperdrive.');
 console.log(`Runtime password rotated for the pinned ${target} project. Role privileges are unchanged. Update the matching Hyperdrive connection before relying on its Worker.`);
}catch(error){
 const code=typeof error?.code==='string'?error.code.replace(/[^A-Z0-9_]/g,'').slice(0,32):'ROTATION_FAILED';
 const detail=String(error?.message||'').replaceAll(adminPassword,'[redacted]').replaceAll(runtimePassword,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').replace(/\s+/g,' ').slice(0,180);
 console.error(`Runtime password rotation failed during ${stage} (${code}): ${detail}. No password values were printed.`);
 process.exitCode=1;
}finally{
 await sql.end();
}
