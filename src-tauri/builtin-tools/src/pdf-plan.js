export const PDF_MAX_BYTES=64*1024*1024,PDF_MAX_PAGES=200
export function pageRange(value,count){
 if(!Number.isInteger(count)||count<1||count>5000)throw new Error('PDF 页数无效或超过 5000 页。')
 value=String(value??'').trim()
 if(!value||value==='全部'){if(count>PDF_MAX_PAGES)throw new Error('单次最多处理 200 页，请填写页码范围。');return Array.from({length:count},(_,i)=>i)}
 const result=[],seen=new Set()
 for(const token of value.split(/[,，]/)){
  const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);if(!match)throw new Error('页码请填写 1-3,5 等格式。')
  const start=Number(match[1]),end=Number(match[2]??match[1]);if(start<1||end<start||end>count)throw new Error(`页码超出范围（1～${count}）。`)
  for(let i=start;i<=end;i++)if(!seen.has(i)){seen.add(i);result.push(i-1);if(result.length>PDF_MAX_PAGES)throw new Error('单次最多处理 200 页。')}
 }
 return result
}
export function pdfPageSize(width,height,paper='a4',orientation='auto',margin=24){
 margin=Number(margin);if(!Number.isFinite(margin)||margin<0||margin>72||!['a4','letter','image'].includes(paper)||!['auto','portrait','landscape'].includes(orientation))throw new Error('纸张、方向或边距无效。')
 let page=paper==='image'?[Math.max(72,width*.75),Math.max(72,height*.75)]:paper==='letter'?[612,792]:[595.28,841.89]
 if(paper!=='image'&&(orientation==='landscape'||(orientation==='auto'&&width>height)))page.reverse()
 if(page[0]<=margin*2||page[1]<=margin*2)throw new Error('边距过大，页面没有可用空间。')
 const ratio=Math.min((page[0]-margin*2)/width,(page[1]-margin*2)/height)
 return {width:page[0],height:page[1],imageWidth:width*ratio,imageHeight:height*ratio,x:(page[0]-width*ratio)/2,y:(page[1]-height*ratio)/2,margin}
}
export function renderScale(width,height,dpi=150){
 dpi=Number(dpi);if(![72,150,200,300].includes(dpi))throw new Error('清晰度请选择 72、150、200 或 300 DPI。')
 return Math.min(dpi/72,Math.sqrt(16000000/(width*height)),8192/Math.max(width,height))
}
export function checkedZip(bytes,unzip,maxTotal=128*1024*1024){
 let total=0,count=0
 return unzip(bytes,{filter(entry){if(++count>4000||entry.originalSize>32*1024*1024||(total+=entry.originalSize)>maxTotal)throw new Error('文档解包内容过大，最多 128 MiB。');return true}})
}
