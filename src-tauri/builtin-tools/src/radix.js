import {$,status,text,copyButton} from './common.js'
import {radixConvert} from './algorithms.js'
export function mount({copyText}){
  for(const id of ['from','to'])for(let i=2;i<=36;i++){const option=text('option',`${i} 进制`);option.value=i;$(id).append(option)}$('from').value='10';$('to').value='16';$('input').value='255';
  const clear=()=>{$('output').value='';status('')};$('input').oninput=clear;$('from').onchange=clear;$('to').onchange=clear;
  const run=()=>{try{const result=radixConvert($('input').value,$('from').value,$('to').value);$('output').value=result.output;status('已转换。')}catch(error){clear();status(error.message,true)}};
  $('swap').onclick=()=>{const from=$('from').value;$('from').value=$('to').value;$('to').value=from;if($('output').value){$('input').value=$('output').value;run()}else clear()};
  $('run').onclick=run;
  copyButton('copy',()=>$('output').value,copyText);run()
}
