import {PDFDocument,degrees} from 'pdf-lib'
import fontkit from 'pdf-fontkit'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth/mammoth.browser.js'
import {Document,Paragraph,TextRun,ImageRun,Packer} from 'docx'
import MarkdownIt from 'markdown-it'
import {unzipSync,Zip,ZipPassThrough} from 'fflate'
import {pageRange,pdfPageSize,renderScale,checkedZip,PDF_MAX_BYTES} from './pdf-plan.js'
import {layoutDocument} from './pdf-layout.js'
import {imageBytes,runImage} from './image-task.js'
import {workerRequest} from './media-job.js'
import {loadPdfForEditing} from './pdf-load.js'

const check=context=>context.signal.throwIfAborted()
const yieldNow=()=>new Promise(resolve=>setTimeout(resolve,0))
function limit(bytes){if(bytes.byteLength>PDF_MAX_BYTES)throw new Error('输出超过 64 MiB，请减少页数或降低清晰度。');return bytes}
async function binary(file,context,max=PDF_MAX_BYTES){check(context);return imageBytes(file,context.signal,max)}
async function editablePdf(bytes,context,resources,password=''){
 return loadPdfForEditing(bytes,async bytes=>{
  check(context)
  const coreUrl=await resources.url('engine/qpdf.js',{signal:context.signal}),wasm=await(await resources.blob('engine/qpdf.wasm',{signal:context.signal})).arrayBuffer(),worker=await context.worker('engine/pdf-decrypt-worker.js')
  try{const output=await workerRequest(worker,{coreUrl,wasm,bytes,password},context,[wasm,bytes.buffer]);check(context);return limit(output.bytes)}finally{worker.terminate()}
 })
}
async function pdfOpen(bytes,context,resources,password=''){
 const packed=unzipSync(new Uint8Array(await(await resources.blob('engine/pdf-data.bin',{signal:context.signal})).arrayBuffer()))
 const mapping={cMapUrl:'cmaps/',standardFontDataUrl:'fonts/',wasmUrl:'wasm/'}
 class BinaryDataFactory{async fetch({kind,filename}){check(context);const value=packed[mapping[kind]+filename];if(!value)throw new Error('缺少 PDF 内置资源 '+filename);return value.slice()}}
 const worker=await context.worker('engine/pdf-worker.js'),pdfWorker=new pdfjs.PDFWorker({port:worker})
 const task=pdfjs.getDocument({data:bytes.slice(),password,worker:pdfWorker,BinaryDataFactory,useWorkerFetch:false,useWasm:true,isEvalSupported:false,enableXfa:false,maxImageSize:16000000,canvasMaxAreaInBytes:64000000,useSystemFonts:false})
 const abort=()=>void task.destroy();context.signal.addEventListener('abort',abort,{once:true})
 try{const document=await task.promise;return {document,async close(){context.signal.removeEventListener('abort',abort);await task.destroy();pdfWorker.destroy();worker.terminate()}}}
 catch(error){context.signal.removeEventListener('abort',abort);pdfWorker.destroy();worker.terminate();if(error.name==='PasswordException')throw new Error('PDF 需要正确的打开密码。');throw error}
}
async function renderPage(page,context,dpi=150,format='png',quality=85,maxEdge=0){
 check(context);const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(renderScale(base.width,base.height,dpi),maxEdge?maxEdge/Math.max(base.width,base.height):Infinity)}),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height))
 const task=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}),abort=()=>task.cancel();context.signal.addEventListener('abort',abort,{once:true})
 try{await task.promise;check(context);const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('页面无法导出。')),format==='jpeg'?'image/jpeg':'image/png',quality/100));return {bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height}}
 finally{context.signal.removeEventListener('abort',abort);canvas.width=canvas.height=1;page.cleanup()}
}
async function preview(bytes,context,resources){const loaded=await pdfOpen(bytes,context,resources);try{return (await renderPage(await loaded.document.getPage(1),context,72)).bytes}finally{await loaded.close()}}
function archive(writer,context){
 let queue=Promise.resolve(),size=0,failure
 const zip=new Zip((error,chunk)=>{if(error){failure=error;return}size+=chunk.length;if(size>PDF_MAX_BYTES){failure=new Error('输出超过 64 MiB，请减少页数或降低清晰度。');return}queue=queue.then(()=>{check(context);return writer.write(chunk,{signal:context.signal})}).catch(error=>{failure=error})})
 return {async add(name,bytes){check(context);const entry=new ZipPassThrough(name);zip.add(entry);entry.push(bytes,true);await queue;if(failure)throw failure},async end(){zip.end();await queue;if(failure)throw failure}}
}
export async function inspectPages(file,context,resources,password=''){
 const {bytes,pdf}=await editablePdf(await binary(file,context),context,resources,password);if(pdf.getPageCount()>200)throw new Error('页面管理最多 200 页。')
 const loaded=await pdfOpen(bytes,context,resources),pages=[]
 try{for(let i=0;i<loaded.document.numPages;i++){check(context);const page=await loaded.document.getPage(i+1),image=await renderPage(page,context,72,'png',80,200);pages.push({index:i,preview:image.bytes});context.report((i+1)/loaded.document.numPages)}return pages}finally{await loaded.close()}
}
export async function exportPages(file,specs,split,context,resources,writer,password=''){
 if(!specs.length||specs.length>200)throw new Error('请选择 1～200 页。');const {pdf:source}=await editablePdf(await binary(file,context),context,resources,password);if(specs.some(item=>!Number.isInteger(item.index)||item.index<0||item.index>=source.getPageCount()||![0,90,180,270].includes(item.rotate)))throw new Error('页面编号或旋转角度无效。')
 const pdf=await PDFDocument.create(),pages=await pdf.copyPages(source,specs.map(item=>item.index));for(let i=0;i<pages.length;i++){pages[i].setRotation(degrees((pages[i].getRotation().angle+specs[i].rotate)%360));pdf.addPage(pages[i]);check(context)}
 const bytes=limit(await pdf.save()),thumb=await preview(bytes,context,resources)
 if(!split)return {bytes,preview:thumb,pages:specs.length}
 const zip=archive(writer,context);for(let i=0;i<pdf.getPageCount();i++){check(context);const single=await PDFDocument.create();const [page]=await single.copyPages(pdf,[i]);single.addPage(page);await zip.add(`page-${String(i+1).padStart(4,'0')}-original-${specs[i].index+1}.pdf`,await single.save());context.report((i+1)/specs.length)}await zip.end();return {preview:thumb,pages:specs.length,written:true}
}
function htmlBlocks(html){
 const root=new DOMParser().parseFromString(html,'text/html').body,blocks=[];let warnings=0
 const forbidden=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','LINK','META'])
 const runs=(node,style={})=>{if(node.nodeType===3)return [{text:node.textContent??'',...style}];if(forbidden.has(node.nodeName)||node.nodeName==='IMG')return [];if(node.nodeName==='BR')return [{text:'\n',...style}];const next={...style,...(['STRONG','B'].includes(node.nodeName)?{bold:true}:{}),...(['EM','I'].includes(node.nodeName)?{italic:true}:{})};return [...node.childNodes].flatMap(child=>runs(child,next))}
 function image(node){const match=/^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\r\n]+)$/i.exec(node.getAttribute('src')??'');if(!match||match[2].length>12*1024*1024){warnings++;return}const raw=atob(match[2].replace(/\s/g,''));blocks.push({kind:'image',mime:match[1].toLowerCase(),bytes:Uint8Array.from(raw,ch=>ch.charCodeAt(0))})}
 function visit(node){
  if(forbidden.has(node.nodeName))return
  if(node.nodeName==='IMG'){image(node);return}
  if(node.nodeName==='TABLE'){blocks.push({kind:'table',rows:[...node.querySelectorAll('tr')].slice(0,500).map(row=>[...row.children].filter(cell=>['TD','TH'].includes(cell.nodeName)).slice(0,12).map(cell=>cell.textContent??''))});return}
  if(['P','PRE','BLOCKQUOTE','LI','H1','H2','H3','H4','H5','H6'].includes(node.nodeName)){
   const parts=runs(node);if(node.nodeName==='LI')parts.unshift({text:node.parentNode.nodeName==='OL'?`${[...node.parentNode.children].indexOf(node)+1}. `:'• '})
   if(parts.some(run=>run.text.trim()))blocks.push({kind:'paragraph',runs:parts,level:node.nodeName.startsWith('H')?Number(node.nodeName[1]):0,list:node.nodeName==='LI'})
   for(const child of node.querySelectorAll('img'))image(child);return
  }
  if(node.nodeType===3){if(node.textContent.trim())blocks.push({kind:'paragraph',text:node.textContent});return}
  for(const child of node.childNodes)visit(child)
 }
 for(const node of root.childNodes)visit(node)
 if(blocks.length>10000||blocks.reduce((n,b)=>n+(b.text?.length??b.runs?.reduce((n,r)=>n+r.text.length,0)??b.rows?.flat().join('').length??0),0)>1000000)throw new Error('文档文字过多，最多 100 万字符。')
 return {blocks,warnings}
}
async function documentBlocks(file,bytes,options){
 const ext=file.name.split('.').pop().toLowerCase()
 if(ext==='docx'){
  const parts=checkedZip(bytes,unzipSync);if(!parts['word/document.xml'])throw new Error('文件不是有效的 DOCX 文档。')
  const converted=await mammoth.convertToHtml({arrayBuffer:bytes.buffer},{externalFileAccess:false,convertImage:mammoth.images.imgElement(async image=>{if(!['image/png','image/jpeg'].includes(image.contentType))return {src:''};const data=await image.read('base64');return {src:data.length<=12*1024*1024?`data:${image.contentType};base64,${data}`:''}})})
  const result=htmlBlocks(converted.value);result.warnings+=converted.messages.length;return result
 }
 if(!['txt','md','markdown','html','htm'].includes(ext))throw new Error('文档输入支持 DOCX、TXT、Markdown、HTML；旧 DOC 格式请先转为 DOCX。')
 const text=new TextDecoder(options.encoding==='gb18030'?'gb18030':'utf-8').decode(bytes)
 if(text.length>1000000)throw new Error('文档最多 100 万字符。')
 if(ext==='txt')return {blocks:text.split(/\r?\n/).map(text=>({kind:'paragraph',text})),warnings:0}
 return htmlBlocks(['md','markdown'].includes(ext)?new MarkdownIt({html:false}).render(text):text)
}
export async function processPdf(mode,files,options,context,resources,writer){
 check(context)
 if(mode==='image.pdf'){
  const pdf=await PDFDocument.create();let processed=0
  for(const item of files){
   const chunks=[];let size=0
   const sink={get bytesWritten(){return size},async write(bytes){size+=bytes.length;if(size>PDF_MAX_BYTES)throw new Error('单张图片编码过大，请降低质量。');chunks.push(bytes)}}
   const converted=await runImage(context,resources,item.file,sink,{format:'jpeg',quality:options.quality,background:'transparent',color:'#ffffff',edge:0})
   const image=await pdf.embedJpg(new Uint8Array(await new Blob(chunks).arrayBuffer())),layout=pdfPageSize(converted.width,converted.height,options.paper,options.orientation,options.margin),page=pdf.addPage([layout.width,layout.height]);page.drawImage(image,{x:layout.x,y:layout.y,width:layout.imageWidth,height:layout.imageHeight});context.report(++processed/files.length*.8);await yieldNow()
  }
  const bytes=limit(await pdf.save());return {bytes,preview:await preview(bytes,context,resources),pages:pdf.getPageCount()}
 }
 if(mode==='pdf.merge'){
  const pdf=await PDFDocument.create();let count=0,total=0
  for(const item of files){const bytes=await binary(item.file,context);total+=bytes.length;if(total>128*1024*1024)throw new Error('合并输入总量最多 128 MiB。');let source;try{source=(await editablePdf(bytes,context,resources,item.password??'')).pdf}catch(error){if(error.name==='AbortError')throw error;throw new Error(`${item.file.name}：${error.message}`)}const indices=pageRange(item.range,source.getPageCount());if(pdf.getPageCount()+indices.length>200)throw new Error('合并结果最多 200 页。');for(const page of await pdf.copyPages(source,indices))pdf.addPage(page);context.report(++count/files.length*.8);check(context);await yieldNow()}
  const bytes=limit(await pdf.save());return {bytes,preview:await preview(bytes,context,resources),pages:pdf.getPageCount()}
 }
 if(mode==='document.pdf'){
  const source=await documentBlocks(files[0].file,await binary(files[0].file,context,32*1024*1024),options),pdf=await PDFDocument.create();pdf.registerFontkit(fontkit)
  const font=await pdf.embedFont(new Uint8Array(await(await resources.blob('engine/cjk-regular.ttf',{signal:context.signal})).arrayBuffer()),{subset:true})
  const boldFont=await pdf.embedFont(new Uint8Array(await(await resources.blob('engine/cjk-bold.ttf',{signal:context.signal})).arrayBuffer()),{subset:true}),layout=await layoutDocument(pdf,font,source.blocks,{...options,context,boldFont});check(context)
  const bytes=limit(await pdf.save());return {bytes,preview:await preview(bytes,context,resources),pages:layout.pages,warnings:source.warnings+layout.warnings}
 }
 const bytes=await binary(files[0].file,context),loaded=await pdfOpen(bytes,context,resources,options.password)
 try{
  const document=loaded.document,indices=pageRange(options.range,document.numPages);let thumbnail,number=0
  if(mode==='pdf.image'){
   const zip=archive(writer,context)
   for(const index of indices){check(context);const page=await document.getPage(index+1),rendered=await renderPage(page,context,options.dpi,options.imageFormat,options.quality);if(!thumbnail)thumbnail=rendered.bytes;await zip.add(`page-${String(index+1).padStart(4,'0')}.${options.imageFormat==='jpeg'?'jpg':'png'}`,rendered.bytes);context.report(++number/indices.length)}
   await zip.end();return {preview:thumbnail,previewType:options.imageFormat==='jpeg'?'image/jpeg':'image/png',pages:indices.length,written:true}
  }
  const sections=[],texts=[]
  for(const index of indices){
   check(context);const page=await document.getPage(index+1),viewport=page.getViewport({scale:1})
   if(options.docxMode==='images'&&options.documentFormat==='docx'){
    const rendered=await renderPage(page,context,options.dpi,'jpeg',options.quality);if(!thumbnail)thumbnail=rendered.bytes
    sections.push({properties:{page:{size:{width:Math.round(viewport.width*20),height:Math.round(viewport.height*20)},margin:{top:0,bottom:0,left:0,right:0}}},children:[new Paragraph({spacing:{before:0,after:0},children:[new ImageRun({type:'jpg',data:rendered.bytes,transformation:{width:viewport.width*96/72,height:Math.max(1,viewport.height*96/72-6)}})]})]})
   }else{
    const content=await page.getTextContent(),text=content.items.filter(item=>'str'in item).map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();texts.push({page:index+1,text})
    if(options.documentFormat==='docx')sections.push({children:[new Paragraph({children:[new TextRun({text:`第 ${index+1} 页`,bold:true})]}),...text.split('\n').map(line=>new Paragraph({children:[new TextRun({text:line,font:'Microsoft YaHei',size:24})]}))]})
    if(!thumbnail)thumbnail=(await renderPage(page,context,72,'png')).bytes
   }
   context.report(++number/indices.length*.9);await yieldNow()
  }
  if(options.documentFormat==='docx'){if(options.docxMode!=='images'&&!texts.some(item=>item.text))throw new Error('页面没有可提取文字；扫描件请选择保真图片版 DOCX。');return {bytes:limit(new Uint8Array(await Packer.toArrayBuffer(new Document({sections})))),preview:thumbnail,previewType:options.docxMode==='images'?'image/jpeg':'image/png',pages:indices.length}}
  if(!texts.some(item=>item.text))throw new Error('页面没有可提取文字；扫描件请选择保真图片版 DOCX。')
  const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  const output=options.documentFormat==='html'?'<!doctype html><meta charset="utf-8">'+texts.map(item=>`<h2>第 ${item.page} 页</h2><pre>${escape(item.text)}</pre>`).join('\n'):texts.map(item=>`${options.documentFormat==='md'?'## ':''}第 ${item.page} 页\n\n${item.text}`).join('\n\n')
  return {bytes:new TextEncoder().encode(output),preview:thumbnail,pages:indices.length}
 }finally{await loaded.close()}
}
