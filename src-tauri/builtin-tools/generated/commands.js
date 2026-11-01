// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text2, error = false) {
  $("status").textContent = text2;
  $("status").classList.toggle("error", error);
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

// src-tauri/builtin-tools/src/commands-extra-data.js
var EXTRA_COMMAND_ROWS = [
  ["SQL", "查询指定字段", "SELECT <字段> FROM <表>;", "SELECT id, name FROM users;", "读取表中指定字段。", "示例表名和字段需替换；字段名不要用单引号包围。", "select"],
  ["SQL", "按条件筛选", "SELECT <字段> FROM <表> WHERE <条件>;", "SELECT id, name FROM users WHERE status = 'active';", "读取符合条件的记录。", "示例是 SQL 文本；程序中应通过数据库驱动绑定参数。", "select"],
  ["SQL", "排序查询结果", "SELECT <字段> FROM <表> ORDER BY <字段> DESC;", "SELECT id, name FROM users ORDER BY id DESC;", "按字段倒序排列结果。", "ASC 升序，DESC 降序；未指定排序时不保证行顺序。", "select"],
  ["SQL", "分页读取", "SELECT <字段> FROM <表> ORDER BY <字段> LIMIT <数量> OFFSET <偏移>;", "SELECT id, name FROM users ORDER BY id LIMIT 20 OFFSET 0;", "限制返回数量并跳过前面的行。", "适用于 SQLite、PostgreSQL、MySQL；SQL Server 的分页语法不同。", "select"],
  ["SQL", "统计记录数量", "SELECT COUNT(*) FROM <表>;", "SELECT COUNT(*) AS total FROM users;", "统计记录行数。", "COUNT(字段) 不包含该字段为 NULL 的记录。", "select"],
  ["SQL", "分组聚合", "SELECT <字段>, COUNT(*) FROM <表> GROUP BY <字段>;", "SELECT status, COUNT(*) AS total FROM users GROUP BY status;", "按相同字段值分组并计数。", "非聚合字段通常应同时出现在 GROUP BY 中。", "select"],
  ["SQL", "筛选聚合结果", "SELECT <字段>, COUNT(*) FROM <表> GROUP BY <字段> HAVING <条件>;", "SELECT status, COUNT(*) AS total FROM users GROUP BY status HAVING COUNT(*) > 5;", "对分组后的结果设置条件。", "WHERE 筛选分组前的行，HAVING 筛选聚合后的组。", "select"],
  ["SQL", "内连接查询", "SELECT <字段> FROM <表1> JOIN <表2> ON <连接条件>;", "SELECT u.name, o.id FROM users AS u JOIN orders AS o ON o.user_id = u.id;", "返回两张表中符合连接条件的记录。", "JOIN 默认可写为 INNER JOIN；相同字段名需使用表别名。", "select"],
  ["SQL", "左连接查询", "SELECT <字段> FROM <左表> LEFT JOIN <右表> ON <条件>;", "SELECT u.name, o.id FROM users AS u LEFT JOIN orders AS o ON o.user_id = u.id;", "保留左表所有记录，右表无匹配时为 NULL。", "把右表过滤条件放在 WHERE 中可能排除无匹配的左表记录。", "select"],
  ["SQL", "插入记录", "INSERT INTO <表> (<字段>) VALUES (<值>);", "INSERT INTO users (id, name, status) VALUES (1, 'Alice', 'active');", "新增一条记录。", "会修改数据；主键不能与已有记录冲突，字符串用单引号。", "insert"],
  ["SQL", "更新指定记录", "UPDATE <表> SET <字段> = <值> WHERE <条件>;", "UPDATE users SET status = 'inactive' WHERE id = 1;", "更新满足条件的记录。", "先 SELECT 核对条件；省略 WHERE 会更新整张表。", "update"],
  ["SQL", "删除指定记录", "DELETE FROM <表> WHERE <条件>;", "DELETE FROM users WHERE id = 1;", "删除符合条件的记录。", "先查询核对；省略 WHERE 会删除全部记录。", "delete"],
  ["SQL", "创建数据表", "CREATE TABLE <表> (<字段定义>);", "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, status VARCHAR(20));", "定义数据表的字段与约束。", "主键自动增长的写法因数据库而异，此示例不启用自动增长。", "createtable"],
  ["SQL", "创建索引", "CREATE INDEX <索引名> ON <表> (<字段>);", "CREATE INDEX idx_users_status ON users (status);", "给常用查询字段建立索引。", "索引占空间并增加写入成本；是否使用由查询规划器决定。", "createindex"],
  ["SQL", "提交或回滚事务", "BEGIN;\n<修改语句>\nCOMMIT;", "BEGIN;\nUPDATE users SET status = 'active' WHERE id = 1;\nCOMMIT;", "将一组修改在事务中提交。", "此形式适用于 SQLite/PostgreSQL；MySQL 可用 START TRANSACTION。提交前用 ROLLBACK; 放弃修改，COMMIT 后不能靠回滚撤销。", "transaction"],
  ["ADB", "查看连接设备", "adb devices -l", "adb devices -l", "列出已连接的 Android 设备及状态。", "设备需启用调试并授权；unauthorized 表示尚未授权。", "adb"],
  ["ADB", "查看 ADB 版本", "adb version", "adb version", "显示 Android Debug Bridge 版本。", "ADB 随 Android SDK Platform-Tools 提供。", "adb"],
  ["ADB", "指定设备进入 shell", "adb -s <序列号> shell", "adb -s DEVICE_SERIAL shell", "进入指定设备的交互 shell。", "请将 DEVICE_SERIAL 替换为 adb devices 输出的序列号；exit 退出。", "adb"],
  ["ADB", "安装或更新 APK", "adb install -r <APK路径>", "adb install -r ./app.apk", "安装 APK，已安装时尝试保留数据更新。", "签名必须兼容；-r 不绕过签名或版本限制。", "adb"],
  ["ADB", "卸载应用", "adb uninstall <包名>", "adb uninstall com.example.app", "卸载指定包名对应的应用。", "会删除应用数据；此示例包名需替换。", "adb"],
  ["ADB", "传文件到设备", "adb push <本机路径> <设备路径>", "adb push ./example.txt /sdcard/Download/example.txt", "把本机文件复制到设备。", "目标路径需要可写；同名文件可能被覆盖。", "adb"],
  ["ADB", "从设备取文件", "adb pull <设备路径> <本机路径>", "adb pull /sdcard/Download/example.txt ./example.txt", "把设备文件复制到本机。", "设备路径需要有读取权限；本机同名文件可能被覆盖。", "adb"],
  ["ADB", "查看实时日志", "adb logcat", "adb logcat", "持续读取 Android 系统日志。", "按 Ctrl+C 停止查看；日志可能含应用数据。", "logcat"],
  ["ADB", "按标签筛选日志", "adb logcat -s <标签:级别>", "adb logcat -s MyApp:D", "只查看指定标签达到所选级别的日志。", "V/D/I/W/E/F/S 分别表示不同等级；标签是示例。", "logcat"],
  ["ADB", "列出应用包名", "adb shell pm list packages", "adb shell pm list packages", "列出设备安装的应用包名。", "可加 -3 只列第三方应用。", "adb"],
  ["ADB", "启动指定 Activity", "adb shell am start -n <包名/Activity>", "adb shell am start -n com.example.app/.MainActivity", "启动指定应用界面。", "Activity 需要存在且允许当前调用方启动。", "adb"],
  ["ADB", "发送 Home 按键", "adb shell input keyevent 3", "adb shell input keyevent 3", "发送 KEYCODE_HOME，返回设备桌面。", "需要设备处于可操作状态；其他键值需查 Android KeyEvent。", "keyevent"],
  ["ADB", "查看屏幕尺寸", "adb shell wm size", "adb shell wm size", "输出设备物理及覆盖设置的屏幕尺寸。", "此命令只读取，不设置新的尺寸。", "adb"],
  ["ADB", "截图并取回", "adb shell screencap -p <设备PNG>\nadb pull <设备PNG> <本机PNG>", "adb shell screencap -p /sdcard/Download/screen.png\nadb pull /sdcard/Download/screen.png ./screen.png", "先把截图保存到设备，再复制到本机。", "已有同名图片会被覆盖；安全界面可能禁止截图。", "adb"],
  ["ADB", "重启设备", "adb reboot", "adb reboot", "重启连接的 Android 设备。", "会中断设备上正在进行的任务。", "adb"],
  ["Curl", "查看 curl 版本", "curl --version", "curl --version", "显示 curl 版本及支持的协议。", "Windows PowerShell 5.1 可用 curl.exe，避免调用别名。", "version"],
  ["Curl", "发送 GET 请求", "curl <URL>", "curl https://example.com/", "获取响应正文并输出。", "未指定其他数据选项时通常是 GET；示例地址需替换。", "url"],
  ["Curl", "只查看响应头", "curl --head <URL>", "curl --head https://example.com/", "通过 HEAD 请求获取响应头。", "部分服务不支持 HEAD；不能等同于 GET 正文请求。", "head"],
  ["Curl", "同时显示响应头和正文", "curl --include <URL>", "curl --include https://example.com/", "在输出中保留状态和响应头。", "--include 与 --head 不同，仍会读取正文。", "include"],
  ["Curl", "跟随重定向", "curl --location <URL>", "curl --location --max-redirs 5 https://example.com/", "请求 Location 指向的后续地址。", "--max-redirs 限制跳转次数；不要把敏感信息随意发往跳转后的站点。", "location"],
  ["Curl", "下载文件", "curl --fail --location --output <文件> <URL>", "curl --fail --location --output example.html https://example.com/", "将请求内容保存到指定文件。", "--fail 遇到 HTTP 400 及以上通常失败；同名文件会被覆盖。", "output"],
  ["Curl", "添加请求头", "curl --header <请求头> <URL>", 'curl --header "Accept: application/json" https://example.com/api', "发送自定义 HTTP 请求头。", "头名和值用冒号分隔；示例接口需替换。", "header"],
  ["Curl", "POST JSON 数据", 'curl --header "Content-Type: application/json" --data <JSON> <URL>', `curl --header "Content-Type: application/json" --data '{"name":"Alice"}' https://example.com/api`, "提交 JSON 正文，--data 会使用 POST。", "此例按 Bash 书写；Windows 可改用下一条的文件正文。", "data"],
  ["Curl", "从文件 POST JSON", 'curl --header "Content-Type: application/json" --data-binary @<文件> <URL>', 'curl --header "Content-Type: application/json" --data-binary "@request.json" https://example.com/api', "原样读取文件内容作为请求体提交。", "request.json 需要先创建，内容编码与接口要求一致。", "data-binary"],
  ["Curl", "提交 URL 编码表单", "curl --data-urlencode <键=值> <URL>", 'curl --data-urlencode "name=Alice Smith" https://example.com/form', "对表单值进行编码后 POST。", "多个字段可重复使用 --data-urlencode。", "data-urlencode"],
  ["Curl", "上传表单文件", "curl --form <字段=@文件> <URL>", 'curl --form "file=@example.txt" https://example.com/upload', "使用 multipart/form-data 上传文件。", "字段名及上传地址由接口定义；不必手写 multipart 边界。", "form"],
  ["Curl", "设置请求超时", "curl --connect-timeout <秒> --max-time <秒> <URL>", "curl --connect-timeout 5 --max-time 15 https://example.com/", "限制连接阶段与整个请求的耗时。", "单位为秒；超时会使请求失败。", "max-time"],
  ["Curl", "查看耗时与状态码", "curl --silent --show-error --output <文件> --write-out <格式> <URL>", 'curl --silent --show-error --output response.txt --write-out "HTTP %{http_code} total %{time_total}s" https://example.com/', "保存正文并输出 HTTP 状态码和总时间。", "--silent 关闭进度；--show-error 保留错误提示。", "write-out"],
  ["Curl", "有限次数重试", "curl --retry <次数> --retry-delay <秒> <URL>", "curl --retry 3 --retry-delay 2 https://example.com/", "在部分临时失败时重试。", "不是所有错误都会重试；谨慎重试可能产生副作用的请求。", "retry"],
  ["Curl", "输出请求调试信息", "curl --verbose <URL>", "curl --verbose https://example.com/", "显示连接、TLS 与请求响应头调试信息。", "分享日志前检查 Cookie、Authorization 等敏感头。", "verbose"],
  ["Python", "查看 Python 版本", "python --version", "python --version", "确认当前 Python 解释器版本。", "某些系统命令名为 python3；Windows 也可用 py -3。", "cmdline"],
  ["Python", "运行脚本", "python <脚本路径> [参数]", "python ./main.py --help", "使用当前解释器执行 Python 文件。", "参数含空格时加引号；--help 是否支持由脚本决定。", "cmdline"],
  ["Python", "运行一段代码", "python -c <代码>", 'python -c "print(2 + 3)"', "直接执行简短 Python 代码。", "复杂代码建议保存到文件，减少 shell 转义问题。", "cmdline"],
  ["Python", "创建虚拟环境", "python -m venv <目录>", "python -m venv .venv", "创建隔离的项目 Python 环境。", "用相应系统的激活命令，或直接调用 .venv 中的解释器。", "venv"],
  ["Python", "激活环境：Bash", "source <环境>/bin/activate", "source .venv/bin/activate", "在 Linux/macOS 的 Bash 或兼容 shell 激活环境。", "只影响当前 shell；Windows PowerShell 使用下一条。", "venv"],
  ["Python", "激活环境：PowerShell", "<环境>\\Scripts\\Activate.ps1", ".\\.venv\\Scripts\\Activate.ps1", "在 Windows PowerShell 激活虚拟环境。", "需允许执行该脚本；也可直接调用 .\\.venv\\Scripts\\python.exe，不必更改策略。", "venv"],
  ["Python", "退出虚拟环境", "deactivate", "deactivate", "退出当前 shell 中已激活的虚拟环境。", "此命令由激活脚本提供，并不是 python 子命令。", "venv"],
  ["Python", "安装依赖包", "python -m pip install <包>", "python -m pip install requests", "用指定 Python 的 pip 安装依赖。", "建议在项目虚拟环境中使用；可写 包名==版本 固定版本。", "pip-install"],
  ["Python", "按依赖文件安装", "python -m pip install -r <依赖文件>", "python -m pip install -r requirements.txt", "按文件中的包名和版本安装。", "先确认文件来源与内容；安装操作可能执行构建脚本。", "pip-install"],
  ["Python", "列出已安装包", "python -m pip list", "python -m pip list", "查看当前解释器环境中已安装的包。", "检查正在使用的解释器，避免混淆不同环境。", "pip-list"],
  ["Python", "导出依赖版本", "python -m pip freeze", "python -m pip freeze > requirements.txt", "将已安装依赖导出为常见 requirements 格式。", "重定向会覆盖文件；freeze 不等同于完整锁文件。", "pip-freeze"],
  ["Python", "查看包详情", "python -m pip show <包>", "python -m pip show requests", "显示依赖版本、安装位置等信息。", "包未安装时不会显示详情。", "pip-show"],
  ["Python", "检查依赖关系", "python -m pip check", "python -m pip check", "检测已安装包之间缺失或不兼容的依赖。", "检查失败会返回非零退出码，不会自动修复。", "pip-check"],
  ["Python", "运行 unittest 测试", "python -m unittest discover -s <目录>", "python -m unittest discover -s tests", "发现并执行标准库 unittest 测试。", "默认匹配 test*.py；可用 -p 调整模式。", "unittest"],
  ["Python", "格式化 JSON 文件", "python -m json.tool <输入JSON> [输出JSON]", "python -m json.tool input.json output.json", "校验 JSON 并输出易读格式。", "输出文件会被覆盖；非法 JSON 返回错误。", "json"],
  ["NPM", "查看 npm 版本", "npm --version", "npm --version", "显示当前 npm 版本。", "npm 通常随 Node.js 安装；请在终端中运行。", "npm"],
  ["NPM", "初始化项目", "npm init", "npm init", "交互创建或补充 package.json。", "npm init -y 使用默认值；已有文件仍可能被修改。", "init"],
  ["NPM", "安装项目依赖", "npm install", "npm install", "根据 package.json 安装依赖。", "可能更新 package-lock.json，并运行依赖生命周期脚本。", "install"],
  ["NPM", "按锁文件安装", "npm ci", "npm ci", "按锁文件进行可复现安装。", "需要兼容的锁文件；会先删除现有 node_modules，不更新锁文件。", "ci"],
  ["NPM", "添加运行依赖", "npm install <包>", "npm install dayjs", "安装并记录运行时依赖。", "会修改 package.json 与锁文件；包名是示例。", "install"],
  ["NPM", "添加开发依赖", "npm install --save-dev <包>", "npm install --save-dev typescript", "安装并记录 devDependencies。", "用于构建、测试等开发阶段。", "install"],
  ["NPM", "固定依赖版本", "npm install --save-exact <包@版本>", "npm install --save-exact dayjs@1.11.13", "安装并在清单中写入精确版本。", "示例版本为固定值，不代表最新版本。", "install"],
  ["NPM", "移除依赖", "npm uninstall <包>", "npm uninstall dayjs", "移除依赖并更新清单与锁文件。", "会影响依赖此包的源码和脚本。", "uninstall"],
  ["NPM", "列出项目脚本", "npm run", "npm run", "列出 package.json 中定义的 scripts。", "查看后再运行需要的脚本。", "run"],
  ["NPM", "运行指定脚本", "npm run <脚本> -- [参数]", "npm run build", "执行项目定义的构建等脚本。", "需要存在同名脚本；-- 后的参数传给脚本。", "run"],
  ["NPM", "执行包提供的命令", "npm exec -- <命令> [参数]", "npm exec -- tsc --version", "运行项目依赖包提供的可执行命令。", "缺少依赖时可能提示下载临时包；需确认包来源。", "exec"],
  ["NPM", "查看顶层依赖", "npm ls --depth=0", "npm ls --depth=0", "列出项目顶层依赖和版本。", "缺失或无效依赖可能使命令返回非零状态。", "ls"],
  ["NPM", "检查可更新依赖", "npm outdated", "npm outdated", "比较已安装、允许更新与最新版本。", "只是查询，不会自动升级依赖。", "outdated"],
  ["NPM", "查询包元数据", "npm view <包> [字段]", "npm view dayjs version", "从当前 npm registry 获取包信息。", "version 表示默认标签的版本；需要联网。", "view"],
  ["NPM", "查看安全审计结果", "npm audit", "npm audit", "检查依赖中已知的安全公告。", "需要联网；只查看报告，不使用会改动依赖的 audit fix。", "audit"]
];

// src-tauri/builtin-tools/src/commands-data.js
var COMMAND_CATEGORIES = ["全部", "Linux", "Git", "Markdown", "Docker", "Windows", "SQL", "ADB", "Curl", "Python", "NPM"];
var rows = [
  ["Linux", "查看当前目录", "pwd", "pwd", "输出当前工作目录的绝对路径。", "适用于 Bash 等常见 shell。", "core"],
  ["Linux", "列出文件详情", "ls -lah [目录]", "ls -lah ./project", "列出隐藏文件、权限和便于阅读的大小。", "-a 包含隐藏文件；-l 为详情；-h 为可读大小。", "core"],
  ["Linux", "切换目录", "cd <目录>", "cd ../project", "切换当前 shell 的工作目录。", "路径含空格时用引号；cd - 可回到上一个目录。", "bash"],
  ["Linux", "创建多级目录", "mkdir -p <目录>", "mkdir -p ./project/logs", "创建目录，父目录不存在时一并创建。", "-p 遇到已有目录不会报错。", "core"],
  ["Linux", "复制目录", "cp -a <源目录> <目标目录>", "cp -a ./project ./project-backup", "复制目录并尽量保留权限、时间等属性。", "目标已存在时可能合并或覆盖同名文件；先确认目标路径。", "core"],
  ["Linux", "移动或重命名", "mv -i <源路径> <目标路径>", "mv -i ./old.txt ./new.txt", "移动文件或修改名称。", "-i 在覆盖目标前询问。", "core"],
  ["Linux", "查看文本", "cat <文件>", "cat ./README.md", "在终端输出文件全部内容。", "大文件可改用 less；二进制文件不适合直接输出。", "core"],
  ["Linux", "跟踪日志", "tail -n <行数> -f <文件>", "tail -n 100 -f ./app.log", "查看日志末尾并持续跟踪新增内容。", "按 Ctrl+C 结束跟踪。", "core"],
  ["Linux", "搜索文本", "grep -n -i -- <模式> <文件>", 'grep -n -i -- "error" ./app.log', "搜索匹配行并显示行号，忽略大小写。", "-F 按固定字符串匹配；默认模式是基本正则。", "grep"],
  ["Linux", "按文件名查找", "find <目录> -type f -name <模式>", 'find ./src -type f -name "*.js"', "递归查找普通文件。", "给通配符加引号，让 find 而不是 shell 展开它。", "find"],
  ["Linux", "查看目录大小", "du -sh <目录>", "du -sh ./project", "汇总目录占用空间。", "-s 仅显示汇总；-h 使用可读单位。", "core"],
  ["Linux", "查看磁盘空间", "df -h", "df -h", "查看已挂载文件系统的容量与可用空间。", "不同系统的挂载点名称不同。", "core"],
  ["Linux", "下载文件", "curl -fL --output <文件> <URL>", "curl -fL --output ./example.html https://example.com/", "跟随重定向，遇到 HTTP 错误返回失败。", "--output 保存到指定文件，已有文件会被覆盖。", "curl"],
  ["Linux", "压缩目录", "tar -czf <归档.tar.gz> <目录>", "tar -czf ./project.tar.gz ./project", "将目录打包并以 gzip 压缩。", "先用 tar -tzf 文件 查看归档内容；已有归档会被覆盖。", "tar"],
  ["Linux", "SSH 连接", "ssh <用户>@<主机>", "ssh user@example.com", "通过 SSH 登录远程主机。", "首次连接须核对主机指纹；可用 -p 指定端口。", "ssh"],
  ["Git", "查看状态", "git status --short", "git status --short", "显示工作区、暂存区和未跟踪文件。", "完整状态可用 git status。", "status"],
  ["Git", "查看未暂存差异", "git diff -- <路径>", "git diff -- ./src", "比较工作区与暂存区。", "git diff --staged 查看已经暂存的差异。", "diff"],
  ["Git", "暂存指定文件", "git add -- <路径>", "git add -- ./README.md", "把指定文件的当前内容加入暂存区。", "后续再修改文件，需要重新暂存。", "add"],
  ["Git", "提交暂存内容", "git commit -m <说明>", 'git commit -m "更新使用说明"', "为暂存区内容创建提交。", "提交前建议查看 git diff --staged。", "commit"],
  ["Git", "查看提交历史", "git log --oneline --graph --all", "git log --oneline --graph --all", "以简短图形显示各分支历史。", "按 q 退出分页查看。", "log"],
  ["Git", "创建并切换分支", "git switch -c <分支名>", "git switch -c feature/example", "从当前提交创建新分支并切换。", "git switch <已有分支> 切换已有分支。", "switch"],
  ["Git", "列出本地和远程分支", "git branch --all", "git branch --all", "查看分支列表。", "带 * 的分支是当前分支。", "branch"],
  ["Git", "读取远端更新", "git fetch --all --prune", "git fetch --all --prune", "更新远程跟踪分支，清理已不存在的远程引用。", "不会自动合并到当前工作区。", "fetch"],
  ["Git", "快进拉取更新", "git pull --ff-only", "git pull --ff-only", "仅在可快进时拉取并更新当前分支。", "分支已经分叉时会停止，需先处理历史差异。", "pull"],
  ["Git", "推送并建立上游", "git push -u origin <分支>", "git push -u origin feature/example", "向 origin 推送分支并建立跟踪关系。", "会修改远端仓库；需相应权限。", "push"],
  ["Git", "克隆仓库", "git clone <URL> [目录]", "git clone https://github.com/example/project.git ./project", "下载仓库及其历史。", "示例仓库为占位地址，请替换。", "clone"],
  ["Git", "临时保存工作", "git stash push -u -m <说明>", 'git stash push -u -m "临时保存"', "暂存当前修改及未跟踪文件，恢复工作区。", "git stash list 查看列表；git stash apply 恢复且保留记录。", "stash"],
  ["Git", "取消文件暂存", "git restore --staged -- <文件>", "git restore --staged -- ./README.md", "把文件从暂存区恢复到 HEAD 版本。", "工作区文件内容保留。", "restore"],
  ["Git", "撤销一个提交", "git revert <提交ID>", "git revert abc1234", "创建一个反向提交，抵消指定提交的改动。", "可能出现冲突；提交 ID 为占位示例。", "revert"],
  ["Git", "查看远端地址", "git remote -v", "git remote -v", "列出远端名称及获取、推送地址。", "在已克隆的仓库目录中运行。", "remote"],
  ["Markdown", "标题", "# 标题", "## 二级标题", "用 1～6 个 # 表示标题层级。", "井号后保留一个空格。", "md"],
  ["Markdown", "粗体", "**文字**", "这是 **重点内容**。", "用两侧各两个星号突出内容。", "文字两边不要紧贴内部空格。", "md"],
  ["Markdown", "斜体", "*文字*", "这是 *强调内容*。", "用单个星号表示强调。", "不同渲染器对下划线的单词内强调处理可能不同。", "md"],
  ["Markdown", "删除线", "~~文字~~", "~~旧内容~~ 新内容", "标记删除或过时的内容。", "GFM 扩展；并非所有基础 Markdown 渲染器支持。", "gfm"],
  ["Markdown", "无序列表", "- 项目", "- 第一项\n- 第二项", "用 -、* 或 + 表示无序项目。", "每项后换行；嵌套项目需要缩进。", "md"],
  ["Markdown", "有序列表", "1. 项目", "1. 准备\n2. 执行\n3. 检查", "表示步骤或有序项目。", "渲染器通常根据首项自动编号。", "md"],
  ["Markdown", "任务列表", "- [ ] 待办\n- [x] 已完成", "- [ ] 检查更新\n- [x] 阅读说明", "用复选框表示任务进度。", "GFM 扩展；x 表示已完成。", "gfm"],
  ["Markdown", "引用", "> 引用内容", "> 这是一段引用。", "显示引用块。", "多层引用可以使用 >>；引用来源需自行注明。", "md"],
  ["Markdown", "行内代码", "`代码`", "使用 `git status` 查看状态。", "突出短命令、文件名或代码片段。", "内容含反引号时可用更长的反引号定界符。", "md"],
  ["Markdown", "代码块", "```语言\n代码\n```", '```js\nconsole.log("Hello");\n```', "用围栏表示多行代码，可指定高亮语言。", "围栏代码块为常用扩展；支持情况依渲染器。", "gfm"],
  ["Markdown", "链接", "[文字](URL)", "[示例网站](https://example.com/)", "创建文字链接。", "URL 中的空格需编码或使用适当尖括号形式。", "md"],
  ["Markdown", "图片", "![替代文字](图片地址)", "![示例图片](./images/example.png)", "嵌入图片并提供替代说明。", "相对路径以文档或托管平台的规则解析。", "md"],
  ["Markdown", "表格", "| 列1 | 列2 |\n| --- | --- |", "| 名称 | 状态 |\n| --- | --- |\n| 工具 | 可用 |", "用竖线与分隔行创建表格。", "GFM 扩展；可用 :---、:---:、---: 指定对齐。", "gfm"],
  ["Markdown", "分隔线", "---", "前一部分\n\n---\n\n后一部分", "用水平线分隔内容。", "前后留空行可避免被解释成标题。", "md"],
  ["Markdown", "转义特殊字符", "\\特殊字符", "\\*这段文字不是斜体\\*", "用反斜杠转义 Markdown 标点。", "常见可转义字符包括星号、井号、方括号等。", "md"],
  ["Docker", "查看运行容器", "docker ps", "docker ps", "列出运行中的容器。", "docker ps -a 也包含已停止的容器。", "container/ls"],
  ["Docker", "查看镜像", "docker image ls", "docker image ls", "列出本机镜像、标签和大小。", "不同标签可能引用同一镜像。", "image/ls"],
  ["Docker", "拉取镜像", "docker pull <镜像:标签>", "docker pull nginx:stable", "从镜像仓库获取镜像。", "省略标签通常使用 latest；固定版本更便于复现。", "image/pull"],
  ["Docker", "启动示例 Web 容器", "docker run -d --name <名称> -p <端口> <镜像>", "docker run -d --name example-web -p 127.0.0.1:8080:80 nginx:stable", "后台启动容器，将本机 8080 映射到容器 80。", "示例仅绑定本机；端口和容器名不能冲突。", "container/run"],
  ["Docker", "查看容器日志", "docker logs --tail <行数> -f <容器>", "docker logs --tail 100 -f example-web", "显示末尾日志并持续跟踪。", "按 Ctrl+C 退出查看，不会停止容器。", "container/logs"],
  ["Docker", "进入容器 shell", "docker exec -it <容器> <命令>", "docker exec -it example-web sh", "在运行中的容器执行交互 shell。", "镜像必须含 sh；exit 离开 shell。", "container/exec"],
  ["Docker", "停止容器", "docker stop <容器>", "docker stop example-web", "向容器发送停止信号。", "会中断该容器服务；停止后可用 docker start 重启。", "container/stop"],
  ["Docker", "启动已有容器", "docker start <容器>", "docker start example-web", "启动一个已经存在但停止的容器。", "不会重建容器或重新应用 docker run 参数。", "container/start"],
  ["Docker", "查看资源占用", "docker stats --no-stream", "docker stats --no-stream", "输出一次容器 CPU、内存和网络使用量。", "去掉 --no-stream 可持续查看。", "container/stats"],
  ["Docker", "构建镜像", "docker build -t <名称:标签> <上下文>", "docker build -t example-app:dev .", "按照上下文目录中的 Dockerfile 构建镜像。", "用 .dockerignore 排除无关文件和敏感资料。", "image/build"],
  ["Docker", "检查容器配置", "docker inspect <容器>", "docker inspect example-web", "输出容器的详细 JSON 配置。", "可能含环境变量与敏感配置，分享前应检查。", "container/inspect"],
  ["Docker", "复制容器文件", "docker cp <容器:路径> <本机路径>", "docker cp example-web:/etc/nginx/nginx.conf ./nginx.conf", "在容器与本机之间复制文件。", "目标路径中的同名文件可能被覆盖。", "container/cp"],
  ["Docker", "Compose 启动服务", "docker compose up -d", "docker compose up -d", "按 Compose 配置创建并后台启动服务。", "在含 compose.yaml 的目录运行；使用 Compose v2。", "compose/up"],
  ["Docker", "Compose 查看服务", "docker compose ps", "docker compose ps", "查看当前 Compose 项目的容器状态。", "-a 可包含已停止容器。", "compose/ps"],
  ["Docker", "Compose 停止并移除", "docker compose down", "docker compose down", "停止服务并移除项目容器和默认网络。", "会中断服务；不加 -v 时通常保留命名卷。", "compose/down"],
  ["Windows", "PowerShell：当前目录", "Get-Location", "Get-Location", "查看当前工作路径。", "请在 PowerShell 中运行。", "Get-Location"],
  ["Windows", "PowerShell：列出文件", "Get-ChildItem -Force <路径>", "Get-ChildItem -Force .", "列出目录中的项目，包含隐藏项目。", "-Recurse 递归；-File 只显示文件。", "Get-ChildItem"],
  ["Windows", "PowerShell：切换目录", "Set-Location -LiteralPath <路径>", 'Set-Location -LiteralPath "C:\\Projects"', "切换工作目录。", "LiteralPath 不把方括号当通配符。", "Set-Location"],
  ["Windows", "PowerShell：创建目录", "New-Item -ItemType Directory -Path <路径>", 'New-Item -ItemType Directory -Path "C:\\Projects\\Example"', "创建目录。", "目标目录需可写；请替换示例路径。", "New-Item"],
  ["Windows", "PowerShell：复制文件", "Copy-Item -LiteralPath <源文件> -Destination <目标>", "Copy-Item -LiteralPath .\\report.txt -Destination .\\report-copy.txt", "复制指定文件。", "目标同名文件可能被覆盖。", "Copy-Item"],
  ["Windows", "PowerShell：重命名", "Rename-Item -LiteralPath <文件> -NewName <名称>", "Rename-Item -LiteralPath .\\old.txt -NewName new.txt", "更改文件或目录名称。", "NewName 填新名称，不是跨目录目标路径。", "Rename-Item"],
  ["Windows", "PowerShell：读取 UTF-8 文本", "Get-Content -LiteralPath <文件> -Encoding utf8", "Get-Content -LiteralPath .\\README.md -Encoding utf8", "读取文本内容。", "-Raw 以一个字符串读取全文；大文件注意大小。", "Get-Content"],
  ["Windows", "PowerShell：搜索文本", "Select-String -LiteralPath <文件> -Pattern <模式>", 'Select-String -LiteralPath .\\app.log -Pattern "error"', "查找文件中匹配的行。", "默认是正则；-SimpleMatch 使用固定字符串。", "Select-String"],
  ["Windows", "PowerShell：查看进程", "Get-Process", "Get-Process", "显示正在运行的进程。", "Get-Process -Name 指定名称可筛选；名称不含 .exe。", "Get-Process"],
  ["Windows", "PowerShell：文件哈希", "Get-FileHash -LiteralPath <文件> -Algorithm SHA256", "Get-FileHash -LiteralPath .\\download.zip -Algorithm SHA256", "计算文件摘要用于校验。", "须与可信来源提供的摘要比较。", "Get-FileHash"],
  ["Windows", "PowerShell：测试端口", "Test-NetConnection <主机> -Port <端口>", "Test-NetConnection example.com -Port 443", "测试 TCP 端口连接情况。", "适用于 Windows 的 NetTCPIP 模块。", "Test-NetConnection"],
  ["Windows", "CMD：网络配置", "ipconfig /all", "ipconfig /all", "查看网络适配器、IP、DNS 等详情。", "CMD 和 PowerShell 都可调用此系统命令。", "ipconfig"],
  ["Windows", "CMD：域名查询", "nslookup <域名>", "nslookup example.com", "查询域名 DNS 记录。", "可在域名后指定 DNS 服务器地址。", "nslookup"],
  ["Windows", "CMD：路由跟踪", "tracert <主机>", "tracert example.com", "查看网络数据包到达目标的路径。", "部分路由器不回应，出现 * 不一定代表目标不可达。", "tracert"],
  ["Windows", "PowerShell：压缩文件", "Compress-Archive -LiteralPath <路径> -DestinationPath <ZIP>", "Compress-Archive -LiteralPath .\\report.txt -DestinationPath .\\report.zip", "将文件压缩为 ZIP。", "这是 Microsoft.PowerShell.Archive 模块命令；大文件和隐藏文件有处理限制。", "Compress-Archive"]
];
function source(category, key) {
  if (category === "SQL") return `https://www.sqlite.org/lang_${key}.html`;
  if (category === "ADB") return key === "logcat" ? "https://developer.android.com/tools/logcat" : key === "keyevent" ? "https://developer.android.com/reference/android/view/KeyEvent" : "https://developer.android.com/tools/adb";
  if (category === "Curl") return `https://curl.se/docs/manpage.html#--${key}`;
  if (category === "Python") {
    if (key === "cmdline") return "https://docs.python.org/3/using/cmdline.html";
    if (key.startsWith("pip-")) return `https://pip.pypa.io/en/stable/cli/${key}/`;
    return `https://docs.python.org/3/library/${key}.html`;
  }
  if (category === "NPM") return key === "npm" ? "https://docs.npmjs.com/cli/v11/" : `https://docs.npmjs.com/cli/v11/commands/npm-${key}/`;
  if (category === "Git") return `https://git-scm.com/docs/git-${key}`;
  if (category === "Docker") return `https://docs.docker.com/reference/cli/docker/${key}/`;
  if (category === "Markdown") return key === "md" ? "https://daringfireball.net/projects/markdown/syntax" : "https://github.github.com/gfm/";
  if (category === "Windows") {
    if (["ipconfig", "nslookup", "tracert"].includes(key)) return `https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/${key}`;
    const module = key === "Select-String" ? "microsoft.powershell.utility" : key === "Get-FileHash" ? "microsoft.powershell.utility" : key === "Test-NetConnection" ? "nettcpip" : key === "Compress-Archive" ? "microsoft.powershell.archive" : "microsoft.powershell.management";
    return `https://learn.microsoft.com/en-us/powershell/module/${module}/${key.toLowerCase()}`;
  }
  return { core: "https://www.gnu.org/software/coreutils/manual/coreutils.html", bash: "https://www.gnu.org/software/bash/manual/bash.html", grep: "https://www.gnu.org/software/grep/manual/grep.html", find: "https://www.gnu.org/software/findutils/manual/html_mono/find.html", curl: "https://curl.se/docs/manpage.html", tar: "https://www.gnu.org/software/tar/manual/tar.html", ssh: "https://man.openbsd.org/ssh" }[key];
}
var COMMANDS = [...rows, ...EXTRA_COMMAND_ROWS].map(([category, title, syntax, example, description, note, key], i) => ({ id: `command-${i}`, category, title, syntax, example, description, note, source: source(category, key) }));
function filterCommands(query, category = "全部") {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return COMMANDS.filter((c) => (category === "全部" || c.category === category) && words.every((word) => [c.category, c.title, c.syntax, c.example, c.description, c.note].join(" ").toLocaleLowerCase().includes(word)));
}

// src-tauri/builtin-tools/src/commands.js
function mount({ copyText }) {
  const notes = { SQL: "示例以 SQLite / PostgreSQL 的基础语法为主，数据库差异会在卡片中注明。", ADB: "设备需启用调试并授权；多设备连接时可用 adb -s 序列号 指定设备。", Curl: "示例按 Bash 书写；Windows PowerShell 5.1 请使用 curl.exe，JSON 正文推荐从文件读取。", Python: "python 可按环境替换为 python3 或 py -3；虚拟环境的激活命令需与终端对应。", NPM: "项目相关命令需在 package.json 所在目录运行。" };
  let category = "全部";
  for (const value of COMMAND_CATEGORIES) {
    const b = text("button", value);
    b.onclick = () => {
      category = value;
      render();
    };
    $("categories").append(b);
  }
  function render() {
    $("category-note").textContent = notes[category] || "";
    $("category-note").hidden = !notes[category];
    const values = filterCommands($("search").value, category);
    $("commands").replaceChildren();
    $("count").textContent = `${category} · ${values.length} 条命令`;
    $("empty").hidden = !!values.length;
    [...$("categories").children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === category)));
    for (const c of values) {
      const card = text("article", "", "card command-card"), h = text("h2", c.title);
      h.append(text("span", c.category, "badge"));
      const syntax = text("code", c.syntax, "command-syntax"), code = text("pre", c.example, "command-example"), note = text("p", c.note, "hint"), actions = text("div", "", "actions");
      for (const [label, value] of [["复制示例", c.example], ["复制语法", c.syntax], ["复制文档地址", c.source]]) {
        const b = text("button", label);
        b.onclick = async () => {
          try {
            await copyText(value);
            status(`已复制${label.slice(2)}。`);
          } catch (e) {
            status(e.message, true);
          }
        };
        actions.append(b);
      }
      card.append(h, text("p", c.description), syntax, text("p", "示例", "hint"), code, note, actions);
      $("commands").append(card);
    }
  }
  $("search").oninput = render;
  render();
}
export {
  mount
};
