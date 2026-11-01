import {build} from 'esbuild'
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {buildMediaCore} from './build-media-core.mjs'
import {packBuiltinAssets} from './pack-builtin-assets.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),source=path.join(root,'src-tauri/builtin-tools/src'),output=path.join(root,'src-tauri/builtin-tools/generated')
await mkdir(output,{recursive:true})
const assets=path.join(output,'media-assets')
await mkdir(assets,{recursive:true})
await buildMediaCore()
await copyFile(path.join(root,'node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'),path.join(assets,'magick.wasm'))
for(const name of ['media','image-format']){
 const result=await build({entryPoints:[path.join(source,name+'-worker.js')],bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',charset:'utf8',minify:true,legalComments:'inline'})
 await writeFile(path.join(assets,name+'-worker.js'),result.outputFiles[0].text)
}
const mediaLicenses=JSON.stringify({ffmpeg:{version:'0.12.10',license:'GPL-2.0-or-later',source:'https://github.com/ffmpegwasm/ffmpeg.wasm/tree/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc',adaptation:{name:'Firefly single-thread encoder stack adapter',stack_bytes:5242880,source:'scripts/build-media-core.mjs',upstream_issue:'https://github.com/ffmpegwasm/ffmpeg.wasm/pull/824',notice:'The pinned WASM binary is unchanged. The JavaScript runtime reserves a malloc-owned 5 MiB stack for each managed Worker.'},text:await readFile(path.join(source,'../data/ffmpeg-gpl-2.0.txt'),'utf8')},magick:{version:'0.0.44',license:await readFile(path.join(root,'node_modules/@imagemagick/magick-wasm/LICENSE'),'utf8'),notice:await readFile(path.join(root,'node_modules/@imagemagick/magick-wasm/NOTICE'),'utf8'),source:'https://github.com/dlemstra/magick-wasm/tree/0.0.44'}})
await writeFile(path.join(assets,'licenses.json'),mediaLicenses)
for(const [kind,names] of Object.entries({video:['ffmpeg-core.js','ffmpeg-core.wasm','media-worker.js','licenses.json'],image:['magick.wasm','image-format-worker.js','licenses.json']})){
 const resources=await Promise.all(names.map(async name=>{const bytes=await readFile(path.join(assets,name));return {path:'engine/'+name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}))
 await writeFile(path.join(assets,kind+'-resources.json'),JSON.stringify(resources))
}
const mediaHtml=await readFile(path.join(source,'media.html'),'utf8')
for(const [mode,title] of Object.entries({'video.compress':'视频压缩','video.audio':'视频转音频','video.convert':'视频格式转换','video.gif':'视频转 GIF','gif.video':'GIF 转视频','audio.compress':'音频压缩','audio.convert':'音频格式转换','video.speed':'视频倍速','audio.speed':'音频倍速'}))await writeFile(path.join(assets,mode+'.html'),mediaHtml.replaceAll('{{mode}}',mode).replaceAll('{{title}}',title))
const effectsHtml=(await readFile(path.join(source,'image-effects.html'),'utf8')).replace('{{pixelate-region}}',await readFile(path.join(source,'image-region.html'),'utf8'))
for(const [mode,title]of Object.entries({'unit.convert':'单位换算','math.calculate':'科学计算器','text.replace':'文本批量替换','data.convert':'CSV / JSON 互转'}))await writeFile(path.join(assets,mode+'.html'),(await readFile(path.join(source,'utility-tools.html'),'utf8')).replaceAll('{{mode}}',mode).replaceAll('{{title}}',title))
for(const [mode,title]of Object.entries({'video.edit':'视频剪辑','audio.edit':'音频剪辑'}))await writeFile(path.join(assets,mode+'.html'),(await readFile(path.join(source,'media-edit.html'),'utf8')).replaceAll('{{mode}}',mode).replaceAll('{{title}}',title))
await import('./build-pdf-assets.mjs')
await import('./build-ocr-assets.mjs')
await import('./build-extra-tools.mjs')
for(const [mode,title] of Object.entries({'image.watermark':'图片水印','image.pixelate':'图片像素化'}))await writeFile(path.join(assets,mode+'.html'),effectsHtml.replaceAll('{{mode}}',mode).replaceAll('{{title}}',title))
const worker=async name=>(await build({entryPoints:[path.join(source,name+'-worker.js')],bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',charset:'utf8',legalComments:'inline',minify:name==='calendar'})).outputFiles[0].text
const notice=async files=>'/*\n'+(await Promise.all(files.map(file=>readFile(path.join(root,file),'utf8')))).join('\n\n').replaceAll('*/','* /')+'\n*/\n'
const identityNotice=await notice(['node_modules/china-division/LICENSE']),bankNotice=await notice(['node_modules/bankcard/LICENSE'])
const regex=await worker('regex')
const textcount=await worker('textcount')
const utility=await worker('utility'),zipTools=await notice(['node_modules/fflate/LICENSE'])+await worker('zip')
const licenses=await Promise.all(['node_modules/cron-parser/LICENSE','node_modules/luxon/LICENSE.md'].map(file=>readFile(path.join(root,file),'utf8')))
const cron='/*\n'+licenses.join('\n\n').replaceAll('*/','* /')+'\n*/\n'+await worker('cron')
const exif=await notice(['node_modules/exifr/LICENSE','node_modules/fflate/LICENSE'])+await worker('exif')
const qr=await notice(['node_modules/jsqr/LICENSE'])+await worker('qr')
const diff=await notice(['node_modules/diff/LICENSE'])+await worker('diff')
const markdown=await notice(['node_modules/markdown-it/LICENSE','node_modules/linkify-it/LICENSE','node_modules/mdurl/LICENSE','node_modules/uc.micro/LICENSE.txt','node_modules/punycode.js/LICENSE-MIT.txt','node_modules/markdown-it/node_modules/entities/LICENSE'])+await worker('markdown')
const globeNotice=await notice(['node_modules/d3-geo/LICENSE','node_modules/d3-array/LICENSE','node_modules/internmap/LICENSE','node_modules/topojson-client/LICENSE','src-tauri/builtin-tools/data/world-atlas-license.txt','src-tauri/builtin-tools/data/globe-data-notice.txt'])
const emojiNotice=await notice(['src-tauri/builtin-tools/data/unicode-license.txt'])
const imagebase64=await worker('imagebase64')
const hiddenimage=await worker('hiddenimage')
const random=await worker('random')
const magic=await worker('magic')
const rc4=await worker('rc4')
const meow=await worker('meow')
const kinship=await notice(['node_modules/relationship.js/LICENSE'])+await worker('kinship')
const calendar=await notice(['node_modules/lunar-javascript/LICENSE'])+await worker('calendar')
const qrGenerateNotice=await notice(['node_modules/qrcode/license','node_modules/dijkstrajs/LICENSE.md'])
const qrGenerate=qrGenerateNotice+await worker('qrgenerate')
for(const name of ['screen-check','quote-card','github-download','file-links','identity','bankcard','code-tools','pdf-security','utility-tools','zip-tools','pdf-pages','media-info','media-edit','image-edit','textcount','boxoffice','ocr','ai-hub','pdf-tools','image-effects','media','regex','cron','radix','hash','source','certificate','decision','pomodoro','history','bing','score','trending','countdown','memo','exif','emoji','qr','diff','markdown','whois','ip','briefing','itnews','bmi','phone','imagebase64','imagestitch','imagecompress','imageconvert','weather','calendar','qrgenerate','morse','hiddenimage','kinship','meow','imagesearch','reaction','random','shortlink','poem','translate','password','woodfish','flowers','globe','commands','fuel','gold','worldtime','magic','palettes','icon-design','rc4','drawing','mindmap','color-picker','exchange','daily-rates']){
  const result=await build({entryPoints:[path.join(source,name+'.js')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2020',charset:'utf8',legalComments:'inline',define:{UTILITY_WORKER_SOURCE:JSON.stringify(utility),ZIP_WORKER_SOURCE:JSON.stringify(zipTools),TEXTCOUNT_WORKER_SOURCE:JSON.stringify(textcount),REGEX_WORKER_SOURCE:JSON.stringify(regex),CRON_WORKER_SOURCE:JSON.stringify(cron),EXIF_WORKER_SOURCE:JSON.stringify(exif),QR_WORKER_SOURCE:JSON.stringify(qr),DIFF_WORKER_SOURCE:JSON.stringify(diff),MARKDOWN_WORKER_SOURCE:JSON.stringify(markdown),IMAGEBASE64_WORKER_SOURCE:JSON.stringify(imagebase64),CALENDAR_WORKER_SOURCE:JSON.stringify(calendar),QR_GENERATE_WORKER_SOURCE:JSON.stringify(qrGenerate),HIDDENIMAGE_WORKER_SOURCE:JSON.stringify(hiddenimage),KINSHIP_WORKER_SOURCE:JSON.stringify(kinship),MEOW_WORKER_SOURCE:JSON.stringify(meow),RANDOM_WORKER_SOURCE:JSON.stringify(random),MAGIC_WORKER_SOURCE:JSON.stringify(magic),RC4_WORKER_SOURCE:JSON.stringify(rc4)}})
  const code=(name==='identity'?identityNotice:name==='bankcard'?bankNotice:name==='globe'?globeNotice:name==='emoji'?emojiNotice:name==='qrgenerate'?qrGenerateNotice:'')+result.outputFiles[0].text
  if(Buffer.byteLength(code)>1024*1024)throw new Error(`Builtin ${name} exceeds 1 MiB`)
  await writeFile(path.join(output,name+'.js'),code,'utf8')
}
await packBuiltinAssets()
