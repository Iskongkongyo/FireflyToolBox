# Node 风格接口示例

此 v7 网页工具使用 `node:buffer` 和 `node:path` 的浏览器实现，通过 `mount()` 初始化页面，显示文件名、UTF-8 字节数与 Base64。先在开发机运行：

```powershell
npm run module:bundle -- examples/modules/node-compat
```

再将生成的 `.fftool` 导入 Windows 或 Android 版模块工作台。运行时仍是隔离浏览器，不提供原生 Node.js、文件系统或子进程权限。
