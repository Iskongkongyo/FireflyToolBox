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
function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function scoreChange(teams, index, delta) {
  return teams.map((team, i) => i === index ? { ...team, score: Math.max(-999999, Math.min(999999, team.score + delta)) } : { ...team });
}

// src-tauri/builtin-tools/src/score.js
function mount({ copyText }) {
  const saved = loadState("score", {});
  let teams = Array.isArray(saved.teams) ? saved.teams.slice(0, 8).map((t, i) => ({ name: String(t.name ?? `队伍 ${i + 1}`).slice(0, 50), score: Math.max(-999999, Math.min(999999, Math.floor(Number(t.score) || 0))) })) : [{ name: "红队", score: 0 }, { name: "蓝队", score: 0 }], history = [];
  if (teams.length < 2) teams = [{ name: "队伍一", score: 0 }, { name: "队伍二", score: 0 }];
  $("title").value = String(saved.title ?? "").slice(0, 100);
  $("step").value = Math.max(1, Math.min(1e3, Number(saved.step) || 1));
  const persist = () => saveState("score", { teams, title: $("title").value, step: Number($("step").value) });
  const snapshot = () => {
    history.push(teams.map((t) => ({ ...t })));
    if (history.length > 50) history.shift();
  };
  function render() {
    $("teams").replaceChildren();
    teams.forEach((team, i) => {
      const card = text("div", "", "score-team"), name = document.createElement("input"), score = text("div", String(team.score), "score-value"), actions = text("div", "", "actions"), plus = text("button", "+"), minus = text("button", "−"), remove = text("button", "移除队伍");
      name.value = team.name;
      name.maxLength = 50;
      name.setAttribute("aria-label", `队伍 ${i + 1} 名称`);
      name.oninput = () => {
        team.name = name.value;
        persist();
      };
      plus.className = "primary";
      plus.setAttribute("aria-label", `队伍 ${i + 1} 加分`);
      minus.setAttribute("aria-label", `队伍 ${i + 1} 减分`);
      for (const [button, sign] of [[plus, 1], [minus, -1]]) button.onclick = () => {
        snapshot();
        const step = Math.max(1, Math.min(1e3, Math.floor(Number($("step").value) || 1)));
        $("step").value = step;
        teams = scoreChange(teams, i, step * sign);
        render();
        persist();
      };
      remove.disabled = teams.length <= 2;
      remove.onclick = () => {
        snapshot();
        teams.splice(i, 1);
        render();
        persist();
      };
      actions.append(minus, plus);
      card.append(name, score, actions, remove);
      $("teams").append(card);
    });
    $("add").disabled = teams.length >= 8;
    $("undo").disabled = !history.length;
  }
  $("add").onclick = () => {
    if (teams.length < 8) {
      snapshot();
      teams.push({ name: `队伍 ${teams.length + 1}`, score: 0 });
      render();
      persist();
    }
  };
  $("undo").onclick = () => {
    if (history.length) {
      teams = history.pop();
      render();
      persist();
      status("已撤销。");
    }
  };
  $("reset").onclick = () => {
    $("reset-confirm").hidden = false;
  };
  $("cancel-reset").onclick = () => {
    $("reset-confirm").hidden = true;
  };
  $("confirm-reset").onclick = () => {
    snapshot();
    teams = teams.map((t) => ({ ...t, score: 0 }));
    $("reset-confirm").hidden = true;
    render();
    persist();
    status("比分已归零，可撤销。");
  };
  $("title").oninput = persist;
  $("step").onchange = persist;
  copyButton("copy", () => [$("title").value, ...teams.map((t) => `${t.name}：${t.score}`)].filter(Boolean).join("\n"), copyText);
  render();
}
export {
  mount
};
