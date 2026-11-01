import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {capacityFixture} from './module-capacity-fixtures.mjs'
import {connectAndroid} from './android-device-client.mjs'

const adb=process.env.FIREFLY_ADB||path.join(process.env.ANDROID_HOME||path.join(process.env.LOCALAPPDATA,'Android/Sdk'),'platform-tools/adb.exe')
const connected=execFileSync(adb,['devices'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(line=>/\tdevice$/.test(line)).map(line=>line.split('\t')[0])
const sourceSerial=process.env.FIREFLY_SYNC_SOURCE_SERIAL||connected.find(id=>id.startsWith('emulator-'))
const targetSerial=process.env.FIREFLY_SYNC_TARGET_SERIAL||connected.find(id=>!id.startsWith('emulator-'))
assert(sourceSerial&&targetSerial&&sourceSerial!==targetSerial,'Connect a disposable emulator as source and a target device, or set FIREFLY_SYNC_SOURCE_SERIAL/FIREFLY_SYNC_TARGET_SERIAL.')
assert(sourceSerial.startsWith('emulator-'),'Use a disposable emulator as source so the test never exports a real device\'s saved data.')
const originalSerial=process.env.FIREFLY_TEST_SERIAL
process.env.FIREFLY_TEST_SERIAL=sourceSerial;const source=await connectAndroid()
let target
try{process.env.FIREFLY_TEST_SERIAL=targetSerial;target=await connectAndroid()}catch(error){source.close();throw error}
finally{if(originalSerial===undefined)delete process.env.FIREFLY_TEST_SERIAL;else process.env.FIREFLY_TEST_SERIAL=originalSerial}
const token=crypto.randomUUID().replaceAll('-','').slice(0,12),moduleId=`dev.example.persist_${token}`
const directory=path.resolve('target-check/sync-storage-review'),packageName=`persist-${token}.fftool`,remote=`/data/local/tmp/${packageName}`
await mkdir(directory,{recursive:true})
const compiled=await build({stdin:{contents:"export{mountWebTool,stopBrowserModule}from './src/services/browserModule.ts'",resolveDir:process.cwd(),sourcefile:'device-persistence.ts'},bundle:true,write:false,platform:'browser',format:'iife',globalName:'PersistenceReview'})
const report={source:sourceSerial,target:targetSerial,moduleId,checks:[]},installed=new Set(),ownedSync=new Set()
let manifest
const pass=value=>{report.checks.push(value);console.log('PASS:',value)}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const defaults={modules:false,automations:false,builtins:false,favorites:false,websites:false,layout:false,preferences:false,web_data:false}
async function inject(client){
 for(let attempt=0;attempt<100;attempt++){try{if(await client.evaluate(()=>!!window.__TAURI_INTERNALS__&&!!document.body))break}catch{}await pause(100)}
 const result=await client.call('Runtime.evaluate',{expression:compiled.outputFiles[0].text});assert(!result.exceptionDetails)
 await client.evaluate(()=>{document.getElementById('persistence-review')?.remove();const root=document.createElement('div');root.id='persistence-review';root.style.cssText='position:fixed;inset:0;background:white;z-index:2147483647;overflow:auto';document.body.append(root)})
}
async function mount(client,index){
 const details=await client.invoke('get_module_details',{moduleId}),tool=details.manifest.tools[index]
 await client.evaluate(async({details,tool,name})=>{window.reviewErrors=[];await window.PersistenceReview.mountWebTool(document.getElementById('persistence-review'),{moduleId:'tool.'+tool.id,resourceModuleId:details.manifest.module_id,html:details.scripts[tool.entry],css:details.scripts[tool.ui.style],script:details.scripts[tool.ui.script],networkHosts:[],timeoutMs:15000,inputBytes:8388608,outputBytes:4194304,openFile:async()=>null,saveFile:async()=>true,copyText:async()=>{},onError:value=>window.reviewErrors.push(value)});document.querySelector('#persistence-review iframe').name=name},{details,tool,name:'persist-'+token})
 const document=await client.call('DOM.getDocument',{depth:0}),node=await client.call('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#persistence-review iframe'})
 assert(node.nodeId);const owner=await client.call('DOM.describeNode',{nodeId:node.nodeId}),frameId=owner.node.frameId||owner.node.contentDocument?.frameId
 assert(frameId);return(await client.call('Page.createIsolatedWorld',{frameId,worldName:'persistence-test'})).executionContextId
}
async function evaluate(client,id,expression){const result=await client.call('Runtime.evaluate',{expression,contextId:id,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
async function saved(client,id){for(let attempt=0;attempt<150;attempt++){const state=await evaluate(client,id,'document.querySelector("[data-save-state]")?.dataset.saveState');if(state==='saved')return;if(state==='error')throw new Error(await evaluate(client,id,'document.querySelector("[data-save-state]").textContent'));await pause(50)}throw new Error('Persistent save acknowledgement timed out')}
const namespace=index=>'tool.'+manifest.tools[index].id
async function load(client,index){return JSON.parse(await client.invoke('load_tool_storage',{moduleId:namespace(index),legacyJson:'{}'}))}
async function store(client,index,values){await client.invoke('save_tool_storage',{moduleId:namespace(index),valuesJson:JSON.stringify(values)})}
async function roundtrip(replace=false){
 ownedSync.add(source)
 const share=await source.invoke('sync_share',{options:{...defaults,web_data:true},preferences:{}})
 const nativePort=Number(share.addresses[0].split(':').at(-1)),forward=source.device('forward','tcp:0',`tcp:${nativePort}`)
 let reverse
 try{
  reverse=target.device('reverse','tcp:0',`tcp:${forward}`)
  ownedSync.add(target)
  const preview=await target.invoke('sync_receive',{endpoint:`127.0.0.1:${reverse}`,code:share.code})
  const allowed=new Set(manifest.tools.map(tool=>'web_data:tool.'+tool.id))
  const keys=preview.items.filter(item=>allowed.has(item.key)&&item.status!=='same').map(item=>item.key)
  const applied=await target.invoke('sync_apply',{selection:{options:{...defaults,web_data:true},keys,replace},legacyStorage:{}})
  return{preview,applied}
 }finally{await source.invoke('sync_close').catch(()=>{});if(reverse)target.device('reverse','--remove',`tcp:${reverse}`);source.device('forward','--remove',`tcp:${forward}`)}
}
try{
 for(const client of [source,target]){const state=await client.invoke('sync_status');assert(!state||!['waiting','transferring'].includes(state.state),'A user sync is already active.');}
 const folder=path.join(directory,'module-'+token),output=path.join(directory,packageName)
 manifest=await capacityFixture(folder,{entries:3,moduleId})
 const css=(await Promise.all(['common','life','utility','creative-tools'].map(name=>readFile(`src-tauri/builtin-tools/src/${name}.css`,'utf8')))).join('\n')
 for(const[index,name]of ['memo','countdown','mindmap'].entries()){
  const tool=manifest.tools[index],script=await build({entryPoints:[`src-tauri/builtin-tools/src/${name}.js`],bundle:true,write:false,platform:'browser',format:'esm'})
  await writeFile(path.join(folder,tool.entry),await readFile(`src-tauri/builtin-tools/src/${name}.html`));await writeFile(path.join(folder,tool.ui.style),name==='mindmap'?await readFile('src-tauri/builtin-tools/src/mindmap.css','utf8'):css);await writeFile(path.join(folder,tool.ui.script),script.outputFiles[0].text)
 }
 const pack=spawnSync(process.execPath,['scripts/bundle-module.mjs',folder,output],{encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(pack.status,0,pack.stderr)
 for(const client of [source,target]){
  client.device('push',output,remote);client.device('shell',`cat ${remote} | run-as firefly.toolbox sh -c 'cat > cache/${packageName}'`)
  await client.invoke('install_module_file',{path:`content://firefly.toolbox.fileprovider/my_cache_images/${packageName}`});installed.add(client)
  await inject(client)
  let id=await mount(client,0);await evaluate(client,id,`document.getElementById('new').click();document.getElementById('body').value='Native 中文 🐱';document.getElementById('body').dispatchEvent(new Event('input',{bubbles:true}))`);await saved(client,id)
  assert.equal(JSON.parse((await load(client,0)).memo).notes[0].body,'Native 中文 🐱')
  id=await mount(client,1);await evaluate(client,id,`document.getElementById('name').value='Native day';document.getElementById('save').click()`);await saved(client,id);assert.equal(JSON.parse((await load(client,1)).days)[0].name,'Native day')
  id=await mount(client,2);await evaluate(client,id,`document.getElementById('mp-text').value='Native mindmap';document.getElementById('mp-text').dispatchEvent(new Event('input',{bubbles:true}))`);for(let n=0;n<150;n++){if(JSON.parse((await load(client,2))['mindmap.draft.v1']||'{}').root?.text==='Native mindmap')break;await pause(50)}assert.equal(JSON.parse((await load(client,2))['mindmap.draft.v1']).root.text,'Native mindmap')
  pass(`${client===source?'Emulator':'Device'}: memo, countdown and mindmap report success after real SQLite writes.`)
  await client.call('Page.reload');await pause(500);await inject(client);id=await mount(client,0);assert.equal(await evaluate(client,id,'document.getElementById("body").value'),'Native 中文 🐱')
  await client.evaluate(()=>window.PersistenceReview.stopBrowserModule())
  pass(`${client===source?'Emulator':'Device'}: saved tool data survives a real main-document reload.`)
 }
 await store(source,0,{same:'remote',new:'incoming'});await store(target,0,{same:'local',old:'keep'})
 let result=await roundtrip();assert(result.preview.web_data_count>=3);assert.deepEqual(await load(target,0),{same:'local',new:'incoming',old:'keep'});pass('The real encrypted native channel merges SQLite data while keeping local conflicting keys.')
 result=await roundtrip(true);assert.deepEqual(await load(target,0),{same:'remote',new:'incoming'});pass('Explicit replacement uses the complete sender snapshot.')
 await store(source,0,{});await roundtrip(true);assert.deepEqual(await load(target,0),{});pass('An explicit empty snapshot clears the selected target tool only.')
 await source.invoke('save_tool_storage',{moduleId:namespace(0),valuesJson:JSON.stringify({edge:String.fromCharCode(0xd800),[String.fromCharCode(0xdfff)]:'key'})})
 await roundtrip(true);const utf16=await load(target,0);assert.equal(utf16.edge.charCodeAt(0),0xd800);assert.equal(utf16[String.fromCharCode(0xdfff)],'key');pass('Isolated UTF-16 code units survive the actual cross-device transport and SQLite import.')
 await store(source,0,{new:'a'.repeat(600000)});await store(target,0,{old:'b'.repeat(600000)})
 await assert.rejects(roundtrip(false),/1 MiB/);assert.equal((await load(target,0)).old.length,600000);assert.equal((await load(target,0)).new,undefined);pass('A native merge overflow rejects the import and leaves the previous target data intact.')
 await store(source,0,{x:'a'.repeat(1048568)});await roundtrip(true);assert.equal((await load(target,0)).x.length,1048568);pass('An exact one-MiB stored snapshot crosses the actual encrypted channel successfully.')
 await writeFile(path.join(directory,'device-results.json'),JSON.stringify(report,null,2))
 await rm(path.join(directory,'device-error.txt'),{force:true})
}catch(error){await writeFile(path.join(directory,'device-error.txt'),String(error.stack||error));throw error}
finally{
 for(const client of [source,target]){
  if(ownedSync.has(client))await client.invoke('sync_close').catch(()=>{})
  await client.evaluate(()=>{window.PersistenceReview?.stopBrowserModule();document.getElementById('persistence-review')?.remove();delete window.PersistenceReview;delete window.reviewErrors}).catch(()=>{})
  if(installed.has(client)){
   for(let index=0;index<manifest.tools.length;index++)await store(client,index,{}).catch(()=>{})
   await client.invoke('delete_tools',{toolIds:manifest.tools.map(tool=>tool.id)}).catch(()=>{})
   await client.call('Page.reload').catch(()=>{})
  }
  client.device('shell','run-as','firefly.toolbox','rm','-f',`cache/${packageName}`);client.device('shell','rm','-f',remote);client.close()
 }
}
