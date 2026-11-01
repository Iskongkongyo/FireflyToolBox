import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve('dist')
const server = createServer(async (request, response) => {
  const file = path.resolve(root, '.' + (new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname))
  if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
  try { response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream'); response.end(await readFile(file)) }
  catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({headless:true,executablePath:process.env.FIREFLY_TEST_BROWSER || (existsSync(chrome)?chrome:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')})
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('firefly.usage-stats.v1','true')
    window.records=[]; window.runs=[]; window.recent=[]
    const tools = [ ['json.format','Text tool',false,'text'], ['custom.1','Automation tool',true,'text'], ['web.1','Web tool',false,'web'] ].map(([id,name,custom,ui_kind]) => ({id,name,custom,ui_kind,description:'',category:'开发与文本',aliases:[],tags:[],actions:[{id:'run',label:'处理',consumes_input:true}]}))
    window.__TAURI_INTERNALS__ = {invoke:async (command,args) => {
      if(command==='list_tools') return tools
      if(command==='record_tool_open') { await new Promise(resolve=>setTimeout(resolve,30));window.records.push(args.toolId);window.recent=[args.toolId,...window.recent.filter(id=>id!==args.toolId)];return }
      if(command==='list_recent_tools') return [...window.recent]
      if(['list_favorites','list_custom_tools','list_modules','list_websites'].includes(command)) return []
      if(command==='run_text_tool') {window.runs.push(args);return 'result'}
      return null
    }}
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const navigate = name => page.locator('.nav-button').filter({hasText:name}).evaluate(button=>button.click())
  for(const [id,name] of [['json.format','Text tool'],['custom.1','Automation tool'],['web.1','Web tool']]) {
    await navigate('工具管理'); await page.locator('.all-tool-item').filter({hasText:name}).click()
    await page.waitForFunction(id=>window.records.includes(id),id)
    if(id==='json.format') { await page.locator('#tool-input').fill('hello');await page.locator('.editor-actions .primary-button').click();await page.waitForFunction(()=>window.runs.length===1) }
    await navigate('首页');await page.locator('.recent-tool-list button').filter({hasText:name}).waitFor()
  }
  assert.deepEqual(await page.evaluate(()=>window.records),['json.format','custom.1','web.1'])
  assert.equal(await page.evaluate(()=>window.runs[0].recordUsage),false,'Opening and executing must not double-count a visit')
  await navigate('更多设置');await page.getByRole('switch',{name:/记录最近使用/}).click()
  await navigate('工具管理');await page.locator('.all-tool-item').filter({hasText:'Text tool'}).click()
  assert.deepEqual(await page.evaluate(()=>window.records),['json.format','custom.1','web.1'])
  console.log('PASS: Opening text, automation and web tools records one visit; running does not double-count; disabling recording stops new visits.')
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
