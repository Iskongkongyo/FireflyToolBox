import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {runInNewContext} from 'node:vm'

const base = 'http://127.0.0.1:32123/' + 'c'.repeat(32)
const fileId = 'a'.repeat(32), run = 'test-run'
const adapterBuild = await build({entryPoints:['src/services/webToolNativeFiles.ts'],bundle:true,write:false,
  platform:'browser',format:'iife',globalName:'FileAdapter',plugins:[{
    name:'native-test-bridge',setup(plugin) {
      plugin.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'bridge'}))
      plugin.onLoad({filter:/.*/,namespace:'bridge'},args=>({contents:args.path.endsWith('/core')
        ? `export const invoke=(...args)=>bridge.invoke(...args); export const convertFileSrc=(path,protocol)=>'http://'+protocol+'.localhost/'+encodeURIComponent(path);`
        : `export const open=async()=>bridge.open(); export const save=async()=> 'content://picked/output.bin';`}))
    },
  }]})

function adapter(userAgent='Android', {selectionCount=1, failOpenAt=0} = {}) {
  const calls=[], received=[], bytes=Uint8Array.from({length:1048576},(_,index)=>index%256)
  let opened = 0
  const bridge={open:()=>Array.from({length:selectionCount},(_,index)=>`content://picked/input${index}.mp4`),async invoke(command,payload,options) {
    calls.push({command,payload,options})
    if(command==='web_file_transport') return base
    if(command==='web_file_create_writer') return fileId
    if(command==='web_file_open') {
      opened++
      if(opened===failOpenAt)throw 'FILE_OPEN: Selected file is unavailable.'
      return {id:opened===1?fileId:opened.toString(16).padStart(32,'0'),name:'sample.mp4',size:17,seekable:true,mime_type:'video/mp4'}
    }
    if(command==='web_file_preview_writer') return {id:fileId,name:'sample.mp4',size:17,seekable:true,mime_type:'video/mp4'}
    if(command==='web_file_write') { const chunk=payload.encoding==='base64'?Buffer.from(payload.data,'base64'):Buffer.from(payload);received.push(chunk);return received.reduce((sum,bytes)=>sum+bytes.length,0) }
    if(command==='web_file_read') return bytes.slice(payload.offset,payload.offset+payload.length).buffer
  }}
  const context={bridge,navigator:{userAgent},URL,Uint8Array,ArrayBuffer,AbortController,DOMException,btoa}
  runInNewContext(adapterBuild.outputFiles[0].text,context)
  return {host:context.FileAdapter.nativeWebFiles,calls,received,bytes}
}

for (const platform of ['Android', 'Windows']) {
  test(`${platform} accepts 64 selected files and rejects 65 before opening native handles`,async()=>{
    const signal=new AbortController().signal,allowed=adapter(platform,{selectionCount:64})
    await allowed.host.begin(run,2**31,2**31)
    const files=await allowed.host.request(run,'open',{extensions:['mp4'],multiple:true},signal,()=>{})
    assert.equal(files.length,64)
    assert.equal(new Set(files.map(file=>file.id)).size,64)
    assert.equal(allowed.calls.filter(call=>call.command==='web_file_open').length,64)
    const denied=adapter(platform,{selectionCount:65})
    await denied.host.begin(run,2**31,2**31)
    await assert.rejects(denied.host.request(run,'open',{extensions:['mp4'],multiple:true},signal,()=>{}),{code:'FILE_COUNT_LIMIT'})
    assert.equal(denied.calls.filter(call=>call.command==='web_file_open').length,0)
  })
  test(`${platform} closes all earlier handles when the 64th selected file fails`,async()=>{
    const f=adapter(platform,{selectionCount:64,failOpenAt:64}),signal=new AbortController().signal
    await f.host.begin(run,2**31,2**31)
    await assert.rejects(f.host.request(run,'open',{extensions:['mp4'],multiple:true},signal,()=>{}),{code:'FILE_OPEN'})
    const opened=f.calls.filter(call=>call.command==='web_file_open')
    const closed=f.calls.filter(call=>call.command==='web_file_close')
    assert.equal(opened.length,64)
    assert.equal(closed.length,63)
    assert.equal(new Set(closed.map(call=>call.payload.id)).size,63)
  })
}

test('Android image writes preserve every byte and partial views through base64 IPC',async()=>{
  const {host,calls,received,bytes}=adapter(),signal=new AbortController().signal
  await host.begin(run,2**31,2**31)
  await host.request(run,'write',{fileId,bytes},signal,()=>{})
  await host.request(run,'write',{fileId,bytes:bytes.subarray(19,73)},signal,()=>{})
  assert.deepEqual(Buffer.concat(received),Buffer.concat([Buffer.from(bytes),Buffer.from(bytes.subarray(19,73))]))
  const writes=calls.filter(call=>call.command==='web_file_write')
  assert.ok(writes.every(call=>call.payload.encoding==='base64'))
  assert.ok(writes.every(call=>call.options.headers['x-firefly-run']===run&&call.options.headers['x-firefly-file']===fileId))
  const controller=new AbortController();controller.abort()
  await assert.rejects(host.request(run,'write',{fileId,bytes},controller.signal,()=>{}),{code:'FILE_CANCELED'})
  assert.equal(calls.filter(call=>call.command==='web_file_write').length,2)
})

test('Android readers, workspaces and previews use the same bounded loopback capability',async()=>{
  const {host,calls}=adapter(),signal=new AbortController().signal
  await host.begin(run,2**31,2**31);await host.begin('second-run',2**31,2**31)
  const files=await host.request(run,'open',{extensions:['mp4']},signal,()=>{})
  const writer=await host.request(run,'createWriter',{},signal,()=>{})
  const preview=await host.request(run,'preview',{fileId,name:'out.mp4'},signal,()=>{})
  assert.equal(files[0].url,`${base}/ff-file/${run}/${fileId}`)
  assert.equal(writer.workspaceUrl,`${base}/ff-work/${run}/${fileId}`)
  assert.equal(preview.url,`${base}/ff-file/${run}/${fileId}`)
  assert.equal(host.protocolSources[0],base+'/')
  assert.equal(calls.filter(call=>call.command==='web_file_transport').length,1)
})

test('Windows keeps raw IPC and its existing custom protocol URLs',async()=>{
  const {host,calls,bytes}=adapter('Windows'),signal=new AbortController().signal
  await host.begin(run,2**31,2**31)
  const writer=await host.request(run,'createWriter',{},signal,()=>{})
  await host.request(run,'write',{fileId,bytes:bytes.subarray(0,255)},signal,()=>{})
  assert.ok(writer.workspaceUrl.startsWith('http://ff-work.localhost/'))
  assert.ok(calls.find(call=>call.command==='web_file_write').payload instanceof Uint8Array)
  assert.equal(calls.filter(call=>call.command==='web_file_transport').length,0)
  assert.equal(host.protocolSources.length,0)
})

const runtimeBuild=await build({entryPoints:['src/services/webToolRuntime.ts'],bundle:true,write:false,
  platform:'browser',format:'iife',globalName:'ToolRuntime',plugins:[{
    name:'toolbox-test-bridge',setup(plugin) {
      plugin.onResolve({filter:/^\.\/toolbox$/},()=>({path:'toolbox',namespace:'fixture'}))
      plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const toolbox = {}'}))
    },
  }]})

function frameFixture() {
  let begin,closedRuns=0
  const appended=[],listeners=new Map()
  const frame={style:{},setAttribute(){},contentWindow:{postMessage(){}},srcdoc:''}
  const container={closest:()=>null,append:value=>appended.push(value)}
  const context={window:{location:{origin:'http://tauri.localhost'},innerHeight:800,setTimeout,requestAnimationFrame:setTimeout,cancelAnimationFrame:clearTimeout,
      addEventListener:(kind,fn)=>listeners.set(kind,fn),removeEventListener:(kind)=>listeners.delete(kind)},
    document:{createElement:()=>frame},crypto:{randomUUID:()=>run},URL,Uint8Array,ArrayBuffer,AbortController,DOMException,Blob,setTimeout,clearTimeout}
  runInNewContext(runtimeBuild.outputFiles[0].text,context)
  let session
  session=context.ToolRuntime.createWebToolSession(container,{networkHosts:[],timeoutMs:15000,inputBytes:2**31,outputBytes:2**31,
    files:{protocolSources:[base+'/'],begin:()=>new Promise(resolve=>{begin=resolve}),close:async()=>{closedRuns++}},onError(){},html:'',css:'',script:''},'hook',{},()=>session.dispose())
  session.ready.catch(()=>{})
  return {session,frame,appended,begin:()=>begin(),closedRuns:()=>closedRuns}
}

test('sandbox waits for file initialization and allows only the actual loopback capability prefix',async()=>{
  const fixture=frameFixture()
  assert.equal(fixture.appended.length,0)
  fixture.begin();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(fixture.appended.length,1)
  assert.ok(fixture.frame.srcdoc.includes(base+'/'))
  assert.ok(!fixture.frame.srcdoc.includes('http://127.0.0.1:*'))
  fixture.session.dispose()
})

test('closing while the transport initializes never mounts the old frame and closes its run',async()=>{
  const fixture=frameFixture()
  fixture.session.dispose();fixture.begin();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(fixture.appended.length,0)
  assert.equal(fixture.closedRuns(),1)
})
