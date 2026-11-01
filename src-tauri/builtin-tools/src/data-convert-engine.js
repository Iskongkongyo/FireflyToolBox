export function parseDelimited(text,delimiter=','){
 if(![',',';','\t','|'].includes(delimiter))throw new Error('分隔符无效。');text=text.replace(/^\uFEFF/,'');if(!text)return []
 const rows=[];let row=[],cell='',quoted=false,closed=false
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=ch;continue}
  if(ch==='"'){if(cell||closed)throw new Error('引号必须出现在字段开头。');quoted=true}else if(ch===delimiter){row.push(cell);cell='';closed=false}else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';closed=false}else{if(closed)throw new Error('结束引号后出现额外字符。');cell+=ch}
  if(rows.length>50000||row.length>200)throw new Error('最多 5 万行、200 列。')
 }
 if(quoted)throw new Error('字段引号未闭合。');if(cell||row.length||closed||!/[\r\n]$/.test(text)){row.push(cell);rows.push(row)}return rows
}
export function csvToJson(text,{delimiter=',',header=true}={}){const rows=parseDelimited(text,delimiter);if(!header)return rows;if(!rows.length)return [];const keys=rows.shift();if(keys.some(k=>!k)||new Set(keys).size!==keys.length)throw new Error('表头不能为空或重复。');return rows.map(row=>{if(row.length!==keys.length)throw new Error('各行列数与表头不一致。');return Object.fromEntries(keys.map((key,i)=>[key,row[i]]))})}
export function jsonToCsv(value,{delimiter=',',fields='',header=true}={}){
 if(![',',';','\t','|'].includes(delimiter))throw new Error('分隔符无效。')
 if(!Array.isArray(value)||value.length>50000)throw new Error('JSON 应为最多 5 万行的数组。');if(!value.length)return ''
 const arrays=Array.isArray(value[0]);if(value.some(row=>arrays?!Array.isArray(row):!row||typeof row!=='object'||Array.isArray(row)))throw new Error('行类型必须一致。')
 const keys=arrays?Array.from({length:Math.max(...value.map(row=>row.length))},(_,i)=>String(i)):fields.trim()?fields.split(',').map(k=>k.trim()):[...new Set(value.flatMap(row=>Object.keys(row)))]
 if(keys.length>200||new Set(keys).size!==keys.length)throw new Error('列数过多或选择字段重复。')
 const escape=value=>{const str=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);return str.includes(delimiter)||/["\r\n]/.test(str)?'"'+str.replaceAll('"','""')+'"':str}
 const lines=value.map(row=>keys.map(key=>escape(row[key])).join(delimiter));if(header&&!arrays)lines.unshift(keys.map(escape).join(delimiter));return lines.join('\r\n')
}
export function replaceRules(text,rules){
 if(!Array.isArray(rules)||rules.length>30)throw new Error('最多 30 条替换规则。');const report=[];let result=text
 for(const rule of rules){if(typeof rule.find!=='string'||!rule.find||typeof rule.replace!=='string')throw new Error('查找内容不能为空。');let count=0
  if(rule.regex){
   if(!/^[gimsu]*$/.test(rule.flags??'')||new Set(rule.flags??'').size!==(rule.flags??'').length)throw new Error('正则标志无效。');const flags=(rule.flags??'').includes('g')?rule.flags:(rule.flags??'')+'g',expression=new RegExp(rule.find,flags);let length=0,last=0
   result=result.replace(expression,(...args)=>{count++;const whole=args[0],groups=typeof args.at(-1)==='object'?args.pop():null,input=args.pop(),offset=args.pop();const value=rule.replace.replace(/\$\$|\$&|\$`|\$'|\$\d{1,2}|\$<[^>]+>/g,token=>{if(token==='$$')return '$';if(token==='$&')return whole;if(token==='$`')return input.slice(0,offset);if(token==="$'")return input.slice(offset+whole.length);if(token.startsWith('$<'))return groups?(groups[token.slice(2,-1)]??''):token;const index=Number(token.slice(1));if(index>0&&index<args.length)return args[index]??'';const first=Number(token[1]);if(token.length===3&&first>0&&first<args.length)return (args[first]??'')+token[2];return token});length+=offset-last+value.length;last=offset+whole.length;if(length>4*1048576)throw new Error('替换结果超过 4 MiB。');return value})
  }
  else{const parts=result.split(rule.find);count=parts.length-1;if(result.length-count*rule.find.length+count*rule.replace.length>4*1048576)throw new Error('替换结果超过 4 MiB。');result=parts.join(rule.replace)}
  if(new TextEncoder().encode(result).length>4*1048576)throw new Error('替换结果超过 4 MiB。');report.push(count)
 }return {text:result,counts:report}
}
