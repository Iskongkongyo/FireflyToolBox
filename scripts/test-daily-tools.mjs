import {test} from 'node:test'
import assert from 'node:assert/strict'
import jsQR from 'jsqr'
import {calendarData,fromLunar,lunarMonths,solarDate} from '../src-tauri/builtin-tools/src/calendar-data.js'
import {qrPayload,qrOptions,qrMatrix,qrGeometry,qrSVG} from '../src-tauri/builtin-tools/src/qr-generate-data.js'
import {weatherNumber,cmaWeather,meteoWeather,meteoURL,stationCode} from '../src-tauri/builtin-tools/src/weather-data.js'

test('calendar converts leap lunar months and handles both solar range boundaries',()=>{
 assert.equal(fromLunar(2025,-6,1),'2025-07-25');assert.equal(lunarMonths(2025).find(m=>m.month<0).label,'闰六月')
 assert.equal(calendarData('2026-02-17').detail.lunar,'二〇二六年正月初一');assert.ok(calendarData('2026-02-17').detail.festivals.includes('春节'))
 for(const d of ['1900-01-01','2100-12-31','2024-02-29'])assert.equal(calendarData(d).cells.length,42)
 for(const d of ['2025-02-29','2026-13-01','1899-12-31'])assert.throws(()=>solarDate(d))
 assert.throws(()=>fromLunar(2026,-6,1));assert.throws(()=>fromLunar(2025,-6,30))
})
test('holiday markers match current collected schedules and do not guess future years',()=>{
 assert.equal(calendarData('2026-10-07').detail.holiday.work,false);assert.equal(calendarData('2026-10-10').detail.holiday.work,true)
 assert.equal(calendarData('2027-10-01').detail.holiday,null);assert.ok(calendarData('2026-10-08').detail.term.includes('寒露'))
})
test('QR payloads preserve Wi-Fi whitespace and escape reserved characters and vCard newlines',()=>{
 assert.equal(qrPayload({type:'wifi',ssid:' Wi;Fi ',security:'WPA',password:' a:b\\ ',hidden:true}),'WIFI:T:WPA;S: Wi\\;Fi ;P: a\\:b\\\\ ;H:true;;')
 assert.ok(qrPayload({type:'contact',name:'测试;人',note:'one\ntwo'}).includes('NOTE:one\\ntwo'))
 assert.equal(qrPayload({type:'geo',latitude:0,longitude:0}),'geo:0,0')
 assert.equal(qrPayload({type:'phone',phone:'+86 138-0013-8000'}),'tel:+8613800138000')
 assert.throws(()=>qrPayload({type:'url',url:'javascript:alert(1)'}));assert.throws(()=>qrPayload({type:'email',email:'bad'}));assert.throws(()=>qrPayload({type:'text',text:'你'.repeat(3000)}))
})
const options=qrOptions({size:512,margin:4,version:0,level:'M',dark:'#000000',light:'#ffffff'})
test('generated QR matrices decode exactly as UTF-8, Wi-Fi, URL and contact data',()=>{
 for(const payload of ['中文 😀\nexact whitespace ',qrPayload({type:'url',url:'example.com/a?x=1'}),qrPayload({type:'wifi',ssid:'测试网络',security:'WPA',password:'pass1234'}),qrPayload({type:'contact',name:'流萤',email:'a@example.com'})]){
  const matrix=qrMatrix(payload,options),{scale,offset}=qrGeometry(matrix,options),pixels=new Uint8ClampedArray(options.size**2*4).fill(255)
  for(let y=0;y<matrix.size;y++)for(let x=0;x<matrix.size;x++)if(matrix.cells[y*matrix.size+x])for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const p=((offset+y*scale+dy)*options.size+offset+x*scale+dx)*4;pixels[p]=pixels[p+1]=pixels[p+2]=0}
  assert.equal(jsQR(pixels,options.size,options.size).data,payload)
  assert.ok(qrSVG(matrix,options).startsWith('<svg'));assert.throws(()=>qrSVG(matrix,options,'x" onload="bad'))
 }
})
test('QR options and capacity failures explain contrast, scale and version constraints',()=>{
 assert.throws(()=>qrOptions({...options,version:0,size:127}));assert.throws(()=>qrOptions({...options,version:0,dark:'#eeeeee'}));assert.throws(()=>qrOptions({...options,version:0,margin:0}))
 assert.throws(()=>qrMatrix('a'.repeat(3000),{...options,version:1}));assert.throws(()=>qrGeometry({size:177},{...options,size:128}))
})
test('weather parsers treat sentinel measurements as missing instead of real weather',()=>{
 assert.equal(weatherNumber(9999),null);assert.equal(weatherNumber(0),0);assert.equal(weatherNumber(1016),1016)
 const data=cmaWeather({code:0,data:{real:{station:{city:'北京'},weather:{temperature:0,airpressure:9999},wind:{speed:0},warn:{alert:'9999'}},predict:{detail:[{date:'2026-10-07',day:{weather:{temperature:'9999'}},night:{weather:{temperature:'12'}}}]}}})
 assert.equal(data.current.temperature,0);assert.equal(data.current.pressure,null);assert.equal(data.warning,'');assert.equal(data.days[0].high,null)
 assert.throws(()=>cmaWeather({code:0,data:''}));assert.throws(()=>stationCode('../x'));assert.throws(()=>meteoURL({latitude:91,longitude:0}))
 const meteo=meteoWeather({current:{time:'2026-10-07T12:00',temperature_2m:0},daily:{time:['2026-10-07']},hourly:{time:['2026-10-07T11:00','2026-10-07T13:00'],temperature_2m:[1,2]}},{name:'城市'})
 assert.equal(meteo.hours.length,1);assert.equal(meteo.hours[0].temperature,2);assert.equal(meteo.current.temperature,0)
})
