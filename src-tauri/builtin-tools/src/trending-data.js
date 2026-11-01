import {safeLink} from './life.js'
export const providers=[
 {id:'baidu',name:'百度',url:'https://top.baidu.com/api/board?platform=pc&tab=realtime',home:'https://top.baidu.com/board?tab=realtime',metric:'热度'},
 {id:'weibo',name:'微博',url:'https://weibo.com/ajax/side/hotSearch',home:'https://s.weibo.com/top/summary?cate=realtimehot',metric:'热度'},
 {id:'douyin',name:'抖音',url:'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',home:'https://www.douyin.com/hot',metric:'热度'},
 {id:'toutiao',name:'头条',url:'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',home:'https://www.toutiao.com/',metric:'热度'},
 {id:'zhihu',name:'知乎',url:'https://api.zhihu.com/topstory/hot-lists/total?limit=50',home:'https://www.zhihu.com/hot',metric:'热度'},
 {id:'bilibili',name:'B站',url:'https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1',home:'https://www.bilibili.com/v/popular/all',metric:'播放'},
 {id:'tieba',name:'贴吧',url:'https://tieba.baidu.com/hottopic/browse/topicList',home:'https://tieba.baidu.com/hottopic/browse/hottopic',metric:'讨论'}
]
export function parseTrending(id,payload){
 let rows=[]
 switch(id){
  case 'baidu':rows=payload.data?.cards?.[0]?.content??[];if(rows[0]?.content)rows=rows[0].content;rows=rows.map(x=>({title:x.word??x.query??x.title,hot:x.hotScore,url:x.url??x.appUrl}));break
  case 'weibo':rows=(payload.data?.realtime??[]).filter(x=>!x.is_ad).map(x=>({title:x.word??x.note,hot:x.num,url:`https://s.weibo.com/weibo?q=${encodeURIComponent(x.word??x.note??'')}`}));break
  case 'douyin':rows=(payload.word_list??[]).map(x=>({title:x.word,hot:x.hot_value,url:`https://www.douyin.com/search/${encodeURIComponent(x.word)}`}));break
  case 'toutiao':rows=(payload.data??[]).map(x=>({title:x.Title,hot:x.HotValue,url:x.Url??`https://www.toutiao.com/trending/${x.ClusterIdStr??x.ClusterId}/`}));break
  case 'zhihu':rows=(payload.data??[]).map(x=>({title:x.target?.title,hot:x.detail_text,url:`https://www.zhihu.com/question/${x.target?.url?.match(/questions\/(\d+)/)?.[1]??x.target?.id??''}`}));break
  case 'bilibili':rows=(payload.data?.list??[]).map(x=>({title:x.title,hot:x.stat?.view,url:`https://www.bilibili.com/video/${x.bvid??''}`}));break
  case 'tieba':rows=(payload.data?.bang_topic?.topic_list??[]).map(x=>({title:x.topic_name,hot:x.discuss_num,url:x.topic_url}));break
 }
 const result=rows.filter(x=>typeof x.title==='string'&&x.title.trim()).slice(0,50).map((x,i)=>({rank:i+1,title:x.title.slice(0,300),hot:String(x.hot??''),url:safeLink(x.url)}))
 if(!result.length)throw new Error('来源暂未返回可用榜单，可能需要登录或正在限流。')
 return result
}
export function hotValue(value){const number=Number(value);return !Number.isFinite(number)||value===''?value:number>=1e8?`${(number/1e8).toFixed(1)} 亿`:number>=1e4?`${(number/1e4).toFixed(1)} 万`:String(number)}
