import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from 'acorn'
import {runInNewContext} from 'node:vm'
import {mount} from '../src-tauri/builtin-tools/src/github-download.js'
test('Release buttons request the system browser for both accelerated and original URLs',async()=>{
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:false,textContent:'',classList:{toggle(){}}});return elements.get(id)}
 for(const id of ['provider','url','ref','path','copy','open','original','output','details','status','cdn-settings','provider-hint','generate','clear','cancel'])element(id)
 element('provider').value='ghfast';element('url').value='https://github.com/owner/repo/releases/download/v1/app.zip'
 const before=globalThis.document;globalThis.document={getElementById:element,querySelectorAll:()=>[...elements.values()]};const calls=[]
 try{const cleanup=mount({signal:new AbortController().signal,copyText:async()=>{},openWebsite:async(url,options)=>calls.push({url,options})});element('generate').onclick();element('open').onclick();await new Promise(resolve=>setImmediate(resolve));element('original').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert.equal(calls[0].url,'https://ghfast.top/https://github.com/owner/repo/releases/download/v1/app.zip');assert.equal(calls[1].url,element('url').value);assert.ok(calls.every(call=>call.options.external===true));cleanup()}finally{globalThis.document=before}
})
test('the sandbox forwards external mode, defaults to an internal window and rejects invalid options',async()=>{
 const source=readFileSync('public/web-tool-runner.js','utf8'),node=parse(source,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='openWebsite'),messages=[]
 const scope={disposed:false,runtime:{signal:{aborted:false}},navigator:{userActivation:{isActive:true}},pendingWebsites:new Map(),saveSequence:0,runId:'test',send:message=>messages.push(message),DOMException}
 runInNewContext(source.slice(node.start,node.end),scope)
 scope.openWebsite('https://github.com/owner/repo',{external:true});assert.equal(messages[0].external,true);scope.pendingWebsites.clear()
 scope.openWebsite('https://github.com/owner/repo');assert.equal(messages[1].external,false);scope.pendingWebsites.clear()
 await assert.rejects(scope.openWebsite('https://github.com/owner/repo',{external:'true'}),/无效/)
 scope.navigator.userActivation.isActive=false;await assert.rejects(scope.openWebsite('https://github.com/owner/repo',{external:true}),/点击/)
})
