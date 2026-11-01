import test from 'node:test'
import assert from 'node:assert/strict'
import {rc4Bytes,rc4Convert,decodeBytes,encodeBytes} from '../src-tauri/builtin-tools/src/rc4-data.js'
import {colorInfo,canvasPoint,pngICO,imageFit} from '../src-tauri/builtin-tools/src/graphics-data.js'
import {drawingProject,boardSize,drawCommand} from '../src-tauri/builtin-tools/src/drawing-data.js'
import {defaultMind,validateMind,addMind,removeMind,allMind,findMind,mindSVG} from '../src-tauri/builtin-tools/src/mindmap-data.js'
import {convertAmount,exchangeRate,currencyList,exchangeURL} from '../src-tauri/builtin-tools/src/exchange-data.js'
test('RC4 matches RFC 6229 keystream vectors and known interoperable ciphertext',()=>{
 const key=decodeBytes('0102030405','hex');assert.equal(encodeBytes(rc4Bytes(new Uint8Array(16),key),'hex'),'B2396305F03DC027CCC3524A0A1118A8')
 assert.equal(encodeBytes(rc4Bytes(new Uint8Array(16),key,768),'hex'),'EB62638D4F0BA1FE9FCA20E05BF8FF2B')
 assert.equal(rc4Convert({source:'Plaintext',key:'Key'}).text,'BBF316E8D940AF0AD3')
 assert.equal(rc4Convert({source:'BBF316E8D940AF0AD3',key:'Key',inputFormat:'hex',outputFormat:'utf8'}).text,'Plaintext')
})
test('RC4 preserves Unicode and BOM characters across Base64 and validates keys and binary encodings',()=>{
 const source='\uFEFF流萤😀\n中文',encrypted=rc4Convert({source,key:'喵',outputFormat:'base64',drop:3072})
 assert.equal(rc4Convert({source:encrypted.text,key:'喵',inputFormat:'base64',outputFormat:'utf8',drop:3072}).text,source)
 assert.throws(()=>rc4Convert({source:'x',key:''}),/密钥/);assert.throws(()=>decodeBytes('abc','hex'));assert.throws(()=>decodeBytes('a===','base64'));assert.throws(()=>rc4Bytes(new Uint8Array(262145),Uint8Array.of(1)));assert.throws(()=>rc4Bytes(Uint8Array.of(1),Uint8Array.of(1),-1))
})
test('pixel colors expose accurate HEX, RGB, HSL and independent alpha information',()=>{
 assert.equal(colorInfo(255,0,0).hsl,'hsl(0, 100%, 50%)');assert.equal(colorInfo(0,255,0).hsl,'hsl(120, 100%, 50%)');assert.equal(colorInfo(0,0,255).hsl,'hsl(240, 100%, 50%)');assert.equal(colorInfo(128,128,128).hsl,'hsl(0, 0%, 50.2%)')
 const half=colorInfo(255,0,0,128);assert.equal(half.hex,'#FF0000');assert.equal(half.hex8,'#FF000080');assert.equal(half.alpha,50);assert.equal(half.rgb,'rgb(255, 0, 0)')
 assert.throws(()=>colorInfo(-1,0,0));assert.deepEqual(canvasPoint({left:10,top:20,width:200,height:100},110,70,1000,500),{x:500,y:250});assert.deepEqual(canvasPoint({left:0,top:0,width:100,height:100},200,-10,100,100),{x:99,y:0})
})
test('icon image fitting and PNG-in-ICO headers retain size and payload offsets',()=>{
 assert.deepEqual(imageFit(200,100,100),{x:0,y:25,width:100,height:50})
 const png=Uint8Array.of(137,80,78,71,13,10,26,10),ico=pngICO(png),view=new DataView(ico.buffer);assert.equal(view.getUint16(2,true),1);assert.equal(view.getUint16(4,true),1);assert.equal(ico[6],0);assert.equal(ico[7],0);assert.equal(view.getUint32(14,true),8);assert.equal(view.getUint32(18,true),22);assert.deepEqual([...ico.slice(22)],[...png]);assert.throws(()=>pngICO(png,512,512))
})
test('drawing projects reject invalid sizes, coordinates, arbitrary images and oversized command logs',()=>{
 const project={schema:'firefly-drawing',version:1,width:800,height:600,background:'#ffffff',transparent:false,image:null,commands:[{tool:'pen',width:8,opacity:1,color:'#276653',fill:false,text:'',fontSize:36,points:[[0,0],[10,10]]}]};assert.equal(drawingProject(project).commands.length,1)
 assert.throws(()=>boardSize(4096,4096));assert.throws(()=>drawingProject({...project,image:'data:image/svg+xml,<svg></svg>'}));assert.throws(()=>drawingProject({...project,commands:[{...project.commands[0],points:[[800,0]]}]}));assert.throws(()=>drawingProject({...project,commands:Array(201).fill(project.commands[0])}));assert.throws(()=>drawingProject({...project,commands:[{...project.commands[0],tool:'script'}]}))
})
test('eraser compositing is scoped to each command and does not alter later drawing settings',()=>{
 const calls=[],ctx={save(){calls.push('save')},restore(){calls.push('restore')},beginPath(){},arc(){},fill(){calls.push(this.globalCompositeOperation)},stroke(){calls.push(this.globalCompositeOperation)},moveTo(){},lineTo(){}}
 drawCommand(ctx,{tool:'eraser',points:[[1,1]],color:'#000000',width:10,opacity:1});drawCommand(ctx,{tool:'pen',points:[[2,2],[4,4]],color:'#FF0000',width:8,opacity:1});assert.deepEqual(calls,['save','destination-out','restore','save','source-over','restore'])
})
test('mindmap edits are immutable, preserve hidden descendants and enforce root and depth rules',()=>{
 const initial=defaultMind(),root=initial.root.id,added=addMind(initial,root);assert.equal(initial.root.children.length,3);assert.equal(added.document.root.children.length,4);assert(findMind(added.document.root,added.selected));assert.equal(removeMind(added.document,added.selected).document.root.children.length,3);assert.throws(()=>removeMind(initial,root));assert.throws(()=>addMind(initial,root,true))
 let document=initial,id=root;for(let i=1;i<8;i++){const next=addMind(document,id);document=next.document;id=next.selected}assert.throws(()=>addMind(document,id),/上限/)
 const duplicate=defaultMind();duplicate.root.children[0].id=duplicate.root.id;assert.throws(()=>validateMind(duplicate));initial.root.collapsed=true;assert.equal(allMind(validateMind(initial).root).length,4)
})
test('mindmap SVG escapes user titles and retains editable labels and connection geometry',()=>{
 const svg=mindSVG({width:400,height:200,links:[{x1:100,y1:50,x2:250,y2:100}],nodes:[{id:'a',title:'<script>&测试',color:'#276653',foreground:'#FFFFFF',root:true,x:10,y:10,width:200,height:100}]});assert(svg.includes('&lt;script&gt;'));assert(!svg.includes('<script>'));assert(svg.includes('viewBox="0 0 400 200"'));assert(svg.includes('<path'));assert(svg.includes('<text'))
})
test('currency conversion rounds decimal arithmetic without binary floating point errors',()=>{
 assert.equal(convertAmount('0.1',.2),'0.02');assert.equal(convertAmount('1.005',1),'1.01');assert.equal(convertAmount('100.50',6.7046,4),'673.8123');assert.equal(convertAmount('10',1e-7,8),'0.00000100');assert.equal(convertAmount('0',999,2),'0.00');assert.throws(()=>convertAmount('-1',1));assert.throws(()=>convertAmount('NaN',1))
})
test('exchange validates currency pair and date and exposes supported currency names',()=>{
 assert.equal(exchangeRate({base:'USD',quote:'CNY',rate:6.7,date:'2026-10-07'},'USD','CNY').rate,6.7);assert.throws(()=>exchangeRate({base:'EUR',quote:'CNY',rate:7,date:'2026-10-07'},'USD','CNY'));assert.throws(()=>exchangeRate({base:'USD',quote:'CNY',rate:0,date:'2026-10-07'},'USD','CNY'));assert.equal(currencyList([{iso_code:'CNY',name:'Yuan'},{iso_code:'BAD!',name:'bad'}])[0].name,'人民币');assert(exchangeURL('USD','CNY').endsWith('/USD/CNY'));assert.throws(()=>exchangeURL('../a','CNY'))
})
