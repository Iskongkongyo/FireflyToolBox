export const $ = id => document.getElementById(id)
export function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error)}
export function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node}
export function copyButton(id,getText,copyText){$(id).onclick=async()=>{try{const value=getText();if(!value){status('请先生成或读取结果。');return}await copyText(value);status('已复制。')}catch(error){status(error.message||String(error),true)}}}
export function size(value){if(value<1024)return `${value} B`;if(value<1048576)return `${(value/1024).toFixed(1)} KiB`;return `${(value/1048576).toFixed(2)} MiB`}
export function httpsURL(value){const raw=value.trim();if(!raw)throw new Error('请输入域名或 HTTPS 地址。');let url;try{url=new URL(/^[a-z]+:\/\//i.test(raw)?raw:`https://${raw}`)}catch{throw new Error('地址格式无效，请填写域名或完整 HTTPS 地址。')}if(url.protocol!=='https:'||url.username||url.password)throw new Error('仅支持不含账号信息的 HTTPS 地址。');return url}
export function workerJob(source,data,signal,timeout=1500,transfer=[]){
  return new Promise((resolve,reject)=>{if(signal?.aborted){reject(new DOMException('已取消','AbortError'));return}const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));let worker;try{worker=new Worker(url)}catch(error){URL.revokeObjectURL(url);reject(error);return}URL.revokeObjectURL(url);
    const finish=(error,result)=>{clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result)};
    const abort=()=>finish(new DOMException('已取消','AbortError'));const timer=setTimeout(()=>finish(new Error('计算耗时过长，已中断。请缩小输入或简化表达式。')),timeout);
    signal?.addEventListener('abort',abort,{once:true});worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data.result);worker.onerror=()=>finish(new Error('计算失败，请检查输入或设备兼容性。'));worker.postMessage(data,transfer);
  })
}
export function operation(signal){let controller;return{start(){controller?.abort();controller=new AbortController();if(signal?.aborted)controller.abort();return controller.signal},cancel(){controller?.abort()},dispose(){controller?.abort()}}}
