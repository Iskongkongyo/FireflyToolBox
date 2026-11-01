import { mountWebTool, stopBrowserModule } from '../src/services/browserModule.ts'

export { stopBrowserModule }
export async function start(container, settings = {}) {
  const size = settings.size ?? 32 * 1024 * 1024
  const stats = { readBytes: 0, writtenBytes: 0, reads: 0, writes: 0, largestChunk: 0, valid: true, saves: 0, closed: [], fallbackLimit: null, errors: [] }
  const files = {
    async begin() {}, async close() {},
    async request(_run, kind, data) {
      if (kind === 'open') return [{ id: 'input', name: 'sample.bin', size: settings.unknownSize ? 0 : size, mime_type: 'application/octet-stream' }]
      if (kind === 'read') {
        stats.reads++; stats.largestChunk = Math.max(stats.largestChunk, data.length)
        const length = Math.max(0, Math.min(data.length, size - data.offset))
        stats.readBytes += length
        const bytes = new Uint8Array(length)
        for (let index = 0; index < length; index++) bytes[index] = (data.offset + index) % 251
        return bytes
      }
      if (kind === 'createWriter') return 'output'
      if (kind === 'write') {
        stats.writes++; stats.largestChunk = Math.max(stats.largestChunk, data.bytes.length)
        const offset = stats.writtenBytes
        stats.writtenBytes += data.bytes.length
        stats.valid &&= data.bytes.every((value, index) => value === (offset + index) % 251)
        return stats.writtenBytes
      }
      if (kind === 'save') { stats.saves++; return true }
      if (kind === 'close') { stats.closed.push(data.fileId); return }
      throw new Error('Unexpected operation: ' + kind)
    },
  }
  const action = settings.saveOnly
    ? `await saveFile('copy.bin',new Blob([new Uint8Array(${size})]));result.textContent='saved'`
    : `const file=await openFile();if(!file)throw new Error('No input');await saveFile('copy.bin',file.blob);result.textContent='copied:'+file.blob.size`
  const taskAction = `const first=await tasks.run('default',()=>42);
    const controller=new AbortController();
    const pending=tasks.run('two hours',()=>new Promise(()=>{}),{timeoutMs:7200000,signal:controller.signal});
    controller.abort();let canceled;try{await pending}catch(error){canceled=error.name}
    let rejected=false;try{await tasks.run('too long',()=>0,{timeoutMs:7200001})}catch{rejected=true}
    const after=await tasks.run('after cancel',()=>43);
    result.textContent='tasks:'+first+':'+canceled+':'+after+':'+rejected`
  await mountWebTool(container, {
    moduleId: 'preview.file-limit-review', html: '<main><button id="run">Run</button><output id="result">Ready</output></main>', css: 'button{min-width:100px;min-height:44px}output{display:block}',
    script: `export function mount({openFile,saveFile,tasks}){document.getElementById('run').onclick=async()=>{const result=document.getElementById('result');try{${settings.tasksOnly ? taskAction : action}}catch(error){result.textContent=error.code||error.message}}}`,
    networkHosts: [], resources: [], timeoutMs: 15000,
    inputBytes: settings.inputBytes ?? 2 ** 31, outputBytes: settings.outputBytes ?? 2 ** 31,
    files: settings.fallback ? undefined : files,
    openFile: async (_extensions, limit) => {
      stats.fallbackLimit = limit
      return { name: 'sample.bin', bytes: new Uint8Array(size).fill(90), mimeType: 'application/octet-stream' }
    },
    saveFile: async (_name, bytes) => { stats.writtenBytes += bytes.length; stats.saves++; return true },
    onError: message => stats.errors.push(message),
  })
  return stats
}
