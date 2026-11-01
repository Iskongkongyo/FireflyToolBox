import MarkdownIt from 'markdown-it'
import {imageSize} from './utility.js'
const md=new MarkdownIt({html:false,linkify:true,typographer:false})
md.core.ruler.after('inline','task-lists',state=>{for(let i=2;i<state.tokens.length;i++){const token=state.tokens[i],first=token.children?.[0];if(token.type!=='inline'||state.tokens[i-1].type!=='paragraph_open'||state.tokens[i-2].type!=='list_item_open'||first?.type!=='text')continue;const match=/^\[([ xX])\]\s+/.exec(first.content);if(!match)continue;first.content=first.content.slice(match[0].length);const checkbox=new state.Token('html_inline','',0);checkbox.content='<input class="md-task" type="checkbox" disabled'+(match[1].toLowerCase()==='x'?' checked':'')+' aria-label="任务状态"> ';token.children.unshift(checkbox)}})
const defaultImage=md.renderer.rules.image
md.renderer.rules.image=(tokens,index,options,env,self)=>{
 const src=tokens[index].attrGet('src')??''
 if(/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src)&&src.length<1500000){try{const raw=atob(src.slice(src.indexOf(',')+1,src.indexOf(',')+1+131072)),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),dims=imageSize(bytes.buffer);if(dims.width*dims.height<=4000000)return defaultImage(tokens,index,options,env,self)}catch{/* Show an inert placeholder for unsupported image data. */}}
 return `<span class="md-image-placeholder">图片：${md.utils.escapeHtml(tokens[index].content||'未命名图片')}（${md.utils.escapeHtml(src.slice(0,500))}）</span>`
}
export function renderMarkdown(source){if(new TextEncoder().encode(source).length>524288)throw new Error('预览最多支持 512 KiB；完整原文仍可保存。');const html=md.render(source);if(html.length>2000000)throw new Error('预览结果过大，请缩小或分段预览。');return html}
