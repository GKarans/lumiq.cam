import http from 'node:http';
import {Readable} from 'node:stream';
import {createApp} from './app.mjs';
import {requireThat} from './security.mjs';
import {clientAddress} from './http-policy.mjs';
import {sendAlert} from './alerts.mjs';

const origin=process.env.PLATFORM_ORIGIN;
requireThat(process.env.PLATFORM_MODE==='staging'&&origin?.startsWith('https://'),503,'This entry point requires explicit staging configuration.');
for(const key of ['PLATFORM_DATABASE_URL','PLATFORM_R2_BUCKET','PLATFORM_R2_ENDPOINT','PLATFORM_R2_ACCESS_KEY_ID','PLATFORM_R2_SECRET_ACCESS_KEY','PLATFORM_SUPABASE_URL','PLATFORM_SUPABASE_PUBLISHABLE_KEY','PLATFORM_SESSION_ENCRYPTION_KEY'])requireThat(process.env[key],503,`Missing staging configuration: ${key}`);
requireThat(new URL(origin).origin===origin&&!origin.includes('event-photo-saas.netlify.app'),503,'Use a new staging origin, without a trailing slash.');
const app=await createApp({origin,local:false});
const workerOnly=process.argv.includes('--worker');
const server=workerOnly?null:http.createServer(async(req,res)=>{
 try{
  if(req.url==='/healthz'){try{await app.db.query('select 1 as ready');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'ok',mode:'staging',database:'ready'}));}catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'unavailable',database:'failed'}));}return;}
  if(req.url.startsWith('/api/billing/webhook')&&Number(req.headers['content-length'])>100000)throw Object.assign(new Error(),{status:413});
 const chunks=[];let size=0,limit=req.url?.endsWith('/convert')?31*1024**2:/\/(?:cover|cover-source|qr-background|qr-source)$/.test(req.url||'')?16*1024**2:7*1024**2;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error(),{status:413});chunks.push(chunk);}
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const result=await app.handle(request,{clientId:clientAddress(req,(process.env.PLATFORM_TRUSTED_PROXY_IPS||'').split(',').filter(Boolean))});
  res.writeHead(result.status,Object.fromEntries(result.headers));
  if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();
 }catch(error){const status=error.status||500;console.error(JSON.stringify({level:'error',component:'http',status,path:req.url,error:error.code||error.name}));if(status>=500)sendAlert('http-error',{status,path:req.url}).catch(()=>{});res.writeHead(status,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:status===413?'This request is too large.':'This request could not finish.'}));}
});
if(server){server.requestTimeout=120000;server.headersTimeout=15000;server.listen(Number(process.env.PORT||5700),'0.0.0.0',()=>console.log('Lumiq isolated staging API ready.'));}
const timers=[];let stopped=false;
if(workerOnly){
 const maintenance=async()=>{if(stopped)return;try{await app.jobs.retention();await app.deliverMail();}catch(error){console.error(JSON.stringify({component:'maintenance',error:error.code||error.name}));}};
 timers.push(setInterval(()=>app.jobs.tick().catch(()=>console.error('Job processing failed')),2000),setInterval(maintenance,60000));
 await maintenance();console.log('Lumiq staging job worker ready.');
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;timers.forEach(clearInterval);const close=async()=>{await app.db.close();process.exit(0);};if(server)server.close(close);else close();});
