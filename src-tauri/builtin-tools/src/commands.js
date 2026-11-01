import {$,text,status} from './common.js'
import {COMMAND_CATEGORIES,filterCommands} from './commands-data.js'
export function mount({copyText}){
 const notes={SQL:'示例以 SQLite / PostgreSQL 的基础语法为主，数据库差异会在卡片中注明。',ADB:'设备需启用调试并授权；多设备连接时可用 adb -s 序列号 指定设备。',Curl:'示例按 Bash 书写；Windows PowerShell 5.1 请使用 curl.exe，JSON 正文推荐从文件读取。',Python:'python 可按环境替换为 python3 或 py -3；虚拟环境的激活命令需与终端对应。',NPM:'项目相关命令需在 package.json 所在目录运行。'}
 let category='全部'
 for(const value of COMMAND_CATEGORIES){const b=text('button',value);b.onclick=()=>{category=value;render()};$('categories').append(b)}
 function render(){$('category-note').textContent=notes[category]||'';$('category-note').hidden=!notes[category];const values=filterCommands($('search').value,category);$('commands').replaceChildren();$('count').textContent=`${category} · ${values.length} 条命令`;$('empty').hidden=!!values.length;[...$('categories').children].forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===category)));for(const c of values){const card=text('article','','card command-card'),h=text('h2',c.title);h.append(text('span',c.category,'badge'));const syntax=text('code',c.syntax,'command-syntax'),code=text('pre',c.example,'command-example'),note=text('p',c.note,'hint'),actions=text('div','','actions');for(const [label,value]of [['复制示例',c.example],['复制语法',c.syntax],['复制文档地址',c.source]]){const b=text('button',label);b.onclick=async()=>{try{await copyText(value);status(`已复制${label.slice(2)}。`)}catch(e){status(e.message,true)}};actions.append(b)}card.append(h,text('p',c.description),syntax,text('p','示例','hint'),code,note,actions);$('commands').append(card)}}
 $('search').oninput=render;render()
}
