import {rc4Convert} from './rc4-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:rc4Convert(data)})}catch(e){self.postMessage({error:e.message})}}
