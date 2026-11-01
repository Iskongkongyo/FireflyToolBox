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
function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1048576).toFixed(2)} MiB`;
}
function httpsURL(value) {
  const raw = value.trim();
  if (!raw) throw new Error("请输入域名或 HTTPS 地址。");
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("地址格式无效，请填写域名或完整 HTTPS 地址。");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("仅支持不含账号信息的 HTTPS 地址。");
  return url;
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

// src-tauri/builtin-tools/src/source.js
function mount({ request, saveFile, copyText, signal }) {
  let bytes, url, contentType, encoding = "utf-8";
  const op = operation(signal);
  $("url").value = "https://www.baidu.com";
  function decode() {
    if (!bytes) return;
    let label = $("encoding").value;
    if (label === "auto") {
      const match = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i);
      label = match?.[1] || (bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8");
    }
    try {
      $("output").value = new TextDecoder(label).decode(bytes);
      encoding = label;
    } catch {
      throw new Error("编码不受支持，请手动选择 UTF-8、GBK 等编码。");
    }
  }
  $("encoding").onchange = () => {
    try {
      decode();
      status(`已按 ${encoding} 解码。`);
    } catch (error) {
      status(error.message, true);
    }
  };
  $("cancel").onclick = () => op.cancel();
  $("fetch").onclick = async () => {
    const job = op.start();
    $("fetch").disabled = true;
    $("cancel").hidden = false;
    $("results").hidden = true;
    bytes = null;
    status("正在读取…");
    try {
      url = httpsURL($("url").value);
      const response = await request(url.href, { signal: job });
      bytes = new Uint8Array(await response.arrayBuffer());
      contentType = response.headers.get("Content-Type") || "未提供";
      decode();
      $("info").replaceChildren();
      for (const [key, value] of [["HTTP 状态", response.status], ["最终地址", response.url || url.href], ["内容类型", contentType], ["响应大小", size(bytes.length)], ["文本编码", encoding]]) $("info").append(text("dt", key), text("dd", value));
      $("results").hidden = false;
      status(response.ok ? "已读取。" : `服务器返回 HTTP ${response.status}，已保留其响应内容供排查。`, !response.ok);
    } catch (error) {
      status(error.name === "AbortError" ? "请求已取消。" : error.message, true);
    } finally {
      $("fetch").disabled = false;
      $("cancel").hidden = true;
    }
  };
  $("save").onclick = async () => {
    if (!bytes) return;
    try {
      const saved = await saveFile(`${url.hostname.slice(0, 90)}.html`, new Blob([bytes], { type: contentType }), { signal });
      status(saved ? "原始响应已保存。" : "已取消保存。");
    } catch (error) {
      status(error.message, true);
    }
  };
  copyButton("copy", () => $("output").value, copyText);
  return () => op.dispose();
}
export {
  mount
};
