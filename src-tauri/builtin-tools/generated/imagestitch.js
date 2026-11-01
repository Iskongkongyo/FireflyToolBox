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

// src-tauri/builtin-tools/src/image-limits.js
var MIB = 1024 * 1024;
var CANVAS_INPUT_BYTES = 64 * MIB;
var CANVAS_OUTPUT_BYTES = 128 * MIB;
var ENGINE_INPUT_BYTES = 256 * MIB;
var ENGINE_OUTPUT_BYTES = 512 * MIB;
var EXIF_INPUT_BYTES = 256 * MIB;
var EXIF_OUTPUT_BYTES = 16 * MIB;

// src-tauri/builtin-tools/src/images.js
var IMAGE_INPUT_LIMIT = CANVAS_INPUT_BYTES;
var IMAGE_OUTPUT_LIMIT = CANVAS_OUTPUT_BYTES;
var MAX_OUTPUT_PIXELS = 24e6;
var MAX_TOTAL_PIXELS = 48e6;
var MAX_IMAGES = 12;
var MAX_TOTAL_BYTES = 256 * 1024 * 1024;
var imageFormats = { png: { mime: "image/png", ext: "png" }, jpeg: { mime: "image/jpeg", ext: "jpg" }, webp: { mime: "image/webp", ext: "webp" } };
function numberIn(value, min, max, name) {
  const n = Number(value);
  if (!String(value).trim() || !Number.isInteger(n) || n < min || n > max) throw new Error(`${name}需为 ${min}～${max} 的整数。`);
  return n;
}
function outputSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_OUTPUT_PIXELS) throw new Error("输出尺寸过大：最多 2400 万像素、单边 16384 px。请减小尺寸或减少图片。");
  return { width, height };
}
function imageOptions(format, quality, background, color) {
  const type = imageFormats[format];
  if (!type) throw new Error("输出格式无效。");
  const q = format === "png" ? 0.9 : numberIn(quality, 1, 100, "质量") / 100;
  if (!["transparent", "color"].includes(background) || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("背景设置无效。");
  return { ...type, quality: q, fill: background === "color" ? color : format === "jpeg" ? "#ffffff" : null };
}
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
function stitchLayout(images, { direction, tileSize, gap, columns, gridFit = "cover" }) {
  if (images.length < 1 || images.length > MAX_IMAGES) throw new Error(`一次最多拼接 ${MAX_IMAGES} 张图片。`);
  if (!["vertical", "horizontal", "grid"].includes(direction)) throw new Error("拼接方式无效。");
  if (!["contain", "cover"].includes(gridFit)) throw new Error("网格适配方式无效。");
  const side = numberIn(tileSize, 64, 4096, "统一尺寸"), space = numberIn(gap, 0, 100, "间距"), cols = Math.min(images.length, numberIn(columns, 1, 6, "网格列数"));
  if (images.some((i) => !Number.isInteger(i.width) || !Number.isInteger(i.height) || i.width < 1 || i.height < 1)) throw new Error("图片尺寸无效。");
  if (images.reduce((sum, i) => sum + i.width * i.height, 0) > MAX_TOTAL_PIXELS) throw new Error("所选图片累计超过 4800 万像素，请减少图片或先压缩尺寸。");
  let width, height, rects = [];
  if (direction === "vertical") {
    width = side + 2 * space;
    height = space;
    for (const i of images) {
      const h = Math.max(1, Math.round(i.height * side / i.width));
      rects.push({ x: space, y: height, width: side, height: h });
      height += h + space;
    }
  } else if (direction === "horizontal") {
    height = side + 2 * space;
    width = space;
    for (const i of images) {
      const w = Math.max(1, Math.round(i.width * side / i.height));
      rects.push({ x: width, y: space, width: w, height: side });
      width += w + space;
    }
  } else {
    const rows = Math.ceil(images.length / cols), cellHeight = Math.max(1, Math.round(side * images[0].height / images[0].width));
    width = cols * side + (cols + 1) * space;
    height = rows * cellHeight + (rows + 1) * space;
    outputSize(width, height);
    rects = images.map((i, n) => {
      const x = space + n % cols * (side + space), y = space + Math.floor(n / cols) * (cellHeight + space);
      if (gridFit === "cover") {
        const ratio2 = Math.max(side / i.width, cellHeight / i.height), sw = side / ratio2, sh = cellHeight / ratio2;
        return { x, y, width: side, height: cellHeight, sourceX: (i.width - sw) / 2, sourceY: (i.height - sh) / 2, sourceWidth: sw, sourceHeight: sh };
      }
      const ratio = Math.min(side / i.width, cellHeight / i.height), w = Math.max(1, Math.min(side, Math.round(i.width * ratio))), h = Math.max(1, Math.min(cellHeight, Math.round(i.height * ratio)));
      return { x: x + Math.floor((side - w) / 2), y: y + Math.floor((cellHeight - h) / 2), width: w, height: h };
    });
  }
  return { ...outputSize(width, height), rects };
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
function preview() {
  let url = "";
  return { clear() {
    if (url) URL.revokeObjectURL(url);
    url = "";
    $("preview-image").removeAttribute("src");
    $("result").hidden = true;
  }, show(blob, info) {
    this.clear();
    url = URL.createObjectURL(blob);
    $("preview-image").src = url;
    $("result-info").textContent = info;
    $("result").hidden = false;
  }, dispose() {
    this.clear();
  } };
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

// src-tauri/builtin-tools/src/imagestitch.js
function mount({ files, signal }) {
  const images = [], view = preview(), job = session(signal, update);
  let result = null;
  function update() {
    $("process").disabled = job.busy || images.length < 2;
    $("save").disabled = job.busy || !result;
    $("clear").disabled = job.busy || !images.length;
    $("add").disabled = job.busy || images.length >= MAX_IMAGES;
    $("quality").disabled = job.busy || $("format").value === "png";
    $("color").disabled = $("color-hex").disabled = job.busy;
    $("empty").hidden = !!images.length;
    document.querySelectorAll("#images li").forEach((li, index) => li.querySelectorAll("button").forEach((button, n) => button.disabled = job.busy || n === 0 && index === 0 || n === 1 && index === images.length - 1));
  }
  function invalidate() {
    result = null;
    view.clear();
    update();
    status("");
  }
  function render() {
    $("images").replaceChildren();
    images.forEach((file, index) => {
      const li = text("li", "", "stitch-image"), thumb = text("img", "");
      thumb.src = file.image.src;
      thumb.alt = file.name;
      const info = text("div", "");
      info.append(text("strong", `${index + 1}. ${file.name}`), text("small", `${file.width} × ${file.height} · ${size(file.blob.size)}`));
      const actions = text("div", "", "stitch-image-actions");
      for (const [label, offset] of [["上移", -1], ["下移", 1], ["移除", 0]]) {
        const button = text("button", label);
        button.type = "button";
        button.setAttribute("aria-label", `${label} ${file.name}`);
        button.disabled = job.busy || offset !== 0 && (index + offset < 0 || index + offset >= images.length);
        button.onclick = () => {
          if (offset === 0) {
            images.splice(index, 1)[0].release();
          } else {
            [images[index], images[index + offset]] = [images[index + offset], images[index]];
          }
          invalidate();
          render();
        };
        actions.append(button);
      }
      li.append(thumb, info, actions);
      $("images").append(li);
    });
    update();
  }
  $("add").onclick = () => void job.run(async (current) => {
    if (images.length >= MAX_IMAGES) throw new Error(`最多添加 ${MAX_IMAGES} 张图片。`);
    const file = await openCanvasFile(files, current);
    if (!file) {
      status("已取消选择。");
      return;
    }
    status("正在读取图片…");
    if (images.reduce((sum, i) => sum + i.blob.size, 0) + file.blob.size > MAX_TOTAL_BYTES) throw new Error("所选图片累计超过 256 MiB，请减少图片或先压缩。");
    const remaining = MAX_TOTAL_PIXELS - images.reduce((sum, i) => sum + i.width * i.height, 0), loaded = await readImage(file, current, remaining);
    if (current.aborted) {
      loaded.release();
      return;
    }
    if (images.reduce((sum, i) => sum + i.width * i.height, 0) + loaded.width * loaded.height > MAX_TOTAL_PIXELS) {
      loaded.release();
      throw new Error("所选图片累计超过 4800 万像素，请减少图片或先压缩尺寸。");
    }
    images.push(loaded);
    invalidate();
    render();
    status(`已添加 ${images.length} 张图片。`);
  });
  $("clear").onclick = () => {
    images.splice(0).forEach((i) => i.release());
    invalidate();
    render();
  };
  for (const id of ["direction", "tile-size", "gap", "columns", "grid-fit", "format", "quality", "background"]) $(id).oninput = () => {
    invalidate();
    $("columns-label").hidden = $("grid-fit-label").hidden = $("direction").value !== "grid";
    $("tile-hint").textContent = $("direction").value === "vertical" ? "每张图片的宽度，等比缩放" : $("direction").value === "horizontal" ? "每张图片的高度，等比缩放" : "网格每格的宽度，高度按首图比例计算";
  };
  const applyColor = (value) => {
    const hex = value.trim();
    $("color-hex").value = hex;
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      $("color").value = hex;
      $("background").value = "color";
    }
    invalidate();
  };
  $("color").oninput = $("color").onchange = () => applyColor($("color").value);
  $("color-hex").oninput = $("color-hex").onchange = () => applyColor($("color-hex").value);
  $("process").onclick = () => void job.run(async (current) => {
    if (images.length < 2) return;
    const options = imageOptions($("format").value, $("quality").value, $("background").value, $("color-hex").value.trim()), layout = stitchLayout(images, { direction: $("direction").value, tileSize: $("tile-size").value, gap: $("gap").value, columns: $("columns").value, gridFit: $("grid-fit").value }), { canvas, ctx } = newCanvas(layout.width, layout.height, options.fill);
    status("正在生成拼接图…");
    try {
      for (let i = 0; i < images.length; i++) {
        checkAbort(current);
        const rect = layout.rects[i];
        if (rect.sourceWidth !== void 0) ctx.drawImage(images[i].image, rect.sourceX, rect.sourceY, rect.sourceWidth, rect.sourceHeight, rect.x, rect.y, rect.width, rect.height);
        else ctx.drawImage(images[i].image, rect.x, rect.y, rect.width, rect.height);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const blob = await encodeCanvas(canvas, options, current);
      checkAbort(current);
      result = { blob, name: `stitched-image.${options.ext}` };
      view.show(blob, `${images.length} 张图片 · ${layout.width} × ${layout.height} · ${size(blob.size)}`);
      status("拼接完成，可保存图片。");
    } finally {
      canvas.width = canvas.height = 1;
    }
  });
  $("save").onclick = () => void job.run(async (current) => {
    if (result) status(await saveBlob(files, result.name, result.blob, current) ? "图片已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => job.cancel();
  update();
  return () => {
    job.dispose();
    images.splice(0).forEach((i) => i.release());
    result = null;
    view.dispose();
  };
}
export {
  mount
};
