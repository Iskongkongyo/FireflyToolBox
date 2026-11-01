import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { connectAndroid } from './android-device-client.mjs'

const client = await connectAndroid()
let release, requested = false, opened = false
const server = createServer((request,response) => {
  if(request.url==='/slow.svg') {
    requested=true
    release=()=>{if(response.writableEnded)return;response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>')}
  } else {response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Progress regression</title><h1>Loading test</h1><img src="/slow.svg">')}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port, remote='/sdcard/firefly-progress-review.xml'
const hierarchy=()=>{client.device('shell','uiautomator','dump',remote);return client.device('shell','cat',remote)}
try {
  client.device('reverse',`tcp:${port}`,`tcp:${port}`)
  await client.evaluate(url=>window.FireflyWebsites.open(url),`http://127.0.0.1:${port}/`);opened=true
  for(let i=0;i<60&&!requested;i++)await new Promise(resolve=>setTimeout(resolve,100))
  assert.ok(requested,'The native browser did not request the slow resource')
  const loading=hierarchy()
  assert.match(loading,/content-desc="网页加载进度 (?:[0-9]|[1-9][0-9]|100)%"/)
  release()
  await new Promise(resolve=>setTimeout(resolve,1000))
  const loaded=hierarchy()
  assert.doesNotMatch(loaded,/content-desc="网页加载进度/)
  await mkdir('target-check/browser-progress-review',{recursive:true})
  await writeFile('target-check/browser-progress-review/android.json',JSON.stringify({android:client.device('shell','getprop','ro.build.version.release'),loading_bar_visible:true,completed_bar_hidden:true},null,2))
  console.log('PASS: The native browser shows page progress while a real resource is loading and hides it after completion.')
} finally {
  release?.()
  if(opened)client.device('shell','input','keyevent','4')
  client.device('reverse','--remove',`tcp:${port}`)
  client.device('shell','rm','-f',remote)
  client.close()
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
}
