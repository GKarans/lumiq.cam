import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {unzipSync} from 'fflate';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';
import {storage} from '../server/storage.mjs';
import {uuid,hash} from '../server/security.mjs';
import {billingService} from '../server/billing.mjs';
import {supabaseAuthService} from '../server/supabase-auth.mjs';
import {eventService} from '../server/events.mjs';
import {jobService} from '../server/jobs.mjs';
import {mediaService} from '../server/media.mjs';

test('JWT billing view derives allowance from an owner-scoped billing RPC',async()=>{
 const owner={id:'owner-a'},periodStart=new Date(Date.now()-86400000).toISOString(),periodEnd=new Date(Date.now()+86400000).toISOString();
 const service=eventService({query:async()=>{throw new Error('billing view should not use direct SQL');}},async()=>{},{getBilling:async user=>{assert.equal(user,owner);return{subscription:{plan:'gathering',status:'active',period_start:periodStart,period_end:periodEnd},used:2,passes:1,orders:[{id:'order-a',plan:'single',amount:1500,status:'paid'}]};}});
 const billing=await service.billingView(owner);
 assert.equal(billing.subscription.plan,'gathering');assert.equal(billing.allowance.limit,4);assert.equal(billing.allowance.used,2);assert.equal(billing.allowance.remaining,2);assert.equal(billing.allowance.available,true);assert.equal(billing.allowance.passes,1);assert.equal(billing.orders[0].id,'order-a');
});

test('event previews use owner and anonymous RPCs without shared SQL',async()=>{
 const user={id:uuid()};let inserted,lookedUp;
 const service=eventService({query:async()=>{throw new Error('event preview must not use direct SQL');}},async()=>{},{createEventPreview:async(owner,eventId,tokenHash)=>{inserted={owner,eventId,tokenHash};return true;},getEventPreview:async(slug,tokenHash)=>{lookedUp={slug,tokenHash};return{id:'event-a',slug,name:'Draft preview',status:'draft',appearance:{title:'Welcome'}};}});
 const secret=await service.createPreview(user,'event-a');
 assert.equal(inserted.owner,user);assert.equal(inserted.eventId,'event-a');assert.match(inserted.tokenHash,/^[a-f0-9]{64}$/);assert.notEqual(inserted.tokenHash,secret);
 const preview=await service.preview('draft-event',secret);
 assert.deepEqual(lookedUp,{slug:'draft-event',tokenHash:inserted.tokenHash});assert.equal(preview.preview,true);assert.equal(preview.name,'Draft preview');
});

test('production billing mutations use owner RPCs and never shared SQL',async()=>{
 const before={...process.env},user={id:uuid(),email:'billing@example.test'},calls=[],stripeCalls=[];
 Object.assign(process.env,{PLATFORM_STRIPE_SECRET:'sk_test_fixture',PLATFORM_STRIPE_PRICE_GATHERING:'price_gathering_fixture'});
 const db={query(){throw new Error('production billing must not use direct SQL');},transaction(){throw new Error('production billing must not use transactions on shared SQL');}};
 const auth={
  async createOwnOrder(owner,id,plan){calls.push(['create',owner,id,plan]);return{id,plan,amount:3000,provider_id:null,provider_customer:'cus_fixture'};},
  async setOwnOrderProvider(owner,id,provider){calls.push(['provider',owner,id,provider]);return true;},
  async getOwnSubscriptionPaymentDetails(owner){calls.push(['details',owner]);return{provider_id:'sub_fixture',provider_customer:'cus_fixture',period_end:'2026-10-01T00:00:00.000Z'};},
  async cancelOwnSubscription(owner){calls.push(['cancel',owner]);return{provider_id:'sub_fixture'};}
 };
 const fetcher=async(url,options)=>{stripeCalls.push({url,options});return Response.json(url.includes('/checkout/sessions')?{id:'cs_fixture',url:'https://checkout.example.test/session'}:url.includes('/billing_portal/sessions')?{url:'https://portal.example.test/session'}:{ok:true});};
 try{
  const billing=billingService(db,{local:false,origin:'https://lumiq.example.test',fetcher,auth});
  const checkout=await billing.checkout(user,{plan:'gathering'});assert.equal(checkout.url,'https://checkout.example.test/session');
  assert.equal(calls[0][0],'create');assert.equal(calls[0][1],user);assert.equal(calls[1][0],'provider');assert.equal(calls[1][1],user);
  assert.equal(stripeCalls[0].options.headers['Idempotency-Key'],calls[0][2]);
  assert.deepEqual(await billing.cancel(user),{ok:true});assert.equal(calls.some(call=>call[0]==='cancel'&&call[1]===user),true);
  assert.equal((await billing.portal(user)).url,'https://portal.example.test/session');
  assert.equal(stripeCalls.length,3);
 }finally{for(const key of ['PLATFORM_STRIPE_SECRET','PLATFORM_STRIPE_PRICE_GATHERING']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});

test('production Stripe webhooks normalize provider state before the restricted payment RPC',async()=>{
 const before={...process.env},owner=uuid(),calls=[],stripeCalls=[];
 Object.assign(process.env,{PLATFORM_STRIPE_SECRET:'sk_test_fixture',PLATFORM_STRIPE_PRICE_GATHERING:'price_gathering_fixture'});
 const db={async query(sql,args){calls.push({sql,args});if(sql.includes('resolve_billing_owner'))return{rows:[{owner}]};if(sql.includes('get_billing_subscription_id'))return{rows:[{provider_id:'sub_fixture'}]};if(sql.includes('apply_provider_payment_event'))return{rows:[{result:{ok:true}}]};if(sql.includes('reconcile_provider_subscription_state'))return{rows:[{saved:true}]};throw new Error('Webhook path attempted direct table SQL.');},transaction(){throw new Error('Webhook path must not open a shared SQL transaction.');}};
 const fetcher=async(url,options)=>{stripeCalls.push(url);return Response.json({id:'sub_fixture',customer:'cus_fixture',metadata:{account_id:owner},status:'active',cancel_at_period_end:false,items:{data:[{quantity:1,price:{id:'price_gathering_fixture'},current_period_start:1800000000,current_period_end:1802592000}]}});};
 try{
  const billing=billingService(db,{local:false,systemRpc:true,origin:'https://lumiq.example.test',fetcher});
  assert.deepEqual(await billing.apply({id:'evt_invoice_fixture',created:1800000001,type:'invoice.paid',data:{object:{subscription:'sub_fixture'}}}),{ok:true});
  const value=calls.at(-1).args[0],payload=typeof value==='string'?JSON.parse(value):value;
  assert.deepEqual(payload,{id:'evt_invoice_fixture',created:1800000001,type:'invoice.paid',owner_id:owner,order_id:null,checkout_id:null,subscription_id:'sub_fixture',payment_status:null,amount_total:null,currency:null,mode:null,plan:'gathering',subscription_status:'active',period_start:new Date(1800000000*1000).toISOString(),period_end:new Date(1802592000*1000).toISOString(),cancel_at_end:false,customer_id:'cus_fixture',provider_updated_at:1800000001});
  assert.equal(calls.some(call=>call.sql.includes('from subscriptions')||call.sql.includes('insert into payment_events')),false);assert.equal(stripeCalls.length,1);
  assert.deepEqual(await billing.reconcile(owner),{ok:true});assert.equal(calls.at(-2).sql.includes('get_billing_subscription_id'),true);assert.equal(calls.at(-1).sql.includes('reconcile_provider_subscription_state'),true);assert.equal(stripeCalls.length,2);
 }finally{for(const key of ['PLATFORM_STRIPE_SECRET','PLATFORM_STRIPE_PRICE_GATHERING']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});

test('production organizer event creation uses the JWT RPC and never shared SQL',async()=>{
 const owner={id:uuid()},created=[];
 const service=eventService({query:async()=>{throw new Error('event creation must not use shared SQL');}},async()=>{},{createEvent:async(user,event)=>{assert.equal(user,owner);created.push(event);return{...event,owner_id:user.id,status:'draft',entitlement:{id:'studio'},retention_at:event.ends_at};}});
 const saved=await service.save(owner,{name:'JWT gathering',description:'Draft',start:'2026-09-28T10:00',end:'2026-09-28T11:00',time_zone:'UTC',title:'Welcome',buttonColor:'#123456'});
 assert.equal(created.length,1);assert.equal(created[0].name,'JWT gathering');assert.match(created[0].slug,/^[a-f0-9]{32}$/);assert.equal(created[0].appearance.title,'Welcome');assert.equal(created[0].appearance.buttonColor,'#123456');assert.equal(saved.owner_id,owner.id);
});

test('production organizer event updates use owner RPC without shared SQL',async()=>{
 const owner={id:uuid()},existing={id:'event-a',owner_id:owner.id,name:'Old gathering',description:'',starts_at:'2026-09-28T10:00:00.000Z',ends_at:'2026-09-28T11:00:00.000Z',time_zone:'UTC',status:'draft',appearance:{title:'Old gathering'},entitlement:{durationDays:3,retentionDays:30},retention_at:'2026-10-28T11:00:00.000Z'};let payload;
 const service=eventService({query:async()=>{throw new Error('event update must not use shared SQL');}},async()=>{},{getEvent:async(user,id)=>{assert.equal(user,owner);assert.equal(id,existing.id);return existing;},updateEvent:async(user,event)=>{assert.equal(user,owner);payload=event;return{...existing,...event,owner_id:user.id};}});
 const updated=await service.save(owner,{name:'New gathering',title:'New title'},existing.id);
 assert.equal(updated.name,'New gathering');assert.equal(payload.starts_at,null);assert.equal(payload.ends_at,null);assert.equal(payload.time_zone,null);assert.equal(payload.appearance.title,'New title');assert.equal(payload.usePreset,false);
});

test('production organizer event actions use owner RPC without shared SQL',async()=>{
 const owner={id:uuid()};let actionCall;
 const service=eventService({query:async()=>{throw new Error('event actions must not use shared SQL');}},async()=>{},{eventAction:async(user,id,input)=>{actionCall={user,id,input};return{ok:true};}});
 assert.deepEqual(await service.action(owner,'event-a',{action:'archive'}),{ok:true});
 assert.deepEqual(actionCall,{user:owner,id:'event-a',input:{action:'archive'}});
});

test('QR layout persistence uses the JWT RPC when configured',async()=>{
 const owner={id:uuid()},saved={template:'vintage',font:'playfair-display',titleSize:80,textX:.5,textY:.15,qrX:.5,qrY:.57,qrScale:1};let received;
 const service=eventService({query:async()=>{throw new Error('QR layout persistence must not use shared SQL');}},async()=>{},{saveQrLayout:async(user,id,layout)=>{received={user,id,layout};return saved;}});
 assert.deepEqual(await service.saveQrLayout(owner,'event-a',saved),saved);assert.deepEqual(received,{user:owner,id:'event-a',layout:saved});
});

test('Supabase event update/action/QR/design-asset RPCs send only scoped fields with the verified JWT',async()=>{
 const db=await openDatabase({memory:true}),before={...process.env},id=uuid(),authUser={id,email:'rpc@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'RPC User'}};let call,actionCall,qrCall,reserveCall,attachCall,coverCall,guestJoinCall,guestIdentityCall,sealedSession;
 try{
  Object.assign(process.env,{PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture',PLATFORM_SESSION_ENCRYPTION_KEY:'13'.repeat(32)});
  await db.query('insert into accounts(id,email,name,verified) values($1,$2,$3,true)',[id,authUser.email,'RPC User']);
  const service=supabaseAuthService(db,{origin:'https://staging.example.test',mail:async()=>{},fetcher:async(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/auth/v1/token'))return Response.json({user:authUser,access_token:'event-update-jwt',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600});if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json(authUser);if(parsed.pathname.endsWith('/rest/v1/rpc/create_own_app_session')){sealedSession=JSON.parse(options.body).p_provider_session;return Response.json(true);}if(parsed.pathname.endsWith('/rest/v1/rpc/get_app_session'))return Response.json({account_id:id,provider_session:sealedSession,expires_at:new Date(Date.now()+3600000).toISOString()});if(parsed.pathname.endsWith('/rest/v1/rpc/delete_app_session'))return Response.json(true);if(parsed.pathname.endsWith('/rest/v1/rpc/sync_own_account'))return Response.json([{account_id:id,email:authUser.email,name:'RPC User',role:'customer',preferences:{},profile:{},design_defaults:{}}]);if(parsed.pathname.endsWith('/rest/v1/rpc/update_own_event')){call={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({id:'event-a',owner_id:id,name:'Updated',status:'draft',appearance:{}});}if(parsed.pathname.endsWith('/rest/v1/rpc/act_on_own_event')){actionCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({ok:true});}if(parsed.pathname.endsWith('/rest/v1/rpc/save_own_qr_layout')){qrCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json(qrCall.args.p_layout);}if(parsed.pathname.endsWith('/rest/v1/rpc/reserve_own_design_asset')){reserveCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({reservation_id:'reservation-a',object_key:'owner/events/gathering-a/cover-a.webp'});}if(parsed.pathname.endsWith('/rest/v1/rpc/attach_own_design_asset')){attachCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({ok:true});}if(parsed.pathname.endsWith('/rest/v1/rpc/get_event_cover_asset')){coverCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json('owner/events/gathering-a/cover.webp');}if(parsed.pathname.endsWith('/rest/v1/rpc/join_public_event')){guestJoinCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({id:guestJoinCall.args.p_guest_id,name:guestJoinCall.args.p_name});}if(parsed.pathname.endsWith('/rest/v1/rpc/get_public_guest_identity')){guestIdentityCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json({id:'guest-a',event_id:'event-a',name:'Guest',storage_prefix:'owner/events/gathering-a'});}throw new Error(`Unexpected test request: ${parsed.pathname}`);}});
  const login=await service.login({email:authUser.email,password:'Test-password-123!'}),signedIn=await service.user(new Request('https://staging.example.test',{headers:{Cookie:login.cookie.split(';')[0]}}));
  const result=await service.updateEvent(signedIn,{id:'event-a',name:'Updated',description:'',starts_at:null,ends_at:null,time_zone:null,appearance:{title:'Updated'},usePreset:false});
  assert.equal(result.owner_id,id);assert.equal(call.authorization,'Bearer event-update-jwt');assert.equal(call.args.p_event_id,'event-a');assert.equal(call.args.p_use_preset,false);assert.equal(call.args.owner_id,undefined);
  assert.deepEqual(await service.eventAction(signedIn,'event-a',{action:'archive'}),{ok:true});assert.equal(actionCall.authorization,'Bearer event-update-jwt');assert.deepEqual(actionCall.args,{p_event_id:'event-a',p_action:'archive',p_funding:'plan',p_confirm:null,p_enabled:null,p_days:null});
  const layout={template:'modern',font:'roboto',titleSize:76,textX:.5,textY:.15,qrX:.5,qrY:.57,qrScale:1};assert.deepEqual(await service.saveQrLayout(signedIn,'event-a',layout),layout);assert.equal(qrCall.authorization,'Bearer event-update-jwt');assert.deepEqual(qrCall.args,{p_event_id:'event-a',p_layout:layout});
  const reservation=await service.reserveDesignAsset(signedIn,'event-a','cover');assert.deepEqual(reservation,{reservationId:'reservation-a',key:'owner/events/gathering-a/cover-a.webp'});assert.equal(reserveCall.authorization,'Bearer event-update-jwt');
  assert.deepEqual(await service.attachDesignAsset(signedIn,'event-a','cover',reservation.key,reservation.reservationId),{ok:true});assert.equal(attachCall.authorization,'Bearer event-update-jwt');assert.deepEqual(attachCall.args,{p_event_id:'event-a',p_asset_type:'cover',p_object_key:reservation.key,p_reservation_id:reservation.reservationId});
  assert.equal(await service.getCoverAsset(signedIn,'event-a',{camera:true}), 'owner/events/gathering-a/cover.webp');assert.equal(coverCall.authorization,'Bearer event-update-jwt');assert.deepEqual(coverCall.args,{p_event_id:'event-a',p_camera:true,p_source:false});
  assert.equal(await service.getCoverAsset(null,'event-a'), 'owner/events/gathering-a/cover.webp');assert.equal(coverCall.authorization,undefined);assert.deepEqual(coverCall.args,{p_event_id:'event-a',p_camera:false,p_source:false});
  const publicGuest=await service.joinPublicEvent('event-a',{id:'guest-a',name:'Guest',tokenHash:'a'.repeat(64)});assert.deepEqual(publicGuest,{id:'guest-a',name:'Guest'});assert.equal(guestJoinCall.authorization,undefined);assert.deepEqual(guestJoinCall.args,{p_event_id:'event-a',p_guest_id:'guest-a',p_name:'Guest',p_token_hash:'a'.repeat(64)});
  assert.deepEqual(await service.getPublicGuestIdentity('event-a','a'.repeat(64)),{id:'guest-a',event_id:'event-a',name:'Guest',storage_prefix:'owner/events/gathering-a'});assert.equal(guestIdentityCall.authorization,undefined);
 }finally{for(const key of ['PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await db.close();}
});

test('guest photo reservation uses only the anonymous capability RPC',async()=>{
  const db=await openDatabase({memory:true}),before={...process.env},id=uuid(),guest={id:'guest-a',event_id:'event-a',name:'Guest'},photo={id:'photo-a',event_id:guest.event_id,guest_id:guest.id,status:'pending'};let rpcCall,sealedSession;
 try{
  Object.assign(process.env,{PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture',PLATFORM_SESSION_ENCRYPTION_KEY:'15'.repeat(32)});
  const authUser={id,email:'photo-rpc@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Photo RPC'}};
  await db.query('insert into accounts(id,email,name,verified) values($1,$2,$3,true)',[id,authUser.email,'Photo RPC']);
  const service=supabaseAuthService(db,{origin:'https://staging.example.test',mail:async()=>{},fetcher:async(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/auth/v1/token'))return Response.json({user:authUser,access_token:'photo-reservation-jwt',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600});if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json(authUser);if(parsed.pathname.endsWith('/rest/v1/rpc/create_own_app_session')){sealedSession=JSON.parse(options.body).p_provider_session;return Response.json(true);}if(parsed.pathname.endsWith('/rest/v1/rpc/get_app_session'))return Response.json({account_id:id,provider_session:sealedSession,expires_at:new Date(Date.now()+3600000).toISOString()});if(parsed.pathname.endsWith('/rest/v1/rpc/delete_app_session'))return Response.json(true);if(parsed.pathname.endsWith('/rest/v1/rpc/sync_own_account'))return Response.json([{account_id:id,email:authUser.email,name:'Photo RPC',role:'customer',preferences:{},profile:{},design_defaults:{}}]);if(parsed.pathname.endsWith('/rest/v1/rpc/reserve_guest_photo')){rpcCall={args:JSON.parse(options.body),authorization:options.headers.Authorization};return Response.json(photo);}throw new Error(`Unexpected test request: ${parsed.pathname}`);}});
  const login=await service.login({email:authUser.email,password:'Test-password-123!'}),signedIn=await service.user(new Request('https://staging.example.test',{headers:{Cookie:login.cookie.split(';')[0]}}));assert.ok(signedIn);
  const result=await service.reserveGuestPhoto({eventId:guest.event_id,photoId:photo.id,guestId:guest.id,guestTokenHash:'a'.repeat(64),guestFolder:'guest-000001',filenamePrefix:'guest-20260927T123456Z',name:'phone.webp',bytes:1200,thumbnailBytes:300,checksum:'c'.repeat(64),thumbnailChecksum:'d'.repeat(64),capturedAtMs:Date.now()});
  assert.deepEqual(result,photo);assert.equal(rpcCall.authorization,undefined);assert.deepEqual(rpcCall.args,{p_event_id:guest.event_id,p_photo_id:photo.id,p_guest_token_hash:'a'.repeat(64),p_guest_folder:'guest-000001',p_filename_prefix:'guest-20260927T123456Z',p_name:'phone.webp',p_bytes:1200,p_thumbnail_bytes:300,p_checksum:'c'.repeat(64),p_thumbnail_checksum:'d'.repeat(64),p_captured_at_ms:rpcCall.args.p_captured_at_ms});
 }finally{for(const key of ['PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await db.close();}
});

test('production media reservation delegates limits and object keys to the guest RPC',async()=>{
 const event={id:uuid(),status:'published',paused:false,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+60000).toISOString(),retention_at:new Date(Date.now()+86400000).toISOString()},guest={id:uuid(),name:'Guntars Ābols',token_hash:'a'.repeat(64)};let payload;
 const service=mediaService({query:async()=>{throw new Error('production reservation must not issue direct SQL');},transaction:async()=>{throw new Error('production reservation must not open a SQL transaction');}},{}, {},undefined,{reserveGuestPhoto:async value=>{payload=value;return{id:value.photoId,event_id:value.eventId,guest_id:value.guestId,status:'pending'};}});
 const result=await service.reserve(event,guest,{id:uuid(),name:'phone-photo.webp',bytes:1200,thumbnail_bytes:300,checksum:'c'.repeat(64),thumbnail_checksum:'d'.repeat(64),captured_at:Date.now()});
 assert.equal(result.status,'pending');assert.equal(payload.eventId,event.id);assert.equal(payload.guestId,guest.id);assert.equal(payload.guestTokenHash,guest.token_hash);
 assert.equal(payload.guestFolder,`guntars-abols-${guest.id.replaceAll('-','').slice(26)}`);
 assert.match(payload.filenamePrefix,/^guntars-abols-[0-9]{8}T[0-9]{6}Z$/);assert.equal(payload.name,'phone-photo.webp');
});

test('production guest photo upload, finalize and discard use only capability RPCs',async()=>{
 const event={id:uuid(),status:'published',paused:false,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+60000).toISOString(),retention_at:new Date(Date.now()+86400000).toISOString()},guest={id:uuid(),token_hash:'a'.repeat(64)},image=Buffer.from('RIFF1234WEBPphoto'),photo={id:uuid(),event_id:event.id,guest_id:guest.id,status:'pending',object_key:'events/photo.webp',thumbnail_key:'events/thumb.webp',bytes:image.length,thumbnail_bytes:image.length,checksum:hash(image),thumbnail_checksum:hash(image)};let status='pending',discarded=false;const stored=new Map();
 const db={query:async()=>{throw new Error('guest media workflow must not use direct SQL');},transaction:async()=>{throw new Error('guest media workflow must not open a SQL transaction');}};
 const files={put:async(key,bytes)=>stored.set(key,bytes),get:async key=>stored.get(key)};
 const auth={getGuestPhotoUpload:async(eventId,photoId,tokenHash)=>{assert.equal(eventId,event.id);assert.equal(photoId,photo.id);assert.equal(tokenHash,guest.token_hash);return{...photo,status};},finalizeGuestPhoto:async()=>{status='uploaded';return{ok:true};},discardGuestPhoto:async()=>{discarded=true;return{ok:true};}};
 const service=mediaService(db,files,{},async()=>{},auth);
 await service.upload(event,guest,photo.id,'photo',image);await service.upload(event,guest,photo.id,'thumb',image);assert.equal(stored.size,2);
 assert.deepEqual(await service.finalize(event,guest,photo.id),{ok:true});assert.equal(status,'uploaded');
 status='pending';assert.deepEqual(await service.discard(event,guest,photo.id),{ok:true});assert.equal(discarded,true);
});

test('public event lookup uses its narrow guest RPC without shared SQL',async()=>{
 const event={id:uuid(),slug:'party-a',name:'Party',status:'published',paused:false,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+60000).toISOString(),retention_at:new Date(Date.now()+86400000).toISOString(),appearance:{}};let lookedUp;
 const service=eventService({query:async()=>{throw new Error('public event lookup must not use direct SQL');}},async()=>{},{getPublicEvent:async slug=>{lookedUp=slug;return event;}});
 assert.equal((await service.guest('party-a')).id,event.id);assert.equal(lookedUp,'party-a');
});

test('public gallery share counter uses its anonymous RPC without shared SQL',async()=>{
 const event={id:uuid(),status:'published',ends_at:new Date(Date.now()-60000).toISOString(),retention_at:new Date(Date.now()+86400000).toISOString(),share_enabled:true,share_expires:new Date(Date.now()+3600000).toISOString()};let consumed;
 const service=eventService({query:async()=>{throw new Error('public share counter must not use direct SQL');}},async()=>{},{consumePublicGalleryShare:async eventId=>{consumed=eventId;return{ok:true};}});
 await service.share(event);assert.equal(consumed,event.id);
});

test('gallery RPC adapters keep owner JWT and public anonymous requests separate',async()=>{
 const owner={id:'organizer-a'},event={id:uuid(),retention_at:new Date(Date.now()+86400000).toISOString(),time_zone:'UTC'},created=new Date().toISOString(),rows=Array.from({length:25},(_,index)=>({id:uuid(),created_at:new Date(Date.now()-index*1000).toISOString(),guest:'Guest'}));let ownCall,publicCall;
 const database={query:async()=>{throw new Error('production gallery listing must not use direct SQL');}};
 const service=mediaService(database,{}, {},undefined,{listOwnGallery:async(user,eventId,query)=>{ownCall={user,eventId,query};return{photos:rows,total:25,guests:['Guest']};},listPublicGallery:async(eventId,query)=>{publicCall={eventId,query};return{photos:rows,total:25,guests:['Guest']};}});
 const params=new URLSearchParams('sort=oldest&guest=Guest&date=2026-09-27&time_zone=UTC'),own=await service.list(event,params,{owner:true,user:owner}),shared=await service.list(event,params);
 assert.equal(own.photos.length,24);assert.ok(own.next);assert.equal(ownCall.user,owner);assert.equal(ownCall.eventId,event.id);assert.equal(ownCall.query.oldest,true);assert.equal(ownCall.query.guest,'Guest');
 assert.equal(shared.photos.length,24);assert.ok(shared.next);assert.equal(publicCall.eventId,event.id);assert.equal(publicCall.query.date,'2026-09-27');
});

test('photo asset authorization resolves through owner and public capability RPCs',async()=>{
 const owner={id:'organizer-a'},photo=uuid(),media={id:photo,status:'uploaded'},event={id:uuid(),owner_id:owner.id};let ownCall,publicCall;
 const database={query:async()=>{throw new Error('production photo asset access must not use direct SQL');}};
 const service=mediaService(database,{}, {},undefined,{
  getOwnPhotoAsset:async(user,id,thumbnail)=>{ownCall={user,id,thumbnail};return{media,event};},
  getPublicPhotoAsset:async(id,thumbnail)=>{publicCall={id,thumbnail};return{media,event};}
 });
 const own=await service.readyWithEvent(photo,owner,true);
 assert.equal(own.media,media);assert.equal(own.event,event);assert.equal(own.shareCounted,true);
 assert.deepEqual(ownCall,{user:owner,id:photo,thumbnail:true});
 const shared=await service.readyWithEvent(photo,null,false);
 assert.equal(shared.shareCounted,true);assert.deepEqual(publicCall,{id:photo,thumbnail:false});
});

test('configured photo RPC misses fail closed instead of falling through to shared SQL',async()=>{
 const calls=[];const database={query:async sql=>{calls.push(sql);throw new Error('shared SQL fallback must not run');}};
 const service=mediaService(database,{}, {},undefined,{
  getOwnPhotoAsset:async()=>null,
  getPublicPhotoAsset:async()=>null,
  getGuestPhotoUpload:async()=>null
 });
 await assert.rejects(service.readyWithEvent(uuid(),{id:'organizer-a'}),error=>error.status===404);
 await assert.rejects(service.ready(uuid()),error=>error.status===503);
 assert.deepEqual(calls,[]);
});

test('organizer gallery curation and deletion use only the owner JWT RPC',async()=>{
 const user={id:'organizer-a'},event={id:uuid()},ids=[uuid(),uuid()],calls=[];
 const database={query:async()=>{throw new Error('production gallery mutations must not use direct SQL');},transaction:async()=>{throw new Error('production gallery mutations must not open SQL transactions');}};
 const service=mediaService(database,{}, {},undefined,{curateOwnGallery:async(...args)=>{calls.push(args);return{ok:true};}});
 assert.deepEqual(await service.curate(user,event,{ids,action:'hide'}),{ok:true});
 assert.deepEqual(await service.remove(user,event,ids),{ok:true});
 assert.deepEqual(calls,[[user,event.id,ids,'hide'],[user,event.id,ids,'delete']]);
});

test('organizer export retries delegate to the owner JWT RPC',async()=>{
 const user={id:'organizer-a'},id=uuid();let call;
 const service=jobService({query:async()=>{throw new Error('production export retry must not use direct SQL');},transaction:async()=>{throw new Error('production export retry must not open SQL transactions');}},{},async()=>{},{retryOwnExport:async(...args)=>{call=args;return{ok:true};}});
 assert.deepEqual(await service.retry(user,id),{ok:true});assert.deepEqual(call,[user,id]);
});

test('production queue dispatch and recovery use only internal RPCs',async()=>{
 const first=uuid(),second=uuid();let requested=0,batches=[],resetIds=null;
 const db={query:async()=>{throw new Error('production queue dispatch must not use direct SQL');},transaction:async()=>{throw new Error('production queue dispatch must not open direct SQL transactions');}};
 const service=jobService(db,{},async()=>{}, {claimPlatformQueueBatch:async limit=>{requested=limit;return[first,second];},resetPlatformQueueDispatch:async ids=>{resetIds=ids;return ids.length;}});
 const result=await service.dispatch({sendBatch:async entries=>{batches=entries;}} ,{limit:2});
 assert.deepEqual(result,{dispatched:2});assert.equal(requested,2);assert.deepEqual(batches.map(item=>item.body.jobId),[first,second]);
 await assert.rejects(service.dispatch({sendBatch:async()=>{throw new Error('queue unavailable');}},{limit:2}),/queue unavailable/);
 assert.deepEqual(resetIds,[first,second]);
});

test('production export snapshotting uses the restricted internal RPC',async()=>{
 const id=uuid(),ids=[uuid(),uuid()];let prepared;
 const db={query:async()=>{throw new Error('production export snapshot must not use direct SQL');},transaction:async()=>{throw new Error('production export snapshot must not open direct SQL transactions');}};
 let claimed=false;
 const service=jobService(db,{},async()=>{}, {recoverStalePlatformJobs:async()=>0,claimPlatformJob:async()=>{if(claimed)return null;claimed=true;return{id,type:'export',payload:{ids}};},preparePlatformExport:async jobId=>{prepared=jobId;return{count:ids.length,parts:1};}});
 await service.tick({maxJobs:1});assert.equal(prepared,id);
});

test('production event cleanup uses only the restricted manifest and finalization RPCs',async()=>{
 const id=uuid(),removed=[];let settled;
 const job={id,type:'retention-cleanup',event_id:uuid(),attempts:1};
 const db={query:async()=>{throw new Error('production cleanup must not use direct SQL');},transaction:async()=>{throw new Error('production cleanup must not open direct SQL transactions');}};
 let claimed=false;
 const files={remove:async key=>removed.push(key)};
 const auth={
  recoverStalePlatformJobs:async()=>0,
  claimPlatformJob:async()=>{if(claimed)return null;claimed=true;return job;},
  getPlatformCleanupManifest:async()=>({photos:[{object_key:'event/photo.webp',thumbnail_key:'event/thumb.webp'}],cover_keys:['event/cover.webp'],exports:[{result:{parts:[{key:'event/export.zip'}]}}]}),
  canDeletePlatformAsset:async()=>true,
  finalizePlatformEventCleanup:async(jobId,count)=>({removed:jobId===id?count:0}),
  settlePlatformJob:async(jobId,outcome,details)=>{settled={jobId,outcome,details};}
 };
 job.id=id;
 const service=jobService(db,files,async()=>{},auth);
 await service.tick({maxJobs:1});
 assert.deepEqual(removed,['event/photo.webp','event/thumb.webp','event/cover.webp','event/export.zip']);
 assert.equal(settled.jobId,id);assert.equal(settled.outcome,'ready');assert.deepEqual(settled.details.result,{removed:1});
});

test('targeted retention drills delegate event transitions to restricted RPCs',async()=>{
 const eventId=uuid(),calls=[];
 const db={query:async()=>{throw new Error('production retention drill must not use direct SQL');},transaction:async()=>{throw new Error('production retention drill must not open direct SQL transactions');}};
 const service=jobService(db,{},async()=>{}, {preparePlatformEventEnd:async id=>{calls.push(['prepare',id]);return{prepared:true,job_id:uuid()};},expirePlatformEvent:async id=>{calls.push(['expire',id]);return{expired:true,job_id:uuid()};}});
 assert.equal((await service.retention({eventId,phase:'event-end'})).prepared,true);
 assert.equal((await service.retention({eventId,phase:'expiry'})).expired,true);
 assert.deepEqual(calls.map(item=>item[0]),['prepare','expire']);assert.ok(calls.every(item=>item[1]===eventId));
});

test('recovery, paging, quotas and request boundaries',async t=>{
 const db=await openDatabase({memory:true}),root=await mkdtemp(path.join(os.tmpdir(),'gf-recovery-'));
 const app=await createApp({db,files:storage({root})}),owner={id:uuid(),name:'Tester',email:'tester@example.test'};
 await db.query('insert into accounts(id,name,email,verified) values($1,$2,$3,true)',[owner.id,owner.name,owner.email]);
 await db.query("insert into subscriptions(account_id,plan,status) values($1,'studio','active')",[owner.id]);
 const draft=await app.events.save(owner,{name:'Recovery event',start:new Date(Date.now()-3600000).toISOString().slice(0,16),end:new Date(Date.now()+3600000).toISOString().slice(0,16),time_zone:'UTC'});
 await app.events.action(owner,draft.id,{action:'publish'});
 let e=await app.events.own(owner,draft.id);
 const guest=await app.events.join(e,{name:'Same name'}),g=await app.events.guestIdentity(e,guest.token);
 const image=await sharp({create:{width:32,height:24,channels:3,background:'#267f62'}}).webp().toBuffer();
 const reserve=()=>app.media.reserve(e,g,{id:uuid(),name:'photo.webp',bytes:image.length,thumbnail_bytes:image.length,checksum:hash(image),thumbnail_checksum:hash(image)});
 let media;
 try{
  await t.test('method confusion and invalid JSON never mutate state',async()=>{
   assert.equal((await app.handle(new Request(app.origin+'/api/auth/logout'))).status,405);
   assert.equal((await app.handle(new Request(app.origin+'/api/auth/login',{method:'POST',headers:{Origin:app.origin},body:'{broken'}))).status,400);
   assert.equal((await app.handle(new Request(app.origin+'/api/events/not-an-id'))).status,404);
  });
  await t.test('server quota, forged files and stale live-state are rejected',async()=>{
   await assert.rejects(app.media.reserve(e,g,{id:uuid(),name:'big',bytes:6291457,thumbnail_bytes:1}),/6 MB/);
   media=await reserve();
   await assert.rejects(app.media.upload(e,g,media.id,'photo',Buffer.from('not an image')),/changed/);
   await app.events.action(owner,e.id,{action:'pause'});
   await assert.rejects(reserve(),/closed/);
   await app.events.action(owner,e.id,{action:'resume'});
   await db.query("update events set entitlement=jsonb_set(entitlement,'{photos}','1') where id=$1",[e.id]);
   await assert.rejects(reserve(),/allowance/);
   await db.query("update events set entitlement=jsonb_set(entitlement,'{photos}','1000') where id=$1",[e.id]);
  });
  await t.test('twenty-five paired photos paginate without originals in grid metadata',async()=>{
   for(let i=0;i<25;i++){
    const m=i===0?media:await reserve();
    await app.media.upload(e,g,m.id,'photo',image);await app.media.upload(e,g,m.id,'thumb',image);await app.media.finalize(e,g,m.id);
   }
   const page=await app.media.list(e,new URLSearchParams()),second=await app.media.list(e,new URLSearchParams({cursor:page.next}));
   assert.equal(page.photos.length,24);assert.equal(second.photos.length,1);assert.equal(new Set([...page.photos,...second.photos].map(p=>p.id)).size,25);
   assert.equal(page.photos[0].object_key,undefined);
  });
  await t.test('Studio maximum gallery and split ZIP export cover exactly one thousand photos',async t=>{
   const draft=await app.events.save(owner,{name:'ZIP capacity event',start:new Date(Date.now()-3600000).toISOString().slice(0,16),end:new Date(Date.now()+3600000).toISOString().slice(0,16),time_zone:'UTC'});await app.events.action(owner,draft.id,{action:'publish'});let capacityEvent=await app.events.own(owner,draft.id);const capacityGuest=await app.events.join(capacityEvent,{name:'Capacity Guest'}),capacityIdentity=await app.events.guestIdentity(capacityEvent,capacityGuest.token);
   const exportPhoto=Buffer.alloc(70*1024,0x5a);for(let n=1;n<=1000;n++)await app.files.put(`load/photo-${n}.webp`,exportPhoto);
   await db.query(`insert into media(id,event_id,guest_id,object_key,thumbnail_key,name,bytes,thumbnail_bytes,checksum,thumbnail_checksum,status,created_at)
    select gen_random_uuid(),$1,$2,'load/photo-'||n||'.webp','load/thumb-'||n||'.webp','load-'||n||'.webp',${exportPhoto.length},128,repeat('a',64),repeat('b',64),'uploaded',now()-(n*interval '1 millisecond')
    from generate_series(1,1000) n`,[capacityEvent.id,capacityIdentity.id]);
   const ids=new Set();let cursor=null,pages=0;do{const params=new URLSearchParams();if(cursor)params.set('cursor',cursor);const page=await app.media.list(capacityEvent,params);page.photos.forEach(photo=>ids.add(photo.id));cursor=page.next;pages++;}while(cursor);
   assert.equal(ids.size,1000);assert.equal(pages,42);
   await db.query("update events set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id=$1",[capacityEvent.id]);capacityEvent=await app.events.own(owner,capacityEvent.id);
   const putStream=app.files.putStream.bind(app.files);let maxBufferedBytes=0;
   app.files.putStream=async(key,stream,type,options)=>{if(!key.startsWith('exports/'))return putStream(key,stream,type,options);const slow=(async function*(){for await(const chunk of stream){await new Promise(resolve=>setTimeout(resolve,5));maxBufferedBytes=Math.max(maxBufferedBytes,stream.readableLength+stream.writableLength);yield chunk;}})();return putStream(key,slow,type,options);};
   const started=performance.now();await app.jobs.retention();let job=(await db.query("select * from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[capacityEvent.id])).rows[0];assert(job);await app.jobs.tick();
   const done=(await db.query('select * from jobs where id=$1',[job.id])).rows[0];assert.equal(done.status,'ready');assert.equal(done.result.count,1000);assert.equal(done.result.parts.length,2);
   const exported=[];for(const part of done.result.parts){const files=unzipSync(await app.files.get(part.key));assert.equal(Object.keys(files).filter(k=>k.endsWith('.webp')).length,part.count);exported.push(...JSON.parse(new TextDecoder().decode(files['manifest.json'])));}
   assert.equal(exported.length,1000);assert.equal(new Set(exported.map(item=>item.id)).size,1000);assert.deepEqual(new Set(exported.map(item=>item.id)),ids);
   assert(maxBufferedBytes<=2*1024*1024,`ZIP stream buffered ${maxBufferedBytes} bytes behind the slow consumer`);
   t.diagnostic(`1,000-photo ZIP: ${done.result.parts.length} parts, ${done.result.parts.reduce((sum,part)=>sum+part.bytes,0)} bytes, ${(performance.now()-started).toFixed(0)} ms; max queued stream data ${maxBufferedBytes} bytes.`);
   const childRows=(await db.query("select * from jobs where type='export-part' and payload->>'parent_id'=$1 order by (payload->>'part_index')::int",[job.id])).rows;
   assert.equal(childRows.length,2);const firstPartKey=childRows[0].result.key,secondPartKey=childRows[1].result.key;
   await app.files.remove(secondPartKey);
   await db.query("update jobs set status='failed',result='{}',error='simulated part failure' where id=$1",[childRows[1].id]);
   await db.query("update jobs set status='failed' where id=$1",[job.id]);
   const retryPutStream=app.files.putStream.bind(app.files),retryPartWrites=new Map();
   app.files.putStream=async(key,...args)=>{if(key.includes(job.id))retryPartWrites.set(key,(retryPartWrites.get(key)||0)+1);return retryPutStream(key,...args);};
   await app.jobs.retry(owner,job.id);await app.jobs.tick();job=(await db.query("select * from jobs where id=$1",[job.id])).rows[0];
   assert.equal(job.status,'ready');assert.equal(job.result.parts.length,2);assert.equal(job.result.parts[0].key,firstPartKey);assert.equal(job.result.parts[1].key,secondPartKey);
   assert.equal(retryPartWrites.has(firstPartKey),false,'A ready export part should not be regenerated when another part is retried.');
   assert.equal(retryPartWrites.get(secondPartKey),1,'Only the failed automatic archive part is rewritten.');
   await db.query("delete from media where event_id=$1 and object_key like 'load/%'",[capacityEvent.id]);
   for(let n=1;n<=1000;n++)await app.files.remove(`load/photo-${n}.webp`);
  });
  await t.test('read-only missing-thumbnail report and repair job',async()=>{
   await app.files.remove(media.thumbnail_key);
   const report=await app.jobs.inspect(e.id);assert.equal(report.issues.length,1);assert.equal(report.issues[0].variant,'thumbnail');
   const job=await app.jobs.queue(owner.id,e.id,'thumbnail-repair',{id:media.id});await app.jobs.tick();
   assert.equal((await db.query('select status from jobs where id=$1',[job.id])).rows[0].status,'ready');
   assert.equal((await app.jobs.inspect(e.id)).issues.length,0);
  });
  await t.test('discard expires reserved URLs before durable deletion',async()=>{
   const m=await reserve();await app.media.upload(e,g,m.id,'photo',image);
   await app.media.discard(e,g,m.id);assert.equal((await app.media.ready(m.id)).status,'deleted');
   await db.query("update jobs set available_at=now() where type='media-cleanup'");await app.jobs.tick();
   await assert.rejects(app.files.get(m.object_key));
  });
  await t.test('date filters follow the viewer timezone without displaying a zone selector',async()=>{
   const previous=(await app.media.ready(media.id)).created_at;
   await db.query("update media set created_at='2026-09-01T01:00:00Z' where id=$1",[media.id]);
   const ny=await app.media.list(e,new URLSearchParams({date:'2026-08-31',time_zone:'America/New_York'}));
   const riga=await app.media.list(e,new URLSearchParams({date:'2026-09-01',time_zone:'Europe/Riga'}));
   assert.equal(ny.total,1);assert.equal(riga.total,1);assert.equal(ny.photos[0].id,riga.photos[0].id);
   await assert.rejects(app.media.list(e,new URLSearchParams({time_zone:'not-a-zone'})),/valid date/);
   await db.query('update media set created_at=$1 where id=$2',[previous,media.id]);
  });
  await t.test('abandoned pending uploads expire and their partial objects are cleaned',async()=>{
   const m=await reserve();await app.media.upload(e,g,m.id,'photo',image);
   await db.query("update media set created_at=now()-interval '25 hours' where id=$1",[m.id]);
   await app.jobs.retention();assert.equal((await app.media.ready(m.id)).status,'deleted');
   await app.jobs.tick();await assert.rejects(app.files.get(m.object_key));
  });
  await t.test('export snapshot includes every page exactly once after a simulated worker crash',async()=>{
   await db.query("update media set deleted_at=now()-interval '2 hours' where event_id=$1 and status='deleted'",[e.id]);
   await db.query("update events set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id=$1",[e.id]);e=await app.events.own(owner,e.id);
   await app.jobs.retention();const job=(await db.query("select * from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows[0];assert(job);
   await db.query("update jobs set status='processing',lease_until=now()-interval '1 minute' where id=$1",[job.id]);await app.jobs.tick();
   const done=(await db.query('select * from jobs where id=$1',[job.id])).rows[0];assert.equal(done.result.count,25);
   const files=unzipSync(await app.files.get(done.result.parts[0].key));assert.equal(Object.keys(files).filter(k=>k.endsWith('.webp')).length,25);
   const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));assert.equal(new Set(manifest.map(p=>p.id)).size,25);
   await app.jobs.retention();assert.equal((await db.query("select count(*)::int as n from jobs where event_id=$1 and type='export' and payload->>'automatic'='true'",[e.id])).rows[0].n,1);
  });
  await t.test('sharing expiry, quota, archive and restore do not reveal photos',async()=>{
   await app.events.action(owner,e.id,{action:'share',enabled:true,days:7});
   await db.query('update events set share_limit=1 where id=$1',[e.id]);e=await app.events.own(owner,e.id);
   await app.events.share(e);await assert.rejects(app.events.share(e),/allowance/);
   await db.query("update events set share_limit=50,share_expires=now()-interval '1 minute' where id=$1",[e.id]);e=await app.events.own(owner,e.id);await assert.rejects(app.events.share(e),/sharing period/);
   await app.events.action(owner,e.id,{action:'archive'});await assert.rejects(app.events.guest(e.slug),/not found/);
   await app.events.action(owner,e.id,{action:'restore'});e=await app.events.own(owner,e.id);assert.equal(e.status,'published');assert.equal(e.share_enabled,false);
  });
  await t.test('object deletion is retryable after a storage outage',async()=>{
   await app.files.put('temporary/cover.webp',image);const job=await app.jobs.queue(owner.id,e.id,'object-cleanup',{keys:['temporary/cover.webp']});
   const remove=app.files.remove;let failed=false;app.files.remove=async k=>{if(!failed){failed=true;throw new Error('simulated outage');}return remove(k);};
   await app.jobs.tick();assert.equal((await db.query('select status from jobs where id=$1',[job.id])).rows[0].status,'queued');
   await db.query('update jobs set available_at=now() where id=$1',[job.id]);await app.jobs.tick();await assert.rejects(app.files.get('temporary/cover.webp'));
   await app.jobs.retention();
  });
  await t.test('background jobs drain with bounded parallelism',async()=>{
   const queue=[],fakeDb={
    async query(sql,values=[]){
     if(sql.startsWith('insert into jobs')){queue.push({id:values[0],owner_id:values[1],event_id:values[2],type:values[3],payload:values[4],status:'queued',attempts:0});return{rows:[]};}
     if(sql.startsWith("update jobs set status='queued'"))return{rows:[]};
     if(sql.startsWith("update jobs set status='ready'")){const job=queue.find(item=>item.id===values[1]);job.status='ready';job.result=values[0];return{rows:[]};}
     if(sql.startsWith('select * from accounts'))return{rows:[{id:values[0],email:'queue@example.test',preferences:{}}]};
     throw new Error(`Unexpected job test query: ${sql}`);
    },
    async transaction(run){return run({async query(sql,values=[]){
     if(sql.startsWith("select * from jobs where status='queued'")){const job=queue.find(item=>item.status==='queued');if(job)job.status='processing';return{rows:job?[job]:[]};}
     if(sql.startsWith("update jobs set status='processing'")){const job=queue.find(item=>item.id===values[0]);job.attempts++;return{rows:[]};}
     if(sql.startsWith('select id from accounts'))return{rows:[]};
     if(sql.startsWith('select 1 from events'))return{rows:[]};
     throw new Error(`Unexpected job transaction query: ${sql}`);
    }});}
   };
   let active=0,peak=0;const files={async remove(){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,15));active--;}};
   const service=jobService(fakeDb,files,async()=>{});
   for(let i=0;i<3;i++)await service.queue(uuid(),uuid(),'object-cleanup',{keys:[`queue-${i}`]});
   await service.tick({concurrency:2,maxJobs:3});
   assert.equal(queue.filter(job=>job.status==='ready').length,3);assert.equal(peak,2);
  });
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

test('Stripe adapter uses customer IDs and canonical state for delayed delivery',async()=>{
 const db=await openDatabase({memory:true}),owner=uuid(),before={...process.env};
 try{
  process.env.PLATFORM_STRIPE_SECRET='sk_test_fixture';process.env.PLATFORM_STRIPE_PRICE_GATHERING='price_fixture';
  await db.query('insert into accounts(id,email,name) values($1,$2,$3)',[owner,'billing@example.test','Billing']);
  await db.query("insert into subscriptions(account_id,provider_id,provider_customer) values($1,'sub_fixture','cus_fixture')",[owner]);
  let body;const service=billingService(db,{local:false,origin:'https://staging.example.test',fetcher:async(url,options)=>{
   if(url.endsWith('billing_portal/sessions')){body=String(options.body);return Response.json({url:'https://billing.stripe.com/test'});}
   return Response.json({id:'sub_fixture',customer:'cus_fixture',metadata:{account_id:owner},status:'canceled',cancel_at_period_end:true,items:{data:[{quantity:1,price:{id:'price_fixture'},current_period_start:Math.floor(Date.now()/1000)-86400,current_period_end:Math.floor(Date.now()/1000)+3600}]}});
  }});
  await service.portal({id:owner});assert.match(body,/customer=cus_fixture/);assert.doesNotMatch(body,/customer=sub_/);
  const event={id:'evt_delayed',created:1,type:'invoice.paid',data:{object:{subscription:'sub_fixture'}}};
  await service.apply(event);assert.equal((await db.query('select status from subscriptions where account_id=$1',[owner])).rows[0].status,'ended');
  assert.equal((await service.apply(event)).duplicate,true);
  assert.equal((await service.apply({id:'evt_unrelated',created:2,type:'customer.created'})).ignored,true);
 }finally{for(const key of ['PLATFORM_STRIPE_SECRET','PLATFORM_STRIPE_PRICE_GATHERING']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await db.close();}
});

test('Supabase adapter keeps provider tokens encrypted and out of browser cookies',async()=>{
 const db=await openDatabase({memory:true}),before={...process.env},id=uuid();
 try{
  Object.assign(process.env,{PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture',PLATFORM_SESSION_ENCRYPTION_KEY:'12'.repeat(32)});
  const user={id,email:'auth@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Auth',profile:{first_name:'Anna',last_name:'Test',phone_country:'LV',phone:'',account_type:'personal',company_name:''}}};
  db.sessionRpc=async(name,args)=>{
   if(name==='create_own_app_session'){await db.query("insert into sessions(token_hash,account_id,expires_at,provider_session) values($1,$2,now()+interval '7 days',$3)",[args.p_hash,id,args.p_provider_session]);return true;}
   if(name==='get_app_session')return(await db.query('select account_id,provider_session,expires_at from sessions where token_hash=$1 and expires_at>now()',[args.p_hash])).rows[0]||null;
   if(name==='update_app_session')return(await db.query('update sessions set provider_session=$1 where token_hash=$2 and expires_at>now() returning token_hash',[args.p_provider_session,args.p_hash])).rows.length===1;
   if(name==='delete_app_session')return(await db.query('delete from sessions where token_hash=$1 returning token_hash',[args.p_hash])).rows.length===1;
   if(name==='delete_own_app_sessions'){const rows=await db.query('delete from sessions where account_id=$1 returning token_hash',[id]);return rows.rows.length;}
   throw new Error(`Unexpected session RPC: ${name}`);
  };
  let authUser=user,tokenRequest,signupRequest,signupUrl,resetUrl,recoveryAuthorization,passwordUpdate,emailUpdateUrl,profileUpdate,accountSyncCalls=[],eventListCalls=[],eventReadCalls=[],eventCreateCalls=[],billingCalls=[],verifyCalls=0;const service=supabaseAuthService(db,{origin:'https://staging.example.test',mail:async()=>{},fetcher:async(url,options)=>{const parsed=new URL(url),isUser=parsed.pathname.endsWith('/user');if(parsed.pathname.endsWith('/verify'))verifyCalls++;if(url.includes('/signup?')){signupRequest=JSON.parse(options.body);signupUrl=parsed;}if(url.includes('/recover?'))resetUrl=parsed;if(url.includes('grant_type=pkce'))tokenRequest=JSON.parse(options.body);if(parsed.pathname.endsWith('/rest/v1/rpc/create_own_event')){const args=JSON.parse(options.body);eventCreateCalls.push({args,headers:options.headers});return Response.json({id:args.p_event_id,owner_id:id,slug:args.p_slug,name:args.p_name,status:'draft',appearance:args.p_appearance,entitlement:{},retention_at:args.p_ends_at});}if(parsed.pathname.endsWith('/rest/v1/rpc/get_own_event')){eventReadCalls.push({body:JSON.parse(options.body),headers:options.headers});return Response.json({id:'event-owner',slug:'owner-event',owner_id:id,name:'Owner event',status:'draft',appearance:{},entitlement:{},published_before:true});}if(parsed.pathname.endsWith('/rest/v1/rpc/get_own_billing')){billingCalls.push({body:JSON.parse(options.body),headers:options.headers});return Response.json({subscription:{plan:'trial',status:'trialing',period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z'},orders:[],used:1,passes:0});}if(parsed.pathname.endsWith('/rest/v1/rpc/list_own_events')){eventListCalls.push({body:JSON.parse(options.body),headers:options.headers});return Response.json([{id:'event-owner',slug:'owner-event',owner_id:id,name:'Owner event',status:'draft',appearance:{},entitlement:{},photo_count:3,bytes:1200}]);}if(parsed.pathname.endsWith('/rest/v1/rpc/sync_own_account')){const args=JSON.parse(options.body),preferences={service:true,marketing:args.p_marketing,locale:args.p_locale};accountSyncCalls.push({args,headers:options.headers});await db.query('insert into accounts(id,email,name,verified,preferences,profile) values($1,$2,$3,true,$4,$5) on conflict(id) do update set email=excluded.email,verified=true,name=excluded.name,preferences=excluded.preferences,profile=excluded.profile',[id,authUser.email,args.p_name,preferences,args.p_profile]);await db.query('insert into subscriptions(account_id) values($1) on conflict do nothing',[id]);return Response.json([{account_id:id,email:authUser.email,name:args.p_name,role:'customer',preferences,profile:args.p_profile,design_defaults:{}}]);}if(isUser&&options.method==='PUT'){const body=JSON.parse(options.body);if(body.password){recoveryAuthorization=options.headers.Authorization;passwordUpdate=body.password;}if(body.data){profileUpdate=body.data;authUser={...authUser,user_metadata:{...authUser.user_metadata,...body.data}};}if(body.email)emailUpdateUrl=parsed;return Response.json({...authUser,...(body.email?{email:authUser.email}:{})});}if(isUser&&options.headers.Authorization?.includes('recovery-access-fixture'))recoveryAuthorization=options.headers.Authorization;return Response.json(isUser?authUser:{user:authUser,access_token:'private-access-fixture',refresh_token:'private-refresh-fixture',expires_at:Math.floor(Date.now()/1000)+3600});}});
  await service.register({first_name:'Anna',last_name:'Test',phone_country:'LV',phone:'',account_type:'personal',email:user.email,password:'Test-password-123!'});
  assert.equal(signupUrl.searchParams.get('redirect_to'),'https://staging.example.test/auth/verify');
  await service.requestReset({email:user.email});assert.equal(resetUrl.searchParams.get('redirect_to'),'https://staging.example.test/auth/reset');
  assert.equal(signupRequest.data.name,'Anna Test');assert.equal(signupRequest.data.profile.first_name,'Anna');
  const confirmed=await service.consume({access_token:'confirmed-access-fixture',refresh_token:'confirmed-refresh-fixture',expires_in:'3600',type:'signup',purpose:'verify'});
  assert.match(confirmed.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.doesNotMatch(JSON.stringify(confirmed),/confirmed-access|confirmed-refresh/);
  await assert.rejects(service.consume({access_token:'confirmed-access-fixture',refresh_token:'confirmed-refresh-fixture',type:'recovery',purpose:'verify'}),/invalid/);
  await assert.rejects(service.consume({access_token:'recovery-access-fixture',type:'recovery',purpose:'reset',password:'New-password-123!',password_confirm:'Different-password-456!'}),/Passwords do not match/);
  await assert.rejects(service.consume({token:'recovery-token-hash-fixture',purpose:'reset',password:'New-password-123!',password_confirm:'Different-password-456!'}),/Passwords do not match/);
  assert.equal(verifyCalls,0);assert.equal(passwordUpdate,undefined);
  const hashRecovered=await service.consume({token:'recovery-token-hash-fixture',purpose:'reset',password:'New-password-123!',password_confirm:'New-password-123!'});
  assert.match(hashRecovered.message,/account has been updated/);assert.equal(verifyCalls,1);assert.equal(recoveryAuthorization,'Bearer private-access-fixture');assert.equal(passwordUpdate,'New-password-123!');
  await db.query('insert into sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval \'1 hour\')',['old-session',id]);
  const recovered=await service.consume({access_token:'recovery-access-fixture',type:'recovery',purpose:'reset',password:'New-password-123!',password_confirm:'New-password-123!'});
  assert.match(recovered.message,/password has been updated/);assert.equal(recoveryAuthorization,'Bearer recovery-access-fixture');assert.equal(passwordUpdate,'New-password-123!');assert.equal((await db.query('select 1 from sessions where account_id=$1',[id])).rows.length,0);
  await service.update({id,email:user.email,profile:user.user_metadata.profile},{password:'Test-password-123!',first_name:'Anna',last_name:'Updated',phone_country:'LV',phone:'',account_type:'personal',company_name:'',email:'updated@example.test',marketing:false,locale:'lv'});
  assert.equal(emailUpdateUrl.searchParams.get('redirect_to'),'https://staging.example.test/auth/email');
  assert.equal(profileUpdate.name,'Anna Updated');assert.equal(profileUpdate.profile.last_name,'Updated');assert.equal(profileUpdate.locale,'lv');
  const accountSync=accountSyncCalls.at(-1);assert.equal(accountSync.headers.Authorization,'Bearer private-access-fixture');assert.equal(accountSync.headers.apikey,'fixture');assert.deepEqual(accountSync.args,{p_name:'Anna Updated',p_profile:{first_name:'Anna',last_name:'Updated',phone_country:'LV',phone:'',account_type:'personal',company_name:''},p_locale:'lv',p_marketing:false});
  assert.equal((await db.query('select profile from accounts where id=$1',[id])).rows[0].profile.last_name,'Updated');
  const emailChanged=await service.consume({access_token:'email-change-fixture',type:'email_change',purpose:'email'});assert.match(emailChanged.message,/email has been updated/);
  const start=service.googleStart(),authorize=new URL(start.url),oauthCookie=start.cookie.split(';')[0];assert.equal(authorize.searchParams.get('provider'),'google');assert.equal(authorize.searchParams.get('code_challenge_method'),'s256');assert(authorize.searchParams.get('code_challenge'));assert.doesNotMatch(start.url,/verifier/);assert.match(start.cookie,/HttpOnly; SameSite=Lax; Secure/);
  const state=authorize.searchParams.get('state');await assert.rejects(service.googleCallback(new Request('https://staging.example.test',{headers:{Cookie:oauthCookie}}),new URL(`https://staging.example.test/api/auth/google/callback?state=tampered&code=fixture`)),/invalid/);
  const oauth=await service.googleCallback(new Request('https://staging.example.test',{headers:{Cookie:oauthCookie}}),new URL(`https://staging.example.test/api/auth/google/callback?state=${encodeURIComponent(state)}&code=fixture`));assert(tokenRequest.code_verifier);assert.match(oauth.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.match(oauth.clear,/Max-Age=0/);assert.doesNotMatch(oauth.cookie,/private-access|private-refresh/);
  const login=await service.login({email:user.email,password:'Test-password-123!'});
  assert.match(login.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.doesNotMatch(login.cookie,/private-access|private-refresh/);
  const row=(await db.query('select * from sessions')).rows[0];assert.doesNotMatch(row.provider_session,/private-access|private-refresh/);
  const request=new Request('https://staging.example.test',{headers:{Cookie:login.cookie.split(';')[0]}});
  const signedIn=await service.user(request);assert.equal(signedIn.id,id);assert.equal(signedIn.profile.first_name,'Anna');assert.equal(signedIn.profile.last_name,'Updated');assert.doesNotMatch(JSON.stringify(signedIn),/private-access-fixture/);const ownEvent=await service.getEvent(signedIn,'event-owner');assert.equal(ownEvent.published_before,true);assert.deepEqual(eventReadCalls.at(-1).body,{p_event_id:'event-owner'});assert.equal(eventReadCalls.at(-1).headers.Authorization,'Bearer private-access-fixture');const billing=await service.getBilling(signedIn);assert.equal(billing.used,1);assert.deepEqual(billingCalls.at(-1).body,{});assert.equal(billingCalls.at(-1).headers.Authorization,'Bearer private-access-fixture');const ownEvents=await service.listEvents(signedIn);assert.equal(ownEvents[0].slug,'owner-event');assert.deepEqual(eventListCalls.at(-1).body,{});assert.equal(eventListCalls.at(-1).headers.Authorization,'Bearer private-access-fixture');const created=await service.createEvent(signedIn,{id:'event-new',slug:'new-event',name:'New event',description:'',starts_at:'2026-09-28T10:00:00.000Z',ends_at:'2026-09-28T11:00:00.000Z',time_zone:'UTC',appearance:{title:'New event'}});assert.equal(created.owner_id,id);assert.equal(eventCreateCalls.at(-1).args.p_event_id,'event-new');assert.equal(eventCreateCalls.at(-1).args.owner_id,undefined);assert.equal(eventCreateCalls.at(-1).headers.Authorization,'Bearer private-access-fixture');await service.logout(request);assert.equal(await service.user(request),null);
 }finally{for(const key of ['PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}await db.close();}
});

test('Supabase app sessions use only the narrow PostgREST RPC boundary',async()=>{
 const before={...process.env},id=uuid(),authUser={id,email:'session@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Session User'}};
 Object.assign(process.env,{PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture',PLATFORM_SESSION_ENCRYPTION_KEY:'34'.repeat(32)});
 const paths=[],calls=[];let encryptedSession=null;
 const db={query(){throw new Error('Session adapter must not use direct SQL.');}};
 const service=supabaseAuthService(db,{origin:'https://production-candidate.example.test',mail:async()=>{},fetcher:async(url,options)=>{
  const parsed=new URL(url);paths.push(parsed.pathname);if(parsed.pathname.endsWith('/auth/v1/token'))return Response.json({user:authUser,access_token:'private-access',refresh_token:'private-refresh',expires_at:Math.floor(Date.now()/1000)+3600});
  if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json(authUser);
  if(parsed.pathname.endsWith('/auth/v1/logout'))return Response.json({});
  if(parsed.pathname.includes('/rest/v1/rpc/')){const name=parsed.pathname.split('/').at(-1),args=JSON.parse(options.body);calls.push({name,args,headers:options.headers});if(name==='sync_own_account')return Response.json([{account_id:id,email:authUser.email,name:'Session User',role:'customer',preferences:{},profile:{},design_defaults:{}}]);if(name==='create_own_app_session'){encryptedSession=args.p_provider_session;return Response.json(true);}if(name==='get_app_session')return Response.json({account_id:id,provider_session:encryptedSession,expires_at:new Date(Date.now()+3600000).toISOString()});if(name==='delete_app_session')return Response.json(true);if(name==='consume_request_limit')return Response.json(1);throw new Error(`Unexpected RPC ${name}`);}
  throw new Error(`Unexpected request ${parsed.pathname}`);
 }});
 try{
  const login=await service.login({email:authUser.email,password:'Secret-test-password'});
  assert.match(login.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.doesNotMatch(login.cookie,/private-access|private-refresh/);
  const request=new Request('https://production-candidate.example.test',{headers:{Cookie:login.cookie.split(';')[0]}});
  assert.equal((await service.user(request)).id,id);await service.consumeRequestLimit('c'.repeat(64),Math.floor(Date.now()/60000),1000);await service.logout(request);
  const create=calls.find(call=>call.name==='create_own_app_session'),get=calls.find(call=>call.name==='get_app_session');
  assert.match(create.args.p_hash,/^[a-f0-9]{64}$/);assert.doesNotMatch(create.args.p_provider_session,/private-access|private-refresh/);
  assert.doesNotMatch(Buffer.from(create.args.p_provider_session,'base64').toString(),/private-access|private-refresh/);
  assert.equal(get.headers.apikey,'fixture');assert.equal(get.headers.Authorization,undefined);
  const limiter=calls.find(call=>call.name==='consume_request_limit');assert.deepEqual(limiter.args,{p_key_hash:'c'.repeat(64),p_window_id:Math.floor(Date.now()/60000),p_limit:1000});assert.equal(limiter.headers.apikey,'fixture');assert.equal(limiter.headers.Authorization,undefined);
  assert.equal(calls.filter(call=>call.name==='delete_app_session').length,1);assert.equal(paths.filter(path=>path.includes('/rest/v1/rpc/')).length,7);
 }finally{for(const key of ['PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY']){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
