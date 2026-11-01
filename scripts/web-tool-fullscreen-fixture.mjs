export function fullscreenFixture(moduleId = 'test.fullscreen_auto', fullscreen = true) {
  const toolId = `${moduleId}.main`
  return {
    manifest: {
      schema_version: 7, module_id: moduleId, version: '1.0.0', api_version: '1', min_app_version: '0.1.69',
      name: { 'zh-CN': fullscreen ? '全屏测试工具' : '普通测试工具' }, author: 'Firefly test', license: 'MIT', platforms: ['windows', 'android'],
      permissions: [], network: { hosts: [] }, resources: [], limits: { input_bytes: 1048576, output_bytes: 4194304, timeout_ms: 15000, heap_bytes: 67108864 },
      tools: [{ id: toolId, name: { 'zh-CN': fullscreen ? '全屏测试工具' : '普通测试工具' }, description: { 'zh-CN': 'Fullscreen lifecycle test' }, category: '效率工具', tags: [], aliases: [], entry: 'index.html', runtime: 'browser', input_schema: null, output_schema: null,
        ui: { kind: 'web', script: 'main.js', style: 'style.css', ...(fullscreen ? { fullscreen: true } : {}) }, actions: [{ id: 'open', label: { 'zh-CN': '打开' } }] }],
    },
    scripts: {
      'index.html': '<main id="surface"><div><label>保留输入<input id="state" value="original"></label><button id="advance">切换颜色</button><output id="count">0</output><button id="fail">触发测试错误</button></div><button id="corner"><span>右上工具按钮</span><output id="corner-count">0</output></button><button id="edge-control">顶边按钮</button><button id="under-hint">提示下按钮 <output id="under-count">0</output></button><canvas id="corner-canvas" width="48" height="26"></canvas></main>',
      'style.css': 'html,body{margin:0;padding:0}#surface{position:fixed;inset:0;background:rgb(255,0,0);display:grid;place-items:center}#surface>div{display:grid;gap:10px;max-width:80vw;padding:20px;border-radius:12px;background:#fff;color:#142c21}input,button{font:16px system-ui;min-height:44px;max-width:100%}label{display:grid}output{text-align:center}#corner{position:fixed;right:12px;top:14px;width:140px;height:44px}#edge-control{position:fixed;right:40px;top:0;width:36px;height:8px;min-height:8px;padding:0;border:0;font-size:0}#under-hint{position:fixed;right:140px;top:72px;width:110px}#corner-canvas{position:fixed;right:20px;top:62px;width:48px;height:26px;background:#369}',
      'main.js': 'export function mount(){window.mountCount=(window.mountCount||0)+1;document.documentElement.dataset.mountCount=String(window.mountCount);let count=0,corner=0,under=0;document.documentElement.dataset.blankClicks="0";document.querySelector("#surface").addEventListener("click",e=>{if(e.target.id==="surface")document.documentElement.dataset.blankClicks=String(Number(document.documentElement.dataset.blankClicks)+1)});document.querySelector("#advance").addEventListener("click",()=>{document.querySelector("#count").textContent=String(++count);document.querySelector("#surface").style.background=["#0f0","#00f","#fff","#000","#f00"][(count-1)%5]});document.querySelector("#corner").onclick=()=>document.querySelector("#corner-count").textContent=String(++corner);document.querySelector("#under-hint").onclick=()=>document.querySelector("#under-count").textContent=String(++under);document.querySelector("#fail").addEventListener("click",()=>{throw new Error("fixture-fullscreen-error")})}',
    },
    builtin: false, modified: false,
  }
}

export function fullscreenDescriptor(details) {
  const tool = details.manifest.tools[0]
  return { id: tool.id, name: tool.name['zh-CN'], description: tool.description['zh-CN'], category: tool.category, tags: [], aliases: [], builtin: false, custom: false, module_id: details.manifest.module_id, runtime: 'browser', ui_kind: 'web', actions: [{ id: 'open', label: '打开' }] }
}
