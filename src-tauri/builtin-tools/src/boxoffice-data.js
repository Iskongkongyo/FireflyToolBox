export const boxSources=[{name:'60s · 7se',url:'https://60s.7se.cn/v2/maoyan/realtime/movie'},{name:'60s · crystelf',url:'https://60s.crystelf.top/v2/maoyan/realtime/movie'}]
export function parseBoxOffice(payload){
 if(payload?.code!==200||!payload.data?.movie?.list)throw new Error('票房数据源暂时不可用。')
 const data=payload.data.movie;if(!Array.isArray(data.list)||!data.list.length)throw new Error('没有可显示的票房数据。')
 const rows=data.list.slice(0,50).map((item,index)=>({rank:index+1,name:String(item.movie_name??'').slice(0,100),box:String(item.box_office_desc??`${item.box_office??'—'}${item.box_office_unit??''}`),rate:String(item.box_office_rate??'—'),shows:String(item.show_count??'—'),showRate:String(item.show_count_rate??'—'),seats:String(item.avg_seat_view??'—'),total:String(item.sum_box_desc??'—'),release:String(item.release_info??'')})).filter(item=>item.name)
 if(!rows.length)throw new Error('票房数据格式已变化。')
 return {rows,total:`${data.box_office??'—'}${data.box_office_unit??''}`,title:String(data.title??'实时票房'),sourceTime:String(data.updated??''),time:Number(data.updated_at)||null,views:String(data.view_count_desc??'—'),shows:String(data.show_count_desc??'—')}
}
