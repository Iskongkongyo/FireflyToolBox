# 媒体与大文件示例

应用 0.1.27 起，清单 v7 可携带独立二进制资源。这个示例验证包内 WASM、受管理 Worker、原生媒体预览、分块复制及标准 PCM WAV 截取。它不包含 FFmpeg，也不提供通用转码。

运行 `npm run module:bundle -- examples/modules/media-files`，再导入生成的 `.fftool`。JS 的相对导入由打包器合并；Worker 资源已经是独立脚本。`assets/add.wasm` 只导出一个整数加法函数。

选取音视频后可以预览。系统文件提供程序须提供可定位的文件，媒体编码仍取决于本机 WebView。复制和截取每次读写最多 1 MiB，输入输出额度各 2 GiB；保存前的结果只存在应用临时目录。WAV 截取保留采样率、声道、位深与选定区间的原始 PCM 数据，不重新编码；只接受编码编号 1 的 PCM WAV。

文件、WASM 和临时输出不会同步到远端服务。退出工具会终止 Worker、关闭文件句柄并清理未保存输出。
