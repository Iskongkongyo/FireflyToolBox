import {$,status,text,operation,copyButton} from './common.js'
import {jsonRequest} from './life.js'
import {phoneNumber,phoneResult} from './practical.js'
export function mount({request,copyText,signal}) {
 const op=operation(signal);let result=''
 const invalidate=()=>{result='';$('results').hidden=true;$('copy').disabled=true;status('')}
 async function query(){let number;try{number=phoneNumber($('phone').value)}catch(e){invalidate();status(e.message,true);return}const current=op.start();invalidate();$('query').disabled=true;$('phone').disabled=true;$('cancel').hidden=false;status('正在查询…');try{const data=phoneResult(await jsonRequest(request,`https://cx.shouji.360.cn/phonearea.php?number=${number}`,current));if(current.aborted)return;const values=[['手机号',number],['省份 / 地区',data.province||'暂无信息'],['城市',data.city||'暂无信息'],['号码段运营商',data.carrier||'暂无信息']];$('info').replaceChildren();for(const[name,value]of values)$('info').append(text('dt',name),text('dd',value));result=values.map(([name,value])=>`${name}：${value}`).join('\n');$('results').hidden=false;$('copy').disabled=false;status('查询完成。')}catch(e){if(!signal.aborted)status(e.name==='AbortError'?'已取消查询。':e.message||'查询失败，请稍后重试。',e.name!=='AbortError')}finally{if(!signal.aborted){$('query').disabled=false;$('phone').disabled=false;$('cancel').hidden=true}}}
 $('query').onclick=()=>void query();$('phone').oninput=invalidate;$('phone').onkeydown=e=>{if(e.key==='Enter'&&!$('query').disabled)void query()};$('cancel').onclick=()=>op.cancel();copyButton('copy',()=>result,copyText);return()=>op.dispose()
}
