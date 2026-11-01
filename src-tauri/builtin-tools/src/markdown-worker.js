import {renderMarkdown} from './markdown-render.js'
self.onmessage=({data})=>{try{self.postMessage({result:renderMarkdown(data.source)})}catch(e){self.postMessage({error:e.message})}}
