import {ImageMagick,MagickFormat,MagickReadSettings,MagickImageInfo,MagickColor,AlphaAction,ResourceLimits} from '@imagemagick/magick-wasm'
import {ENGINE_OUTPUT_BYTES} from './image-limits.js'
export const imageFormats={png:MagickFormat.Png,jpeg:MagickFormat.Jpeg,webp:MagickFormat.WebP,bmp:MagickFormat.Bmp,tiff:MagickFormat.Tiff,avif:MagickFormat.Avif,jxl:MagickFormat.Jxl,gif:MagickFormat.Gif,ico:MagickFormat.Ico}
export function readImage(bytes,extension,work,maxPixels=40000000){
  ResourceLimits.width=65535n;ResourceLimits.height=65535n;ResourceLimits.memory=536870912n;ResourceLimits.map=0n;ResourceLimits.disk=0n;ResourceLimits.time=180n
  const settings=new MagickReadSettings({frameIndex:0,frameCount:1,...(extension==='tga'?{format:MagickFormat.Tga}:extension==='ico'?{format:MagickFormat.Ico}:{})})
  const info=MagickImageInfo.create(bytes,settings)
  if(info.width*info.height>maxPixels)throw new Error(`图片超过 ${maxPixels/10000} 万像素，请先缩小图片。`)
  return ImageMagick.read(bytes,settings,image=>{image.autoOrient();return work(image)})
}
export function encodeImage(image,format,quality){
  if(!imageFormats[format]||!Number.isInteger(quality)||quality<1||quality>100)throw new Error('输出格式或质量无效。')
  if(format==='jpeg'){image.backgroundColor=new MagickColor('#ffffff');image.alpha(AlphaAction.Remove)}
  image.strip();image.quality=quality
  const output=image.write(imageFormats[format],data=>data.slice())
  if(output.length>ENGINE_OUTPUT_BYTES)throw new Error('转换结果超过 512 MiB，请缩小图片后重试。')
  const preview=image.clone(copy=>{const ratio=Math.min(1,512/Math.max(copy.width,copy.height));copy.resize(Math.max(1,Math.round(copy.width*ratio)),Math.max(1,Math.round(copy.height*ratio)));return copy.write(MagickFormat.Png,data=>data.slice())})
  return {output,preview,width:image.width,height:image.height}
}
export function convertImage(bytes,options,extension=''){
  const format=imageFormats[options.format],quality=Number(options.quality),edge=Number(options.edge??0)
  if(!format||!Number.isInteger(quality)||quality<1||quality>100||!Number.isInteger(edge)||edge<0||edge>16384||!['transparent','color'].includes(options.background)||!/^#[0-9a-f]{6}$/i.test(options.color))throw new Error('图片格式、质量、尺寸或背景颜色无效。')
  return readImage(bytes,extension,image=>{
    if(edge&&Math.max(image.width,image.height)>edge){const ratio=edge/Math.max(image.width,image.height);image.resize(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)))}
    if(options.format==='ico'&&Math.max(image.width,image.height)>256){const ratio=256/Math.max(image.width,image.height);image.resize(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)))}
    if(options.background==='color'||options.format==='jpeg'){
      image.backgroundColor=new MagickColor(options.background==='color'?options.color:'#ffffff');image.alpha(AlphaAction.Remove)
    }
    image.strip();image.quality=quality
    const width=image.width,height=image.height
    const output=image.write(format,data=>data.slice())
    if(output.length>268435456)throw new Error('转换结果超过 256 MiB，请缩小图片后重试。')
    const preview=image.clone(copy=>{const ratio=Math.min(1,512/Math.max(copy.width,copy.height));copy.resize(Math.max(1,Math.round(copy.width*ratio)),Math.max(1,Math.round(copy.height*ratio)));return copy.write(MagickFormat.Png,data=>data.slice())})
    return {output,preview,width,height}
  })
}
