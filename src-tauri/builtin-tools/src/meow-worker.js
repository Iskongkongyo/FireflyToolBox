import {meowEncode,meowDecode} from './meow-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:data.action==='encode'?{output:meowEncode(data.input,data.mapping)}:meowDecode(data.input,data.mapping,data.auto)})}catch(e){self.postMessage({error:e.message})}}
