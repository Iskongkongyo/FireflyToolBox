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

// src-tauri/builtin-tools/src/quick-network-data.js
function webAddress(value, httpsOnly = false) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("请输入完整的网页地址。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.href.length > 4096 || httpsOnly && url.protocol !== "https:") throw new Error(httpsOnly ? "请输入不含账号信息的完整 HTTPS 地址。" : "仅支持不含账号信息的 HTTP / HTTPS 地址。");
  return url;
}
function providerURL(provider, action, value) {
  if (!["is.gd", "v.gd"].includes(provider)) throw new Error("短链来源无效。");
  const url = "https://" + provider + "/" + (action === "create" ? "create.php" : "forward.php") + "?" + new URLSearchParams({ format: "json", [action === "create" ? "url" : "shorturl"]: value });
  if (url.length > 4096) throw new Error("生成请求超过 4096 字符，请缩短原地址。");
  return url;
}
function shortResult(data, create) {
  if (data?.errorcode) {
    const descriptions = { 1: "地址无效或链接不存在", 2: "链接不可用或已被停用", 3: "请求频率过高，请等待一分钟后再试", 4: "短链服务暂时不可用" };
    throw Object.assign(new Error((descriptions[data.errorcode] || "短链服务返回错误") + (data.errormessage ? "：" + String(data.errormessage).slice(0, 180) : "")), { limited: Number(data.errorcode) === 3 });
  }
  return webAddress(create ? data?.shorturl : data?.url).href;
}

// src-tauri/builtin-tools/src/shortlink-data.js
var SHORT_PROVIDERS = ["spoo.me", "ulvis.net", "suo.yt", "is.gd", "v.gd"];
function shortRequest(provider, value, create = true, shortKey = "") {
  if (!SHORT_PROVIDERS.includes(provider)) throw new Error("短链来源无效。");
  const target = webAddress(value, !create);
  if (["is.gd", "v.gd"].includes(provider)) return { method: "GET", url: providerURL(provider, create ? "create" : "lookup", target.href) };
  if (provider === "spoo.me") {
    if (!create) throw new Error("spoo.me 使用服务器跳转还原。");
    return { method: "POST", url: "https://spoo.me/api/v1/shorten", body: JSON.stringify({ long_url: target.href }) };
  }
  if (provider === "suo.yt") {
    if (!create) throw new Error("suo.yt 使用服务器跳转还原。");
    const key = String(shortKey).trim();
    if (key.length > 128 || /[\x00-\x1f\x7f\\/?#]/.test(key)) throw new Error("自定义短码最多 128 字符，且不能包含 /、?、# 或控制字符。");
    const encoded = btoa(Array.from(new TextEncoder().encode(target.href), (byte) => String.fromCharCode(byte)).join(""));
    const body = new URLSearchParams({ longUrl: encoded, shortKey: key }).toString();
    if (body.length > 16384) throw new Error("生成请求过长，请缩短原链接。");
    return { method: "POST", url: "https://suo.yt/short", body };
  }
  let params;
  if (create) params = new URLSearchParams({ url: target.href, type: "json", private: "1" });
  else {
    if (target.hostname !== "ulvis.net" || !/^\/[a-z0-9_-]{1,128}$/i.test(target.pathname)) throw new Error("请填写完整的 ulvis.net 短链接。");
    params = new URLSearchParams({ id: target.pathname.slice(1), type: "json" });
  }
  const url = `https://ulvis.net/API/${create ? "write" : "read"}/get?${params}`;
  if (url.length > 4096) throw new Error("生成请求超过 4096 字符，请缩短原地址。");
  return { method: "GET", url };
}
function detail(data) {
  const error = data?.error;
  return String(typeof error === "string" ? error : error?.message || error?.msg || data?.Message || data?.Msg || data?.message || data?.detail || "").slice(0, 180);
}
function providerResult(provider, data, create = true, status2 = 200) {
  if (status2 === 429) throw Object.assign(new Error("请求频率过高，请等待一分钟后再试。"), { limited: true });
  if (status2 >= 400) throw new Error(`${provider} 请求失败（HTTP ${status2}）${detail(data) ? "：" + detail(data) : "，请稍后重试。"}`);
  let value;
  if (["is.gd", "v.gd"].includes(provider)) value = shortResult(data, create);
  else if (provider === "spoo.me") {
    if (!data?.short_url) throw new Error(detail(data) || "spoo.me 未返回有效短链接，请稍后重试。");
    value = data.short_url;
  } else if (provider === "suo.yt") {
    if (!create) throw new Error("suo.yt 使用服务器跳转还原。");
    if (Number(data?.Code) !== 1) throw new Error("suo.yt 生成失败" + (detail(data) ? "：" + detail(data) : "，请检查地址或自定义短码。"));
    if (typeof data.ShortUrl !== "string" || !data.ShortUrl.trim()) throw new Error("suo.yt 未返回有效短链接，请稍后重试。");
    value = data.ShortUrl;
  } else if (provider === "ulvis.net") {
    if (![true, 1, "1"].includes(data?.success)) {
      const reason = detail(data);
      throw new Error(reason.toLowerCase().includes("domain not allowed") ? "ulvis.net 不接受这个域名，请换一个地址或生成服务。" : `ulvis.net ${create ? "生成" : "查询"}失败${reason ? "：" + reason : "，请稍后重试。"}`);
    }
    value = create ? data?.data?.url : data?.data?.full;
  } else throw new Error("短链来源无效。");
  const url = webAddress(value, create);
  if (create && (url.origin !== "https://" + provider || url.pathname === "/")) throw new Error("生成服务返回了非预期短链，已停止展示。");
  return url.href;
}
async function postRequest(provider, url, contentType, body, signal, fetcher, timeoutMs) {
  if (typeof body !== "string" || new TextEncoder().encode(body).length > 16384) throw new Error("短链接提交内容无效或过长。");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetcher(url, { method: "POST", headers: { "Content-Type": contentType, Accept: "application/json" }, body, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    const max = 256 * 1024;
    if (Number(response.headers.get("content-length")) > max) {
      controller.abort();
      throw new Error(provider + " 响应过大，请稍后重试。");
    }
    const reader = response.body?.getReader();
    let source = "";
    if (reader) {
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > max) {
            controller.abort();
            throw new Error(provider + " 响应过大，请稍后重试。");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        source = new TextDecoder().decode(bytes);
      } finally {
        reader.releaseLock();
      }
    }
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      if (response.status === 429) data = {};
      else throw new Error(`${provider} 未返回有效 JSON（HTTP ${response.status}），请稍后重试。`);
    }
    return { data, status: response.status };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (timedOut) throw new Error(provider + " 请求超过 15 秒，请稍后重试。");
    if (error instanceof TypeError) throw new Error("无法连接 " + provider + "，请检查网络或稍后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
var spooRequest = (body, signal, fetcher = fetch, timeoutMs = 15e3) => postRequest("spoo.me", "https://spoo.me/api/v1/shorten", "application/json", body, signal, fetcher, timeoutMs);
var suoRequest = (body, signal, fetcher = fetch, timeoutMs = 15e3) => postRequest("suo.yt", "https://suo.yt/short", "application/x-www-form-urlencoded;charset=UTF-8", body, signal, fetcher, timeoutMs);

// src-tauri/builtin-tools/src/shortlink.js
function mount({ request, resolveLink, copyText, signal }) {
  let result = "";
  const cooldowns = /* @__PURE__ */ new Map(), job = session(signal, () => {
    $("copy").disabled = job.busy || !result;
  });
  function invalidate() {
    result = "";
    $("output").value = "";
    $("details").textContent = "";
    $("hops-box").hidden = true;
    $("copy").disabled = true;
    status("");
  }
  function settings() {
    invalidate();
    const create = $("action").value === "create";
    $("provider-label").hidden = !create;
    $("short-key-label").hidden = !create || $("provider").value !== "suo.yt";
    $("run").textContent = create ? "生成短链" : "还原地址";
  }
  for (const id of ["url", "action", "provider", "short-key"]) $(id).oninput = settings;
  async function api(provider, value, create, current) {
    const cooldown = cooldowns.get(provider) || 0;
    if (Date.now() < cooldown) throw new Error(`${provider} 服务限流，请等待 ${Math.ceil((cooldown - Date.now()) / 1e3)} 秒再试。`);
    const spec = shortRequest(provider, value, create, provider === "suo.yt" ? $("short-key").value : "");
    let data, httpStatus;
    if (spec.method === "POST") {
      const response = await (provider === "suo.yt" ? suoRequest : spooRequest)(spec.body, current);
      data = response.data;
      httpStatus = response.status;
    } else {
      const response = await request(spec.url, { signal: current });
      httpStatus = response.status;
      try {
        data = await response.json();
      } catch {
        throw new Error(`${provider} 未返回有效 JSON（HTTP ${httpStatus}），请稍后重试。`);
      }
    }
    try {
      return providerResult(provider, data, create, httpStatus);
    } catch (error) {
      if (error.limited) cooldowns.set(provider, Date.now() + 6e4);
      throw error;
    }
  }
  $("run").onclick = () => void job.run(async (current) => {
    invalidate();
    const create = $("action").value === "create", url = webAddress($("url").value, !create);
    status(create ? "正在生成短链…" : "正在还原地址…");
    let next, description = "";
    if (create) {
      const provider = $("provider").value;
      next = await api(provider, url.href, true, current);
      description = `生成服务：${provider}`;
    } else if (["is.gd", "v.gd", "ulvis.net"].includes(url.hostname)) {
      next = await api(url.hostname, url.href, false, current);
      description = "使用短链服务官方查询，没有访问目标网页。";
    } else {
      const data = await resolveLink(url.href, { signal: current });
      next = webAddress(data.url).href;
      description = data.http_stopped ? "解析到 HTTP 地址，尚未继续访问后续跳转。" : data.hops?.length > 1 ? `已解析 ${data.hops.length - 1} 次跳转，目标返回 HTTP ${data.status}。` : "未检测到服务器重定向，可能已是原地址或需要网页脚本跳转。";
      $("hops").replaceChildren(...(data.hops || []).map((v) => text("li", v)));
      $("hops-box").hidden = false;
    }
    if (current.aborted) return;
    result = next;
    $("output").value = next;
    $("details").textContent = description;
    status(create ? "短链接已生成。" : "地址已解析。");
  });
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => result, copyText);
  return () => job.dispose();
}
export {
  mount
};
