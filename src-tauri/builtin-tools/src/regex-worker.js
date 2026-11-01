import {regexTest} from './algorithms.js'
self.onmessage=({data})=>{try{self.postMessage({result:regexTest(data)})}catch(error){self.postMessage({error:error.message})}}
