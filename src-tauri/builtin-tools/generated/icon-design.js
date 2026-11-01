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

// src-tauri/builtin-tools/src/graphics-data.js
function hexColor(value) {
  const hex = String(value).trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("颜色须为 #RRGGBB 格式。");
  return hex.toUpperCase();
}
function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function imageFit(width, height, side) {
  const scale = Math.min(side / width, side / height);
  return { x: (side - width * scale) / 2, y: (side - height * scale) / 2, width: width * scale, height: height * scale };
}
function pngICO(bytes, width = 256, height = 256) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || width < 1 || height < 1 || width > 256 || height > 256) throw new Error("ICO 需要 1～256 px 的 PNG。");
  const out = new Uint8Array(22 + bytes.length), v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, 1, true);
  out[6] = width === 256 ? 0 : width;
  out[7] = height === 256 ? 0 : height;
  v.setUint16(10, 1, true);
  v.setUint16(12, 32, true);
  v.setUint32(14, bytes.length, true);
  v.setUint32(18, 22, true);
  out.set(bytes, 22);
  return out;
}
var ICON_SYMBOLS = [["bolt", "闪电", "M36 3L10 35H27L23 61L54 25H36Z"], ["heart", "爱心", "M32 56C-4 33 3 8 18 8C25 8 29 12 32 18C35 12 39 8 46 8C61 8 68 33 32 56Z"], ["star", "星星", "M32 3L41 22L62 25L47 40L51 61L32 51L13 61L17 40L2 25L23 22Z"], ["cloud", "云朵", "M17 51C0 51-1 31 13 27C12 5 44 4 47 27C65 24 70 51 51 51Z"], ["moon", "月亮", "M49 8C19 8 17 46 46 52C20 68-4 42 8 18C16 2 34-4 49 8Z"], ["leaf", "叶子", "M55 6C55 52 20 64 10 43C0 19 25 6 55 6ZM15 44L48 15L43 36L29 33Z"], ["chat", "对话", "M8 8H56V45H34L17 58V45H8Z"], ["bookmark", "书签", "M15 5H49V60L32 49L15 60Z"]];
function bindHexPair(color, hex, onChange) {
  function apply(value) {
    hex.value = value;
    if (/^#[0-9a-f]{6}$/i.test(value.trim())) color.value = value.trim();
    onChange();
  }
  color.oninput = color.onchange = () => apply(color.value);
  hex.oninput = hex.onchange = () => apply(hex.value);
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

// src-tauri/builtin-tools/src/icon-design.js
function mount({ openFile, saveFile, signal }) {
  const canvas = $("icon-canvas"), ctx = canvas.getContext("2d");
  let image = null, valid = true;
  const job = session(signal, update);
  for (const [id, name] of ICON_SYMBOLS) {
    const option = text("option", name);
    option.value = id;
    $("symbol").append(option);
  }
  function update() {
    $("save-png").disabled = $("save-ico").disabled = job.busy || !valid;
  }
  function draw() {
    const side = Number($("size").value), radius = Number($("radius").value), scale = Number($("scale").value) / 100, mode = $("mode").value, bg = $("background").value;
    if (![256, 512, 1024].includes(side) || !Number.isFinite(radius) || radius < 0 || radius > 50 || !Number.isFinite(scale) || scale < 0.2 || scale > 0.9) throw new Error("图标尺寸、圆角或内容大小无效。");
    const color = mode === "image" ? null : hexColor($("fg-hex").value);
    if (bg !== "transparent") hexColor($("bg-hex").value);
    if (bg === "gradient") hexColor($("bg2-hex").value);
    if (mode === "image" && !image) throw new Error("请先导入图标图片。");
    if (mode === "text" && !$("text").value.trim()) throw new Error("请输入图标文字。");
    canvas.width = canvas.height = side;
    roundedPath(ctx, 0, 0, side, side, side * radius / 100);
    ctx.save();
    ctx.clip();
    if (bg === "solid") {
      ctx.fillStyle = $("bg-hex").value;
      ctx.fillRect(0, 0, side, side);
    } else if (bg === "gradient") {
      const gradient = ctx.createLinearGradient(0, 0, side, side);
      gradient.addColorStop(0, $("bg-hex").value);
      gradient.addColorStop(1, $("bg2-hex").value);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, side, side);
    }
    if (mode === "symbol") {
      const entry = ICON_SYMBOLS.find((v) => v[0] === $("symbol").value);
      if (!entry) throw new Error("图标无效。");
      ctx.translate(side * (1 - scale) / 2, side * (1 - scale) / 2);
      ctx.scale(side * scale / 64, side * scale / 64);
      ctx.fillStyle = color;
      ctx.fill(new Path2D(entry[2]), "evenodd");
    } else if (mode === "text") {
      const font = { sans: 'system-ui,"Microsoft YaHei",sans-serif', serif: 'Georgia,"SimSun",serif', mono: "Consolas,monospace" }[$("font").value] || "system-ui";
      let fontSize = side * scale;
      ctx.font = `700 ${fontSize}px ${font}`;
      const width = ctx.measureText($("text").value).width;
      if (width > side * scale) fontSize *= side * scale / width;
      ctx.font = `700 ${fontSize}px ${font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText($("text").value, side / 2, side / 2);
    } else {
      const fit = imageFit(image.width, image.height, side * scale), offset = side * (1 - scale) / 2;
      ctx.drawImage(image.image, offset + fit.x, offset + fit.y, fit.width, fit.height);
    }
    ctx.restore();
  }
  function refresh() {
    $("symbol-label").hidden = $("mode").value !== "symbol";
    $("text-settings").hidden = $("mode").value !== "text";
    $("image-settings").hidden = $("mode").value !== "image";
    $("fg-label").hidden = $("mode").value === "image";
    $("bg2-label").hidden = $("background").value !== "gradient";
    $("radius-value").textContent = $("radius").value + "%";
    $("scale-value").textContent = $("scale").value + "%";
    try {
      draw();
      valid = true;
      status("");
    } catch (e) {
      valid = false;
      status(e.message, true);
    }
    update();
  }
  for (const id of ["size", "mode", "symbol", "text", "font", "radius", "scale", "background"]) $(id).oninput = refresh;
  for (const id of ["fg", "bg", "bg2"]) bindHexPair($(id), $(id + "-hex"), refresh);
  $("open").onclick = () => void job.run(async (current) => {
    const file = await openFile({ extensions: ["png", "jpg", "jpeg", "webp", "bmp"], signal: current });
    if (!file) return;
    const loaded = await readImage(file, current, 12e6);
    if (current.aborted) {
      loaded.release();
      return;
    }
    image?.release();
    image = loaded;
    $("image-info").textContent = `${file.name} · ${loaded.width} × ${loaded.height} · ${size(file.blob.size)}`;
    refresh();
  });
  async function save(ico, current) {
    draw();
    let target = canvas, temporary = null;
    if (ico) {
      temporary = document.createElement("canvas");
      temporary.width = temporary.height = 256;
      temporary.getContext("2d").drawImage(canvas, 0, 0, 256, 256);
      target = temporary;
    }
    try {
      const png = await encodeCanvas(target, { mime: "image/png", quality: 1 }, current);
      checkAbort(current);
      const blob = ico ? new Blob([pngICO(new Uint8Array(await png.arrayBuffer()))], { type: "image/x-icon" }) : png;
      status(await saveFile(ico ? "应用图标.ico" : "应用图标.png", blob, { signal: current }) ? "图标已保存。" : "已取消保存。");
    } finally {
      if (temporary) temporary.width = temporary.height = 1;
    }
  }
  $("save-png").onclick = () => void job.run((s) => save(false, s));
  $("save-ico").onclick = () => void job.run((s) => save(true, s));
  $("cancel").onclick = () => job.cancel();
  refresh();
  return () => {
    job.dispose();
    image?.release();
    canvas.width = canvas.height = 1;
  };
}
export {
  mount
};
