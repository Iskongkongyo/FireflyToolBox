// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
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

// src-tauri/builtin-tools/src/random.js
function mount({ copyText, saveFile, signal }) {
  let result = "";
  const job = session(signal, update);
  function update() {
    for (const id of ["copy", "save"]) $(id).disabled = job.busy || !result;
    for (const id of ["digit-min", "digit-max"]) $(id).disabled = job.busy || !$("digits").checked;
    $("symbol-chars").disabled = job.busy || !$("symbols").checked;
    $("custom-chars").disabled = job.busy || !$("custom").checked;
  }
  function invalidate() {
    result = "";
    $("output").value = "";
    update();
    status("");
  }
  for (const e of document.querySelectorAll("main input,main select")) e.oninput = () => {
    invalidate();
    $("number-options").hidden = $("type").value !== "numbers";
    $("string-options").hidden = $("type").value !== "strings";
  };
  $("generate").onclick = () => void job.run(async (current) => {
    status("正在生成…");
    const type = $("type").value, options = type === "numbers" ? { count: $("number-count").value, min: $("min").value, max: $("max").value, repeat: $("repeat").checked } : { count: $("string-count").value, length: $("length").value, digits: $("digits").checked, digitMin: $("digit-min").value, digitMax: $("digit-max").value, lower: $("lower").checked, upper: $("upper").checked, symbols: $("symbols").checked, symbolChars: $("symbol-chars").value, custom: $("custom").checked, customChars: $("custom-chars").value, exclude: $("exclude").checked, ensure: $("ensure").checked };
    const values = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/random-data.js\n  function randomSource() {\n    let buffer = new Uint32Array(512), index = buffer.length;\n    return () => {\n      if (index + 1 >= buffer.length) {\n        crypto.getRandomValues(buffer);\n        index = 0;\n      }\n      return BigInt(buffer[index++]) << 32n | BigInt(buffer[index++]);\n    };\n  }\n  function randomBelow(bound, next = randomSource()) {\n    if (bound < 1n || bound > 1n << 64n) throw new Error("随机范围无效。");\n    if (bound === 1n) return 0n;\n    const total = 1n << 64n, limit = total - total % bound;\n    let value;\n    do {\n      value = next();\n    } while (value >= limit);\n    return value % bound;\n  }\n  function integer(value, min, max, name) {\n    const n = Number(value);\n    if (!String(value).trim() || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name}需为 ${min}～${max} 的整数。`);\n    return n;\n  }\n  function randomNumbers({ count, min, max, repeat }, next = randomSource()) {\n    const amount = integer(count, 1, 1e3, "数量"), low = integer(min, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "最小值"), high = integer(max, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "最大值");\n    if (low > high) throw new Error("最小值不能大于最大值。");\n    const start = BigInt(low), size = BigInt(high) - start + 1n;\n    if (!repeat && BigInt(amount) > size) throw new Error("范围内可用数字不足，请减少数量或允许重复。");\n    const result = [], map = /* @__PURE__ */ new Map();\n    for (let i = 0; i < amount; i++) {\n      if (repeat) result.push(String(start + randomBelow(size, next)));\n      else {\n        const remaining = size - BigInt(i), pick = randomBelow(remaining, next), last = remaining - 1n, value = map.get(pick) ?? pick;\n        map.set(pick, map.get(last) ?? last);\n        map.delete(last);\n        result.push(String(start + value));\n      }\n    }\n    return result;\n  }\n  function randomStrings(options, next = randomSource()) {\n    const count = integer(options.count, 1, 1e3, "数量"), length = integer(options.length, 1, 256, "长度");\n    if (count * length > 65536) throw new Error("总字符数最多 65536，请减少数量或长度。");\n    let groups = [];\n    if (options.symbols && !String(options.symbolChars || "")) throw new Error("请填写已启用的符号库。");\n    if (options.custom && !String(options.customChars || "")) throw new Error("请填写已启用的自定义字符库。");\n    if (options.digits) {\n      const from = integer(options.digitMin, 0, 9, "数字起点"), to = integer(options.digitMax, 0, 9, "数字终点");\n      if (from > to) throw new Error("数字起点不能大于终点。");\n      groups.push(Array.from({ length: to - from + 1 }, (_, i) => String(from + i)));\n    }\n    if (options.lower) groups.push([..."abcdefghijklmnopqrstuvwxyz"]);\n    if (options.upper) groups.push([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);\n    if (options.symbols) groups.push([...String(options.symbolChars || "")]);\n    if (options.custom) groups.push([...String(options.customChars || "")]);\n    groups = groups.map((g) => [...new Set(g)].filter((c) => !options.exclude || !"0O1Il".includes(c)));\n    if (groups.some((g) => !g.length)) throw new Error("所选字符类别被全部排除，请调整字符库或排除选项。");\n    const all = [...new Set(groups.flat())];\n    if (!all.length) throw new Error("请至少启用一类有可用字符的字符库。");\n    if (all.length > 4096) throw new Error("字符库最多 4096 个字符。");\n    if (options.ensure && length < groups.length) throw new Error("长度小于所选字符类别数，无法每类至少包含一个字符。");\n    const choose = (a) => a[Number(randomBelow(BigInt(a.length), next))], result = [];\n    for (let i = 0; i < count; i++) {\n      const chars = options.ensure ? groups.map(choose) : [];\n      while (chars.length < length) chars.push(choose(all));\n      if (options.ensure) for (let j = chars.length - 1; j > 0; j--) {\n        const k = Number(randomBelow(BigInt(j + 1), next));\n        [chars[j], chars[k]] = [chars[k], chars[j]];\n      }\n      result.push(chars.join(""));\n    }\n    return result;\n  }\n\n  // src-tauri/builtin-tools/src/random-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      self.postMessage({ result: data.type === "numbers" ? randomNumbers(data.options) : randomStrings(data.options) });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { type, options }, current, 5e3);
    if (current.aborted) return;
    result = values.join("\n");
    $("output").value = result;
    status(`已生成 ${values.length} 条。`);
  });
  $("copy").onclick = () => void job.run(async () => {
    await copyText(result);
    status("已复制。");
  });
  $("save").onclick = () => void job.run(async (current) => {
    status(await saveFile("random-results.txt", new Blob([result], { type: "text/plain;charset=utf-8" }), { signal: current }) ? "结果已保存。" : "已取消保存。");
  });
  $("cancel").onclick = () => job.cancel();
  update();
  return () => job.dispose();
}
export {
  mount
};
