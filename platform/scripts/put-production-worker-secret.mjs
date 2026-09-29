import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const config=path.join(root,'cloudflare/worker/wrangler.production.preflight.local.jsonc');
const sources={
 PLATFORM_SESSION_ENCRYPTION_KEY:{name:'LUMIQ_PRODUCTION_SESSION_ENCRYPTION_KEY',valid:value=>/^[a-f0-9]{64}$/i.test(value)},
 PLATFORM_EMAIL_KEY:{name:'LUMIQ_PRODUCTION_EMAIL_KEY',valid:value=>typeof value==='string'&&value.length>0}
};
const binding=process.env.LUMIQ_PRODUCTION_WORKER_SECRET_BINDING;
const source=sources[binding];
const secret=source&&process.env[source.name];
if(!source||!source.valid(secret))throw new Error('DPAPI Worker secret is missing or has an invalid format.');

const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const child=spawn(process.execPath,[wrangler,'secret','put',binding,'--config',config,'--name','lumiq-production-candidate'],{
 cwd:root,
 env:Object.fromEntries(Object.entries(process.env).filter(([name])=>name!==source.name&&name!=='LUMIQ_PRODUCTION_WORKER_SECRET_BINDING')),
 stdio:['pipe','pipe','pipe'],
 windowsHide:true
});
child.stdout.resume();
child.stderr.resume();
child.stdin.end(`${secret}\n`);
const exitCode=await new Promise((resolve,reject)=>{
 child.once('error',reject);
 child.once('close',resolve);
});
if(exitCode!==0){
 console.error(`Candidate Worker secret was not updated (wrangler exit ${exitCode}). No secret values were printed.`);
 process.exitCode=exitCode||1;
}else console.log(`Production candidate ${binding} saved in Cloudflare.`);
