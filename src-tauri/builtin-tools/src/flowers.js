import {$,text,status} from './common.js'
import {FLOWER_CATEGORIES,filterFlowers,flowerSummary} from './flowers-data.js'
export function mount({copyText}){
 let category='全部'
 for(const value of FLOWER_CATEGORIES){const b=text('button',value);b.onclick=()=>{category=value;render()};$('categories').append(b)}
 function render(){const values=filterFlowers($('search').value,category,$('season').value);$('flowers').replaceChildren();$('count').textContent=`找到 ${values.length} 种花卉`;$('empty').hidden=!!values.length;[...$('categories').children].forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===category)));for(const f of values){const card=text('article','','card flower-card'),heading=text('div','','flower-heading'),symbol=text('span',f.name.slice(0,1),'flower-symbol'),title=text('h2',f.name);heading.append(symbol,title);card.append(heading,text('p',f.categories.join(' · '),'hint'),text('p',f.meaning));const list=text('dl','','meta');for(const [k,v]of [['常见颜色',f.colors],['自然花期',f.bloom],['花店供应',f.supply]])list.append(text('dt',k),text('dd',v));const seasons=text('div','','flower-seasons');f.seasons.forEach((v,i)=>{const n=text('span',`${['春','夏','秋','冬'][i]} · ${v==='常'?'常见':v==='季'?'季节性':'较少'}`);n.dataset.supply=v;seasons.append(n)});const copy=text('button','复制花语','mobile-full-row');copy.onclick=async()=>{try{await copyText(flowerSummary(f));status(`已复制${f.name}的花语。`)}catch(e){status(e.message,true)}};card.append(list,seasons,copy);$('flowers').append(card)}}
 $('search').oninput=render;$('season').onchange=render;render()
}
