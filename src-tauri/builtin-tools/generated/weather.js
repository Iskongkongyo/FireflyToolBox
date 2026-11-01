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

// src-tauri/builtin-tools/src/weather-data.js
var weatherNumber = (value) => value === null || value === void 0 || value === "" || !Number.isFinite(Number(value)) || Math.abs(Number(value)) >= 9e3 ? null : Number(value);
var weatherText = (value) => value === null || value === void 0 || ["9999", "9999.0", "null", "undefined"].includes(String(value)) ? "" : String(value).trim().slice(0, 2e3);
function stationCode(value) {
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(value)) throw new Error("城市编码无效，请重新选择城市。");
  return value;
}
function weatherCode(code) {
  return { 0: "晴", 1: "大部晴朗", 2: "局部多云", 3: "阴", 45: "雾", 48: "冻雾", 51: "毛毛雨", 53: "毛毛雨", 55: "较强毛毛雨", 56: "冻毛毛雨", 57: "冻毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "冻雨", 71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒", 80: "阵雨", 81: "阵雨", 82: "强阵雨", 85: "阵雪", 86: "强阵雪", 95: "雷雨", 96: "雷雨伴冰雹", 99: "强雷雨伴冰雹" }[code] || "暂无天气描述";
}
function cmaWeather(response) {
  const data = response?.data, real = data?.real, predict = data?.predict;
  if (response?.code !== 0 || !real?.station?.city || !Array.isArray(predict?.detail) || !predict.detail.length) throw new Error("中国气象未返回有效天气，请重新选择城市或切换来源。");
  const w = real.weather || {}, wind = real.wind || {}, air = data.air || {}, sun = real.sunriseSunset || {}, warn = real.warn || {};
  return { provider: "中国气象 · 中央气象台", location: [real.station.province, real.station.city].filter(Boolean).join(" · "), timezone: "北京时间", currentTime: weatherText(real.publish_time), forecastTime: weatherText(predict.publish_time), current: { temperature: weatherNumber(w.temperature), apparent: weatherNumber(w.feelst), humidity: weatherNumber(w.humidity), rain: weatherNumber(w.rain), pressure: weatherNumber(w.airpressure), wind: weatherNumber(wind.speed), windText: [weatherText(wind.direct), weatherText(wind.power)].filter(Boolean).join(" "), description: weatherText(w.info) || "暂无天气描述", sunrise: weatherText(sun.sunrise), sunset: weatherText(sun.sunset), aqi: weatherNumber(air.aqi), air: weatherText(air.text), airTime: weatherText(air.forecasttime) }, warning: weatherText(warn.alert) ? [weatherText(warn.alert), weatherText(warn.issuecontent), weatherText(warn.issuetime)].filter(Boolean).join("\n") : "", days: predict.detail.slice(0, 7).map((d) => ({ date: d.date, high: weatherNumber(d.day?.weather?.temperature), low: weatherNumber(d.night?.weather?.temperature), day: weatherText(d.day?.weather?.info) || "暂无白天天气", night: weatherText(d.night?.weather?.info) || "暂无夜间天气", wind: [weatherText(d.day?.wind?.direct), weatherText(d.day?.wind?.power)].filter(Boolean).join(" "), nightWind: [weatherText(d.night?.wind?.direct), weatherText(d.night?.wind?.power)].filter(Boolean).join(" "), rain: weatherNumber(d.precipitation) })), hourlyTitle: "近 24 小时观测", hours: (Array.isArray(data.passedchart) ? data.passedchart : []).slice(0, 24).map((h) => ({ time: h.time, temperature: weatherNumber(h.temperature), humidity: weatherNumber(h.humidity), rain: weatherNumber(h.rain1h), wind: weatherNumber(h.windSpeed) })), link: /^\/publish\/forecast\/[A-Za-z0-9/_-]+\.html$/.test(real.station.url) ? "https://www.nmc.cn" + real.station.url : "https://www.nmc.cn" };
}
function meteoURL(city) {
  const lat = Number(city.latitude), lon = Number(city.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("城市坐标无效，请重新搜索。");
  const p = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m", hourly: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m", daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max", wind_speed_unit: "ms", timezone: "auto", forecast_days: "7" });
  return "https://api.open-meteo.com/v1/forecast?" + p;
}
function meteoWeather(data, city) {
  if (!data?.current?.time || !Array.isArray(data.daily?.time) || !data.daily.time.length) throw new Error("Open-Meteo 未返回有效天气，请稍后重试。");
  const c = data.current, d = data.daily, h = data.hourly || {}, field = (object, key, i) => weatherNumber(object[key]?.[i]);
  return { provider: "Open-Meteo", location: [city.name, city.admin1, city.country].filter(Boolean).join(" · "), timezone: (data.timezone || city.timezone || "城市当地时间") + " · 城市当地时间", currentTime: c.time.replace("T", " "), forecastTime: "", current: { temperature: weatherNumber(c.temperature_2m), apparent: weatherNumber(c.apparent_temperature), humidity: weatherNumber(c.relative_humidity_2m), rain: weatherNumber(c.precipitation), pressure: weatherNumber(c.pressure_msl), wind: weatherNumber(c.wind_speed_10m), windText: c.wind_direction_10m === void 0 ? "" : `${c.wind_direction_10m}° · 阵风 ${weatherNumber(c.wind_gusts_10m) ?? "—"} m/s`, cloud: weatherNumber(c.cloud_cover), description: weatherCode(c.weather_code), sunrise: d.sunrise?.[0]?.replace("T", " "), sunset: d.sunset?.[0]?.replace("T", " "), uv: field(d, "uv_index_max", 0) }, warning: "", days: d.time.slice(0, 7).map((date, i) => ({ date, high: field(d, "temperature_2m_max", i), low: field(d, "temperature_2m_min", i), day: weatherCode(d.weather_code?.[i]), night: "", wind: `最大风速 ${field(d, "wind_speed_10m_max", i) ?? "—"} m/s`, rain: field(d, "precipitation_sum", i), probability: field(d, "precipitation_probability_max", i), uv: field(d, "uv_index_max", i) })), hourlyTitle: "未来 24 小时预报", hours: (h.time || []).map((time, i) => ({ time: time.replace("T", " "), temperature: field(h, "temperature_2m", i), humidity: field(h, "relative_humidity_2m", i), rain: field(h, "precipitation", i), probability: field(h, "precipitation_probability", i), wind: field(h, "wind_speed_10m", i), description: weatherCode(h.weather_code?.[i]) })).filter((v) => v.time >= c.time.replace("T", " ")).slice(0, 24), link: "https://open-meteo.com/" };
}

// src-tauri/builtin-tools/src/weather.js
function mount({ request, copyText, signal }) {
  const state = loadState("weather.settings", {}), op = operation(signal);
  let busy = false, cities = [], globalCities = [], shown = null, shownKey = "", copied = "", cached = loadState("weather.cache", null);
  if (!cached?.data?.current || !Array.isArray(cached.data.days) || !Array.isArray(cached.data.hours) || cached.data.days.some((d) => !d || typeof d.date !== "string") || cached.data.hours.some((h) => !h || typeof h.time !== "string")) cached = null;
  const value = (v, unit = "") => v === null || v === void 0 || v === "" ? "—" : `${v}${unit}`;
  function saveSettings() {
    Object.assign(state, { provider: $("provider").value, province: $("province").value, city: $("china-city").value, global: globalCities[Number($("global-city").value)] || null, keyword: $("keyword").value });
    saveState("weather.settings", state);
  }
  function key() {
    return $("provider").value === "cma" ? "cma:" + $("china-city").value : "meteo:" + JSON.stringify(globalCities[Number($("global-city").value)] || null);
  }
  function render(data, cache = false) {
    shown = data;
    shownKey = key();
    $("results").hidden = false;
    $("cache-label").hidden = !cache;
    $("location").textContent = data.location;
    $("published").textContent = `${data.provider} · ${data.timezone}
${data.provider === "Open-Meteo" ? "模型时间" : "实况发布"}：${data.currentTime || "—"}`;
    $("temperature").textContent = value(data.current.temperature, "°C");
    $("description").textContent = data.current.description;
    $("feel").textContent = "体感 " + value(data.current.apparent, "°C");
    $("metrics").replaceChildren();
    for (const [label, v] of [["湿度", value(data.current.humidity, "%")], ["风速", value(data.current.wind, " m/s")], ["风向 / 风力", data.current.windText || "—"], ["降水", value(data.current.rain, " mm")], ["气压", value(data.current.pressure, " hPa")], ["日出", data.current.sunrise || "—"], ["日落", data.current.sunset || "—"], ...data.current.aqi !== void 0 ? [["空气质量", `${value(data.current.aqi)} ${data.current.air || ""}`], ["空气质量时间", data.current.airTime || "—"]] : [["云量", value(data.current.cloud, "%")], ["最大紫外线指数", value(data.current.uv)]]]) {
      const item = text("div", "", "weather-metric");
      item.append(text("small", label), text("strong", v));
      $("metrics").append(item);
    }
    $("warning-card").hidden = !data.warning;
    $("warning").textContent = plainHTML(data.warning);
    $("forecast-time").textContent = data.forecastTime ? "预报发布：" + data.forecastTime : "城市当地日期";
    $("days").replaceChildren();
    for (const d of data.days) {
      const card = text("article", "", "weather-day");
      card.append(text("strong", d.date), text("h3", `${value(d.low, "°")} ～ ${value(d.high, "°")}`), text("p", d.day));
      if (d.night) card.append(text("p", "夜间：" + d.night, "hint"));
      card.append(text("p", d.wind || "风况暂无", "hint"));
      if (d.nightWind) card.append(text("p", "夜间：" + d.nightWind, "hint"));
      card.append(text("p", `降水 ${value(d.rain, " mm")}${d.probability === void 0 ? "" : " · 概率 " + value(d.probability, "%")}`, "hint"));
      if (d.uv !== void 0) card.append(text("p", "紫外线 " + value(d.uv), "hint"));
      $("days").append(card);
    }
    $("hours").replaceChildren();
    for (const h of data.hours) {
      const row = text("tr", "");
      for (const v of [h.time, `${h.description || ""} ${value(h.temperature, "°C")}`, value(h.humidity, "%"), `${value(h.rain, " mm")}${h.probability === void 0 ? "" : " / " + value(h.probability, "%")}`, value(h.wind, " m/s")]) row.append(text("td", v));
      $("hours").append(row);
    }
    $("hourly-card").hidden = !data.hours.length;
    $("hourly-title").textContent = data.hourlyTitle;
    copied = `${data.location}
${data.provider} · ${data.currentTime}
${data.current.description} ${value(data.current.temperature, "°C")} · 体感 ${value(data.current.apparent, "°C")}
湿度 ${value(data.current.humidity, "%")} · 风 ${value(data.current.wind, " m/s")} ${data.current.windText || ""}
` + data.days.map((d) => `${d.date} ${d.day}${d.night ? " / " + d.night : ""} ${value(d.low, "°")}～${value(d.high, "°")} 降水 ${value(d.rain, " mm")}`).join("\n");
    $("copy").disabled = false;
    $("source").disabled = false;
  }
  function clear() {
    shown = null;
    shownKey = "";
    copied = "";
    $("results").hidden = true;
    $("copy").disabled = true;
    $("source").disabled = true;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    const current = op.start();
    document.querySelectorAll("main button,main input,main select").forEach((n) => n.disabled = true);
    $("cancel").hidden = false;
    $("cancel").disabled = false;
    try {
      await fn(current);
    } catch (e) {
      if (!signal.aborted) {
        if (shown && shownKey === key()) $("cache-label").hidden = false;
        status((e.name === "AbortError" ? "已取消查询。" : e.message) + (shown && shownKey === key() ? " 当前显示上次数据，尚未更新。" : ""), e.name !== "AbortError");
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        document.querySelectorAll("main button,main input,main select").forEach((n) => n.disabled = false);
        $("copy").disabled = !shown;
        $("source").disabled = !shown;
        $("cancel").hidden = true;
      }
    }
  }
  async function fetchWeather(current) {
    const queryKey = key();
    if (cached?.key === queryKey && !shown) render(cached.data, true);
    status("正在查询天气…");
    let data;
    if ($("provider").value === "cma") {
      const code = stationCode($("china-city").value);
      data = cmaWeather(await jsonRequest(request, "https://www.nmc.cn/rest/weather?stationid=" + encodeURIComponent(code), current));
    } else {
      const city = globalCities[Number($("global-city").value)];
      if (!city) throw new Error("请先搜索并选择城市。");
      data = meteoWeather(await jsonRequest(request, meteoURL(city), current), city);
    }
    if (current.aborted) return;
    render(data);
    cached = { key: queryKey, data };
    saveState("weather.cache", cached);
    saveSettings();
    status("天气已更新。");
  }
  async function loadCities(current, selected) {
    const province = stationCode($("province").value), data = await jsonRequest(request, "https://www.nmc.cn/rest/province/" + province, current);
    if (!Array.isArray(data) || !data.length) throw new Error("该地区没有返回城市列表。");
    if (current.aborted) return;
    cities = data.filter((c) => /^[A-Za-z0-9_-]{3,16}$/.test(c.code)).slice(0, 500);
    $("china-city").replaceChildren(...cities.map((c) => {
      const o = text("option", weatherText(c.city));
      o.value = c.code;
      return o;
    }));
    if (cities.some((c) => c.code === selected)) $("china-city").value = selected;
    saveSettings();
  }
  async function initializeChina(current) {
    status("正在读取省份与城市…");
    const provinces = await jsonRequest(request, "https://www.nmc.cn/rest/province", current);
    if (!Array.isArray(provinces) || !provinces.length) throw new Error("中国气象没有返回地区列表，请切换来源重试。");
    if (current.aborted) return;
    $("province").replaceChildren(...provinces.filter((p) => /^[A-Za-z0-9_-]{3,16}$/.test(p.code)).map((p) => {
      const o = text("option", p.name);
      o.value = p.code;
      return o;
    }));
    $("province").value = provinces.some((p) => p.code === state.province) ? state.province : "ABJ";
    await loadCities(current, state.city);
    if (!current.aborted) await fetchWeather(current);
  }
  async function search(current) {
    const term = $("keyword").value.trim();
    if (term.length < 2) throw new Error("请输入至少两个字符的城市名称。");
    status("正在搜索城市…");
    const data = await jsonRequest(request, "https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({ name: term, count: "10", language: "zh", format: "json" }), current);
    if (current.aborted) return;
    globalCities = (Array.isArray(data.results) ? data.results : []).filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
    $("global-city").replaceChildren(...globalCities.map((c, i) => {
      const o = text("option", [c.name, c.admin1, c.country].filter(Boolean).join(" · "));
      o.value = String(i);
      return o;
    }));
    clear();
    if (!globalCities.length) throw new Error("没有找到匹配的城市，请换用其他名称。");
    await fetchWeather(current);
  }
  $("provider").value = state.provider === "meteo" ? "meteo" : "cma";
  $("keyword").value = state.keyword || "北京";
  if (state.global) {
    globalCities = [state.global];
    const o = text("option", [state.global.name, state.global.admin1, state.global.country].filter(Boolean).join(" · "));
    o.value = "0";
    $("global-city").append(o);
  }
  function providerUI() {
    $("china-controls").hidden = $("provider").value !== "cma";
    $("global-controls").hidden = $("provider").value !== "meteo";
  }
  providerUI();
  $("provider").onchange = () => {
    clear();
    providerUI();
    saveSettings();
    void run((current) => $("provider").value === "cma" ? initializeChina(current) : globalCities.length ? fetchWeather(current) : search(current));
  };
  $("province").onchange = () => {
    clear();
    void run(async (current) => {
      await loadCities(current);
      if (!current.aborted) await fetchWeather(current);
    });
  };
  $("china-city").onchange = $("global-city").onchange = () => {
    clear();
    saveSettings();
    void run(fetchWeather);
  };
  $("search").onclick = () => void run(search);
  $("keyword").onkeydown = (e) => {
    if (e.key === "Enter") void run(search);
  };
  $("refresh").onclick = () => void run((current) => $("provider").value === "cma" && !$("china-city").value ? initializeChina(current) : fetchWeather(current));
  $("cancel").onclick = () => op.cancel();
  copyButton("copy", () => copied, copyText);
  copyButton("source", () => shown?.link || "", copyText);
  void run((current) => $("provider").value === "cma" ? initializeChina(current) : globalCities.length ? fetchWeather(current) : search(current));
  return () => op.dispose();
}
export {
  mount
};
