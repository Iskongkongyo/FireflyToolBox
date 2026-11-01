// Emscripten callbacks are synchronous: only a dedicated Worker uses this bridge.
// The capability URLs address selected readers or run-owned temporary files.
export function attachFile(FS, path, info, writable=false) {
  let size=info.size??0,cacheStart=-1,cache=new Uint8Array(0)
  // A negative start is an invalid cache, not an interval starting at -1.
  // MP4/MOV faststart alternates reads and writes on this same node.
  const invalidateCache=()=>{cacheStart=-1;cache=new Uint8Array(0)}
  const xhr=(method,query='',body=null,range)=>{
    const request=new XMLHttpRequest();request.open(method,info.url+query,false);request.responseType='arraybuffer'
    if(range)request.setRequestHeader('Range',range)
    request.send(body)
    if(request.status!==200&&request.status!==206)throw new Error(request.status===413?'输出超过文件上限。':`临时文件读写失败（${request.status}）。`)
    return new Uint8Array(request.response??new ArrayBuffer(0))
  }
  const node=FS.createNode(FS.lookupPath('/media').node,path,0o100666,0)
  node.node_ops={
    getattr:()=>({dev:1,ino:node.id,mode:node.mode,nlink:1,uid:0,gid:0,rdev:0,size,atime:new Date(),mtime:new Date(),ctime:new Date(),blksize:1048576,blocks:Math.ceil(size/512)}),
    setattr:(_,attrs)=>{if(attrs.size!==undefined){if(!writable)throw new FS.ErrnoError(2);xhr('POST',`?size=${attrs.size}`);size=attrs.size;invalidateCache()}},
  }
  node.stream_ops={
    llseek:(_,offset,whence)=>{const position=whence===2?size+offset:whence===1?_.position+offset:offset;if(position<0)throw new FS.ErrnoError(28);return position},
    read:(_,buffer,offset,length,position)=>{
      let read=0
      while(read<length&&position+read<size){
        const at=position+read
        if(cacheStart<0||at<cacheStart||at>=cacheStart+cache.length){cacheStart=Math.floor(at/1048576)*1048576;const end=Math.min(size-1,cacheStart+1048575);cache=xhr('GET','',null,`bytes=${cacheStart}-${end}`);if(cache.length!==end-cacheStart+1){invalidateCache();throw new Error('文件读取不完整。')}}
        const from=at-cacheStart,count=Math.min(length-read,cache.length-from,size-at)
        buffer.set(cache.subarray(from,from+count),offset+read);read+=count
      }
      return read
    },
    write:(_,buffer,offset,length,position)=>{
      if(!writable)throw new FS.ErrnoError(2)
      for(let used=0;used<length;used+=1048576){const bytes=buffer.slice(offset+used,offset+Math.min(length,used+1048576));xhr('POST',`?offset=${position+used}`,bytes)}
      size=Math.max(size,position+length);invalidateCache();return length
    },
  }
  return ()=>size
}
