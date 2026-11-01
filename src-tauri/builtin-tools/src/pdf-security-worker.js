import {securePdf} from './pdf-security-engine.js'
self.onmessage=async({data})=>{try{
 importScripts(data.coreUrl)
 let rejectLoad;const failure=new Promise((_,reject)=>{rejectLoad=reject})
 const core=await Promise.race([failure,self.Module({noInitialRun:true,noExitRuntime:true,noFSInit:true,preRun:[module=>module.FS.init(null,()=>{},()=>{})],instantiateWasm(imports,ready){WebAssembly.instantiate(data.wasm,imports).then(value=>ready(value.instance,value.module)).catch(()=>rejectLoad(new Error('PDF 引擎启动失败，请检查设备内存。')));return {}}})])
 const result=securePdf(core,new Uint8Array(data.bytes),data.mode,data.options)
 self.postMessage({type:'done',bytes:result},[result.buffer])
}catch(error){self.postMessage({type:'error',message:/memory|out of bounds/i.test(error.message)?'PDF 处理所需内存不足，请使用较小文件或关闭其他占用内存的程序后重试。':error.message||'PDF 处理失败。'})}}
