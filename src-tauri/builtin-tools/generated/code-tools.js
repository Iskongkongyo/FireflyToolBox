// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1048576).toFixed(2)} MiB`;
}

// src-tauri/builtin-tools/src/media-job.js
function workerRequest(worker, data, { signal, report = () => {
}, onLog = () => {
} } = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      worker.onmessage = worker.onerror = null;
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException("任务已取消。", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("转换引擎启动失败或设备内存不足。"));
    worker.onmessage = ({ data: data2 }) => {
      if (data2.type === "progress") report(data2.value);
      else if (data2.type === "log") onLog(data2.message);
      else if (data2.type === "error") finish(new Error(data2.message));
      else if (data2.type === "done") finish(null, data2);
    };
    worker.postMessage(data, transfer);
  });
}
function outputName(name, suffix, extension) {
  return name.replace(/\.[^.]*$/, "").slice(0, 80) + suffix + "." + extension;
}

// src-tauri/builtin-tools/src/code-tools.js
function mount({ files, tasks, copyText, signal }) {
  const language = $("code-tool").dataset.language;
  let result = "", filename = "code." + language, busy = false, controller, disposed = false;
  $("module-field").hidden = language !== "js";
  $("optimize-field").hidden = language !== "js";
  $("usage").textContent = language === "html" ? "输入最多 1 MiB，输出最多 4 MiB。压缩保留 pre / textarea 的内容，不压缩内嵌 JS / CSS；模板文件与依赖空白布局的 HTML 请检查实际显示。" : language === "css" ? "输入最多 1 MiB，输出最多 4 MiB。CSS 压缩保留 /*! … */ 许可注释；不合并或重排规则。" : "输入最多 1 MiB，输出最多 4 MiB。默认只紧凑输出；可启用表达式优化与局部变量名压缩。JSX / TypeScript 请先转换为普通 JavaScript 再压缩。";
  if (language === "css") {
    $("keep-comments").checked = false;
    $("keep-comments").parentElement.hidden = true;
  }
  const update = () => {
    for (const node of document.querySelectorAll("button,input,select,textarea")) node.disabled = busy;
    for (const id of ["copy", "save", "use-result"]) $(id).disabled = busy || !result;
    $("cancel").hidden = !busy;
    $("cancel").disabled = false;
  };
  const invalidate = () => {
    result = "";
    $("output").value = "";
    $("stats").textContent = "";
    update();
  };
  async function job(work) {
    if (busy || disposed || signal.aborted) return;
    busy = true;
    controller = new AbortController();
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      await work(controller.signal);
    } catch (error) {
      if (!disposed && !signal.aborted) status(error.name === "AbortError" ? "已取消。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      controller = null;
      busy = false;
      if (!disposed) update();
    }
  }
  $("input").oninput = invalidate;
  for (const node of document.querySelectorAll("select,input")) node.oninput = invalidate;
  $("import").onclick = () => void job(async (current) => {
    const file = await files.open({ extensions: [language, language === "js" ? "mjs" : language === "html" ? "htm" : "css", "txt"], signal: current });
    if (!file) return;
    try {
      const bytes = await (await file.blob({ maxBytes: 1048576, signal: current })).arrayBuffer();
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("文件不是有效的 UTF-8 文本，请先转换编码。");
      }
      invalidate();
      filename = file.name;
      $("input").value = content;
      status("文件已导入。");
    } finally {
      await file.close();
    }
  });
  for (const action of ["format", "minify"]) $(action).onclick = () => void job(async (current) => {
    invalidate();
    const source = $("input").value, options = { indent: $("indent").value === "tab" ? 2 : Number($("indent").value), tabs: $("indent").value === "tab", width: Number($("width").value), module: $("module").checked, optimize: $("optimize").checked, keepComments: $("keep-comments").checked };
    if (!source.trim()) throw new Error("请输入代码或导入文件。");
    if (new TextEncoder().encode(source).length > 1048576) throw new Error("输入代码最多 1 MiB。");
    status("正在" + (action === "format" ? "格式化" : "压缩") + "…");
    const completed = await tasks.run("代码处理", async (context) => workerRequest(await context.worker("engine/code-worker.js"), { language, action, source, options }, context), { signal: current, timeoutMs: 6e4 });
    result = completed.text;
    $("output").value = result;
    const before = new TextEncoder().encode(source).length, after = new TextEncoder().encode(result).length;
    $("stats").textContent = `UTF-8 大小：${size(before)} → ${size(after)}${action === "minify" && before ? " · 体积变化 " + ((after / before - 1) * 100).toFixed(1) + "%" : ""}`;
    status("处理完成。");
  });
  $("use-result").onclick = () => {
    if (result) {
      $("input").value = result;
      invalidate();
      status("结果已放回输入。");
    }
  };
  $("copy").onclick = () => void job(async () => {
    await copyText(result);
    status("已复制结果。");
  });
  $("save").onclick = () => void job(async (current) => {
    const writer = await files.createWriter(outputName(filename, "-processed", language));
    try {
      await writer.write(new TextEncoder().encode(result), { signal: current });
      status(await writer.save({ signal: current }) ? "结果已保存。" : "已取消保存。");
    } finally {
      await writer.abort();
    }
  });
  $("clear").onclick = () => {
    $("input").value = "";
    filename = "code." + language;
    invalidate();
    status("已清空。");
  };
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    result = "";
  };
}
export {
  mount
};
