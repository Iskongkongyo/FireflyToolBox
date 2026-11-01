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

// src-tauri/builtin-tools/src/image-region-plan.js
function regionRect(left, top, width, height, imageWidth, imageHeight) {
  const values = [left, top, width, height].map(Number);
  if (values.some((value) => !Number.isSafeInteger(value))) throw new Error("选区坐标须为整数像素。");
  const [x, y, w, h] = values;
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > imageWidth || y + h > imageHeight) throw new Error("选区须位于图片内，且宽高大于零。");
  return { left: x, top: y, width: w, height: h };
}
function dragRegion(start, end, width, height) {
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const left = Math.min(width - 1, Math.floor(clamp(Math.min(start.x, end.x), width))), top = Math.min(height - 1, Math.floor(clamp(Math.min(start.y, end.y), height)));
  const right = Math.max(left + 1, Math.ceil(clamp(Math.max(start.x, end.x), width))), bottom = Math.max(top + 1, Math.ceil(clamp(Math.max(start.y, end.y), height)));
  return regionRect(left, top, right - left, bottom - top, width, height);
}

// src-tauri/builtin-tools/src/image-region.js
function createImageRegion({ canvas, fields, editor, resetButton, enabled, onChange, onError }) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("设备不支持选区预览。");
  let info = null, image = null, drag = null;
  function selection() {
    if (!info) throw new Error("请先选择图片。");
    return regionRect(fields.left.value, fields.top.value, fields.width.value, fields.height.value, info.width, info.height);
  }
  function paint() {
    if (!image) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    try {
      const rect = selection(), sx = canvas.width / info.width, sy = canvas.height / info.height, x = rect.left * sx, y = rect.top * sy, w = rect.width * sx, h = rect.height * sy;
      context.fillStyle = "rgba(0,0,0,.24)";
      context.fillRect(0, 0, canvas.width, y);
      context.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      context.fillRect(0, y, x, h);
      context.fillRect(x + w, y, canvas.width - x - w, h);
      context.strokeStyle = "#20a674";
      context.lineWidth = 2;
      context.strokeRect(x, y, w, h);
    } catch {
    }
  }
  function set(rect) {
    for (const [key, value] of Object.entries(rect)) fields[key].value = String(value);
    for (const field of Object.values(fields)) field.removeAttribute("aria-invalid");
    paint();
    onChange(rect);
  }
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(info.width, (event.clientX - box.left) * info.width / box.width)), y: Math.max(0, Math.min(info.height, (event.clientY - box.top) * info.height / box.height)) };
  }
  for (const field of Object.values(fields)) field.oninput = () => {
    paint();
    try {
      const rect = selection();
      for (const field2 of Object.values(fields)) field2.removeAttribute("aria-invalid");
      onChange(rect);
    } catch (error) {
      field.setAttribute("aria-invalid", "true");
      onError(error);
    }
  };
  resetButton.onclick = () => {
    if (info && enabled()) set({ left: 0, top: 0, width: info.width, height: info.height });
  };
  canvas.onpointerdown = (event) => {
    if (!info || !enabled() || drag || event.isPrimary === false || event.button > 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, start: point(event), clientX: event.clientX, clientY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!drag || drag.id !== event.pointerId || !enabled()) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3) return;
    drag.moved = true;
    set(dragRegion(drag.start, point(event), info.width, info.height));
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = (event) => {
    if (drag?.id === event.pointerId) drag = null;
  };
  return {
    get ready() {
      return !!info;
    },
    selection,
    setSource(nextInfo, nextImage) {
      info = nextInfo;
      image = nextImage;
      drag = null;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      editor.hidden = false;
      fields.left.max = info.width - 1;
      fields.top.max = info.height - 1;
      fields.width.max = info.width;
      fields.height.max = info.height;
      set({ left: 0, top: 0, width: info.width, height: info.height });
    },
    dispose() {
      drag = null;
      info = image = null;
      canvas.width = canvas.height = 1;
      editor.hidden = true;
    }
  };
}

// src-tauri/builtin-tools/src/image-effects.js
function textWatermark(value, color) {
  const text = value.trim();
  if (!text || [...text].length > 80 || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("请输入 1～80 字的水印文字并选择有效颜色。");
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("设备不支持文字绘制。");
  const font = (px) => `700 ${px}px system-ui,"Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  ctx.font = font(96);
  const fontSize = Math.max(12, Math.min(96, Math.floor(4032 / Math.max(1, ctx.measureText(text).width) * 96)));
  ctx.font = font(fontSize);
  canvas.width = Math.min(4096, Math.ceil(ctx.measureText(text).width) + 24);
  canvas.height = Math.ceil(fontSize * 1.8) + 24;
  ctx.font = font(fontSize);
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 12, canvas.height / 2);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? blob.arrayBuffer().then((value2) => resolve(new Uint8Array(value2)), reject) : reject(new Error("无法生成文字水印。")), "image/png"));
}
function hexColor(value) {
  const hex = value.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) throw new Error("文字颜色请输入 3 或 6 位十六进制颜色，如 #ffffff。");
  return "#" + (hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex).toLowerCase();
}
function mount({ files, resources, tasks, signal }) {
  const mode = $("effects-tool").dataset.mode, isWatermark = mode === "image.watermark";
  let original = null, markFile = null, result = null, controller = null, busy = false, disposed = false, previewUrl = "", sourceUrl = "";
  const region = isWatermark ? null : createImageRegion({ canvas: $("pixelate-canvas"), editor: $("pixelate-editor"), resetButton: $("pixelate-reset"), fields: Object.fromEntries(["left", "top", "width", "height"].map((key) => [key, $("pixelate-" + key)])), enabled: () => !busy && !disposed, onChange: () => {
    invalidate();
    status("选区已更新，重新处理可预览效果。");
  }, onError: (error) => {
    invalidate();
    status(error.message, true);
  } });
  $("watermark-settings").hidden = !isWatermark;
  $("pixelate-settings").hidden = isWatermark;
  const update = () => {
    for (const el of document.querySelectorAll("input,select,#choose,#choose-mark")) el.disabled = busy;
    $("text-settings").hidden = $("mark-type").value !== "text";
    $("logo-settings").hidden = $("mark-type").value !== "image";
    $("quality").disabled = busy || $("format").value === "png";
    $("process").disabled = busy || !original || !isWatermark && !region.ready;
    $("save").disabled = busy || !result;
    $("cancel").hidden = !busy;
    $("pixelate-reset").disabled = busy || !region?.ready;
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
      if (!disposed && !signal.aborted) status(error.name === "AbortError" ? "已取消，可以重新处理。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      controller = null;
      busy = false;
      if (!disposed) update();
    }
  }
  async function choose(watermark, current) {
    const next = await files.open({ extensions: [], signal: current });
    if (!next) {
      status("已取消选择。");
      return;
    }
    const limit = watermark ? 16 * 1048576 : ENGINE_INPUT_BYTES;
    if (next.size > limit) {
      await next.close();
      throw new Error(`文件最多 ${limit / 1048576} MiB。`);
    }
    if (watermark) {
      await markFile?.close();
      markFile = next;
      $("mark-info").textContent = next.name;
    } else {
      let nextUrl = "";
      try {
        let inspected, nextImage;
        if (!isWatermark) {
          status("正在生成原图选区预览…");
          inspected = await tasks.run("读取原图预览", (context) => inspectImage(context, resources, next), { signal: current, timeoutMs: 6e5 });
          nextUrl = URL.createObjectURL(new Blob([inspected.preview], { type: "image/png" }));
          nextImage = new Image();
          nextImage.src = nextUrl;
          await nextImage.decode();
        }
        current.throwIfAborted();
        await original?.close();
        original = next;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        sourceUrl = nextUrl;
        if (inspected) region.setSource(inspected, nextImage);
        $("source-info").textContent = `${next.name} · ${next.size ? size(next.size) : "大小待读取"}${inspected ? ` · 原图 ${inspected.width} × ${inspected.height}` : ""}`;
      } catch (error) {
        if (nextUrl) URL.revokeObjectURL(nextUrl);
        await next.close();
        throw error;
      }
    }
    invalidate();
    status("文件已选择，设置参数后开始处理。");
  }
  $("choose").onclick = () => void job((current) => choose(false, current));
  $("choose-mark").onclick = () => void job((current) => choose(true, current));
  for (const el of document.querySelectorAll("input:not([data-region-field]),select")) el.oninput = () => {
    invalidate();
    status("参数已更新，重新处理可预览效果。");
  };
  $("mark-color").oninput = $("mark-color").onchange = () => {
    $("mark-color-hex").value = $("mark-color").value;
    $("mark-color-hex").removeAttribute("aria-invalid");
    invalidate();
    status("文字颜色已更新。");
  };
  $("mark-color-hex").oninput = () => {
    try {
      $("mark-color").value = hexColor($("mark-color-hex").value);
      $("mark-color-hex").removeAttribute("aria-invalid");
      status("文字颜色已更新。");
    } catch {
      $("mark-color-hex").setAttribute("aria-invalid", "true");
      status("请输入 3 或 6 位十六进制颜色，如 #ffffff。");
    }
    invalidate();
  };
  $("mark-color-hex").onchange = () => {
    try {
      $("mark-color-hex").value = hexColor($("mark-color-hex").value);
    } catch (error) {
      status(error.message, true);
    }
  };
  $("process").onclick = () => void job(async (current) => {
    if (!original) return;
    invalidate();
    const options = { mode, format: $("format").value, quality: $("quality").value, block: $("block").value, position: $("position").value, opacity: $("opacity").value, size: $("mark-size").value, angle: $("angle").value };
    if (!isWatermark) options.region = region.selection();
    if (isWatermark && $("mark-type").value === "image" && !markFile) throw new Error("请先选择水印图片。");
    const color = isWatermark && $("mark-type").value === "text" ? hexColor($("mark-color-hex").value) : "";
    const writer = await files.createWriter(outputName(original.name, isWatermark ? "-watermark" : "-pixelated", options.format === "jpeg" ? "jpg" : options.format));
    try {
      const converted = await tasks.run(isWatermark ? "添加图片水印" : "图片像素化", async (context) => {
        status("正在处理图片…");
        let watermark;
        if (isWatermark) {
          if ($("mark-type").value === "text") {
            watermark = await textWatermark($("mark-text").value, color);
            options.watermarkExtension = "png";
          } else {
            watermark = await imageBytes(markFile, context.signal, 16 * 1048576);
            options.watermarkExtension = markFile.name.split(".").pop().toLowerCase();
          }
        }
        return runImage(context, resources, original, writer, options, watermark);
      }, { signal: current, timeoutMs: 6e5 });
      current.throwIfAborted();
      result = writer;
      previewUrl = URL.createObjectURL(new Blob([converted.preview], { type: "image/png" }));
      $("preview-image").src = previewUrl;
      $("result").hidden = false;
      $("result-info").textContent = `${converted.width} × ${converted.height} · ${size(writer.bytesWritten)} · ${isWatermark ? "水印已添加" : `像素块 ${options.block} px · 选区 ${options.region.left}, ${options.region.top} / ${options.region.width} × ${options.region.height}`}`;
      status("处理完成，可以查看预览并保存图片。");
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
    void markFile?.close();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    region?.dispose();
    invalidate();
  };
}
export {
  mount
};
