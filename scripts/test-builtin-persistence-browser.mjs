import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const host=await build({stdin:{contents:"export {mountWebTool,stopBrowserModule} from './src/services/browserModule.ts'",resolveDir:process.cwd(),sourcefile:'persistence-review.ts'},bundle:true,write:false,platform:'browser',format:'esm'})
const sources={}
for(const name of ['memo','countdown','mindmap'])sources[name]=(await build({entryPoints:[`src-tauri/builtin-tools/src/${name}.js`],bundle:true,write:false,platform:'browser',format:'esm'})).outputFiles[0].text
const html=Object.fromEntries(['memo','countdown','mindmap'].map(name=>[name,fs.readFileSync(`src-tauri/builtin-tools/src/${name}.html`,'utf8')]))
const css=['common','life','utility','creative-tools'].map(name=>fs.readFileSync(`src-tauri/builtin-tools/src/${name}.css`,'utf8')).join('\n')
let server,browser,origin
before(async()=>{
 server=createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname
  if(name==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><style>body{margin:0}#host{width:100%;min-width:0}.web-tool-frame{display:block;width:100%;border:0}</style><div id="host"></div>');return}
  if(name==='/host.js'){response.setHeader('Content-Type','text/javascript');response.end(host.outputFiles[0].text);return}
  const root=path.resolve('public'),file=path.resolve(root,'.'+name)
  if(!file.startsWith(root+path.sep)){response.writeHead(404);response.end();return}
  try{response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(file))}catch{response.writeHead(404);response.end()}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe'
 browser=await chromium.launch({headless:true,executablePath:process.env.FIREFLY_TEST_BROWSER||(fs.existsSync(chrome)?chrome:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')})
})
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve))})
async function fixture(t,width=1280){
 const context=await browser.newContext({viewport:{width,height:900}});t.after(()=>context.close())
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  window.isTauri=true;window.stored=new Map();window.saveControl={hold:true,fail:false};window.pendingWrites=[];window.hostErrors=[]
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
   if(command==='load_tool_storage'){if(args.readOnly)return window.stored.get(args.moduleId)??null;if(!window.stored.has(args.moduleId))window.stored.set(args.moduleId,args.legacyJson);return window.stored.get(args.moduleId)}
   if(command==='save_tool_storage'){if(window.saveControl.hold)await new Promise(resolve=>window.pendingWrites.push(resolve));if(window.saveControl.fail)throw new Error('disk full');window.stored.set(args.moduleId,args.valuesJson);return}
   throw new Error(command)
  }}
 })
 await page.goto(origin)
 async function mount(name){
  const ids={memo:'notes.memo',countdown:'time.countdown',mindmap:'creative.mindmap'}
  await page.evaluate(async({script,html,css,id})=>{window.api=await import('/host.js');await window.api.mountWebTool(document.getElementById('host'),{moduleId:'tool.'+id,script,html,css,networkHosts:[],timeoutMs:15000,inputBytes:8388608,outputBytes:4194304,openFile:async()=>null,saveFile:async()=>true,copyText:async()=>{},onError:error=>window.hostErrors.push(error)})},{script:sources[name],html:html[name],css:name==='mindmap'?fs.readFileSync('src-tauri/builtin-tools/src/mindmap.css','utf8'):css,id:ids[name]})
 }
 const frame=page.frameLocator('iframe'),save=state=>frame.locator(`[data-save-state="${state}"]`)
 async function release(){await page.evaluate(()=>{window.saveControl.hold=false;for(const resolve of window.pendingWrites.splice(0))resolve()})}
 async function data(id,key){return page.evaluate(({id,key})=>JSON.parse(JSON.parse(window.stored.get('tool.'+id))[key]),{id,key})}
 t.after(()=>assert.deepEqual(errors,[]))
 return{page,frame,save,mount,release,data}
}
for(const width of [1280,390]){
 test(`memo waits for acknowledgement and preserves notes above the old 64 KiB limit at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('memo');await f.frame.locator('#new').click();await f.save('pending').waitFor()
  assert.equal(await f.save('saved').count(),0)
  await f.release();await f.save('saved').waitFor()
  for(let index=0;index<3;index++){if(index)await f.frame.locator('#new').click();await f.frame.locator('#body').fill('猫'.repeat(12000));await f.save('saved').waitFor()}
  const notes=await f.data('notes.memo','memo');assert.equal(notes.notes.length,3);assert(notes.notes.every(note=>note.body.length===12000));assert((await f.frame.locator('#capacity').textContent()).includes('1024 KiB'))
  assert((await f.page.evaluate(()=>new TextEncoder().encode(window.stored.get('tool.notes.memo')).byteLength))>65536)
  await f.page.evaluate(()=>window.api.stopBrowserModule());await f.mount('memo');assert.equal(await f.frame.locator('#body').inputValue(),'猫'.repeat(12000))
 })
 test(`countdown retries a failed save without duplicating a day at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('countdown');await f.frame.locator('#name').fill('First');await f.frame.locator('#save').click();await f.save('pending').waitFor();assert.equal(await f.save('saved').count(),0)
  await f.release();await f.save('saved').waitFor();await f.page.evaluate(()=>window.saveControl.fail=true)
  await f.frame.locator('#name').fill('Second');await f.frame.locator('#save').click();await f.save('error').waitFor()
  assert.equal((await f.data('time.countdown','days')).length,1)
  await f.page.evaluate(()=>window.saveControl.fail=false);await f.frame.getByRole('button',{name:'重试保存'}).click();await f.save('saved').waitFor()
  assert.deepEqual((await f.data('time.countdown','days')).map(day=>day.name),['First','Second'])
  await f.page.waitForFunction(()=>window.hostErrors.at(-1)==='')
 })
 test(`mindmap confirms the latest draft and retries a storage failure on the next edit at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('mindmap');if(width<760)await f.frame.locator('#mp-panel-btn').click();await f.frame.locator('#mp-text').fill('First edit')
  await f.page.waitForFunction(()=>window.pendingWrites.length>0);assert.equal(await f.frame.locator('#mp-dot').getAttribute('hidden'),null);await f.frame.locator('#mp-text').fill('Latest edit')
  await f.release();await f.page.waitForFunction(()=>JSON.parse(JSON.parse(window.stored.get('tool.creative.mindmap')||'{}')['mindmap.draft.v1']||'{}').root?.text==='Latest edit');await f.frame.locator('#mp-dot').waitFor({state:'hidden'})
  await f.page.evaluate(()=>window.saveControl.fail=true);await f.frame.locator('#mp-text').fill('Retry this edit');await f.page.waitForFunction(()=>window.hostErrors.some(e=>e.includes('disk full')))
  assert.equal(await f.frame.locator('#mp-dot').getAttribute('hidden'),null);assert.equal((await f.data('creative.mindmap','mindmap.draft.v1')).root.text,'Latest edit')
  await f.page.evaluate(()=>window.saveControl.fail=false);await f.frame.locator('#mp-text').fill('Retried edit');await f.page.waitForFunction(()=>JSON.parse(JSON.parse(window.stored.get('tool.creative.mindmap')||'{}')['mindmap.draft.v1']||'{}').root?.text==='Retried edit');await f.frame.locator('#mp-dot').waitFor({state:'hidden'})
  assert.equal((await f.data('creative.mindmap','mindmap.draft.v1')).root.text,'Retried edit')
 })
}
test('a delayed acknowledgement after stopping cannot report success into the next tool',async t=>{
 const f=await fixture(t);await f.mount('memo');await f.frame.locator('#new').click();await f.save('pending').waitFor()
 await f.page.evaluate(()=>window.api.stopBrowserModule());await f.release();await f.mount('countdown');assert.equal(await f.save('saved').count(),0);assert.equal(await f.save('pending').count(),0)
})
test('storage recovery does not erase an unrelated runtime error',async t=>{
 const f=await fixture(t);await f.release();await f.mount('memo');await f.page.evaluate(()=>window.saveControl.fail=true);await f.frame.locator('#new').click();await f.save('error').waitFor()
 await f.frame.locator('#new').evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{error:new Error('unrelated failure'),message:'unrelated failure'})))
 // The fixture intentionally reports this error through the actual runtime.
 await f.page.evaluate(()=>window.saveControl.fail=false);await f.frame.getByRole('button',{name:'重试保存'}).click();await f.save('saved').waitFor()
 assert((await f.page.evaluate(()=>window.hostErrors.at(-1))).includes('unrelated failure'))
})
test('a synchronous quota failure preserves the editor and can save after reducing stored content',async t=>{
 const f=await fixture(t);await f.release();await f.mount('memo');await f.frame.locator('#new').click();await f.save('saved').waitFor()
 await f.frame.locator('#body').evaluate(()=>localStorage.setItem('padding','x'.repeat(1048000)))
 await f.frame.locator('#body').fill('x'.repeat(2000));await f.save('error').waitFor()
 assert.equal(await f.frame.getByRole('button',{name:'重试保存'}).isVisible(),false)
 assert.equal(await f.frame.locator('#body').inputValue(),'x'.repeat(2000))
 await f.frame.locator('#body').evaluate(()=>localStorage.removeItem('padding'))
 await f.frame.locator('#body').fill('x'.repeat(2001));await f.save('saved').waitFor()
 assert.equal((await f.data('notes.memo','memo')).notes[0].body.length,2001)
})
