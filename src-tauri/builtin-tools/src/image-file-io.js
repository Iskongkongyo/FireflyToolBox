import {CANVAS_INPUT_BYTES,CANVAS_OUTPUT_BYTES} from './image-limits.js'
export async function openCanvasFile(files,signal){
 const file=await files.open({extensions:['png','jpg','jpeg','webp','bmp'],signal})
 if(!file)return null
 try{return {name:file.name,blob:await file.blob({maxBytes:CANVAS_INPUT_BYTES,signal})}}finally{await file.close()}
}
export async function saveBlob(files,name,blob,signal,maxBytes=CANVAS_OUTPUT_BYTES){
 if(!blob.size||blob.size>maxBytes)throw new Error(`输出须大于零且不超过 ${maxBytes/1048576} MiB。`)
 const writer=await files.createWriter(name)
 try{await writer.write(blob,{signal});return await writer.save({signal})}finally{await writer.abort()}
}
