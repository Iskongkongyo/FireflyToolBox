import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {encodeImageBlob,decodeImageBlob} from '../src-tauri/builtin-tools/src/imagebase64-data.js'
import {IMAGE_LIMIT,BASE64_TEXT_LIMIT} from '../src-tauri/builtin-tools/src/practical.js'
import {openBase64File} from '../src-tauri/builtin-tools/src/imagebase64-io.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/L9sAAAAASUVORK5CYII=','base64')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')

test('chunked Base64 retains bytes across 3-byte boundaries and imports whitespace / unpadded / Data URLs',async()=>{
 for(const length of [png.length,768*1024-1,768*1024,768*1024+1,9*1048576+17]){
  const bytes=Buffer.alloc(length,173);png.copy(bytes)
  const result=await encodeImageBlob(new Blob([bytes])),text=await result.textBlob.text()
  assert.equal(text,bytes.toString('base64'))
  for(const input of [text,`data:image/png;base64,\r\n${text}`,text.replace(/=+$/,'')]){
   const restored=await decodeImageBlob(new Blob([input]))
   assert.equal(restored.mime,'image/png');assert.equal(restored.width,1)
   assert.equal(hash(Buffer.from(await restored.imageBlob.arrayBuffer())),hash(bytes))
  }
 }
})

test('decoding accepts UTF-8 BOM, split headers, split padding, and whitespace extending beyond 64 MiB',async()=>{
 const base64=png.toString('base64')
 const start='\uFEFF'+' '.repeat(1048576-4)+'d'
 const header=await decodeImageBlob(new Blob([start,`ata:image/png;base64,${base64}`]))
 assert.deepEqual(Buffer.from(await header.imageBlob.arrayBuffer()),png)
 const shifted=' '.repeat(1048576-base64.length+1)+base64
 assert.deepEqual(Buffer.from(await(await decodeImageBlob(new Blob([shifted]))).imageBlob.arrayBuffer()),png)
 const spaces=new Blob([' '.repeat(1048576)]),text=new Blob([Array(65).fill(spaces),base64].flat())
 assert(text.size>64*1048576)
 const restored=await decodeImageBlob(text)
 assert.deepEqual(Buffer.from(await restored.imageBlob.arrayBuffer()),png)
})

test('Blob conversion accepts exactly 64 MiB and rejects an encoded image one byte over the decoded limit',async()=>{
 const bytes=Buffer.alloc(IMAGE_LIMIT,91);png.copy(bytes)
 const result=await encodeImageBlob(new Blob([bytes])),restored=await decodeImageBlob(result.textBlob)
 assert.equal(restored.imageBlob.size,IMAGE_LIMIT)
 assert.equal(hash(Buffer.from(await restored.imageBlob.arrayBuffer())),hash(bytes))
 // 64 MiB leaves one byte in the final Base64 quartet. Replace it with two bytes.
 const oversized=new Blob([result.textBlob.slice(0,-4),Buffer.from([91,91]).toString('base64')])
 await assert.rejects(decodeImageBlob(oversized),/还原的图片超过 64 MiB/)
})

test('chunk decoder rejects malformed characters, padding, MIME mismatch and declared size limits',async()=>{
 for(const input of ['', 'a', 'abc!', 'AAAA=', 'AA=', 'AA===', 'AAA==', 'AA==AAAA', 'AA==\nA', 'data:image/jpeg;base64,'+png.toString('base64'), 'data:image/png,'+png.toString('base64'), 'data:image/svg+xml;base64,PHN2Zz4=']){
  await assert.rejects(decodeImageBlob(new Blob([input])),undefined,input)
 }
 await assert.rejects(decodeImageBlob(new Blob([Uint8Array.of(255,254)])),/UTF-8/)
 await assert.rejects(decodeImageBlob({size:BASE64_TEXT_LIMIT+1}),/96 MiB/)
 await assert.rejects(encodeImageBlob({size:IMAGE_LIMIT+1}),/64 MiB/)
 const aborted=new AbortController();aborted.abort()
 await assert.rejects(encodeImageBlob(new Blob([png]),aborted.signal),{name:'AbortError'})
 await assert.rejects(decodeImageBlob(new Blob([png.toString('base64')]),aborted.signal),{name:'AbortError'})
})

test('oversized preview dimensions do not block lossless binary conversion',async()=>{
 const bytes=Buffer.from(png);bytes.writeUInt32BE(24000,16)
 const result=await encodeImageBlob(new Blob([bytes]));assert.equal(result.canPreview,false)
 const restored=await decodeImageBlob(result.textBlob)
 assert.equal(restored.canPreview,false);assert.deepEqual(Buffer.from(await restored.imageBlob.arrayBuffer()),bytes)
})

test('v7 text input reads beyond the SDK Blob cap, bounds chunks, closes on success and rejects short reads',async()=>{
 const length=65*1048576+3,requests=[];let closed=0
 const file={name:'large.base64',size:length,async read(offset,count){requests.push(count);return new Uint8Array(count).fill(32)},async close(){closed++}}
 const signal=new AbortController().signal,result=await openBase64File({open:async()=>file},'text',signal)
 assert.equal(result.blob.size,length);assert(requests.every(n=>n<=1048576));assert.equal(closed,1)
 for(const reader of [{...file,size:BASE64_TEXT_LIMIT+1},{...file,size:10,read:async()=>new Uint8Array(9)}]){
  await assert.rejects(openBase64File({open:async()=>reader},'text',signal))
 }
 assert.equal(closed,3)
})
