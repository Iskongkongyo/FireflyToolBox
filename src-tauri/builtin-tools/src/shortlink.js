import {$,status,text,copyButton} from './common.js'
import {session} from './image-runtime.js'
import {webAddress} from './quick-network-data.js'
import {shortRequest,providerResult,spooRequest,suoRequest} from './shortlink-data.js'
export function mount({request,resolveLink,copyText,signal}){
 let result='';const cooldowns=new Map(),job=session(signal,()=>{$('copy').disabled=job.busy||!result})
 function invalidate(){result='';$('output').value='';$('details').textContent='';$('hops-box').hidden=true;$('copy').disabled=true;status('')}
 function settings(){invalidate();const create=$('action').value==='create';$('provider-label').hidden=!create;$('short-key-label').hidden=!create||$('provider').value!=='suo.yt';$('run').textContent=create?'生成短链':'还原地址'}
 for(const id of ['url','action','provider','short-key'])$(id).oninput=settings
 async function api(provider,value,create,current){
  const cooldown=cooldowns.get(provider)||0;if(Date.now()<cooldown)throw new Error(`${provider} 服务限流，请等待 ${Math.ceil((cooldown-Date.now())/1000)} 秒再试。`)
  const spec=shortRequest(provider,value,create,provider==='suo.yt'?$('short-key').value:'');let data,httpStatus
  if(spec.method==='POST'){const response=await (provider==='suo.yt'?suoRequest:spooRequest)(spec.body,current);data=response.data;httpStatus=response.status}
  else{const response=await request(spec.url,{signal:current});httpStatus=response.status;try{data=await response.json()}catch{throw new Error(`${provider} 未返回有效 JSON（HTTP ${httpStatus}），请稍后重试。`)}}
  try{return providerResult(provider,data,create,httpStatus)}catch(error){if(error.limited)cooldowns.set(provider,Date.now()+60000);throw error}
 }
 $('run').onclick=()=>void job.run(async current=>{
  invalidate();const create=$('action').value==='create',url=webAddress($('url').value,!create);status(create?'正在生成短链…':'正在还原地址…');let next,description=''
  if(create){const provider=$('provider').value;next=await api(provider,url.href,true,current);description=`生成服务：${provider}`}
  else if(['is.gd','v.gd','ulvis.net'].includes(url.hostname)){next=await api(url.hostname,url.href,false,current);description='使用短链服务官方查询，没有访问目标网页。'}
  else{const data=await resolveLink(url.href,{signal:current});next=webAddress(data.url).href;description=data.http_stopped?'解析到 HTTP 地址，尚未继续访问后续跳转。':data.hops?.length>1?`已解析 ${data.hops.length-1} 次跳转，目标返回 HTTP ${data.status}。`:'未检测到服务器重定向，可能已是原地址或需要网页脚本跳转。';$('hops').replaceChildren(...(data.hops||[]).map(v=>text('li',v)));$('hops-box').hidden=false}
  if(current.aborted)return;result=next;$('output').value=next;$('details').textContent=description;status(create?'短链接已生成。':'地址已解析。')
 });$('cancel').onclick=()=>job.cancel();copyButton('copy',()=>result,copyText);return()=>job.dispose()
}
