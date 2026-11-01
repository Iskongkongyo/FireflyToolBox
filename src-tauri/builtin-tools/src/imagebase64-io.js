import {IMAGE_LIMIT,BASE64_TEXT_LIMIT} from './practical.js'
export async function openBase64File(files,kind,signal){
 const limit=kind==='image'?IMAGE_LIMIT:BASE64_TEXT_LIMIT
 const file=await files.open({extensions:kind==='image'?['png','jpg','jpeg','gif','webp','bmp']:['txt','base64'],signal})
 if(!file)return null
 try{
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>limit)throw new Error(`${kind==='image'?'图片':'Base64 文本'}需大于 0 且不超过 ${limit/1048576} MiB。`)
  const parts=[];let offset=0
  while(offset<file.size){
   signal?.throwIfAborted()
   const count=Math.min(1048576,file.size-offset),bytes=await file.read(offset,count,{signal})
   if(!(bytes instanceof Uint8Array)||bytes.length!==count)throw new Error('读取文件不完整，请重新选择文件。')
   parts.push(bytes);offset+=bytes.length
  }
  signal?.throwIfAborted()
  return {name:file.name,blob:new Blob(parts,{type:kind==='image'?file.type:'text/plain;charset=utf-8'})}
 }finally{await file.close()}
}
