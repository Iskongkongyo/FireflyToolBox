import {$,status,size,operation,workerJob} from './common.js'
import {BASE64_TEXT_LIMIT} from './practical.js'
import {BASE64_PREVIEW_CHARS} from './imagebase64-data.js'
import {openBase64File} from './imagebase64-io.js'
import {saveBlob} from './image-file-io.js'

export function mount({files,copyText,signal}){
 const op=operation(signal)
 let imageBlob=null,imageName='',objectURL='',rawBlob=null,textBlob=null,busy=false
 const controls=['mode','format','content','open-image','open-text','decode','clear','copy','save-text','save-image']
 function availability(){
  for(const id of ['copy','save-text'])$(id).disabled=busy||!(textBlob?.size||$('content').value.trim())
  $('save-image').disabled=busy||!imageBlob
 }
 function discardImage(){
  if(objectURL)URL.revokeObjectURL(objectURL)
  objectURL='';imageBlob=null;imageName='';rawBlob=null
  $('image').removeAttribute('src');$('preview').hidden=true;availability()
 }
 function clear(){discardImage();textBlob=null;$('content').value='';$('content').readOnly=$('mode').value==='encode';$('content-info').textContent='';availability()}
 async function showText(blob,current){
  const value=await blob.slice(0,BASE64_PREVIEW_CHARS).text();current.throwIfAborted()
  textBlob=blob;$('content').value=value
  const partial=blob.size>BASE64_PREVIEW_CHARS
  $('content').readOnly=$('mode').value==='encode'||partial
  $('content-info').textContent=partial?`完整文本 ${size(blob.size)}，仅预览前 256 KiB；复制、保存和还原均使用完整内容。大文本请通过“打开 Base64 文本”导入。`:''
  availability()
 }
 async function output(current){
  if(!rawBlob)return
  const prefix=$('format').value==='url'?`data:${imageBlob.type};base64,`:''
  await showText(new Blob([prefix,rawBlob],{type:'text/plain;charset=utf-8'}),current)
 }
 async function task(fn){
  if(busy)return
  busy=true;const current=op.start();controls.forEach(id=>$(id).disabled=true);$('cancel').hidden=false
  try{await fn(current)}
  catch(e){if(!signal.aborted)status(e.name==='AbortError'?'已取消操作。':e.message||'操作失败，请重试。',e.name!=='AbortError')}
  finally{if(!signal.aborted){busy=false;controls.forEach(id=>$(id).disabled=false);$('cancel').hidden=true;availability()}}
 }
 async function present(blob,name,result,current){
  let url='',previewNote=''
  if(result.canPreview){
   url=URL.createObjectURL(blob);const probe=new Image()
   try{await new Promise((resolve,reject)=>{
    let timer;const finish=e=>{clearTimeout(timer);current.removeEventListener('abort',abort);probe.onload=probe.onerror=null;e?reject(e):resolve()}
    const abort=()=>{probe.removeAttribute('src');finish(new DOMException('已取消','AbortError'))}
    probe.onload=()=>finish();probe.onerror=()=>finish(new Error('当前设备无法预览此图片'))
    current.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(new Error('预览超时')),30000)
    if(current.aborted){abort();return}probe.src=url
   })}catch(e){URL.revokeObjectURL(url);url='';if(e.name==='AbortError')throw e;previewNote=' · 预览不可用，仍可转换与保存'}
   finally{probe.removeAttribute('src')}
  }else previewNote=' · 尺寸超过预览范围或无法读取，仍可转换与保存'
  if(current.aborted){if(url)URL.revokeObjectURL(url);current.throwIfAborted()}
  discardImage();objectURL=url;imageBlob=blob;imageName=name;rawBlob=result.textBlob||null
  $('image').hidden=!url;if(url)$('image').src=url
  $('image-info').textContent=`${name}${result.width?` · ${result.width} × ${result.height}`:''} · ${size(blob.size)}${previewNote}`
  $('preview').hidden=false
  if(rawBlob)await output(current)
  availability()
 }
 $('open-image').onclick=()=>void task(async current=>{
  const file=await openBase64File(files,'image',current);if(!file){status('已取消选择。');return}
  status('正在分块转换图片…')
  const result=await workerJob(IMAGEBASE64_WORKER_SOURCE,{mode:'encode',blob:file.blob},current,120000)
  await present(new Blob([file.blob],{type:result.mime}),file.name,result,current);status('已生成 Base64。')
 })
 $('decode').onclick=()=>void task(async current=>{
  status('正在分块还原图片…')
  const blob=textBlob||new Blob([$('content').value],{type:'text/plain;charset=utf-8'})
  const result=await workerJob(IMAGEBASE64_WORKER_SOURCE,{mode:'decode',blob},current,120000)
  await present(result.imageBlob,`image.${result.ext}`,result,current);status('图片已还原，可保存到设备。')
 })
 $('open-text').onclick=()=>void task(async current=>{
  const file=await openBase64File(files,'text',current);if(!file){status('已取消选择。');return}
  await showText(file.blob,current);discardImage();status('文本已打开，点击“还原图片”查看结果。')
 })
 $('format').onchange=()=>void task(output)
 $('content').oninput=()=>{textBlob=null;$('content-info').textContent='';discardImage();status('')}
 $('mode').onchange=()=>{
  clear();const decode=$('mode').value==='decode'
  $('encode-controls').hidden=decode;$('decode-controls').hidden=!decode
  $('content').placeholder=decode?'粘贴纯 Base64 或 data:image/...;base64,...；大文本可打开文件':'选择图片后将在这里生成 Base64'
  status('')
 }
 $('clear').onclick=()=>{clear();status('')}
 $('copy').onclick=()=>void task(async current=>{
  const value=textBlob?await textBlob.text():$('content').value;current.throwIfAborted()
  await copyText(value);status('已复制完整 Base64。')
 })
 $('save-text').onclick=()=>void task(async current=>{
  const blob=textBlob||new Blob([$('content').value],{type:'text/plain;charset=utf-8'})
  const saved=await saveBlob(files,'image-base64.txt',blob,current,BASE64_TEXT_LIMIT)
  status(saved?'完整 Base64 已保存。':'已取消保存。')
 })
 $('save-image').onclick=()=>void task(async current=>{
  const saved=await saveBlob(files,imageName,imageBlob,current)
  status(saved?'图片已保存。':'已取消保存。')
 })
 $('cancel').onclick=()=>op.cancel()
 const abort=()=>op.cancel();signal.addEventListener('abort',abort,{once:true})
 return()=>{signal.removeEventListener('abort',abort);op.dispose();clear()}
}
