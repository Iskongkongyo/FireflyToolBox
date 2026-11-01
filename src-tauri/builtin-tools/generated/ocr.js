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

// src-tauri/builtin-tools/src/ocr-engine.js
async function recognize(context, resources, image, options) {
  if (!["standard", "small", "line"].includes(options.mode)) throw new Error("识别模式无效。");
  context.report(0.01);
  const [wasm, detModel, recModel, keyBlob] = await Promise.all(["engine/ocr-runtime.wasm", "engine/ppocr-det.bin", "engine/ppocr-rec.bin", "engine/ppocr-keys.json"].map((path) => resources.blob(path, { signal: context.signal })));
  const [runtime, det, rec, keys] = await Promise.all([wasm.arrayBuffer(), detModel.arrayBuffer(), recModel.arrayBuffer(), keyBlob.text().then(JSON.parse)]);
  if (!Array.isArray(keys) || keys.length !== 18708 || keys.some((char) => typeof char !== "string")) throw new Error("文字字典损坏，请恢复工具后重试。");
  context.signal.throwIfAborted();
  const worker = await context.worker("engine/ocr-worker.js");
  try {
    return await workerRequest(worker, { wasm: runtime, detModel: det, recModel: rec, keys, image: image.buffer, options }, context, [runtime, det, rec, image.buffer]);
  } finally {
    worker.terminate();
  }
}

// src-tauri/builtin-tools/src/ocr-plan.js
function cropRect(left, top, width, height, imageWidth, imageHeight) {
  const values = [left, top, width, height].map(Number);
  if (values.some((v) => !Number.isFinite(v))) throw new Error("选区坐标无效。");
  const [x, y, w, h] = values.map(Math.round);
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > imageWidth || y + h > imageHeight) throw new Error("选区须位于图片内，且宽高大于零。");
  return { left: x, top: y, width: w, height: h };
}

// src-tauri/builtin-tools/src/ocr.js
function mount({ files, resources, tasks, copyText, signal }) {
  let source = null, info = null, image = null, previewUrl = "", resultImage = null, resultUrl = "", result = null, highlight = -1, controller, busy = false, disposed = false, drag = null;
  const canvas = $("canvas"), ctx = canvas.getContext("2d"), resultCanvas = $("result-canvas"), resultCtx = resultCanvas.getContext("2d");
  const update = () => {
    for (const el of document.querySelectorAll("button,input,select,textarea")) el.disabled = busy;
    $("process").disabled = $("reset").disabled = busy || !source;
    $("cancel").disabled = false;
    $("cancel").hidden = !busy;
    $("progress").hidden = !busy;
    $("copy").disabled = $("save").disabled = busy || !$("output").value.trim();
  };
  function selection() {
    if (!info) throw new Error("请先选择图片。");
    return cropRect($("left").value, $("top").value, $("width").value, $("height").value, info.width, info.height);
  }
  function paint() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    try {
      const r = selection(), sx = canvas.width / info.width, sy = canvas.height / info.height;
      ctx.fillStyle = "#10251d65";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#2aaa7a";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
      $("selection-info").textContent = `原图选区：${r.width} × ${r.height} · X ${r.left} / Y ${r.top}`;
    } catch {
      $("selection-info").textContent = "请将选区设置在图片范围内。";
    }
  }
  const setRect = (left, top, width, height) => {
    for (const [key, value] of Object.entries({ left, top, width, height })) $(key).value = Math.round(value);
    paint();
  };
  function paintResult() {
    if (!resultImage || !result) return;
    resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    resultCtx.drawImage(resultImage, 0, 0);
    const sx = resultCanvas.width / result.width, sy = resultCanvas.height / result.height;
    result.lines.forEach((line, index) => {
      resultCtx.beginPath();
      line.box.quad.forEach(([x, y], i) => i ? resultCtx.lineTo(x * sx, y * sy) : resultCtx.moveTo(x * sx, y * sy));
      resultCtx.closePath();
      resultCtx.strokeStyle = index === highlight ? "#f59e0b" : "#2aaa7a";
      resultCtx.lineWidth = index === highlight ? 3 : 1.5;
      resultCtx.stroke();
    });
  }
  function clearResultPreview() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    resultImage = null;
    result = null;
    highlight = -1;
    resultCanvas.width = resultCanvas.height = 1;
    $("recognition-preview").hidden = true;
    $("lines").replaceChildren();
  }
  async function job(work) {
    if (busy || disposed) return;
    busy = true;
    drag = null;
    controller = new AbortController();
    $("progress").value = 0;
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      await work(controller.signal);
    } catch (error) {
      if (!disposed && !signal.aborted) status(error.name === "AbortError" ? "已取消，图片和已有文字仍保留。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      controller = null;
      busy = false;
      if (!disposed && !signal.aborted) update();
    }
  }
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(info.width - 1, Math.round((event.clientX - box.left) * info.width / box.width))), y: Math.max(0, Math.min(info.height - 1, Math.round((event.clientY - box.top) * info.height / box.height))) };
  }
  canvas.onpointerdown = (event) => {
    if (!info || busy || drag || event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, start: point(event) };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (drag?.id !== event.pointerId || busy) return;
    event.preventDefault();
    const p = point(event), start = drag.start;
    setRect(Math.min(p.x, start.x), Math.min(p.y, start.y), Math.max(1, Math.abs(p.x - start.x)), Math.max(1, Math.abs(p.y - start.y)));
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = (event) => {
    if (drag?.id === event.pointerId) drag = null;
  };
  for (const key of ["left", "top", "width", "height"]) $(key).oninput = paint;
  $("reset").onclick = () => {
    if (info) setRect(0, 0, info.width, info.height);
  };
  $("choose").onclick = () => void job(async (current) => {
    const next = await files.open({ extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "avif", "heic", "heif", "jxl"], signal: current });
    if (!next) return;
    let nextUrl = "";
    try {
      if (next.size > 32 * 1048576) throw new Error("OCR 图片最多 32 MiB。");
      status("正在读取原图…");
      const value = await tasks.run("读取图片", async (context) => {
        const bytes = await imageBytes(next, context.signal, 32 * 1048576), wasm = await (await resources.blob("engine/magick.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/image-format-worker.js");
        try {
          return await workerRequest(worker, { type: "inspect", bytes: bytes.buffer, wasm, extension: next.name.split(".").at(-1).toLowerCase() }, context, [bytes.buffer, wasm]);
        } finally {
          worker.terminate();
        }
      }, { signal: current, timeoutMs: 6e5 });
      nextUrl = URL.createObjectURL(new Blob([value.preview], { type: "image/png" }));
      const nextImage = new Image();
      nextImage.src = nextUrl;
      await nextImage.decode();
      current.throwIfAborted();
      await source?.close();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      source = next;
      info = value;
      image = nextImage;
      previewUrl = nextUrl;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      $("editor").hidden = false;
      $("empty").hidden = true;
      setRect(0, 0, info.width, info.height);
      $("source-info").textContent = `${next.name} · ${size(next.size)} · ${info.width} × ${info.height}`;
      $("output").value = "";
      $("confidence").textContent = "结果可直接编辑和校对";
      clearResultPreview();
      status("已选择图片，可框选文字或直接识别全图。");
    } catch (error) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      await next.close().catch(() => {
      });
      throw error;
    }
  });
  $("process").onclick = () => void job(async (current) => {
    const started = performance.now(), rect = selection(), options = { ...rect, enhance: $("enhance").value, rotation: Number($("rotation").value), invert: $("invert").checked, deskew: $("deskew").checked };
    const data = await tasks.run("图片文字识别", async (context) => {
      status("正在裁剪原图…");
      const bytes = await imageBytes(source, context.signal, 32 * 1048576), wasm = await (await resources.blob("engine/magick.wasm", { signal: context.signal })).arrayBuffer(), worker = await context.worker("engine/ocr-prepare-worker.js");
      let prepared;
      try {
        prepared = await workerRequest(worker, { bytes: bytes.buffer, wasm, extension: source.name.split(".").at(-1).toLowerCase(), options }, context, [bytes.buffer, wasm]);
      } finally {
        worker.terminate();
      }
      context.report(0.12);
      $("progress").value = 0.12;
      status("正在检测和识别文字…");
      return recognize({ ...context, report: (value2) => {
        context.report(0.12 + 0.88 * value2);
        $("progress").value = 0.12 + 0.88 * value2;
      } }, resources, prepared.bytes, { mode: $("mode").value, sort: $("sort").checked });
    }, { signal: current, timeoutMs: 6e5 });
    current.throwIfAborted();
    const nextUrl = URL.createObjectURL(new Blob([data.preview], { type: "image/png" })), nextImage = new Image();
    try {
      nextImage.src = nextUrl;
      await nextImage.decode();
      current.throwIfAborted();
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      throw error;
    }
    clearResultPreview();
    resultUrl = nextUrl;
    resultImage = nextImage;
    result = data;
    resultCanvas.width = nextImage.naturalWidth;
    resultCanvas.height = nextImage.naturalHeight;
    paintResult();
    $("recognition-preview").hidden = false;
    let value = data.text || "";
    if ($("merge-spaces").checked) value = value.replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, "$1");
    $("output").value = value;
    $("confidence").textContent = `${data.lines.length} 行 · ${(Math.max(0, Math.min(1, data.score)) * 100).toFixed(1)}% 分数 · ${((performance.now() - started) / 1e3).toFixed(1)} 秒`;
    $("progress").value = 1;
    for (const [index, line] of data.lines.slice(0, 200).entries()) {
      const button = text("button", "", "ocr-line");
      button.append(text("small", String(index + 1)), text("span", line.text), text("small", Math.round(Math.max(0, Math.min(1, line.score)) * 100) + "%"));
      button.onclick = () => {
        highlight = index;
        document.querySelectorAll(".ocr-line").forEach((node, i) => node.classList.toggle("selected", i === index));
        paintResult();
      };
      $("lines").append(button);
    }
    if (data.lines.length > 200) $("lines").append(text("p", "显示前 200 行，完整内容见识别结果。", "hint"));
    status(value.trim() ? "识别完成，可直接校对、复制或保存文字。" : "没有识别到文字，可缩小选区、调整方向或尝试单行模式。");
  });
  $("copy").onclick = async () => {
    try {
      await copyText($("output").value);
      status("文字已复制。");
    } catch (error) {
      status(error.message, true);
    }
  };
  $("save").onclick = () => void job(async (current) => {
    const name = (source?.name.replace(/\.[^.]+$/, "").slice(0, 80) || "图片") + "-文字识别.txt", writer = await files.createWriter(name);
    try {
      await writer.write(new TextEncoder().encode($("output").value), { signal: current });
      status(await writer.save({ signal: current }) ? "文字已保存。" : "已取消保存，文字仍保留。");
    } finally {
      await writer.abort();
    }
  });
  $("output").oninput = update;
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void source?.close().catch(() => {
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearResultPreview();
    canvas.width = canvas.height = 1;
    image = null;
    info = null;
  };
}
export {
  mount
};
