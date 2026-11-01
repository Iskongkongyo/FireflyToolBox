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

// src-tauri/builtin-tools/src/exchange-data.js
var COMMON_CURRENCIES = { CNY: "人民币", USD: "美元", EUR: "欧元", JPY: "日元", HKD: "港币", TWD: "新台币", GBP: "英镑", AUD: "澳大利亚元", CAD: "加拿大元", SGD: "新加坡元", KRW: "韩元", CHF: "瑞士法郎", NZD: "新西兰元", THB: "泰铢", MYR: "马来西亚林吉特", INR: "印度卢比", IDR: "印尼卢比", VND: "越南盾", PHP: "菲律宾比索", AED: "阿联酋迪拉姆", SAR: "沙特里亚尔", TRY: "土耳其里拉", BRL: "巴西雷亚尔", MXN: "墨西哥比索", ZAR: "南非兰特", SEK: "瑞典克朗", NOK: "挪威克朗", DKK: "丹麦克朗", PLN: "波兰兹罗提", CZK: "捷克克朗", HUF: "匈牙利福林", ILS: "以色列新谢克尔", RUB: "俄罗斯卢布" };
function decimalParts(value) {
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error("数值无效。");
  const digits = match[1] + (match[2] || ""), scale = (match[2] || "").length - Number(match[3] || 0);
  return { n: BigInt(digits) * 10n ** BigInt(Math.max(0, -scale)), scale: Math.max(0, scale) };
}
function convertAmount(amount, rate, precision = 2) {
  const text2 = String(amount).trim();
  if (!/^\d{1,15}(?:\.\d{1,8})?$/.test(text2)) throw new Error("请输入非负金额，最多 15 位整数和 8 位小数。");
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error("汇率或显示精度无效。");
  const a = decimalParts(text2), r = decimalParts(rate), scale = a.scale + r.scale, total = a.n * r.n;
  let rounded;
  if (scale <= precision) rounded = total * 10n ** BigInt(precision - scale);
  else {
    const divisor = 10n ** BigInt(scale - precision);
    rounded = (total + divisor / 2n) / divisor;
  }
  const value = rounded.toString().padStart(precision + 1, "0");
  return precision ? value.slice(0, -precision) + "." + value.slice(-precision) : value;
}

// src-tauri/builtin-tools/src/daily-rates-data.js
var DAILY_RATES_URL = "https://api.frankfurter.dev/v2/rates?base=CNY";
function cnyRates(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error("来源未返回有效的人民币汇率列表。");
  const rates = /* @__PURE__ */ new Map();
  for (const row of value) {
    if (row?.base !== "CNY") throw new Error("来源返回的基准币种不是人民币，已停止展示。");
    if (!/^[A-Z]{3}$/.test(row.quote) || row.quote === "CNY" || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0 || !Number.isFinite(1 / row.rate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const previous = rates.get(row.quote);
    if (!previous || previous.date < row.date) rates.set(row.quote, { code: row.quote, rate: row.rate, date: row.date });
  }
  if (!rates.size) throw new Error("来源没有可用的外币参考汇率。");
  return [...rates.values()].sort((a, b) => a.code.localeCompare(b.code));
}
var display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["zh-CN"], { type: "currency" }) : null;
function currencyName(code) {
  try {
    return COMMON_CURRENCIES[code] || display?.of(code) || code;
  } catch {
    return code;
  }
}
function rateFigures(row) {
  return { outward: row.rate.toLocaleString("zh-CN", { maximumFractionDigits: 8 }), inward: convertAmount("100", 1 / row.rate, 2) };
}
function filterCnyRates(rows, query, scope = "common") {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => (scope !== "common" || row.code in COMMON_CURRENCIES) && words.every((word) => (row.code + " " + currencyName(row.code)).toLowerCase().includes(word)));
}
function dailyRatesText(rows) {
  return rows.map((row) => {
    const figures = rateFigures(row);
    return `${currencyName(row.code)}（${row.code}）
1 元人民币 ≈ ${figures.outward} ${row.code}
100 ${row.code} ≈ ${figures.inward} 元人民币
数据日期：${row.date}`;
  }).join("\n\n");
}

// src-tauri/builtin-tools/src/daily-rates.js
function mount({ request, copyText, signal }) {
  let rows = [], copied = "", cached = false;
  const job = session(signal, () => {
    $("copy").disabled = job.busy || !copied;
  });
  const cache = loadState("daily-rates.cache", null);
  if (cache?.rows) {
    try {
      rows = cnyRates(cache.rows.map((r) => ({ base: "CNY", quote: r.code, rate: r.rate, date: r.date })));
      cached = true;
    } catch {
    }
  }
  function render() {
    const shown = filterCnyRates(rows, $("search").value, $("scope").value);
    $("rates").replaceChildren();
    for (const row of shown) {
      const figures = rateFigures(row), card = text("article", "", "card daily-rate-card"), heading = text("h2", currencyName(row.code));
      heading.append(text("span", row.code, "badge"));
      const forward = text("div", "", "daily-rate-forward");
      forward.append(text("small", "1 元人民币可兑换"), text("strong", figures.outward + " " + row.code));
      const inverse = text("p", `100 ${row.code} ≈ ${figures.inward} 元人民币`, "daily-rate-inverse"), copy = text("button", "复制此币种", "mobile-full-row");
      copy.onclick = async () => {
        try {
          await copyText(dailyRatesText([row]));
          if (!signal.aborted) status("已复制" + currencyName(row.code) + "参考汇率。");
        } catch (e) {
          if (!signal.aborted) status(e.message, true);
        }
      };
      card.append(heading, forward, inverse, text("p", "数据日期：" + row.date, "hint"), copy);
      $("rates").append(card);
    }
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    $("published").textContent = dates.length ? `人民币基准 · 来源日期 ${dates[0]}${dates.length > 1 ? " ～ " + dates.at(-1) : ""}${cached ? " · 上次查询缓存" : ""}` : "";
    $("count").textContent = rows.length ? `显示 ${shown.length} / ${rows.length} 个币种` : "";
    $("empty").hidden = !!shown.length;
    $("empty-title").textContent = rows.length ? "没有找到匹配的币种" : "暂未取得汇率，点击更新后重试";
    copied = dailyRatesText(shown);
    $("copy").disabled = job.busy || !copied;
  }
  $("refresh").onclick = () => void job.run(async (current) => {
    status("正在获取人民币参考汇率…");
    if (!rows.length) $("empty-title").textContent = "正在获取人民币参考汇率…";
    try {
      const response = await request(DAILY_RATES_URL, { signal: current });
      if (!response.ok) throw new Error(`汇率来源请求失败（HTTP ${response.status}），请稍后重试。`);
      const next = cnyRates(await response.json());
      if (current.aborted) return;
      rows = next;
      cached = false;
      saveState("daily-rates.cache", { rows, fetched: (/* @__PURE__ */ new Date()).toISOString() });
      render();
      status("人民币参考汇率已更新。");
    } catch (e) {
      if (current.aborted) throw e;
      cached = !!rows.length;
      render();
      throw e;
    }
  });
  $("search").oninput = render;
  $("scope").onchange = render;
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => copied, copyText);
  render();
  $("refresh").click();
  return () => job.dispose();
}
export {
  mount
};
