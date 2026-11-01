import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const bundle = await build({ entryPoints: ['src/services/browserModule.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const dist = path.resolve('dist'), publicDir = path.resolve('public')
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (pathname === '/host.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><div id="host"></div>'); return }
  const file = pathname === '/app' ? path.join(dist, 'index.html') : path.resolve(pathname.startsWith('/assets/') ? dist : publicDir, '.' + pathname)
  if (![dist, publicDir].some(root => file.startsWith(root + path.sep))) { response.writeHead(404); response.end(); return }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' })[path.extname(file)] ?? 'application/octet-stream')
    response.end(fs.readFileSync(file))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (fs.existsSync(chrome) ? chrome : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
try {
  for (const width of [1280, 390]) {
    await test(`v7 web tools retain small-file open/save at ${width}px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(origin)
        await page.evaluate(async () => {
          window.savedFiles = []
          const { mountWebTool } = await import('/host.js')
          await mountWebTool(document.getElementById('host'), {
            moduleId: 'v7.small-file-review', html: '<main><button id="open">打开</button><textarea id="text"></textarea><button id="save">保存</button></main>', css: 'textarea { display:block; width:95%; height:100px }',
            script: 'export function mount({openFile,saveFile}) { document.getElementById("open").onclick=async()=>{const file=await openFile({extensions:["txt"]});if(file)document.getElementById("text").value=await file.blob.text()};document.getElementById("save").onclick=async()=>{await saveFile("copy.txt",new Blob([document.getElementById("text").value],{type:"text/plain"}))} }',
            networkHosts: [], resources: [], timeoutMs: 15000, inputBytes: 8388608, outputBytes: 4194304,
            openFile: async () => ({ name: 'sample.txt', bytes: new TextEncoder().encode('中文 UTF-8\nsecond line'), mimeType: 'text/plain' }),
            saveFile: async (name, bytes) => { window.savedFiles.push({ name, text: new TextDecoder().decode(bytes) }); return true },
            onError: message => { window.hostError = message },
          })
        })
        const frame = page.frameLocator('.web-tool-frame')
        await frame.locator('#open').click()
        const sandbox = page.frames().find(item => item.parentFrame() && item.url() === 'about:srcdoc')
        assert(sandbox)
        await sandbox.waitForFunction(() => document.getElementById('text')?.value === '中文 UTF-8\nsecond line')
        assert.equal(await frame.locator('#text').inputValue(), '中文 UTF-8\nsecond line')
        await frame.locator('#save').click()
        await page.waitForFunction(() => window.savedFiles.length === 1)
        assert.deepEqual(await page.evaluate(() => window.savedFiles), [{ name: 'copy.txt', text: '中文 UTF-8\nsecond line' }])
        assert.equal(await page.evaluate(() => window.hostError), undefined)
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    })

    await test(`the workbench creates v7 web packages and v6 QuickJS text at ${width}px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      context.setDefaultTimeout(8000)
      const page = await context.newPage()
      try {
        await page.addInitScript(() => {
          window.isTauri = true
          const modules = [], details = {}, tools = []
          window.createdManifests = []
          window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback() {}, invoke: async (command, args) => {
            if (command === 'list_tools') return tools.slice()
            if (command === 'load_tool_storage') return '{}'
            if (command === 'list_modules') return modules.slice()
            if (command === 'get_module_details') return details[args.moduleId]
            if (['list_favorites', 'list_recent_tools', 'list_websites', 'list_custom_tools'].includes(command)) return []
            if (command === 'install_module_draft') {
              const manifest = args.manifest, tool = manifest.tools[0]
              window.createdManifests.push(manifest)
              const summary = { module_id: manifest.module_id, version: manifest.version, name: manifest.name['zh-CN'], author: manifest.author, tools: [tool.name['zh-CN']], tool_ids: [tool.id], categories: [tool.category], network_hosts: [], builtin: false, modified: false }
              modules.push(summary); details[manifest.module_id] = { manifest, scripts: args.scripts, builtin: false, modified: false }
              tools.push({ ...tool, name: tool.name['zh-CN'], description: tool.description['zh-CN'], aliases: [], tags: [], builtin: false, custom: false, module_id: manifest.module_id, ui_kind: tool.ui.kind, actions: tool.actions.map(action => ({ ...action, label: action.label['zh-CN'] })) })
              return summary
            }
            return null
          } }
        })
        await page.goto(origin + '/app')
        await page.locator('.nav-button').filter({ hasText: '工具管理' }).evaluate(button => button.click())
        await page.getByRole('button', { name: '打开工具工作台', exact: true }).click()
        await page.locator('#studio-tab-create').click()
        for (const [index, kind] of ['web', 'text'].entries()) {
          if (index) {
            await page.locator('#studio-tab-create').click()
            await page.getByRole('button', { name: '新建工具', exact: true }).click()
            const dialog = page.locator('dialog[open]')
            await dialog.getByRole('button', { name: '新建工具', exact: true }).click()
          }
          await page.locator(`[data-tool-kind="${kind}"]`).click()
          await page.locator('#studio-panel-create input').first().fill(kind === 'web' ? '网页 v7 回归' : '文本回归')
          if (kind === 'web') {
            const hosts = Array.from({ length: 65 }, (_, index) => `https://host${index}.example.com`)
            await page.locator('#tool-network-hosts').fill(hosts.join('\n'))
            await page.locator('#studio-panel-create button[type="submit"]').click()
            await page.locator('.toast:popover-open').filter({ hasText: '最多 64 个' }).waitFor()
            assert.equal(await page.evaluate(() => window.createdManifests.length), 0)
            await page.locator('#tool-network-hosts').fill(hosts.slice(0, 64).join('\n'))
            const source = page.locator('#tool-source-editor')
            await source.evaluate((textarea, size) => {
              window.capacityHtml = textarea.value
              textarea.value = window.capacityHtml + ' '.repeat(size - new TextEncoder().encode(window.capacityHtml).byteLength)
              textarea.dispatchEvent(new Event('input', { bubbles: true }))
            }, 8 * 1024 * 1024 + 1)
            await page.getByRole('button', { name: '预览网页工具', exact: true }).click()
            await page.locator('.module-studio-preview .editor-status.error').filter({ hasText: '8 MiB' }).waitFor()
            assert.equal(await page.locator('.web-tool-frame').count(), 0)
            await source.evaluate((textarea, size) => {
              textarea.value = window.capacityHtml + ' '.repeat(size - new TextEncoder().encode(window.capacityHtml).byteLength)
              textarea.dispatchEvent(new Event('input', { bubbles: true }))
            }, 8 * 1024 * 1024)
            await page.getByRole('button', { name: '预览网页工具', exact: true }).click()
            await page.frameLocator('.web-tool-frame').locator('body').waitFor().catch(async error => {
              throw new Error('8 MiB preview: ' + (await page.locator('.module-studio-preview .editor-status.error').allTextContents()).join('\n'), { cause: error })
            })
          }
          await page.locator('#studio-panel-create button[type="submit"]').click()
          await page.waitForFunction(count => window.createdManifests.length === count, index + 1, { timeout: 8000 }).catch(async error => { throw new Error(kind + ': ' + await page.locator('.module-page-error').allTextContents(), { cause: error }) })
          await page.locator('.toast:popover-open').filter({ hasText: '已安装' }).waitFor()
          assert.equal(await page.locator('#studio-tab-create').getAttribute('aria-selected'), 'true')
        }
        const [web, text] = await page.evaluate(() => window.createdManifests)
        assert.equal(web.schema_version, 7)
        assert.equal(web.tools[0].ui.kind, 'web')
        assert.equal(web.tools[0].runtime, 'browser')
        assert.equal(web.network.hosts.length, 64)
        assert.equal(web.network.hosts[63], 'https://host63.example.com')
        assert.deepEqual(web.permissions, ['network'])
        assert.equal(web.limits.input_bytes, 2147483648)
        assert.equal(web.limits.output_bytes, 2147483648)
        assert.equal(text.schema_version, 6)
        assert.equal(text.tools[0].runtime, undefined)
        assert.equal(text.tools[0].ui.kind, 'text')
        assert.equal(text.limits.timeout_ms, 3000)
        assert.equal(text.limits.input_bytes, 1048576)
        assert.equal(text.limits.output_bytes, 4194304)
        await page.locator('#studio-tab-installed').click()
        await page.getByRole('tab', { name: '导入/创建工具', exact: true }).click()
        await page.locator('.module-studio-list-item').filter({ hasText: '网页 v7 回归' }).click()
        await page.locator('.module-studio-detail-tool').first().waitFor()
        await page.waitForFunction(() => !document.querySelector('.panel-stage-settling'))
        const row = page.locator('.module-studio-detail-tool').first(), last = row.locator('.module-studio-tool-actions button').last()
        const [rowBounds, lastBounds] = await Promise.all([row.boundingBox(), last.boundingBox()])
        assert(Math.abs(rowBounds.x + rowBounds.width - lastBounds.x - lastBounds.width) < 2)
        if (width < 600) assert(lastBounds.height >= 44)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      } finally { await context.close() }
    })
  }
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
