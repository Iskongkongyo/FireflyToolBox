import {Exifr,sidecar} from 'exifr/dist/full.esm.mjs'
import {pngICC,parseICC} from './icc.js'
const names={ifd0:'TIFF 主图',ifd1:'缩略图',exif:'EXIF',gps:'GPS',xmp:'XMP',iptc:'IPTC',icc:'ICC',jfif:'JPEG 头',ihdr:'PNG 头',interop:'互操作信息',makerNote:'MakerNote',userComment:'用户备注'}
function clean(value,depth=0){if(value instanceof Date)return value.toISOString();if(typeof value==='bigint')return String(value);if(typeof value==='string')return value.length>65536?{text:value.slice(0,65536),truncated:true,length:value.length}:value;if(ArrayBuffer.isView(value))return{bytes:value.byteLength,hex:Array.from(new Uint8Array(value.buffer,value.byteOffset,Math.min(value.byteLength,256)),n=>n.toString(16).padStart(2,'0')).join(' '),truncated:value.byteLength>256};if(Array.isArray(value))return value.slice(0,8192).map(x=>clean(x,depth+1));if(value&&typeof value==='object'){if(depth>10)return '[深层数据]';return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,depth+1)]))}return value}
export async function inspectMetadata(buffer){
 const b=new Uint8Array(buffer),png=b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71,parser=new Exifr({tiff:true,exif:true,gps:true,xmp:true,iptc:true,ihdr:true,jfif:true,icc:!png,ifd1:true,interop:true,makerNote:true,userComment:true,mergeOutput:false,reviveValues:false,silentErrors:true,chunked:false})
 await parser.read(buffer);const parsed=await parser.parse(),groups={},warnings=parser.errors.map(e=>e.message||String(e));let profile=null
 for(const[key,value]of Object.entries(parsed??{}))if(key!=='errors'&&value&&Object.keys(Object(value)).length){if(names[key]&&key!=='xmp')groups[names[key]]=clean(value);else{groups.XMP??={};groups.XMP[key]=clean(value)}}
 try{profile=png?pngICC(buffer):parser.parsers.icc?.chunk.getUint8Array(0);if(profile?.length){if(profile.length<132)throw new Error('ICC 配置文件头过短。');const length=new DataView(profile.buffer,profile.byteOffset,profile.byteLength).getUint32(0);if(length<132||length>profile.length||length>2097152)throw new Error('ICC 配置文件长度无效或超过 2 MiB。');profile=Uint8Array.from(profile.subarray(0,length));const details=await sidecar(profile,{reviveValues:false},'icc');groups.ICC={...clean(details),...parseICC(profile)}}}catch(e){warnings.push(`ICC：${e.message}`);profile=null}
 if(JSON.stringify(groups).length>3000000)throw new Error('元数据过大，超过展示与导出上限。')
 return {groups,warnings,icc:profile}
}
self.onmessage=async({data})=>{try{self.postMessage({result:await inspectMetadata(data.bytes)})}catch(error){self.postMessage({error:`无法解析图片元数据：${error.message||String(error)}`})}}
