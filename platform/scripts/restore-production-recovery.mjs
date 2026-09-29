import {createWriteStream} from 'node:fs';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import postgres from 'postgres';
import {fileURLToPath} from 'node:url';
import {GetObjectCommand,ListObjectsV2Command,S3Client} from '@aws-sdk/client-s3';
import {pipeline} from 'node:stream/promises';
import {assertEmptyAuthUsers,assertEmptyPublicSchema,ensureProductionCompatibilityRole,waitForChildExit,validateRestoreTarget} from './restore-safety.mjs';

const productionProject='baqebydtinysosueksgr';
const protectedProjects=new Set([productionProject,'sprzlvywzpeyuzbsyplz','cpweowosocjuccjsyyic']);
const backupBucket='lumiq-production-backups';
const recoveryBucket='lumiq-production-recovery';
const backupEndpoint='https://af664043db99694ff5a6ac88a7e7dc4d.eu.r2.cloudflarestorage.com';
const recoveryEndpoint=backupEndpoint;
const recoveryPoolerHost='aws-1-eu-central-1.pooler.supabase.com';
const projectRef=process.env.LUMIQ_RECOVERY_PROJECT_REF;
const databasePassword=process.env.LUMIQ_RECOVERY_DB_PASSWORD;
const runtimePassword=process.env.LUMIQ_RECOVERY_RUNTIME_PASSWORD;
const backupAccessKeyId=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID;
const backupSecretAccessKey=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY;
const recoveryAccessKeyId=process.env.LUMIQ_RECOVERY_R2_ACCESS_KEY_ID;
const recoverySecretAccessKey=process.env.LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY;

if(!projectRef||! /^[a-z0-9]{20}$/i.test(projectRef)||protectedProjects.has(projectRef))throw new Error('Supply a new Recovery project ref; Production, Restore Drill and closed-test refs are forbidden.');
if(!databasePassword||!runtimePassword||!backupAccessKeyId||!backupSecretAccessKey||!recoveryAccessKeyId||!recoverySecretAccessKey)throw new Error('Recovery restore credentials are missing from the DPAPI-protected process.');
validateRestoreTarget(`postgresql://postgres.${projectRef}@${recoveryPoolerHost}:5432/postgres`,projectRef);

const backupS3=new S3Client({region:'auto',endpoint:backupEndpoint,credentials:{accessKeyId:backupAccessKeyId,secretAccessKey:backupSecretAccessKey}});
const recoveryS3=new S3Client({region:'auto',endpoint:recoveryEndpoint,credentials:{accessKeyId:recoveryAccessKeyId,secretAccessKey:recoverySecretAccessKey}});
const root=path.join(tmpdir(),`lumiq-recovery-restore-${randomUUID()}`);
const scriptDirectory=path.dirname(fileURLToPath(import.meta.url));
const safeFile=(relative)=>{
 if(typeof relative!=='string'||!relative||relative.startsWith('/')||/^[A-Za-z]:/.test(relative))throw new Error('Backup manifest has an invalid local path.');
 const normalized=relative.replaceAll('\\','/');
 const resolved=path.resolve(root,normalized),inside=path.relative(root,resolved);
 if(!inside||inside==='..'||inside.startsWith(`..${path.sep}`)||path.isAbsolute(inside))throw new Error('Backup manifest path escapes the temporary restore directory.');
 return resolved;
};
const run=async(file,args,env)=>{
 const child=spawn(process.execPath,[file,...args],{stdio:'inherit',windowsHide:true,env});
 const code=await waitForChildExit(child);
 if(code!==0)throw new Error(`Recovery restore sub-step failed with exit code ${code}.`);
};
let created=false;
try{
 const targetObjects=await recoveryS3.send(new ListObjectsV2Command({Bucket:recoveryBucket,MaxKeys:1}));
 if(targetObjects.KeyCount)throw new Error('Recovery R2 bucket is not empty; refusing to restore.');
 let token,prefixes=[];
 do{
  const page=await backupS3.send(new ListObjectsV2Command({Bucket:backupBucket,Prefix:'production/',Delimiter:'/',ContinuationToken:token}));
  prefixes.push(...(page.CommonPrefixes||[]).map(item=>item.Prefix).filter(value=>/^production\/[0-9TZ.-]+\/$/.test(value||'')));
  token=page.NextContinuationToken;
 }while(token);
 const prefix=prefixes.sort().at(-1)?.slice(0,-1);
 if(!prefix)throw new Error('No Production backup prefix was found in the private backups bucket.');
 const manifestKey=`${prefix}/manifest.json`;
 const manifestObject=await backupS3.send(new GetObjectCommand({Bucket:backupBucket,Key:manifestKey}));
 const manifest=JSON.parse(await manifestObject.Body.transformToString());
 if(![3,4].includes(manifest.format_version)||manifest.database?.source_project_ref!==productionProject||manifest.remote_bucket!==backupBucket||manifest.remote_prefix!==prefix||manifest.bucket!=='lumiq-production-photos'||!Array.isArray(manifest.objects))throw new Error('Latest backup manifest is not pinned to the verified Production source and backup bucket.');
 await mkdir(root,{recursive:false});created=true;
 const files=[
  {relative:manifest.database.file,key:`${prefix}/${manifest.database.file}`},
  {relative:manifest.database.auth_file,key:`${prefix}/${manifest.database.auth_file}`},
  {relative:'manifest.json',key:manifestKey},
  ...manifest.objects.map(item=>({relative:item.file,key:`${prefix}/${String(item.file).replaceAll('\\','/')}`}))
 ];
 const seenFiles=new Set(),seenKeys=new Set();
 for(const item of files){
  const local=safeFile(item.relative);
  if(seenFiles.has(local)||seenKeys.has(item.key))throw new Error('Production backup manifest contains duplicate recovery paths.');
  seenFiles.add(local);seenKeys.add(item.key);
  await mkdir(path.dirname(local),{recursive:true});
  const object=await backupS3.send(new GetObjectCommand({Bucket:backupBucket,Key:item.key}));
  await pipeline(object.Body,createWriteStream(local,{flags:'wx'}));
 }
 const verifyEnv={...process.env};
 for(const name of ['LUMIQ_RECOVERY_DB_PASSWORD','LUMIQ_RECOVERY_RUNTIME_PASSWORD','LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY','LUMIQ_RECOVERY_R2_ACCESS_KEY_ID','LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY'])delete verifyEnv[name];
 await run(path.join(scriptDirectory,'verify-backup.mjs'),[root],verifyEnv);
 const database=new URL(`postgresql://postgres.${projectRef}@${recoveryPoolerHost}:5432/postgres`);
 database.password=databasePassword;
 database.searchParams.set('sslmode','require');
 if(manifest.format_version===4){
  const preflightDb=postgres(database.toString(),{ssl:'require',max:1,connect_timeout:10,idle_timeout:2});
  try{
   await assertEmptyPublicSchema(preflightDb);
   await assertEmptyAuthUsers(preflightDb);
   await ensureProductionCompatibilityRole(preflightDb);
  }finally{await preflightDb.end();}
  const migrationEnv={...process.env,LUMIQ_MIGRATION_TARGET:'recovery',LUMIQ_RECOVERY_PROJECT_REF:projectRef};
  await run(path.join(scriptDirectory,'apply-restore-drill-migrations.mjs'),[],migrationEnv);
 }
 const restoreEnv={
  ...process.env,
  PLATFORM_DATABASE_URL:database.toString(),
  PLATFORM_R2_BUCKET:recoveryBucket,
  PLATFORM_R2_ENDPOINT:recoveryEndpoint,
  PLATFORM_R2_ACCESS_KEY_ID:recoveryAccessKeyId,
  PLATFORM_R2_SECRET_ACCESS_KEY:recoverySecretAccessKey,
  PLATFORM_RUNTIME_PASSWORD:runtimePassword,
  PLATFORM_RESTORE_TARGET_REF:projectRef,
  PLATFORM_RESTORE_DRILL:'EMPTY-ISOLATED-TARGET',
  PLATFORM_RESTORE_FORMAT:String(manifest.format_version)
 };
 database.password='';
 for(const name of ['LUMIQ_RECOVERY_DB_PASSWORD','LUMIQ_RECOVERY_RUNTIME_PASSWORD','LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY','LUMIQ_RECOVERY_R2_ACCESS_KEY_ID','LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY'])delete restoreEnv[name];
 await run(path.join(scriptDirectory,'restore-drill.mjs'),[root],restoreEnv);
 console.log(`Production backup ${prefix} restored and verified on isolated Recovery project ${projectRef}.`);
 console.log(manifest.format_version===4?'Migration checksums and schema were verified before restoring data.':'Apply the Recovery migration chain next.');
}catch(error){
 const detail=String(error?.message||'Recovery restore failed.').replaceAll(databasePassword,'[redacted]').replaceAll(runtimePassword,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]').replace(/\s+/g,' ').slice(0,240);
 console.error(`Production Recovery restore failed: ${detail}. No credential values were printed.`);
 process.exitCode=1;
}finally{
 if(created)await rm(root,{recursive:true,force:true});
 backupS3.destroy();recoveryS3.destroy();
}
