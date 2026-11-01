export const MIB=1024*1024
export const CANVAS_INPUT_BYTES=64*MIB
export const CANVAS_OUTPUT_BYTES=128*MIB
export const ENGINE_INPUT_BYTES=256*MIB
export const ENGINE_OUTPUT_BYTES=512*MIB
export const EXIF_INPUT_BYTES=256*MIB
export const EXIF_OUTPUT_BYTES=16*MIB
export const HIDDEN_OUTPUT_PIXELS=8000000
export const HIDDEN_OUTPUT_EDGES=[768,1024,1536,1920,2560,3072]
export function hiddenOutputSize(width,height,edge){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!HIDDEN_OUTPUT_EDGES.includes(Number(edge)))throw new Error('请选择有效的图片与输出尺寸。')
 const scale=Math.min(1,Number(edge)/Math.max(width,height),Math.sqrt(HIDDEN_OUTPUT_PIXELS/(width*height)))
 return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))}
}
