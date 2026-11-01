import{test}from'node:test'
import assert from'node:assert/strict'
import{convertUnit}from'../src-tauri/builtin-tools/src/units-data.js'
import{calculate}from'../src-tauri/builtin-tools/src/math-engine.js'
import{parseDelimited,csvToJson,jsonToCsv,replaceRules}from'../src-tauri/builtin-tools/src/data-convert-engine.js'
import{createArchive,inspectArchive,extractArchive,archivePath}from'../src-tauri/builtin-tools/src/zip-engine.js'
test('units use exact reference constants, affine temperature and distinguish binary capacity',()=>{
 assert.equal(convertUnit('length','inch','cm',1),2.54);assert.equal(convertUnit('data','KiB','B',1),1024);assert.equal(convertUnit('data','KB','B',1),1000);assert.equal(convertUnit('temperature','C','F',0),32);assert.equal(convertUnit('temperature','F','C',32),0);assert.ok(Math.abs(convertUnit('temperature','C','K',0)-273.15)<1e-10);assert.throws(()=>convertUnit('temperature','K','C',-1));assert.throws(()=>convertUnit('data','B','KB',-1))
})
test('math parser preserves precedence, exponent associativity, percentage and angle mode',()=>{
 assert.equal(calculate('(2+3)*4'),20);assert.equal(calculate('2^3^2'),512);assert.equal(calculate('-2^2'),-4);assert.equal(calculate('2^-2'),.25);assert.equal(calculate('200*10%'),20);assert.ok(Math.abs(calculate('sin(30)')-.5)<1e-12);assert.ok(Math.abs(calculate('sin(pi/2)',{degrees:false})-1)<1e-12);assert.equal(calculate('ans+3',{ans:4}),7);for(const expr of ['1/0','sqrt(-1)','alert(1)','1;2','2pi','pow(2)','(1+2'])assert.throws(()=>calculate(expr))
})
test('CSV quotes, embedded newline, BOM and long number strings round trip without numeric coercion',()=>{
 const csv='\uFEFFid,name,note\r\n001,"小明, A","line1\nline2"\r\n9007199254740993,"a""b",';const data=csvToJson(csv);assert.equal(data[0].id,'001');assert.equal(data[0].note,'line1\nline2');assert.equal(data[1].id,'9007199254740993');assert.deepEqual(csvToJson(jsonToCsv(data)),data);assert.deepEqual(parseDelimited('a\tb\n1\t2','\t'),[['a','b'],['1','2']]);assert.throws(()=>csvToJson('a,a\n1,2'));assert.throws(()=>parseDelimited('"bad'));assert.deepEqual(csvToJson('a,b\n1,2',{header:false}),[['a','b'],['1','2']])
})
test('CSV exporting selected fields preserves nested JSON and safely represents special object keys',()=>{
 const rows=csvToJson('__proto__,name\nx,test');assert.equal(Object.getPrototypeOf(rows[0]),Object.prototype);assert.equal(rows[0].__proto__,'x');const result=jsonToCsv([{a:1,b:{x:2},c:3}],{fields:'b,a'});assert.deepEqual(csvToJson(result),[{b:'{"x":2}',a:'1'}])
})
test('replacement rules are sequential and ordinary replacements keep dollar symbols literal',()=>{
 const result=replaceRules('a  a',[{find:'a',replace:'b',regex:false},{find:' +',replace:'_',regex:true,flags:'g'}]);assert.equal(result.text,'b_b');assert.deepEqual(result.counts,[2,1]);assert.equal(replaceRules('ab12',[{find:'([a-z]+)(\\d+)',replace:'$2-$1',regex:true,flags:''}]).text,'12-ab');assert.equal(replaceRules('a',[{find:'a',replace:'$&',regex:false}]).text,'$&');assert.throws(()=>replaceRules('a',[{find:'(',replace:'x',regex:true}]))
})
test('ZIP creation, listing and selected extraction preserve file names and bytes',()=>{
 const source=new TextEncoder().encode('hello 中文'),zip=createArchive([{name:'folder/a.txt',bytes:source},{name:'empty.txt',bytes:new Uint8Array()}],6),rows=inspectArchive(zip);assert.equal(rows.length,2);assert.deepEqual(extractArchive(zip,'folder/a.txt'),source);assert.equal(extractArchive(zip,'empty.txt').length,0);assert.throws(()=>createArchive([{name:'same',bytes:source},{name:'same',bytes:source}]))
})
test('ZIP directory traversal, encrypted flags and damaged directories fail before extraction',()=>{
 for(const name of ['../x','a/../x','/tmp/x','C:/x','a\\x'])assert.throws(()=>archivePath(name));const zip=createArchive([{name:'a',bytes:new Uint8Array([1])}]),view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);let central=-1;for(let i=0;i<zip.length-4;i++)if(view.getUint32(i,true)===0x02014b50){central=i;break}assert.ok(central>=0);view.setUint16(central+8,1,true);assert.throws(()=>inspectArchive(zip));assert.throws(()=>inspectArchive(new Uint8Array([1,2,3])))
})
