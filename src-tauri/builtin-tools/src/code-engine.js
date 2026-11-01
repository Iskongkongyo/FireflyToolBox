import {format} from 'prettier/standalone'
import babel from 'prettier/plugins/babel'
import estree from 'prettier/plugins/estree'
import html from 'prettier/plugins/html'
import postcss from 'prettier/plugins/postcss'
import {minify as minifyJs} from 'terser'
import {minify as minifyCss} from 'csso'
import {minify as minifyHtml} from 'html-minifier-terser'
export async function transformCode(language,action,source,options={}){
 if(!['html','js','css'].includes(language)||!['format','minify'].includes(action))throw new Error('处理方式无效。')
 if(typeof source!=='string'||new TextEncoder().encode(source).length>1048576)throw new Error('输入代码最多 1 MiB。')
 if(!source.trim())throw new Error('请输入代码或导入文件。')
 const indent=Number(options.indent??2),width=Number(options.width??80)
 if(![2,4].includes(indent)||![80,100,120].includes(width))throw new Error('缩进或换行宽度无效。')
 let result
 if(action==='format')result=await format(source,{parser:{html:'html',js:'babel',css:'css'}[language],plugins:[babel,estree,html,postcss],tabWidth:indent,printWidth:width,useTabs:options.tabs===true,endOfLine:'lf',htmlWhitespaceSensitivity:'css',embeddedLanguageFormatting:'auto'})
 else if(language==='js')result=(await minifyJs(source,{module:options.module===true,compress:options.optimize===true,mangle:options.optimize===true,format:{comments:options.keepComments===true?'all':'some'}})).code
 else if(language==='css')result=minifyCss(source,{restructure:false,comments:'exclamation'}).css
 else result=await minifyHtml(source,{collapseWhitespace:true,conservativeCollapse:true,removeComments:options.keepComments!==true,removeOptionalTags:false,removeAttributeQuotes:false,removeEmptyAttributes:false,minifyJS:false,minifyCSS:false,decodeEntities:false,keepClosingSlash:true})
 if(typeof result!=='string'||new TextEncoder().encode(result).length>4194304)throw new Error('输出代码超过 4 MiB。')
 return result
}
