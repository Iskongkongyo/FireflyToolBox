const patterns={han:/\p{Script=Han}/u,latin:/\p{Script=Latin}/u,letter:/\p{L}/u,digit:/\p{Nd}/u,space:/\p{Zs}/u,control:/\p{Cc}/u,punctuation:/\p{P}/u,symbol:/\p{S}/u}
export function countText(text){
 const counts={han:0,latin:0,otherLetters:0,digits:0,spaces:0,otherSpaces:0,tabs:0,newlines:0,controls:0,punctuation:0,symbols:0,other:0};let total=0,whitespace=0
 for(const ch of text){total++;if(/\s/u.test(ch))whitespace++
  if(ch===' ')counts.spaces++;else if(ch==='\t')counts.tabs++;else if(/[\r\n\u2028\u2029]/u.test(ch))counts.newlines++;else if(patterns.space.test(ch))counts.otherSpaces++;else if(patterns.han.test(ch))counts.han++;else if(patterns.digit.test(ch))counts.digits++;else if(patterns.latin.test(ch)&&patterns.letter.test(ch))counts.latin++;else if(patterns.letter.test(ch))counts.otherLetters++;else if(patterns.punctuation.test(ch))counts.punctuation++;else if(patterns.symbol.test(ch))counts.symbols++;else if(patterns.control.test(ch))counts.controls++;else counts.other++
 }
 const lines=text?text.split(/\r\n|[\r\n\u2028\u2029]/):[]
 let visible=0;if(typeof Intl.Segmenter==='function')for(const _ of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text))visible++;else visible=total
 return {total,withoutSpaces:total-counts.spaces-counts.otherSpaces,withoutWhitespace:total-whitespace,visible,utf16:text.length,utf8:new TextEncoder().encode(text).length,lines:lines.length,nonemptyLines:lines.filter(line=>line.trim()).length,breaks:(text.match(/\r\n|[\r\n\u2028\u2029]/g)||[]).length,englishWords:(text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)||[]).length,counts}
}
