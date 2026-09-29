import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {assertEmptyAuthUsers,assertEmptyPublicSchema,ensureProductionCompatibilityRole,inspectPublicRestoreState,libpqConnectionForCli,provisionRestoredRuntimeRole,validateRestoreTarget,waitForChildExit} from '../scripts/restore-safety.mjs';

const ref='cpweowosocjuccjsyyic';

test('restore candidate config is isolated, closed and cannot run retention automatically',async()=>{
 const config=JSON.parse(await readFile(new URL('../../cloudflare/worker/wrangler.restore-drill.template.jsonc',import.meta.url),'utf8'));
 assert.equal(config.name,'lumiq-restore-drill-candidate');
 assert.equal(config.workers_dev,true);
 assert.equal(config.preview_urls,false);
 assert.equal(config.routes,undefined);
 assert.equal(config.triggers,undefined);
 assert.equal(config.queues,undefined);
 assert.equal(config.vars.PLATFORM_RELEASE_APPROVED,'NOT_APPROVED');
 assert.equal(config.vars.PLATFORM_SUPABASE_PROJECT_REF,'sprzlvywzpeyuzbsyplz');
 assert.deepEqual(config.r2_buckets.map(({bucket_name})=>bucket_name),['lumiq-restore-drill-20260925']);
 assert.equal(config.hyperdrive[0].id,'00000000000000000000000000000000');
});

test('libpq CLI connections keep passwords out of process arguments',()=>{
 const result=libpqConnectionForCli('postgresql://postgres.project:pa%40ss%3Aword@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require');
 assert.equal(result.password,'pa@ss:word');
 assert.equal(result.connectionString,'postgresql://postgres.project@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require');
 assert.equal(result.connectionString.includes('pa@ss'),false);
 assert.throws(()=>libpqConnectionForCli('postgresql://postgres@db.example.com:5432/postgres'),/include a host, username and password/);
});

test('restore target confirmation matches direct and session-pooler Supabase URLs',()=>{
 assert.equal(validateRestoreTarget(`postgresql://postgres.${ref}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,ref),ref);
 assert.equal(validateRestoreTarget(`postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,ref),ref);
});

test('restore target confirmation rejects wrong project refs and non-Supabase hosts',()=>{
 assert.throws(()=>validateRestoreTarget(`postgresql://postgres.${ref}:secret@pool.example.com:5432/postgres`,ref),/does not match/);
 assert.throws(()=>validateRestoreTarget(`postgresql://postgres.otherref:secret@pooler.supabase.com:5432/postgres`,ref),/does not match/);
 assert.throws(()=>validateRestoreTarget(`postgresql://postgres.${ref}:secret@pooler.supabase.com:5432/postgres`,''),/Confirm the exact/);
});

test('restore target confirmation rejects wrong schemes and transaction-pooler port',()=>{
 assert.throws(()=>validateRestoreTarget(`https://postgres.${ref}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,ref),/PostgreSQL endpoint on port 5432/);
 assert.throws(()=>validateRestoreTarget(`postgresql://postgres.${ref}:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,ref),/PostgreSQL endpoint on port 5432/);
});

test('restore preflight refuses databases containing public tables',async()=>{
 const empty=async()=>[];
 await assertEmptyPublicSchema(empty);
 await assert.rejects(assertEmptyPublicSchema(async()=>[{table_name:'events'}]),/not empty \(events\)/);
});

test('partial restore retry only cleans tables named in the verified backup',async()=>{
 const expected=[{schema:'public',name:'accounts'},{schema:'public',name:'events'}];
 const query=rows=>async strings=>strings.join('').includes('pg_catalog.pg_tables')?rows:[];
 assert.equal(await inspectPublicRestoreState(query([]),expected),false);
 await assert.rejects(inspectPublicRestoreState(query([{table_name:'accounts'}]),expected),/Confirm the exact target/);
 assert.equal(await inspectPublicRestoreState(query([{table_name:'accounts'},{table_name:'events'}]),expected,{allowPartial:true}),true);
 await assert.rejects(inspectPublicRestoreState(query([{table_name:'accounts'},{table_name:'unexpected'}]),expected,{allowPartial:true}),/outside this backup/);
});

test('restored runtime role is NOBYPASSRLS with no table grants or memberships',async()=>{
 const statements=[];
 const tx=async(strings,...values)=>{
  const query=strings.join('?');
  if(query.includes("rolname='lumiq_restore_runtime'"))return[];
  if(query.includes('format('))return[{ddl:`create role lumiq_restore_runtime login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication password '${values[0]}'`}];
  return[];
 };
 tx.unsafe=async statement=>statements.push(statement);
 const sql=async(strings)=>{
  const query=strings.join('');
  if(query.includes('show password_encryption'))return[{password_encryption:'scram-sha-256'}];
  if(query.includes("rolname in ('anon'"))return[{rolname:'anon'},{rolname:'authenticated'},{rolname:'service_role'}];
  if(query.includes('has_table_privilege'))return[{rolcanlogin:true,rolinherit:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolsuper:false,can_read_accounts:false,can_insert_accounts:false,can_update_accounts:false,can_delete_accounts:false,has_any_table_privileges:false,has_any_sequence_privileges:false,has_memberships:false,owns_objects:false,anon_can_read_accounts:false,authenticated_can_read_accounts:false}];
  return[];
 };
 sql.begin=callback=>callback(tx);
 await assert.rejects(provisionRestoredRuntimeRole(sql,'too-short'),/32 characters/);
 await provisionRestoredRuntimeRole(sql,'a'.repeat(32));
 assert.ok(statements.some(statement=>statement.includes('login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication')));
 assert.ok(statements.some(statement=>statement.includes('revoke all privileges on all tables in schema public from lumiq_restore_runtime')));
 assert.ok(statements.some(statement=>statement.includes('revoke all privileges on all sequences in schema public from lumiq_restore_runtime')));
 assert.ok(statements.some(statement=>statement.includes('grant connect on database postgres to lumiq_restore_runtime')));
 assert.ok(statements.every(statement=>!statement.includes('grant select, insert, update, delete on all tables')));
});

test('restore refuses an existing runtime role that bypasses RLS',async()=>{
 let mutated=false;
 const tx=async(strings)=>{
  if(strings.join('').includes("rolname='lumiq_restore_runtime'"))return[{rolcanlogin:true,rolinherit:false,rolbypassrls:true,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolsuper:false}];
  return[];
 };
 tx.unsafe=async()=>{mutated=true;};
 const sql=async strings=>strings.join('').includes('show password_encryption')?[{password_encryption:'scram-sha-256'}]:strings.join('').includes("rolname in ('anon'")?[{rolname:'anon'},{rolname:'authenticated'},{rolname:'service_role'}]:[];
 sql.begin=callback=>callback(tx);
 await assert.rejects(provisionRestoredRuntimeRole(sql,'a'.repeat(32)),/unexpected privileges/);
 assert.equal(mutated,false);
});

test('restore preflight refuses target projects with existing Auth users or identities',async()=>{
 await assertEmptyAuthUsers(async()=>[]);
 await assert.rejects(assertEmptyAuthUsers(async()=>[{table_name:'users'}]),/Auth data is not empty \(users\)/);
 await assert.rejects(assertEmptyAuthUsers(async()=>[{table_name:'identities'}]),/Auth data is not empty \(identities\)/);
});

test('Recovery compatibility role has login but no password or elevated role attributes',async()=>{
 const statements=[];
 const tx=async strings=>strings.join('').includes('from pg_roles')?[]:[];
 tx.unsafe=async statement=>statements.push(statement);
 const sql=async strings=>strings.join('').includes('from pg_roles')?[{rolcanlogin:true,rolinherit:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolsuper:false}]:[];
 sql.begin=callback=>callback(tx);
 await ensureProductionCompatibilityRole(sql);
 assert.deepEqual(statements,['create role lumiq_production_runtime login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication']);
 await assert.rejects(ensureProductionCompatibilityRole(Object.assign(async strings=>strings.join('').includes('from pg_roles')?[{rolcanlogin:true,rolinherit:false,rolbypassrls:true,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolsuper:false}]:[],{begin:callback=>callback(async()=>[{rolcanlogin:true,rolinherit:false,rolbypassrls:true,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolsuper:false}])})),/not least-privileged/);
});

test('missing restore utility rejects rather than leaving the drill waiting',async()=>{
 const child=new EventEmitter(),pending=waitForChildExit(child);child.emit('error',Object.assign(new Error('missing'),{code:'ENOENT'}));
 await assert.rejects(pending,/missing/);
});
