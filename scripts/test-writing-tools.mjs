import test from 'node:test'
import assert from 'node:assert/strict'
import {fuelData,goldData,spotGold,quoteDateState} from '../src-tauri/builtin-tools/src/price-data.js'
import {WORLD_CITIES,zoneOffset,cityTime,filterWorldCities,offsetText} from '../src-tauri/builtin-tools/src/worldtime-data.js'
import {INVISIBLE_TYPES,RANDOM_INVISIBLE_TYPES,magicText,visibleMagic} from '../src-tauri/builtin-tools/src/magic-data.js'
import {cnyRates,filterCnyRates,rateFigures,dailyRatesText} from '../src-tauri/builtin-tools/src/daily-rates-data.js'
import {PALETTES,contrastColor,filterPalettes,paletteCSS,paletteSVG} from '../src-tauri/builtin-tools/src/palettes-data.js'
import {markdownEdit,markdownHistory,readMarkdown,encodeMarkdown,markdownFilename,MARKDOWN_ACTIONS} from '../src-tauri/builtin-tools/src/markdown-edit.js'
import {renderMarkdown} from '../src-tauri/builtin-tools/src/markdown-render.js'
test('fuel rejects a wrong province, missing prices and false freshness labels',()=>{
 const value={code:200,data:{region:'上海',updated:'2026/10/08 15:30:00',items:[{name:'92#汽油',price:'8.56'},{name:'未知',price:null}],trend:{next_adjustment_date:'10月15日24时',direction:'下调'}}}
 const data=fuelData(value,'上海');assert.equal(data.items.length,1);assert.equal(data.items[0].price,8.56);assert.equal(data.date,'2026-10-08');assert.throws(()=>fuelData(value,'北京'),/所选地区/)
 assert.throws(()=>fuelData({code:200,data:{region:'上海',items:[]}},'上海'))
 assert.equal(quoteDateState('2026-10-08','2026-10-08'),'今日数据');assert(quoteDateState('2026-10-07','2026-10-08').includes('并非今日'));assert.equal(quoteDateState('','2026-10-08'),'来源未提供日期')
})
test('gold groups distinguish retail, bars, recycling and currency/weight units',()=>{
 const result=goldData({date:'2026-10-08',metals:[{name:'黄金_9999',today_price:'891.7',unit:'元/克'}],stores:[{brand:'周大福',product:'黄金',price:'1249',unit:'元/克'},{brand:'伦敦金',product:'4000',price:'4000',unit:'元/克'}],banks:[{bank:'工商银行',product:'如意金条',price:'911',unit:'元/克'}],recycle:[{type:'黄金回收',price:'876',unit:'元/克'},{type:'999白银回收',price:'10',unit:'元/克'}]})
 assert.equal(result.rows.length,4);assert.deepEqual(result.rows.map(r=>r.category),['国内参考','品牌零售','投资金条','黄金回收'])
 assert.equal(spotGold({symbol:'XAU',currency:'USD',price:4000,updatedAt:'2026-10-08T07:00:00Z'}).unit,'美元 / 金衡盎司');assert.throws(()=>spotGold({symbol:'XAU',currency:'CNY',price:4000,updatedAt:'2026-10-08'}));assert.throws(()=>goldData({metals:[]}))
})
test('world clocks follow US DST and fractional offsets with civil date differences',()=>{
 assert.equal(zoneOffset(new Date('2026-03-08T06:59:00Z'),'America/New_York'),-300);assert.equal(zoneOffset(new Date('2026-03-08T07:01:00Z'),'America/New_York'),-240)
 assert.equal(zoneOffset(new Date('2026-11-01T05:59:00Z'),'America/New_York'),-240);assert.equal(zoneOffset(new Date('2026-11-01T06:01:00Z'),'America/New_York'),-300)
 assert.equal(zoneOffset(new Date('2026-10-08T00:00:00Z'),'Asia/Kathmandu'),345);assert.equal(offsetText(345),'UTC+05:45')
 const ny=cityTime(new Date('2026-10-08T00:00:00Z'),'America/New_York','Asia/Shanghai');assert.equal(ny.date,'2026-10-07');assert.equal(ny.dayDelta,-1);assert.equal(ny.difference,-720)
 assert.equal(cityTime(new Date('2026-10-08T00:00:00Z'),'Asia/Shanghai').time,'08:00:00');assert(filterWorldCities('纽约')[0].zone==='America/New_York');assert.equal(filterWorldCities('Tokyo','亚洲')[0].name,'东京')
 for(const c of WORLD_CITIES)assert.doesNotThrow(()=>cityTime(new Date(),c.zone));assert.equal(new Set(WORLD_CITIES.map(c=>c.id)).size,WORLD_CITIES.length)
})
test('magic preserves emoji graphemes, inserts at configured intervals and clears only selected characters',()=>{
 const family='👨‍👩‍👧‍👦',value=magicText(family+'a😀',{interval:1});assert.equal(value.text,family+'\u200ba\u200b😀');assert.equal(value.count,2)
 assert.equal(magicText('abcd',{interval:2,repeat:2,end:true}).text,'ab\u200b\u200bcd\u200b\u200b')
 assert.equal(magicText('a\u200bb\u2060c',{action:'remove',type:'zwsp'}).text,'ab\u2060c');assert(visibleMagic(value.text,'zwsp').includes('⟦U+200B⟧'))
 for(const item of INVISIBLE_TYPES)assert.equal(magicText('ab',{type:item.id}).text,'a'+item.char+'b')
 assert.throws(()=>magicText('abc',{interval:0}));assert.throws(()=>magicText('a'.repeat(65537)));assert.throws(()=>magicText('a'.repeat(20000),{repeat:8}),/256/)
})
test('all 64 palettes have five valid colors, useful text contrast and portable SVG/CSS output',()=>{
 assert.equal(PALETTES.length,64);assert.equal(new Set(PALETTES.map(p=>p.name)).size,64)
 function luminance(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)}
 for(const p of PALETTES){assert.equal(p.colors.length,5);for(const hex of p.colors){assert.match(hex,/^#[A-F0-9]{6}$/);const a=luminance(hex),b=luminance(contrastColor(hex));assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5)}assert(paletteCSS(p).includes('--color-5'));assert(paletteSVG(p).includes('<svg'));assert(!paletteSVG(p).includes('<script'))}
 assert(filterPalettes('蓝色','清新').length>0);assert.equal(filterPalettes('no palette').length,0)
})
test('Markdown formatting handles Unicode selections, line prefixes, code fences and selected text retention',()=>{
 const bold=markdownEdit('你好😀',2,4,'bold');assert.equal(bold.text,'你好**😀**');assert.equal(bold.end-bold.start,2);assert.equal(markdownEdit(bold.text,bold.start,bold.end,'bold').text,'你好😀')
 assert.equal(markdownEdit('甲\n乙\n丙',0,3,'quote').text,'> 甲\n> 乙\n丙');assert.equal(markdownEdit('\n文',0,0,'h1').text,'# \n文')
 const fenced=markdownEdit('```nested```',0,12,'code');assert(fenced.text.startsWith('````text\n'))
 assert(markdownEdit('保留原文',0,4,'table').text.startsWith('保留原文\n\n|'))
 for(const[id]of MARKDOWN_ACTIONS){const result=markdownEdit('文字',0,2,id);assert.equal(typeof result.text,'string');assert(result.start>=0&&result.end<=result.text.length);assert.doesNotThrow(()=>renderMarkdown(result.text))}
})
test('Markdown undo/redo branches correctly and bounds snapshot memory',()=>{
 const initial={text:'',start:0,end:0},history=markdownHistory(initial,400);history.push({text:'first',start:5,end:5});history.push({text:'second',start:6,end:6});assert.equal(history.undo().text,'first');assert.equal(history.redo().text,'second');history.undo();history.push({text:'new',start:3,end:3});assert.equal(history.canRedo,false)
 for(let i=0;i<100;i++)history.push({text:String(i).repeat(30),start:0,end:0});let count=0;while(history.canUndo){history.undo();count++}assert(count<10)
})
test('Markdown reads BOM and legacy Chinese, writes explicit encodings/EOL and preserves emoji',async()=>{
 const source='流萤😀\n第二行';for(const encoding of ['utf8','utf8bom','utf16le','utf16be']){const bytes=encodeMarkdown(source,encoding,'crlf'),value=await readMarkdown(new Blob([bytes]));assert.equal(value.text,'流萤😀\r\n第二行');assert.equal(value.eol,'crlf');assert.equal(value.saveEncoding,encoding)}
 const legacy=await readMarkdown(new Blob([Uint8Array.of(0xd6,0xd0,0xce,0xc4)]));assert.equal(legacy.text,'中文');assert.equal(legacy.encoding,'gb18030')
 assert.equal(markdownFilename('notes.txt'),'notes.md');assert.equal(markdownFilename('README'),'README.md');assert.throws(()=>markdownFilename('../a.md'));assert.throws(()=>encodeMarkdown('a'.repeat(1048577)));await assert.rejects(readMarkdown(new Blob(['a'.repeat(1048577)])))
})
test('Markdown task lists render as inert checkboxes and raw HTML remains escaped',()=>{
 const html=renderMarkdown('- [ ] 待办\n- [x] 完成\n\n<script>alert(1)</script>');assert.equal((html.match(/class="md-task"/g)||[]).length,2);assert(html.includes('disabled checked'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'))
})

test('random invisible insertion respects spacing and only mixes the four announced types',()=>{
 let n=0;const source='👨‍👩‍👧‍👦AB😀',result=magicText(source,{type:'random',interval:1,repeat:2},()=>n++%4)
 assert.equal(result.count,6);assert.equal(result.text,'👨‍👩‍👧‍👦\u200b\u2060A\u2063\ufeffB\u200b\u2060😀')
 assert.equal(RANDOM_INVISIBLE_TYPES.length,4);assert(!RANDOM_INVISIBLE_TYPES.some(v=>['zwnj','zwj'].includes(v.id)))
 const marked=visibleMagic(result.text,'random');for(const item of RANDOM_INVISIBLE_TYPES)assert(marked.includes('⟦'+item.code+'⟧'));assert(marked.includes('👨‍👩‍👧‍👦'))
 assert.throws(()=>magicText('a',{type:'random',action:'remove'}),/仅用于插入/);assert.throws(()=>magicText('ab',{type:'random'},()=>5),/选择无效/)
})

test('daily reference rates enforce the CNY base and preserve individual quote dates',()=>{
 const rows=cnyRates([{base:'CNY',quote:'USD',rate:.15,date:'2026-10-07'},{base:'CNY',quote:'JPY',rate:22,date:'2026-10-08'},{base:'CNY',quote:'USD',rate:.149,date:'2026-10-08'},{base:'CNY',quote:'CNY',rate:1,date:'2026-10-08'},{base:'CNY',quote:'BAD',rate:0,date:'2026-10-08'}])
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.code==='USD').date,'2026-10-08');assert.equal(filterCnyRates(rows,'美元')[0].code,'USD');assert.equal(rateFigures({rate:.125}).inward,'800.00');assert(dailyRatesText(rows).includes('1 元人民币'));assert(dailyRatesText(rows).includes('2026-10-07')===false)
 assert.throws(()=>cnyRates([{base:'USD',quote:'CNY',rate:6.7,date:'2026-10-08'}]),/不是人民币/);assert.throws(()=>cnyRates([]));assert.equal(filterCnyRates(rows,'no-match').length,0)
})
