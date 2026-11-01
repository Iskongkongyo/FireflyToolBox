export const TEXT_LIMIT = 1024 * 1024
export const bytes = value => new TextEncoder().encode(value).byteLength
export const newId = () => typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('')
export function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{throw new Error('工具存储空间不足，当前修改尚未保存。请先导出或缩短内容。')}}
export function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export function dayNumber(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)throw new Error('请选择有效日期。')
 const [year,month,day]=match.slice(1).map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0)
 if(year<1000||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error('请选择有效日期。')
 return date.getTime()/86400000
}
export function countdown(event,today=localDay()){
 dayNumber(event.date);const now=dayNumber(today);let target=event.date
 if(event.yearly){const month=Number(event.date.slice(5,7)),day=Number(event.date.slice(8));let year=Number(today.slice(0,4));const dateInYear=y=>{const d=new Date(0);d.setUTCFullYear(y,month,0);const last=d.getUTCDate();return `${y}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`};target=dateInYear(year);if(dayNumber(target)<now)target=dateInYear(year+1)}
 const difference=dayNumber(target)-now;return {target,difference,days:Math.abs(difference)+(event.includeToday&&difference!==0?1:0)}
}
export async function decodeFile(blob,limit=TEXT_LIMIT,encoding='utf-8'){
 if(blob.size>limit)throw new Error(`文本文件超过 ${Math.round(limit/1024)} KiB 上限。`)
 const data=new Uint8Array(await blob.arrayBuffer());let decoder=encoding
 if(data[0]===255&&data[1]===254)decoder='utf-16le';else if(data[0]===254&&data[1]===255)decoder='utf-16be'
 try{return new TextDecoder(decoder,{fatal:true}).decode(data)}catch{throw new Error('文件编码无法识别，请选择 UTF-8 或 GBK 编码后重试。')}
}
export function imageSize(buffer){
 const b=new Uint8Array(buffer),v=new DataView(buffer),ascii=(start,length)=>String.fromCharCode(...b.slice(start,start+length));let width,height
 if(b.length>=24&&ascii(1,3)==='PNG'&&ascii(12,4)==='IHDR'){width=v.getUint32(16);height=v.getUint32(20)}
 else if(b.length>=10&&ascii(0,3)==='GIF'){width=v.getUint16(6,true);height=v.getUint16(8,true)}
 else if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
  const type=ascii(12,4);if(type==='VP8X'){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16)}
  else if(type==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383}
  else if(type==='VP8L'&&b[20]===47){width=1+(((b[22]&63)<<8)|b[21]);height=1+(((b[24]&15)<<10)|(b[23]<<2)|(b[22]>>6))}
 }
 else if(b.length>=26&&ascii(0,2)==='BM'){const dib=v.getUint32(14,true);if(dib===12){width=v.getUint16(18,true);height=v.getUint16(20,true)}else if(dib>=40){width=v.getInt32(18,true);height=Math.abs(v.getInt32(22,true))}}
 else if(b[0]===255&&b[1]===216){let p=2;while(p+3<b.length){if(b[p++]!==255)throw new Error('JPEG 文件结构无效。');while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(p+2>b.length)break;const length=v.getUint16(p);if(length<2||p+length>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=v.getUint16(p+3);width=v.getUint16(p+5);break}p+=length}}
 if(!width||!height||width<0||height<0)throw new Error('无法读取图片尺寸，请选择 PNG、JPEG、GIF、WebP 或 BMP 图片。')
 if(width*height>24000000||width>16000||height>16000)throw new Error('图片尺寸过大，请先裁剪或缩小至 2400 万像素以内。')
 return {width,height}
}
