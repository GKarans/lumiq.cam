import {loadSharp} from './image-runtime.mjs';
import {requireThat,Fault} from './security.mjs';

export async function replaceCover(db,files,events,user,eventId,data,validateImage,screen='welcome'){
 requireThat(['welcome','camera'].includes(screen),400,'Choose a valid guest screen.');
 requireThat(typeof data==='string'&&data.length<9*1024**2,413,'Choose a smaller cover.');
 const initial=await events.own(user,eventId);
 let photo;
 try{const source=Buffer.from(data,'base64');if(validateImage){await validateImage(source);photo=source;}else{const sharp=await loadSharp();photo=await sharp(source,{limitInputPixels:40e6}).rotate().resize({width:1600,withoutEnlargement:true}).webp({quality:82}).toBuffer();}}
 catch{throw new Fault(415,'This cover could not be opened.');}
 const assetType=screen==='camera'?'camera_cover':'cover',reservation=await events.reserveDesignAsset(user,eventId,assetType);
 await files.put(reservation.key,photo);
 await events.attachDesignAsset(user,eventId,assetType,reservation.key,reservation.reservationId);
 return {ok:true};
}

export async function replaceCoverSource(db,files,events,user,eventId,data,validateImage){
 requireThat(typeof data==='string'&&data.length<9*1024**2,413,'Choose a smaller cover.');await events.own(user,eventId);let photo;
 try{const source=Buffer.from(data,'base64');if(validateImage){await validateImage(source);photo=source;}else{const sharp=await loadSharp();photo=await sharp(source,{limitInputPixels:40e6,failOn:'warning'}).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();}}
 catch{throw new Fault(415,'This cover could not be opened.');}
 const reservation=await events.reserveDesignAsset(user,eventId,'cover_source');await files.put(reservation.key,photo);return events.attachDesignAsset(user,eventId,'cover_source',reservation.key,reservation.reservationId);
}
