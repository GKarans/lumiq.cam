import {Canvas,FabricImage,IText,PencilBrush} from '/vendor/fabric.js';
import {coverGeometry} from '/shared/cover.js';

const FONT_STACKS={sans:'Roboto, sans-serif',serif:'Georgia, serif',display:'Playfair Display, Georgia, serif',mono:'monospace'};
const svgData=async url=>{
 const response=await fetch(url,{credentials:'same-origin'});
 if(!response.ok)throw new Error('The QR code could not be prepared.');
 return URL.createObjectURL(await response.blob());
};
const imageFromUrl=async url=>FabricImage.fromURL(url,{crossOrigin:'same-origin'});

export function wireTextField(canvas,input){
 const sync=()=>{const object=canvas.getActiveObject();input.disabled=!object||typeof object.text!=='string';input.value=input.disabled?'':object.text;};
 const change=()=>{const object=canvas.getActiveObject();if(!object||typeof object.text!=='string')return;object.set('text',input.value);object.initDimensions();object.setCoords();canvas.requestRenderAll();};
 canvas.on('selection:created',sync);canvas.on('selection:updated',sync);canvas.on('selection:cleared',sync);canvas.on('text:changed',sync);input.addEventListener('input',change);sync();
 return()=>{canvas.off('selection:created',sync);canvas.off('selection:updated',sync);canvas.off('selection:cleared',sync);canvas.off('text:changed',sync);input.removeEventListener('input',change);};
}

export function createCanvasEditor({element,width,height,background,scene,qrUrl}){
 const canvas=new Canvas(element,{width,height,preserveObjectStacking:true,selection:true,perPixelTargetFind:false});
 const constrainBackground=object=>{const minScale=Math.max(width/object.width,height/object.height),scale=Math.max(minScale,Number(object.scaleX)||1,Number(object.scaleY)||1),center=object.getCenterPoint();object.set({originX:'center',originY:'center',scaleX:scale,scaleY:scale,hasControls:false,lockScalingX:true,lockScalingY:true});object.setPositionByOrigin(center,'center','center');const geometry=coverGeometry(width,height,object.width,object.height,{zoom:scale/minScale}),left=Math.max(width-geometry.width,Math.min(0,center.x-geometry.width/2)),top=Math.max(height-geometry.height,Math.min(0,center.y-geometry.height/2));object.setPositionByOrigin({x:left+geometry.width/2,y:top+geometry.height/2},'center','center');object.setCoords();};
 const prepareObjectsForEditing=()=>canvas.getObjects().forEach(object=>{
  if(object instanceof IText)object.set({editable:false,selectable:true,evented:true,hasControls:true,lockMovementX:false,lockMovementY:false,lockScalingX:false,lockScalingY:false});
  object.setCoords();
  if(object.lumiqRole==='background'){object.set({selectable:true,evented:true,lockMovementX:false,lockMovementY:false});constrainBackground(object);}
 });
 canvas.freeDrawingBrush=new PencilBrush(canvas);canvas.freeDrawingBrush.width=8;canvas.freeDrawingBrush.color='#173e32';
 let qrObject=null,qrObjectUrl=null,backgroundSource=background||null,history=[],redoHistory=[];
 const resize=()=>{const host=element.parentElement,scale=Math.min(host.clientWidth/width,host.clientHeight/height,1);canvas.setDimensions({width:Math.round(width*scale),height:Math.round(height*scale)},{cssOnly:true});};
 const observer=new ResizeObserver(resize);observer.observe(element.parentElement);resize();
 const backgroundReady=(async()=>{
  if(scene){await canvas.loadFromJSON(scene);}
  if(canvas.backgroundImage){const legacy=canvas.backgroundImage;canvas.backgroundImage=null;legacy.set({lumiqRole:'background',selectable:true,evented:true});canvas.add(legacy);canvas.sendObjectToBack(legacy);}
  canvas.getObjects().forEach(object=>{if(object.lumiqRole==='qr')qrObject=object;if(object.lumiqRole==='background')backgroundSource=object.getSrc?.()||backgroundSource;});prepareObjectsForEditing();
  if(background&&!canvas.getObjects().some(object=>object.lumiqRole==='background'))await addBackground(background);
  canvas.requestRenderAll();
 })();
 const beginTextEditing=target=>{if(!(target instanceof IText)||target.isEditing)return;canvas.setActiveObject(target);target.set('editable',true);target.enterEditing();const textarea=target.hiddenTextarea,dialog=element.closest('dialog');if(textarea&&dialog&&textarea.parentElement!==dialog){textarea.style.position='fixed';dialog.append(textarea);}target.selectAll();textarea?.focus();canvas.requestRenderAll();};
 canvas.on('mouse:dblclick',({target})=>beginTextEditing(target));
 const editSelectedText=event=>{
  const target=canvas.getActiveObject();
  if(!(target instanceof IText)||target.isEditing||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='Enter'){event.preventDefault();beginTextEditing(target);return;}
  if(!event.key||event.key==='Dead'||event.key==='Unidentified'||(event.key.length!==1&&Array.from(event.key).length!==1))return;
  event.preventDefault();beginTextEditing(target);
  target.set('text',event.key);target.initDimensions();
  const cursor=target.graphemeSplit(event.key).length;
  target.selectionStart=cursor;target.selectionEnd=cursor;
  if(target.hiddenTextarea){target.hiddenTextarea.value=event.key;target.hiddenTextarea.setSelectionRange(event.key.length,event.key.length);}
  target.setCoords();canvas.requestRenderAll();
 };
 canvas.upperCanvasEl.tabIndex=0;
 canvas.on('mouse:up',()=>{const target=canvas.getActiveObject();if(target instanceof IText&&!target.isEditing)canvas.upperCanvasEl.focus({preventScroll:true});});
 canvas.upperCanvasEl.addEventListener('keydown',editSelectedText);
 canvas.on('text:editing:exited',({target})=>{if(target instanceof IText){target.set('editable',false);target.setCoords();canvas.requestRenderAll();}});
 canvas.on('text:changed',({target})=>{if(target instanceof IText){target.setCoords();canvas.requestRenderAll();}});
 canvas.on('object:moving',({target})=>{if(target?.lumiqRole==='background')constrainBackground(target);});
 const snapshot=()=>{if(history.length===30)history.shift();history.push(JSON.parse(JSON.stringify(canvas.toObject(['lumiqRole']))));redoHistory=[];};
 canvas.on('path:created',()=>{canvas.isDrawingMode=false;canvas.requestRenderAll();});
 canvas.on('mouse:down',()=>{if(canvas.getActiveObject()||canvas.isDrawingMode)snapshot();});
 const active=()=>canvas.getActiveObject();
 const addText=(text='Your text',{edit=true,role='text',size}={})=>{snapshot();const offset=role==='text'?canvas.getObjects().filter(item=>item.lumiqRole==='text').length:0;const object=new IText(text,{left:width*.5,top:height*Math.min(.46+offset*.075,.82),originX:'center',textAlign:'center',fontSize:size||Math.round(width/18),fontFamily:FONT_STACKS.sans,fill:'#173e32',fontWeight:'600',editable:false,selectable:true,evented:true,hasControls:true,lockMovementX:false,lockMovementY:false,lockScalingX:false,lockScalingY:false,lumiqRole:role,objectCaching:false});canvas.add(object);canvas.setActiveObject(object);object.setCoords();if(edit)beginTextEditing(object);canvas.requestRenderAll();return object;};
 const addEmoji=emoji=>addText(emoji,{edit:false,role:'emoji',size:56});
 const addQr=async()=>{await backgroundReady;if(qrObject){canvas.setActiveObject(qrObject);canvas.requestRenderAll();return;}snapshot();qrObjectUrl=await svgData(qrUrl);qrObject=await imageFromUrl(qrObjectUrl);const size=Math.round(Math.min(width,height)*.28);qrObject.scaleToWidth(size);qrObject.set({left:width*.56,top:height*.56,cornerStyle:'circle',transparentCorners:false,lumiqRole:'qr'});canvas.add(qrObject);canvas.setActiveObject(qrObject);canvas.requestRenderAll();};
 const removeQr=()=>{if(qrObject){snapshot();canvas.remove(qrObject);qrObject=null;canvas.requestRenderAll();}};
 const setDrawing=enabled=>{canvas.isDrawingMode=enabled;if(enabled)canvas.discardActiveObject();canvas.requestRenderAll();};
 const setBrush=(color,size)=>{canvas.freeDrawingBrush.color=color;canvas.freeDrawingBrush.width=Math.max(1,Math.min(80,Number(size)||8));setDrawing(true);};
 const setTextStyle=({color,size,font,bold,align,recordHistory=true}={})=>{const object=active();if(!object||object.lumiqRole==='qr')return;if(recordHistory)snapshot();if(color)object.set('fill',color);if(size)object.set('fontSize',Math.max(8,Math.min(220,Number(size)||32)));if(font)object.set('fontFamily',FONT_STACKS[font]||FONT_STACKS.sans);if(bold!==undefined)object.set('fontWeight',bold?'700':'400');if(align)object.set('textAlign',align);object.initDimensions?.();object.setCoords();canvas.requestRenderAll();};
 const restore=(from,to)=>async()=>{const next=from.pop();if(!next)return;const current=JSON.parse(JSON.stringify(canvas.toObject(['lumiqRole'])));to.push(current);await canvas.loadFromJSON(next);prepareObjectsForEditing();qrObject=canvas.getObjects().find(object=>object.lumiqRole==='qr')||null;canvas.requestRenderAll();};
 const undo=restore(history,redoHistory),redo=restore(redoHistory,history);
 async function addBackground(url){const image=await imageFromUrl(url);const scale=Math.max(width/image.width,height/image.height);image.set({originX:'center',originY:'center',left:width/2,top:height/2,scaleX:scale,scaleY:scale,selectable:true,evented:true,hasControls:false,lockScalingX:true,lockScalingY:true,lockMovementX:false,lockMovementY:false,lumiqRole:'background'});image.setCoords();canvas.add(image);canvas.sendObjectToBack(image);backgroundSource=url;return image;}
 const loadBackground=async url=>{canvas.getObjects().filter(object=>object.lumiqRole==='background').forEach(object=>canvas.remove(object));await addBackground(url);canvas.requestRenderAll();};
 const exportImage=async()=>{await backgroundReady;canvas.discardActiveObject();canvas.requestRenderAll();return await new Promise((resolve,reject)=>canvas.lowerCanvasEl.toBlob(blob=>blob?resolve(blob):reject(new Error('The design could not be exported.')),'image/webp',.9));};
 const loadScene=async scene=>{await canvas.loadFromJSON(scene);prepareObjectsForEditing();qrObject=canvas.getObjects().find(object=>object.lumiqRole==='qr')||null;backgroundSource=canvas.getObjects().find(object=>object.lumiqRole==='background')?.getSrc?.()||backgroundSource;canvas.discardActiveObject();canvas.requestRenderAll();};
 const zoomBackground=factor=>{const image=canvas.getObjects().find(object=>object.lumiqRole==='background');if(!image)return;const min=Math.max(width/image.width,height/image.height),current=Math.max(image.scaleX,image.scaleY),next=Math.max(min,Math.min(min*3,current*factor)),center=image.getCenterPoint();image.set({scaleX:next,scaleY:next,left:center.x,top:center.y});constrainBackground(image);canvas.requestRenderAll();};
 const resetBackground=()=>{const image=canvas.getObjects().find(object=>object.lumiqRole==='background');if(!image)return;image.set({left:width/2,top:height/2});constrainBackground(image);canvas.requestRenderAll();};
 return {canvas,backgroundReady,addText,editText:beginTextEditing,addEmoji,addQr,removeQr,undo,redo,snapshot,setDrawing,setBrush,setTextStyle,loadBackground,loadScene,zoomBackground,resetBackground,exportImage,hasQr:()=>Boolean(qrObject),serialize(){const value=canvas.toObject(['lumiqRole']);if(value.backgroundImage&&backgroundSource)value.backgroundImage.src=backgroundSource;for(const object of value.objects||[]){if(object.lumiqRole==='background')object.src=backgroundSource;if(object.lumiqRole==='qr')object.src=qrUrl;}return value;},dispose(){observer.disconnect();canvas.upperCanvasEl.removeEventListener('keydown',editSelectedText);canvas.dispose();if(qrObjectUrl)URL.revokeObjectURL(qrObjectUrl);}};
}
