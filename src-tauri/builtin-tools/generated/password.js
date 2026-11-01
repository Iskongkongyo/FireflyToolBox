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
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("工具存储空间不足，当前修改尚未保存。请先导出或缩短内容。");
  }
}

// src-tauri/builtin-tools/src/random-data.js
function randomSource() {
  let buffer = new Uint32Array(512), index = buffer.length;
  return () => {
    if (index + 1 >= buffer.length) {
      crypto.getRandomValues(buffer);
      index = 0;
    }
    return BigInt(buffer[index++]) << 32n | BigInt(buffer[index++]);
  };
}
function randomBelow(bound, next = randomSource()) {
  if (bound < 1n || bound > 1n << 64n) throw new Error("随机范围无效。");
  if (bound === 1n) return 0n;
  const total = 1n << 64n, limit = total - total % bound;
  let value;
  do {
    value = next();
  } while (value >= limit);
  return value % bound;
}
function integer(value, min, max, name) {
  const n = Number(value);
  if (!String(value).trim() || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name}需为 ${min}～${max} 的整数。`);
  return n;
}
function randomStrings(options, next = randomSource()) {
  const count = integer(options.count, 1, 1e3, "数量"), length = integer(options.length, 1, 256, "长度");
  if (count * length > 65536) throw new Error("总字符数最多 65536，请减少数量或长度。");
  let groups = [];
  if (options.symbols && !String(options.symbolChars || "")) throw new Error("请填写已启用的符号库。");
  if (options.custom && !String(options.customChars || "")) throw new Error("请填写已启用的自定义字符库。");
  if (options.digits) {
    const from = integer(options.digitMin, 0, 9, "数字起点"), to = integer(options.digitMax, 0, 9, "数字终点");
    if (from > to) throw new Error("数字起点不能大于终点。");
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => String(from + i)));
  }
  if (options.lower) groups.push([..."abcdefghijklmnopqrstuvwxyz"]);
  if (options.upper) groups.push([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
  if (options.symbols) groups.push([...String(options.symbolChars || "")]);
  if (options.custom) groups.push([...String(options.customChars || "")]);
  groups = groups.map((g) => [...new Set(g)].filter((c) => !options.exclude || !"0O1Il".includes(c)));
  if (groups.some((g) => !g.length)) throw new Error("所选字符类别被全部排除，请调整字符库或排除选项。");
  const all = [...new Set(groups.flat())];
  if (!all.length) throw new Error("请至少启用一类有可用字符的字符库。");
  if (all.length > 4096) throw new Error("字符库最多 4096 个字符。");
  if (options.ensure && length < groups.length) throw new Error("长度小于所选字符类别数，无法每类至少包含一个字符。");
  const choose = (a) => a[Number(randomBelow(BigInt(a.length), next))], result = [];
  for (let i = 0; i < count; i++) {
    const chars = options.ensure ? groups.map(choose) : [];
    while (chars.length < length) chars.push(choose(all));
    if (options.ensure) for (let j = chars.length - 1; j > 0; j--) {
      const k = Number(randomBelow(BigInt(j + 1), next));
      [chars[j], chars[k]] = [chars[k], chars[j]];
    }
    result.push(chars.join(""));
  }
  return result;
}

// src-tauri/builtin-tools/src/password-data.js
var PASSWORD_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
function generatePassword(options, next) {
  const length = Number(options.length);
  if (!Number.isInteger(length) || length < 6 || length > 32) throw new Error("密码长度须为 6～32 位。");
  return randomStrings({ ...options, count: 1, length, digitMin: 0, digitMax: 9, symbolChars: PASSWORD_SYMBOLS, custom: false, ensure: true }, next)[0];
}
function passwordStrength(value) {
  const chars = [...String(value)], length = chars.length, classes = [/[0-9]/, /[a-z]/, /[A-Z]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length;
  let pool = (/[0-9]/.test(value) ? 10 : 0) + (/[a-z]/.test(value) ? 26 : 0) + (/[A-Z]/.test(value) ? 26 : 0) + (/[^a-zA-Z0-9]/.test(value) ? 32 : 0), score = length ? Math.min(100, length * Math.log2(Math.max(pool, 1))) : 0;
  const repeated = /(.)\1{2,}/u.test(value), sequence = /(0123|1234|2345|3456|4567|5678|6789|9876|abcd|bcde|cdef|defg|qwer|asdf|zxcv)/i.test(value), common = /(password|passwd|admin|letmein|welcome|iloveyou|123456|qwerty)/i.test(value);
  if (new Set(chars).size <= Math.max(2, length / 3)) score *= 0.35;
  if (repeated) score *= 0.6;
  if (sequence) score *= 0.65;
  if (common) score = Math.min(score, 20);
  if (length < 10) score = Math.min(score, 39);
  else if (length < 12) score = Math.min(score, 59);
  score = Math.round(score);
  const level = !length ? "未输入" : score < 40 ? "弱" : score < 60 ? "一般" : score < 80 ? "较强" : "强";
  const tips = [];
  if (length && length < 12) tips.push("建议至少 12 位");
  if (length && classes < 2) tips.push("可增加字符种类");
  if (common || sequence || repeated) tips.push("避免常见词、连续或重复字符");
  return { length, classes, score, level, tips };
}
function cleanPasswordFavorites(value) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v.id === "string" && typeof v.value === "string" && [...v.value].length >= 6 && [...v.value].length <= 32).slice(0, 30).map((v) => ({ id: v.id.slice(0, 64), value: v.value, label: String(v.label || "未命名").slice(0, 40) })) : [];
}

// src-tauri/builtin-tools/src/password.js
function mount({ copyText, signal }) {
  let favorites = cleanPasswordFavorites(loadState("password.favorites", [])), disposed = false;
  const save = (next) => {
    persist("password.favorites", next);
    favorites = next;
    render();
  };
  function render() {
    $("favorite-visibility").textContent = $("show").checked ? "密码已显示" : "密码已遮挡";
    $("favorites").replaceChildren();
    $("favorite-empty").hidden = !!favorites.length;
    $("favorite-count").textContent = `${favorites.length} / 30`;
    for (const item of favorites) {
      const card = text("article", "", "catalog-item"), title = text("strong", item.label), value = text("code", $("show").checked ? item.value : "•".repeat(item.value.length), "password-value"), actions = text("div", "", "actions");
      for (const [label, action] of [["使用", () => {
        $("password").value = item.value;
        update();
        status("已填入收藏密码。");
      }], ["复制", async () => {
        await copyText(item.value);
        if (!disposed) status("已复制收藏密码。");
      }], ["删除", () => {
        save(favorites.filter((v) => v.id !== item.id));
        status("已删除收藏。");
      }]]) {
        const b = text("button", label);
        b.onclick = async () => {
          try {
            await action();
          } catch (e) {
            if (!disposed) status(e.message, true);
          }
        };
        actions.append(b);
      }
      card.append(title, value, actions);
      $("favorites").append(card);
    }
  }
  function update() {
    const value = $("password").value, s = passwordStrength(value);
    $("strength").value = s.score;
    $("strength-label").textContent = s.level;
    $("strength-info").textContent = value ? `${s.length} 位 · ${s.classes} 类字符${s.tips.length ? " · " + s.tips.join("；") : ""}` : "";
    $("copy").disabled = !value;
    $("favorite").disabled = s.length < 6 || s.length > 32;
  }
  $("length").oninput = () => {
    const n = Number($("length").value);
    if (Number.isInteger(n) && n >= 6 && n <= 32) $("length-slider").value = n;
  };
  $("length-slider").oninput = () => {
    $("length").value = $("length-slider").value;
  };
  $("password").oninput = update;
  $("show").onchange = () => {
    $("password").type = $("show").checked ? "text" : "password";
    render();
  };
  $("generate").onclick = () => {
    try {
      $("password").value = generatePassword({ length: $("length").value, ...Object.fromEntries(["digits", "lower", "upper", "symbols", "exclude"].map((id) => [id, $(id).checked])) });
      update();
      status("密码已生成。");
    } catch (e) {
      status(e.message, true);
    }
  };
  copyButton("copy", () => $("password").value, copyText);
  $("favorite").onclick = () => {
    try {
      const value = $("password").value;
      if ([...value].length < 6 || [...value].length > 32) throw new Error("仅收藏 6～32 位密码。");
      if (favorites.some((v) => v.value === value)) throw new Error("这个密码已经收藏。");
      if (favorites.length >= 30) throw new Error("最多收藏 30 个密码，请先删除不需要的收藏。");
      save([{ id: newId(), value, label: $("label").value.trim() || "未命名" }, ...favorites]);
      status("密码已收藏。");
    } catch (e) {
      status(e.message, true);
    }
  };
  render();
  update();
  signal?.addEventListener("abort", () => {
    disposed = true;
  }, { once: true });
  return () => {
    disposed = true;
    $("password").value = "";
    favorites = [];
  };
}
export {
  mount
};
