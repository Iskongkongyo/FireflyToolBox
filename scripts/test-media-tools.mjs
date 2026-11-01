import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import create from '@ffmpeg/core'
import {initializeImageMagick,ImageMagick,MagickColors,MagickFormat,MagickReadSettings} from '@imagemagick/magick-wasm'
import {plan} from '../src-tauri/builtin-tools/src/media-plan.js'
import {attachFile} from '../src-tauri/builtin-tools/src/media-fs.js'
import {convertImage,imageFormats} from '../src-tauri/builtin-tools/src/image-magick.js'
globalThis.self={location:{href:'http://localhost/core.js'}}
let core=await create({wasmBinary:fs.readFileSync('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm')})
let logs=[];core.setLogger(({message})=>logs.push(message))
function exec(args){logs=[];core.reset();let code;try{code=core.exec(...args)}catch(error){throw new Error(error.message+'\n'+logs.slice(-14).join('\n'))}assert.equal(code,0,logs.slice(-10).join('\n'))}
exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','sample.mp4'])
const sample=core.FS.readFile('sample.mp4'),files=new Map([['input',sample]]),requests=[]
globalThis.XMLHttpRequest=class {
 open(method,url){this.method=method;this.url=new URL(url);this.headers={}}
 setRequestHeader(k,v){this.headers[k]=v}
 send(body){
  const name=this.url.pathname.slice(1),bytes=files.get(name)??new Uint8Array(0);requests.push({method:this.method,name,bytes:body?.length??0,range:this.headers.Range})
  if(this.method==='GET'){
   const [,from,to]=/^bytes=(\d+)-(\d+)$/.exec(this.headers.Range),part=bytes.slice(Number(from),Number(to)+1);assert.ok(part.length<=1048576);this.response=part.buffer;this.status=206
  }else{
   const offset=Number(this.url.searchParams.get('offset')),size=this.url.searchParams.get('size'),output=new Uint8Array(size!==null?Number(size):Math.max(bytes.length,offset+body.length));output.set(bytes.subarray(0,output.length));if(size===null)output.set(body,offset);files.set(name,output);this.status=200;this.response=new ArrayBuffer(0);assert.ok((body?.length??0)<=1048576)
  }
 }
}
core.FS.mkdir('/media');attachFile(core.FS,'input.mp4',{url:'http://localhost/input',size:sample.length})
async function freshCore(){core=await create({wasmBinary:fs.readFileSync('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm')});core.setLogger(({message})=>logs.push(message));core.FS.mkdir('/media');attachFile(core.FS,'input.mp4',{url:'http://localhost/input',size:sample.length})}
async function convert(mode,format,extra={}){
 await freshCore()
 const name='result.'+format
 const unique=mode.replaceAll('.','-')+Math.random().toString(16).slice(2)+'.'+format
 attachFile(core.FS,unique,{url:'http://localhost/'+unique,size:0},true)
 exec(plan(mode,{format,quality:'balanced',resolution:360,...extra},'/media/input.mp4','/media/'+unique))
 const bytes=files.get(unique);assert.ok(bytes.length>0);core.FS.writeFile(name,bytes)
 return bytes
}
test('command parameters reject unsupported formats, resolutions and GIF frame ranges',()=>{
 for(const options of [{format:'exe'},{format:'mp4',resolution:777},{format:'mp4',quality:'whatever'}])assert.throws(()=>plan('video.convert',options))
 for(const options of [{format:'gif',fps:31},{format:'gif',duration:61},{format:'gif',start:-1}])assert.throws(()=>plan('video.gif',options))
 assert.ok(plan('video.compress',{format:'mp4',resolution:1080}).join(' ').includes('min(iw,1920)'))
})
test('native-backed random FS supports output rewrites, truncate and 1 MiB bounded reads beyond the old input cap',()=>{
 const bytes=new Uint8Array(9*1048576+3);bytes[bytes.length-1]=77;files.set('large',bytes)
 attachFile(core.FS,'large.bin',{url:'http://localhost/large',size:bytes.length})
 const fd=core.FS.open('/media/large.bin','r'),part=new Uint8Array(3);core.FS.read(fd,part,0,3,bytes.length-3);assert.equal(part[2],77);core.FS.close(fd)
 attachFile(core.FS,'rewrite.bin',{url:'http://localhost/rewrite',size:0},true)
 const stream=core.FS.open('/media/rewrite.bin','w+');core.FS.write(stream,new Uint8Array([1,2,3]),0,3,0);core.FS.write(stream,new Uint8Array([9]),0,1,1);core.FS.close(stream)
 assert.deepEqual([...files.get('rewrite')],[1,9,3]);core.FS.truncate('/media/rewrite.bin',1);assert.equal(files.get('rewrite').length,1)
})
for(const format of ['mp4','webm','mkv','mov','avi'])test('video conversion produces decodable '+format,async()=>{
 await convert('video.convert',format);exec(['-i','result.'+format,'-frames:v','1','-f','null','-']);assert.ok(logs.some(s=>s.includes('160x90')))
})
test('compression scales larger clips to selected resolution without upscaling',async()=>{
 await freshCore()
 exec(['-f','lavfi','-i','color=size=1280x720:rate=1','-t','1','-c:v','libx264','big.mp4'])
 const bytes=core.FS.readFile('big.mp4');files.set('big',bytes);attachFile(core.FS,'big.mp4',{url:'http://localhost/big',size:bytes.length});attachFile(core.FS,'small.mp4',{url:'http://localhost/small',size:0},true)
 exec(plan('video.compress',{format:'mp4',resolution:360},'/media/big.mp4','/media/small.mp4'));core.FS.writeFile('small.mp4',files.get('small'));exec(['-i','small.mp4','-frames:v','1','-f','null','-']);assert.ok(logs.some(s=>s.includes('640x360')))
})
for(const format of ['mp3','m4a','wav','flac','ogg','opus'])test('extract audio as '+format,async()=>{await convert('video.audio',format)})
for(const format of ['mp3','m4a','wav','flac','ogg','opus'])test('audio format conversion applies sample rate and mono channel settings: '+format,async()=>{
 const bytes=await convert('audio.convert',format,{sampleRate:16000,channels:1,bitrate:64})
 exec(['-i','result.'+format,'-f','null','-']);assert.ok(logs.some(line=>line.includes(format==='opus'?'48000 Hz':'16000 Hz')));assert.ok(logs.some(line=>line.includes('mono')));assert.ok(bytes.length>0)
})
test('audio compression yields smaller output at a lower bitrate while retaining playable audio',async()=>{
 const small=await convert('audio.compress','mp3',{quality:'small',bitrate:64}),high=await convert('audio.compress','mp3',{quality:'high',bitrate:192})
 assert.ok(small.length<high.length);exec(['-i','result.mp3','-f','null','-'])
 for(const options of [{format:'wav'},{format:'mp3',bitrate:7},{format:'opus',sampleRate:44100},{format:'mp3',channels:7}])assert.throws(()=>plan('audio.compress',options))
})
for(const rate of [.25,.5,2,4])test('audio speed '+rate+' changes duration while keeping a decodable stream',async()=>{
 const bytes=await convert('audio.speed','wav',{speed:rate,keepPitch:true,sampleRate:16000,channels:1})
 // WAV data size gives exact PCM duration, independently of the command builder.
 let at=12,dataLength=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 while(at+8<=bytes.length){const size=view.getUint32(at+4,true);if(Buffer.from(bytes.slice(at,at+4)).toString()==='data'){dataLength=size;break}at+=8+size+(size%2)}
 assert.ok(Math.abs(dataLength/32000-1/rate)<.25)
})
test('video speed changes the timeline and accepts optional audio',async()=>{
 const bytes=await convert('video.speed','mp4',{speed:2,keepPitch:true});exec(['-i','result.mp4','-f','null','-']);const duration=logs.join('\n').match(/Duration: 00:00:([0-9.]+)/);assert.ok(duration&&Number(duration[1])<.8);assert.ok(bytes.length>0)
 assert.throws(()=>plan('audio.speed',{format:'wav',speed:0}));assert.throws(()=>plan('video.speed',{format:'mp4',speed:5}))
})
test('speed can change pitch, and silent video needs no artificial audio track',async()=>{
 await convert('audio.speed','wav',{speed:2,keepPitch:false});exec(['-i','result.wav','-f','null','-'])
 await freshCore();exec(['-i','/media/input.mp4','-an','-c:v','copy','silent.mp4']);const bytes=core.FS.readFile('silent.mp4');files.set('silent-speed-input',bytes);attachFile(core.FS,'silent.mp4',{url:'http://localhost/silent-speed-input',size:bytes.length});attachFile(core.FS,'silent-speed.mp4',{url:'http://localhost/silent-speed-output',size:0},true)
 exec(plan('video.speed',{format:'mp4',speed:.5,keepPitch:true,resolution:0},'/media/silent.mp4','/media/silent-speed.mp4'));assert.ok(files.get('silent-speed-output').length>0)
})
test('audio editing trims to the selected duration and applies fade boundaries',async()=>{
 const bytes=await convert('audio.edit','wav',{start:.2,end:.7,fadeIn:.1,fadeOut:.1,sampleRate:16000,channels:1});const buffer=Buffer.from(bytes),at=buffer.indexOf('data');assert.ok(at>0);const length=buffer.readUInt32LE(at+4);assert.ok(Math.abs(length/32000-.5)<.02);assert.throws(()=>plan('audio.edit',{format:'wav',start:1,end:0}));assert.throws(()=>plan('audio.edit',{format:'wav',start:0,end:1,fadeIn:2}))
})
test('video editing crops and rotates a real clip, then decodes the result',async()=>{
 await convert('video.edit','mp4',{start:0,end:.5,x:0,y:0,width:80,height:60,rotation:90,resolution:0,mute:true});exec(['-i','result.mp4','-frames:v','1','-f','null','-']);assert.ok(logs.some(line=>line.includes('60x80')))
})
test('video GIF palette/fps and GIF to MP4 retain a single animation cycle',async()=>{
 const gif=await convert('video.gif','gif',{fps:12,duration:1});assert.equal(new TextDecoder().decode(gif.slice(0,3)),'GIF')
 const animation=ImageMagick.readCollection(gif,images=>({frames:images.length,duration:images.reduce((total,image)=>total+image.animationDelay/image.animationTicksPerSecond,0)}))
 assert.equal(animation.frames,12);assert.ok(Math.abs(animation.duration-1)<.05)
 files.set('gif',gif);attachFile(core.FS,'input.gif',{url:'http://localhost/gif',size:gif.length});attachFile(core.FS,'gif.mp4',{url:'http://localhost/gif-video',size:0},true)
 exec(plan('gif.video',{format:'mp4',resolution:360},'/media/input.gif','/media/gif.mp4'));assert.ok(files.get('gif-video').length>0)
})
await initializeImageMagick(fs.readFileSync('node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'))
const image=ImageMagick.read(MagickColors.Transparent,32,24,im=>im.write(MagickFormat.Png,data=>data.slice()))
for(const format of Object.keys(imageFormats))test('image '+format+' round-trips dimensions and provides PNG preview',()=>{
 const result=convertImage(image,{format,quality:80,background:'color',color:'#ff0000',edge:0})
 assert.deepEqual(ImageMagick.read(result.output,new MagickReadSettings({format:imageFormats[format]}),im=>[im.width,im.height]),[32,24])
 assert.equal(result.preview[0],137)
})
test('image transparency, fill color, aspect ratio and larger than 8 MiB input remain supported',()=>{
 const filled=convertImage(image,{format:'png',quality:100,background:'color',color:'#ff0000',edge:16});assert.equal(filled.width,16);assert.equal(filled.height,12)
 const big=ImageMagick.read(MagickColors.Red,2000,1500,im=>im.write(MagickFormat.Bmp,data=>data.slice()));assert.ok(big.length>8388608)
 const result=convertImage(big,{format:'jpeg',quality:80,background:'transparent',color:'#ffffff',edge:0});assert.equal(result.width,2000);assert.equal(result.height,1500)
 assert.throws(()=>convertImage(image,{format:'heic',quality:80,background:'transparent',color:'#ffffff',edge:0}))
})
