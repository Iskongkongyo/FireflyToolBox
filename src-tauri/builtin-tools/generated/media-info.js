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

// src-tauri/builtin-tools/src/media-task.js
async function mediaTask(context, resources, input, mode, options = {}, writer) {
  const coreUrl = await resources.url("engine/ffmpeg-core.js", { signal: context.signal }), wasm = await (await resources.blob("engine/ffmpeg-core.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/media-worker.js");
  return workerRequest(worker, { coreUrl, wasm, mode, options, extension: input.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? "bin", input: { url: input.url, size: input.size }, ...writer ? { output: { url: writer.workspaceUrl, size: 0 } } : {} }, context, [wasm]);
}
function cleanMediaInfo(info) {
  const copy = structuredClone(info);
  if (copy.format) delete copy.format.filename;
  return copy;
}
async function seekableFile(file, files, signal) {
  if (file.seekable && file.url) return file;
  const writer = await files.createWriter(file.name.slice(0, 120));
  try {
    await writer.write(file.stream({ signal }), { signal });
    const reader = await writer.preview({ signal });
    await writer.abort();
    await file.close();
    return reader;
  } catch (error) {
    await writer.abort();
    await file.close();
    throw error;
  }
}

// src-tauri/builtin-tools/src/media-info.js
function mount({ files, resources, tasks, copyText, signal }) {
  let file = null, info = null, busy = false, controller;
  const update = () => {
    $("choose").disabled = busy;
    $("copy").disabled = busy || !info;
    $("cancel").hidden = !busy;
  };
  $("choose").onclick = async () => {
    if (busy) return;
    busy = true;
    controller = new AbortController();
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      let next = await files.open({ extensions: [], signal: controller.signal });
      if (!next) return;
      next = await seekableFile(next, files, controller.signal);
      await file?.close();
      file = next;
      status("正在读取媒体头信息…");
      const result = await tasks.run("读取媒体信息", (context) => mediaTask(context, resources, file, "media.info"), { signal: controller.signal, timeoutMs: 6e4 });
      info = cleanMediaInfo(result.info);
      $("source-info").textContent = `${file.name} · ${size(file.size)}`;
      $("details").replaceChildren();
      const format = info.format ?? {};
      const meta = text("dl", "", "meta");
      for (const [label, value] of [["容器", format.format_long_name ?? format.format_name], ["时长（秒）", format.duration], ["整体码率（bit/s）", format.bit_rate]]) {
        meta.append(text("dt", label), text("dd", String(value ?? "未提供")));
      }
      $("details").append(meta);
      for (const stream of info.streams ?? []) {
        const box = text("section", "", "card");
        box.append(text("h2", `流 ${stream.index} · ${stream.codec_type}`));
        const list = text("dl", "", "meta");
        for (const [key, label] of Object.entries({ codec_name: "编码", profile: "Profile", width: "宽", height: "高", avg_frame_rate: "平均帧率（比值）", bit_rate: "码率（bit/s）", sample_rate: "采样率（Hz）", channels: "声道", channel_layout: "声道布局", pix_fmt: "像素格式", duration: "流时长（秒）" })) if (stream[key] !== void 0) list.append(text("dt", label), text("dd", String(stream[key])));
        box.append(list);
        $("details").append(box);
      }
      status("读取完成；来源未提供的字段不做推测。");
    } catch (error) {
      status(error.name === "AbortError" ? "已取消。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      busy = false;
      controller = null;
      update();
    }
  };
  $("copy").onclick = async () => {
    try {
      await copyText(JSON.stringify(info, null, 2));
      status("信息 JSON 已复制。");
    } catch (error) {
      status(error.message, true);
    }
  };
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    controller?.abort();
    void file?.close();
  };
}
export {
  mount
};
