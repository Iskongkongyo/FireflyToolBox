// Independent decoding requires ffmpeg and ffprobe on PATH. No user files are used.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {attachFile} from '../src-tauri/builtin-tools/src/media-fs.js'
import {plan} from '../src-tauri/builtin-tools/src/media-plan.js'
const folder=path.resolve('target-check/media-muxing-checks');fs.mkdirSync(folder,{recursive:true})
function native(command,args){const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1048576,timeout:120000});assert.equal(result.status,0,result.error?.message??result.stderr?.slice(-3000));return result.stdout}
globalThis.self={location:{href:'http://localhost/core.js'}}
const create=new Function('require','__dirname',fs.readFileSync('src-tauri/builtin-tools/generated/media-assets/ffmpeg-core.js','utf8')+';return createFFmpegCore;')(createRequire(import.meta.url),path.resolve('node_modules/@ffmpeg/core/dist/umd'))
const wasm=fs.readFileSync('src-tauri/builtin-tools/generated/media-assets/ffmpeg-core.wasm'),files=new Map();let partialRead=false,reads=0
globalThis.XMLHttpRequest=class {
 open(method,url){this.method=method;this.url=new URL(url);this.headers={}}
 setRequestHeader(name,value){this.headers[name]=value}
 send(body){
  const fd=files.get(this.url.pathname.slice(1));assert.notEqual(fd,undefined)
  if(this.method==='GET'){
   const [,start,end]=/^bytes=(\d+)-(\d+)$/.exec(this.headers.Range),length=Math.min(Number(end)-Number(start)+1,fs.fstatSync(fd).size-Number(start));assert.ok(length<=1048576)
   const bytes=new Uint8Array(length),read=fs.readSync(fd,bytes,0,length,Number(start));this.response=bytes.slice(0,partialRead?Math.max(0,read-1):read).buffer;this.status=206;reads++
  }else{assert.equal(this.method,'POST');if(this.url.searchParams.has('size'))fs.ftruncateSync(fd,Number(this.url.searchParams.get('size')));else{assert.ok(body.length<=1048576);fs.writeSync(fd,body,0,body.length,Number(this.url.searchParams.get('offset')))}this.status=200;this.response=new ArrayBuffer(0)}
 }
}
async function engine(){const core=await create({wasmBinary:wasm});core.fireflyEnsureEncoderStack();core.FS.mkdir('/media');return core}
{
 const core=await engine(),name=path.join(folder,'cache.bin'),bytes=Uint8Array.from({length:2*1048576+37},(_,index)=>index%251),fd=fs.openSync(name,'w+');fs.writeFileSync(fd,bytes);files.set('cache',fd)
 try{
  attachFile(core.FS,'cache.bin',{url:'http://localhost/cache',size:bytes.length},true)
  const stream=core.FS.open('/media/cache.bin','r+'),block=new Uint8Array(8192)
  for(const offset of [0,1048576-4096,1048576+4096]){
   core.FS.read(stream,block,0,block.length,offset);assert.deepEqual(block,bytes.slice(offset,offset+block.length))
   const patch=new Uint8Array([9,8,7,6]);core.FS.write(stream,patch,0,patch.length,offset+7);bytes.set(patch,offset+7)
   core.FS.read(stream,block,0,block.length,offset);assert.deepEqual(block,bytes.slice(offset,offset+block.length),'Read after write must observe current bytes without a one-byte shift')
  }
  core.FS.truncate('/media/cache.bin',100);const afterTruncate=new Uint8Array(100);core.FS.read(stream,afterTruncate,0,100,0);assert.deepEqual(afterTruncate,bytes.slice(0,100))
  const replacement=new Uint8Array([5,4,3,2,1]);core.FS.write(stream,replacement,0,replacement.length,0);core.FS.truncate('/media/cache.bin',replacement.length);assert.deepEqual(core.FS.readFile('/media/cache.bin'),replacement)
  core.FS.write(stream,new Uint8Array([3]),0,1,0);partialRead=true;assert.throws(()=>core.FS.read(stream,new Uint8Array(5),0,5,0),/读取不完整/);partialRead=false
  core.FS.close(stream);console.log('PASS cache: overwrite, chunk boundaries, truncate, replacement, short-read rejection')
 }finally{partialRead=false;fs.closeSync(fd);files.delete('cache')}
}
const source=path.join(folder,'source.mp4'),silent=path.join(folder,'silent.mp4')
native('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-y',source])
native('ffmpeg',['-v','error','-i',source,'-map','0:v:0','-c:v','copy','-an','-y',silent])
const cases=[
 {name:'mp4-20-fast',format:'mp4',start:0,end:20},
 {name:'mp4-20-control',format:'mp4',start:0,end:20,plain:true},
 {name:'mov-20-fast',format:'mov',start:0,end:20},
 {name:'mp4-10-fast',format:'mp4',start:0,end:10},
 {name:'mov-5-to-25-fast',format:'mov',start:5,end:25},
 {name:'mp4-20-silent',format:'mp4',start:0,end:20,silent:true},
 {name:'mov-20-muted',format:'mov',start:0,end:20,mute:true}
],reports=[]
function mediaPayload(file){const data=fs.readFileSync(file);for(let at=0;at+8<=data.length;){let length=data.readUInt32BE(at),header=8;if(length===1){length=Number(data.readBigUInt64BE(at+8));header=16}if(!length)length=data.length-at;if(data.toString('ascii',at+4,at+8)==='mdat')return createHash('sha256').update(data.subarray(at+header,at+length)).digest('hex');assert.ok(length>=header);at+=length}throw Error('Missing media payload')}
for(const item of cases){
 const output=path.join(folder,item.name+'.'+item.format),input=fs.openSync(item.silent?silent:source,'r'),writer=fs.openSync(output,'w+');files.set('input',input);files.set('output',writer);const core=await engine(),logs=[];core.setLogger(({message})=>logs.push(message))
 try{
  attachFile(core.FS,'input.mp4',{url:'http://localhost/input',size:fs.fstatSync(input).size});attachFile(core.FS,'output.'+item.format,{url:'http://localhost/output',size:0},true)
  const args=plan('video.edit',{...item,resolution:0,quality:'balanced'},'/media/input.mp4','/media/output.'+item.format);if(item.plain){const at=args.indexOf('-movflags');assert.ok(at>=0);args.splice(at,2)}
  assert.equal(core.exec(...args),0,logs.slice(-8).join('\n'));fs.writeFileSync(path.join(folder,item.name+'-engine.log'),logs.join('\n'))
 }finally{fs.closeSync(writer);fs.closeSync(input);files.delete('input');files.delete('output')}
 const probe=JSON.parse(native('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_frames,nb_read_frames,duration,avg_frame_rate','-of','json',output])).streams[0],digest=path.join(folder,item.name+'.framemd5')
 native('ffmpeg',['-v','error','-xerror','-i',output,'-map','0:v:0','-an','-fps_mode','passthrough','-f','framemd5','-y',digest])
 const frames=fs.readFileSync(digest,'utf8').split(/\r?\n/).filter(row=>row&&!row.startsWith('#')),expected=(item.end-item.start)*30,tail=frames.slice(-90)
 assert.equal(Number(probe.nb_frames),expected);assert.equal(Number(probe.nb_read_frames),expected);assert.equal(frames.length,expected);assert.ok(Math.abs(Number(probe.duration)-(item.end-item.start))<.05);assert.equal(new Set(tail.map(row=>row.split(',').at(-1).trim())).size,tail.length,'Every final frame must contain changing pixels')
 const report={name:item.name,bytes:fs.statSync(output).size,duration:Number(probe.duration),frames:frames.length,changingTailFrames:tail.length,mediaSha256:mediaPayload(output)};reports.push(report);console.log('PASS '+JSON.stringify(report))
}
assert.ok(reports[0].bytes>1048576);assert.equal(reports[0].mediaSha256,reports[1].mediaSha256,'Faststart must relocate the original media bytes exactly')
fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify({cachePassed:true,ioChunkBytes:1048576,reads,cases:reports},null,2))
console.log('All cache and 7 complete-file decoding checks passed.')
