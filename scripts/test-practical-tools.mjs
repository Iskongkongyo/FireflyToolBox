import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bmi,phoneNumber,phoneResult,encodeImageBase64,decodeImageBase64,IMAGE_LIMIT,BASE64_TEXT_LIMIT} from '../src-tauri/builtin-tools/src/practical.js'
import {imageSize} from '../src-tauri/builtin-tools/src/utility.js'

test('BMI follows adult Chinese cutoffs before rounding, including jin conversion',()=>{
  for(const[value,category]of [[18.49,'体重偏低'],[18.5,'正常范围'],[23.999,'正常范围'],[24,'超重'],[27.999,'超重'],[28,'肥胖']]) assert.equal(bmi(100,value).category,category)
  assert.equal(bmi(170,120,'jin').kg,60);assert.ok(Math.abs(bmi(170,60).value-60/2.89)<1e-10)
  assert.equal(bmi(100,20).lower,18.5);assert.equal(bmi(100,20).upper,24)
  for(const[h,w]of [['',60],[0,60],[170,''],[170,-1],[251,60],[170,Infinity]])assert.throws(()=>bmi(h,w))
})
test('phone lookup normalizes only mainland phone numbers without URL injection',()=>{
  for(const n of ['13800138000','+86 138-0013-8000','0086 (138)00138000'])assert.equal(phoneNumber(n),'13800138000')
  for(const n of ['','12345678901','1380013800','+1 13800138000','13800138000&x=1'])assert.throws(()=>phoneNumber(n))
  assert.deepEqual(phoneResult({code:0,data:{province:'北京',city:'',sp:'移动'}}),{province:'北京',city:'',carrier:'移动'})
  assert.throws(()=>phoneResult({code:0,data:{province:'',city:'',sp:''}}));assert.throws(()=>phoneResult({code:500,data:{}}))
})
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/L9sAAAAASUVORK5CYII=','base64'))
test('image Base64 round trip preserves every byte with plain and data URL input',()=>{
  const data=encodeImageBase64(png.buffer);assert.equal(data.mime,'image/png')
  for(const input of [data.base64,`data:image/png;base64,${data.base64}`,data.base64.replace(/=+$/,'')+'\n'])assert.deepEqual(new Uint8Array(decodeImageBase64(input).buffer),png)
  assert.deepEqual(imageSize(png.buffer),{width:1,height:1})
})
test('image conversion rejects unsupported formats, wrong MIME, invalid padding and oversized decoded data',()=>{
  const valid=encodeImageBase64(png.buffer).base64
  for(const input of ['', 'abc!','a','aaaa=','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,'+valid,'data:image/png,'+valid,'a'.repeat(BASE64_TEXT_LIMIT+1),'A'.repeat(Math.ceil((IMAGE_LIMIT+1)/3)*4)])assert.throws(()=>decodeImageBase64(input))
  assert.throws(()=>encodeImageBase64(new ArrayBuffer(IMAGE_LIMIT+1)))
  assert.throws(()=>decodeImageBase64(btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
  const huge=png.slice();new DataView(huge.buffer).setUint32(16,20000);assert.throws(()=>imageSize(huge.buffer))
})
test('large image encoding uses bounded chunks without stack overflow',()=>{
  const large=new Uint8Array(IMAGE_LIMIT);large.set(png);const result=encodeImageBase64(large.buffer)
  assert.equal(decodeImageBase64(result.base64).buffer.byteLength,IMAGE_LIMIT)
})
