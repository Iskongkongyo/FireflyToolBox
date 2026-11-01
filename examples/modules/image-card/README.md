# 图片卡片网页工具示例

在项目根目录运行 `npm run module:bundle -- examples/modules/image-card`，然后到“模块工作台 → 导入模块”安装生成的 `.fftool`。打开“图片卡片生成器”后可以修改标题、预览 Canvas，并通过宿主保存 PNG。

这个 Manifest v7 示例包含独立的 HTML、CSS 和 JS 文件。JS 导出 `mount({ saveFile })`；`saveFile(文件名, Blob)` 会让用户选择保存位置，取消时返回 `false`。小文件接口继续在 v7 中使用，网页工具在隔离页面中运行。
