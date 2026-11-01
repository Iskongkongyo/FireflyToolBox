// src-tauri/builtin-tools/src/mindmap.js
var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
var PALETTE = [
  "#1D9E75",
  "#0E9CC4",
  "#3E63DD",
  "#8E4EC6",
  "#E5484D",
  "#F76808",
  "#F2A20C",
  "#30A46C",
  "#E93D82",
  "#5B6B78"
];
function uid() {
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function r2(v) {
  return Math.round(v * 10) / 10;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}
function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return "rgba(120,130,126," + a + ")";
  return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
}
function mix(hex, target, k) {
  const c = hexToRgb(hex), t = hexToRgb(target);
  if (!c || !t) return hex;
  const f = (a, b) => Math.round(a + (b - a) * k);
  return "#" + [f(c.r, t.r), f(c.g, t.g), f(c.b, t.b)].map((v) => ("0" + v.toString(16)).slice(-2)).join("");
}
function lum(hex) {
  const c = hexToRgb(hex);
  if (!c) return 1;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function onColor(hex) {
  return lum(hex) > 0.6 ? "#151A18" : "#FFFFFF";
}
function newNode(text, color) {
  return { id: uid(), text: text == null ? "新节点" : text, color: color || null, collapsed: false, children: [] };
}
function walk(n, fn, parent) {
  fn(n, parent);
  for (let i = 0; i < n.children.length; i++) walk(n.children[i], fn, n);
}
function walkVisible(n, fn, parent) {
  fn(n, parent);
  if (n.collapsed) return;
  for (let i = 0; i < n.children.length; i++) walkVisible(n.children[i], fn, n);
}
function findNode(n, id) {
  if (n.id === id) return n;
  for (let i = 0; i < n.children.length; i++) {
    const hit = findNode(n.children[i], id);
    if (hit) return hit;
  }
  return null;
}
function findParent(n, id, parent) {
  for (let i = 0; i < n.children.length; i++) {
    const c = n.children[i];
    if (c.id === id) return n;
    const hit = findParent(c, id, n);
    if (hit) return hit;
  }
  return null;
}
function isAncestor(anc, node) {
  if (anc === node) return true;
  for (let i = 0; i < anc.children.length; i++) {
    if (isAncestor(anc.children[i], node)) return true;
  }
  return false;
}
function countAll(n) {
  let c = 0;
  walk(n, (x) => {
    if (x !== n) c++;
  });
  return c;
}
function serialize(n) {
  return {
    id: n.id,
    text: n.text,
    color: n.color || null,
    collapsed: !!n.collapsed,
    children: n.children.map(serialize)
  };
}
function normalize(n) {
  if (!n || typeof n !== "object") return newNode("中心主题", PALETTE[0]);
  const out = {
    id: typeof n.id === "string" && n.id ? n.id : uid(),
    text: typeof n.text === "string" ? n.text : "新节点",
    color: typeof n.color === "string" ? n.color : null,
    collapsed: !!n.collapsed,
    children: []
  };
  const kids = Array.isArray(n.children) ? n.children : [];
  for (let i = 0; i < kids.length; i++) out.children.push(normalize(kids[i]));
  return out;
}
var STY = {
  root: { fs: 18, padX: 18, padY: 13, weight: 700, maxW: 300, r: 13 },
  one: { fs: 15, padX: 14, padY: 9, weight: 600, maxW: 240, r: 10 },
  rest: { fs: 14, padX: 12, padY: 7, weight: 400, maxW: 210, r: 9 }
};
function styOf(level) {
  return level === 0 ? STY.root : level === 1 ? STY.one : STY.rest;
}
function hGap(level) {
  return level === 0 ? 76 : 46;
}
function vGap(level) {
  return level === 0 ? 20 : 12;
}
var mcv = document.createElement("canvas");
var mctx = mcv.getContext("2d");
function wrapText(text, maxW, weight, fs) {
  mctx.font = weight + " " + fs + "px " + FONT;
  const out = [];
  const paras = String(text == null ? "" : text).split("\n");
  for (let p = 0; p < paras.length; p++) {
    const chars = Array.from(paras[p]);
    if (!chars.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const test = line + ch;
      if (line && mctx.measureText(test).width > maxW) {
        const sp = line.lastIndexOf(" ");
        if (sp > 0 && /[A-Za-z0-9]/.test(ch)) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}
function measureNode(n, level) {
  const s = styOf(level);
  const lines = wrapText(n.text, s.maxW - s.padX * 2, s.weight, s.fs);
  mctx.font = s.weight + " " + s.fs + "px " + FONT;
  let w = 0;
  for (let i = 0; i < lines.length; i++) w = Math.max(w, mctx.measureText(lines[i]).width);
  const lh = Math.round(s.fs * 1.38);
  return {
    lines,
    lh,
    w: Math.max(54, Math.ceil(w) + s.padX * 2),
    h: Math.max(34, lines.length * lh + s.padY * 2)
  };
}
function measureAll(root) {
  (function rec(n, level, inherit) {
    n.level = level;
    n.ecolor = n.color || inherit || PALETTE[0];
    const m = measureNode(n, level);
    n.lines = m.lines;
    n.lh = m.lh;
    n.w = m.w;
    n.h = m.h;
    if (!n.children.length) {
      n.subH = n.h;
      return;
    }
    for (let i = 0; i < n.children.length; i++) rec(n.children[i], level + 1, n.ecolor);
    if (n.collapsed) {
      n.subH = n.h;
      return;
    }
    let total = 0;
    for (let i = 0; i < n.children.length; i++) total += n.children[i].subH;
    total += vGap(level) * (n.children.length - 1);
    n.subH = Math.max(n.h, total);
  })(root, 0, null);
}
function place(n, edgeX, cy, dir) {
  n.dir = dir;
  n.x = dir === 1 ? edgeX : edgeX - n.w;
  n.y = cy - n.h / 2;
  if (n.collapsed || !n.children.length) return;
  const childEdge = dir === 1 ? n.x + n.w + hGap(n.level) : n.x - hGap(n.level);
  let total = 0;
  for (let i = 0; i < n.children.length; i++) total += n.children[i].subH;
  total += vGap(n.level) * (n.children.length - 1);
  let y = cy - total / 2;
  for (let i = 0; i < n.children.length; i++) {
    const c = n.children[i];
    place(c, childEdge, y + c.subH / 2, dir);
    y += c.subH + vGap(n.level);
  }
}
function placeSide(list, edgeX, dir) {
  if (!list.length) return;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].subH;
  total += vGap(0) * (list.length - 1);
  let y = -total / 2;
  for (let i = 0; i < list.length; i++) {
    place(list[i], edgeX, y + list[i].subH / 2, dir);
    y += list[i].subH + vGap(0);
  }
}
function layoutAll(root, mode) {
  measureAll(root);
  root.dir = 1;
  root.x = -root.w / 2;
  root.y = -root.h / 2;
  const kids = root.children.slice();
  let right = kids, left = [];
  if (mode === "both" && kids.length > 1) {
    right = [];
    left = [];
    const sorted = kids.map((k, i) => ({ k, i, h: k.subH })).sort((a, b) => b.h - a.h);
    let rh = 0, lh = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (rh <= lh) {
        right.push(sorted[i]);
        rh += sorted[i].h;
      } else {
        left.push(sorted[i]);
        lh += sorted[i].h;
      }
    }
    right.sort((a, b) => a.i - b.i);
    left.sort((a, b) => a.i - b.i);
    right = right.map((x) => x.k);
    left = left.map((x) => x.k);
  }
  placeSide(right, root.x + root.w + hGap(0), 1);
  placeSide(left, root.x - hGap(0), -1);
}
function bboxOf(root) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  walkVisible(root, (n) => {
    const extra = n.children.length ? 12 : 0;
    if (n.x < x1) x1 = n.x;
    if (n.y < y1) y1 = n.y;
    if (n.x + n.w + (n.dir === 1 ? extra : 0) > x2) x2 = n.x + n.w + (n.dir === 1 ? extra : 0);
    if (n.x - (n.dir === -1 ? extra : 0) < x1) x1 = n.x - (n.dir === -1 ? extra : 0);
    if (n.y + n.h > y2) y2 = n.y + n.h;
  });
  if (!isFinite(x1)) return { x: 0, y: 0, w: 100, h: 60 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function visualOf(n, dark) {
  const c = n.ecolor;
  if (n.level === 0) {
    return { fill: c, stroke: "", text: onColor(c), textInline: true };
  }
  if (n.level === 1) {
    return {
      fill: rgba(c, dark ? 0.26 : 0.15),
      stroke: "",
      text: dark ? mix(c, "#FFFFFF", 0.34) : c,
      textInline: true
    };
  }
  return {
    fill: "none",
    stroke: rgba(c, dark ? 0.42 : 0.3),
    text: dark ? "#C8CECB" : "#22282B",
    textInline: true
  };
}
function tpl(project, branches) {
  const root = newNode(project, PALETTE[0]);
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const node = newNode(b[0], b[3] || PALETTE[i % PALETTE.length]);
    const kids = b[1] || [];
    for (let j = 0; j < kids.length; j++) {
      const k = kids[j];
      if (Array.isArray(k)) node.children.push(newNode(k[0], null));
      else node.children.push(newNode(k, null));
    }
    if (b[2]) node.collapsed = true;
    root.children.push(node);
  }
  return root;
}
var TEMPLATES = {
  blank: { label: "空白导图", build: () => newNode("中心主题", PALETTE[0]) },
  project: {
    label: "项目规划",
    build: () => tpl("项目规划", [
      ["目标与范围", ["一句话目标", "交付物清单", "验收标准"], false, "#1D9E75"],
      ["里程碑", ["需求冻结", "开发完成", "灰度上线"], false, "#0E9CC4"],
      ["分工", ["前端", "后端", "测试"], false, "#3E63DD"],
      ["风险", ["排期压缩", "外部依赖"], false, "#E5484D"]
    ])
  },
  meeting: {
    label: "会议脑暴",
    build: () => tpl("议题：下一步怎么做", [
      ["现状", ["数据表现", "用户反馈"]],
      ["问题", ["卡点在哪", "谁受影响"]],
      ["想法", ["方案 A", "方案 B", "方案 C"]],
      ["行动项", ["负责人", "截止时间"]]
    ])
  },
  study: {
    label: "学习笔记",
    build: () => tpl("学习主题", [
      ["核心概念", ["定义", "关键词"]],
      ["例子", ["正面例子", "反例"]],
      ["易错点", ["常见误解"]],
      ["关联", ["和已知的什么有关"]]
    ])
  },
  swot: {
    label: "SWOT 分析",
    build: () => tpl("SWOT", [
      ["优势 Strengths", ["资源", "能力"], false, "#30A46C"],
      ["劣势 Weaknesses", ["短板"], false, "#E5484D"],
      ["机会 Opportunities", ["市场", "趋势"], false, "#0E9CC4"],
      ["威胁 Threats", ["竞争", "政策"], false, "#F76808"]
    ])
  }
};
var WELCOME = tpl("思维导图", [
  ["双击改文字", ["选中节点直接打字", "Enter 完成，Shift+Enter 换行"]],
  ["Tab 加子节点", ["Enter 加同级", "方向键在节点间移动"]],
  ["拖动节点", ["拖到别的节点上就换了父级"], false, "#8E4EC6"],
  ["折叠分支", ["点节点右侧的小圆点", "灰色数字表示折叠了多少节点"], false, "#F76808"],
  ["导出", ["PNG / SVG / Markdown 大纲", "工程可保存成 JSON 再打开"], false, "#0E9CC4"]
]);
function svgIcon(body) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
}
var ICON = {
  menu: svgIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  undo: svgIcon('<path d="M8.6 5.6L4.1 10l4.5 4.4"/><path d="M4.1 10h9.1a5.5 5.5 0 010 11h-4"/>'),
  redo: svgIcon('<path d="M15.4 5.6l4.5 4.4-4.5 4.4"/><path d="M19.9 10h-9.1a5.5 5.5 0 000 11h4"/>'),
  panel: svgIcon('<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2"/><path d="M14.4 5.4v13.2"/>'),
  close: svgIcon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  down: svgIcon('<path d="M12 4v11"/><path d="M8 10.5l4 4 4-4"/><path d="M5 19.5h14"/>')
};
function mount(api) {
  const rootEl = document.getElementById("mp");
  if (!rootEl) return;
  const $ = (s) => rootEl.querySelector(s);
  const sig = api && api.signal ? api.signal : new AbortController().signal;
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, Object.assign({ signal: sig }, opts || {}));
  };
  const stage = $("#mp-stage");
  const svg = $("#mp-svg");
  const viewG = $("#mp-view");
  const edgesG = $("#mp-edges");
  const nodesG = $("#mp-nodes");
  const ed = $("#mp-edit");
  const panel = $("#mp-panel");
  const scrim = $("#mp-scrim");
  const dock = $("#mp-dock");
  const hintEl = $("#mp-hint");
  const pop = $("#mp-pop");
  const shade = $("#mp-shade");
  const nameIn = $("#mp-name");
  const dot = $("#mp-dot");
  const panelText = $("#mp-text");
  const colorBox = $("#mp-colors");
  const S = {
    root: null,
    sel: null,
    layout: "both",
    curve: true,
    alpha: false,
    name: "未命名导图",
    scale: 1,
    tx: 0,
    ty: 0
  };
  let dark = false;
  let elMap = /* @__PURE__ */ new Map();
  let past = [];
  let future = [];
  let drag = null;
  let pinch = null;
  let lastTap = { id: null, t: 0 };
  let editing = null;
  let panelBefore = null;
  let colorScope = "node";
  let saveTimer = 0;
  let draftRevision = 0;
  let fittedView = null, fitMode = "initial";
  let toastTimer = 0;
  let hintTimer = 0;
  let rafId = 0;
  let fitted = false;
  const ptrs = /* @__PURE__ */ new Map();
  const KEY_DRAFT = "mindmap.draft.v1";
  const KEY_PREF = "mindmap.pref.v1";
  function syncTheme() {
    dark = document.documentElement.getAttribute("data-theme") === "dark";
    rootEl.setAttribute("data-theme", dark ? "dark" : "light");
    if (S.root) {
      renderSvg();
    }
  }
  try {
    const mo = new MutationObserver(syncTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (sig.addEventListener) sig.addEventListener("abort", () => mo.disconnect());
  } catch (e) {
  }
  dark = document.documentElement.getAttribute("data-theme") === "dark";
  rootEl.setAttribute("data-theme", dark ? "dark" : "light");
  function toast(msg) {
    let t = document.getElementById("mp-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "mp-toast";
      t.className = "mptoast";
      rootEl.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
  }
  function hint(msg) {
    hintEl.textContent = msg;
    hintEl.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove("show"), 2200);
  }
  function applyView() {
    viewG.setAttribute("transform", "translate(" + r2(S.tx) + "," + r2(S.ty) + ") scale(" + S.scale.toFixed(4) + ")");
    $("#mp-zval").textContent = Math.round(S.scale * 100) + "%";
  }
  function edgePath(p, c) {
    const x1 = c.dir === 1 ? p.x + p.w : p.x;
    const y1 = p.y + p.h / 2;
    const x2 = c.dir === 1 ? c.x : c.x + c.w;
    const y2 = c.y + c.h / 2;
    if (!S.curve) {
      const mx2 = (x1 + x2) / 2;
      return "M" + r2(x1) + "," + r2(y1) + " H" + r2(mx2) + " V" + r2(y2) + " H" + r2(x2);
    }
    const mx = (x1 + x2) / 2;
    return "M" + r2(x1) + "," + r2(y1) + " C" + r2(mx) + "," + r2(y1) + " " + r2(mx) + "," + r2(y2) + " " + r2(x2) + "," + r2(y2);
  }
  function nodeMarkup(n) {
    const s = styOf(n.level);
    const v = visualOf(n, dark);
    const lines = n.lines || [n.text];
    const textH = lines.length * n.lh;
    const top = (n.h - textH) / 2;
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      parts.push('<text class="mtx" x="' + s.padX + '" y="' + r2(top + n.lh * (i + 0.78)) + '" font-size="' + s.fs + '" font-weight="' + s.weight + '"' + (v.textInline ? ' fill="' + v.text + '"' : "") + ">" + esc(lines[i]) + "</text>");
    }
    let badge = "";
    if (n.children.length) {
      const bx = n.dir === 1 ? n.w + 9 : -9;
      const label = n.collapsed ? String(countAll(n)) : "−";
      badge = '<g class="mcol" transform="translate(' + bx + "," + r2(n.h / 2) + ')"><circle r="9" stroke="' + n.ecolor + '"/><text fill="' + n.ecolor + '">' + label + "</text></g>";
    }
    return '<g class="mn' + (n.id === S.sel ? " sel" : "") + (n.collapsed ? " folded" : "") + '" data-id="' + n.id + '" transform="translate(' + r2(n.x) + "," + r2(n.y) + ')"><rect class="mring" x="-5" y="-5" width="' + (n.w + 10) + '" height="' + (n.h + 10) + '" rx="' + (s.r + 5) + '"/><rect class="mrect" width="' + n.w + '" height="' + n.h + '" rx="' + s.r + '" fill="' + v.fill + '"' + (v.stroke ? ' stroke="' + v.stroke + '" stroke-width="1.2"' : "") + "/>" + (n._hide ? "" : parts.join("")) + badge + "</g>";
  }
  function renderSvg() {
    const edgeHtml = [];
    const nodeHtml = [];
    walkVisible(S.root, (n, p) => {
      if (p) {
        const w = n.level === 1 ? 2.4 : 1.6;
        edgeHtml.push('<path class="me" d="' + edgePath(p, n) + '" stroke="' + n.ecolor + '" stroke-width="' + w + '" opacity="' + (n.level === 1 ? 0.9 : 0.68) + '"/>');
      }
      nodeHtml.push(nodeMarkup(n));
    });
    edgesG.innerHTML = edgeHtml.join("");
    nodesG.innerHTML = nodeHtml.join("");
    elMap = /* @__PURE__ */ new Map();
    const gs = nodesG.querySelectorAll(".mn");
    for (let i = 0; i < gs.length; i++) elMap.set(gs[i].dataset.id, gs[i]);
  }
  function refresh() {
    layoutAll(S.root, S.layout);
    renderSvg();
    applyView();
    syncPanel();
    updateUI();
  }
  function select(id, opts) {
    const prev = S.sel;
    S.sel = id;
    if (prev && elMap.has(prev)) elMap.get(prev).classList.remove("sel");
    if (id && elMap.has(id)) elMap.get(id).classList.add("sel");
    syncPanel();
    updateUI();
    if (!opts || opts.center !== false) {
      const n = findNode(S.root, id);
      if (n) ensureVisible(n);
    }
  }
  function ensureVisible(n) {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch) return;
    const pad = 60;
    const x1 = n.x * S.scale + S.tx, y1 = n.y * S.scale + S.ty;
    const x2 = x1 + n.w * S.scale, y2 = y1 + n.h * S.scale;
    let dx = 0, dy = 0;
    if (x1 < pad) dx = pad - x1;
    if (x2 > cw - pad) dx = cw - pad - x2;
    if (y1 < pad) dy = pad - y1;
    if (y2 > ch - pad) dy = ch - pad - y2;
    if (dx || dy) {
      S.tx += dx;
      S.ty += dy;
      applyView();
    }
  }
  function snap() {
    return JSON.stringify(serialize(S.root));
  }
  function commit(before) {
    if (!before) return;
    const now = snap();
    if (now === before) return;
    past.push(before);
    if (past.length > 60) past.shift();
    future = [];
    updateUI();
    scheduleSave();
  }
  function applySnap(str) {
    try {
      S.root = normalize(JSON.parse(str));
    } catch (e) {
      return;
    }
    if (!findNode(S.root, S.sel)) S.sel = S.root.id;
    refresh();
  }
  function undo() {
    if (editing) commitEdit();
    if (!past.length) return;
    const cur = snap();
    const prev = past.pop();
    future.push(cur);
    applySnap(prev);
    scheduleSave();
  }
  function redo() {
    if (editing) commitEdit();
    if (!future.length) return;
    const cur = snap();
    const next = future.pop();
    past.push(cur);
    applySnap(next);
    scheduleSave();
  }
  function scheduleSave() {
    draftRevision++;
    dot.hidden = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 500);
  }
  async function saveDraft() {
    clearTimeout(saveTimer);
    const revision = draftRevision;
    dot.hidden = false;
    let ok = true;
    try {
      localStorage.setItem(KEY_DRAFT, JSON.stringify({
        app: "fftool.mindmap",
        v: 1,
        name: S.name,
        layout: S.layout,
        curve: S.curve,
        view: { s: S.scale, tx: S.tx, ty: S.ty },
        root: serialize(S.root)
      }));
      if (api && api.storage && typeof api.storage.flush === "function") await api.storage.flush();
    } catch (e) {
      ok = false;
    }
    if (revision === draftRevision) dot.hidden = ok;
    if (!ok && !sig.aborted) toast("草稿未能保存，请先导出工程");
  }
  function loadDraft() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY_DRAFT);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    try {
      const d = JSON.parse(raw);
      if (!d || !d.root) return false;
      S.root = normalize(d.root);
      if (typeof d.name === "string" && d.name) S.name = d.name;
      if (d.layout === "right" || d.layout === "both") S.layout = d.layout;
      if (typeof d.curve === "boolean") S.curve = d.curve;
      return true;
    } catch (e) {
      return false;
    }
  }
  on(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(saveTimer);
      saveDraft();
    }
  });
  on(window, "pagehide", () => saveDraft());
  function addChild(id) {
    if (editing) commitEdit();
    const parent = id && findNode(S.root, id) || S.root;
    const before = snap();
    const color = parent === S.root ? pickColor(parent) : null;
    const child = newNode("新节点", color);
    parent.children.push(child);
    parent.collapsed = false;
    commit(before);
    refresh();
    select(child.id);
    startEdit(child.id);
  }
  function addSibling(id) {
    if (editing) commitEdit();
    const target = id && findNode(S.root, id) || S.root;
    if (target === S.root) {
      addChild(S.root.id);
      return;
    }
    const parent = findParent(S.root, target.id);
    if (!parent) return;
    const before = snap();
    const node = newNode("新节点", parent === S.root ? pickColor(parent) : null);
    const idx = parent.children.indexOf(target);
    parent.children.splice(idx + 1, 0, node);
    commit(before);
    refresh();
    select(node.id);
    startEdit(node.id);
  }
  function pickColor(parent) {
    const used = {};
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].color) used[parent.children[i].color] = 1;
    }
    for (let i = 0; i < PALETTE.length; i++) {
      if (!used[PALETTE[i]]) return PALETTE[i];
    }
    return PALETTE[parent.children.length % PALETTE.length];
  }
  function deleteNode(id) {
    if (!id) return;
    const n = findNode(S.root, id);
    if (!n) return;
    if (n === S.root) {
      if (S.root.children.length) {
        toast("根节点不能删除，可以清空整张导图");
        return;
      }
      const before2 = snap();
      S.root.text = "中心主题";
      S.root.color = PALETTE[0];
      commit(before2);
      refresh();
      return;
    }
    const parent = findParent(S.root, id);
    if (!parent) return;
    const before = snap();
    parent.children.splice(parent.children.indexOf(n), 1);
    const nextSel = parent.id;
    commit(before);
    S.sel = nextSel;
    refresh();
    toast(countAll(n) ? "已删除分支（可撤销）" : "已删除节点（可撤销）");
  }
  function toggleFold(id) {
    const n = findNode(S.root, id);
    if (!n || !n.children.length) return;
    const before = snap();
    n.collapsed = !n.collapsed;
    commit(before);
    refresh();
    if (n.collapsed) hint("已折叠 " + countAll(n) + " 个节点");
  }
  function foldAll(v) {
    const before = snap();
    walk(S.root, (n) => {
      if (n.children.length) n.collapsed = v;
    });
    if (v) S.root.collapsed = false;
    commit(before);
    refresh();
    toast(v ? "已折叠所有分支" : "已展开所有分支");
  }
  function setColor(hex) {
    const n = findNode(S.root, S.sel);
    if (!n) return;
    const before = snap();
    if (colorScope === "branch") {
      walk(n, (x) => {
        x.color = hex;
      });
    } else {
      n.color = hex;
    }
    commit(before);
    refresh();
  }
  function reparent(childId, parentId) {
    const n = findNode(S.root, childId);
    const np = findNode(S.root, parentId);
    if (!n || !np || n === S.root) return;
    if (isAncestor(n, np)) return;
    const op = findParent(S.root, childId);
    if (!op || op === np) return;
    const before = snap();
    op.children.splice(op.children.indexOf(n), 1);
    np.children.push(n);
    np.collapsed = false;
    commit(before);
    refresh();
    select(n.id);
    toast("已改为「" + np.text.slice(0, 8) + "」的子节点");
  }
  function navigate(dir) {
    const cur = findNode(S.root, S.sel) || S.root;
    if (dir === "left" || dir === "right") {
      const p2 = findParent(S.root, cur.id);
      const toward = dir === "right" && cur.dir === 1 || dir === "left" && cur.dir === -1;
      if (toward && !cur.collapsed && cur.children.length) {
        select(cur.children[0].id);
        return;
      }
      if (!toward && p2) {
        select(p2.id);
        return;
      }
      if (p2) select(p2.id);
      else if (cur.children.length) select(cur.children[0].id);
      return;
    }
    const p = findParent(S.root, cur.id);
    const list = p ? p.children : [S.root];
    const i = list.indexOf(cur);
    if (i < 0) return;
    const ni = dir === "up" ? i - 1 : i + 1;
    if (ni >= 0 && ni < list.length) select(list[ni].id);
  }
  function startEdit(id) {
    const n = findNode(S.root, id);
    if (!n) return;
    if (editing && editing.node.id === id) return;
    if (editing) commitEdit();
    editing = { node: n, before: snap() };
    n._hide = true;
    renderSvg();
    const s = styOf(n.level);
    const sc = S.scale;
    ed.hidden = false;
    ed.value = n.text;
    ed.style.left = r2(n.x * sc + S.tx) + "px";
    ed.style.top = r2(n.y * sc + S.ty) + "px";
    ed.style.width = Math.max(70, n.w * sc) + "px";
    ed.style.fontSize = Math.max(11, s.fs * sc) + "px";
    ed.style.fontWeight = String(s.weight);
    ed.style.lineHeight = Math.max(14, Math.round(s.fs * 1.38) * sc) + "px";
    ed.style.padding = r2(Math.max(4, s.padY * sc)) + "px " + r2(Math.max(4, s.padX * sc)) + "px";
    ed.style.height = Math.max(28, n.h * sc) + "px";
    setTimeout(() => {
      try {
        ed.focus();
        ed.select();
      } catch (e) {
      }
    }, 0);
  }
  function placeEdit() {
    if (!editing || ed.hidden) return;
    const n = editing.node;
    const s = styOf(n.level);
    const sc = S.scale;
    ed.style.left = r2(n.x * sc + S.tx) + "px";
    ed.style.top = r2(n.y * sc + S.ty) + "px";
    ed.style.width = Math.max(70, n.w * sc) + "px";
    ed.style.fontSize = Math.max(11, s.fs * sc) + "px";
    ed.style.padding = r2(Math.max(4, s.padY * sc)) + "px " + r2(Math.max(4, s.padX * sc)) + "px";
    ed.style.height = Math.max(28, ed.scrollHeight) + "px";
  }
  function commitEdit(save) {
    if (!editing) return;
    const e = editing;
    editing = null;
    ed.hidden = true;
    e.node._hide = false;
    if (save !== false) {
      const v = ed.value.replace(/[\s\u3000]+$/, "");
      e.node.text = v || "新节点";
    }
    commit(e.before);
    refresh();
  }
  on(ed, "input", () => {
    placeEdit();
  });
  on(ed, "blur", () => {
    if (editing) commitEdit();
  });
  on(ed, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const keep = editing ? editing.node.id : null;
      commitEdit();
      if (keep) {
        select(keep);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const id = editing ? editing.node.id : null;
      commitEdit();
      if (id) addChild(id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    }
    e.stopPropagation();
  });
  function localPt(e) {
    const r = stage.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
  }
  function toMap(sx, sy) {
    return { x: (sx - S.tx) / S.scale, y: (sy - S.ty) / S.scale };
  }
  function nodeAt(cx, cy) {
    let el = null;
    try {
      el = document.elementFromPoint(cx, cy);
    } catch (e) {
      return null;
    }
    if (!el || !el.closest) return null;
    const g = el.closest(".mn");
    return g ? g.dataset.id : null;
  }
  function clearDrop() {
    const prev = nodesG.querySelector(".mn.drop");
    if (prev) prev.classList.remove("drop");
  }
  on(svg, "pointerdown", (e) => {
    if (e.button === 2) return;
    if (editing) commitEdit();
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (err) {
    }
    const p = localPt(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) {
      const a = Array.from(ptrs.values());
      pinch = {
        d: Math.max(1, Math.hypot(a[0].sx - a[1].sx, a[0].sy - a[1].sy)),
        mid: { sx: (a[0].sx + a[1].sx) / 2, sy: (a[0].sy + a[1].sy) / 2 },
        s: S.scale,
        tx: S.tx,
        ty: S.ty
      };
      drag = null;
      return;
    }
    if (ptrs.size > 2) return;
    const target = e.target.closest ? e.target.closest(".mn") : null;
    if (target && target.dataset.id) {
      if (e.target.closest(".mcol")) {
        toggleFold(target.dataset.id);
        return;
      }
      const id = target.dataset.id;
      if (S.sel !== id) select(id, { center: false });
      const now = Date.now();
      if (lastTap.id === id && now - lastTap.t < 400) {
        lastTap.id = null;
        lastTap.t = 0;
        startEdit(id);
        return;
      }
      lastTap = { id, t: now };
      drag = { kind: "node", id, start: p, moved: false, before: snap() };
      return;
    }
    drag = { kind: "pan", start: p, tx: S.tx, ty: S.ty };
    svg.classList.add("panning");
  });
  on(svg, "pointermove", (e) => {
    const p = localPt(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2 && pinch) {
      const a = Array.from(ptrs.values());
      const d = Math.max(1, Math.hypot(a[0].sx - a[1].sx, a[0].sy - a[1].sy));
      const mid = { sx: (a[0].sx + a[1].sx) / 2, sy: (a[0].sy + a[1].sy) / 2 };
      const ns = Math.max(0.12, Math.min(3.2, pinch.s * (d / pinch.d)));
      const bx = (pinch.mid.sx - pinch.tx) / pinch.s;
      const by = (pinch.mid.sy - pinch.ty) / pinch.s;
      S.scale = ns;
      S.tx = mid.sx - bx * ns;
      S.ty = mid.sy - by * ns;
      applyView();
      if (editing) placeEdit();
      return;
    }
    if (!drag) return;
    if (drag.kind === "pan") {
      S.tx = drag.tx + (p.sx - drag.start.sx);
      S.ty = drag.ty + (p.sy - drag.start.sy);
      applyView();
      if (editing) placeEdit();
      return;
    }
    if (drag.kind === "node") {
      if (!drag.moved && Math.hypot(p.sx - drag.start.sx, p.sy - drag.start.sy) > 6) drag.moved = true;
      if (!drag.moved) return;
      const over = nodeAt(p.cx, p.cy);
      clearDrop();
      drag.target = null;
      if (over && over !== drag.id) {
        const n = findNode(S.root, drag.id);
        const t = findNode(S.root, over);
        if (n && t && !isAncestor(n, t)) {
          drag.target = over;
          const el = elMap.get(over);
          if (el) el.classList.add("drop");
        }
      }
    }
  });
  function endPointer(e) {
    ptrs.delete(e.pointerId);
    if (pinch) {
      if (ptrs.size < 2) pinch = null;
      return;
    }
    if (ptrs.size > 0) return;
    const d = drag;
    drag = null;
    svg.classList.remove("panning");
    clearDrop();
    if (!d) return;
    if (d.kind === "node" && d.moved && d.target) reparent(d.id, d.target);
  }
  on(svg, "pointerup", endPointer);
  on(svg, "pointercancel", endPointer);
  on(svg, "dblclick", (e) => {
    const t = e.target.closest ? e.target.closest(".mn") : null;
    if (t && t.dataset.id) {
      e.preventDefault();
      select(t.dataset.id, { center: false });
      startEdit(t.dataset.id);
    }
  });
  on(svg, "wheel", (e) => {
    e.preventDefault();
    const p = localPt(e);
    const k = Math.exp(-e.deltaY * 15e-4);
    zoomAt(p, S.scale * k);
  }, { passive: false });
  on(svg, "contextmenu", (e) => e.preventDefault());
  function zoomAt(p, ns) {
    ns = Math.max(0.12, Math.min(3.2, ns));
    const bx = (p.sx - S.tx) / S.scale;
    const by = (p.sy - S.ty) / S.scale;
    S.scale = ns;
    S.tx = p.sx - bx * ns;
    S.ty = p.sy - by * ns;
    applyView();
    if (editing) placeEdit();
  }
  function fit() {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch || !S.root) return;
    const bb = bboxOf(S.root);
    const pad = 56;
    const s = Math.max(0.12, Math.min(2, Math.min((cw - pad * 2) / Math.max(1, bb.w), (ch - pad * 2) / Math.max(1, bb.h))));
    S.scale = s;
    S.tx = cw / 2 - (bb.x + bb.w / 2) * s;
    S.ty = ch / 2 - (bb.y + bb.h / 2) * s;
    fittedView = { scale: S.scale, tx: S.tx, ty: S.ty };
    fitMode = "fit";
    applyView();
    if (editing) placeEdit();
    updateUI();
  }
  function initialView() {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch || !S.root) return;
    const bb = bboxOf(S.root);
    const pad = 48;
    const fitScale = Math.min((cw - pad * 2) / Math.max(1, bb.w), (ch - pad * 2) / Math.max(1, bb.h));
    const s = Math.max(0.55, Math.min(1.3, fitScale));
    S.scale = s;
    S.tx = cw / 2 - (S.root.x + S.root.w / 2) * s;
    S.ty = ch / 2 - (S.root.y + S.root.h / 2) * s;
    fittedView = { scale: S.scale, tx: S.tx, ty: S.ty };
    fitMode = "initial";
    applyView();
    updateUI();
  }
  function resetView() {
    S.scale = 1;
    S.tx = stage.clientWidth / 2;
    S.ty = stage.clientHeight / 2;
    applyView();
  }
  on(window, "keydown", (e) => {
    if (!shade.hidden) {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#mp-ok").click();
      }
      return;
    }
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT")) {
      if (t === ed) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (k === "s") {
        e.preventDefault();
        saveProject();
        return;
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      addChild(S.sel || S.root.id);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      addSibling(S.sel || S.root.id);
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      startEdit(S.sel || S.root.id);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (S.sel) {
        e.preventDefault();
        deleteNode(S.sel);
      }
      return;
    }
    if (e.key === "Escape") {
      select(null);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      navigate("up");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      navigate("down");
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigate("left");
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigate("right");
      return;
    }
    if (e.key === "+" || e.key === "=") {
      zoomAt({ sx: stage.clientWidth / 2, sy: stage.clientHeight / 2 }, S.scale * 1.2);
      return;
    }
    if (e.key === "-") {
      zoomAt({ sx: stage.clientWidth / 2, sy: stage.clientHeight / 2 }, S.scale / 1.2);
      return;
    }
    if (e.key === "0") {
      fit();
      return;
    }
  });
  function syncPanel() {
    const n = findNode(S.root, S.sel);
    const has = !!n;
    $("#mp-addchild").disabled = !has;
    $("#mp-addsib").disabled = !has;
    $("#mp-del").disabled = !has;
    const foldBtn = $("#mp-fold");
    foldBtn.disabled = !has || !n.children.length;
    foldBtn.textContent = has && n.collapsed ? "展开分支" : "折叠分支";
    if (has && document.activeElement !== panelText) {
      panelText.value = n.text;
    }
    panelText.disabled = !has;
    panelText.placeholder = has ? "输入节点文字" : "先选中一个节点";
    const cur = has ? n.color || n.ecolor : "";
    const swi = colorBox.querySelectorAll(".swi");
    for (let i = 0; i < swi.length; i++) {
      swi[i].classList.toggle("on", swi[i].dataset.v.toLowerCase() === String(cur).toLowerCase());
    }
    setSeg("#mp-scope", colorScope);
    setSeg("#mp-layout", S.layout);
    setSeg("#mp-curve", S.curve ? "1" : "0");
  }
  function setSeg(sel, v) {
    const bs = rootEl.querySelectorAll(sel + " button");
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].dataset.v === v);
  }
  function updateUI() {
    $("#mp-undo").disabled = past.length === 0;
    $("#mp-redo").disabled = future.length === 0;
    dock.hidden = !S.sel;
    const n = findNode(S.root, S.sel);
    const fold = dock.querySelector('[data-act="fold"]');
    if (fold) fold.textContent = n && n.collapsed ? "展开" : "折叠";
  }
  (function buildColors() {
    const html = [];
    for (let i = 0; i < PALETTE.length; i++) {
      html.push('<button class="swi" type="button" data-v="' + PALETTE[i] + '" title="' + PALETTE[i] + '" aria-label="配色 ' + (i + 1) + '" style="background:' + PALETTE[i] + '"></button>');
    }
    colorBox.innerHTML = html.join("");
    on(colorBox, "click", (e) => {
      const b = e.target.closest ? e.target.closest(".swi") : null;
      if (b) setColor(b.dataset.v);
    });
  })();
  on($("#mp-scope"), "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    colorScope = b.dataset.v;
    setSeg("#mp-scope", colorScope);
  });
  on($("#mp-layout"), "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    S.layout = b.dataset.v;
    refresh();
    fit();
    scheduleSave();
  });
  on($("#mp-curve"), "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    S.curve = b.dataset.v === "1";
    refresh();
    scheduleSave();
  });
  on(panelText, "focus", () => {
    panelBefore = snap();
  });
  on(panelText, "input", () => {
    const n = findNode(S.root, S.sel);
    if (!n) return;
    if (!panelBefore) panelBefore = snap();
    n.text = panelText.value;
    layoutAll(S.root, S.layout);
    renderSvg();
    applyView();
    updateUI();
    scheduleSave();
  });
  on(panelText, "blur", () => {
    if (panelBefore) {
      commit(panelBefore);
      panelBefore = null;
      refresh();
    }
  });
  on(panelText, "keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      panelText.blur();
    }
  });
  on($("#mp-addchild"), "click", () => addChild(S.sel || S.root.id));
  on($("#mp-addsib"), "click", () => addSibling(S.sel || S.root.id));
  on($("#mp-fold"), "click", () => toggleFold(S.sel));
  on($("#mp-del"), "click", () => deleteNode(S.sel));
  on($("#mp-undo"), "click", undo);
  on($("#mp-redo"), "click", redo);
  on($("#mp-zin"), "click", () => zoomAt({ sx: stage.clientWidth / 2, sy: stage.clientHeight / 2 }, S.scale * 1.25));
  on($("#mp-zout"), "click", () => zoomAt({ sx: stage.clientWidth / 2, sy: stage.clientHeight / 2 }, S.scale / 1.25));
  on($("#mp-zfit"), "click", fit);
  on(dock, "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    const act = b.dataset.act;
    if (act === "child") addChild(S.sel);
    else if (act === "sib") addSibling(S.sel);
    else if (act === "fold") toggleFold(S.sel);
    else if (act === "del") deleteNode(S.sel);
    else if (act === "color") openColorPop(b);
  });
  let popAnchor = null;
  function closePop() {
    pop.hidden = true;
    popAnchor = null;
  }
  function openColorPop(anchor) {
    const cur = findNode(S.root, S.sel);
    const now = cur ? cur.color || cur.ecolor : "";
    pop.innerHTML = '<div class="poph">节点配色</div><div class="popcol">' + PALETTE.map((c) => '<button class="swi' + (c.toLowerCase() === String(now).toLowerCase() ? " on" : "") + '" type="button" data-c="' + c + '" style="background:' + c + '" aria-label="配色"></button>').join("") + "</div>";
    pop.hidden = false;
    popAnchor = anchor;
    pop.style.visibility = "hidden";
    pop.style.left = "8px";
    pop.style.top = "8px";
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    if (left < 8) left = 8;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    let top = r.top - pr.height - 8;
    if (top < 8) top = Math.min(window.innerHeight - pr.height - 8, r.bottom + 8);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
    pop.style.visibility = "";
    pop.__colors = true;
  }
  function openPop(anchor, items) {
    pop.__colors = false;
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.sep) {
        rows.push('<div class="popsep"></div>');
        continue;
      }
      if (it.head) {
        rows.push('<div class="poph">' + esc(it.head) + "</div>");
        continue;
      }
      const dot2 = it.dot ? '<span class="pdot" style="background:' + it.dot + '"></span>' : "";
      rows.push('<button class="popi" type="button" data-i="' + i + '">' + dot2 + '<span class="pt">' + esc(it.t) + "</span>" + (it.hint ? '<span class="ph">' + esc(it.hint) + "</span>" : "") + "</button>");
    }
    pop.innerHTML = rows.join("");
    pop.hidden = false;
    popAnchor = anchor;
    pop.style.visibility = "hidden";
    pop.style.left = "8px";
    pop.style.top = "8px";
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.right - pr.width;
    if (left < 8) left = 8;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
    pop.style.visibility = "";
    pop.__items = items;
  }
  on(pop, "click", (e) => {
    if (pop.__colors) {
      const sw = e.target.closest ? e.target.closest(".swi") : null;
      if (!sw) return;
      const c = sw.dataset.c;
      closePop();
      setColor(c);
      return;
    }
    const b = e.target.closest ? e.target.closest(".popi") : null;
    if (!b) return;
    const it = (pop.__items || [])[Number(b.dataset.i)];
    closePop();
    if (it && it.act) setTimeout(it.act, 0);
  });
  on(document, "pointerdown", (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (popAnchor && popAnchor.contains(e.target)) return;
    closePop();
  }, true);
  function ask(msg) {
    return new Promise((resolve) => {
      $("#mp-qt").textContent = msg;
      shade.hidden = false;
      const done = (v) => {
        shade.hidden = true;
        $("#mp-ok").onclick = null;
        $("#mp-cancel").onclick = null;
        shade.onclick = null;
        resolve(v);
      };
      $("#mp-ok").onclick = () => done(true);
      $("#mp-cancel").onclick = () => done(false);
      shade.onclick = (e) => {
        if (e.target === shade) done(false);
      };
      setTimeout(() => {
        try {
          $("#mp-ok").focus();
        } catch (e) {
        }
      }, 30);
    });
  }
  function fileName() {
    let n = (S.name || "思维导图").trim().replace(/[\\/:*?"<>|]/g, "_");
    return n || "思维导图";
  }
  async function pickFile(exts) {
    if (api && typeof api.openFile === "function") {
      return await api.openFile({ extensions: exts, signal: sig });
    }
    return await new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = exts.map((x) => "." + x).join(",");
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        resolve(f ? { name: f.name, blob: f } : null);
      };
      inp.click();
    });
  }
  async function saveBlob(name, blob) {
    if (api && typeof api.saveFile === "function") {
      return await api.saveFile(name, blob, { signal: sig });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    return true;
  }
  async function saveProject() {
    if (editing) commitEdit();
    try {
      const data = JSON.stringify({
        app: "fftool.mindmap",
        v: 1,
        name: S.name,
        layout: S.layout,
        curve: S.curve,
        root: serialize(S.root)
      }, null, 1);
      const ok = await saveBlob(fileName() + ".mind.json", new Blob([data], { type: "application/json" }));
      toast(ok ? "工程已保存" : "已取消");
    } catch (err) {
      toast("保存失败：" + (err && err.message || err));
    }
  }
  async function openProject() {
    let f;
    try {
      f = await pickFile(["json"]);
    } catch (err) {
      toast("打开失败");
      return;
    }
    if (!f || !f.blob) return;
    try {
      const d = JSON.parse(await f.blob.text());
      if (!d || !d.root) throw new Error("不是思维导图工程文件");
      const before = snap();
      S.root = normalize(d.root);
      if (typeof d.name === "string" && d.name) S.name = d.name;
      if (d.layout === "right" || d.layout === "both") S.layout = d.layout;
      if (typeof d.curve === "boolean") S.curve = d.curve;
      S.sel = S.root.id;
      nameIn.value = S.name;
      past = [];
      future = [];
      commit(before);
      updateUI();
      refresh();
      setTimeout(initialView, 30);
      toast("已打开工程");
    } catch (err) {
      toast("打开失败：" + (err && err.message || err));
    }
  }
  function newMap(tplKey) {
    const run = async () => {
      const before = snap();
      const t = TEMPLATES[tplKey] || TEMPLATES.blank;
      S.root = t.build();
      S.name = tplKey === "blank" ? "未命名导图" : t.label;
      nameIn.value = S.name;
      S.sel = S.root.id;
      past = [];
      future = [];
      commit(before);
      updateUI();
      refresh();
      setTimeout(initialView, 30);
      toast("已新建：" + t.label);
    };
    run();
  }
  function exportBg() {
    return dark ? "#151C1A" : "#FFFFFF";
  }
  function exportSvgString(scale, transparent) {
    const bb = bboxOf(S.root);
    const PAD = 44;
    const x = bb.x - PAD, y = bb.y - PAD;
    const w = bb.w + PAD * 2, h = bb.h + PAD * 2;
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w * scale) + '" height="' + Math.round(h * scale) + '" viewBox="' + r2(x) + " " + r2(y) + " " + r2(w) + " " + r2(h) + '">');
    out.push('<g font-family="' + esc(FONT) + '">');
    if (!transparent) {
      out.push('<rect x="' + r2(x) + '" y="' + r2(y) + '" width="' + r2(w) + '" height="' + r2(h) + '" fill="' + exportBg() + '"/>');
    }
    walkVisible(S.root, (n, p) => {
      if (!p) return;
      const wd = n.level === 1 ? 2.4 : 1.6;
      out.push('<path d="' + edgePath(p, n) + '" fill="none" stroke="' + n.ecolor + '" stroke-width="' + wd + '" stroke-linecap="round" opacity="' + (n.level === 1 ? 0.9 : 0.68) + '"/>');
    });
    walkVisible(S.root, (n) => {
      const s = styOf(n.level);
      const v = visualOf(n, dark);
      const lines = n.lines || [n.text];
      out.push('<g transform="translate(' + r2(n.x) + "," + r2(n.y) + ')">');
      out.push('<rect width="' + n.w + '" height="' + n.h + '" rx="' + s.r + '" fill="' + v.fill + '"' + (v.stroke ? ' stroke="' + v.stroke + '" stroke-width="1.2"' : "") + "/>");
      const textH = lines.length * n.lh;
      const top = (n.h - textH) / 2;
      for (let i = 0; i < lines.length; i++) {
        out.push('<text x="' + s.padX + '" y="' + r2(top + n.lh * (i + 0.78)) + '" font-size="' + s.fs + '" font-weight="' + s.weight + '" fill="' + v.text + '">' + esc(lines[i]) + "</text>");
      }
      if (n.children.length && n.collapsed) {
        const bx = n.dir === 1 ? n.w + 9 : -9;
        out.push('<g transform="translate(' + bx + "," + r2(n.h / 2) + ')"><circle r="9" fill="' + exportBg() + '" stroke="' + n.ecolor + '" stroke-width="1.6"/><text y="0.5" font-size="9.5" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="' + n.ecolor + '">' + countAll(n) + "</text></g>");
      }
      out.push("</g>");
    });
    out.push("</g></svg>");
    return out.join("");
  }
  function toBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        b ? resolve(b) : reject(new Error("编码失败"));
      }, type, q);
    });
  }
  let busy = false;
  async function exportPng(scale) {
    if (busy) {
      toast("正在导出，请稍候");
      return;
    }
    if (editing) commitEdit();
    busy = true;
    try {
      const str = exportSvgString(scale, S.alpha);
      const bb = bboxOf(S.root);
      const PAD = 44;
      const w = Math.round((bb.w + PAD * 2) * scale);
      const h = Math.round((bb.h + PAD * 2) * scale);
      const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      try {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error("渲染失败"));
          img.src = url;
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 4e3);
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const c = canvas.getContext("2d");
      c.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, "image/png");
      const ok = await saveBlob(fileName() + ".png", blob);
      toast(ok ? "已导出 PNG（" + scale + " 倍）" : "已取消");
    } catch (err) {
      toast("导出失败：" + (err && err.message || err));
    } finally {
      busy = false;
    }
  }
  async function exportSvg() {
    if (editing) commitEdit();
    try {
      const str = exportSvgString(1, S.alpha);
      const ok = await saveBlob(fileName() + ".svg", new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
      toast(ok ? "已导出 SVG" : "已取消");
    } catch (err) {
      toast("导出失败：" + (err && err.message || err));
    }
  }
  async function exportOutline() {
    const lines = ["# " + S.root.text, ""];
    (function rec(n, depth) {
      if (n.collapsed) return;
      for (let i = 0; i < n.children.length; i++) {
        const c = n.children[i];
        lines.push("  ".repeat(depth) + "- " + c.text);
        rec(c, depth + 1);
      }
    })(S.root, 0);
    try {
      const ok = await saveBlob(fileName() + ".md", new Blob([lines.join("\n") + "\n"], { type: "text/markdown;charset=utf-8" }));
      toast(ok ? "已导出 Markdown 大纲" : "已取消");
    } catch (err) {
      toast("导出失败：" + (err && err.message || err));
    }
  }
  $("#mp-menu").innerHTML = ICON.menu;
  $("#mp-panel-btn").innerHTML = ICON.panel;
  $("#mp-close").innerHTML = ICON.close;
  $("#mp-undo").innerHTML = ICON.undo;
  $("#mp-redo").innerHTML = ICON.redo;
  $("#mp-export").innerHTML = ICON.down + "<span>导出</span>";
  on($("#mp-menu"), "click", () => {
    const items = [{ head: "新建" }, { t: "空白导图", act: () => newMap("blank") }];
    Object.keys(TEMPLATES).forEach((k) => {
      if (k === "blank") return;
      items.push({ t: TEMPLATES[k].label, act: () => newMap(k) });
    });
    items.push({ sep: 1 });
    items.push({ t: "打开工程…", hint: ".json", act: openProject });
    items.push({ t: "保存工程", hint: "Ctrl+S", act: saveProject });
    openPop($("#mp-menu"), items);
  });
  on($("#mp-export"), "click", () => {
    openPop($("#mp-export"), [
      { head: "导出" },
      { t: "PNG 图片（2 倍）", act: () => exportPng(2) },
      { t: "PNG 图片（3 倍）", act: () => exportPng(3) },
      { t: "SVG 矢量图", act: exportSvg },
      { sep: 1 },
      { t: "Markdown 大纲", act: exportOutline },
      { sep: 1 },
      { t: "保存工程", hint: ".json", act: saveProject }
    ]);
  });
  on($("#mp-aa"), "click", () => {
    openPop($("#mp-aa"), [
      { head: "视图" },
      { t: "适合窗口", hint: "0", act: fit },
      { t: "重置到 100%", act: resetView },
      { sep: 1 },
      { t: "折叠所有分支", act: () => foldAll(true) },
      { t: "展开所有分支", act: () => foldAll(false) },
      { sep: 1 },
      {
        t: "导出透明背景",
        on: S.alpha,
        act: () => {
          S.alpha = !S.alpha;
          syncAlpha();
          scheduleSave();
        }
      }
    ]);
  });
  let panelOpen = true;
  function setPanelOpen(open) {
    panelOpen = open;
    const narrow = rootEl.classList.contains("narrow");
    if (narrow) {
      panel.hidden = false;
      panel.classList.toggle("open", open);
      scrim.hidden = !open;
    } else {
      panel.hidden = !open;
      scrim.hidden = true;
    }
  }
  on($("#mp-panel-btn"), "click", () => setPanelOpen(!panelOpen));
  on($("#mp-close"), "click", () => setPanelOpen(false));
  on(scrim, "click", () => setPanelOpen(false));
  on($("#mp-open"), "click", openProject);
  on($("#mp-save"), "click", saveProject);
  on($("#mp-new"), "click", async () => {
    const ok = await ask("新建会清空当前导图，确定吗？");
    if (ok) newMap("blank");
  });
  function syncAlpha() {
    $("#mp-alpha").checked = !!S.alpha;
  }
  on($("#mp-alpha"), "change", () => {
    S.alpha = $("#mp-alpha").checked;
  });
  on(nameIn, "input", () => {
    S.name = nameIn.value || "未命名导图";
    scheduleSave();
  });
  on(nameIn, "keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      nameIn.blur();
    }
  });
  function layout() {
    const narrow = rootEl.clientWidth < 760;
    const was = rootEl.classList.contains("narrow");
    rootEl.classList.toggle("narrow", narrow);
    if (narrow !== was) {
      panel.hidden = false;
      panel.classList.remove("open");
      scrim.hidden = true;
      panelOpen = !narrow;
    }
    if (!fitted && stage.clientWidth > 0) {
      fitted = true;
      initialView();
    } else if (fittedView && ["scale", "tx", "ty"].every((k) => Math.abs(S[k] - fittedView[k]) < 1e-3)) {
      if (fitMode === "fit") fit();
      else initialView();
    } else if (editing) {
      placeEdit();
    }
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(rootEl);
  ro.observe(stage);
  if (sig.addEventListener) sig.addEventListener("abort", () => ro.disconnect());
  let pref = {};
  try {
    pref = JSON.parse(localStorage.getItem(KEY_PREF) || "{}") || {};
  } catch (e) {
    pref = {};
  }
  if (pref.layout === "right" || pref.layout === "both") S.layout = pref.layout;
  if (typeof pref.curve === "boolean") S.curve = pref.curve;
  const had = loadDraft();
  if (!had) {
    S.root = TEMPLATES.project.build();
    S.name = "项目规划";
  }
  S.sel = S.root.id;
  nameIn.value = S.name;
  syncAlpha();
  refresh();
  layout();
  setTimeout(() => {
    if (!fitted) {
      fitted = true;
    }
    initialView();
  }, 60);
  if (had) setTimeout(() => toast("已恢复上次的导图"), 300);
  on(window, "resize", () => {
    if (editing) placeEdit();
  });
  return function cleanup() {
    clearTimeout(saveTimer);
    clearTimeout(toastTimer);
    clearTimeout(hintTimer);
    if (rafId) cancelAnimationFrame(rafId);
    saveDraft();
    try {
      ro.disconnect();
    } catch (e) {
    }
  };
}
export {
  mount
};
