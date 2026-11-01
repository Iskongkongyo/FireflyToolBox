import {$,status,size} from './common.js'
import {workerRequest,outputName} from './media-job.js'
import {plan,videoFormats,audioFormats} from './media-plan.js'
export function mount({files,resources,tasks,signal}){
  const mode=$('media-tool').dataset.mode
  let input=null,output=null,preview=null,controller=null,busy=false,disposed=false,previewUrl=''
  const audio=mode==='video.audio'||mode.startsWith('audio.'),advancedAudio=mode.startsWith('audio.'),gif=mode==='video.gif',fromGif=mode==='gif.video'
  const formats=gif?{gif:[]}:mode==='audio.compress'?{mp3:[],m4a:[],ogg:[],opus:[]}:audio?audioFormats:fromGif?{mp4:[],webm:[]}:videoFormats
  $('format').replaceChildren(...Object.keys(formats).map(value=>{const option=document.createElement('option');option.value=value;option.textContent=value.toUpperCase();return option}))
  $('resolution-field').hidden=audio;$('gif-settings').hidden=!gif
  $('audio-settings').hidden=!advancedAudio
  $('speed-settings').hidden=!mode.endsWith('.speed');$('mute-field').hidden=mode!=='video.speed'
  if(mode==='video.speed')$('resolution').value='0'
  if(mode==='audio.compress')$('quality').value='small'
  if(gif)$('resolution').value='360'
  $('source-info').textContent=fromGif?'选择 GIF 动图，保留单次动画的帧时间。':advancedAudio?'支持 MP3、M4A、AAC、WAV、FLAC、OGG、Opus、WMA、AIFF 等音频。单个文件最多 2 GiB。':'支持 MP4、MOV、WebM、MKV、AVI 等常见视频。单个文件最多 2 GiB。'
  if(advancedAudio)$('usage-hint').textContent='降低码率、采样率或改为单声道可缩小音频。有损格式再次压缩会损失音质；WAV / FLAC 不使用码率档位，OGG 按音质使用可变码率。Opus 支持 8 / 16 / 24 / 48 kHz，低采样率 MP3 最高 160 kbps。文件读写上限 2 GiB。'
  const update=()=>{
    const format=$('format').value,lossless=['wav','flac'].includes(format)
    for(const el of document.querySelectorAll('input,select,#choose'))el.disabled=busy
    if(audio&&(lossless||(advancedAudio&&format!=='ogg'&&Number($('bitrate').value)>0)))$('quality').disabled=true
    $('bitrate').disabled=busy||lossless||format==='ogg'
    for(const option of $('sample-rate').options)option.disabled=format==='opus'&&![0,8000,16000,24000,48000].includes(Number(option.value))
    if(format==='opus'&&![0,8000,16000,24000,48000].includes(Number($('sample-rate').value)))$('sample-rate').value='48000'
    $('process').disabled=busy||!input;$('save').disabled=busy||!output;$('cancel').hidden=!busy
  }
  async function clearResult(){const old=output,reader=preview;output=preview=null;$('result').hidden=true;for(const el of [$('preview'),$('preview-audio')]){el.pause();el.removeAttribute('src');el.load()}$('preview-image').removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';await reader?.close();await old?.abort()}
  async function job(work){if(busy||disposed)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){status(error.name==='AbortError'?'已取消，可重新处理。':error.message,true)}finally{signal.removeEventListener('abort',abort);busy=false;controller=null;if(!disposed)update()}}
  $('choose').onclick=()=>void job(async current=>{
    const next=await files.open({extensions:fromGif?['gif']:advancedAudio?['mp3','m4a','aac','wav','flac','ogg','opus','wma','aiff','aif','amr','webm']:['mp4','mov','webm','mkv','avi','m4v','mpg','mpeg','flv','wmv','ts','3gp'],signal:current})
    if(!next){status('已取消选择。');return}
    if(!next.seekable||!next.url){
      // Cloud providers may expose a pipe. Make one bounded, cancelable disk copy.
      const scratch=await files.createWriter(next.name.slice(0,120))
      try{status('正在准备文件…');await scratch.write(next.stream({signal:current}),{signal:current});const reader=await scratch.preview({signal:current});await scratch.abort();await next.close();await input?.close();input=reader}catch(error){await scratch.abort();await next.close();throw error}
    }else{await input?.close();input=next}
    await clearResult();$('source-info').textContent=`${input.name} · ${size(input.size)}`;status('文件已选择，设置参数后开始转换。')
  })
  for(const el of document.querySelectorAll('input,select'))el.oninput=()=>{void clearResult();update();status('参数已更新。')}
  $('process').onclick=()=>void job(async current=>{
    if(!input)return
    const options={format:$('format').value,quality:$('quality').value,resolution:$('resolution').value,fps:$('fps').value,start:$('start').value,duration:$('duration').value,bitrate:$('bitrate').value,sampleRate:$('sample-rate').value,channels:$('channels').value,speed:$('speed').value,keepPitch:$('keep-pitch').checked,mute:$('mute').checked}
    plan(mode,options) // Validate before loading any large engine asset.
    await clearResult();$('progress').value=0;$('detail').textContent='';const name=outputName(input.name,'-converted',options.format),writer=await files.createWriter(name)
    try{
      await tasks.run($('media-tool').getAttribute('aria-label'),async context=>{
        status('正在加载离线转换引擎…');context.report(.01)
        const coreUrl=await resources.url('engine/ffmpeg-core.js',{signal:context.signal}),wasm=await (await resources.blob('engine/ffmpeg-core.wasm',{signal:context.signal})).arrayBuffer()
        const worker=await context.worker('engine/media-worker.js')
        await workerRequest(worker,{coreUrl,wasm,mode,options,extension:input.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase()??(fromGif?'gif':'mp4'),input:{url:input.url,size:input.size},output:{url:writer.workspaceUrl,size:0}},
          {...context,report:value=>{context.report(value);$('progress').value=value;status(`正在转换… ${Math.round(value*100)}%`)},onLog:message=>{$('detail').textContent=message.slice(0,200)}},[wasm])
      },{signal:current,timeoutMs:1800000})
      preview=await writer.preview({signal:current});output=writer
      $('result').hidden=false;$('result-info').textContent=`${name} · ${size(input.size)} → ${size(preview.size)}`
      $('preview').hidden=gif||audio;$('preview-audio').hidden=!audio;$('preview-image').hidden=!gif
      if(gif){if(preview.size<=16*1048576){previewUrl=URL.createObjectURL(await preview.blob({maxBytes:16*1048576,signal:current}));$('preview-image').src=previewUrl}else{$('preview-image').hidden=true;$('detail').textContent='GIF 大于 16 MiB，请保存后查看动图。'}}
      else if(['mp4','webm','mp3','m4a','wav','flac','ogg','opus'].includes(options.format)){const player=audio?$('preview-audio'):$('preview');player.src=preview.url;player.load()}
      else $('detail').textContent='该格式可保存后在支持它的播放器中打开。'
      $('progress').value=1
      status(['video.compress','audio.compress'].includes(mode)&&preview.size>=input.size?'处理完成，输出比原文件大；可降低质量或调整压缩参数后重试。':'处理完成，可以预览并保存。')
    }catch(error){if(output===writer)await clearResult();else await writer.abort();throw error}
  })
  $('save').onclick=()=>void job(async current=>{if(output&&await output.save({signal:current})){output=null;status('文件已保存。')}else status('已取消保存，可以再次保存。')})
  $('cancel').onclick=()=>controller?.abort()
  update()
  return()=>{disposed=true;controller?.abort();void input?.close();void clearResult()}
}
