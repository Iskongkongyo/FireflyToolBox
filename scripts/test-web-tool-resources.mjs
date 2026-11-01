import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { wavInfo, wavClipHeader } from '../examples/modules/media-files/wav.js'

function fixture(input = new Uint8Array(), declared = [], timers = {setTimeout,clearTimeout}) {
  const handlers = new Set(), calls = [], writes = [], workers = []
  const controller = new AbortController()
  const assets = new Map(declared.map(resource => [resource.path, resource.bytes]))
  const parent = { postMessage(message) {
    calls.push(message)
    queueMicrotask(() => {
      let result, error
      try {
        switch (message.operation) {
          case 'resource': result = assets.get(message.path).slice(message.offset, message.offset + message.length); break
          case 'open': result = [{id:'input',name:'sample.wav',mime_type:'audio/wav',size:input.length,seekable:true,url:'blob:preview'}]; break
          case 'read': if(message.length>1048576)throw new Error('large chunk');result=input.slice(message.offset,message.offset+message.length);break
          case 'createWriter': result = {id:'output',workspaceUrl:'blob:workspace'}; break
          case 'write': writes.push(message.bytes.slice()); result = writes.reduce((size,bytes)=>size+bytes.length,0);break
          case 'save': result = true;break
          case 'close': result = null;break
        }
      } catch(value) {error={code:'FILE_FAILED',message:value.message}}
      for(const handler of handlers)handler({source:parent,data:{id:'run',type:'streamResult',requestId:message.requestId,result,error}})
    })
  } }
  const context = {parent,AbortController,AbortSignal,DOMException,Uint8Array,ArrayBuffer,Blob,ReadableStream,URL,Promise,TextEncoder,TextDecoder,...timers,
    addEventListener(type,fn){if(type==='message')handlers.add(fn)},removeEventListener(type,fn){if(type==='message')handlers.delete(fn)},
    Worker:class {constructor(){this.terminated=false;workers.push(this)}terminate(){this.terminated=true}},
  }
  context.window=context
  runInNewContext(readFileSync('public/web-tool-assets.js','utf8'),context)
  runInNewContext(readFileSync('public/web-tool-tasks.js','utf8'),context)
  const send=message=>calls.push(message)
  const api=context.FireflyWebToolAssets('run',send,controller.signal,declared.map(({path,bytes})=>({path,size:bytes.length})),true)
  const tasks=context.FireflyWebToolTasks('run',send,controller.signal,api.resources)
  return {...api,tasks,controller,calls,writes,workers}
}

test('independent binary resources are read in bounded chunks, cached and compiled as WASM',async()=>{
  const wasm=readFileSync('examples/modules/media-files/assets/add.wasm')
  const data=new Uint8Array(3*1048576+7).fill(41)
  const f=fixture(undefined,[{path:'assets/add.wasm',bytes:wasm},{path:'assets/model.bin',bytes:data}])
  const blob=await f.resources.blob('assets/model.bin')
  assert.equal(blob.size,data.length)
  assert.equal(await f.resources.blob('assets/model.bin'),blob)
  assert.equal(f.calls.filter(c=>c.operation==='resource'&&c.path==='assets/model.bin').length,4)
  assert(f.calls.filter(c=>c.operation==='resource').every(c=>c.length<=1048576))
  const {instance}=await WebAssembly.instantiate(await(await f.resources.blob('assets/add.wasm')).arrayBuffer())
  assert.equal(instance.exports.add(21,21),42)
  await assert.rejects(f.resources.blob('../other.wasm'),{code:'RESOURCE_SCOPE'})
  f.controller.abort()
})

test('file streaming copies data larger than legacy limits without an oversized request',async()=>{
  const input=new Uint8Array(9*1048576+17).fill(83),f=fixture(input)
  const file=await f.files.open(),output=await f.files.createWriter('copy.wav')
  await output.write(file.stream())
  assert.equal(output.bytesWritten,input.length)
  assert(f.calls.filter(c=>c.operation==='read').every(c=>c.length<=1048576))
  assert(f.writes.every(bytes=>bytes.length<=1048576))
  assert.deepEqual(Buffer.concat(f.writes),Buffer.from(input))
  assert.equal(await output.save(),true)
  await file.close();f.controller.abort()
})

test('large Blob previews reject before reading and writer operations keep order',async()=>{
  const f=fixture(new Uint8Array(17*1048576)),file=await f.files.open()
  await assert.rejects(file.blob(),{code:'FILE_INPUT_LIMIT'})
  assert.equal(f.calls.filter(c=>c.operation==='read').length,0)
  const writer=await f.files.createWriter('ordered.bin')
  await Promise.all([writer.write(new Uint8Array([1,2])),writer.write(new Uint8Array([3])),writer.write(new Uint8Array([4,5]))])
  assert.deepEqual(Buffer.concat(f.writes),Buffer.from([1,2,3,4,5]))
  await writer.abort();await assert.rejects(writer.write(new Uint8Array([6])),{name:'AbortError'})
  f.controller.abort()
})

test('stopping a sandbox rejects pending IO and revokes further resource access',async()=>{
  const f=fixture(new Uint8Array([1,2]))
  const pending=f.files.open()
  f.controller.abort()
  await assert.rejects(pending,{name:'AbortError'})
  await assert.rejects(f.files.open(),{name:'AbortError'})
})

test('a long task timeout terminates its Worker and releases its task slot',async()=>{
  const f=fixture(undefined,[{path:'assets/job.js',bytes:new TextEncoder().encode('self.onmessage=()=>{}')}])
  await assert.rejects(f.tasks.run('work',async task=>{await task.worker('assets/job.js');return new Promise(()=>{})},{timeoutMs:20}),{name:'AbortError'})
  assert.equal(f.workers.length,1);assert.equal(f.workers[0].terminated,true)
  assert.equal(await f.tasks.run('next',()=>42),42)
  f.controller.abort()
})

test('long tasks default to 30 minutes, allow two hours, and release Workers and slots on timeout or cancel',async()=>{
  const scheduled=new Map(),delays=[]
  let sequence=0
  const timers={setTimeout(fn,ms){const id=++sequence;scheduled.set(id,fn);delays.push(ms);return id},clearTimeout(id){scheduled.delete(id)}}
  const f=fixture(undefined,[{path:'assets/job.js',bytes:new TextEncoder().encode('self.onmessage=()=>{}')}],timers)
  const work=async task=>{await task.worker('assets/job.js');return new Promise(()=>{})}
  const expired=f.tasks.run('default',work)
  assert.equal(delays.at(-1),1800000)
  // Wait for the actual resource-backed Worker to be registered before canceling.
  for(let attempt=0;attempt<30&&!f.workers.length;attempt++)await Promise.resolve()
  assert.equal(f.workers.length,1)
  scheduled.values().next().value()
  await assert.rejects(expired,{name:'AbortError'})
  assert.equal(f.workers[0].terminated,true)
  assert.equal(scheduled.size,0)
  const controller=new AbortController()
  const canceled=f.tasks.run('extended',work,{timeoutMs:7200000,signal:controller.signal})
  assert.equal(delays.at(-1),7200000)
  for(let attempt=0;attempt<30&&f.workers.length<2;attempt++)await Promise.resolve()
  assert.equal(f.workers.length,2)
  controller.abort()
  await assert.rejects(canceled,{name:'AbortError'})
  assert.equal(f.workers[1].terminated,true)
  assert.equal(scheduled.size,0)
  for(const timeoutMs of [7200001,Infinity,NaN,0,-1,1.5])await assert.rejects(f.tasks.run('invalid',()=>42,{timeoutMs}),/2 小时/)
  assert.equal(await f.tasks.run('next',()=>42),42)
  assert.equal(scheduled.size,0)
  f.controller.abort()
})

test('WAV clipping preserves PCM format and rounds to whole sample frames',async()=>{
  const info={encoding:1,channels:2,rate:48000,byteRate:192000,blockAlign:4,bits:16,offset:44,size:192000*3,seconds:3}
  const clip=wavClipHeader(info,.25,1.5)
  assert.equal(clip.offset,44+48000);assert.equal(clip.size,240000)
  const view=new DataView(clip.header.buffer)
  assert.equal(view.getUint32(24,true),48000);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(40,true),clip.size)
  const data=new Uint8Array(44+clip.size);data.set(clip.header)
  const parsed=await wavInfo({size:data.length,read:async(offset,length)=>data.slice(offset,offset+length)})
  assert.equal(parsed.seconds,1.25)
  assert.throws(()=>wavClipHeader(info,2,1),/截取区间/)
  data[20]=3
  await assert.rejects(wavInfo({size:data.length,read:async(offset,length)=>data.slice(offset,offset+length)}),/标准 PCM/)
})

test('odd-length mono WAV clips include a padding byte outside their data chunk',()=>{
  const info={channels:1,rate:2,byteRate:2,blockAlign:1,bits:8,offset:44,size:4,seconds:2}
  const clip=wavClipHeader(info,0,.5),view=new DataView(clip.header.buffer)
  assert.equal(clip.size,1);assert.equal(clip.padding,1);assert.equal(view.getUint32(4,true),38);assert.equal(view.getUint32(40,true),1)
})
