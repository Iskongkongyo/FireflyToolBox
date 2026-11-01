import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomNumbers,randomStrings,randomBelow} from '../src-tauri/builtin-tools/src/random-data.js'
import {reactionStats,recordReaction,reactionAverage} from '../src-tauri/builtin-tools/src/reaction-data.js'
import {webAddress,providerURL,shortResult,poemRequest,poemResult,baiduWords} from '../src-tauri/builtin-tools/src/quick-network-data.js'
import {SHORT_PROVIDERS,shortRequest,providerResult,spooRequest,suoRequest} from '../src-tauri/builtin-tools/src/shortlink-data.js'
import {GITHUB_PROVIDERS,githubDownload,githubAddress} from '../src-tauri/builtin-tools/src/github-download-data.js'
test('random integers cover inclusive negative ranges, safe limits and sampling without duplicates',()=>{
 const output=randomNumbers({count:11,min:-5,max:5,repeat:false});assert.equal(new Set(output).size,11);assert.deepEqual(output.map(Number).sort((a,b)=>a-b),Array.from({length:11},(_,i)=>i-5))
 assert.deepEqual(randomNumbers({count:3,min:7,max:7,repeat:true}),['7','7','7']);assert.throws(()=>randomNumbers({count:2,min:7,max:7,repeat:false}))
 const large=randomNumbers({count:50,min:-Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER,repeat:false});assert.equal(new Set(large).size,50);assert.ok(large.every(v=>BigInt(v)>=-9007199254740991n&&BigInt(v)<=9007199254740991n))
 let draws=0;assert.equal(randomBelow(3n,()=>++draws===1?(1n<<64n)-1n:4n),1n);assert.equal(draws,2);assert.throws(()=>randomBelow(1n<<65n))
})
test('random strings respect custom digit ranges, codepoint lengths and enabled categories',()=>{
 const options={count:50,length:12,digits:true,digitMin:2,digitMax:4,lower:true,upper:true,symbols:true,symbolChars:'@#',custom:true,customChars:'流萤',ensure:true}
 for(const s of randomStrings(options)){assert.equal([...s].length,12);assert.match(s,/[2-4]/);assert.match(s,/[a-z]/);assert.match(s,/[A-Z]/);assert.match(s,/[@#]/);assert.match(s,/[流萤]/);assert.doesNotMatch(s,/[015-9]/)}
 const emoji=randomStrings({count:3,length:5,custom:true,customChars:'😀'});assert.ok(emoji.every(s=>[...s].length===5))
 assert.throws(()=>randomStrings({...options,length:3}));assert.throws(()=>randomStrings({count:1,length:2}));assert.throws(()=>randomStrings({count:1,length:2,digits:true,digitMin:0,digitMax:1,exclude:true}));assert.throws(()=>randomStrings({count:1,length:2,custom:true,customChars:''}))
})
test('reaction records keep the best lifetime time and the most recent five average',()=>{
 let stats=reactionStats({});for(const v of [100,200,300,400,500,600])stats=recordReaction(stats,v)
 assert.equal(stats.best,100);assert.deepEqual(stats.recent,[200,300,400,500,600]);assert.equal(reactionAverage(stats),400)
 assert.deepEqual(reactionStats({recent:[null,-1,Infinity,80],best:NaN}).recent,[80]);assert.throws(()=>recordReaction(stats,-1));assert.throws(()=>recordReaction(stats,10001))
})
test('short link encoding preserves query delimiters and reports provider rate limits',()=>{
 const value='https://example.com/?a=1&b=中文#section';assert.equal(new URL(providerURL('is.gd','create',value)).searchParams.get('url'),value)
 assert.equal(shortResult({shorturl:'https://is.gd/test'},true),'https://is.gd/test');assert.throws(()=>shortResult({errorcode:3,errormessage:'limit'},true),e=>e.limited)
 for(const v of ['javascript:alert(1)','https://u:p@example.com/','file:///a'])assert.throws(()=>webAddress(v));assert.throws(()=>webAddress('http://example.com',true))
})
test('poems validate each head character, length and individual rhyme flags',()=>{
 const query=poemRequest('流萤',7,true);assert.equal(new URL(query.url).searchParams.get('nr'),'流萤');assert.throws(()=>poemRequest('word',7,true))
 const response={ok:true,lines:[{text:'流光照水映新晴',rhyme:true},{text:'萤火随风入画屏',rhyme:false}]};assert.equal(poemResult(response,'流萤',7).rhymed,false)
 assert.throws(()=>poemResult(response,'萤流',7));assert.throws(()=>poemResult(response,'流萤',5))
})
test('Baidu anonymous word results remain word references and handle empty or restricted responses',()=>{
 assert.deepEqual(baiduWords({errno:0,data:[{k:'hello',v:'你好'}]}),[{word:'hello',meaning:'你好'}]);assert.throws(()=>baiduWords({errno:1022}));assert.throws(()=>baiduWords({errno:0,data:[]}))
})

test('new short link providers preserve URL data and constrain anonymous endpoints and output origins',()=>{
 const value='https://saucenao.com/?a=1&word=流萤#section',normalized=new URL(value).href
 assert.equal(SHORT_PROVIDERS.length,5)
 assert.deepEqual(SHORT_PROVIDERS.slice(-2),['is.gd','v.gd'])
 const spoo=shortRequest('spoo.me',value);assert.equal(spoo.method,'POST');assert.deepEqual(JSON.parse(spoo.body),{long_url:normalized})
 const ulvis=shortRequest('ulvis.net',value);assert.equal(new URL(ulvis.url).searchParams.get('url'),normalized);assert.equal(new URL(ulvis.url).searchParams.get('private'),'1')
 const lookup=shortRequest('ulvis.net','https://ulvis.net/abc123',false);assert.equal(new URL(lookup.url).searchParams.get('id'),'abc123')
 assert.equal(providerResult('spoo.me',{short_url:'https://spoo.me/abc',claim_token:'discard'},true,201),'https://spoo.me/abc')
 assert.equal(providerResult('ulvis.net',{success:true,data:{url:'https://ulvis.net/abc',full:value}},false),normalized)
 assert.throws(()=>providerResult('spoo.me',{short_url:'https://other.test/abc'}),/非预期/)
 assert.throws(()=>providerResult('ulvis.net',{success:false,error:{msg:'domain not allowed'}}),/不接受/)
 assert.throws(()=>providerResult('spoo.me',{},true,429),e=>e.limited)
 assert.throws(()=>shortRequest('ulvis.net','https://ulvis.net/a/b',false));assert.throws(()=>shortRequest('spoo.me','javascript:alert(1)'))
})

test('Spoo POST omits credentials and detects oversized or malformed responses',async()=>{
 const body=shortRequest('spoo.me','https://example.com/').body
 const response=await spooRequest(body,new AbortController().signal,async(url,options)=>{assert.equal(url,'https://spoo.me/api/v1/shorten');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Content-Type']);assert.equal(options.body,body);return new Response('{"short_url":"https://spoo.me/abc"}',{status:201})})
 assert.equal(response.status,201)
 await assert.rejects(spooRequest(body,null,async()=>new Response('x'.repeat(256*1024+1))),/响应过大/)
 await assert.rejects(spooRequest(body,null,async()=>new Response('<html>error</html>',{status:403})),/HTTP 403/)
 const limited=await spooRequest(body,null,async()=>new Response('limit',{status:429}));assert.equal(limited.status,429)
})

test('Spoo cancellation and timeout abort the actual fetch operation',async()=>{
 const pending=(_url,{signal})=>new Promise((_resolve,reject)=>{if(signal.aborted)reject(new DOMException('aborted','AbortError'));else signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})})
 const controller=new AbortController(),job=spooRequest('{}',controller.signal,pending);controller.abort();await assert.rejects(job,e=>e.name==='AbortError')
 await assert.rejects(spooRequest('{}',null,pending,5),/超过 15 秒/)
})
test('GitHub CDN conversion preserves version, Unicode paths and supports manual slash refs',()=>{
 assert.equal(GITHUB_PROVIDERS.length,4)
 const input='https://github.com/owner/repo/blob/main/src/a%20b.js'
 assert.equal(githubDownload('jsdelivr',input).url,'https://cdn.jsdelivr.net/gh/owner/repo@main/src/a%20b.js')
 assert.equal(githubDownload('statically',input).url,'https://cdn.statically.io/gh/owner/repo@main/src/a%20b.js')
 assert.equal(githubDownload('jsdelivr','https://github.com/owner/repo/blob/main/%20file%20').url,'https://cdn.jsdelivr.net/gh/owner/repo@main/%20file%20')
 assert.equal(githubDownload('jsdelivr','https://raw.githubusercontent.com/owner/repo/refs/heads/main/LICENSE').url,'https://cdn.jsdelivr.net/gh/owner/repo@main/LICENSE')
 assert.equal(githubDownload('statically','https://github.com/owner/repo/blob/feature/new/src/file.js',{ref:'feature/new'}).url,'https://cdn.statically.io/gh/owner/repo@feature%2Fnew/src/file.js')
 assert.equal(githubDownload('jsdelivr','https://github.com/owner/repo',{ref:'v1.0',path:'目录/a #%.js'}).url,'https://cdn.jsdelivr.net/gh/owner/repo@v1.0/%E7%9B%AE%E5%BD%95/a%20%23%25.js')
 assert.throws(()=>githubDownload('jsdelivr','https://github.com/owner/repo/tree/main/src'),/文件路径/)
 assert.throws(()=>githubDownload('jsdelivr','https://github.com/owner/repo/releases/download/v1/app.zip'),/Release/)
 for(const value of ['https://github.com.evil.test/a/b','https://user:pass@github.com/a/b','http://github.com/a/b','https://github.com:444/a/b'])assert.throws(()=>githubAddress(value))
 assert.throws(()=>githubDownload('jsdelivr',input,{path:'../private'}))
})
test('GitHub prefix proxies retain complete original URLs without nested URL escaping',()=>{
 const input='https://github.com/owner/repo/releases/download/v1/app.zip?raw=1&test=2#note'
 assert.equal(githubDownload('pd',input).url,'https://pd.zwc365.com/'+input)
 assert.equal(githubDownload('ghfast',input).url,'https://ghfast.top/'+input)
 const archive='https://codeload.github.com/owner/repo/zip/refs/heads/main';assert.equal(githubDownload('ghfast',archive).url,'https://ghfast.top/'+archive)
 assert.throws(()=>githubDownload('statically',archive),/源码 ZIP/)
})
test('Suo forms encode URLs as Base64 and validate optional short codes and result origins',()=>{
 const input='https://example.com/?word=流萤&sign=a+b#片段',spec=shortRequest('suo.yt',input,true,'ff_39'),form=new URLSearchParams(spec.body)
 assert.equal(spec.method,'POST');assert.equal(spec.url,'https://suo.yt/short');assert.equal(Buffer.from(form.get('longUrl'),'base64').toString('utf8'),new URL(input).href);assert.equal(form.get('shortKey'),'ff_39');assert.equal(new URLSearchParams(shortRequest('suo.yt',input).body).get('shortKey'),'')
 assert.equal(providerResult('suo.yt',{Code:1,ShortUrl:'https://suo.yt/ff39'}),'https://suo.yt/ff39')
 assert.throws(()=>providerResult('suo.yt',{Code:1003,Message:'短码已占用'}),/短码已占用/)
 for(const value of ['https://evil.test/a','http://suo.yt/a','https://suo.yt:8443/a'])assert.throws(()=>providerResult('suo.yt',{Code:1,ShortUrl:value}))
 assert.throws(()=>providerResult('suo.yt',{Code:1}),/未返回有效/);assert.throws(()=>shortRequest('suo.yt',input,true,'x/y'));assert.throws(()=>shortRequest('suo.yt',input,false),/跳转还原/)
})
test('Suo POST uses a form without cookies, and handles response limits and cancellation',async()=>{
 const body=shortRequest('suo.yt','https://example.com/').body
 const response=await suoRequest(body,null,async(url,options)=>{assert.equal(url,'https://suo.yt/short');assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded;charset=UTF-8');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.body,body);return new Response('{"Code":1,"ShortUrl":"https://suo.yt/test"}')});assert.equal(response.data.Code,1)
 await assert.rejects(suoRequest(body,null,async()=>new Response('x'.repeat(256*1024+1))),/响应过大/)
 await assert.rejects(suoRequest(body,null,async()=>new Response('<html>bad</html>',{status:500})),/HTTP 500/)
 const pending=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})),controller=new AbortController(),job=suoRequest(body,controller.signal,pending);controller.abort();await assert.rejects(job,e=>e.name==='AbortError')
 await assert.rejects(suoRequest(body,null,pending,5),/超过 15 秒/)
})
