import {$,status,size} from './common.js'
import {outputName} from './media-job.js'
import {imageBytes,runImage,inspectImage} from './image-task.js'
import {createImageRegion} from './image-region.js'
import {ENGINE_INPUT_BYTES} from './image-limits.js'
function textWatermark(value,color){
 const text=value.trim();if(!text||[...text].length>80||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('请输入 1～80 字的水印文字并选择有效颜色。')
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw new Error('设备不支持文字绘制。')
 const font=px=>`700 ${px}px system-ui,"Microsoft YaHei","Noto Sans CJK SC",sans-serif`
 ctx.font=font(96);const fontSize=Math.max(12,Math.min(96,Math.floor(4032/Math.max(1,ctx.measureText(text).width)*96)))
 ctx.font=font(fontSize);canvas.width=Math.min(4096,Math.ceil(ctx.measureText(text).width)+24);canvas.height=Math.ceil(fontSize*1.8)+24
 ctx.font=font(fontSize);ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,12,canvas.height/2)
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?blob.arrayBuffer().then(value=>resolve(new Uint8Array(value)),reject):reject(new Error('无法生成文字水印。')),'image/png'))
}
function hexColor(value){const hex=value.trim().replace(/^#/,'');if(!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex))throw new Error('文字颜色请输入 3 或 6 位十六进制颜色，如 #ffffff。');return '#'+(hex.length===3?[...hex].map(ch=>ch+ch).join(''):hex).toLowerCase()}
export function mount({files,resources,tasks,signal}){
 const mode=$('effects-tool').dataset.mode,isWatermark=mode==='image.watermark'
 let original=null,markFile=null,result=null,controller=null,busy=false,disposed=false,previewUrl='',sourceUrl=''
 const region=isWatermark?null:createImageRegion({canvas:$('pixelate-canvas'),editor:$('pixelate-editor'),resetButton:$('pixelate-reset'),fields:Object.fromEntries(['left','top','width','height'].map(key=>[key,$('pixelate-'+key)])),enabled:()=>!busy&&!disposed,onChange:()=>{invalidate();status('选区已更新，重新处理可预览效果。')},onError:error=>{invalidate();status(error.message,true)}})
 $('watermark-settings').hidden=!isWatermark;$('pixelate-settings').hidden=isWatermark
 const update=()=>{
  for(const el of document.querySelectorAll('input,select,#choose,#choose-mark'))el.disabled=busy
  $('text-settings').hidden=$('mark-type').value!=='text';$('logo-settings').hidden=$('mark-type').value!=='image'
  $('quality').disabled=busy||$('format').value==='png';$('process').disabled=busy||!original||(!isWatermark&&!region.ready);$('save').disabled=busy||!result;$('cancel').hidden=!busy;$('pixelate-reset').disabled=busy||!region?.ready
 }
 const invalidate=()=>{const old=result;result=null;void old?.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('preview-image').removeAttribute('src');$('result').hidden=true;update()}
 async function job(work){if(busy||disposed||signal.aborted)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){if(!disposed&&!signal.aborted)status(error.name==='AbortError'?'已取消，可以重新处理。':error.message,true)}finally{signal.removeEventListener('abort',abort);controller=null;busy=false;if(!disposed)update()}}
 async function choose(watermark,current){
  const next=await files.open({extensions:[],signal:current});if(!next){status('已取消选择。');return}
  const limit=watermark?16*1048576:ENGINE_INPUT_BYTES
  if(next.size>limit){await next.close();throw new Error(`文件最多 ${limit/1048576} MiB。`)}
  if(watermark){await markFile?.close();markFile=next;$('mark-info').textContent=next.name;}
  else{
   let nextUrl=''
   try{
    let inspected,nextImage
    if(!isWatermark){status('正在生成原图选区预览…');inspected=await tasks.run('读取原图预览',context=>inspectImage(context,resources,next),{signal:current,timeoutMs:600000});nextUrl=URL.createObjectURL(new Blob([inspected.preview],{type:'image/png'}));nextImage=new Image();nextImage.src=nextUrl;await nextImage.decode()}
    current.throwIfAborted();await original?.close();original=next;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=nextUrl
    if(inspected)region.setSource(inspected,nextImage)
    $('source-info').textContent=`${next.name} · ${next.size?size(next.size):'大小待读取'}${inspected?` · 原图 ${inspected.width} × ${inspected.height}`:''}`
   }catch(error){if(nextUrl)URL.revokeObjectURL(nextUrl);await next.close();throw error}
  }
  invalidate();status('文件已选择，设置参数后开始处理。')
 }
 $('choose').onclick=()=>void job(current=>choose(false,current));$('choose-mark').onclick=()=>void job(current=>choose(true,current))
 for(const el of document.querySelectorAll('input:not([data-region-field]),select'))el.oninput=()=>{invalidate();status('参数已更新，重新处理可预览效果。')}
 $('mark-color').oninput=$('mark-color').onchange=()=>{$('mark-color-hex').value=$('mark-color').value;$('mark-color-hex').removeAttribute('aria-invalid');invalidate();status('文字颜色已更新。')}
 $('mark-color-hex').oninput=()=>{try{$('mark-color').value=hexColor($('mark-color-hex').value);$('mark-color-hex').removeAttribute('aria-invalid');status('文字颜色已更新。')}catch{$('mark-color-hex').setAttribute('aria-invalid','true');status('请输入 3 或 6 位十六进制颜色，如 #ffffff。')}invalidate()}
 $('mark-color-hex').onchange=()=>{try{$('mark-color-hex').value=hexColor($('mark-color-hex').value)}catch(error){status(error.message,true)}}
 $('process').onclick=()=>void job(async current=>{
  if(!original)return;invalidate()
  const options={mode,format:$('format').value,quality:$('quality').value,block:$('block').value,position:$('position').value,opacity:$('opacity').value,size:$('mark-size').value,angle:$('angle').value}
  if(!isWatermark)options.region=region.selection()
  if(isWatermark&&$('mark-type').value==='image'&&!markFile)throw new Error('请先选择水印图片。')
  const color=isWatermark&&$('mark-type').value==='text'?hexColor($('mark-color-hex').value):''
  const writer=await files.createWriter(outputName(original.name,isWatermark?'-watermark':'-pixelated',options.format==='jpeg'?'jpg':options.format))
  try{
   const converted=await tasks.run(isWatermark?'添加图片水印':'图片像素化',async context=>{
    status('正在处理图片…')
    let watermark
    if(isWatermark){
     if($('mark-type').value==='text'){watermark=await textWatermark($('mark-text').value,color);options.watermarkExtension='png'}
     else {watermark=await imageBytes(markFile,context.signal,16*1048576);options.watermarkExtension=markFile.name.split('.').pop().toLowerCase()}
    }
    return runImage(context,resources,original,writer,options,watermark)
   },{signal:current,timeoutMs:600000})
   current.throwIfAborted();result=writer;previewUrl=URL.createObjectURL(new Blob([converted.preview],{type:'image/png'}));$('preview-image').src=previewUrl;$('result').hidden=false
   $('result-info').textContent=`${converted.width} × ${converted.height} · ${size(writer.bytesWritten)} · ${isWatermark?'水印已添加':`像素块 ${options.block} px · 选区 ${options.region.left}, ${options.region.top} / ${options.region.width} × ${options.region.height}`}`
   status('处理完成，可以查看预览并保存图片。')
  }catch(error){await writer.abort();throw error}
 })
 $('save').onclick=()=>void job(async current=>{if(result&&await result.save({signal:current})){result=null;status('图片已保存。')}else status('已取消保存，可以再次保存。')})
 $('cancel').onclick=()=>controller?.abort();update()
 return()=>{disposed=true;controller?.abort();void original?.close();void markFile?.close();if(sourceUrl)URL.revokeObjectURL(sourceUrl);region?.dispose();invalidate()}
}
