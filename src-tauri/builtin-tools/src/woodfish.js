import {$,status} from './common.js'
import {loadState} from './life.js'
import {persist} from './utility.js'
export function mount({signal}){
 let total=Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(Number(loadState('woodfish.count',0))||0))),count=0,sound=loadState('woodfish.sound',true)!==false,audio=null,timer=0,disposed=false,voices=0
 const render=()=>{$('session-count').textContent=count.toLocaleString();$('total-count').textContent=total.toLocaleString();$('sound').textContent=`声音：${sound?'开':'关'}`;$('sound').setAttribute('aria-pressed',String(sound))}
 async function play(){if(!sound||voices>=8||disposed)return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('当前设备不支持提示音。');audio??=new C();if(audio.state==='suspended')await audio.resume();if(disposed||!sound)return;voices++;const now=audio.currentTime,g=audio.createGain();g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.35,now+.003);g.gain.exponentialRampToValueAtTime(.0001,now+.22);g.connect(audio.destination);for(const [index,freq]of [520,830,1340].entries()){const o=audio.createOscillator();o.type='sine';o.frequency.setValueAtTime(freq,now);o.frequency.exponentialRampToValueAtTime(freq*.83,now+.18);o.connect(g);if(index===0)o.onended=()=>{voices=Math.max(0,voices-1);g.disconnect()};o.start(now);o.stop(now+.24)}}catch(e){if(!disposed)status('无法播放敲击声，可关闭声音后继续。',true)}}
 function hit(){if(disposed)return;count=Math.min(Number.MAX_SAFE_INTEGER,count+1);total=Math.min(Number.MAX_SAFE_INTEGER,total+1);try{persist('woodfish.count',total);status('')}catch(e){status(e.message,true)}render();$('fish').classList.remove('hit');$('woodfish-float').classList.remove('rise');void $('fish').offsetWidth;$('fish').classList.add('hit');$('woodfish-float').classList.add('rise');clearTimeout(timer);timer=setTimeout(()=>{$('fish').classList.remove('hit');$('woodfish-float').classList.remove('rise')},400);void play()}
 $('fish').onclick=hit
 function key(event){if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||![' ','Enter'].includes(event.key)||/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName))return;event.preventDefault();hit()}
 document.addEventListener('keydown',key)
 $('sound').onclick=()=>{sound=!sound;try{persist('woodfish.sound',sound)}catch(e){status(e.message,true)}render()}
 $('reset').onclick=()=>{count=0;render();status('本次计数已重置。')}
 $('reset-total').onclick=()=>{$('confirm').hidden=false};$('cancel-reset').onclick=()=>{$('confirm').hidden=true};$('confirm-reset').onclick=()=>{try{persist('woodfish.count',0);total=count=0;$('confirm').hidden=true;render();status('累计计数已清空。')}catch(e){status(e.message,true)}}
 function dispose(){if(disposed)return;disposed=true;clearTimeout(timer);document.removeEventListener('keydown',key);if(audio){void audio.close();audio=null}}
 signal?.addEventListener('abort',dispose,{once:true});render();return dispose
}
