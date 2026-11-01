import {$,status,copyButton} from './common.js'
import {session} from './image-runtime.js'
import {GITHUB_PROVIDERS,githubDownload} from './github-download-data.js'
export function mount({copyText,openWebsite,signal}){
 let result=null;const job=session(signal,update)
 function update(){for(const id of ['copy','open','original'])$(id).disabled=job.busy||!result}
 function invalidate(){result=null;$('output').value='';$('details').textContent='';status('');update()}
 function providerChanged(){invalidate();const provider=GITHUB_PROVIDERS.find(item=>item.id===$('provider').value);$('cdn-settings').hidden=!provider.cdn;$('provider-hint').textContent=provider.cdn?'转换 GitHub / Raw 仓库文件；Release 附件和源码 ZIP 请选下面两种代理服务。':'在服务地址后直接拼接原始 GitHub 链接，可用于 Release 附件、源码压缩包或 Raw 文件。'}
 $('provider').oninput=providerChanged;for(const id of ['url','ref','path'])$(id).oninput=invalidate
 $('generate').onclick=()=>{invalidate();try{result=githubDownload($('provider').value,$('url').value,{ref:$('ref').value,path:$('path').value});$('output').value=result.url;$('details').textContent=result.provider+' · '+result.kind+'\n'+result.hint;status('加速链接已生成。');update()}catch(error){status(error.message,true)}}
 $('url').onkeydown=event=>{if(event.key==='Enter')$('generate').click()}
 $('open').onclick=()=>void job.run(async current=>{if(!result)return;await openWebsite(result.url,{title:'GitHub 下载 · '+result.provider,external:true});if(!current.aborted)status('已交给系统浏览器处理下载。')})
 $('original').onclick=()=>void job.run(async current=>{if(!result)return;await openWebsite(result.original,{title:'GitHub 原链接',external:true});if(!current.aborted)status('已在系统浏览器打开原链接。')})
 $('clear').onclick=()=>{for(const id of ['url','ref','path'])$(id).value='';invalidate();status('已清空。')};$('cancel').onclick=()=>job.cancel();copyButton('copy',()=>result?.url??'',copyText);providerChanged();return()=>job.dispose()
}
