import {randomNumbers,randomStrings} from './random-data.js'
self.onmessage=({data})=>{try{self.postMessage({result:data.type==='numbers'?randomNumbers(data.options):randomStrings(data.options)})}catch(e){self.postMessage({error:e.message})}}
