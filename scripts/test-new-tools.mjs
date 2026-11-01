import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {parse} from 'acorn'
import {runInNewContext} from 'node:vm'
import {PDFDocument} from 'pdf-lib'
import {inspectIdentity,identityChecksum} from '../src-tauri/builtin-tools/src/identity-engine.js'
import {inspectBankCard,bankLookupFields} from '../src-tauri/builtin-tools/src/bankcard-engine.js'
import {transformCode} from '../src-tauri/builtin-tools/src/code-engine.js'
import {securePdf,encryptionOptions} from '../src-tauri/builtin-tools/src/pdf-security-engine.js'
test('identity checksum, age birthday boundary, impossible date, legacy and historical region',()=>{
 const id='11010519491231002X',value=inspectIdentity(id,'2026-10-12');assert.equal(value.valid,true);assert.equal(value.age,76);assert.ok(value.region.includes('朝阳'));assert.equal(inspectIdentity(id,'2026-12-31').age,77);assert.equal(inspectIdentity(id.toLowerCase(),'2026-10-12').valid,true)
 assert.equal(inspectIdentity(id.slice(0,-1)+'0','2026-10-12').valid,false)
 const body='11010520010229001';assert.equal(inspectIdentity(body+identityChecksum(body),'2026-10-12').valid,false)
 const future='11010520990101001';assert.equal(inspectIdentity(future+identityChecksum(future),'2026-10-12').valid,false)
 const legacy=inspectIdentity('110105491231002','2026-10-12');assert.equal(legacy.normalized,id);assert.equal(legacy.legacy,true)
 const historical='11010319491231002',old=inspectIdentity(historical+identityChecksum(historical),'2026-10-12');assert.equal(old.valid,true);assert.equal(old.regionKnown,false)
})
test('bank card local checksum and BIN query avoid inventing missing regions',()=>{
 assert.equal(inspectBankCard('4111 1111 1111 1111').luhn,true);assert.equal(inspectBankCard('4111111111111112').luhn,false);assert.equal(inspectBankCard('622305').prefixOnly,true);assert.throws(()=>inspectBankCard('0000000000000000'));assert.throws(()=>inspectBankCard('123456789'))
 const result=bankLookupFields({bank:{name:'Example bank'},country:{alpha2:'DK'},type:'debit'});assert.equal(result.find(row=>row[0]==='发卡国家 / 地区')[1],'丹麦');assert.ok(result.find(row=>row[0]==='发卡机构城市')[1].includes('未提供'))
})
const ast=source=>JSON.parse(JSON.stringify(parse(source,{ecmaVersion:'latest',sourceType:'module'}),(key,value)=>['start','end','raw'].includes(key)?undefined:Array.isArray(value)?value.filter(item=>item?.type!=='EmptyStatement'):value))
test('JavaScript formatting/minification preserve strings, regex and automatic semicolon boundaries',async()=>{
 const source='const url = "https://example.com/a//b"; const expression = /https?:\\/\\/[^ ]+/g;\nfunction f(){ return\n{answer:42}; }'
 for(const action of ['format','minify'])assert.deepEqual(ast(await transformCode('js',action,source)),ast(source))
 await assert.rejects(transformCode('js','minify','function {'))
})
test('HTML and CSS preserve sensitive whitespace and do not load URLs',async()=>{
 const source='<div> hello <span>world</span> ! </div><pre>  a\n b  </pre><textarea> a  b </textarea><script>const x = "a  b";</script>'
 const result=await transformCode('html','minify',source,{keepComments:true});assert.ok(result.includes('<pre>  a\n b  </pre>'));assert.ok(result.includes('<textarea> a  b </textarea>'));assert.ok(result.includes('const x = "a  b";'))
 const css='/*! license */ a { --text: "a  b"; background:url(https://example.invalid/a.png); } b { color: red; }',output=await transformCode('css','minify',css);assert.ok(output.includes('license'));assert.ok(output.includes('a  b'));assert.ok(output.indexOf('a{')<output.indexOf('b{'));assert.ok((await transformCode('css','format',css)).includes('\n'))
 await assert.rejects(transformCode('js','format',' '.repeat(1048577)))
})
test('the generated classic code Worker runs without network APIs',async()=>{
 const messages=[],scope={self:{postMessage:value=>messages.push(value)},TextEncoder,TextDecoder}
 runInNewContext(readFileSync('src-tauri/builtin-tools/generated/media-assets/code-worker.js','utf8'),scope)
 await scope.self.onmessage({data:{language:'html',action:'minify',source:'<pre>  keep  </pre>',options:{}}})
 assert.equal(messages[0].type,'done');assert.equal(messages[0].text,'<pre>  keep  </pre>')
})
async function qpdf(){const create=createRequire(import.meta.url)('@jspawn/qpdf-wasm'),events=['uncaughtException','unhandledRejection'],previous=events.map(name=>new Set(process.listeners(name)));try{return await create({noInitialRun:true,noExitRuntime:true,noFSInit:true,preRun:[core=>core.FS.init(null,()=>{},()=>{})],instantiateWasm(imports,ready){WebAssembly.instantiate(readFileSync('node_modules/@jspawn/qpdf-wasm/qpdf.wasm'),imports).then(value=>ready(value.instance,value.module));return {}}})}finally{events.forEach((name,index)=>{for(const listener of process.listeners(name))if(!previous[index].has(listener))process.removeListener(name,listener)})}}
async function processPdf(bytes,mode,options){const core=await qpdf(),exit=process.exitCode;try{return securePdf(core,bytes,mode,options)}finally{process.exitCode=exit}}
test('PDF AES-256 roundtrip, @ and Unicode passwords, wrong password and permissions validation',async()=>{
 const source=await PDFDocument.create();source.addPage([321,456]);const bytes=await source.save(),opening='@中文-password',owner='different-owner'
 const encrypted=await processPdf(bytes,'pdf.encrypt',{opening,owner,allowPrint:false,allowCopy:false,allowModify:false});await assert.rejects(PDFDocument.load(encrypted),/encrypted/)
 await assert.rejects(processPdf(encrypted,'pdf.decrypt',{password:'incorrect'}))
 const plain=await processPdf(encrypted,'pdf.decrypt',{password:opening}),result=await PDFDocument.load(plain);assert.equal(result.isEncrypted,false);assert.equal(result.getPageCount(),1);assert.deepEqual(result.getPage(0).getSize(),{width:321,height:456})
 const reencrypted=await processPdf(encrypted,'pdf.encrypt',{password:opening,opening:'new-password'});assert.ok((await processPdf(reencrypted,'pdf.decrypt',{password:'new-password'})).length)
 assert.throws(()=>encryptionOptions({opening:'x',allowCopy:false}));assert.throws(()=>encryptionOptions({opening:'中'.repeat(43)}));assert.throws(()=>encryptionOptions({opening:'a\0b'}))
})
