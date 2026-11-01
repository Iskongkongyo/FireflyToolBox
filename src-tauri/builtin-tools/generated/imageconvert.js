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

// src-tauri/builtin-tools/src/image-limits.js
var MIB = 1024 * 1024;
var CANVAS_INPUT_BYTES = 64 * MIB;
var CANVAS_OUTPUT_BYTES = 128 * MIB;
var ENGINE_INPUT_BYTES = 256 * MIB;
var ENGINE_OUTPUT_BYTES = 512 * MIB;
var EXIF_INPUT_BYTES = 256 * MIB;
var EXIF_OUTPUT_BYTES = 16 * MIB;

// src-tauri/builtin-tools/src/image-task.js
async function imageBytes(file, signal, maxBytes = ENGINE_INPUT_BYTES) {
  if (file.size > maxBytes) throw new Error(`文件最多 ${maxBytes / 1048576} MiB。`);
  const parts = [];
  let length = 0;
  for (let offset2 = 0; ; ) {
    const bytes = await file.read(offset2, 1048576, { signal });
    if (!bytes.length) break;
    length += bytes.length;
    if (length > maxBytes) throw new Error(`文件最多 ${maxBytes / 1048576} MiB。`);
    parts.push(bytes);
    offset2 += bytes.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const bytes of parts) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  parts.length = 0;
  return result;
}
async function runImage(context, resources, file, writer, options, watermark) {
  const bytes = await imageBytes(file, context.signal), wasm = await (await resources.blob("engine/magick.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/image-format-worker.js");
  try {
    const data = { wasm, bytes: bytes.buffer, options, extension: file.name.split(".").pop().toLowerCase(), ...watermark ? { watermark: watermark.buffer } : {} }, transfer = [wasm, bytes.buffer, ...watermark ? [watermark.buffer] : []];
    context.report(0.2);
    const result = await workerRequest(worker, data, context, transfer);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        context.signal.removeEventListener("abort", abort);
        worker.onmessage = worker.onerror = null;
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new DOMException("已取消", "AbortError"));
      context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) {
        abort();
        return;
      }
      worker.onerror = () => finish(new Error("图片引擎停止。"));
      worker.onmessage = async ({ data: data2 }) => {
        try {
          if (data2.type === "error") throw new Error(data2.message);
          await writer.write(data2.bytes, { signal: context.signal });
          context.report(0.3 + 0.7 * writer.bytesWritten / result.size);
          if (data2.done) finish();
          else worker.postMessage({ type: "next" });
        } catch (error) {
          finish(error);
        }
      };
      worker.postMessage({ type: "next" });
    });
    return result;
  } finally {
    worker.terminate();
  }
}

// src-tauri/builtin-tools/src/image-conversion-ui.js
function mountConversion({ files, resources, tasks, signal }, compress = false) {
  let original = null, result = null, controller = null, busy = false, previewUrl = "", disposed = false;
  const update = () => {
    for (const el of document.querySelectorAll("input,select,#choose")) el.disabled = busy;
    $("process").disabled = busy || !original;
    $("save").disabled = busy || !result;
    $("cancel").hidden = !busy;
    $("quality").disabled = busy || ["png", "bmp", "tiff", "ico", "gif"].includes($("format").value);
  };
  const invalidate = () => {
    const old = result;
    result = null;
    void old?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    $("preview-image").removeAttribute("src");
    $("result").hidden = true;
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
      if (!disposed && !signal.aborted) status(error.name === "AbortError" ? "已取消，可重新处理。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      busy = false;
      controller = null;
      if (!disposed) update();
    }
  }
  $("choose").onclick = () => void job(async (current) => {
    const file = await files.open({ extensions: [], signal: current });
    if (!file) {
      status("已取消选择。");
      return;
    }
    if (file.size > ENGINE_INPUT_BYTES) {
      await file.close();
      throw new Error("图片文件最多 256 MiB。");
    }
    current.throwIfAborted();
    await original?.close();
    original = file;
    invalidate();
    $("source-info").textContent = `${file.name} · ${file.size ? size(file.size) : "大小待读取"}`;
    status("图片已选择。动画、多页图片将处理首帧。");
  });
  for (const id of ["format", "quality", ...!compress ? ["background", "edge"] : []]) $(id).oninput = () => {
    invalidate();
    status("");
  };
  if (!compress) {
    const color = (value) => {
      $("color-hex").value = value;
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        $("color").value = value;
        $("background").value = "color";
      }
      invalidate();
    };
    $("color").oninput = () => color($("color").value);
    $("color-hex").oninput = () => color($("color-hex").value.trim());
  }
  $("process").onclick = () => void job(async (current) => {
    if (!original) return;
    invalidate();
    const options = { format: $("format").value, quality: $("quality").value, background: compress ? "transparent" : $("background").value, color: compress ? "#ffffff" : $("color-hex").value.trim(), edge: compress ? 0 : $("edge").value };
    const writer = await files.createWriter(outputName(original.name, compress ? "-compressed" : "-converted", options.format === "jpeg" ? "jpg" : options.format));
    try {
      const converted = await tasks.run(compress ? "压缩图片" : "转换图片", async (context) => {
        status("正在读取图片并处理…");
        return runImage(context, resources, original, writer, options);
      }, { signal: current, timeoutMs: 6e5 });
      current.throwIfAborted();
      result = writer;
      previewUrl = URL.createObjectURL(new Blob([converted.preview], { type: "image/png" }));
      $("preview-image").src = previewUrl;
      $("result").hidden = false;
      let note = `${converted.width} × ${converted.height} · ${options.format.toUpperCase()} · ${size(original.size)} → ${size(writer.bytesWritten)}`;
      if (compress && original.size) {
        const percent = (1 - writer.bytesWritten / original.size) * 100;
        note += percent >= 0 ? ` · 减少 ${percent.toFixed(1)}%` : ` · 增大 ${(-percent).toFixed(1)}%`;
      }
      $("result-info").textContent = note;
      status(compress && writer.bytesWritten >= original.size ? "输出比原图大，可降低质量后重试。" : "处理完成，可以保存图片。");
    } catch (error) {
      await writer.abort();
      throw error;
    }
  });
  $("save").onclick = () => void job(async (current) => {
    if (result && await result.save({ signal: current })) {
      result = null;
      status("图片已保存。");
    } else status("已取消保存，可以再次保存。");
  });
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void original?.close();
    invalidate();
  };
}

// src-tauri/builtin-tools/src/imageconvert.js
function mount(api) {
  return mountConversion(api);
}
export {
  mount
};
