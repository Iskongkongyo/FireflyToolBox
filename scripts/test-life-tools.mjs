import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomIndex,wheelTarget,remainingSeconds,nextPhase,scoreChange,safeLink} from '../src-tauri/builtin-tools/src/life.js'
import {parseTrending} from '../src-tauri/builtin-tools/src/trending-data.js'
import {bingURL,bingArchiveURL,bingImages} from '../src-tauri/builtin-tools/src/bing.js'
test('wheel randomness rejects modulo bias and the pointer lands on the winning segment',()=>{
 const draws=[4294967295,4];assert.equal(randomIndex(3,()=>draws.shift()),1)
 for(let count=2;count<=24;count++)for(let winner=0;winner<count;winner++){const rotation=wheelTarget(1234,winner,count),pointer=((360-rotation%360)%360);assert.equal(Math.floor(pointer/(360/count)),winner);assert.ok(rotation>1234+1800)}
 assert.throws(()=>randomIndex(1));assert.throws(()=>randomIndex(25))
})
test('pomodoro uses a deadline across suspended ticks and resumes from paused seconds',()=>{
 assert.equal(remainingSeconds({running:true,deadline:100500},100000),1);assert.equal(remainingSeconds({running:true,deadline:100000},120000),0);assert.equal(remainingSeconds({running:false,remaining:123},900000),123)
 assert.equal(nextPhase('focus',0,4),'short');assert.equal(nextPhase('focus',3,4),'short');assert.equal(nextPhase('focus',4,4),'long');assert.equal(nextPhase('long',4,4),'focus')
})
test('score snapshots are independent and score bounds protect the layout',()=>{
 const teams=[{name:'A',score:999999},{name:'B',score:0}];const result=scoreChange(teams,0,1);assert.equal(result[0].score,999999);result[1].name='changed';assert.equal(teams[1].name,'B');assert.equal(scoreChange(teams,1,-1000000)[1].score,-999999)
})
test('feed links reject scripts and credentials and Bing downloads stay on its image endpoint',()=>{
 for(const value of ['javascript:alert(1)','http://example.com','https://user:pass@example.com'])assert.equal(safeLink(value),'')
 assert.equal(bingURL({urlbase:'/th?id=OHR.Test'},'UHD'),'https://www.bing.com/th?id=OHR.Test_UHD.jpg');assert.throws(()=>bingURL({urlbase:'https://evil.test/th?id=x'}));assert.throws(()=>bingURL({urlbase:'/evil?id=x'}))
})
test('Bing markets explicitly select country and language, and reject geographic fallback data',()=>{
 for(const [market,country]of [['zh-CN','CN'],['en-US','US'],['ja-JP','JP']]){const url=new URL(bingArchiveURL(market));assert.equal(url.searchParams.get('mkt'),market);assert.equal(url.searchParams.get('setmkt'),market);assert.equal(url.searchParams.get('cc'),country);assert.equal(url.searchParams.get('n'),'8');if(market!=='zh-CN')assert.equal(url.origin,'https://www.bing.com');const payload={images:[{urlbase:'/th?id=OHR.Same_'+market.toUpperCase()+'123'}]};assert.equal(bingImages(payload,market).length,1);if(market!=='zh-CN')assert.throws(()=>bingImages({images:[{urlbase:'/th?id=OHR.Same_ZH-CN123'}]},market),/地区/)}
 assert.throws(()=>bingArchiveURL('invalid'));assert.throws(()=>bingImages({images:[]},'zh-CN'));assert.throws(()=>bingImages({images:[{urlbase:'https://evil.test/th?id=x'}]},'zh-CN'))
})
test('all seven platform shapes normalize their actual fields and keep full Zhihu IDs from URLs',()=>{
 const fixtures={baidu:{data:{cards:[{content:[{content:[{word:'百度',hotScore:'10',url:'https://www.baidu.com/s?q=x'}]}]}]}},weibo:{data:{realtime:[{word:'微博',num:20},{word:'广告',is_ad:1}]}},douyin:{word_list:[{word:'抖音',hot_value:30}]},toutiao:{data:[{Title:'头条',HotValue:'40',ClusterIdStr:'123456789123456789'}]},zhihu:{data:[{target:{title:'知乎',id:123,url:'https://api.zhihu.com/questions/2090445207380743793'},detail_text:'50 万热度'}]},bilibili:{data:{list:[{title:'B站',bvid:'BV123',stat:{view:60}}]}},tieba:{data:{bang_topic:{topic_list:[{topic_name:'贴吧',discuss_num:70,topic_url:'https://tieba.baidu.com/t/x'}]}}}}
 for(const[id,fixture]of Object.entries(fixtures)){const rows=parseTrending(id,fixture);assert.equal(rows.length,1);assert.ok(rows[0].url.startsWith('https:'));assert.equal(rows[0].rank,1)}assert.ok(parseTrending('zhihu',fixtures.zhihu)[0].url.endsWith('2090445207380743793'));assert.throws(()=>parseTrending('weibo',{ok:0}));assert.throws(()=>parseTrending('baidu',{success:false}))
})
