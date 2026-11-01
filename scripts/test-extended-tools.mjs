import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {morseEncode,morseDecode} from '../src-tauri/builtin-tools/src/morse-data.js'
import {hiddenImage} from '../src-tauri/builtin-tools/src/hiddenimage-data.js'
import {kinship} from '../src-tauri/builtin-tools/src/kinship-data.js'
import {meowEncode,meowDecode} from '../src-tauri/builtin-tools/src/meow-data.js'

test('Morse preserves words, punctuation and line boundaries and rejects unsupported symbols',()=>{
 assert.equal(morseEncode('SOS'),'... --- ...');assert.equal(morseDecode('··· ——— ···'),'SOS')
 assert.equal(morseDecode(morseEncode('Hello, world!'.replace('!','?'))),'HELLO, WORLD?')
 assert.equal(morseDecode(morseEncode('A / B\nC-D')),'A / B\nC-D')
 assert.throws(()=>morseEncode('你好'));assert.throws(()=>morseDecode('......'))
})
test('hidden PNG grayscale pixels reproduce distinct white and black target brightness',()=>{
 const front=new Uint8ClampedArray([0,0,0,255,255,255,255,255,100,100,100,255]),back=new Uint8ClampedArray([255,255,255,255,0,0,0,255,170,170,170,255]),out=hiddenImage(front,back,{white:60,black:35,color:0})
 for(let p=0;p<out.length;p+=4){const alpha=out[p+3]/255;assert.ok(Math.abs(out[p]*alpha-back[p]*.35)<2);assert.ok(Math.abs(out[p]*alpha+255*(1-alpha)-(153+front[p]*.4))<2);assert.equal(out[p],out[p+1]);assert.equal(out[p],out[p+2])}
})
test('hidden color intensity is bounded and invalid images are rejected',()=>{
 const a=new Uint8ClampedArray([255,0,0,255]),b=new Uint8ClampedArray([0,0,255,255]);assert.notDeepEqual(hiddenImage(a,b,{white:60,black:35,color:0}),hiddenImage(a,b,{white:60,black:35,color:100}))
 assert.throws(()=>hiddenImage(a,b,{white:30,black:35,color:0}));assert.throws(()=>hiddenImage(a,new Uint8ClampedArray(8),{white:60,black:35,color:0}));assert.throws(()=>hiddenImage(new Uint8ClampedArray(),new Uint8ClampedArray(),{white:60,black:35,color:0}))
})
test('hidden white and black image color strengths can be controlled independently',()=>{
 const front=new Uint8ClampedArray([255,0,0,255]),back=new Uint8ClampedArray([0,0,255,255]),common={white:60,black:35}
 const gray=hiddenImage(front,back,{...common,whiteColor:0,blackColor:0}),coloredFront=hiddenImage(front,back,{...common,whiteColor:100,blackColor:0}),coloredBack=hiddenImage(front,back,{...common,whiteColor:0,blackColor:100})
 assert.notDeepEqual(gray,coloredFront);assert.notDeepEqual(gray,coloredBack);assert.notDeepEqual(coloredFront,coloredBack)
 assert.ok(coloredFront[0]>coloredFront[2]);assert.ok(coloredBack[2]>coloredBack[0])
 assert.deepEqual(hiddenImage(front,back,{...common,color:50}),hiddenImage(front,back,{...common,whiteColor:50,blackColor:50}))
 assert.throws(()=>hiddenImage(front,back,{...common,whiteColor:-1,blackColor:0}));assert.throws(()=>hiddenImage(front,back,{...common,whiteColor:0,blackColor:101}))
})
test('kinship distinguishes elder and younger relatives, maternal branches and affinity',()=>{
 const cases=[['爸爸的哥哥','伯父'],['爸爸的弟弟','叔叔'],['妈妈的哥哥','大舅'],['哥哥的妻子','嫂子'],['妻子的妈妈','岳母'],['丈夫的爸爸','公公'],['姐姐的儿子','外甥'],['哥哥的女儿','侄女'],['儿子的儿子','孙子'],['女儿的女儿','外孙女']]
 for(const[text,result]of cases)assert.ok(kinship({text,sex:-1}).result.includes(result),text)
 assert.deepEqual(kinship({text:'爸爸的哥哥的儿子',sex:1}).result,['堂哥','堂弟'])
 assert.deepEqual(kinship({text:'妈妈的妹妹的女儿',sex:1}).result,['姨姐','姨妹'])
 assert.equal(kinship({text:'外婆',target:'舅妈',sex:1}).result[0],'婆婆')
})
test('kinship reverse honorifics honor self gender and impossible relationships fail',()=>{
 assert.deepEqual(kinship({text:'妈妈的哥哥',sex:1,reverse:true}).result,['外甥'])
 assert.deepEqual(kinship({text:'妈妈的哥哥',sex:0,reverse:true}).result,['外甥女'])
 assert.ok(kinship({text:'舅妈',type:'chain'}).result[0].includes('妈妈'))
 assert.throws(()=>kinship({text:'妻子',sex:0}));assert.throws(()=>kinship({text:'外星人'}));assert.throws(()=>kinship({text:Array(10).fill('爸爸').join('的')}))
})
test('Meow matches original four-character triples, preserves UTF-8 and handles literal suffix collisions',()=>{
 assert.equal(meowEncode('A'),'萤流流萤流流')
 for(const input of ['中文 😀\n  spaces ','AB+','A','https://example.com/?a=1']){const encoded=meowEncode(input);assert.equal(meowDecode(encoded).output,input);assert.equal(meowDecode('喵呜...'+encoded+'喵～').output,input)}
 assert.equal(meowDecode(meowEncode('流萤 🌙','星月云风'),'星月云风').output,'流萤 🌙')
 assert.throws(()=>meowEncode('text','喵喵喵喵'));assert.throws(()=>meowDecode('不是喵语'))
})
test('Meow auto decoding preserves multiple layers and custom mapping behavior',()=>{
 const original='自动连续还原：你好，流萤！',first=meowEncode(original),twice=meowEncode(first)
 assert.equal(meowDecode(twice,'流萤喵～',true).output,original)
 assert.equal(meowDecode(twice,'流萤喵～',true).layers.length,2)
})
test('website bridge accepts declared HTTPS origins and rejects credentials, wildcards and unsafe schemes',async()=>{
 const compiled=await build({entryPoints:['src/services/webToolLinks.ts'],bundle:true,write:false,platform:'node',format:'esm'}),code=compiled.outputFiles[0].text,api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
 assert.equal(api.checkedWebsite('https://image.baidu.com/','百度识图',['https://image.baidu.com']).title,'百度识图')
 for(const value of ['http://image.baidu.com','https://user:pass@image.baidu.com','https://image.baidu.com.evil.test','javascript:alert(1)','file:///x'])assert.throws(()=>api.checkedWebsite(value,'',['https://image.baidu.com']))
 assert.throws(()=>api.checkedWebsite('https://image.baidu.com','',['https://*']))
})
