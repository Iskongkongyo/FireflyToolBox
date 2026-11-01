import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { connectAndroid } from './android-device-client.mjs'
import { createHash } from 'node:crypto'

const client = await connectAndroid()
const report = { android: client.device('shell', 'getprop', 'ro.build.version.release'), runs: [] }
let id
let originalUsage
try {
  originalUsage = await client.evaluate(() => localStorage.getItem('firefly.usage-stats.v1'))
  const tool = await client.invoke('save_custom_tool', { tool: { id: '', name: `Automation regression ${crypto.randomUUID()}`, description: '', tags: [], icon: null, icon_data: null,
    steps: [{tool_id:'text.case',action:'upper'}, {tool_id:'base64.convert',action:'encode'}, {tool_id:'sha256.hash',action:'hash'}] } })
  id = tool.id
  await client.evaluate(() => { localStorage.setItem('firefly.usage-stats.v1','true');setTimeout(()=>location.reload(),0) })
  await new Promise(resolve=>setTimeout(resolve,500))
  let opened=false
  for(let attempt=0;attempt<60;attempt++) {
    try { opened=await client.evaluate(name=>{
      document.querySelector('.startup-splash-skip')?.click()
      const navigation=[...document.querySelectorAll('.nav-button')].find(node=>node.textContent.trim()==='工具管理')
      navigation?.click()
      const item=[...document.querySelectorAll('.all-tool-item')].find(node=>node.textContent.includes(name))
      item?.click();return !!item
    },tool.name) } catch {}
    if(opened)break
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  assert.ok(opened,'The new automation could not be opened through the UI')
  for(let attempt=0;attempt<30;attempt++) {
    report.opened_recorded=(await client.invoke('list_recent_tools')).includes(id)
    if(report.opened_recorded)break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  if(!process.argv.includes('--baseline'))assert.equal(report.opened_recorded,true)
  for (let i = 0; i < 3; i++) {
    const started = Date.now()
    try {
      const result = await client.invoke('run_text_tool', { toolId: id, action:'run',input:'Hello 流萤',recordUsage:false,requestId:crypto.randomUUID() })
      const expected = createHash('sha256').update(Buffer.from('Hello 流萤'.toUpperCase()).toString('base64')).digest('hex')
      assert.equal(result, expected)
      report.runs.push({ success:true,ms:Date.now()-started })
      console.log(`Run ${i+1}: ${Date.now()-started} ms, correct output`)
    } catch (error) { report.runs.push({ success:false,error:String(error) }); break }
  }
  await mkdir('target-check/automation-review', {recursive:true})
  await writeFile(`target-check/automation-review/${process.argv.includes('--baseline')?'before':'after'}.json`, JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
  if (!process.argv.includes('--baseline')) assert.equal(report.runs.filter(run => run.success).length, 3)
} finally {
  if (id) await client.invoke('delete_custom_tool', {id})
  if(originalUsage!==undefined)await client.evaluate(saved=>{if(saved===null)localStorage.removeItem('firefly.usage-stats.v1');else localStorage.setItem('firefly.usage-stats.v1',saved);setTimeout(()=>location.reload(),0)},originalUsage)
  client.close()
}
