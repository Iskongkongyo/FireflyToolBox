import {readFile,writeFile,readdir,copyFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {zipSync} from 'fflate'
const assets='src-tauri/builtin-tools/generated/media-assets'
await mkdir(assets,{recursive:true})
const fonts={'cjk-regular.ttf':'308bdf653cdbf746355f7f4d13096bffd066778bd4b896d9c628bd3266092fed','cjk-bold.ttf':'b9fc5dd060fe72bf51d38344363fd0a84d460629eba0546b1a37bc4490c28ccd'}
for(const [name,hash]of Object.entries(fonts)){const bytes=await readFile('src-tauri/builtin-tools/data/pdf-fonts/'+name);if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('中文字体校验失败。');await copyFile('src-tauri/builtin-tools/data/pdf-fonts/'+name,assets+'/'+name)}
const data={}
for(const [folder,prefix] of [['cmaps','cmaps/'],['standard_fonts','fonts/'],['wasm','wasm/']])for(const file of await readdir('node_modules/pdfjs-dist/'+folder)){
 if(file.startsWith('LICENSE'))continue
 data[prefix+file]=new Uint8Array(await readFile('node_modules/pdfjs-dist/'+folder+'/'+file))
}
await writeFile(assets+'/pdf-data.bin',zipSync(data,{level:0}))
const worker=await build({entryPoints:['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true,legalComments:'inline'})
await writeFile(assets+'/pdf-worker.js',worker.outputFiles[0].text)
for(const name of ['qpdf.js','qpdf.wasm'])await copyFile('node_modules/@jspawn/qpdf-wasm/'+name,assets+'/'+name)
const decryptWorker=await build({entryPoints:['src-tauri/builtin-tools/src/pdf-decrypt-worker.js'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',minify:true,legalComments:'inline'})
await writeFile(assets+'/pdf-decrypt-worker.js',decryptWorker.outputFiles[0].text)
const engine=await build({entryPoints:['src-tauri/builtin-tools/src/pdf-engine.js'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'inline'})
await writeFile(assets+'/pdf-engine.js',engine.outputFiles[0].text)
const texts={}
for(const [name,file] of [['qpdf-wasm','node_modules/@jspawn/qpdf-wasm/LICENSE'],['pdf-lib','node_modules/pdf-lib/LICENSE.md'],['pdfjs','node_modules/pdfjs-dist/LICENSE'],['docx','node_modules/docx/LICENSE'],['mammoth','node_modules/mammoth/LICENSE'],['font','src-tauri/builtin-tools/data/noto-font-license.txt']])texts[name]=await readFile(file,'utf8')
for(const folder of ['wasm','standard_fonts','cmaps'])for(const file of await readdir('node_modules/pdfjs-dist/'+folder))if(file.startsWith('LICENSE'))texts['pdfjs/'+folder+'/'+file]=await readFile('node_modules/pdfjs-dist/'+folder+'/'+file,'utf8')
await writeFile(assets+'/pdf-licenses.json',JSON.stringify({licenses:texts,qpdf:{version:'11.0.0',package:'@jspawn/qpdf-wasm 0.0.2',license:'Apache-2.0',source:'https://github.com/jsscheller/qpdf-wasm'},fontkit:{version:'1.8.9',license:'MIT',source:'https://github.com/znacloud/pdf-fontkit'},font:{source:'https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c',derivative:'Firefly Document Regular/Bold, static wght 400/700, fonttools 4.60.1',sha256:fonts}}))
const image=JSON.parse(await readFile(assets+'/image-resources.json','utf8'))
const resources=await Promise.all(['pdf-engine.js','pdf-worker.js','pdf-decrypt-worker.js','qpdf.js','qpdf.wasm','pdf-data.bin','cjk-regular.ttf','cjk-bold.ttf','pdf-licenses.json'].map(async name=>{const bytes=await readFile(assets+'/'+name);return {path:'engine/'+name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}))
await writeFile(assets+'/pdf-resources.json',JSON.stringify([...resources,...image]))
const html=await readFile('src-tauri/builtin-tools/src/pdf-tools.html','utf8')
for(const [mode,title]of Object.entries({'image.pdf':'图片转 PDF','pdf.image':'PDF 转图片','pdf.merge':'PDF 合并','document.pdf':'文档转 PDF','pdf.document':'PDF 转文档'}))await writeFile(assets+'/'+mode+'.html',html.replaceAll('{{mode}}',mode).replaceAll('{{title}}',title))
