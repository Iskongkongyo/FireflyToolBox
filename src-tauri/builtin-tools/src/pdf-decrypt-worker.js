import {decryptPdf} from './pdf-decrypt.js'
self.onmessage=async event=>{
 try {
  const {coreUrl,wasm,bytes,password}=event.data
  importScripts(coreUrl)
  // This build does not implement wasmBinary/print; supply WASM directly and
  // suppress FS diagnostics so passwords are never logged or requested online.
  const core=await self.Module({noInitialRun:true,noExitRuntime:true,noFSInit:true,preRun:[core=>core.FS.init(null,()=>{},()=>{})],instantiateWasm(imports,ready){WebAssembly.instantiate(wasm,imports).then(value=>ready(value.instance,value.module)).catch(()=>self.postMessage({type:'error',message:'PDF 解密引擎启动失败，请检查设备内存。'}));return {}}})
  const result=decryptPdf(core,new Uint8Array(bytes),password)
  self.postMessage({type:'done',bytes:result},[result.buffer])
 }catch(error){self.postMessage({type:'error',message:error.message||'PDF 解密失败。'})}
}
