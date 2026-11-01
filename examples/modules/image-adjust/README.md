# 图片亮度处理示例

Manifest v7 网页工具，演示用户选文件、Canvas 预览处理和 PNG 保存。源码只用 HTML、CSS 和 JS，不需要额外依赖；继续使用 `openFile/saveFile` 小文件接口。

```powershell
npm run module:bundle -- examples/modules/image-adjust
```

在「全部工具 → 模块工作台 → 导入模块」安装生成的 `.fftool`。选择 PNG、JPEG、WebP 或 GIF 图片后，可调整亮度、切换灰度并保存 PNG。

模块调用 `openFile({ extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] })`。用户取消时返回 `null`，选中后返回 `{ name, blob }`；扩展名列表是选取器过滤提示，工具仍应验证文件内容。单文件输入上限由 Manifest `input_bytes` 声明，此示例为 8 MiB。输出上限 4 MiB，图片预览最长边缩到 1024 像素。

页面图标和背景图案来自 `assets/` 里的 SVG。HTML 的 `src="{{asset:assets/badge.svg}}"` 和 CSS 的 `url("{{asset:assets/dots.svg}}")` 会在 v7 打包时转换为独立资源引用，随包保存并校验大小与 SHA-256。单个资源最多 48 MiB，单个源码最多 4 MiB；运行时由资源接口生成可用地址。
