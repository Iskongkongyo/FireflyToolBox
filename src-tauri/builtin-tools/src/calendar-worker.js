import {calendarData,lunarMonths,fromLunar} from './calendar-data.js'
self.onmessage=({data})=>{try{const result=data.action==='months'?lunarMonths(data.year):data.action==='lunar'?calendarData(fromLunar(data.year,data.month,data.day)):calendarData(data.date);self.postMessage({result})}catch(e){self.postMessage({error:e.message})}}
