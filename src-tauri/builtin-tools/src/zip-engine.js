import {zipSync,unzipSync} from 'fflate'
export function archivePath(value){
 if(typeof value!=='string'||!value||value.length>240||/^[\/]|\\|:|[\x00-\x1f]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('归档文件名不能含绝对路径、反斜线或上级目录。');return value
}
export function inspectArchive(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break}
 if(end<0)throw new Error('ZIP 目录无效。');if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('不支持分卷 ZIP。')
 const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),length=view.getUint32(end+12,true);if(count===65535||offset===4294967295)throw new Error('首期仅支持普通 ZIP，不支持 ZIP64。');if(count>2000||offset+length>end)throw new Error('ZIP 目录超限或损坏。')
 let cursor=offset;for(let i=0;i<count;i++){if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)throw new Error('ZIP 目录损坏。');if(view.getUint16(cursor+8,true)&65)throw new Error('不支持加密 ZIP。');if(![0,8].includes(view.getUint16(cursor+10,true)))throw new Error('不支持该 ZIP 压缩算法。');cursor+=46+view.getUint16(cursor+28,true)+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);if(cursor>offset+length)throw new Error('ZIP 目录损坏。')}
 const entries=[];let total=0
 unzipSync(bytes,{filter(entry){if(entries.length>=2000||entry.originalSize>128*1048576||(total+=entry.originalSize)>256*1048576)throw new Error('ZIP 最多 2000 项，单文件 128 MiB，总解压大小 256 MiB。');const name=entry.name.replace(/\/$/,'');if(name)archivePath(name);entries.push({name:entry.name,size:entry.originalSize,compressed:entry.size,directory:entry.name.endsWith('/')});return false}})
 return entries
}
export function extractArchive(bytes,name){const entries=inspectArchive(bytes);if(!entries.some(entry=>entry.name===name&&!entry.directory))throw new Error('请选择有效文件。');const data=unzipSync(bytes,{filter:entry=>entry.name===name})[name];if(!data)throw new Error('文件无法解压。');return data}
export function createArchive(files,level=6){
 if(!Number.isInteger(level)||level<0||level>9||!files.length||files.length>16)throw new Error('最多 16 个文件，压缩等级 0～9。');const data=Object.create(null);let total=0
 for(const file of files){const name=archivePath(file.name);if(data[name])throw new Error('归档文件名重复：'+name);total+=file.bytes.length;if(total>128*1048576)throw new Error('打包原始总量最多 128 MiB。');data[name]=file.bytes}
 const result=zipSync(data,{level});if(result.length>64*1048576)throw new Error('ZIP 输出超过 64 MiB，请减少文件。');return result
}
