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
function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function remainingSeconds(state, now = Date.now()) {
  return state.running ? Math.max(0, Math.ceil((state.deadline - now) / 1e3)) : state.remaining;
}
function nextPhase(phase, completed, cycles) {
  return phase === "focus" ? completed > 0 && completed % cycles === 0 ? "long" : "short" : "focus";
}

// src-tauri/builtin-tools/src/pomodoro.js
function mount() {
  const saved = loadState("pomodoro", {}), limits = { focus: 180, short: 60, long: 120, cycles: 12 }, settings = { focus: 25, short: 5, long: 15, cycles: 4, sound: true, auto: false, ...saved.settings };
  for (const id of Object.keys(limits)) settings[id] = Math.max(id === "cycles" ? 2 : 1, Math.min(limits[id], Math.floor(Number(settings[id])) || (id === "cycles" ? 4 : 25)));
  let state = { phase: "focus", remaining: settings.focus * 60, running: false, completed: 0, ...saved.state }, audio;
  if (!["focus", "short", "long"].includes(state.phase)) state.phase = "focus";
  state.completed = Math.max(0, Math.floor(Number(state.completed) || 0));
  state.remaining = Math.max(0, Math.min(10800, Number(state.remaining) || 0));
  if (state.running && !Number.isFinite(state.deadline)) state.running = false;
  $("task").value = String(saved.task ?? "").slice(0, 100);
  const names = { focus: "专注时间", short: "短休息", long: "长休息" };
  const persist = () => saveState("pomodoro", { settings, state, task: $("task").value });
  function render() {
    const remaining = remainingSeconds(state);
    $("time").textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    $("phase-name").textContent = names[state.phase];
    $("sessions").textContent = `已完成 ${state.completed} 轮专注`;
    $("start").textContent = state.running ? "暂停" : "开始";
    const percent = Math.max(0, Math.min(100, 100 - remaining / (settings[state.phase] * 60) * 100));
    document.querySelector(".timer-ring").style.background = `conic-gradient(var(--accent) ${percent}%, var(--soft) 0)`;
    document.querySelectorAll("[data-phase]").forEach((x) => x.classList.toggle("selected", x.dataset.phase === state.phase));
  }
  function phase(id) {
    state.phase = id;
    state.remaining = settings[id] * 60;
    state.running = false;
    state.deadline = null;
    persist();
    render();
  }
  function begin() {
    state.running = true;
    state.deadline = Date.now() + state.remaining * 1e3;
    persist();
    render();
  }
  function sound() {
    if (!settings.sound || !audio || audio.state !== "running") return;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(1e-3, audio.currentTime + 0.8);
    osc.start();
    osc.stop(audio.currentTime + 0.8);
  }
  function tick() {
    if (state.running && remainingSeconds(state) === 0) {
      state.running = false;
      state.remaining = 0;
      if (state.phase === "focus") state.completed++;
      sound();
      status(`${names[state.phase]}结束了，${state.phase === "focus" ? "休息一下吧！" : "准备开始下一轮专注。"}`);
      const next = nextPhase(state.phase, state.completed, settings.cycles);
      phase(next);
      if (settings.auto && !document.hidden) begin();
      persist();
    }
    render();
  }
  $("start").onclick = () => {
    try {
      audio ?? (audio = new (window.AudioContext || window.webkitAudioContext)());
      void audio.resume().catch(() => {
      });
    } catch {
    }
    if (state.running && remainingSeconds(state) === 0) {
      tick();
      return;
    }
    if (state.running) {
      state.remaining = remainingSeconds(state);
      state.running = false;
      persist();
      render();
    } else begin();
  };
  $("reset").onclick = () => {
    phase(state.phase);
    status("已重置本轮。");
  };
  $("skip").onclick = () => {
    phase(nextPhase(state.phase, state.completed, settings.cycles));
    status("已切换阶段，跳过的专注不计入完成轮数。");
  };
  document.querySelectorAll("[data-phase]").forEach((button) => button.onclick = () => phase(button.dataset.phase));
  for (const [id, max] of Object.entries(limits)) {
    $(id).value = settings[id];
    $(id).onchange = () => {
      settings[id] = Math.max(id === "cycles" ? 2 : 1, Math.min(max, Math.floor(Number($(id).value) || 1)));
      $(id).value = settings[id];
      persist();
    };
  }
  for (const id of ["sound", "auto"]) {
    $(id).checked = Boolean(settings[id]);
    $(id).onchange = () => {
      settings[id] = $(id).checked;
      persist();
    };
  }
  $("task").oninput = persist;
  const timer = setInterval(tick, 250);
  document.addEventListener("visibilitychange", tick);
  tick();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
    persist();
    void audio?.close();
  };
}
export {
  mount
};
