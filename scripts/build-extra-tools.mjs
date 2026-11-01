import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {resolve} from 'node:path'
const assets='src-tauri/builtin-tools/generated/media-assets',source='src-tauri/builtin-tools/src'
await mkdir(assets,{recursive:true})
for(const name of ['code','pdf-security']){const worker=await build({entryPoints:[source+'/'+name+'-worker.js'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',charset:'utf8',minify:true,legalComments:'inline',...(name==='code'?{alias:{'clean-css':resolve(source,'code-css-stub.js')}}:{})});await writeFile(assets+'/'+name+'-worker.js',worker.outputFiles[0].text)}
const licenses={}
for(const [name,license]of [['prettier','LICENSE'],['terser','LICENSE'],['csso','LICENSE'],['css-tree','LICENSE'],['html-minifier-terser','LICENSE'],['clean-css','LICENSE'],['relateurl','LICENSE'],['entities','LICENSE']]){const info=JSON.parse(await readFile('node_modules/'+name+'/package.json','utf8'));licenses[name]={version:info.version,license:info.license,text:await readFile('node_modules/'+name+'/'+license,'utf8'),source:info.homepage??info.repository}}
await writeFile(assets+'/code-licenses.json',JSON.stringify(licenses))
for(const [name,files]of Object.entries({code:['code-worker.js','code-licenses.json'],'pdf-security':['pdf-security-worker.js','qpdf.js','qpdf.wasm','pdf-licenses.json']})){const resources=await Promise.all(files.map(async file=>{const bytes=await readFile(assets+'/'+file);return {path:'engine/'+file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}));await writeFile(assets+'/'+name+'-resources.json',JSON.stringify(resources))}
const codeHtml=await readFile(source+'/code-tools.html','utf8'),pdfHtml=await readFile(source+'/pdf-security.html','utf8')
for(const language of ['html','js','css'])await writeFile(assets+'/'+language+'.format.html',codeHtml.replaceAll('{{language}}',language).replaceAll('{{title}}',{html:'HTML 格式化与压缩',js:'JS 格式化与压缩',css:'CSS 格式化与压缩'}[language]))
for(const mode of ['pdf.encrypt','pdf.decrypt'])await writeFile(assets+'/'+mode+'.html',pdfHtml.replaceAll('{{mode}}',mode).replaceAll('{{title}}',mode==='pdf.encrypt'?'PDF 加密':'PDF 解密'))
