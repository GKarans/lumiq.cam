import {COVERS} from '../shared/covers.js';
import {DateTime} from 'luxon';
import {PLANS,eventState} from '../shared/plans.js';
import {uuid,token,hash,text,requireThat} from './security.mjs';
import {grantPublication,publicationAllowance} from './allowances.mjs';
import {normalizeCover} from '../shared/cover.js';
import {eventFolder,organizerFolder,organizerLabel} from '../shared/storage-keys.js';
import {normalizeCanvasScene} from '../shared/canvas-scene.js';
export function schedule(input) {
 const zone=text(input.time_zone,80);
 const parse=v=>{const date=DateTime.fromISO(text(v,30),{zone});requireThat(date.isValid&&date.toFormat("yyyy-MM-dd'T'HH:mm")===v&&date.getPossibleOffsets().length===1,400,'Choose a valid time outside a daylight-saving clock change.');return date;};
 const start=parse(input.start),end=parse(input.end);
 requireThat(end>start,400,'End time must be after the start.');
 return {starts_at:start.toUTC().toISO(),ends_at:end.toUTC().toISO(),time_zone:zone};
}
const jsonValue=(value,fallback)=>{if(typeof value!=='string')return value??fallback;try{return JSON.parse(value)??fallback;}catch{return fallback;}};
export function normalizeAppearance(value){
 const parsed=jsonValue(value,{});
 if(Array.isArray(parsed))return parsed.reduce((appearance,item)=>{const part=jsonValue(item,{});return part&&typeof part==='object'&&!Array.isArray(part)?{...appearance,...part}:appearance;},{});
 return parsed&&typeof parsed==='object'?parsed:{};
}
export function normalizeEvent(event){return event?{...event,appearance:normalizeAppearance(event.appearance),entitlement:jsonValue(event.entitlement,null)}:event;}
function eventAppearance(input,name,existing=null){
 const guestDesign=normalizeCanvasScene(input.guestDesign)||existing?.appearance.guest_design;
 return{title:String(input.title||name).slice(0,80),subtitle:String(input.subtitle||'').slice(0,180),button:String(input.button||existing?.appearance.button||'Take a photo').slice(0,28),chooseButton:String(input.chooseButton||existing?.appearance.chooseButton||'Choose photos').slice(0,28),joinButton:String(input.joinButton||existing?.appearance.joinButton||'Join the gathering').slice(0,28),showTitle:input.showTitle===undefined?existing?.appearance.showTitle!==false:Boolean(input.showTitle),showDate:input.showDate===undefined?Boolean(existing?.appearance.showDate):Boolean(input.showDate),cover:COVERS.find(c=>c.id===input.coverPreset||c.url===input.cover)?.url||existing?.appearance.cover||'/assets/garden-gathering.webp',...(existing?.appearance.camera_cover?{camera_cover:existing.appearance.camera_cover}:{}),...(existing?.appearance.camera_cover_key?{camera_cover_key:existing.appearance.camera_cover_key}:{}),...(existing?.appearance.qr_layout?{qr_layout:existing.appearance.qr_layout}:{}),...(existing?.appearance.qr_background_key?{qr_background_key:existing.appearance.qr_background_key}:{}),...(existing?.appearance.qr_base_key?{qr_base_key:existing.appearance.qr_base_key}:{}),...(existing?.appearance.cover_base_key?{cover_base_key:existing.appearance.cover_base_key}:{}),...(guestDesign?{guest_design:guestDesign}:{}),...normalizeCover({...existing?.appearance,...input})};
}
export function eventService(db,mail,auth={}) {
 const audit=(actor,action,target,detail={})=>db.query('insert into audit(id,actor_id,action,target_id,detail) values($1,$2,$3,$4,$5)',[uuid(),actor,action,target,detail]);
 const own=async(user,id,tx=db)=>{const row=tx===db&&auth.getEvent?await auth.getEvent(user,id):(await tx.query("select * from events where id=$1 and owner_id=$2 and status<>'deleted'"+(tx===db?'':' for update'),[id,user.id])).rows[0];const event=normalizeEvent(row);requireThat(event,404,'Event not found.');return event;};
 const ensureOrganizerPrefix=async(tx,ownerId)=>{
  let account=(await tx.query('select id,name,profile,storage_prefix from accounts where id=$1',[ownerId])).rows[0];
  requireThat(account,404,'Organizer account not found.');
  if(account.storage_prefix)return account.storage_prefix;
  account=(await tx.query('select id,name,profile,storage_prefix from accounts where id=$1 for update',[ownerId])).rows[0];
  if(account.storage_prefix)return account.storage_prefix;
  const label=organizerLabel(account.name,account.profile),compact=account.id.replaceAll('-','');
  for(const offset of [0,6,12,18,24,26]){
   const prefix=organizerFolder(label,compact.slice(offset,offset+6));
   const used=(await tx.query('select 1 from accounts where storage_prefix=$1 and id<>$2',[prefix,ownerId])).rows.length;
   if(used)continue;
   await tx.query('update accounts set storage_prefix=$1 where id=$2',[prefix,ownerId]);
   return prefix;
  }
  throw new Error('Could not allocate a unique organizer storage folder.');
 };
 const availableEventPrefix=async(tx,organizer,name,id,excludeId=null)=>{
  const compact=id.replaceAll('-','');
  for(const offset of [0,6,12,18,24,26]){
   const prefix=`${organizer}/events/${eventFolder(name,compact.slice(offset,offset+6))}`;
   const used=(await tx.query('select 1 from events where storage_prefix=$1 and ($2::uuid is null or id<>$2)',[prefix,excludeId])).rows.length;
   if(!used)return prefix;
  }
  throw new Error('Could not allocate a unique event storage folder.');
 };
 const ensureEventPrefix=async(event,tx)=>{
  const organizer=await ensureOrganizerPrefix(tx,event.owner_id);
  const current=(await tx.query('select name,storage_prefix from events where id=$1 for update',[event.id])).rows[0];
  if(current.storage_prefix.startsWith(`${organizer}/events/`))return current.storage_prefix;
  const prefix=await availableEventPrefix(tx,organizer,current.name,event.id,event.id);
  await tx.query('update events set storage_prefix=$1 where id=$2',[prefix,event.id]);
  return prefix;
 };
 const subscription=async user=>(await db.query('select * from subscriptions where account_id=$1',[user.id])).rows[0];
 return {
  own,subscription,audit,allowance:user=>publicationAllowance(db,user.id),
  async billingView(user){if(auth.getBilling){const data=await auth.getBilling(user)||{},sub=data.subscription||null,plan=PLANS[sub?.plan]||PLANS.trial,available=Boolean(sub&&['active','trialing'].includes(sub.status)&&Date.parse(sub.period_start)<=Date.now()&&Date.parse(sub.period_end)>Date.now()),used=Number(data.used)||0;return{subscription:sub,allowance:{used,limit:plan.events,remaining:available?Math.max(0,plan.events-used):0,available,passes:Number(data.passes)||0,period_start:sub?.period_start??null,period_end:sub?.period_end??null,plan:plan.id},orders:Array.isArray(data.orders)?data.orders:[]};}return{subscription:await subscription(user),allowance:await publicationAllowance(db,user.id),orders:(await db.query('select * from orders where owner_id=$1 order by created_at desc',[user.id])).rows};},
  async list(user){const rows=auth.listEvents?await auth.listEvents(user):(await db.query("select e.*,count(m.id) filter(where m.status='uploaded' and e.retention_at>now())::int as photo_count,coalesce(sum(m.bytes+m.thumbnail_bytes) filter(where m.status in ('uploaded','pending') and e.retention_at>now()),0)::bigint as bytes from events e left join media m on m.event_id=e.id where e.owner_id=$1 and e.status<>'deleted' group by e.id order by e.created_at desc",[user.id])).rows;return rows.map(row=>{const event=normalizeEvent(row);return{...event,state:eventState(event)};});},
  async save(user,input,id=null){
   if(!id&&auth.createEvent){
    const name=text(input.name,80),times=schedule(input),plan=PLANS.studio;
    requireThat(Date.parse(times.ends_at)-Date.parse(times.starts_at)<=plan.durationDays*86400000,400,`This plan supports events up to ${plan.durationDays} days.`);
    return normalizeEvent(await auth.createEvent(user,{id:uuid(),slug:token().slice(0,32),name,description:String(input.description||'').slice(0,500),...times,appearance:eventAppearance(input,name)}));
   }
   if(id&&auth.updateEvent){
    const existing=await own(user,id),name=text(input.name,80),preset=COVERS.find(c=>c.id===input.coverPreset||c.url===input.cover),hasSchedule=['start','end','time_zone'].some(key=>input[key]!==undefined),times=hasSchedule?schedule(input):{};
    return normalizeEvent(await auth.updateEvent(user,{id,name,description:String(input.description||'').slice(0,500),starts_at:times.starts_at??null,ends_at:times.ends_at??null,time_zone:times.time_zone??null,appearance:eventAppearance(input,name,existing),usePreset:Boolean(preset)}));
   }
   return db.transaction(async tx=>{
   await tx.query('select id from accounts where id=$1 for update',[user.id]);
   const creating=!id,existing=creating?null:await own(user,id,tx);
   if(creating)id=uuid();
   const publicationRow=existing?(await tx.query('select * from event_publications where event_id=$1',[id])).rows[0]:null;
   const publication=publicationRow?{...publicationRow,entitlement:jsonValue(publicationRow.entitlement,PLANS.studio)}:null;
   const plan=publication?.entitlement||PLANS.studio,scheduleProvided=['start','end','time_zone'].some(key=>input[key]!==undefined),times=existing&&!scheduleProvided?{starts_at:existing.starts_at,ends_at:existing.ends_at,time_zone:existing.time_zone}:schedule(input),durationLabel=plan.durationDays===1?'day':'days';
   requireThat(Date.parse(times.ends_at)-Date.parse(times.starts_at)<=plan.durationDays*86400000,400,`This plan supports events up to ${plan.durationDays} ${durationLabel}.`);
   const name=text(input.name,80),preset=COVERS.find(c=>c.id===input.coverPreset||c.url===input.cover);
   const appearance=eventAppearance(input,name,existing);
   if(existing){
    if(publication){requireThat(Date.parse(times.ends_at)<=Date.parse(publication.schedule_deadline),409,'This event cannot be moved beyond its scheduling window.');const captured=(await tx.query("select id from media where event_id=$1 limit 1",[id])).rows.length;if(captured)requireThat(Date.parse(times.starts_at)===Date.parse(existing.starts_at)&&Date.parse(times.ends_at)===Date.parse(existing.ends_at),409,'Event times cannot change after photos have been submitted. Pause uploads if needed.');}
    const state=eventState(existing);
    requireThat(state!=='archived'&&existing.status!=='archived',409,'An archived event can no longer be changed.');
    requireThat(Date.parse(existing.retention_at)>Date.now(),409,'This event is past its retention period and can no longer be changed.');
    if(state==='completed')requireThat(Date.parse(times.starts_at)===Date.parse(existing.starts_at)&&Date.parse(times.ends_at)===Date.parse(existing.ends_at),409,'A completed event cannot be rescheduled.');
    if(existing.appearance.cover_key){if(preset){await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'object-cleanup',$4)",[uuid(),user.id,id,{keys:[existing.appearance.cover_key,...(existing.appearance.cover_base_key?[existing.appearance.cover_base_key]:[])]}]);delete appearance.cover_base_key;}else appearance.cover_key=existing.appearance.cover_key;}
    await tx.query('update events set name=$1,description=$2,starts_at=$3,ends_at=$4,time_zone=$5,appearance=$6,retention_at=$7 where id=$8',[name,String(input.description||'').slice(0,500),times.starts_at,times.ends_at,times.time_zone,appearance,new Date(Date.parse(times.ends_at)+existing.entitlement.retentionDays*86400000).toISOString(),id]);
   }
   else{const drafts=(await tx.query("select count(*)::int as n from events where owner_id=$1 and status='draft'",[user.id])).rows[0].n;requireThat(drafts<100,409,'Archive unused drafts before creating another event.');const slug=token().slice(0,32),organizer=await ensureOrganizerPrefix(tx,user.id),prefix=await availableEventPrefix(tx,organizer,name,id);await tx.query('insert into events(id,owner_id,slug,name,description,starts_at,ends_at,time_zone,appearance,storage_prefix,entitlement,retention_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,user.id,slug,name,String(input.description||'').slice(0,500),times.starts_at,times.ends_at,times.time_zone,appearance,prefix,plan,new Date(Date.parse(times.ends_at)+plan.retentionDays*86400000).toISOString()]);}
   await tx.query('insert into audit(id,actor_id,action,target_id) values($1,$2,$3,$4)',[uuid(),user.id,existing?'event.updated':'event.created',id]);return own(user,id,tx);
  });},
  async action(user,id,input){if(auth.eventAction)return auth.eventAction(user,id,input);return db.transaction(async tx=>{await tx.query('select id from accounts where id=$1 for update',[user.id]);const e=await own(user,id,tx);const action=input.action;
   if(action==='publish'){
    requireThat(e.status==='draft'&&Date.parse(e.ends_at)>Date.now(),409,'Only a future or live draft can be published.');
    const plan=await grantPublication(tx,user,e,input.funding||'plan');
    requireThat(Date.parse(e.ends_at)-Date.parse(e.starts_at)<=plan.durationDays*86400000,409,`This allowance supports events up to ${plan.durationDays} ${plan.durationDays===1?'day':'days'}.`);
    const usage=(await tx.query("select count(*)::int as n,coalesce(sum(bytes+thumbnail_bytes),0)::bigint as bytes from media where event_id=$1 and status in ('pending','uploaded')",[id])).rows[0];
    requireThat(usage.n<=plan.photos&&Number(usage.bytes)<=plan.bytes,409,'This draft exceeds the selected allowance.');
    await tx.query("update events set status='published',paused=false,entitlement=$2,retention_at=ends_at+($3*interval '1 day') where id=$1",[id,plan,plan.retentionDays]);
   }
   else if(action==='pause'||action==='resume'){requireThat(['live','paused','scheduled'].includes(eventState(e)),409,'Uploads cannot be changed after the event.');await tx.query('update events set paused=$1 where id=$2',[action==='pause',id]);}
   else if(action==='archive')await tx.query("update events set status='archived',share_enabled=false where id=$1",[id]);
   else if(action==='restore'){requireThat(e.status==='archived'&&Date.parse(e.retention_at)>Date.now(),409,'This event can no longer be restored.');await tx.query("update events set status=case when ends_at<=now() and exists(select 1 from event_publications where event_id=$1) then 'published' else 'draft' end,paused=true where id=$1",[id]);}
   else if(action==='delete'){requireThat(input.confirm===e.name,400,'Type the event name to confirm permanent deletion.');await tx.query("update events set status='deleted',share_enabled=false where id=$1",[id]);await tx.query('insert into jobs(id,owner_id,event_id,type) values($1,$2,$3,\'cleanup\')',[uuid(),user.id,id]);}
   else if(action==='share'){requireThat(eventState(e)==='completed',409,'Sharing becomes available when the event ends.');const days=Number(input.days),remaining=Math.floor((Date.parse(e.retention_at)-Date.now())/86400000),maxDays=Math.min(e.entitlement.shareDays,remaining);requireThat(Number.isInteger(days)&&days>=1&&days<=maxDays,400,`Choose between 1 and ${Math.max(0,maxDays)} days, within the remaining photo-retention period.`);await tx.query('update events set share_enabled=$1,share_expires=now()+($2*interval \'1 day\') where id=$3',[input.enabled===true,days,id]);}
   else requireThat(false,400,'Unknown event action.');
   await tx.query('insert into audit(id,actor_id,action,target_id) values($1,$2,$3,$4)',[uuid(),user.id,`event.${action}`,id]);return {ok:true};
  });},
  async saveQrLayout(user,id,layout){if(auth.saveQrLayout)return auth.saveQrLayout(user,id,layout);return db.transaction(async tx=>{await tx.query('select id from accounts where id=$1 for update',[user.id]);const event=await own(user,id,tx);requireThat(layout.template!=='custom'||event.appearance.qr_background_key,409,'Upload a custom QR background first.');requireThat(['draft','published'].includes(event.status)&&Date.parse(event.retention_at)>Date.now(),409,'This event can no longer be redesigned.');await tx.query('update events set appearance=$1::jsonb where id=$2',[{...event.appearance,qr_layout:layout},event.id]);return layout;});},
  async reserveDesignAsset(user,id,assetType){if(auth.reserveDesignAsset)return auth.reserveDesignAsset(user,id,assetType);return db.transaction(async tx=>{await tx.query('select id from accounts where id=$1 for update',[user.id]);const event=await own(user,id,tx);requireThat(['cover','camera_cover','cover_source','qr_source','qr_background'].includes(assetType),400,'Choose a valid design asset.');requireThat(['draft','published'].includes(event.status)&&Date.parse(event.retention_at)>Date.now(),409,'This event can no longer be redesigned.');const prefix=await ensureEventPrefix(event,tx),reservationId=uuid(),key=`${prefix}/${assetType}-${reservationId.replaceAll('-','')}.webp`;await tx.query("insert into jobs(id,owner_id,event_id,type,payload,available_at) values($1,$2,$3,'object-cleanup',$4,now()+interval '10 minutes')",[reservationId,user.id,id,{keys:[key]}]);return{reservationId,key};});},
  async attachDesignAsset(user,id,assetType,key,reservationId){if(auth.attachDesignAsset)return auth.attachDesignAsset(user,id,assetType,key,reservationId);return db.transaction(async tx=>{await tx.query('select id from accounts where id=$1 for update',[user.id]);const event=await own(user,id,tx);requireThat(['draft','published'].includes(event.status)&&Date.parse(event.retention_at)>Date.now(),409,'This event can no longer be redesigned.');const reservation=(await tx.query("select status,payload from jobs where id=$1 and owner_id=$2 and event_id=$3 and type='object-cleanup' for update",[reservationId,user.id,id])).rows[0];requireThat(reservation?.status==='queued'&&reservation.payload?.keys?.length===1&&reservation.payload.keys[0]===key,409,'The design upload reservation expired.');const appearance={...event.appearance};let previous;if(assetType==='cover'){previous=appearance.cover_key;appearance.cover=`/api/covers/${id}${appearance.guest_design?'?design=1':''}`;appearance.cover_key=key;}else if(assetType==='camera_cover'){previous=appearance.camera_cover_key;appearance.camera_cover=`/api/covers/${id}?design=1&screen=camera`;appearance.camera_cover_key=key;}else if(assetType==='cover_source'){previous=appearance.cover_base_key;appearance.cover_base_key=key;}else if(assetType==='qr_source'){previous=appearance.qr_base_key;appearance.qr_base_key=key;appearance.qr_layout={...(appearance.qr_layout||{}),template:'custom'};}else if(assetType==='qr_background'){previous=appearance.qr_background_key;appearance.qr_background_key=key;}else requireThat(false,400,'Choose a valid design asset.');await tx.query('update events set appearance=$1::jsonb where id=$2',[appearance,id]);await tx.query('delete from jobs where id=$1',[reservationId]);if(previous&&previous!==key)await tx.query("insert into jobs(id,owner_id,event_id,type,payload) values($1,$2,$3,'object-cleanup',$4)",[uuid(),user.id,id,{keys:[previous]}]);await tx.query('insert into audit(id,actor_id,action,target_id) values($1,$2,$3,$4)',[uuid(),user.id,'event.design-asset.updated',id]);return{ok:true};});},
  async coverAsset(user,id,{camera=false,source=false}={}){if(auth.getCoverAsset)return auth.getCoverAsset(user,id,{camera,source});const event=normalizeEvent((await db.query("select * from events where id=$1 and status<>'deleted' and retention_at>now() and (owner_id=$2 or status='published')",[id,user?.id||null])).rows[0]);if(!event)return null;return source?(event.appearance.cover_base_key||event.appearance.cover_key):camera?(event.appearance.camera_cover_key||event.appearance.cover_key):event.appearance.cover_key;},
  async guest(slug){const row=auth.getPublicEvent?await auth.getPublicEvent(slug):(await db.query("select * from events where slug=$1 and status='published' and retention_at>now()",[slug])).rows[0],e=normalizeEvent(row);requireThat(e,404,'Event not found. Check the link and try again.');return e;},
  async createPreview(user,eventId){const secret=token();if(auth.createEventPreview)await auth.createEventPreview(user,eventId,hash(secret));else await db.query("insert into auth_tokens(token_hash,account_id,purpose,payload,expires_at) values($1,$2,'event-preview',$3,now()+interval '15 minutes')",[hash(secret),user.id,{event_id:eventId}]);return secret;},
  async preview(slug,secret){const tokenHash=hash(secret||''),row=auth.getEventPreview?await auth.getEventPreview(slug,tokenHash):(await db.query("select e.* from events e join auth_tokens t on t.account_id=e.owner_id where e.slug=$1 and t.token_hash=$2 and t.purpose='event-preview' and t.expires_at>now() and t.payload->>'event_id'=e.id::text and e.status<>'deleted'",[slug,tokenHash])).rows[0];const e=normalizeEvent(row);requireThat(e,404,'This event preview has expired. Create a new test QR.');return{...e,preview:true};},
  async organizerPrefix(user,tx=db){return tx===db?db.transaction(inner=>ensureOrganizerPrefix(inner,user.id)):ensureOrganizerPrefix(tx,user.id);},
  async organizedEventPrefix(event,tx=db){return tx===db?db.transaction(inner=>ensureEventPrefix(event,inner)):ensureEventPrefix(event,tx);},
  async join(e,input){requireThat(eventState(e)==='live',409,'Photo upload is not available for this event right now.');const id=uuid(),secret=token(),name=text(input.name,80);if(auth.joinPublicEvent){const guest=await auth.joinPublicEvent(e.id,{id,name,tokenHash:hash(secret)});requireThat(guest?.id===id&&guest.name===name,403,'Could not join this event.');}else await db.query('insert into guests(id,event_id,name,token_hash,storage_prefix) values($1,$2,$3,$4,$5)',[id,e.id,name,hash(secret),e.storage_prefix]);return {id,name,token:secret};},
  async guestIdentity(e,secret){const digest=hash(secret||''),g=auth.getPublicGuestIdentity?await auth.getPublicGuestIdentity(e.id,digest):(await db.query('select * from guests where token_hash=$1 and event_id=$2',[digest,e.id])).rows[0];requireThat(g,401,'Enter your name again to continue.');return{...g,token_hash:digest};},
  async share(e){requireThat(eventState(e)==='completed'&&e.share_enabled&&Date.parse(e.share_expires)>Date.now(),403,'This gallery is not shared or its sharing period has ended.');if(auth.consumePublicGalleryShare){await auth.consumePublicGalleryShare(e.id);return;}const r=await db.query("update events set share_used=share_used+1 where id=$1 and status='published' and ends_at<=now() and share_enabled=true and share_expires>now() and retention_at>now() and share_used<share_limit returning id",[e.id]);requireThat(r.rows.length,429,'This gallery is no longer available or has reached its allowance.');}
 };
}
