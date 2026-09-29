import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {databaseLimiter} from '../server/security.mjs';
import {clientAddress} from '../server/http-policy.mjs';

test('rate allowance is shared between service instances and resets by window',async()=>{
 const db=await openDatabase({memory:true});let now=1000000;
 try{const a=databaseLimiter(db,2,'fixture',()=>now),b=databaseLimiter(db,2,'fixture',()=>now);await a('client');await b('client');await assert.rejects(a('client'),/Too many/);now+=60000;await b('client');const row=(await db.query('select * from request_limits')).rows[0];assert.equal(row.requests,1);assert.notEqual(row.key_hash,'client');}finally{await db.close();}
});

test('rate limiter delegates production counters to its RPC callback without direct SQL',async()=>{
 let requests=0;const db={query(){throw new Error('Expected RPC-backed rate limiting.');}},limit=databaseLimiter(db,2,'fixture',()=>120000,async(hash,window,max)=>{assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(window,2);assert.equal(max,2);return++requests;});
 await limit('client');await limit('client');await assert.rejects(limit('client'),/Too many/);assert.equal(requests,3);
});
test('forwarded addresses are trusted only from an explicitly configured proxy',()=>{
 const r={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'198.51.100.9, 203.0.113.4'}};
 assert.equal(clientAddress(r),'127.0.0.1');assert.equal(clientAddress(r,['127.0.0.1']),'203.0.113.4');r.headers['x-forwarded-for']='invalid';assert.equal(clientAddress(r,['127.0.0.1']),'127.0.0.1');
});
