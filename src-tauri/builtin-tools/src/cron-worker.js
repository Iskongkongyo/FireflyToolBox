import {CronExpressionParser} from 'cron-parser/dist/CronExpressionParser.js'
self.onmessage=({data})=>{try{
  const expression=data.expression.trim();if(expression.length>200||/\bH\b/i.test(expression))throw new Error('表达式过长或包含不支持的 H 随机字段。');
  if(!expression.startsWith('@')&&![5,6].includes(expression.split(/\s+/).length))throw new Error('请输入 5 字段或带秒的 6 字段表达式，不支持 Quartz 年份字段。');
  new Intl.DateTimeFormat('zh-CN',{timeZone:data.tz});
  const interval=CronExpressionParser.parse(expression,{currentDate:data.start||new Date(),tz:data.tz}),canonical=interval.stringify(true),dates=[];
  for(let i=0;i<Math.min(20,Math.max(1,Number(data.count)||10));i++){dates.push(interval.next().toDate().toISOString())}
  self.postMessage({result:{canonical,dates}})
}catch(error){self.postMessage({error:error.message})}}
