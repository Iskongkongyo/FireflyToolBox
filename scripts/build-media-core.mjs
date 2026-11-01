import{readFile,writeFile,mkdir}from'node:fs/promises'
import{createHash}from'node:crypto'
const input=new URL('../node_modules/@ffmpeg/core/dist/umd/',import.meta.url),output=new URL('../src-tauri/builtin-tools/generated/media-assets/',import.meta.url)
const pinned={'ffmpeg-core.js':'b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21','ffmpeg-core.wasm':'9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7'}
export async function buildMediaCore(){
 await mkdir(output,{recursive:true})
 for(const [name,hash]of Object.entries(pinned)){const bytes=await readFile(new URL(name,input));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('FFmpeg core version changed; review the stack adapter before updating.');if(name.endsWith('.wasm'))await writeFile(new URL(name,output),bytes)}
 let js=await readFile(new URL('ffmpeg-core.js',input),'utf8')
 const marker='return createFFmpegCore.ready'
 if(js.split(marker).length!==2||!js.includes('var stackRestore=')||js.includes('checkStackCookie'))throw new Error('Unsupported FFmpeg runtime stack layout.')
 // core 0.12.10 links a 64 KiB C stack. Its upstream 5 MiB fix has not been
 // released. Keep the pinned WASM/data layout; reserve a separate allocator-
 // owned block for the downward-growing stack in each single-thread Worker.
 // This allocation lives until the entire Worker is destroyed, so malloc
 // cannot reuse it while native functions/argv are on the new stack.
 // Native exit/abort can leave the stack pointer below its entry point.
 // Only restore it between commands, never while a native call is active.
 const adapter=`var fireflyEncoderStackTop=0;
Module["fireflyEnsureEncoderStack"]=function(){
 if(!fireflyEncoderStackTop){
  var bytes=5*1024*1024,base=Module["_malloc"](bytes+32);
  if(!base||base+bytes+32>Module["HEAPU8"].byteLength)throw new Error("编码引擎无法申请所需内存，请降低清晰度或缩短片段。");
  fireflyEncoderStackTop=Math.floor((base+bytes+16)/16)*16;
  Module["fireflyEncoderStackBytes"]=bytes;
 }
 stackRestore(fireflyEncoderStackTop);
};
["exec","ffprobe"].forEach(function(name){
 var original=Module[name];
 Module[name]=function(){
  Module["fireflyEnsureEncoderStack"]();
  try{return original.apply(Module,arguments)}finally{stackRestore(fireflyEncoderStackTop)}
 };
});\n`
 js=js.replace(marker,adapter+marker);await writeFile(new URL('ffmpeg-core.js',output),js)
}
