import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import postgres from 'postgres';
import {GetObjectCommand,ListObjectsV2Command,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {libpqConnectionForCli,waitForChildExit} from './restore-safety.mjs';
import {captureTableInventory} from './restore-verification.mjs';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';
import {pipeline} from 'node:stream/promises';

const sourceProject='baqebydtinysosueksgr';
const sourceBucket='lumiq-production-photos';
const backupBucket='lumiq-production-backups';
const endpoint='https://af664043db99694ff5a6ac88a7e7dc4d.eu.r2.cloudflarestorage.com';
const databasePassword=process.env.LUMIQ_PRODUCTION_DB_PASSWORD;
const sourceAccessKeyId=process.env.LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID;
const sourceSecretAccessKey=process.env.LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY;
const backupAccessKeyId=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID;
const backupSecretAccessKey=process.env.LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY;
const rootArgument=process.argv[2];

if(!databasePassword||!sourceAccessKeyId||!sourceSecretAccessKey||!backupAccessKeyId||!backupSecretAccessKey||!rootArgument)throw new Error('Production backup needs masked local credentials and an explicit output directory.');
const sourceUrl=new URL(`postgresql://postgres.${sourceProject}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`);
sourceUrl.password=databasePassword;
sourceUrl.searchParams.set('sslmode','require');
const database=sourceUrl.toString();
sourceUrl.password='';
const cliConnection=libpqConnectionForCli(database);
const cliEnvironment={...process.env,PGPASSWORD:cliConnection.password};
for(const name of ['LUMIQ_PRODUCTION_DB_PASSWORD','LUMIQ_PRODUCTION_PHOTOS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_PHOTOS_R2_SECRET_ACCESS_KEY','LUMIQ_PRODUCTION_BACKUPS_R2_ACCESS_KEY_ID','LUMIQ_PRODUCTION_BACKUPS_R2_SECRET_ACCESS_KEY'])delete cliEnvironment[name];
const root=path.resolve(rootArgument);
if(path.dirname(root)!==path.resolve(tmpdir())||!/^lumiq-production-backup-[a-f0-9-]{36}$/i.test(path.basename(root)))throw new Error('Production backup staging must use its unique temporary directory under the system temp folder.');
try{await stat(root);throw new Error('Production backup staging path already exists; refusing to overwrite it.');}catch(error){if(error.code!=='ENOENT')throw error;}
const dump=path.join(root,'database.dump');
const authDump=path.join(root,'auth-users.dump');
const objectRoot=path.join(root,'objects');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const remotePrefix=`production/${stamp}`;
const sql=postgres(database,{ssl:'require',max:1});
const sourceS3=new S3Client({region:'auto',endpoint,credentials:{accessKeyId:sourceAccessKeyId,secretAccessKey:sourceSecretAccessKey}});
const backupS3=new S3Client({region:'auto',endpoint,credentials:{accessKeyId:backupAccessKeyId,secretAccessKey:backupSecretAccessKey}});
const digest=async file=>{
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(file))hash.update(chunk);
 return{size:(await stat(file)).size,sha256:hash.digest('hex')};
};
let inventory,migrations;

try{
 const remote=await backupS3.send(new ListObjectsV2Command({Bucket:backupBucket,Prefix:`${remotePrefix}/`,MaxKeys:1}));
 if(remote.KeyCount)throw new Error('Generated backup prefix already exists; refusing to overwrite it.');
 await mkdir(root,{recursive:false});
 await mkdir(objectRoot,{recursive:false});
 await sql.begin('isolation level repeatable read, read only',async tx=>{
  const snapshot=(await tx`select pg_export_snapshot() as id`)[0].id;
  migrations=await tx`select version,checksum from public.platform_migrations order by version`;
  const expected=PLATFORM_MIGRATIONS.map(entry=>entry.version).sort();
  if(JSON.stringify(migrations.map(entry=>entry.version))!==JSON.stringify(expected))throw new Error('Production migration ledger is not exactly 001-046; refusing the backup.');
  for(let index=0;index<PLATFORM_MIGRATIONS.length;index++){
   const source=await readFile(new URL(`../server/${PLATFORM_MIGRATIONS[index].file}`,import.meta.url),'utf8');
   const checksum=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
   if(migrations[index].version!==PLATFORM_MIGRATIONS[index].version||migrations[index].checksum!==checksum)throw new Error(`Production migration checksum differs at ${PLATFORM_MIGRATIONS[index].version}; refusing the backup.`);
  }
  const [runtime]=await tx`select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname='lumiq_production_runtime'`;
  if(!runtime?.rolcanlogin||runtime.rolinherit||runtime.rolbypassrls||runtime.rolsuper||runtime.rolcreatedb||runtime.rolcreaterole||runtime.rolreplication)throw new Error('Production lumiq_production_runtime state is not the reviewed least-privilege state.');
  const [security]=await tx`
   select count(*)::integer as table_count,
    count(*) filter(where not c.relrowsecurity)::integer as tables_without_rls,
    count(*) filter(where has_table_privilege('anon',c.oid,'select'))::integer as anon_select,
    count(*) filter(where has_table_privilege('authenticated',c.oid,'select'))::integer as authenticated_select
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')
  `;
  if(security.table_count!==19||security.tables_without_rls||security.anon_select||security.authenticated_select)throw new Error('Production RLS or browser-role isolation failed backup preflight.');
  inventory=await captureTableInventory(tx);
  const publicTables=inventory.filter(table=>table.schema==='public');
  if(!publicTables.length||!inventory.some(table=>table.schema==='auth'&&table.name==='users')||!inventory.some(table=>table.schema==='auth'&&table.name==='identities'))throw new Error('Production inventory is missing public or Supabase Auth tables.');
  const publicArgs=publicTables.flatMap(table=>['--table',`public.${table.name}`]);
  const publicDump=spawn('pg_dump',['--format=custom','--data-only','--no-owner','--no-acl',...publicArgs,'--exclude-table-data=public.platform_migrations',`--snapshot=${snapshot}`,'--file',dump,cliConnection.connectionString],{stdio:'inherit',windowsHide:true,env:cliEnvironment});
  if(await waitForChildExit(publicDump)!==0)throw new Error('pg_dump failed while exporting production application data.');
  const authExport=spawn('pg_dump',['--format=custom','--data-only','--no-owner','--no-acl','--table=auth.users','--table=auth.identities',`--snapshot=${snapshot}`,'--file',authDump,cliConnection.connectionString],{stdio:'inherit',windowsHide:true,env:cliEnvironment});
  if(await waitForChildExit(authExport)!==0)throw new Error('pg_dump failed while exporting Supabase Auth users and identities.');
 });

 const objects=[];let continuationToken;
 do{
  const page=await sourceS3.send(new ListObjectsV2Command({Bucket:sourceBucket,ContinuationToken:continuationToken}));
  for(const item of page.Contents||[]){
   const key=String(item.Key||'');
   if(!key||key.startsWith('/')||key.split('/').includes('..'))throw new Error('Production R2 returned an invalid object key.');
   const result=await sourceS3.send(new GetObjectCommand({Bucket:sourceBucket,Key:key}));
   const localFile=path.join(objectRoot,encodeURIComponent(key));
   await pipeline(result.Body,createWriteStream(localFile,{flags:'wx'}));
   objects.push({key,size:item.Size,etag:item.ETag,...await digest(localFile),file:path.relative(root,localFile)});
  }
  continuationToken=page.NextContinuationToken;
 }while(continuationToken);

 const publicFile=await digest(dump),authFile=await digest(authDump);
 const manifest={format_version:4,created_at:new Date().toISOString(),bucket:sourceBucket,remote_bucket:backupBucket,remote_prefix:remotePrefix,database:{scope:'lumiq-public-plus-auth-users-identities',public_dump:'data-only',source_project_ref:sourceProject,file:'database.dump',size:publicFile.size,sha256:publicFile.sha256,auth_file:'auth-users.dump',auth_size:authFile.size,auth_sha256:authFile.sha256,tables:inventory,migrations},objects};
 await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 const verification=spawn(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'verify-backup.mjs'),root],{stdio:'inherit',windowsHide:true,env:cliEnvironment});
 if(await waitForChildExit(verification)!==0)throw new Error('Local checksum verification failed; remote backup was not written.');

 const files=[{local:dump,key:`${remotePrefix}/database.dump`},{local:authDump,key:`${remotePrefix}/auth-users.dump`},...objects.map(item=>({local:path.join(root,item.file),key:`${remotePrefix}/${item.file.replaceAll('\\','/')}`})),{local:path.join(root,'manifest.json'),key:`${remotePrefix}/manifest.json`}];
 for(const file of files)await backupS3.send(new PutObjectCommand({Bucket:backupBucket,Key:file.key,Body:createReadStream(file.local)}));
 for(const file of files){
  const remoteFile=await backupS3.send(new GetObjectCommand({Bucket:backupBucket,Key:file.key}));
  const hash=createHash('sha256');let size=0;
  for await(const chunk of remoteFile.Body){hash.update(chunk);size+=chunk.length;}
  const local=await digest(file.local);
  if(size!==local.size||hash.digest('hex')!==local.sha256)throw new Error(`Uploaded backup checksum mismatch at ${file.key}.`);
 }
 await rm(root,{recursive:true});
 console.log(`Production backup verified in private R2: ${remotePrefix}; ${inventory.length} tables, ${migrations.length} migrations, ${objects.length} photos.`);
 console.log('Temporary local dump and photo copies were removed after remote read-back checks.');
}finally{
 await sql.end();
 sourceS3.destroy();
 backupS3.destroy();
 cliConnection.password='';
 cliEnvironment.PGPASSWORD='';
}
