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

// src-tauri/builtin-tools/src/life.js
function loadState(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

// src-tauri/builtin-tools/src/meow.js
var DEFAULT = "流萤喵～";
var POOL = [...DEFAULT + "星月云雾风花雪音梦琉璃樱海夜光影"];
function mount({ copyText, signal }) {
  let output = "";
  const job = session(signal, () => {
    $("copy").disabled = job.busy || !output;
  });
  const saved = loadState("meow.mapping", DEFAULT);
  $("mapping").value = typeof saved === "string" ? saved : DEFAULT;
  const invalidate = () => {
    output = "";
    $("output").value = "";
    $("layers").textContent = "";
    $("copy").disabled = true;
    status("");
  };
  $("input").oninput = invalidate;
  $("mapping").oninput = () => {
    invalidate();
    saveState("meow.mapping", $("mapping").value);
  };
  $("reset").onclick = () => {
    $("mapping").value = DEFAULT;
    saveState("meow.mapping", DEFAULT);
    invalidate();
  };
  $("random").onclick = () => {
    const chars = [...POOL], picked = [];
    for (let i = 0; i < 4; i++) picked.push(chars.splice(crypto.getRandomValues(new Uint32Array(1))[0] % chars.length, 1)[0]);
    $("mapping").value = picked.join("");
    saveState("meow.mapping", $("mapping").value);
    invalidate();
  };
  for (const [id, action, auto] of [["encode", "encode", false], ["decode", "decode", false], ["auto", "decode", true]]) $(id).onclick = () => void job.run(async (current) => {
    invalidate();
    status("正在转换…");
    const data = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/meow-core.js\n  var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";\n  var DEFAULT_CHARS = "流萤喵～";\n  function isInvisible(c) {\n    if (c.trim() === "") return true;\n    const cp = c.codePointAt(0);\n    return cp === 8203 || cp === 8204 || cp === 8205 || cp === 8288 || cp === 65279;\n  }\n  function utf8ToBase64(str) {\n    const bytes = new TextEncoder().encode(str);\n    let binString = "";\n    for (let i = 0; i < bytes.byteLength; i++) binString += String.fromCharCode(bytes[i]);\n    return btoa(binString);\n  }\n  function strictBase64ToUtf8(base64) {\n    const binString = atob(base64);\n    const bytes = new Uint8Array(binString.length);\n    for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);\n    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);\n  }\n  function getPermutations(items) {\n    if (items.length <= 1) return [items.slice()];\n    const result = [];\n    for (let i = 0; i < items.length; i++) {\n      const rest = items.slice(0, i).concat(items.slice(i + 1));\n      for (const tail of getPermutations(rest)) result.push([items[i], ...tail]);\n    }\n    return result;\n  }\n  function normalizeCipherInput(rawInput) {\n    let input = [...rawInput.trim()].filter((c) => !/\\s/u.test(c)).join("");\n    const prefix = "喵呜...", suffix = "喵～", length = [...input].length;\n    if (input.startsWith(prefix) && input.endsWith(suffix) && (length - 7) % 3 === 0) input = input.slice(prefix.length, -suffix.length);\n    else if (input.startsWith(prefix) && (length - 5) % 3 === 0) input = input.slice(prefix.length);\n    else if (input.endsWith(suffix) && (length - 2) % 3 === 0) input = input.slice(0, -suffix.length);\n    return [...input];\n  }\n  function looksLikeCipherStructure(rawInput, minLength = 12) {\n    const cipherChars = normalizeCipherInput(rawInput);\n    if (cipherChars.length < minLength || cipherChars.length % 3 !== 0) return false;\n    const uniqueChars = [...new Set(cipherChars)];\n    return uniqueChars.length === 4 && !uniqueChars.some(isInvisible);\n  }\n  function scoreDecodedText(text) {\n    const chars = [...text];\n    if (!chars.length) return -Infinity;\n    const commonPunctuation = /* @__PURE__ */ new Set([...".,!?;:\'\\"()[]{}-_/@#%&+=*<>，。！？：；、“”‘’（）【】《》…—~～`"]);\n    let score = 0;\n    for (const c of chars) {\n      const cp = c.codePointAt(0);\n      if (cp < 32 && c !== "\\n" && c !== "\\r" && c !== "	" || cp === 127) return -Infinity;\n      if (/\\s/u.test(c)) score += 2.6;\n      else if (/^[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]$/u.test(c)) score += 3.3;\n      else if (/^\\p{L}$/u.test(c)) score += 3;\n      else if (/^\\p{N}$/u.test(c)) score += 2.5;\n      else if (commonPunctuation.has(c)) score += 1.25;\n      else if (/^[\\p{P}\\p{S}]$/u.test(c)) score += 0.7;\n      else score += 0.35;\n    }\n    let avg = score / chars.length;\n    if (/https?:\\/\\//i.test(text)) avg += 0.5;\n    if (/\\b(?:www\\.)?[A-Za-z0-9-]+\\.[A-Za-z]{2,}\\b/.test(text)) avg += 0.25;\n    if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(text.trim())) avg += 0.35;\n    try {\n      const trimmed = text.trim();\n      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && JSON.parse(trimmed) !== void 0) avg += 0.8;\n    } catch (e) {\n    }\n    const whitespaceRatio = chars.filter((c) => /\\s/u.test(c)).length / chars.length;\n    if (whitespaceRatio > 0) avg += Math.min(0.35, whitespaceRatio * 2);\n    const englishWords = text.toLowerCase().match(/[a-z]{3,}/g) || [];\n    if (englishWords.length) {\n      let vowelLikeWords = 0;\n      let bigramHits = 0;\n      let bigramTotal = 0;\n      const commonBigrams = new Set("th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur el lo wo rl ld".split(" "));\n      for (const word of englishWords) {\n        const vowelRatio = [...word].filter((c) => "aeiouy".includes(c)).length / word.length;\n        if (vowelRatio >= 0.15 && vowelRatio <= 0.7) vowelLikeWords++;\n        for (let i = 0; i < word.length - 1; i++) {\n          bigramTotal++;\n          if (commonBigrams.has(word.slice(i, i + 2))) bigramHits++;\n        }\n      }\n      avg += 0.18 * (vowelLikeWords / englishWords.length);\n      if (bigramTotal) avg += 0.45 * (bigramHits / bigramTotal);\n    }\n    if (looksLikeCipherStructure(text, 12)) avg += 2.7;\n    return avg;\n  }\n  function tryDecodeWithMapping(cipherChars, mappingChars) {\n    const digitMap = new Map(mappingChars.map((c, i) => [c, i]));\n    let b64Str = "";\n    for (let i = 0; i < cipherChars.length; i += 3) {\n      const d0 = digitMap.get(cipherChars[i]);\n      const d1 = digitMap.get(cipherChars[i + 1]);\n      const d2 = digitMap.get(cipherChars[i + 2]);\n      if (d0 === void 0 || d1 === void 0 || d2 === void 0) return null;\n      b64Str += B64_ALPHABET[d0 * 16 + d1 * 4 + d2];\n    }\n    if (b64Str.length % 4 === 1) return null;\n    let padded = b64Str;\n    const remainder = padded.length % 4;\n    if (remainder === 2) padded += "==";\n    else if (remainder === 3) padded += "=";\n    try {\n      const decoded = strictBase64ToUtf8(padded);\n      if (utf8ToBase64(decoded).replace(/=/g, "") !== b64Str) return null;\n      return { decoded, score: scoreDecodedText(decoded) };\n    } catch (e) {\n      return null;\n    }\n  }\n  function detectMappingFromInput(rawInput) {\n    const cipherChars = normalizeCipherInput(rawInput);\n    if (cipherChars.length < 12 || cipherChars.length % 3 !== 0) return null;\n    const uniqueChars = [...new Set(cipherChars)];\n    if (uniqueChars.length !== 4 || uniqueChars.some(isInvisible)) return null;\n    const candidates = [];\n    for (const permutation of getPermutations(uniqueChars)) {\n      const result = tryDecodeWithMapping(cipherChars, permutation);\n      if (result && Number.isFinite(result.score)) {\n        candidates.push({ chars: permutation, decoded: result.decoded, score: result.score });\n      }\n    }\n    if (!candidates.length) return null;\n    candidates.sort((a, b) => b.score - a.score);\n    const best = candidates[0];\n    const second = candidates[1];\n    const decoded = best.decoded.trim();\n    const isNestedCipher = looksLikeCipherStructure(decoded, 12);\n    const hasCjk = /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/u.test(decoded);\n    const hasWhitespace = /\\s/u.test(decoded);\n    const hasKnownStructure = /https?:\\/\\//i.test(decoded) || /\\b(?:www\\.)?[A-Za-z0-9-]+\\.[A-Za-z]{2,}\\b/.test(decoded) || /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(decoded);\n    const minScore = isNestedCipher ? 2.7 : hasCjk ? 2.2 : hasKnownStructure || hasWhitespace ? 2.6 : 3;\n    const minGap = cipherChars.length < 36 ? 0.18 : 0.12;\n    if (best.score < minScore) return null;\n    if (second && best.score - second.score < minGap) return null;\n    return best;\n  }\n  function decodeStrictWithCustomMapping(rawInput, mappingChars) {\n    if (!mappingChars || mappingChars.length !== 4) return null;\n    const cipherChars = normalizeCipherInput(rawInput);\n    if (!cipherChars.length || cipherChars.length % 3 !== 0) return null;\n    if (cipherChars.some((c) => !mappingChars.includes(c))) return null;\n    return tryDecodeWithMapping(cipherChars, mappingChars);\n  }\n\n  // src-tauri/builtin-tools/src/meow-data.js\n  function meowMapping(value) {\n    const chars = [...value];\n    if (chars.length !== 4 || new Set(chars).size !== 4 || chars.some(isInvisible)) throw new Error("请输入四个不重复、非空白的映射字符，顺序需与编码时一致。");\n    return chars;\n  }\n  function meowEncode(input, mapping = DEFAULT_CHARS) {\n    if (!input) throw new Error("请输入待转换的文字。");\n    if (new TextEncoder().encode(input).length > 32768) throw new Error("原文最多 32 KiB，请缩短内容。");\n    const chars = meowMapping(mapping), base64 = utf8ToBase64(input).replace(/=/g, "");\n    return [...base64].map((c) => {\n      const i = B64_ALPHABET.indexOf(c);\n      return chars[Math.floor(i / 16)] + chars[Math.floor(i / 4) % 4] + chars[i % 4];\n    }).join("");\n  }\n  function meowDecode(input, mapping = DEFAULT_CHARS, auto = false) {\n    if (!input.trim()) throw new Error("请输入喵语。");\n    if (new TextEncoder().encode(input).length > 1048576) throw new Error("喵语最多 1 MiB，请缩短内容。");\n    let chars;\n    try {\n      chars = meowMapping(mapping);\n    } catch (e) {\n      if (!auto) throw e;\n    }\n    let current = input;\n    const seen = /* @__PURE__ */ new Set([input]), layers = [];\n    for (let i = 0; i < (auto ? 12 : 1); i++) {\n      let decoded = auto ? detectMappingFromInput(current) : null;\n      const detected = !!decoded;\n      if (!decoded && chars) {\n        const custom = decodeStrictWithCustomMapping(current, chars);\n        if (custom) decoded = { ...custom, chars };\n      }\n      if (!decoded) {\n        if (!layers.length) throw new Error("无法可靠还原，请确认喵语完整，并填写编码时的四个映射字符（顺序一致）。");\n        return { output: current, layers, partial: true };\n      }\n      if (seen.has(decoded.decoded)) return { output: current, layers, partial: true };\n      current = decoded.decoded;\n      seen.add(current);\n      layers.push({ mapping: decoded.chars.join(""), detected });\n      if (!looksLikeCipherStructure(current, 6)) return { output: current, layers, partial: false };\n    }\n    return { output: current, layers, partial: auto && looksLikeCipherStructure(current, 6) };\n  }\n\n  // src-tauri/builtin-tools/src/meow-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      self.postMessage({ result: data.action === "encode" ? { output: meowEncode(data.input, data.mapping) } : meowDecode(data.input, data.mapping, data.auto) });\n    } catch (e) {\n      self.postMessage({ error: e.message });\n    }\n  };\n})();\n', { action, auto, input: $("input").value, mapping: $("mapping").value }, current, 1e4);
    if (current.aborted) return;
    output = data.output;
    $("output").value = output;
    if (data.layers) $("layers").textContent = data.layers.map((l, i) => `第 ${i + 1} 层：${l.mapping}（${l.detected ? "自动识别" : "指定映射"}）`).join(" · ");
    status(data.partial ? "已还原部分内容，下一层需要确认映射或已达到 12 层上限。" : "已转换。", !!data.partial);
  });
  $("swap").onclick = () => {
    if (!output) return;
    $("input").value = output;
    invalidate();
  };
  $("clear").onclick = () => {
    $("input").value = "";
    invalidate();
  };
  $("copy").onclick = () => void job.run(async () => {
    await copyText(output);
    status("已复制。");
  });
  $("cancel").onclick = () => job.cancel();
  return () => job.dispose();
}
export {
  mount
};
