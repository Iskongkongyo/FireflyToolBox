import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

let release, requested=false, socket, process
const server=createServer((request,response)=>{
  if(request.url==='/slow.svg'){requested=true;release=()=>{if(response.writableEnded)return;response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg"/>')}}
  else{response.setHeader('Content-Type','text/html');response.end('<title>Browser progress regression</title><h1>Loading</h1><img src="/slow.svg">')}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port
const debugPort=Number(globalThis.process.env.FIREFLY_TEST_DEBUG_PORT || 19347)
const title=`Firefly progress ${Date.now()}`, label=`website-progress-${Date.now()}`
const profile=path.resolve(`target-check/browser-progress-review/windows-profile-${Date.now()}`)
await mkdir(profile,{recursive:true})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const visible=()=>JSON.parse(execFileSync('python',['-c',`import ctypes,json,sys
from ctypes import wintypes
u=ctypes.windll.user32
u.FindWindowW.argtypes=[wintypes.LPCWSTR,wintypes.LPCWSTR];u.FindWindowW.restype=wintypes.HWND
u.GetDlgItem.argtypes=[wintypes.HWND,ctypes.c_int];u.GetDlgItem.restype=wintypes.HWND
u.IsWindowVisible.argtypes=[wintypes.HWND]
h=u.FindWindowW(None,sys.argv[1]);bar=u.GetDlgItem(h,0x7f31) if h else None
u.GetDlgCtrlID.argtypes=[wintypes.HWND]
found=[]
callback=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)(lambda child,param: (found.append(child) if u.GetDlgCtrlID(child)==0x7f31 else None) or True)
if h and not bar:u.EnumChildWindows(h,callback,0);bar=found[0] if found else None
print(json.dumps(dict(window=bool(h),bar=bool(bar),visible=bool(bar and u.IsWindowVisible(bar)))))`,title],{encoding:'utf8',windowsHide:true}))
try{
  process=spawn(path.resolve(globalThis.process.env.FIREFLY_TEST_EXE || 'target-check/debug/firefly-toolbox.exe'),[],{env:{...globalThis.process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`,WEBVIEW2_USER_DATA_FOLDER:profile},windowsHide:true,stdio:['ignore','pipe','pipe']})
  process.stderr.on('data',data=>console.error(data.toString()))
  process.on('exit',code=>console.log('Test app exit:',code))
  let target
  let targets=[]
  for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();target=targets.find(item=>/^https?:\/\/tauri\.localhost/.test(item.url)&&!item.url.includes('splash.html'))}catch{}if(target)break;if(process.exitCode!==null)break;await delay(200)}
  if(!target)console.log('Debug targets:',targets)
  assert.ok(target,'Windows app did not expose a test WebView')
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let sequence=0;const pending=new Map()
  socket.onmessage=({data})=>{const r=JSON.parse(data),t=pending.get(r.id);if(t){pending.delete(r.id);clearTimeout(t.timer);r.error?t.reject(new Error(JSON.stringify(r.error))):t.resolve(r.result)}}
  const evaluate=expression=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(new Error('Windows CDP timeout')),15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))}).then(result=>{if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value})
  let ready=false
  for(let i=0;i<60;i++){try{ready=await evaluate("typeof window.__TAURI_INTERNALS__?.invoke === 'function'")}catch{}if(ready)break;await delay(100)}
  assert.ok(ready,'The application IPC did not finish startup')
  await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview_window',{options:${JSON.stringify({label,title,url:`http://127.0.0.1:${port}/`,width:800,height:600,additionalBrowserArgs:`--remote-debugging-port=${debugPort}`,dataDirectory:path.resolve('target-check/browser-progress-review/direct-api-profile')})}})`)
  for(let i=0;i<60&&!visible().window;i++)await delay(100)
  await evaluate(`window.__TAURI_INTERNALS__.invoke('initialize_website_progress',{label:${JSON.stringify(label)}})`)
  for(let i=0;i<60&&!requested;i++)await delay(100)
  if(!requested){console.log('Native window:',visible());console.log('Targets:',await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json())}
  assert.ok(requested)
  for(let i=0;i<30&&!visible().bar;i++)await delay(50)
  assert.deepEqual(visible(),{window:true,bar:true,visible:true})
  release();await delay(1000)
  assert.equal(visible().visible,false)
  await writeFile('target-check/browser-progress-review/windows.json',JSON.stringify({loading_bar_visible:true,completed_bar_hidden:true},null,2))
  console.log('PASS: Windows native loading strip is visible while loading and hidden after completion.')
}finally{release?.();socket?.close();process?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
