import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateWebp} from '../../cloudflare/worker/src/webp-validation.js';
import {createQueueConsumer,createWorkerHandler} from '../../cloudflare/worker/src/router.js';
import worker,{assertMigrationsApplied,createScheduledHandler,migrationVersions} from '../../cloudflare/worker/src/index.js';

test('Worker startup requires every current platform migration',()=>{
 const applied=new Set(migrationVersions);
 assert.doesNotThrow(()=>assertMigrationsApplied(applied));
 applied.delete('011-queue-job-dispatch');
 assert.throws(()=>assertMigrationsApplied(applied),/Required database migrations are missing/);
});

test('Worker WebP validation accepts optimized photos and rejects malformed or oversized files',async()=>{
 const sample=await readFile(new URL('../public/assets/garden-gathering.webp',import.meta.url));
 await validateWebp(sample);
 await assert.rejects(validateWebp(sample.subarray(0,sample.length-1)));
 const oversized=Buffer.from(sample);
 const dimensions=oversized.indexOf(Buffer.from('VP8 '));
 assert.notEqual(dimensions,-1);
 oversized[dimensions+14]=0xff;
 oversized[dimensions+15]=0xff;
 oversized[dimensions+16]=0xff;
 oversized[dimensions+17]=0xff;
 await assert.rejects(validateWebp(oversized));
});

test('Worker forwards API requests and reports database health',async()=>{
 const seen=[];
 const handler=createWorkerHandler(async()=>({
  db:{query:async sql=>{seen.push(sql);return{rows:[{ready:1}]};},close:async()=>{seen.push('closed');}},
  handle:async request=>{seen.push(new URL(request.url).pathname);return new Response('api response');}
 }));
 const env={PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',PLATFORM_SERVICE_NAME:'lumiq-cam'};
 const api=await handler.fetch(new Request('https://lumiq.cam/api/config'),env);
 assert.equal(api.status,200);
 assert.equal(await api.text(),'api response');
 const health=await handler.fetch(new Request('https://lumiq.cam/healthz'),env);
 assert.equal(health.status,200);
 assert.deepEqual(await health.json(),{status:'ok',service:'lumiq-cam',database:'ready',storage:'bound'});
 const testEnv={...env};delete testEnv.PLATFORM_SERVICE_NAME;
 const testHealth=await handler.fetch(new Request('https://lumiq-closed-test.gkarans-events.workers.dev/healthz'),testEnv);
 assert.deepEqual(await testHealth.json(),{status:'ok',service:'lumiq-closed-test.gkarans-events.workers.dev',database:'ready',storage:'bound'});
 assert.deepEqual(seen,['/api/config','closed','select 1 as ready','closed','select 1 as ready','closed']);
});

test('Worker serves assets and gives a closed 503 when backend setup is unavailable',async()=>{
 const handler=createWorkerHandler(async()=>{throw new Error('private configuration detail');});
 const env={PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',ASSETS:{fetch:async()=>new Response('static app')}};
 const page=await handler.fetch(new Request('https://lumiq.cam/'),env);
 assert.equal(await page.text(),'static app');
 const api=await handler.fetch(new Request('https://lumiq.cam/api/config'),env);
 assert.equal(api.status,503);
 assert.deepEqual(await api.json(),{error:'Lumiq backend is temporarily unavailable.'});
 const health=await handler.fetch(new Request('https://lumiq.cam/healthz'),env);
 assert.equal(health.status,503);
 assert.equal((await health.json()).database,'unavailable');
});

test('Worker release gate blocks assets, API and health unless mode and approval match',async()=>{
 let appCalls=0,assetCalls=0;
 const handler=createWorkerHandler(async()=>{appCalls++;throw new Error('must stay closed');});
 for(const env of [
  {},
  {PLATFORM_MODE:'production',PLATFORM_RELEASE_APPROVED:'staging'},
  {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'production'}
 ]){
  const gatedEnv={...env,ASSETS:{fetch:async()=>{assetCalls++;return new Response('static app');}}};
  for(const path of ['/','/api/config','/healthz']){
   const response=await handler.fetch(new Request(`https://lumiq.cam${path}`),gatedEnv);
   assert.equal(response.status,503,`${path} should remain closed for ${JSON.stringify(env)}`);
   assert.deepEqual(await response.json(),{error:'Lumiq is not available.'});
  }
 }
 assert.equal(appCalls,0);
 assert.equal(assetCalls,0);
});

test('Worker release gate also blocks scheduled database and mail work',async()=>{
 let scheduled=0;
 const context={waitUntil:()=>{scheduled++;}};
 for(const env of [
  {PLATFORM_MODE:'production',PLATFORM_RELEASE_APPROVED:'staging'},
  {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'production'},
  {PLATFORM_MODE:'production'}
 ]){
  await worker.scheduled({}, {...env,HYPERDRIVE:{connectionString:'unused-test-connection'}}, context);
 }
 assert.equal(scheduled,0);
});

test('scheduled Worker processes one database-polled job per invocation',async()=>{
 const calls=[],closed=[],runScheduled=createScheduledHandler(async()=>({
  jobs:{retention:async()=>calls.push('retention'),tick:async options=>calls.push(options)},
  deliverMail:async()=>calls.push('mail'),
  db:{close:async()=>closed.push(true)}
 }));
 let scheduled;
 await runScheduled({},
  {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',HYPERDRIVE:{connectionString:'unused-test-connection'}},
  {waitUntil:promise=>{scheduled=promise;}}
 );
 await scheduled;
 assert.deepEqual(calls,['retention',{concurrency:1,maxJobs:1},'mail']);
 assert.equal(closed.length,1);
});

test('retention drill schedule is isolated, event-targeted, and never delivers email',async()=>{
 const calls=[],closed=[],runScheduled=createScheduledHandler(async()=>({
  jobs:{retention:async options=>{calls.push(['retention',options]);return{expired:true,jobId:'d4f6c64d-9065-4c42-9a48-cbac690b106d'};},tick:async options=>calls.push(['tick',options])},
  db:{query:async(...args)=>{calls.push(['query',...args]);return{rows:[{status:'ready',result:{removed:1}}]};},close:async()=>closed.push(true)},
  deliverMail:async()=>calls.push(['mail'])
 }));
 let scheduled;const eventId='cc8d61dd-9b02-4c68-a4a3-0069f098bf6a';
 await runScheduled({}, {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',PLATFORM_SERVICE_NAME:'lumiq-restore-drill-candidate',PLATFORM_SUPABASE_PROJECT_REF:'sprzlvywzpeyuzbsyplz',PLATFORM_R2_BUCKET:'lumiq-restore-drill-20260925',PLATFORM_RETENTION_DRILL_EVENT_ID:eventId,HYPERDRIVE:{connectionString:'unused-test-connection'}}, {waitUntil:promise=>{scheduled=promise;}});
 await scheduled;
 assert.deepEqual(calls.slice(0,2),[['retention',{eventId}],['tick',{concurrency:1,maxJobs:1,jobIds:['d4f6c64d-9065-4c42-9a48-cbac690b106d']}]]);
 assert(!calls.some(([type])=>type==='mail'));assert.equal(closed.length,1);
 let opened=false;const guarded=createScheduledHandler(async()=>{opened=true;throw new Error('Guard should reject the wrong bucket before opening a database.');});
 await guarded({}, {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',PLATFORM_SERVICE_NAME:'lumiq-restore-drill-candidate',PLATFORM_SUPABASE_PROJECT_REF:'sprzlvywzpeyuzbsyplz',PLATFORM_R2_BUCKET:'lumiq-closed-test-photos',PLATFORM_RETENTION_DRILL_EVENT_ID:eventId,HYPERDRIVE:{connectionString:'unused-test-connection'}}, {waitUntil:()=>{}});
 assert.equal(opened,false);
});

test('event-end drill prepares and processes only the targeted archive without mail delivery',async()=>{
 const calls=[],closed=[],eventId='cc8d61dd-9b02-4c68-a4a3-0069f098bf6a',jobId='d4f6c64d-9065-4c42-9a48-cbac690b106d';let scheduled;
 const runScheduled=createScheduledHandler(async()=>({
  jobs:{retention:async options=>{calls.push(['retention',options]);return{prepared:true,jobId};},tick:async options=>calls.push(['tick',options])},
  db:{query:async(...args)=>{calls.push(['query',...args]);return{rows:args[0].startsWith('select id from jobs')?[{id:'12b718a0-7119-460c-846c-4b08d239ce64'}]:[{status:'ready',result:{parts:[{key:'exports/synthetic/part-1.zip'}]}}]};},close:async()=>closed.push(true)},
  deliverMail:async()=>calls.push(['mail'])
 }));
 await runScheduled({}, {PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',PLATFORM_SERVICE_NAME:'lumiq-restore-drill-candidate',PLATFORM_SUPABASE_PROJECT_REF:'sprzlvywzpeyuzbsyplz',PLATFORM_R2_BUCKET:'lumiq-restore-drill-20260925',PLATFORM_RETENTION_DRILL_EVENT_ID:eventId,PLATFORM_RETENTION_DRILL_PHASE:'event-end',HYPERDRIVE:{connectionString:'unused-test-connection'}}, {waitUntil:promise=>{scheduled=promise;}});
 await scheduled;
 assert.deepEqual(calls.slice(0,2),[['retention',{eventId,phase:'event-end'}],['tick',{concurrency:1,maxJobs:1,jobIds:[jobId]}]]);
 assert.deepEqual(calls[2][1],"select id from jobs where event_id=$1 and type='export-part' and payload->>'parent_id'=$2 and status='queued' order by (payload->>'part_index')::int limit 10");
 assert.deepEqual(calls[3],['tick',{concurrency:1,maxJobs:1,jobIds:['12b718a0-7119-460c-846c-4b08d239ce64']}]);
 assert(!calls.some(([type])=>type==='mail'));assert.equal(closed.length,1);
});

test('queue consumer runs only valid targeted jobs, closes DB and retries startup failures',async()=>{
 const calls=[],deadLetters=[],makeMessage=body=>({body,acked:false,retried:null,ack(){this.acked=true;},retry(options){this.retried=options;}});
 const id='d4f6c64d-9065-4c42-9a48-cbac690b106d',valid=makeMessage({jobId:id}),invalid=makeMessage({jobId:'not-a-uuid'}),closed=[];
 const consumer=createQueueConsumer(async()=>({jobs:{tick:async options=>calls.push(options),deadLetter:async jobId=>deadLetters.push(jobId)},db:{close:async()=>closed.push(true)}}));
 await consumer({messages:[valid,invalid]},{PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging'});
 assert.deepEqual(calls,[{concurrency:1,maxJobs:1,jobIds:[id]}]);assert.equal(valid.acked,true);assert.equal(invalid.acked,true);assert.equal(closed.length,1);
 const poison=makeMessage({jobId:id});await consumer({queue:'test-jobs-dlq',messages:[poison]},{PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging',LUMIQ_JOBS_DLQ_NAME:'test-jobs-dlq'});assert.deepEqual(deadLetters,[id]);assert.equal(poison.acked,true);
 const blocked=makeMessage({jobId:id});await consumer({messages:[blocked]},{PLATFORM_MODE:'production',PLATFORM_RELEASE_APPROVED:'staging'});assert.deepEqual(blocked.retried,{delaySeconds:60});
 const unavailable=makeMessage({jobId:id}),original=console.error;console.error=()=>{};
 try{await createQueueConsumer(async()=>{throw new Error('offline');})({messages:[unavailable]},{PLATFORM_MODE:'staging',PLATFORM_RELEASE_APPROVED:'staging'});}finally{console.error=original;}
 assert.deepEqual(unavailable.retried,{delaySeconds:60});
});
