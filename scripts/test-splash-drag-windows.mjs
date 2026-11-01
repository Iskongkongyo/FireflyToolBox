import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { connectWindows } from './windows-test-client.mjs'

const directory = path.resolve('target-check/app-polish/windows')
await mkdir(directory, { recursive: true })
const client = await connectWindows({ splash: true }), report = { checks: [] }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const native = (action, kind = 'splash') => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-splash-drag.ps1', '-Action', action, '-OwnedProcess', String(client.pid), '-Kind', kind], { encoding: 'utf8', windowsHide: true, timeout: 10000 }))
try {
  for (let i = 0; i < 40; i++) { if (await client.evaluate(() => !!document.querySelector('.startup-splash-image'))) break; await pause(50) }
  await client.evaluate(() => {
    // Hold only this test page's countdown while sending actual OS mouse input.
    const latest = setInterval(() => {}, 1000); for (let id = 1; id <= latest; id++) clearInterval(id)
    window.htmlDrags = 0; document.addEventListener('dragstart', () => window.htmlDrags++)
    window.splashMouseDown = []
    document.addEventListener('mousedown', event => window.splashMouseDown.push({ detail: event.detail, target: event.target.className, prevented: event.defaultPrevented }))
  })
  assert.equal(await client.evaluate(() => document.querySelector('.startup-splash-image').draggable), false)
  await client.invoke('show_splash')
  const moved = native('drag'); assert(moved.found, JSON.stringify(moved))
  assert(Math.abs(moved.after.Left - moved.before.Left) > 40 && Math.abs(moved.after.Top - moved.before.Top) > 30, JSON.stringify(moved))
  const mouse = await client.evaluate(() => window.splashMouseDown)
  assert(mouse.some(event => event.detail === 1 && event.target.includes('startup-splash') && event.prevented), JSON.stringify(mouse))
  assert.equal(await client.evaluate(() => window.htmlDrags), 0)
  report.checks.push('actual OS mouse dragging moves the splash through the permitted native API without dragging image data')
  report.drag = moved
  console.log('PASS:', report.checks.at(-1))
  const shot = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, 'splash-drag.png'), Buffer.from(shot.data, 'base64'))
  await client.evaluate(() => document.querySelector('.startup-splash-skip').click()).catch(() => {})
  let splashClosed = false
  for (let i = 0; i < 40; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${process.env.FIREFLY_TEST_DEBUG_PORT || 19351}/json/list`)).json()
    if (!targets.some(target => target.url.includes('splash.html'))) { splashClosed = true; break }
    await pause(100)
  }
  assert(splashClosed, 'Skip must close the real splash WebView')
  let main
  for (let i = 0; i < 40; i++) { main = native('probe', 'main'); if (main.found) break; await pause(100) }
  assert(main?.found)
  assert(Math.abs(main.after.Left - moved.after.Left) <= 1 && Math.abs(main.after.Top - moved.after.Top) <= 1, JSON.stringify({ main, moved }))
  report.checks.push('skip closes the splash and the main window inherits its moved position'); report.main = main; report.splashClosed = splashClosed
  console.log('PASS:', report.checks.at(-1))
} finally { await writeFile(path.join(directory, 'splash-results.json'), JSON.stringify(report, null, 2)); client.close() }
