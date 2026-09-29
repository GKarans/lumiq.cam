import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {migrate} from './migrations.mjs';
import {PLATFORM_MIGRATIONS} from './migration-manifest.mjs';
import {fileURLToPath} from 'node:url';
const moduleFile=typeof import.meta.url==='string'&&import.meta.url.startsWith('file:')?fileURLToPath(import.meta.url):null;
export const ROOT=moduleFile?path.resolve(path.dirname(moduleFile),'..'):(process.env.PLATFORM_ROOT||'/');
export function encodeUuidArrayParameters(text,args=[]){
 const encoded=args.slice();
 for(const match of text.matchAll(/\$(\d+)\s*::\s*uuid\s*\[\s*\]/gi)){
  const index=Number(match[1])-1,value=encoded[index];
  if(value==null||!Array.isArray(value))continue;
  encoded[index]=`{${value.map(item=>`"${String(item).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`).join(',')}}`;
 }
 return encoded;
}
export async function openDatabase(options={}) {
 const connection=options.connection??process.env.PLATFORM_DATABASE_URL;
 let query,transaction,close;
 if(connection){
  if(/ojcvnsbhphvijmzjfenl|af664043db99694ff5a6ac88a7e7dc4d/.test(connection))throw new Error('MVP infrastructure is forbidden');
  const {default:postgres}=await import('postgres');
  const sql=postgres(connection,{ssl:options.ssl??'require',max:options.maxConnections??5,fetch_types:options.fetchTypes??true});
  query=async(text,args=[])=>({rows:await sql.unsafe(text,encodeUuidArrayParameters(text,args))});
  transaction=fn=>sql.begin(tx=>fn({exec:text=>tx.unsafe(text).simple(),query:async(text,args=[])=>({rows:await tx.unsafe(text,encodeUuidArrayParameters(text,args))}),queuePlatformMessage:(...args)=>queuePlatformMessage(async(text,values=[])=>({rows:await tx.unsafe(text,encodeUuidArrayParameters(text,values))}),...args)}));
  close=()=>sql.end();
 }else{
  const {PGlite}=await import('@electric-sql/pglite');
  const directory=options.memory?'memory://':path.join(ROOT,'.local','database');
  if(!options.memory)await mkdir(directory,{recursive:true});
  const db=new PGlite(directory);query=(...args)=>db.query(...args);transaction=fn=>db.transaction(tx=>fn({query:tx.query.bind(tx),exec:tx.exec.bind(tx),queuePlatformMessage:(...args)=>queuePlatformMessage(tx.query.bind(tx),...args)}));close=()=>db.close();
 }
 const db={query,transaction,close,queuePlatformMessage:(...args)=>queuePlatformMessage(query,...args)};
 const entries=[];
 if(!options.skipMigrations)for(const {version,file} of PLATFORM_MIGRATIONS)entries.push({version,sql:await readFile(path.join(ROOT,'server',file),'utf8')});
 // A single schema execution is valid in PostgreSQL and PGlite extended mode through transaction.
 if(options.skipMigrations){if(!connection)throw new Error('A database connection is required when migrations are skipped.');}
 else if(!connection||process.env.PLATFORM_MIGRATE==='1')await migrate(db,entries,{local:!connection});
 else {
  const applied=(await db.query('select version from platform_migrations')).rows.map(r=>r.version);
  if(entries.some(e=>!applied.includes(e.version)))throw new Error('Platform migrations are pending. Run npm run migrate before starting.');
 }
 return db;
}
function queuePlatformMessage(query,account,subject,body,dedupe=null){
 return query('select public.queue_platform_message($1::uuid,$2::text,$3::text,$4::text,$5::text) as queued',[account.id||null,account.email,subject,body,dedupe]).then(result=>result.rows[0].queued);
}
