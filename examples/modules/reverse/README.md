# 文本反转模块示例

在此目录中，将 `manifest.json`、`main.js` 和 `helper.js` 放在 ZIP 根目录，然后把 ZIP 文件扩展名改为 `.fftool`。可用 Python 一步生成：

```sh
python -m zipfile -c reverse.fftool manifest.json main.js helper.js
```

在 Windows 或 Android 版应用的「全部工具」右上角点击代码图标，进入“模块工作台 → 导入模块”，选择该文件并确认安装。模块脚本导出 `run(input, action)`，也可导出异步函数；其中输入和结果均为 `{ text: string }`。QuickJS 模式可通过相对路径导入包内 `.js` 文件，安装时会检查入口、导出和依赖；它不提供网络、文件、剪贴板或 Node 内置 API。

“手动创建模块”可用表单创建模块，或载入此示例修改 `main.js` 和 `helper.js`；已安装模块也可导出为 `.fftool`。许可证可选择 MIT、GPL 等常见标识或无证书；工具图标可选择宿主预设图标，也可导入 SVG、PNG、JPEG 或 WebP。导入的图标会转换成内嵌 PNG，随 `.fftool` 一起导出。若源码引用 npm 包，可先在有 `node_modules` 的开发机执行 `npm run module:bundle -- examples/modules/reverse`，得到合并依赖的 `.fftool`。
