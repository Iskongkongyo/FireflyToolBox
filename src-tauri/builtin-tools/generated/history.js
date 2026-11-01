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
function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
function plainHTML(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");
  template.content.querySelectorAll("script,style").forEach((node) => node.remove());
  return template.content.textContent.trim();
}
async function jsonRequest(request, url, signal) {
  const response = await request(url, { signal });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请稍后重试。`);
  try {
    return await response.json();
  } catch {
    throw new Error("来源返回了无法解析的数据，请稍后重试。");
  }
}
function buttonLink(node, url, copyText, status2) {
  const link = safeLink(url);
  node.disabled = !link;
  node.onclick = async () => {
    try {
      await copyText(link);
      status2("链接已复制，可在浏览器中打开。");
    } catch (e) {
      status2(e.message, true);
    }
  };
}

// src-tauri/builtin-tools/src/history.js
function mount({ request, copyText, signal }) {
  const op = operation(signal);
  let rows = [], cache = /* @__PURE__ */ new Map();
  const localDate = () => {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  $("date").value = localDate();
  function render() {
    $("events").replaceChildren();
    const query = $("filter").value.trim().toLowerCase(), filtered = rows.filter((x) => `${x.year} ${x.title} ${x.desc}`.toLowerCase().includes(query));
    for (const item of filtered) {
      const card = text("article", "", "feed-item"), copy = text("button", "复制资料链接", "mobile-full-row");
      buttonLink(copy, item.link, copyText, status);
      card.append(text("span", `${item.year} 年`, "year-label"), text("h2", item.title), text("p", item.desc, "hint"), copy);
      $("events").append(card);
    }
    if (!filtered.length) $("events").append(text("p", rows.length ? "没有匹配的事件。" : "这一天暂未收录事件。", "hint"));
  }
  async function load(refresh = false) {
    const parts = $("date").value.split("-");
    if (parts.length !== 3) {
      status("请选择有效日期。", true);
      return;
    }
    const month = parts[1], day = parts[2], date = `${month}-${day}`, current = op.start();
    $("refresh").disabled = true;
    $("today").disabled = true;
    $("date").disabled = true;
    $("cancel").hidden = false;
    rows = [];
    $("events").replaceChildren();
    status("正在读取历史事件…");
    try {
      let payload = cache.get(month);
      if (!payload || refresh) {
        payload = await jsonRequest(request, `https://baike.baidu.com/cms/home/eventsOnHistory/${month}.json`, current);
        cache.set(month, payload);
        if (cache.size > 3) cache.delete(cache.keys().next().value);
      }
      if (current.aborted) return;
      const data = payload?.[month]?.[month + day];
      if (!Array.isArray(data)) throw new Error("来源未提供这一天的数据。");
      rows = data.slice(0, 150).map((x) => ({ year: String(x.year ?? ""), title: plainHTML(x.title).slice(0, 500), desc: plainHTML(x.desc).slice(0, 1500), link: x.link }));
      render();
      $("source").textContent = `来源：百度百科 · ${date} · ${rows.length} 条事件`;
      status("已读取。");
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消查询。" : e.message, true);
    } finally {
      if (!signal.aborted) {
        $("refresh").disabled = false;
        $("today").disabled = false;
        $("date").disabled = false;
        $("cancel").hidden = true;
      }
    }
  }
  $("refresh").onclick = () => void load(true);
  $("today").onclick = () => {
    $("date").value = localDate();
    void load();
  };
  $("filter").oninput = render;
  $("cancel").onclick = () => op.cancel();
  void load();
  return () => op.dispose();
}
export {
  mount
};
