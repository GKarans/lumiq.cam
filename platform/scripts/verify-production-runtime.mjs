import postgres from 'postgres';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const projectRef='baqebydtinysosueksgr';
const host='aws-0-eu-central-1.pooler.supabase.com';
const roleName=process.env.LUMIQ_PRODUCTION_RUNTIME_ROLE||'lumiq_runtime';
if(!['lumiq_runtime','lumiq_production_runtime'].includes(roleName))throw new Error('Production runtime role is not an allowed pinned identity.');
const hardened=roleName==='lumiq_production_runtime';
const bootstrap=process.env.LUMIQ_PRODUCTION_RUNTIME_PHASE==='bootstrap';
if(bootstrap&&!hardened)throw new Error('Bootstrap verification is only available for the dedicated safe Production role.');
const expectedVersions=(hardened&&!bootstrap?PLATFORM_MIGRATIONS:PLATFORM_MIGRATIONS.slice(0,13)).map(entry=>entry.version).sort();
const internalRpcAllowlist=[
 'apply_provider_payment_event','can_delete_platform_asset','claim_platform_deliveries','claim_platform_job',
 'claim_platform_queue_batch','collect_platform_notices','complete_platform_export_part','dead_letter_platform_job',
 'expire_platform_event','finalize_platform_event_cleanup','get_billing_subscription_id','get_platform_cleanup_manifest','get_platform_export_notice',
 'get_platform_export_part','list_platform_retention_reminders','platform_media_cleanup_should_defer',
 'prepare_platform_event_end','prepare_platform_export','queue_platform_message','reconcile_provider_subscription_state',
 'recover_stale_platform_jobs','renew_platform_job','reserve_r2_budget','reset_platform_queue_dispatch',
 'resolve_billing_owner','run_platform_retention_cycle','save_platform_thumbnail_details','settle_platform_delivery',
 'settle_platform_job'
];
const authRpcOwners=['lumiq_api_owner','lumiq_admin_owner','lumiq_billing_owner','lumiq_support_owner','lumiq_session_owner','lumiq_preview_owner'];

function readSecret(prompt){
 if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')throw new Error('Run this from the visible Codex terminal so the password can be entered without echo.');
 return new Promise((resolve,reject)=>{
  let value='';
  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const onData=chunk=>{
   for(const char of chunk){
    if(char==='\u0003'){cleanup();reject(new Error('Cancelled.'));return;}
    if(char==='\r'||char==='\n'){cleanup();resolve(value);return;}
    if(char==='\u007f'||char==='\b')value=value.slice(0,-1);
    else if(char>=' ')value+=char;
   }
  };
  function cleanup(){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
  process.stdin.on('data',onData);
 });
}

let password='';
let sql;
let stage='connect';
try{
 password=process.env.LUMIQ_PRODUCTION_RUNTIME_PASSWORD||await readSecret(`Production ${roleName} password (hidden; read-only check): `);
 if(!password)throw new Error('Password was empty.');
 const connection=new URL(`postgresql://${roleName}.${projectRef}@${host}:5432/postgres`);
 connection.password=password;
 connection.searchParams.set('sslmode','require');
 sql=postgres(connection.toString(),{ssl:'require',max:1,connect_timeout:10,idle_timeout:2});
 password='';

 const [identity]=await sql`
  select current_database() as database_name,current_user as runtime_user,
   r.rolcanlogin,r.rolinherit,r.rolbypassrls,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication
  from pg_roles r where r.rolname=current_user
 `;
 stage='identity check';
 if(identity?.database_name!=='postgres'||identity.runtime_user!==roleName||!identity.rolcanlogin||identity.rolsuper||identity.rolcreatedb||identity.rolcreaterole||identity.rolreplication||identity.rolinherit||identity.rolbypassrls===hardened)throw new Error('Connected database or runtime role identity does not match the pinned Production target.');
 stage='Auth RPC owner privileges check';
 const authOwnerAccess=await sql`select r.rolname,has_schema_privilege(r.rolname,'auth','usage') as auth_schema_usage from pg_roles r where r.rolname=any(${authRpcOwners}) order by r.rolname`;
 if(authOwnerAccess.length!==authRpcOwners.length||authOwnerAccess.some(role=>!role.auth_schema_usage))throw new Error('One or more JWT-bound Auth RPC owners are missing auth schema USAGE.');
 stage='migration ledger check';
 const versions=await sql`select version from public.platform_migrations order by version`;
 const applied=versions.map(row=>row.version);
 if(JSON.stringify(applied)!==JSON.stringify(expectedVersions))throw new Error(`Production migration ledger does not match the expected ${hardened?'full':'pre-hardening'} version set.`);
 stage='RLS and grants check';
 const [access]=await sql`
  select count(*)::integer as public_tables,
   count(*) filter(where not c.relrowsecurity)::integer as tables_without_rls,
   count(*) filter(where has_table_privilege('anon',c.oid,'select'))::integer as anon_direct_select,
   count(*) filter(where has_table_privilege('authenticated',c.oid,'select'))::integer as authenticated_direct_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
 `;
 if(access.public_tables!==19||access.tables_without_rls!==0||access.anon_direct_select!==0||access.authenticated_direct_select!==0)throw new Error('Production public-table RLS or browser-role access does not match the reviewed state.');
 let runtimeAccess;
 if(hardened&&bootstrap){
  stage='safe runtime bootstrap grants check';
  runtimeAccess=(await sql`
   select count(*) filter(where case when c.relkind in ('r','p') then has_table_privilege(current_user,c.oid,'select') or has_table_privilege(current_user,c.oid,'insert') or has_table_privilege(current_user,c.oid,'update') or has_table_privilege(current_user,c.oid,'delete') else false end)::integer as direct_table_access,
    count(*) filter(where case when c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and not(n.nspname='public' and c.relname='platform_migrations' and a.attname='version') then has_column_privilege(current_user,c.oid,a.attnum,'select') or has_column_privilege(current_user,c.oid,a.attnum,'insert') or has_column_privilege(current_user,c.oid,a.attnum,'update') or has_column_privilege(current_user,c.oid,a.attnum,'references') else false end)::integer as other_column_access
   from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid
   where n.nspname='public'
  `)[0];
  runtimeAccess.sequence_access=(await sql`select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'usage,select,update') else false end`)[0].count;
  const [migrationRead]=await sql`select has_column_privilege(current_user,'public.platform_migrations','version','select') as can_read_versions,has_column_privilege(current_user,'public.platform_migrations','checksum','select') as can_read_checksums`;
  runtimeAccess.migrationVersionOnly=migrationRead.can_read_versions&&!migrationRead.can_read_checksums;
  if(runtimeAccess.direct_table_access||runtimeAccess.other_column_access||runtimeAccess.sequence_access||!runtimeAccess.migrationVersionOnly)throw new Error('Safe bootstrap role has unexpected table, column, sequence or migration-ledger access.');
 } else if(hardened){
  stage='hardened runtime grant check';
  runtimeAccess=(await sql`
   select count(*) filter(where has_table_privilege(current_user,c.oid,'select'))::integer as direct_select,
    count(*) filter(where has_table_privilege(current_user,c.oid,'insert'))::integer as direct_insert,
    count(*) filter(where has_table_privilege(current_user,c.oid,'update'))::integer as direct_update,
    count(*) filter(where has_table_privilege(current_user,c.oid,'delete'))::integer as direct_delete,
    count(*) filter(where a.attnum>0 and not a.attisdropped and not(n.nspname='public' and c.relname='platform_migrations' and a.attname='version') and has_column_privilege(current_user,c.oid,a.attnum,'select'))::integer as column_select,
    count(*) filter(where a.attnum>0 and not a.attisdropped and (has_column_privilege(current_user,c.oid,a.attnum,'insert') or has_column_privilege(current_user,c.oid,a.attnum,'update') or has_column_privilege(current_user,c.oid,a.attnum,'references')))::integer as column_write
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   left join pg_attribute a on a.attrelid=c.oid
   where n.nspname='public' and c.relkind in ('r','p')
  `)[0];
  if(runtimeAccess.direct_select||runtimeAccess.direct_insert||runtimeAccess.direct_update||runtimeAccess.direct_delete||runtimeAccess.column_select||runtimeAccess.column_write)throw new Error('Hardened Production runtime has direct public table or column access.');
  const sequenceAccess=(await sql`select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'usage,select,update') else false end`)[0].count;
  runtimeAccess.sequence_access=sequenceAccess;
  if(sequenceAccess)throw new Error('Hardened Production runtime has direct public sequence access.');
  const [migrationRead]=await sql`select has_column_privilege(current_user,'public.platform_migrations','version','select') as can_read_versions,has_column_privilege(current_user,'public.platform_migrations','checksum','select') as can_read_checksums`;
  if(!migrationRead.can_read_versions||migrationRead.can_read_checksums)throw new Error('Hardened Production runtime migration-ledger access is broader than version-only.');
  const definers=(await sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) and has_function_privilege(current_user,p.oid,'execute') order by p.proname`).map(row=>row.proname);
  if(JSON.stringify(definers)!==JSON.stringify(internalRpcAllowlist))throw new Error('Hardened Production SECURITY DEFINER RPC allowlist does not match the reviewed list.');
  runtimeAccess={...runtimeAccess,migrationVersionOnly:true,securityDefinerRpcAllowlist:definers};
 }
 console.log(JSON.stringify({targetProject:projectRef,database:identity.database_name,user:identity.runtime_user,login:identity.rolcanlogin,noinherit:!identity.rolinherit,bypassRls:identity.rolbypassrls,superuser:identity.rolsuper,createdb:identity.rolcreatedb,createrole:identity.rolcreaterole,replication:identity.rolreplication,authOwnerAccess,migrations:applied,access,runtimeAccess}));
}catch(error){
 const code=typeof error?.code==='string'?error.code.replace(/[^A-Z0-9_]/g,'').slice(0,32):'CHECK_FAILED';
 console.error(`Production runtime verification failed during ${stage} (${code}). No database changes were made.`);
 process.exitCode=1;
}finally{
 password='';
 if(sql)await sql.end();
}
