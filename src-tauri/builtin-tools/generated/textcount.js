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

// src-tauri/builtin-tools/src/textcount.js
var labels = { total: "总字符（码点）", withoutSpaces: "不含空格", withoutWhitespace: "不含所有空白", visible: "可见字符簇", lines: "行数", nonemptyLines: "非空行", breaks: "换行次数", englishWords: "英文字词", utf16: "UTF-16 单元", utf8: "UTF-8 字节" };
var typeLabels = { han: "汉字", latin: "拉丁字母", otherLetters: "其他语言字母", digits: "数字", spaces: "普通空格", otherSpaces: "其他空格（含全角）", tabs: "制表符", newlines: "换行字符", controls: "其他控制字符", punctuation: "标点", symbols: "符号（含 Emoji 码点）", other: "其他（含组合符）" };
function mount({ copyText, openFile, signal }) {
  let timer, controller, result, disposed = false;
  function show(data) {
    result = data;
    for (const [id, label] of Object.entries(labels)) $(id).textContent = data[id].toLocaleString();
    $("types").replaceChildren(...Object.entries(typeLabels).map(([key, label]) => {
      const item = text("div", "", "card");
      item.append(text("strong", data.counts[key].toLocaleString()), text("p", label, "hint"));
      return item;
    }));
    status("已更新统计。");
  }
  async function update() {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    const value = $("input").value;
    if (new TextEncoder().encode(value).length > 2 * 1048576) {
      status("文本最多 2 MiB。", true);
      return;
    }
    try {
      const data = await workerJob(`"use strict";
(() => {
  // src-tauri/builtin-tools/src/text-count-data.js
  var patterns = { han: /\\p{Script=Han}/u, latin: /\\p{Script=Latin}/u, letter: /\\p{L}/u, digit: /\\p{Nd}/u, space: /\\p{Zs}/u, control: /\\p{Cc}/u, punctuation: /\\p{P}/u, symbol: /\\p{S}/u };
  function countText(text) {
    const counts = { han: 0, latin: 0, otherLetters: 0, digits: 0, spaces: 0, otherSpaces: 0, tabs: 0, newlines: 0, controls: 0, punctuation: 0, symbols: 0, other: 0 };
    let total = 0, whitespace = 0;
    for (const ch of text) {
      total++;
      if (/\\s/u.test(ch)) whitespace++;
      if (ch === " ") counts.spaces++;
      else if (ch === "	") counts.tabs++;
      else if (/[\\r\\n\\u2028\\u2029]/u.test(ch)) counts.newlines++;
      else if (patterns.space.test(ch)) counts.otherSpaces++;
      else if (patterns.han.test(ch)) counts.han++;
      else if (patterns.digit.test(ch)) counts.digits++;
      else if (patterns.latin.test(ch) && patterns.letter.test(ch)) counts.latin++;
      else if (patterns.letter.test(ch)) counts.otherLetters++;
      else if (patterns.punctuation.test(ch)) counts.punctuation++;
      else if (patterns.symbol.test(ch)) counts.symbols++;
      else if (patterns.control.test(ch)) counts.controls++;
      else counts.other++;
    }
    const lines = text ? text.split(/\\r\\n|[\\r\\n\\u2028\\u2029]/) : [];
    let visible = 0;
    if (typeof Intl.Segmenter === "function") for (const _ of new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)) visible++;
    else visible = total;
    return { total, withoutSpaces: total - counts.spaces - counts.otherSpaces, withoutWhitespace: total - whitespace, visible, utf16: text.length, utf8: new TextEncoder().encode(text).length, lines: lines.length, nonemptyLines: lines.filter((line) => line.trim()).length, breaks: (text.match(/\\r\\n|[\\r\\n\\u2028\\u2029]/g) || []).length, englishWords: (text.match(/[A-Za-z]+(?:['’\\-][A-Za-z]+)*/g) || []).length, counts };
  }

  // src-tauri/builtin-tools/src/textcount-worker.js
  self.onmessage = ({ data }) => {
    try {
      self.postMessage({ result: countText(data.text) });
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
})();
`, { text: value }, current.signal, 15e3);
      if (!disposed && controller === current) show(data);
    } catch (error) {
      if (error.name !== "AbortError") status(error.message, true);
    }
  }
  $("input").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void update(), 150);
  };
  $("clear").onclick = () => {
    $("input").value = "";
    void update();
  };
  $("import").onclick = async () => {
    try {
      const file = await openFile({ extensions: ["txt", "md", "csv", "json"], signal });
      if (!file) return;
      if (file.blob.size > 2 * 1048576) throw new Error("文本最多 2 MiB。");
      $("input").value = await file.blob.text();
      void update();
    } catch (error) {
      status(error.message, true);
    }
  };
  $("copy").onclick = async () => {
    if (!result) return;
    try {
      await copyText([...Object.entries(labels).map(([key, label]) => `${label}：${result[key]}`), ...Object.entries(typeLabels).map(([key, label]) => `${label}：${result.counts[key]}`)].join("\n"));
      status("统计已复制。");
    } catch (error) {
      status(error.message, true);
    }
  };
  void update();
  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
export {
  mount
};
