import test from 'node:test';
import assert from 'node:assert/strict';
import {supabaseAuthService} from '../server/supabase-auth.mjs';

test('Supabase Auth failures log safe request metadata without credentials or provider message',async()=>{
 const previous={
  PLATFORM_SUPABASE_URL:process.env.PLATFORM_SUPABASE_URL,
  PLATFORM_SUPABASE_PUBLISHABLE_KEY:process.env.PLATFORM_SUPABASE_PUBLISHABLE_KEY,
  PLATFORM_SESSION_ENCRYPTION_KEY:process.env.PLATFORM_SESSION_ENCRYPTION_KEY
 };
 Object.assign(process.env,{
  PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',
  PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',
  PLATFORM_SESSION_ENCRYPTION_KEY:'34'.repeat(32)
 });
 const warnings=[],originalWarn=console.warn;
 console.warn=message=>warnings.push(message);
 try{
  const service=supabaseAuthService({}, {
   origin:'https://candidate.example.test',mail:async()=>{},
   fetcher:async()=>Response.json({code:'otp_expired',message:'private@example.test bearer eyJprivate-token'},
    {status:422,headers:{'sb-request-id':'request-fixture'}})
  });
  await assert.rejects(service.requestReset({email:'private@example.test'}),/Authentication could not be completed/);
  assert.equal(warnings.length,1);
  assert.deepEqual(JSON.parse(warnings[0]),{
   level:'warn',component:'supabase-auth',route:'recover',status:422,code:'otp_expired',requestId:'request-fixture'
  });
  assert.doesNotMatch(warnings[0],/private@example|private-token|bearer/i);
 }finally{
  console.warn=originalWarn;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('Supabase RPC failures log only safe status metadata',async()=>{
 const previous={
  PLATFORM_SUPABASE_URL:process.env.PLATFORM_SUPABASE_URL,
  PLATFORM_SUPABASE_PUBLISHABLE_KEY:process.env.PLATFORM_SUPABASE_PUBLISHABLE_KEY,
  PLATFORM_SESSION_ENCRYPTION_KEY:process.env.PLATFORM_SESSION_ENCRYPTION_KEY
 };
 Object.assign(process.env,{
  PLATFORM_SUPABASE_URL:'https://isolated-fixture.supabase.co',
  PLATFORM_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',
  PLATFORM_SESSION_ENCRYPTION_KEY:'34'.repeat(32)
 });
 const warnings=[],originalWarn=console.warn,user={id:'user-fixture',email:'private@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Test User'}};
 console.warn=message=>warnings.push(message);
 try{
  const service=supabaseAuthService({}, {
   origin:'https://lumiq.cam',mail:async()=>{},
   fetcher:async url=>url.includes('/auth/v1/token')
    ?Response.json({user,access_token:'private-access-token',refresh_token:'private-refresh-token'})
    :Response.json({code:'42501',message:'private@example.test bearer private-database-detail'},
     {status:403,headers:{'sb-request-id':'request-fixture'}})
  });
  await assert.rejects(service.login({email:user.email,password:'private-password'}),error=>{
   assert.equal(error.message,'Lumiq account access is temporarily unavailable because account setup could not finish. If this happened after a password reset, your password may already have changed. Do not request another reset; contact Lumiq support.');
   return true;
  });
  assert.equal(warnings.length,1);
  assert.deepEqual(JSON.parse(warnings[0]),{
   level:'warn',component:'supabase-auth-rpc',rpc:'sync_own_account',status:403,code:'42501',requestId:'request-fixture'
  });
  assert.doesNotMatch(warnings[0],/private@example|private-access|private-refresh|private-password|private-database-detail|bearer/i);
 }finally{
  console.warn=originalWarn;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
