import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {Zip,ZipPassThrough,strToU8} from 'fflate';
import {uuid,requireThat,hash} from './security.mjs';
import {loadSharp} from './image-runtime.mjs';
import {collectNotices} from './notifications.mjs';
import {localized} from './locale.mjs';
import {sendAlert} from './alerts.mjs';
import {safeName} from '../shared/plans.js';
import {organizerLabel} from '../shared/storage-keys.js';
export function jobService(db,files,mail,auth={}){
 let running=false;
 const queue=async(owner,event,type,payload={})=>{const id=uuid();await db.query('insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,$4,$5)',[id,owner,event,type,payload]);return{id};};
 const removeUnreferenced=async(key,ownerId,eventId=null)=>db.transaction(async tx=>{
  await tx.query('select id from accounts where id=$1 for update',[ownerId]);
  const references=(await tx.query("select 1 from events where owner_id=$2 and id<>coalesce($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) and (appearance->>'cover_key'=$1 or appearance->>'camera_cover_key'=$1 or appearance->>'cover_base_key'=$1 or appearance->>'qr_background_key'=$1 or appearance->>'qr_base_key'=$1) limit 1",[key,ownerId,eventId])).rows;
  if(!references.length)await files.remove(key);
 });
 const prepareExport=async job=>{
  if(auth.preparePlatformExport){const result=await auth.preparePlatformExport(job.id);requireThat(result?.count===job.payload.ids.length&&result.parts>0,409,'Photos changed after this export was requested. Create a new export.');return;}
  const items=(await db.query("select id,bytes from media m where event_id=$1 and id=any($2::uuid[]) and (status='uploaded' or ($3::boolean and status='deleted' and deleted_at>(select ends_at from events where id=$1))) order by created_at,id",[job.event_id,job.payload.ids,Boolean(job.payload.automatic)])).rows;
  requireThat(items.length===job.payload.ids.length,409,'Photos changed after this export was requested. Create a new export.');
  const groups=[];let group=[],bytes=0;
  for(const item of items){if(group.length&&bytes+Number(item.bytes)>64*1024**2){groups.push(group);group=[];bytes=0;}group.push(item.id);bytes+=Number(item.bytes);}
  if(group.length)groups.push(group);
  requireThat(groups.length>0,409,'There are no photos to export.');
  await db.transaction(async tx=>{
   const parent=(await tx.query("select status from jobs where id=$1 and type='export' for update",[job.id])).rows[0];
   requireThat(parent?.status==='processing',409,'This export is no longer being prepared.');
   const existing=(await tx.query("select count(*)::int as count from jobs where type='export-part' and payload->>'parent_id'=$1",[job.id])).rows[0].count;
   if(!existing)for(let index=0;index<groups.length;index++)await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'export-part',$4)",[uuid(),job.owner_id,job.event_id,{parent_id:job.id,part_index:index,ids:groups[index],automatic:Boolean(job.payload.automatic)}]);
   await tx.query("update jobs set status='processing',result=$1,lease_until=null,updated_at=now() where id=$2",[{count:items.length},job.id]);
  });
 };
 const exportPart=async job=>{
  const items=auth.getPlatformExportPart?await auth.getPlatformExportPart(job.id):(await db.query("select m.*,g.name as guest,e.name as event_name,a.name as organizer_name,a.profile as organizer_profile from media m join guests g on g.id=m.guest_id join events e on e.id=m.event_id join accounts a on a.id=e.owner_id where m.event_id=$1 and m.id=any($2::uuid[]) and (m.status='uploaded' or ($3::boolean and m.status='deleted' and m.deleted_at>e.ends_at)) order by m.created_at,m.id",[job.event_id,job.payload.ids,Boolean(job.payload.automatic)])).rows;
  requireThat(items.length===job.payload.ids.length,409,'Photos changed after this export was requested. Create a new export.');
  const bytes=items.reduce((sum,item)=>sum+Number(item.bytes),0);requireThat(bytes<=64*1024**2,413,'This export part exceeds its storage safety limit.');
  const names=items.map(item=>{const storedName=item.object_key.split('/').at(-1);return/^[a-z0-9-]+-\d{8}T\d{6}Z-[0-9a-f]{6}\.webp$/i.test(storedName)?storedName:`${item.guest.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,60)}-${item.id}.webp`;});
  const manifest=strToU8(JSON.stringify(items.map(item=>({id:item.id,photographer:item.guest,captured:item.captured_at||item.created_at,format:'optimized WebP'})),null,2));
  const contentLength=22+92+2*strToU8('manifest.json').length+manifest.length+items.reduce((sum,item,index)=>sum+Number(item.bytes)+92+2*strToU8(names[index]).length,0);
  const parentId=job.payload.parent_id,index=Number(job.payload.part_index),key=`exports/${job.event_id}/${parentId}/part-${index+1}.zip`,output=new PassThrough({highWaterMark:1024*1024});
  await files.remove(key);
  output.on('error',()=>{});
  let archiveBytes=0;
  const push=async(entry,value)=>{const data=Buffer.from(value),size=64*1024;if(!data.length){entry.push(data,true);return;}for(let offset=0;offset<data.length;offset+=size){entry.push(data.subarray(offset,Math.min(offset+size,data.length)),offset+size>=data.length);if(output.writableNeedDrain)await once(output,'drain');}};
  const finished=new Promise((resolve,reject)=>{
   const zip=new Zip((error,chunk,final)=>{if(error){output.destroy(error);reject(error);return;}archiveBytes+=chunk.length;output.write(Buffer.from(chunk));if(final){output.end();resolve();}});
   (async()=>{try{
    for(const [index,item] of items.entries()){if(auth.renewPlatformJob)requireThat(await auth.renewPlatformJob(job.id),409,'This export part is no longer being processed.');else await db.query("update jobs set lease_until=now()+interval '10 minutes' where id=$1",[job.id]);const entry=new ZipPassThrough(names[index]);zip.add(entry);await push(entry,await files.get(item.object_key));}
    const manifestEntry=new ZipPassThrough('manifest.json');zip.add(manifestEntry);await push(manifestEntry,manifest);zip.end();
   }catch(error){zip.terminate();output.destroy(error);reject(error);}})();
  });
  const writes=await Promise.allSettled([files.putStream(key,output,'application/zip',{maxBytes:contentLength,contentLength}),finished]),failed=writes.find(result=>result.status==='rejected');
  if(failed){await files.remove(key).catch(()=>{});throw failed.reason;}
  const organizer=organizerLabel(items[0].organizer_name,items[0].organizer_profile),base=safeName(`${organizer}-${items[0].event_name}`);
  return{key,name:`${base}-${index+1}.zip`,bytes:archiveBytes,count:items.length};
 };
 const completeExportPart=async(job,part)=>auth.completePlatformExportPart?auth.completePlatformExportPart(job.id,part):db.transaction(async tx=>{
  const saved=(await tx.query("update jobs set status='ready',result=$1,updated_at=now(),error=null,lease_until=null where id=$2 and status='processing' returning id",[part,job.id])).rows[0];if(!saved)return null;
  const parentId=job.payload.parent_id,parent=(await tx.query("select * from jobs where id=$1 and type='export' for update",[parentId])).rows[0];requireThat(parent,404,'The parent export no longer exists.');
  const totals=(await tx.query("select count(*)::int as total,count(*) filter(where status='ready')::int as ready from jobs where type='export-part' and payload->>'parent_id'=$1",[parentId])).rows[0];
  if(totals.total!==totals.ready||parent.status!=='processing')return null;
  const children=(await tx.query("select result from jobs where type='export-part' and payload->>'parent_id'=$1 order by (payload->>'part_index')::int",[parentId])).rows;
  const result={parts:children.map(row=>row.result),count:children.reduce((sum,row)=>sum+Number(row.result.count),0),expires_at:parent.payload.automatic?parent.payload.retention_at:new Date(Date.now()+7*86400000).toISOString()};
  return(await tx.query("update jobs set status='ready',result=$1,lease_until=null,error=null,updated_at=now() where id=$2 and status='processing' returning *",[result,parentId])).rows[0]||null;
 });
 const cleanup=async job=>{
  if(job.type==='object-cleanup'){
   if(auth.getPlatformCleanupManifest){const manifest=await auth.getPlatformCleanupManifest(job.id);for(const key of manifest.keys||[])if(await auth.canDeletePlatformAsset(job.id,key))await files.remove(key);return{checked:manifest.keys?.length||0};}
   for(const key of job.payload.keys||[])await removeUnreferenced(key,job.owner_id);return{checked:job.payload.keys?.length||0};
  }
  if(job.type==='thumbnail-repair'){
   const manifest=auth.getPlatformCleanupManifest?await auth.getPlatformCleanupManifest(job.id):null;
   const m=manifest?.photo||(await db.query("select * from media where id=$1 and event_id=$2 and status='uploaded'",[job.payload.id,job.event_id])).rows[0];
   requireThat(m,404,'Photo no longer available.');
   const sharp=await loadSharp(),thumb=await sharp(await files.get(m.object_key),{limitInputPixels:40e6}).rotate().resize({width:360,height:360,fit:'inside',withoutEnlargement:true}).webp({quality:74}).toBuffer();
   await files.put(m.thumbnail_key,thumb);
   if(auth.savePlatformThumbnailDetails)requireThat(await auth.savePlatformThumbnailDetails(job.id,m.id,thumb.length,hash(thumb)),409,'Photo changed while its thumbnail was being repaired.');else await db.query("update media set thumbnail_bytes=$1,thumbnail_checksum=$2 where id=$3 and status='uploaded'",[thumb.length,hash(thumb),m.id]);
   return{repaired:m.id};
  }
  requireThat(['cleanup','retention-cleanup','media-cleanup'].includes(job.type),400,'Unknown maintenance job.');
  if(job.type==='media-cleanup'){
   if(auth.platformMediaCleanupShouldDefer){if(await auth.platformMediaCleanupShouldDefer(job.id))return{deferred:true};}
   else{const event=(await db.query('select ends_at,retention_at from events where id=$1',[job.event_id])).rows[0];if(event&&Date.parse(event.ends_at)<=Date.now()&&Date.parse(event.retention_at)>Date.now()){const selected=(await db.query("select id from media where event_id=$1 and id=any($2::uuid[]) and status='deleted' and deleted_at>(select ends_at from events where id=$1)",[job.event_id,job.payload.ids])).rows;if(selected.length){const autos=(await db.query("select status,payload from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[job.event_id])).rows;const included=autos.some(item=>item.payload.ids.some(id=>selected.some(photo=>photo.id===id)));if(!autos.length||autos.some(item=>included&&item.status!=='ready'))return{deferred:true};}}}
  }
   const isEvent=['cleanup','retention-cleanup'].includes(job.type);
   if(auth.getPlatformCleanupManifest){
    const manifest=await auth.getPlatformCleanupManifest(job.id),rows=manifest.photos||[];
    for(const media of rows){await files.remove(media.object_key);await files.remove(media.thumbnail_key);}
    if(isEvent){for(const key of manifest.cover_keys||[])if(await auth.canDeletePlatformAsset(job.id,key))await files.remove(key);for(const entry of manifest.exports||[]){for(const part of entry.result?.parts||[])if(part.key)await files.remove(part.key);if(entry.result?.key)await files.remove(entry.result.key);}return auth.finalizePlatformEventCleanup(job.id,rows.length);}
    return{removed:rows.length};
   }
   const rows=(await db.query(isEvent?'select * from media where event_id=$1':"select * from media where event_id=$1 and id=any($2::uuid[]) and status='deleted'",isEvent?[job.event_id]:[job.event_id,job.payload.ids])).rows;for(const m of rows){await files.remove(m.object_key);await files.remove(m.thumbnail_key);}if(isEvent){const event=(await db.query('select owner_id,appearance from events where id=$1',[job.event_id])).rows[0];for(const key of ['cover_key','camera_cover_key','cover_base_key','qr_background_key','qr_base_key'])if(event?.appearance[key])await removeUnreferenced(event.appearance[key],event.owner_id,job.event_id);const exports=(await db.query("select type,result from jobs where event_id=$1 and type in ('export','export-part')",[job.event_id])).rows;for(const e of exports){for(const part of e.result?.parts||[])await files.remove(part.key);if(e.result?.key)await files.remove(e.result.key);}await db.query('delete from media where event_id=$1',[job.event_id]);await db.query('delete from guests where event_id=$1',[job.event_id]);await db.query('delete from jobs where event_id=$1 and id<>$2',[job.event_id,job.id]);await db.query("update events set status=$2,slug='expired-'||id::text,description='',appearance='{}',storage_prefix='expired/events/'||id::text,entitlement=jsonb_build_object('retentionDays',coalesce((entitlement->>'retentionDays')::integer,14)),paused=true,share_enabled=false,share_expires=null,share_used=0,share_limit=0,gallery_cover_id=null where id=$1",[job.event_id,job.type==='cleanup'?'deleted':'archived']);}return{removed:rows.length};};
  const expireEvent=async eventId=>{
   if(auth.expirePlatformEvent)return auth.expirePlatformEvent(eventId);
   return db.transaction(async tx=>{
   const event=(await tx.query("select id,owner_id from events where id=$1 and retention_at<=now() and status<>'deleted' for update",[eventId])).rows[0];if(!event)return{expired:false,jobId:null};
   const existing=(await tx.query("select id from jobs where event_id=$1 and type in ('cleanup','retention-cleanup') and status in ('queued','processing','ready') order by created_at desc limit 1",[eventId])).rows[0];if(existing)return{expired:true,jobId:existing.id,existing:true};
   await tx.query("update events set status='archived',paused=true,share_enabled=false,gallery_cover_id=null where id=$1 and retention_at<=now() and status<>'deleted'",[eventId]);const jobId=uuid();await tx.query("insert into jobs(id,owner_id,event_id,type) values($1,$2,$3,'retention-cleanup')",[jobId,event.owner_id,eventId]);return{expired:true,jobId,existing:false};
  });
  };
  const prepareEventEnd=async eventId=>{
   if(auth.preparePlatformEventEnd)return auth.preparePlatformEventEnd(eventId);
   return db.transaction(async tx=>{
   const event=(await tx.query("select id,owner_id,ends_at,retention_at from events where id=$1 and status='published' and ends_at<=now() and retention_at>now() for update",[eventId])).rows[0];if(!event)return{prepared:false,jobId:null};
   const ids=(await tx.query("select id from media where event_id=$1 and (status='uploaded' or (status='deleted' and deleted_at>$2)) order by id",[event.id,event.ends_at])).rows.map(row=>row.id).sort();if(!ids.length)return{prepared:false,jobId:null};
   const existing=(await tx.query("select id from jobs where event_id=$1 and type='export' and payload->>'automatic'='true' order by created_at desc for update limit 1",[eventId])).rows[0];if(existing)return{prepared:true,jobId:existing.id,existing:true};
   const jobId=uuid();await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'export',$4)",[jobId,event.owner_id,eventId,{ids,automatic:true,retention_at:event.retention_at}]);return{prepared:true,jobId,existing:false};
   });
  };
  return{
  queue,
  async inspect(eventId){const rows=(await db.query("select * from media where event_id=$1 and status<>'deleted' order by created_at limit 5000",[eventId])).rows,issues=[];for(const m of rows){for(const [variant,key]of [['photo',m.object_key],['thumbnail',m.thumbnail_key]])try{await files.size(key);}catch{issues.push({id:m.id,status:m.status,variant,key});}}return{checked:rows.length,issues};},
   async retry(user,id,admin=false){if(admin&&auth.retryAdminJob){requireThat(await auth.retryAdminJob(user,id)===true,404,'Job not available for retry.');return{ok:true};}if(!admin&&auth.retryOwnExport)return auth.retryOwnExport(user,id);const result=await db.transaction(async tx=>{
   const job=(await tx.query("select * from jobs where id=$1 and status='failed' and ($3 or owner_id=$2) for update",[id,user.id,admin])).rows[0];if(!job)return null;
   if(job.type==='export'){const children=(await tx.query("select id,status from jobs where type='export-part' and payload->>'parent_id'=$1",[id])).rows;if(children.length){await tx.query("update jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where type='export-part' and payload->>'parent_id'=$1 and status='failed'",[id]);await tx.query("update jobs set status='processing',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=$1",[id]);}else await tx.query("update jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=$1",[id]);
   }else await tx.query("update jobs set status='queued',available_at=now(),error=null,attempts=0,lease_until=null,dispatched_at=null where id=$1",[id]);return true;
  });requireThat(result,404,'Job not available for retry.');return{ok:true};},
  async deadLetter(id){const job=auth.deadLetterPlatformJob?await auth.deadLetterPlatformJob(id):await db.transaction(async tx=>{const row=(await tx.query("update jobs set status='failed',error='The background queue could not deliver this job. Retry it or contact support.',lease_until=null,dispatched_at=null,updated_at=now() where id=$1 and (status='queued' or (status='processing' and lease_until<now())) returning id,type,payload",[id])).rows[0];if(row?.type==='export-part')await tx.query("update jobs set status='failed',error='An archive part could not be delivered. Retry this archive to continue.',lease_until=null,updated_at=now() where id=$1 and status='processing'",[row.payload.parent_id]);return row;});if(job)await sendAlert('background-job-dead-lettered',{job:job.id,type:job.type}).catch(error=>console.error(JSON.stringify({level:'error',component:'alerts',error:error.message})));return{failed:Boolean(job)};},
  async dispatch(queueBinding,{limit=1000}={}){requireThat(queueBinding&&typeof queueBinding.sendBatch==='function',503,'The background queue is not configured.');requireThat(Number.isInteger(limit)&&limit>=1&&limit<=1000,400,'Invalid queue dispatch limit.');let dispatched=0;while(dispatched<limit){const ids=auth.claimPlatformQueueBatch?await auth.claimPlatformQueueBatch(Math.min(100,limit-dispatched)):await db.transaction(async tx=>{const jobs=(await tx.query("select id from jobs where status='queued' and available_at<=now() and (dispatched_at is null or dispatched_at<now()-interval '5 minutes') order by created_at,id for update skip locked limit $1",[Math.min(100,limit-dispatched)])).rows;if(jobs.length)await tx.query("update jobs set dispatched_at=now() where id=any($1::uuid[])",[jobs.map(job=>job.id)]);return jobs.map(job=>job.id);});if(!ids.length)break;try{await queueBinding.sendBatch(ids.map(id=>({body:{jobId:id}})));dispatched+=ids.length;}catch(error){if(auth.resetPlatformQueueDispatch)await auth.resetPlatformQueueDispatch(ids);else await db.query("update jobs set dispatched_at=null where id=any($1::uuid[]) and status='queued'",[ids]);throw error;}}return{dispatched};},
  async tick({concurrency=1,maxJobs=10,jobIds=null}={}){if(running)return;requireThat(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=5&&Number.isInteger(maxJobs)&&maxJobs>=concurrency&&maxJobs<=10,400,'Invalid background job concurrency.');requireThat(jobIds===null||(Array.isArray(jobIds)&&jobIds.length<=100&&jobIds.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))),400,'Invalid background job IDs.');running=true;try{
   if(auth.recoverStalePlatformJobs)await auth.recoverStalePlatformJobs();else await db.query("update jobs set status='queued',dispatched_at=null where status='processing' and lease_until<now()");
   const claim=()=>auth.claimPlatformJob?auth.claimPlatformJob(jobIds):db.transaction(async tx=>{const j=(await tx.query("select * from jobs where status='queued' and available_at<=now() and ($1::uuid[] is null or id=any($1::uuid[])) order by created_at,case when type='export-part' then (payload->>'part_index')::int else -1 end,id for update skip locked limit 1",[jobIds])).rows[0];if(j)await tx.query("update jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '10 minutes' where id=$1",[j.id]);return j;});
   let claimed=0;
   const processOne=async()=>{while(claimed<maxJobs){claimed++;const job=await claim();if(!job)return;
    try{
     if(job.type==='export')await prepareExport(job);
     else if(job.type==='export-part'){const part=await exportPart(job),parent=await completeExportPart(job,part);if(parent){const account=auth.getPlatformExportNotice?await auth.getPlatformExportNotice(parent.id):(await db.query('select * from accounts where id=$1',[parent.owner_id])).rows[0];if(account)await mail(account,localized(account,'Your photo export is ready','Tavs foto eksports ir gatavs'),localized(account,'Your optimized photo archive is ready in your event workspace.','Optimizēto foto arhīvs ir gatavs pasākuma darba vietā.'),`export:${parent.id}`);}}
     else{const result=await cleanup(job);if(result?.deferred){if(auth.settlePlatformJob)await auth.settlePlatformJob(job.id,'defer',{delaySeconds:120,decrementAttempt:true});else await db.query("update jobs set status='queued',available_at=now()+interval '2 minutes',attempts=greatest(attempts-1,0),lease_until=null,dispatched_at=null,updated_at=now() where id=$1",[job.id]);}else if(auth.settlePlatformJob)await auth.settlePlatformJob(job.id,'ready',{result});else await db.query("update jobs set status='ready',result=$1,updated_at=now(),error=null where id=$2",[result,job.id]);}
    }
    catch(error){const retry=job.attempts<2;const failure='This job could not finish. Your photos remain available. Retry or contact support.';if(auth.settlePlatformJob)await auth.settlePlatformJob(job.id,retry?'retry':'failed',{error:failure,delaySeconds:retry?30:0});else{await db.query('update jobs set status=$1,error=$2,available_at=now()+interval \'30 seconds\',updated_at=now(),lease_until=null,dispatched_at=null where id=$3',[retry?'queued':'failed',failure,job.id]);if(job.type==='export-part'&&!retry)await db.query("update jobs set status='failed',error=$1,lease_until=null,updated_at=now() where id=$2 and status='processing'",['One export part failed after retries. Retry this export to continue.',job.payload.parent_id]);}console.error(JSON.stringify({level:'error',component:'jobs',job:job.id,type:job.type,error:error.status||error.code||error.name||'processing-failed'}));if(!retry)await sendAlert('background-job-failed',{job:job.id,type:job.type}).catch(alertError=>console.error(JSON.stringify({level:'error',component:'alerts',error:alertError.message})));}
   }};
   const outcomes=await Promise.allSettled(Array.from({length:concurrency},processOne)),failed=outcomes.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  }finally{running=false;}},
  async retention({eventId=null,phase='expiry'}={}){
   if(eventId!==null){requireThat(typeof eventId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId),400,'Invalid event ID.');requireThat(['expiry','event-end'].includes(phase),400,'Invalid retention drill phase.');return phase==='event-end'?prepareEventEnd(eventId):expireEvent(eventId);}
   if(auth.runPlatformRetentionCycle){
    if(auth.collectPlatformNotices)await auth.collectPlatformNotices();else await collectNotices(db);
    const result=await auth.runPlatformRetentionCycle(250),reminders=await auth.listPlatformRetentionReminders(250);
    for(const event of reminders){const account={id:event.owner_id,email:event.email,preferences:event.preferences};await mail(account,localized(account,'Your photo retention period is ending','Foto glabāšanas periods drīz beigsies'),localized(account,`${event.event_name}: download your photos before ${new Date(event.retention_at).toISOString().slice(0,10)}.`,`${event.event_name}: lejupielādē foto līdz ${new Date(event.retention_at).toISOString().slice(0,10)}.`),`retention:${event.event_id}:${event.retention_at}`);}
    return{...result,retention_reminders:reminders.length};
   }
   await collectNotices(db);await db.query('delete from request_limits where expires_at<now()');
   const ended=(await db.query("select e.id from events e where e.status='published' and e.ends_at<=now() and e.retention_at>now() and (exists(select 1 from media m where m.event_id=e.id and (m.status='uploaded' or (m.status='deleted' and m.deleted_at>e.ends_at))) or exists(select 1 from jobs j where j.event_id=e.id and j.type='export' and j.payload->>'automatic'='true')) order by e.ends_at limit 250")).rows;
   for(const candidate of ended)await db.transaction(async tx=>{
    const event=(await tx.query("select id,owner_id,ends_at,retention_at from events where id=$1 and status='published' for update",[candidate.id])).rows[0];if(!event||Date.parse(event.ends_at)>Date.now()||Date.parse(event.retention_at)<=Date.now())return;
    const ids=(await tx.query("select id from media where event_id=$1 and (status='uploaded' or (status='deleted' and deleted_at>$2)) order by id",[event.id,event.ends_at])).rows.map(row=>row.id).sort();
    const jobs=(await tx.query("select * from jobs where event_id=$1 and type='export' and payload->>'automatic'='true' order by created_at desc for update",[event.id])).rows;
    if(jobs.length)return;
    if(ids.length)await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'export',$4)",[uuid(),event.owner_id,event.id,{ids,automatic:true,retention_at:event.retention_at}]);
   });
   const pending=(await db.query("select m.id,m.event_id,e.owner_id from media m join events e on e.id=m.event_id where m.status='pending' and m.created_at<now()-interval '24 hours'")).rows;
   for(const m of pending)await db.transaction(async tx=>{const r=await tx.query("update media set status='deleted',deleted_at=now() where id=$1 and status='pending' returning id",[m.id]);if(r.rows.length)await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'media-cleanup',$4)",[uuid(),m.owner_id,m.event_id,{ids:[m.id]}]);});
   const expired=(await db.query("select * from jobs where type='export' and status='ready' and result->>'expires_at' is not null and (result->>'expires_at')::timestamptz<=now() and not (result ? 'cleaned')")).rows;
   for(const j of expired)await db.transaction(async tx=>{await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'object-cleanup',$4)",[uuid(),j.owner_id,j.event_id,{keys:(j.result.parts||[]).map(p=>p.key)}]);await tx.query("update jobs set result=result||'{\"cleaned\":true}'::jsonb where id=$1",[j.id]);});
   await db.query("update subscriptions set status='ended' where period_end<=now() and (cancel_at_end=true or plan='trial')");
   const rows=(await db.query("select e.id from events e where e.retention_at<=now() and e.status<>'deleted' and not exists(select 1 from jobs j where j.event_id=e.id and j.type in ('cleanup','retention-cleanup') and j.status in ('queued','processing','ready'))")).rows;for(const e of rows)await expireEvent(e.id);const remind=(await db.query("select e.*,a.email,a.name as account_name,a.preferences from events e join accounts a on a.id=e.owner_id where e.retention_at between now() and now()+interval '7 days' and e.status<>'deleted'")).rows;for(const e of remind){const account={id:e.owner_id,email:e.email,preferences:e.preferences};await mail(account,localized(account,'Your photo retention period is ending','Foto glabāšanas periods drīz beigsies'),localized(account,`${e.name}: download your photos before ${new Date(e.retention_at).toISOString().slice(0,10)}.`,`${e.name}: lejupielādē foto līdz ${new Date(e.retention_at).toISOString().slice(0,10)}.`),`retention:${e.id}:${e.retention_at}`);}await db.query("delete from sessions where expires_at<now();").catch(()=>{});}
 };
}
