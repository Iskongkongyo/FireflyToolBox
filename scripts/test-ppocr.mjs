import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {ctcDecode,dbPostProcess,sortBoxes,minAreaRect} from '../src-tauri/builtin-tools/src/ppocr-data.js'
test('CTC repeats collapse only without an intervening blank and dictionary/output mismatches fail',()=>{
 const chars=['','中','文'],tokens=[1,1,0,1,2,2],values=new Float32Array(tokens.length*3);tokens.forEach((c,i)=>values[i*3+c]=.9)
 const result=ctcDecode(values,[1,6,3],chars);assert.equal(result.text,'中中文');assert(Math.abs(result.score-.9)<1e-6);assert.throws(()=>ctcDecode(values,[1,6,4],chars));assert.throws(()=>ctcDecode(values,[1,5,3],chars))
})
test('DB postprocessing maps source coordinates, rejects weak components and clamps expanded rotated regions',()=>{
 const w=64,h=48,map=new Float32Array(w*h);for(let y=10;y<22;y++)for(let x=12;x<48;x++)map[y*w+x]=.9
 const boxes=dbPostProcess(map,[1,1,h,w],.5,128,96);assert.equal(boxes.length,1);assert(Math.abs(boxes[0].cx-59)<1);assert(boxes[0].quad.flat().every(v=>Number.isFinite(v)&&v>=0));assert(boxes[0].w>70)
 assert.equal(dbPostProcess(map.map(v=>v?.3:0),[1,1,h,w],1,w,h).length,0);assert.throws(()=>dbPostProcess(map,[1,1,20,20],1,w,h))
 const rect=minAreaRect([10,10,30,30,34,26,14,6]);assert(rect.w>rect.h)
})
test('reading order is stable across nearby columns and retains complete line metadata',()=>{
 const rows=[{cx:100,cy:12,h:10,text:'B'},{cx:12,cy:11,h:10,text:'A'},{cx:10,cy:35,h:10,text:'C'}];assert.deepEqual(sortBoxes(rows).map(v=>v.text),['A','B','C'])
})
test('factory OCR resources use pinned PP-OCR / ONNX assets and have no old Tesseract model files',()=>{
 const manifest=JSON.parse(readFileSync('src-tauri/builtin-tools/generated/media-assets/ocr-resources.json','utf8')),paths=manifest.map(r=>r.path);for(const path of ['engine/ppocr-det.bin','engine/ppocr-rec.bin','engine/ppocr-keys.json','engine/ocr-runtime.wasm'])assert(paths.includes(path));for(const path of paths)assert(!/traineddata|eng-best|chi_sim|eng\.bin|ocr-core/.test(path));for(const name of ['eng-best.bin','chi_sim-best.bin'])assert.equal(existsSync('src-tauri/builtin-tools/data/ocr-models/'+name),false)
 const pkg=JSON.parse(readFileSync('package.json','utf8'));assert.equal(pkg.devDependencies['onnxruntime-web'],'1.23.2');for(const key of Object.keys(pkg.devDependencies))assert(!key.includes('tesseract'))
})
