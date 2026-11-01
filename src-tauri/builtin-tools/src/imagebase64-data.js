import {IMAGE_LIMIT,BASE64_TEXT_LIMIT,imageType} from './practical.js'
import {imageSize} from './utility.js'

export const BASE64_PREVIEW_CHARS=256*1024
const textType='text/plain;charset=utf-8',chunkBytes=768*1024
const check=signal=>signal?.throwIfAborted()
export function base64ImageInfo(buffer){
 const type=imageType(buffer)
 try{return {...type,...imageSize(buffer),canPreview:true}}
 catch{return {...type,canPreview:false}}
}
export async function encodeImageBlob(blob,signal){
 if(!blob.size||blob.size>IMAGE_LIMIT)throw new Error('图片需大于 0 且不超过 64 MiB。')
 check(signal)
 const info=base64ImageInfo(await blob.slice(0,1048576).arrayBuffer()),parts=[]
 for(let offset=0;offset<blob.size;offset+=chunkBytes){
  check(signal)
  const bytes=new Uint8Array(await blob.slice(offset,offset+chunkBytes).arrayBuffer()),chunks=[]
  for(let start=0;start<bytes.length;start+=49152)chunks.push(btoa(String.fromCharCode(...bytes.subarray(start,start+49152))))
  parts.push(new Blob(chunks,{type:textType}))
 }
 check(signal)
 return {...info,textBlob:new Blob(parts,{type:textType})}
}
export async function decodeImageBlob(blob,signal){
 if(!blob.size||blob.size>BASE64_TEXT_LIMIT)throw new Error('Base64 文本需大于 0 且不超过 96 MiB。')
 const parts=[],decoder=new TextDecoder('utf-8',{fatal:true});let total=0,pending='',declared='',headerDone=false,padding=false
 function decodePart(content){
  if(!content)return
  let raw;try{raw=atob(content)}catch{throw new Error('Base64 内容无法解码，请检查字符和末尾的 =。')}
  total+=raw.length
  if(total>IMAGE_LIMIT)throw new Error('还原的图片超过 64 MiB 上限。')
  const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)
  parts.push(new Blob([bytes]))
 }
 function accept(value,final=false){
  let content=pending+value.replace(/[\t\n\r ]/g,'');pending=''
  if(!headerDone){
   // Wait for enough characters to distinguish a split Data URL header.
   if(!final&&content.length<64){pending=content;return}
   if(/^data:/i.test(content)){
    const header=/^data:(image\/(?:png|jpeg|jpg|gif|webp|bmp));base64,/i.exec(content)
    if(!header)throw new Error('Data URL 格式无效，仅支持常见图片的 data:image/...;base64, 格式。')
    declared=header[1].toLowerCase().replace('image/jpg','image/jpeg');content=content.slice(header[0].length)
   }
   headerDone=true
  }
  if(/[^A-Za-z0-9+/=]/.test(content))throw new Error('Base64 内容无效，请检查字符。')
  const equals=content.indexOf('='),end=equals>=0?Math.floor(equals/4)*4:Math.floor(content.length/4)*4
  decodePart(content.slice(0,end));pending=content.slice(end)
  if(equals>=0){padding=true;if(pending.length>4||!/^[A-Za-z0-9+/]{2,3}={1,2}$/.test(pending))throw new Error('Base64 末尾的 = 无效。')}
  if(final){if(pending.length===1||padding&&pending.length!==4)throw new Error('Base64 末尾的 = 无效。');decodePart(pending);pending=''}
 }
 for(let offset=0;offset<blob.size;offset+=1048576){
  check(signal)
  const bytes=new Uint8Array(await blob.slice(offset,offset+1048576).arrayBuffer())
  let value;try{value=decoder.decode(bytes,{stream:true})}catch{throw new Error('文本不是有效的 UTF-8 Base64 文件。')}
  accept(value)
 }
 check(signal)
 let tail;try{tail=decoder.decode()}catch{throw new Error('文本不是有效的 UTF-8 Base64 文件。')}
 accept(tail,true)
 if(!total)throw new Error('Base64 内容为空。')
 const output=new Blob(parts),info=base64ImageInfo(await output.slice(0,1048576).arrayBuffer())
 if(declared&&declared!==info.mime)throw new Error('Data URL 声明的图片格式与实际内容不一致。')
 return {...info,imageBlob:new Blob([output],{type:info.mime})}
}
