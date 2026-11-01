import { wavInfo, wavClipHeader } from './wav.js'

export function mount({ resources, files, tasks, signal }) {
  const find = id => document.getElementById(id)
  let selected, busy = false
  function controls(value) {busy=value;find('open').disabled=value;find('copy').disabled=value||!selected;find('clip').disabled=value||!selected;find('cancel').disabled=!value}
  function status(value) {find('status').textContent=value}
  function report(value) {find('progress').value=value}
  find('wasm').onclick=async()=>{
    find('wasm').disabled=true
    try {
      const value=await tasks.run('运行 WASM',async task=>{
        const worker=await task.worker('assets/compute.worker.js')
        const wasmURL=await resources.url('assets/add.wasm',{signal:task.signal})
        return await new Promise((resolve,reject)=>{worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);worker.onerror=event=>reject(new Error(event.message));worker.postMessage({wasmURL,a:21,b:21})})
      })
      find('wasm-result').textContent=String(value)
    } catch(error) {status(error.message)}
    finally {find('wasm').disabled=false}
  }
  find('open').onclick=async()=>{
    try {
      const file=await files.open()
      if(!file)return
      await selected?.close();selected=file
      find('file-name').textContent=`${file.name} · ${(file.size/1048576).toFixed(2)} MiB`
      for(const kind of ['video','audio']){const player=find(kind);player.pause();player.removeAttribute('src');player.hidden=true}
      const kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':''
      if(kind&&file.url){find(kind).src=file.url;find(kind).hidden=false}
      controls(false);status('文件已选择。')
    } catch(error) {status(error.message)}
  }
  async function process(clip) {
    if(busy||!selected)return
    controls(true);report(0)
    let output
    try {
      const saved=await tasks.run(clip?'截取 WAV':'分块复制',async task=>{
        const name=clip?'clip.wav':`copy-${selected.name}`
        output=await files.createWriter(name)
        if(clip){
          const info=await wavInfo(selected),range=wavClipHeader(info,Number(find('start').value),Number(find('end').value))
          await output.write(range.header,{signal:task.signal})
          for(let offset=0;offset<range.size;){
            const bytes=await selected.read(range.offset+offset,Math.min(1048576,range.size-offset),{signal:task.signal})
            if(!bytes.length)throw new Error('源文件已变化，截取已停止。')
            await output.write(bytes,{signal:task.signal});offset+=bytes.length;task.report(offset/range.size);report(offset/range.size)
          }
          if(range.padding)await output.write(new Uint8Array(1),{signal:task.signal})
        } else {
          await output.write(selected.stream({signal:task.signal,onProgress:({processed,total})=>{const value=total?processed/total:0;task.report(value);report(value)}}),{signal:task.signal})
        }
        return output.save({signal:task.signal})
      })
      status(saved?'文件已保存。':'已取消保存。')
    } catch(error) {status(error.name==='AbortError'?'处理已取消。':error.message)}
    finally {await output?.abort();controls(false)}
  }
  find('copy').onclick=()=>process(false)
  find('clip').onclick=()=>process(true)
  find('cancel').onclick=()=>tasks.cancelAll()
  return ()=>{tasks.cancelAll();void selected?.close();for(const kind of ['audio','video']){find(kind)?.pause()}signal.aborted&&status('工具已停止。')}
}
