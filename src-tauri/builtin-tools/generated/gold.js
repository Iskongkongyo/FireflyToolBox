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

// src-tauri/builtin-tools/src/network.js
function chinaDay(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// src-tauri/builtin-tools/src/price-data.js
var PRICE_SOURCES = ["https://60s.7se.cn", "https://60s.crystelf.top"];
var clean = (v, max = 120) => typeof v === "string" ? v.slice(0, max) : "";
function priceNumber(v) {
  if (v === null || v === void 0 || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e6 ? n : null;
}
function payload(v) {
  if (v?.code !== void 0 && v.code !== 200) throw new Error(clean(v.message) || "来源暂时没有提供价格数据。");
  return v?.data || v;
}
var goldWord = (v) => /黄金|金条|^\d+\s*[kK]金/.test(v) && !/[铂钯白]金|白银/.test(v);
function goldData(value) {
  const d = payload(value);
  if (!d || !Array.isArray(d.metals)) throw new Error("来源未返回有效的黄金价格。");
  const rows = [];
  function add(list, category, accept, title, price) {
    for (const v of (Array.isArray(list) ? list : []).slice(0, 100)) {
      if (!v || !accept(v)) continue;
      const n = priceNumber(price(v));
      if (n === null || v.unit !== "元/克") continue;
      rows.push({ category, name: clean(title(v), 80), price: n, unit: "元/克", product: clean(v.product, 60), purity: clean(v.purity, 40), sell: priceNumber(v.sell_price), high: priceNumber(v.high_price), low: priceNumber(v.low_price), updated: clean(v.updated) });
    }
  }
  add(d.metals, "国内参考", (v) => ["今日金价", "黄金_9999", "黄金_T+D", "黄金9999", "黄金T+D"].includes(v.name), (v) => v.name, (v) => v.today_price ?? v.price);
  add(d.stores, "品牌零售", (v) => v.product === "黄金" && !/伦敦|纽约|XAU|COMEX/.test(v.brand), (v) => v.brand, (v) => v.price);
  add(d.banks, "投资金条", (v) => goldWord(String(v.product || "")), (v) => `${v.bank} · ${v.product}`, (v) => v.price);
  add(d.recycle, "黄金回收", (v) => goldWord(String(v.type || "")), (v) => v.type, (v) => v.price);
  if (!rows.length) throw new Error("来源没有可用的黄金价格。");
  return { date: clean(d.date, 10), rows };
}
function spotGold(value) {
  if (value?.symbol !== "XAU" || value.currency && value.currency !== "USD" || priceNumber(value.price) === null || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("国际来源未返回有效的美元黄金报价。");
  return { category: "国际现货", name: "现货黄金 XAU / USD", price: priceNumber(value.price), unit: "美元 / 金衡盎司", updated: value.updatedAt };
}
function priceText(value) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function quoteDateState(date, today) {
  return !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "来源未提供日期" : date === today ? "今日数据" : `来源日期：${date}，并非今日数据`;
}

// src-tauri/builtin-tools/src/price-runtime.js
async function priceQuery(request, path, parse, signal) {
  const failures = [];
  for (const origin of PRICE_SOURCES) {
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    try {
      const r = await request(origin + path, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = parse(await r.json());
      return { data, source: origin, fetched: (/* @__PURE__ */ new Date()).toISOString() };
    } catch (e) {
      if (signal.aborted || e.name === "AbortError") throw e;
      failures.push(e.message);
    }
  }
  throw new Error(`价格来源暂时不可用，请稍后重试。${failures[0] ? "（" + failures[0].slice(0, 100) + "）" : ""}`);
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

// src-tauri/builtin-tools/src/gold.js
function mount({ request, copyText, signal }) {
  let record = null, category = "全部", copied = "";
  const job = session(signal, () => {
    $("copy").disabled = job.busy || !copied;
  });
  for (const value of ["全部", "国际现货", "国内参考", "品牌零售", "投资金条", "黄金回收"]) {
    const b = text("button", value);
    b.onclick = () => {
      category = value;
      render();
    };
    $("categories").append(b);
  }
  function render() {
    [...$("categories").children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === category)));
    if (!record) return;
    const words = $("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean), rows = [...record.spot ? [record.spot] : [], ...record.data.rows].filter((v) => (category === "全部" || v.category === category) && words.every((w) => [v.name, v.product, v.purity].join(" ").toLowerCase().includes(w)));
    $("prices").replaceChildren();
    for (const v of rows) {
      const card = text("article", "", "card gold-price-card"), h = text("h2", v.name);
      h.append(text("span", v.category, "badge"));
      card.append(h, text("strong", priceText(v.price), "gold-price-value"), text("span", v.unit, "quote-unit"));
      if (v.high || v.low) {
        const p = text("p", `${v.high ? "最高 " + priceText(v.high) : ""}${v.low ? " · 最低 " + priceText(v.low) : ""}`, "hint");
        card.append(p);
      }
      if (v.purity) card.append(text("p", "成色：" + v.purity, "hint"));
      card.append(text("p", "数据时间：" + (v.updated || "未提供"), "hint"));
      $("prices").append(card);
    }
    $("empty").hidden = !!rows.length;
    $("empty").querySelector("h2").textContent = "没有匹配的报价";
    $("published").textContent = `${quoteDateState(record.data.date, chinaDay())}${record.cached ? " · 国内报价为上次查询缓存" : ""}`;
    $("source").textContent = `国内来源：${record.source} · 国际来源：${record.spot ? "Gold API" : "暂未取得"}`;
    copied = rows.map((v) => `${v.name}：${priceText(v.price)} ${v.unit}
数据时间：${v.updated || "未提供"}`).join("\n\n");
    $("copy").disabled = job.busy || !copied;
  }
  const cached = loadState("gold.cache", null);
  if (cached?.data?.rows?.length && cached.data.rows.every((v) => typeof v.name === "string" && typeof v.price === "number")) {
    record = { ...cached, cached: true };
    render();
  }
  $("query").onclick = () => void job.run(async (current) => {
    status("正在更新黄金价格…");
    const [domestic, international] = await Promise.allSettled([priceQuery(request, "/v2/gold-price", goldData, current), (async () => {
      const r = await request("https://api.gold-api.com/price/XAU", { signal: current });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return spotGold(await r.json());
    })()]);
    if (current.aborted) return;
    if (domestic.status === "rejected") {
      if (international.status === "fulfilled") {
        record = record?.data?.rows?.length ? { ...record, spot: international.value, cached: true } : { data: { date: chinaDay(new Date(international.value.updated)), rows: [] }, source: "暂未取得", spot: international.value };
        render();
        status("国际价格已更新，国内来源暂不可用。", true);
        return;
      }
      if (record) {
        record.cached = true;
        render();
      }
      throw domestic.reason;
    }
    record = { ...domestic.value, spot: international.status === "fulfilled" ? international.value : null, cached: false };
    saveState("gold.cache", record);
    render();
    status(international.status === "fulfilled" ? "黄金价格已更新。" : "国内价格已更新，国际来源暂不可用。", international.status !== "fulfilled");
  });
  $("search").oninput = render;
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => copied, copyText);
  render();
  return () => job.dispose();
}
export {
  mount
};
