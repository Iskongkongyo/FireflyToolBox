import provinces from 'china-division/dist/provinces.json' with {type:'json'}
import cities from 'china-division/dist/cities.json' with {type:'json'}
import areas from 'china-division/dist/areas.json' with {type:'json'}
const provinceNames=Object.fromEntries(provinces.map(item=>[item.code,item.name]))
Object.assign(provinceNames,{'71':'台湾省','81':'香港特别行政区','82':'澳门特别行政区','83':'台湾居民居住证'})
const cityNames=Object.fromEntries(cities.map(item=>[item.code,item.name]))
const areaNames=Object.fromEntries(areas.map(item=>[item.code,item.name]))
const weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
export function identityChecksum(body){if(!/^\d{17}$/.test(body))throw new Error('身份证本体须为 17 位数字。');return '10X98765432'[[...body].reduce((sum,bit,index)=>sum+Number(bit)*weights[index],0)%11]}
export function chinaToday(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`}
function dateParts(value){const match=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);if(!match)return null;const [year,month,day]=match.slice(1).map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);return year>0&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?{year,month,day,stamp:date.getTime()}:null}
export function inspectIdentity(input,asOf=chinaToday()){
 const number=String(input).replace(/\s/g,'').toUpperCase(),reference=dateParts(asOf)
 if(!reference)throw new Error('年龄计算日期无效。')
 if(!/^(?:\d{15}|\d{17}[0-9X])$/.test(number))throw new Error('请输入 18 位身份证号码（末位可为 X），或旧版 15 位号码。')
 const legacy=number.length===15,body=legacy?number.slice(0,6)+'19'+number.slice(6):number.slice(0,17),normalized=body+identityChecksum(body)
 const code=body.slice(0,6),birth=dateParts(body.slice(6,14)),issues=[]
 const province=provinceNames[code.slice(0,2)],city=cityNames[code.slice(0,4)],area=areaNames[code]
 if(!province||code==='000000')issues.push('地址码的省级代码未识别')
 if(!birth)issues.push('出生日期不存在')
 else if(birth.stamp>reference.stamp)issues.push('出生日期晚于计算日期')
 if(!legacy&&number!==normalized)issues.push('校验码不正确，末位应为 '+normalized.at(-1))
 const age=birth&&birth.stamp<=reference.stamp?reference.year-birth.year-Number(reference.month<birth.month||(reference.month===birth.month&&reference.day<birth.day)):null
 return {valid:!issues.length,issues,legacy,number,normalized,code,region:[province,city,area].filter(Boolean).join(' / ')||'未收录',regionKnown:!!area||['810000','820000','830000'].includes(code),birthday:birth?`${body.slice(6,10)}-${body.slice(10,12)}-${body.slice(12,14)}`:'无效',age,sex:Number(body.at(-1))%2?'男':'女',asOf}
}
