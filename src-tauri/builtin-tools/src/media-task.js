import {workerRequest} from './media-job.js'
export async function mediaTask(context,resources,input,mode,options={},writer){
 const coreUrl=await resources.url('engine/ffmpeg-core.js',{signal:context.signal}),wasm=await(await resources.blob('engine/ffmpeg-core.wasm',{signal:context.signal})).arrayBuffer(),worker=await context.worker('engine/media-worker.js')
 return workerRequest(worker,{coreUrl,wasm,mode,options,extension:input.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase()??'bin',input:{url:input.url,size:input.size},...(writer?{output:{url:writer.workspaceUrl,size:0}}:{})},context,[wasm])
}
export function cleanMediaInfo(info){const copy=structuredClone(info);if(copy.format)delete copy.format.filename;return copy}
export async function seekableFile(file,files,signal){if(file.seekable&&file.url)return file;const writer=await files.createWriter(file.name.slice(0,120));try{await writer.write(file.stream({signal}),{signal});const reader=await writer.preview({signal});await writer.abort();await file.close();return reader}catch(error){await writer.abort();await file.close();throw error}}
