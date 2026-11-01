import {searchCardBin} from 'bankcard'
export function luhn(number){let sum=0,doubled=false;for(let index=number.length-1;index>=0;index--){let value=Number(number[index]);if(doubled){value*=2;if(value>9)value-=9}sum+=value;doubled=!doubled}return sum%10===0}
export function inspectBankCard(input){
 const number=String(input).replace(/[\s-]/g,'')
 if(!/^\d{6,19}$/.test(number))throw new Error('请输入 6 位 BIN 前缀，或 12～19 位银行卡号。')
 const prefixOnly=number.length===6
 if(!prefixOnly&&number.length<12)throw new Error('完整卡号须为 12～19 位；只查询发卡机构时请输入前 6 位。')
 if(/^0+$/.test(number))throw new Error('号码不能全部为 0。')
 const candidates=searchCardBin(number,{multiple:true})??[]
 const matches=candidates.filter(item=>prefixOnly||item.len===number.length)
 return {number,prefix:number.slice(0,6),prefixOnly,luhn:prefixOnly?null:luhn(number),matches}
}
export function bankLookupFields(info){
 const types={debit:'借记卡',credit:'信用卡',charge:'签账卡'};let country=info.country?.name??info.country?.alpha2
 try{if(info.country?.alpha2)country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(info.country.alpha2)}catch{}
 return [['银行',info.bank?.name||'接口未提供'],['卡组织',info.scheme||'接口未提供'],['卡种',types[info.type]||info.type||'接口未提供'],['品牌',info.brand||'接口未提供'],['发卡国家 / 地区',country||'接口未提供'],['发卡机构城市',info.bank?.city||'接口未提供，无法据卡号确定开户地'],['预付卡',typeof info.prepaid==='boolean'?(info.prepaid?'是':'否'):'接口未提供'],['数据来源','Binlist 公共 BIN 查询']]
}
