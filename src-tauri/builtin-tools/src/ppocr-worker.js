import * as ort from 'onnxruntime-web/wasm'
import {DET,dbPostProcess,ctcDecode,sortBoxes} from './ppocr-data.js'
const canvas=(w,h)=>new OffscreenCanvas(w,h)
const context=c=>c.getContext('2d',{willReadFrequently:true})
function resized(source,w,h,contentWidth=w,contentHeight=h){const c=canvas(w,h),ctx=context(c);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,contentWidth,contentHeight);return ctx.getImageData(0,0,w,h)}
function tensor(image,detect,contentWidth=image.width,contentHeight=image.height){const {width:w,height:h,data}=image,plane=w*h,values=new Float32Array(plane*3);for(let y=0;y<contentHeight;y++)for(let x=0;x<contentWidth;x++){const i=y*w+x;for(let channel=0;channel<3;channel++){const value=data[i*4+2-channel]/255;values[channel*plane+i]=detect?(value-DET.mean[channel])/DET.std[channel]:(value-.5)/.5}}return new ort.Tensor('float32',values,[1,3,h,w])}
function cropQuad(source,quad){const [tl,tr,,bl]=quad,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),br=quad[2],w=Math.max(2,Math.round(Math.max(dist(tl,tr),dist(bl,br)))),h=Math.max(2,Math.round(Math.max(dist(tl,bl),dist(tr,br)))),ux=(tr[0]-tl[0])/w,uy=(tr[1]-tl[1])/w,vx=(bl[0]-tl[0])/h,vy=(bl[1]-tl[1])/h,det=ux*vy-vx*uy;if(!Number.isFinite(det)||Math.abs(det)<1e-9)return null;const c=canvas(w,h),ctx=context(c);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.setTransform(vy/det,-uy/det,-vx/det,ux/det,(vx*tl[1]-vy*tl[0])/det,(uy*tl[0]-ux*tl[1])/det);ctx.drawImage(source,0,0);return c}
async function infer(session,input,preferred='fetch_name_0'){let outputs;try{outputs=await session.run({[session.inputNames.includes('x')?'x':session.inputNames[0]]:input});const value=outputs[session.outputNames.includes(preferred)?preferred:session.outputNames[0]];return {data:Float32Array.from(value.data),dims:[...value.dims]}}finally{input.dispose();if(outputs)for(const output of Object.values(outputs))output.dispose()}}
async function run(data){
 const {wasm,detModel,recModel,keys,image,options}=data
 ort.env.logLevel='error';ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmBinary=new Uint8Array(wasm)
 const chars=['',...keys];if(!chars.includes(' '))chars.push(' ');if(chars.length!==18710)throw new Error('文字字典与模型不匹配。')
 let det,rec,bitmap,source;const report=value=>self.postMessage({type:'progress',value})
 try{
  report(.02);bitmap=await createImageBitmap(new Blob([image],{type:'image/png'}));source=canvas(bitmap.width,bitmap.height);context(source).drawImage(bitmap,0,0);bitmap.close();bitmap=null
  const W=source.width,H=source.height
  let boxes;if(options.mode==='line')boxes=[{quad:[[0,0],[W,0],[W,H],[0,H]],score:1,cx:W/2,cy:H/2,w:W,h:H}]
  else{
   det=await ort.InferenceSession.create(new Uint8Array(detModel),{executionProviders:['wasm'],graphOptimizationLevel:'all'});report(.12)
   const maxSide=options.mode==='small'?1536:960,scale=maxSide/Math.max(W,H),cw=Math.max(1,Math.floor(W*scale)),ch=Math.max(1,Math.floor(H*scale)),w=Math.ceil(cw/32)*32,h=Math.ceil(ch/32)*32
   const output=await infer(det,tensor(resized(source,w,h,cw,ch),true,cw,ch));boxes=dbPostProcess(output.data,output.dims,scale,W,H)
   await det.release();det=null
  }
  if(options.sort)boxes=sortBoxes(boxes);report(.25)
  const lines=[]
  if(boxes.length){rec=await ort.InferenceSession.create(new Uint8Array(recModel),{executionProviders:['wasm'],graphOptimizationLevel:'all'});report(.32)
   for(let index=0;index<boxes.length;index++){
    const box=boxes[index];if(box.w>=4&&box.h>=4){const cropped=cropQuad(source,box.quad);if(cropped){
     const width=Math.min(4096,Math.max(320,Math.ceil(48*cropped.width/cropped.height))),contentWidth=Math.min(width,Math.max(1,Math.ceil(48*cropped.width/cropped.height))),pixels=resized(cropped,width,48,contentWidth,48)
     cropped.width=cropped.height=1
     const output=await infer(rec,tensor(pixels,false,contentWidth,48));const decoded=ctcDecode(output.data,output.dims,chars);if(decoded.text.trim())lines.push({...decoded,box})
    }}report(.32+.65*(index+1)/boxes.length)
   }
  }
  const ratio=Math.min(1,1024/Math.max(W,H)),previewCanvas=canvas(Math.max(1,Math.round(W*ratio)),Math.max(1,Math.round(H*ratio)));context(previewCanvas).drawImage(source,0,0,previewCanvas.width,previewCanvas.height);const preview=new Uint8Array(await(await previewCanvas.convertToBlob({type:'image/png'})).arrayBuffer());previewCanvas.width=previewCanvas.height=1
  return {type:'done',text:lines.map(line=>line.text).join('\n'),score:lines.length?lines.reduce((sum,line)=>sum+line.score,0)/lines.length:0,lines,width:W,height:H,preview}
 }finally{bitmap?.close();if(source)source.width=source.height=1;await det?.release().catch(()=>{});await rec?.release().catch(()=>{})}
}
self.onmessage=async({data})=>{try{const result=await run(data);self.postMessage(result,[result.preview.buffer])}catch(error){const message=/memory|out of bounds|allocation|too large|unreachable/i.test(error.message||'')?'识别引擎内存不足，请缩小选区或改用标准模式后重试。':error.message||'文字识别失败，请重新选择图片。';self.postMessage({type:'error',message})}}
