# 更新检测与通知

应用启动时在后台请求同一份 JSON，不阻塞界面。失败后间隔 500 毫秒重试一次（最多请求两次），每次最多 8 秒，最终失败不弹窗、不发消息。返回的更新与通知依次展示；启动图、搜索、侧边栏或已有对话框结束后才显示。

## 接入地址

正式地址为 `https://firefly.202132.xyz/fireflytoolbox/message.json`，已写入 `src-tauri/remote-messages.json`。将 [messages.json](messages.json) 的内容按需修改后部署到该地址即可。也可以在构建进程中设置 `FIREFLY_MESSAGES_URL` 环境变量覆盖此值；设为空字符串可关闭消息请求。地址只在构建时读取，不提供面向普通用户的服务器配置入口；更换地址需要重新编译双端。

远程 JSON 内容可随时更新，无需重新发布应用。示例中的两项 `enabled` 均为 `false`，下载链接也是占位地址，发布前务必替换。服务器不需要接收账号、设备标识、工具数据或已读 ID；网络服务仍会看到常规连接信息（例如 IP 地址）。

## JSON 字段

| 字段 | 含义 |
| --- | --- |
| `schema_version` | 固定为数字 `1` |
| `update` / `notification` | 两项相互独立；不需要时可省略或设为 `null` |
| `id` | 非空字符串，最多 160 字节；发布新消息时更换 ID |
| `enabled` | 真正的 JSON 布尔值；只有 `true` 才参与显示判断 |
| `show_once` | 布尔值，默认 `true`；同一 ID 确认后不再自动弹出。`false` 时每次启动都可弹出，强制更新仍优先持续提示 |
| `title` | 支持 Emoji 的纯文本标题，最多 120 个 Unicode 码点，不解析 HTML |
| `content` | 支持 Emoji 的 HTML 正文，单项最多 128 KiB |
| `update.version` | 严格语义版本号，例如 `0.1.70`，只有高于当前应用版本才显示 |
| `update.force` | 布尔值，默认 `false`；`true` 时弹窗没有关闭/稍后按钮，Esc 和 Android 返回键也不能跳过 |
| `update.downloads.windows` | Windows 版 HTTPS 下载地址，可使用发布页或直链 |
| `update.downloads.android` | Android 版 HTTPS 下载地址，可使用发布页或直链 |

更新展示必须同时满足：`version` 高于当前应用版本名、`enabled` 为 `true`、当前平台存在有效的 HTTPS 下载链接（以及标题 / ID 等基本字段有效）。相同或更低版本、关闭开关、只提供另一平台链接、空链接或非法链接，都不展示更新，即使 `force: true` 也不能绕过这三个条件。无效更新不会阻止有效通知显示。版本使用应用运行时的版本名按语义版本比较，例如 `1.10.0` 高于 `1.9.0`；预发布版本按语义版本比较，构建元数据不触发更新。原生下载交给系统浏览器，不自动下载、安装或重启应用；点击“前往下载”后保留弹窗，防止误以为打开链接就已更新。操作失败可重试，弹窗不额外展示下载链接区域。

当 `show_once: true`（或未填写）时，普通更新点“稍后再说”或关闭后、通知点“我知道了”或关闭后，分别按 `update:id` / `notification:id` 记住。相同 ID 下次不再自动弹出；更换 ID 可再次提示。当 `show_once: false` 时，忽略此前已读记录，确认后不写入已读记录，下一次启动仍可弹出；同一次启动中关闭后不会马上重复弹，也不会因切回前台再次请求。更新与通知分别配置该字段。

强制更新优先于 `show_once`：只要满足更新展示条件，即使此前已确认相同 ID，也会继续展示，避免重启绕过强制更新。关闭服务器 `enabled` 后下次启动不再显示。已读记录只存在本机，最多保存最近 200 项，不参与设备同步和配置备份；没有缓存旧的强制更新配置，离线启动不会被过期缓存拦住。

“关于应用 → 检查更新”支持主动重查，并允许再次查看已暂缓的普通更新；手动失败会发出简短消息，不重复展示通知。“历史版本”保留项目发布页入口。应用每次进程启动检查一次，不在切回前台时循环请求。

## 正文 HTML

支持 `h1`–`h6`、`p`、`br`、`img`、`a`、`strong` / `b`、`em` / `i`、`u`、`s` / `del`、`ul` / `ol` / `li`、`blockquote`、`pre` / `code`、`hr`、`span` / `div`、`table` / `thead` / `tbody` / `tr` / `th` / `td`、`sup` / `sub`。

正文经过 DOMPurify 标签与属性白名单清理。脚本、事件处理器、任意样式、表单、iframe、SVG 和内嵌音视频不会运行或展示；不接受远程 `class`、`id`、`data-*`。图片和链接必须使用绝对 HTTPS 地址，禁止 `javascript:`、`data:`、`file:` 和应用内部地址。图片自适应卡片宽度、延迟加载、不携带来源页；链接始终通过系统浏览器打开。正文随应用主题和字体大小排版，长内容仅在卡片中滚动，操作按钮保持可见。

整个 JSON 最多 256 KiB；建议图片用适合手机的压缩尺寸。使用 UTF-8，HTTP 状态须成功；支持至多两次 HTTPS 跳转，不发送 Cookie 或本地已读状态。请合理设置静态托管的缓存时间，客户端请求带有 `Cache-Control: no-cache`。

标题与正文可直接输入 Emoji，例如 `"title": "✨ 流萤有新版本啦"`、`"content": "<p>感谢陪伴 💚🐱</p>"`，也兼容合法 JSON Unicode 转义；正文中的 HTML 数字实体也能正常显示。保留肤色、变体选择符和组合 Emoji，不将其替换成图片。字体优先使用系统的彩色 Emoji 字体，具体可显示的最新表情取决于设备字体版本。

## 验证

- `npm run test:remote-messages:browser`：生产前端的弹窗顺序、HTML 过滤、已读状态、强制更新、手动检查和窄屏排版。
- `cargo test -p firefly-toolbox remote_messages::tests --lib`：原生版本/平台校验、独立解析、真实 HTTP 失败重试与容量限制。
- 原生设备脚本与本地服务见 `scripts/test-remote-messages-device.mjs`，需要使用 `FIREFLY_MESSAGES_URL=http://127.0.0.1:18791/messages.json` 编译的调试版本；Android 使用 ADB reverse 连接本机服务。HTTP 回环地址只对调试构建开放，正式构建仍要求 HTTPS。
