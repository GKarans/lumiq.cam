import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openDatabase} from '../server/db.mjs';
import {createApp,isReleaseApproved} from '../server/app.mjs';
import {storage} from '../server/storage.mjs';
import {uuid,hash} from '../server/security.mjs';
import {collectNotices,queueMessage} from '../server/notifications.mjs';
import {mailDelivery,renderLumiqEmail} from '../server/mail.mjs';
import {replaceCover,replaceCoverSource} from '../server/covers.mjs';
import {replaceQrBackground,replaceQrSource,saveQrLayout} from '../server/qr-posters.mjs';
import {normalizeEvent} from '../server/events.mjs';
import {validateWebp} from '../../cloudflare/worker/src/webp-validation.js';

test('deployment approval matches the explicit environment and keeps production locked by default',()=>{
 assert.equal(isReleaseApproved('staging','staging'),true);
 assert.equal(isReleaseApproved('production','production'),true);
 assert.equal(isReleaseApproved('production','staging'),false);
 assert.equal(isReleaseApproved('staging','production'),false);
 assert.equal(isReleaseApproved(undefined,undefined),false);
});

test('alternate app hosts require exact allowlisting and keep CSRF origin checks strict',async()=>{
 const db=await openDatabase({memory:true}),primary='https://lumiq.cam',testHost='https://lumiq-closed-test.gkarans-events.workers.dev';
 try{
  const app=await createApp({db,origin:primary,allowedOrigins:[testHost]});
  assert.equal((await app.handle(new Request(`${testHost}/api/config`))).status,200);
  const post=(host,requestOrigin)=>app.handle(new Request(`${host}/api/auth/logout`,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:'{}'}));
  assert.equal((await post(testHost,testHost)).status,200);
  assert.equal((await post(testHost,'https://attacker.example')).status,403);
  assert.equal((await app.handle(new Request('https://unlisted.example/'))).status,403);
  await assert.rejects(createApp({origin:primary,allowedOrigins:['https://lumiq.cam/path']}),/Configured origin is invalid/);
 }finally{await db.close();}
});

test('event JSONB values returned as strings are normalized before use',()=>{
 const event=normalizeEvent({appearance:'{"cover":"/api/covers/id","title":"Saved"}',entitlement:'{"retentionDays":14}'});
 assert.deepEqual(event.appearance,{cover:'/api/covers/id',title:'Saved'});
 assert.deepEqual(event.entitlement,{retentionDays:14});
 const legacy=normalizeEvent({appearance:[
  '{"title":"Ballīte","cover":"/assets/garden-gathering.webp","font":"roboto"}',
  '{"qr_layout":{"template":"modern","font":"playfair-display"}}',
  '{"qr_layout":{"template":"vintage","font":"playfair-display"}}'
 ]});
 assert.deepEqual(legacy.appearance,{title:'Ballīte',cover:'/assets/garden-gathering.webp',font:'roboto',qr_layout:{template:'vintage',font:'playfair-display'}});
});

test('service notices deduplicate and delivery retries survive worker restarts',async()=>{
 const db=await openDatabase({memory:true}),owner={id:uuid(),email:'notices@example.test',name:'Notifications'};
 const previousKey=process.env.PLATFORM_EMAIL_KEY,previousFrom=process.env.PLATFORM_EMAIL_FROM,previousReplyTo=process.env.PLATFORM_EMAIL_REPLY_TO;
 try{
  await db.query('insert into accounts(id,email,name) values($1,$2,$3)',[owner.id,owner.email,owner.name]);
  await db.query("insert into subscriptions(account_id,plan,status) values($1,'studio','active')",[owner.id]);
  const app=await createApp({db});
  const e=await app.events.save(owner,{name:'Notice fixture',time_zone:'UTC',start:'2026-01-01T10:00',end:'2026-01-01T11:00'});
  await db.query("update events set status='published',retention_at=now()+interval '10 days' where id=$1",[e.id]);
  await collectNotices(db);await collectNotices(db);
  assert.equal((await db.query('select count(*)::int as n from deliveries')).rows[0].n,2);
  Object.assign(process.env,{PLATFORM_EMAIL_KEY:'fixture',PLATFORM_EMAIL_FROM:'testing@example.test'});
  let fail=true;const keys=[],payloads=[];
  const deliver=mailDelivery(db,{local:false,fetcher:async(url,options)=>{keys.push(options.headers['Idempotency-Key']);payloads.push(JSON.parse(options.body));return new Response(null,{status:fail?503:200});}});
  assert.equal((await deliver()).sent,0);
  const retry=(await db.query('select * from deliveries')).rows;
  assert.ok(retry.every(m=>m.status==='queued'&&m.attempts===1&&Date.parse(m.available_at)>Date.now()));
  fail=false;await db.query('update deliveries set available_at=now()');assert.equal((await deliver()).sent,2);
  assert.equal(new Set(keys).size,2);
  await queueMessage(db,owner,'Crash fixture','Resume without duplicate delivery.','crash');
  await db.query("update deliveries set status='processing',lease_until=now()-interval '1 minute' where dedupe_key='crash'");
  assert.equal((await deliver()).sent,1);
  await queueMessage(db,owner,'Last attempt','Requires operator attention.','last');
  await db.query("update deliveries set attempts=4 where dedupe_key='last'");fail=true;
  await deliver();assert.equal((await db.query("select status from deliveries where dedupe_key='last'")).rows[0].status,'failed');
  fail=false;process.env.PLATFORM_EMAIL_REPLY_TO='support@lumiq.cam';
  await queueMessage(db,owner,'HTML <fixture>','<img src=x onerror=alert(1)>\n\nhttps://lumiq.cam/reset?token=x&next=ok','html');
  await db.query("update deliveries set reply_to='guest@example.test' where dedupe_key='html'");
  assert.equal((await deliver()).sent,1);
  const message=payloads.at(-1);
  assert.equal(message.text,'<img src=x onerror=alert(1)>\n\nhttps://lumiq.cam/reset?token=x&next=ok');
  assert.equal(message.reply_to,'guest@example.test');
  assert.match(message.html,/HTML &lt;fixture&gt;/);
  assert.match(message.html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(message.html,/<img src=x/);
  assert.match(message.html,/href="https:\/\/lumiq\.cam\/reset\?token=x&amp;next=ok"/);
 }finally{
  for(const [key,value]of [['PLATFORM_EMAIL_KEY',previousKey],['PLATFORM_EMAIL_FROM',previousFrom],['PLATFORM_EMAIL_REPLY_TO',previousReplyTo]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await db.close();
 }
});

test('Lumiq email renderer includes responsive brand and escapes content',()=>{
 const html=renderLumiqEmail('Parole <mainīta>','Droši turpini & apstiprini.');
 assert.match(html,/name="viewport"/);
 assert.match(html,/Lumiq/);
 assert.match(html,/Parole &lt;mainīta&gt;/);
 assert.match(html,/Droši turpini &amp; apstiprini\./);
 assert.match(html,/lang="lv"/);
});

test('cover replacement preserves the attached file and cleans failed attachments',async()=>{
 const db=await openDatabase({memory:true}),root=await mkdtemp(path.join(os.tmpdir(),'gf-covers-'));
 const files=storage({root}),app=await createApp({db,files}),user={id:uuid(),email:'cover@example.test',name:'Cover'};
 try{
  await db.query('insert into accounts(id,email,name) values($1,$2,$3)',[user.id,user.email,user.name]);await db.query('insert into subscriptions(account_id) values($1)',[user.id]);
  const start=new Date(Date.now()-2*3600000).toISOString().slice(0,16),end=new Date(Date.now()-3600000).toISOString().slice(0,16);
  const e=await app.events.save(user,{name:'Cover fixture',time_zone:'UTC',start,end});
  const folder=(await db.query('select storage_prefix from accounts where id=$1',[user.id])).rows[0].storage_prefix;
  await db.query('update accounts set name=$1 where id=$2',['Renamed Organizer',user.id]);
  assert.equal(await app.events.organizerPrefix(user),folder);
  await db.query('update events set appearance=$1::jsonb where id=$2',[JSON.stringify([
   JSON.stringify({title:'Cover fixture',cover:'/assets/garden-gathering.webp',font:'roboto'}),
   JSON.stringify({qr_layout:{template:'modern',font:'playfair-display'}})
  ]),e.id]);
  const qrLayout=await saveQrLayout(db,app.events,user,e.id,{template:'vintage',font:'roboto',qrY:.62});
  assert.deepEqual(qrLayout,{template:'vintage',font:'roboto',titleSize:76,textX:.5,textY:.15,qrX:.5,qrY:.62,qrScale:1});
  const data=(await sharp({create:{width:16,height:16,channels:3,background:'#16835e'}}).webp().toBuffer()).toString('base64');
  await replaceQrBackground(db,files,app.events,user,e.id,data,validateWebp);const qrBackground=(await app.events.own(user,e.id)).appearance.qr_background_key;
  assert.match(qrBackground,/^cover-[0-9a-f]{6}\/events\/cover-fixture-[0-9a-f]{6}\/qr_background-[0-9a-f]{32}\.webp$/);
  await replaceCover(db,files,app.events,user,e.id,data,validateWebp);const first=(await app.events.own(user,e.id)).appearance.cover_key;
  assert.match(first,/^cover-[0-9a-f]{6}\/events\/cover-fixture-[0-9a-f]{6}\/cover-[0-9a-f]{32}\.webp$/);
  await replaceCover(db,files,app.events,user,e.id,data,validateWebp,'camera');
  const cameraCover=(await app.events.own(user,e.id)).appearance.camera_cover_key;
  assert.match(cameraCover,/^cover-[0-9a-f]{6}\/events\/cover-fixture-[0-9a-f]{6}\/camera_cover-[0-9a-f]{32}\.webp$/);
  await replaceCoverSource(db,files,app.events,user,e.id,data,validateWebp);
  const coverSource=(await app.events.own(user,e.id)).appearance.cover_base_key;
  assert.match(coverSource,/^cover-[0-9a-f]{6}\/events\/cover-fixture-[0-9a-f]{6}\/cover_source-[0-9a-f]{32}\.webp$/);
  const updated=await app.events.save(user,{name:'Cover fixture',title:'Saved design',time_zone:'UTC',start,end},e.id);
  assert.equal(updated.appearance.title,'Saved design');
  assert.equal(updated.appearance.cover,`/api/covers/${e.id}`);
  assert.equal(updated.appearance.cover_key,first);
  assert.deepEqual(updated.appearance.qr_layout,qrLayout);
  assert.equal(updated.appearance.font,'roboto');
  assert.equal(updated.appearance.qr_background_key,qrBackground);
  await replaceQrSource(db,files,app.events,user,e.id,data,validateWebp);
  const qrSourceEvent=await app.events.own(user,e.id);
  assert.match(qrSourceEvent.appearance.qr_base_key,/^cover-[0-9a-f]{6}\/events\/cover-fixture-[0-9a-f]{6}\/qr_source-[0-9a-f]{32}\.webp$/);
  assert.equal(qrSourceEvent.appearance.qr_layout.template,'custom');
  await replaceCover(db,files,app.events,user,e.id,data,validateWebp);const second=(await app.events.own(user,e.id)).appearance.cover_key;
  assert.notEqual(first,second);await app.jobs.tick();await assert.rejects(files.get(first));assert.ok(await files.size(second));
  const abandoned=await app.events.reserveDesignAsset(user,e.id,'cover');await files.put(abandoned.key,Buffer.from('orphan'));
  await app.events.action(user,e.id,{action:'archive'});
  await assert.rejects(app.events.attachDesignAsset(user,e.id,'cover',abandoned.key,abandoned.reservationId),/no longer be redesigned/);
  await assert.rejects(replaceCover(db,files,app.events,user,e.id,data,validateWebp),/no longer be redesigned/);
  const cleanup=(await db.query("select * from jobs where status='queued' and type='object-cleanup'")).rows;
  assert.equal(cleanup.length,1);const detached=cleanup[0].payload.keys[0];assert.equal(detached,abandoned.key);assert.ok(await files.size(detached));
  await db.query('update jobs set available_at=now() where id=$1',[cleanup[0].id]);await app.jobs.tick();await assert.rejects(files.get(detached));assert.ok(await files.size(second));
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

test('every new event starts with its own cover and QR design',async()=>{
 const db=await openDatabase({memory:true}),root=await mkdtemp(path.join(os.tmpdir(),'gf-design-defaults-'));
 const files=storage({root}),app=await createApp({db,files}),user={id:uuid(),email:'defaults@example.test',name:'Defaults'};
 try{
  await db.query('insert into accounts(id,email,name,verified) values($1,$2,$3,true)',[user.id,user.email,user.name]);
  const start=new Date(Date.now()+3600000).toISOString().slice(0,16),end=new Date(Date.now()+7200000).toISOString().slice(0,16),data=(await sharp({create:{width:16,height:16,channels:3,background:'#16835e'}}).webp().toBuffer()).toString('base64');
  const first=await app.events.save(user,{name:'First party',start,end,time_zone:'UTC'});
  await replaceCover(db,files,app.events,user,first.id,data,validateWebp);
  await saveQrLayout(db,app.events,user,first.id,{template:'vintage',font:'roboto'});
  await replaceQrBackground(db,files,app.events,user,first.id,data,validateWebp);
  await saveQrLayout(db,app.events,user,first.id,{template:'custom'});
  const customized=await app.events.own(user,first.id),coverKey=customized.appearance.cover_key,qrKey=customized.appearance.qr_background_key;
  await db.query('update accounts set design_defaults=$1::jsonb where id=$2',[{cover:customized.appearance.cover,cover_key:coverKey,qr_layout:customized.appearance.qr_layout,qr_background_key:qrKey},user.id]);
  const second=await app.events.save(user,{name:'Second party',start,end,time_zone:'UTC'});
  assert.equal(second.appearance.cover,'/assets/garden-gathering.webp');
  assert.equal(second.appearance.cover_key,undefined);
  assert.equal(second.appearance.qr_background_key,undefined);
  assert.equal(second.appearance.qr_layout,undefined);
  assert.equal((await app.events.own(user,first.id)).appearance.qr_background_key,qrKey);
  const outsider={id:uuid(),email:'outsider@example.test',name:'Outsider'},session=uuid();
  await db.query('insert into accounts(id,email,name,verified) values($1,$2,$3,true)',[outsider.id,outsider.email,outsider.name]);
  await db.query("insert into sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '1 hour')",[hash(session),outsider.id]);
  const outsiderEvent=await app.events.save(outsider,{name:'Other party',start,end,time_zone:'UTC'});
  assert.notEqual(outsiderEvent.storage_prefix.split('/')[0],first.storage_prefix.split('/')[0]);
  const otherRequest=(route,body)=>app.handle(new Request(`${app.origin}${route}`,{method:body?'POST':'GET',headers:{Origin:app.origin,Cookie:`lumiq_session=${session}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  for(const route of [`/api/events/${first.id}`,`/api/events/${first.id}/qr?format=table`,`/api/covers/${first.id}`])assert.equal((await otherRequest(route)).status,404);
  for(const route of [`/api/events/${first.id}/cover`,`/api/events/${first.id}/qr-background`])assert.equal((await otherRequest(route,{data})).status,404);
  assert.equal((await app.events.own(user,first.id)).appearance.cover_key,coverKey);
  assert.equal((await app.events.own(user,first.id)).appearance.qr_background_key,qrKey);
  const migration=await readFile(new URL('../server/migrations/010-event-isolated-designs.sql',import.meta.url),'utf8');
  await db.query(migration);
  assert.deepEqual((await db.query('select design_defaults from accounts where id=$1',[user.id])).rows[0].design_defaults,{});
  await app.events.action(user,first.id,{action:'delete',confirm:first.name});
  await app.jobs.tick();
  await assert.rejects(files.get(coverKey));
  await assert.rejects(files.get(qrKey));
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

test('support replies and failed-email recovery require an audited administrator',async()=>{
 const db=await openDatabase({memory:true}),app=await createApp({db});
 try{
  const admin=uuid(),customer=uuid(),caseId=uuid();
  for(const [id,role]of [[admin,'admin'],[customer,'customer']]){
   await db.query('insert into accounts(id,name,email,role) values($1,$2,$3,$4)',[id,role,`${role}@example.test`,role]);
   await db.query("insert into sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '1 hour')",[hash(id),id]);
  }
  await db.query('insert into support_cases(id,owner_id,email,subject,message) values($1,$2,$3,$4,$5)',[caseId,customer,'customer@example.test','Need help','Test question']);
  const call=(who,route,body)=>app.handle(new Request(app.origin+'/api/'+route,{method:body?'POST':'GET',headers:{Origin:app.origin,Cookie:`lumiq_session=${who}`},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await call(customer,'admin/reply',{id:caseId,reply:'Not authorized'})).status,403);
  assert.equal((await call(admin,'admin/reply',{id:caseId,reply:'Here is your answer.'})).status,200);
  const delivery=(await db.query('select * from deliveries')).rows[0];assert.equal(delivery.body,'Here is your answer.');
  await db.query("update deliveries set status='failed',attempts=5 where id=$1",[delivery.id]);
  assert.equal((await call(customer,'admin/retry-email',{id:delivery.id})).status,403);
  assert.equal((await call(admin,'admin/retry-email',{id:delivery.id})).status,200);
  assert.equal((await db.query('select attempts from deliveries where id=$1',[delivery.id])).rows[0].attempts,0);
  const overview=await(await call(admin,'admin')).json();assert.equal(overview.deliveries[0].body,undefined);
  assert.equal((await db.query("select count(*)::int as n from audit where action in ('admin.support.reply','admin.email.retry')")).rows[0].n,2);
 }finally{await db.close();}
});
