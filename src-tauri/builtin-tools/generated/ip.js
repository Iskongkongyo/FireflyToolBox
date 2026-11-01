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

// src-tauri/builtin-tools/src/network.js
function ipAddress(value) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) {
    const parts = raw.split(".").map(Number);
    if (parts.every((n) => n >= 0 && n <= 255)) return parts.join(".");
  }
  if (/^[\da-f:[\]]+$/i.test(raw) && raw.includes(":")) {
    try {
      const url = new URL(`https://${raw.startsWith("[") ? raw : `[${raw}]`}`);
      return url.hostname.replace(/^\[|\]$/g, "");
    } catch {
    }
  }
  throw new Error("请输入有效的 IPv4 或 IPv6 地址。");
}

// src-tauri/builtin-tools/src/ip.js
function mount({ request, copyText, signal }) {
  const op = operation(signal);
  let result = "";
  async function query() {
    const current = op.start();
    for (const id of ["query", "current"]) $(id).disabled = true;
    $("cancel").hidden = false;
    $("results").hidden = true;
    $("copy").disabled = true;
    status("正在查询 IP…");
    try {
      const ip = ipAddress($("ip").value), data = await jsonRequest(request, `https://api.live.bilibili.com/ip_service/v1/ip_service/get_ip_addr?ip=${encodeURIComponent(ip)}`, current);
      if (data.code !== 0 || !data.data?.addr) throw new Error(data.message || data.msg || "来源未返回有效的 IP 信息。");
      if (current.aborted) return;
      const values = [["IP 地址", data.data.addr], ["国家/地区或归属类别", data.data.country], ["省份", data.data.province], ["城市", data.data.city], ["运营商", data.data.isp]];
      $("info").replaceChildren();
      for (const [name, value] of values) $("info").append(text("dt", name), text("dd", value || "暂无信息"));
      result = values.map(([name, value]) => `${name}：${value || "暂无信息"}`).join("\n");
      $("results").hidden = false;
      $("copy").disabled = false;
      status("查询完成。");
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消查询。" : e.message, true);
    } finally {
      if (!signal.aborted) {
        for (const id of ["query", "current"]) $(id).disabled = false;
        $("cancel").hidden = true;
      }
    }
  }
  $("query").onclick = () => void query();
  $("current").onclick = () => {
    $("ip").value = "";
    void query();
  };
  $("cancel").onclick = () => op.cancel();
  copyButton("copy", () => result, copyText);
  return () => op.dispose();
}
export {
  mount
};
