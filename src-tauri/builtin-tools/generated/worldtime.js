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

// src-tauri/builtin-tools/src/life.js
function loadState(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// src-tauri/builtin-tools/src/utility.js
var TEXT_LIMIT = 1024 * 1024;
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("工具存储空间不足，当前修改尚未保存。请先导出或缩短内容。");
  }
}

// src-tauri/builtin-tools/src/worldtime-data.js
var WORLD_CITIES = [
  ["beijing", "北京", "中国", "Asia/Shanghai", "亚洲", "Beijing"],
  ["shanghai", "上海", "中国", "Asia/Shanghai", "亚洲", "Shanghai"],
  ["hongkong", "香港", "中国", "Asia/Hong_Kong", "亚洲", "Hong Kong"],
  ["taipei", "台北", "中国台湾", "Asia/Taipei", "亚洲", "Taipei"],
  ["tokyo", "东京", "日本", "Asia/Tokyo", "亚洲", "Tokyo"],
  ["seoul", "首尔", "韩国", "Asia/Seoul", "亚洲", "Seoul"],
  ["singapore", "新加坡", "新加坡", "Asia/Singapore", "亚洲", "Singapore"],
  ["bangkok", "曼谷", "泰国", "Asia/Bangkok", "亚洲", "Bangkok"],
  ["hanoi", "河内", "越南", "Asia/Ho_Chi_Minh", "亚洲", "Hanoi"],
  ["jakarta", "雅加达", "印度尼西亚", "Asia/Jakarta", "亚洲", "Jakarta"],
  ["manila", "马尼拉", "菲律宾", "Asia/Manila", "亚洲", "Manila"],
  ["kuala-lumpur", "吉隆坡", "马来西亚", "Asia/Kuala_Lumpur", "亚洲", "Kuala Lumpur"],
  ["delhi", "新德里", "印度", "Asia/Kolkata", "亚洲", "New Delhi"],
  ["kathmandu", "加德满都", "尼泊尔", "Asia/Kathmandu", "亚洲", "Kathmandu"],
  ["dubai", "迪拜", "阿联酋", "Asia/Dubai", "亚洲", "Dubai"],
  ["riyadh", "利雅得", "沙特阿拉伯", "Asia/Riyadh", "亚洲", "Riyadh"],
  ["istanbul", "伊斯坦布尔", "土耳其", "Europe/Istanbul", "欧洲", "Istanbul"],
  ["moscow", "莫斯科", "俄罗斯", "Europe/Moscow", "欧洲", "Moscow"],
  ["london", "伦敦", "英国", "Europe/London", "欧洲", "London"],
  ["paris", "巴黎", "法国", "Europe/Paris", "欧洲", "Paris"],
  ["berlin", "柏林", "德国", "Europe/Berlin", "欧洲", "Berlin"],
  ["rome", "罗马", "意大利", "Europe/Rome", "欧洲", "Rome"],
  ["madrid", "马德里", "西班牙", "Europe/Madrid", "欧洲", "Madrid"],
  ["zurich", "苏黎世", "瑞士", "Europe/Zurich", "欧洲", "Zurich"],
  ["stockholm", "斯德哥尔摩", "瑞典", "Europe/Stockholm", "欧洲", "Stockholm"],
  ["helsinki", "赫尔辛基", "芬兰", "Europe/Helsinki", "欧洲", "Helsinki"],
  ["athens", "雅典", "希腊", "Europe/Athens", "欧洲", "Athens"],
  ["new-york", "纽约", "美国", "America/New_York", "美洲", "New York NYC"],
  ["washington", "华盛顿", "美国", "America/New_York", "美洲", "Washington DC"],
  ["chicago", "芝加哥", "美国", "America/Chicago", "美洲", "Chicago"],
  ["los-angeles", "洛杉矶", "美国", "America/Los_Angeles", "美洲", "Los Angeles LA"],
  ["san-francisco", "旧金山", "美国", "America/Los_Angeles", "美洲", "San Francisco"],
  ["toronto", "多伦多", "加拿大", "America/Toronto", "美洲", "Toronto"],
  ["vancouver", "温哥华", "加拿大", "America/Vancouver", "美洲", "Vancouver"],
  ["mexico", "墨西哥城", "墨西哥", "America/Mexico_City", "美洲", "Mexico City"],
  ["sao-paulo", "圣保罗", "巴西", "America/Sao_Paulo", "美洲", "Sao Paulo"],
  ["buenos-aires", "布宜诺斯艾利斯", "阿根廷", "America/Argentina/Buenos_Aires", "美洲", "Buenos Aires"],
  ["santiago", "圣地亚哥", "智利", "America/Santiago", "美洲", "Santiago"],
  ["sydney", "悉尼", "澳大利亚", "Australia/Sydney", "大洋洲", "Sydney"],
  ["melbourne", "墨尔本", "澳大利亚", "Australia/Melbourne", "大洋洲", "Melbourne"],
  ["perth", "珀斯", "澳大利亚", "Australia/Perth", "大洋洲", "Perth"],
  ["auckland", "奥克兰", "新西兰", "Pacific/Auckland", "大洋洲", "Auckland"],
  ["honolulu", "檀香山", "美国", "Pacific/Honolulu", "大洋洲", "Honolulu Hawaii"],
  ["cairo", "开罗", "埃及", "Africa/Cairo", "非洲", "Cairo"],
  ["johannesburg", "约翰内斯堡", "南非", "Africa/Johannesburg", "非洲", "Johannesburg"],
  ["nairobi", "内罗毕", "肯尼亚", "Africa/Nairobi", "非洲", "Nairobi"],
  ["lagos", "拉各斯", "尼日利亚", "Africa/Lagos", "非洲", "Lagos"],
  ["casablanca", "卡萨布兰卡", "摩洛哥", "Africa/Casablanca", "非洲", "Casablanca"],
  ["utc", "UTC", "协调世界时", "UTC", "其他", "UTC GMT"]
].map(([id, name, country, zone, region, aliases]) => ({ id, name, country, zone, region, aliases }));
var cache = /* @__PURE__ */ new Map();
function formatter(zone, twelve) {
  const key = zone + ":" + twelve;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: twelve ? "h12" : "h23", weekday: "short" }));
  return cache.get(key);
}
function parts(date, zone, twelve = false) {
  return Object.fromEntries(formatter(zone, twelve).formatToParts(date).filter((v) => v.type !== "literal").map((v) => [v.type, v.value]));
}
function zoneOffset(date, zone) {
  const p = parts(date, zone);
  return Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(date.getTime() / 1e3) * 1e3) / 6e4);
}
function offsetText(minutes) {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  return `UTC${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
}
function cityTime(date, zone, reference = "Asia/Shanghai", twelve = false) {
  const p = parts(date, zone, twelve), full = parts(date, zone), base = parts(date, reference), offset = zoneOffset(date, zone), difference = offset - zoneOffset(date, reference), dayDelta = (Date.UTC(Number(full.year), Number(full.month) - 1, Number(full.day)) - Date.UTC(Number(base.year), Number(base.month) - 1, Number(base.day))) / 864e5;
  return { time: `${p.hour}:${p.minute}:${p.second}${p.dayPeriod ? " " + p.dayPeriod.toUpperCase() : ""}`, date: `${p.year}-${p.month}-${p.day}`, weekday: { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" }[p.weekday], offset: offsetText(offset), difference, dayDelta };
}
function timeDifference(minutes) {
  return minutes === 0 ? "相同时间" : `${minutes > 0 ? "快" : "慢"} ${Math.abs(minutes) / 60} 小时`;
}
function filterWorldCities(query, region = "全部") {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return WORLD_CITIES.filter((c) => (region === "全部" || c.region === region) && words.every((w) => [c.name, c.country, c.zone, c.aliases].join(" ").toLowerCase().includes(w)));
}

// src-tauri/builtin-tools/src/worldtime.js
function mount({ copyText, signal }) {
  let region = "全部", records = [], timer = 0, disposed = false;
  const state = loadState("worldtime.settings", {});
  let favorites = new Set(Array.isArray(state.favorites) ? state.favorites.filter((id) => WORLD_CITIES.some((c) => c.id === id)) : ["beijing", "tokyo", "singapore", "dubai", "london", "paris", "new-york", "sydney"]);
  for (const c of WORLD_CITIES) {
    const option = text("option", c.name + " · " + c.zone);
    option.value = c.id;
    $("reference").append(option);
  }
  $("reference").value = WORLD_CITIES.some((c) => c.id === state.reference) ? state.reference : "beijing";
  $("format").value = state.format === "12" ? "12" : "24";
  $("favorites-only").checked = state.only === true;
  function save() {
    try {
      persist("worldtime.settings", { favorites: [...favorites], reference: $("reference").value, format: $("format").value, only: $("favorites-only").checked });
    } catch (e) {
      status(e.message, true);
    }
  }
  function tick() {
    if (disposed || document.hidden) return;
    const now = /* @__PURE__ */ new Date(), ref = WORLD_CITIES.find((c) => c.id === $("reference").value).zone;
    for (const row of records) {
      try {
        const value = cityTime(now, row.city.zone, ref, $("format").value === "12");
        row.time.textContent = value.time;
        row.date.textContent = `${value.date} ${value.weekday}`;
        row.zone.textContent = value.offset + " · " + row.city.zone;
        row.delta.textContent = `对照时区：${timeDifference(value.difference)}${value.dayDelta ? " · " + (value.dayDelta < 0 ? "前一天" : "后一天") : ""}`;
        row.current = value;
      } catch {
        row.time.textContent = "时区暂不支持";
        row.date.textContent = row.city.zone;
      }
    }
  }
  function render() {
    records = [];
    $("cities").replaceChildren();
    [...$("regions").children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === region)));
    const cities = filterWorldCities($("search").value, region).filter((c) => !$("favorites-only").checked || favorites.has(c.id));
    for (const city of cities) {
      const card = text("article", "", "card worldtime-card"), heading = text("div", "", "worldtime-heading"), title = text("h2", city.name), fav = text("button", favorites.has(city.id) ? "★" : "☆", "worldtime-favorite");
      fav.setAttribute("aria-label", (favorites.has(city.id) ? "取消常用：" : "设为常用：") + city.name);
      fav.setAttribute("aria-pressed", String(favorites.has(city.id)));
      fav.onclick = () => {
        favorites.has(city.id) ? favorites.delete(city.id) : favorites.add(city.id);
        save();
        render();
      };
      heading.append(title, fav);
      const row = { city, time: text("strong", "", "worldtime-clock"), date: text("p", "", "worldtime-date"), zone: text("p", "", "hint"), delta: text("p", "", "hint") }, copy = text("button", "复制时间", "mobile-full-row");
      copy.onclick = async () => {
        try {
          const v = cityTime(/* @__PURE__ */ new Date(), city.zone, WORLD_CITIES.find((c) => c.id === $("reference").value).zone, $("format").value === "12");
          await copyText(`${city.name} · ${city.country}
${v.date} ${v.weekday} ${v.time}
${v.offset} · ${city.zone}`);
          if (!disposed) status("已复制" + city.name + "时间。");
        } catch (e) {
          if (!disposed) status(e.message, true);
        }
      };
      card.append(heading, text("p", city.country, "hint"), row.time, row.date, row.zone, row.delta, copy);
      $("cities").append(card);
      records.push(row);
    }
    $("count").textContent = `显示 ${cities.length} 个城市`;
    $("empty").hidden = !!cities.length;
    tick();
  }
  for (const value of ["全部", "亚洲", "欧洲", "美洲", "大洋洲", "非洲", "其他"]) {
    const b = text("button", value);
    b.onclick = () => {
      region = value;
      render();
    };
    $("regions").append(b);
  }
  $("search").oninput = render;
  for (const id of ["reference", "format", "favorites-only"]) $(id).onchange = () => {
    save();
    render();
  };
  function visibility() {
    clearInterval(timer);
    if (!document.hidden) {
      tick();
      timer = setInterval(tick, 1e3);
    }
  }
  document.addEventListener("visibilitychange", visibility);
  render();
  visibility();
  return () => {
    disposed = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
    records = [];
  };
}
export {
  mount
};
