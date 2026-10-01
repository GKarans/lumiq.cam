import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {supabaseAuthService} from '../server/supabase-auth.mjs';

test('locked invite callback validates the Supabase invite without creating a Lumiq session',async()=>{
 const previous={};
 for(const key of ['PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY'])previous[key]=process.env[key];
 process.env.PLATFORM_SUPABASE_URL='https://production-ref.supabase.co';
 process.env.PLATFORM_SUPABASE_PUBLISHABLE_KEY='publishable-fixture';
 process.env.PLATFORM_SESSION_ENCRYPTION_KEY='a'.repeat(64);
 const calls=[];
 try{
  const service=supabaseAuthService({}, {
   origin:'https://candidate.example.workers.dev',
   mail:async()=>{},
   callbackOnly:true,
   fetcher:async(url,options)=>{
    calls.push({path:new URL(url).pathname,authorization:options.headers.Authorization});
    return Response.json({id:'invite-user',email:'owner@example.test',email_confirmed_at:'2026-09-29T12:00:00Z'});
   }
  });
  const result=await service.consume({access_token:'invite-access-fixture',refresh_token:'unused-refresh-fixture',type:'invite',purpose:'verify'});
  assert.deepEqual(result,{message:'Invitation confirmed. You can now sign in.'});
  assert.deepEqual(calls,[{path:'/auth/v1/user',authorization:'Bearer invite-access-fixture'}]);
  await assert.rejects(service.consume({access_token:'invite-access-fixture',type:'signup',purpose:'verify'}),/invitation link is invalid/i);
  await assert.rejects(service.consume({token:'invite-token-fixture',type:'invite',purpose:'verify'}),/invitation link is invalid/i);
  assert.equal(calls.length,1,'invalid callback types never reach Supabase');
 }finally{
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('callback-only app rejects every route except the invite consume endpoint',async()=>{
 const keys=['PLATFORM_MODE','PLATFORM_RELEASE_APPROVED','PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{PLATFORM_MODE:'production',PLATFORM_RELEASE_APPROVED:'NOT_APPROVED',PLATFORM_SUPABASE_URL:'https://production-ref.supabase.co',PLATFORM_SUPABASE_PUBLISHABLE_KEY:'publishable-fixture',PLATFORM_SESSION_ENCRYPTION_KEY:'b'.repeat(64)});
 let queries=0;
 try{
  const app=await createApp({origin:'https://candidate.example.workers.dev',local:false,authCallbackOnly:true,db:{query:async()=>{queries++;return{rows:[]};}},files:{}});
  const blocked=await app.handle(new Request('https://candidate.example.workers.dev/api/config'));
  assert.equal(blocked.status,404);
  const wrongHost=await app.handle(new Request('https://lumiq.cam/api/auth/consume',{method:'POST',headers:{origin:'https://lumiq.cam','content-type':'application/json'},body:'{}'}));
  assert.equal(wrongHost.status,403);
  assert.equal(queries,0,'blocked requests do not touch the database');
 }finally{
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
