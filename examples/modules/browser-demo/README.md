# 浏览器模块示例

运行 `npm run module:bundle -- examples/modules/browser-demo`，在示例目录生成 `.fftool`，再到 Windows 或 Android 的“工具工作台 → 导入工具”安装。

此示例使用 v7 网页入口、DOM 和按模块隔离的 `localStorage`。`mount()` 初始化页面，点击按钮后显示输入内容与累计次数；切换工具会关闭页面。一个包可以包含多个网页工具，通过 `module:bundle` 命令将 npm 包和相对导入合并进各自入口。不再使用旧版浏览器 `run()` 文本入口。
