export const PHOTO_SOURCE_TYPES=Object.freeze(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
export const PHOTO_LIMITS=Object.freeze({sourceBytes:30*1024**2,photoBytes:6*1024**2,thumbnailBytes:1024**2,sourcePixels:60e6,batchFiles:20,batchBytes:150*1024**2});
const string=(value,min=1,max=500)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max;
const uuid=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
export function validateContract(name,input){
 if(!input||typeof input!=='object'||Array.isArray(input))return'Provide an object.';
 if(name==='auth.login'&&(!string(input.email,3,320)||!string(input.password,12,128)))return'Provide a valid email and password.';
 if(name==='auth.register'&&(!string(input.email,3,320)||!string(input.password,12,128)||(input.password_confirm!==undefined&&input.password!==input.password_confirm)||!(string(input.name,1,160)||(string(input.first_name,1,80)&&string(input.last_name,1,80)))))return'Complete the required account fields.';
 if(name==='event.save'&&(!string(input.name,1,80)||!string(input.start,16,30)||!string(input.end,16,30)||!string(input.time_zone,1,80)))return'Complete the event name and schedule.';
 if(name==='event.update'&&(!string(input.name,1,80)||(['start','end','time_zone'].some(key=>input[key]!==undefined)&&!['start','end','time_zone'].every(key=>string(input[key],key==='time_zone'?1:16,key==='time_zone'?80:30)))))return'Provide a complete schedule or leave it unchanged.';
 if(name==='guest.join'&&!string(input.name,1,80))return'Enter your name.';
 if(name==='media.reserve'&&(!uuid(input.id)||!string(input.name,1,180)||!Number.isFinite(Number(input.bytes))||!Number.isFinite(Number(input.thumbnail_bytes))||(input.captured_at!==undefined&&(!Number.isFinite(Number(input.captured_at))||Number(input.captured_at)<0))))return'Provide valid photo metadata.';
 if(name==='gallery.curate'&&(!['favorite','unfavorite','hide','restore','cover'].includes(input.action)||!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>200||!input.ids.every(uuid)))return'Choose valid photos and a gallery action.';
 return null;
}
