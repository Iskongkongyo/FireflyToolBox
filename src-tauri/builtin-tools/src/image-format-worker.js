import {initializeImageMagick} from '@imagemagick/magick-wasm'
import {convertImage,readImage,encodeImage} from './image-magick.js'
import {imageEffect} from './image-effects-engine.js'
let output,offset=0
self.onmessage=async({data})=>{
  try{
    if(data.type==='next'){
      const bytes=output.slice(offset,offset+1048576);offset+=bytes.length
      self.postMessage({type:'chunk',bytes,done:offset===output.length},[bytes.buffer]);if(offset===output.length)output=null
      return
    }
    await initializeImageMagick(new Uint8Array(data.wasm))
    if(data.type==='inspect'){
      const result=readImage(new Uint8Array(data.bytes),data.extension,image=>{const width=image.width,height=image.height,edge=Number.isFinite(data.previewSize)?Math.max(512,Math.min(1600,Math.round(data.previewSize))):512;const ratio=Math.min(1,edge/Math.max(width,height));image.resize(Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio)));return {width,height,preview:encodeImage(image,'png',100).output}});self.postMessage({type:'done',...result},[result.preview.buffer]);return
    }
    const result=data.options.mode?imageEffect(new Uint8Array(data.bytes),data.options,data.extension,data.watermark?new Uint8Array(data.watermark):undefined):convertImage(new Uint8Array(data.bytes),data.options,data.extension)
    output=result.output;offset=0
    self.postMessage({type:'done',size:output.length,preview:result.preview,width:result.width,height:result.height},[result.preview.buffer])
  }catch(error){self.postMessage({type:'error',message:error?.message??String(error)})}
}
