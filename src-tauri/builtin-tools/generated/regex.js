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

// src-tauri/builtin-tools/src/regex.js
function mount({ copyText, signal }) {
  const templates = [["邮箱（常见格式）", "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"], ["HTTPS 地址", "https://[^\\s<>]+"], ["中国大陆手机号", "(?<!\\d)1[3-9]\\d{9}(?!\\d)"], ["IPv4", "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b"], ["整数", "[+-]?\\d+"], ["日期 YYYY-MM-DD", "\\b\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])\\b"], ["UUID", "\\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\b"], ["中文", "[\\u4E00-\\u9FFF]+"]];
  for (const [name, pattern] of templates) {
    const button = text("button", name);
    button.onclick = () => {
      $("pattern").value = pattern;
    };
    $("templates").append(button);
  }
  for (const [flag, name] of [["g", "全部匹配"], ["i", "忽略大小写"], ["m", "多行"], ["s", "点匹配换行"], ["u", "Unicode"], ["y", "粘连"]]) {
    const label = text("label", `${name} ${flag}`, "check"), input = document.createElement("input");
    input.type = "checkbox";
    input.value = flag;
    input.checked = flag === "g";
    label.prepend(input);
    $("flags").append(label);
  }
  $("pattern").value = "(\\w+)@(\\w+\\.\\w+)";
  $("input").value = "hello@example.com\nadmin@test.org";
  $("replacement").value = "$1";
  const op = operation(signal);
  $("cancel").onclick = () => op.cancel();
  $("run").onclick = async () => {
    const input = $("input").value;
    const job = op.start();
    $("run").disabled = true;
    $("cancel").hidden = false;
    $("results").hidden = true;
    status("正在匹配…");
    try {
      const result = await workerJob('"use strict";\n(() => {\n  // src-tauri/builtin-tools/src/algorithms.js\n  function regexTest({ pattern, flags, input, replacement }) {\n    if (pattern.length > 2048 || input.length > 262144 || replacement.length > 2048) throw new Error("表达式、测试文本或替换文本过长。");\n    const literal = pattern.match(/^\\/([\\s\\S]*)\\/([gimsuy]*)$/);\n    if (literal) {\n      pattern = literal[1];\n      flags = literal[2];\n    }\n    const regex = new RegExp(pattern, flags), matches = [];\n    let match, truncated = false, output = "", cursor = 0;\n    function append(value) {\n      if (output.length + value.length > 1048576) throw new Error("替换结果超过 1 MiB，请缩小输入或替换文本。");\n      output += value;\n    }\n    while (match = regex.exec(input)) {\n      if (matches.length >= 200) {\n        truncated = true;\n        break;\n      }\n      if (match.length > 21) throw new Error("最多支持 20 个捕获组。");\n      matches.push({ index: match.index, end: match.index + match[0].length, text: match[0].slice(0, 256), groups: match.slice(1).map((v) => v === void 0 ? null : v.slice(0, 256)), named: Object.fromEntries(Object.entries(match.groups ?? {}).map(([key, value]) => [key, value?.slice(0, 256) ?? null])) });\n      append(input.slice(cursor, match.index));\n      let replacementSize = 0;\n      const bounded = (value) => {\n        replacementSize += value.length;\n        if (replacementSize > 1048576) throw new Error("替换结果超过 1 MiB，请缩小输入或替换文本。");\n        return value;\n      };\n      const expanded = replacement.replace(/\\$([$&`\']|\\d{1,2}|<[^>]+>)/g, (token, key) => {\n        if (key === "$") return bounded("$");\n        if (key === "&") return bounded(match[0]);\n        if (key === "`") return bounded(input.slice(0, match.index));\n        if (key === "\'") return bounded(input.slice(match.index + match[0].length));\n        if (key.startsWith("<")) return bounded(match.groups ? match.groups[key.slice(1, -1)] ?? "" : token);\n        const n = Number(key);\n        if (n > 0 && n < match.length) return bounded(match[n] ?? "");\n        if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length) return bounded((match[Number(key[0])] ?? "") + key[1]);\n        return bounded(token);\n      });\n      append(expanded);\n      cursor = match.index + match[0].length;\n      if (!regex.global) break;\n      if (match[0] === "") regex.lastIndex += regex.unicode && input.codePointAt(regex.lastIndex) > 65535 ? 2 : 1;\n    }\n    if (!truncated) append(input.slice(cursor));\n    return { matches, truncated, replacement: truncated ? null : output };\n  }\n\n  // src-tauri/builtin-tools/src/regex-worker.js\n  self.onmessage = ({ data }) => {\n    try {\n      self.postMessage({ result: regexTest(data) });\n    } catch (error) {\n      self.postMessage({ error: error.message });\n    }\n  };\n})();\n', { pattern: $("pattern").value, flags: [...$("flags").querySelectorAll("input:checked")].map((i) => i.value).join(""), input, replacement: $("replacement").value }, job, 1200);
      $("count").textContent = `${result.truncated ? "至少 " : ""}${result.matches.length} 条`;
      $("matches").replaceChildren();
      $("highlight").replaceChildren();
      let offset = 0;
      for (const [index, item] of result.matches.entries()) {
        const row = document.createElement("tr");
        for (const value of [index + 1, `${item.index}–${item.end}`, item.text, JSON.stringify({ groups: item.groups, named: item.named })]) row.append(text("td", value));
        $("matches").append(row);
        $("highlight").append(document.createTextNode(input.slice(offset, item.index)), text("mark", input.slice(item.index, item.end) || "∅"));
        offset = item.end;
      }
      $("highlight").append(document.createTextNode(input.slice(offset)));
      $("output").value = result.replacement ?? "";
      $("copy").disabled = result.replacement === null;
      $("results").hidden = false;
      status(result.truncated ? "匹配过多，已截断；请缩小范围后查看完整替换结果。" : `已找到 ${result.matches.length} 条匹配。`);
    } catch (error) {
      status(error.name === "AbortError" ? "已取消。" : error.message, true);
    } finally {
      $("run").disabled = false;
      $("cancel").hidden = true;
    }
  };
  copyButton("copy", () => $("output").value, copyText);
  signal.addEventListener("abort", () => op.dispose(), { once: true });
  return () => op.dispose();
}
export {
  mount
};
