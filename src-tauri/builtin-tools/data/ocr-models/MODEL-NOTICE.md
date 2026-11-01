# OCR 模型与来源

本项目使用的检测模型、识别模型和字符字典，直接来源为 [OOCCRR 图片文字识别工具](https://www.ooccrr.com/zh/image-ocr/)，对应下载资源位于 `cdn.ooccrr.com/models/`。本项目最初参考用户提供的 `图片文字识别.html` 接入检测、识别流程及模型配置，并调整几何后处理与 CTC 解码，增加边界提取、张量验证、资源释放和后台执行。

三份资源的下载地址、原始文件名、大小与 SHA-256 固定在 [models.json](models.json)。这些记录对应本项目实际打包的文件，不代表来源网站后续更新的全部模型，也未将其标为 PaddleOCR 官方发布文件。

来源网站的服务使用规则见 [OOCCRR 用户协议](https://www.ooccrr.com/zh/terms/)。本仓库目前未附这三份模型资源的独立许可文本或单独的再分发授权文件；本说明用于记录来源，不将网站的免费使用说明、ONNX Runtime 的 MIT 许可或本项目的 MIT 许可作为模型再分发授权。

运行库使用 ONNX Runtime Web 1.23.2（MIT），完整许可见 `ONNX-RUNTIME-LICENSE`。图像读取与原图裁剪沿用项目的 ImageMagick 引擎及其原有许可说明。识别运行时无需访问模型下载站点。

为兼容网页工具的 Blob Worker，构建时保留运行库的内嵌 WASM 工厂及原始 WASM 二进制，强制单线程并通过 `wasmBinary` 提供字节；只替换 1.23.2 中仍会求值的备用 WASM 相对地址表达式，防止不具备模块基址的 Worker 报 Invalid URL。此适配不改变 WASM、模型或推理逻辑，表达式数量在构建时校验。
