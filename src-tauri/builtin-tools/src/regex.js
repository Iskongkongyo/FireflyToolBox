import {$,status,text,copyButton,workerJob,operation} from './common.js'
export function mount({copyText,signal}){
  const templates=[['邮箱（常见格式）','[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'],['HTTPS 地址','https://[^\\s<>]+'],['中国大陆手机号','(?<!\\d)1[3-9]\\d{9}(?!\\d)'],['IPv4','\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b'],['整数','[+-]?\\d+'],['日期 YYYY-MM-DD','\\b\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])\\b'],['UUID','\\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\b'],['中文','[\\u4E00-\\u9FFF]+']];
  for(const[name,pattern]of templates){const button=text('button',name);button.onclick=()=>{$('pattern').value=pattern};$('templates').append(button)}
  for(const[flag,name]of [['g','全部匹配'],['i','忽略大小写'],['m','多行'],['s','点匹配换行'],['u','Unicode'],['y','粘连']]){const label=text('label',`${name} ${flag}`,'check'),input=document.createElement('input');input.type='checkbox';input.value=flag;input.checked=flag==='g';label.prepend(input);$('flags').append(label)}
  $('pattern').value='(\\w+)@(\\w+\\.\\w+)';$('input').value='hello@example.com\nadmin@test.org';$('replacement').value='$1';
  const op=operation(signal);$('cancel').onclick=()=>op.cancel();
  $('run').onclick=async()=>{const input=$('input').value;const job=op.start();$('run').disabled=true;$('cancel').hidden=false;$('results').hidden=true;status('正在匹配…');try{
    const result=await workerJob(REGEX_WORKER_SOURCE,{pattern:$('pattern').value,flags:[...$('flags').querySelectorAll('input:checked')].map(i=>i.value).join(''),input,replacement:$('replacement').value},job,1200);
    $('count').textContent=`${result.truncated?'至少 ':''}${result.matches.length} 条`;$('matches').replaceChildren();$('highlight').replaceChildren();let offset=0;
    for(const[index,item]of result.matches.entries()){const row=document.createElement('tr');for(const value of [index+1,`${item.index}–${item.end}`,item.text,JSON.stringify({groups:item.groups,named:item.named})])row.append(text('td',value));$('matches').append(row);$('highlight').append(document.createTextNode(input.slice(offset,item.index)),text('mark',input.slice(item.index,item.end)||'∅'));offset=item.end}
    $('highlight').append(document.createTextNode(input.slice(offset)));$('output').value=result.replacement??'';$('copy').disabled=result.replacement===null;$('results').hidden=false;status(result.truncated?'匹配过多，已截断；请缩小范围后查看完整替换结果。':`已找到 ${result.matches.length} 条匹配。`)
  }catch(error){status(error.name==='AbortError'?'已取消。':error.message,true)}finally{$('run').disabled=false;$('cancel').hidden=true}};
  copyButton('copy',()=>$('output').value,copyText);signal.addEventListener('abort',()=>op.dispose(),{once:true});return()=>op.dispose()
}
