import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';
import {storage} from '../server/storage.mjs';
import {billingService} from '../server/billing.mjs';
import {PLANS,eventState} from '../shared/plans.js';
import {uuid} from '../server/security.mjs';

test('publication allowance and Single Event purchases',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'lumiq-allowances-')),db=await openDatabase({memory:true}),app=await createApp({db,files:storage({root})});
 const account=async(plan='trial')=>{const u={id:uuid(),name:'Allowance test',email:`${uuid()}@example.test`};await db.query('insert into accounts(id,name,email) values($1,$2,$3)',[u.id,u.name,u.email]);await db.query("insert into subscriptions(account_id,plan,status) values($1,$2,$3)",[u.id,plan,plan==='trial'?'trialing':'active']);return u;};
 const draft=(u)=>app.events.save(u,{name:'Future gathering',start:new Date(Date.now()+86400000).toISOString().slice(0,16),end:new Date(Date.now()+2*86400000).toISOString().slice(0,16),time_zone:'UTC'});
 const publish=(u,e,funding='plan')=>app.events.action(u,e.id,{action:'publish',funding});
 try{
  await t.test('new plan limits and automatic expiry archive behavior',async()=>{
   assert.deepEqual(['trial','single','gathering','studio'].map(id=>{const p=PLANS[id];return[p.price,p.photos,p.bytes/1024**2,p.durationDays,p.retentionDays,p.shareDays];}),[[0,50,100,1,7,4],[1500,500,1000,3,14,7],[3000,500,1000,3,14,7],[7000,1000,2000,3,30,14]]);
   const u=await account('gathering'),e=await draft(u);await publish(u,e);
   await db.query("update events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',retention_at=now()-interval '1 second',share_enabled=true where id=$1",[e.id]);
   const expired=await app.events.own(u,e.id);assert.equal(eventState(expired),'archived');
   const listed=(await app.events.list(u)).find(row=>row.id===e.id);assert.equal(listed.state,'archived');assert.equal(listed.photo_count,0);assert.equal(Number(listed.bytes),0);
   await assert.rejects(app.media.list(expired,new URLSearchParams(),{owner:true}),/Photo retention has ended/);
   await assert.rejects(app.events.guest(e.slug),/Event not found/);
   await app.jobs.retention();await app.jobs.tick();
   assert.equal((await app.events.own(u,e.id)).status,'archived');
   assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='retention-cleanup' and status='ready'",[e.id])).rows[0].n,1);
  });
  await t.test('event completion archives its gallery snapshot; later gallery deletion does not change the ZIP',async()=>{
   const u=await account('studio'),e=await draft(u);await publish(u,e);
   const guestId=uuid();await db.query('insert into guests(id,event_id,name,token_hash,storage_prefix) values($1,$2,$3,$4,$5)',[guestId,e.id,'Guest','token-'+guestId,'guest/test']);
   const photo=Buffer.from('synthetic-webp-fixture');
   const ids=[uuid(),uuid()],deletedBeforeEnd=uuid();
   for(let i=0;i<ids.length;i++){const key=`automatic/${ids[i]}.webp`;await app.files.put(key,photo);await db.query("insert into media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,status) values($1,$2,$3,$4,$5,$6,$7,1,'uploaded')",[ids[i],e.id,guestId,key,`automatic/${ids[i]}-thumb.webp`,`${i}.webp`,photo.length]);}
   await db.query("insert into media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,status,deleted_at) values($1,$2,$3,$4,$5,'removed.webp',$6,1,'deleted',now()-interval '2 hours')",[deletedBeforeEnd,e.id,guestId,`automatic/${deletedBeforeEnd}.webp`,`automatic/${deletedBeforeEnd}-thumb.webp`,photo.length]);
   await db.query("update events set name='Synthetic party',description='Remove at retention expiry',appearance='{\"cover\":\"private-cover\"}',starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',retention_at=now()+interval '30 days' where id=$1",[e.id]);
   await app.jobs.retention();
   let autos=(await db.query("select * from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows;
   assert.equal(autos.length,1);assert.equal(autos[0].status,'queued');assert.deepEqual([...autos[0].payload.ids].sort(),[...ids].sort());
   await app.jobs.retention();assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows[0].n,1);
   await app.media.remove(u,await app.events.own(u,e.id),[ids[0]]);
   await db.query("update jobs set status='failed' where id=$1",[autos[0].id]);await db.query("update jobs set available_at=now() where type='media-cleanup' and event_id=$1",[e.id]);await app.jobs.tick();
   assert.equal(await app.files.size(`automatic/${ids[0]}.webp`),photo.length,'Keep the event-end snapshot source available while a failed automatic export can be retried.');
   await db.query("update jobs set status='queued',available_at=now() where id=$1",[autos[0].id]);await app.jobs.tick();autos=(await db.query("select * from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows;assert.equal(autos[0].status,'ready');assert.equal(autos[0].result.count,2);assert.equal(autos[0].result.expires_at,new Date((await app.events.own(u,e.id)).retention_at).toISOString());
   await app.media.remove(u,await app.events.own(u,e.id),[ids[1]]);await app.jobs.retention();
   assert.equal((await db.query('select status from jobs where id=$1',[autos[0].id])).rows[0].status,'ready');
   await app.jobs.retention();assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows[0].n,1,'The maintenance cycle must not rebuild or replace the immutable archive.');
   const archivedZip=autos[0].result.parts[0].key;assert(await app.files.size(archivedZip));
   await db.query("update jobs set available_at=now() where type='media-cleanup' and event_id=$1",[e.id]);await app.jobs.tick();assert(await app.files.size(archivedZip),'Deleting gallery photos must not remove them from the already generated ZIP.');
   await db.query("update events set retention_at=now()-interval '1 second' where id=$1",[e.id]);const expiry=await app.jobs.retention({eventId:e.id});assert(expiry.expired&&expiry.jobId);await app.jobs.tick({jobIds:[expiry.jobId]});
   assert.equal((await db.query('select count(*)::int as n from media where event_id=$1',[e.id])).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int as n from guests where event_id=$1',[e.id])).rows[0].n,0);
   await assert.rejects(app.files.size(archivedZip),{code:'ENOENT'},'Retention expiry removes the ZIP as well as gallery media.');
   const archived=(await db.query('select id,name,slug,description,appearance,storage_prefix,entitlement,status,starts_at,ends_at,time_zone,retention_at,share_enabled,share_expires,share_used,share_limit from events where id=$1',[e.id])).rows[0];
   assert.equal(archived.name,'Synthetic party');assert.equal(archived.slug,`expired-${e.id}`);assert.equal(archived.description,'');assert.deepEqual(archived.appearance,{});assert.equal(archived.storage_prefix,`expired/events/${e.id}`);assert.deepEqual(archived.entitlement,{retentionDays:30});assert.equal(archived.status,'archived');assert(archived.starts_at&&archived.ends_at&&archived.time_zone&&archived.retention_at);assert.equal(archived.share_enabled,false);assert.equal(archived.share_expires,null);assert.equal(archived.share_used,0);assert.equal(archived.share_limit,0);
  });
  await t.test('retention cleanup retries idempotently and never removes another organizer assets',async()=>{
   const owner=await account('studio'),other=await account('studio'),photo=Buffer.from('synthetic-cleanup-photo');
   const makeEnded=async(user,name)=>{
    const event=await draft(user);await publish(user,event);const guestId=uuid(),mediaId=uuid();
    await db.query('insert into guests(id,event_id,name,token_hash,storage_prefix) values($1,$2,$3,$4,$5)',[guestId,event.id,'Test guest',`cleanup-${guestId}`,`cleanup/${event.id}/guest`]);
    const prefix=`cleanup/${event.id}`,keys={photo:`${prefix}/guest/photo.webp`,thumb:`${prefix}/guest/thumb/photo.webp`,cover:`${prefix}/cover.webp`,qr:`${prefix}/qr.webp`};
    for(const key of Object.values(keys))await app.files.put(key,photo);
    await db.query("insert into media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,status) values($1,$2,$3,$4,$5,'photo.webp',$6,$6,'uploaded')",[mediaId,event.id,guestId,keys.photo,keys.thumb,photo.length]);
    await db.query("update events set name=$2,starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',retention_at=now()+interval '1 day',appearance=jsonb_build_object('cover_key',$3::text,'qr_background_key',$4::text) where id=$1",[event.id,name,keys.cover,keys.qr]);
    return{eventId:event.id,mediaId,keys};
   };
   const target=await makeEnded(owner,'Expiring synthetic event'),preserved=await makeEnded(other,'Unexpired synthetic event');
   const targeted=await app.jobs.retention({eventId:target.eventId,phase:'event-end'});assert(targeted.prepared&&targeted.jobId);
   await app.jobs.tick({concurrency:1,maxJobs:1,jobIds:[targeted.jobId]});
   const targetParts=(await db.query("select id from jobs where event_id=$1 and type='export-part' and payload->>'parent_id'=$2 and status='queued'",[target.eventId,targeted.jobId])).rows;assert(targetParts.length);
   await app.jobs.tick({concurrency:1,maxJobs:targetParts.length,jobIds:targetParts.map(part=>part.id)});
   assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[preserved.eventId])).rows[0].n,0,'The scoped event-end preparation must not touch another organizer event.');
   await app.jobs.retention();await app.jobs.tick();
   const getAutoZip=async(eventId)=>{const job=(await db.query("select result from jobs where event_id=$1 and type='export' and status='ready' and payload->>'automatic'='true'",[eventId])).rows[0];assert(job?.result?.parts?.length);return job.result.parts[0].key;};
   const targetZip=await getAutoZip(target.eventId),preservedZip=await getAutoZip(preserved.eventId);
   await db.query('update events set retention_at=now()-interval \'1 second\' where id=$1',[target.eventId]);
    const expiry=await app.jobs.retention({eventId:target.eventId});assert(expiry.expired&&expiry.jobId);
   let cleanup=(await db.query("select id,status from jobs where event_id=$1 and type='retention-cleanup'",[target.eventId])).rows;assert.equal(cleanup.length,1);assert.equal(cleanup[0].status,'queued');
   const remove=app.files.remove;let failed=false;app.files.remove=async key=>{if(key===target.keys.photo&&!failed){failed=true;throw new Error('synthetic R2 outage');}return remove(key);};
   try{await app.jobs.tick();}finally{app.files.remove=remove;}
   cleanup=(await db.query('select id,status from jobs where id=$1',[cleanup[0].id])).rows[0];assert.equal(cleanup.status,'queued');
    const retry=await app.jobs.retention({eventId:target.eventId});assert.equal(retry.jobId,cleanup.id,'A repeated scoped expiry must reuse its existing cleanup job.');
    await db.query('update jobs set available_at=now() where id=$1',[cleanup.id]);await app.jobs.tick({jobIds:[cleanup.id]});
   for(const key of Object.values(target.keys))await assert.rejects(app.files.get(key),{code:'ENOENT'});
   await assert.rejects(app.files.get(targetZip),{code:'ENOENT'});
   assert.equal((await db.query('select count(*)::int as n from media where event_id=$1',[target.eventId])).rows[0].n,0);
   const archived=(await db.query('select id,name,slug,description,appearance,storage_prefix,entitlement,status,starts_at,ends_at,time_zone,retention_at,share_enabled,share_expires,share_used,share_limit from events where id=$1',[target.eventId])).rows[0];
   assert.equal(archived.name,'Expiring synthetic event');assert.equal(archived.slug,`expired-${target.eventId}`);assert.equal(archived.description,'');assert.deepEqual(archived.appearance,{});assert.equal(archived.storage_prefix,`expired/events/${target.eventId}`);assert.deepEqual(archived.entitlement,{retentionDays:30});assert.equal(archived.status,'archived');assert(archived.starts_at&&archived.ends_at&&archived.time_zone&&archived.retention_at);assert.equal(archived.share_enabled,false);assert.equal(archived.share_expires,null);assert.equal(archived.share_used,0);assert.equal(archived.share_limit,0);
   await app.jobs.retention();await app.jobs.tick();assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='retention-cleanup'",[target.eventId])).rows[0].n,1,'Repeated expiry runs must remain idempotent after success.');
   assert.equal((await db.query('select count(*)::int as n from media where id=$1 and event_id=$2',[preserved.mediaId,preserved.eventId])).rows[0].n,1);
   for(const key of [...Object.values(preserved.keys),preservedZip])assert(await app.files.size(key),`Other organizer asset must survive cleanup: ${key}`);
  });
  await t.test('expired subscriptions preserve owner access and post-event sharing until retention ends',async()=>{
   for(const plan of ['gathering','studio']){
    const u=await account(plan),e=await draft(u);await publish(u,e);
    const published=await app.events.own(u,e.id);
    assert.equal(published.entitlement.retentionDays,plan==='studio'?30:14);
    await db.query("update events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',retention_at=now()+($2*interval '1 day') where id=$1",[e.id,published.entitlement.retentionDays]);
    await db.query("update subscriptions set status='canceled',period_end=now()-interval '1 day' where account_id=$1",[u.id]);
    const retained=await app.events.own(u,e.id);
    assert.deepEqual(retained.entitlement,published.entitlement);
    assert((await app.events.list(u)).some(item=>item.id===e.id));
    await app.events.action(u,e.id,{action:'share',enabled:true,days:published.entitlement.shareDays});
    await app.events.share(await app.events.guest(e.slug));
    await assert.rejects(publish(u,await draft(u)));
    await db.query("update events set retention_at=now()-interval '1 second' where id=$1",[e.id]);
    await assert.rejects(app.events.guest(e.slug),/Event not found/);
   }
  });
  await t.test('sharing duration is user-selected but cannot pass the remaining retention deadline',async()=>{
   const u=await account('gathering'),e=await draft(u);await publish(u,e);
   await db.query("update events set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day',retention_at=now()+interval '4 days 1 minute' where id=$1",[e.id]);
   await assert.rejects(app.events.action(u,e.id,{action:'share',enabled:true,days:5}),/remaining photo-retention period/);
   await app.events.action(u,e.id,{action:'share',enabled:true,days:4});
   const shared=await app.events.own(u,e.id);assert(Date.parse(shared.share_expires)<=Date.parse(shared.retention_at));
  });
  await t.test('trial remains one free publication and deletion cannot recycle it',async()=>{
   assert.equal(PLANS.trial.price,0);const u=await account(),a=await draft(u),b=await draft(u);
   assert.equal((await app.events.allowance(u)).remaining,1);await publish(u,a);
   await app.events.action(u,a.id,{action:'delete',confirm:a.name});await assert.rejects(publish(u,b),/trial event has been used/);
  });
  await t.test('Gathering grants four per period, including future and already ended events',async()=>{
   assert.equal(PLANS.gathering.events,4);const u=await account('gathering');
   for(let i=0;i<4;i++){const e=await draft(u);await publish(u,e);await db.query("update events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",[e.id]);}
   const fifth=await draft(u);await assert.rejects(publish(u,fifth),/billing period is used/);
   assert.equal((await app.events.allowance(u)).used,4);
   await db.query("update event_publications set consumed_at=now()-interval '1 month' where owner_id=$1",[u.id]);
   await db.query("update subscriptions set period_start=now(),period_end=now()+interval '1 month' where account_id=$1",[u.id]);
   assert.equal((await app.events.allowance(u)).remaining,4);await publish(u,fifth);
  });
  await t.test('concurrent publications cannot spend the final subscription slot twice',async()=>{
   const u=await account('gathering');for(let i=0;i<3;i++)await publish(u,await draft(u));
   const a=await draft(u),b=await draft(u);
   const results=await Promise.allSettled([publish(u,a),publish(u,b)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal((await app.events.allowance(u)).used,4);
  });
  await t.test('a pass belongs to its buyer and concurrent publication consumes it once',async()=>{
   const owner=await account(),other=await account(),order=await app.billing.checkout(owner,{plan:'single'});
   await app.billing.simulate(owner,order.order,'success');
   await assert.rejects(publish(other,await draft(other),'pass'),/No Single Event pass/);
   const a=await draft(owner),b=await draft(owner);
   const results=await Promise.allSettled([publish(owner,a,'pass'),publish(owner,b,'pass')]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal((await app.events.allowance(owner)).passes,0);
   assert.equal((await db.query('select count(*)::int as n from event_publications where owner_id=$1',[owner.id])).rows[0].n,1);
  });
  await t.test('restoring an ended unpublished draft never grants guest access',async()=>{
   const u=await account(),e=await draft(u);
   await app.events.action(u,e.id,{action:'archive'});
   await db.query("update events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",[e.id]);
   await app.events.action(u,e.id,{action:'restore'});
   assert.equal((await app.events.own(u,e.id)).status,'draft');
   await assert.rejects(app.events.guest(e.slug),/Event not found/);
   assert.equal((await app.events.allowance(u)).remaining,1);
  });
  await t.test('Studio grants twelve, not unlimited sequential events',async()=>{
   const u=await account('studio');for(let i=0;i<12;i++)await publish(u,await draft(u));
   await assert.rejects(publish(u,await draft(u)),/billing period is used/);
  });
  await t.test('one-time pass is idempotent, separate from subscription and consumed once',async()=>{
   const u=await account('gathering'),before=await app.events.subscription(u);
   const order=await app.billing.checkout(u,{plan:'single'});await app.billing.simulate(u,order.order,'success');await app.billing.simulate(u,order.order,'success');
   const after=await app.events.subscription(u);assert.equal(after.plan,'gathering');assert.equal(String(before.period_end),String(after.period_end));
   assert.equal((await app.events.allowance(u)).passes,1);
   const e=await draft(u);await publish(u,e,'pass');assert.equal((await app.events.own(u,e.id)).entitlement.photos,PLANS.gathering.photos);assert.equal((await app.events.allowance(u)).used,0);
   await app.events.action(u,e.id,{action:'archive'});await app.events.action(u,e.id,{action:'restore'});await publish(u,e);
   assert.equal((await app.events.allowance(u)).passes,0);assert.equal((await app.events.allowance(u)).used,0);
   await assert.rejects(publish(u,await draft(u),'pass'),/No Single Event pass/);
  });
  await t.test('failed/canceled checkout grants no pass and invalid publication rolls back consumption',async()=>{
   const u=await account();for(const outcome of ['fail','cancel']){const o=await app.billing.checkout(u,{plan:'single'});await app.billing.simulate(u,o.order,outcome);}
   assert.equal((await app.events.allowance(u)).passes,0);
   const e=await draft(u);await db.query("update events set ends_at=starts_at+interval '8 days' where id=$1",[e.id]);
   await assert.rejects(publish(u,e),/up to 1 day/);assert.equal((await app.events.allowance(u)).remaining,1);
  });
  await t.test('subscription plan changes in the same period cannot reset used publications',async()=>{
   const u=await account(),first=await app.billing.checkout(u,{plan:'gathering'});await app.billing.simulate(u,first.order,'success');
   await publish(u,await draft(u));const before=await app.events.subscription(u);
   const change=await app.billing.checkout(u,{plan:'studio'});await app.billing.simulate(u,change.order,'success');
   const after=await app.events.subscription(u);assert.equal(String(before.period_start),String(after.period_start));assert.equal((await app.events.allowance(u)).used,1);assert.equal((await app.events.allowance(u)).remaining,11);
  });
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

test('Stripe Single Event checkout uses payment mode and a verified paid event grants only a pass',async()=>{
 const db=await openDatabase({memory:true}),u={id:uuid(),email:'single@example.test'},prior={...process.env};let request;
 try{
  process.env.PLATFORM_STRIPE_SECRET='sk_test_fixture';process.env.PLATFORM_STRIPE_PRICE_SINGLE='price_one_time';
  await db.query('insert into accounts(id,name,email) values($1,$2,$3)',[u.id,'Single buyer',u.email]);await db.query('insert into subscriptions(account_id) values($1)',[u.id]);
  const billing=billingService(db,{origin:'https://isolated.example.test',local:false,fetcher:async(url,options)=>{request=new URLSearchParams(options.body);return Response.json({id:'cs_fixture',url:'https://checkout.stripe.com/fixture'});}});
  await billing.checkout(u,{plan:'single'});assert.equal(request.get('mode'),'payment');assert.equal(request.has('subscription_data[metadata][account_id]'),false);
  const event={id:'evt_single',created:Math.floor(Date.now()/1000),type:'checkout.session.completed',data:{object:{id:'cs_fixture',mode:'payment',payment_status:'paid',amount_total:PLANS.single.price,currency:'eur',metadata:{account_id:u.id,order_id:request.get('metadata[order_id]')}}}};
  await billing.apply(event);await billing.apply(event);assert.equal((await db.query('select count(*)::int as n from event_passes')).rows[0].n,1);assert.equal((await db.query('select plan from subscriptions where account_id=$1',[u.id])).rows[0].plan,'trial');
 }finally{for(const key of ['PLATFORM_STRIPE_SECRET','PLATFORM_STRIPE_PRICE_SINGLE']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await db.close();}
});
