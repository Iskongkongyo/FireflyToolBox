export function mediaErrorMessage(error,format=''){
 const message=error?.message??String(error)
 if(/memory access out of bounds|index out of bounds|out of bounds memory/i.test(message)){
  const alternative=format==='webm'?'改用 MP4':format==='opus'?'改用 MP3 或 M4A':'更换输出格式'
  return `编码引擎发生内存访问异常，本次处理未完成。请降低清晰度、缩短片段或${alternative}后重试。`
 }
 if(/out of memory|cannot allocate memory|could not allocate memory|memory allocation failed|Array buffer allocation failed/i.test(message))return '编码所需内存不足。本次处理未完成，请降低清晰度、缩短片段或关闭其他占用内存的程序后重试。'
 return message
}
