export function workerRequest(worker, data, {signal,report=()=>{},onLog=()=>{}}={}, transfer=[]) {
  return new Promise((resolve,reject)=>{
    const finish=(error,result)=>{worker.onmessage=worker.onerror=null;signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)}
    const abort=()=>finish(new DOMException('任务已取消。','AbortError'))
    if(signal?.aborted){abort();return}
    signal?.addEventListener('abort',abort,{once:true})
    worker.onerror=()=>finish(new Error('转换引擎启动失败或设备内存不足。'))
    worker.onmessage=({data})=>{
      if(data.type==='progress')report(data.value)
      else if(data.type==='log')onLog(data.message)
      else if(data.type==='error')finish(new Error(data.message))
      else if(data.type==='done')finish(null,data)
    }
    worker.postMessage(data,transfer)
  })
}
export function outputName(name, suffix, extension){return name.replace(/\.[^.]*$/,'').slice(0,80)+suffix+'.'+extension}
