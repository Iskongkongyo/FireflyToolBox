import {test} from 'node:test'
import assert from 'node:assert/strict'
import {countText} from '../src-tauri/builtin-tools/src/text-count-data.js'
import {cropRect} from '../src-tauri/builtin-tools/src/ocr-plan.js'
import {parseBoxOffice} from '../src-tauri/builtin-tools/src/boxoffice-data.js'
import {publicPrompts,publicSkills} from '../src-tauri/builtin-tools/src/ai-data.js'
test('Unicode counting keeps categories disjoint and distinguishes spaces, whitespace and newline events',()=>{
 const text='中文 Ab12! 😀\t\r\n\u3000',data=countText(text)
 assert.equal(data.total,[...text].length);assert.equal(data.counts.han,2);assert.equal(data.counts.latin,2);assert.equal(data.counts.digits,2);assert.equal(data.counts.spaces,2);assert.equal(data.counts.otherSpaces,1);assert.equal(data.counts.tabs,1);assert.equal(data.counts.newlines,2);assert.equal(data.breaks,1);assert.equal(data.lines,2);assert.equal(data.withoutSpaces,data.total-3);assert.equal(data.withoutWhitespace,data.total-6);assert.equal(Object.values(data.counts).reduce((n,v)=>n+v,0),data.total)
})
test('empty input, grapheme clusters, mixed scripts and a trailing newline have explicit counts',()=>{
 assert.equal(countText('').lines,0);const combined=countText('e\u0301👩‍💻');assert.equal(combined.visible,2);assert.ok(combined.total>combined.visible);assert.equal(countText('a\n').lines,2);assert.equal(countText('a\n').nonemptyLines,1);assert.equal(countText('Ωあ９').counts.otherLetters,2);assert.equal(countText('Ωあ９').counts.digits,1)
})
test('OCR crop bounds use image coordinates and reject out-of-range regions',()=>{
 assert.deepEqual(cropRect(10,20,100,80,300,200),{left:10,top:20,width:100,height:80});for(const args of [[-1,0,3,3],[0,0,0,2],[290,0,20,10],[0,199,10,2]])assert.throws(()=>cropRect(...args,300,200))
})
test('box office retains upstream timestamps and does not reinterpret failures as current data',()=>{
 const data=parseBoxOffice({code:200,data:{movie:{box_office:10,box_office_unit:'万',updated:'2026-10-09 10:00',updated_at:123,list:[{movie_name:'测试电影',box_office_desc:'3万',sum_box_desc:'1亿'}]}}});assert.equal(data.rows[0].box,'3万');assert.equal(data.sourceTime,'2026-10-09 10:00');assert.equal(data.time,123);for(const payload of [{code:500,data:null},{code:200,data:{movie:{list:[]}}}])assert.throws(()=>parseBoxOffice(payload))
})
test('public AI responses use verified source URLs, bounded content and text-only metadata',()=>{
 assert.equal(publicPrompts({prompts:[{id:'abc',title:'Writer',content:'Prompt'}]})[0].url,'https://prompts.chat/prompts/abc');assert.equal(publicSkills({skills:[{id:'owner/repo/name',name:'name',source:'owner/repo'}]})[0].url,'https://skills.sh/owner/repo/name');assert.equal(publicSkills([{name:'unsafe',html_url:'javascript:alert(1)'}]).length,0);assert.throws(()=>publicPrompts({}));assert.throws(()=>publicSkills({skills:[]}))
})
