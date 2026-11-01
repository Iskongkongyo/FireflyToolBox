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
function canvasPoint(rect, x, y, width, height) {
  return { x: Math.max(0, Math.min(width - 1, (x - rect.left) * width / Math.max(rect.width, 1))), y: Math.max(0, Math.min(height - 1, (y - rect.top) * height / Math.max(rect.height, 1))) };
}
function colorInfo(r, g, b, a = 255) {
  if (![r, g, b, a].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error("像素颜色无效。");
  const values = [r, g, b].map((v) => v / 255), max = Math.max(...values), min = Math.min(...values), delta = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1));
    h = max === values[0] ? (values[1] - values[2]) / delta % 6 : max === values[1] ? (values[2] - values[0]) / delta + 2 : (values[0] - values[1]) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  const toHex = (v) => v.toString(16).padStart(2, "0").toUpperCase(), hex = "#" + [r, g, b].map(toHex).join("");
  return { r, g, b, a, hex, hex8: hex + toHex(a), rgb: `rgb(${r}, ${g}, ${b})`, rgba: `rgba(${r}, ${g}, ${b}, ${Math.round(a / 255 * 1e3) / 1e3})`, hsl: `hsl(${Math.round(h) % 360}, ${Math.round(s * 1e3) / 10}%, ${Math.round(l * 1e3) / 10}%)`, alpha: Math.round(a / 255 * 100) };
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

// src-tauri/builtin-tools/src/color-picker.js
function mount({ files, copyText, signal }) {
  const display = $("image-canvas"), ctx = display.getContext("2d"), original = document.createElement("canvas"), source = original.getContext("2d", { willReadFrequently: true }), loupe = $("loupe-canvas"), lens = loupe.getContext("2d");
  let selected = null, drag = null, width = 0, height = 0, frame = 0, pending = null, colors = [];
  const job = session(signal, () => {
  });
  function sample(x, y) {
    if (!width) return;
    x = Math.max(0, Math.min(width - 1, Math.round(x)));
    y = Math.max(0, Math.min(height - 1, Math.round(y)));
    const rgba = source.getImageData(x, y, 1, 1).data;
    selected = { ...colorInfo(...rgba), x, y };
    $("result").hidden = false;
    $("pixel-position").textContent = `X ${x} · Y ${y}`;
    $("alpha").textContent = `Alpha ${selected.alpha}%（不透明度）${selected.a === 0 ? " · 完全透明像素" : ""}`;
    $("color-preview").style.backgroundColor = selected.rgba;
    for (const id of ["hex", "rgb", "hsl", "hex8"]) $(id).textContent = selected[id];
    $("hex8-row").hidden = selected.a === 255;
    $("loupe-hex").textContent = selected.hex;
    lens.clearRect(0, 0, 126, 126);
    lens.imageSmoothingEnabled = false;
    lens.drawImage(original, x - 4, y - 4, 9, 9, 0, 0, 126, 126);
    lens.strokeStyle = "rgba(0,0,0,.18)";
    lens.lineWidth = 1;
    for (let p = 0; p <= 126; p += 14) {
      lens.beginPath();
      lens.moveTo(p, 0);
      lens.lineTo(p, 126);
      lens.moveTo(0, p);
      lens.lineTo(126, p);
      lens.stroke();
    }
    lens.strokeStyle = "#fff";
    lens.lineWidth = 3;
    lens.strokeRect(56, 56, 14, 14);
    lens.strokeStyle = "#172d25";
    lens.lineWidth = 1;
    lens.strokeRect(56, 56, 14, 14);
    position();
  }
  function position() {
    if (!selected) return;
    const initialImage = display.getBoundingClientRect(), initialStage = $("picker-stage").getBoundingClientRect(), right = initialStage.right - initialImage.right >= 146, left = initialImage.left - initialStage.left >= 146;
    $("picker-stage").dataset.loupeLayout = right || left ? "side" : "below";
    const image = display.getBoundingClientRect(), stage = $("picker-stage").getBoundingClientRect(), px = image.left - stage.left + (selected.x + 0.5) / width * image.width, py = image.top - stage.top + (selected.y + 0.5) / height * image.height;
    $("picker-crosshair").hidden = $("loupe").hidden = false;
    $("picker-crosshair").style.left = px + "px";
    $("picker-crosshair").style.top = py + "px";
    $("loupe").style.left = (right ? image.right - stage.left + 10 : left ? image.left - stage.left - 146 : Math.max(0, Math.min(stage.width - 136, px - 68))) + "px";
    $("loupe").style.top = (right || left ? Math.max(0, Math.min(stage.height - 162, py - 80)) : image.bottom - stage.top + 10) + "px";
  }
  function queue(x, y) {
    pending = { x, y };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) {
        sample(pending.x, pending.y);
        pending = null;
      }
    });
  }
  function history() {
    if (!selected) return;
    const key = selected.hex8;
    if (colors.at(-1) !== key) colors = [...colors.filter((c) => c !== key), key].slice(-16);
    $("history").replaceChildren(...colors.map((hex) => {
      const b = text("button", hex);
      b.style.backgroundColor = hex;
      b.setAttribute("aria-label", "复制记录 " + hex);
      b.onclick = () => void copy(hex);
      return b;
    }));
  }
  async function copy(value) {
    try {
      await copyText(value);
      if (!signal.aborted) status("已复制。");
    } catch (e) {
      if (!signal.aborted) status(e.message, true);
    }
  }
  function point(event) {
    const p = canvasPoint(display.getBoundingClientRect(), event.clientX, event.clientY, width, height);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  display.onpointerdown = (e) => {
    if (job.busy || !width || e.button !== 0) return;
    e.preventDefault();
    const p = point(e);
    sample(p.x, p.y);
    drag = { id: e.pointerId, kind: "image" };
    display.setPointerCapture(e.pointerId);
  };
  display.onpointermove = (e) => {
    if (job.busy || !width || drag && drag.id !== e.pointerId) return;
    if (e.pointerType === "mouse" || drag) {
      const p = point(e);
      queue(p.x, p.y);
    }
  };
  function end(e) {
    if (!drag || drag.id !== e.pointerId) return;
    if (pending) {
      sample(pending.x, pending.y);
      pending = null;
    }
    if (e.type === "pointerup") history();
    drag = null;
  }
  display.onpointerup = display.onpointercancel = end;
  display.onlostpointercapture = () => {
    drag = null;
  };
  $("loupe").onpointerdown = (e) => {
    if (!selected || job.busy) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, kind: "loupe", startX: e.clientX, startY: e.clientY, x: selected.x, y: selected.y };
    $("loupe").setPointerCapture(e.pointerId);
  };
  $("loupe").onpointermove = (e) => {
    if (drag?.kind !== "loupe" || drag.id !== e.pointerId) return;
    e.preventDefault();
    const rect = display.getBoundingClientRect();
    queue(drag.x + (e.clientX - drag.startX) * width / rect.width, drag.y + (e.clientY - drag.startY) * height / rect.height);
  };
  $("loupe").onpointerup = $("loupe").onpointercancel = end;
  $("loupe").onlostpointercapture = () => {
    drag = null;
  };
  const moves = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  for (const [id, [dx, dy]] of Object.entries(moves)) $(id).onclick = () => {
    if (selected) {
      sample(selected.x + dx, selected.y + dy);
      history();
    }
  };
  display.onkeydown = (e) => {
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
    if (dir && selected) {
      e.preventDefault();
      const [dx, dy] = moves[dir], step = e.shiftKey ? 10 : 1;
      sample(selected.x + dx * step, selected.y + dy * step);
    }
  };
  for (const id of ["hex", "rgb", "hsl", "hex8"]) $("copy-" + id).onclick = () => {
    if (selected) void copy(selected[id]);
  };
  $("copy-all").onclick = () => {
    if (selected) void copy(`${selected.hex}
${selected.rgb}
${selected.hsl}
${selected.hex8}
X ${selected.x}, Y ${selected.y}`);
  };
  $("open").onclick = () => void job.run(async (current) => {
    const file = await openCanvasFile(files, current);
    if (!file) return;
    const image = await readImage(file, current);
    try {
      if (current.aborted) return;
      original.width = image.width;
      original.height = image.height;
      source.drawImage(image.image, 0, 0);
      width = image.width;
      height = image.height;
      const scale = Math.min(1, 1400 / width, 900 / height);
      display.width = Math.max(1, Math.round(width * scale));
      display.height = Math.max(1, Math.round(height * scale));
      ctx.drawImage(original, 0, 0, display.width, display.height);
      $("picker-stage").hidden = false;
      $("image-info").textContent = `${file.name} · ${width} × ${height} · ${size(file.blob.size)}`;
      sample(Math.floor(width / 2), Math.floor(height / 2));
      status("图片已读取，可移动取色。");
    } finally {
      image.release();
    }
  });
  $("cancel").onclick = () => job.cancel();
  const observer = new ResizeObserver(position);
  observer.observe($("picker-stage"));
  return () => {
    job.dispose();
    cancelAnimationFrame(frame);
    observer.disconnect();
    original.width = original.height = display.width = display.height = 1;
    colors = [];
    selected = null;
  };
}
export {
  mount
};
