import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function fixture() {
  const workers = [], events = [], listeners = new Map()
  const context = { AbortController, AbortSignal, DOMException, Request, performance, setTimeout, clearTimeout, fetch,
    Worker: class { constructor(url, options) { this.name = options?.name; this.url = url; this.terminated = false; workers.push(this) } terminate() { this.terminated = true } },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
  }
  context.window = context; context.parent = {}; context.document = { addEventListener() {}, removeEventListener() {} }
  runInNewContext(readFileSync('public/web-tool-safety.js', 'utf8'), context)
  runInNewContext(readFileSync('public/web-tool-tasks.js', 'utf8'), context)
  const runtime = context.FireflyWebToolRuntime('budget', 'test', data => events.push(data), { initializationMs: 5000, interactionMs: 10000 })
  runtime.finishMount()
  const resources = { worker: (path, options) => runtime.createWorker(path, options, options.signal) }
  const tasks = context.FireflyWebToolTasks('test', data => events.push(data), runtime.signal, resources, runtime)
  return { runtime, tasks, workers, events, context, resources }
}
async function until(check) { for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await Promise.resolve() }; assert.fail('The queue did not settle') }

test('a completed task cancels Worker allocation that has not finished loading its resource', async t => {
  const f = fixture(); t.after(() => f.runtime.dispose())
  const allocate = f.resources.worker
  let release, late
  const gate = new Promise(resolve => { release = resolve })
  f.resources.worker = async (...args) => { await gate; return allocate(...args) }
  assert.equal(await f.tasks.run('first result wins', task => {
    late = task.worker('slow.js').then(() => 'allocated', error => error.name)
    return 42
  }), 42)
  release()
  assert.equal(await late, 'AbortError')
  assert(f.workers.every(worker => worker.terminated))
  assert.equal(await f.tasks.run('next', () => 43), 43)
})

test('late progress from a completed task cannot restore its running indicator', async t => {
  const f = fixture(); t.after(() => f.runtime.dispose())
  let report
  await f.tasks.run('finished', task => { report = task.report; return 42 })
  const count = f.events.length
  report(0.5)
  assert.equal(f.events.length, count)
  assert.equal(f.events.at(-1).state, 'finished')
})
test('default concurrency starts four jobs and drains the rest in FIFO order', async () => {
  const f = fixture(), started = [], gates = []
  let active = 0, peak = 0
  const jobs = Array.from({ length: 9 }, (_, index) => f.tasks.run(String(index), async task => {
    started.push(index); active++; peak = Math.max(peak, active)
    await task.worker('job.js')
    await new Promise(resolve => gates[index] = resolve)
    active--; return index
  }))
  await until(() => gates.filter(Boolean).length === 4)
  assert.deepEqual(started, [0, 1, 2, 3])
  for (let index = 0; index < 9; index++) { await until(() => !!gates[index]); gates[index](); await until(() => f.events.some(event => event.taskId === `task-${index + 1}` && event.state === 'finished')) }
  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 9 }, (_, index) => index))
  assert.equal(peak, 4)
  assert(f.workers.every(worker => worker.terminated))
  f.runtime.dispose()
})
test('eight Workers are explicit and decreasing a live Worker limit is rejected atomically', async () => {
  const f = fixture(), gates = []
  f.tasks.configure({ concurrency: 8, workerLimit: 8 })
  const jobs = Array.from({ length: 8 }, (_, index) => f.tasks.run(String(index), async task => {
    await task.worker('job.js'); await new Promise(resolve => gates[index] = resolve)
  }))
  await until(() => gates.length === 8)
  assert.equal(f.workers.length, 8)
  assert.throws(() => new f.context.Worker('ninth.js'), error => error.code === 'WORKER_LIMIT')
  assert.throws(() => f.tasks.configure({ concurrency: 1, workerLimit: 1 }), error => error.code === 'WORKER_LIMIT')
  assert.equal(f.tasks.configure().concurrency, 8)
  for (const value of [0, 9, 1.5, NaN, Infinity]) assert.throws(() => f.tasks.configure({ concurrency: value }))
  for (const resolve of gates) resolve()
  await Promise.all(jobs)
  assert(f.workers.every(worker => worker.terminated))
  f.runtime.dispose()
})
test('canceling a queued job never runs its callback and never consumes a Worker slot', async () => {
  const f = fixture(), controller = new AbortController()
  f.tasks.configure({ concurrency: 1 })
  let release, called = false
  const first = f.tasks.run('first', async task => { await task.worker('first.js'); await new Promise(resolve => release = resolve) })
  await until(() => !!release)
  const canceled = f.tasks.run('queued', () => { called = true }, { signal: controller.signal })
  const rejected = assert.rejects(canceled, { name: 'AbortError' })
  controller.abort(); await rejected
  assert.equal(called, false); assert.equal(f.workers.length, 1)
  release(); await first
  assert.equal(await f.tasks.run('next', () => 42), 42)
  f.runtime.dispose()
})
test('a task waiting for a Worker can be canceled without disturbing an active Worker', async () => {
  const f = fixture(), controller = new AbortController()
  f.tasks.configure({ concurrency: 2, workerLimit: 1 })
  let release, allocated = false
  const first = f.tasks.run('owner', async task => { await task.worker('first.js'); await new Promise(resolve => release = resolve) })
  await until(() => !!release)
  const second = f.tasks.run('waiting', async task => { await task.worker('second.js'); allocated = true }, { signal: controller.signal })
  const rejected = assert.rejects(second, { name: 'AbortError' })
  await Promise.resolve(); controller.abort(); await rejected
  assert.equal(allocated, false); assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, false)
  release(); await first
  f.runtime.dispose()
})
test('the waiting queue is bounded and stopping rejects every active and queued job', async () => {
  const f = fixture(); f.tasks.configure({ concurrency: 1 })
  const jobs = Array.from({ length: 129 }, (_, index) => f.tasks.run(String(index), () => new Promise(() => {})))
  const settled = Promise.allSettled(jobs)
  await assert.rejects(f.tasks.run('overflow', () => {}), /128/)
  f.runtime.dispose()
  const results = await settled
  assert(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'))
})
test('raw Worker option getters cannot reenter the constructor past its limit', () => {
  const f = fixture(); f.runtime.configureWorkers(1)
  const worker = new f.context.Worker('outer.js', { get name() {
    assert.throws(() => new f.context.Worker('inner.js'), error => error.code === 'WORKER_LIMIT')
    return 'outer'
  } })
  assert.equal(f.workers.length, 1)
  worker.terminate(); f.runtime.dispose()
})
