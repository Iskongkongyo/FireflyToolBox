import {workerRequest} from './media-job.js'
import {ENGINE_INPUT_BYTES} from './image-limits.js'
export async function imageBytes(file,signal,maxBytes=ENGINE_INPUT_BYTES){
 if(file.size>maxBytes)throw new Error(`文件最多 ${maxBytes/1048576} MiB。`)
 const parts=[];let length=0
 for(let offset=0;;){const bytes=await file.read(offset,1048576,{signal});if(!bytes.length)break;length+=bytes.length;if(length>maxBytes)throw new Error(`文件最多 ${maxBytes/1048576} MiB。`);parts.push(bytes);offset+=bytes.length}
 const result=new Uint8Array(length);let offset=0;for(const bytes of parts){result.set(bytes,offset);offset+=bytes.length}parts.length=0;return result
}
export async function inspectImage(context,resources,file){
 const bytes=await imageBytes(file,context.signal),wasm=await(await resources.blob('engine/magick.wasm',{signal:context.signal})).arrayBuffer(),worker=await context.worker('engine/image-format-worker.js')
 try{return await workerRequest(worker,{type:'inspect',previewSize:1024,bytes:bytes.buffer,wasm,extension:file.name.split('.').at(-1).toLowerCase()},context,[bytes.buffer,wasm])}finally{worker.terminate()}
}
export async function runImage(context,resources,file,writer,options,watermark){
 const bytes=await imageBytes(file,context.signal),wasm=await (await resources.blob('engine/magick.wasm',{signal:context.signal})).arrayBuffer(),worker=await context.worker('engine/image-format-worker.js')
 try{
 const data={wasm,bytes:bytes.buffer,options,extension:file.name.split('.').pop().toLowerCase(),...(watermark?{watermark:watermark.buffer}:{})},transfer=[wasm,bytes.buffer,...(watermark?[watermark.buffer]:[])]
 context.report(.2)
 const result=await workerRequest(worker,data,context,transfer)
 await new Promise((resolve,reject)=>{
  const finish=error=>{context.signal.removeEventListener('abort',abort);worker.onmessage=worker.onerror=null;error?reject(error):resolve()}
  const abort=()=>finish(new DOMException('已取消','AbortError'))
  context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted){abort();return}
  worker.onerror=()=>finish(new Error('图片引擎停止。'))
  worker.onmessage=async({data})=>{try{if(data.type==='error')throw new Error(data.message);await writer.write(data.bytes,{signal:context.signal});context.report(.3+.7*writer.bytesWritten/result.size);if(data.done)finish();else worker.postMessage({type:'next'})}catch(error){finish(error)}}
  worker.postMessage({type:'next'})
 })
 return result
 }finally{worker.terminate()}
}
