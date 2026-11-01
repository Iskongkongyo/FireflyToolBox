export function loadState(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
export function saveState(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Storage may be full; this session still works. */}}
export function randomIndex(count,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]){
  if(!Number.isInteger(count)||count<2||count>24)throw new Error('请设置 2 到 24 个选项。')
  const bound=2**32-(2**32%count);let value
  do{value=random()}while(value>=bound)
  return value%count
}
export function wheelTarget(rotation,index,count){const step=360/count,target=(360-(index+.5)*step)%360;return rotation+360*6+((target-rotation%360+360)%360)}
export function remainingSeconds(state,now=Date.now()){return state.running?Math.max(0,Math.ceil((state.deadline-now)/1000)):state.remaining}
export function nextPhase(phase,completed,cycles){return phase==='focus'?(completed>0&&completed%cycles===0?'long':'short'):'focus'}
export function scoreChange(teams,index,delta){return teams.map((team,i)=>i===index?{...team,score:Math.max(-999999,Math.min(999999,team.score+delta))}:{...team})}
export function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}}
export function plainHTML(value){const template=document.createElement('template');template.innerHTML=String(value??'');template.content.querySelectorAll('script,style').forEach(node=>node.remove());return template.content.textContent.trim()}
export async function jsonRequest(request,url,signal){const response=await request(url,{signal});if(!response.ok)throw new Error(`来源返回 HTTP ${response.status}，请稍后重试。`);try{return await response.json()}catch{throw new Error('来源返回了无法解析的数据，请稍后重试。')}}
export function buttonLink(node,url,copyText,status){const link=safeLink(url);node.disabled=!link;node.onclick=async()=>{try{await copyText(link);status('链接已复制，可在浏览器中打开。')}catch(e){status(e.message,true)}}}
