import {initializeImageMagick} from '@imagemagick/magick-wasm'
import {prepareOcr} from './ocr-prepare.js'
self.onmessage=async({data})=>{try{await initializeImageMagick(new Uint8Array(data.wasm));const result=prepareOcr(new Uint8Array(data.bytes),data.extension,data.options);self.postMessage({type:'done',...result},[result.bytes.buffer])}catch(error){self.postMessage({type:'error',message:error.message})}}
