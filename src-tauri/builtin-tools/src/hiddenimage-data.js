import {HIDDEN_OUTPUT_PIXELS} from './image-limits.js'
export function hiddenImage(front,back,options){
 if(!(front instanceof Uint8ClampedArray)||!(back instanceof Uint8ClampedArray)||!front.length||front.length!==back.length||front.length%4||front.length>HIDDEN_OUTPUT_PIXELS*4)throw new Error('图片像素数据无效或超过 800 万像素。')
 const white=Number(options.white)/100,black=Number(options.black)/100,whiteColor=Number(options.whiteColor??options.color??0)/100,blackColor=Number(options.blackColor??options.color??0)/100
 if(!Number.isFinite(white)||white<.5||white>.95||!Number.isFinite(black)||black<.05||black>.5||!Number.isFinite(whiteColor)||whiteColor<0||whiteColor>1||!Number.isFinite(blackColor)||blackColor<0||blackColor>1)throw new Error('亮度比例或色彩强度无效。')
 const out=new Uint8ClampedArray(front.length)
 for(let p=0;p<out.length;p+=4){
  const fg=.299*front[p]+.587*front[p+1]+.114*front[p+2],bg=.299*back[p]+.587*back[p+1]+.114*back[p+2]
  const wr=255*white+(1-white)*(fg*(1-whiteColor)+front[p]*whiteColor),wg=255*white+(1-white)*(fg*(1-whiteColor)+front[p+1]*whiteColor),wb=255*white+(1-white)*(fg*(1-whiteColor)+front[p+2]*whiteColor)
  const br=black*(bg*(1-blackColor)+back[p]*blackColor),bgc=black*(bg*(1-blackColor)+back[p+1]*blackColor),bb=black*(bg*(1-blackColor)+back[p+2]*blackColor)
  const alpha=Math.min(1,Math.max(0,1-((wr-br)+(wg-bgc)+(wb-bb))/(3*255),br/255,bgc/255,bb/255)),background=(1-alpha)*255
  out[p]=alpha<1e-6?0:Math.max(0,Math.min(255,(wr+br-background)/(2*alpha)))
  out[p+1]=alpha<1e-6?0:Math.max(0,Math.min(255,(wg+bgc-background)/(2*alpha)))
  out[p+2]=alpha<1e-6?0:Math.max(0,Math.min(255,(wb+bb-background)/(2*alpha)))
  out[p+3]=Math.round(alpha*255)
 }
 return out
}
