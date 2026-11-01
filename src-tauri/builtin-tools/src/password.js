import {$,text,status,copyButton} from './common.js'
import {loadState} from './life.js'
import {persist,newId} from './utility.js'
import {generatePassword,passwordStrength,cleanPasswordFavorites} from './password-data.js'
export function mount({copyText,signal}){
 let favorites=cleanPasswordFavorites(loadState('password.favorites',[])),disposed=false
 const save=next=>{persist('password.favorites',next);favorites=next;render()}
 function render(){$('favorite-visibility').textContent=$('show').checked?'密码已显示':'密码已遮挡';$('favorites').replaceChildren();$('favorite-empty').hidden=!!favorites.length;$('favorite-count').textContent=`${favorites.length} / 30`;for(const item of favorites){const card=text('article','','catalog-item'),title=text('strong',item.label),value=text('code',$('show').checked?item.value:'•'.repeat(item.value.length),'password-value'),actions=text('div','','actions');for(const[label,action]of [['使用',()=>{$('password').value=item.value;update();status('已填入收藏密码。')}],['复制',async()=>{await copyText(item.value);if(!disposed)status('已复制收藏密码。')}],['删除',()=>{save(favorites.filter(v=>v.id!==item.id));status('已删除收藏。')} ]]){const b=text('button',label);b.onclick=async()=>{try{await action()}catch(e){if(!disposed)status(e.message,true)}};actions.append(b)}card.append(title,value,actions);$('favorites').append(card)}}
 function update(){const value=$('password').value,s=passwordStrength(value);$('strength').value=s.score;$('strength-label').textContent=s.level;$('strength-info').textContent=value?`${s.length} 位 · ${s.classes} 类字符${s.tips.length?' · '+s.tips.join('；'):''}`:'';$('copy').disabled=!value;$('favorite').disabled=s.length<6||s.length>32}
 $('length').oninput=()=>{const n=Number($('length').value);if(Number.isInteger(n)&&n>=6&&n<=32)$('length-slider').value=n};$('length-slider').oninput=()=>{$('length').value=$('length-slider').value}
 $('password').oninput=update;$('show').onchange=()=>{$('password').type=$('show').checked?'text':'password';render()}
 $('generate').onclick=()=>{try{$('password').value=generatePassword({length:$('length').value,...Object.fromEntries(['digits','lower','upper','symbols','exclude'].map(id=>[id,$(id).checked]))});update();status('密码已生成。')}catch(e){status(e.message,true)}}
 copyButton('copy',()=>$('password').value,copyText)
 $('favorite').onclick=()=>{try{const value=$('password').value;if([...value].length<6||[...value].length>32)throw new Error('仅收藏 6～32 位密码。');if(favorites.some(v=>v.value===value))throw new Error('这个密码已经收藏。');if(favorites.length>=30)throw new Error('最多收藏 30 个密码，请先删除不需要的收藏。');save([{id:newId(),value,label:$('label').value.trim()||'未命名'},...favorites]);status('密码已收藏。')}catch(e){status(e.message,true)}}
 render();update();signal?.addEventListener('abort',()=>{disposed=true},{once:true});return()=>{disposed=true;$('password').value='';favorites=[]}
}
