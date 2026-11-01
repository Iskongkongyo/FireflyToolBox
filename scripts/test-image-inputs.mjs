// Real generated tools and public v7 file SDK inside an opaque iframe sandbox.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs'
import {createServer} from 'node:http'
import {chromium} from 'playwright-core'
import path from 'node:path'

const source='src-tauri/builtin-tools/src/',generated='src-tauri/builtin-tools/generated/'
const css=['common','life','utility','new-tools','creative-tools'].map(name=>readFileSync(source+name+'.css','utf8')).join('\n')
function fixture(name,origin){
 const child=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${readFileSync(source+name+'.html','utf8')}<script>${readFileSync('public/web-tool-assets.js','utf8')}</script><script type="module">
 import {mount} from '${origin}/bundle/${name}.js';const controller=new AbortController(),assets=FireflyWebToolAssets('image-check',()=>{},controller.signal,[],true);window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.dispose=mount({files:assets.files,signal:controller.signal,copyText:async value=>parent.postMessage({type:'copied',value},'*')});window.ready=true;
 </script></body></html>`
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:1800px;border:0;display:block}</style></head><body><iframe sandbox="allow-scripts" id="tool"></iframe><script>
 window.saved=[];window.reads=[];window.writes=[];window.closedInputs=[];window.errors=[];let sequence=0;const inputs=new Map(),outputs=new Map();
 window.addEventListener('message',async event=>{
 if(event.source!==document.getElementById('tool').contentWindow)return;const m=event.data;
 if(m.type==='copied'){window.copied=m.value;return}if(m.type!=='stream')return;
 let result,error;
 try{switch(m.operation){
 case 'open':{if(!window.nextFile){result=[];break}const id='input-'+(++sequence),f=window.nextFile;inputs.set(id,f);result=[{id,name:f.name,size:f.blob.size,mime_type:f.blob.type,seekable:true}];break}
 case 'read':{reads.push(m.length);const f=inputs.get(m.fileId);result=new Uint8Array(await f.blob.slice(m.offset,m.offset+m.length).arrayBuffer());break}
 case 'close':closedInputs.push(m.fileId);inputs.delete(m.fileId);outputs.delete(m.fileId);result=null;break;
 case 'createWriter':{const id='output-'+(++sequence);outputs.set(id,[]);result={id,workspaceUrl:''};break}
 case 'write':{writes.push(m.bytes.length);const parts=outputs.get(m.fileId);parts.push(m.bytes);result=parts.reduce((total,p)=>total+p.byteLength,0);break}
 case 'save':{const parts=outputs.get(m.fileId);saved.push({name:m.name,blob:new Blob(parts)});outputs.delete(m.fileId);result=true;break}
 default:throw new Error('Unexpected SDK operation '+m.operation)
 }}catch(e){errors.push(e.message);error={message:e.message}}
 event.source.postMessage({id:'image-check',type:'streamResult',requestId:m.requestId,result,error},'*',result instanceof Uint8Array?[result.buffer]:[])
 });document.getElementById('tool').srcdoc=${JSON.stringify(child).replaceAll('</script','<\\/script')};
 </script></body></html>`
}
const server=createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*')
 if(req.url.startsWith('/bundle/')){const name=req.url.slice(8,-3);if(!['imagebase64','color-picker'].includes(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(generated+name+'.js','utf8'));return}
 const name=req.url.slice(1);if(!['imagebase64','color-picker'].includes(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture(name,origin))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`
const artifact='target-check/image-inputs';mkdirSync(artifact,{recursive:true})
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe',browser=process.env.FIREFLY_TEST_BROWSER||(existsSync(chrome)?chrome:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
const context=await chromium.launchPersistentContext(mkdtempSync(path.join(artifact,'profile-')),{executablePath:browser,headless:true,viewport:{width:390,height:900},args:['--disable-gpu'],timeout:30000})
let page,frame
async function open(name,width=390){if(page)await page.close();page=await context.newPage();await page.setViewportSize({width,height:900});await page.goto(origin+'/'+name);frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>window.ready===true,null,{timeout:30000})}
const click=id=>frame.evaluate(id=>document.getElementById(id).click(),id)
const idle=id=>frame.waitForFunction(id=>!document.getElementById(id).disabled,id,{timeout:30000})
async function makeImage(width,height,pad=0){
 await page.evaluate(({width,height,pad})=>{
  const row=Math.ceil(width*3/4)*4,size=54+row*height,bytes=new Uint8Array(size+pad),view=new DataView(bytes.buffer)
  bytes[0]=66;bytes[1]=77;view.setUint32(2,size,true);view.setUint32(10,54,true);view.setUint32(14,40,true);view.setInt32(18,width,true);view.setInt32(22,-height,true);view.setUint16(26,1,true);view.setUint16(28,24,true);view.setUint32(34,row*height,true)
  const center=54+Math.floor(height/2)*row+Math.floor(width/2)*3
  bytes.set([0,51,255,255,170,0],center)
  window.sourceBytes=bytes;window.nextFile={name:'large.bmp',blob:new Blob([bytes],{type:'image/bmp'})}
 },{width,height,pad})
}
async function save(id){const count=await page.evaluate(()=>saved.length);await click(id);await page.waitForFunction(count=>saved.length>count,count);await idle(id)}
try{
 await test('Base64 v7 worker, partial preview, complete copy/save and raw / Data URL output work past old limits',async()=>{
  await open('imagebase64');await makeImage(100,100,9*1048576);await click('open-image');await idle('open-image')
  const ui=await frame.evaluate(()=>({preview:document.getElementById('content').value.length,note:document.getElementById('content-info').textContent,status:document.getElementById('status').textContent,image:document.getElementById('image').naturalWidth,errors}))
  assert.equal(ui.status,'已生成 Base64。');assert.equal(ui.preview,256*1024);assert(ui.note.includes('完整'));assert.equal(ui.image,100);assert.deepEqual(ui.errors,[])
  await save('save-text');await click('copy');await page.waitForFunction(()=>!!window.copied)
  assert(await page.evaluate(async()=>copied===await saved.at(-1).blob.text()))
  const format=await page.evaluate(async()=>{const text=await saved.at(-1).blob.text();return{prefix:text.slice(0,22),length:text.length,expected:22+Math.ceil(sourceBytes.length/3)*4}})
  assert.equal(format.prefix,'data:image/bmp;base64,');assert.equal(format.length,format.expected)
  await frame.evaluate(()=>{document.getElementById('format').value='raw';document.getElementById('format').dispatchEvent(new Event('change'))});await idle('format');await save('save-text')
  assert(await page.evaluate(async()=>{const expected=copied.slice(copied.indexOf(',')+1);return await saved.at(-1).blob.text()===expected}))
  await save('save-image');assert(await page.evaluate(async()=>{const actual=new Uint8Array(await saved.at(-1).blob.arrayBuffer());return actual.length===sourceBytes.length&&actual.every((v,i)=>v===sourceBytes[i])}))
  assert(await page.evaluate(()=>reads.every(n=>n<=1048576)&&writes.every(n=>n<=1048576)&&closedInputs.includes('input-1')&&errors.length===0))
  await page.screenshot({path:path.join(artifact,'base64-390.png')})
 })
 await test('Base64 imports the complete large text and reconstructs the exact original file, with manual editing retained',async()=>{
  await page.evaluate(()=>{window.nextFile={name:'large.base64',blob:saved.find(f=>f.name==='image-base64.txt').blob}})
  await frame.evaluate(()=>{document.getElementById('mode').value='decode';document.getElementById('mode').dispatchEvent(new Event('change'))});await click('open-text');await idle('open-text')
  assert.equal(await frame.evaluate(()=>document.getElementById('content').readOnly),true)
  await click('decode');await idle('decode');assert.equal(await frame.evaluate(()=>document.getElementById('status').textContent),'图片已还原，可保存到设备。')
  await save('save-image');assert(await page.evaluate(async()=>{const actual=new Uint8Array(await saved.at(-1).blob.arrayBuffer());return actual.length===sourceBytes.length&&actual.every((v,i)=>v===sourceBytes[i])}))
  await click('clear');assert.equal(await frame.evaluate(()=>document.getElementById('content').readOnly),false)
  await frame.evaluate(()=>{const input=document.getElementById('content');input.value='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/L9sAAAAASUVORK5CYII=';input.dispatchEvent(new Event('input'))});await click('decode');await idle('decode')
  assert.equal(await frame.evaluate(()=>document.getElementById('image').naturalWidth),1)
 })
 await test('color picker reads a 40 MiB / 14 MP image and keeps adjacent original pixel colors exact',async()=>{
  await open('color-picker');await makeImage(4000,3500);await click('open');await idle('open')
  const ui=await frame.evaluate(()=>({hex:document.getElementById('hex').textContent,position:document.getElementById('pixel-position').textContent,status:document.getElementById('status').textContent,errors}))
  assert.equal(ui.status,'图片已读取，可移动取色。');assert.equal(ui.hex,'#FF3300');assert.equal(ui.position,'X 2000 · Y 1750');assert.deepEqual(ui.errors,[])
  await click('right');assert.equal(await frame.evaluate(()=>document.getElementById('hex').textContent),'#00AAFF')
  await frame.locator('#image-canvas').focus();await frame.locator('#image-canvas').press('ArrowLeft');assert.equal(await frame.evaluate(()=>document.getElementById('hex').textContent),'#FF3300')
  await click('copy-hex');await page.waitForFunction(()=>window.copied==='#FF3300')
  assert(await page.evaluate(()=>reads.every(n=>n<=1048576)&&closedInputs.includes('input-1')&&errors.length===0))
  await page.screenshot({path:path.join(artifact,'picker-390.png')})
 })
 await test('Base64 and color picker cards fit mobile and desktop widths without horizontal overflow',async()=>{
  for(const width of [320,390,1280])for(const name of ['imagebase64','color-picker']){
   await open(name,width);assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' '+width)
  }
 })
}finally{await context.close();await new Promise(r=>server.close(r))}
