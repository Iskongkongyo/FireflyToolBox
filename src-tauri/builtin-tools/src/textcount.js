import {$,status,workerJob,text} from './common.js'
const labels={total:'总字符（码点）',withoutSpaces:'不含空格',withoutWhitespace:'不含所有空白',visible:'可见字符簇',lines:'行数',nonemptyLines:'非空行',breaks:'换行次数',englishWords:'英文字词',utf16:'UTF-16 单元',utf8:'UTF-8 字节'}
const typeLabels={han:'汉字',latin:'拉丁字母',otherLetters:'其他语言字母',digits:'数字',spaces:'普通空格',otherSpaces:'其他空格（含全角）',tabs:'制表符',newlines:'换行字符',controls:'其他控制字符',punctuation:'标点',symbols:'符号（含 Emoji 码点）',other:'其他（含组合符）'}
export function mount({copyText,openFile,signal}){
 let timer,controller,result,disposed=false
 function show(data){result=data;for(const [id,label]of Object.entries(labels))$(id).textContent=data[id].toLocaleString();$('types').replaceChildren(...Object.entries(typeLabels).map(([key,label])=>{const item=text('div','','card');item.append(text('strong',data.counts[key].toLocaleString()),text('p',label,'hint'));return item}));status('已更新统计。')}
 async function update(){controller?.abort();controller=new AbortController();const current=controller;const value=$('input').value;if(new TextEncoder().encode(value).length>2*1048576){status('文本最多 2 MiB。',true);return}try{const data=await workerJob(TEXTCOUNT_WORKER_SOURCE,{text:value},current.signal,15000);if(!disposed&&controller===current)show(data)}catch(error){if(error.name!=='AbortError')status(error.message,true)}}
 $('input').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>void update(),150)}
 $('clear').onclick=()=>{$('input').value='';void update()}
 $('import').onclick=async()=>{try{const file=await openFile({extensions:['txt','md','csv','json'],signal});if(!file)return;if(file.blob.size>2*1048576)throw new Error('文本最多 2 MiB。');$('input').value=await file.blob.text();void update()}catch(error){status(error.message,true)}}
 $('copy').onclick=async()=>{if(!result)return;try{await copyText([...Object.entries(labels).map(([key,label])=>`${label}：${result[key]}`),...Object.entries(typeLabels).map(([key,label])=>`${label}：${result.counts[key]}`)].join('\n'));status('统计已复制。')}catch(error){status(error.message,true)}}
 void update();return()=>{disposed=true;clearTimeout(timer);controller?.abort()}
}
