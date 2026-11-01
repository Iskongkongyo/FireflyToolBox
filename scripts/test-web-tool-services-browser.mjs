import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
const workerCode = 'self.onmessage=event=>setTimeout(()=>self.postMessage(event.data),60)'

const compiled = await build({ entryPoints: ['scripts/web-tool-services-fixture.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' })
let server, browser, origin
before(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') { response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><meta charset="utf-8"><div id="host"></div>');return }
    if (pathname === '/fixture.js') {response.setHeader('Content-Type','text/javascript');response.end(compiled.outputFiles[0].text);return}
    const root = path.resolve('public'), file = path.resolve(root, '.' + pathname)
    if (!file.startsWith(root + path.sep)) {response.writeHead(404);response.end();return}
    try {response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(file))}catch{response.writeHead(404);response.end()}
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe'
  browser=await chromium.launch({headless:true,executablePath:process.env.FIREFLY_TEST_BROWSER || (fs.existsSync(chrome)?chrome:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')})
})
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve))})
async function fixture(t,width=1280) {
  const context=await browser.newContext({viewport:{width,height:900}});t.after(()=>context.close())
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(({workerCode})=>{
    const sessions=new Map();let sequence=0
    window.nativeCalls=[];window.sessions=sessions
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      window.nativeCalls.push({command,args})
      if(command==='read_module_resource')return new TextEncoder().encode(workerCode).slice(args.offset,args.offset+args.length).buffer
      if(command==='web_tool_http_create') {
        if(!args.allowedHosts.includes(new URL(args.url).origin))throw {code:'HTTP_ORIGIN_DENIED',message:'Origin denied'}
        const id=String(++sequence).padStart(32,'0');sessions.set(id,{...args,offset:0});return id
      }
      const session=sessions.get(args.id)
      if(command==='web_tool_http_cancel'){sessions.delete(args.id);return true}
      if(!session)throw{code:'HTTP_SESSION_CLOSED',message:'Closed'}
      if(command==='web_tool_http_start') {
        const url=new URL(session.url)
        session.bytes=url.pathname.startsWith('/bytes/')?new Uint8Array(Number(url.pathname.split('/').at(-1))).fill(42):new TextEncoder().encode(JSON.stringify({method:session.options.method,headers:session.options.headers,body:session.options.body_base64?new TextDecoder().decode(Uint8Array.from(atob(session.options.body_base64),char=>char.charCodeAt(0))):''}))
        if(session.bytes.length>session.options.max_response_bytes){sessions.delete(args.id);throw{code:'HTTP_RESPONSE_LIMIT',message:'Limit'}}
        return{status:200,url:session.url,headers:[['content-type','application/json']]}
      }
      if(command==='web_tool_http_read'){const bytes=session.bytes.slice(session.offset,session.offset+262144);session.offset+=bytes.length;if(!bytes.length)sessions.delete(args.id);return bytes.buffer}
      throw new Error(command)
    }}
  },{workerCode})
  await page.goto(origin)
  async function start(script,settings={}) {
    await page.evaluate(async({script,settings})=>{window.fixture=await import('/fixture.js');window.report=await window.fixture.mount(document.getElementById('host'),script,settings)},{script,settings})
  }
  const frame=page.frameLocator('.web-tool-frame')
  async function run(expected) {await frame.locator('#run').click();await frame.locator('#result').filter({hasText:expected}).waitFor({timeout:20000})}
  t.after(()=>assert.deepEqual(errors,[]))
  return{page,frame,start,run}
}
for(const width of [1280,390])test(`SQLite-compatible storage API migrates to IndexedDB and survives reload at ${width}px`,async t=>{
  const f=await fixture(t,width)
  await f.page.evaluate(()=>localStorage.setItem('firefly.browser-module.preview.services-review.notes','旧数据 🐱'))
  await f.start(`export function mount({storage}){document.getElementById('result').textContent=localStorage.getItem('notes');document.getElementById('run').onclick=async()=>{localStorage.clear();localStorage.setItem('x','a'.repeat(1048568));sessionStorage.setItem('x','a'.repeat(1048568));await storage.flush();document.getElementById('result').textContent='saved'}}`)
  assert.equal(await f.frame.locator('#result').textContent(),'旧数据 🐱')
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('firefly.browser-module.preview.services-review.notes')),null)
  await f.run('saved');await f.page.reload()
  await f.start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('x').length+':'+sessionStorage.length}`)
  assert.equal(await f.frame.locator('#result').textContent(),'1048568:0')
})
test('real opaque-frame Workers reach eight and queued tasks drain in order',async t=>{
  const f=await fixture(t)
  await f.start(`export function mount({tasks}){tasks.configure({concurrency:8,workerLimit:8});document.getElementById('run').onclick=async()=>{let active=0,peak=0;const order=[];const values=await Promise.all(Array.from({length:12},(_,i)=>tasks.run(String(i),async task=>{active++;peak=Math.max(peak,active);order.push(i);const worker=await task.worker('assets/job.js');const value=await new Promise(resolve=>{worker.onmessage=e=>resolve(e.data);worker.postMessage(i)});active--;return value})));document.getElementById('result').textContent=JSON.stringify({peak,order,values})}}`,{resources:[{path:'assets/job.js',size:new TextEncoder().encode(workerCode).length,sha256:'0'.repeat(64)}]})
  await f.run('peak')
  const value=JSON.parse(await f.frame.locator('#result').textContent())
  assert.equal(value.peak,8);assert.deepEqual(value.order,Array.from({length:12},(_,i)=>i));assert.deepEqual(value.values,value.order)
  assert((await f.page.evaluate(()=>window.report.statuses)).some(status=>status.message.includes('等待')))
  assert.deepEqual(await f.page.evaluate(()=>window.report.errors),[])
})
test('opaque-frame POST forwards headers and Unicode body, and streams sixteen MiB',async t=>{
  const f=await fixture(t)
  await f.start(`export function mount({request}){document.getElementById('run').onclick=async()=>{const echo=await(await request('https://api.example.test/echo',{method:'POST',headers:{Authorization:'Bearer test'},body:'中文'})).json();const response=await request('https://api.example.test/bytes/16777216',{stream:true,maxResponseBytes:16777216});const reader=response.body.getReader();let total=0,valid=true;while(true){const{value,done}=await reader.read();if(done)break;total+=value.length;valid=valid&&value.every(byte=>byte===42)}document.getElementById('result').textContent=JSON.stringify({echo,total,valid})}}`)
  await f.run('16777216')
  const result=JSON.parse(await f.frame.locator('#result').textContent())
  assert.equal(result.echo.body,'中文');assert.equal(result.echo.headers.authorization,'Bearer test');assert.equal(result.total,16777216);assert.equal(result.valid,true)
  assert.equal(await f.page.evaluate(()=>window.sessions.size),0)
  assert.deepEqual(await f.page.evaluate(()=>window.report.errors),[])
})
test('preview cleanup removes preview snapshots without touching installed namespaces',async t=>{
  const f=await fixture(t)
  const write=`export function mount({storage}){document.getElementById('run').onclick=async()=>{localStorage.setItem('x','keep');await storage.flush();document.getElementById('result').textContent='saved'}}`
  await f.start(write,{moduleId:'dev.real-state'});await f.run('saved')
  await f.start(write);await f.run('saved')
  await f.page.evaluate(()=>window.fixture.clearPreviewStorage())
  await f.start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('x')??'empty'}`,{moduleId:'dev.real-state'})
  assert.equal(await f.frame.locator('#result').textContent(),'keep')
  await f.start(`export function mount(){document.getElementById('result').textContent=localStorage.getItem('x')??'empty'}`)
  assert.equal(await f.frame.locator('#result').textContent(),'empty')
})
