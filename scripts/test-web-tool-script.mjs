import { build } from 'esbuild'
import { Worker } from 'node:worker_threads'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const bundle = await build({ entryPoints: ['src/services/webToolScript.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { protectWebToolScript } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

function execute(source) {
  const hook = 'guard_' + crypto.randomUUID().replaceAll('-', '')
  const transformed = protectWebToolScript(source, hook, 'main.js')
  const url = 'data:text/javascript;base64,' + Buffer.from(transformed).toString('base64')
  return new Promise((resolve, reject) => {
    const worker = new Worker(`const {parentPort}=require('node:worker_threads');let checks=0;globalThis[${JSON.stringify(hook)}]=()=>{if(++checks>500)throw new Error('budget exceeded')};import(${JSON.stringify(url)}).then(async m=>{const value=typeof m.run==='function'?await m.run():null;parentPort.postMessage({value,checks})}).catch(e=>parentPort.postMessage({error:e.message,checks}));`, { eval: true })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('instrumented script did not stop')) }, 2000)
    worker.once('message', value => { clearTimeout(timer); void worker.terminate(); resolve(value) })
    worker.once('error', error => { clearTimeout(timer); void worker.terminate(); reject(error) })
  })
}

for (const source of [
  'while(true) {}',
  'export function run(){for(;;);}',
  'export function run(){do {continue} while(true)}',
  'export function run(){outer:for(;;){for(;;){continue outer}}}',
  'export function run(){function recur(){return recur()}return recur()}',
  'export function run(){const recur=()=>recur();return recur()}',
  'export async function run(){for(;;){await Promise.resolve()}}',
]) {
  test('stops runaway script: ' + source, async () => {
    const result = await execute(source)
    assert.equal(result.error, 'budget exceeded')
  })
}

test('preserves loops, nested arrows, object returns, directives and class methods', async () => {
  const result = await execute(`export function run(){'use strict';let n=0;for(let i=0;i<3;i++)n+=i;for(const x of [4,5])n+=x;for(const k in {a:1,b:2})n++;let j=0;do j++;while(j<2);const f=x=>y=>({v:x+y});class C{get value(){return f(n)(j).v}}return new C().value}`)
  assert.equal(result.value, 16)
  assert.ok(result.checks > 10)
})

test('rejects invalid JavaScript rather than executing unprotected source', () => {
  assert.throws(() => protectWebToolScript('export function {', 'test', 'bad.js'), SyntaxError)
})

function runtimeFixture(budgets = { initializationMs: 5000, interactionMs: 10000 }) {
  let clock = 0
  let timerSequence = 0
  const timers = new Map()
  const listeners = new Map()
  const events = target => ({
    addEventListener(type, listener) {
      const key = target + ':' + type
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(target + ':' + type)?.delete(listener) },
  })
  const nativeWorkers = []
  const fetchSignals = []
  const messages = []
  const context = {
    AbortController, Request, Error, Set, performance: { now: () => clock },
    setTimeout(callback) { const id = ++timerSequence; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    Worker: class { constructor() { this.terminated = false; nativeWorkers.push(this) } terminate() { this.terminated = true } },
    fetch(_input, options) { fetchSignals.push(options.signal); return Promise.resolve({ ok: true }) },
  }
  context.window = context
  Object.assign(context, events('window'))
  context.document = events('document')
  runInNewContext(readFileSync('public/web-tool-safety.js', 'utf8'), context)
  const runtime = context.FireflyWebToolRuntime('budget', 'session', value => messages.push(value), budgets)
  return { context, runtime, nativeWorkers, fetchSignals, messages,
    check() { for (let index = 0; index < 256; index++) context.budget() },
    advance(value, yieldToLoop = false) {
      clock = value
      if (yieldToLoop) {
        const ready = [...timers.values()]
        timers.clear()
        for (const callback of ready) callback()
      }
    },
    event(target, type) { for (const listener of [...listeners.get(target + ':' + type) ?? []]) listener() },
    pendingTimers: () => timers.size,
  }
}

test('stopping runtime terminates Workers and aborts fetch response bodies and lifecycle signal', async () => {
  const fixture = runtimeFixture()
  new fixture.context.Worker('blob:worker')
  await fixture.context.fetch('https://example.com')
  assert.equal(fixture.fetchSignals[0].aborted, false)
  fixture.runtime.dispose()
  assert.equal(fixture.runtime.signal.aborted, true)
  assert.equal(fixture.nativeWorkers[0].terminated, true)
  assert.equal(fixture.fetchSignals[0].aborted, true)
  fixture.runtime.dispose()
})

test('caller AbortSignal reaches fetch and elapsed idle time does not count as synchronous work', async () => {
  const fixture = runtimeFixture()
  const caller = new AbortController()
  await fixture.context.fetch('https://example.com', { signal: caller.signal })
  caller.abort()
  assert.equal(fixture.fetchSignals[0].aborted, true)
  fixture.advance(5000, true)
  assert.doesNotThrow(() => fixture.context.budget())
  fixture.runtime.dispose()
})

test('runtime budget stops resources and emits a distinct fatal code', () => {
  const fixture = runtimeFixture()
  new fixture.context.Worker('blob:worker')
  fixture.context.budget()
  fixture.advance(5001)
  assert.throws(() => fixture.check(), error => error.code === 'SCRIPT_TIME_LIMIT' && error.message.includes('5 秒'))
  assert.equal(fixture.messages[0].type, 'fatal')
  assert.equal(fixture.messages[0].code, 'SCRIPT_TIME_LIMIT')
  assert.equal(fixture.nativeWorkers[0].terminated, true)
})

test('initialization tolerates work beyond the old 1.5-second budget and stops beyond five seconds', () => {
  const fixture = runtimeFixture()
  fixture.check()
  for (const time of [1800, 3001, 4999, 5000]) {
    fixture.advance(time)
    assert.doesNotThrow(() => fixture.check())
  }
  fixture.advance(5001)
  assert.throws(() => fixture.check(), error => error.code === 'SCRIPT_TIME_LIMIT' && error.message.includes('初始化'))
})

test('finishing mount gives interaction a fresh ten-second budget', () => {
  const fixture = runtimeFixture()
  fixture.check()
  fixture.advance(4800)
  assert.doesNotThrow(() => fixture.check())
  fixture.runtime.finishMount()
  assert.equal(fixture.pendingTimers(), 0)
  fixture.check()
  for (const time of [7801, 10800, 14799, 14800]) {
    fixture.advance(time)
    assert.doesNotThrow(() => fixture.check())
  }
  fixture.advance(14801)
  assert.throws(() => fixture.check(), error => error.code === 'SCRIPT_TIME_LIMIT' && error.message.includes('交互') && error.message.includes('10 秒'))
})

test('the mount transition cannot be repeated to reset an active interaction', () => {
  const fixture = runtimeFixture()
  fixture.runtime.finishMount()
  fixture.check()
  fixture.advance(9900)
  fixture.runtime.finishMount()
  fixture.advance(10001)
  assert.throws(() => fixture.check(), error => error.code === 'SCRIPT_TIME_LIMIT')
})

test('finishing mount checks initialization work even without another instrumented loop', () => {
  const fixture = runtimeFixture()
  fixture.check()
  fixture.advance(5001)
  assert.throws(() => fixture.runtime.finishMount(), error => error.code === 'SCRIPT_TIME_LIMIT')
  assert.equal(fixture.runtime.signal.aborted, true)
})

test('separate event-loop turns do not accumulate elapsed time toward the interaction limit', () => {
  const fixture = runtimeFixture()
  fixture.runtime.finishMount()
  for (let turn = 0; turn < 5; turn++) {
    fixture.advance(turn * 10000, true)
    fixture.check()
    fixture.advance(turn * 10000 + 6000)
    assert.doesNotThrow(() => fixture.check())
  }
  fixture.runtime.dispose()
})

for (const [target, event] of [['document', 'visibilitychange'], ['window', 'pageshow']]) {
  test(`${event} clears the old timer and excludes time spent inactive`, () => {
    const fixture = runtimeFixture()
    fixture.runtime.finishMount()
    fixture.check()
    fixture.advance(2000)
    fixture.event(target, event)
    assert.equal(fixture.pendingTimers(), 0)
    fixture.advance(3600000)
    assert.doesNotThrow(() => fixture.check())
    assert.equal(fixture.pendingTimers(), 1)
    fixture.runtime.dispose()
    assert.equal(fixture.pendingTimers(), 0)
  })
}

test('finishing a canceled mount cannot reactivate the runtime', () => {
  const fixture = runtimeFixture()
  fixture.check()
  fixture.runtime.dispose()
  fixture.runtime.finishMount()
  assert.equal(fixture.pendingTimers(), 0)
  assert.throws(() => fixture.context.budget(), error => error.code === 'TOOL_STOPPED')
})

test('invalid execution budgets are rejected instead of silently disabling the guard', () => {
  for (const budgets of [1500, {}, { initializationMs: NaN, interactionMs: 10000 }, { initializationMs: 5000, interactionMs: Infinity }, { initializationMs: -1, interactionMs: 10000 }, { initializationMs: 5000, interactionMs: '0' }]) {
    assert.throws(() => runtimeFixture(budgets), /运行预算/)
  }
})

test('custom phase budgets remain independent and zero disables only the selected phase', () => {
  for (const budgets of [{ initializationMs: 0, interactionMs: 30000 }, { initializationMs: 30000, interactionMs: 0 }]) {
    const fixture = runtimeFixture(budgets)
    const mountedAt = budgets.initializationMs === 0 ? 3600000 : 20000
    fixture.check()
    fixture.advance(mountedAt)
    assert.doesNotThrow(() => fixture.check())
    fixture.runtime.finishMount()
    fixture.check()
    fixture.advance(mountedAt + 20000)
    assert.doesNotThrow(() => fixture.check())
    if (budgets.interactionMs) {
      fixture.advance(mountedAt + budgets.interactionMs + 1)
      assert.throws(() => fixture.check(), error => error.code === 'SCRIPT_TIME_LIMIT' && error.message.includes('30 秒'))
    } else {
      fixture.advance(mountedAt + 3600000)
      assert.doesNotThrow(() => fixture.check())
    }
    fixture.runtime.dispose()
    assert.throws(() => fixture.check(), error => error.code === 'TOOL_STOPPED')
  }
})

test('the first call after a long inactive period receives a fresh budget', () => {
  const fixture = runtimeFixture()
  fixture.advance(10000)
  assert.doesNotThrow(() => fixture.context.budget())
  fixture.advance(15000, true)
  assert.doesNotThrow(() => fixture.context.budget())
  fixture.runtime.dispose()
})
