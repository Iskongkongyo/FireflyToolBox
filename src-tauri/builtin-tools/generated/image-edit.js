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
async function inspectImage(context, resources, file) {
  const bytes = await imageBytes(file, context.signal), wasm = await (await resources.blob("engine/magick.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/image-format-worker.js");
  try {
    return await workerRequest(worker, { type: "inspect", previewSize: 1024, bytes: bytes.buffer, wasm, extension: file.name.split(".").at(-1).toLowerCase() }, context, [bytes.buffer, wasm]);
  } finally {
    worker.terminate();
  }
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

// src-tauri/builtin-tools/src/image-edit.js
function mount({ files, resources, tasks, signal }) {
  let file = null, info = null, image = null, controller, busy = false, disposed = false, drag = null, result = null, sourceUrl = "", previewUrl = "";
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const update = () => {
    for (const el of document.querySelectorAll("button,input,select")) el.disabled = busy;
    $("process").disabled = busy || !info;
    $("save").disabled = busy || !result;
    $("cancel").disabled = false;
    $("cancel").hidden = !busy;
    $("quality").disabled = busy || $("format").value === "png";
  };
  const invalidate = () => {
    const old = result;
    result = null;
    void old?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    $("result").hidden = true;
    update();
  };
  function paint() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    ctx.strokeStyle = "#20a674";
    ctx.lineWidth = 2;
    ctx.strokeRect(Number($("x").value) * canvas.width / info.width, Number($("y").value) * canvas.height / info.height, Number($("width").value) * canvas.width / info.width, Number($("height").value) * canvas.height / info.height);
  }
  const set = (x, y, w, h) => {
    for (const [key, value] of Object.entries({ x, y, width: w, height: h })) $(key).value = Math.round(value);
    paint();
    invalidate();
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
  $("choose").onclick = () => void job(async (current) => {
    const next = await files.open({ extensions: [], signal: current });
    if (!next) return;
    let nextUrl = "";
    try {
      const inspected = await tasks.run("读取图片", (context) => inspectImage(context, resources, next), { signal: current, timeoutMs: 6e5 });
      nextUrl = URL.createObjectURL(new Blob([inspected.preview], { type: "image/png" }));
      const nextImage = new Image();
      nextImage.src = nextUrl;
      await nextImage.decode();
      current.throwIfAborted();
      await file?.close();
      file = next;
      info = inspected;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = nextUrl;
      image = nextImage;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      $("editor").hidden = false;
      set(0, 0, info.width, info.height);
      $("source-info").textContent = `${file.name} · ${info.width} × ${info.height} · ${size(file.size)}`;
      status("拖拽或输入原图坐标进行裁剪。");
    } catch (error) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      await next.close();
      throw error;
    }
  });
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(info.width, Math.round((event.clientX - box.left) * info.width / box.width))), y: Math.max(0, Math.min(info.height, Math.round((event.clientY - box.top) * info.height / box.height))) };
  }
  canvas.onpointerdown = (event) => {
    if (!info || busy) return;
    drag = point(event);
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!drag) return;
    const end = point(event);
    let w = Math.abs(end.x - drag.x), h = Math.abs(end.y - drag.y);
    const [rw, rh] = $("ratio").value.split(":").map(Number);
    if (rw && rh) {
      h = Math.min(h, w * rh / rw);
      w = h * rw / rh;
    }
    set(Math.min(drag.x, end.x), Math.min(drag.y, end.y), Math.max(1, w), Math.max(1, h));
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = null;
  };
  for (const el of document.querySelectorAll("input,select")) el.oninput = () => {
    paint();
    invalidate();
  };
  $("ratio").onchange = () => {
    if (!info) return;
    const [rw, rh] = $("ratio").value.split(":").map(Number);
    if (rw && rh) {
      const scale = Math.min(info.width / rw, info.height / rh);
      set(Math.floor((info.width - rw * scale) / 2), Math.floor((info.height - rh * scale) / 2), Math.floor(rw * scale), Math.floor(rh * scale));
    }
  };
  $("reset").onclick = () => set(0, 0, info.width, info.height);
  $("process").onclick = () => void job(async (current) => {
    invalidate();
    const options = { mode: "image.edit", format: $("format").value, quality: $("quality").value, x: $("x").value, y: $("y").value, width: $("width").value, height: $("height").value, rotation: $("rotation").value, mirrorX: $("mirror-x").checked, mirrorY: $("mirror-y").checked }, writer = await files.createWriter(outputName(file.name, "-edited", options.format === "jpeg" ? "jpg" : options.format));
    try {
      const output = await tasks.run("裁剪图片", (context) => runImage(context, resources, file, writer, options), { signal: current, timeoutMs: 6e5 });
      result = writer;
      previewUrl = URL.createObjectURL(new Blob([output.preview], { type: "image/png" }));
      $("preview-image").src = previewUrl;
      $("result").hidden = false;
      $("result-info").textContent = `${output.width} × ${output.height} · ${size(writer.bytesWritten)}`;
      status("处理完成，可保存图片。");
    } catch (error) {
      await writer.abort();
      throw error;
    }
  });
  $("save").onclick = () => void job(async (current) => {
    if (result && await result.save({ signal: current })) {
      result = null;
      status("图片已保存。");
    } else status("已取消保存。");
  });
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void file?.close();
    invalidate();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    canvas.width = canvas.height = 1;
    image = null;
  };
}
export {
  mount
};
