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
function randomIndex(count, random = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  if (!Number.isInteger(count) || count < 2 || count > 24) throw new Error("请设置 2 到 24 个选项。");
  const bound = 2 ** 32 - 2 ** 32 % count;
  let value;
  do {
    value = random();
  } while (value >= bound);
  return value % count;
}
function wheelTarget(rotation, index, count) {
  const step = 360 / count, target = (360 - (index + 0.5) * step) % 360;
  return rotation + 360 * 6 + (target - rotation % 360 + 360) % 360;
}

// src-tauri/builtin-tools/src/decision.js
function mount({ copyText, signal }) {
  const saved = loadState("decision", {});
  let options = Array.isArray(saved.options) ? saved.options.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 24) : ["面条", "米饭", "饺子", "火锅"];
  if (options.length < 2) options = ["选项一", "选项二"];
  $("subject").value = typeof saved.subject === "string" ? saved.subject.slice(0, 100) : "今天吃什么？";
  let rotation = 0, spinning = false, timer, result = "";
  const canvas = $("wheel"), ctx = canvas.getContext("2d");
  const persist = () => saveState("decision", { subject: $("subject").value, options });
  function subject() {
    const value = $("subject").value.trim();
    $("wheel-subject").textContent = value;
    $("wheel-subject").hidden = !value;
  }
  function draw() {
    ctx.clearRect(0, 0, 600, 600);
    const step = Math.PI * 2 / options.length, colors = ["#397d68", "#d6974b", "#6688aa", "#bd6a7b", "#8d83b2", "#6c9b75"];
    options.forEach((label, i) => {
      ctx.beginPath();
      ctx.moveTo(300, 300);
      ctx.arc(300, 300, 285, -Math.PI / 2 + i * step, -Math.PI / 2 + (i + 1) * step);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = "#ffffff88";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.translate(300, 300);
      ctx.rotate(-Math.PI / 2 + (i + 0.5) * step);
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${options.length > 12 ? 20 : 25}px system-ui`;
      ctx.textAlign = "right";
      ctx.fillText(label.length > 9 ? label.slice(0, 8) + "…" : label, 252, 8);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(300, 300, 38, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
  function edit() {
    result = "";
    $("winner").textContent = "准备好了就转一下";
    draw();
    persist();
  }
  function render() {
    $("options").replaceChildren();
    options.forEach((value, i) => {
      const row = text("div", "", "option-row"), input = document.createElement("input"), remove = text("button", "×");
      input.value = value;
      input.maxLength = 60;
      input.setAttribute("aria-label", `选项 ${i + 1}`);
      input.oninput = () => {
        options[i] = input.value;
        edit();
      };
      remove.setAttribute("aria-label", `删除选项 ${i + 1}`);
      remove.disabled = options.length <= 2;
      remove.onclick = () => {
        options.splice(i, 1);
        render();
        edit();
      };
      row.append(text("span", String(i + 1)), input, remove);
      $("options").append(row);
    });
    $("add").disabled = options.length >= 24;
    draw();
  }
  $("subject").oninput = () => {
    subject();
    persist();
    result = "";
    $("winner").textContent = "准备好了就转一下";
  };
  $("add").onclick = () => {
    if (options.length < 24) {
      options.push(`选项 ${options.length + 1}`);
      render();
      edit();
    }
  };
  $("spin").onclick = () => {
    if (spinning) return;
    if (options.some((x) => !x.trim())) {
      status("请先填写所有选项。", true);
      return;
    }
    const index = randomIndex(options.length);
    rotation = wheelTarget(rotation, index, options.length);
    spinning = true;
    status("转盘转动中…");
    $("spin").disabled = true;
    $("options").querySelectorAll("input,button").forEach((x) => x.disabled = true);
    $("add").disabled = true;
    $("subject").disabled = true;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 4200;
    canvas.style.transition = `transform ${duration}ms cubic-bezier(.15,.75,.12,1)`;
    canvas.style.transform = `rotate(${rotation}deg)`;
    timer = setTimeout(() => {
      if (signal.aborted) return;
      spinning = false;
      result = options[index];
      $("winner").textContent = result;
      status("决定好了！");
      $("spin").disabled = false;
      $("subject").disabled = false;
      render();
    }, duration);
  };
  copyButton("copy", () => result ? `${$("subject").value}
${result}` : "", copyText);
  subject();
  render();
  return () => clearTimeout(timer);
}
export {
  mount
};
