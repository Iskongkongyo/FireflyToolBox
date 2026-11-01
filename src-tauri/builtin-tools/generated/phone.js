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

// src-tauri/builtin-tools/src/practical.js
var IMAGE_LIMIT = 64 * 1024 * 1024;
var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;
function phoneNumber(value) {
  const number = value.trim().replace(/[\s()-]/g, "").replace(/^(?:\+86|0086)/, "");
  if (!/^1[3-9]\d{9}$/.test(number)) throw new Error("请输入 11 位中国大陆手机号，可带 +86 或 0086 前缀。");
  return number;
}
function phoneResult(data) {
  if (data?.code !== 0 || !data.data || typeof data.data !== "object") throw new Error("查询服务暂不可用，请稍后重试。");
  const value = (key) => typeof data.data[key] === "string" ? data.data[key].trim() : "";
  const province = value("province"), city = value("city"), carrier = value("sp");
  if (!province && !city && !carrier) throw new Error("未找到该号码段的归属信息，可能是新号段或服务数据尚未更新。");
  return { province, city, carrier };
}

// src-tauri/builtin-tools/src/phone.js
function mount({ request, copyText, signal }) {
  const op = operation(signal);
  let result = "";
  const invalidate = () => {
    result = "";
    $("results").hidden = true;
    $("copy").disabled = true;
    status("");
  };
  async function query() {
    let number;
    try {
      number = phoneNumber($("phone").value);
    } catch (e) {
      invalidate();
      status(e.message, true);
      return;
    }
    const current = op.start();
    invalidate();
    $("query").disabled = true;
    $("phone").disabled = true;
    $("cancel").hidden = false;
    status("正在查询…");
    try {
      const data = phoneResult(await jsonRequest(request, `https://cx.shouji.360.cn/phonearea.php?number=${number}`, current));
      if (current.aborted) return;
      const values = [["手机号", number], ["省份 / 地区", data.province || "暂无信息"], ["城市", data.city || "暂无信息"], ["号码段运营商", data.carrier || "暂无信息"]];
      $("info").replaceChildren();
      for (const [name, value] of values) $("info").append(text("dt", name), text("dd", value));
      result = values.map(([name, value]) => `${name}：${value}`).join("\n");
      $("results").hidden = false;
      $("copy").disabled = false;
      status("查询完成。");
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消查询。" : e.message || "查询失败，请稍后重试。", e.name !== "AbortError");
    } finally {
      if (!signal.aborted) {
        $("query").disabled = false;
        $("phone").disabled = false;
        $("cancel").hidden = true;
      }
    }
  }
  $("query").onclick = () => void query();
  $("phone").oninput = invalidate;
  $("phone").onkeydown = (e) => {
    if (e.key === "Enter" && !$("query").disabled) void query();
  };
  $("cancel").onclick = () => op.cancel();
  copyButton("copy", () => result, copyText);
  return () => op.dispose();
}
export {
  mount
};
