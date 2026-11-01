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
async function jsonRequest(request, url, signal) {
  const response = await request(url, { signal });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请稍后重试。`);
  try {
    return await response.json();
  } catch {
    throw new Error("来源返回了无法解析的数据，请稍后重试。");
  }
}

// src-tauri/builtin-tools/src/bing.js
var bingMarkets = { "zh-CN": { name: "中国", country: "CN", origin: "https://cn.bing.com" }, "en-US": { name: "美国", country: "US", origin: "https://www.bing.com" }, "ja-JP": { name: "日本", country: "JP", origin: "https://www.bing.com" } };
function bingArchiveURL(market) {
  const settings = bingMarkets[market];
  if (!settings) throw new Error("请选择有效地区。");
  const url = new URL("/HPImageArchive.aspx", settings.origin);
  url.search = new URLSearchParams({ format: "js", idx: "0", n: "8", mkt: market, setmkt: market, cc: settings.country, setlang: market, ...market === "en-US" ? { ensearch: "1" } : {} }).toString();
  return url.href;
}
function bingImages(payload, market) {
  if (!bingMarkets[market]) throw new Error("请选择有效地区。");
  if (!Array.isArray(payload?.images) || !payload.images.length) throw new Error("来源暂时没有返回壁纸。");
  const images = payload.images.slice(0, 8);
  for (const image of images) {
    bingURL(image);
    const region = /_([a-z]{2}-[a-z]{2})\d+(?:&|$)/i.exec(image.urlbase)?.[1];
    if (region && region.toLowerCase() !== market.toLowerCase()) throw new Error(`来源未返回${bingMarkets[market].name}地区的壁纸，请稍后刷新。`);
  }
  return images;
}
function bingURL(image, resolution = "1920x1080") {
  const url = new URL(`${image.urlbase}_${resolution}.jpg`, "https://www.bing.com");
  if (url.origin !== "https://www.bing.com" || url.pathname !== "/th") throw new Error("来源返回了无效的壁纸地址。");
  return url.href;
}
function mount({ request, saveFile, copyText, signal }) {
  const op = operation(signal);
  let selected, items = [], busy = false;
  const market = loadState("market", "zh-CN");
  if (["zh-CN", "en-US", "ja-JP"].includes(market)) $("market").value = market;
  function select(image) {
    if (busy) return;
    selected = image;
    const preview = $("preview");
    preview.hidden = false;
    preview.src = bingURL(image);
    preview.alt = image.title || "必应每日壁纸";
    $("title").textContent = image.title || image.startdate;
    $("copyright").textContent = `${image.enddate ?? image.startdate} · ${image.copyright ?? ""}`;
    $("save").disabled = false;
    $("copy").disabled = false;
    document.querySelectorAll("[data-wallpaper]").forEach((x) => x.classList.toggle("selected", x.dataset.wallpaper === image.startdate));
  }
  $("preview").onerror = () => status("图片暂时无法加载，可重试刷新或复制图片链接。", true);
  async function load() {
    if (busy) return;
    busy = true;
    const current = op.start(), market2 = $("market").value;
    selected = null;
    items = [];
    $("gallery").replaceChildren();
    $("preview").hidden = true;
    $("preview").removeAttribute("src");
    $("title").textContent = "";
    $("copyright").textContent = "";
    $("refresh").disabled = true;
    $("market").disabled = true;
    $("save").disabled = true;
    $("copy").disabled = true;
    status(`正在读取${bingMarkets[market2].name}地区壁纸…`);
    try {
      const payload = await jsonRequest(request, bingArchiveURL(market2), current);
      if (current.aborted) return;
      items = bingImages(payload, market2);
      for (const image of items) {
        const button = text("button", image.enddate ?? image.startdate);
        button.dataset.wallpaper = image.startdate;
        button.onclick = () => select(image);
        $("gallery").append(button);
      }
      saveState("market", market2);
      busy = false;
      select(items[0]);
      status(`已读取${bingMarkets[market2].name}地区最近 ${items.length} 天的壁纸。`);
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消。" : e.message, true);
    } finally {
      busy = false;
      if (!signal.aborted) {
        $("refresh").disabled = false;
        $("market").disabled = false;
        $("save").disabled = !selected;
        $("copy").disabled = !selected;
      }
    }
  }
  $("refresh").onclick = () => void load();
  $("market").onchange = () => void load();
  $("cancel").onclick = () => op.cancel();
  $("copy").onclick = async () => {
    try {
      await copyText(bingURL(selected, $("resolution").value));
      status("图片链接已复制。");
    } catch (e) {
      status(e.message, true);
    }
  };
  $("save").onclick = async () => {
    if (!selected || busy) return;
    busy = true;
    const current = op.start(), resolution = $("resolution").value;
    for (const id of ["save", "refresh", "market", "resolution", "copy"]) $(id).disabled = true;
    $("cancel").hidden = false;
    status("正在下载壁纸…");
    try {
      const response = await request(bingURL(selected, resolution), { signal: current });
      if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("来源返回的内容不是图片。");
      if (!blob.size || blob.size > 4194304) throw new Error("壁纸超过 4 MiB，请改用 1920 × 1080。");
      const saved = await saveFile(`Bing-${selected.startdate}-${resolution}.jpg`, blob, { signal: current });
      if (!signal.aborted) status(saved ? "壁纸已保存。" : "已取消保存。");
    } catch (e) {
      if (!signal.aborted) status(e.name === "AbortError" ? "已取消下载。" : e.message, true);
    } finally {
      busy = false;
      if (!signal.aborted) {
        for (const id of ["save", "refresh", "market", "resolution", "copy"]) $(id).disabled = false;
        $("cancel").hidden = true;
      }
    }
  };
  void load();
  return () => op.dispose();
}
export {
  bingArchiveURL,
  bingImages,
  bingMarkets,
  bingURL,
  mount
};
