import {AlphaAction,Channels,EvaluateOperator,CompositeOperator,Point,MagickColors,FilterType,MagickGeometry} from '@imagemagick/magick-wasm'
import {readImage,encodeImage} from './image-magick.js'
import {regionRect} from './image-region-plan.js'

function pixelate(image,block){
 const width=image.width,height=image.height,small=new MagickGeometry(Math.max(1,Math.ceil(width/block)),Math.max(1,Math.ceil(height/block))),original=new MagickGeometry(width,height)
 small.ignoreAspectRatio=original.ignoreAspectRatio=true
 image.resize(small,FilterType.Box);image.resize(original,FilterType.Point)
}
export function watermarkPositions(width,height,markWidth,markHeight,position){
  if(!['tile','top-left','top-right','bottom-left','bottom-right','center'].includes(position))throw new Error('水印位置无效。')
  const margin=Math.max(1,Math.round(Math.min(width,height)*.02)),left=Math.min(margin,Math.max(0,width-markWidth)),top=Math.min(margin,Math.max(0,height-markHeight)),right=Math.max(0,width-markWidth-margin),bottom=Math.max(0,height-markHeight-margin)
  if(position==='center')return [[Math.max(0,Math.round((width-markWidth)/2)),Math.max(0,Math.round((height-markHeight)/2))]]
  if(position!=='tile')return [[position.endsWith('left')?left:right,position.startsWith('top')?top:bottom]]
  const stepX=Math.max(1,markWidth+margin*3),stepY=Math.max(1,markHeight+margin*3),points=[]
  if(Math.ceil(width/stepX)*Math.ceil(height/stepY)>2048)throw new Error('水印重复次数过多，请增大水印尺寸。')
  for(let y=top;y<height;y+=stepY)for(let x=left;x<width;x+=stepX)points.push([x,y])
  return points
}
export function imageEffect(bytes,options,extension='',watermarkBytes){
  const quality=Number(options.quality??90),block=Number(options.block??12),opacity=Number(options.opacity??30),scale=Number(options.size??25),angle=Number(options.angle??-30)
  if(!['image.watermark','image.pixelate','image.edit'].includes(options.mode)||!['png','jpeg','webp'].includes(options.format)||!Number.isInteger(quality)||quality<1||quality>100)throw new Error('图片效果、输出格式或质量无效。')
  if(options.mode==='image.pixelate'&&(!Number.isInteger(block)||block<1||block>512))throw new Error('像素块大小须为 1～512 像素。')
  if(options.mode==='image.watermark'&&(!Number.isFinite(opacity)||opacity<0||opacity>100||!Number.isFinite(scale)||scale<5||scale>100||!Number.isFinite(angle)||angle< -180||angle>180||!watermarkBytes?.length))throw new Error('请选择水印；透明度须为 0～100，大小 5～100%，角度 -180～180°。')
  return readImage(bytes,extension,image=>{
    if(options.mode==='image.edit'){
      const x=Number(options.x),y=Number(options.y),width=Number(options.width),height=Number(options.height),rotation=Number(options.rotation??0)
      if([x,y,width,height].some(v=>!Number.isInteger(v))||x<0||y<0||width<1||height<1||x+width>image.width||y+height>image.height||![0,90,180,270].includes(rotation))throw new Error('图片裁剪区域或旋转角度无效。')
      image.crop(new MagickGeometry(x,y,width,height));image.page=new MagickGeometry(0,0,width,height)
      if(options.mirrorX)image.flop();if(options.mirrorY)image.flip();if(rotation){image.backgroundColor=MagickColors.Transparent;image.rotate(rotation)}
    }else if(options.mode==='image.pixelate'){
      const rect=options.region?regionRect(options.region.left,options.region.top,options.region.width,options.region.height,image.width,image.height):{left:0,top:0,width:image.width,height:image.height}
      if(block>1){
        if(rect.left===0&&rect.top===0&&rect.width===image.width&&rect.height===image.height)pixelate(image,block)
        else image.clone(part=>{part.crop(new MagickGeometry(rect.left,rect.top,rect.width,rect.height));part.page=new MagickGeometry(0,0,rect.width,rect.height);pixelate(part,block);image.composite(part,CompositeOperator.Copy,new Point(rect.left,rect.top))})
      }
    }else{
      readImage(watermarkBytes,options.watermarkExtension??'',mark=>{
        const ratio=Math.min(image.width*scale/100/mark.width,image.height*.8/mark.height)
        mark.resize(Math.max(1,Math.round(mark.width*ratio)),Math.max(1,Math.round(mark.height*ratio)))
        mark.backgroundColor=MagickColors.Transparent;mark.rotate(angle)
        const fit=Math.min(1,image.width*.96/mark.width,image.height*.96/mark.height)
        if(fit<1)mark.resize(Math.max(1,Math.floor(mark.width*fit)),Math.max(1,Math.floor(mark.height*fit)))
        mark.alpha(AlphaAction.Set);mark.evaluate(Channels.Alpha,EvaluateOperator.Multiply,opacity/100)
        for(const [x,y] of watermarkPositions(image.width,image.height,mark.width,mark.height,options.position))image.composite(mark,CompositeOperator.Over,new Point(x,y))
      },8000000)
    }
    return encodeImage(image,options.format,quality)
  })
}
