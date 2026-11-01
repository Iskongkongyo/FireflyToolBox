import {$,status,operation,size} from './common.js'
import {imageSize} from './utility.js'
import {imageType} from './practical.js'
import {IMAGE_INPUT_LIMIT,IMAGE_OUTPUT_LIMIT,animatedImage} from './images.js'
const abortError=()=>new DOMException('已取消','AbortError')
export function checkAbort(signal){if(signal?.aborted)throw abortError()}
export function session(signal,update){const op=operation(signal);let busy=false;return{get busy(){return busy},async run(fn){if(busy)return;busy=true;const current=op.start();document.querySelectorAll('main button,main input,main select,main textarea').forEach(n=>n.disabled=true);$('cancel').hidden=false;$('cancel').disabled=false;try{await fn(current)}catch(e){if(!signal.aborted)status(e.name==='AbortError'?'已取消操作。':e.message||'操作失败，请重试。',e.name!=='AbortError')}finally{if(!signal.aborted){busy=false;document.querySelectorAll('main button,main input,main select,main textarea').forEach(n=>n.disabled=false);$('cancel').hidden=true;update()}}},cancel(){op.cancel()},dispose(){op.dispose()}}}
export async function readImage(file,signal,maxPixels=24000000){
 if(!file.blob.size||file.blob.size>IMAGE_INPUT_LIMIT)throw new Error('图片需大于 0 且不超过 64 MiB。')
 const buffer=await file.blob.slice(0,1024*1024).arrayBuffer();checkAbort(signal);const type=imageType(buffer),dimensions=imageSize(buffer)
 if(dimensions.width*dimensions.height>maxPixels)throw new Error(`图片超过当前允许的 ${Math.round(maxPixels/10000)} 万像素，请减少图片或先缩小尺寸。`)
 if(type.mime==='image/gif')throw new Error('此工具处理静态图片，请选择 PNG、JPEG、WebP 或 BMP；GIF 动画不支持。')
 if(animatedImage(buffer,type.mime))throw new Error('此工具处理静态图片，动画 PNG / WebP 请先转换为静态图片。')
 const url=URL.createObjectURL(new Blob([file.blob],{type:type.mime})),image=new Image()
 try{await new Promise((resolve,reject)=>{let timer;const finish=e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;e?reject(e):resolve()};const abort=()=>{image.removeAttribute('src');finish(abortError())};image.onload=()=>finish();image.onerror=()=>finish(new Error('图片损坏，或当前设备无法读取该图片格式。'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(new Error('读取图片超时，请选择较小的图片。')),30000);if(signal?.aborted){abort();return}image.src=url});checkAbort(signal);const width=image.naturalWidth,height=image.naturalHeight;if(!width||!height||width*height>Math.min(maxPixels,24000000)||width>16384||height>16384)throw new Error('图片尺寸过大或无法读取。');return{name:file.name,blob:file.blob,image,width,height,mime:type.mime,originalWidth:dimensions.width,release(){image.removeAttribute('src');URL.revokeObjectURL(url)}}}catch(e){image.removeAttribute('src');URL.revokeObjectURL(url);throw e}
}
export function newCanvas(width,height,fill){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前设备无法创建图片画布。');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';if(fill){ctx.fillStyle=fill;ctx.fillRect(0,0,width,height)}return{canvas,ctx}}
export async function encodeCanvas(canvas,options,signal){
 checkAbort(signal);return new Promise((resolve,reject)=>{let timer;const finish=(e,blob)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(blob)};const abort=()=>finish(abortError());signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(new Error('生成图片超时，请缩小尺寸后重试。')),60000);try{canvas.toBlob(blob=>{if(signal?.aborted){finish(abortError());return}if(!blob){finish(new Error('图片生成失败，请减小尺寸或更换格式。'));return}if(blob.type!==options.mime){finish(new Error('当前设备不支持该输出格式，请选择 PNG 或 JPEG。'));return}if(blob.size>IMAGE_OUTPUT_LIMIT){finish(new Error(`生成图片为 ${size(blob.size)}，超过 128 MiB 保存上限，请降低质量或缩小尺寸。`));return}finish(null,blob)},options.mime,options.quality)}catch(e){finish(e)}})
}
export function preview(){let url='';return{clear(){if(url)URL.revokeObjectURL(url);url='';$('preview-image').removeAttribute('src');$('result').hidden=true},show(blob,info){this.clear();url=URL.createObjectURL(blob);$('preview-image').src=url;$('result-info').textContent=info;$('result').hidden=false},dispose(){this.clear()}}}
export function resultName(name,suffix,ext){return(name.replace(/\.[^.]+$/,'').slice(0,80)||'image')+suffix+'.'+ext}
