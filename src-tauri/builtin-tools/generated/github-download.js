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

// src-tauri/builtin-tools/src/github-download-data.js
var GITHUB_PROVIDERS = [
  { id: "jsdelivr", name: "jsDelivr", prefix: "https://cdn.jsdelivr.net/gh/", cdn: true },
  { id: "statically", name: "Statically", prefix: "https://cdn.statically.io/gh/", cdn: true },
  { id: "pd", name: "pd.zwc365.com", prefix: "https://pd.zwc365.com/" },
  { id: "ghfast", name: "ghfast.top", prefix: "https://ghfast.top/" }
];
var sources = ["github.com", "raw.githubusercontent.com", "codeload.github.com"];
function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("链接包含无效的百分号编码。");
  }
}
function githubAddress(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("请输入完整的 GitHub HTTPS 链接。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !sources.includes(url.hostname) || url.href.length > 4096) throw new Error("仅支持 github.com、raw.githubusercontent.com 或 codeload.github.com 的 HTTPS 链接。");
  if (url.pathname.split("/").filter(Boolean).length < 2) throw new Error("链接须包含用户名和仓库名。");
  return url;
}
function filePath(value) {
  const parts = String(value).replace(/^\/+/, "").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\\]/.test(part))) throw new Error("请填写有效的仓库内文件路径，使用 / 分隔目录。");
  return parts.map(encodeURIComponent).join("/");
}
function githubDownload(providerId, value, options = {}) {
  const provider = GITHUB_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) throw new Error("请选择有效的加速服务。");
  const source = githubAddress(value);
  if (!provider.cdn) {
    const url2 = provider.prefix + source.href;
    if (url2.length > 4096) throw new Error("加速链接过长，请缩短原链接。");
    return { url: url2, original: source.href, provider: provider.name, kind: "代理链接", hint: "原链接已拼接到服务地址后。文件下载与服务可用性取决于所选线路。" };
  }
  const parts = source.pathname.split("/").filter(Boolean).map(decoded), owner = parts[0], repo = source.hostname === "github.com" && parts.length === 2 ? parts[1].replace(/\.git$/i, "") : parts[1];
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner) || !/^[a-z0-9_.-]{1,100}$/i.test(repo)) throw new Error("GitHub 用户名或仓库名无效。");
  let tail = [], kind = "仓库地址", directory = false;
  if (source.hostname === "raw.githubusercontent.com") {
    tail = parts.slice(2);
    if (tail[0] === "refs" && ["heads", "tags"].includes(tail[1])) tail = tail.slice(2);
    kind = "Raw 文件";
  } else if (source.hostname === "github.com" && ["blob", "raw", "tree"].includes(parts[2])) {
    tail = parts.slice(3);
    directory = parts[2] === "tree";
    kind = directory ? "仓库目录" : "仓库文件";
  } else if (source.hostname !== "github.com" || parts.length > 2) throw new Error("CDN 仅支持仓库文件；Release 附件或源码 ZIP 请选 pd.zwc365.com 或 ghfast.top。");
  const override = String(options.ref ?? "").trim(), manualPath = String(options.path ?? "").trim(), joined = tail.join("/");
  let ref = override || tail[0] || "", path = manualPath || (directory ? "" : override && joined.startsWith(override + "/") ? joined.slice(override.length + 1) : tail.slice(1).join("/"));
  if (!ref || !path) throw new Error("请填写分支 / 标签 / 提交和仓库内文件路径，或粘贴完整的文件链接。");
  if (ref.length > 255 || /[\x00-\x20\\?#]/.test(ref) || ref.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("版本或分支名无效。");
  const url = provider.prefix + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "@" + encodeURIComponent(ref) + "/" + filePath(path) + source.search + source.hash;
  if (url.length > 4096) throw new Error("加速链接过长，请缩短版本或文件路径。");
  return { url, original: source.href, provider: provider.name, kind, hint: `仓库：${owner}/${repo} · 版本：${ref} · 文件：${path}` };
}

// src-tauri/builtin-tools/src/github-download.js
function mount({ copyText, openWebsite, signal }) {
  let result = null;
  const job = session(signal, update);
  function update() {
    for (const id of ["copy", "open", "original"]) $(id).disabled = job.busy || !result;
  }
  function invalidate() {
    result = null;
    $("output").value = "";
    $("details").textContent = "";
    status("");
    update();
  }
  function providerChanged() {
    invalidate();
    const provider = GITHUB_PROVIDERS.find((item) => item.id === $("provider").value);
    $("cdn-settings").hidden = !provider.cdn;
    $("provider-hint").textContent = provider.cdn ? "转换 GitHub / Raw 仓库文件；Release 附件和源码 ZIP 请选下面两种代理服务。" : "在服务地址后直接拼接原始 GitHub 链接，可用于 Release 附件、源码压缩包或 Raw 文件。";
  }
  $("provider").oninput = providerChanged;
  for (const id of ["url", "ref", "path"]) $(id).oninput = invalidate;
  $("generate").onclick = () => {
    invalidate();
    try {
      result = githubDownload($("provider").value, $("url").value, { ref: $("ref").value, path: $("path").value });
      $("output").value = result.url;
      $("details").textContent = result.provider + " · " + result.kind + "\n" + result.hint;
      status("加速链接已生成。");
      update();
    } catch (error) {
      status(error.message, true);
    }
  };
  $("url").onkeydown = (event) => {
    if (event.key === "Enter") $("generate").click();
  };
  $("open").onclick = () => void job.run(async (current) => {
    if (!result) return;
    await openWebsite(result.url, { title: "GitHub 下载 · " + result.provider, external: true });
    if (!current.aborted) status("已交给系统浏览器处理下载。");
  });
  $("original").onclick = () => void job.run(async (current) => {
    if (!result) return;
    await openWebsite(result.original, { title: "GitHub 原链接", external: true });
    if (!current.aborted) status("已在系统浏览器打开原链接。");
  });
  $("clear").onclick = () => {
    for (const id of ["url", "ref", "path"]) $(id).value = "";
    invalidate();
    status("已清空。");
  };
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => result?.url ?? "", copyText);
  providerChanged();
  return () => job.dispose();
}
export {
  mount
};
