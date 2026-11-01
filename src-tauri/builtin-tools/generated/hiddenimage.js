// src-tauri/builtin-tools/src/image-limits.js
var MIB = 1024 * 1024;
var CANVAS_INPUT_BYTES = 64 * MIB;
var CANVAS_OUTPUT_BYTES = 128 * MIB;
var ENGINE_INPUT_BYTES = 256 * MIB;
var ENGINE_OUTPUT_BYTES = 512 * MIB;
var EXIF_INPUT_BYTES = 256 * MIB;
var EXIF_OUTPUT_BYTES = 16 * MIB;
var HIDDEN_OUTPUT_PIXELS = 8e6;
var HIDDEN_OUTPUT_EDGES = [768, 1024, 1536, 1920, 2560, 3072];
function hiddenOutputSize(width, height, edge) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !HIDDEN_OUTPUT_EDGES.includes(Number(edge))) throw new Error("请选择有效的图片与输出尺寸。");
  const scale = Math.min(1, Number(edge) / Math.max(width, height), Math.sqrt(HIDDEN_OUTPUT_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

// src-tauri/builtin-tools/src/image-file-io.js
async function openCanvasFile(files, signal) {
  const file = await files.open({ extensions: ["png", "jpg", "jpeg", "webp", "bmp"], signal });
  if (!file) return null;
  try {
    return { name: file.name, blob: await file.blob({ maxBytes: CANVAS_INPUT_BYTES, signal }) };
  } finally {
    await file.close();
  }
}
async function saveBlob(files, name, blob, signal, maxBytes = CANVAS_OUTPUT_BYTES) {
  if (!blob.size || blob.size > maxBytes) throw new Error(`输出须大于零且不超过 ${maxBytes / 1048576} MiB。`);
  const writer = await files.createWriter(name);
  try {
    await writer.write(blob, { signal });
    return await writer.save({ signal });
  } finally {
    await writer.abort();
  }
}

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
function workerJob(source, data, signal, timeout = 1500, transfer = []) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("已取消", "AbortError"));
      return;
    }
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    let worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      reject(error);
      return;
    }
    URL.revokeObjectURL(url);
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    const timer = setTimeout(() => finish(new Error("计算耗时过长，已中断。请缩小输入或简化表达式。")), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data: data2 }) => finish(data2.error ? new Error(data2.error) : null, data2.result);
    worker.onerror = () => finish(new Error("计算失败，请检查输入或设备兼容性。"));
    worker.postMessage(data, transfer);
  });
}
function operation(signal) {
  let controller;
  return { start() {
    controller?.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    return controller.signal;
  }, cancel() {
    controller?.abort();
  }, dispose() {
    controller?.abort();
  } };
}

// src-tauri/builtin-tools/src/utility.js
var TEXT_LIMIT = 1024 * 1024;
function imageSize(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer), ascii = (start, length) => String.fromCharCode(...b.slice(start, start + length));
  let width, height;
  if (b.length >= 24 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (b.length >= 10 && ascii(0, 3) === "GIF") {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
  } else if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const type = ascii(12, 4);
    if (type === "VP8X") {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (type === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) {
      width = v.getUint16(26, true) & 16383;
      height = v.getUint16(28, true) & 16383;
    } else if (type === "VP8L" && b[20] === 47) {
      width = 1 + ((b[22] & 63) << 8 | b[21]);
      height = 1 + ((b[24] & 15) << 10 | b[23] << 2 | b[22] >> 6);
    }
  } else if (b.length >= 26 && ascii(0, 2) === "BM") {
    const dib = v.getUint32(14, true);
    if (dib === 12) {
      width = v.getUint16(18, true);
      height = v.getUint16(20, true);
    } else if (dib >= 40) {
      width = v.getInt32(18, true);
      height = Math.abs(v.getInt32(22, true));
    }
  } else if (b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 3 < b.length) {
      if (b[p++] !== 255) throw new Error("JPEG 文件结构无效。");
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (p + 2 > b.length) break;
      const length = v.getUint16(p);
      if (length < 2 || p + length > b.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        break;
      }
      p += length;
    }
  }
  if (!width || !height || width < 0 || height < 0) throw new Error("无法读取图片尺寸，请选择 PNG、JPEG、GIF、WebP 或 BMP 图片。");
  if (width * height > 24e6 || width > 16e3 || height > 16e3) throw new Error("图片尺寸过大，请先裁剪或缩小至 2400 万像素以内。");
  return { width, height };
}

// src-tauri/builtin-tools/src/practical.js
var IMAGE_LIMIT = 64 * 1024 * 1024;
var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;
function imageType(buffer) {
  const b = new Uint8Array(buffer), word = (start, end) => String.fromCharCode(...b.slice(start, end));
  if (b.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) && word(12, 16) === "IHDR") return { mime: "image/png", ext: "png" };
  if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(word(0, 6))) return { mime: "image/gif", ext: "gif" };
  if (b.length >= 30 && word(0, 4) === "RIFF" && word(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length >= 26 && word(0, 2) === "BM") return { mime: "image/bmp", ext: "bmp" };
  throw new Error("仅支持 PNG、JPEG、GIF、WebP、BMP 图片，请检查文件内容。");
}

// src-tauri/builtin-tools/src/images.js
var IMAGE_INPUT_LIMIT = CANVAS_INPUT_BYTES;
var IMAGE_OUTPUT_LIMIT = CANVAS_OUTPUT_BYTES;
var MAX_TOTAL_BYTES = 256 * 1024 * 1024;
function animatedImage(buffer, mime) {
  const b = new Uint8Array(buffer), view = new DataView(buffer);
  if (mime === "image/webp") return b.length >= 21 && String.fromCharCode(...b.slice(12, 16)) === "VP8X" && !!(b[20] & 2);
  if (mime === "image/png") {
    let p = 8;
    while (p + 12 <= b.length) {
      const length = view.getUint32(p), type = String.fromCharCode(...b.slice(p + 4, p + 8));
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND" || p + 12 + length > b.length) break;
      p += length + 12;
    }
  }
  return false;
}

// src-tauri/builtin-tools/src/image-runtime.js
var abortError = () => new DOMException("已取消", "AbortError");
function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}
function session(signal, update) {
  const op = operation(signal);
  let busy = false;
  return { get busy() {
    return busy;
  }, async run(fn) {
    if (busy) return;
    busy = true;
    const current = op.start();
    document.querySelectorAll("main button,main input,main select,main textarea").forEach((n) => n.disabled = true);
    $("cancel").hidden = false;
    $("cancel").disabled = false;
    try {
      await fn(current);
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消操作。" : e.message || "操作失败，请重试。", e.name !== "AbortError");
    } finally {
      if (!signal.aborted) {
        busy = false;
        document.querySelectorAll("main button,main input,main select,main textarea").forEach((n) => n.disabled = false);
        $("cancel").hidden = true;
        update();
      }
    }
  }, cancel() {
    op.cancel();
  }, dispose() {
    op.dispose();
  } };
}
async function readImage(file, signal, maxPixels = 24e6) {
  if (!file.blob.size || file.blob.size > IMAGE_INPUT_LIMIT) throw new Error("图片需大于 0 且不超过 64 MiB。");
  const buffer = await file.blob.slice(0, 1024 * 1024).arrayBuffer();
  checkAbort(signal);
  const type = imageType(buffer), dimensions = imageSize(buffer);
  if (dimensions.width * dimensions.height > maxPixels) throw new Error(`图片超过当前允许的 ${Math.round(maxPixels / 1e4)} 万像素，请减少图片或先缩小尺寸。`);
  if (type.mime === "image/gif") throw new Error("此工具处理静态图片，请选择 PNG、JPEG、WebP 或 BMP；GIF 动画不支持。");
  if (animatedImage(buffer, type.mime)) throw new Error("此工具处理静态图片，动画 PNG / WebP 请先转换为静态图片。");
  const url = URL.createObjectURL(new Blob([file.blob], { type: type.mime })), image = new Image();
  try {
    await new Promise((resolve, reject) => {
      let timer;
      const finish = (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
        e ? reject(e) : resolve();
      };
      const abort = () => {
        image.removeAttribute("src");
        finish(abortError());
      };
      image.onload = () => finish();
      image.onerror = () => finish(new Error("图片损坏，或当前设备无法读取该图片格式。"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => finish(new Error("读取图片超时，请选择较小的图片。")), 3e4);
      if (signal?.aborted) {
        abort();
        return;
      }
      image.src = url;
    });
    checkAbort(signal);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > Math.min(maxPixels, 24e6) || width > 16384 || height > 16384) throw new Error("图片尺寸过大或无法读取。");
    return { name: file.name, blob: file.blob, image, width, height, mime: type.mime, originalWidth: dimensions.width, release() {
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    } };
  } catch (e) {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
    throw e;
  }
}
function newCanvas(width, height, fill) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前设备无法创建图片画布。");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  return { canvas, ctx };
}
async function encodeCanvas(canvas, options, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (e, blob) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      e ? reject(e) : resolve(blob);
    };
    const abort = () => finish(abortError());
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("生成图片超时，请缩小尺寸后重试。")), 6e4);
    try {
      canvas.toBlob((blob) => {
        if (signal?.aborted) {
          finish(abortError());
          return;
        }
        if (!blob) {
          finish(new Error("图片生成失败，请减小尺寸或更换格式。"));
          return;
        }
        if (blob.type !== options.mime) {
          finish(new Error("当前设备不支持该输出格式，请选择 PNG 或 JPEG。"));
          return;
        }
        if (blob.size > IMAGE_OUTPUT_LIMIT) {
          finish(new Error(`生成图片为 ${size(blob.size)}，超过 128 MiB 保存上限，请降低质量或缩小尺寸。`));
          return;
        }
        finish(null, blob);
      }, options.mime, options.quality);
    } catch (e) {
      finish(e);
    }
  });
}

// src-tauri/builtin-tools/src/hiddenimage.js
function mount({ files, signal }) {
  let front = null, back = null, result = null, url = "";
  const job = session(signal, update);
  function update() {
    $("process").disabled = job.busy || !front || !back;
    $("swap").disabled = job.busy || !front || !back;
    $("save").disabled = job.busy || !result;
  }
  function invalidate() {
    result = null;
    if (url) URL.revokeObjectURL(url);
    url = "";
    for (const id of ["light-preview", "dark-preview"]) $(id).removeAttribute("src");
    $("result").hidden = true;
    update();
    status("");
  }
  function sources() {
    for (const [id, file] of [["front", front], ["back", back]]) {
      $(id + "-info").textContent = file ? `${file.name} · ${file.width} × ${file.height} · ${size(file.blob.size)}` : "尚未选择";
      $(id + "-image").hidden = !file;
      if (file) $(id + "-image").src = file.image.src;
      else $(id + "-image").removeAttribute("src");
    }
  }
  for (const id of ["front", "back"]) $(id).onclick = () => void job.run(async (current) => {
    const file = await openCanvasFile(files, current);
    if (!file) {
      status("已取消选择。");
      return;
    }
    const dim = imageSize(await file.blob.slice(0, 1048576).arrayBuffer());
    if (dim.width * dim.height > 24e6) throw new Error("单张最多 2400 万像素，请先缩小图片。");
    const loaded = await readImage(file, current);
    if (current.aborted) {
      loaded.release();
      return;
    }
    if (id === "front") {
      front?.release();
      front = loaded;
    } else {
      back?.release();
      back = loaded;
    }
    invalidate();
    sources();
    status("图片已读取。");
  });
  $("swap").onclick = () => {
    [front, back] = [back, front];
    invalidate();
    sources();
  };
  for (const id of ["white", "black", "white-color", "black-color"]) $(id).oninput = () => {
    $(id + "-value").textContent = $(id).value + "%" + (id.endsWith("-color") && Number($(id).value) === 0 ? " · 灰度" : "");
    invalidate();
  };
  $("fit").onchange = $("output-size").onchange = invalidate;
  function draw(source, ctx, width, height, background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const ratio = $("fit").value === "cover" ? Math.max(width / source.width, height / source.height) : Math.min(width / source.width, height / source.height);
    ctx.drawImage(source.image, (width - source.width * ratio) / 2, (height - source.height * ratio) / 2, source.width * ratio, source.height * ratio);
  }
  $("process").onclick = () => void job.run(async (current) => {
    if (!front || !back) return;
    status("正在生成隐藏图…");
    const { width, height } = hiddenOutputSize(front.width, front.height, Number($("output-size").value)), a = newCanvas(width, height), b = newCanvas(width, height);
    try {
      draw(front, a.ctx, width, height, "#fff");
      draw(back, b.ctx, width, height, "#000");
      const fa = a.ctx.getImageData(0, 0, width, height), ba = b.ctx.getImageData(0, 0, width, height);
      b.canvas.width = b.canvas.height = 1;
      const data = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/image-limits.js\n  var MIB = 1024 * 1024;\n  var CANVAS_INPUT_BYTES = 64 * MIB;\n  var CANVAS_OUTPUT_BYTES = 128 * MIB;\n  var ENGINE_INPUT_BYTES = 256 * MIB;\n  var ENGINE_OUTPUT_BYTES = 512 * MIB;\n  var EXIF_INPUT_BYTES = 256 * MIB;\n  var EXIF_OUTPUT_BYTES = 16 * MIB;\n  var HIDDEN_OUTPUT_PIXELS = 8e6;\n\n  // src-tauri/builtin-tools/src/hiddenimage-data.js\n  function hiddenImage(front, back, options) {\n    if (!(front instanceof Uint8ClampedArray) || !(back instanceof Uint8ClampedArray) || !front.length || front.length !== back.length || front.length % 4 || front.length > HIDDEN_OUTPUT_PIXELS * 4) throw new Error("图片像素数据无效或超过 800 万像素。");\n    const white = Number(options.white) / 100, black = Number(options.black) / 100, whiteColor = Number(options.whiteColor ?? options.color ?? 0) / 100, blackColor = Number(options.blackColor ?? options.color ?? 0) / 100;\n    if (!Number.isFinite(white) || white < 0.5 || white > 0.95 || !Number.isFinite(black) || black < 0.05 || black > 0.5 || !Number.isFinite(whiteColor) || whiteColor < 0 || whiteColor > 1 || !Number.isFinite(blackColor) || blackColor < 0 || blackColor > 1) throw new Error("亮度比例或色彩强度无效。");\n    const out = new Uint8ClampedArray(front.length);\n    for (let p = 0; p < out.length; p += 4) {\n      const fg = 0.299 * front[p] + 0.587 * front[p + 1] + 0.114 * front[p + 2], bg = 0.299 * back[p] + 0.587 * back[p + 1] + 0.114 * back[p + 2];\n      const wr = 255 * white + (1 - white) * (fg * (1 - whiteColor) + front[p] * whiteColor), wg = 255 * white + (1 - white) * (fg * (1 - whiteColor) + front[p + 1] * whiteColor), wb = 255 * white + (1 - white) * (fg * (1 - whiteColor) + front[p + 2] * whiteColor);\n      const br = black * (bg * (1 - blackColor) + back[p] * blackColor), bgc = black * (bg * (1 - blackColor) + back[p + 1] * blackColor), bb = black * (bg * (1 - blackColor) + back[p + 2] * blackColor);\n      const alpha = Math.min(1, Math.max(0, 1 - (wr - br + (wg - bgc) + (wb - bb)) / (3 * 255), br / 255, bgc / 255, bb / 255)), background = (1 - alpha) * 255;\n      out[p] = alpha < 1e-6 ? 0 : Math.max(0, Math.min(255, (wr + br - background) / (2 * alpha)));\n      out[p + 1] = alpha < 1e-6 ? 0 : Math.max(0, Math.min(255, (wg + bgc - background) / (2 * alpha)));\n      out[p + 2] = alpha < 1e-6 ? 0 : Math.max(0, Math.min(255, (wb + bb - background) / (2 * alpha)));\n      out[p + 3] = Math.round(alpha * 255);\n    }\n    return out;\n  }\n\n  // src-tauri/builtin-tools/src/hiddenimage-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      const front = data.front instanceof Uint8ClampedArray ? data.front : new Uint8ClampedArray(data.front), back = data.back instanceof Uint8ClampedArray ? data.back : new Uint8ClampedArray(data.back), pixels = hiddenImage(front, back, data.options);\n      self.postMessage({ result: { pixels } }, [pixels.buffer]);\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { front: fa.data, back: ba.data, options: { white: $("white").value, black: $("black").value, whiteColor: $("white-color").value, blackColor: $("black-color").value } }, current, 12e4, [fa.data.buffer, ba.data.buffer]);
      checkAbort(current);
      a.ctx.putImageData(new ImageData(data.pixels, width, height), 0, 0);
      const blob = await encodeCanvas(a.canvas, { mime: "image/png" }, current);
      checkAbort(current);
      result = blob;
      url = URL.createObjectURL(blob);
      $("light-preview").src = $("dark-preview").src = url;
      $("result-info").textContent = `${width} × ${height} · ${size(blob.size)} · PNG 透明图`;
      $("result").hidden = false;
      status("隐藏图已生成。");
    } finally {
      a.canvas.width = a.canvas.height = b.canvas.width = b.canvas.height = 1;
    }
  });
  $("save").onclick = () => void job.run(async (current) => {
    if (result) status(await saveBlob(files, "hidden-image.png", result, current) ? "PNG 已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => job.cancel();
  update();
  return () => {
    job.dispose();
    front?.release();
    back?.release();
    front = back = null;
    invalidate();
  };
}
export {
  mount
};
