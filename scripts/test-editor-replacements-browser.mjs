import assert from 'node:assert/strict'
import {before, after, test} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {chromium} from 'playwright-core'

const directory='target-check/editor-replacements/browser';fs.mkdirSync(directory,{recursive:true})
const stems={ 'drawing.board':'drawing','mind.map':'mindmap','text.diff':'diff','markdown.editor':'markdown' },specs={}
for(const[id,stem]of Object.entries(stems)){const base='src-tauri/builtin-tools/';specs[id]={manifest:JSON.parse(fs.readFileSync(base+'src/'+stem+'.manifest.json','utf8')),html:fs.readFileSync(base+'src/'+stem+'.html','utf8'),css:fs.readFileSync(base+'src/'+stem+'.css','utf8'),script:fs.readFileSync(base+'generated/'+stem+'.js','utf8')}}
const host=await build({stdin:{contents:"export{mountWebTool,stopBrowserModule,setWebToolFullscreen}from './src/services/browserModule.ts'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'})
let server,browser,origin
before(async()=>{
 server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#host{width:100%}.web-tool-frame{display:block;width:100%;border:0}</style><div id="host"></div>');return}if(url.pathname==='/host.js'){res.setHeader('Content-Type','text/javascript');res.end(host.outputFiles[0].text);return}const base=path.resolve('public'),file=path.resolve(base,'.'+url.pathname);try{if(!file.startsWith(base+path.sep))throw Error();res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({headless:true,executablePath:process.env.FIREFLY_TEST_BROWSER||(fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')})
})
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r))})
async function fixture(t,width){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600}),page=await context.newPage(),errors=[];context.setDefaultTimeout(10000)
 page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.hostErrors),[])}finally{await context.close()}})
 await page.addInitScript(()=>{if(window!==top)return;window.isTauri=true;window.stored={};window.saved=[];window.opened=[];window.hostErrors=[];window.saveResult=true;window.nextFile=null;window.__TAURI_INTERNALS__={invoke:async(command,args)=>{if(command==='load_tool_storage')return window.stored[args.moduleId]??(args.readOnly?null:args.legacyJson);if(command==='save_tool_storage'){window.stored[args.moduleId]=args.valuesJson;return}throw Error(command)}}})
 await page.goto(origin)
 async function mount(id){await page.evaluate(async({id,spec})=>{window.api=await import('/host.js');await window.api.mountWebTool(document.getElementById('host'),{moduleId:'tool.'+id,html:spec.html,css:spec.css,script:spec.script,networkHosts:[],timeoutMs:spec.manifest.limits.timeout_ms,inputBytes:spec.manifest.limits.input_bytes,outputBytes:spec.manifest.limits.output_bytes,openFile:async extensions=>{window.opened.push(extensions);const file=window.nextFile;window.nextFile=null;return file?{name:file.name,bytes:new Uint8Array(file.bytes),mimeType:file.mimeType||'application/json'}:null},saveFile:async(name,bytes)=>{window.saved.push({name,bytes:Array.from(bytes)});return window.saveResult},copyText:async text=>{window.copied=text},onError:e=>window.hostErrors.push(e)});if(spec.manifest.tools[0].ui.fullscreen)window.api.setWebToolFullscreen(true)}, {id,spec:specs[id]})}
 const frame=page.frameLocator('.web-tool-frame')
 async function lastSaved(action){const count=await page.evaluate(()=>window.saved.length);await action();await page.waitForFunction(count=>saved.length>count,count);return page.evaluate(()=>saved.at(-1))}
 async function stored(id,key){await page.waitForFunction(({id,key})=>!!JSON.parse(window.stored['tool.'+id]||'{}')[key],{id,key});return page.evaluate(({id,key})=>JSON.parse(JSON.parse(window.stored['tool.'+id])[key]),{id,key})}
 async function reopen(id){await page.evaluate(()=>window.api.stopBrowserModule());await mount(id)}
 return{page,frame,mount,reopen,lastSaved,stored}
}
for(const width of [1280,390]){
 test(`replacement drawing creates vector strokes, rotates, persists and exports PNG/SVG/project at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('drawing.board');await f.frame.locator('#db-cv').waitFor();await f.page.waitForTimeout(180)
  const cv=await f.frame.locator('#db-cv').boundingBox();assert(cv.width>100);const x=cv.x+cv.width*.4,y=cv.y+cv.height*.4
  await f.page.mouse.move(x,y);await f.page.mouse.down();await f.page.mouse.move(x+28,y+25,{steps:8});await f.page.mouse.up()
  const first=await f.stored('drawing.board','drawboard.draft.v1');assert(first.o.length>0)
  if(width>=720){await f.frame.locator('#db-panel').click();assert.equal(await f.frame.locator('#db-side').isVisible(),false);await f.frame.locator('#db-panel').click();assert.equal(await f.frame.locator('#db-side').isVisible(),true)}
  await f.frame.locator('#db-rotate').click();const rotated=await f.stored('drawing.board','drawboard.draft.v1');await f.page.waitForTimeout(600)
  const after=await f.stored('drawing.board','drawboard.draft.v1');assert.equal(after.w,first.h);assert.equal(after.h,first.w)
  await f.reopen('drawing.board');assert((await f.stored('drawing.board','drawboard.draft.v1')).o.length>0)
  if(width===1280){await f.page.setViewportSize({width:2560,height:1440});await f.page.waitForTimeout(200);assert.equal(await f.frame.locator('#db-cv').evaluate(c=>c.getContext('2d').getImageData(Math.round(c.width*.5),Math.round(c.height*.4),1,1).data[3]),255,'A fitted board stays centered when native fullscreen expands the viewport')}
  if(width<720)await f.frame.locator('#db-panel').click();await f.frame.locator('#db-scale').selectOption('1')
  const png=await f.lastSaved(()=>f.frame.locator('#db-save').click()),bytes=Buffer.from(png.bytes);assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),after.w);assert.equal(bytes.readUInt32BE(20),after.h);fs.writeFileSync(`${directory}/drawing-${width}.png`,bytes)
  await f.frame.locator('#db-fmt').selectOption('svg');const svg=await f.lastSaved(()=>f.frame.locator('#db-save').click());assert(Buffer.from(svg.bytes).toString().includes('<svg'))
  await f.frame.locator('#db-fmt').selectOption('jpg');const jpg=await f.lastSaved(()=>f.frame.locator('#db-save').click());assert.equal(Buffer.from(jpg.bytes).toString('hex',0,2),'ffd8')
  const project=await f.lastSaved(()=>f.frame.locator('#db-save-proj').click());assert(JSON.parse(Buffer.from(project.bytes)).o.length>0)
  const imported=JSON.parse(Buffer.from(project.bytes));imported.w=888;imported.h=666;await f.page.evaluate(value=>{window.nextFile={name:'imported.json',bytes:Array.from(new TextEncoder().encode(JSON.stringify(value)))}},imported);await f.frame.locator('#db-open-proj').click();await f.page.waitForTimeout(600);assert.equal((await f.stored('drawing.board','drawboard.draft.v1')).w,888)
 })
 test(`replacement mind map edits nodes, adds children, persists and exports SVG/Markdown/project at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('mind.map');await f.frame.locator('#mp-nodes [data-id]').first().waitFor()
  if(width===1280){await f.page.setViewportSize({width:2560,height:1440});await f.page.waitForTimeout(200);const centered=await f.frame.locator('#mp-stage').evaluate(stage=>{const r=stage.getBoundingClientRect(),n=document.querySelector('#mp-nodes [data-id] rect').getBoundingClientRect();return Math.abs(n.x+n.width/2-r.x-r.width/2)<2&&Math.abs(n.y+n.height/2-r.y-r.height/2)<2});assert(centered,'A fitted map stays centered after entering native fullscreen')}
  if(!await f.frame.locator('#mp-text').isVisible())await f.frame.locator('#mp-panel-btn').click();await f.frame.locator('#mp-text').fill('新版中心 🐱');await f.frame.locator('#mp-text').dispatchEvent('input')
  let draft=await f.stored('mind.map','mindmap.draft.v1');assert.equal(draft.root.text,'新版中心 🐱')
  await f.frame.locator('#mp-addchild').click();await f.frame.locator('#mp-edit').fill('子节点');await f.frame.locator('#mp-edit').press('Enter');await f.page.waitForTimeout(650)
  draft=await f.stored('mind.map','mindmap.draft.v1');assert(draft.root.children.some(c=>c.text==='子节点'))
  if(width<600)await f.frame.locator('#mp-close').click();await f.reopen('mind.map');await f.frame.locator('#mp-nodes').filter({hasText:'新版中心 🐱'}).waitFor()
  await f.frame.locator('#mp-export').click();const svg=await f.lastSaved(()=>f.frame.getByRole('button',{name:/SVG/}).click());assert(Buffer.from(svg.bytes).toString().includes('新版中心'))
  await f.frame.locator('#mp-export').click();const md=await f.lastSaved(()=>f.frame.getByRole('button',{name:/Markdown/}).click());assert(Buffer.from(md.bytes).toString().includes('子节点'))
  await f.frame.locator('#mp-export').click();const png=await f.lastSaved(()=>f.frame.getByRole('button',{name:/PNG.*2/}).click());assert.equal(Buffer.from(png.bytes).toString('hex',0,8),'89504e470d0a1a0a')
  await f.frame.locator('#mp-export').click();const project=await f.lastSaved(()=>f.frame.locator('#mp-pop').getByRole('button',{name:/保存工程/}).click());const imported=JSON.parse(Buffer.from(project.bytes));imported.root.text='导入导图';await f.page.evaluate(value=>{window.nextFile={name:'imported.json',bytes:Array.from(new TextEncoder().encode(JSON.stringify(value)))}},imported);await f.frame.locator('#mp-menu').click();await f.frame.locator('#mp-pop').getByRole('button',{name:/打开工程/}).click();await f.page.waitForTimeout(650);assert.equal((await f.stored('mind.map','mindmap.draft.v1')).root.text,'导入导图')
 })
 test(`replacement diff compares, navigates, handles options, copies and exports real text at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('text.diff');await f.frame.locator('#taLeft').fill('same\nold\nend');await f.frame.locator('#taRight').fill('same\nnew\nadded\nend');await f.frame.locator('#btnCompare').click();await f.frame.locator('#resultView').waitFor({state:'visible'})
  assert.notEqual(await f.frame.locator('#statChg').textContent(),'0 处');await f.frame.locator('#btnNext').click();await f.frame.locator('#segView [data-view=unified]').click();await f.frame.locator('#btnCopy').click();await f.page.waitForFunction(()=>!!window.copied);assert((await f.page.evaluate(()=>copied)).includes('new'))
  const saved=await f.lastSaved(()=>f.frame.locator('#btnSave').click());assert(Buffer.from(saved.bytes).toString().includes('old'))
  await f.frame.locator('#btnEdit').click();await f.frame.locator('#taLeft').fill('hello');await f.frame.locator('#taRight').fill('HELLO');await f.frame.locator('#btnCompare').click();await f.frame.locator('label:has(#optCase)').click();await f.page.waitForTimeout(250);assert.equal((await f.frame.locator('#statSim').textContent()).trim(),'100%')
  await f.frame.locator('#btnEdit').click();await f.page.evaluate(()=>{window.nextFile={name:'gbk.txt',bytes:[0xd6,0xd0,0xce,0xc4]}});await f.frame.locator('#fillLeft').click();await f.page.waitForTimeout(100);assert.equal(await f.frame.locator('#taLeft').inputValue(),'中文')
 })
 test(`replacement Markdown edits/previews, persists, imports, formats and exports without executing HTML at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('markdown.editor');const text='# 新编辑器 🐱\n\n**粗体** 与表格\n\n<script>window.badMarkdown=true</script>'
  await f.frame.locator('#md-ta').fill(text);await f.page.waitForTimeout(700);const draft=await f.stored('markdown.editor','md.draft.v1');assert.equal(draft.t,text)
  assert.equal(await f.frame.locator('html').evaluate(()=>window.badMarkdown===true),false);await f.frame.locator('#md-mode [data-v=prev]').click();await f.frame.locator('#md-prev h1').filter({hasText:'新编辑器'}).waitFor();await f.reopen('markdown.editor')
  await f.frame.locator('#md-mode [data-v=edit]').click();assert.equal(await f.frame.locator('#md-ta').inputValue(),text)
  await f.frame.locator('#md-export').click();const md=await f.lastSaved(()=>f.frame.getByRole('button',{name:/^保存 Markdown/}).click());assert.equal(Buffer.from(md.bytes).toString(),text)
  await f.frame.locator('#md-export').click();const html=await f.lastSaved(()=>f.frame.getByRole('button',{name:/^导出 HTML 网页/}).click());assert(Buffer.from(html.bytes).toString().includes('新编辑器'))
  await f.page.evaluate(()=>{window.nextFile={name:'导入.md',bytes:Array.from(new TextEncoder().encode('# 导入成功\n\n测试'))}});await f.frame.locator('#md-menu').click();await f.frame.getByRole('button',{name:/打开文件/}).click();await f.frame.locator('#md-ta').waitFor();await f.page.waitForTimeout(200);assert((await f.frame.locator('#md-ta').inputValue()).includes('导入成功'))
 })
}
for(const[id,key,selector,baseline]of[
 ['mind.map','mindmap.draft.v1','#mp-text',{app:'fftool.mindmap',v:1,name:'Quota',root:{id:'r',text:'baseline',color:'#1D9E75',collapsed:false,children:[]}}],
 ['markdown.editor','md.draft.v1','#md-ta',{n:'Quota.md',t:'baseline',at:1}],
])test(`${id} keeps the last saved draft if its quota is exceeded`,async t=>{
 const f=await fixture(t,1280);await f.page.evaluate(({id,key,baseline})=>{window.stored['tool.'+id]=JSON.stringify({[key]:JSON.stringify(baseline),padding:'x'.repeat(1047400)})},{id,key,baseline});await f.mount(id)
 await f.frame.locator(selector).fill('x'.repeat(2000));await f.page.waitForTimeout(1000)
 const actual=await f.page.evaluate(({id,key})=>JSON.parse(window.stored['tool.'+id])[key],{id,key});assert(actual,'Last saved draft must remain available');assert.deepEqual(JSON.parse(actual),baseline)
})

for(const width of [1280,390]){
 for(const view of width===1280?['split','unified']:['unified'])test(`diff supports bidirectional block merging, undo and full-content export in ${view} at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('text.diff');const left='A\nold-one\nM\nold-two\nZ',right='A\nnew-one\nM\nnew-two\nZ'
  await f.frame.locator('#taLeft').fill(left);await f.frame.locator('#taRight').fill(right);await f.frame.locator('#btnCompare').click();await f.frame.locator(`#segView [data-view=${view}]`).click()
  await f.frame.locator('#bodyLeft [data-merge="0"]').first().click();const modal=f.frame.locator('#mergeDialog');await modal.waitFor({state:'visible'});assert((await modal.locator('#mergeOldText').textContent()).includes('old-one'));assert.equal(await modal.locator('#mergePrev').isDisabled(),true)
  await f.page.waitForTimeout(180);assert(await modal.evaluate(d=>{const r=d.querySelector('.merge-columns').getBoundingClientRect();return [...d.querySelectorAll('.merge-side>.btn')].every(b=>{const p=b.getBoundingClientRect();return p.top>=r.top&&p.bottom<=r.bottom+1})}),'Short change blocks show both merge buttons without scrolling')
  await modal.locator('#mergeNext').click();assert((await modal.locator('#mergeNewText').textContent()).includes('new-two'));await modal.locator('#mergeToOld').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),'A\nold-one\nM\nnew-two\nZ');assert.equal(await f.frame.locator('#taRight').inputValue(),right);assert.equal(await f.frame.locator('#statChg').textContent(),'1 处')
  await f.frame.locator('#btnUndoMerge').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),left);assert.equal(await f.frame.locator('#statChg').textContent(),'2 处')
  await f.frame.locator('#bodyLeft [data-merge="0"]').first().click();await modal.locator('#mergeToNew').click();const merged='A\nold-one\nM\nnew-two\nZ';assert.equal(await f.frame.locator('#taRight').inputValue(),merged)
  await f.frame.locator('#contentExport summary').click();await f.frame.locator('[data-export=copy-right]').click();await f.page.waitForFunction(()=>!!window.copied);assert.equal(await f.page.evaluate(()=>copied),merged)
  await f.frame.locator('#contentExport summary').click();const saved=await f.lastSaved(()=>f.frame.locator('[data-export=save-right]').click());assert.equal(Buffer.from(saved.bytes).toString(),merged)
  await f.frame.locator('#bodyLeft [data-merge="0"]').first().focus();await f.page.keyboard.press('Enter');await modal.waitFor({state:'visible'});await f.page.screenshot({path:`${directory}/merge-${view}-${width}.png`});await modal.locator('#mergeClose').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),left)
 })
 test(`diff handles additions, complete deletions and ignored context without applying stale ranges at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('text.diff');await f.frame.locator('#taLeft').fill('one');await f.frame.locator('#taRight').fill('one\nadded');await f.frame.locator('#btnCompare').click();await f.frame.locator('#bodyLeft [data-merge]').first().click();await f.frame.locator('#mergeToOld').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),'one\nadded');assert.equal(await f.frame.locator('#statChg').textContent(),'0 处');await f.frame.locator('#btnUndoMerge').click()
  await f.frame.locator('#bodyLeft [data-merge]').first().click();await f.frame.locator('#mergeToNew').click();assert.equal(await f.frame.locator('#taRight').inputValue(),'one');await f.frame.locator('#btnUndoMerge').click();await f.frame.locator('#btnEdit').click()
  await f.frame.locator('#taLeft').fill('deleted');await f.frame.locator('#taRight').fill('');await f.frame.locator('#btnCompare').click();await f.frame.locator('#bodyLeft [data-merge]').first().click();await f.frame.locator('#mergeToOld').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),'');assert.equal(await f.frame.locator('#statChg').textContent(),'0 处');await f.frame.locator('#btnUndoMerge').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),'deleted')
  await f.frame.locator('#btnEdit').click();await f.frame.locator('#taLeft').fill('Keep\n\nOLD\nTAIL');await f.frame.locator('#taRight').fill('keep\n\nNEW\nEXTRA\nTAIL');await f.frame.locator('#btnCompare').click();await f.frame.locator('label:has(#optCase)').click();await f.frame.locator('label:has(#optBlank)').click();await f.frame.locator('#bodyLeft [data-merge]').first().click();await f.frame.locator('#mergeToOld').click();assert.equal(await f.frame.locator('#taLeft').inputValue(),'Keep\n\nNEW\nEXTRA\nTAIL')
 })
 test(`Markdown heading menu preserves text selection and offers body plus H1–H6 at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('markdown.editor');await f.frame.locator('#md-mode [data-v=edit]').click();const original='# first\n\nsecond\nthird';await f.frame.locator('#md-ta').fill(original);await f.frame.locator('#md-ta').evaluate(n=>n.setSelectionRange(0,8));await f.frame.locator('[data-act=h]').click()
  assert.equal(await f.frame.getByRole('menuitemradio').count(),7);assert.equal(await f.frame.locator('#md-ta').inputValue(),original);await f.frame.getByRole('menuitemradio',{name:/H3/}).click();assert.equal(await f.frame.locator('#md-ta').inputValue(),'### first\n\nsecond\nthird')
  await f.frame.locator('[data-act=h]').click();await f.frame.getByRole('menuitemradio',{name:'正文',exact:true}).click();assert.equal(await f.frame.locator('#md-ta').inputValue(),'first\n\nsecond\nthird')
  await f.frame.locator('#md-ta').evaluate(n=>{const p=n.value.indexOf('second')+2;n.setSelectionRange(p,p)});await f.frame.locator('[data-act=h]').click();await f.page.keyboard.press('End');await f.page.keyboard.press('Enter');await f.page.waitForTimeout(30);assert.equal(await f.frame.locator('#md-ta').inputValue(),'first\n\n###### second\nthird');await f.frame.locator('#md-ta').press('Control+z');assert.equal(await f.frame.locator('#md-ta').inputValue(),'first\n\nsecond\nthird')
 })
 test(`Markdown table dimensions validate, preview and cancel without losing the caret at ${width}px`,async t=>{
  const f=await fixture(t,width);await f.mount('markdown.editor');await f.frame.locator('#md-mode [data-v=edit]').click();await f.frame.locator('#md-ta').fill('before\nafter');await f.frame.locator('#md-ta').evaluate(n=>n.setSelectionRange(6,6));await f.frame.locator('[data-act=table]').click();const dialog=f.frame.locator('#md-table-dialog');await dialog.waitFor({state:'visible'});await dialog.locator('#md-table-rows').fill('0');await dialog.locator('#md-table-cols').fill('4');await dialog.getByRole('button',{name:'插入表格',exact:true}).click();assert.equal(await dialog.locator('#md-table-error').isVisible(),true);assert.equal(await f.frame.locator('#md-ta').inputValue(),'before\nafter')
  assert(await dialog.evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&[...d.querySelectorAll('input')].every(n=>{const p=n.getBoundingClientRect();return p.left>=r.left&&p.right<=r.right})}),'Table fields fit the dialog and viewport')
  await dialog.locator('#md-table-rows').fill('2');await f.page.screenshot({path:`${directory}/table-${width}.png`});await dialog.getByRole('button',{name:'插入表格',exact:true}).click();await f.frame.locator('#md-mode [data-v=prev]').click();await f.frame.locator('#md-prev tbody tr').first().waitFor();assert.equal(await f.frame.locator('#md-prev th').count(),4);assert.equal(await f.frame.locator('#md-prev tbody tr').count(),2)
  await f.frame.locator('#md-mode [data-v=edit]').click();await f.frame.locator('#md-ta').fill('# Foo');await f.frame.locator('#md-ta').evaluate(n=>n.setSelectionRange(2,5));await f.frame.locator('[data-act=table]').click();await dialog.locator('#md-table-cancel').click();assert.equal(await f.frame.locator('#md-ta').inputValue(),'# Foo');assert.deepEqual(await f.frame.locator('#md-ta').evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,5]);await f.frame.locator('[data-act=bold]').click();assert.equal(await f.frame.locator('#md-ta').inputValue(),'# **Foo**')
 })
}
