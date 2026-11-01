import {test}from'node:test'
import assert from'node:assert/strict'
import fs from'node:fs'
import{initializeImageMagick,ImageMagick,MagickColors,MagickFormat}from'@imagemagick/magick-wasm'
import{prepareOcr}from'../src-tauri/builtin-tools/src/ocr-prepare.js'
await initializeImageMagick(fs.readFileSync('node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'))
const options={left:3000,top:200,width:300,height:100,enhance:'none',rotation:0,invert:false,deskew:false}
test('OCR crops the original coordinates before rescaling, preserving distant small regions',()=>{
 const bytes=ImageMagick.read(MagickColors.White,5000,1200,image=>image.write(MagickFormat.Png,data=>data.slice())),result=prepareOcr(bytes,'png',options)
 assert.equal(result.width,332);assert.equal(result.height,132);assert.equal(result.scale,1);assert.ok(result.bytes.length)
 assert.throws(()=>prepareOcr(bytes,'png',{...options,left:4900}),/选区/)
})
test('small selected regions gain resolution and rotated selections preserve dimensions plus border',()=>{
 const bytes=ImageMagick.read(MagickColors.Black,500,300,image=>image.write(MagickFormat.Png,data=>data.slice())),result=prepareOcr(bytes,'png',{...options,left:0,top:0,width:100,height:50,enhance:'auto',invert:true,rotation:90})
 assert.equal(result.scale,3);assert.equal(result.width,182);assert.equal(result.height,332)
 ImageMagick.read(result.bytes,image=>assert.equal(image.width,182))
 for(const value of ['invalid'])assert.throws(()=>prepareOcr(bytes,'png',{...options,enhance:value}),/设置/)
})
test('large OCR regions stay within the pixel budget while ordinary documents retain original resolution',()=>{
 const bytes=ImageMagick.read(MagickColors.White,5000,4000,image=>image.write(MagickFormat.Png,data=>data.slice())),result=prepareOcr(bytes,'png',{...options,left:0,top:0,width:5000,height:4000,enhance:'auto'})
 assert.ok(result.width*result.height<=16000000);assert.ok(result.scale<1)
})
