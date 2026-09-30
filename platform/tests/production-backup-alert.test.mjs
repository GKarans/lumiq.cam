import assert from 'node:assert/strict';
import test from 'node:test';
import {sendProductionBackupAlert} from '../scripts/send-production-backup-alert.mjs';

test('backup failure email is sent to the owner from the verified Lumiq sender without operational data',async()=>{
 let request;
 await sendProductionBackupAlert({apiKey:'test-only-secret',fetchImpl:async(url,options)=>{
  request={url,options};return{ok:true,status:200};
 }});
 assert.equal(request.url,'https://api.resend.com/emails');
 assert.equal(request.options.headers.Authorization,'Bearer test-only-secret');
 const body=JSON.parse(request.options.body);
 assert.equal(body.from,'Lumiq <noreply@lumiq.cam>');
 assert.deepEqual(body.to,['guntars.karans@gmail.com']);
 assert.match(body.text,/Windows Task Scheduler/);
 assert.doesNotMatch(body.text,/password|token|dump|R2 object/i);
});

test('backup alert rejects missing credentials and failed Resend responses',async()=>{
 await assert.rejects(sendProductionBackupAlert({apiKey:'',fetchImpl:async()=>{throw new Error('must not call fetch');}}),/credential is unavailable/);
 await assert.rejects(sendProductionBackupAlert({apiKey:'test-only-secret',fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
});
