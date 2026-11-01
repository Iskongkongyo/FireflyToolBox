import {workerRequest} from './media-job.js'
export async function recognize(context,resources,image,options){
 if(!['standard','small','line'].includes(options.mode))throw new Error('识别模式无效。')
 context.report(.01)
 const [wasm,detModel,recModel,keyBlob]=await Promise.all(['engine/ocr-runtime.wasm','engine/ppocr-det.bin','engine/ppocr-rec.bin','engine/ppocr-keys.json'].map(path=>resources.blob(path,{signal:context.signal})))
 const [runtime,det,rec,keys]=await Promise.all([wasm.arrayBuffer(),detModel.arrayBuffer(),recModel.arrayBuffer(),keyBlob.text().then(JSON.parse)])
 if(!Array.isArray(keys)||keys.length!==18708||keys.some(char=>typeof char!=='string'))throw new Error('文字字典损坏，请恢复工具后重试。')
 context.signal.throwIfAborted();const worker=await context.worker('engine/ocr-worker.js')
 try{return await workerRequest(worker,{wasm:runtime,detModel:det,recModel:rec,keys,image:image.buffer,options},context,[runtime,det,rec,image.buffer])}finally{worker.terminate()}
}
