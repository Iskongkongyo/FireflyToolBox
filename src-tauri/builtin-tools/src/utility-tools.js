import {$,status,text,workerJob} from './common.js'
import {unitGroups,convertUnit} from './units-data.js'
import {calculate} from './math-engine.js'
import {loadState,saveState} from './life.js'
export function mount({copyText,openFile,saveFile,signal}){
 const mode=$('utility-tool').dataset.mode,calculator=mode==='math.calculate';let result='',controller,busy=false,disposed=false,answer=0,history=loadState('history',[])
 if(!Array.isArray(history))history=[];history=history.filter(item=>item&&typeof item.expression==='string'&&item.expression.length<=512&&['string','number'].includes(typeof item.result)&&String(item.result).trim()&&Number.isFinite(Number(item.result))).slice(0,20)
 if(calculator){$('utility-tool').classList.add('calculator-tool');$('utility-actions').hidden=true;$('utility-result').hidden=true;$('process').textContent='计算 =';$('copy').textContent='复制结果';$('save').textContent='保存结果';$('calculator-actions').append($('process'),$('copy'),$('save'));$('calculator-status').append($('status'))}
 for(const key of ['units','calculator','replace','data'])$(key+'-settings').hidden=mode!==({units:'unit.convert',calculator:'math.calculate',replace:'text.replace',data:'data.convert'}[key])
 const update=()=>{for(const el of document.querySelectorAll('button,input,select,textarea'))el.disabled=busy;$('copy').disabled=busy||!result;$('save').disabled=busy||!result;$('clear-history').disabled=busy||!history.length;$('cancel').hidden=!busy;$('cancel').disabled=false}
 const show=value=>{result=value;$('output').value=value;if(calculator)$('calculator-result').textContent=value||'—';update()}
 function choices(select,items){select.replaceChildren(...Object.entries(items).map(([value,item])=>{const option=document.createElement('option');option.value=value;option.textContent=Array.isArray(item)?item[0]:item.name;return option}))}
 choices($('group'),unitGroups)
 function units(){const group=unitGroups[$('group').value];choices($('from'),group.units);choices($('to'),group.units);$('to').selectedIndex=Math.min(1,$('to').options.length-1);convert()}
 function convert(){try{show(String(Number(convertUnit($('group').value,$('from').value,$('to').value,$('number').value).toPrecision(12))));status('已换算，结果按 12 位有效数字显示。')}catch(error){show('');status(error.message,true)}}
 $('group').onchange=units;for(const id of ['from','to','number'])$(id).oninput=convert;$('swap').onclick=()=>{const from=$('from').value;$('from').value=$('to').value;$('to').value=from;convert()}
 function renderHistory(){$('history-empty').hidden=!!history.length;$('clear-history').disabled=!history.length;$('history').replaceChildren(...history.map(item=>{const button=text('button','','calculator-history-item'),angleKnown=['deg','rad'].includes(item.angleUnit);button.append(text('span',item.expression,'calculator-history-expression'),text('strong',String(item.result)),text('small',angleKnown?(item.angleUnit==='rad'?'RAD 弧度':'DEG 角度'):'旧记录未保存角度单位','hint'));button.onclick=()=>{$('expression').value=item.expression;if(angleKnown)$('angle-unit').value=item.angleUnit;answer=Number(item.result);show(String(item.result));status(angleKnown?'已恢复这条计算记录。':'已恢复历史结果；旧记录未保存角度单位，请按原计算方式选择。')};return button}))}
 $('clear-history').onclick=()=>{history=[];saveState('history',history);renderHistory()}
 async function process(){if(busy)return;if(mode==='unit.convert'){convert();return}if(mode==='math.calculate'){try{answer=calculate($('expression').value,{degrees:$('angle-unit').value==='deg',ans:answer});show(String(Number(answer.toPrecision(14))));history.unshift({expression:$('expression').value,result,angleUnit:$('angle-unit').value});history=history.slice(0,20);saveState('history',history);renderHistory();status('计算完成。')}catch(error){show('');status(error.message,true)}return}
  busy=true;controller=new AbortController();const abort=()=>controller?.abort();signal.addEventListener('abort',abort,{once:true});update();try{
   const input=$('input').value;if(new TextEncoder().encode(input).length>2*1048576)throw new Error('输入最多 2 MiB。')
   const rules=mode==='text.replace'?JSON.parse($('rules').value):null,data=await workerJob(UTILITY_WORKER_SOURCE,{mode,text:input,rules,direction:$('direction').value,options:{delimiter:$('delimiter').value==='tab'?'\t':$('delimiter').value,header:$('header').checked,fields:$('fields').value}},controller.signal,8000)
   if(new TextEncoder().encode(data.text).length>4*1048576)throw new Error('输出最多 4 MiB。');show(data.text);status(data.counts?'各规则替换次数：'+data.counts.join('、'):'转换完成。')
  }catch(error){status(error.name==='AbortError'?'已取消，请调整规则后重试。':error.message,true)}finally{signal.removeEventListener('abort',abort);busy=false;controller=null;if(!disposed)update()}
 }
 $('process').onclick=()=>void process();$('expression').onkeydown=event=>{if(event.key==='Enter')void process()};$('cancel').onclick=()=>controller?.abort()
 if(calculator){
  const input=$('expression'),changed=()=>{show('');status('')};input.oninput=changed;$('angle-unit').onchange=changed
  function insert(value,kind='text'){
   let start=input.selectionStart??input.value.length,end=input.selectionEnd??start,selected=input.value.slice(start,end),replacement=value,caret
   if(kind==='text'&&value===')'&&start===end&&input.value[start]===')'){input.focus();input.setSelectionRange(start+1,start+1);return}
   if(kind==='clear'){input.value='';input.focus();changed();return}
   if(kind==='backspace'){if(start===end&&start)start--;replacement=''}
   if(kind==='function'){replacement=value+'('+selected+')';caret=start+value.length+1+(selected?selected.length+1:0)}
   if(kind==='square'){replacement=selected?'('+selected+')^2':'^2'}
   if(kind==='sign'){
    if(selected)replacement='-('+selected+')'
    else{
     const before=input.value.slice(0,start),number=/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(before),negative=/\(-((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\)$/.exec(before)
     if(number){start=number.index;const minus=start-1,unary=input.value[minus]==='-'&&(minus===0||/[+\-*/^(,]/.test(input.value[minus-1]));if(unary){start=minus;replacement=number[0]}else replacement=start===0?'-'+number[0]:'(-'+number[0]+')'}
     else if(negative){start=negative.index;replacement=negative[1]}
     else if(input.value){start=0;end=input.value.length;replacement='-('+input.value+')'}
     else replacement='-'
    }
   }
   if(input.value.length-(end-start)+replacement.length>512){status('表达式最多 512 字符。',true);return}
   input.setRangeText(replacement,start,end,'end');if(caret!==undefined)input.setSelectionRange(caret,caret);input.focus();changed()
  }
  const functions=[['sin','sin'],['cos','cos'],['tan','tan'],['asin','asin'],['acos','acos'],['atan','atan'],['√','sqrt'],['x²','^2','square'],['xʸ','^','text'],['ln','ln'],['log','log'],['exp','exp'],['π','pi','text'],['e','e','text'],['ans','ans','text'],['abs','abs'],['min','min'],['max','max']]
  const numbers=[['AC','','clear'],['⌫','','backspace'],['(','('],[')',')'],['7','7'],['8','8'],['9','9'],['÷','/'],['4','4'],['5','5'],['6','6'],['×','*'],['1','1'],['2','2'],['3','3'],['−','-'],['±','-','sign'],['0','0'],['.','.'],['+','+'],['%','%'],[',',',']]
  for(const [id,keys]of [['calculator-functions',functions],['calculator-numbers',numbers]])for(const [label,value,kind]of keys){const button=text('button',label);button.type='button';button.className=kind==='clear'?'calculator-clear':['÷','×','−','+'].includes(label)?'calculator-operator':'';button.dataset.key=label;button.setAttribute('aria-label',({'⌫':'删除前一个字符','AC':'清空表达式','√':'平方根','x²':'平方','xʸ':'幂','±':'负号','%':'百分号',',':'函数参数分隔符'})[label]??label);button.onclick=()=>insert(value,kind??(id==='calculator-functions'?'function':'text'));$(id).append(button)}
 }
 $('import').onclick=async()=>{try{const file=await openFile({extensions:['txt','csv','tsv','json'],signal});if(!file)return;if(file.blob.size>2*1048576)throw new Error('输入最多 2 MiB。');$('input').value=await file.blob.text();status('已导入，点击处理查看结果。')}catch(error){status(error.message,true)}}
 $('copy').onclick=async()=>{try{await copyText(result);status('结果已复制。')}catch(error){status(error.message,true)}}
 $('save').onclick=async()=>{try{status(await saveFile(mode==='data.convert'?($('direction').value==='csv'?'converted.json':'converted.csv'):'result.txt',new Blob([result],{type:'text/plain;charset=utf-8'}),{signal})?'文件已保存。':'已取消保存。')}catch(error){status(error.message,true)}}
 $('input-panel').hidden=!['text.replace','data.convert'].includes(mode);$('import').hidden=$('input-panel').hidden
 if(mode==='unit.convert')units();renderHistory();update();return()=>{disposed=true;controller?.abort()}
}
