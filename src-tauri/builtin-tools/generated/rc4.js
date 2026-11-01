// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function copyButton(id, getText, copyText) {
  $(id).onclick = async () => {
    try {
      const value = getText();
      if (!value) {
        status("请先生成或读取结果。");
        return;
      }
      await copyText(value);
      status("已复制。");
    } catch (error) {
      status(error.message || String(error), true);
    }
  };
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

// src-tauri/builtin-tools/src/practical.js
var IMAGE_LIMIT = 64 * 1024 * 1024;
var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;

// src-tauri/builtin-tools/src/image-limits.js
var MIB = 1024 * 1024;
var CANVAS_INPUT_BYTES = 64 * MIB;
var CANVAS_OUTPUT_BYTES = 128 * MIB;
var ENGINE_INPUT_BYTES = 256 * MIB;
var ENGINE_OUTPUT_BYTES = 512 * MIB;
var EXIF_INPUT_BYTES = 256 * MIB;
var EXIF_OUTPUT_BYTES = 16 * MIB;

// src-tauri/builtin-tools/src/images.js
var MAX_TOTAL_BYTES = 256 * 1024 * 1024;

// src-tauri/builtin-tools/src/image-runtime.js
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

// src-tauri/builtin-tools/src/rc4.js
function mount({ copyText, saveFile, signal }) {
  let result = "";
  const job = session(signal, () => {
    $("copy").disabled = $("save").disabled = job.busy || !result;
  });
  function invalidate() {
    result = "";
    $("output").value = "";
    $("copy").disabled = $("save").disabled = true;
    status("");
  }
  for (const id of ["input", "key", "input-format", "key-format", "output-format", "drop"]) $(id).oninput = invalidate;
  function action() {
    const decrypt = $("action").value === "decrypt";
    $("input-format").value = decrypt ? "hex" : "utf8";
    $("output-format").value = decrypt ? "utf8" : "hex";
    $("run").textContent = decrypt ? "RC4 解密" : "RC4 加密";
    invalidate();
  }
  $("action").onchange = action;
  $("show-key").onchange = () => {
    $("key").type = $("show-key").checked ? "text" : "password";
  };
  $("run").onclick = () => void job.run(async (current) => {
    const data = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/rc4-data.js\n  function decodeBytes(value, format) {\n    const text = String(value);\n    if (format === "utf8") return new TextEncoder().encode(text);\n    if (format === "hex") {\n      const raw = text.replace(/\\s/g, "");\n      if (!/^(?:[a-f0-9]{2})*$/i.test(raw)) throw new Error("HEX 须为成对的十六进制字符。");\n      return Uint8Array.from(raw.match(/../g) || [], (v) => parseInt(v, 16));\n    }\n    if (format === "base64") {\n      const raw = text.replace(/\\s/g, "");\n      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error("Base64 编码无效，请检查字符和末尾填充。");\n      try {\n        return Uint8Array.from(atob(raw), (v) => v.charCodeAt(0));\n      } catch {\n        throw new Error("Base64 编码无效。");\n      }\n    }\n    throw new Error("数据编码无效。");\n  }\n  function encodeBytes(bytes, format) {\n    if (format === "hex") return Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();\n    if (format === "base64") {\n      let binary = "";\n      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));\n      return btoa(binary);\n    }\n    if (format === "utf8") {\n      try {\n        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);\n      } catch {\n        throw new Error("结果不是有效 UTF-8；请核对密钥、编码及丢弃字节，或改用 HEX / Base64 查看。");\n      }\n    }\n    throw new Error("结果编码无效。");\n  }\n  function rc4Bytes(input, key, drop = 0) {\n    if (!(input instanceof Uint8Array) || !(key instanceof Uint8Array) || key.length < 1 || key.length > 256) throw new Error("密钥需为 1～256 字节。");\n    if (input.length > 262144) throw new Error("原始数据最多 256 KiB。");\n    if (!Number.isInteger(drop) || drop < 0 || drop > 65536) throw new Error("丢弃字节需为 0～65536 的整数。");\n    const state = Uint8Array.from({ length: 256 }, (_, i2) => i2);\n    let j = 0;\n    for (let i2 = 0; i2 < 256; i2++) {\n      j = j + state[i2] + key[i2 % key.length] & 255;\n      [state[i2], state[j]] = [state[j], state[i2]];\n    }\n    let i = 0;\n    j = 0;\n    const out = new Uint8Array(input.length);\n    for (let n = 0; n < drop + input.length; n++) {\n      i = i + 1 & 255;\n      j = j + state[i] & 255;\n      [state[i], state[j]] = [state[j], state[i]];\n      const k = state[state[i] + state[j] & 255];\n      if (n >= drop) out[n - drop] = input[n - drop] ^ k;\n    }\n    return out;\n  }\n  function rc4Convert({ source, key, inputFormat = "utf8", keyFormat = "utf8", outputFormat = "hex", drop = 0 }) {\n    const input = decodeBytes(source, inputFormat), secret = decodeBytes(key, keyFormat);\n    if (!input.length) throw new Error("请先输入需要处理的内容。");\n    const output = rc4Bytes(input, secret, Number(drop));\n    return { text: encodeBytes(output, outputFormat), bytes: output.length, keyBytes: secret.length };\n  }\n\n  // src-tauri/builtin-tools/src/rc4-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      self.postMessage({ result: rc4Convert(data) });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { source: $("input").value, key: $("key").value, inputFormat: $("input-format").value, keyFormat: $("key-format").value, outputFormat: $("output-format").value, drop: $("drop").value }, current, 3e3);
    if (current.aborted) return;
    result = data.text;
    $("output").value = result;
    status(`已处理 ${data.bytes} 字节，密钥 ${data.keyBytes} 字节。`);
  });
  $("swap").onclick = () => {
    if (!result) return;
    const value = result, format = $("output-format").value;
    $("action").value = $("action").value === "encrypt" ? "decrypt" : "encrypt";
    action();
    $("input").value = value;
    $("input-format").value = format;
  };
  copyButton("copy", () => result, copyText);
  $("save").onclick = () => void job.run(async (current) => {
    status(await saveFile("RC4结果.txt", new Blob([result], { type: "text/plain;charset=utf-8" }), { signal: current }) ? "TXT 已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => job.cancel();
  return () => {
    job.dispose();
    $("key").value = "";
    result = "";
  };
}
export {
  mount
};
