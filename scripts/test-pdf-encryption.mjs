import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {PDFDocument,StandardFonts,EncryptedPDFError,degrees} from 'pdf-lib'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {decryptPdf} from '../src-tauri/builtin-tools/src/pdf-decrypt.js'
import {loadPdfForEditing} from '../src-tauri/builtin-tools/src/pdf-load.js'
const create=createRequire(import.meta.url)('@jspawn/qpdf-wasm'),wasm=fs.readFileSync('node_modules/@jspawn/qpdf-wasm/qpdf.wasm')
async function core(){const events=['uncaughtException','unhandledRejection'],previous=events.map(event=>new Set(process.listeners(event)));try{return await create({noInitialRun:true,noExitRuntime:true,noFSInit:true,preRun:[core=>core.FS.init(null,()=>{},()=>{})],instantiateWasm(imports,ready){WebAssembly.instantiate(wasm,imports).then(value=>ready(value.instance,value.module));return {}}})}finally{for(let i=0;i<events.length;i++)for(const listener of process.listeners(events[i]))if(!previous[i].has(listener))process.removeListener(events[i],listener)}}
function run(core,args){const exit=process.exitCode;try{return core.callMain(args)}finally{process.exitCode=exit}}
async function fixture(password,bits,aes){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica)
 for(const text of ['first page','second page']){const page=pdf.addPage([300,400]);page.drawText(text,{font,size:22,x:20,y:350});page.drawRectangle({x:30,y:30,width:50,height:60})}
 pdf.getPage(1).setRotation(degrees(90));const q=await core();q.FS.writeFile('/source.pdf',await pdf.save())
 const args=['--allow-weak-crypto','--encrypt',password,'owner-test',String(bits),...(aes?['--use-aes=y']:[]),'--','/source.pdf','/encrypted.pdf']
 assert.equal(run(q,args),0);return q.FS.readFile('/encrypted.pdf')
}
async function decrypt(bytes,password,max){const q=await core();const exit=process.exitCode;try{return decryptPdf(q,bytes,password,max)}finally{process.exitCode=exit;assert.throws(()=>q.FS.stat('/input.pdf'));assert.throws(()=>q.FS.stat('/output.pdf'))}}
for(const [label,password,bits,aes]of [['empty-password AES-256','',256,false],['password AES-256','test-secret',256,false],['Unicode password AES-256','中文密码-🔑',256,false],['password AES-128','test-secret',128,true],['password RC4-128','test-secret',128,false],['password RC4-40','test-secret',40,false]])test(`encrypted ${label} preserves selectable text, page order, geometry and rotation`,async()=>{
 const bytes=await fixture(password,bits,aes);await assert.rejects(PDFDocument.load(bytes),error=>error.message===new EncryptedPDFError().message)
 const {pdf:source}=await loadPdfForEditing(bytes,bytes=>decrypt(bytes,password)),target=await PDFDocument.create()
 assert.equal(source.isEncrypted,false);assert.equal(source.getPageCount(),2);assert.equal(source.getPage(1).getRotation().angle,90)
 for(const page of await target.copyPages(source,[1,0]))target.addPage(page)
 const task=getDocument({data:await target.save(),useWorkerFetch:false}),parsed=await task.promise
 try{assert.equal(parsed.numPages,2);assert.equal((await parsed.getPage(1)).rotate,90);const text=(await(await parsed.getPage(1)).getTextContent()).items.map(item=>item.str??'').join('');assert.equal(text,'second page');assert.deepEqual(source.getPage(0).getSize(),{width:300,height:400})}finally{await task.destroy()}
})
test('wrong or missing passwords fail without returning broken pages or leaking passwords',async()=>{
 const bytes=await fixture('test-secret',256,false)
 for(const password of ['', 'wrong-secret'])await assert.rejects(decrypt(bytes,password),error=>error.message.includes('打开密码')&&!error.message.includes('secret'))
})
test('ordinary PDFs bypass decryption and malformed PDFs report readable errors',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();const output=await loadPdfForEditing(bytes,()=>{throw new Error('must not decrypt')});assert.equal(output.pdf.getPageCount(),1);await assert.rejects(loadPdfForEditing(new Uint8Array([1,2,3]),()=>{}),/文件是否完整/)
})
test('decryption checks output quota and deletes temporary input/output on failure',async()=>{
 const bytes=await fixture('',256,false);await assert.rejects(decrypt(bytes,'',1),/64 MiB/);await assert.rejects(decrypt(new Uint8Array([1,2,3]),''),/文件是否完整/)
})
test('host CSP permits native workspace URLs used by Workers on both platforms',()=>{
 const csp=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).app.security.csp
 const connect=csp.split(';').map(value=>value.trim().split(/\s+/)).find(parts=>parts[0]==='connect-src')
 for(const source of ['ff-work:','http://ff-work.localhost','https://ff-work.localhost','ff-file:','http://ff-file.localhost'])assert.ok(connect.includes(source),`missing ${source}`)
 assert.ok(!connect.includes('http:'));assert.ok(!connect.includes('*'))
})
