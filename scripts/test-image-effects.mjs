import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {initializeImageMagick,ImageMagick,MagickColors,MagickFormat,MagickGeometry} from '@imagemagick/magick-wasm'
import {imageEffect,watermarkPositions} from '../src-tauri/builtin-tools/src/image-effects-engine.js'
import {convertImage} from '../src-tauri/builtin-tools/src/image-magick.js'
await initializeImageMagick(fs.readFileSync('node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'))
const png=(color,w,h)=>ImageMagick.read(color,w,h,image=>image.write(MagickFormat.Png,data=>data.slice()))
const source=png(MagickColors.Blue,80,60),logo=png(MagickColors.Red,20,10)
const options={mode:'image.watermark',format:'png',quality:90,position:'top-left',opacity:100,size:25,angle:0}
const pixels=bytes=>ImageMagick.read(bytes,image=>image.getPixels(pixels=>pixels.toByteArray(0,0,image.width,image.height,'RGBA')))
const pixel=(bytes,x,y,w=80)=>[...pixels(bytes).slice((y*w+x)*4,(y*w+x)*4+4)]
for(const position of ['top-left','top-right','bottom-left','bottom-right','center'])test('watermark placement '+position+' respects margins and leaves surrounding pixels intact',()=>{
 const result=imageEffect(source,{...options,position},'png',logo),[x,y]=watermarkPositions(80,60,20,10,position)[0]
 assert.deepEqual(pixel(result.output,x+2,y+2),[255,0,0,255]);assert.deepEqual(pixel(result.output,0,0),[0,0,255,255])
 assert.equal(result.width,80);assert.equal(result.height,60)
})
test('opacity is composited over the source, including transparent input',()=>{
 const half=imageEffect(source,{...options,opacity:50},'png',logo),color=pixel(half.output,3,3)
 assert.ok(Math.abs(color[0]-128)<=1);assert.ok(Math.abs(color[2]-127)<=1)
 const zero=imageEffect(source,{...options,opacity:0},'png',logo);assert.deepEqual(pixels(zero.output),pixels(source))
 const transparent=png(MagickColors.Transparent,80,60),result=imageEffect(transparent,{...options,opacity:50},'png',logo)
 assert.ok(Math.abs(pixel(result.output,3,3)[3]-128)<=1);assert.equal(pixel(result.output,79,59)[3],0)
})
test('tile coverage repeats across the image; rotating a logo keeps its background transparent',()=>{
 const tiled=imageEffect(source,{...options,position:'tile'},'png',logo);assert.deepEqual(pixel(tiled.output,25,15),[255,0,0,255])
 const rotated=imageEffect(source,{...options,position:'center',angle:45},'png',logo),values=pixels(rotated.output)
 let red=0,black=0;for(let i=0;i<values.length;i+=4){if(values[i]>0)red++;if(values[i]===0&&values[i+2]===0)black++}
 assert.ok(red>100&&red<800);assert.equal(black,0)
})
const rgb=Buffer.alloc(16*16*3);for(let y=0;y<16;y++)for(let x=0;x<16;x++)rgb.set([x*16,y*16,128],(y*16+x)*3)
const gradient=Buffer.concat([Buffer.from('P6\n16 16\n255\n'),rgb])
test('pixelation averages blocks and uses sharp edges while preserving exact image dimensions',()=>{
 const result=imageEffect(gradient,{mode:'image.pixelate',format:'png',quality:90,block:4}),values=pixels(result.output)
 assert.equal(result.width,16);assert.equal(result.height,16)
 const at=(x,y)=>[...values.slice((y*16+x)*4,(y*16+x)*4+4)]
 assert.deepEqual(at(0,0),at(3,3));assert.notDeepEqual(at(0,0),at(4,0))
 const original=imageEffect(gradient,{mode:'image.pixelate',format:'png',quality:90,block:1});assert.deepEqual(pixels(original.output),pixels(gradient))
 const whole=imageEffect(gradient,{mode:'image.pixelate',format:'png',quality:90,block:512}),single=pixels(whole.output)
 assert.deepEqual([...single.slice(0,4)],[...single.slice(-4)])
})

test('region pixelation matches a separately pixelated crop and preserves every outside pixel',()=>{
 const region={left:4,top:3,width:8,height:8},settings={mode:'image.pixelate',format:'png',quality:90,block:4}
 const before=pixels(gradient),result=imageEffect(gradient,{...settings,region}),after=pixels(result.output)
 const crop=ImageMagick.read(gradient,image=>{image.crop(new MagickGeometry(region.left,region.top,region.width,region.height));return image.write(MagickFormat.Png,data=>data.slice())})
 const expected=pixels(imageEffect(crop,settings).output)
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const offset=(y*16+x)*4,inside=x>=region.left&&x<region.left+region.width&&y>=region.top&&y<region.top+region.height
  const pixel=inside?expected.slice(((y-region.top)*region.width+x-region.left)*4,((y-region.top)*region.width+x-region.left)*4+4):before.slice(offset,offset+4)
  assert.deepEqual(after.slice(offset,offset+4),pixel,`pixel ${x},${y}`)
 }
 assert.equal(result.width,16);assert.equal(result.height,16)
 assert.deepEqual(pixels(imageEffect(gradient,{...settings,block:1,region}).output),before)
})

test('regional pixelation copies alpha exactly instead of blending over the original',()=>{
 const rgba=Buffer.alloc(16*16*4)
 for(let y=0;y<16;y++)for(let x=0;x<16;x++)rgba.set([x*16,y*16,128,32+(x+y)%8*28],(y*16+x)*4)
 const input=Buffer.concat([Buffer.from('P7\nWIDTH 16\nHEIGHT 16\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n'),rgba])
 const region={left:4,top:4,width:8,height:8},settings={mode:'image.pixelate',format:'png',quality:90,block:4}
 const before=pixels(input),after=pixels(imageEffect(input,{...settings,region}).output)
 const crop=ImageMagick.read(input,image=>{image.crop(new MagickGeometry(4,4,8,8));return image.write(MagickFormat.Png,data=>data.slice())}),expected=pixels(imageEffect(crop,settings).output)
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const at=(y*16+x)*4,inside=x>=4&&x<12&&y>=4&&y<12,other=inside?((y-4)*8+x-4)*4:at
  assert.deepEqual(after.slice(at,at+4),(inside?expected:before).slice(other,other+4))
 }
 for(const invalid of [{...region,left:-1},{...region,width:0},{...region,left:12},{...region,top:1.5}])assert.throws(()=>imageEffect(input,{...settings,region:invalid}))
})
test('effect output formats and large images use the real encoder',()=>{
 const large=ImageMagick.read(MagickColors.Blue,2000,1500,image=>image.write(MagickFormat.Bmp,data=>data.slice()));assert.ok(large.length>8388608)
 for(const format of ['png','jpeg','webp']){const result=imageEffect(large,{mode:'image.pixelate',format,quality:85,block:32});assert.deepEqual(ImageMagick.read(result.output,image=>[image.width,image.height]),[2000,1500]);assert.equal(result.preview[0],137)}
})
test('invalid effects, block sizes, opacity and excessive tile counts are rejected',()=>{
 for(const block of [0,-1,1.5,513])assert.throws(()=>imageEffect(source,{mode:'image.pixelate',format:'png',quality:90,block}))
 for(const changes of [{opacity:101},{size:0},{angle:181},{position:'unknown'},{format:'exe'}])assert.throws(()=>imageEffect(source,{...options,...changes},'png',logo))
 assert.throws(()=>watermarkPositions(40000,10,1,1,'tile'))
})
test('image edit crops the actual pixels and rotates dimensions without changing surrounding color',()=>{
 const result=imageEffect(gradient,{mode:'image.edit',format:'png',quality:90,x:4,y:2,width:8,height:6,rotation:90,mirrorX:true});assert.equal(result.width,6);assert.equal(result.height,8);assert.throws(()=>imageEffect(gradient,{mode:'image.edit',format:'png',quality:90,x:15,y:0,width:8,height:6,rotation:0}))
})

test('shared compression really encodes JPEG outputs larger than the old 4 MiB limit',()=>{
 const rgb=Buffer.alloc(3000*1000*3);let seed=123456789
 for(let index=0;index<rgb.length;index++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;rgb[index]=seed&255}
 const input=Buffer.concat([Buffer.from('P6\n3000 1000\n255\n'),rgb])
 const result=convertImage(input,{format:'jpeg',quality:100,background:'transparent',color:'#ffffff',edge:0})
 assert.ok(input.length>8*1048576);assert.ok(result.output.length>4*1048576)
 assert.deepEqual(ImageMagick.read(result.output,image=>[image.width,image.height]),[3000,1000])
})

test('real image inspection and cropping accept a valid image file beyond 128 MiB',()=>{
 const bmp=ImageMagick.read(MagickColors.Blue,32,24,image=>image.write(MagickFormat.Bmp,bytes=>bytes.slice()))
 const input=new Uint8Array(128*1048576+17),originalOffset=new DataView(bmp.buffer,bmp.byteOffset,bmp.byteLength).getUint32(10,true),pixelBytes=bmp.length-originalOffset,newOffset=input.length-pixelBytes
 input.set(bmp.subarray(0,originalOffset));input.set(bmp.subarray(originalOffset),newOffset)
 const header=new DataView(input.buffer);header.setUint32(2,input.length,true);header.setUint32(10,newOffset,true)
 const result=imageEffect(input,{mode:'image.edit',format:'png',quality:90,x:3,y:4,width:12,height:9,rotation:90})
 assert.deepEqual([result.width,result.height],[9,12])
 assert.deepEqual(pixel(result.output,0,0,9),[0,0,255,255])
})
