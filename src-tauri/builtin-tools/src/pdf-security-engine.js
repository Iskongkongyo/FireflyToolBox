import {decryptPdf} from './pdf-decrypt.js'
function password(value,max=1024){if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new Error('PDF 密码无效或过长。');return value}
const hex=value=>Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('')
export function encryptionOptions(options){
 const opening=password(options.opening??''),owner=password(options.owner||opening),source=password(options.password??'')
 if(!opening)throw new Error('请设置打开密码。')
 if([opening,owner].some(value=>new TextEncoder().encode(value).length>127))throw new Error('新密码最多 127 个 UTF-8 字节；中文通常每字占 3 字节。')
 const restricted=options.allowPrint===false||options.allowCopy===false||options.allowModify===false
 if(restricted&&owner===opening)throw new Error('限制打印、复制或修改时，请设置与打开密码不同的权限密码。')
 return {opening,owner,source,allowPrint:options.allowPrint!==false,allowCopy:options.allowCopy!==false,allowModify:options.allowModify!==false}
}
export function securePdf(core,bytes,mode,options={}){
 const maximum=64*1048576
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>maximum)throw new Error('PDF 文件须非空且不超过 64 MiB。')
 if(mode==='pdf.decrypt')return decryptPdf(core,bytes,password(options.password??''),maximum)
 if(mode!=='pdf.encrypt')throw new Error('PDF 处理方式无效。')
 const config=encryptionOptions(options),input='/security-input.pdf',output='/security-output.pdf'
 try{
  core.FS.writeFile(input,bytes)
  // Hex password mode avoids qpdf's @argument-file expansion for passwords
  // starting with @, and preserves UTF-8 bytes without shell interpolation.
  const code=core.callMain(['--password-mode=hex-bytes','--password='+hex(config.source),'--encrypt',hex(config.opening),hex(config.owner),'256','--print='+(config.allowPrint?'full':'none'),'--extract='+(config.allowCopy?'y':'n'),'--modify='+(config.allowModify?'all':'none'),'--',input,output])
  if(code!==0&&code!==3)throw new Error('PDF 无法加密，请检查原文件密码和文件是否完整。')
  const stat=core.FS.stat(output);if(!stat.size||stat.size>maximum)throw new Error('加密后的 PDF 为空或超过 64 MiB。')
  return core.FS.readFile(output)
 }finally{for(const path of [input,output])try{core.FS.unlink(path)}catch{}}
}
