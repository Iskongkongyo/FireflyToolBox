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

// src-tauri/builtin-tools/src/network.js
function domainName(value) {
  let raw = value.trim();
  if (!raw) throw new Error("请输入注册域名，如 example.com。");
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("域名格式无效。");
  }
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || url.port) throw new Error("请输入不含账号和端口的域名。");
  const name = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (name.length > 253 || name.split(".").length < 2 || !/[a-z]/.test(name.split(".").at(-1)) || name.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("请输入有效的注册域名，如 example.com。");
  return name;
}
function rdapSummary(data) {
  if (!data || data.objectClassName !== "domain") throw new Error("来源未返回有效的域名注册信息。");
  const entities = [];
  function walk(list, depth = 0) {
    if (depth > 4) return;
    for (const e of (list ?? []).slice(0, 100)) {
      const fields = e.vcardArray?.[1] ?? [], name = fields.find((x) => x[0] === "fn")?.[3] ?? e.handle ?? "", organization = fields.find((x) => x[0] === "org")?.[3] ?? "";
      entities.push({ roles: e.roles ?? [], name: String(name), organization: Array.isArray(organization) ? organization.join(" ") : String(organization), handle: e.handle ?? "" });
      walk(e.entities, depth + 1);
    }
  }
  walk(data.entities);
  return { domain: data.unicodeName ?? data.ldhName ?? "", handle: data.handle ?? "", status: data.status ?? [], events: (data.events ?? []).map((e) => ({ action: e.eventAction, date: e.eventDate })), nameservers: (data.nameservers ?? []).map((n) => n.unicodeName ?? n.ldhName ?? "").filter(Boolean), entities, notices: [...data.notices ?? [], ...data.remarks ?? []].flatMap((n) => n.description ?? []).slice(0, 20) };
}

// src-tauri/builtin-tools/src/whois.js
function mount({ request, copyText, signal }) {
  const op = operation(signal);
  let raw = "";
  $("query").onclick = async () => {
    const current = op.start();
    $("query").disabled = true;
    $("cancel").hidden = false;
    $("results").hidden = true;
    $("copy").disabled = true;
    status("正在查询注册信息…");
    try {
      const domain = domainName($("domain").value), response = await request(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: current });
      if (!response.ok) throw new Error(response.status === 404 ? "未查询到该域名的注册信息，请核对注册域名或后缀是否支持 RDAP。" : `注册信息服务返回 HTTP ${response.status}，请稍后重试。`);
      const data = await response.json(), info = rdapSummary(data);
      if (current.aborted) return;
      raw = JSON.stringify(data, null, 2);
      $("info").replaceChildren();
      const add = (name, value) => $("info").append(text("dt", name), text("dd", value || "未公开"));
      add("域名", info.domain);
      add("注册记录 ID", info.handle);
      const registrar = info.entities.find((e) => e.roles.includes("registrar"));
      add("注册商", registrar?.name);
      const owner = info.entities.find((e) => e.roles.includes("registrant"));
      if (owner) add("注册人/机构", [owner.name, owner.organization].filter(Boolean).join(" · "));
      add("状态", info.status.join("\n"));
      for (const event of info.events) add({ registration: "注册时间", expiration: "到期时间", "last changed": "修改时间", "last update of RDAP database": "记录更新时间" }[event.action] ?? event.action, event.date);
      add("域名服务器", info.nameservers.join("\n"));
      $("source").textContent = `数据来源：${new URL(response.url).host}`;
      $("raw").textContent = raw;
      $("results").hidden = false;
      $("copy").disabled = false;
      status("查询完成。");
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消查询。" : e.message, true);
    } finally {
      if (!signal.aborted) {
        $("query").disabled = false;
        $("cancel").hidden = true;
      }
    }
  };
  $("cancel").onclick = () => op.cancel();
  copyButton("copy", () => raw, copyText);
  return () => op.dispose();
}
export {
  mount
};
