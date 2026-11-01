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
var PROVINCES = ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆"];
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
function fuelData(value, province) {
  const d = payload(value);
  if (!d || typeof d.region !== "string" || !d.region.includes(province) || !Array.isArray(d.items)) throw new Error("来源未返回所选地区的油价，请稍后重试。");
  const items = d.items.slice(0, 12).filter((v) => v && priceNumber(v.price) !== null && typeof v.name === "string").map((v) => ({ name: clean(v.name, 40), price: priceNumber(v.price) }));
  if (!items.length) throw new Error("该地区暂时没有可用的油价。");
  return { region: clean(d.region, 80), items, updated: clean(d.updated), date: clean(d.updated).slice(0, 10).replaceAll("/", "-"), trend: { next: clean(d.trend?.next_adjustment_date), direction: ["上调", "下调", "搁浅"].includes(d.trend?.direction) ? d.trend.direction : "", change: clean(d.trend?.change_liter_desc) } };
}
function priceText(value) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// src-tauri/builtin-tools/src/fuel.js
function mount({ request, copyText, signal }) {
  let copied = "", shown = null;
  const job = session(signal, () => {
    $("copy").disabled = job.busy || !copied;
  }), cache = loadState("fuel.cache", {});
  for (const p of PROVINCES) {
    const option = text("option", p);
    option.value = p;
    $("province").append(option);
  }
  const last = loadState("fuel.province", "北京");
  $("province").value = PROVINCES.includes(last) ? last : "北京";
  function render(record, cached2 = false) {
    const d = record.data;
    shown = record;
    copied = `${d.region}油价
${d.items.map((v) => `${v.name}：${priceText(v.price)} 元/升`).join("\n")}
数据更新时间：${d.updated || "未提供"}
来源：${record.source}`;
    $("results").hidden = false;
    $("cached").hidden = !cached2;
    $("region").textContent = d.region;
    $("updated").textContent = `数据更新时间：${d.updated || "来源未提供"}${d.date && d.date !== chinaDay() ? " · 不是今日更新" : ""}`;
    $("prices").replaceChildren(...d.items.map((v) => {
      const item = text("div", "", "quote-price");
      item.append(text("small", v.name), text("strong", priceText(v.price)), text("span", "元/升", "hint"));
      return item;
    }));
    $("trend").hidden = !d.trend.next;
    $("trend").textContent = d.trend.next ? `来源预计下次调整：${d.trend.next}${d.trend.direction ? " · 预计" + d.trend.direction : ""}${d.trend.change ? " " + d.trend.change : ""}` : "";
    $("source").textContent = `来源：${record.source} · 汽油价格网`;
    $("copy").disabled = false;
  }
  function cached() {
    const record = cache[$("province").value];
    if (record?.data?.region && Array.isArray(record.data.items) && record.data.trend) {
      try {
        if (record.data.region.includes($("province").value)) render(record, true);
      } catch {
      }
    }
  }
  $("province").onchange = () => {
    copied = "";
    shown = null;
    $("results").hidden = true;
    $("copy").disabled = true;
    saveState("fuel.province", $("province").value);
    cached();
    status("");
  };
  $("query").onclick = () => void job.run(async (current) => {
    const province = $("province").value;
    saveState("fuel.province", province);
    status("正在查询油价…");
    let result;
    try {
      result = await priceQuery(request, "/v2/fuel-price?" + new URLSearchParams({ region: province }), (v) => fuelData(v, province), current);
    } catch (e) {
      if (shown && !current.aborted) render(shown, true);
      throw e;
    }
    ;
    if (current.aborted) return;
    cache[province] = result;
    saveState("fuel.cache", cache);
    render(result);
    status("油价已更新。");
  });
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => copied, copyText);
  cached();
  return () => {
    shown = null;
    job.dispose();
  };
}
export {
  mount
};
