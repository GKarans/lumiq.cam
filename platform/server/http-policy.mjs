import {requireThat} from './security.mjs';
import {isIP} from 'node:net';

export function clientAddress(request,trusted=[]){
 const peer=request.socket.remoteAddress||'unknown';
 if(!trusted.includes(peer))return peer;
 const forwarded=String(request.headers['x-forwarded-for']||'').split(',').map(x=>x.trim());
 const candidate=forwarded.at(-1);
 return candidate&&isIP(candidate)?candidate:peer;
}

export function checkMethod(path, method) {
 const routes = [
  [/^\/api\/(config|local\/(demo|inbox)|auth\/(session|google\/(start|callback))|billing|admin)$/, ['GET']],
  [/^\/api\/(local\/demo-session|account\/password|auth\/(register|login|logout|reset|consume)|billing\/(checkout|simulate|cancel|portal)|admin\/(retry|reply|reconcile|retry-email))$/, ['POST']],
  [/^\/api\/account$/, ['PATCH','DELETE']],
  [/^\/api\/(events|support)$/, ['GET','POST']],
  [/^\/api\/events\/[0-9a-f-]{36}$/, ['GET','PATCH']],
  [/^\/api\/events\/[0-9a-f-]{36}\/photos$/, ['GET','DELETE']],
  [/^\/api\/events\/[0-9a-f-]{36}\/qr-source$/, ['GET','POST']],
  [/^\/api\/events\/[0-9a-f-]{36}\/(action|export|duplicate|cover|cover-source|curate|preview|qr-background|qr-layout)$/, ['POST']],
  [/^\/api\/events\/[0-9a-f-]{36}\/(jobs|qr)$/, ['GET']],
  [/^\/api\/guest\/[\w-]+(?:\/photos)?$/, ['GET']],
  [/^\/api\/guest\/[\w-]+\/(join|reserve|finalize|discard)$/, ['POST']],
  [/^\/api\/guest\/[\w-]+\/content\/[0-9a-f-]{36}\/(photo|thumb)$/, ['PUT']],
  [/^\/api\/guest\/[\w-]+\/convert$/, ['PUT']],
  [/^\/api\/(covers\/[0-9a-f-]{36}|photos\/[0-9a-f-]{36}\/(photo|thumb))$/, ['GET']],
  [/^\/api\/jobs\/[0-9a-f-]{36}(?:\/download\/\d+)?$/, ['GET']],
  [/^\/api\/jobs\/[0-9a-f-]{36}\/retry$/, ['POST']],
 ];
 const route = routes.find(([pattern]) => pattern.test(path));
 requireThat(route,404,'This action is not available.');
 requireThat(route[1].includes(method),405,'This request method is not allowed.');
}

export function storageOrigin() {
 const endpoint=process.env.PLATFORM_R2_ENDPOINT;
 if(!endpoint)return '';
 const url=new URL(endpoint);
 requireThat(url.protocol==='https:' && url.hostname.endsWith('.r2.cloudflarestorage.com'),503,'Configure a private R2 S3 endpoint.');
 return url.origin;
}
