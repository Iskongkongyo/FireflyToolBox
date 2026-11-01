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

// src-tauri/builtin-tools/src/utility.js
var TEXT_LIMIT = 1024 * 1024;
var bytes = (value) => new TextEncoder().encode(value).byteLength;
var newId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, "0")).join("");
async function decodeFile(blob, limit = TEXT_LIMIT, encoding = "utf-8") {
  if (blob.size > limit) throw new Error(`文本文件超过 ${Math.round(limit / 1024)} KiB 上限。`);
  const data = new Uint8Array(await blob.arrayBuffer());
  let decoder = encoding;
  if (data[0] === 255 && data[1] === 254) decoder = "utf-16le";
  else if (data[0] === 254 && data[1] === 255) decoder = "utf-16be";
  try {
    return new TextDecoder(decoder, { fatal: true }).decode(data);
  } catch {
    throw new Error("文件编码无法识别，请选择 UTF-8 或 GBK 编码后重试。");
  }
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

// src-tauri/builtin-tools/src/memo.js
function mount({ copyText, openFile, saveFile, storage, signal }) {
  const saver = persistentSaver(storage, signal);
  const saved = loadState("memo", {}), op = operation(signal);
  let notes = Array.isArray(saved.notes) ? saved.notes.filter((n) => n && typeof n.id === "string" && typeof n.body === "string").slice(0, 32) : [], current = notes.some((n) => n.id === saved.current) ? saved.current : notes[0]?.id, timer, dirty = false;
  const note = () => notes.find((n) => n.id === current);
  function commit(next = notes, id = current, label = "已自动保存。") {
    void saver.write("memo", { notes: next, current: id }, label);
    notes = next;
    current = id;
    dirty = false;
    capacity();
    renderList();
  }
  function capacity() {
    const used = bytes(JSON.stringify(Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    }))));
    $("capacity").textContent = `${notes.length} 篇 · 已用 ${(used / 1024).toFixed(1)} / 1024 KiB（1 MiB）`;
  }
  function flush() {
    clearTimeout(timer);
    if (!dirty || !current) return true;
    try {
      const next = notes.map((n) => n.id === current ? { ...n, title: $("title").value, body: $("body").value, updated: Date.now() } : n);
      commit(next);
      return true;
    } catch (e) {
      status(e.message, true);
      return false;
    }
  }
  function show() {
    const n = note();
    $("title").value = n?.title ?? "";
    $("body").value = n?.body ?? "";
    for (const id of ["title", "body", "copy", "export", "delete"]) $(id).disabled = !n;
    renderList();
    capacity();
  }
  function renderList() {
    $("notes").replaceChildren();
    const q = $("search").value.trim().toLowerCase();
    for (const n of [...notes].sort((a, b) => b.updated - a.updated).filter((n2) => `${n2.title} ${n2.body}`.toLowerCase().includes(q))) {
      const button = text("button", "", "memo-note");
      button.classList.toggle("selected", n.id === current);
      button.append(text("strong", n.title || "未命名笔记"), text("small", n.body.slice(0, 55) || "空白笔记"));
      button.onclick = () => {
        if (!flush()) return;
        try {
          commit(notes, n.id);
          show();
          status("");
        } catch (e) {
          status(e.message, true);
        }
      };
      $("notes").append(button);
    }
    if (!$("notes").children.length) $("notes").append(text("p", notes.length ? "没有匹配的笔记。" : "还没有笔记。", "hint"));
  }
  function create(title = "", body = "") {
    if (!flush()) return;
    if (notes.length >= 32) {
      status("最多保存 32 篇，请先导出或删除部分笔记。", true);
      return;
    }
    try {
      const n = { id: newId(), title, body, updated: Date.now() };
      commit([...notes, n], n.id, "新笔记已保存。");
      show();
      status("");
    } catch (e) {
      status(e.message, true);
    }
  }
  const input = () => {
    dirty = true;
    flush();
  };
  $("title").oninput = input;
  $("body").oninput = input;
  $("title").onblur = flush;
  $("body").onblur = flush;
  $("search").oninput = renderList;
  $("new").onclick = () => create();
  $("copy").onclick = async () => {
    try {
      await copyText([$("title").value, $("body").value].filter(Boolean).join("\n"));
      status("已复制。");
    } catch (e) {
      status(e.message, true);
    }
  };
  $("export").onclick = async () => {
    try {
      const value = [$("title").value, $("body").value].filter(Boolean).join("\n");
      const saved2 = await saveFile(`${$("title").value || "备忘录"}.txt`, new Blob([value], { type: "text/plain;charset=utf-8" }), { signal: op.start() });
      if (!signal.aborted) status(saved2 ? "文件已保存。" : "已取消导出。");
    } catch (e) {
      if (!signal.aborted) status(e.message, true);
    }
  };
  $("import").onclick = async () => {
    if (!flush()) return;
    try {
      const file = await openFile({ extensions: ["txt", "md"], signal: op.start() });
      if (!file) {
        status("已取消导入。");
        return;
      }
      const value = await decodeFile(file.blob, 48e3, $("encoding").value);
      if (value.length > 12e3) throw new Error("笔记超过 12000 字符，请使用 Markdown 工具打开或分成多篇。");
      create(file.name.replace(/\.[^.]+$/, "").slice(0, 60), value);
    } catch (e) {
      if (!signal.aborted) status(e.message, true);
    }
  };
  $("delete").onclick = () => {
    $("delete-confirm").hidden = false;
  };
  $("cancel-delete").onclick = () => {
    $("delete-confirm").hidden = true;
  };
  $("confirm-delete").onclick = () => {
    try {
      clearTimeout(timer);
      const next = notes.filter((n) => n.id !== current);
      commit(next, next[0]?.id, "笔记已删除。");
      $("delete-confirm").hidden = true;
      show();
      status("");
    } catch (e) {
      status(e.message, true);
    }
  };
  show();
  return () => {
    flush();
    saver.dispose();
    clearTimeout(timer);
    op.dispose();
  };
}
export {
  mount
};
