export const GITHUB_PROVIDERS=[
 {id:'jsdelivr',name:'jsDelivr',prefix:'https://cdn.jsdelivr.net/gh/',cdn:true},
 {id:'statically',name:'Statically',prefix:'https://cdn.statically.io/gh/',cdn:true},
 {id:'pd',name:'pd.zwc365.com',prefix:'https://pd.zwc365.com/'},
 {id:'ghfast',name:'ghfast.top',prefix:'https://ghfast.top/'}
]
const sources=['github.com','raw.githubusercontent.com','codeload.github.com']
function decoded(value){try{return decodeURIComponent(value)}catch{throw new Error('链接包含无效的百分号编码。')}}
export function githubAddress(value){
 let url;try{url=new URL(String(value).trim())}catch{throw new Error('请输入完整的 GitHub HTTPS 链接。')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!sources.includes(url.hostname)||url.href.length>4096)throw new Error('仅支持 github.com、raw.githubusercontent.com 或 codeload.github.com 的 HTTPS 链接。')
 if(url.pathname.split('/').filter(Boolean).length<2)throw new Error('链接须包含用户名和仓库名。')
 return url
}
function filePath(value){const parts=String(value).replace(/^\/+/, '').split('/');if(parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\\]/.test(part)))throw new Error('请填写有效的仓库内文件路径，使用 / 分隔目录。');return parts.map(encodeURIComponent).join('/')}
export function githubDownload(providerId,value,options={}){
 const provider=GITHUB_PROVIDERS.find(item=>item.id===providerId);if(!provider)throw new Error('请选择有效的加速服务。')
 const source=githubAddress(value)
 if(!provider.cdn){const url=provider.prefix+source.href;if(url.length>4096)throw new Error('加速链接过长，请缩短原链接。');return {url,original:source.href,provider:provider.name,kind:'代理链接',hint:'原链接已拼接到服务地址后。文件下载与服务可用性取决于所选线路。'}}
 const parts=source.pathname.split('/').filter(Boolean).map(decoded),owner=parts[0],repo=source.hostname==='github.com'&&parts.length===2?parts[1].replace(/\.git$/i,''):parts[1]
 if(!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner)||! /^[a-z0-9_.-]{1,100}$/i.test(repo))throw new Error('GitHub 用户名或仓库名无效。')
 let tail=[],kind='仓库地址',directory=false
 if(source.hostname==='raw.githubusercontent.com'){tail=parts.slice(2);if(tail[0]==='refs'&&['heads','tags'].includes(tail[1]))tail=tail.slice(2);kind='Raw 文件'}
 else if(source.hostname==='github.com'&&['blob','raw','tree'].includes(parts[2])){tail=parts.slice(3);directory=parts[2]==='tree';kind=directory?'仓库目录':'仓库文件'}
 else if(source.hostname!=='github.com'||parts.length>2)throw new Error('CDN 仅支持仓库文件；Release 附件或源码 ZIP 请选 pd.zwc365.com 或 ghfast.top。')
 const override=String(options.ref??'').trim(),manualPath=String(options.path??'').trim(),joined=tail.join('/')
 let ref=override||tail[0]||'',path=manualPath||(directory?'':override&&joined.startsWith(override+'/')?joined.slice(override.length+1):tail.slice(1).join('/'))
 if(!ref||!path)throw new Error('请填写分支 / 标签 / 提交和仓库内文件路径，或粘贴完整的文件链接。')
 if(ref.length>255||/[\x00-\x20\\?#]/.test(ref)||ref.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('版本或分支名无效。')
 const url=provider.prefix+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'@'+encodeURIComponent(ref)+'/'+filePath(path)+source.search+source.hash
 if(url.length>4096)throw new Error('加速链接过长，请缩短版本或文件路径。')
 return {url,original:source.href,provider:provider.name,kind,hint:`仓库：${owner}/${repo} · 版本：${ref} · 文件：${path}`}
}
