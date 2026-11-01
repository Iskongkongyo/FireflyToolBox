import {$,status,size} from './common.js'
import {outputName} from './media-job.js'
import {runImage} from './image-task.js'
import {ENGINE_INPUT_BYTES} from './image-limits.js'
export function mountConversion({files,resources,tasks,signal},compress=false){
 let original=null,result=null,controller=null,busy=false,previewUrl='',disposed=false
 const update=()=>{for(const el of document.querySelectorAll('input,select,#choose'))el.disabled=busy;$('process').disabled=busy||!original;$('save').disabled=busy||!result;$('cancel').hidden=!busy;$('quality').disabled=busy||['png','bmp','tiff','ico','gif'].includes($('format').value)}
 const invalidate=()=>{const old=result;result=null;void old?.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('preview-image').removeAttribute('src');$('result').hidden=true;update()}
 async function job(work){if(busy||disposed||signal.aborted)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){if(!disposed&&!signal.aborted)status(error.name==='AbortError'?'已取消，可重新处理。':error.message,true)}finally{signal.removeEventListener('abort',abort);busy=false;controller=null;if(!disposed)update()}}
 $('choose').onclick=()=>void job(async current=>{
  const file=await files.open({extensions:[],signal:current});if(!file){status('已取消选择。');return}
  if(file.size>ENGINE_INPUT_BYTES){await file.close();throw new Error('图片文件最多 256 MiB。')}
  current.throwIfAborted();await original?.close();original=file;invalidate();$('source-info').textContent=`${file.name} · ${file.size?size(file.size):'大小待读取'}`;status('图片已选择。动画、多页图片将处理首帧。')
 })
 for(const id of ['format','quality',...(!compress?['background','edge']:[])])$(id).oninput=()=>{invalidate();status('')}
 if(!compress){const color=value=>{$('color-hex').value=value;if(/^#[0-9a-f]{6}$/i.test(value)){$('color').value=value;$('background').value='color'}invalidate()};$('color').oninput=()=>color($('color').value);$('color-hex').oninput=()=>color($('color-hex').value.trim())}
 $('process').onclick=()=>void job(async current=>{
  if(!original)return;invalidate()
  const options={format:$('format').value,quality:$('quality').value,background:compress?'transparent':$('background').value,color:compress?'#ffffff':$('color-hex').value.trim(),edge:compress?0:$('edge').value}
  const writer=await files.createWriter(outputName(original.name,compress?'-compressed':'-converted',options.format==='jpeg'?'jpg':options.format))
  try{
   const converted=await tasks.run(compress?'压缩图片':'转换图片',async context=>{status('正在读取图片并处理…');return runImage(context,resources,original,writer,options)},{signal:current,timeoutMs:600000})
   current.throwIfAborted();result=writer;previewUrl=URL.createObjectURL(new Blob([converted.preview],{type:'image/png'}));$('preview-image').src=previewUrl;$('result').hidden=false
   let note=`${converted.width} × ${converted.height} · ${options.format.toUpperCase()} · ${size(original.size)} → ${size(writer.bytesWritten)}`
   if(compress&&original.size){const percent=(1-writer.bytesWritten/original.size)*100;note+=percent>=0?` · 减少 ${percent.toFixed(1)}%`:` · 增大 ${(-percent).toFixed(1)}%`}
   $('result-info').textContent=note;status(compress&&writer.bytesWritten>=original.size?'输出比原图大，可降低质量后重试。':'处理完成，可以保存图片。')
  }catch(error){await writer.abort();throw error}
 })
 $('save').onclick=()=>void job(async current=>{if(result&&await result.save({signal:current})){result=null;status('图片已保存。')}else status('已取消保存，可以再次保存。')})
 $('cancel').onclick=()=>controller?.abort();update()
 return()=>{disposed=true;controller?.abort();void original?.close();invalidate()}
}
