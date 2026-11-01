import {replaceRules,csvToJson,jsonToCsv} from './data-convert-engine.js'
self.onmessage=({data})=>{try{self.postMessage({result:data.mode==='text.replace'?replaceRules(data.text,data.rules):data.direction==='csv'?{text:JSON.stringify(csvToJson(data.text,data.options),null,2)}:{text:jsonToCsv(JSON.parse(data.text),data.options)}})}catch(error){self.postMessage({error:error.message})}}
