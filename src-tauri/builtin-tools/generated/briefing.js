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
function loadState(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
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

// src-tauri/builtin-tools/src/network.js
function chinaDay(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
var briefingSources = ["https://60s-static.viki.moe/60s/", "https://cdn.jsdelivr.net/gh/vikiboss/60s-static-host@main/static/60s/", "https://raw.githubusercontent.com/vikiboss/60s-static-host/main/static/60s/"];
function briefingData(value, date) {
  if (value?.data) value = value.data;
  if (!value || !Array.isArray(value.news) || !value.news.length || value.date !== date) throw new Error("来源尚未提供所选日期的早报。");
  return { date: value.date, news: value.news.filter((x) => typeof x === "string").slice(0, 60), tip: String(value.tip ?? ""), link: String(value.link ?? ""), updated: String(value.updated ?? value.created ?? "") };
}

// src-tauri/builtin-tools/src/briefing.js
function mount({ request, copyText, saveFile, signal }) {
  const op = operation(signal);
  let data = null, cached = loadState("briefing", null);
  $("date").value = chinaDay();
  const content = () => data ? [`60秒早报 · ${data.date}`, ...data.news.map((n, i) => `${i + 1}. ${n}`), data.tip ? `每日一语：${data.tip}` : ""].filter(Boolean).join("\n\n") : "";
  function render() {
    if (!data) return;
    $("news").replaceChildren(...data.news.map((n, i) => {
      const card = text("li");
      card.append(text("span", String(i + 1), "briefing-number"), text("span", n, "briefing-text"));
      return card;
    }));
    $("tip").hidden = !data.tip;
    $("tip").textContent = data.tip;
    $("source").textContent = `60s 每日新闻 · ${data.date}${data.updated ? ` · ${data.updated}` : ""}`;
    for (const id of ["copy", "save"]) $(id).disabled = false;
    buttonLink($("link"), data.link, copyText, status);
  }
  async function fetchDate(date, current) {
    let error;
    for (const base of briefingSources) {
      try {
        return briefingData(await jsonRequest(request, base + date + ".json", current), date);
      } catch (e) {
        if (current.aborted) throw e;
        error = e;
      }
    }
    throw error;
  }
  async function load() {
    const date = $("date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      status("请选择日期。", true);
      return;
    }
    const current = op.start();
    for (const id of ["refresh", "today", "date"]) $(id).disabled = true;
    $("cancel").hidden = false;
    status("正在读取早报…");
    try {
      let fallback = false;
      try {
        data = await fetchDate(date, current);
      } catch (e) {
        if (current.aborted || date !== chinaDay()) throw e;
        const yesterday = /* @__PURE__ */ new Date(date + "T00:00:00+08:00");
        yesterday.setTime(yesterday.getTime() - 864e5);
        data = await fetchDate(chinaDay(yesterday), current);
        fallback = true;
      }
      if (current.aborted) return;
      render();
      cached = data;
      saveState("briefing", data);
      status(fallback ? `今日早报暂未更新，显示 ${data.date} 的上一期。` : "早报已更新。");
    } catch (e) {
      if (!signal.aborted) {
        if (cached?.news && cached.date === date) {
          data = cached;
          render();
        }
        status(e.name === "AbortError" ? "已取消读取。" : `暂时无法读取早报：${e.message}${data ? " 当前保留上次读取的内容。" : ""}`, true);
      }
    } finally {
      if (!signal.aborted) {
        for (const id of ["refresh", "today", "date"]) $(id).disabled = false;
        $("cancel").hidden = true;
      }
    }
  }
  $("refresh").onclick = () => void load();
  $("today").onclick = () => {
    $("date").value = chinaDay();
    void load();
  };
  $("cancel").onclick = () => op.cancel();
  copyButton("copy", content, copyText);
  $("save").onclick = async () => {
    try {
      const saved = await saveFile(`60秒早报-${data.date}.txt`, new Blob([content()], { type: "text/plain;charset=utf-8" }), { signal: op.start() });
      if (!signal.aborted) status(saved ? "早报已保存。" : "已取消保存。");
    } catch (e) {
      if (!signal.aborted) status(e.message, true);
    }
  };
  if (cached?.date === $("date").value && Array.isArray(cached.news)) {
    data = cached;
    render();
  }
  void load();
  return () => op.dispose();
}
export {
  mount
};
