import http from 'node:http';
import {Readable} from 'node:stream';
import {createApp} from './app.mjs';
import {openDatabase} from './db.mjs';
import {storage} from './storage.mjs';
import {seedLocal} from './seed.mjs';
const port=Number(process.env.PLATFORM_PORT||5700);
const origin=`http://127.0.0.1:${port}`;
if(process.env.PLATFORM_MODE&&process.env.PLATFORM_MODE!=='local')throw new Error('This launcher is local-only. Use the staging entry point after setup.');
const test=process.env.PLATFORM_EPHEMERAL_TEST==='1';
const app=await createApp({origin,local:true,...(test?{db:await openDatabase({memory:true}),files:storage({root:process.env.PLATFORM_TEST_OBJECTS})}:{})});
await seedLocal(app);
const server=http.createServer(async(req,res)=>{
 try{let size=0;const chunks=[],limit=req.url?.endsWith('/convert')?31*1024**2:/\/(?:cover|cover-source|qr-background|qr-source)$/.test(req.url||'')?16*1024**2:7*1024**2;for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}const request=new Request(`${origin}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const result=await app.handle(request);res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();}catch{res.writeHead(500);res.end('Request failed');}
});
server.requestTimeout=120000;
server.listen(port,'127.0.0.1',()=>console.log(`Lumiq local platform: ${origin}\nMVP connections disabled. Payments simulated. Data: platform/.local`));
const timer=setInterval(()=>app.jobs.tick().catch(console.error),2000);const retention=setInterval(()=>app.jobs.retention().catch(console.error),60000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);clearInterval(retention);server.close(async()=>{await app.db.close();process.exit(0);});});
