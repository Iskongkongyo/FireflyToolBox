import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {geoOrthographic,geoPath,geoArea} from 'd3-geo'
import {feature} from 'topojson-client'
import {generatePassword,passwordStrength,cleanPasswordFavorites,PASSWORD_SYMBOLS} from '../src-tauri/builtin-tools/src/password-data.js'
import {FLOWERS,filterFlowers,flowerSummary} from '../src-tauri/builtin-tools/src/flowers-data.js'
import {countryIndex,countryAt,searchCountries,labelBoxes} from '../src-tauri/builtin-tools/src/globe-data.js'
import {COMMANDS,COMMAND_CATEGORIES,filterCommands} from '../src-tauri/builtin-tools/src/commands-data.js'
test('password bounds, categories, ambiguous characters and invalid settings',()=>{
 for(let mask=1;mask<16;mask++)for(const length of [6,16,32]){
  const options={length,digits:!!(mask&1),lower:!!(mask&2),upper:!!(mask&4),symbols:!!(mask&8),exclude:true},value=generatePassword(options)
  assert.equal(value.length,length);assert(!/[0O1Il]/.test(value));if(options.digits)assert(/[2-9]/.test(value));if(options.lower)assert(/[a-z]/.test(value));if(options.upper)assert(/[A-Z]/.test(value));if(options.symbols)assert([...value].some(c=>PASSWORD_SYMBOLS.includes(c)))
 }
 for(const length of [5,33,6.5,''])assert.throws(()=>generatePassword({length,digits:true}))
 assert.throws(()=>generatePassword({length:12}),/至少/)
})
test('strength flags predictable patterns and distinguishes useful random lengths',()=>{
 assert.equal(passwordStrength('').level,'未输入')
 for(const value of ['password123456!','aaaaaaAAAAAA111111','1234567890','qwertyuiop'])assert.equal(passwordStrength(value).level,'弱')
 assert.equal(passwordStrength('aB7!kF2@').level,'弱');assert.equal(passwordStrength('mT7!gR4@sN8#kW2?').level,'强')
 assert(passwordStrength('xT9!bM4@zQ7#').score<passwordStrength('xT9!bM4@zQ7#uE8&').score)
})
test('saved passwords are bounded, local records with no auto history',()=>{
 assert.deepEqual(cleanPasswordFavorites(null),[])
 assert.equal(cleanPasswordFavorites([{id:'a',value:'12345'},{id:'b',value:'123456',label:'x'}]).length,1)
 assert.equal(cleanPasswordFavorites(Array.from({length:50},(_,i)=>({id:String(i),value:'123456',label:'x'.repeat(100)}))).length,30)
 assert.equal(cleanPasswordFavorites([{id:'a',value:'123456',label:'x'.repeat(100)}])[0].label.length,40)
})
test('flower catalog searches aliases, category, color and seasonal supply',()=>{
 assert.equal(FLOWERS.length,24);assert.equal(new Set(FLOWERS.map(f=>f.id)).size,24)
 assert.equal(filterFlowers('月季')[0].name,'玫瑰');assert(filterFlowers('黄色','友情').some(f=>f.name==='玫瑰'))
 assert(!filterFlowers('芍药','全部','3').length);assert(filterFlowers('芍药','全部','0').length)
 assert.equal(filterFlowers('not-a-flower').length,0)
 for(const f of FLOWERS){assert.equal(f.seasons.length,4);assert(f.seasons.every(s=>['常','季','少'].includes(s)));assert(flowerSummary(f).includes('自然花期'));assert(new URL(f.source).protocol==='https:')}
})
test('150 command cards preserve literal code, category and search constraints',()=>{
 assert.equal(COMMANDS.length,150)
 for(const category of COMMAND_CATEGORIES.slice(1)){assert.equal(filterCommands('',category).length,15);assert(filterCommands('日志',category).every(c=>c.category===category))}
 assert.equal(filterCommands('git diff')[0].category,'Git')
 assert(filterCommands('PowerShell UTF-8').some(c=>c.example.includes('Get-Content')))
 assert(filterCommands('代码块','Markdown')[0].example.includes('```js\n'))
 assert.equal(filterCommands('no-such-command').length,0)
 for(const c of COMMANDS){assert(c.note&&c.example&&c.syntax);assert.equal(new URL(c.source).protocol,'https:')}
})
test('offline land geometry renders with proper horizon clipping and coordinate inversion',async()=>{
 const world=JSON.parse(await readFile(new URL('../src-tauri/builtin-tools/data/land-110m.json',import.meta.url),'utf8')),land=feature(world,world.objects.land),projection=geoOrthographic().scale(200).translate([250,250]).rotate([-116.4,-39.9,0]),path=geoPath(projection)
 assert(geoArea(land)>1&&geoArea(land)<4);assert(path(land).length>1000)
 const center=projection.invert([250,250]);assert(Math.abs(center[0]-116.4)<1e-6&&Math.abs(center[1]-39.9)<1e-6)
 assert(path({type:'Point',coordinates:[116.4,39.9]}));assert.equal(path({type:'Point',coordinates:[-63.6,-39.9]}),null)
})

test('country selection resolves land, ocean, aliases and coordinates across hemispheres',async()=>{
 const world=JSON.parse(await readFile(new URL('../src-tauri/builtin-tools/data/countries-110m.json',import.meta.url),'utf8')),labels=JSON.parse(await readFile(new URL('../src-tauri/builtin-tools/data/country-labels.json',import.meta.url),'utf8')),countries=countryIndex(world,labels)
 assert.equal(countries.length,177);assert(countries.every(c=>c.name&&c.english&&c.point.every(Number.isFinite)))
 for(const [point,name]of [[[116.4,39.9],'中国'],[[139.69,35.69],'日本'],[[-.13,51.51],'英国'],[[2.35,48.86],'法国'],[[-97.48,39.54],'美国'],[[151.21,-33.87],'澳大利亚'],[[-47.88,-15.79],'巴西']])assert.equal(countryAt(countries,point)?.name,name)
 assert.equal(countryAt(countries,[0,0]),null);assert.equal(countryAt(countries,[0,91]),null)
 assert.equal(searchCountries(countries,'China')[0].name,'中国');assert.equal(searchCountries(countries,'USA')[0].name,'美国');assert.equal(searchCountries(countries,'FR')[0].name,'法国');assert.equal(searchCountries(countries,'not a country').length,0)
 assert(searchCountries(countries,'中国').some(c=>c.name==='中国'));assert.equal(searchCountries(countries,'').length,0)
 assert.equal(searchCountries(countries,'台湾')[0].name,'中国台湾');assert.equal(searchCountries(countries,'Taiwan')[0].name,'中国台湾')
})
test('globe labels remain on canvas and do not collide with each other or a marker',()=>{
 const candidates=[{name:'中国',x:100,y:100},{name:'nearby',x:110,y:102},{name:'英国',x:240,y:100},{name:'edge',x:1,y:10}],placed=labelBoxes(candidates,300,200,name=>name.length*12)
 assert.deepEqual(placed.map(c=>c.name),['中国','英国'])
 assert.deepEqual(labelBoxes([{name:'center',x:150,y:100},{name:'horizon',x:245,y:100}],300,200,name=>name.length*12,[],{x:150,y:100,r:100}).map(c=>c.name),['center'])
 assert.deepEqual(labelBoxes(candidates,300,200,name=>name.length*12,[{x:90,y:90,w:20,h:20}]).map(c=>c.name),['英国'])
})
