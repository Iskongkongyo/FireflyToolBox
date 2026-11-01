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

// src-tauri/builtin-tools/src/trending-data.js
var providers = [
  { id: "baidu", name: "百度", url: "https://top.baidu.com/api/board?platform=pc&tab=realtime", home: "https://top.baidu.com/board?tab=realtime", metric: "热度" },
  { id: "weibo", name: "微博", url: "https://weibo.com/ajax/side/hotSearch", home: "https://s.weibo.com/top/summary?cate=realtimehot", metric: "热度" },
  { id: "douyin", name: "抖音", url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", home: "https://www.douyin.com/hot", metric: "热度" },
  { id: "toutiao", name: "头条", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", home: "https://www.toutiao.com/", metric: "热度" },
  { id: "zhihu", name: "知乎", url: "https://api.zhihu.com/topstory/hot-lists/total?limit=50", home: "https://www.zhihu.com/hot", metric: "热度" },
  { id: "bilibili", name: "B站", url: "https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1", home: "https://www.bilibili.com/v/popular/all", metric: "播放" },
  { id: "tieba", name: "贴吧", url: "https://tieba.baidu.com/hottopic/browse/topicList", home: "https://tieba.baidu.com/hottopic/browse/hottopic", metric: "讨论" }
];
function parseTrending(id, payload) {
  let rows = [];
  switch (id) {
    case "baidu":
      rows = payload.data?.cards?.[0]?.content ?? [];
      if (rows[0]?.content) rows = rows[0].content;
      rows = rows.map((x) => ({ title: x.word ?? x.query ?? x.title, hot: x.hotScore, url: x.url ?? x.appUrl }));
      break;
    case "weibo":
      rows = (payload.data?.realtime ?? []).filter((x) => !x.is_ad).map((x) => ({ title: x.word ?? x.note, hot: x.num, url: `https://s.weibo.com/weibo?q=${encodeURIComponent(x.word ?? x.note ?? "")}` }));
      break;
    case "douyin":
      rows = (payload.word_list ?? []).map((x) => ({ title: x.word, hot: x.hot_value, url: `https://www.douyin.com/search/${encodeURIComponent(x.word)}` }));
      break;
    case "toutiao":
      rows = (payload.data ?? []).map((x) => ({ title: x.Title, hot: x.HotValue, url: x.Url ?? `https://www.toutiao.com/trending/${x.ClusterIdStr ?? x.ClusterId}/` }));
      break;
    case "zhihu":
      rows = (payload.data ?? []).map((x) => ({ title: x.target?.title, hot: x.detail_text, url: `https://www.zhihu.com/question/${x.target?.url?.match(/questions\/(\d+)/)?.[1] ?? x.target?.id ?? ""}` }));
      break;
    case "bilibili":
      rows = (payload.data?.list ?? []).map((x) => ({ title: x.title, hot: x.stat?.view, url: `https://www.bilibili.com/video/${x.bvid ?? ""}` }));
      break;
    case "tieba":
      rows = (payload.data?.bang_topic?.topic_list ?? []).map((x) => ({ title: x.topic_name, hot: x.discuss_num, url: x.topic_url }));
      break;
  }
  const result = rows.filter((x) => typeof x.title === "string" && x.title.trim()).slice(0, 50).map((x, i) => ({ rank: i + 1, title: x.title.slice(0, 300), hot: String(x.hot ?? ""), url: safeLink(x.url) }));
  if (!result.length) throw new Error("来源暂未返回可用榜单，可能需要登录或正在限流。");
  return result;
}
function hotValue(value) {
  const number = Number(value);
  return !Number.isFinite(number) || value === "" ? value : number >= 1e8 ? `${(number / 1e8).toFixed(1)} 亿` : number >= 1e4 ? `${(number / 1e4).toFixed(1)} 万` : String(number);
}

// src-tauri/builtin-tools/src/trending.js
function mount({ request, copyText, signal }) {
  const op = operation(signal), cache = /* @__PURE__ */ new Map();
  let active = providers.find((x) => x.id === loadState("platform", "baidu")) ?? providers[0], busy = false;
  const last = loadState("last-board", null);
  if (last && providers.some((x) => x.id === last.id) && Array.isArray(last.rows) && Number.isFinite(last.time)) cache.set(last.id, last);
  function render() {
    $("list").replaceChildren();
    const board = cache.get(active.id), query = $("filter").value.trim().toLowerCase();
    $("source").textContent = `${active.name} · 平台公开接口${board ? ` · 获取于 ${new Date(board.time).toLocaleString()}` : ""}`;
    if (!board) return;
    const rows = board.rows.filter((x) => x.title.toLowerCase().includes(query));
    for (const row of rows) {
      const item = text("article", "", "trend-item"), content = text("div", "", "trend-content"), copy = text("button", "复制链接", "mobile-full-row");
      buttonLink(copy, row.url, copyText, status);
      content.append(text("strong", row.title), text("p", row.hot ? `${hotValue(row.hot)} ${active.metric}` : "", "hint"));
      item.append(text("span", String(row.rank), "trend-rank"), content, copy);
      $("list").append(item);
    }
    if (!rows.length) $("list").append(text("p", "没有匹配的热点。", "hint"));
  }
  function controls() {
    document.querySelectorAll("[data-platform]").forEach((x) => {
      x.disabled = busy;
      x.classList.toggle("selected", x.dataset.platform === active.id);
    });
    $("refresh").disabled = busy;
    $("cancel").hidden = !busy;
    buttonLink($("home"), active.home, copyText, status);
  }
  async function load(force = false) {
    if (busy) return;
    render();
    const board = cache.get(active.id);
    if (!force && board && Date.now() - board.time < 3e5 && Date.now() >= board.time) {
      status("已显示最近获取的榜单。");
      return;
    }
    busy = true;
    controls();
    const current = op.start(), provider = active;
    status("正在读取榜单…");
    try {
      const payload = await jsonRequest(request, provider.url, current);
      if (current.aborted) return;
      const rows = parseTrending(provider.id, payload), fresh = { id: provider.id, time: Date.now(), rows };
      cache.set(provider.id, fresh);
      saveState("platform", provider.id);
      const compact = { ...fresh, rows: rows.slice(0, 25) };
      if (new TextEncoder().encode(JSON.stringify(compact)).length < 45e3) saveState("last-board", compact);
      render();
      status(`已更新 ${rows.length} 条热点。`);
    } catch (e) {
      if (!signal.aborted) {
        render();
        status(e.name === "AbortError" ? "已取消刷新。" : `${provider.name}暂时无法读取：${e.message}${cache.has(provider.id) ? " 当前显示上次获取的数据。" : " 可复制平台热榜链接，在浏览器中查看。"}`, true);
      }
    } finally {
      busy = false;
      if (!signal.aborted) controls();
    }
  }
  for (const provider of providers) {
    const button = text("button", provider.name);
    button.dataset.platform = provider.id;
    button.onclick = () => {
      if (busy) return;
      active = provider;
      $("filter").value = "";
      saveState("platform", provider.id);
      controls();
      void load();
    };
    $("platforms").append(button);
  }
  $("refresh").onclick = () => void load(true);
  $("cancel").onclick = () => op.cancel();
  $("filter").oninput = render;
  controls();
  void load();
  return () => op.dispose();
}
export {
  mount
};
