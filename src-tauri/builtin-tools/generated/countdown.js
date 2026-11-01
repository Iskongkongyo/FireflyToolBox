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
var newId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, "0")).join("");
function localDay(date = /* @__PURE__ */ new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dayNumber(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("请选择有效日期。");
  const [year, month, day] = match.slice(1).map(Number), date = /* @__PURE__ */ new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1e3 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("请选择有效日期。");
  return date.getTime() / 864e5;
}
function countdown(event, today = localDay()) {
  dayNumber(event.date);
  const now = dayNumber(today);
  let target = event.date;
  if (event.yearly) {
    const month = Number(event.date.slice(5, 7)), day = Number(event.date.slice(8));
    let year = Number(today.slice(0, 4));
    const dateInYear = (y) => {
      const d = /* @__PURE__ */ new Date(0);
      d.setUTCFullYear(y, month, 0);
      const last = d.getUTCDate();
      return `${y}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    };
    target = dateInYear(year);
    if (dayNumber(target) < now) target = dateInYear(year + 1);
  }
  const difference = dayNumber(target) - now;
  return { target, difference, days: Math.abs(difference) + (event.includeToday && difference !== 0 ? 1 : 0) };
}

// src-tauri/builtin-tools/src/persistence-ui.js
function persistentSaver(storage, signal) {
  const panel = document.createElement("div"), message = document.createElement("p"), retry = document.createElement("button");
  panel.dataset.saveState = "idle";
  panel.hidden = true;
  message.className = "status";
  message.setAttribute("role", "status");
  retry.type = "button";
  retry.textContent = "重试保存";
  retry.hidden = true;
  panel.append(message, retry);
  document.getElementById("status").after(panel);
  let revision = 0, disposed = false, latest, last = Promise.resolve(true);
  const active = () => !disposed && !signal?.aborted;
  function show(state, value) {
    if (!active()) return;
    panel.hidden = false;
    panel.dataset.saveState = state;
    message.textContent = value;
    message.classList.toggle("error", state === "error");
    retry.hidden = state !== "error";
  }
  function commit(entry) {
    if (!active()) throw new DOMException("工具已停止。", "AbortError");
    const current = ++revision;
    latest = entry;
    try {
      localStorage.setItem(entry.key, entry.json);
    } catch (error) {
      show("error", "尚未保存：" + error.message);
      latest = void 0;
      retry.hidden = true;
      last = Promise.resolve(false);
      throw error;
    }
    show("pending", "正在保存…");
    last = Promise.resolve().then(() => storage.flush()).then(() => {
      if (current === revision) show("saved", entry.label);
      return true;
    }, (error) => {
      if (current === revision) show("error", "尚未保存：" + error.message);
      return false;
    });
    return last;
  }
  retry.onclick = () => {
    if (!latest || !active()) return;
    try {
      void commit(latest);
    } catch {
    }
  };
  const stop = () => {
    disposed = true;
    revision++;
    retry.hidden = true;
    retry.onclick = null;
  };
  signal?.addEventListener("abort", stop, { once: true });
  return {
    write(key, value, label = "已保存。") {
      return commit({ key, json: JSON.stringify(value), label });
    },
    settled: () => last,
    dispose() {
      stop();
      signal?.removeEventListener("abort", stop);
    }
  };
}

// src-tauri/builtin-tools/src/countdown.js
function mount({ copyText, storage, signal }) {
  const saver = persistentSaver(storage, signal);
  let events = loadState("days", []);
  if (!Array.isArray(events)) events = [];
  events = events.filter((e) => {
    try {
      return e && typeof e.name === "string" && countdown(e);
    } catch {
      return false;
    }
  }).slice(0, 50);
  let editing = null, deleting = null;
  const summary = (e) => {
    const value = countdown(e);
    return `${e.name}：${value.difference === 0 ? "就是今天" : `${value.difference > 0 ? "还有" : "已经"} ${value.days} 天`}（${value.target}）`;
  };
  function save(next, label = "已保存。") {
    void saver.write("days", next, label);
    events = next;
    render();
  }
  function reset() {
    editing = null;
    $("name").value = "";
    $("date").value = localDay();
    $("note").value = "";
    $("yearly").checked = false;
    $("include").checked = false;
    $("form-title").textContent = "添加日子";
    $("save").textContent = "添加日子";
    $("cancel-edit").hidden = true;
  }
  function render() {
    $("days").replaceChildren();
    if (!events.length) $("days").append(text("p", "还没有记录日子，添加一个期待吧。", "hint"));
    for (const e of [...events].sort((a, b) => {
      const x = countdown(a).difference, y = countdown(b).difference;
      return (x < 0) - (y < 0) || Math.abs(x) - Math.abs(y);
    })) {
      const v = countdown(e), card = text("article", "", "card countdown-item"), heading = text("h2", e.name), number = text("div", String(v.days), "day-value"), actions = text("div", "", "actions"), edit = text("button", "编辑"), remove = text("button", "删除"), copy = text("button", "复制");
      edit.onclick = () => {
        editing = e.id;
        $("name").value = e.name;
        $("date").value = e.date;
        $("note").value = e.note ?? "";
        $("yearly").checked = !!e.yearly;
        $("include").checked = !!e.includeToday;
        $("form-title").textContent = "编辑日子";
        $("save").textContent = "保存修改";
        $("cancel-edit").hidden = false;
        $("name").focus();
      };
      remove.onclick = () => {
        deleting = e.id;
        $("delete-confirm").hidden = false;
        $("confirm-delete").focus();
      };
      copy.onclick = async () => {
        try {
          await copyText(summary(e));
          status("已复制。");
        } catch (err) {
          status(err.message, true);
        }
      };
      actions.append(edit, remove, copy);
      card.append(heading, text("p", v.difference === 0 ? "就是今天" : v.difference > 0 ? "距离这一天还有" : "距离这一天已经", "hint"), number, text("p", `${v.target}${e.yearly ? " · 每年重复" : ""}`, "hint"));
      if (e.note) card.append(text("p", e.note));
      card.append(actions);
      $("days").append(card);
    }
  }
  $("save").onclick = () => {
    try {
      const name = $("name").value.trim();
      if (!name) throw new Error("请填写日子名称。");
      if (!editing && events.length >= 50) throw new Error("最多保存 50 个日子。");
      const e = { id: editing ?? newId(), name, date: $("date").value, note: $("note").value, yearly: $("yearly").checked, includeToday: $("include").checked };
      countdown(e);
      save(editing ? events.map((x) => x.id === editing ? e : x) : [...events, e]);
      reset();
      status("");
    } catch (e) {
      status(e.message, true);
    }
  };
  $("cancel-edit").onclick = reset;
  $("cancel-delete").onclick = () => {
    $("delete-confirm").hidden = true;
  };
  $("confirm-delete").onclick = () => {
    try {
      save(events.filter((e) => e.id !== deleting), "日子已删除。");
      if (editing === deleting) reset();
      $("delete-confirm").hidden = true;
      status("");
    } catch (e) {
      status(e.message, true);
    }
  };
  copyButton("copy", () => events.map(summary).join("\n"), copyText);
  const refresh = () => render(), timer = setInterval(refresh, 6e4);
  document.addEventListener("visibilitychange", refresh);
  reset();
  render();
  return () => {
    saver.dispose();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
  };
}
export {
  mount
};
