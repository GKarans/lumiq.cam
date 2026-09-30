import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {pruneProductionBackups} from '../scripts/prune-production-backups.mjs';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const bucket='lumiq-production-backups';
const project='baqebydtinysosueksgr';
const appliedMigrations=await Promise.all(PLATFORM_MIGRATIONS.slice(0,46).map(async entry=>{
 const source=await readFile(new URL(`../server/${entry.file}`,import.meta.url),'utf8');
 return{version:entry.version,checksum:createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex')};
}));

function fixtureS3(manifests){
 const deleted=[];
 return{
  deleted,
  async send(command){
   const input=command.input;
   if(input.Delimiter==='/')return{CommonPrefixes:Object.keys(manifests).map(prefix=>({Prefix:`${prefix}/`}))};
   if(input.Key){
    const prefix=input.Key.slice(0,-'/manifest.json'.length);
    const manifest=manifests[prefix];
    if(!manifest)throw new Error('not found');
    return{Body:{transformToString:async()=>JSON.stringify(manifest)}};
   }
   if(input.Delete){deleted.push(...input.Delete.Objects.map(item=>item.Key));return{}};
   const prefix=input.Prefix.replace(/\/$/,'');
   const manifest=manifests[prefix];
   if(!manifest)return{Contents:[]};
   return{Contents:[
    {Key:`${prefix}/manifest.json`,Size:100},
    {Key:`${prefix}/database.dump`,Size:12},
    {Key:`${prefix}/auth-users.dump`,Size:8}
   ]};
  }
 };
}

function manifest(prefix){
 return{
  format_version:4,remote_prefix:prefix,remote_bucket:bucket,bucket:'lumiq-production-photos',
  database:{scope:'lumiq-public-plus-auth-users-identities',source_project_ref:project,file:'database.dump',size:12,auth_file:'auth-users.dump',auth_size:8,tables:[{schema:'auth',name:'users'},{schema:'auth',name:'identities'}],migrations:appliedMigrations},
  objects:[]
 };
}

test('retention removes only complete expired Production sets and preserves the newest and in-window sets',async()=>{
 const old='production/2026-08-01T02-30-00-000Z';
 const recent='production/2026-09-15T02-30-00-000Z';
 const newest='production/2026-09-30T23-17-06-575Z';
 const incomplete='production/2026-08-02T02-30-00-000Z';
 const s3=fixtureS3({[old]:manifest(old),[recent]:manifest(recent),[newest]:manifest(newest),[incomplete]:null});
 const result=await pruneProductionBackups({s3,bucket,now:new Date('2026-10-01T00:00:00Z')});
 assert.deepEqual(result.deletedPrefixes,[old]);
 assert.equal(result.newestPrefix,`${newest}/`);
 assert.deepEqual(s3.deleted,[`${old}/manifest.json`,`${old}/database.dump`,`${old}/auth-users.dump`]);
});

test('retention skips tampered, mis-pinned, malformed and path-escaping backup manifests',async()=>{
 const checksumBad='production/2026-08-01T02-30-00-000Z';
 const wrongProject='production/2026-08-02T02-30-00-000Z';
 const escaping='production/2026-08-03T02-30-00-000Z';
 const s3=fixtureS3({
  [checksumBad]:{...manifest(checksumBad),database:{...manifest(checksumBad).database,migrations:[{version:'001-platform',checksum:'0'.repeat(64)}]}},
  [wrongProject]:{...manifest(wrongProject),database:{...manifest(wrongProject).database,source_project_ref:'another-project'}},
  [escaping]:{...manifest(escaping),database:{...manifest(escaping).database,file:'../production.dump'}}
 });
 const result=await pruneProductionBackups({s3,bucket,now:new Date('2026-10-01T00:00:00Z')});
 assert.deepEqual(result.deletedPrefixes,[]);
 assert.deepEqual(s3.deleted,[]);
});

test('retention blocks all deletion when the newest dated backup is incomplete',async()=>{
 const old='production/2026-08-01T02-30-00-000Z';
 const incompleteNewest='production/2026-09-30T23-17-06-575Z';
 const s3=fixtureS3({[old]:manifest(old),[incompleteNewest]:null});
 const result=await pruneProductionBackups({s3,bucket,now:new Date('2026-10-01T00:00:00Z')});
 assert.equal(result.blockedByIncompleteNewest,true);
 assert.deepEqual(result.deletedPrefixes,[]);
 assert.deepEqual(s3.deleted,[]);
});

test('retention refuses policies shorter than 30 days',async()=>{
 await assert.rejects(pruneProductionBackups({s3:fixtureS3({}),bucket,retentionDays:29}),/at least 30 days/);
});
