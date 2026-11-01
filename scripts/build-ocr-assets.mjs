import {readFile,writeFile,copyFile,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
const assets='src-tauri/builtin-tools/generated/media-assets',directory='src-tauri/builtin-tools/data/ocr-models'
const models=JSON.parse(await readFile(directory+'/models.json','utf8'))
for(const model of models.models){const bytes=await readFile(directory+'/'+model.name);if(bytes.length!==model.size||createHash('sha256').update(bytes).digest('hex')!==model.sha256)throw new Error('PP-OCR 模型校验失败：'+model.name);await copyFile(directory+'/'+model.name,assets+'/'+model.name)}
await copyFile('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',assets+'/ocr-runtime.wasm')
// ORT 1.23.2 resolves its unused fallback WASM URL even when wasmBinary is
// supplied. A classic Blob Worker has no module base URL. Keep the embedded
// factory and binary, and replace only that unused location with a valid URL.
const blobWorkerAdapter={name:'firefly-ort-blob-worker',setup(builder){builder.onLoad({filter:/[\\/]ort\.wasm\.bundle\.min\.mjs$/},async({path})=>{const text=await readFile(path,'utf8'),pattern='new URL("ort-wasm-simd-threaded.wasm",import.meta.url).href';if(text.split(pattern).length-1!==2)throw new Error('Pinned ONNX Runtime fallback adapter no longer matches');return{contents:text.replaceAll(pattern,'"data:application/wasm,"'),loader:'js'}})}}
for(const [entry,name]of [['ppocr-worker','ocr-worker'],['ocr-prepare-worker','ocr-prepare-worker']]){const result=await build({entryPoints:['src-tauri/builtin-tools/src/'+entry+'.js'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',minify:true,charset:'utf8',legalComments:'inline',define:{'import.meta.url':'undefined'},plugins:entry==='ppocr-worker'?[blobWorkerAdapter]:[],logOverride:{'empty-import-meta':'silent'}});await writeFile(assets+'/'+name+'.js',result.outputFiles[0].text)}
await writeFile(assets+'/ocr-licenses.json',JSON.stringify({engine:'ONNX Runtime Web',version:'1.23.2',runtimeLicense:await readFile(directory+'/ONNX-RUNTIME-LICENSE','utf8'),models,notice:await readFile(directory+'/MODEL-NOTICE.md','utf8')}))
const resources=await Promise.all(['ocr-worker.js','ocr-runtime.wasm','ocr-prepare-worker.js','ppocr-det.bin','ppocr-rec.bin','ppocr-keys.json','ocr-licenses.json'].map(async name=>{const bytes=await readFile(assets+'/'+name);return{path:'engine/'+name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}))
const image=JSON.parse(await readFile(assets+'/image-resources.json','utf8'));await writeFile(assets+'/ocr-resources.json',JSON.stringify([...resources,...image]))
// Remove obsolete generated files as well as their packed copies. No models
// from the old Tesseract engine are shipped in new clients or tool exports.
for(const name of ['ocr-core.js','eng.bin','chi_sim.bin','eng-best.bin','chi_sim-best.bin'])for(const suffix of ['', '.zlib'])await rm(assets+'/'+name+suffix,{force:true})
