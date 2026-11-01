import {qrMatrix} from './qr-generate-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:qrMatrix(data.payload,data.options)})}catch(e){self.postMessage({error:e.message})}}
