import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { capacityFixture } from './module-capacity-fixtures.mjs'
import { connectAndroid } from './android-device-client.mjs'
import { connectWindows } from './windows-test-client.mjs'

const compiled = await build({entryPoints:['scripts/web-tool-services-fixture.mjs'],bundle:true,write:false,format:'iife',globalName:'ServicesReview',platform:'browser'})
const windows=process.argv.includes('--windows')
const client=await (windows?connectWindows():connectAndroid()),serial=windows?'windows':client.device('get-serialno'),token=crypto.randomUUID().replaceAll('-','').slice(0,12)
const directory=path.resolve('target-check/web-services-review',serial.replace(/[^\w-]/g,'_'))
await mkdir(directory,{recursive:true})
const moduleId=`dev.example.services_${token}`,name=`services-${token}.fftool`,remote=`/data/local/tmp/${name}`
const longModuleId=`dev.${'a'.repeat(40)}.${'b'.repeat(40)}`,previewId=`preview.installed.${longModuleId}.${longModuleId}.tool`
const origin=process.env.FIREFLY_HTTP_ECHO_ORIGIN||'https://postman-echo.com'
const report={moduleId,platform:windows?'windows':'android',android:windows?undefined:client.device('shell','getprop','ro.build.version.release'),webview:windows?'WebView2':client.device('shell','dumpsys','webviewupdate').match(/Current WebView package[^\n]+/)?.[0],checks:[]}
const pass=message=>{report.checks.push(message);console.log('PASS:',message)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let installed=false,manifest
async function inject(){
  for(let attempt=0;attempt<100;attempt++){
    try{if(await client.evaluate(()=>!!window.__TAURI_INTERNALS__&&!!document.body))break}catch{}
    await delay(100)
  }
  const loaded=await client.call('Runtime.evaluate',{expression:compiled.outputFiles[0].text});assert(!loaded.exceptionDetails)
  await client.evaluate(()=>{document.getElementById('services-review')?.remove();const node=document.createElement('div');node.id='services-review';node.style.cssText='position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto';document.body.append(node)})
}
async function context(){
  const tree=await client.call('Page.getFrameTree'),find=node=>node.frame.url==='about:srcdoc'?node.frame:node.childFrames?.map(find).find(Boolean),frame=find(tree.frameTree)
  assert(frame)
  return(await client.call('Page.createIsolatedWorld',{frameId:frame.id,worldName:'services-review'})).executionContextId
}
async function evaluate(expression,id){const value=await client.call('Runtime.evaluate',{expression,contextId:id,returnByValue:true});if(value.exceptionDetails)throw new Error(JSON.stringify(value.exceptionDetails));return value.result.value}
async function start(script,overrides={}){
  await client.evaluate(async({script,settings})=>{window.servicesReport=await window.ServicesReview.mount(document.getElementById('services-review'),script,settings)},{script,settings:{moduleId,resourceModuleId:moduleId,resources:manifest.resources,hosts:[origin],...overrides}})
  return context()
}
async function run(expected){
  const id=await context();await evaluate('document.getElementById("run").click()',id)
  let value
  for(let attempt=0;attempt<650;attempt++){value=await evaluate('document.getElementById("result").textContent',id);if(value.startsWith('error:'))throw new Error(value);if(value.includes(expected))return value;await delay(100)}
  throw new Error('Tool result timed out: '+value)
}
const click=body=>`document.getElementById('run').onclick=async()=>{try{${body}}catch(error){document.getElementById('result').textContent='error:'+(error.code||error.name)+':'+error.message}}`
try{
  const source=path.join(directory,'module'),output=path.join(directory,'module.fftool')
  manifest=await capacityFixture(source,{moduleId})
  const worker='self.onmessage=event=>setTimeout(()=>self.postMessage(event.data),60)',bytes=new TextEncoder().encode(worker)
  await mkdir(path.join(source,'assets'),{recursive:true});await writeFile(path.join(source,'assets/job.js'),bytes)
  manifest.permissions=['network'];manifest.network.hosts=[origin];manifest.resources=[{path:'assets/job.js',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest))
  const packed=spawnSync(process.execPath,['scripts/bundle-module.mjs',source,output],{encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(packed.status,0,packed.stderr)
  if(!windows){client.device('push',output,remote);client.device('shell',`cat ${remote} | run-as firefly.toolbox sh -c 'cat > cache/${name}'`)}
  await client.invoke('install_module_file',{path:windows?output:`content://firefly.toolbox.fileprovider/my_cache_images/${name}`});installed=true
  await inject()
  await client.evaluate(id=>{localStorage.setItem(`firefly.browser-module.${id}.notes`,'迁移数据 🐱');localStorage.setItem(`firefly.browser-module.${id}.edge`,'\ud800');localStorage.setItem(`firefly.browser-module.${id}.\udfff`,'key')},moduleId)
  let id=await start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('notes')}`)
  assert.equal(await evaluate('document.getElementById("result").textContent',id),'迁移数据 🐱')
  assert.equal(await client.evaluate(id=>localStorage.getItem(`firefly.browser-module.${id}.notes`),moduleId),null)
  const migrated=JSON.parse(await client.invoke('load_tool_storage',{moduleId,legacyJson:'{}'}));assert.equal(migrated.notes,'迁移数据 🐱');assert.equal(migrated.edge.charCodeAt(0),0xd800);assert.equal(migrated['\udfff'],'key')
  pass('Legacy tool data migrates into SQLite before its browser copy is removed.')
  await start(`export function mount({storage}){${click("localStorage.clear();localStorage.setItem('x','a'.repeat(1048568));sessionStorage.setItem('x','a'.repeat(1048568));await storage.flush();let local=false,session=false;try{localStorage.setItem('extra','x')}catch(error){local=error.name==='QuotaExceededError'}try{sessionStorage.setItem('extra','x')}catch(error){session=error.name==='QuotaExceededError'}document.getElementById('result').textContent='quota:'+local+':'+session")}}`)
  assert.equal(await run('quota:'),'quota:true:true')
  pass('The actual sandbox accepts one MiB each for persistent/session storage and rejects overflow.')
  await client.call('Page.reload');await delay(500);await inject()
  id=await start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('x').length+':'+sessionStorage.length}`)
  assert.equal(await evaluate('document.getElementById("result").textContent',id),'1048568:0')
  pass('SQLite content survives a real main-document reload and session data is cleared.')
  const quota=await client.evaluate(async moduleId=>{try{await window.__TAURI_INTERNALS__.invoke('save_tool_storage',{moduleId,valuesJson:JSON.stringify({x:'a'.repeat(1048569)})});return false}catch(error){return String(error).includes('STORAGE_LIMIT')}},moduleId)
  assert.equal(quota,true);assert.equal(JSON.parse(await client.invoke('load_tool_storage',{moduleId,legacyJson:'{}'})).x.length,1048568)
  pass('The native storage command independently rejects overflow and preserves the last committed snapshot.')
  await client.evaluate(moduleId=>localStorage.setItem(`firefly.browser-module.${moduleId}.notes`,'x'.repeat(1048576)),moduleId)
  id=await start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('x').length}`)
  assert.equal(await evaluate('document.getElementById("result").textContent',id),'1048568')
  assert.equal(await client.evaluate(moduleId=>localStorage.getItem(`firefly.browser-module.${moduleId}.notes`).length,moduleId),1048576)
  await client.evaluate(moduleId=>localStorage.removeItem(`firefly.browser-module.${moduleId}.notes`),moduleId)
  pass('A committed native snapshot opens even when a stale legacy copy exceeds its quota; the stale copy stays intact.')
  const other=await client.invoke('load_tool_storage',{moduleId:moduleId+'_other',legacyJson:'{}'});assert.equal(other,'{}')
  pass('A second module namespace cannot see the first module’s stored data.')
  id=await start(`export function mount(){document.getElementById('result').textContent='long-preview:'+localStorage.length}`,{moduleId:previewId})
  assert.equal(await evaluate('document.getElementById("result").textContent',id),'long-preview:0')
  pass('An installed-source preview with valid long module/tool IDs still opens its storage namespace.')
  await start(`export function mount({tasks}){tasks.configure({concurrency:8,workerLimit:8});${click("let active=0,peak=0;const order=[];const values=await Promise.all(Array.from({length:12},(_,i)=>tasks.run(String(i),async task=>{active++;peak=Math.max(peak,active);order.push(i);const worker=await task.worker('assets/job.js');const value=await new Promise(resolve=>{worker.onmessage=e=>resolve(e.data);worker.postMessage(i)});active--;return value})));document.getElementById('result').textContent=JSON.stringify({peak,order,values})")}}`)
  const parallel=JSON.parse(await run('peak'));assert.equal(parallel.peak,8);assert.deepEqual(parallel.order,Array.from({length:12},(_,i)=>i));assert.deepEqual(parallel.values,parallel.order)
  pass('Eight real resource-backed Workers execute twelve queued tasks in FIFO start order.')
  await start(`export function mount({tasks}){tasks.configure({concurrency:1,workerLimit:1});${click("const controller=new AbortController();let started=0;const jobs=Array.from({length:12},(_,i)=>tasks.run(String(i),async task=>{started++;await task.worker('assets/job.js');await new Promise(()=>{})},{signal:controller.signal}));setTimeout(()=>controller.abort(),40);const results=await Promise.allSettled(jobs);const next=await tasks.run('next',()=>42);document.getElementById('result').textContent='cancel:'+started+':'+results.filter(r=>r.status==='rejected'&&r.reason.name==='AbortError').length+':'+next")}}`)
  assert.equal(await run('cancel:'),'cancel:1:12:42')
  pass('Canceling a batch rejects active and queued tasks, skips queued callbacks and frees the next task slot.')
  await start(`export function mount({tasks}){tasks.configure({concurrency:2,workerLimit:1});${click("let release,notify,pending;const ready=new Promise(resolve=>notify=resolve);const owner=tasks.run('owner',async task=>{await task.worker('assets/job.js');notify();await new Promise(resolve=>release=resolve)});await ready;const value=await tasks.run('finished',task=>{pending=task.worker('assets/job.js').then(()=> 'leaked',error=>error.name);return 42});release();await owner;const late=await pending;const next=await tasks.run('next',async task=>{await task.worker('assets/job.js');return 43});document.getElementById('result').textContent='late:'+late+':'+value+':'+next")}}`)
  assert.equal(await run('late:'),'late:AbortError:42:43')
  pass('Finishing a task cancels its late Worker allocation and leaves a slot available for the next real Worker.')
  await start(`export function mount({request}){${click("let rejected=0;for(const body of [new Uint8Array(16777217),new ArrayBuffer(16777217)]){body.slice=()=>{throw new Error('copied oversized body')};try{await request("+JSON.stringify(origin+'/post')+",{method:'POST',body})}catch(error){if(error.name==='RangeError')rejected++;else throw error}}document.getElementById('result').textContent='early:'+rejected")}}`)
  assert.equal(await run('early:'),'early:2')
  pass('Oversized typed arrays and ArrayBuffers are rejected before copying or allocating a native HTTP request.')
  const endpoint=JSON.stringify(origin+'/post')
  await start(`export function mount({request}){${click(`const response=await request(${endpoint},{method:'POST',headers:{'Content-Type':'application/json','X-Firefly-Test':'fixture-only'},body:JSON.stringify({message:'中文 🐱',sample:'a'.repeat(65536)}),timeoutMs:60000});const value=await response.json();document.getElementById('result').textContent=JSON.stringify({status:response.status,message:value.json?.message,sample:value.json?.sample?.length,header:value.headers?.['x-firefly-test']})`)}}`)
  const post=JSON.parse(await run('fixture-only'));assert.equal(post.status,200);assert.equal(post.message,'中文 🐱');assert.equal(post.sample,65536)
  pass('A real HTTPS POST echoes the custom header, Unicode JSON body and 64 KiB payload correctly.')
  await start(`export function mount({request}){${click(`const response=await request(${JSON.stringify(origin+'/get?firefly_stream=1')},{stream:true,timeoutMs:60000});const reader=response.body.getReader();let text='',chunks=0;const decoder=new TextDecoder();while(true){const{value,done}=await reader.read();if(done)break;chunks++;text+=decoder.decode(value,{stream:true})}text+=decoder.decode();document.getElementById('result').textContent='stream:'+JSON.parse(text).args.firefly_stream+':'+chunks`)}}`)
  assert((await run('stream:1:')).startsWith('stream:1:'))
  pass('A real HTTPS response is consumed through the native chunked response.body channel.')
  await start(`export function mount({request}){${click(`const controller=new AbortController();const promise=request(${JSON.stringify(origin+'/delay/3')},{signal:controller.signal,timeoutMs:60000});setTimeout(()=>controller.abort(),100);let canceled=false;try{await promise}catch(error){canceled=error.name==='AbortError'}document.getElementById('result').textContent='abort:'+canceled`)}}`)
  assert.equal(await run('abort:'),'abort:true')
  pass('AbortSignal cancels an actual native HTTPS operation without waiting for the remote response.')
  await start(`export function mount({resolveLink}){${click(`const value=await resolveLink(${JSON.stringify(origin+'/get')});document.getElementById('result').textContent='resolved:'+value.status+':'+value.url`)}}`)
  assert((await run('resolved:200:')).startsWith('resolved:200:'+origin+'/get'))
  pass('The existing resolveLink helper remains callable through the real native permission boundary.')
  const native=await client.evaluate(async origin=>{
    const invoke=window.__TAURI_INTERNALS__.invoke,allowedHosts=[origin],url=origin+'/get'
    const token=await invoke('web_tool_http_create',{url,allowedHosts,options:{}});await invoke('web_tool_http_cancel',{id:token})
    let stopped=false,badHeader=false
    try{await invoke('web_tool_http_start',{id:token})}catch{stopped=true}
    try{await invoke('web_tool_http_create',{url,allowedHosts,options:{headers:{Cookie:'test-only'}}})}catch(error){badHeader=error.code==='HTTP_HEADER_INVALID'}
    return{stopped,badHeader}
  },origin)
  assert.deepEqual(native,{stopped:true,badHeader:true})
  pass('Canceled reservations cannot start and native header policy rejects Cookie injection.')
  await writeFile(path.join(directory,'services.json'),JSON.stringify(report,null,2))
  await rm(path.join(directory,'services-error.txt'),{force:true})
}catch(error){await writeFile(path.join(directory,'services-error.txt'),String(error.stack||error));throw error}
finally{
  try{await client.evaluate(moduleId=>{window.ServicesReview?.stopBrowserModule();document.getElementById('services-review')?.remove();window.ServicesReview=undefined;delete window.servicesReport;const prefix=`firefly.browser-module.${moduleId}.`;for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key)},moduleId)}catch{}
  await client.invoke('save_tool_storage',{moduleId,valuesJson:'{}'}).catch(()=>{})
  await client.invoke('save_tool_storage',{moduleId:moduleId+'_other',valuesJson:'{}'}).catch(()=>{})
  await client.invoke('save_tool_storage',{moduleId:previewId,valuesJson:'{}'}).catch(()=>{})
  if(installed)await client.invoke('delete_tools',{toolIds:manifest.tools.map(tool=>tool.id)}).catch(()=>{})
  if(!windows){client.device('shell','run-as','firefly.toolbox','rm','-f',`cache/${name}`);client.device('shell','rm','-f',remote)}
  client.close()
}
