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

// src-tauri/builtin-tools/src/magic-data.js
var INVISIBLE_TYPES = [{ id: "zwsp", name: "零宽空格", char: "​", code: "U+200B", note: "不占可见宽度，可提供换行机会。" }, { id: "joiner", name: "单词连接符", char: "⁠", code: "U+2060", note: "不占可见宽度，可阻止相邻位置换行。" }, { id: "separator", name: "不可见分隔符", char: "⁣", code: "U+2063", note: "不可见的表达式分隔字符，不是普通空格。" }, { id: "bom", name: "零宽不换行空格", char: "\uFEFF", code: "U+FEFF", note: "位于文件开头时可能被当作 BOM。" }, { id: "zwnj", name: "零宽非连接符", char: "‌", code: "U+200C", note: "可改变部分语言的连字；清理时请留意原文。" }, { id: "zwj", name: "零宽连接符", char: "‍", code: "U+200D", note: "可改变连字与 Emoji 组合；清理时请留意原文。" }];
var RANDOM_INVISIBLE_TYPES = INVISIBLE_TYPES.filter((v) => ["zwsp", "joiner", "separator", "bom"].includes(v.id));
var INVISIBLE_OPTIONS = [...INVISIBLE_TYPES, { id: "random", name: "随机", code: "四种常用类型", note: "每个插入字符随机使用 U+200B、U+2060、U+2063 或 U+FEFF；不随机插入可能改变连字和 Emoji 组合的连接符。" }];
function visibleMagic(value, type) {
  if (type === "random") {
    const map = new Map(RANDOM_INVISIBLE_TYPES.map((v) => [v.char, v.code]));
    return Array.from(String(value), (c) => map.has(c) ? "⟦" + map.get(c) + "⟧" : c).join("");
  }
  const item = INVISIBLE_TYPES.find((v) => v.id === type);
  return item ? String(value).split(item.char).join("⟦" + item.code + "⟧") : String(value);
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

// src-tauri/builtin-tools/src/magic.js
function mount({ copyText, saveFile, signal }) {
  let result = "", resultType = "zwsp";
  const job = session(signal, () => {
    $("copy").disabled = $("save").disabled = job.busy || !result;
  });
  for (const item of INVISIBLE_OPTIONS) {
    const option = text("option", `${item.name} · ${item.code}`);
    option.value = item.id;
    $("type").append(option);
  }
  function markers() {
    $("markers").hidden = !$("show-markers").checked;
    $("markers").textContent = visibleMagic(result, resultType);
  }
  function settings() {
    const remove = $("action").value === "remove";
    $("type").querySelector("option[value=random]").disabled = remove;
    if (remove && $("type").value === "random") $("type").value = "zwsp";
    $("insert-settings").hidden = $("action").value === "remove";
    $("process").textContent = $("action").value === "remove" ? "清理不可见字符" : "生成魔法内容";
    $("type-note").textContent = INVISIBLE_OPTIONS.find((v) => v.id === $("type").value).note;
  }
  function invalidate() {
    result = "";
    $("output").value = "";
    $("copy").disabled = $("save").disabled = true;
    markers();
    settings();
    status("");
  }
  for (const id of ["input", "type", "action", "interval", "repeat", "at-end"]) $(id).oninput = invalidate;
  $("show-markers").onchange = markers;
  $("process").onclick = () => void job.run(async (current) => {
    if (!$("input").value) throw new Error("请先输入内容。");
    const data = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/random-data.js\n  function randomSource() {\n    let buffer = new Uint32Array(512), index = buffer.length;\n    return () => {\n      if (index + 1 >= buffer.length) {\n        crypto.getRandomValues(buffer);\n        index = 0;\n      }\n      return BigInt(buffer[index++]) << 32n | BigInt(buffer[index++]);\n    };\n  }\n  function randomBelow(bound, next = randomSource()) {\n    if (bound < 1n || bound > 1n << 64n) throw new Error("随机范围无效。");\n    if (bound === 1n) return 0n;\n    const total = 1n << 64n, limit = total - total % bound;\n    let value;\n    do {\n      value = next();\n    } while (value >= limit);\n    return value % bound;\n  }\n\n  // src-tauri/builtin-tools/src/magic-data.js\n  var INVISIBLE_TYPES = [{ id: "zwsp", name: "零宽空格", char: "​", code: "U+200B", note: "不占可见宽度，可提供换行机会。" }, { id: "joiner", name: "单词连接符", char: "⁠", code: "U+2060", note: "不占可见宽度，可阻止相邻位置换行。" }, { id: "separator", name: "不可见分隔符", char: "⁣", code: "U+2063", note: "不可见的表达式分隔字符，不是普通空格。" }, { id: "bom", name: "零宽不换行空格", char: "\\uFEFF", code: "U+FEFF", note: "位于文件开头时可能被当作 BOM。" }, { id: "zwnj", name: "零宽非连接符", char: "‌", code: "U+200C", note: "可改变部分语言的连字；清理时请留意原文。" }, { id: "zwj", name: "零宽连接符", char: "‍", code: "U+200D", note: "可改变连字与 Emoji 组合；清理时请留意原文。" }];\n  var RANDOM_INVISIBLE_TYPES = INVISIBLE_TYPES.filter((v) => ["zwsp", "joiner", "separator", "bom"].includes(v.id));\n  var INVISIBLE_OPTIONS = [...INVISIBLE_TYPES, { id: "random", name: "随机", code: "四种常用类型", note: "每个插入字符随机使用 U+200B、U+2060、U+2063 或 U+FEFF；不随机插入可能改变连字和 Emoji 组合的连接符。" }];\n  function magicText(source, { type = "zwsp", interval = 1, repeat = 1, end = false, action = "insert" } = {}, random = () => Number(randomBelow(BigInt(RANDOM_INVISIBLE_TYPES.length)))) {\n    const value = String(source), item = INVISIBLE_OPTIONS.find((v) => v.id === type);\n    if (!item) throw new Error("请选择有效的不可见字符类型。");\n    if (type === "random" && action === "remove") throw new Error("随机仅用于插入，请选择要清理的字符类型。");\n    if (new TextEncoder().encode(value).length > 65536) throw new Error("输入最多支持 64 KiB，请分段处理。");\n    let output = "", count = 0, units = 0;\n    if (action === "remove") {\n      output = value.split(item.char).join("");\n      count = [...value].filter((c) => c === item.char).length;\n      units = [...output].length;\n    } else if (action === "insert") {\n      const step = Number(interval), times = Number(repeat);\n      if (!Number.isInteger(step) || step < 1 || step > 1e3 || !Number.isInteger(times) || times < 1 || times > 8) throw new Error("插入间隔须为 1～1000，单次数量须为 1～8。");\n      const segments = typeof Intl.Segmenter === "function" ? Array.from(new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(value), (v) => v.segment) : Array.from(value);\n      units = segments.length;\n      const parts = [];\n      for (let i = 0; i < segments.length; i++) {\n        parts.push(segments[i]);\n        if ((i + 1) % step === 0 && (end || i < segments.length - 1)) {\n          if (type === "random") {\n            for (let j = 0; j < times; j++) {\n              const index = random();\n              if (!Number.isInteger(index) || index < 0 || index >= RANDOM_INVISIBLE_TYPES.length) throw new Error("随机字符选择无效。");\n              parts.push(RANDOM_INVISIBLE_TYPES[index].char);\n            }\n          } else parts.push(item.char.repeat(times));\n          count += times;\n        }\n      }\n      output = parts.join("");\n    } else throw new Error("请选择插入或清理。");\n    if (new TextEncoder().encode(output).length > 262144) throw new Error("结果超过 256 KiB，请增大间隔或减少单次数量。");\n    return { text: output, count, units, action, type: item.code };\n  }\n\n  // src-tauri/builtin-tools/src/magic-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      self.postMessage({ result: magicText(data.source, data.options) });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { source: $("input").value, options: { action: $("action").value, type: $("type").value, interval: $("interval").value, repeat: $("repeat").value, end: $("at-end").checked } }, current, 3e3);
    if (current.aborted) return;
    result = data.text;
    resultType = $("type").value;
    $("output").value = result;
    markers();
    status(resultType === "random" ? `插入了 ${data.count} 个随机不可见字符。` : `${data.action === "remove" ? "清理" : "插入"}了 ${data.count} 个 ${data.type} 字符。`);
  });
  copyButton("copy", () => result, copyText);
  $("save").onclick = () => void job.run(async (current) => {
    status(await saveFile("魔法内容.txt", new Blob([result], { type: "text/plain;charset=utf-8" }), { signal: current }) ? "TXT 已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => job.cancel();
  settings();
  return () => job.dispose();
}
export {
  mount
};
