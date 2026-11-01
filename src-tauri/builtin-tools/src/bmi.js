import {$,status,copyButton} from './common.js'
import {bmi} from './practical.js'
export function mount({copyText}) {
 let result=''
 const invalidate=()=>{result='';$('results').hidden=true;$('copy').disabled=true;status('')}
 const calculate=()=>{try{const data=bmi($('height').value,$('weight').value,$('unit').value);$('bmi-value').textContent=data.value.toFixed(2);$('category').textContent=data.category;const range=`该身高对应的正常体重范围：${data.lower.toFixed(1)} kg 至小于 ${data.upper.toFixed(1)} kg（约值）。`;$('range').textContent=range;result=`身高：${$('height').value} cm\n体重：${data.kg} kg\nBMI：${data.value.toFixed(2)}（${data.category}）\n${range}\n参考：中国成人标准；分类按未舍入值判定。`;$('results').hidden=false;$('copy').disabled=false;status('计算完成。')}catch(e){invalidate();status(e.message,true)}}
 $('calculate').onclick=calculate;for(const id of ['height','weight','unit']){$(id).oninput=invalidate;$(id).onkeydown=e=>{if(e.key==='Enter')calculate()}}
 $('clear').onclick=()=>{$('height').value='';$('weight').value='';invalidate();$('height').focus()};copyButton('copy',()=>result,copyText)
}
