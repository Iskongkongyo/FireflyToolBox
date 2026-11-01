import {$,status,text,operation} from './common.js'
import {jsonRequest} from './life.js'
import {publicPrompts,publicSkills,navigation} from './ai-data.js'
export function mount({request,copyText,openWebsite,signal}){
 const op=operation(signal);let tab='prompts',rows=[],busy=false,requestSequence=0
 const show=()=>{
  $('list').replaceChildren()
  for(const row of rows){const item=text('article','','card');item.append(text('h2',row.name),text('p',row.description??'','hint'),text('p',row.source??'','hint'));if(row.content){const details=document.createElement('details'),summary=text('summary','查看提示词'),body=text('pre',row.content);body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto';details.append(summary,body);item.append(details)}const actions=text('div','','actions');if(row.content){const copy=text('button','复制提示词');copy.onclick=async()=>{try{await copyText(row.content);status('提示词已复制。')}catch(error){status(error.message,true)}};actions.append(copy)}if(row.url){const open=text('button','打开来源');open.onclick=async()=>{try{await openWebsite(row.url,{title:row.name})}catch(error){status(error.message,true)}};actions.append(open)}item.append(actions);$('list').append(item)}
 }
 async function load(){if(busy)return;if(tab==='navigation'){rows=navigation.map(([name,description,url])=>({name,description,url,source:'网站入口'}));show();$('refresh').disabled=false;status('选择网站，查看对应资源。');return}busy=true;$('refresh').disabled=true;const current=op.start(),sequence=++requestSequence;status('正在读取公开数据…');try{
  let fresh;if(tab==='prompts')fresh=publicPrompts(await jsonRequest(request,'https://prompts.chat/api/prompts?type=TEXT&perPage=24&sort=popular&page=1',current))
  else fresh=publicSkills(await jsonRequest(request,'https://api.github.com/repos/openai/skills/contents/skills/.curated',current))
  if(current.aborted||sequence!==requestSequence)return;rows=fresh;show();status(`已获取 ${rows.length} 条 · ${new Date().toLocaleString()}`)
 }catch(error){if(sequence===requestSequence)status(error.name==='AbortError'?'已取消。':'数据暂时无法获取：'+error.message,true)}finally{if(sequence===requestSequence){busy=false;if(!signal.aborted)$('refresh').disabled=false}}}
 for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{requestSequence++;op.cancel();busy=false;tab=button.dataset.tab;rows=[];show();for(const node of document.querySelectorAll('[data-tab]'))node.classList.toggle('selected',node===button);void load()}
 $('refresh').onclick=()=>void load();void load();return()=>op.dispose()
}
