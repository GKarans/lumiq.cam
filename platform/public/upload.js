import {api,esc,icon,icons,toast} from './ui.js';
import {uploadStore} from './upload-store.js';
import {PHOTO_LIMITS,PHOTO_SOURCE_TYPES} from '/shared/contracts.js';
async function canvasBlob(canvas,quality){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(!blob||blob.type!=='image/webp')throw new Error('Your browser cannot prepare this photo format. Update the browser or use a recent Chrome or Safari.');return blob;}
async function compatibleSource(file,slug,token){
 if(!['image/heic','image/heif'].includes(file.type))return file;
 const response=await fetch(`/api/guest/${slug}/convert`,{method:'PUT',headers:{'X-Guest-Token':token,'Content-Type':file.type},body:file,signal:AbortSignal.timeout(120000)});
 if(!response.ok){let message='This HEIC photo could not be converted. Try a JPEG copy.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
 return new File([await response.blob()],file.name.replace(/\.hei[cf]$/i,'.webp'),{type:'image/webp',lastModified:file.lastModified});
}
export async function optimize(file,slug,token){
 if(!PHOTO_SOURCE_TYPES.includes(file.type))throw new Error('Choose a JPEG, PNG, WebP, HEIC or HEIF photo.');
 if(file.size>PHOTO_LIMITS.sourceBytes)throw new Error('This source photo is over 30 MB. Choose a smaller copy.');
 file=await compatibleSource(file,slug,token);
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error('This photo could not be opened. Try a different JPEG or PNG.');}
 try{if(bitmap.width*bitmap.height>PHOTO_LIMITS.sourcePixels)throw new Error('This photo has too many pixels. Choose a smaller copy.');const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);let photo=await canvasBlob(c,.84);if(photo.size>PHOTO_LIMITS.photoBytes)photo=await canvasBlob(c,.65);if(photo.size>PHOTO_LIMITS.photoBytes)throw new Error('The optimized photo is still over 6 MB. Choose a smaller copy.');const t=document.createElement('canvas'),ratio=Math.min(1,360/Math.max(c.width,c.height));t.width=Math.max(1,Math.round(c.width*ratio));t.height=Math.max(1,Math.round(c.height*ratio));t.getContext('2d').drawImage(c,0,0,t.width,t.height);return{photo,thumb:await canvasBlob(t,.74)};}finally{bitmap.close();}
}
const digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
function put(url,blob,token,onprogress,signal,remoteHeaders){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.timeout=120000;for(const [k,v]of Object.entries(remoteHeaders||{'X-Guest-Token':token,'Content-Type':'image/webp'}))xhr.setRequestHeader(k,v);xhr.upload.onprogress=e=>onprogress(e.lengthComputable?e.loaded/e.total:0);xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else{let message;try{message=JSON.parse(xhr.responseText).error;}catch{}const error=new Error(message||'Upload failed. Try again.');error.status=xhr.status;reject(error);}};xhr.onerror=()=>reject(new Error('Connection lost. Retry when you are online.'));xhr.ontimeout=()=>reject(new Error('Upload timed out. Please retry.'));xhr.onabort=()=>reject(new Error('Upload canceled.'));signal.addEventListener('abort',()=>xhr.abort(),{once:true});if(signal.aborted){reject(new Error('Upload canceled.'));return;}xhr.send(blob);});}
export function photoQueue(slug,guest,host){let queue=[],running=0,disposed=false;const scope=`${slug}:${guest.id}`;
 const headers={'X-Guest-Token':guest.token};
 const render=()=>{if(disposed)return;host.innerHTML=queue.length?`<div class="queue"><strong class="small">${queue.filter(q=>q.status==='uploaded').length} uploaded · ${queue.filter(q=>q.status==='failed').length} need attention</strong>${queue.map(q=>`<article class="queue-item"><img src="${q.preview}" alt="Selected photo"><div><p>${esc(q.name)}</p><small>${esc(q.message||q.status)}</small><progress max="100" value="${q.progress}" aria-label="Upload progress"></progress></div><div class="queue-actions">${q.status==='failed'?`<button class="icon" data-retry="${q.id}" aria-label="Retry photo" title="Retry photo">${icon('rotate-cw')}</button>`:''}${q.status==='uploaded'?icon('circle-check'):`<button class="icon" data-remove="${q.id}" aria-label="Remove photo" title="Remove photo">${icon('x')}</button>`}</div></article>`).join('')}</div>`:'';host.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>{const q=queue.find(x=>x.id===b.dataset.retry);q.status='queued';q.message='';pump();});host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const q=queue.find(x=>x.id===b.dataset.remove);q.controller?.abort();q.removed=true;await uploadStore.remove(scope,q.id);URL.revokeObjectURL(q.preview);queue=queue.filter(x=>x!==q);render();});icons();};
 const process=async q=>{
  q.controller=new AbortController();q.status='preparing';render();
  try{
   if(!q.photo){Object.assign(q,await optimize(q.file,slug,guest.token));q.checksum=await digest(q.photo);q.thumbnail_checksum=await digest(q.thumb);}
   if(q.removed)return;q.status='uploading';q.progress=10;render();
   const reserved=await api(`/guest/${slug}/reserve`,{method:'POST',headers,body:{id:q.id,name:q.name,captured_at:q.file.lastModified,bytes:q.photo.size,thumbnail_bytes:q.thumb.size,checksum:q.checksum,thumbnail_checksum:q.thumbnail_checksum}});
   q.reserved=true;
   if(q.removed)return;
   if(reserved.status!=='uploaded'){
    for(const [kind,blob,flag,start,range]of [['photo',q.photo,'sentPhoto',10,65],['thumb',q.thumb,'sentThumb',75,20]]){
     if(!q[flag]){const target=reserved.targets?.[kind];await put(target?.url||`/api/guest/${slug}/content/${q.id}/${kind}`,blob,guest.token,p=>{q.progress=start+p*range;render();},q.controller.signal,target?.headers);q[flag]=true;}
     if(q.removed)return;
    }
    await api(`/guest/${slug}/finalize`,{method:'POST',headers,body:{id:q.id}});
   }
   q.status='uploaded';q.message='Photo uploaded!';q.progress=100;q.photo=null;q.thumb=null;await uploadStore.remove(scope,q.id);toast('Photo uploaded!');
  }catch(e){if(!q.removed){const transient=(!e.status||e.status>=500||e.status===429)&&q.photo&&!disposed;
    if(transient&&(q.retries||0)<2){q.retries=(q.retries||0)+1;q.status='waiting';q.message='Connection interrupted. Retrying...';setTimeout(()=>{if(!q.removed&&!disposed){q.status='queued';pump();}},q.retries*2000);}
    else{q.status='failed';q.message=e.message;}
  }}finally{
   if(q.removed&&q.reserved)api(`/guest/${slug}/discard`,{method:'POST',headers,body:{id:q.id}}).catch(()=>{});
   running--;render();pump();
  }
 };
 const pump=()=>{render();if(disposed)return;while(running<2){const q=queue.find(q=>q.status==='queued');if(!q)break;running++;process(q);}};
 const beforeUnload=e=>{if(queue.some(q=>!['uploaded','failed'].includes(q.status))){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);
 const restore=async()=>{const saved=await uploadStore.list(scope);if(disposed)return;for(const item of saved)queue.push({id:item.id,name:item.name,file:item.file,added:item.added,preview:URL.createObjectURL(item.file),status:'queued',progress:0,message:'Restored after refresh'});pump();};restore();
 return{async add(files){const list=[...files];if(list.length>PHOTO_LIMITS.batchFiles||queue.filter(q=>q.status!=='uploaded').length+list.length>PHOTO_LIMITS.batchFiles){toast('Choose up to 20 photos at a time.',true);return;}if(list.reduce((s,f)=>s+f.size,0)>PHOTO_LIMITS.batchBytes){toast('This selection exceeds 150 MB. Add fewer photos at a time.',true);return;}for(const f of list){const q={id:crypto.randomUUID(),name:f.name,file:f,added:Date.now(),preview:URL.createObjectURL(f),status:'queued',progress:0};queue.push(q);await uploadStore.save(scope,q);}pump();},pending:()=>queue.some(q=>q.status!=='uploaded'),dispose(){disposed=true;window.removeEventListener('beforeunload',beforeUnload);for(const q of queue){q.controller?.abort();URL.revokeObjectURL(q.preview);}}};
}
