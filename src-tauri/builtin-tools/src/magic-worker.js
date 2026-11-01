import {magicText} from './magic-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:magicText(data.source,data.options)})}catch(e){self.postMessage({error:e.message})}}
