import {encodeImageBlob,decodeImageBlob} from './imagebase64-data.js'
self.onmessage=async({data})=>{try{const result=await(data.mode==='encode'?encodeImageBlob(data.blob):decodeImageBlob(data.blob));self.postMessage({result})}catch(e){self.postMessage({error:e.message})}}
