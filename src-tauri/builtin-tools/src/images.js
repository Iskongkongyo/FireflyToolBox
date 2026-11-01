import {CANVAS_INPUT_BYTES,CANVAS_OUTPUT_BYTES} from './image-limits.js'
export const IMAGE_INPUT_LIMIT = CANVAS_INPUT_BYTES
export const IMAGE_OUTPUT_LIMIT = CANVAS_OUTPUT_BYTES
export const MAX_OUTPUT_PIXELS = 24000000
export const MAX_TOTAL_PIXELS = 48000000
export const MAX_IMAGES = 12
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const imageFormats = {png:{mime:'image/png',ext:'png'},jpeg:{mime:'image/jpeg',ext:'jpg'},webp:{mime:'image/webp',ext:'webp'}}
export function numberIn(value,min,max,name){const n=Number(value);if(!String(value).trim()||!Number.isInteger(n)||n<min||n>max)throw new Error(`${name}需为 ${min}～${max} 的整数。`);return n}
export function outputSize(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_OUTPUT_PIXELS)throw new Error('输出尺寸过大：最多 2400 万像素、单边 16384 px。请减小尺寸或减少图片。');return{width,height}}
export function resized(width,height,maxSide){const side=numberIn(maxSide,0,8192,'最长边');if(!width||!height)throw new Error('图片尺寸无效。');const ratio=side?Math.min(1,side/Math.max(width,height)):1;return outputSize(Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio)))}
export function imageOptions(format,quality,background,color){const type=imageFormats[format];if(!type)throw new Error('输出格式无效。');const q=format==='png'?.9:numberIn(quality,1,100,'质量')/100;if(!['transparent','color'].includes(background)||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('背景设置无效。');return{...type,quality:q,fill:background==='color'?color:format==='jpeg'?'#ffffff':null}}
export function animatedImage(buffer,mime){const b=new Uint8Array(buffer),view=new DataView(buffer);if(mime==='image/webp')return b.length>=21&&String.fromCharCode(...b.slice(12,16))==='VP8X'&&!!(b[20]&2);if(mime==='image/png'){let p=8;while(p+12<=b.length){const length=view.getUint32(p),type=String.fromCharCode(...b.slice(p+4,p+8));if(type==='acTL')return true;if(type==='IDAT'||type==='IEND'||p+12+length>b.length)break;p+=length+12}}return false}
export function stitchLayout(images,{direction,tileSize,gap,columns,gridFit='cover'}){
 if(images.length<1||images.length>MAX_IMAGES)throw new Error(`一次最多拼接 ${MAX_IMAGES} 张图片。`)
 if(!['vertical','horizontal','grid'].includes(direction))throw new Error('拼接方式无效。')
 if(!['contain','cover'].includes(gridFit))throw new Error('网格适配方式无效。')
 const side=numberIn(tileSize,64,4096,'统一尺寸'),space=numberIn(gap,0,100,'间距'),cols=Math.min(images.length,numberIn(columns,1,6,'网格列数'))
 if(images.some(i=>!Number.isInteger(i.width)||!Number.isInteger(i.height)||i.width<1||i.height<1))throw new Error('图片尺寸无效。')
 if(images.reduce((sum,i)=>sum+i.width*i.height,0)>MAX_TOTAL_PIXELS)throw new Error('所选图片累计超过 4800 万像素，请减少图片或先压缩尺寸。')
 let width,height,rects=[]
 if(direction==='vertical'){width=side+2*space;height=space;for(const i of images){const h=Math.max(1,Math.round(i.height*side/i.width));rects.push({x:space,y:height,width:side,height:h});height+=h+space}}
 else if(direction==='horizontal'){height=side+2*space;width=space;for(const i of images){const w=Math.max(1,Math.round(i.width*side/i.height));rects.push({x:width,y:space,width:w,height:side});width+=w+space}}
 else{
  const rows=Math.ceil(images.length/cols),cellHeight=Math.max(1,Math.round(side*images[0].height/images[0].width))
  width=cols*side+(cols+1)*space;height=rows*cellHeight+(rows+1)*space
  outputSize(width,height)
  rects=images.map((i,n)=>{
   const x=space+(n%cols)*(side+space),y=space+Math.floor(n/cols)*(cellHeight+space)
   if(gridFit==='cover'){
    const ratio=Math.max(side/i.width,cellHeight/i.height),sw=side/ratio,sh=cellHeight/ratio
    return{x,y,width:side,height:cellHeight,sourceX:(i.width-sw)/2,sourceY:(i.height-sh)/2,sourceWidth:sw,sourceHeight:sh}
   }
   const ratio=Math.min(side/i.width,cellHeight/i.height),w=Math.max(1,Math.min(side,Math.round(i.width*ratio))),h=Math.max(1,Math.min(cellHeight,Math.round(i.height*ratio)))
   return{x:x+Math.floor((side-w)/2),y:y+Math.floor((cellHeight-h)/2),width:w,height:h}
  })
 }
 return{...outputSize(width,height),rects}
}
