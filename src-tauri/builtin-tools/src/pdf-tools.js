import {$,status,size} from './common.js'
import {outputName} from './media-job.js'
export function mount({files,resources,tasks,signal}){
 const mode=$('pdf-tool').dataset.mode,multiple=['image.pdf','pdf.merge'].includes(mode)
 let selected=[],result=null,previewUrl='',busy=false,disposed=false,controller
 $('image-settings').hidden=mode!=='image.pdf';$('render-settings').hidden=!['pdf.image','pdf.document'].includes(mode);$('document-settings').hidden=mode!=='document.pdf';$('export-settings').hidden=mode!=='pdf.document';$('range-field').hidden=!['pdf.image','pdf.document'].includes(mode);$('password-field').hidden=!['pdf.image','pdf.document'].includes(mode)
 if(mode==='document.pdf'){$('paper-settings').hidden=false;$('paper').querySelector('option[value="image"]').remove();$('orientation').value='portrait';$('margin').value='36'}else $('paper-settings').hidden=mode!=='image.pdf'
 const invalidate=()=>{const old=result;result=null;void old?.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('preview-image').removeAttribute('src');$('result').hidden=true;update()}
 const update=()=>{
  const pictureDoc=mode==='pdf.document'&&$('document-format').value==='docx'&&$('docx-mode').value==='images'
  for(const el of document.querySelectorAll('input,select,#choose,#file-list button'))el.disabled=busy||el.dataset.boundary==='true'
  $('process').disabled=busy||!selected.length;$('save').disabled=busy||!result;$('cancel').hidden=!busy;$('docx-mode-field').hidden=$('document-format').value!=='docx';$('quality').disabled=busy||(mode==='pdf.image'&&$('image-format').value==='png')
  $('render-settings').hidden=mode!=='pdf.image'&&!pictureDoc;$('image-format').parentElement.hidden=mode!=='pdf.image';$('quality').parentElement.hidden=!['image.pdf','pdf.image'].includes(mode)&&!pictureDoc
 }
 function render(){
  $('file-list').replaceChildren(...selected.map((item,index)=>{
   const row=document.createElement('li');row.className='pdf-file-row';const name=document.createElement('span');name.textContent=`${index+1}. ${item.file.name} · ${item.file.size?size(item.file.size):'大小待读取'}`;row.append(name)
   if(mode==='pdf.merge'){
    for(const [field,title,placeholder]of [['range','合并页码','全部或 1-3,5'],['password','PDF 打开密码（可选）','无需密码可留空']]){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type=field==='password'?'password':'text';if(field==='password'){input.autocomplete='off';input.maxLength=1024}input.placeholder=placeholder;input.value=item[field];input.oninput=()=>{item[field]=input.value;invalidate()};label.append(input);row.append(label)}
   }
   const buttons=document.createElement('div');buttons.className='actions'
   for(const [label,delta] of [['上移',-1],['下移',1],['移除',0]]){if(!multiple&&delta)continue;const button=document.createElement('button');button.textContent=label;button.dataset.boundary=String((delta<0&&index===0)||(delta>0&&index===selected.length-1));button.disabled=busy||button.dataset.boundary==='true';button.onclick=()=>{if(delta){[selected[index],selected[index+delta]]=[selected[index+delta],selected[index]]}else{selected.splice(index,1);void item.file.close()}invalidate();render()};buttons.append(button)}row.append(buttons);return row
  }));update()
 }
 async function job(work){if(busy||disposed)return;busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{await work(controller.signal)}catch(error){status(error.name==='AbortError'?'已取消，可以重新处理。':error.message,true)}finally{signal.removeEventListener('abort',abort);controller=null;busy=false;if(!disposed){update();render()}}}
 $('choose').onclick=()=>void job(async current=>{
  const extensions=mode==='image.pdf'?[]:mode==='document.pdf'?['docx','txt','md','markdown','html','htm']:['pdf'],picked=multiple?await files.openMany({extensions,signal:current}):[await files.open({extensions,signal:current})].filter(Boolean)
  if(!picked.length){status('已取消选择。');return}
  try{if((multiple?selected.length:0)+picked.length>16)throw new Error('最多选择 16 个文件。');if(picked.some(file=>file.size>(mode==='image.pdf'?128:mode==='document.pdf'?32:64)*1048576))throw new Error('文件超过该工具的大小上限。');if([...((multiple)?selected:[]),...picked.map(file=>({file}))].reduce((n,item)=>n+item.file.size,0)>128*1048576)throw new Error('所选文件总量最多 128 MiB。')}
  catch(error){await Promise.all(picked.map(file=>file.close()));throw error}
  if(!multiple){await Promise.all(selected.map(item=>item.file.close()));selected=[]}
  selected.push(...picked.map(file=>({file,range:'',password:''})));invalidate();render();status(multiple?'文件已添加，可调整顺序后处理。':'文件已选择。')
 })
 for(const el of document.querySelectorAll('section input,section select'))el.oninput=()=>{invalidate();status('参数已更新。')}
 $('process').onclick=()=>void job(async current=>{
  const options={paper:$('paper').value,orientation:$('orientation').value,margin:Number($('margin').value),quality:Number($('quality').value),dpi:Number($('dpi').value),imageFormat:$('image-format').value,range:$('range').value,password:$('password').value,fontSize:Number($('font-size').value),encoding:$('encoding').value,documentFormat:$('document-format').value,docxMode:$('docx-mode').value}
  if(!Number.isFinite(options.quality)||options.quality<1||options.quality>100)throw new Error('质量须为 1～100。')
  const ext=mode==='pdf.image'?'zip':mode==='pdf.document'?options.documentFormat:'pdf',name=mode==='pdf.merge'?'merged.pdf':outputName(selected[0].file.name,'-converted',ext),writer=await files.createWriter(name);invalidate()
  try{
   const output=await tasks.run($('pdf-tool').getAttribute('aria-label'),async context=>{
    status('正在加载离线 PDF 引擎…');const engine=await import(await resources.url('engine/pdf-engine.js',{signal:context.signal}));status('正在处理文件…')
    const value=await engine.processPdf(mode,selected,options,context,resources,writer);if(value.bytes)await writer.write(value.bytes,{signal:context.signal});return value
   },{signal:current,timeoutMs:1800000})
   current.throwIfAborted();result=writer;previewUrl=URL.createObjectURL(new Blob([output.preview],{type:output.previewType??'image/png'}));$('preview-image').src=previewUrl;$('result').hidden=false;$('result-info').textContent=`${name} · ${output.pages} 页 · ${size(writer.bytesWritten)}`
   status(output.warnings?`处理完成，${output.warnings} 处样式、图片或字符未完整保留，请检查预览。`:'处理完成，可以保存。')
  }catch(error){await writer.abort();throw error}
 })
 $('save').onclick=()=>void job(async current=>{if(result&&await result.save({signal:current})){result=null;status('文件已保存。')}else status('已取消保存，可以再次保存。')});$('cancel').onclick=()=>controller?.abort();update()
 return()=>{disposed=true;controller?.abort();void Promise.all(selected.map(item=>item.file.close()));invalidate()}
}
