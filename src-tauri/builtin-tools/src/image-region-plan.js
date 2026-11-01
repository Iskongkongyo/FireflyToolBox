export function regionRect(left,top,width,height,imageWidth,imageHeight){
 const values=[left,top,width,height].map(Number)
 if(values.some(value=>!Number.isSafeInteger(value)))throw new Error('选区坐标须为整数像素。')
 const [x,y,w,h]=values
 if(x<0||y<0||w<1||h<1||x+w>imageWidth||y+h>imageHeight)throw new Error('选区须位于图片内，且宽高大于零。')
 return {left:x,top:y,width:w,height:h}
}
export function dragRegion(start,end,width,height){
 const clamp=(value,max)=>Math.max(0,Math.min(max,value))
 const left=Math.min(width-1,Math.floor(clamp(Math.min(start.x,end.x),width))),top=Math.min(height-1,Math.floor(clamp(Math.min(start.y,end.y),height)))
 const right=Math.max(left+1,Math.ceil(clamp(Math.max(start.x,end.x),width))),bottom=Math.max(top+1,Math.ceil(clamp(Math.max(start.y,end.y),height)))
 return regionRect(left,top,right-left,bottom-top,width,height)
}
