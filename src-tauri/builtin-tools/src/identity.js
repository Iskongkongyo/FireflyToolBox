import {$,status,text,copyButton} from './common.js'
import {inspectIdentity,chinaToday} from './identity-engine.js'
export function mount({copyText}){
 let report='';$('as-of').value=chinaToday()
 const clear=()=>{report='';$('result').hidden=true;$('copy').disabled=true}
 $('number').oninput=clear;$('as-of').oninput=clear
 $('process').onclick=()=>{clear();try{
  const value=inspectIdentity($('number').value,$('as-of').value),rows=[['规则校验',value.valid?(value.legacy?'旧版格式通过，15 位号码无独立校验码':'结构、出生日期与校验码通过'):value.issues.join('；')],['地址码',value.code],['地区',value.region],['地区匹配',value.regionKnown?'已匹配地区数据':'完整地区代码未收录，可能为历史代码，需核对'],['出生日期',value.birthday],['年龄',value.age===null?'无法计算':value.age+' 周岁'],['性别',value.sex],['计算日期',value.asOf]]
  if(value.legacy)rows.push(['换算的 18 位号码',value.normalized])
  $('fields').replaceChildren(...rows.flatMap(([name,content])=>[text('dt',name),text('dd',content)]));report=rows.map(row=>row.join('：')).join('\n');$('result').hidden=false;$('copy').disabled=false
  status(value.valid?(value.regionKnown?'号码规则校验通过。':'号码结构与校验码通过，完整地区代码待核对。'):'号码规则校验未通过。',!value.valid)
 }catch(error){status(error.message,true)}}
 $('number').onkeydown=event=>{if(event.key==='Enter')$('process').click()}
 $('clear').onclick=()=>{$('number').value='';clear();status('已清空。')}
 copyButton('copy',()=>report,copyText)
}
