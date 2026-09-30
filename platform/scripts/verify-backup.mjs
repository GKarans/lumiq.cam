import {readFile,lstat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const root=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Usage: node platform/scripts/verify-backup.mjs <backup-directory>');
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const resolveFile=relative=>{
 if(typeof relative!=='string'||!relative)throw new Error('Backup manifest contains an invalid file path.');
 const file=path.resolve(root,relative),inside=path.relative(root,file);
 if(!inside||inside.startsWith(`..${path.sep}`)||inside==='..'||path.isAbsolute(inside))throw new Error('Backup manifest file path escapes its directory.');
 return file;
};
const realRoot=await realpath(root);
const verifyFile=async({file,size,sha256},label)=>{
 if(!Number.isSafeInteger(size)||size<0||typeof sha256!=='string'||! /^[a-f0-9]{64}$/i.test(sha256))throw new Error(`Backup manifest has invalid integrity data: ${label}`);
 const target=await realpath(resolveFile(file)),inside=path.relative(realRoot,target);
 if(!inside||inside.startsWith(`..${path.sep}`)||inside==='..'||path.isAbsolute(inside))throw new Error('Backup manifest file path escapes its directory.');
 const info=await lstat(target);
 if(!info.isFile())throw new Error(`Backup item is not a regular file: ${label}`);
 if(info.size!==size)throw new Error(`Size mismatch: ${label}`);
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(target))hash.update(chunk);
 if(hash.digest('hex')!==sha256.toLowerCase())throw new Error(`Checksum mismatch: ${label}`);
};

const database=manifest.database;
 if(![3,4].includes(manifest.format_version)||database?.scope!=='lumiq-public-plus-auth-users-identities'||!Array.isArray(database.tables)||!Array.isArray(manifest.objects)){
 throw new Error('Backup manifest is incomplete or outdated. Create a new version 4 backup.');
 }
if(manifest.format_version===4){
 if(database.public_dump!=='data-only'||!Array.isArray(database.migrations)||database.migrations.length===0||database.migrations.length>PLATFORM_MIGRATIONS.length)throw new Error('Version 4 backup is missing its data-only marker or has an invalid migration chain.');
 for(let index=0;index<database.migrations.length;index++){
  const entry=PLATFORM_MIGRATIONS[index],applied=database.migrations[index];
  const source=(await readFile(new URL(`../server/${entry.file}`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const checksum=createHash('sha256').update(source).digest('hex');
  if(applied?.version!==entry.version||applied?.checksum!==checksum)throw new Error(`Backup migration chain differs at ${entry.version}.`);
 }
}
const tableNames=new Set();
for(const table of database.tables){
 const validPublic=table?.schema==='public'&&typeof table.name==='string'&&table.name.length>0;
 const validAuth=table?.schema==='auth'&&['users','identities'].includes(table.name);
 if((!validPublic&&!validAuth)||typeof table.rows!=='string'||!/^\d+$/.test(table.rows))throw new Error('Backup manifest contains an invalid database table inventory.');
 const name=`${table.schema}.${table.name}`;
 if(tableNames.has(name))throw new Error('Backup manifest contains a duplicate database table.');
 tableNames.add(name);
}
if(!['auth.users','auth.identities'].every(name=>tableNames.has(name)))throw new Error('Backup manifest is missing required Supabase Auth user data.');
const objectKeys=new Set();
for(const object of manifest.objects){
 if(typeof object?.key!=='string'||!object.key||objectKeys.has(object.key))throw new Error('Backup manifest contains an invalid or duplicate R2 key.');
 objectKeys.add(object.key);
}

await verifyFile(database,'Lumiq public database dump');
await verifyFile({file:database.auth_file,size:database.auth_size,sha256:database.auth_sha256},'Supabase Auth users and identities dump');
for(const object of manifest.objects)await verifyFile(object,object.key||'unnamed object');
console.log(`Backup verified: Lumiq database/Auth data and ${manifest.objects.length} R2 objects. Restore into an empty isolated drill environment before approving production.`);
