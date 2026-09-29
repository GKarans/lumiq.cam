import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';

if(process.env.PLATFORM_DATABASE_URL||process.env.PLATFORM_R2_BUCKET)throw new Error('Browser verification is local-only. Clear cloud configuration first.');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;
const temporary=await mkdtemp(path.join(os.tmpdir(),'gf-browser-'));
const env={...process.env,PLATFORM_TEST_OBJECTS:temporary,PLATFORM_MODE:'local',PLATFORM_PORT:String(port),PLATFORM_EPHEMERAL_TEST:'1',PLATFORM_TEST_ORIGIN:base};
const server=spawn(process.execPath,['platform/server/start.mjs'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let startup='';server.stdout.on('data',b=>startup+=b);server.stderr.on('data',b=>startup+=b);
const result={started_at:new Date().toISOString(),environment:'ephemeral local PostgreSQL and files',checks:[]};
try{
 let ready=false;
 for(let n=0;n<120;n++){
  if(server.exitCode!==null)throw new Error(`Test server exited: ${startup}`);
  try{ready=(await fetch(base+'/api/config',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(ready)break;await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw new Error(`Test server failed to start: ${startup}`);
 await mkdir('platform/test-results',{recursive:true});
 for(const file of ['browser.cjs','journey.cjs','invite-callback-browser.cjs','designer.cjs','billing-browser.cjs','refinement-browser.cjs','accessibility.cjs']){
  const child=spawn(process.execPath,[`platform/tests/${file}`],{env,stdio:'inherit',windowsHide:true});
  const [code]=await once(child,'exit');result.checks.push({file,passed:code===0});
  if(code!==0)throw new Error(`${file} failed`);
 }
 console.log('Isolated browser verification passed. Your preview data was not used.');
}catch(error){result.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
 server.kill('SIGTERM');
 await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);});
 if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('gf-browser-'))throw new Error('Unexpected test cleanup path.');
 await rm(temporary,{recursive:true,force:true});
 result.finished_at=new Date().toISOString();await mkdir('platform/test-results',{recursive:true});
 await writeFile('platform/test-results/browser-report.json',JSON.stringify(result,null,2));
}
