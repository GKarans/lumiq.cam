import {DeleteObjectsCommand,GetObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {validateMigrationPrefix} from './validate-migration-prefix.mjs';

const timestampFromPrefix=prefix=>{
 const match=/^production\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\/$/.exec(prefix);
 if(!match)return null;
 const [date,time]=match[1].split('T');
 const timestamp=Date.parse(`${date}T${time.replaceAll('-',':').replace(/:(\d{3})Z$/,'.$1Z')}`);
 return Number.isFinite(timestamp)?timestamp:null;
};

const backupKey=(prefix,relative)=>{
 if(typeof relative!=='string'||!relative||relative.startsWith('/')||/^[A-Za-z]:/.test(relative))return null;
 const normalized=relative.replaceAll('\\','/');
 const parts=normalized.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'))return null;
 return `${prefix}${normalized}`;
};

async function listAll(s3,input){
 const objects=[];let token;
 do{
  const page=await s3.send(new ListObjectsV2Command({...input,ContinuationToken:token}));
  objects.push(...(page.Contents||[]));token=page.NextContinuationToken;
 }while(token);
 return objects;
}

async function completeBackup(s3,bucket,candidate){
 const prefix=candidate.prefix.slice(0,-1),manifestKey=`${prefix}/manifest.json`;
 let manifest;
 try{
  const response=await s3.send(new GetObjectCommand({Bucket:bucket,Key:manifestKey}));
  manifest=JSON.parse(await response.Body.transformToString());
 }catch{return null;}
 const database=manifest?.database;
 if(manifest.format_version!==4||manifest.remote_prefix!==prefix||manifest.remote_bucket!==bucket||manifest.bucket!=='lumiq-production-photos'||database?.scope!=='lumiq-public-plus-auth-users-identities'||database?.source_project_ref!=='baqebydtinysosueksgr'||!Array.isArray(manifest.objects)||!Array.isArray(database.tables)||!Array.isArray(database.migrations))return null;
 try{await validateMigrationPrefix(database.migrations);}catch{return null;}
 if(!['auth.users','auth.identities'].every(name=>database.tables.some(table=>`${table.schema}.${table.name}`===name)))return null;

 const expected=new Map([[manifestKey,null]]);
 const add=(relative,size)=>{
  const key=backupKey(`${prefix}/`,relative);
  if(!key||expected.has(key)||!Number.isSafeInteger(size)||size<0)return false;
  expected.set(key,size);return true;
 };
 if(!add(database.file,database.size)||!add(database.auth_file,database.auth_size))return null;
 for(const object of manifest.objects)if(!add(object?.file,object?.size))return null;
 const actual=await listAll(s3,{Bucket:bucket,Prefix:`${prefix}/`});
 if(actual.length!==expected.size||actual.some(item=>!expected.has(item.Key)||(expected.get(item.Key)!==null&&expected.get(item.Key)!==item.Size)))return null;
 return{...candidate,objects:actual};
}

export async function pruneProductionBackups({s3,bucket,now=new Date(),retentionDays=30}){
 if(!s3||!bucket||!Number.isInteger(retentionDays)||retentionDays<30)throw new Error('Production backup retention requires a bucket and at least 30 days.');
 const prefixes=[];let token;
 do{
  const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'production/',Delimiter:'/',ContinuationToken:token}));
  prefixes.push(...(page.CommonPrefixes||[]).map(item=>item.Prefix).filter(Boolean));token=page.NextContinuationToken;
 }while(token);

 const dated=prefixes.map(prefix=>({prefix,time:timestampFromPrefix(prefix)})).filter(item=>item.time!==null).sort((a,b)=>a.time-b.time);
 const newestDated=dated.at(-1)?.prefix;
 const complete=[];
 for(const candidate of dated){
  const verified=await completeBackup(s3,bucket,candidate);
  if(verified)complete.push(verified);
 }
 const newest=complete.at(-1)?.prefix;
 if(newestDated&&newest!==newestDated)return{retentionDays,deletedPrefixes:[],newestPrefix:newestDated,eligiblePrefixes:dated.length,blockedByIncompleteNewest:true};
 const cutoff=now.getTime()-retentionDays*24*60*60*1000;
 const removed=[];

 for(const candidate of complete){
  if(candidate.prefix===newest||candidate.time>=cutoff)continue;
  const prefix=candidate.prefix.slice(0,-1);
  const actual=candidate.objects;
  for(let index=0;index<actual.length;index+=1000){
   const batch=actual.slice(index,index+1000);
   const result=await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Quiet:true,Objects:batch.map(item=>({Key:item.Key}))}}));
   if(result.Errors?.length)throw new Error('R2 reported an incomplete Production backup retention deletion.');
  }
  removed.push(prefix);
 }

 return{retentionDays,deletedPrefixes:removed,newestPrefix:newest||null,eligiblePrefixes:dated.length,blockedByIncompleteNewest:false};
}
