// Keep editing responsive while reporting only acknowledged persistent writes.
export function persistentSaver(storage, signal) {
 const panel=document.createElement('div'),message=document.createElement('p'),retry=document.createElement('button')
 panel.dataset.saveState='idle';panel.hidden=true;message.className='status';message.setAttribute('role','status');retry.type='button';retry.textContent='重试保存';retry.hidden=true;panel.append(message,retry);document.getElementById('status').after(panel)
 let revision=0,disposed=false,latest,last=Promise.resolve(true)
 const active=()=>!disposed&&!signal?.aborted
 function show(state,value){if(!active())return;panel.hidden=false;panel.dataset.saveState=state;message.textContent=value;message.classList.toggle('error',state==='error');retry.hidden=state!=='error'}
 function commit(entry){
  if(!active())throw new DOMException('工具已停止。','AbortError')
  const current=++revision;latest=entry
  try{localStorage.setItem(entry.key,entry.json)}catch(error){show('error','尚未保存：'+error.message);latest=undefined;retry.hidden=true;last=Promise.resolve(false);throw error}
  show('pending','正在保存…')
  last=Promise.resolve().then(()=>storage.flush()).then(()=>{if(current===revision)show('saved',entry.label);return true},error=>{if(current===revision)show('error','尚未保存：'+error.message);return false})
  return last
 }
 retry.onclick=()=>{if(!latest||!active())return;try{void commit(latest)}catch{/* The error remains visible with its retry action. */}}
 const stop=()=>{disposed=true;revision++;retry.hidden=true;retry.onclick=null}
 signal?.addEventListener('abort',stop,{once:true})
 return{
  write(key,value,label='已保存。'){return commit({key,json:JSON.stringify(value),label})},
  settled:()=>last,
  dispose(){stop();signal?.removeEventListener('abort',stop)},
 }
}
