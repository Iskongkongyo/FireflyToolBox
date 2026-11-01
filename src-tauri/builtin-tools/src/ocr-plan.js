export function cropRect(left,top,width,height,imageWidth,imageHeight){
 const values=[left,top,width,height].map(Number);if(values.some(v=>!Number.isFinite(v)))throw new Error('选区坐标无效。')
 const [x,y,w,h]=values.map(Math.round);if(x<0||y<0||w<1||h<1||x+w>imageWidth||y+h>imageHeight)throw new Error('选区须位于图片内，且宽高大于零。')
 return {left:x,top:y,width:w,height:h}
}
