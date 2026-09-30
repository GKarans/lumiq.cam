import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,symlink} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {assertObjectInventory,assertTableInventory} from '../scripts/restore-verification.mjs';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const script=path.resolve('platform/scripts/verify-backup.mjs');
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'lumiq-backup-'));
 const database=Buffer.from('postgres public-schema dump fixture'),auth=Buffer.from('Supabase Auth data-only dump fixture'),object=Buffer.from('private photo fixture');
 await writeFile(path.join(root,'database.dump'),database);
 await writeFile(path.join(root,'auth-users.dump'),auth);
 await mkdir(path.join(root,'objects'));
 await writeFile(path.join(root,'objects/photo.webp'),object);
 const digest=data=>createHash('sha256').update(data).digest('hex');
 await writeFile(path.join(root,'manifest.json'),JSON.stringify({format_version:3,database:{scope:'lumiq-public-plus-auth-users-identities',file:'database.dump',size:database.length,sha256:digest(database),auth_file:'auth-users.dump',auth_size:auth.length,auth_sha256:digest(auth),tables:[{schema:'auth',name:'identities',rows:'1'},{schema:'auth',name:'users',rows:'1'},{schema:'public',name:'accounts',rows:'1'}]},objects:[{key:'event/photo.webp',file:'objects/photo.webp',size:object.length,sha256:digest(object)}]}));
 return root;
}
function verify(root){return spawnSync(process.execPath,[script,root],{encoding:'utf8'});}

test('backup verifier accepts matching application, Auth and object checksums',async()=>{
 const root=await fixture();try{const result=verify(root);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/database\/Auth data and 1 R2 objects/);}finally{await rm(root,{recursive:true,force:true});}
});

test('version 4 backup validates an applied migration-chain prefix',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lumiq-backup-v4-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const database=Buffer.from('application data-only dump'),auth=Buffer.from('auth data-only dump');
 await writeFile(path.join(root,'database.dump'),database);await writeFile(path.join(root,'auth-users.dump'),auth);
 const digest=data=>createHash('sha256').update(data).digest('hex');
 const migrations=await Promise.all(PLATFORM_MIGRATIONS.slice(0,46).map(async entry=>({version:entry.version,checksum:digest((await readFile(path.resolve('platform/server',entry.file),'utf8')).replaceAll('\r\n','\n'))})));
 const validMigrations=structuredClone(migrations);
 const manifest={format_version:4,database:{scope:'lumiq-public-plus-auth-users-identities',public_dump:'data-only',file:'database.dump',size:database.length,sha256:digest(database),auth_file:'auth-users.dump',auth_size:auth.length,auth_sha256:digest(auth),tables:[{schema:'auth',name:'identities',rows:'0'},{schema:'auth',name:'users',rows:'0'},{schema:'public',name:'accounts',rows:'0'}],migrations},objects:[]};
 await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 assert.equal(verify(root).status,0,verify(root).stderr);
 manifest.database.migrations[10].checksum='0'.repeat(64);await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 assert.match(verify(root).stderr,/Backup migration chain differs at/);
 manifest.database.migrations=validMigrations;manifest.database.migrations.push({version:'999-unrecognized',checksum:'0'.repeat(64)});await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 assert.match(verify(root).stderr,/Backup migration chain differs at 047-sync-account-auth-schema-usage/);
});

test('backup verifier rejects altered dump, mismatched object size and escaping paths',async t=>{
 const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'database.dump'),'altered');assert.notEqual(verify(root).status,0);
 await writeFile(path.join(root,'database.dump'),'postgres public-schema dump fixture');
 await writeFile(path.join(root,'auth-users.dump'),'altered Auth data');assert.match(verify(root).stderr,/Size mismatch: Supabase Auth users and identities dump/);
 await writeFile(path.join(root,'auth-users.dump'),'Supabase Auth data-only dump fixture');
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 manifest.objects[0].size+=1;await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));assert.match(verify(root).stderr,/Size mismatch/);
 manifest.objects[0].size-=1;manifest.objects[0].file='../outside.webp';await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));assert.match(verify(root).stderr,/escapes its directory/);
});

test('backup verifier rejects a manifest path escaping through a directory symlink',async t=>{
 const root=await fixture(),outside=await mkdtemp(path.join(os.tmpdir(),'lumiq-backup-outside-'));
 t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
 const objects=path.join(root,'objects'),externalObjects=path.join(outside,'objects');
 await rename(objects,externalObjects);
 try{await symlink(externalObjects,objects,process.platform==='win32'?'junction':'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP','EINVAL'].includes(error.code)){t.skip(`Directory symlinks are unavailable: ${error.code}`);return;}throw error;}
 const result=verify(root);assert.notEqual(result.status,0);assert.match(result.stderr,/escapes its directory/);
});

test('restore compares the complete public table row inventory',async()=>{
 const tables=[{schema:'auth',name:'identities',rows:'1'},{schema:'auth',name:'users',rows:'1'},{schema:'public',name:'accounts',rows:'1'}];
 let inventoryQuery=0;
 const sql=async()=>inventoryQuery++===0?tables.map(({schema,name})=>({schemaname:schema,tablename:name})):[];
 sql.unsafe=async query=>[{row_count:query.includes('"auth"."identities"')?'1':query.includes('"auth"."users"')?'1':'1'}];
 assert.equal(await assertTableInventory(sql,tables),3);
 inventoryQuery=0;
 await assert.rejects(assertTableInventory(sql,tables.map(item=>({...item,rows:'2'}))),/table inventory does not match/);
 inventoryQuery=0;
 await assert.rejects(assertTableInventory(sql,[]),/table inventory does not match/);
});

test('restore verifies exact R2 key, size and stream checksum inventory',async()=>{
 const bytes=Buffer.from('photo data'),digest=createHash('sha256').update(bytes).digest('hex'),expected=[{key:'event/photo.webp',size:bytes.length,sha256:digest}];
 const listPage=async()=>({Contents:[{Key:'event/photo.webp',Size:bytes.length}]});
 const getObject=async()=>({Body:Readable.from([bytes.subarray(0,3),bytes.subarray(3)])});
 assert.equal(await assertObjectInventory({bucket:'isolated',expected,listPage,getObject}),1);
 await assert.rejects(assertObjectInventory({bucket:'isolated',expected,listPage:async()=>({Contents:[]}),getObject}),/key and size inventory/);
 await assert.rejects(assertObjectInventory({bucket:'isolated',expected,listPage:async()=>({Contents:[{Key:'event/photo.webp',Size:bytes.length+1}]}),getObject}),/key and size inventory/);
 await assert.rejects(assertObjectInventory({bucket:'isolated',expected,listPage,getObject:async()=>({Body:Readable.from([Buffer.from('corrupt')])})}),/checksum mismatch/);
});
