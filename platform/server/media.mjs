import {uuid,text,requireThat,hash} from './security.mjs';
import {loadSharp} from './image-runtime.mjs';
import {DateTime} from 'luxon';
import {eventState} from '../shared/plans.js';
import {photographerFolder,photoObjectName} from '../shared/storage-keys.js';

const encodeCursor=row=>Buffer.from(JSON.stringify([new Date(row.created_at).toISOString(),row.id])).toString('base64url');
function decodeCursor(value){
 if(!value)return null;
 try{const [created,id]=JSON.parse(Buffer.from(value,'base64url').toString());requireThat(!Number.isNaN(Date.parse(created))&&/^[0-9a-f-]{36}$/i.test(id),400,'Invalid gallery cursor.');return{created,id};}
 catch(error){if(error?.status)throw error;requireThat(false,400,'Invalid gallery cursor.');}
}

export function mediaService(db,files,events,validateImage=async bytes=>{const sharp=await loadSharp();await sharp(bytes,{limitInputPixels:40e6}).raw().toBuffer();},auth={}){
 const ready=async id=>{requireThat(!auth.getGuestPhotoUpload,503,'Photo access RPC is unavailable.');const m=(await db.query('select * from media where id=$1',[id])).rows[0];requireThat(m,404,'Photo not found.');return m;};
 return {
  ready,
  async readyWithEvent(id,user=null,thumbnail=false){
   if(auth.getOwnPhotoAsset&&user){const own=await auth.getOwnPhotoAsset(user,id,thumbnail);if(own?.media&&own?.event)return{media:own.media,event:own.event,shareCounted:true};}
   if(auth.getPublicPhotoAsset){const shared=await auth.getPublicPhotoAsset(id,thumbnail);if(shared?.media&&shared?.event)return{media:shared.media,event:shared.event,shareCounted:true};}
   if(auth.getOwnPhotoAsset||auth.getPublicPhotoAsset)requireThat(false,404,'Photo unavailable.');
   const row=(await db.query(`
    select m.*,e.owner_id as asset_event_owner_id,e.status as asset_event_status,
     e.starts_at as asset_event_starts_at,e.ends_at as asset_event_ends_at,
     e.paused as asset_event_paused,e.retention_at as asset_event_retention_at,
     e.share_enabled as asset_event_share_enabled,e.share_expires as asset_event_share_expires
    from media m join events e on e.id=m.event_id
    where m.id=$1 and e.status<>'deleted' and e.retention_at>now()
   `,[id])).rows[0];
   requireThat(row,404,'Photo unavailable.');
   const event={id:row.event_id,owner_id:row.asset_event_owner_id,status:row.asset_event_status,starts_at:row.asset_event_starts_at,ends_at:row.asset_event_ends_at,paused:row.asset_event_paused,retention_at:row.asset_event_retention_at,share_enabled:row.asset_event_share_enabled,share_expires:row.asset_event_share_expires};
   return{media:row,event,shareCounted:false};
  },
  async discard(e,g,id){if(auth.discardGuestPhoto){requireThat(g.token_hash,401,'Enter your name again to continue.');return auth.discardGuestPhoto(e.id,id,g.token_hash);}return db.transaction(async tx=>{const m=(await tx.query("update media set status='deleted',deleted_at=now() where id=$1 and event_id=$2 and guest_id=$3 and status='pending' returning id",[id,e.id,g.id])).rows[0];if(m)await tx.query("insert into jobs(id,owner_id,event_id,type,payload,available_at) values($1,$2,$3,'media-cleanup',$4,now()+interval '6 minutes')",[uuid(),e.owner_id,e.id,{ids:[id]}]);return{ok:true};});},
  async reserve(e,g,input){
   requireThat(eventState(e)==='live',409,'This event is closed for uploads.');
   const id=text(input.id,36);requireThat(/^[0-9a-f-]{36}$/i.test(id),400,'Invalid photo identifier.');
   const bytes=Number(input.bytes),thumb=Number(input.thumbnail_bytes);requireThat(bytes>0&&bytes<=6291456&&thumb>0&&thumb<=1048576,413,'The optimized photo must be under 6 MB.');
   for(const h of [input.checksum,input.thumbnail_checksum])requireThat(/^[a-f0-9]{64}$/.test(h),400,'Photo validation failed.');
   const requestedCapture=Number(input.captured_at),now=Date.now(),capturedAt=Number.isFinite(requestedCapture)&&requestedCapture>=Date.UTC(1980,0,1)&&requestedCapture<=now+86400000?new Date(requestedCapture):new Date(now);
   if(auth.reserveGuestPhoto){
    requireThat(g.token_hash,401,'Enter your name again to continue.');
    const filename=photoObjectName(g.name,capturedAt,id);
    return auth.reserveGuestPhoto({eventId:e.id,photoId:id,guestId:g.id,guestTokenHash:g.token_hash,name:text(input.name,180),bytes,thumbnailBytes:thumb,checksum:input.checksum,thumbnailChecksum:input.thumbnail_checksum,capturedAtMs:capturedAt.getTime(),guestFolder:photographerFolder(g.name,g.id),filenamePrefix:filename.replace(/-[a-f0-9]{6}\.webp$/i,'')});
   }
   return db.transaction(async tx=>{
    await events.organizerPrefix({id:e.owner_id},tx);
    e=(await tx.query('select * from events where id=$1 for update',[e.id])).rows[0];requireThat(eventState(e)==='live',409,'This event is closed for uploads.');
    const previous=(await tx.query('select * from media where id=$1',[id])).rows[0];
    if(previous){requireThat(previous.event_id===e.id&&previous.guest_id===g.id&&previous.bytes===bytes&&previous.thumbnail_bytes===thumb&&previous.checksum===input.checksum&&previous.thumbnail_checksum===input.thumbnail_checksum&&previous.status!=='deleted',409,'This upload cannot be replaced.');return previous;}
    const used=(await tx.query("select count(*)::int as photos,coalesce(sum(bytes+thumbnail_bytes),0)::bigint as bytes from media where event_id=$1 and status in ('pending','uploaded')",[e.id])).rows[0];
    requireThat(used.photos<e.entitlement.photos&&Number(used.bytes)+bytes+thumb<=e.entitlement.bytes,409,'This event has reached its photo or storage allowance.');
    const eventPrefix=await events.organizedEventPrefix(e,tx),guestPrefix=`${eventPrefix}/${photographerFolder(g.name,g.id)}`;let filename,key,thumbnail;
    for(const offset of [26,0,6,12,18,24]){
     filename=photoObjectName(g.name,capturedAt,id.replaceAll('-','').slice(offset,offset+6));
     key=`${guestPrefix}/${filename}`;thumbnail=`${guestPrefix}/thumb/${filename}`;
     const collision=(await tx.query('select 1 from media where object_key in ($1,$2) or thumbnail_key in ($1,$2) limit 1',[key,thumbnail])).rows.length;
     if(!collision)break;
     filename=key=thumbnail=null;
    }
    requireThat(filename,409,'Could not allocate a unique photo filename. Please try again.');
    return(await tx.query('insert into media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,checksum,thumbnail_checksum,captured_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *',[id,e.id,g.id,key,thumbnail,text(input.name,180),bytes,thumb,input.checksum,input.thumbnail_checksum,capturedAt.toISOString()])).rows[0];
   });
  },
   async upload(e,g,id,kind,bytes){const m=auth.getGuestPhotoUpload?(requireThat(g.token_hash,401,'Enter your name again to continue.'),await auth.getGuestPhotoUpload(e.id,id,g.token_hash)):await ready(id);requireThat(m,404,'Photo upload not found.');requireThat(m.event_id===e.id&&m.guest_id===g.id&&m.status==='pending'&&eventState(e)==='live',409,'This upload is no longer available.');const thumb=kind==='thumb';requireThat(['thumb','photo'].includes(kind),400,'Invalid photo variant.');requireThat(bytes.length===Number(thumb?m.thumbnail_bytes:m.bytes)&&hash(bytes)===(thumb?m.thumbnail_checksum:m.checksum),400,'The photo changed during upload. Try again.');requireThat(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',415,'Upload a supported photo.');await files.put(thumb?m.thumbnail_key:m.object_key,bytes);return{ok:true};},
   async finalize(e,g,id){const m=auth.getGuestPhotoUpload?(requireThat(g.token_hash,401,'Enter your name again to continue.'),await auth.getGuestPhotoUpload(e.id,id,g.token_hash)):await ready(id);requireThat(m,404,'Photo upload not found.');requireThat(m.event_id===e.id&&m.guest_id===g.id&&m.status!=='deleted',409,'This event is closed. The photo was not completed.');if(m.status==='uploaded')return{ok:true};requireThat(eventState(e)==='live',409,'This event is closed. The photo was not completed.');for(const[k,h]of[[m.object_key,m.checksum],[m.thumbnail_key,m.thumbnail_checksum]]){let bytes;try{bytes=await files.get(k);}catch{requireThat(false,409,'Both photo files must finish uploading.');}requireThat(hash(bytes)===h,409,'Photo verification failed. Try again.');try{await validateImage(bytes);}catch{requireThat(false,415,'This file is not a valid photo.');}}if(auth.finalizeGuestPhoto){await auth.finalizeGuestPhoto(e.id,id,g.token_hash);return{ok:true};}const result=await db.query("update media set status='uploaded' where id=$1 and status='pending' and exists(select 1 from events where id=$2 and status='published' and paused=false and starts_at<=now() and ends_at>now()) returning id",[id,e.id]);if(!result.rows.length)requireThat((await ready(id)).status==='uploaded',409,'The event closed while the photo was being verified.');if(result.rows.length)await db.query("insert into metrics(id,event_id,kind,amount) values($1,$2,'upload-completed',1)",[uuid(),e.id]);return{ok:true};},
  async list(e,params,{owner=false,user=null}={}){
   requireThat(Date.parse(e.retention_at)>Date.now(),410,'Photo retention has ended. This event is archived and its photos are no longer available.');
   const guest=params.get('guest')||'',date=params.get('date')||'',cursor=decodeCursor(params.get('cursor'));
   requireThat(!date||/^\d{4}-\d{2}-\d{2}$/.test(date),400,'Choose a valid date.');
   const order=params.get('sort')==='oldest'?'asc':'desc',operator=order==='asc'?'>':'<';
   const zone=params.get('time_zone')||e.time_zone;requireThat(zone.length<=80&&DateTime.now().setZone(zone).isValid,400,'Choose a valid date.');
   const query={guest,date,timeZone:zone,oldest:order==='asc',cursorCreated:cursor?.created||null,cursorId:cursor?.id||null};
   if(owner&&auth.listOwnGallery){requireThat(user,401,'Sign in to continue.');const result=await auth.listOwnGallery(user,e.id,query),photos=Array.isArray(result?.photos)?result.photos:[],page=photos.slice(0,24);return{photos:page,total:Number(result?.total)||0,guests:Array.isArray(result?.guests)?result.guests:[],next:photos.length>24?encodeCursor(page.at(-1)):null,updated_at:new Date().toISOString(),gallery_cover_id:e.gallery_cover_id||null};}
   if(!owner&&auth.listPublicGallery){const result=await auth.listPublicGallery(e.id,query),photos=Array.isArray(result?.photos)?result.photos:[],page=photos.slice(0,24);return{photos:page,total:Number(result?.total)||0,guests:Array.isArray(result?.guests)?result.guests:[],next:photos.length>24?encodeCursor(page.at(-1)):null,updated_at:new Date().toISOString(),gallery_cover_id:e.gallery_cover_id||null};}
   const filters="m.event_id=$1 and m.status='uploaded' and ($2='' or g.name=$2) and ($3='' or (m.created_at at time zone $4)::date::text=$3)"+(owner?'':' and m.hidden=false');
   const args=[e.id,guest,date,zone],cursorSql=cursor?` and (m.created_at,m.id) ${operator} ($5::timestamptz,$6::uuid)`:'';
   if(cursor)args.push(cursor.created,cursor.id);
   const photos=(await db.query(`select m.id,m.name,m.created_at,m.bytes,m.favorite,m.hidden,g.name as guest from media m join guests g on g.id=m.guest_id where ${filters}${cursorSql} order by m.created_at ${order},m.id ${order} limit 25`,args)).rows;
   const page=photos.slice(0,24),total=(await db.query(`select count(*)::int as n from media m join guests g on g.id=m.guest_id where ${filters}`,[e.id,guest,date,zone])).rows[0].n;
   const guests=(await db.query("select distinct g.name from guests g join media m on m.guest_id=g.id where m.event_id=$1 and m.status='uploaded'"+(owner?'':' and m.hidden=false')+' order by g.name',[e.id])).rows.map(g=>g.name);
   return{photos:page,total,guests,next:photos.length>24?encodeCursor(page.at(-1)):null,updated_at:new Date().toISOString(),gallery_cover_id:e.gallery_cover_id||null};
  },
  async curate(user,e,input){
   const ids=input.ids;requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=200&&ids.every(id=>/^[0-9a-f-]{36}$/i.test(id)),400,'Select 1 to 200 photos.');
   if(auth.curateOwnGallery)return auth.curateOwnGallery(user,e.id,ids,input.action);
   const actions={favorite:['favorite',true],unfavorite:['favorite',false],hide:['hidden',true],restore:['hidden',false]};
   return db.transaction(async tx=>{
    const rows=(await tx.query("select id from media where event_id=$1 and id=any($2::uuid[]) and status='uploaded'",[e.id,ids])).rows;requireThat(rows.length===new Set(ids).size,404,'Some selected photos are unavailable.');
    if(input.action==='cover'){requireThat(ids.length===1,400,'Choose one gallery cover.');await tx.query('update events set gallery_cover_id=$1 where id=$2',[ids[0],e.id]);}
    else{const change=actions[input.action];requireThat(change,400,'Unknown gallery action.');await tx.query(`update media set ${change[0]}=$1 where event_id=$2 and id=any($3::uuid[])`,[change[1],e.id,ids]);}
    await tx.query('insert into audit(id,actor_id,action,target_id,detail) values($1,$2,$3,$4,$5)',[uuid(),user.id,`gallery.${input.action}`,e.id,{ids}]);return{ok:true};
   });
  },
  async remove(user,e,ids){requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=200&&ids.every(id=>/^[0-9a-f-]{36}$/i.test(id)),400,'Select 1 to 200 photos.');if(auth.curateOwnGallery)return auth.curateOwnGallery(user,e.id,ids,'delete');await db.transaction(async tx=>{await tx.query('select id from events where id=$1 for update',[e.id]);const rows=(await tx.query("select id from media where event_id=$1 and id=any($2::uuid[]) and status='uploaded'",[e.id,ids])).rows;requireThat(rows.length===new Set(ids).size,404,'Some selected photos are unavailable.');await tx.query("update media set status='deleted',deleted_at=now() where event_id=$1 and id=any($2::uuid[])",[e.id,ids]);await tx.query('update events set gallery_cover_id=null where id=$1 and gallery_cover_id=any($2::uuid[])',[e.id,ids]);await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'media-cleanup',$4)",[uuid(),user.id,e.id,{ids}]);});return{ok:true};}
 };
}
