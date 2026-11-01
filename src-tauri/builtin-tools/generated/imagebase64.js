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

// src-tauri/builtin-tools/src/practical.js
var IMAGE_LIMIT = 64 * 1024 * 1024;
var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;

// src-tauri/builtin-tools/src/utility.js
var TEXT_LIMIT = 1024 * 1024;

// src-tauri/builtin-tools/src/imagebase64-data.js
var BASE64_PREVIEW_CHARS = 256 * 1024;
var chunkBytes = 768 * 1024;

// src-tauri/builtin-tools/src/imagebase64-io.js
async function openBase64File(files, kind, signal) {
  const limit = kind === "image" ? IMAGE_LIMIT : BASE64_TEXT_LIMIT;
  const file = await files.open({ extensions: kind === "image" ? ["png", "jpg", "jpeg", "gif", "webp", "bmp"] : ["txt", "base64"], signal });
  if (!file) return null;
  try {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit) throw new Error(`${kind === "image" ? "图片" : "Base64 文本"}需大于 0 且不超过 ${limit / 1048576} MiB。`);
    const parts = [];
    let offset = 0;
    while (offset < file.size) {
      signal?.throwIfAborted();
      const count = Math.min(1048576, file.size - offset), bytes = await file.read(offset, count, { signal });
      if (!(bytes instanceof Uint8Array) || bytes.length !== count) throw new Error("读取文件不完整，请重新选择文件。");
      parts.push(bytes);
      offset += bytes.length;
    }
    signal?.throwIfAborted();
    return { name: file.name, blob: new Blob(parts, { type: kind === "image" ? file.type : "text/plain;charset=utf-8" }) };
  } finally {
    await file.close();
  }
}

// src-tauri/builtin-tools/src/image-limits.js
var MIB = 1024 * 1024;
var CANVAS_INPUT_BYTES = 64 * MIB;
var CANVAS_OUTPUT_BYTES = 128 * MIB;
var ENGINE_INPUT_BYTES = 256 * MIB;
var ENGINE_OUTPUT_BYTES = 512 * MIB;
var EXIF_INPUT_BYTES = 256 * MIB;
var EXIF_OUTPUT_BYTES = 16 * MIB;

// src-tauri/builtin-tools/src/image-file-io.js
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

// src-tauri/builtin-tools/src/imagebase64.js
function mount({ files, copyText, signal }) {
  const op = operation(signal);
  let imageBlob = null, imageName = "", objectURL = "", rawBlob = null, textBlob = null, busy = false;
  const controls = ["mode", "format", "content", "open-image", "open-text", "decode", "clear", "copy", "save-text", "save-image"];
  function availability() {
    for (const id of ["copy", "save-text"]) $(id).disabled = busy || !(textBlob?.size || $("content").value.trim());
    $("save-image").disabled = busy || !imageBlob;
  }
  function discardImage() {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = "";
    imageBlob = null;
    imageName = "";
    rawBlob = null;
    $("image").removeAttribute("src");
    $("preview").hidden = true;
    availability();
  }
  function clear() {
    discardImage();
    textBlob = null;
    $("content").value = "";
    $("content").readOnly = $("mode").value === "encode";
    $("content-info").textContent = "";
    availability();
  }
  async function showText(blob, current) {
    const value = await blob.slice(0, BASE64_PREVIEW_CHARS).text();
    current.throwIfAborted();
    textBlob = blob;
    $("content").value = value;
    const partial = blob.size > BASE64_PREVIEW_CHARS;
    $("content").readOnly = $("mode").value === "encode" || partial;
    $("content-info").textContent = partial ? `完整文本 ${size(blob.size)}，仅预览前 256 KiB；复制、保存和还原均使用完整内容。大文本请通过“打开 Base64 文本”导入。` : "";
    availability();
  }
  async function output(current) {
    if (!rawBlob) return;
    const prefix = $("format").value === "url" ? `data:${imageBlob.type};base64,` : "";
    await showText(new Blob([prefix, rawBlob], { type: "text/plain;charset=utf-8" }), current);
  }
  async function task(fn) {
    if (busy) return;
    busy = true;
    const current = op.start();
    controls.forEach((id) => $(id).disabled = true);
    $("cancel").hidden = false;
    try {
      await fn(current);
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消操作。" : e.message || "操作失败，请重试。", e.name !== "AbortError");
    } finally {
      if (!signal.aborted) {
        busy = false;
        controls.forEach((id) => $(id).disabled = false);
        $("cancel").hidden = true;
        availability();
      }
    }
  }
  async function present(blob, name, result, current) {
    let url = "", previewNote = "";
    if (result.canPreview) {
      url = URL.createObjectURL(blob);
      const probe = new Image();
      try {
        await new Promise((resolve, reject) => {
          let timer;
          const finish = (e) => {
            clearTimeout(timer);
            current.removeEventListener("abort", abort2);
            probe.onload = probe.onerror = null;
            e ? reject(e) : resolve();
          };
          const abort2 = () => {
            probe.removeAttribute("src");
            finish(new DOMException("已取消", "AbortError"));
          };
          probe.onload = () => finish();
          probe.onerror = () => finish(new Error("当前设备无法预览此图片"));
          current.addEventListener("abort", abort2, { once: true });
          timer = setTimeout(() => finish(new Error("预览超时")), 3e4);
          if (current.aborted) {
            abort2();
            return;
          }
          probe.src = url;
        });
      } catch (e) {
        URL.revokeObjectURL(url);
        url = "";
        if (e.name === "AbortError") throw e;
        previewNote = " · 预览不可用，仍可转换与保存";
      } finally {
        probe.removeAttribute("src");
      }
    } else previewNote = " · 尺寸超过预览范围或无法读取，仍可转换与保存";
    if (current.aborted) {
      if (url) URL.revokeObjectURL(url);
      current.throwIfAborted();
    }
    discardImage();
    objectURL = url;
    imageBlob = blob;
    imageName = name;
    rawBlob = result.textBlob || null;
    $("image").hidden = !url;
    if (url) $("image").src = url;
    $("image-info").textContent = `${name}${result.width ? ` · ${result.width} × ${result.height}` : ""} · ${size(blob.size)}${previewNote}`;
    $("preview").hidden = false;
    if (rawBlob) await output(current);
    availability();
  }
  $("open-image").onclick = () => void task(async (current) => {
    const file = await openBase64File(files, "image", current);
    if (!file) {
      status("已取消选择。");
      return;
    }
    status("正在分块转换图片…");
    const result = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/practical.js\n  var IMAGE_LIMIT = 64 * 1024 * 1024;\n  var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;\n  function imageType(buffer) {\n    const b = new Uint8Array(buffer), word = (start, end) => String.fromCharCode(...b.slice(start, end));\n    if (b.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) && word(12, 16) === "IHDR") return { mime: "image/png", ext: "png" };\n    if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: "image/jpeg", ext: "jpg" };\n    if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(word(0, 6))) return { mime: "image/gif", ext: "gif" };\n    if (b.length >= 30 && word(0, 4) === "RIFF" && word(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };\n    if (b.length >= 26 && word(0, 2) === "BM") return { mime: "image/bmp", ext: "bmp" };\n    throw new Error("仅支持 PNG、JPEG、GIF、WebP、BMP 图片，请检查文件内容。");\n  }\n\n  // src-tauri/builtin-tools/src/utility.js\n  var TEXT_LIMIT = 1024 * 1024;\n  function imageSize(buffer) {\n    const b = new Uint8Array(buffer), v = new DataView(buffer), ascii = (start, length) => String.fromCharCode(...b.slice(start, start + length));\n    let width, height;\n    if (b.length >= 24 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {\n      width = v.getUint32(16);\n      height = v.getUint32(20);\n    } else if (b.length >= 10 && ascii(0, 3) === "GIF") {\n      width = v.getUint16(6, true);\n      height = v.getUint16(8, true);\n    } else if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {\n      const type = ascii(12, 4);\n      if (type === "VP8X") {\n        width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);\n        height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);\n      } else if (type === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) {\n        width = v.getUint16(26, true) & 16383;\n        height = v.getUint16(28, true) & 16383;\n      } else if (type === "VP8L" && b[20] === 47) {\n        width = 1 + ((b[22] & 63) << 8 | b[21]);\n        height = 1 + ((b[24] & 15) << 10 | b[23] << 2 | b[22] >> 6);\n      }\n    } else if (b.length >= 26 && ascii(0, 2) === "BM") {\n      const dib = v.getUint32(14, true);\n      if (dib === 12) {\n        width = v.getUint16(18, true);\n        height = v.getUint16(20, true);\n      } else if (dib >= 40) {\n        width = v.getInt32(18, true);\n        height = Math.abs(v.getInt32(22, true));\n      }\n    } else if (b[0] === 255 && b[1] === 216) {\n      let p = 2;\n      while (p + 3 < b.length) {\n        if (b[p++] !== 255) throw new Error("JPEG 文件结构无效。");\n        while (b[p] === 255) p++;\n        const marker = b[p++];\n        if (marker === 217 || marker === 218) break;\n        if (marker === 1 || marker >= 208 && marker <= 215) continue;\n        if (p + 2 > b.length) break;\n        const length = v.getUint16(p);\n        if (length < 2 || p + length > b.length) break;\n        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {\n          height = v.getUint16(p + 3);\n          width = v.getUint16(p + 5);\n          break;\n        }\n        p += length;\n      }\n    }\n    if (!width || !height || width < 0 || height < 0) throw new Error("无法读取图片尺寸，请选择 PNG、JPEG、GIF、WebP 或 BMP 图片。");\n    if (width * height > 24e6 || width > 16e3 || height > 16e3) throw new Error("图片尺寸过大，请先裁剪或缩小至 2400 万像素以内。");\n    return { width, height };\n  }\n\n  // src-tauri/builtin-tools/src/imagebase64-data.js\n  var BASE64_PREVIEW_CHARS = 256 * 1024;\n  var textType = "text/plain;charset=utf-8";\n  var chunkBytes = 768 * 1024;\n  var check = (signal) => signal?.throwIfAborted();\n  function base64ImageInfo(buffer) {\n    const type = imageType(buffer);\n    try {\n      return { ...type, ...imageSize(buffer), canPreview: true };\n    } catch {\n      return { ...type, canPreview: false };\n    }\n  }\n  async function encodeImageBlob(blob, signal) {\n    if (!blob.size || blob.size > IMAGE_LIMIT) throw new Error("图片需大于 0 且不超过 64 MiB。");\n    check(signal);\n    const info = base64ImageInfo(await blob.slice(0, 1048576).arrayBuffer()), parts = [];\n    for (let offset = 0; offset < blob.size; offset += chunkBytes) {\n      check(signal);\n      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer()), chunks = [];\n      for (let start = 0; start < bytes.length; start += 49152) chunks.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 49152))));\n      parts.push(new Blob(chunks, { type: textType }));\n    }\n    check(signal);\n    return { ...info, textBlob: new Blob(parts, { type: textType }) };\n  }\n  async function decodeImageBlob(blob, signal) {\n    if (!blob.size || blob.size > BASE64_TEXT_LIMIT) throw new Error("Base64 文本需大于 0 且不超过 96 MiB。");\n    const parts = [], decoder = new TextDecoder("utf-8", { fatal: true });\n    let total = 0, pending = "", declared = "", headerDone = false, padding = false;\n    function decodePart(content) {\n      if (!content) return;\n      let raw;\n      try {\n        raw = atob(content);\n      } catch {\n        throw new Error("Base64 内容无法解码，请检查字符和末尾的 =。");\n      }\n      total += raw.length;\n      if (total > IMAGE_LIMIT) throw new Error("还原的图片超过 64 MiB 上限。");\n      const bytes = new Uint8Array(raw.length);\n      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);\n      parts.push(new Blob([bytes]));\n    }\n    function accept(value, final = false) {\n      let content = pending + value.replace(/[\\t\\n\\r ]/g, "");\n      pending = "";\n      if (!headerDone) {\n        if (!final && content.length < 64) {\n          pending = content;\n          return;\n        }\n        if (/^data:/i.test(content)) {\n          const header = /^data:(image\\/(?:png|jpeg|jpg|gif|webp|bmp));base64,/i.exec(content);\n          if (!header) throw new Error("Data URL 格式无效，仅支持常见图片的 data:image/...;base64, 格式。");\n          declared = header[1].toLowerCase().replace("image/jpg", "image/jpeg");\n          content = content.slice(header[0].length);\n        }\n        headerDone = true;\n      }\n      if (/[^A-Za-z0-9+/=]/.test(content)) throw new Error("Base64 内容无效，请检查字符。");\n      const equals = content.indexOf("="), end = equals >= 0 ? Math.floor(equals / 4) * 4 : Math.floor(content.length / 4) * 4;\n      decodePart(content.slice(0, end));\n      pending = content.slice(end);\n      if (equals >= 0) {\n        padding = true;\n        if (pending.length > 4 || !/^[A-Za-z0-9+/]{2,3}={1,2}$/.test(pending)) throw new Error("Base64 末尾的 = 无效。");\n      }\n      if (final) {\n        if (pending.length === 1 || padding && pending.length !== 4) throw new Error("Base64 末尾的 = 无效。");\n        decodePart(pending);\n        pending = "";\n      }\n    }\n    for (let offset = 0; offset < blob.size; offset += 1048576) {\n      check(signal);\n      const bytes = new Uint8Array(await blob.slice(offset, offset + 1048576).arrayBuffer());\n      let value;\n      try {\n        value = decoder.decode(bytes, { stream: true });\n      } catch {\n        throw new Error("文本不是有效的 UTF-8 Base64 文件。");\n      }\n      accept(value);\n    }\n    check(signal);\n    let tail;\n    try {\n      tail = decoder.decode();\n    } catch {\n      throw new Error("文本不是有效的 UTF-8 Base64 文件。");\n    }\n    accept(tail, true);\n    if (!total) throw new Error("Base64 内容为空。");\n    const output = new Blob(parts), info = base64ImageInfo(await output.slice(0, 1048576).arrayBuffer());\n    if (declared && declared !== info.mime) throw new Error("Data URL 声明的图片格式与实际内容不一致。");\n    return { ...info, imageBlob: new Blob([output], { type: info.mime }) };\n  }\n\n  // src-tauri/builtin-tools/src/imagebase64-worker.js\n  self.onmessage = async ({ data }) => {\n    try {\n      const result = await (data.mode === "encode" ? encodeImageBlob(data.blob) : decodeImageBlob(data.blob));\n      self.postMessage({ result });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { mode: "encode", blob: file.blob }, current, 12e4);
    await present(new Blob([file.blob], { type: result.mime }), file.name, result, current);
    status("已生成 Base64。");
  });
  $("decode").onclick = () => void task(async (current) => {
    status("正在分块还原图片…");
    const blob = textBlob || new Blob([$("content").value], { type: "text/plain;charset=utf-8" });
    const result = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/practical.js\n  var IMAGE_LIMIT = 64 * 1024 * 1024;\n  var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;\n  function imageType(buffer) {\n    const b = new Uint8Array(buffer), word = (start, end) => String.fromCharCode(...b.slice(start, end));\n    if (b.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) && word(12, 16) === "IHDR") return { mime: "image/png", ext: "png" };\n    if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: "image/jpeg", ext: "jpg" };\n    if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(word(0, 6))) return { mime: "image/gif", ext: "gif" };\n    if (b.length >= 30 && word(0, 4) === "RIFF" && word(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };\n    if (b.length >= 26 && word(0, 2) === "BM") return { mime: "image/bmp", ext: "bmp" };\n    throw new Error("仅支持 PNG、JPEG、GIF、WebP、BMP 图片，请检查文件内容。");\n  }\n\n  // src-tauri/builtin-tools/src/utility.js\n  var TEXT_LIMIT = 1024 * 1024;\n  function imageSize(buffer) {\n    const b = new Uint8Array(buffer), v = new DataView(buffer), ascii = (start, length) => String.fromCharCode(...b.slice(start, start + length));\n    let width, height;\n    if (b.length >= 24 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {\n      width = v.getUint32(16);\n      height = v.getUint32(20);\n    } else if (b.length >= 10 && ascii(0, 3) === "GIF") {\n      width = v.getUint16(6, true);\n      height = v.getUint16(8, true);\n    } else if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {\n      const type = ascii(12, 4);\n      if (type === "VP8X") {\n        width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);\n        height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);\n      } else if (type === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) {\n        width = v.getUint16(26, true) & 16383;\n        height = v.getUint16(28, true) & 16383;\n      } else if (type === "VP8L" && b[20] === 47) {\n        width = 1 + ((b[22] & 63) << 8 | b[21]);\n        height = 1 + ((b[24] & 15) << 10 | b[23] << 2 | b[22] >> 6);\n      }\n    } else if (b.length >= 26 && ascii(0, 2) === "BM") {\n      const dib = v.getUint32(14, true);\n      if (dib === 12) {\n        width = v.getUint16(18, true);\n        height = v.getUint16(20, true);\n      } else if (dib >= 40) {\n        width = v.getInt32(18, true);\n        height = Math.abs(v.getInt32(22, true));\n      }\n    } else if (b[0] === 255 && b[1] === 216) {\n      let p = 2;\n      while (p + 3 < b.length) {\n        if (b[p++] !== 255) throw new Error("JPEG 文件结构无效。");\n        while (b[p] === 255) p++;\n        const marker = b[p++];\n        if (marker === 217 || marker === 218) break;\n        if (marker === 1 || marker >= 208 && marker <= 215) continue;\n        if (p + 2 > b.length) break;\n        const length = v.getUint16(p);\n        if (length < 2 || p + length > b.length) break;\n        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {\n          height = v.getUint16(p + 3);\n          width = v.getUint16(p + 5);\n          break;\n        }\n        p += length;\n      }\n    }\n    if (!width || !height || width < 0 || height < 0) throw new Error("无法读取图片尺寸，请选择 PNG、JPEG、GIF、WebP 或 BMP 图片。");\n    if (width * height > 24e6 || width > 16e3 || height > 16e3) throw new Error("图片尺寸过大，请先裁剪或缩小至 2400 万像素以内。");\n    return { width, height };\n  }\n\n  // src-tauri/builtin-tools/src/imagebase64-data.js\n  var BASE64_PREVIEW_CHARS = 256 * 1024;\n  var textType = "text/plain;charset=utf-8";\n  var chunkBytes = 768 * 1024;\n  var check = (signal) => signal?.throwIfAborted();\n  function base64ImageInfo(buffer) {\n    const type = imageType(buffer);\n    try {\n      return { ...type, ...imageSize(buffer), canPreview: true };\n    } catch {\n      return { ...type, canPreview: false };\n    }\n  }\n  async function encodeImageBlob(blob, signal) {\n    if (!blob.size || blob.size > IMAGE_LIMIT) throw new Error("图片需大于 0 且不超过 64 MiB。");\n    check(signal);\n    const info = base64ImageInfo(await blob.slice(0, 1048576).arrayBuffer()), parts = [];\n    for (let offset = 0; offset < blob.size; offset += chunkBytes) {\n      check(signal);\n      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer()), chunks = [];\n      for (let start = 0; start < bytes.length; start += 49152) chunks.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 49152))));\n      parts.push(new Blob(chunks, { type: textType }));\n    }\n    check(signal);\n    return { ...info, textBlob: new Blob(parts, { type: textType }) };\n  }\n  async function decodeImageBlob(blob, signal) {\n    if (!blob.size || blob.size > BASE64_TEXT_LIMIT) throw new Error("Base64 文本需大于 0 且不超过 96 MiB。");\n    const parts = [], decoder = new TextDecoder("utf-8", { fatal: true });\n    let total = 0, pending = "", declared = "", headerDone = false, padding = false;\n    function decodePart(content) {\n      if (!content) return;\n      let raw;\n      try {\n        raw = atob(content);\n      } catch {\n        throw new Error("Base64 内容无法解码，请检查字符和末尾的 =。");\n      }\n      total += raw.length;\n      if (total > IMAGE_LIMIT) throw new Error("还原的图片超过 64 MiB 上限。");\n      const bytes = new Uint8Array(raw.length);\n      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);\n      parts.push(new Blob([bytes]));\n    }\n    function accept(value, final = false) {\n      let content = pending + value.replace(/[\\t\\n\\r ]/g, "");\n      pending = "";\n      if (!headerDone) {\n        if (!final && content.length < 64) {\n          pending = content;\n          return;\n        }\n        if (/^data:/i.test(content)) {\n          const header = /^data:(image\\/(?:png|jpeg|jpg|gif|webp|bmp));base64,/i.exec(content);\n          if (!header) throw new Error("Data URL 格式无效，仅支持常见图片的 data:image/...;base64, 格式。");\n          declared = header[1].toLowerCase().replace("image/jpg", "image/jpeg");\n          content = content.slice(header[0].length);\n        }\n        headerDone = true;\n      }\n      if (/[^A-Za-z0-9+/=]/.test(content)) throw new Error("Base64 内容无效，请检查字符。");\n      const equals = content.indexOf("="), end = equals >= 0 ? Math.floor(equals / 4) * 4 : Math.floor(content.length / 4) * 4;\n      decodePart(content.slice(0, end));\n      pending = content.slice(end);\n      if (equals >= 0) {\n        padding = true;\n        if (pending.length > 4 || !/^[A-Za-z0-9+/]{2,3}={1,2}$/.test(pending)) throw new Error("Base64 末尾的 = 无效。");\n      }\n      if (final) {\n        if (pending.length === 1 || padding && pending.length !== 4) throw new Error("Base64 末尾的 = 无效。");\n        decodePart(pending);\n        pending = "";\n      }\n    }\n    for (let offset = 0; offset < blob.size; offset += 1048576) {\n      check(signal);\n      const bytes = new Uint8Array(await blob.slice(offset, offset + 1048576).arrayBuffer());\n      let value;\n      try {\n        value = decoder.decode(bytes, { stream: true });\n      } catch {\n        throw new Error("文本不是有效的 UTF-8 Base64 文件。");\n      }\n      accept(value);\n    }\n    check(signal);\n    let tail;\n    try {\n      tail = decoder.decode();\n    } catch {\n      throw new Error("文本不是有效的 UTF-8 Base64 文件。");\n    }\n    accept(tail, true);\n    if (!total) throw new Error("Base64 内容为空。");\n    const output = new Blob(parts), info = base64ImageInfo(await output.slice(0, 1048576).arrayBuffer());\n    if (declared && declared !== info.mime) throw new Error("Data URL 声明的图片格式与实际内容不一致。");\n    return { ...info, imageBlob: new Blob([output], { type: info.mime }) };\n  }\n\n  // src-tauri/builtin-tools/src/imagebase64-worker.js\n  self.onmessage = async ({ data }) => {\n    try {\n      const result = await (data.mode === "encode" ? encodeImageBlob(data.blob) : decodeImageBlob(data.blob));\n      self.postMessage({ result });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { mode: "decode", blob }, current, 12e4);
    await present(result.imageBlob, `image.${result.ext}`, result, current);
    status("图片已还原，可保存到设备。");
  });
  $("open-text").onclick = () => void task(async (current) => {
    const file = await openBase64File(files, "text", current);
    if (!file) {
      status("已取消选择。");
      return;
    }
    await showText(file.blob, current);
    discardImage();
    status("文本已打开，点击“还原图片”查看结果。");
  });
  $("format").onchange = () => void task(output);
  $("content").oninput = () => {
    textBlob = null;
    $("content-info").textContent = "";
    discardImage();
    status("");
  };
  $("mode").onchange = () => {
    clear();
    const decode = $("mode").value === "decode";
    $("encode-controls").hidden = decode;
    $("decode-controls").hidden = !decode;
    $("content").placeholder = decode ? "粘贴纯 Base64 或 data:image/...;base64,...；大文本可打开文件" : "选择图片后将在这里生成 Base64";
    status("");
  };
  $("clear").onclick = () => {
    clear();
    status("");
  };
  $("copy").onclick = () => void task(async (current) => {
    const value = textBlob ? await textBlob.text() : $("content").value;
    current.throwIfAborted();
    await copyText(value);
    status("已复制完整 Base64。");
  });
  $("save-text").onclick = () => void task(async (current) => {
    const blob = textBlob || new Blob([$("content").value], { type: "text/plain;charset=utf-8" });
    const saved = await saveBlob(files, "image-base64.txt", blob, current, BASE64_TEXT_LIMIT);
    status(saved ? "完整 Base64 已保存。" : "已取消保存。");
  });
  $("save-image").onclick = () => void task(async (current) => {
    const saved = await saveBlob(files, imageName, imageBlob, current);
    status(saved ? "图片已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => op.cancel();
  const abort = () => op.cancel();
  signal.addEventListener("abort", abort, { once: true });
  return () => {
    signal.removeEventListener("abort", abort);
    op.dispose();
    clear();
  };
}
export {
  mount
};
