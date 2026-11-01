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
function currencyList(data) {
  if (!Array.isArray(data)) throw new Error("来源未返回有效的币种列表。");
  const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["zh-CN"], { type: "currency" }) : null;
  return data.filter((v) => /^[A-Z]{3}$/.test(v.iso_code)).slice(0, 300).map((v) => ({ code: v.iso_code, name: COMMON_CURRENCIES[v.iso_code] || names?.of(v.iso_code) || String(v.name).slice(0, 80) }));
}
function exchangeURL(from, to) {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error("币种无效。");
  return `https://api.frankfurter.dev/v2/rate/${from}/${to}`;
}
function exchangeRate(data, from, to) {
  if (data?.base !== from || data?.quote !== to || typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("来源未返回所选币种的有效汇率。");
  return { from, to, rate: data.rate, date: data.date };
}
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

// src-tauri/builtin-tools/src/exchange.js
function mount({ request, copyText, signal }) {
  let record = null, copied = "";
  const op = operation(signal), job = session(signal, () => {
    $("copy").disabled = job.busy || !copied;
  }), state = loadState("exchange.settings", {}), cache = loadState("exchange.cache", {});
  let currencies = Object.entries(COMMON_CURRENCIES).map(([code, name]) => ({ code, name }));
  function fill() {
    const from = $("from").value || state.from || "CNY", to = $("to").value || state.to || "USD";
    for (const id of ["from", "to"]) {
      $(id).replaceChildren();
      for (const c of currencies) {
        const item = text("option", `${c.code} · ${c.name}`);
        item.value = c.code;
        $(id).append(item);
      }
    }
    $("from").value = currencies.some((c) => c.code === from) ? from : "CNY";
    $("to").value = currencies.some((c) => c.code === to) ? to : "USD";
  }
  function render(cached = false) {
    copied = "";
    $("result").hidden = true;
    if (!record) return;
    try {
      const value = convertAmount($("amount").value, record.rate, Number($("precision").value));
      $("formula").textContent = `${$("amount").value} ${record.from} =`;
      $("converted").textContent = value + " " + record.to;
      $("rate").textContent = `1 ${record.from} = ${record.rate} ${record.to}`;
      $("date").textContent = record.from === record.to ? "同币种换算，无需汇率。" : `数据日期：${record.date}${cached ? " · 上次查询缓存" : ""}`;
      copied = `${$("amount").value} ${record.from} = ${value} ${record.to}
1 ${record.from} = ${record.rate} ${record.to}${record.date ? "\n汇率日期：" + record.date : ""}`;
      $("result").hidden = false;
      status("");
    } catch (e) {
      status(e.message, true);
    }
    $("copy").disabled = job.busy || !copied;
  }
  function pair() {
    saveState("exchange.settings", { from: $("from").value, to: $("to").value });
    record = $("from").value === $("to").value ? { from: $("from").value, to: $("to").value, rate: 1, date: "" } : cache[$("from").value + "-" + $("to").value] ? { ...cache[$("from").value + "-" + $("to").value], cached: true } : null;
    if (record && (record.from !== $("from").value || record.to !== $("to").value)) record = null;
    render(!!record && record.from !== record.to);
  }
  fill();
  pair();
  for (const id of ["from", "to"]) $(id).onchange = pair;
  for (const id of ["amount", "precision"]) $(id).oninput = () => render(!!record?.cached);
  $("swap").onclick = () => {
    const from = $("from").value;
    $("from").value = $("to").value;
    $("to").value = from;
    pair();
  };
  $("query").onclick = () => void job.run(async (current) => {
    convertAmount($("amount").value, 1, Number($("precision").value));
    const from = $("from").value, to = $("to").value;
    if (from === to) {
      record = { from, to, rate: 1, date: "" };
      render();
      return;
    }
    status("正在获取参考汇率…");
    const r = await request(exchangeURL(from, to), { signal: current });
    if (!r.ok) throw new Error(`汇率来源请求失败（HTTP ${r.status}），请稍后重试。`);
    const next = exchangeRate(await r.json(), from, to);
    if (current.aborted) return;
    record = next;
    cache[from + "-" + to] = next;
    const entries = Object.entries(cache);
    saveState("exchange.cache", Object.fromEntries(entries.slice(-30)));
    render();
    status("参考汇率已更新。");
  });
  $("cancel").onclick = () => job.cancel();
  copyButton("copy", () => copied, copyText);
  void (async () => {
    const current = op.start();
    try {
      const r = await request("https://api.frankfurter.dev/v2/currencies", { signal: current });
      if (!r.ok) throw new Error();
      const next = currencyList(await r.json());
      if (current.aborted) return;
      if (next.length) {
        currencies = next;
        fill();
        $("currencies-note").textContent = `来源支持 ${currencies.length} 种币种。`;
      }
    } catch (e) {
      if (!current.aborted) $("currencies-note").textContent = "币种列表暂不可用，仍可使用常见币种。";
    }
  })();
  return () => {
    op.dispose();
    job.dispose();
  };
}
export {
  mount
};
