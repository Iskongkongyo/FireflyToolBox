// Real-browser OCR regression. Uses a separate, disposable browser profile;
// never touches a running browser or a connected phone. Node 22 + Chromium.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync} from 'node:fs'
import {createServer} from 'node:http'
import {chromium} from 'playwright-core'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer as createViteServer} from 'vite'
import {ocrFixture} from './ocr-browser-fixture.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),artifact=path.join(root,'target-check/mobile-creative');mkdirSync(artifact,{recursive:true})
const chromePath='C:/Program Files/Google/Chrome/Application/chrome.exe'
const browserPath=process.env.FIREFLY_TEST_BROWSER||(existsSync(chromePath)?chromePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
const tools=[],css=['common','life','utility','new-tools','creative-tools'].map(name=>readFileSync(path.join(root,'src-tauri/builtin-tools/src',name+'.css'),'utf8')).join('\n')
const toolPage=name=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${readFileSync(path.join(root,'src-tauri/builtin-tools/src',name+'.html'),'utf8')}<script type="module">
 import {mount} from '/bundle/${name}.js';window.results=[];window.errors=[];window.addEventListener('error',e=>errors.push(e.message));document.documentElement.style.setProperty('--firefly-viewport-height',Math.max(300,innerHeight-112)+'px');localStorage.clear();
 window.dispose=mount({storage:{flush:async()=>{}},signal:new AbortController().signal,openFile:async()=>window.nextFile||null,saveFile:async(name,blob)=>{results.push({name,type:blob.type,size:blob.size,text:blob.type.includes('json')||blob.type.includes('markdown')||blob.type.includes('html')||blob.type.includes('svg')?await blob.text():null});return true},copyText:async text=>{window.copied=text}});window.ready=true;
 </script></body></html>`
const vite=await createViteServer({configFile:path.join(root,'vite.config.ts'),server:{middlewareMode:true,hmr:false,watch:null},appType:'spa',logLevel:'error'})
const server=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');if(req.url==='/ocr'||req.url==='/ocr-sandbox'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(ocrFixture(origin,req.url==='/ocr-sandbox'));return}if(req.url?.startsWith('/ocr-resource/')&&/^[\w.-]+$/.test(req.url.slice(14))){const name=req.url.slice(14);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'application/octet-stream');res.end(readFileSync(path.join(root,'src-tauri/builtin-tools/generated/media-assets',name)));return}const name=req.url?.replace('/bundle/','').replace('.js','');if(req.url?.startsWith('/bundle/')&&(tools.includes(name)||name==='ocr')){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(path.join(root,'src-tauri/builtin-tools/generated',name+'.js')))}else if(tools.includes(req.url?.slice(1))){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(toolPage(req.url.slice(1)))}else if(req.url==='/app'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(path.join(root,'dist/index.html')))}else if(req.url?.startsWith('/assets/')&&/^[\w.-]+$/.test(req.url.slice(8))){const asset=path.join(root,'dist/assets',req.url.slice(8)),extension=path.extname(asset);if(!existsSync(asset)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',({'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'})[extension]||'application/octet-stream');res.end(readFileSync(asset))}else vite.middlewares(req,res)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
const context=await chromium.launchPersistentContext(mkdtempSync(path.join(artifact,'profile-')),{executablePath:browserPath,headless:true,viewport:{width:1280,height:900},hasTouch:true,args:['--disable-gpu'],timeout:30000})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function waitFor(fn,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await fn();if(value)return value}catch{}await delay(50)}throw new Error('Browser readiness timed out')}
let page,cdp
try{
 const evaluate=expression=>page.evaluate(expression)
 async function open(name,width=390,height=844){
  const old=page;page=await context.newPage();if(old)await old.close();const session=await context.newCDPSession(page);cdp={call:(method,params={})=>session.send(method,params)};
  if(name==='app')await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:async command=>{if(['list_tools','list_favorites','list_recent_tools','list_custom_tools','list_websites'].includes(command))return[];throw new Error('Unexpected native command: '+command)}}});
  await cdp.call('Emulation.setUserAgentOverride',{userAgent:width<=900?'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36'});await page.setViewportSize({width,height});await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=900});await cdp.call('Emulation.setTouchEmulationEnabled',{enabled:width<=900,maxTouchPoints:5});await page.goto(origin+'/'+name,{waitUntil:'load',timeout:30000});await waitFor(()=>evaluate(name==='app'?"!!document.querySelector('.app-shell')":'window.ready===true'),30000);await cdp.call('Emulation.setPageScaleFactor',{pageScaleFactor:1});await delay(100)
 }
 await test('OCR responsive source, settings and result cards stay within phone and desktop widths',async()=>{
  for(const width of [320,390,1280]){await open('ocr',width,900);const m=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,columns:getComputedStyle(document.querySelector('.ocr-layout')).gridTemplateColumns.split(' ').length,choose:document.getElementById('choose').getBoundingClientRect().height})`);assert.equal(m.overflow,false);assert(m.choose>=44);assert.equal(m.columns,width>850?2:1)}
 })
 const ocrEval=code=>evaluate('window.ocrEval('+JSON.stringify(code)+')')
 async function ocrImage(kind){await ocrEval(`(async()=>{await document.fonts.ready;const c=document.createElement('canvas');c.width=${kind==='crop'?1400:1000};c.height=${kind==='crop'?550:280};const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#111';ctx.font="48px 'Microsoft YaHei', Arial";${kind==='crop'?"ctx.fillText('KEEP 123',360,130);ctx.fillText('IGNORE 456',360,440)":"ctx.fillText('中文测试',60,95);ctx.fillText('Hello 123',60,195)"};window.nextImage=await new Promise(r=>c.toBlob(r,'image/png'));document.getElementById('choose').click()})()`);await waitFor(()=>ocrEval(`!document.getElementById('process').disabled`),30000)}
 await test('OCR real PP-OCR models recognize Chinese/English entirely inside an opaque sandbox',async()=>{
  await open('ocr-sandbox',900,950);await ocrImage('mixed');await ocrEval(`document.getElementById('process').click()`);await waitFor(()=>ocrEval(`!document.getElementById('process').disabled`),90000);const data=await ocrEval(`({text:document.getElementById('output').value,summary:document.getElementById('confidence').textContent,status:document.getElementById('status').textContent,errors})`);writeFileSync(path.join(artifact,'ocr-mixed-result.json'),JSON.stringify(data,null,2));assert(data.text.replace(/\s+/g,'').includes('中文测试'));assert(data.text.replace(/\s+/g,'').toLowerCase().includes('hello123'));assert.deepEqual(data.errors,[]);await ocrEval(`document.getElementById('copy').click();document.getElementById('save').click()`);await waitFor(()=>ocrEval(`!!window.saved`));assert.equal(await ocrEval('copied'),data.text);assert.equal(await ocrEval('saved.text'),data.text)
 })
 await test('OCR crops original pixels before recognition and cancel preserves edited output',async()=>{
  await open('ocr-sandbox',390,900);await ocrImage('crop');await ocrEval(`for(const [id,value]of Object.entries({left:300,top:45,width:700,height:140})){document.getElementById(id).value=value;document.getElementById(id).dispatchEvent(new Event('input'))}document.getElementById('process').click()`);await waitFor(()=>ocrEval(`!document.getElementById('process').disabled`),90000);const value=await ocrEval(`document.getElementById('output').value`);assert(value.replace(/\s+/g,'').includes('KEEP123'));assert(!value.includes('IGNORE'));await ocrEval(`document.getElementById('output').value='保留校对文字';document.getElementById('output').dispatchEvent(new Event('input'));document.getElementById('process').click();document.getElementById('cancel').click()`);await waitFor(()=>ocrEval(`!document.getElementById('process').disabled`));assert.equal(await ocrEval(`document.getElementById('output').value`),'保留校对文字')
 })
}finally{
 await context.close();await vite.close();await new Promise(resolve=>server.close(resolve))
}
