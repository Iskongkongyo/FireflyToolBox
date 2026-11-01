import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

// These selectors describe the requested actions, including buttons created by
// feed rendering. Geometry checks catch partial-width flex and grid rows alike.
export const cases = [
  ['video.edit', 'media-edit', '#choose'],
  ['image.hidden', 'hiddenimage', '#front, #back'],
  ['image.edit', 'image-edit', '#choose'],
  ['pdf.encrypt', 'pdf-security', '#choose'],
  ['pdf.decrypt', 'pdf-security', '#choose'],
  ['zip.manage', 'zip-tools', '#choose, #process, #open-zip'],
  ['history.today', 'history', '#refresh, #events article button'],
  ['trending.live', 'trending', '#list article button'],
  ['unit.convert', 'utility-tools', '#swap'],
  ['date.calendar', 'calendar', '#convert'],
  ['flowers.catalog', 'flowers', '#flowers article button'],
  ['time.world', 'worldtime', '#cities article > button'],
  ['currency.today', 'daily-rates', '#rates article button'],
  ['notes.memo', 'memo', '#import'],
  ['currency.exchange', 'exchange', '#copy'],
  ['fuel.price', 'fuel', '#copy'],
  ['news.briefing', 'briefing', '#refresh'],
  ['qr.generate', 'qrgenerate', '#open-text'],
]

export const desktopCases = [
  ['html.format', 'code-tools', '#import, #format, #minify, #use-result, #copy, #save, #clear'],
  ['text.count', 'textcount', '#import, #copy, #clear'],
  ['file.hash', 'hash', '#choose'],
  ['health.bmi', 'bmi', '#calculate, #clear, #copy'],
  ['weather.forecast', 'weather', '#refresh, #copy, #source'],
  ['score.board', 'score', '#add, #undo, #reset, #copy'],
]

export function measureButtons(selector) {
  const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
  return [...document.querySelectorAll(selector)].filter(button => button.getBoundingClientRect().height > 0).map(button => {
    const parent = button.parentElement, b = rect(button), p = rect(parent), s = getComputedStyle(parent)
    const left = p.x + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft)
    const width = p.width - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth) - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
    return { label: button.textContent, ...b, left, availableWidth: width, sharesRow: [...parent.children].some(other => {
      if (other === button) return false
      const r = rect(other)
      return r.width > 0 && r.height > 0 && r.y < b.y + b.height - 1 && r.y + r.height > b.y + 1
    }) }
  })
}

export function assertDesktopButtons(rows, label) {
  assert(rows.length > 0, label + ': missing buttons')
  for (const r of rows) {
    assert(r.height >= 44, `${label}/${r.label}: action is too short`)
    assert(r.width >= Math.min(120, r.availableWidth) - 1, `${label}/${r.label}: cramped action width ${r.width}px in ${r.availableWidth}px`)
    assert(r.x >= r.left - 1 && r.x + r.width <= r.left + r.availableWidth + 1, `${label}/${r.label}: action exceeds its container`)
  }
}

export function assertFullRows(rows, label) {
  assert(rows.length > 0, label + ': missing buttons')
  for (const r of rows) {
    assert(Math.abs(r.width - r.availableWidth) <= 1, `${label}/${r.label}: ${r.width} of ${r.availableWidth}px`)
    assert(Math.abs(r.x - r.left) <= 1, `${label}/${r.label}: row starts inside another column`)
    assert.equal(r.sharesRow, false, `${label}/${r.label}: another control shares the row`)
  }
}

const directory = path.resolve('target-check/mobile-tool-buttons')
fs.mkdirSync(directory, { recursive: true })
const mode = process.argv.includes('--windows') ? 'windows' : process.argv.includes('--android') ? 'android' : 'browser'
if (mode === 'browser') await browserCheck()
else await (await import('./test-mobile-tool-buttons-device.mjs')).deviceCheck({ mode, directory, cases: mode === 'windows' ? [...cases, ...desktopCases] : cases, measureButtons, assertFullRows, assertDesktopButtons })

async function browserCheck() {
  const source = 'src-tauri/builtin-tools/src/', generated = 'src-tauri/builtin-tools/generated/'
  const read = file => fs.readFileSync(file, 'utf8'), previous = file => execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  const cssFiles = ['common', 'life', 'utility', 'new-tools', 'creative-tools'].map(n => source + n + '.css')
  const currentCss = cssFiles.map(read).join('\n'), previousCss = cssFiles.map(previous).join('\n')
  const specs = Object.fromEntries([...cases, ...desktopCases].map(([id, stem]) => [id, { stem, current: read(source + stem + '.html').replaceAll('{{mode}}', id).replaceAll('{{language}}', id.split('.')[0]), previous: previous(source + stem + '.html').replaceAll('{{mode}}', id).replaceAll('{{language}}', id.split('.')[0]) }]))
  // Independent deterministic responses exercise actual asynchronous render paths.
  const fixture = `
    window.copied='';window.opened=0;window.errors=[];localStorage.clear();
    addEventListener('error', e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    const request=async url=>{let value={};if(url.includes('eventsOnHistory')){const d=new Date(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');value={[m]:{[m+day]:[{year:2020,title:'布局测试事件',desc:'测试资料',link:'https://baike.baidu.com/item/test'}]}}}
    else if(url.includes('frankfurter.dev/v2/rates'))value=[{base:'CNY',quote:'USD',rate:.14,date:'2026-10-29'},{base:'CNY',quote:'EUR',rate:.13,date:'2026-10-29'}];
    else if(url.includes('baidu'))value={data:{cards:[{content:[{content:[{word:'布局测试热点',hotScore:'12345',url:'https://www.baidu.com/s?wd=test'}]}]}]}};
    else return new Response('offline fixture',{status:503});return Response.json(value)};
    window.dispose=mount({request,signal:new AbortController().signal,storage:{flush:async()=>{}},copyText:async text=>window.copied=text,openFile:async()=>{opened++;return null},saveFile:async()=>false,files:{open:async()=>{opened++;return null}},resources:{},tasks:{}});window.ready=true;`
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'), old = url.searchParams.has('before'), spec = specs[url.pathname.slice(1)]
    if (spec) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${old ? previousCss : currentCss}</style>${old ? spec.previous : spec.current}<script type="module">import {mount} from '/bundle/${spec.stem}.js${old ? '?before' : ''}';${fixture}</script>`)
    } else if (/^\/bundle\/[\w-]+\.js$/.test(url.pathname)) {
      res.setHeader('Content-Type', 'text/javascript'); const file = generated + path.basename(url.pathname)
      res.end(old ? previous(file) : read(file))
    } else { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true, executablePath: process.env.FIREFLY_TEST_BROWSER || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') })
  const report = { checks: [], screenshots: [] }
  try {
    for (const [width, touch] of [[320, true], [390, true], [600, true], [800, true], [1280, true], [390, false], [800, false], [1280, false]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch }), page = await context.newPage()
      const variants = touch ? cases : [...cases, ...desktopCases]
      for (const [id, , selector] of variants) {
        async function open(before = false) {
          await page.goto(origin + '/' + id + (before ? '?before' : '')); await page.waitForFunction(() => window.ready === true)
          for (const part of selector.split(',')) await page.locator(part.trim()).first().waitFor({ state: 'visible' })
          if (id === 'date.calendar') await page.waitForFunction(() => document.querySelector('#details').children.length > 0)
          assert.deepEqual(await page.evaluate(() => errors), [], id)
        }
        await open()
        const rows = await page.evaluate(measureButtons, selector)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, id + ': horizontal overflow')
        if (touch) {
          assertFullRows(rows, id)
          await open(true); const before = await page.evaluate(measureButtons, selector)
          assert.equal(rows.length, before.length, id)
          for (let i = 0; i < rows.length; i++) for (const key of ['x', 'width', 'height', 'availableWidth']) assert(Math.abs(rows[i][key] - before[i][key]) <= 1, `${id}/${key}: touch layout changed`)
          await open()
          if (['history.today', 'trending.live', 'flowers.catalog', 'time.world', 'currency.today'].includes(id)) {
            const search = page.locator(id === 'history.today' || id === 'trending.live' ? '#filter' : '#search')
            await search.fill(''); await search.dispatchEvent('input'); assertFullRows(await page.evaluate(measureButtons, selector), id + ': rerender')
            const copy = page.locator(selector.split(',').at(-1).trim()).first(); await copy.click(); await page.waitForFunction(() => copied.length > 0)
          }
          if (width === 390) { const file = path.join(directory, `${id}-mobile.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file) }
        } else {
          assertDesktopButtons(rows, id)
        }
        report.checks.push(`${touch ? 'touch' : 'mouse'} ${width}px: ${id}`)
      }
      await context.close(); console.log(`PASS: all ${variants.length} tool variants at ${width}px (${touch ? 'touch' : 'mouse'})`)
    }
  } finally {
    fs.writeFileSync(path.join(directory, 'browser-results.json'), JSON.stringify(report, null, 2)); await browser.close(); await new Promise(resolve => server.close(resolve))
  }
}
