// src-tauri/builtin-tools/src/diff-merge.js
function physicalLines(text) {
  const lines = [], breaks = /\r\n|\r|\n/g;
  let start = 0, match;
  while (match = breaks.exec(text)) {
    lines.push({ start, end: match.index + match[0].length, text: text.slice(start, match.index), no: lines.length + 1 });
    start = match.index + match[0].length;
  }
  if (start < text.length) lines.push({ start, end: text.length, text: text.slice(start), no: lines.length + 1 });
  return lines;
}
function lineSpan(text, numbers, beforeLine) {
  const lines = physicalLines(text);
  if (!Array.isArray(numbers) || numbers.some((number, i) => !Number.isInteger(number) || number < 1 || i > 0 && number <= numbers[i - 1])) throw new Error("差异位置已变化，请重新对比。");
  if (!numbers.length) {
    const offset = beforeLine == null ? text.length : lines[beforeLine - 1]?.start;
    if (!Number.isInteger(offset)) throw new Error("差异位置已变化，请重新对比。");
    return { start: offset, end: offset, text: "" };
  }
  const first = lines[numbers[0] - 1], last = lines[numbers[numbers.length - 1] - 1];
  if (!first || !last || first.start > last.end) throw new Error("差异位置已变化，请重新对比。");
  return { start: first.start, end: last.end, text: text.slice(first.start, last.end) };
}
function planLineMerge(target, source, targetLines, sourceLines, targetBefore, sourceBefore) {
  if (!targetLines.length && !sourceLines.length) throw new Error("没有可合并的差异内容。");
  const range = lineSpan(target, targetLines, targetBefore), donor = lineSpan(source, sourceLines, sourceBefore);
  const eol = target.match(/\r\n|\r|\n/)?.[0] || source.match(/\r\n|\r|\n/)?.[0] || "\n";
  let start = range.start, insert = donor.text.replace(/\r\n|\r|\n/g, eol);
  if (insert && start === target.length && start > 0 && !/[\r\n]$/.test(target)) insert = eol + insert;
  if (!insert && range.end === target.length && start > 0 && !/[\r\n]$/.test(source)) {
    const ending = target.slice(0, start).match(/(?:\r\n|\r|\n)$/);
    if (ending) start -= ending[0].length;
  }
  return { start, end: range.end, insert, removed: target.slice(start, range.end) };
}

// src-tauri/builtin-tools/src/diff.js
var PREFS_KEY = "diff_check.prefs.v1";
var CELL_CAP = 4e6;
var LINE_CAP = 8e3;
var FOLD_MIN = 15;
var FOLD_CTX = 3;
var WORD_BUDGET = 600;
var WORD_TOKENS = 420;
var MAX_BYTES = 4 * 1024 * 1024;
var SAMPLE_L = [
  "function greet(name) {",
  '  const text = "Hello, " + name;',
  "  console.log(text);",
  "  return text;",
  "}",
  "",
  'const users = ["Anna", "Ben", "Cara"];',
  "",
  "users.forEach((u) => {",
  "  greet(u);",
  "});"
].join("\n");
var SAMPLE_R = [
  'function greet(name, greeting = "Hello") {',
  '  const text = greeting + ", " + name + "!";',
  "  console.log(text);",
  "  return text;",
  "}",
  "",
  'const users = ["Anna", "Ben", "Cara", "Dan"];',
  "",
  "users.forEach((user) => {",
  "  greet(user);",
  "});"
].join("\n");
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function decodeBytes(buf) {
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch (e2) {
      text = new TextDecoder("utf-8").decode(buf);
    }
  }
  return text.replace(/^\uFEFF/, "");
}
function splitLines(text) {
  if (!text) return [];
  const arr = text.split(/\r\n|\r|\n/);
  if (arr.length && arr[arr.length - 1] === "" && /[\r\n]$/.test(text)) arr.pop();
  return arr.map((t, i) => ({ text: t, no: i + 1 }));
}
function bytesOf(str) {
  return new Blob([str]).size;
}
function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
function tokenize(s) {
  return s.match(/[\u3040-\u30ff\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[\s\S]/g) || [];
}
function lcsInto(a, b, s, ea, sb, eb, eq, ops) {
  const na = ea - s;
  const nb = eb - sb;
  const w = nb + 1;
  const dp = new Uint16Array((na + 1) * w);
  for (let i2 = na - 1; i2 >= 0; i2 -= 1) {
    const row = i2 * w;
    const next = (i2 + 1) * w;
    for (let j2 = nb - 1; j2 >= 0; j2 -= 1) {
      if (eq(a[s + i2], b[sb + j2])) dp[row + j2] = dp[next + j2 + 1] + 1;
      else dp[row + j2] = Math.max(dp[next + j2], dp[row + j2 + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < na && j < nb) {
    if (eq(a[s + i], b[sb + j])) {
      ops.push({ t: "=", i: s + i, j: sb + j });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ t: "-", i: s + i });
      i += 1;
    } else {
      ops.push({ t: "+", j: sb + j });
      j += 1;
    }
  }
  while (i < na) {
    ops.push({ t: "-", i: s + i });
    i += 1;
  }
  while (j < nb) {
    ops.push({ t: "+", j: sb + j });
    j += 1;
  }
}
function findAnchors(a, b, s, ea, sb, eb, keyOf) {
  const cntA = /* @__PURE__ */ new Map();
  const cntB = /* @__PURE__ */ new Map();
  const posB = /* @__PURE__ */ new Map();
  for (let i = s; i < ea; i += 1) {
    const k = keyOf(a[i]);
    cntA.set(k, (cntA.get(k) || 0) + 1);
  }
  for (let j = sb; j < eb; j += 1) {
    const k = keyOf(b[j]);
    cntB.set(k, (cntB.get(k) || 0) + 1);
    if (!posB.has(k)) posB.set(k, j);
  }
  const cand = [];
  for (let i = s; i < ea; i += 1) {
    const k = keyOf(a[i]);
    if (cntA.get(k) === 1 && cntB.get(k) === 1) cand.push([i, posB.get(k)]);
  }
  if (!cand.length) return [];
  const tails = [];
  const prev = new Array(cand.length).fill(-1);
  for (let k = 0; k < cand.length; k += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (cand[tails[mid]][1] < cand[k][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out = [];
  let cur = tails.length ? tails[tails.length - 1] : -1;
  while (cur >= 0) {
    out.push(cand[cur]);
    cur = prev[cur];
  }
  out.reverse();
  return out;
}
function diffRange(a, b, s, ea, sb, eb, eq, keyOf, ops, depth) {
  while (s < ea && sb < eb && eq(a[s], b[sb])) {
    ops.push({ t: "=", i: s, j: sb });
    s += 1;
    sb += 1;
  }
  let xa = ea;
  let xb = eb;
  while (xa > s && xb > sb && eq(a[xa - 1], b[xb - 1])) {
    xa -= 1;
    xb -= 1;
  }
  const na = xa - s;
  const nb = xb - sb;
  if (na === 0 || nb === 0) {
    for (let i = s; i < xa; i += 1) ops.push({ t: "-", i });
    for (let j = sb; j < xb; j += 1) ops.push({ t: "+", j });
  } else if (na * nb <= CELL_CAP || depth > 12) {
    lcsInto(a, b, s, xa, sb, xb, eq, ops);
  } else {
    const anchors = findAnchors(a, b, s, xa, sb, xb, keyOf);
    if (!anchors.length) {
      for (let i = s; i < xa; i += 1) ops.push({ t: "-", i });
      for (let j = sb; j < xb; j += 1) ops.push({ t: "+", j });
    } else {
      let pa = s;
      let pb = sb;
      for (let k = 0; k < anchors.length; k += 1) {
        const ai = anchors[k][0];
        const bi = anchors[k][1];
        diffRange(a, b, pa, ai, pb, bi, eq, keyOf, ops, depth + 1);
        ops.push({ t: "=", i: ai, j: bi });
        pa = ai + 1;
        pb = bi + 1;
      }
      diffRange(a, b, pa, xa, pb, xb, eq, keyOf, ops, depth + 1);
    }
  }
  while (xa < ea && xb < eb) {
    ops.push({ t: "=", i: xa, j: xb });
    xa += 1;
    xb += 1;
  }
}
function diffSeq(a, b, eq, keyOf) {
  const ops = [];
  const key = keyOf || ((x) => String(x));
  diffRange(a, b, 0, a.length, 0, b.length, eq, key, ops, 0);
  return ops;
}
function wordDiff(left, right, eqTok) {
  const ta = tokenize(left);
  const tb = tokenize(right);
  if (ta.length > WORD_TOKENS || tb.length > WORD_TOKENS) return null;
  const ops = diffSeq(ta, tb, eqTok);
  let lh = "";
  let rh = "";
  let del = "";
  let ins = "";
  const flushDel = () => {
    if (del) {
      lh += '<em class="d">' + del + "</em>";
      del = "";
    }
  };
  const flushIns = () => {
    if (ins) {
      rh += '<em class="i">' + ins + "</em>";
      ins = "";
    }
  };
  for (let k = 0; k < ops.length; k += 1) {
    const op = ops[k];
    if (op.t === "=") {
      flushDel();
      flushIns();
      lh += esc(ta[op.i]);
      rh += esc(tb[op.j]);
    } else if (op.t === "-") {
      del += esc(ta[op.i]);
    } else {
      ins += esc(tb[op.j]);
    }
  }
  flushDel();
  flushIns();
  return { l: lh, r: rh };
}
function mount(app) {
  const signal = app && app.signal;
  const $ = (sel) => document.querySelector(sel);
  const root = $("#diff");
  const inputView = $("#inputView");
  const resultView = $("#resultView");
  const editorL = $("#taLeft");
  const editorR = $("#taRight");
  const nameL = $("#nameLeft");
  const nameR = $("#nameRight");
  const metaL = $("#metaLeft");
  const metaR = $("#metaRight");
  const hintL = $("#hintLeft");
  const hintR = $("#hintRight");
  const btnCompare = $("#btnCompare");
  const btnSample = $("#btnSample");
  const btnSwap = $("#btnSwap");
  const btnClear = $("#btnClear");
  const btnEdit = $("#btnEdit");
  const btnCopy = $("#btnCopy");
  const btnSave = $("#btnSave");
  const btnPrev = $("#btnPrev");
  const btnNext = $("#btnNext");
  const navPos = $("#navPos");
  const statAdd = $("#statAdd");
  const statDel = $("#statDel");
  const statChg = $("#statChg");
  const statSim = $("#statSim");
  const paneL = $("#paneLeft");
  const paneR = $("#paneRight");
  const bodyL = $("#bodyLeft");
  const bodyR = $("#bodyRight");
  const paneRwrap = $("#paneRightWrap");
  const headLeft = $("#headLeft");
  const headRight = $("#headRight");
  const statusEl = $("#status");
  const emptyState = $("#emptyState");
  const emptyText = $("#emptyText");
  const segView = $("#segView");
  const optCase = $("#optCase");
  const optSpace = $("#optSpace");
  const optBlank = $("#optBlank");
  const optSync = $("#optSync");
  const optWrap = $("#optWrap");
  const optCvd = $("#optCvd");
  const fillL = $("#fillLeft");
  const fillR = $("#fillRight");
  const mergeDialog = $("#mergeDialog");
  const undoMerge = $("#btnUndoMerge");
  const contentExport = $("#contentExport");
  const prefs = loadPrefs();
  const state = {
    view: prefs.view,
    ignoreCase: prefs.ignoreCase,
    ignoreSpace: prefs.ignoreSpace,
    ignoreBlank: prefs.ignoreBlank,
    sync: prefs.sync,
    wrap: prefs.wrap,
    cvd: prefs.cvd,
    left: { text: "", name: "", size: 0 },
    right: { text: "", name: "", size: 0 }
  };
  let rows = [];
  let navRows = [];
  let navIdx = -1;
  let folds = {};
  let expanded = {};
  let statusTimer = 0;
  let isNarrow = false;
  const effView = () => isNarrow ? "unified" : state.view;
  let busy = false;
  let disposed = false;
  let blocks = [], selectedMerge = null, mergeHistory = [], mergeHistoryBytes = 0;
  function clearMergeHistory() {
    mergeHistory = [];
    mergeHistoryBytes = 0;
    undoMerge.disabled = true;
  }
  function closeMerge() {
    selectedMerge = null;
    if (mergeDialog.open) mergeDialog.close();
  }
  function loadPrefs() {
    const base = { view: "split", ignoreCase: false, ignoreSpace: false, ignoreBlank: false, sync: true, wrap: false, cvd: false };
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return base;
      const s = JSON.parse(raw);
      if (s.view === "split" || s.view === "unified") base.view = s.view;
      ["ignoreCase", "ignoreSpace", "ignoreBlank", "sync", "wrap", "cvd"].forEach((k) => {
        if (typeof s[k] === "boolean") base[k] = s[k];
      });
      return base;
    } catch (e) {
      return base;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        view: state.view,
        ignoreCase: state.ignoreCase,
        ignoreSpace: state.ignoreSpace,
        ignoreBlank: state.ignoreBlank,
        sync: state.sync,
        wrap: state.wrap,
        cvd: state.cvd
      }));
    } catch (e) {
    }
    try {
      const flush = app && app.storage && app.storage.flush;
      if (typeof flush === "function") Promise.resolve(flush.call(app.storage)).catch(() => {
      });
    } catch (e) {
    }
  }
  function toast(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (!disposed) statusEl.classList.remove("show");
    }, 2600);
  }
  function syncInputMeta() {
    const l = state.left;
    const r = state.right;
    nameL.textContent = l.name || "粘贴文本";
    nameR.textContent = r.name || "粘贴文本";
    nameL.classList.toggle("file", !!l.name);
    nameR.classList.toggle("file", !!r.name);
    metaL.textContent = l.text ? l.text.split(/\r\n|\r|\n/).length + " 行 · " + fmtBytes(bytesOf(l.text)) : "空";
    metaR.textContent = r.text ? r.text.split(/\r\n|\r|\n/).length + " 行 · " + fmtBytes(bytesOf(r.text)) : "空";
    hintL.hidden = !!l.text;
    hintR.hidden = !!r.text;
    btnCompare.disabled = !l.text && !r.text;
  }
  function setSide(side, text, name) {
    clearMergeHistory();
    const s = side === "left" ? state.left : state.right;
    s.text = text;
    s.name = name || "";
    if (side === "left") editorL.value = text;
    else editorR.value = text;
    syncInputMeta();
  }
  function normLine(t) {
    let s = t;
    if (state.ignoreSpace) s = s.replace(/[\s\u3000]+/g, " ").trim();
    if (state.ignoreCase) s = s.toLowerCase();
    return s;
  }
  function compare() {
    if (disposed || busy) return;
    closeMerge();
    const lText = editorL.value;
    const rText = editorR.value;
    state.left.text = lText;
    state.right.text = rText;
    if (!lText && !rText && resultView.hidden) {
      toast("两边都还是空的");
      return;
    }
    let la = splitLines(lText);
    let rb = splitLines(rText);
    if (state.ignoreBlank) {
      la = la.filter((x) => x.text.trim() !== "");
      rb = rb.filter((x) => x.text.trim() !== "");
    }
    if (la.length > LINE_CAP || rb.length > LINE_CAP) {
      toast("行数超过 " + LINE_CAP + "，已按整块替换处理");
    }
    const eq = (x, y) => normLine(x.text) === normLine(y.text);
    const ops = diffSeq(la, rb, eq, (x) => normLine(x.text));
    const segs = [];
    let cur = null;
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (op.t === "=") {
        if (!cur || cur.type !== "eq") {
          cur = { type: "eq", items: [] };
          segs.push(cur);
        }
        cur.items.push({ l: la[op.i], r: rb[op.j] });
      } else {
        if (!cur || cur.type !== "chg") {
          cur = { type: "chg", dels: [], inss: [] };
          segs.push(cur);
        }
        if (op.t === "-") cur.dels.push(la[op.i]);
        else cur.inss.push(rb[op.j]);
      }
    }
    let add = 0;
    let del = 0;
    let chg = 0;
    let eqLines = 0;
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      if (s.type === "eq") eqLines += s.items.length;
      else {
        chg += 1;
        add += s.inss.length;
        del += s.dels.length;
      }
    }
    const total = Math.max(1, Math.max(la.length, rb.length));
    let sim = Math.round(eqLines / total * 100);
    if (sim >= 100 && (add > 0 || del > 0)) sim = 99;
    let nextLeft = null, nextRight = null;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].type === "eq") {
        nextLeft = segs[i].items[0].l.no;
        nextRight = segs[i].items[0].r.no;
      } else {
        segs[i].nextLeft = nextLeft;
        segs[i].nextRight = nextRight;
      }
    }
    rows = [];
    blocks = [];
    let wordCount = 0;
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      if (s.type === "eq") {
        for (let k = 0; k < s.items.length; k += 1) {
          rows.push({ k: "eq", l: s.items[k].l, r: s.items[k].r });
        }
      } else {
        const block = blocks.length;
        blocks.push({ left: s.dels.map((line) => line.no), right: s.inss.map((line) => line.no), nextLeft: s.nextLeft, nextRight: s.nextRight });
        const n = Math.max(s.dels.length, s.inss.length);
        for (let k = 0; k < n; k += 1) {
          const L = s.dels[k] || null;
          const R = s.inss[k] || null;
          let hl = null;
          if (L && R && wordCount < WORD_BUDGET) {
            wordCount += 1;
            hl = wordDiff(L.text, R.text, (x, y) => normLine(x) === normLine(y));
          }
          rows.push({ k: L && R ? "chg" : L ? "del" : "ins", l: L, r: R, hl, first: k === 0, block });
        }
      }
    }
    navRows = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].k !== "eq" && (i === 0 || rows[i - 1].k === "eq")) navRows.push(i);
    }
    navIdx = -1;
    expanded = {};
    buildFolds();
    statAdd.textContent = "+" + add;
    statDel.textContent = "−" + del;
    statChg.textContent = chg + " 处";
    statSim.textContent = sim + "%";
    statAdd.classList.toggle("zero", add === 0);
    statDel.classList.toggle("zero", del === 0);
    statChg.classList.toggle("zero", chg === 0);
    statSim.classList.toggle("zero", sim === 100);
    statSim.classList.toggle("warn", sim < 80 && sim >= 40);
    statSim.classList.toggle("bad", sim < 40);
    headLeft.textContent = state.left.name || "原文本";
    headRight.textContent = state.right.name || "新文本";
    const ignored = [];
    if (state.ignoreCase) ignored.push("大小写");
    if (state.ignoreSpace) ignored.push("空白");
    if (state.ignoreBlank) ignored.push("空行");
    emptyText.textContent = ignored.length ? "忽略" + ignored.join("、") + "后，两边内容一致" : "两边内容完全一致，没有发现差异";
    inputView.hidden = true;
    resultView.hidden = false;
    emptyState.hidden = navRows.length > 0;
    render();
    syncNav();
    savePrefs();
  }
  function openMerge(index) {
    const block = blocks[index];
    if (!block || disposed) return;
    const left = editorL.value, right = editorR.value;
    selectedMerge = { index, block, left, right };
    const a = lineSpan(left, block.left, block.nextLeft), b = lineSpan(right, block.right, block.nextRight);
    const label = (numbers, before) => numbers.length ? "第 " + numbers[0] + (numbers.length > 1 ? "～" + numbers[numbers.length - 1] : "") + " 行" : before == null ? "末尾插入位置" : "第 " + before + " 行前";
    $("#mergePosition").textContent = index + 1 + " / " + blocks.length;
    $("#mergeOldRange").textContent = (state.left.name ? state.left.name + " · " : "") + label(block.left, block.nextLeft);
    $("#mergeNewRange").textContent = (state.right.name ? state.right.name + " · " : "") + label(block.right, block.nextRight);
    const preview = (text) => !text ? "（此处无内容）" : text.length <= 6e4 ? text : text.slice(0, 6e4).replace(/[\uD800-\uDBFF]$/, "") + "\n…（仅预览前 6 万字符，合并使用完整内容）";
    $("#mergeOldText").textContent = preview(a.text);
    $("#mergeNewText").textContent = preview(b.text);
    $("#mergePrev").disabled = index === 0;
    $("#mergeNext").disabled = index === blocks.length - 1;
    if (!mergeDialog.open) mergeDialog.showModal();
  }
  function refreshAfterMerge(preferred) {
    syncInputMeta();
    compare();
    if (navRows.length) {
      navIdx = Math.min(preferred, navRows.length - 1) - 1;
      gotoNav(1);
      bodyL.querySelector('[data-r="' + navRows[navIdx] + '"]')?.focus({ preventScroll: true });
    }
    undoMerge.disabled = !mergeHistory.length;
  }
  function applyMerge(target) {
    const chosen = selectedMerge;
    if (!chosen || !mergeDialog.open) return;
    if (editorL.value !== chosen.left || editorR.value !== chosen.right) {
      closeMerge();
      compare();
      toast("内容已变化，请重新选择差异块。");
      return;
    }
    const source = target === "left" ? "right" : "left", block = chosen.block;
    try {
      const patch = planLineMerge(chosen[target], chosen[source], block[target], block[source], block[target === "left" ? "nextLeft" : "nextRight"], block[source === "left" ? "nextLeft" : "nextRight"]);
      const text = chosen[target].slice(0, patch.start) + patch.insert + chosen[target].slice(patch.end);
      if (bytesOf(text) > 32 * 1024 * 1024) throw new Error("合并后内容超过 32 MiB，请分段处理。");
      const entry = { side: target, start: patch.start, removed: patch.removed, inserted: patch.insert, bytes: (patch.removed.length + patch.insert.length) * 2 };
      mergeHistory.push(entry);
      mergeHistoryBytes += entry.bytes;
      while (mergeHistory.length > 20 || mergeHistoryBytes > 8 * 1024 * 1024 && mergeHistory.length > 1) mergeHistoryBytes -= mergeHistory.shift().bytes;
      (target === "left" ? editorL : editorR).value = text;
      state[target].text = text;
      closeMerge();
      refreshAfterMerge(chosen.index);
      toast("已合并到" + (target === "left" ? "旧内容" : "新内容") + "，可撤销或另存。");
    } catch (error) {
      toast(error.message || "合并失败，请重新对比。");
    }
  }
  function revertMerge() {
    const entry = mergeHistory[mergeHistory.length - 1];
    if (!entry) return;
    const editor = entry.side === "left" ? editorL : editorR, current = editor.value;
    if (current.slice(entry.start, entry.start + entry.inserted.length) !== entry.inserted) {
      clearMergeHistory();
      toast("内容已变化，无法撤销这次合并。");
      return;
    }
    mergeHistory.pop();
    mergeHistoryBytes -= entry.bytes;
    editor.value = current.slice(0, entry.start) + entry.removed + current.slice(entry.start + entry.inserted.length);
    state[entry.side].text = editor.value;
    closeMerge();
    refreshAfterMerge(0);
    toast("已撤销上次合并。");
  }
  async function exportContent(action) {
    const [kind, side] = action.split("-"), value = side === "left" ? editorL.value : editorR.value;
    contentExport.open = false;
    try {
      if (kind === "copy") {
        if (typeof app.copyText !== "function") throw new Error("复制接口不可用。");
        await app.copyText(value);
        toast("已复制" + (side === "left" ? "旧内容" : "新内容") + "。");
      } else {
        if (!value) throw new Error("内容为空，请先输入或合并内容。");
        const name = state[side].name || (side === "left" ? "旧内容.txt" : "新内容.txt"), dot = name.lastIndexOf(".");
        const output = dot > 0 ? name.slice(0, dot) + "-合并" + name.slice(dot) : name + "-合并.txt";
        const ok = await app.saveFile(output, new Blob([value], { type: "text/plain;charset=utf-8" }), { signal });
        toast(ok ? "内容已另存。" : "已取消另存。");
      }
    } catch (error) {
      toast("导出失败：" + error.message);
    }
  }
  $("#mergeToNew").addEventListener("click", () => applyMerge("right"));
  $("#mergeToOld").addEventListener("click", () => applyMerge("left"));
  $("#mergeClose").addEventListener("click", closeMerge);
  $("#mergePrev").addEventListener("click", () => {
    if (selectedMerge) openMerge(selectedMerge.index - 1);
  });
  $("#mergeNext").addEventListener("click", () => {
    if (selectedMerge) openMerge(selectedMerge.index + 1);
  });
  mergeDialog.addEventListener("close", () => {
    if (!mergeDialog.open) selectedMerge = null;
  });
  mergeDialog.addEventListener("click", (event) => {
    const r = mergeDialog.getBoundingClientRect();
    if (event.target === mergeDialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) closeMerge();
  });
  undoMerge.addEventListener("click", revertMerge);
  contentExport.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (button) void exportContent(button.dataset.export);
  });
  function buildFolds() {
    folds = {};
    let i = 0;
    while (i < rows.length) {
      if (rows[i].k !== "eq") {
        i += 1;
        continue;
      }
      let j = i;
      while (j < rows.length && rows[j].k === "eq") j += 1;
      const len = j - i;
      if (len >= FOLD_MIN) {
        folds[i] = { from: i, to: j - 1, head: FOLD_CTX, tail: FOLD_CTX };
      }
      i = j;
    }
  }
  function mergeAttributes(row) {
    return row.k === "eq" ? "" : ' data-merge="' + row.block + '" role="button" tabindex="' + (row.first ? "0" : "-1") + '" aria-haspopup="dialog" aria-label="查看第 ' + (row.block + 1) + ' 处差异并合并" title="点击查看差异块并合并"';
  }
  function rowHtmlL(row, idx, isNav) {
    const cls = row.k === "eq" ? "eq" : row.k === "ins" ? "blank" : "del";
    const ln = row.l ? row.l.no : "";
    let tx;
    if (!row.l) tx = "";
    else if (row.hl && row.hl.l) tx = row.hl.l;
    else tx = esc(row.l.text) || "&nbsp;";
    return '<div class="row ' + cls + (isNav ? " nav" : "") + '" data-r="' + idx + '"' + mergeAttributes(row) + '><span class="ln">' + ln + '</span><span class="tx">' + tx + "</span></div>";
  }
  function rowHtmlR(row, idx, isNav) {
    const cls = row.k === "eq" ? "eq" : row.k === "del" ? "blank" : "ins";
    const ln = row.r ? row.r.no : "";
    let tx;
    if (!row.r) tx = "";
    else if (row.hl && row.hl.r) tx = row.hl.r;
    else tx = esc(row.r.text) || "&nbsp;";
    return '<div class="row ' + cls + (isNav ? " nav" : "") + '" data-r="' + idx + '"' + mergeAttributes(row) + '><span class="ln">' + ln + '</span><span class="tx">' + tx + "</span></div>";
  }
  function rowHtmlU(row, idx, isNav) {
    const nav = isNav ? " nav" : "";
    const cell = (cls, lno, rno, sign, tx) => '<div class="row u ' + cls + nav + '" data-r="' + idx + '"' + mergeAttributes(row) + '><span class="ln">' + lno + '</span><span class="ln">' + rno + '</span><span class="sg">' + sign + '</span><span class="tx">' + (tx || "&nbsp;") + "</span></div>";
    if (row.k === "eq") {
      return cell("eq", row.l ? row.l.no : "", row.r ? row.r.no : "", " ", esc(row.l ? row.l.text : ""));
    }
    if (row.k === "del") {
      return cell("del", row.l.no, "", "−", esc(row.l.text));
    }
    if (row.k === "ins") {
      return cell("ins", "", row.r.no, "+", esc(row.r.text));
    }
    const leftTx = row.hl ? row.hl.l : esc(row.l.text);
    const rightTx = row.hl ? row.hl.r : esc(row.r.text);
    return cell("del", row.l.no, "", "−", leftTx) + cell("ins", "", row.r.no, "+", rightTx);
  }
  function foldHtml(from, to, count) {
    return '<div class="fold" data-fold="' + from + '"><span class="fold-line"></span><button type="button" class="fold-btn" data-expand="' + from + '">展开 ' + count + ' 行相同内容</button><span class="fold-line"></span></div>';
  }
  function render() {
    if (disposed) return;
    const navSet = {};
    for (let i = 0; i < navRows.length; i += 1) navSet[navRows[i]] = true;
    if (effView() === "unified") {
      let html = "";
      let i = 0;
      while (i < rows.length) {
        const f = folds[i];
        if (f && !expanded[i]) {
          for (let k = f.from; k < f.from + f.head; k += 1) html += rowHtmlU(rows[k], k, navSet[k]);
          const hidden = f.to - f.from + 1 - f.head - f.tail;
          html += foldHtml(f.from, f.to, hidden);
          for (let k = f.to - f.tail + 1; k <= f.to; k += 1) html += rowHtmlU(rows[k], k, navSet[k]);
          i = f.to + 1;
        } else {
          html += rowHtmlU(rows[i], i, navSet[i]);
          i += 1;
        }
      }
      bodyL.innerHTML = html;
      paneRwrap.hidden = true;
      paneL.classList.add("unified");
    } else {
      let hl = "";
      let hr = "";
      let i = 0;
      while (i < rows.length) {
        const f = folds[i];
        if (f && !expanded[i]) {
          for (let k = f.from; k < f.from + f.head; k += 1) {
            hl += rowHtmlL(rows[k], k, navSet[k]);
            hr += rowHtmlR(rows[k], k, navSet[k]);
          }
          const hidden = f.to - f.from + 1 - f.head - f.tail;
          const filler = foldHtml(f.from, f.to, hidden);
          hl += filler;
          hr += filler;
          for (let k = f.to - f.tail + 1; k <= f.to; k += 1) {
            hl += rowHtmlL(rows[k], k, navSet[k]);
            hr += rowHtmlR(rows[k], k, navSet[k]);
          }
          i = f.to + 1;
        } else {
          hl += rowHtmlL(rows[i], i, navSet[i]);
          hr += rowHtmlR(rows[i], i, navSet[i]);
          i += 1;
        }
      }
      bodyL.innerHTML = hl;
      bodyR.innerHTML = hr;
      paneRwrap.hidden = false;
      paneL.classList.remove("unified");
    }
    applyOptics();
  }
  function applyOptics() {
    const wrapOn = state.wrap || isNarrow;
    root.classList.toggle("wrap", wrapOn);
    root.classList.toggle("split", effView() === "split");
    root.classList.toggle("narrow", isNarrow);
    root.classList.toggle("cvd", state.cvd);
    optWrap.checked = wrapOn;
    optWrap.disabled = isNarrow;
    const label = optWrap.parentElement;
    if (label) label.title = isNarrow ? "窄屏下自动换行已强制开启" : "";
  }
  function syncNav() {
    if (!navRows.length) {
      navPos.textContent = "无差异";
      btnPrev.disabled = true;
      btnNext.disabled = true;
      return;
    }
    btnPrev.disabled = false;
    btnNext.disabled = false;
    navPos.textContent = navIdx + 1 + " / " + navRows.length;
  }
  function gotoNav(dir) {
    if (!navRows.length) return;
    if (navIdx < 0) navIdx = dir > 0 ? 0 : navRows.length - 1;
    else navIdx = (navIdx + dir + navRows.length) % navRows.length;
    syncNav();
    const target = navRows[navIdx];
    const el = bodyL.querySelector('[data-r="' + target + '"]');
    const el2 = bodyR.querySelector('[data-r="' + target + '"]');
    bodyL.querySelectorAll(".row.flash").forEach((n) => n.classList.remove("flash"));
    bodyR.querySelectorAll(".row.flash").forEach((n) => n.classList.remove("flash"));
    if (el) el.classList.add("flash");
    if (el2) el2.classList.add("flash");
    if (!el) return;
    const top = Math.max(0, el.offsetTop - paneL.clientHeight / 2 + el.offsetHeight / 2);
    const maxA = paneL.scrollHeight - paneL.clientHeight;
    const maxB = paneR.scrollHeight - paneR.clientHeight;
    syncing = true;
    paneL.scrollTop = top;
    if (effView() === "split" && maxA > 0 && maxB > 0) paneR.scrollTop = top / maxA * maxB;
    window.setTimeout(() => {
      syncing = false;
    }, 60);
  }
  let syncing = false;
  function syncFrom(src, dst) {
    if (!state.sync || effView() !== "split" || syncing) return;
    const maxA = src.scrollHeight - src.clientHeight;
    const maxB = dst.scrollHeight - dst.clientHeight;
    if (maxA <= 0 || maxB <= 0) return;
    syncing = true;
    dst.scrollTop = src.scrollTop / maxA * maxB;
    window.requestAnimationFrame(() => {
      syncing = false;
    });
  }
  const EXT12 = ["txt", "md", "json", "js", "ts", "css", "html", "csv", "log", "py", "xml", "yml"];
  async function pickFile(side) {
    if (disposed || busy) return;
    if (typeof app.openFile === "function") {
      busy = true;
      try {
        let file = null;
        try {
          file = await app.openFile({ signal });
        } catch (e1) {
          file = await app.openFile({ extensions: EXT12, signal });
        }
        if (!file) return;
        await readFileInto(side, file);
      } catch (e) {
        toast("读取失败：" + (e && e.message ? e.message : "未知错误"));
      } finally {
        busy = false;
      }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,.json,.js,.ts,.css,.html,.csv,.log,.py,.java,.go,.rs,.c,.cpp,.xml,.yml,.yaml,text/*";
    input.onchange = () => {
      if (input.files && input.files[0]) readBlobInto(side, input.files[0], input.files[0].name);
    };
    input.click();
  }
  function looksBinary(bytes) {
    const n = Math.min(bytes.length, 4096);
    let zero = 0;
    for (let i = 0; i < n; i += 1) if (bytes[i] === 0) zero += 1;
    return zero > n * 0.02;
  }
  async function readFileInto(side, file) {
    if (!file || !file.blob) return;
    if (file.blob.size > MAX_BYTES) toast("文件超过 4 MB，可能很卡，仍会尝试读取");
    const buf = await file.blob.arrayBuffer();
    if (looksBinary(new Uint8Array(buf))) {
      toast("这看起来是二进制文件，结果可能没有意义");
    }
    setSide(side, decodeBytes(buf), file.name || "");
    toast("已载入 " + (file.name || "文件"));
  }
  async function readBlobInto(side, blob, name) {
    if (blob.size > MAX_BYTES) toast("文件超过 4 MB，可能很卡，仍会尝试读取");
    const buf = await blob.arrayBuffer();
    if (looksBinary(new Uint8Array(buf))) {
      toast("这看起来是二进制文件，结果可能没有意义");
    }
    setSide(side, decodeBytes(buf), name || "");
    toast("已载入 " + (name || "文件"));
  }
  function bindDrop(el, side) {
    const mark = (on) => el.classList.toggle("dragover", on);
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      mark(true);
    });
    el.addEventListener("dragleave", () => mark(false));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      mark(false);
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readBlobInto(side, f, f.name);
    });
  }
  function unifiedText() {
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (r.k === "eq") out.push("  " + (r.l ? r.l.text : ""));
      else if (r.k === "del") out.push("- " + r.l.text);
      else if (r.k === "ins") out.push("+ " + r.r.text);
      else {
        if (r.l) out.push("- " + r.l.text);
        if (r.r) out.push("+ " + r.r.text);
      }
    }
    return out.join("\n");
  }
  async function copyDiff() {
    const text = unifiedText();
    if (!text) {
      toast("还没有对比结果");
      return;
    }
    try {
      if (typeof app.copyText === "function") await app.copyText(text);
      else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else throw new Error("unsupported");
      toast("差异已复制");
    } catch (e) {
      toast("复制失败，请手动选中");
    }
  }
  async function saveDiff() {
    if (!rows.length) {
      toast("还没有对比结果");
      return;
    }
    const text = unifiedText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const d = /* @__PURE__ */ new Date();
    const p = (n) => n < 10 ? "0" + n : "" + n;
    const name = "diff-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".txt";
    try {
      if (typeof app.saveFile === "function") {
        const ok = await app.saveFile(name, blob, { signal });
        toast(ok ? "已保存 " + name : "已取消保存");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4e3);
        toast("已下载 " + name);
      }
    } catch (e) {
      toast("保存失败：" + (e && e.message ? e.message : "未知错误"));
    }
  }
  const onCompare = () => compare();
  const onSample = () => {
    editorL.value = SAMPLE_L;
    editorR.value = SAMPLE_R;
    setSide("left", SAMPLE_L, "greet.js");
    setSide("right", SAMPLE_R, "greet.new.js");
    toast("已载入示例");
  };
  const onSwap = () => {
    const l = editorL.value;
    editorL.value = editorR.value;
    editorR.value = l;
    const ln = state.left.name;
    setSide("left", editorL.value, state.right.name);
    setSide("right", editorR.value, ln);
    toast("已左右交换");
  };
  const onClear = () => {
    editorL.value = "";
    editorR.value = "";
    setSide("left", "", "");
    setSide("right", "", "");
    toast("已清空");
  };
  const onEdit = () => {
    inputView.hidden = false;
    resultView.hidden = true;
  };
  const onViewClick = (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    state.view = b.getAttribute("data-view");
    syncToggles();
    savePrefs();
    applyOptics();
    render();
    syncNav();
  };
  const onFoldClick = (e) => {
    const b = e.target.closest("[data-expand]");
    if (b) {
      expanded[b.getAttribute("data-expand")] = true;
      render();
      return;
    }
    const change = e.target.closest("[data-merge]");
    if (change && window.getSelection()?.isCollapsed !== false) openMerge(Number(change.dataset.merge));
  };
  const onPaneScroll = (e) => {
    if (e.target === paneL) syncFrom(paneL, paneR);
    else syncFrom(paneR, paneL);
  };
  const onOpt = () => {
    state.ignoreCase = optCase.checked;
    state.ignoreSpace = optSpace.checked;
    state.ignoreBlank = optBlank.checked;
    state.sync = optSync.checked;
    state.cvd = optCvd.checked;
    if (!isNarrow) state.wrap = optWrap.checked;
    savePrefs();
    applyOptics();
    if (rows.length) compare();
  };
  const onKey = (e) => {
    if (mergeDialog.open) return;
    if (e.key === "Escape" && contentExport.open) {
      contentExport.open = false;
      contentExport.querySelector("summary").focus();
      return;
    }
    const change = e.target.closest?.("[data-merge]");
    if (change && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openMerge(Number(change.dataset.merge));
      return;
    }
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        compare();
      }
      return;
    }
    if (e.target && /^(BUTTON|SELECT|A)$/.test(e.target.tagName)) return;
    if (e.key === "Enter" && !resultView.hidden) {
      e.preventDefault();
      gotoNav(e.shiftKey ? -1 : 1);
    }
  };
  function syncToggles() {
    segView.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-view") === state.view);
    });
    optCase.checked = state.ignoreCase;
    optSpace.checked = state.ignoreSpace;
    optBlank.checked = state.ignoreBlank;
    optSync.checked = state.sync;
    optWrap.checked = state.wrap;
    optCvd.checked = state.cvd;
  }
  btnCompare.addEventListener("click", onCompare);
  btnSample.addEventListener("click", onSample);
  btnSwap.addEventListener("click", onSwap);
  btnClear.addEventListener("click", onClear);
  btnEdit.addEventListener("click", onEdit);
  btnCopy.addEventListener("click", copyDiff);
  btnSave.addEventListener("click", saveDiff);
  btnPrev.addEventListener("click", () => gotoNav(-1));
  btnNext.addEventListener("click", () => gotoNav(1));
  segView.addEventListener("click", onViewClick);
  fillL.addEventListener("click", () => pickFile("left"));
  fillR.addEventListener("click", () => pickFile("right"));
  paneL.addEventListener("scroll", onPaneScroll, { passive: true });
  paneR.addEventListener("scroll", onPaneScroll, { passive: true });
  resultView.addEventListener("click", onFoldClick);
  [optCase, optSpace, optBlank, optSync, optWrap, optCvd].forEach((el) => el.addEventListener("change", onOpt));
  editorL.addEventListener("input", () => {
    clearMergeHistory();
    state.left.text = editorL.value;
    if (state.left.name) state.left.name = "";
    syncInputMeta();
  });
  editorR.addEventListener("input", () => {
    clearMergeHistory();
    state.right.text = editorR.value;
    if (state.right.name) state.right.name = "";
    syncInputMeta();
  });
  document.addEventListener("keydown", onKey);
  const onOutsideExport = (event) => {
    if (!contentExport.contains(event.target)) contentExport.open = false;
  };
  document.addEventListener("click", onOutsideExport);
  bindDrop($("#editorLeft"), "left");
  bindDrop($("#editorRight"), "right");
  const mq = window.matchMedia("(max-width: 820px)");
  const onMq = () => {
    const next = mq.matches;
    if (next === isNarrow) return;
    isNarrow = next;
    applyOptics();
    if (rows.length) render();
    syncNav();
  };
  isNarrow = mq.matches;
  if (mq.addEventListener) mq.addEventListener("change", onMq);
  else if (mq.addListener) mq.addListener(onMq);
  syncToggles();
  syncInputMeta();
  applyOptics();
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    closeMerge();
    clearMergeHistory();
    window.clearTimeout(statusTimer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onOutsideExport);
    btnCompare.removeEventListener("click", onCompare);
    btnSample.removeEventListener("click", onSample);
    btnSwap.removeEventListener("click", onSwap);
    btnClear.removeEventListener("click", onClear);
    btnEdit.removeEventListener("click", onEdit);
    btnCopy.removeEventListener("click", copyDiff);
    btnSave.removeEventListener("click", saveDiff);
    segView.removeEventListener("click", onViewClick);
    resultView.removeEventListener("click", onFoldClick);
    paneL.removeEventListener("scroll", onPaneScroll);
    paneR.removeEventListener("scroll", onPaneScroll);
    if (mq.removeEventListener) mq.removeEventListener("change", onMq);
    else if (mq.removeListener) mq.removeListener(onMq);
  };
  if (signal) {
    if (signal.aborted) cleanup();
    else signal.addEventListener("abort", cleanup, { once: true });
  }
  return cleanup;
}
export {
  mount
};
