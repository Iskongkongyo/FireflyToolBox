import {degrees,rgb} from 'pdf-lib'
import {pdfPageSize} from './pdf-plan.js'
export async function layoutDocument(pdf,font,blocks,options={}){
 const size=pdfPageSize(1,2,options.paper??'a4',options.orientation??'portrait',options.margin??36),fontSize=Number(options.fontSize??12)
 if(![10,12,14,16].includes(fontSize))throw new Error('字号无效。')
 const available=size.width-2*size.margin;let page,y,pages=0,warnings=0
 const supported=new Set(font.getCharacterSet()),clean=value=>[...value].map(ch=>{if(ch==='\t')return '    ';if(ch==='\n')return ch;const code=ch.codePointAt(0);if(supported.has(code))return ch;warnings++;return supported.has(9633)?'□':'?'}).join('');let characters=0
 const next=()=>{if(++pages>200)throw new Error('文档排版超过 200 页，请拆分文件。');page=pdf.addPage([size.width,size.height]);y=size.height-size.margin}
 const ensure=height=>{if(!page||y-height<size.margin)next()}
 async function paragraph(runs,scale=1,indent=0){
  const px=fontSize*scale,lineHeight=px*1.55;let line=[],lineWidth=0
   const draw=()=>{ensure(lineHeight);y-=px;let x=size.margin+indent;for(const part of line){page.drawText(part.text,{x,y,size:px,font:part.bold?(options.boldFont??font):font,color:rgb(0,0,0),...(part.italic?{xSkew:degrees(9)}:{})});x+=part.width}y-=lineHeight-px;line=[];lineWidth=0}
  for(const run of runs)for(const ch of clean(run.text)){
   if(++characters%256===0){options.context?.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,0))}
   if(ch==='\n'){draw();continue}const width=(run.bold?(options.boldFont??font):font).widthOfTextAtSize(ch,px)
   if(lineWidth+width>available-indent&&line.length)draw()
   const last=line.at(-1);if(last&&last.bold===run.bold&&last.italic===run.italic){last.text+=ch;last.width+=width}else line.push({...run,text:ch,width});lineWidth+=width
  }
  if(line.length)draw();y-=px*.4
 }
 for(const block of blocks){
  options.context?.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,0))
  if(block.kind==='image'){
   try{const embedded=block.mime==='image/png'?await pdf.embedPng(block.bytes):await pdf.embedJpg(block.bytes);const scale=Math.min(1,available/embedded.width,(size.height-2*size.margin)/embedded.height),width=embedded.width*scale,height=embedded.height*scale;ensure(height+8);y-=height;page.drawImage(embedded,{x:size.margin,y,width,height});y-=8}catch{warnings++}
  }else if(block.kind==='table'){
   for(const row of block.rows)await paragraph([{text:row.join('  |  ')}],1,0)
   y-=fontSize*.4
  }else await paragraph(block.runs??[{text:block.text??''}],block.level?Math.max(1,2.1-block.level*.3):1,block.list?fontSize:0)
 }
 if(!pages)next()
 return {pages,warnings}
}
