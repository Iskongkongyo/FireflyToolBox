export function radixConvert(value,from,to){
  const digits='0123456789abcdefghijklmnopqrstuvwxyz';from=Number(from);to=Number(to);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<2||from>36||to<2||to>36)throw new Error('进制须为 2 到 36 的整数。');
  let raw=value.trim().toLowerCase(),negative=false;if(raw[0]==='-'||raw[0]==='+'){negative=raw[0]==='-';raw=raw.slice(1)}
  for(const[prefix,base]of [['0b',2],['0o',8],['0x',16]]){if(raw.startsWith(prefix)&&from===base)raw=raw.slice(2)}
  if(!raw||raw.length>4096)throw new Error('请输入不超过 4096 位的整数；暂不支持小数。');
  let number=0n;for(const ch of raw){const digit=digits.indexOf(ch);if(digit<0||digit>=from)throw new Error(`字符“${ch}”不属于 ${from} 进制。`);number=number*BigInt(from)+BigInt(digit)}
  if(negative)number=-number;return {output:number.toString(to),binary:number.toString(2),octal:number.toString(8),decimal:number.toString(10),hex:number.toString(16).toUpperCase()}
}
export function regexTest({pattern,flags,input,replacement}){
  if(pattern.length>2048||input.length>262144||replacement.length>2048)throw new Error('表达式、测试文本或替换文本过长。');
  const literal=pattern.match(/^\/([\s\S]*)\/([gimsuy]*)$/);if(literal){pattern=literal[1];flags=literal[2]}
  const regex=new RegExp(pattern,flags),matches=[];let match,truncated=false,output='',cursor=0;
  function append(value){if(output.length+value.length>1048576)throw new Error('替换结果超过 1 MiB，请缩小输入或替换文本。');output+=value}
  while((match=regex.exec(input))){
    if(matches.length>=200){truncated=true;break}if(match.length>21)throw new Error('最多支持 20 个捕获组。');
    matches.push({index:match.index,end:match.index+match[0].length,text:match[0].slice(0,256),groups:match.slice(1).map(v=>v===undefined?null:v.slice(0,256)),named:Object.fromEntries(Object.entries(match.groups??{}).map(([key,value])=>[key,value?.slice(0,256)??null]))});
    append(input.slice(cursor,match.index));
    let replacementSize=0;const bounded=value=>{replacementSize+=value.length;if(replacementSize>1048576)throw new Error('替换结果超过 1 MiB，请缩小输入或替换文本。');return value};
    const expanded=replacement.replace(/\$([$&`']|\d{1,2}|<[^>]+>)/g,(token,key)=>{
      if(key==='$')return bounded('$');if(key==='&')return bounded(match[0]);if(key==='`')return bounded(input.slice(0,match.index));if(key==="'")return bounded(input.slice(match.index+match[0].length));
      if(key.startsWith('<'))return bounded(match.groups?match.groups[key.slice(1,-1)]??'':token);
      const n=Number(key);if(n>0&&n<match.length)return bounded(match[n]??'');if(key.length===2&&Number(key[0])>0&&Number(key[0])<match.length)return bounded((match[Number(key[0])]??'')+key[1]);return bounded(token);
    });append(expanded);cursor=match.index+match[0].length;
    if(!regex.global)break;if(match[0]==='')regex.lastIndex+=(regex.unicode&&input.codePointAt(regex.lastIndex)>0xffff)?2:1;
  }
  if(!truncated)append(input.slice(cursor));return {matches,truncated,replacement:truncated?null:output}
}
