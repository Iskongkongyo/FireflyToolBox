import {$,status,size} from './common.js'
import {mediaTask,seekableFile} from './media-task.js'
import {plan,parseTime,audioFormats,videoFormats} from './media-plan.js'
import {outputName} from './media-job.js'
export function mount({files,resources,tasks,signal}){
 const mode=$('edit-tool').dataset.mode,audio=mode==='audio.edit';let file=null,info=null,result=null,preview=null,busy=false,controller,disposed=false
 $('video-settings').hidden=audio;$('audio-settings').hidden=!audio;$('video-preview').hidden=audio;$('audio-preview').hidden=!audio
 const formats=audio?audioFormats:videoFormats;for(const value of Object.keys(formats)){const option=document.createElement('option');option.value=value;option.textContent=value.toUpperCase();$('format').append(option)}
 const update=()=>{for(const el of document.querySelectorAll('input,select,button'))el.disabled=busy;$('process').disabled=busy||!file;$('save').disabled=busy||!result;$('cancel').disabled=false;$('cancel').hidden=!busy}
 async function clear(){const old=result,reader=preview;result=preview=null;for(const id of ['video-preview','audio-preview']){const player=$(id);player.pause();player.removeAttribute('src');player.load()}$('result').hidden=true;await reader?.close();await old?.abort()}
 async function job(work){if(busy||disposed)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){status(error.name==='AbortError'?'已取消，可重新剪辑。':error.message,true)}finally{signal.removeEventListener('abort',abort);controller=null;busy=false;if(!disposed)update()}}
 $('choose').onclick=()=>void job(async current=>{let next=await files.open({extensions:[],signal:current});if(!next)return;next=await seekableFile(next,files,current);try{status('正在读取媒体信息…');const meta=await tasks.run('读取剪辑信息',context=>mediaTask(context,resources,next,'media.info'),{signal:current,timeoutMs:60000});await file?.close();file=next;info=meta.info;await clear();const duration=Number(info.format?.duration??0);$('end').value=Number.isFinite(duration)&&duration>0?duration.toFixed(3):'5';$('source-info').textContent=`${file.name} · ${size(file.size)} · 时长 ${duration||'未提供'} 秒`;status('设置片段起止时间后剪辑。')}catch(error){await next.close();throw error}})
 for(const el of document.querySelectorAll('input,select'))el.oninput=()=>{void clear();update()}
 $('process').onclick=()=>void job(async current=>{
  const options={format:$('format').value,quality:$('quality').value,resolution:0,start:$('start').value,end:$('end').value,fadeIn:$('fade-in').value,fadeOut:$('fade-out').value,x:$('x').value,y:$('y').value,width:$('width').value,height:$('height').value,rotation:$('rotation').value,mirror:$('mirror').checked,mute:$('mute').checked}
  plan(mode,options)
  const duration=Number(info?.format?.duration),selectedDuration=parseTime(options.end)-parseTime(options.start)
  if(Number.isFinite(duration)&&duration>0&&parseTime(options.end)>duration+.05)throw new Error('结束时间超出媒体时长。')
  const video=info?.streams?.find(stream=>stream.codec_type==='video')
  if(!audio&&Number(options.width)&&video&&(Number(options.x)+Number(options.width)>video.width||Number(options.y)+Number(options.height)>video.height))throw new Error('裁剪区域超出原视频尺寸。')
  await clear()
  const writer=await files.createWriter(outputName(file.name,'-edited',options.format))
  try{
   const completed=await tasks.run(audio?'音频剪辑':'视频剪辑',context=>{status('正在剪辑并编码…');return mediaTask(context,resources,file,mode,options,writer)},{signal:current,timeoutMs:1800000})
   preview=await writer.preview({signal:current});result=writer;$('result').hidden=false
   const actual=Number(completed.duration),known=Number.isFinite(actual)&&actual>0
   $('result-info').textContent=`${known?'实际时长 '+actual.toFixed(3):'所选区间 '+selectedDuration} 秒 · ${size(preview.size)}`
   const supported=['mp4','webm','mp3','m4a','wav','flac','ogg','opus'].includes(options.format)
   if(supported){const player=$(audio?'audio-preview':'video-preview');player.src=preview.url;player.load()}
   status(known&&actual<selectedDuration-.15?'剪辑完成。输出短于所选区间，可能是原文件画面或音轨提前结束；可保存后检查。':supported?'剪辑完成，可预览并保存。':'剪辑完成，请保存后使用支持该格式的播放器查看。')
  }catch(error){if(result===writer)await clear();else await writer.abort();throw error}
 })
 $('save').onclick=()=>void job(async current=>{if(result&&await result.save({signal:current})){result=null;status('文件已保存。')}else status('已取消保存。')});$('cancel').onclick=()=>controller?.abort();update();return()=>{disposed=true;controller?.abort();void file?.close();void clear()}
}
