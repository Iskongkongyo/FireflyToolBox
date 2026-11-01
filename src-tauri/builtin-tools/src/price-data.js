export const PRICE_SOURCES=['https://60s.7se.cn','https://60s.crystelf.top']
export const PROVINCES=['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆']
const clean=(v,max=120)=>typeof v==='string'?v.slice(0,max):''
export function priceNumber(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>0&&n<1000000?n:null}
function payload(v){if(v?.code!==undefined&&v.code!==200)throw new Error(clean(v.message)||'来源暂时没有提供价格数据。');return v?.data||v}
export function fuelData(value,province){const d=payload(value);if(!d||typeof d.region!=='string'||!d.region.includes(province)||!Array.isArray(d.items))throw new Error('来源未返回所选地区的油价，请稍后重试。');const items=d.items.slice(0,12).filter(v=>v&&priceNumber(v.price)!==null&&typeof v.name==='string').map(v=>({name:clean(v.name,40),price:priceNumber(v.price)}));if(!items.length)throw new Error('该地区暂时没有可用的油价。');return{region:clean(d.region,80),items,updated:clean(d.updated),date:clean(d.updated).slice(0,10).replaceAll('/','-'),trend:{next:clean(d.trend?.next_adjustment_date),direction:['上调','下调','搁浅'].includes(d.trend?.direction)?d.trend.direction:'',change:clean(d.trend?.change_liter_desc)}}}
const goldWord=v=>/黄金|金条|^\d+\s*[kK]金/.test(v)&&!/[铂钯白]金|白银/.test(v)
export function goldData(value){const d=payload(value);if(!d||!Array.isArray(d.metals))throw new Error('来源未返回有效的黄金价格。');const rows=[]
 function add(list,category,accept,title,price){for(const v of (Array.isArray(list)?list:[]).slice(0,100)){if(!v||!accept(v))continue;const n=priceNumber(price(v));if(n===null||v.unit!=='元/克')continue;rows.push({category,name:clean(title(v),80),price:n,unit:'元/克',product:clean(v.product,60),purity:clean(v.purity,40),sell:priceNumber(v.sell_price),high:priceNumber(v.high_price),low:priceNumber(v.low_price),updated:clean(v.updated)})}}
 add(d.metals,'国内参考',v=>['今日金价','黄金_9999','黄金_T+D','黄金9999','黄金T+D'].includes(v.name),v=>v.name,v=>v.today_price??v.price)
 // Some upstream rows incorrectly list international quotes as CNY per gram. Only show actual jewelry products here.
 add(d.stores,'品牌零售',v=>v.product==='黄金'&&!/伦敦|纽约|XAU|COMEX/.test(v.brand),v=>v.brand,v=>v.price)
 add(d.banks,'投资金条',v=>goldWord(String(v.product||'')),v=>`${v.bank} · ${v.product}`,v=>v.price)
 add(d.recycle,'黄金回收',v=>goldWord(String(v.type||'')),v=>v.type,v=>v.price)
 if(!rows.length)throw new Error('来源没有可用的黄金价格。');return{date:clean(d.date,10),rows}
}
export function spotGold(value){if(value?.symbol!=='XAU'||value.currency&&value.currency!=='USD'||priceNumber(value.price)===null||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('国际来源未返回有效的美元黄金报价。');return{category:'国际现货',name:'现货黄金 XAU / USD',price:priceNumber(value.price),unit:'美元 / 金衡盎司',updated:value.updatedAt}}
export function priceText(value){return Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
export function quoteDateState(date,today){return !/^\d{4}-\d{2}-\d{2}$/.test(date)?'来源未提供日期':date===today?'今日数据':`来源日期：${date}，并非今日数据`}
