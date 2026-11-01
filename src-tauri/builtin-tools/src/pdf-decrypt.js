// Run only in a managed Worker. Passwords and CLI diagnostics never leave it.
export function decryptPdf(core, bytes, password='', maxBytes=64*1024*1024) {
 if(typeof password!=='string'||password.length>1024)throw new Error('PDF 密码过长。')
 const input='/input.pdf',output='/output.pdf'
 try {
  core.FS.writeFile(input,bytes)
  const code=core.callMain([`--password=${password}`,'--decrypt',input,output])
  if(code!==0&&code!==3)throw new Error('PDF 无法解密，请检查打开密码和文件是否完整。')
  const stat=core.FS.stat(output)
  if(!stat.size||stat.size>maxBytes)throw new Error('解密后的 PDF 超过 64 MiB，或文件内容为空。')
  return core.FS.readFile(output)
 } finally {for(const path of [input,output])try{core.FS.unlink(path)}catch{}}
}
