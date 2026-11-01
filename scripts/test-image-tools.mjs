import {test} from 'node:test'
import assert from 'node:assert/strict'
import {stitchLayout,resized,imageOptions,animatedImage,MAX_TOTAL_PIXELS} from '../src-tauri/builtin-tools/src/images.js'

const images=[{width:400,height:200},{width:100,height:200}]
test('stitch layout preserves aspect ratios, ordered placement and the exact margins',()=>{
 const vertical=stitchLayout(images,{direction:'vertical',tileSize:200,gap:10,columns:2})
 assert.deepEqual(vertical,{width:220,height:530,rects:[{x:10,y:10,width:200,height:100},{x:10,y:120,width:200,height:400}]})
 const horizontal=stitchLayout(images,{direction:'horizontal',tileSize:200,gap:0,columns:2})
 assert.deepEqual(horizontal,{width:500,height:200,rects:[{x:0,y:0,width:400,height:200},{x:400,y:0,width:100,height:200}]})
 const grid=stitchLayout(images,{direction:'grid',tileSize:200,gap:10,columns:2,gridFit:'contain'})
 assert.deepEqual(grid,{width:430,height:120,rects:[{x:10,y:10,width:200,height:100},{x:295,y:10,width:50,height:100}]})
})
test('zero-gap identical rectangular images fill the entire grid without square-cell padding',()=>{
 for(const image of [{width:400,height:200},{width:200,height:400},{width:133,height:97}])for(const gridFit of ['cover','contain']){
  const grid=stitchLayout(Array(4).fill(image),{direction:'grid',tileSize:200,gap:0,columns:2,gridFit})
  assert.equal(grid.width,400);assert.equal(grid.height,2*Math.round(200*image.height/image.width))
  assert.equal(grid.rects.reduce((sum,r)=>sum+r.width*r.height,0),grid.width*grid.height)
  for(const rect of grid.rects){assert.equal(rect.width,200);assert.equal(rect.height,grid.height/2)}
 }
})
test('mixed-ratio grids support centered cover crops and uncropped letterboxing explicitly',()=>{
 const grid=stitchLayout(images,{direction:'grid',tileSize:200,gap:0,columns:2})
 assert.deepEqual(grid.rects[1],{x:200,y:0,width:200,height:100,sourceX:0,sourceY:75,sourceWidth:100,sourceHeight:50})
 assert.throws(()=>stitchLayout(images,{direction:'grid',tileSize:200,gap:0,columns:2,gridFit:'stretch'}))
})
test('resize never enlarges small images and bounds canvases before allocation',()=>{
 assert.deepEqual(resized(4000,3000,1920),{width:1920,height:1440});assert.deepEqual(resized(400,200,1920),{width:400,height:200})
 assert.deepEqual(resized(5000,3000,0),{width:5000,height:3000});assert.throws(()=>resized(6000,5000,0));assert.throws(()=>resized(400,200,-1));assert.throws(()=>resized(400,200,'abc'))
 assert.throws(()=>stitchLayout([{width:10000,height:10000}],{direction:'grid',tileSize:200,gap:0,columns:2}))
 assert.throws(()=>stitchLayout(Array(13).fill({width:100,height:100}),{direction:'grid',tileSize:200,gap:0,columns:2}))
 assert.throws(()=>stitchLayout(Array(12).fill({width:100,height:100}),{direction:'vertical',tileSize:4096,gap:100,columns:2}))
 assert.equal(MAX_TOTAL_PIXELS,48000000)
})
test('output format and transparency settings avoid mislabeled files and black JPEG backgrounds',()=>{
 assert.equal(imageOptions('jpeg',80,'transparent','#ff0000').fill,'#ffffff')
 assert.equal(imageOptions('webp',80,'transparent','#ff0000').fill,null)
 assert.equal(imageOptions('png','','color','#ff0000').fill,'#ff0000')
 for(const args of [['avif',80,'transparent','#ffffff'],['jpeg',101,'transparent','#ffffff'],['png',80,'color','url(x)']])assert.throws(()=>imageOptions(...args))
})
test('animation detection rejects APNG and animated WebP before native pixel decoding',()=>{
 const webp=new Uint8Array(30);webp.set([...Buffer.from('VP8X')],12);webp[20]=2;assert.equal(animatedImage(webp.buffer,'image/webp'),true);webp[20]=16;assert.equal(animatedImage(webp.buffer,'image/webp'),false)
 const png=new Uint8Array(60),view=new DataView(png.buffer);view.setUint32(8,13);png.set(Buffer.from('IHDR'),12);view.setUint32(33,8);png.set(Buffer.from('acTL'),37);assert.equal(animatedImage(png.buffer,'image/png'),true);png.set(Buffer.from('IDAT'),37);assert.equal(animatedImage(png.buffer,'image/png'),false)
})
