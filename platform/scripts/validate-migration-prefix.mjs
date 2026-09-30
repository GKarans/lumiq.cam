import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

export async function validateMigrationPrefix(applied){
 if(!Array.isArray(applied)||applied.length===0||applied.length>PLATFORM_MIGRATIONS.length){
  throw new Error('Migration ledger is empty or longer than the application manifest.');
 }
 for(let index=0;index<applied.length;index++){
  const expected=PLATFORM_MIGRATIONS[index],entry=applied[index];
  const source=await readFile(new URL(`../server/${expected.file}`,import.meta.url),'utf8');
  const checksum=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
  if(entry?.version!==expected.version||entry?.checksum!==checksum){
   throw new Error(`Migration ledger differs from the application manifest at ${expected.version}.`);
  }
 }
}
