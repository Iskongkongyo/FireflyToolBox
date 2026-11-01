// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
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

// src-tauri/builtin-tools/src/reaction-data.js
function reactionStats(data) {
  const recent = Array.isArray(data?.recent) ? data.recent.filter((v) => Number.isFinite(v) && v >= 0 && v <= 1e4).slice(-5) : [], best = Number.isFinite(data?.best) && data.best >= 0 && data.best <= 1e4 ? data.best : null;
  return { recent, best: recent.length ? Math.min(best ?? Infinity, ...recent) : best, count: Number.isSafeInteger(data?.count) && data.count >= 0 ? data.count : recent.length };
}
function recordReaction(stats, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 1e4) throw new Error("本次计时无效，请重新测试。");
  const previous = reactionStats(stats);
  return { recent: [...previous.recent, milliseconds].slice(-5), best: Math.min(previous.best ?? Infinity, milliseconds), count: previous.count + 1 };
}
function reactionAverage(stats) {
  const values = reactionStats(stats).recent;
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// src-tauri/builtin-tools/src/reaction.js
function mount({ signal }) {
  const pad = $("pad");
  let stats = reactionStats(loadState("reaction.stats", {})), active = null, phase = "idle", timer, frame, timeout, cue = 0, last = null;
  function records() {
    $("best").textContent = stats.best === null ? "—" : Math.round(stats.best) + " ms";
    const average = reactionAverage(stats);
    $("average").textContent = average === null ? "—" : Math.round(average) + " ms";
    $("last").textContent = last === null ? "—" : Math.round(last) + " ms";
    $("history").textContent = stats.recent.length ? `最近 ${stats.recent.length} 次：${stats.recent.map((v) => Math.round(v) + " ms").join("、")}` : "还没有有效记录。";
  }
  function finish() {
    clearTimeout(timer);
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    const previous = active;
    active = null;
    phase = "idle";
    $("reset").disabled = false;
    if (previous?.kind === "pointer" && pad.hasPointerCapture?.(previous.id)) pad.releasePointerCapture(previous.id);
  }
  function cancel(message) {
    if (!active) return;
    finish();
    pad.classList.remove("ready");
    $("prompt").textContent = "本次无效";
    $("detail").textContent = "重新按住卡片开始";
    status(message, true);
  }
  function begin(kind, id) {
    if (active || signal.aborted) return;
    active = { kind, id };
    phase = "waiting";
    pad.classList.remove("ready");
    $("prompt").textContent = "保持按住…";
    $("detail").textContent = "等绿色提示，再抬起";
    $("reset").disabled = true;
    $("confirm").hidden = true;
    status("");
    const word = crypto.getRandomValues(new Uint32Array(1))[0], limit = 2 ** 32 - 2 ** 32 % 3501;
    let random = word;
    while (random >= limit) random = crypto.getRandomValues(new Uint32Array(1))[0];
    timer = setTimeout(() => {
      if (!active || phase !== "waiting") return;
      frame = requestAnimationFrame(() => {
        if (!active || phase !== "waiting") return;
        pad.classList.add("ready");
        $("prompt").textContent = "抬起";
        $("detail").textContent = "现在松开手指 / 按键";
        cue = performance.now();
        phase = "ready";
        timeout = setTimeout(() => cancel("松开时间超过 10 秒，本次不计入成绩。"), 1e4);
      });
    }, 1500 + random % 3501);
  }
  function release(kind, id) {
    if (!active || active.kind !== kind || active.id !== id) return;
    if (phase !== "ready") {
      cancel("提前松手了，看到绿色“抬起”再松开。");
      return;
    }
    const elapsed = performance.now() - cue;
    finish();
    pad.classList.remove("ready");
    try {
      last = elapsed;
      stats = recordReaction(stats, elapsed);
      records();
      $("prompt").textContent = Math.round(elapsed) + " ms";
      $("detail").textContent = "再次按住，继续测试";
      persist("reaction.stats", stats);
      status("成绩已记录。");
    } catch (e) {
      status(e.message, true);
    }
  }
  function down(e) {
    if (e.isPrimary === false || e.button !== 0) return;
    e.preventDefault();
    pad.focus({ preventScroll: true });
    begin("pointer", e.pointerId);
    if (active?.kind === "pointer" && active.id === e.pointerId) try {
      pad.setPointerCapture(e.pointerId);
    } catch {
    }
  }
  function up(e) {
    release("pointer", e.pointerId);
  }
  function move(e) {
    if (active?.kind !== "pointer" || active.id !== e.pointerId) return;
    const r = pad.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cancel("手指移出了卡片，本次不计入成绩。");
  }
  function keydown(e) {
    if (![" ", "Enter"].includes(e.key) || e.repeat) return;
    e.preventDefault();
    begin("key", e.key);
  }
  function keyup(e) {
    if (![" ", "Enter"].includes(e.key)) return;
    e.preventDefault();
    release("key", e.key);
  }
  const blur = () => cancel("窗口失去焦点，本次不计入成绩。"), visibility = () => {
    if (document.hidden) cancel("页面切到后台，本次不计入成绩。");
  };
  pad.onpointerdown = down;
  pad.onpointerup = up;
  pad.onpointermove = move;
  pad.onpointercancel = (e) => {
    if (active?.kind === "pointer" && active.id === e.pointerId) cancel("点按已中断，本次不计入成绩。");
  };
  pad.onlostpointercapture = () => cancel("点按已中断，本次不计入成绩。");
  pad.onblur = () => cancel("焦点离开卡片，本次不计入成绩。");
  pad.onkeydown = keydown;
  pad.onkeyup = keyup;
  pad.oncontextmenu = (e) => e.preventDefault();
  window.addEventListener("blur", blur);
  document.addEventListener("visibilitychange", visibility);
  $("reset").onclick = () => {
    $("confirm").hidden = false;
  };
  $("cancel-reset").onclick = () => {
    $("confirm").hidden = true;
  };
  $("confirm-reset").onclick = () => {
    try {
      persist("reaction.stats", { recent: [], best: null, count: 0 });
      stats = reactionStats({});
      last = null;
      records();
      $("confirm").hidden = true;
      status("记录已清空。");
    } catch (e) {
      status(e.message, true);
    }
  };
  records();
  return () => {
    finish();
    window.removeEventListener("blur", blur);
    document.removeEventListener("visibilitychange", visibility);
  };
}
export {
  mount
};
