import {webAddress,providerURL,shortResult} from './quick-network-data.js'
export const SHORT_PROVIDERS=['spoo.me','ulvis.net','suo.yt','is.gd','v.gd']
export function shortRequest(provider,value,create=true,shortKey=''){
 if(!SHORT_PROVIDERS.includes(provider))throw new Error('短链来源无效。')
 const target=webAddress(value,!create)
 if(['is.gd','v.gd'].includes(provider))return{method:'GET',url:providerURL(provider,create?'create':'lookup',target.href)}
 if(provider==='spoo.me'){if(!create)throw new Error('spoo.me 使用服务器跳转还原。');return{method:'POST',url:'https://spoo.me/api/v1/shorten',body:JSON.stringify({long_url:target.href})}}
 if(provider==='suo.yt'){
  if(!create)throw new Error('suo.yt 使用服务器跳转还原。')
  const key=String(shortKey).trim();if(key.length>128||/[\x00-\x1f\x7f\\/?#]/.test(key))throw new Error('自定义短码最多 128 字符，且不能包含 /、?、# 或控制字符。')
  const encoded=btoa(Array.from(new TextEncoder().encode(target.href),byte=>String.fromCharCode(byte)).join(''))
  const body=new URLSearchParams({longUrl:encoded,shortKey:key}).toString();if(body.length>16384)throw new Error('生成请求过长，请缩短原链接。')
  return{method:'POST',url:'https://suo.yt/short',body}
 }
 let params
 if(create)params=new URLSearchParams({url:target.href,type:'json',private:'1'})
 else{if(target.hostname!=='ulvis.net'||!/^\/[a-z0-9_-]{1,128}$/i.test(target.pathname))throw new Error('请填写完整的 ulvis.net 短链接。');params=new URLSearchParams({id:target.pathname.slice(1),type:'json'})}
 const url=`https://ulvis.net/API/${create?'write':'read'}/get?${params}`
 if(url.length>4096)throw new Error('生成请求超过 4096 字符，请缩短原地址。')
 return{method:'GET',url}
}
function detail(data){const error=data?.error;return String(typeof error==='string'?error:error?.message||error?.msg||data?.Message||data?.Msg||data?.message||data?.detail||'').slice(0,180)}
export function providerResult(provider,data,create=true,status=200){
 if(status===429)throw Object.assign(new Error('请求频率过高，请等待一分钟后再试。'),{limited:true})
 if(status>=400)throw new Error(`${provider} 请求失败（HTTP ${status}）${detail(data)?'：'+detail(data):'，请稍后重试。'}`)
 let value
 if(['is.gd','v.gd'].includes(provider))value=shortResult(data,create)
 else if(provider==='spoo.me'){if(!data?.short_url)throw new Error(detail(data)||'spoo.me 未返回有效短链接，请稍后重试。');value=data.short_url}
 else if(provider==='suo.yt'){if(!create)throw new Error('suo.yt 使用服务器跳转还原。');if(Number(data?.Code)!==1)throw new Error('suo.yt 生成失败'+(detail(data)?'：'+detail(data):'，请检查地址或自定义短码。'));if(typeof data.ShortUrl!=='string'||!data.ShortUrl.trim())throw new Error('suo.yt 未返回有效短链接，请稍后重试。');value=data.ShortUrl}
 else if(provider==='ulvis.net'){if(![true,1,'1'].includes(data?.success)){const reason=detail(data);throw new Error(reason.toLowerCase().includes('domain not allowed')?'ulvis.net 不接受这个域名，请换一个地址或生成服务。':`ulvis.net ${create?'生成':'查询'}失败${reason?'：'+reason:'，请稍后重试。'}`)}value=create?data?.data?.url:data?.data?.full}
 else throw new Error('短链来源无效。')
 const url=webAddress(value,create)
 if(create&&(url.origin!=='https://'+provider||url.pathname==='/'))throw new Error('生成服务返回了非预期短链，已停止展示。')
 return url.href
}
// Spoo's anonymous endpoint supports CORS. Submit only the URL, never cookies or tracing headers.
async function postRequest(provider,url,contentType,body,signal,fetcher,timeoutMs){
 if(typeof body!=='string'||new TextEncoder().encode(body).length>16384)throw new Error('短链接提交内容无效或过长。')
 const controller=new AbortController();let timedOut=false
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs)
 try{
  const response=await fetcher(url,{method:'POST',headers:{'Content-Type':contentType,Accept:'application/json'},body,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal})
  const max=256*1024;if(Number(response.headers.get('content-length'))>max){controller.abort();throw new Error(provider+' 响应过大，请稍后重试。')}
  const reader=response.body?.getReader();let source=''
  if(reader){const chunks=[];let length=0;try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){controller.abort();throw new Error(provider+' 响应过大，请稍后重试。')}chunks.push(value)}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}source=new TextDecoder().decode(bytes)}finally{reader.releaseLock()}}
  let data;try{data=JSON.parse(source)}catch{if(response.status===429)data={};else throw new Error(`${provider} 未返回有效 JSON（HTTP ${response.status}），请稍后重试。`)}
  return{data,status:response.status}
 }catch(error){if(signal?.aborted)throw new DOMException('已取消','AbortError');if(timedOut)throw new Error(provider+' 请求超过 15 秒，请稍后重试。');if(error instanceof TypeError)throw new Error('无法连接 '+provider+'，请检查网络或稍后重试。');throw error}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
// Both anonymous endpoints accept CORS requests without cookies.
export const spooRequest=(body,signal,fetcher=fetch,timeoutMs=15000)=>postRequest('spoo.me','https://spoo.me/api/v1/shorten','application/json',body,signal,fetcher,timeoutMs)
export const suoRequest=(body,signal,fetcher=fetch,timeoutMs=15000)=>postRequest('suo.yt','https://suo.yt/short','application/x-www-form-urlencoded;charset=UTF-8',body,signal,fetcher,timeoutMs)
