import {$,status,text,operation,copyButton} from './common.js'
import {jsonRequest} from './life.js'
import {ipAddress} from './network.js'
export function mount({request,copyText,signal}){
 const op=operation(signal);let result=''
 async function query(){const current=op.start();for(const id of ['query','current'])$(id).disabled=true;$('cancel').hidden=false;$('results').hidden=true;$('copy').disabled=true;status('正在查询 IP…');try{const ip=ipAddress($('ip').value),data=await jsonRequest(request,`https://api.live.bilibili.com/ip_service/v1/ip_service/get_ip_addr?ip=${encodeURIComponent(ip)}`,current);if(data.code!==0||!data.data?.addr)throw new Error(data.message||data.msg||'来源未返回有效的 IP 信息。');if(current.aborted)return;const values=[['IP 地址',data.data.addr],['国家/地区或归属类别',data.data.country],['省份',data.data.province],['城市',data.data.city],['运营商',data.data.isp]];$('info').replaceChildren();for(const[name,value]of values)$('info').append(text('dt',name),text('dd',value||'暂无信息'));result=values.map(([name,value])=>`${name}：${value||'暂无信息'}`).join('\n');$('results').hidden=false;$('copy').disabled=false;status('查询完成。')}catch(e){if(!signal.aborted)status(e.name==='AbortError'?'已取消查询。':e.message,true)}finally{if(!signal.aborted){for(const id of ['query','current'])$(id).disabled=false;$('cancel').hidden=true}}}
 $('query').onclick=()=>void query();$('current').onclick=()=>{$('ip').value='';void query()};$('cancel').onclick=()=>op.cancel();copyButton('copy',()=>result,copyText);return()=>op.dispose()
}
