import {createWriteStream} from 'node:fs';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GetObjectCommand,ListObjectsV2Command,S3Client} from '@aws-sdk/client-s3';
import {pipeline} from 'node:stream/promises';
import {waitForChildExit} from './restore-safety.mjs';

const bucket='lumiq-production-backups';
const endpoint='https://af664043db99694ff5a6ac88a7e7dc4d.eu.r2.cloudflarestorage.com';
const project='baqebydtinysosueksgr';
const accessKeyId=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID;
const secretAccessKey=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY;
if(!accessKeyId||!secretAccessKey)throw new Error('Production backup check needs DPAPI-protected R2 credentials.');

const s3=new S3Client({region:'auto',endpoint,credentials:{accessKeyId,secretAccessKey}});
const root=path.join(tmpdir(),`lumiq-production-backup-check-${randomUUID()}`);
const scriptDirectory=path.dirname(fileURLToPath(import.meta.url));
let created=false;
const safePath=relative=>{
 if(typeof relative!=='string'||!relative||relative.startsWith('/')||/^[A-Za-z]:/.test(relative))throw new Error('Backup manifest path is invalid.');
 const resolved=path.resolve(root,relative.replaceAll('\\','/'));
 const inside=path.relative(root,resolved);
 if(!inside||inside==='..'||inside.startsWith(`..${path.sep}`)||path.isAbsolute(inside))throw new Error('Backup manifest path escapes its temporary directory.');
 return resolved;
};

try{
 let token;
 const prefixes=[];
 do{
  const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'production/',Delimiter:'/',ContinuationToken:token}));
  prefixes.push(...(page.CommonPrefixes||[]).map(item=>item.Prefix).filter(value=>/^production\/[0-9TZ.-]+\/$/.test(value||'')));
  token=page.NextContinuationToken;
 }while(token);
 const prefix=prefixes.sort().at(-1)?.slice(0,-1);
 if(!prefix)throw new Error('No Production backup exists in the configured private R2 bucket.');
 const manifestKey=`${prefix}/manifest.json`;
 const manifestResponse=await s3.send(new GetObjectCommand({Bucket:bucket,Key:manifestKey}));
 const manifest=JSON.parse(await manifestResponse.Body.transformToString());
 if(![3,4].includes(manifest.format_version)||manifest.database?.source_project_ref!==project||manifest.remote_bucket!==bucket||manifest.remote_prefix!==prefix||manifest.bucket!=='lumiq-production-photos'||!Array.isArray(manifest.objects))throw new Error('Latest backup manifest is not pinned to Production and the expected private buckets.');
 await mkdir(root,{recursive:false});created=true;
 const entries=[
  {relative:manifest.database.file,key:`${prefix}/${manifest.database.file}`},
  {relative:manifest.database.auth_file,key:`${prefix}/${manifest.database.auth_file}`},
  {relative:'manifest.json',key:manifestKey},
  ...manifest.objects.map(item=>({relative:item.file,key:`${prefix}/${String(item.file).replaceAll('\\','/')}`}))
 ];
 const files=new Set(),keys=new Set();
 for(const entry of entries){
  const local=safePath(entry.relative);
  if(files.has(local)||keys.has(entry.key))throw new Error('Latest backup has duplicate files or object keys.');
  files.add(local);keys.add(entry.key);
  await mkdir(path.dirname(local),{recursive:true});
  const response=await s3.send(new GetObjectCommand({Bucket:bucket,Key:entry.key}));
  await pipeline(response.Body,createWriteStream(local,{flags:'wx'}));
 }
 const env={...process.env};
 delete env.LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID;
 delete env.LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY;
 const verifier=spawn(process.execPath,[path.join(scriptDirectory,'verify-backup.mjs'),root],{stdio:'inherit',windowsHide:true,env});
 if(await waitForChildExit(verifier)!==0)throw new Error('Latest Production backup failed local integrity verification.');
 console.log(`Latest private Production backup verified: ${prefix}; ${manifest.database.tables.length} tables, ${manifest.database.migrations?.length||0} migrations, ${manifest.objects.length} photo objects.`);
}catch(error){
 const message=String(error?.message||'Production backup verification failed.').replace(/https?:\/\/[^\s]+/g,'[endpoint redacted]').replace(/\s+/g,' ').slice(0,220);
 console.error(`Production backup verification failed: ${message}. No credentials were printed.`);
 process.exitCode=1;
}finally{
 if(created)await rm(root,{recursive:true,force:true});
 s3.destroy();
}
