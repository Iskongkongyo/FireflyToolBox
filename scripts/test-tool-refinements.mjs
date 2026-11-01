import test from 'node:test'
import assert from 'node:assert/strict'
import {createImageRegion} from '../src-tauri/builtin-tools/src/image-region.js'
import {dragRegion,regionRect} from '../src-tauri/builtin-tools/src/image-region-plan.js'
import {mount,translationSites} from '../src-tauri/builtin-tools/src/translate.js'
import {transform} from 'esbuild'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

test('pixelation drag selection clamps edges and preserves reverse drags in original coordinates',()=>{
 assert.deepEqual(dragRegion({x:90,y:80},{x:10,y:20},100,100),{left:10,top:20,width:80,height:60})
 assert.deepEqual(dragRegion({x:-5,y:-2},{x:500,y:400},100,80),{left:0,top:0,width:100,height:80})
 assert.throws(()=>regionRect(0,0,101,80,100,80))
 assert.throws(()=>regionRect(0,0,1.5,1,100,80))
})

test('pixelation defaults to full image and maps a scaled touch drag to the full-resolution region',()=>{
 const fields=Object.fromEntries(['left','top','width','height'].map(key=>[key,{value:'',removeAttribute(){},setAttribute(){}}]))
 const paint={clearRect(){},drawImage(){},fillRect(){},strokeRect(){}},changes=[]
 const canvas={getContext:()=>paint,getBoundingClientRect:()=>({left:10,top:20,width:400,height:200}),setPointerCapture(){}}
 const editor={hidden:true},resetButton={}
 const region=createImageRegion({canvas,fields,editor,resetButton,enabled:()=>true,onChange:value=>changes.push(value),onError:()=>{}})
 region.setSource({width:4000,height:2000},{naturalWidth:1000,naturalHeight:500})
 assert.deepEqual(region.selection(),{left:0,top:0,width:4000,height:2000})
 canvas.onpointerdown({clientX:310,clientY:170,pointerId:4,button:0,preventDefault(){}})
 canvas.onpointermove({clientX:110,clientY:70,pointerId:4})
 assert.deepEqual(region.selection(),{left:1000,top:500,width:2000,height:1000})
 canvas.onpointerup({pointerId:4})
 resetButton.onclick();assert.deepEqual(region.selection(),{left:0,top:0,width:4000,height:2000})
 canvas.onpointerdown({clientX:110,clientY:70,pointerId:5,button:0,preventDefault(){}})
 canvas.onpointerup({pointerId:5});assert.equal(changes.length,3)
 region.dispose();assert.equal(region.ready,false);assert.equal(editor.hidden,true)
})

test('translation cards open and copy all six declared HTTPS entries, and stop after cleanup',async()=>{
 const element=()=>({children:[],classList:{toggle(){}},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}})
 const sites=element(),status=element(),oldDocument=globalThis.document,opened=[],copied=[]
 globalThis.document={createElement:element,getElementById:id=>id==='sites'?sites:status}
 try{
  const dispose=mount({signal:new AbortController().signal,openWebsite:async url=>opened.push(url),copyText:async url=>copied.push(url)})
  assert.equal(sites.children.length,6)
  for(const article of sites.children){const actions=article.children[2];await actions.children[0].onclick();await actions.children[1].onclick()}
  assert.deepEqual(opened,translationSites.map(site=>site[1]));assert.deepEqual(copied,opened)
  assert.ok(opened.every(url=>new URL(url).protocol==='https:'))
  assert.ok(opened.includes('https://www.deepl.com/'));assert.ok(opened.includes('https://www.bing.com/translator'))
  dispose();await sites.children[0].children[2].children[0].onclick();assert.equal(opened.length,6)
 }finally{globalThis.document=oldDocument}
})

test('official box office uses the mobile address on phones and retains the desktop dashboard',async()=>{
 const source=readFileSync('src/services/officialBoxOffice.ts','utf8'),compiled=await transform(source,{loader:'ts',format:'cjs'}),scope={module:{exports:{}}}
 runInNewContext(compiled.code,scope)
 assert.equal(scope.module.exports.boxOfficeUrl(true),'https://piaofang.maoyan.com/box-office?ver=normal')
 assert.equal(scope.module.exports.boxOfficeUrl(false),'https://piaofang.maoyan.com/i/dashboard/movie')
})
