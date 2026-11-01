import {Unzlib} from 'fflate'
const LIMIT=2*1024*1024
export function pngICC(buffer){
 const b=new Uint8Array(buffer),view=new DataView(buffer);if(b.length<8||b[0]!==137||b[1]!==80||b[2]!==78||b[3]!==71)return null
 let p=8
 while(p+12<=b.length){const length=view.getUint32(p),end=p+12+length;if(end>b.length)throw new Error('PNG 数据块长度无效。');const type=String.fromCharCode(...b.slice(p+4,p+8));if(type==='iCCP'){const data=b.slice(p+8,p+8+length),zero=data.indexOf(0);if(zero<1||zero>79||data[zero+1]!==0)throw new Error('PNG ICC 压缩头无效。');let total=0;const chunks=[],inflater=new Unzlib((chunk)=>{total+=chunk.length;if(total>LIMIT)throw new Error('ICC 配置文件超过 2 MiB。');chunks.push(chunk)});const packed=data.subarray(zero+2);for(let start=0;start<packed.length;start+=2048)inflater.push(packed.subarray(start,start+2048),start+2048>=packed.length);const profile=new Uint8Array(total);let offset=0;for(const chunk of chunks){profile.set(chunk,offset);offset+=chunk.length}return profile}p=end;if(type==='IEND')break}
 return null
}
export function parseICC(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength)
 const text=(offset,length)=>String.fromCharCode(...b.slice(offset,offset+length)).replace(/\0+$/,'').trim(),fixed=offset=>v.getInt32(offset)/65536
 if(b.length<132||b.length>LIMIT||text(36,4)!=='acsp')throw new Error('ICC 配置文件头无效。')
 const size=v.getUint32(0),count=v.getUint32(128);if(size<132||size>b.length||count>4096||132+count*12>size)throw new Error('ICC 标签目录无效。')
 const tags={}
 for(let i=0;i<count;i++){const p=132+i*12,name=text(p,4),offset=v.getUint32(p+4),length=v.getUint32(p+8);if(length<8||offset<132+count*12||offset+length>size){tags[name]={error:'标签范围无效'};continue}const type=text(offset,4);let value
  if(type==='XYZ'){value=[];for(let q=offset+8;q+12<=offset+length&&value.length<256;q+=12)value.push([fixed(q),fixed(q+4),fixed(q+8)])}
  else if(type==='sf32'){value=[];for(let q=offset+8;q+4<=offset+length&&value.length<4096;q+=4)value.push(fixed(q))}
  else if(type==='curv'&&length>=12){const points=v.getUint32(offset+8);if(12+points*2>length)value={error:'曲线长度无效'};else if(points===0)value={gamma:1};else if(points===1)value={gamma:v.getUint16(offset+12)/256};else{const samples=[];for(let q=0;q<Math.min(points,4096);q++)samples.push(v.getUint16(offset+12+q*2)/65535);value={points,samples,truncated:points>4096}}}
  else if(type==='para'&&length>=12){const functionType=v.getUint16(offset+8),parameters=[];for(let q=offset+12;q+4<=offset+length&&parameters.length<16;q+=4)parameters.push(fixed(q));value={functionType,parameters}}
  else value={type,bytes:length}
  tags[name]={type,bytes:length,value}
 }
 return {ProfileSize:size,ProfileVersion:`${b[8]}.${b[9]>>4}.${b[9]&15}`,DeviceClass:text(12,4),ColorSpace:text(16,4),ConnectionSpace:text(20,4),Creator:text(80,4),DeviceManufacturer:text(48,4),DeviceModel:text(52,4),RenderingIntent:v.getUint32(64),Illuminant:[fixed(68),fixed(72),fixed(76)],ProfileID:Array.from(b.slice(84,100),n=>n.toString(16).padStart(2,'0')).join(''),TagCount:count,Tags:tags}
}
