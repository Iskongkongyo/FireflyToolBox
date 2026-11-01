import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

function fixture() {
  let time = 0, sequence = 0
  const timers = new Map(), messages = [], handlers = new Map()
  class Element {
    constructor(selector = 'div') { this.selector = selector }
    matches(selector) { return selector.split(',').includes(this.selector) }
  }
  class EventTarget {
    addEventListener(name, callback) { handlers.set(name, callback) }
    removeEventListener(name, callback) { if (handlers.get(name) === callback) handlers.delete(name) }
  }
  const window = new EventTarget(); window.getSelection = () => ''
  runInNewContext(readFileSync('public/web-tool-presentation.js', 'utf8'), { window, EventTarget, Element, innerWidth: 390, performance: { now: () => time },
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id }, clearTimeout: id => timers.delete(id) })
  const api = window.FireflyWebToolPresentation('fixture', m => messages.push(m.action))
  function fire(type, args = {}, path = [new Element()]) {
    const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 0, clientX: 385, clientY: 80, defaultPrevented: false, stopped: false, relatedTarget: {}, detail: 1,
      preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() { this.stopped = true }, composedPath: () => path, ...args }
    handlers.get(type)?.(event); return event
  }
  function advance(ms) { const end = time + ms; while (true) { const next = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); time = next[1].at; next[1].fn() }; time = end }
  api.setFullscreen(true)
  return { api, fire, advance, messages, Element, timers, handlers, window }
}
test('ordinary corner taps and mouse movement below the top edge never reveal controls', () => {
  const f = fixture(); f.fire('pointerdown'); f.advance(120); f.fire('pointerup'); f.advance(1000)
  f.fire('pointermove', { pointerType: 'mouse', clientY: 32 }); f.advance(1000); assert.deepEqual(f.messages, [])
})
test('mouse top-edge dwell requires 400ms and tolerates small jitter', () => {
  const f = fixture(); f.fire('pointermove', { pointerType: 'mouse', clientY: 4 }); f.advance(399); assert.deepEqual(f.messages, [])
  f.fire('pointermove', { pointerType: 'mouse', clientX: 383, clientY: 4 }); f.advance(1); assert.deepEqual(f.messages, ['reveal'])
})
for (const [name, type, args] of [['click', 'pointerdown', { pointerType: 'mouse' }], ['drag', 'pointermove', { pointerType: 'mouse', clientY: 4, buttons: 1 }], ['leave', 'pointerout', { relatedTarget: null }], ['blur', 'blur', {}], ['scroll', 'scroll', {}], ['resize', 'resize', {}]]) {
  test(`mouse dwell is canceled by ${name}`, () => { const f = fixture(); f.fire('pointermove', { pointerType: 'mouse', clientY: 4 }); f.advance(200); f.fire(type, args); f.advance(600); assert.deepEqual(f.messages, []) })
}
test('moving away from the dwell anchor restarts its timer', () => {
  const f = fixture(); f.fire('pointermove', { pointerType: 'mouse', clientY: 4 }); f.advance(300); f.fire('pointermove', { pointerType: 'mouse', clientX: 375, clientY: 4 }); f.advance(399); assert.deepEqual(f.messages, []); f.advance(1); assert.deepEqual(f.messages, ['reveal'])
})
test('blank-corner hold reveals once after 600ms and consumes only its own release/click', () => {
  const f = fixture(); f.fire('pointerdown'); f.advance(599); assert.deepEqual(f.messages, []); f.advance(1); assert.deepEqual(f.messages, ['reveal'])
  assert.equal(f.fire('pointerup').stopped, true); assert.equal(f.fire('click').stopped, true)
  f.fire('pointerdown'); f.fire('pointerup'); assert.equal(f.fire('click').stopped, false)
})
test('touch pointerout between release and compatibility click preserves long-press suppression', () => {
  const f = fixture(); f.fire('pointerdown'); f.advance(600); f.fire('pointerup'); f.fire('pointerout', { relatedTarget: null })
  assert.equal(f.fire('click').stopped, true)
})
for (const selector of ['button', 'a[href]', 'input', 'textarea', 'summary', '[role="button"]', '[role="slider"]', 'canvas', 'svg']) {
  test(`touch hold on ${selector} leaves tool interaction alone`, () => {
    const f = fixture(), path = [new f.Element('span'), new f.Element(selector)]
    const down = f.fire('pointerdown', {}, path); f.advance(900); const up = f.fire('pointerup', {}, path)
    assert.deepEqual(f.messages, []); assert.equal(down.defaultPrevented, false); assert.equal(up.stopped, false)
  })
}
for (const [name, type, args] of [['movement', 'pointermove', { clientY: 100 }], ['cancel', 'pointercancel', {}], ['second finger', 'pointerdown', { pointerId: 2, isPrimary: false }]]) {
  test(`touch hold is canceled by ${name}`, () => { const f = fixture(); f.fire('pointerdown'); f.advance(300); f.fire(type, args); f.advance(500); assert.deepEqual(f.messages, []) })
}
test('tool-canceled pointers and text selection suppress long-press controls', () => {
  const f = fixture(), down = f.fire('pointerdown'); down.preventDefault(); f.advance(700); assert.deepEqual(f.messages, [])
  f.fire('pointerup'); f.window.getSelection = () => 'selected'; f.fire('pointerdown'); f.advance(700); assert.deepEqual(f.messages, [])
})
test('only the right-edge horizontal swipe exits, and text editing remains untouched', () => {
  const f = fixture(); f.fire('pointerdown', { clientX: 200, clientY: 400 }); f.fire('pointermove', { clientX: 100, clientY: 401 }); assert.deepEqual(f.messages, []); f.fire('pointerup')
  const path = [new f.Element('input')]; f.fire('pointerdown', { clientY: 400 }, path); f.fire('pointermove', { clientX: 290, clientY: 401 }, path); assert.deepEqual(f.messages, []); f.fire('pointerup')
  f.fire('pointerdown', { clientY: 400 }); f.fire('pointermove', { clientX: 290, clientY: 401 }); assert.deepEqual(f.messages, ['exit'])
})
test('Escape exits immediately, cancels timers and ignores composition', () => {
  const f = fixture(); f.fire('keydown', { key: 'Escape', isComposing: true }); assert.deepEqual(f.messages, [])
  f.fire('pointermove', { pointerType: 'mouse', clientY: 4 }); const key = f.fire('keydown', { key: 'Escape' }); f.advance(1000)
  assert.equal(key.stopped, true); assert.deepEqual(f.messages, ['exit'])
})
test('fullscreen exit and disposal clear delayed gestures and all listeners', () => {
  const f = fixture(); f.fire('pointerdown'); f.api.setFullscreen(false); f.advance(1000); assert.deepEqual(f.messages, [])
  f.api.setFullscreen(true); f.fire('pointermove', { pointerType: 'mouse', clientY: 4 }); f.api.dispose(); f.advance(1000)
  assert.deepEqual(f.messages, []); assert.equal(f.timers.size, 0); assert.equal(f.handlers.size, 0)
})
