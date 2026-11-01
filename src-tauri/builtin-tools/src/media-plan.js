// Shared command builder. Native paths and command strings never come from a tool.
export const videoFormats = {mp4:['libx264','aac'],webm:['libvpx','libopus'],mkv:['libx264','aac'],mov:['libx264','aac'],avi:['mpeg4','libmp3lame']}
export const audioFormats = {mp3:['libmp3lame','audio/mpeg'],m4a:['aac','audio/mp4'],wav:['pcm_s16le','audio/wav'],flac:['flac','audio/flac'],ogg:['libvorbis','audio/ogg'],opus:['libopus','audio/ogg']}
export function parseTime(value){const text=String(value??'').trim();if(!text)throw new Error('请输入时间。');const parts=text.split(':');if(parts.length>3||parts.some(part=>!/^\d+(?:\.\d+)?$/.test(part))||parts.slice(1).some(part=>Number(part)>=60))throw new Error('时间格式须为秒数或 HH:MM:SS。');const result=parts.reduce((sum,part)=>sum*60+Number(part),0);if(!Number.isFinite(result)||result>86400)throw new Error('时间须在 0～24 小时内。');return result}
export function speedFilter(rate,keepPitch=true){
  rate=Number(rate);if(!Number.isFinite(rate)||rate<.25||rate>4)throw new Error('倍速须在 0.25～4 之间。')
  if(!keepPitch)return `aresample=48000,asetrate=${48000*rate},aresample=48000`
  const parts=[];while(rate>2){parts.push('atempo=2');rate/=2}while(rate<.5){parts.push('atempo=0.5');rate/=.5}parts.push(`atempo=${rate}`);return parts.join(',')
}
export function plan(mode, options, input='input.mp4', output='output.mp4') {
  const quality=options.quality??'balanced',resolution=Number(options.resolution??720),fps=Number(options.fps??15)
  if(!['high','balanced','small'].includes(quality)||![0,1080,720,480,360,240].includes(resolution))throw new Error('清晰度或质量无效。')
  const crf={high:20,balanced:26,small:32}[quality],bitrate={high:'192k',balanced:'128k',small:'96k'}[quality]
  // Fit the long/short edges into the selected landscape or portrait box, never upscale.
  const scale=resolution?`scale=w='if(gte(iw,ih),min(iw,${Math.round(resolution*16/9)}),min(iw,${resolution}))':h='if(gte(iw,ih),min(ih,${resolution}),min(ih,${Math.round(resolution*16/9)}))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`:'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1'
  const args=['-hide_banner','-loglevel','info','-threads','1','-filter_threads','1','-filter_complex_threads','1','-fflags','+genpts']
  const editing=['video.edit','audio.edit'].includes(mode);let duration=0
  if(editing){const start=parseTime(options.start),end=parseTime(options.end);duration=end-start;if(duration<=0)throw new Error('结束时间必须大于起点。');args.push('-ss',String(start));}
  if(mode==='video.gif'){
    const start=Number(options.start??0),duration=Number(options.duration??5)
    if(!Number.isFinite(start)||start<0||start>86400||!Number.isFinite(duration)||duration<=0||duration>60||!Number.isInteger(fps)||fps<1||fps>30)throw new Error('GIF 片段须为 0～24 小时内的起点、1～60 秒时长，帧率须为 1～30。')
    const colors={high:256,balanced:128,small:64}[quality],dither=quality==='small'?'bayer:bayer_scale=3':'sierra2_4a'
    // Per-frame palettes avoid buffering the whole clip while waiting for a final palette.
    args.push('-ss',String(start),'-i',input,'-t',String(duration),'-an','-filter_complex',`fps=${fps},${scale},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=single[p];[b][p]paletteuse=new=1:dither=${dither}`,'-loop','0',output)
  }else if(['video.audio','audio.compress','audio.convert','audio.speed','audio.edit'].includes(mode)){
    const codec=audioFormats[options.format]?.[0];if(!codec)throw new Error('音频格式无效。')
    const advanced=mode!=='video.audio',sampleRate=Number(options.sampleRate??0),channels=Number(options.channels??0),selectedBitrate=Number(options.bitrate??0)
    if(advanced&&(![0,8000,16000,22050,24000,32000,44100,48000].includes(sampleRate)||![0,1,2].includes(channels)||![0,32,48,64,96,128,160,192,256,320].includes(selectedBitrate)))throw new Error('音频采样率、声道或码率无效。')
    if(mode==='audio.compress'&&['wav','flac'].includes(options.format))throw new Error('音频压缩请选择 MP3、M4A、OGG 或 Opus。')
    if(advanced&&options.format==='opus'&&![0,8000,16000,24000,48000].includes(sampleRate))throw new Error('Opus 采样率请选择 8、16、24 或 48 kHz。')
    args.push('-i',input,'-map','0:a:0','-vn','-c:a',codec)
    if(editing){const fadeIn=Number(options.fadeIn??0),fadeOut=Number(options.fadeOut??0);if(!Number.isFinite(fadeIn)||!Number.isFinite(fadeOut)||fadeIn<0||fadeOut<0||fadeIn+fadeOut>duration)throw new Error('淡入淡出时间不能超过片段长度。');args.push('-t',String(duration));const filters=[`atrim=end=${duration}`];if(fadeIn)filters.push(`afade=t=in:st=0:d=${fadeIn}`);if(fadeOut)filters.push(`afade=t=out:st=${duration-fadeOut}:d=${fadeOut}`);args.push('-af',filters.join(','))}
    if(mode==='audio.speed')args.push('-af',speedFilter(options.speed,options.keepPitch!==false))
    if(advanced){
      if(options.format==='ogg')args.push('-q:a',String({high:5,balanced:3,small:mode==='audio.compress'?0:1}[quality]))
      else if(!['wav','flac'].includes(options.format)){
        let kbps=selectedBitrate||{high:192,balanced:128,small:mode==='audio.compress'?64:96}[quality]
        if(options.format==='mp3'&&sampleRate&&sampleRate<32000)kbps=Math.min(kbps,160)
        args.push('-b:a',kbps+'k')
      }
      if(channels)args.push('-ac',String(channels))
      if(sampleRate||options.format==='opus')args.push('-ar',String(sampleRate||48000))
      if(options.format==='flac')args.push('-compression_level','8')
    }else{
      if(!['wav','flac'].includes(options.format))args.push('-b:a',bitrate)
      if(options.format==='opus')args.push('-ar','48000')
    }
    args.push(output)
  }else {
    if(!['video.compress','video.convert','gif.video','video.speed','video.edit'].includes(mode)||!videoFormats[options.format])throw new Error('视频格式无效。')
    if(mode==='gif.video')args.push('-ignore_loop','1')
    // Input -ss rebases both streams against the same selected start. Trim
    // them at that common end, preserving the original A/V timestamp offset.
    const filters=editing?[`trim=end=${duration}`]:[]
    if(mode==='video.edit'){const x=Number(options.x??0),y=Number(options.y??0),w=Number(options.width??0),h=Number(options.height??0);if([x,y,w,h].some(v=>!Number.isInteger(v)||v<0)||Boolean(w)!==Boolean(h))throw new Error('裁剪坐标须为非负整数；宽高同时为零表示整图。');if(w&&h){if(w<2||h<2)throw new Error('视频裁剪宽高至少 2 像素。');filters.push(`crop=${w}:${h}:${x}:${y}`)}const rotation=Number(options.rotation??0);if(![0,90,180,270].includes(rotation))throw new Error('旋转角度无效。');if(rotation===90)filters.push('transpose=1');if(rotation===180)filters.push('hflip','vflip');if(rotation===270)filters.push('transpose=2');if(options.mirror)filters.push('hflip')}
    filters.push(mode==='video.speed'?`${scale},setpts=(PTS-STARTPTS)/${Number(options.speed)}`:scale)
    args.push('-i',input,'-map','0:v:0','-map','0:a:0?','-vf',filters.join(','),'-pix_fmt','yuv420p','-c:v',videoFormats[options.format][0])
    if(editing)args.push('-t',String(duration),'-af',`atrim=end=${duration}`,'-fps_mode','vfr','-shortest')
    if(mode==='video.speed')args.push('-af',speedFilter(options.speed,options.keepPitch!==false))
    if(options.format==='webm')args.push('-crf',String(Math.min(63,crf+5)),'-b:v','1M','-deadline','good','-cpu-used','4','-lag-in-frames','0','-auto-alt-ref','0')
    else if(options.format==='avi')args.push('-q:v',String({high:3,balanced:6,small:10}[quality]))
    else args.push('-crf',String(crf),'-preset','veryfast')
    args.push('-threads','1','-c:a',videoFormats[options.format][1],'-b:a',bitrate)
    if(mode==='gif.video'||(['video.speed','video.edit'].includes(mode)&&options.mute===true))args.push('-an')
    if(['mp4','mov'].includes(options.format))args.push('-movflags','+faststart')
    args.push(output)
  }
  return args
}
