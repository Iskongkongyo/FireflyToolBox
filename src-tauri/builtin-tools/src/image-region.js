import {regionRect,dragRegion} from './image-region-plan.js'
export function createImageRegion({canvas,fields,editor,resetButton,enabled,onChange,onError}){
 const context=canvas.getContext('2d');if(!context)throw new Error('设备不支持选区预览。')
 let info=null,image=null,drag=null
 function selection(){if(!info)throw new Error('请先选择图片。');return regionRect(fields.left.value,fields.top.value,fields.width.value,fields.height.value,info.width,info.height)}
 function paint(){
  if(!image)return
  context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0)
  try{const rect=selection(),sx=canvas.width/info.width,sy=canvas.height/info.height,x=rect.left*sx,y=rect.top*sy,w=rect.width*sx,h=rect.height*sy
   context.fillStyle='rgba(0,0,0,.24)';context.fillRect(0,0,canvas.width,y);context.fillRect(0,y+h,canvas.width,canvas.height-y-h);context.fillRect(0,y,x,h);context.fillRect(x+w,y,canvas.width-x-w,h)
   context.strokeStyle='#20a674';context.lineWidth=2;context.strokeRect(x,y,w,h)
  }catch{}
 }
 function set(rect){for(const [key,value]of Object.entries(rect))fields[key].value=String(value);for(const field of Object.values(fields))field.removeAttribute('aria-invalid');paint();onChange(rect)}
 function point(event){const box=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(info.width,(event.clientX-box.left)*info.width/box.width)),y:Math.max(0,Math.min(info.height,(event.clientY-box.top)*info.height/box.height))}}
 for(const field of Object.values(fields))field.oninput=()=>{paint();try{const rect=selection();for(const field of Object.values(fields))field.removeAttribute('aria-invalid');onChange(rect)}catch(error){field.setAttribute('aria-invalid','true');onError(error)}}
 resetButton.onclick=()=>{if(info&&enabled())set({left:0,top:0,width:info.width,height:info.height})}
 canvas.onpointerdown=event=>{if(!info||!enabled()||drag||event.isPrimary===false||event.button>0)return;event.preventDefault();drag={id:event.pointerId,start:point(event),clientX:event.clientX,clientY:event.clientY};canvas.setPointerCapture(event.pointerId)}
 canvas.onpointermove=event=>{if(!drag||drag.id!==event.pointerId||!enabled())return;if(!drag.moved&&Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY)<3)return;drag.moved=true;set(dragRegion(drag.start,point(event),info.width,info.height))}
 canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=event=>{if(drag?.id===event.pointerId)drag=null}
 return {
  get ready(){return !!info},selection,
  setSource(nextInfo,nextImage){info=nextInfo;image=nextImage;drag=null;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;editor.hidden=false;fields.left.max=info.width-1;fields.top.max=info.height-1;fields.width.max=info.width;fields.height.max=info.height;set({left:0,top:0,width:info.width,height:info.height})},
  dispose(){drag=null;info=image=null;canvas.width=canvas.height=1;editor.hidden=true},
 }
}
