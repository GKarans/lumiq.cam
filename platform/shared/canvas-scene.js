export function normalizeCanvasScene(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const scene=JSON.parse(JSON.stringify(value));
 if(!Array.isArray(scene.objects)||scene.objects.length>80||JSON.stringify(scene).length>140_000)return null;
 const allowed=new Set(['IText','Textbox','Text','Path','Image','Rect','Circle','Ellipse','Line','Triangle','Polygon']);
 if(scene.objects.some(object=>!object||!allowed.has(object.type)))return null;
 return scene;
}
