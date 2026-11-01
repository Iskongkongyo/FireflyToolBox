import jsQR from 'jsqr'
self.onmessage=({data})=>{try{const code=jsQR(new Uint8ClampedArray(data.pixels),data.width,data.height,{inversionAttempts:'attemptBoth'});self.postMessage({result:code?{text:code.data,version:code.version,bytes:code.binaryData,location:code.location}:null})}catch(error){self.postMessage({error:`二维码解析失败：${error.message}`})}}
