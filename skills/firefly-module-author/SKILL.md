---
name: firefly-module-author
description: 为流萤百宝箱创建、修改和打包 .fftool 工具时使用。文本处理使用 QuickJS 和 v6 清单，网页工具统一使用 v7；包含可独立复制的清单、源码模板、文件与资源接口及打包方法。
---

# fftool 工具包开发

目标是交付可导入的 `.fftool` 文件。本文可独立使用，不需要应用源码或仓库权限。默认面向应用 1.0.0，使用用户指定的工具名、功能、平台与许可。

## 选择类型与交付

| 类型 | 适用范围 | 入口 |
| --- | --- | --- |
| 文本处理（QuickJS，清单 v6） | 纯文字计算、校验、编码、算法 | `run(input, action)` 返回 `{ text: string }` |
| 网页工具（v7） | 自定义界面、浏览器 API、文件、HTTPS 查询，以及可选的 Worker/WASM 等独立资源 | HTML/CSS/JS，JS 导出 `mount(context)`；按需使用 `resources`、`files`、`tasks` |

v6/v7 指清单的 `schema_version`，宿主 `api_version` 仍为 `"1"`。内置文本工具、工作台新建文本工具和本指南的文本模板统一采用 v6；已有 QuickJS 文本包继续按原协议校验。网页工具全部使用 v7，包内所有工具都须为 `runtime:"browser"`、`ui.kind:"web"`，不混装 QuickJS 文本工具。没有独立资源时也使用 v7，可省略 `resources` 或填 `[]`；旧网页包和浏览器 `run()` 文本入口不再接受。

1. 按下方模板创建完整文件，改为唯一 ID、实际功能和必要权限，并按用途选择下面的分组与图标，不照抄示例元数据。ID 使用小写 ASCII 点分形式，普通包不能使用 `builtin.*` / `custom.*`；工具 ID 以模块 ID 加点为前缀。版本用 `1.0.0` 等语义版本。
2. 清单保持完整字段及正确类型；`actions`、`tags`、`aliases`、`input_schema`、`output_schema` 等不能因空值省略。按下方字段限制控制标签、别名和操作数量，挑选常用别名，不堆叠近义词。填写实际支持的平台和输入类型。
3. 编写业务代码、检查边界与取消，再打包。网页入口与 Worker 各自预编译成单文件，不能留下 npm 裸导入或未解析的相对导入；第三方许可随包保留。
4. 交付真实 `.fftool`，说明功能、额度与已完成的验证。仅打包/语法校验不能称为导入或双端实机通过；无法运行客户端时明确告知。

## 清单字段限制

清单、工具、`ui`、`actions`、`limits`、`network` 等结构拒绝未知字段，字段位置和类型须与模板一致。空数组、`null` 和省略字段各有约定，不能互相替换。容量使用二进制 KiB / MiB / GiB，清单、源码、文本输入输出和存储按 UTF-8 字节计；本表“字符”指 Unicode 码点，文件名、网页标题与存储键另按 UTF-16 代码单元计。中文和 Emoji 的字符数与字节数可能不同。

| 字段 | 限制 |
| --- | --- |
| `module_id`、`tools[i].id` | 各最多 100 个 ASCII 字符，至少两段点分名称；每段 1～40 个字符，以小写字母开头，其余只用小写字母、数字和 `_`。工具 ID 以包 ID 加 `.` 为前缀，不占用其他工具 ID；普通包不使用 `builtin.*` / `custom.*` |
| `version`、`min_app_version` | 合法语义版本；最低应用版本不能高于目标客户端，宿主 `api_version` 为 `"1"` |
| 包名、工具名 | 每个语言值非空，最多 80 个字符 |
| 工具描述 | 每个语言值非空，最多 500 个字符 |
| `author`、`license` | 各非空，最多 100 个字符 |
| `category` | 非空，最多 40 个字符；分类、内置图标和自定义 PNG 图标规则见下文 |
| `name`、`description`、操作 `label` 的语言对象 | 各 1～4 项；语言键非空、最多 16 UTF-8 字节，每个值非空，通常填写 `zh-CN` |
| `platforms` | 1～4 项，包含实际目标平台。当前客户端运行于 Windows / Android；校验器接受的 `linux`、`macos`、`ios` 标识不代表已有对应客户端支持 |
| `tools` | 每包 1～16 个工具，包内工具 ID 不重复 |
| `tags`、`aliases` | **分别最多 8 项**（`tags.length ≤ 8`、`aliases.length ≤ 8`），每项最多 32 个字符 |
| `actions` | 文本工具每工具 1～8 项；网页工具每工具恰好 1 项，网页上的多个按钮在 JS 内实现 |
| `action.id`、`action.label` | ID 为 1～40 个小写 ASCII 字母、数字或 `_`，同工具内不重复；每个语言的操作名称最多 40 个字符 |
| `action.input_types` | 仅文本操作可用，最多 11 项且不重复，可用类型见文本模板；空数组不参与推荐，网页操作不填写此字段 |

## 分组与工具图标

`category`、`icon` / `icon_data` 都填写在每一个 `tools[i]` 中，同包工具可以分别选择。网页工具只是运行类型，不代表它应归入“图片与影音”；按实际处理的内容和用途分类。下面模板里的文字和文件分类只是示例，需要随新工具一起修改。

### 内置分组

优先使用下表中的准确名称，写入 `category` 字符串：

| 分组名 | 适合的功能 | 导入时会归并的旧名称 |
| --- | --- | --- |
| 开发与文本 | 编码、JSON、正则、代码、文本转换与校验 | 文本与编码、开发工具 |
| 图片与影音 | 图片、设计、音频、视频处理 | 图片工具、音频工具、视频工具、设计工具 |
| 文件与文档 | 文件管理、压缩、PDF、文档转换 | PDF与文档、文件与数据 |
| 生活与查询 | 天气、日历、价格、信息查询与生活计算 | 日期与时间、生活查询、资讯阅读、财经行情 |
| 效率工具 | 记事、计时、计划、决策与工作辅助 | — |
| 趣味与AI | 游戏、趣味互动、AI 相关功能 | 趣味娱乐、AI工具 |

也可以使用用户指定的自定义分组名，例如 `摄影助手`、`工作日报`；`category` 须为非空字符串，最多 40 个字符，去掉首尾空白。新的名称会成为工具的默认分类，显示位置还受本机分组设置影响。旧别名会按上表归并，例如写 `设计工具` 会进入“图片与影音”；需要独立自定义分类时避免复用这些旧别名。不要把本机的 `home:...` / `source:...` ID 写进 `category`。

包里的默认分类与“分组管理”中由用户建立的本机分组不是同一个对象；仅填写同名 `category` 不能绑定某个本机自建分组。用户若要放进已建的本机分组，交付时说明可在导入后通过“分组管理”移动工具；不要声称工具包已经修改了用户的本机分组布局。

### 内置图标

宿主允许不填图标，但制作工具时，除非用户明确选择“无图标”，应为每个工具提供合适的 `icon` 或有效的 `icon_data`。无图标时同时省略这两个字段，不填空字符串。`icon` 只能使用下表的小写标识，不加界面内部的 `module-` 前缀，也不写其他图标库的名称：

| `icon` 标识 | 含义与常见用途 |
| --- | --- |
| `code` | 代码、开发辅助 |
| `text` | 文字处理、笔记 |
| `spark` | 灵感、AI、创作 |
| `shapes` | 形状、通用组合工具 |
| `bolt` | 效率、快捷操作 |
| `hash` | 哈希、编码、数据标识 |
| `image` | 图片处理 |
| `file` | 文件、文档 |
| `folder` | 文件整理、目录 |
| `link` | 链接、网址 |
| `globe` | 网络、全球信息 |
| `search` | 搜索、查询 |
| `clock` | 计时、时间 |
| `calendar` | 日历、日期 |
| `calculator` | 计算、换算 |
| `lock` | 密码、安全 |
| `terminal` | 命令、终端 |
| `database` | 数据存储、数据库 |
| `chart` | 图表、统计 |
| `heart` | 生活、健康 |

例如，文本清洗可选 `category: "开发与文本"` 与 `icon: "text"`，PDF 转换可选 `category: "文件与文档"` 与 `icon: "file"`，计划助手可选 `category: "效率工具"` 与 `icon: "calendar"`；分组和图标独立选择，不需要固定搭配。

### 自定义图标与偏好确认

自定义图片填入 `icon_data`，内容须为实际的 PNG Data URL（以 `data:image/png;base64,` 开头），PNG 原始字节最多 24 KiB，宽高各在 1～96 像素之间；使用时删除 `icon` 字段，两者不能同时填写。自定义图标名称、图片路径、远程 URL 或 SVG 源码不能代替 `icon_data`。不要交付占位 Base64。

应用工作台的图标选择器可导入基础 SVG、PNG、JPEG、WebP，转换成满足以上要求的 PNG；独立制作工具包时，需要自行完成转换后再写入清单。还没有可用的自定义图片时，可先建议一个内置图标，或向用户索取素材；不要用任意自定义名称填进 `icon`。

用途清楚且用户没有特别偏好时，按以上规则选择并在交付说明中简述即可，不必每次追问。如果功能横跨多个分组、用户提到已有分组，或希望使用品牌／自定义图标，可简短询问，例如：“默认放入‘效率工具’，使用 `calendar` 图标可以吗？也可以指定分组名或提供自己的图标。”优先沿用用户已给出的选择；无法读取用户设备上的分组时，不假装已获知本机配置。

## 文本处理模板

目录只需 `manifest.json`、`main.js`。应用提供输入和结果框；输入与输出固定为 `{ text: string }`。返回对象只能包含 `text` 一个字符串字段，不能额外返回 `stats`、`metadata` 等。清单输入输出 schema 及 `ui.kind/input_field/output_field` 须与模板完全一致，不能增加自定义输入表单字段。

`manifest.json`：

```json
{
  "schema_version": 6,
  "module_id": "dev.example.skill_quickjs",
  "version": "1.0.0",
  "api_version": "1",
  "min_app_version": "0.1.40",
  "name": { "zh-CN": "QuickJS 文本示例" },
  "author": "Example",
  "license": "MIT",
  "platforms": ["windows", "android"],
  "permissions": [],
  "network": {
    "hosts": []
  },
  "limits": {
    "input_bytes": 1048576,
    "output_bytes": 4194304,
    "timeout_ms": 3000,
    "heap_bytes": 67108864
  },
  "tools": [
    {
      "id": "dev.example.skill_quickjs.convert",
      "name": { "zh-CN": "文本大写转换" },
      "description": { "zh-CN": "将输入文字转换为大写" },
      "category": "开发与文本",
      "icon": "text",
      "tags": [
        "文本"
      ],
      "aliases": [],
      "entry": "main.js",
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "ui": {
        "kind": "text",
        "input_field": "text",
        "output_field": "text"
      },
      "actions": [
        {
          "id": "convert",
          "label": { "zh-CN": "转换" },
          "input_types": [
            "text"
          ]
        }
      ]
    }
  ]
}
```

`main.js`：

```js
export function run(input, action) {
  if (action !== 'convert') throw new Error('不支持的操作');
  return { text: input.text.toUpperCase() };
}
```

QuickJS 没有 DOM、fetch、计时器、文件系统或 Node 内置模块；纯计算最长 3 秒、堆最高 64 MiB，运行栈另设 512 KiB。Promise 微任务可用，但没有浏览器事件循环。需要网络或文件时选择网页工具。

`input_types` 仅用于识别推荐，可选 `text`、`json`、`jwt`、`uuid`、`unix_timestamp`、`datetime`、`base64`、`url`、`url_encoding`、`hex_color`、`rgb_color`，只声明确实适用的类型；空数组表示不参与推荐。

## 网页工具模板

目录包含 `manifest.json`、`index.html`、`style.css`、`main.js`。HTML 按页面内容片段编写：宿主只导入解析后的 `body` 子节点，不依赖 `head` 中的标题、meta 或外链样式；HTML 脚本不会作为入口执行，也不写事件属性。样式放在 `ui.style`，业务代码和事件绑定放入 `ui.script` 导出的 `mount`。清单的输入输出 schema 均为 `null`，不填写文本工具的输入输出字段。应用顶栏和说明区已展示工具名与清单中的 `description`，HTML 直接从功能内容开始，避免重复页首标题和介绍。

`manifest.json`：

```json
{
  "schema_version": 7,
  "module_id": "dev.example.skill_web",
  "version": "1.0.0",
  "api_version": "1",
  "min_app_version": "1.0.0",
  "name": { "zh-CN": "网页工具示例" },
  "author": "Example",
  "license": "MIT",
  "platforms": ["windows", "android"],
  "permissions": [],
  "network": {
    "hosts": []
  },
  "limits": {
    "input_bytes": 2147483648,
    "output_bytes": 2147483648,
    "timeout_ms": 15000,
    "heap_bytes": 67108864
  },
  "tools": [
    {
      "id": "dev.example.skill_web.save_text",
      "name": { "zh-CN": "文字文件生成器" },
      "description": { "zh-CN": "输入文字并保存为 TXT 文件" },
      "category": "文件与文档",
      "icon": "file",
      "tags": [
        "文件",
        "文字"
      ],
      "aliases": [],
      "entry": "index.html",
      "runtime": "browser",
      "input_schema": null,
      "output_schema": null,
      "ui": {
        "kind": "web",
        "script": "main.js",
        "style": "style.css"
      },
      "actions": [
        {
          "id": "open",
          "label": { "zh-CN": "打开" }
        }
      ]
    }
  ]
}
```

需要全屏的网页工具（例如屏幕检测、画布展示）可在 `ui` 中声明 `"fullscreen": true`，例如 `"ui": {"kind":"web","script":"main.js","style":"style.css","fullscreen":true}`。省略或 `false` 时普通显示；它只适用于 v7 网页工具，不适用于文本工具。仅在工具用途明确需要时启用，不确定时询问用户。工作台“高级设置 → 默认显示方式”可管理此配置，预览仍保持普通显示。已有网页工具也可从“更多工具操作 → 全屏显示”手动进入。

宿主管理系统全屏及退出：PC 按 Esc；移动端系统返回或从右边缘向左滑。退出只恢复普通显示，不重新挂载工具；离开工具、停止或出错会恢复应用界面。按应用设置，进入时可显示退出按钮与初次提示，随后隐藏；PC 鼠标靠近右上方顶边并停留可呼出按钮，移动端可长按右上角空白处呼出，普通点击工具控件不会呼出。手动呼出只显示退出按钮，不重复显示整段提示。保留这些宿主入口，不自行调用 `requestFullscreen()`、锁定方向或修改宿主导航。全屏布局建议 `html,body{margin:0;padding:0}` 并使用响应式视口尺寸；重要控件与屏幕边缘保持适当间距，无需给右上角预留固定空白，避免用宿主顶栏高度作固定补偿。Canvas / SVG 等交互画布不要依赖角落长按退出，应保留系统返回、边缘手势或 Esc 的退出方式。

`index.html`：

```html
<main>
  <label>内容<textarea id="text" rows="8"></textarea></label>
  <button id="save" type="button">保存 TXT</button>
  <p id="status" role="status"></p>
</main>
```

`style.css`：

```css
html, body { background: transparent; }
body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
main { min-width: 0; }
label, textarea { display: block; width: 100%; box-sizing: border-box; }
textarea { margin: 8px 0 16px; font: inherit; }
button { min-height: 44px; padding: 0 16px; }
```

`main.js`：

```js
export function mount({ saveFile, signal }) {
  const input = document.querySelector('#text');
  const button = document.querySelector('#save');
  const status = document.querySelector('#status');
  button.onclick = async () => {
    if (!input.value) { status.textContent = '请输入内容'; return; }
    button.disabled = true;
    try {
      const saved = await saveFile('result.txt', new Blob([input.value], { type: 'text/plain' }), { signal });
      if (!signal.aborted) status.textContent = saved ? '已保存' : '已取消保存';
    } catch (error) {
      if (!signal.aborted) status.textContent = error.message;
    } finally { if (!signal.aborted) button.disabled = false; }
  };
  return () => { button.onclick = null; };
}
```

网页工具运行在独立沙箱中，不能访问主界面 DOM、Tauri、系统路径或任意系统命令。使用自然文档流、响应式宽度和至少 44 px 的触控按钮；页面高度由宿主自动调整。不要用 `window.innerHeight` 当固定视口高度，可用 `var(--firefly-viewport-height)`。

沙箱禁止原生表单提交（含 `method="dialog"` 的提交流程）、网页自行弹窗与自动下载。使用 `type="button"`、`click` 及必要的回车事件处理表单，不依赖原生 `submit`；通过 `openWebsite` 打开网页、通过宿主文件接口保存结果。

`vh`、`svh`、`lvh`、`dvh` 按宿主可视高度适配，`100vh` 不等于工具卡片的可用高度。宿主也会适配根元素的部分百分比高度，普通子元素的百分比高度仍依赖包含块。画布和固定工作区按实际容器尺寸布局；全 fixed 页面有视口高度兜底，仍需检查内容溢出、窗口变化和移动端输入法出现后的布局。

包内资源使用 `resources`，用户文件使用 `files` 的句柄与原样返回的 URL，不拼接文件协议或本机地址。`fetch('./assets/x.bin')` 不会读取工具包资源；CSP 也不允许用 `fetch(dataUrl)` 通用地转换数据。图片可直接使用允许的 data URL；需要 Blob 时，从已有字节或正确解码的 Base64 构造。

模块初始化及 `mount` 完成前的连续界面执行预算默认 **5 秒**，挂载后的交互预算默认 **10 秒**；正常让出事件循环后的异步等待不累计进该预算。用户可在“更多设置 → 网页工具设置”中分别选择 5、10、30、60、120、300 秒或“不限制”，重新打开工具后生效，正式工具与工作台预览共用设置。超限会停止工具并释放其受管理资源，压缩等较长计算建议放 Worker，以保持界面响应。这两个预算由宿主控制，工具不能自行修改。`limits.timeout_ms` 最长 15 秒，默认仍限制首次挂载的整体等待；用户将初始化预算调至高于默认值时，整体等待至少为该预算加 1 秒，选择“不限制”时同时关闭首次挂载整体等待超时。交互预算不改变文件任务和网络超时。长任务应在 `mount` 返回后由用户操作启动，使用 `tasks` 独立计时；避免在 `mount` 中等待长任务完成。

`await Promise.resolve()` 仍可能连续执行微任务，不保证让出界面。较长流程可在阶段之间用 `await new Promise(resolve => setTimeout(resolve, 0))` 让出事件循环，恢复后检查 `signal.aborted`；单个阶段本身过重时继续分块或放入 Worker。`tasks.run()` 的回调仍在主线程，排队和独立期限不会自动把计算搬到后台，需要时实际创建 `task.worker()` / `resources.worker()`。

`mount()` 可不返回值；需要清理时返回函数，异步 `mount` 也可最终返回函数。清理函数应幂等，按需释放自行创建的动画帧、计时器、全局监听器、Observer、自建 Blob URL 及渲染器/GPU 资源，并配合 `signal` 丢弃迟到结果。宿主会在停止时清理受管理的 Worker 和资源 URL；`resources.url()` 返回缓存地址，使用期间不要提前撤销，自行创建的 URL 由工具维护生命周期。

### 页面背景与配色

网页工具的 iframe 和 `html` 默认透明；模板将 `body` 也设为透明，让页面透出宿主背景。宿主默认浅色背景是 **`#F7F8F5`**（极浅灰绿色），深色背景是 **`#131C1B`**。这与内置工具浅色卡片的白色 **`#FFFFFF`** 不同。

内置工具样式中的 `--bg: #F6F9F6` 用于只读输入框、结果高亮等局部区域，并非整页底色；其深色值是 `#15211D`。需要统一页面外观时，优先保持 `html, body { background: transparent; }`，不要无条件铺白底。工具独立预览需要底色时，可用 `#F7F8F5` 作为默认浅色预览底色。

宿主会设置工具文档根元素的 `data-theme="light"` / `"dark"`，并传入主题色 `--accent`；其他宿主 CSS 变量不会自动跨 iframe 继承。自定义卡片和输入框需在工具自己的 CSS 中提供对应的明暗配色。

### mount 提供的接口

| 接口 | 用法与约束 |
| --- | --- |
| `signal` | 停止/离开时中止；取消后丢弃迟到结果，清理 Worker、URL 和事件 |
| `openFile({extensions,signal})` | v7 的小文件接口，返回 `{name,blob}` 或 null；`extensions` 最多 12 项（`extensions.length ≤ 12`），每项为 1～10 位小写字母 / 数字，不带点号或通配符；`[]` 表示不限制筛选。自应用 0.1.66 起，文件上限取 `limits.input_bytes` 与 32 MiB 的较小值，仍需验证实际格式和解码像素 |
| `saveFile(name,blob,{signal})` | v7 的小文件接口，用户选择保存位置，返回是否保存；上限取 `limits.output_bytes` 与 32 MiB 的较小值。拒绝零字节 Blob，报 `FILE_EMPTY` |
| `copyText(text)` | 用户点击后复制文本，UTF-8 字节数不能超过清单 `limits.output_bytes` |
| `request(url,options)` | HTTPS GET/POST、headers/body，返回 Response，免浏览器 CORS；默认期限 15000 ms、响应 4 MiB。`timeoutMs` 为 1～60000 的整数毫秒，`maxResponseBytes` 为 1 字节～16 MiB 的整数；请求体最多 16 MiB，0 不表示不限 |
| `storage.flush()` | `localStorage` 仍可同步读写；等待宿主确认异步保存，失败会拒绝并提示，重要操作保存后应等待它 |
| `openWebsite(url,{title,external})` | 需当前用户点击激活，打开已声明的 HTTPS 来源；同一实例不能并行打开多个待完成请求。默认应用网页窗口，`external:true` 使用系统浏览器；标题取前 80 个 UTF-16 代码单元 |
| `resolveLink(url,{signal})` | 只解析服务器跳转，返回 `{url,hops,status,http_stopped}`，最多 5 次/15 秒；不执行中转页脚本 |
| `inspectCertificate(url,{signal})` | 检查已声明 HTTPS 来源的证书，期限 15 秒；选项仅支持 `signal` |
| `hashFile({algorithm,signal,onProgress})` | 原生选择文件并计算哈希，算法为 `md5`、`sha1`、`sha256`、`sha384`、`sha512`，默认 `sha256`；返回 `{name,size,algorithm,digest}` 或 null。原生文件最高 16 GiB、期限 600 秒，此额度不适用于通用 `files` 处理 |

`saveFile` / `files.createWriter` 的建议输出名字须非空，最多 120 个 UTF-16 代码单元；不合法文件名字符会被替换，不能用它指定任意本机写入路径。网页宿主共享系统文件操作租约，选文件 / 保存窗口不能并行发起；前一个未结束可能报 `FILE_BUSY`，切换工具也不会绕过未关闭的系统窗口。取消等待不保证关闭系统窗口，也不保证撤销已经开始的写入。小文件 `saveFile` 的非空约束不能直接套用到所有 writer 接口。

联网同时声明 `permissions:["network"]` 和 `network.hosts:["https://api.example.com"]`，离线工具使用空权限和空来源，普通包只支持这一项联网权限。**`hosts` 最多 64 项**，来源须是确切、规范的 HTTPS Origin：不加末尾斜杠、接口路径、查询参数或账号信息；非默认端口须声明，默认 443 端口应省略，普通包不使用通配符。接口需属于允许来源；浏览器 `fetch()` 的跨源请求仍受 CSP 和 CORS 约束，免浏览器 CORS 使用宿主 `request()`。省略 Cookie，并设置取消和响应上限。网页自身只读解析结果不等于已打开目标。网页 / 网络入口的 URL 有 4096 上限，前端按字符串长度、原生网络层按 UTF-8 字节检查，非 ASCII URL 可能更早达到上限。

自 0.1.68 起，`localStorage` 与 `sessionStorage` **各最多 1 MiB**（键值 JSON 的 UTF-8 大小），键最长 256 个 UTF-16 代码单元。`localStorage` 按工具 ID 隔离，同包的不同工具也各自保存，由客户端宿主 SQLite 管理；浏览器开发环境使用 IndexedDB。首次使用先迁移旧数据，只清理已确认且内容仍一致的旧键；迁移失败或存在冲突时保留旧副本，不覆盖数据库新数据。升级、编辑或重装同一工具 ID 保留数据；工具包导出和仅同步工具包不包含这些用户数据；自 0.1.69 起，设备同步可单独勾选“网页工具保存的数据”（新格式需两端 0.1.69 或更新版本）。`sessionStorage` 仅当前运行，这些兼容接口不提供直接访问宿主数据库的能力。

写入先更新工具内存，自动异步保存；重要结果执行 `await storage.flush()` 再显示已保存，失败后可重试，不要只依赖离开页面前的回调。分别处理 `setItem()` 同步抛出的 `QuotaExceededError` 和保存确认的异步失败；控制历史条数及字段长度，避免每帧写入。不要存密码、完整卡号或其他不必要的敏感输入。

`request` 选项为 `{method,headers,body,timeoutMs,maxResponseBytes,stream,signal}`。`method` 默认 GET，可用 POST；body 支持字符串、Blob、Uint8Array、ArrayBuffer、URLSearchParams，JSON 正文需自行序列化并声明类型。请求头最多 64 项/16 KiB，可显式设置 Authorization、Content-Type 等；Cookie、Host、Origin、Referer、Content-Length、连接字段、`Sec-*` 和 `Proxy-*` 等由宿主管理。只向已声明 HTTPS 来源请求；每次重定向也检查来源。POST 的 301/302/303 转 GET，307/308 保留方法和正文；带正文的跨来源转发拒绝，其他跨来源重定向去掉自定义请求头。不会共享网站窗口 Cookie。

默认等完整正文后返回，兼容原有 GET 用法。大响应或逐段输出使用 `stream:true`，收到响应头就返回，`response.body` 按需读取，每块最多 256 KiB；必须读到 EOF 或调用 `response.body.cancel()`，也可通过 signal 取消。期限包含响应正文读取时间；流式和完整读取均执行响应总额上限。宿主请求最多同时 4 个。

以下片段放在用户操作的异步函数内，需要同时声明示例 HTTPS 来源与 network 权限：

```js
const response = await request('https://api.example.com/query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '待处理文本' }), signal,
  timeoutMs: 60000, maxResponseBytes: 16777216,
});
if (!response.ok) throw new Error('接口状态 ' + response.status);
const result = await response.json();
localStorage.setItem('last-result', JSON.stringify(result));
await storage.flush();
```

入口通过 Blob URL 导入，`import.meta.url` 不是工具包目录，不能据此定位包内相对资源。普通 Worker 可用，模块 Worker 在不透明来源中需单独验证；经典 Worker 单文件更兼容。`SharedWorker` 未开放，调用会报 `WORKER_UNSUPPORTED`。入口或依赖不要使用 eval、new Function、远程脚本或内嵌 iframe。

## v7 资源与大文件

网页模板统一使用 `schema_version:7`，需要独立资源时增加例如 `"resources":[{"path":"assets/job.js"},{"path":"assets/core.wasm"}]`。打包器补齐资源 `size` / `sha256`；正式包必须与正文一致。HTML/CSS 可用 `{{resource:assets/image.png}}`。

包内源码与资源路径须与清单逐字符一致，可先用 `resources.list()` 核对资源；不添加 `./`、绝对路径、反斜杠或 URL 编码。路径使用 1–120 个 ASCII 字母、数字、`_`、`-`、`.`、`/`，不含空段、`.` 或 `..` 目录段。文件及资源不能以仅大小写不同的名称重复。源码为 UTF-8，清单为 UTF-8 无 BOM，源码与资源均不能是零字节文件；没有样式时可在 CSS 中保留有效注释。读取失败时保留 `RESOURCE_SCOPE` 等原始错误，不回退到 `fetch(原路径)` 掩盖问题。

资源使用小写后缀，且须通过所用打包器和目标客户端的检查；不同打包器的类型白名单可能不同，本文 Python 打包器支持的类型见下方 `resource_types`。自定义二进制可按 `.bin` 声明，但改名不会转换格式，解析器必须支持真实内容；外部纹理、材质等依赖也需声明并提供相应的资源 URL 映射。Worker 资源仍须使用 `.js` 后缀。

工具包大小与运行时输入输出是不同额度。网页模板与工作台新建网页工具的 `limits.input_bytes` / `limits.output_bytes` 默认各为 2 GiB（2147483648 字节），与 v7 上限一致；可按工具需要调小。额度用于 `files` 分块处理，不会预分配 2 GiB 内存；直接修改包内清单版本或通过源码编辑器添加资源，不会自动提高这两个字段，创建表单的编辑行为见后文。`openFile/saveFile` 始终保留上述小文件上限。QuickJS 文本模板仍为输入 1 MiB、输出 4 MiB。

| 额度 | QuickJS 文本工具 | v7 网页工具 |
| --- | --- | --- |
| 包及解包内容 | 2 MiB | 128 MiB |
| `manifest.json` | 64 KiB | 64 KiB |
| ZIP 条目数，含目录条目 | 20 | 384 |
| 单源码 / 源码合计 | 1 MiB / 2 MiB | 8 MiB / 32 MiB |
| 源码文件数 | 16 | 128 |
| 独立资源 | 不支持 | 单个 96 MiB，最多 128 个 |
| `limits.input_bytes` | 1 字节～1 MiB | 1 字节～2 GiB，供文件句柄使用 |
| `limits.output_bytes` | 1 字节～4 MiB | 1 字节～2 GiB，供文件句柄使用 |
| `limits.timeout_ms` | 1～3000 ms | 1～15000 ms，另受前述挂载等待与界面预算规则约束 |
| `limits.heap_bytes` | 1～64 MiB，QuickJS 强制执行 | 仍须填写 1～64 MiB 的合法整数，不构成浏览器 / WASM 堆配额 |

`limits` 均为整数，输入、输出、超时的 **0 不表示“不限制”**。上述网页容量自应用 0.1.67 起生效。包文件与解包总量分别检查，清单、源码和独立资源共同占用总额，不能同时用满每项上限。v7 所有源码须由工具的 `entry` / `ui.script` / `ui.style` 引用，128 个源码的上限不代表可额外放入任意辅助 JS；辅助 JS、WASM 等按 `resources` 声明。全体已安装扩展仍受源码合计 64 MiB、资源合计 512 MiB 的独立额度约束。局域网同步另有 128 MiB 序列化快照额度（资源编码也占空间），超出时用 `.fftool` 文件导入。

ZIP 单条目在压缩后大小非零时，解压大小不得超过压缩大小的 100 倍；下方 Python 打包器使用 `ZIP_STORED`，手动压缩也需满足该限制。工具包拒绝符号链接及未声明资源。

同一网页运行实例最多 8 个未结束的文件句柄 / 包内资源分块请求，超出报 `FILE_BUSY`；这是在途请求数，与下方 128 个活动句柄、64 个多选文件不是同一个额度。批量读取、写入或释放句柄时均控制并行数量，不对大量文件无限 `Promise.all`。

v7 的 `mount` 还提供：

- `resources.list()`、`blob(path,{signal})`、`url(path,{signal})`、`worker(path)`。资源随包携带；停止时撤销地址并终止受管理 Worker。
- `files.open({extensions,signal})`、`openMany()` 的 `extensions` 也最多 12 项，格式同 `openFile`；需要支持很多格式时可传 `[]`，选择后再验证真实文件内容，不把完整格式库塞进筛选列表。自应用 0.1.66 起一次最多选择 64 个文件，所有运行会话合计最多保留 128 个活动句柄（含输入、输出、预览和正在操作的文件）；批量处理后及时 `close()` / `abort()`。句柄有 `name,size,type,seekable,url`；`read(offset,length,{signal})` 每块最多 1 MiB，`stream({signal,onProgress})` 读到实际 EOF，`close()` 释放。未知大小 size 为 0，不认定为空。
- `files.createWriter(name)` 创建临时输出；`write(data,{signal})` 接收字节、Blob 或流；`preview()` 返回只读句柄，随后不继续修改；`save({signal})` 提交，`abort()` 丢弃。
- `tasks.run(label,work,{signal,timeoutMs})`，work 收到 `{signal,report,worker}`；默认 30 分钟、最多 2 小时。自 0.1.68 起默认并发 4 个，多余任务按 FIFO 等待（最多 128 个等待项）；期限从开始执行时计时，等待时也可取消。`tasks.configure({concurrency:4,workerLimit:8})` 可分别设置任务并发和 Worker 上限，各为 1–8，默认各 4；减少 Worker 上限前先释放已创建的 Worker。`resources.worker()` / `task.worker()` 会等待 Worker 空位，可取消；原生 `new Worker()` 是同步接口，达到上限仍抛错。每任务需要多个 Worker 时，配置足够的 Worker 上限，或释放后再申请，避免各任务持有部分 Worker 互相等待。完成/取消/超时会清理任务拥有的 Worker；停止工具取消全部运行项和等待项。同步计算仍受连续界面执行预算约束，压缩等耗时计算放 Worker，并响应 `signal`。

受管理 Worker 的等待队列也最多 128 项，与任务等待队列分别计算。

两种 Blob 接口的来源和额度不同：

| 调用 | 来源与读取方式 | 大小参数 |
| --- | --- | --- |
| `resources.blob(path,{signal})` | 包内声明资源，经最多 1 MiB 的分块传输后组成完整 Blob，默认按路径缓存 | 未实现 `maxBytes`，传入它不会限额或截断；仍受资源/包容量限制 |
| `file.blob({maxBytes,signal})` | `files.open()` 等返回的用户文件句柄，完整读取为 Blob | 默认 16 MiB、最高 64 MiB，超限报 `FILE_INPUT_LIMIT` |

音视频可用文件的只读 URL 按 Range 预览。完整 Blob、资源缓存和像素解码仍占内存，文件额度不能视为内存保证。`limits.heap_bytes` 仅由 QuickJS 强制执行，网页清单中的该字段不构成浏览器或 WASM 的堆内存配额。

需要 WASM 同步随机文件回调时，仅在受管理 Worker 中用 `writer.workspaceUrl`：GET 带单一 `Range: bytes=起点-终点`，POST `?offset=字节偏移` 写二进制，POST `?size=长度`（空正文）截断；每块最多 1 MiB。检查 200/206、短读和缓存一致性，失败即丢弃输出，完成后 `preview()` 获取实际大小。输入只读，停止后地址失效。单线程 WASM 可用，共享内存/跨源隔离和网页强制堆配额未开放。

## 工作台创建、编辑与更新

可视化创建 / 载入编辑表单仅支持**单工具、单操作、Windows / Android**；网页源码要求恰好一个 HTML 入口、一个 JS、一个 CSS，独立资源另行导入。这与清单允许的每包 16 个工具、最多 128 个网页源码不同。合法的多工具、多操作包或更复杂的已有包，使用“已安装工具”的源码编辑器或外部打包流程处理。

当前表单有两项编辑行为需要核对：

- 标签与别名的提示是“逗号分隔”，实际同时按中英文逗号和所有空白拆分；`image converter` 会变成两项。合法 JSON 清单中含空格的别名载入后再保存，也可能被拆开或超过 8 项。需要保留完整字符串时使用源码编辑器核对清单。
- 载入已有工具后，经该表单保存会把 `min_app_version` 改为当前应用版本，网页输入 / 输出额度重设为各 2 GiB，文本重设为 1 / 4 MiB，即使只改名称也会发生。需要保留已有自定义额度与最低版本时，使用源码编辑器核对并保留这些字段。

草稿自动保存受浏览器存储配额限制，另有草稿 JSON 最多 `128 × 1024 × 1024` 个 UTF-16 代码单元的保护上限；浏览器可能更早触顶。保存失败及时导出，草稿容量不等于可安装包容量。

更新同 ID 包时，已有工具 ID 集合须保持不变，不能通过覆盖增加、删除或改名，不同包也不能占用相同工具 ID。普通扩展不能降级，同版本内容修改可以覆盖；尚未修改的自带默认工具有既有覆盖例外。编辑已安装工具不能改包 ID，自带工具还须保留原工具 ID。工具包导出不包含用户的持久数据，需要数据时另行选择相应同步内容。

## 独立打包

如果有用户提供的 Windows 客户端，直接调用；不需要项目源码、npm 或 Rust：

```powershell
& '客户端路径\firefly-toolbox.exe' --pack-fftool '工具目录' 'output.fftool' | Out-String
& '客户端路径\firefly-toolbox.exe' --check-fftool 'output.fftool' | Out-String
```

退出码 0 且输出 JSON 的 `ok:true` 表示校验通过；不等于已执行功能。

Windows `--pack-fftool` 的目录扫描深度最多 16、访问目录项最多 4096，并跳过隐藏项与 `node_modules`；这是该打包器的扫描限制。

没有客户端时，把以下代码保存为 `pack_fftool.py`，用 Python 3.9+ 标准库运行 `python pack_fftool.py 工具目录 output.fftool`。ZIP 根直接放清单和声明文件，采用 ZIP_STORED。该脚本做结构、路径、大小和资源摘要检查，不做完整 JS/宿主语义校验。

```python
"""Package ready tool sources/resources using only the Python standard library."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import uuid
import zipfile

def pack(directory, destination=None):
    root=Path(directory).resolve(strict=True)
    def checked(relative):
        if not isinstance(relative,str) or not re.fullmatch(r"[A-Za-z0-9_./-]{1,120}",relative) or any(part in ("",".","..") for part in relative.split("/")):
            raise ValueError("包内路径无效")
        path=root
        for part in relative.split("/"):
            path=path/part
            if path.is_symlink():raise ValueError("资源不能使用链接")
        if not path.resolve(strict=True).is_relative_to(root):raise ValueError("文件超出工具目录")
        return path
    def read(relative,limit):
        path=checked(relative)
        if not path.is_file() or not 0<path.stat().st_size<=limit:raise ValueError("文件为空或过大："+relative)
        return path.read_bytes()
    raw=read("manifest.json",65536)
    if raw.startswith(b"\xef\xbb\xbf"):raise ValueError("manifest.json 必须为 UTF-8 无 BOM")
    manifest=json.loads(raw.decode("utf-8"))
    required={"schema_version","module_id","version","api_version","min_app_version","name","author","license","platforms","permissions","network","limits","tools"}
    if not isinstance(manifest,dict) or not required.issubset(manifest) or set(manifest)-required-{"resources"}:raise ValueError("清单字段缺失或存在未知字段")
    hosts=manifest.get("network",{}).get("hosts")
    if not isinstance(hosts,list) or len(hosts)>64 or any(not isinstance(host,str) for host in hosts):raise ValueError("network.hosts 必须是最多 64 项的来源数组")
    modern=manifest["schema_version"]==7
    if (modern or any(tool.get("runtime")=="browser" or tool.get("ui",{}).get("kind")=="web" for tool in manifest["tools"])) and (not modern or any(tool.get("runtime")!="browser" or tool.get("ui",{}).get("kind")!="web" for tool in manifest["tools"])):raise ValueError("网页工具仅支持 v7 和 HTML/CSS/JS 页面入口")
    source_limit=(8 if modern else 1)*1048576
    package_limit=(128 if modern else 2)*1048576
    if not re.fullmatch(r"[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+",manifest["module_id"]):raise ValueError("工具包 ID 无效")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?",manifest["version"]):raise ValueError("版本无效")
    resource_types={"wasm","js","json","bin","png","jpg","jpeg","webp","gif","svg","avif","bmp","ico","heic","heif","jxl","tif","tiff","woff","woff2","ttf","otf","mp3","wav","ogg","flac","m4a","aac","mp4","webm","mov"}
    assets={};descriptors={};sources={}
    def add_resource(relative):
        if not modern or Path(relative).suffix[1:] not in resource_types:raise ValueError("独立资源需要 v7 和支持的资源类型")
        data=read(relative,96*1048576)
        if relative.endswith(".wasm") and not data.startswith(b"\0asm\x01\0\0\0"):raise ValueError("WASM 头无效")
        if relative.endswith(".js"):data.decode("utf-8")
        digest=hashlib.sha256(data).hexdigest()
        assets[relative]=data;descriptors[relative]={"path":relative,"size":len(data),"sha256":digest}
        if len(assets)>128:raise ValueError("资源数量超过 128 个")
        return descriptors[relative]
    for descriptor in manifest.get("resources",[]):
        actual=add_resource(descriptor["path"])
        if (descriptor.get("sha256") and descriptor["sha256"]!=actual["sha256"]) or (descriptor.get("size") and descriptor["size"]!=actual["size"]):raise ValueError("资源摘要或大小不符")
    mime={"png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","webp":"image/webp","gif":"image/gif","svg":"image/svg+xml","woff":"font/woff","woff2":"font/woff2"}
    def embedded(match):
        relative=match.group(1)
        if modern:add_resource(relative);return "{{resource:"+relative+"}}"
        kind=Path(relative).suffix[1:]
        if kind not in mime:raise ValueError("不支持的静态资源")
        return "data:"+mime[kind]+";base64,"+base64.b64encode(read(relative,524288)).decode("ascii")
    for path in sorted(root.rglob("*")):
        relative=path.relative_to(root).as_posix()
        if any(part.startswith(".") or part=="node_modules" for part in path.relative_to(root).parts):continue
        if path.is_symlink():raise ValueError("工具目录不能包含链接")
        if relative in assets or not path.is_file() or path.suffix not in (".js",".html",".css"):continue
        if len(sources)>=(128 if modern else 16):raise ValueError("源码数量超限")
        text=read(relative,source_limit).decode("utf-8")
        if path.suffix in (".html",".css"):text=re.sub(r"\{\{asset:([^}]+)\}\}",embedded,text)
        data=text.encode("utf-8")
        if len(data)>source_limit:raise ValueError("内嵌后源码大小超限")
        sources[relative]=data
    for tool in manifest["tools"]:
        paths=[tool["entry"]]
        if tool["ui"]["kind"]=="web":paths += [tool["ui"]["script"],tool["ui"]["style"]]
        if any(path not in sources for path in paths):raise ValueError("缺少入口源码")
    if modern:manifest["resources"]=[descriptors[path] for path in sorted(descriptors)]
    files={**sources,**assets,"manifest.json":json.dumps(manifest,ensure_ascii=False,separators=(",",":")).encode("utf-8")}
    if not sources or len(files["manifest.json"])>65536 or sum(map(len,sources.values()))>(32 if modern else 2)*1048576 or sum(map(len,files.values()))>package_limit:raise ValueError("源码或包总量超限")
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_STORED) as archive:
        for name,data in files.items():archive.writestr(name,data)
    result=buffer.getvalue()
    if len(result)>package_limit:raise ValueError("工具包大小超限")
    output=Path(destination) if destination else root/(manifest["module_id"]+"-"+manifest["version"]+".fftool")
    if output.suffix.lower()!=".fftool" or output.is_symlink():raise ValueError("输出必须为普通 .fftool 文件")
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_name(output.name+".tmp-"+uuid.uuid4().hex)
    try:temporary.write_bytes(result);temporary.replace(output)
    finally:
        if temporary.exists():temporary.unlink()
    return output.resolve()

if __name__=="__main__":
    if len(sys.argv) not in (2,3):raise SystemExit("用法：python pack_fftool.py 工具目录 [输出.fftool]")
    print(pack(*sys.argv[1:]))
```

导入入口为“工具管理 → 工具工作台 → 导入工具”。交付前检查正常输入、错误输入、额度、取消、320 px 布局、浅深色主题和实际结果；有资源加载或长任务时，额外检查加载反馈、资源读取失败、损坏输入、重试恢复，以及取消/离开后的迟到结果和资源清理。有客户端时再验证导入和运行；模拟后端不等于原生验证。若只完成打包或代码检查，准确说明尚未完成的部分。
