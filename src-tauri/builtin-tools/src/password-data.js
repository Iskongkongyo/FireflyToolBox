import {randomStrings} from './random-data.js'
export const PASSWORD_SYMBOLS='!@#$%^&*()-_=+[]{};:,.?'
export function generatePassword(options,next){const length=Number(options.length);if(!Number.isInteger(length)||length<6||length>32)throw new Error('密码长度须为 6～32 位。');return randomStrings({...options,count:1,length,digitMin:0,digitMax:9,symbolChars:PASSWORD_SYMBOLS,custom:false,ensure:true},next)[0]}
// A local heuristic, not a cracking-time estimate or a breached-password service.
export function passwordStrength(value){
 const chars=[...String(value)],length=chars.length,classes=[/[0-9]/,/[a-z]/,/[A-Z]/,/[^a-zA-Z0-9]/].filter(re=>re.test(value)).length
 let pool=(/[0-9]/.test(value)?10:0)+(/[a-z]/.test(value)?26:0)+(/[A-Z]/.test(value)?26:0)+(/[^a-zA-Z0-9]/.test(value)?32:0),score=length?Math.min(100,length*Math.log2(Math.max(pool,1))):0
 const repeated=/(.)\1{2,}/u.test(value),sequence=/(0123|1234|2345|3456|4567|5678|6789|9876|abcd|bcde|cdef|defg|qwer|asdf|zxcv)/i.test(value),common=/(password|passwd|admin|letmein|welcome|iloveyou|123456|qwerty)/i.test(value)
 if(new Set(chars).size<=Math.max(2,length/3))score*=.35
 if(repeated)score*=.6;if(sequence)score*=.65;if(common)score=Math.min(score,20)
 if(length<10)score=Math.min(score,39);else if(length<12)score=Math.min(score,59)
 score=Math.round(score);const level=!length?'未输入':score<40?'弱':score<60?'一般':score<80?'较强':'强'
 const tips=[];if(length&&length<12)tips.push('建议至少 12 位');if(length&&classes<2)tips.push('可增加字符种类');if(common||sequence||repeated)tips.push('避免常见词、连续或重复字符')
 return{length,classes,score,level,tips}
}
export function cleanPasswordFavorites(value){return Array.isArray(value)?value.filter(v=>v&&typeof v.id==='string'&&typeof v.value==='string'&&[...v.value].length>=6&&[...v.value].length<=32).slice(0,30).map(v=>({id:v.id.slice(0,64),value:v.value,label:String(v.label||'未命名').slice(0,40)})):[]}
