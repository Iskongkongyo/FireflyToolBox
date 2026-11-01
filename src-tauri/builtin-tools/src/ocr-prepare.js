import {MagickGeometry,MagickColors,AlphaAction,ColorType,FilterType,Percentage} from '@imagemagick/magick-wasm'
import {readImage,encodeImage} from './image-magick.js'
import {cropRect} from './ocr-plan.js'
export function prepareOcr(bytes,extension,options){
 if(!['auto','none','binary'].includes(options.enhance)||![0,90,180,270].includes(Number(options.rotation)))throw new Error('识别图像设置无效。')
 return readImage(bytes,extension,image=>{
  const r=cropRect(options.left,options.top,options.width,options.height,image.width,image.height)
  image.crop(new MagickGeometry(r.left,r.top,r.width,r.height));image.page=new MagickGeometry(0,0,r.width,r.height)
  image.backgroundColor=MagickColors.White;image.alpha(AlphaAction.Remove)
  if(Number(options.rotation))image.rotate(Number(options.rotation))
  const ratio=Math.min(options.enhance==='none'?1:Math.max(1,Math.min(3,1800/Math.max(image.width,image.height))),4064/Math.max(image.width,image.height),Math.sqrt(15500000/(image.width*image.height)))
  if(Math.abs(ratio-1)>.001)image.resize(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)),FilterType.Lanczos)
  if(options.enhance!=='none'){image.colorType=ColorType.Grayscale;image.autoLevel();if(options.invert)image.negate();if(options.enhance==='binary')image.threshold(new Percentage(55))}
  else if(options.invert)image.negate()
  let skew=0;if(options.deskew)skew=image.deskew(new Percentage(40))
  image.borderColor=MagickColors.White;image.border(16)
  if(image.width*image.height>16000000||Math.max(image.width,image.height)>8192)throw new Error('识别区域过大，请缩小选区。')
  const result=encodeImage(image,'png',100);if(result.output.length>32*1048576)throw new Error('识别选区超过 32 MiB，请缩小选区。')
  return {bytes:result.output,width:result.width,height:result.height,scale:ratio,skew}
 })
}
