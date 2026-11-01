import {$,status,text,copyButton} from './common.js'
import {inspectBankCard,bankLookupFields} from './bankcard-engine.js'
export function mount({request,copyText,signal}){
 let report='',busy=false,controller,disposed=false
 const update=()=>{for(const id of ['number','process','lookup','clear'])$(id).disabled=busy;$('copy').disabled=busy||!report;$('cancel').hidden=!busy}
 const clear=()=>{report='';$('result').hidden=true;update()}
 function render(rows){report=rows.map(row=>row.join('：')).join('\n');$('fields').replaceChildren(...rows.flatMap(([name,value])=>[text('dt',name),text('dd',String(value))]));$('result').hidden=false;update()}
 function local(){const value=inspectBankCard($('number').value),rows=[['BIN 前缀',value.prefix],['Luhn 校验',value.prefixOnly?'仅输入前缀，不校验完整卡号':value.luhn?'通过（仅号码规则）':'未通过；部分旧卡不采用 Luhn，需核对']];if(value.matches.length){rows.push(['本地银行',value.matches.map(item=>item.bankName).join(' / ')],['本地卡种',value.matches.map(item=>item.cardTypeName).join(' / ')])}else rows.push(['本地银行','当前数据未匹配，可能为未收录 BIN']);rows.push(['发卡地区','本地数据不含地区，可点击“查询发卡地区”']);render(rows);return {value,rows}}
 $('number').oninput=clear
 $('process').onclick=()=>{clear();try{local();status('本地识别完成。')}catch(error){status(error.message,true)}}
 $('lookup').onclick=async()=>{if(busy||disposed)return;clear();let current;try{current=local()}catch(error){status(error.message,true);return}busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();const timer=setTimeout(abort,20000);update();status('正在查询 BIN 发卡信息…');try{
  const response=await request('https://lookup.binlist.net/'+current.value.prefix,{signal:controller.signal})
  if(!response.ok)throw new Error(response.status===429?'公共查询达到频率限制，请稍后重试；本地结果已保留。':response.status===404?'接口未收录此 BIN；本地结果已保留。':'查询接口暂时不可用（'+response.status+'），本地结果已保留。')
  const raw=await response.text();if(raw.length>65536)throw new Error('查询数据过大。')
  const info=JSON.parse(raw);if(!info||typeof info!=='object'||Array.isArray(info))throw new Error('查询返回的数据无效。')
  if(!disposed&&!signal.aborted){render([...current.rows.slice(0,-1),...bankLookupFields(info)]);status('查询完成，缺失地区信息已标明。')}
 }catch(error){if(!disposed&&!signal.aborted)status(error.name==='AbortError'?'已取消或查询超时，本地结果已保留。':error.message,true)}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller=null;busy=false;if(!disposed)update()}}
 $('clear').onclick=()=>{$('number').value='';clear();status('已清空。')};$('cancel').onclick=()=>controller?.abort();copyButton('copy',()=>report,copyText);update()
 return()=>{disposed=true;controller?.abort();report=''}
}
