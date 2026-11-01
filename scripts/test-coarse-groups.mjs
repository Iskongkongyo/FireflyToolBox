import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const output=await build({entryPoints:['src/services/coarseGroups.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {coarseGroupId,defaultHomeGroupId,coarseHomeToolOrder,resolveHomeGroupId,homeSourceGroupIds}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))
const empty=()=>({names:{},custom:[],deleted:[],assignments:{},otherCreated:false})
test('six defaults combine old categories while unknown user categories keep their names',()=>{
 const settings=empty();assert.equal(coarseGroupId('source:视频工具',settings),'source:图片与影音');assert.equal(coarseGroupId('source:PDF与文档',settings),'source:文件与文档');assert.equal(coarseGroupId('user:mine',settings),'user:mine');assert.equal(coarseGroupId('source:我的工具',settings),'source:我的工具')
})
test('renamed and deleted old defaults retain builtin and imported tool membership',()=>{
 const settings=empty(),tool={id:'image.convert',category:'图片与影音'};assert.equal(defaultHomeGroupId(tool,settings),'source:图片与影音')
 settings.names['source:图片工具']='摄影';assert.equal(defaultHomeGroupId(tool,settings),'source:图片工具');assert.equal(defaultHomeGroupId({id:'dev.my.photo',category:'图片工具'},settings),'source:图片工具');assert.equal(coarseGroupId('source:图片工具',settings),'source:图片工具')
 settings.deleted.push('source:图片工具');assert.equal(defaultHomeGroupId(tool,settings),'home:other')
 assert.equal(defaultHomeGroupId({id:'image.convert',category:'效率工具'},settings),'source:效率工具')
})
test('merged group orders retain prior tool order, deduplicate and respect newly saved order',()=>{
 const settings=empty(),orders={'source:图片工具':['image.convert','image.exif'],'source:视频工具':['video.edit','image.convert'],'source:图片与影音':['video.edit']}
 assert.deepEqual(coarseHomeToolOrder('source:图片与影音',orders,['source:图片工具','source:视频工具'],settings),['video.edit','image.convert','image.exif'])
 settings.names['source:图片工具']='摄影';assert.deepEqual(coarseHomeToolOrder('source:图片与影音',orders,['source:图片工具','source:视频工具'],settings),['video.edit','image.convert'])
})

test('automation placed in Ungrouped or a chosen group does not generate an empty metadata group',()=>{
 const tool={id:'custom.1',category:'自定义工具'},settings=empty()
 for(const group of ['home:other','home:mine','source:开发与文本']){
  settings.custom=[{id:'home:mine',name:'我的工具'}];settings.assignments[tool.id]=group
  assert.equal(resolveHomeGroupId(tool,settings),group)
  assert.deepEqual(homeSourceGroupIds([tool],settings),[])
 }
})

test('imported or legacy tools without explicit placement retain real Custom Tools membership',()=>{
 const tools=[{id:'custom.1',category:'自定义工具'},{id:'local.web.main',category:'自定义工具'}],settings=empty()
 assert.deepEqual(homeSourceGroupIds(tools,settings),['source:自定义工具'])
 settings.assignments['custom.1']='home:other'
 assert.deepEqual(homeSourceGroupIds(tools,settings),['source:自定义工具'])
 settings.assignments['local.web.main']='home:other'
 assert.deepEqual(homeSourceGroupIds(tools,settings),[])
})

test('renamed sources stay available when empty and deleted sources are never recreated',()=>{
 const tool={id:'custom.1',category:'自定义工具'},settings=empty()
 settings.assignments[tool.id]='home:other';settings.names['source:自定义工具']='我的流程'
 assert.deepEqual(homeSourceGroupIds([tool],settings),['source:自定义工具'])
 settings.deleted.push('source:自定义工具');delete settings.assignments[tool.id]
 assert.equal(resolveHomeGroupId(tool,settings),'home:other')
 assert.deepEqual(homeSourceGroupIds([tool],settings),[])
})

test('preset groups retain their existing empty-group behavior while other metadata placeholders disappear',()=>{
 const tools=[{id:'json.format',category:'开发与文本'},{id:'local.text.main',category:'文本处理'}],settings=empty()
 settings.assignments={'json.format':'home:other','local.text.main':'home:other'}
 assert.deepEqual(homeSourceGroupIds(tools,settings),['source:开发与文本'])
})
