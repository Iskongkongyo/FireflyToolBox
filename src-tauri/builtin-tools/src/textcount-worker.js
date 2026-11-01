import {countText} from './text-count-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:countText(data.text)})}catch(error){self.postMessage({error:error.message})}}
