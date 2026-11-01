import {$,status,size} from './common.js'
import {encryptionOptions} from './pdf-security-engine.js'
import {workerRequest,outputName} from './media-job.js'
export function mount({files,resources,tasks,signal}){
 const mode=$('pdf-security').dataset.mode,encrypt=mode==='pdf.encrypt';let file=null,result=null,busy=false,controller,disposed=false
 $('encrypt-fields').hidden=!encrypt;$('process').textContent=encrypt?'加密 PDF':'解密 PDF';$('usage').textContent=encrypt?'输出 PDF 需输入打开密码。修改已有加密 PDF 时，请填写原文件密码；重新写入 PDF 会影响已有数字签名。':'使用正确的打开密码或权限密码移除加密；未加密的文件也可导出。此工具不破解未知密码。重新写入 PDF 会影响已有数字签名。'
 const update=()=>{for(const node of document.querySelectorAll('input,button'))node.disabled=busy;$('process').disabled=busy||!file;$('save').disabled=busy||!result;$('cancel').hidden=!busy;$('cancel').disabled=false}
 async function invalidate(){const old=result;result=null;$('result').hidden=true;update();await old?.abort()}
 async function job(work){if(busy||disposed||signal.aborted)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){if(!disposed&&!signal.aborted)status(error.name==='AbortError'?'已取消，未保存输出。':error.message,true)}finally{signal.removeEventListener('abort',abort);controller=null;busy=false;if(!disposed)update()}}
 for(const node of document.querySelectorAll('input'))node.oninput=()=>void invalidate()
 $('choose').onclick=()=>void job(async current=>{const next=await files.open({extensions:['pdf'],signal:current});if(!next)return;if(next.size>64*1048576){await next.close();throw new Error('PDF 文件最多 64 MiB。')}await invalidate();await file?.close();file=next;$('source-info').textContent=next.name+' · '+(next.size?size(next.size):'大小待读取');status('文件已选择。')})
 $('process').onclick=()=>void job(async current=>{
  const options={password:$('source-password').value,opening:$('opening').value,owner:$('owner').value,allowPrint:$('allow-print').checked,allowCopy:$('allow-copy').checked,allowModify:$('allow-modify').checked}
  if(encrypt){if(options.opening!==$('confirm').value)throw new Error('两次打开密码不一致。');encryptionOptions(options)}
  await invalidate();status('正在读取 PDF…')
  const bytes=await(await file.blob({maxBytes:64*1048576,signal:current})).arrayBuffer()
  const completed=await tasks.run(encrypt?'PDF 加密':'PDF 解密',async context=>{status('正在'+(encrypt?'加密':'解密')+' PDF…');const coreUrl=await resources.url('engine/qpdf.js',{signal:context.signal}),wasm=await(await resources.blob('engine/qpdf.wasm',{signal:context.signal})).arrayBuffer();return workerRequest(await context.worker('engine/pdf-security-worker.js'),{mode,options,bytes,wasm,coreUrl},context,[bytes,wasm])},{signal:current,timeoutMs:300000})
  const writer=await files.createWriter(outputName(file.name,encrypt?'-encrypted':'-decrypted','pdf'))
  try{await writer.write(completed.bytes,{signal:current});result=writer;$('result').hidden=false;$('result-info').textContent=(encrypt?'已加密 PDF':'未加密 PDF')+' · '+size(completed.bytes.byteLength);for(const id of ['source-password','opening','confirm','owner'])$(id).value='';status('处理完成，请保存结果。')}catch(error){await writer.abort();throw error}
 })
 $('save').onclick=()=>void job(async current=>{if(result&&await result.save({signal:current})){result=null;status('文件已保存。')}else status('已取消保存，可再次保存。')})
 $('clear').onclick=()=>void job(async()=>{await invalidate();await file?.close();file=null;for(const id of ['source-password','opening','confirm','owner'])$(id).value='';$('source-info').textContent='单个 PDF 最多 64 MiB。';status('已清空。')});$('cancel').onclick=()=>controller?.abort();update()
 return()=>{disposed=true;controller?.abort();void file?.close();void invalidate();for(const id of ['source-password','opening','confirm','owner'])$(id).value=''}
}
