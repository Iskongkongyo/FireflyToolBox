# 开发与验证

以下命令在仓库根目录执行。

| 环境    | 要求                                                         |
| ------- | ------------------------------------------------------------ |
| 通用    | Git、Node.js 22、npm、Rust 稳定版                            |
| Windows | MSVC 工具链、Visual Studio C++ 构建工具、WebView2 Runtime    |
| Android | JDK 21、Android SDK（API 36）、NDK `26.1.10909125`、Rust target `aarch64-linux-android` |

原生环境安装可参考 [Tauri 开发前置条件](https://v2.tauri.app/start/prerequisites/)。

## 获取源码与启动

```powershell
git clone https://github.com/Iskongkongyo/FireflyToolbox.git
cd FireflyToolbox
npm ci
npm run build:builtin-tools
npm run tauri dev
```

仅预览界面可运行 `npm run dev`；文件、系统窗口等原生能力需要在 Tauri 客户端中使用。

## Windows 构建

```powershell
npm run build:portable
```

## Android 构建

Android 工程已初始化，应用包名为 `firefly.toolbox`。将 `JAVA_HOME` 指向 JDK 21，并根据实际安装位置调整 SDK 路径：

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/26.1.10909125'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
rustup target add aarch64-linux-android
npm run tauri -- android build -d -t aarch64 --apk --ci
```

上面的命令生成 arm64 调试包；正式发布时请配置自己的 release 签名，并保存好签名密钥。

## 常用检查

```powershell
npm run build
cargo test -p toolbox-core -p toolbox-storage
npm run test:web-tool-resources
npm run test:module-v7
npm run test:module-v7:browser
npm run test:tool-repository
npm run test:tool-repository:browser
npm run test:website-blob
npm run test:web-tool
npm run test:web-tool-budget:browser
npm run test:web-tool-files:browser
npm run test:web-tool-services
npm run test:web-tool-services:browser
npm run test:module-capacity
npm run test:device-sync
npm run test:builtin-persistence:browser
npm run test:mobile-ripples:browser
npm run test:image-inputs
npm run test:ppocr
```

连接专用模拟器和真机后，可运行 `npm run test:device-sync:device` 检查保存确认及原生加密同步。模拟器作为发送端，接收端只导入临时测试工具的数据；连接通过 ADB 转发，不用于验证 Wi-Fi 可达性。

工具市场的原生回归使用固定的本地 HTTP 目录及工具包：先将 `FIREFLY_REPOSITORY_TEST_URL` 设为 `http://127.0.0.1:18794/`，编译隔离 Windows 调试客户端和 Android 调试 APK，再依次运行 `node scripts/test-tool-repository-device.mjs --windows` 与 `npm run test:tool-repository:device`。两端不能同时占用测试端口。脚本只安装独立命名的临时工具，结束后清理并恢复涉及的偏好；测试目录不读写正式工具库缓存。完成后清空该环境变量并重新编译、安装正常客户端，避免保留测试入口；正式 release 构建忽略此变量。

正常调试客户端可运行 `node scripts/test-tool-repository-live.mjs --windows` 或去掉 `--windows`，直接验证 FFTools 真实目录、提交名称、安装预览和最大工具包下载校验；此项需要联网，不安装仓库工具，结束后恢复相关偏好。

运行 `powershell.exe -NoProfile -NonInteractive -File scripts/test-web-tool-budget-settings-windows.ps1` 可编译并检查独立数据目录的 Windows 测试客户端。安装同一版 Android 调试 APK 并连接真机后，加上 `-WithAndroidSync` 可检查两项预算的双向同步和恢复默认；通道使用 ADB 转发，结束后恢复两端原偏好。

正式便携版启动检查：先退出正在使用的正式客户端，执行 `npm run build:portable`，再运行 `powershell.exe -NoProfile -NonInteractive -File scripts/test-windows-release-startup.ps1`。脚本使用真实发布产物和现有用户配置，保留缓存，连续启动三次，通过 Win32 窗口与可访问性树检查主窗口显示、页面渲染、进程响应和原生崩溃日志；只关闭自己启动的进程，不清空配置或确认通知。它补充隔离调试版测试，覆盖窗口创建期间可能发生的早期 IPC。

网络 API、存储迁移、Worker 队列和容量的 Windows 原生检查：先运行上述 Windows 脚本并加上 `-BuildOnly`，再运行 `node scripts/test-web-tool-services-device.mjs --windows` 和 `node scripts/test-module-capacity-device.mjs --windows`。去掉 `--windows` 即检查连接的 Android 真机；脚本仅安装临时测试工具并在结束后清理。

指南的分组与图标可运行 `node scripts/test-module-metadata-device.mjs --windows` 检查；去掉 `--windows` 即检查连接的 Android 真机。脚本验证完整模板、全部图标标识、自定义 PNG 和分类，并核对首页实际渲染，结束后清理临时工具。

指南页面的布局、全文复制与加载期间返回可运行 `node --test scripts/test-tool-author-skill-page-browser.mjs` 检查（先构建前端）。运行 `node scripts/test-tool-author-skill-page-device.mjs --windows` 可检查 Windows 原生页面与草稿保留；去掉 `--windows` 即检查 Android 真机，并验证系统返回键。使用同版测试客户端，保持应用在前台，脚本结束后恢复原草稿。

自动化独立编辑页可运行 `node --test scripts/test-custom-tool-page-browser.mjs` 检查窄屏布局、步骤排序、保存失败重试和编辑返回。运行 `node scripts/test-custom-tool-page-device.mjs --windows` 检查 Windows；去掉 `--windows` 检查 Android 真机，实际创建、执行及更新临时自动化，结束后清理测试记录并恢复分组与使用统计偏好。

其余专项检查入口见 [package.json](../../package.json) 的 `scripts`。涉及客户端功能的改动，请分别说明 Windows 与 Android 的构建及验证情况。

平板导航回归可运行 `node --test scripts/test-app-layout-browser.mjs`，覆盖 Android 平板宽度、自动隐藏开关保存、滑动分页及 Windows 窗口尺寸变化。安装同版调试 APK 后，运行 `node scripts/test-app-layout-device.mjs` 检查连接的 Android 平板触摸交互；加上 `--windows` 检查隔离 Windows 客户端，结束后恢复测试涉及的偏好。

智能识别可运行 `npm run test:detection` 与 `npm run test:detection:browser` 检查异步结果、剪贴板、页面返回及窄屏布局。`node scripts/test-detection-page-device.mjs --windows` 检查 Windows 原生页面，去掉 `--windows` 检查连接的 Android 真机；脚本直接填入固定文本，验证真实原生识别、元数据、带入与返回，不读写系统剪贴板，结束后恢复原偏好。粘贴成功、读取失败与迟到读取由浏览器用例使用模拟剪贴板验证。

连接 Android 真机并准备好隔离 Windows 测试客户端后，可运行 `node scripts/test-group-sync-polish-device.mjs` 验证空分组隐藏、已安装工具操作按钮与双向同步预览的联网折叠。脚本仅使用临时工具包，不导入接收预览，结束后清理工具并恢复分组等原偏好；同步经 ADB 转发，不代表 Wi-Fi 可达性验证。
