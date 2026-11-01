import{inspectArchive,extractArchive,createArchive}from'./zip-engine.js'
self.onmessage=({data})=>{try{const result=data.mode==='inspect'?inspectArchive(data.bytes):data.mode==='extract'?extractArchive(data.bytes,data.name):createArchive(data.files,data.level);self.postMessage({result},result instanceof Uint8Array?[result.buffer]:[])}catch(error){self.postMessage({error:error.message})}}
