import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const context = { window: {} }
runInNewContext(readFileSync('public/web-tool-layout.js', 'utf8'), context)
const rewrite = context.fireflyViewportValue

test('vertical viewport units use a stable host height inside calculations', () => {
  for (const unit of ['vh', 'dvh', 'svh', 'lvh']) assert.equal(rewrite(`100${unit}`), 'calc(var(--firefly-viewport-height) * 1)')
  assert.equal(rewrite('calc(50vh - 32px)'), 'calc(calc(var(--firefly-viewport-height) * 0.5) - 32px)')
  assert.equal(rewrite('clamp(100px, 65dvh, 800px)'), 'clamp(100px, calc(var(--firefly-viewport-height) * 0.65), 800px)')
  assert.equal(rewrite('translateY(-10vh)'), 'translateY(calc(var(--firefly-viewport-height) * -0.1))')
  assert.equal(rewrite('2.5vh 0'), 'calc(var(--firefly-viewport-height) * 0.025) 0')
})
test('percentage widths and child heights keep their author-defined containing block', () => {
  assert.equal(rewrite('100%'), '100%')
  assert.equal(rewrite('calc(100% - 10px)', true), 'calc(calc(var(--firefly-viewport-height) * 1) - 10px)')
  assert.equal(rewrite('100vw 50%'), '100vw 50%')
  assert.equal(rewrite('var(--size, 50%)'), 'var(--size, 50%)')
})
test('strings, URLs, escaped text and identifiers are preserved', () => {
  for (const value of ['"100vh"', "'100vh'", 'url(/images/100vh.png)', 'url("data:image/svg+xml,100vh")', '"escaped \\"100vh\\" text"', 'var(--space100vh)', 'calc(var(--space100vh) + 20px)']) assert.equal(rewrite(value), value)
})
