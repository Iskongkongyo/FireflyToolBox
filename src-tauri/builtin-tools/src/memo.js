import {$,status,text,operation} from './common.js'
import {loadState} from './life.js'
import {bytes,decodeFile,newId} from './utility.js'
import {persistentSaver} from './persistence-ui.js'
export function mount({copyText,openFile,saveFile,storage,signal}){
 const saver=persistentSaver(storage,signal)
 const saved=loadState('memo',{}),op=operation(signal);let notes=Array.isArray(saved.notes)?saved.notes.filter(n=>n&&typeof n.id==='string'&&typeof n.body==='string').slice(0,32):[],current=notes.some(n=>n.id===saved.current)?saved.current:notes[0]?.id,timer,dirty=false
 const note=()=>notes.find(n=>n.id===current)
 function commit(next=notes,id=current,label='已自动保存。'){void saver.write('memo',{notes:next,current:id},label);notes=next;current=id;dirty=false;capacity();renderList()}
 function capacity(){const used=bytes(JSON.stringify(Object.fromEntries(Array.from({length:localStorage.length},(_,index)=>{const key=localStorage.key(index);return[key,localStorage.getItem(key)]}))));$('capacity').textContent=`${notes.length} 篇 · 已用 ${(used/1024).toFixed(1)} / 1024 KiB（1 MiB）`}
 function flush(){clearTimeout(timer);if(!dirty||!current)return true;try{const next=notes.map(n=>n.id===current?{...n,title:$('title').value,body:$('body').value,updated:Date.now()}:n);commit(next);return true}catch(e){status(e.message,true);return false}}
 function show(){const n=note();$('title').value=n?.title??'';$('body').value=n?.body??'';for(const id of ['title','body','copy','export','delete'])$(id).disabled=!n;renderList();capacity()}
 function renderList(){$('notes').replaceChildren();const q=$('search').value.trim().toLowerCase();for(const n of [...notes].sort((a,b)=>b.updated-a.updated).filter(n=>`${n.title} ${n.body}`.toLowerCase().includes(q))){const button=text('button','','memo-note');button.classList.toggle('selected',n.id===current);button.append(text('strong',n.title||'未命名笔记'),text('small',n.body.slice(0,55)||'空白笔记'));button.onclick=()=>{if(!flush())return;try{commit(notes,n.id);show();status('')}catch(e){status(e.message,true)}};$('notes').append(button)}if(!$('notes').children.length)$('notes').append(text('p',notes.length?'没有匹配的笔记。':'还没有笔记。','hint'))}
 function create(title='',body=''){if(!flush())return;if(notes.length>=32){status('最多保存 32 篇，请先导出或删除部分笔记。',true);return}try{const n={id:newId(),title,body,updated:Date.now()};commit([...notes,n],n.id,'新笔记已保存。');show();status('')}catch(e){status(e.message,true)}}
 const input=()=>{dirty=true;flush()};$('title').oninput=input;$('body').oninput=input;$('title').onblur=flush;$('body').onblur=flush;$('search').oninput=renderList;$('new').onclick=()=>create()
 $('copy').onclick=async()=>{try{await copyText([$('title').value,$('body').value].filter(Boolean).join('\n'));status('已复制。')}catch(e){status(e.message,true)}}
 $('export').onclick=async()=>{try{const value=[$('title').value,$('body').value].filter(Boolean).join('\n');const saved=await saveFile(`${$('title').value||'备忘录'}.txt`,new Blob([value],{type:'text/plain;charset=utf-8'}),{signal:op.start()});if(!signal.aborted)status(saved?'文件已保存。':'已取消导出。')}catch(e){if(!signal.aborted)status(e.message,true)}}
 $('import').onclick=async()=>{if(!flush())return;try{const file=await openFile({extensions:['txt','md'],signal:op.start()});if(!file){status('已取消导入。');return}const value=await decodeFile(file.blob,48000,$('encoding').value);if(value.length>12000)throw new Error('笔记超过 12000 字符，请使用 Markdown 工具打开或分成多篇。');create(file.name.replace(/\.[^.]+$/,'').slice(0,60),value)}catch(e){if(!signal.aborted)status(e.message,true)}}
 $('delete').onclick=()=>{$('delete-confirm').hidden=false};$('cancel-delete').onclick=()=>{$('delete-confirm').hidden=true};$('confirm-delete').onclick=()=>{try{clearTimeout(timer);const next=notes.filter(n=>n.id!==current);commit(next,next[0]?.id,'笔记已删除。');$('delete-confirm').hidden=true;show();status('')}catch(e){status(e.message,true)}}
 show();return()=>{flush();saver.dispose();clearTimeout(timer);op.dispose()}
}
