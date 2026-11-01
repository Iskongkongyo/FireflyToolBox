import {PDFDocument,EncryptedPDFError} from 'pdf-lib'
export async function loadPdfForEditing(bytes,decrypt){
 try{return {pdf:await PDFDocument.load(bytes),bytes}}
 catch(error){
  // pdf-lib 1.17's transpiled Error subclass loses its prototype/name.
  if(error?.message!==new EncryptedPDFError().message)throw new Error('无法读取 PDF，请检查文件是否完整。')
 }
 const plain=await decrypt(bytes)
 return {pdf:await PDFDocument.load(plain),bytes:plain}
}
