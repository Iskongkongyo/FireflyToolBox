import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {openCanvasFile,saveBlob} from '../src-tauri/builtin-tools/src/image-file-io.js'
import {hiddenOutputSize,HIDDEN_OUTPUT_PIXELS} from '../src-tauri/builtin-tools/src/image-limits.js'
import {hiddenImage} from '../src-tauri/builtin-tools/src/hiddenimage-data.js'
import {imageBytes} from '../src-tauri/builtin-tools/src/image-task.js'

function sdk(input){
 const handlers=[],written=[],closed=[],controller=new AbortController()
 const parent={postMessage(message){queueMicrotask(()=>{
  let result
  switch(message.operation){
   case 'open':result=[{id:'input',name:'large.png',size:input.length,seekable:true,mime_type:'image/png'}];break
   case 'read':result=input.slice(message.offset,message.offset+message.length);break
   case 'close':closed.push(message.fileId);result=null;break
   case 'createWriter':result={id:'output',workspaceUrl:'blob:output'};break
   case 'write':written.push(message.bytes.slice());result=written.reduce((total,bytes)=>total+bytes.length,0);break
   case 'save':result=true;break
  }
  for(const handler of handlers)handler({source:parent,data:{id:'run',type:'streamResult',requestId:message.requestId,result}})
 })}}
 const scope={parent,AbortController,AbortSignal,DOMException,Uint8Array,ArrayBuffer,Blob,ReadableStream,URL,Promise,TextEncoder,TextDecoder,setTimeout,clearTimeout,
  addEventListener:(_kind,handler)=>handlers.push(handler),removeEventListener(){}}
 scope.window=scope;runInNewContext(readFileSync('public/web-tool-assets.js','utf8'),scope)
 const {files}=scope.FireflyWebToolAssets('run',()=>{},controller.signal,[],true)
 return {files,written,closed,controller}
}

test('canvas tools read beyond 8 MiB through the actual file SDK and close input handles',async()=>{
 const input=new Uint8Array(9*1048576+17).fill(39),fixture=sdk(input)
 const file=await openCanvasFile(fixture.files,fixture.controller.signal)
 assert.equal(file.blob.size,input.length)
 assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()),input)
 assert.deepEqual(fixture.closed,['input'])
 fixture.controller.abort()
})

test('image saving above 4 MiB uses ordered binary chunks through the actual SDK',async()=>{
 const fixture=sdk(new Uint8Array()),bytes=new Uint8Array(5*1048576+17).fill(101)
 assert.equal(await saveBlob(fixture.files,'result.png',new Blob([bytes]),fixture.controller.signal),true)
 assert.ok(fixture.written.every(bytes=>bytes.length<=1048576))
 assert.deepEqual(Buffer.concat(fixture.written),Buffer.from(bytes))
 fixture.controller.abort()
})

test('engine readers accept files over the old 128 MiB boundary without oversized native requests',async()=>{
 const length=128*1048576+1,requests=[]
 const file={size:length,read:async(offset,count)=>{requests.push(count);return new Uint8Array(Math.max(0,Math.min(count,length-offset))).fill(7)}}
 const bytes=await imageBytes(file,new AbortController().signal)
 assert.equal(bytes.length,length);assert.equal(bytes[0],7);assert.equal(bytes.at(-1),7)
 assert.ok(requests.every(count=>count<=1048576))
 await assert.rejects(imageBytes({size:256*1048576+1},new AbortController().signal),/256 MiB/)
})

test('hidden output retains aspect ratio and bounds both the new 3072 edge and pixel allocations',()=>{
 assert.deepEqual(hiddenOutputSize(80,60,3072),{width:80,height:60})
 for(const [width,height] of [[4000,4000],[6000,4000],[16384,900],[3072,3072]]){
  const output=hiddenOutputSize(width,height,3072)
  assert.ok(Math.max(output.width,output.height)<=3072)
  assert.ok(output.width*output.height<=HIDDEN_OUTPUT_PIXELS)
 }
 assert.throws(()=>hiddenOutputSize(4000,3000,9999))
})

test('hidden processing supports more than four million pixels and preserves its transparent white-black result',()=>{
 const pixels=4000001,front=new Uint8ClampedArray(pixels*4).fill(255),back=new Uint8ClampedArray(pixels*4)
 const output=hiddenImage(front,back,{white:80,black:20,whiteColor:0,blackColor:0})
 assert.equal(output.length,pixels*4)
 assert.ok(output.every(byte=>byte===0))
})
