import {attachFile} from './media-fs.js'
import {plan} from './media-plan.js'
import {mediaErrorMessage} from './media-errors.js'
self.onmessage=async({data})=>{
  let last=[],bridgeError
  try{
    importScripts(data.coreUrl)
    const core=await self.createFFmpegCore({wasmBinary:new Uint8Array(data.wasm)})
    if(typeof core.fireflyEnsureEncoderStack!=='function')throw new Error('此工具的编码引擎资源较旧，请更新工具包或恢复默认引擎。')
    core.fireflyEnsureEncoderStack()
    core.setLogger(({message})=>{last.push(message);if(last.length>24)last.shift();if(/Duration:|time=/.test(message))self.postMessage({type:'log',message})})
    core.setProgress(({progress})=>self.postMessage({type:'progress',value:Math.max(0,Math.min(.99,progress))}))
    core.FS.mkdir('/media')
    // Preserve native I/O errors even when FFmpeg turns them into a generic codec error.
    const attach=(name,info,write)=>{const getSize=attachFile(core.FS,name,info,write);const node=core.FS.lookupPath('/media/'+name).node;for(const key of ['read','write']){const original=node.stream_ops[key];node.stream_ops[key]=(...args)=>{try{return original(...args)}catch(error){bridgeError=error;throw error}}}return getSize}
    attach('input.'+data.extension,data.input,false)
    if(data.mode==='media.info'){
      core.setTimeout(20000);core.ffprobe('-v','error','-show_streams','-show_format','-of','json','-o','/info.json','/media/input.'+data.extension)
      const raw=core.FS.readFile('/info.json',{encoding:'utf8'});if(raw.length>1048576)throw new Error('媒体信息过大。');const info=JSON.parse(raw);if(!info.format&&!info.streams?.length)throw new Error('无法识别媒体信息。');self.postMessage({type:'done',info});return
    }
    const getSize=attach('output.'+data.options.format,data.output,true)
    const args=plan(data.mode,data.options,'/media/input.'+data.extension,'/media/output.'+data.options.format)
    core.setTimeout(1800000)
    const code=core.exec(...args)
    if(bridgeError||code!==0||!getSize())throw bridgeError??new Error(/matches no streams/.test(last.join(' '))?'所选视频没有可提取的音轨。':`转换失败；请检查文件是否完整、格式是否支持。\n${last.slice(-6).join('\n')}`)
    let duration,videoDuration
    if(['video.edit','audio.edit'].includes(data.mode)){
      try{core.reset();core.setTimeout(20000);core.ffprobe('-v','error','-show_streams','-show_format','-of','json','-o','/result-info.json','/media/output.'+data.options.format);const info=JSON.parse(core.FS.readFile('/result-info.json',{encoding:'utf8'}));const value=Number(info.format?.duration),video=Number(info.streams?.find(stream=>stream.codec_type==='video')?.duration);if(Number.isFinite(value)&&value>0)duration=value;if(Number.isFinite(video)&&video>0)videoDuration=video}catch{/* Metadata is optional; a completed output remains saveable. */}
    }
    self.postMessage({type:'done',size:getSize(),duration,videoDuration})
  }catch(error){self.postMessage({type:'error',message:mediaErrorMessage(error,data.options?.format)})}
}
