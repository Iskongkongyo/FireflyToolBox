import {kinship} from './kinship-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:kinship(data)})}catch(e){self.postMessage({error:e.message})}}
