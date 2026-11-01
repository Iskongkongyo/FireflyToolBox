import assert from 'node:assert/strict'
import {test} from 'node:test'
import {physicalLines,lineSpan,planLineMerge} from '../src-tauri/builtin-tools/src/diff-merge.js'
import {headingEdit,tableMarkdown} from '../src-tauri/builtin-tools/src/markdown-insert.js'

const merge=(target,source,a,b,nextA=null,nextB=null)=>{const p=planLineMerge(target,source,a,b,nextA,nextB);const result=target.slice(0,p.start)+p.insert+target.slice(p.end);assert.equal(result.slice(0,p.start)+p.removed+result.slice(p.start+p.insert.length),target,'Every patch can be undone exactly');return result}
test('physical offsets distinguish LF, CRLF, CR, empty content and a trailing terminator',()=>{
 assert.deepEqual(physicalLines('').map(l=>l.text),[]);assert.deepEqual(physicalLines('a\r\nb\rc\n').map(l=>l.text),['a','b','c']);assert.deepEqual(physicalLines('\n\n').map(l=>l.text),['',''])
 assert.deepEqual(lineSpan('a\r\nb\r\n',[2],null),{start:3,end:6,text:'b\r\n'});assert.throws(()=>lineSpan('a',[2],null));assert.throws(()=>lineSpan('a\nb',[2,1],null))
})
test('a block replacement leaves every other change and context untouched',()=>{assert.equal(merge('head\nold\nmid\nother\nend','head\nnew\nmid\nchanged\nend',[2],[2],3,3),'head\nnew\nmid\nother\nend')})
for(const eol of ['\n','\r\n','\r']){
 test(`EOF insertion and deletion work with ${JSON.stringify(eol)} and absent final newline`,()=>{
  assert.equal(merge('a','a'+eol+'b',[],[2]),'a'+eol+'b')
  assert.equal(merge('a'+eol+'b','a',[2],[]),'a')
  assert.equal(merge('a'+eol+'b'+eol,'a'+eol,[2],[]),'a'+eol)
 })
}
test('insertion/deletion at the beginning and merging into/from empty text are reversible',()=>{
 assert.equal(merge('tail','added\ntail',[],[1],1,2),'added\ntail');assert.equal(merge('added\ntail','tail',[1],[],2,1),'tail');assert.equal(merge('','added',[],[1]),'added');assert.equal(merge('only','',[1],[]),'')
})
test('target line ending style and ignored blank context are retained',()=>{
 assert.equal(merge('A\r\nold\r\nZ','A\nnew\nZ',[2],[2],3,3),'A\r\nnew\r\nZ')
 assert.equal(merge('Keep\n\nold\nTAIL','keep\n\nnew\nextra\nTAIL',[3],[3,4],4,5),'Keep\n\nnew\nextra\nTAIL')
 assert.equal(merge('A\n\nB','A\nX\nB',[],[2],3,3),'A\n\nX\nB')
})
for(const level of [0,1,2,3,4,5,6])test(`heading level ${level} replaces the marker and preserves selected text`,()=>{
 const original='## hello\nnext',edit=headingEdit(original,3,8,level),result=original.slice(0,edit.start)+edit.insert+original.slice(edit.end)
 assert.equal(result,(level?'#'.repeat(level)+' ':'')+'hello\nnext');assert.equal(result.slice(edit.selectionStart,edit.selectionEnd),'hello')
})
test('heading insertion keeps the caret in the same word and does not affect the next selected-line boundary',()=>{
 const e=headingEdit('hello\nnext',2,2,2);assert.equal(e.selectionStart,5);assert.equal(e.selectionEnd,5)
 const selected=headingEdit('one\ntwo',0,4,3);assert.equal(selected.insert,'### one');assert.equal(selected.end,3)
 const empty=headingEdit('\nnext',0,0,1);assert.equal(empty.start,0);assert.equal(empty.insert,'# ')
 assert.equal(headingEdit('a\n\nb',0,4,2).insert,'## a\n\n## b')
})
test('table dimensions count body rows separately from the header',()=>{
 const t=tableMarkdown(3,4).trimEnd().split('\n');assert.equal(t.length,5);assert(t.every(l=>l.split('|').length===6));assert(t[0].includes('列 4'));assert.equal(tableMarkdown(100,20).trimEnd().split('\n').length,102)
})
test('invalid table sizes and heading levels never produce partial edits',()=>{
 for(const n of [0,-1,1.5,NaN,Infinity,101])assert.throws(()=>tableMarkdown(n,3));for(const n of [0,-1,2.5,NaN,Infinity,21])assert.throws(()=>tableMarkdown(2,n));assert.throws(()=>headingEdit('text',0,0,7));assert.throws(()=>headingEdit('text',3,1,1))
})
