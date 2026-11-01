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
async function jsonRequest(request, url, signal) {
  const response = await request(url, { signal });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请稍后重试。`);
  try {
    return await response.json();
  } catch {
    throw new Error("来源返回了无法解析的数据，请稍后重试。");
  }
}

// src-tauri/builtin-tools/src/quick-network-data.js
function poemRequest(head, length, rhyme) {
  const value = String(head).trim(), chars = [...value];
  if (!chars.length || chars.length > 8 || chars.some((c) => !/^\p{Script=Han}$/u.test(c))) throw new Error("请输入 1～8 个连续汉字作为藏头内容。");
  if (![5, 7].includes(Number(length))) throw new Error("请选择五言或七言。");
  return { head: value, length: Number(length), url: "https://api.tangdouz.com/a/cts/cts.php?" + new URLSearchParams({ nr: value, num: String(length), yc: rhyme ? "1" : "0", return: "json" }) };
}
function poemResult(data, head, length) {
  if (!data?.ok || !Array.isArray(data.lines)) throw new Error(typeof data?.error === "string" ? data.error : typeof data?.msg === "string" ? data.msg : "来源暂时未生成有效诗句，请稍后重试。");
  const chars = [...head];
  if (data.lines.length !== chars.length || data.lines.some((line, i) => typeof line?.text !== "string" || [...line.text][0] !== chars[i] || [...line.text].length !== length)) throw new Error("返回诗句不符合藏头内容或字数，已停止展示，请重试。");
  return { lines: data.lines.map((line) => ({ text: line.text, source: [line.dynasty, line.author, line.title].filter((v) => typeof v === "string" && v.length < 200).join(" · "), rhyme: line.rhyme === true })), rhymed: data.lines.every((line) => line.rhyme === true) };
}

// src-tauri/builtin-tools/src/poem.js
function mount({ request, copyText, signal }) {
  let result = "";
  const job = session(signal, () => {
    $("copy").disabled = job.busy || !result;
  });
  const invalidate = () => {
    result = "";
    $("result").hidden = true;
    $("copy").disabled = true;
    status("");
  };
  for (const id of ["head", "length", "rhyme"]) $(id).oninput = invalidate;
  $("generate").onclick = () => void job.run(async (current) => {
    const query = poemRequest($("head").value, $("length").value, $("rhyme").checked);
    status("正在生成诗句…");
    const data = poemResult(await jsonRequest(request, query.url, current), query.head, query.length);
    if (current.aborted) return;
    $("lines").replaceChildren();
    for (const line of data.lines) {
      const item = text("div", "", "poem-line"), body = text("p", "");
      body.append(text("strong", [...line.text][0]), document.createTextNode([...line.text].slice(1).join("")));
      item.append(body);
      if (line.source) item.append(text("small", line.source, "hint"));
      $("lines").append(item);
    }
    result = data.lines.map((l) => l.text).join("\n");
    $("rhyme-info").textContent = !$("rhyme").checked ? "本次未要求押韵。" : data.rhymed ? "来源标注每句均押韵。" : "部分句尾未匹配韵脚，已保留符合藏头和字数的结果。";
    $("result").hidden = false;
    status("诗句已组合。");
  });
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => result, copyText);
  return () => job.dispose();
}
export {
  mount
};
