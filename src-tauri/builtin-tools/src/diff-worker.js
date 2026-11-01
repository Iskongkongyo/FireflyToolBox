import {diffLines} from 'diff'
export function compare(data){const changes=diffLines(data.before,data.after,{ignoreWhitespace:!!data.whitespace,ignoreCase:!!data.ignoreCase,stripTrailingCr:true,timeout:1600,maxEditLength:1800});if(!changes)throw new Error('差异过多或计算超时，请分段比较。');return {changes,added:changes.filter(c=>c.added).reduce((s,c)=>s+c.count,0),removed:changes.filter(c=>c.removed).reduce((s,c)=>s+c.count,0)}}
self.onmessage=({data})=>{try{self.postMessage({result:compare(data)})}catch(e){self.postMessage({error:e.message})}}
