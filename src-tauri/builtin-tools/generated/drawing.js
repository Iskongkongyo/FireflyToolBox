// src-tauri/builtin-tools/src/drawing.js
var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif';
var TAU = Math.PI * 2;
function ic(body) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
}
var ICONS = {
  select: ic('<path d="M5 3.2l13.4 7.1-5.9 1.3-1.3 5.7z"/>'),
  hand: ic('<path d="M8.6 11.4V5.9a1.4 1.4 0 012.8 0v5M11.4 10.3V4.7a1.4 1.4 0 012.8 0v5.7M14.2 10.5V6.1a1.4 1.4 0 012.8 0v7.1c0 3.3-2 5.6-5.1 5.6-1.9 0-3-.7-4-2.1l-2.2-3.3a1.5 1.5 0 012.4-1.8l1.6 1.9"/>'),
  pen: ic('<path d="M4.6 19.4l1-3.4L16.2 5.4a1.9 1.9 0 012.7 0l.5.5a1.9 1.9 0 010 2.7L8.8 19.2z"/><path d="M14.7 6.9l2.6 2.6"/>'),
  marker: ic('<path d="M9.6 20.4H20"/><path d="M4.7 15.3l7.1-7.1a1.8 1.8 0 012.6 0l2.4 2.4a1.8 1.8 0 010 2.6l-5.6 5.6H6.9z"/>'),
  line: ic('<path d="M5 19L19 5"/>'),
  arrow: ic('<path d="M4.5 19.5L19 5"/><path d="M19 10.6V5h-5.6"/>'),
  rect: ic('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  ellipse: ic('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  triangle: ic('<path d="M12 4.6l8.1 14.8H3.9z"/>'),
  diamond: ic('<path d="M12 3.7l8.3 8.3-8.3 8.3L3.7 12z"/>'),
  star: ic('<path d="M12 3.9l2.4 5.1 5.6.7-4.1 3.9 1 5.6-4.9-2.7-4.9 2.7 1-5.6L4 9.7l5.6-.7z"/>'),
  text: ic('<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>'),
  eraser: ic('<path d="M7.5 20H20"/><path d="M4.6 15.4l7.2-7.2 4.8 4.8-5.7 5.6H7.4z"/>'),
  undo: ic('<path d="M8.6 5.6L4.1 10l4.5 4.4"/><path d="M4.1 10h9.1a5.5 5.5 0 010 11h-4"/>'),
  redo: ic('<path d="M15.4 5.6l4.5 4.4-4.5 4.4"/><path d="M19.9 10h-9.1a5.5 5.5 0 000 11h4"/>'),
  download: ic('<path d="M12 4.2v10"/><path d="M8 10.6l4 4 4-4"/><path d="M5 19.6h14"/>'),
  panel: ic('<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2"/><path d="M14.4 5.4v13.2"/>'),
  close: ic('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  minus: ic('<path d="M5 12h14"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  rotate: ic('<path d="M20.4 12a8.4 8.4 0 11-2.6-6.1"/><path d="M20.4 3.6v5h-5"/>')
};
var TOOLS = [
  { id: "select", key: "v", label: "选择", icon: "select", hint: "点选图形拖动移动，抓住角点缩放；双击文字可直接改写" },
  { id: "hand", key: "h", label: "手型", icon: "hand", hint: "拖动画布平移；任何工具下按住空格也能平移" },
  { sep: true },
  { id: "pen", key: "b", label: "画笔", icon: "pen", hint: "自由绘制，松开后成为一条可再编辑的线" },
  { id: "marker", key: "m", label: "荧光笔", icon: "marker", hint: "半透明宽笔，用来打亮重点" },
  { sep: true },
  { id: "line", key: "l", label: "直线", icon: "line", hint: "按住 Shift 可约束到 45° 角" },
  { id: "arrow", key: "a", label: "箭头", icon: "arrow", hint: "从起点拖到终点，箭头指向终点" },
  { id: "rect", key: "r", label: "矩形", icon: "rect", hint: "按住 Shift 画正方形" },
  { id: "ellipse", key: "o", label: "椭圆", icon: "ellipse", hint: "按住 Shift 画正圆" },
  { id: "triangle", key: "y", label: "三角", icon: "triangle", hint: "按住 Shift 画等腰三角" },
  { id: "diamond", key: "d", label: "菱形", icon: "diamond", hint: "适合画流程图判断框" },
  { id: "star", key: "s", label: "星形", icon: "star", hint: "五角星，可配合“实”填充" },
  { sep: true },
  { id: "text", key: "t", label: "文字", icon: "text", hint: "点一下开始输入，Enter 完成、Shift+Enter 换行" },
  { id: "eraser", key: "e", label: "橡皮", icon: "eraser", hint: "划过图形即整条删除，可撤销" }
];
var PALETTE = [
  ["#22282B", "墨黑"],
  ["#FFFFFF", "纯白"],
  ["#8B9390", "灰"],
  ["#E5484D", "红"],
  ["#F76808", "橙"],
  ["#FFB224", "黄"],
  ["#30A46C", "绿"],
  ["#12A594", "青"],
  ["#0091FF", "蓝"],
  ["#3E63DD", "靛"],
  ["#8E4EC6", "紫"],
  ["#E93D82", "粉"]
];
var BOARDS = [
  ["#FFFFFF", "纯白"],
  ["#FBF6EC", "米白"],
  ["#EDEFF2", "浅灰"],
  ["#1B1F1E", "墨黑"],
  ["#22352B", "黑板绿"],
  ["transparent", "透明"]
];
var PRESETS = [
  ["1600x900", "横版 16:9 · 1600×900"],
  ["1080x1920", "竖版 9:16 · 1080×1920"],
  ["1400x1050", "横版 4:3 · 1400×1050"],
  ["1050x1400", "竖版 4:3 · 1050×1400"],
  ["1414x1000", "横版 A4 · 1414×1000"],
  ["1000x1414", "竖版 A4 · 1000×1414"],
  ["1200x1200", "方形 1:1 · 1200×1200"],
  ["2000x1200", "大画布 · 2000×1200"]
];
var CLOSED = { rect: 1, ellipse: 1, triangle: 1, diamond: 1, star: 1 };
var uidSeed = 0;
function uid() {
  uidSeed++;
  return "o" + Date.now().toString(36) + uidSeed.toString(36) + Math.random().toString(36).slice(2, 6);
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function r2(v) {
  return Math.round(v * 100) / 100;
}
function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim();
  if (h[0] === "#") h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return "rgba(34,40,43," + a + ")";
  return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
}
function isDark(hex) {
  const c = hexToRgb(hex);
  if (!c) return false;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) < 0.32;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = clamp(t, 0, 1);
  const x = a.x + dx * t, y = a.y + dy * t;
  return Math.hypot(p.x - x, p.y - y);
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop();
    const i = seg[0], j = seg[1];
    let maxD = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([i, idx]);
      stack.push([idx, j]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
function starPts(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n;
    const k = i % 2 ? 0.42 : 1;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function stamp() {
  const d = /* @__PURE__ */ new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes());
}
function mount(api) {
  const root = document.getElementById("db");
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const sig = api && api.signal ? api.signal : new AbortController().signal;
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, Object.assign({ signal: sig }, opts || {}));
  };
  const cv = $("#db-cv");
  const g = cv.getContext("2d");
  const wrap = $("#db-wrap");
  const ta = $("#db-txt");
  const rail = $("#db-rail");
  const panel = $("#db-side");
  const scrim = $("#db-scrim");
  const hint = $("#db-hint");
  const stat = $("#db-stat");
  const toastEl = $("#db-toast");
  const colorBox = $("#db-colors");
  const bgBox = $("#db-bgs");
  const colorInput = $("#db-color");
  const widthInput = $("#db-width");
  const widthOut = $("#db-wval");
  const dashSeg = $("#db-dash");
  const fillSeg = $("#db-fill");
  const fsInput = $("#db-fs");
  const fsOut = $("#db-fsval");
  const gridSel = $("#db-grid");
  const orientSeg = $("#db-orient");
  const sizeSel = $("#db-size");
  const bwIn = $("#db-w");
  const bhIn = $("#db-h");
  const fmtSel = $("#db-fmt");
  const scaleSel = $("#db-scale");
  const alphaChk = $("#db-alpha");
  const opRow = $("#db-oprow");
  const opInput = $("#db-op");
  const opOut = $("#db-opval");
  const undoBtn = $("#db-undo");
  const redoBtn = $("#db-redo");
  const zval = $("#db-zval");
  const S = {
    w: 1600,
    h: 900,
    bg: "#FFFFFF",
    grid: "dots",
    objects: [],
    tool: "pen",
    color: "#22282B",
    size: 4,
    dash: false,
    fill: "none",
    fontSize: 32,
    sel: null,
    view: { scale: 1, tx: 0, ty: 0 }
  };
  let dpr = 1;
  let dark = false;
  let raf = 0;
  let inited = false;
  let editing = null;
  let drag = null;
  let spaceDown = false;
  let lastPt = null;
  let pinch = null;
  const ptrs = /* @__PURE__ */ new Map();
  const imgCache = /* @__PURE__ */ new Map();
  const tileCache = /* @__PURE__ */ new Map();
  const past = [];
  const future = [];
  let toastTimer = 0;
  let hintTimer = 0;
  let saveTimer = 0;
  let quotaWarned = false;
  let busy = false;
  const STORE_KEY = "drawboard.draft.v1";
  function syncTheme() {
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", t);
    dark = t === "dark";
    req();
  }
  syncTheme();
  try {
    const mo = new MutationObserver(syncTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (sig.addEventListener) sig.addEventListener("abort", () => mo.disconnect());
  } catch (e) {
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1900);
  }
  function flashHint(msg) {
    hint.textContent = msg;
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("show"), 2600);
  }
  function shapePath(o) {
    const p = new Path2D();
    const x = o.x, y = o.y, w = o.w, h = o.h;
    if (o.type === "rect") {
      p.rect(x, y, w, h);
    } else if (o.type === "ellipse") {
      p.ellipse(x + w / 2, y + h / 2, Math.max(0.01, w / 2), Math.max(0.01, h / 2), 0, 0, TAU);
    } else if (o.type === "triangle") {
      p.moveTo(x + w / 2, y);
      p.lineTo(x + w, y + h);
      p.lineTo(x, y + h);
      p.closePath();
    } else if (o.type === "diamond") {
      p.moveTo(x + w / 2, y);
      p.lineTo(x + w, y + h / 2);
      p.lineTo(x + w / 2, y + h);
      p.lineTo(x, y + h / 2);
      p.closePath();
    } else if (o.type === "star") {
      const pts = starPts(x + w / 2, y + h / 2, w / 2, h / 2, 5);
      p.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
      p.closePath();
    }
    return p;
  }
  function penPath(pts) {
    const p = new Path2D();
    if (!pts || !pts.length) return p;
    if (pts.length === 1) {
      p.moveTo(pts[0].x, pts[0].y);
      p.lineTo(pts[0].x + 0.01, pts[0].y);
      return p;
    }
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      p.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    p.lineTo(last.x, last.y);
    return p;
  }
  const mcv = document.createElement("canvas");
  const mctx = mcv.getContext("2d");
  function measureLine(text, size) {
    mctx.font = size + "px " + FONT;
    return mctx.measureText(text).width;
  }
  function textBox(o) {
    const lines = String(o.text || "").split("\n");
    let w = 0;
    for (let i = 0; i < lines.length; i++) w = Math.max(w, measureLine(lines[i], o.size));
    const lh = o.size * 1.3;
    return { x: o.x, y: o.y, w: Math.max(w, o.size * 0.6), h: Math.max(lh, lines.length * lh) };
  }
  function bboxOf(o) {
    if (o.type === "pen" || o.type === "marker") {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < o.pts.length; i++) {
        const p = o.pts[i];
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }
      if (!isFinite(x1)) {
        x1 = 0;
        y1 = 0;
        x2 = 1;
        y2 = 1;
      }
      const hw = (o.width || 2) / 2;
      return { x: x1 - hw, y: y1 - hw, w: x2 - x1 + hw * 2, h: y2 - y1 + hw * 2 };
    }
    if (o.type === "line" || o.type === "arrow") {
      const hw = (o.width || 2) / 2;
      return {
        x: Math.min(o.x1, o.x2) - hw,
        y: Math.min(o.y1, o.y2) - hw,
        w: Math.abs(o.x2 - o.x1) + hw * 2,
        h: Math.abs(o.y2 - o.y1) + hw * 2
      };
    }
    if (o.type === "text") return textBox(o);
    return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
  }
  function req() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }
  function tile(kind, color) {
    const key = kind + "|" + color;
    if (tileCache.has(key)) return tileCache.get(key);
    const step = 25;
    const t = document.createElement("canvas");
    t.width = step;
    t.height = step;
    const q = t.getContext("2d");
    if (kind === "dots") {
      q.fillStyle = color;
      q.beginPath();
      q.arc(step / 2, step / 2, 1.4, 0, TAU);
      q.fill();
    } else {
      q.fillStyle = color;
      q.fillRect(0, 0, step, 1);
      q.fillRect(0, 0, 1, step);
    }
    tileCache.set(key, t);
    return t;
  }
  function checker() {
    if (tileCache.has("__checker")) return tileCache.get("__checker");
    const t = document.createElement("canvas");
    t.width = t.height = 22;
    const q = t.getContext("2d");
    q.fillStyle = "#FFFFFF";
    q.fillRect(0, 0, 22, 22);
    q.fillStyle = "#E4E7E4";
    q.fillRect(0, 0, 11, 11);
    q.fillRect(11, 11, 11, 11);
    tileCache.set("__checker", t);
    return t;
  }
  function paintBoard(c) {
    if (S.bg === "transparent") {
      const pat = c.createPattern(checker(), "repeat");
      c.fillStyle = pat;
    } else {
      c.fillStyle = S.bg;
    }
    c.fillRect(0, 0, S.w, S.h);
    if (S.grid !== "none") {
      const col = isDark(S.bg) ? "rgba(255,255,255,.20)" : "rgba(20,32,26,.14)";
      const pat = c.createPattern(tile(S.grid, col), "repeat");
      c.fillStyle = pat;
      c.fillRect(0, 0, S.w, S.h);
    }
  }
  function arrowHead(c, x, y, a, len, spread) {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - len * Math.cos(a - spread), y - len * Math.sin(a - spread));
    c.lineTo(x - len * Math.cos(a + spread), y - len * Math.sin(a + spread));
    c.closePath();
    c.fill();
  }
  function drawObject(c, o) {
    if (o._hide) return;
    const sw = Math.max(0.5, o.width || 2);
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    if (o.type === "pen" || o.type === "marker") {
      if (o.type === "marker") c.globalAlpha = 0.34;
      c.strokeStyle = o.color;
      c.lineWidth = sw;
      c.stroke(penPath(o.pts));
    } else if (o.type === "line" || o.type === "arrow") {
      const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const head = o.type === "arrow" ? Math.max(9, sw * 3.4) : 0;
      const ex = o.x2 - Math.cos(ang) * head * 0.82;
      const ey = o.y2 - Math.sin(ang) * head * 0.82;
      c.strokeStyle = o.color;
      c.lineWidth = sw;
      if (o.dash) {
        const d = Math.max(6, sw * 2.4);
        c.setLineDash([d, d * 0.8]);
      }
      c.beginPath();
      c.moveTo(o.x1, o.y1);
      c.lineTo(head ? ex : o.x2, head ? ey : o.y2);
      c.stroke();
      if (head) {
        c.setLineDash([]);
        c.fillStyle = o.color;
        arrowHead(c, o.x2, o.y2, ang, head, 0.42);
      }
    } else if (o.type === "text") {
      const lines = String(o.text || "").split("\n");
      const lh = o.size * 1.3;
      c.fillStyle = o.color;
      c.textBaseline = "top";
      c.textAlign = "left";
      c.font = o.size + "px " + FONT;
      for (let i = 0; i < lines.length; i++) c.fillText(lines[i], o.x, o.y + i * lh);
    } else if (o.type === "image") {
      c.globalAlpha = o.opacity == null ? 1 : o.opacity;
      const el = imageFor(o.src);
      if (el) c.drawImage(el, o.x, o.y, o.w, o.h);
      else {
        c.fillStyle = "rgba(140,150,145,.16)";
        c.fillRect(o.x, o.y, o.w, o.h);
        c.strokeStyle = "rgba(140,150,145,.5)";
        c.lineWidth = 1;
        c.setLineDash([6, 5]);
        c.strokeRect(o.x, o.y, o.w, o.h);
      }
    } else if (CLOSED[o.type]) {
      const p = shapePath(o);
      if (o.fill && o.fill !== "none") {
        c.fillStyle = o.fill === "solid" ? o.color : rgba(o.color, 0.16);
        c.fill(p);
      }
      c.strokeStyle = o.color;
      c.lineWidth = sw;
      if (o.dash) {
        const d = Math.max(6, sw * 2.4);
        c.setLineDash([d, d * 0.8]);
      }
      c.stroke(p);
    }
    c.restore();
  }
  function drawObjects(c) {
    for (let i = 0; i < S.objects.length; i++) drawObject(c, S.objects[i]);
  }
  function handlePos(b) {
    const v = S.view;
    const x = b.x * v.scale + v.tx, y = b.y * v.scale + v.ty;
    const w = b.w * v.scale, h = b.h * v.scale;
    return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  }
  function drawSelection(c) {
    if (!S.sel) return;
    const o = findObj(S.sel);
    if (!o || o._hide) return;
    const b = bboxOf(o);
    const p = handlePos(b);
    const acc = dark ? "#5DCAA5" : "#1D9E75";
    c.save();
    c.strokeStyle = acc;
    c.lineWidth = 1.5;
    c.setLineDash([5, 4]);
    c.strokeRect(p[0][0] - 3, p[0][1] - 3, b.w * S.view.scale + 6, b.h * S.view.scale + 6);
    c.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = dark ? "#1A1F1E" : "#FFFFFF";
      c.beginPath();
      c.rect(p[i][0] - 4.5, p[i][1] - 4.5, 9, 9);
      c.fill();
      c.stroke();
    }
    c.restore();
  }
  function drawRing(c) {
    if (!lastPt) return;
    const t = S.tool;
    if (t !== "pen" && t !== "marker" && t !== "eraser") return;
    let r;
    if (t === "eraser") r = 11;
    else r = Math.max(2, (t === "marker" ? markerWidth() : S.size) * S.view.scale / 2);
    r = Math.max(3, r);
    c.save();
    c.beginPath();
    c.arc(lastPt.sx, lastPt.sy, r, 0, TAU);
    c.lineWidth = 1;
    c.strokeStyle = dark ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.42)";
    c.stroke();
    c.restore();
  }
  function render() {
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    const nd = Math.min(window.devicePixelRatio || 1, 2.5);
    const pw = Math.round(cw * nd), ph = Math.round(ch * nd);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    dpr = nd;
    const v = S.view;
    const bw = S.w * v.scale, bh = S.h * v.scale;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(nd, 0, 0, nd, 0, 0);
    g.save();
    g.shadowColor = dark ? "rgba(0,0,0,.55)" : "rgba(18,30,25,.22)";
    g.shadowBlur = 20;
    g.shadowOffsetY = 5;
    g.fillStyle = S.bg === "transparent" ? "#FFFFFF" : S.bg;
    g.fillRect(v.tx, v.ty, bw, bh);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(v.tx, v.ty, bw, bh);
    g.clip();
    g.translate(v.tx, v.ty);
    g.scale(v.scale, v.scale);
    paintBoard(g);
    drawObjects(g);
    g.restore();
    g.save();
    g.strokeStyle = dark ? "rgba(255,255,255,.14)" : "rgba(18,30,25,.12)";
    g.lineWidth = 1;
    g.strokeRect(v.tx + 0.5, v.ty + 0.5, Math.max(0, bw - 1), Math.max(0, bh - 1));
    g.restore();
    drawSelection(g);
    drawRing(g);
    placeEditor();
    stat.textContent = S.objects.length + " 个对象 · " + S.w + "×" + S.h;
  }
  function snap() {
    const objs = [];
    for (let i = 0; i < S.objects.length; i++) {
      const o = S.objects[i];
      if (o._hide) continue;
      objs.push(o);
    }
    return JSON.stringify({ o: objs, bg: S.bg, w: S.w, h: S.h, grid: S.grid });
  }
  function pushHistory(before) {
    if (!before || before === snap()) return;
    past.push(before);
    let total = 0;
    for (let i = 0; i < past.length; i++) total += past[i].length;
    while (past.length > 30 || total > 16e6 && past.length > 6) {
      total -= past.shift().length;
    }
    future.length = 0;
    updateUI();
    scheduleSave();
  }
  function applySnap(str) {
    let d;
    try {
      d = JSON.parse(str);
    } catch (e) {
      return;
    }
    if (!d || !Array.isArray(d.o)) return;
    S.objects = d.o;
    S.bg = typeof d.bg === "string" ? d.bg : S.bg;
    S.w = d.w > 0 ? d.w : S.w;
    S.h = d.h > 0 ? d.h : S.h;
    S.grid = d.grid || "none";
    S.sel = null;
    syncBoardUI();
    syncPanel();
    req();
  }
  function undo() {
    if (editing) commitEdit();
    if (!past.length) return;
    const cur = snap();
    const prev = past.pop();
    future.push(cur);
    applySnap(prev);
    updateUI();
    scheduleSave();
    toast("已撤销");
  }
  function redo() {
    if (!future.length) return;
    const cur = snap();
    const next = future.pop();
    past.push(cur);
    applySnap(next);
    updateUI();
    scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 450);
  }
  function saveDraft() {
    let data;
    try {
      data = snap();
    } catch (e) {
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, data);
    } catch (err) {
      try {
        const d = JSON.parse(data);
        d.o = d.o.filter((o) => o.type !== "image");
        localStorage.setItem(STORE_KEY, JSON.stringify(d));
        if (!quotaWarned) {
          quotaWarned = true;
          toast("底图较大，草稿未能保存它，请及时导出");
        }
      } catch (e2) {
      }
    }
    if (api && api.storage && typeof api.storage.flush === "function") {
      try {
        api.storage.flush().catch(() => {
          if (!sig.aborted) toast("草稿未能写入设备，请及时导出");
        });
      } catch (e) {
      }
    }
  }
  function loadDraft() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.o)) return false;
      S.objects = d.o;
      if (typeof d.bg === "string") S.bg = d.bg;
      if (d.w > 0) S.w = d.w;
      if (d.h > 0) S.h = d.h;
      if (d.grid) S.grid = d.grid;
      return S.objects.length > 0;
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
  on(window, "pagehide", () => {
    clearTimeout(saveTimer);
    saveDraft();
  });
  function imageFor(src) {
    if (!src) return null;
    let e = imgCache.get(src);
    if (!e) {
      const el = new Image();
      e = { el, ok: false };
      el.onload = () => {
        e.ok = true;
        req();
      };
      el.onerror = () => {
        e.ok = false;
      };
      el.src = src;
      imgCache.set(src, e);
    }
    return e.ok ? e.el : null;
  }
  const hcv = document.createElement("canvas");
  hcv.width = hcv.height = 1;
  const hx = hcv.getContext("2d");
  function strokeHit(path, o, bp, tol) {
    hx.lineWidth = (o.width || 2) + tol * 2;
    try {
      return hx.isPointInStroke(path, bp.x, bp.y);
    } catch (e) {
      return false;
    }
  }
  function fillHit(path, bp) {
    try {
      return hx.isPointInPath(path, bp.x, bp.y);
    } catch (e) {
      return false;
    }
  }
  function hitTest(o, bp, tol) {
    if (o.type === "text") {
      const b = textBox(o);
      return bp.x >= b.x - tol && bp.x <= b.x + b.w + tol && bp.y >= b.y - tol && bp.y <= b.y + b.h + tol;
    }
    if (o.type === "image") {
      return bp.x >= o.x - tol && bp.x <= o.x + o.w + tol && bp.y >= o.y - tol && bp.y <= o.y + o.h + tol;
    }
    if (o.type === "pen" || o.type === "marker") return strokeHit(penPath(o.pts), o, bp, tol);
    if (o.type === "line" || o.type === "arrow") {
      const d = segDist(bp, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 });
      const extra = o.type === "arrow" ? Math.max(9, (o.width || 2) * 3.4) * 0.5 : 0;
      return d <= (o.width || 2) / 2 + tol + extra;
    }
    if (CLOSED[o.type]) {
      const p = shapePath(o);
      if (o.fill && o.fill !== "none" && fillHit(p, bp)) return true;
      return strokeHit(p, o, bp, tol);
    }
    return false;
  }
  function pick(bp) {
    const tol = 6 / S.view.scale;
    for (let i = S.objects.length - 1; i >= 0; i--) {
      const o = S.objects[i];
      if (o._hide) continue;
      if (hitTest(o, bp, tol)) return o;
    }
    return null;
  }
  function findObj(id) {
    for (let i = 0; i < S.objects.length; i++) if (S.objects[i].id === id) return S.objects[i];
    return null;
  }
  function findIndex(id) {
    for (let i = 0; i < S.objects.length; i++) if (S.objects[i].id === id) return i;
    return -1;
  }
  function handleAt(p) {
    if (!S.sel) return null;
    const o = findObj(S.sel);
    if (!o || o._hide) return null;
    const pts = handlePos(bboxOf(o));
    const names = ["nw", "ne", "sw", "se"];
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.sx - pts[i][0], p.sy - pts[i][1]) <= 12) return names[i];
    }
    return null;
  }
  function translateObj(o, dx, dy) {
    if (o.type === "pen" || o.type === "marker") {
      o.pts = o.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (o.type === "line" || o.type === "arrow") {
      o.x1 += dx;
      o.y1 += dy;
      o.x2 += dx;
      o.y2 += dy;
    } else {
      o.x += dx;
      o.y += dy;
    }
  }
  function scaleObj(o, b0, b1) {
    const sx = b0.w ? b1.w / b0.w : 1;
    const sy = b0.h ? b1.h / b0.h : 1;
    const fx = (x) => b1.x + (x - b0.x) * sx;
    const fy = (y) => b1.y + (y - b0.y) * sy;
    if (o.type === "pen" || o.type === "marker") {
      o.pts = o.pts.map((p) => ({ x: fx(p.x), y: fy(p.y) }));
      o.width = Math.max(0.5, (o.width || 2) * Math.abs((sx + sy) / 2));
    } else if (o.type === "line" || o.type === "arrow") {
      const a = { x: fx(o.x1), y: fy(o.y1) };
      const b = { x: fx(o.x2), y: fy(o.y2) };
      o.x1 = a.x;
      o.y1 = a.y;
      o.x2 = b.x;
      o.y2 = b.y;
    } else if (o.type === "text") {
      o.x = fx(o.x);
      o.y = fy(o.y);
      o.size = Math.max(6, o.size * sy);
    } else {
      o.x = b1.x;
      o.y = b1.y;
      o.w = b1.w;
      o.h = b1.h;
    }
  }
  function zoomAt(p, ns) {
    const v = S.view;
    ns = clamp(ns, 0.05, 10);
    const bx = (p.sx - v.tx) / v.scale;
    const by = (p.sy - v.ty) / v.scale;
    v.scale = ns;
    v.tx = p.sx - bx * ns;
    v.ty = p.sy - by * ns;
    updateUI();
    req();
  }
  let fittedView = null;
  function fit() {
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    const pad = 22;
    const s = clamp(Math.min((cw - pad * 2) / S.w, (ch - pad * 2) / S.h), 0.05, 4);
    S.view.scale = s;
    S.view.tx = (cw - S.w * s) / 2;
    S.view.ty = (ch - S.h * s) / 2;
    fittedView = { ...S.view };
    updateUI();
    req();
  }
  function localPt(e) {
    const r = cv.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function toBoard(p) {
    return { x: (p.sx - S.view.tx) / S.view.scale, y: (p.sy - S.view.ty) / S.view.scale };
  }
  function markerWidth() {
    return Math.max(14, S.size * 3);
  }
  function beginPinch() {
    if (drag && drag.kind === "draw") {
      removeObj(drag.obj.id);
      drag = null;
    } else if (drag && drag.before) {
      applySnap(drag.before);
      drag = null;
    }
    const a = Array.from(ptrs.values());
    if (a.length < 2) return;
    pinch = {
      d: Math.max(1, Math.hypot(a[0].sx - a[1].sx, a[0].sy - a[1].sy)),
      mid: { sx: (a[0].sx + a[1].sx) / 2, sy: (a[0].sy + a[1].sy) / 2 },
      view: { scale: S.view.scale, tx: S.view.tx, ty: S.view.ty }
    };
  }
  on(cv, "pointerdown", (e) => {
    if (e.button === 2) return;
    if (editing) commitEdit();
    try {
      cv.setPointerCapture(e.pointerId);
    } catch (err) {
    }
    const p = localPt(e);
    lastPt = p;
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) {
      beginPinch();
      return;
    }
    if (ptrs.size > 2) return;
    e.preventDefault();
    const bp = toBoard(p);
    const panMode = S.tool === "hand" || spaceDown || e.button === 1;
    if (panMode) {
      drag = { kind: "pan", pid: e.pointerId, prev: p };
      cv.style.cursor = "grabbing";
      return;
    }
    if (S.tool === "select") {
      startSelect(e, p, bp);
      return;
    }
    if (S.tool === "eraser") {
      drag = { kind: "erase", pid: e.pointerId, before: snap(), changed: false };
      eraseAt(bp);
      return;
    }
    if (S.tool === "text") {
      startText(bp);
      return;
    }
    startDraw(e, bp);
  });
  on(cv, "pointermove", (e) => {
    const p = localPt(e);
    lastPt = p;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2 && pinch) {
      const a = Array.from(ptrs.values());
      const d = Math.max(1, Math.hypot(a[0].sx - a[1].sx, a[0].sy - a[1].sy));
      const mid = { sx: (a[0].sx + a[1].sx) / 2, sy: (a[0].sy + a[1].sy) / 2 };
      const ns = clamp(pinch.view.scale * (d / pinch.d), 0.05, 10);
      const bx = (pinch.mid.sx - pinch.view.tx) / pinch.view.scale;
      const by = (pinch.mid.sy - pinch.view.ty) / pinch.view.scale;
      S.view.scale = ns;
      S.view.tx = mid.sx - bx * ns;
      S.view.ty = mid.sy - by * ns;
      updateUI();
      req();
      return;
    }
    if (!drag) {
      req();
      return;
    }
    const bp = toBoard(p);
    if (drag.kind === "pan") {
      S.view.tx += p.sx - drag.prev.sx;
      S.view.ty += p.sy - drag.prev.sy;
      drag.prev = p;
      req();
      return;
    }
    if (drag.kind === "draw") {
      moveDraw(e, bp);
      return;
    }
    if (drag.kind === "move") {
      const dx = bp.x - drag.start.x, dy = bp.y - drag.start.y;
      restoreFrom(drag.obj, drag.clone);
      let mx = dx, my = dy;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) my = 0;
        else mx = 0;
      }
      translateObj(drag.obj, mx, my);
      req();
      return;
    }
    if (drag.kind === "scale") {
      moveScale(e, bp);
      return;
    }
    if (drag.kind === "erase") {
      eraseAt(bp);
      return;
    }
  });
  function endPointer(e) {
    ptrs.delete(e.pointerId);
    if (pinch) {
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0) endDrag();
      return;
    }
    if (ptrs.size === 0) endDrag();
  }
  on(cv, "pointerup", endPointer);
  on(cv, "pointercancel", endPointer);
  on(cv, "pointerleave", () => {
    if (!drag) {
      lastPt = null;
      req();
    }
  });
  on(cv, "contextmenu", (e) => e.preventDefault());
  function endDrag() {
    cv.style.cursor = cursorFor();
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "draw") {
      const o = d.obj;
      if (CLOSED[o.type] && (o.w < 3 || o.h < 3)) {
        removeObj(o.id);
      } else if (o.type === "line" || o.type === "arrow") {
        if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3) removeObj(o.id);
      } else if (o.type === "pen" || o.type === "marker") {
        o.pts = simplify(o.pts, 0.55);
      }
      pushHistory(d.before);
    } else if (d.kind === "move" || d.kind === "scale") {
      pushHistory(d.before);
    } else if (d.kind === "erase") {
      if (d.changed) pushHistory(d.before);
    }
    req();
  }
  function restoreFrom(o, clone) {
    const keys = Object.keys(clone);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === "pts") o.pts = clone.pts.map((p) => ({ x: p.x, y: p.y }));
      else o[k] = clone[k];
    }
  }
  function startDraw(e, bp) {
    const before = snap();
    const id = uid();
    let o;
    if (S.tool === "pen" || S.tool === "marker") {
      o = {
        id,
        type: S.tool,
        pts: [{ x: bp.x, y: bp.y }],
        color: S.color,
        width: S.tool === "marker" ? markerWidth() : S.size
      };
    } else if (S.tool === "line" || S.tool === "arrow") {
      o = {
        id,
        type: S.tool,
        x1: bp.x,
        y1: bp.y,
        x2: bp.x,
        y2: bp.y,
        color: S.color,
        width: S.size,
        dash: S.dash
      };
    } else {
      o = {
        id,
        type: S.tool,
        x: bp.x,
        y: bp.y,
        w: 0,
        h: 0,
        color: S.color,
        width: S.size,
        dash: S.dash,
        fill: S.fill
      };
    }
    S.objects.push(o);
    drag = { kind: "draw", pid: e.pointerId, obj: o, start: bp, before };
    req();
  }
  function moveDraw(e, bp) {
    const o = drag.obj;
    const st = drag.start;
    if (o.type === "pen" || o.type === "marker") {
      const last = o.pts[o.pts.length - 1];
      if (Math.hypot(bp.x - last.x, bp.y - last.y) * S.view.scale > 1.1) o.pts.push({ x: bp.x, y: bp.y });
    } else if (o.type === "line" || o.type === "arrow") {
      let x2 = bp.x, y2 = bp.y;
      if (e.shiftKey) {
        const ang = Math.atan2(bp.y - st.y, bp.x - st.x);
        const step = Math.PI / 4;
        const snapped = Math.round(ang / step) * step;
        const len = Math.hypot(bp.x - st.x, bp.y - st.y);
        x2 = st.x + Math.cos(snapped) * len;
        y2 = st.y + Math.sin(snapped) * len;
      }
      o.x2 = x2;
      o.y2 = y2;
    } else {
      let x1 = Math.min(st.x, bp.x), y1 = Math.min(st.y, bp.y);
      let w = Math.abs(bp.x - st.x), h = Math.abs(bp.y - st.y);
      if (e.shiftKey) {
        const s = Math.max(w, h);
        w = s;
        h = s;
        x1 = bp.x < st.x ? st.x - s : st.x;
        y1 = bp.y < st.y ? st.y - s : st.y;
      }
      o.x = x1;
      o.y = y1;
      o.w = w;
      o.h = h;
    }
    req();
  }
  function startSelect(e, p, bp) {
    const o = S.sel ? findObj(S.sel) : null;
    if (o) {
      const h = handleAt(p);
      if (h) {
        drag = {
          kind: "scale",
          pid: e.pointerId,
          handle: h,
          obj: o,
          before: snap(),
          clone: JSON.parse(JSON.stringify(o)),
          b0: bboxOf(o)
        };
        return;
      }
    }
    const hit = pick(bp);
    if (!hit) {
      S.sel = null;
      syncPanel();
      req();
      return;
    }
    S.sel = hit.id;
    syncPanel();
    drag = {
      kind: "move",
      pid: e.pointerId,
      obj: hit,
      before: snap(),
      clone: JSON.parse(JSON.stringify(hit)),
      start: bp
    };
    req();
  }
  function moveScale(e, bp) {
    const d = drag;
    const b0 = d.b0;
    let x1 = b0.x, y1 = b0.y, x2 = b0.x + b0.w, y2 = b0.y + b0.h;
    if (d.handle.indexOf("w") >= 0) x1 = bp.x;
    else x2 = bp.x;
    if (d.handle.indexOf("n") >= 0) y1 = bp.y;
    else y2 = bp.y;
    if (e.shiftKey && b0.w > 0 && b0.h > 0) {
      const ratio = b0.h / b0.w;
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      if (w * ratio > h) {
        const nh = w * ratio;
        if (d.handle.indexOf("n") >= 0) y1 = y2 - nh;
        else y2 = y1 + nh;
      } else {
        const nw = h / ratio;
        if (d.handle.indexOf("w") >= 0) x1 = x2 - nw;
        else x2 = x1 + nw;
      }
    }
    let nb = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1)
    };
    nb.w = Math.max(4, nb.w);
    nb.h = Math.max(4, nb.h);
    restoreFrom(d.obj, d.clone);
    scaleObj(d.obj, b0, nb);
    req();
  }
  function eraseAt(bp) {
    const tol = 8 / S.view.scale;
    let hit = false;
    for (let i = S.objects.length - 1; i >= 0; i--) {
      const o = S.objects[i];
      if (o._hide) continue;
      if (hitTest(o, bp, tol)) {
        S.objects.splice(i, 1);
        hit = true;
        if (S.sel === o.id) S.sel = null;
      }
    }
    if (hit) {
      if (drag) drag.changed = true;
      syncPanel();
      req();
    }
  }
  function removeObj(id) {
    const i = findIndex(id);
    if (i >= 0) S.objects.splice(i, 1);
    if (S.sel === id) S.sel = null;
  }
  function startText(bp) {
    const before = snap();
    const o = {
      id: uid(),
      type: "text",
      x: bp.x,
      y: bp.y,
      text: "",
      color: S.color,
      size: S.fontSize
    };
    S.objects.push(o);
    S.sel = o.id;
    openEditor(o, before, true);
  }
  function openEditor(o, before, isNew) {
    editing = { obj: o, before: before || snap(), isNew: !!isNew };
    o._hide = true;
    ta.hidden = false;
    ta.value = o.text || "";
    placeEditor();
    req();
    setTimeout(() => {
      try {
        ta.focus();
        const n = ta.value.length;
        ta.setSelectionRange(n, n);
      } catch (e) {
      }
    }, 0);
  }
  function placeEditor() {
    if (!editing) {
      if (!ta.hidden) ta.hidden = true;
      return;
    }
    const o = editing.obj;
    const sc = S.view.scale;
    const fs = Math.max(9, o.size * sc);
    const lines = ta.value.split("\n");
    let wmax = 0;
    for (let i = 0; i < lines.length; i++) wmax = Math.max(wmax, measureLine(lines[i] || " ", o.size));
    ta.hidden = false;
    ta.style.left = o.x * sc + S.view.tx + "px";
    ta.style.top = o.y * sc + S.view.ty + "px";
    ta.style.fontSize = fs + "px";
    ta.style.lineHeight = o.size * 1.3 * sc + "px";
    ta.style.color = o.color;
    ta.style.width = Math.max(80, wmax * sc + 26) + "px";
    ta.style.height = Math.max(fs * 1.5, lines.length * o.size * 1.3 * sc + 6) + "px";
  }
  function commitEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    ta.hidden = true;
    const o = ed.obj;
    o._hide = false;
    const txt = ta.value.replace(/[\s\u3000]+$/, "");
    if (!txt) {
      removeObj(o.id);
    } else {
      o.text = txt;
    }
    pushHistory(ed.before);
    S.sel = txt ? o.id : null;
    syncPanel();
    req();
  }
  on(ta, "input", () => {
    placeEditor();
  });
  on(ta, "blur", () => {
    if (editing) commitEdit();
  });
  on(ta, "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    }
    e.stopPropagation();
  });
  on(cv, "dblclick", (e) => {
    const p = localPt(e);
    const bp = toBoard(p);
    const o = pick(bp);
    if (o && o.type === "text") {
      S.sel = o.id;
      syncPanel();
      openEditor(o, snap(), false);
    }
  });
  on(cv, "wheel", (e) => {
    e.preventDefault();
    const p = localPt(e);
    if (e.shiftKey && !e.ctrlKey) {
      S.view.tx -= e.deltaY;
      req();
      return;
    }
    const k = Math.exp(-e.deltaY * 16e-4);
    zoomAt(p, S.view.scale * k);
  }, { passive: false });
  on(window, "keydown", (e) => {
    const t = e.target;
    const tag = t && t.tagName ? t.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (t === ta) return;
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
        doExport();
        return;
      }
      if (k === "d") {
        e.preventDefault();
        duplicateSel();
        return;
      }
      if (k === "a") {
        e.preventDefault();
        return;
      }
      return;
    }
    if (e.key === " ") {
      spaceDown = true;
      cv.style.cursor = "grab";
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      S.sel = null;
      syncPanel();
      req();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (S.sel) {
        e.preventDefault();
        const before = snap();
        removeObj(S.sel);
        pushHistory(before);
        syncPanel();
        req();
      }
      return;
    }
    if (e.key === "+" || e.key === "=") {
      zoomAt(centerPt(), S.view.scale * 1.2);
      return;
    }
    if (e.key === "-") {
      zoomAt(centerPt(), S.view.scale / 1.2);
      return;
    }
    if (e.key === "0") {
      fit();
      return;
    }
    const low = e.key.toLowerCase();
    for (let i = 0; i < TOOLS.length; i++) {
      const td = TOOLS[i];
      if (td.key === low) {
        setTool(td.id);
        e.preventDefault();
        return;
      }
    }
  });
  on(window, "keyup", (e) => {
    if (e.key === " ") {
      spaceDown = false;
      cv.style.cursor = cursorFor();
    }
  });
  on(window, "blur", () => {
    spaceDown = false;
    cv.style.cursor = cursorFor();
  });
  function centerPt() {
    return { sx: wrap.clientWidth / 2, sy: wrap.clientHeight / 2 };
  }
  function cursorFor() {
    if (S.tool === "hand") return "grab";
    if (S.tool === "select") return "default";
    if (S.tool === "text") return "text";
    return "crosshair";
  }
  function setTool(id) {
    S.tool = id;
    const btns = rail.querySelectorAll(".tb");
    for (let i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].dataset.tool === id);
    cv.style.cursor = cursorFor();
    for (let i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === id && TOOLS[i].hint) {
        flashHint(TOOLS[i].label + " · " + TOOLS[i].hint);
        break;
      }
    }
    syncPanel();
    req();
  }
  function applyColor(hex, remember) {
    S.color = hex;
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && o.color) o.color = hex;
    }
    if (remember) {
      try {
        localStorage.setItem("drawboard.color", hex);
      } catch (e) {
      }
    }
    syncPanel();
    req();
  }
  function syncSwatches() {
    const items = colorBox.querySelectorAll(".swi");
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("on", items[i].dataset.v.toLowerCase() === String(S.color).toLowerCase());
    }
    colorInput.value = hexToRgb(S.color) ? S.color : "#22282b";
  }
  function syncBoardUI() {
    const items = bgBox.querySelectorAll(".swi");
    for (let i = 0; i < items.length; i++) items[i].classList.toggle("on", items[i].dataset.v === S.bg);
    gridSel.value = S.grid;
    bwIn.value = S.w;
    bhIn.value = S.h;
    let matched = false;
    for (let i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i][0] === S.w + "x" + S.h) matched = true;
    }
    sizeSel.value = matched ? S.w + "x" + S.h : "custom";
    const dir = orientationOf(S.w, S.h);
    const ob = orientSeg.querySelectorAll("button");
    for (let i = 0; i < ob.length; i++) ob[i].classList.toggle("on", ob[i].dataset.v === dir);
  }
  function syncPanel() {
    const o = S.sel ? findObj(S.sel) : null;
    const has = !!o;
    $("#db-front").disabled = !has;
    $("#db-back").disabled = !has;
    $("#db-dup").disabled = !has;
    $("#db-del").disabled = !has;
    opRow.hidden = !(has && o.type === "image");
    if (has && o.type === "image") {
      const op = Math.round((o.opacity == null ? 1 : o.opacity) * 100);
      opInput.value = op;
      opOut.textContent = op;
    }
    fsInput.value = has && o.type === "text" ? Math.round(o.size) : S.fontSize;
    fsOut.textContent = fsInput.value;
    widthInput.value = S.size;
    widthOut.textContent = S.size;
    const dashV = o && (o.type === "line" || o.type === "arrow" || CLOSED[o.type]) ? !!o.dash : S.dash;
    setSeg(dashSeg, dashV ? "1" : "0");
    const fillV = o && CLOSED[o.type] ? o.fill || "none" : S.fill;
    setSeg(fillSeg, fillV);
    if (o && o.color) {
      colorInput.value = hexToRgb(o.color) ? o.color : colorInput.value;
      const items = colorBox.querySelectorAll(".swi");
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle("on", items[i].dataset.v.toLowerCase() === String(o.color).toLowerCase());
      }
    } else {
      syncSwatches();
    }
  }
  function setSeg(el, v) {
    const bs = el.querySelectorAll("button");
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].dataset.v === v);
  }
  function updateUI() {
    undoBtn.disabled = past.length === 0;
    redoBtn.disabled = future.length === 0;
    zval.textContent = Math.round(S.view.scale * 100) + "%";
  }
  function duplicateSel() {
    if (!S.sel) return;
    const o = findObj(S.sel);
    if (!o) return;
    const before = snap();
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid();
    if (c.type === "pen" || c.type === "marker") {
      c.pts = c.pts.map((p) => ({ x: p.x + 24, y: p.y + 24 }));
    } else if (c.type === "line" || c.type === "arrow") {
      c.x1 += 24;
      c.x2 += 24;
      c.y1 += 24;
      c.y2 += 24;
    } else {
      c.x += 24;
      c.y += 24;
    }
    S.objects.push(c);
    S.sel = c.id;
    pushHistory(before);
    syncPanel();
    req();
  }
  function moveLayer(toFront) {
    if (!S.sel) return;
    const i = findIndex(S.sel);
    if (i < 0) return;
    const before = snap();
    const o = S.objects.splice(i, 1)[0];
    if (toFront) S.objects.push(o);
    else S.objects.unshift(o);
    pushHistory(before);
    req();
  }
  function setBg(v) {
    const before = snap();
    S.bg = v;
    if (isDark(v) && !isDark(S.color)) S.color = "#FFFFFF";
    else if (!isDark(v) && isDark(S.color)) S.color = "#22282B";
    pushHistory(before);
    syncBoardUI();
    syncSwatches();
    req();
  }
  function applySize(w, h) {
    const nw = clamp(Math.round(w) || S.w, 200, 6e3);
    const nh = clamp(Math.round(h) || S.h, 200, 6e3);
    if (nw === S.w && nh === S.h) return;
    const before = snap();
    S.w = nw;
    S.h = nh;
    let outside = 0;
    for (let i = 0; i < S.objects.length; i++) {
      const b = bboxOf(S.objects[i]);
      if (b.x + b.w > nw || b.y + b.h > nh || b.x < 0 || b.y < 0) outside++;
    }
    pushHistory(before);
    syncBoardUI();
    fit();
    if (outside) toast(outside + " 个图形超出新画板范围");
  }
  function orientationOf(w, h) {
    return w > h ? "land" : h > w ? "port" : "square";
  }
  function toggleOrientation() {
    if (S.w === S.h) {
      toast("方形画板不用切换横竖，直接改尺寸即可");
      return;
    }
    const before = snap();
    const nw = S.h, nh = S.w;
    const items = S.objects.slice();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const b = bboxOf(items[i]);
      if (b.x < x1) x1 = b.x;
      if (b.y < y1) y1 = b.y;
      if (b.x + b.w > x2) x2 = b.x + b.w;
      if (b.y + b.h > y2) y2 = b.y + b.h;
    }
    let k = 1;
    if (isFinite(x1) && items.length) {
      const pad = 28;
      const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
      if (bw > nw - pad * 2 || bh > nh - pad * 2) {
        k = clamp(Math.min((nw - pad * 2) / bw, (nh - pad * 2) / bh), 0.05, 1);
      }
      const bcx = (x1 + x2) / 2, bcy = (y1 + y2) / 2;
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        const b0 = bboxOf(o);
        scaleObj(o, b0, {
          x: nw / 2 + (b0.x - bcx) * k,
          y: nh / 2 + (b0.y - bcy) * k,
          w: Math.max(1, b0.w * k),
          h: Math.max(1, b0.h * k)
        });
      }
    }
    S.w = nw;
    S.h = nh;
    pushHistory(before);
    syncBoardUI();
    fit();
    req();
    scheduleSave();
    toast("已切换为" + (nw > nh ? "横版" : "竖版") + " " + nw + "×" + nh + (k < 1 ? "（内容已等比缩小）" : ""));
  }
  (function buildRail() {
    const html = [];
    for (let i = 0; i < TOOLS.length; i++) {
      const t = TOOLS[i];
      if (t.sep) {
        html.push('<div class="tsep"></div>');
        continue;
      }
      html.push('<button class="tb" type="button" data-tool="' + t.id + '" title="' + t.label + " (" + t.key.toUpperCase() + ')" aria-label="' + t.label + '">' + ICONS[t.icon] + "</button>");
    }
    rail.innerHTML = html.join("");
    on(rail, "click", (e) => {
      const b = e.target.closest ? e.target.closest(".tb") : null;
      if (b && b.dataset.tool) setTool(b.dataset.tool);
    });
  })();
  (function buildSwatches() {
    const c = [];
    for (let i = 0; i < PALETTE.length; i++) {
      c.push('<button class="swi" type="button" data-v="' + PALETTE[i][0] + '" title="' + PALETTE[i][1] + '" aria-label="' + PALETTE[i][1] + '" style="background:' + PALETTE[i][0] + '"></button>');
    }
    colorBox.innerHTML = c.join("");
    on(colorBox, "click", (e) => {
      const b2 = e.target.closest ? e.target.closest(".swi") : null;
      if (!b2) return;
      const before = snap();
      applyColor(b2.dataset.v, true);
      pushHistory(before);
    });
    const b = [];
    for (let i = 0; i < BOARDS.length; i++) {
      b.push('<button class="swi" type="button" data-v="' + BOARDS[i][0] + '" title="' + BOARDS[i][1] + '" aria-label="' + BOARDS[i][1] + '" style="background:' + (BOARDS[i][0] === "transparent" ? "transparent" : BOARDS[i][0]) + '"></button>');
    }
    bgBox.innerHTML = b.join("");
    on(bgBox, "click", (e) => {
      const t = e.target.closest ? e.target.closest(".swi") : null;
      if (t) setBg(t.dataset.v);
    });
    const s = ['<option value="custom">自定义</option>'];
    for (let i = 0; i < PRESETS.length; i++) {
      s.push('<option value="' + PRESETS[i][0] + '">' + PRESETS[i][1] + "</option>");
    }
    sizeSel.innerHTML = s.join("");
  })();
  $("#db-undo").innerHTML = ICONS.undo;
  $("#db-redo").innerHTML = ICONS.redo;
  $("#db-zout").innerHTML = ICONS.minus;
  $("#db-rotate").innerHTML = ICONS.rotate;
  $("#db-zin").innerHTML = ICONS.plus;
  $("#db-panel").innerHTML = ICONS.panel;
  $("#db-close").innerHTML = ICONS.close;
  $("#db-export").insertAdjacentHTML("afterbegin", ICONS.download);
  function liveSlider(el, outEl, apply, suffix) {
    let before = null;
    on(el, "pointerdown", () => {
      before = snap();
    });
    on(el, "keydown", () => {
      if (!before) before = snap();
    });
    on(el, "input", () => {
      if (!before) before = snap();
      apply(Number(el.value));
      if (outEl) outEl.textContent = el.value + (suffix || "");
      req();
      scheduleSave();
    });
    on(el, "change", () => {
      if (before) {
        pushHistory(before);
        before = null;
      }
      scheduleSave();
    });
  }
  liveSlider(widthInput, widthOut, (v) => {
    S.size = clamp(v, 1, 48);
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && o.type === "marker") o.width = markerWidth();
      else if (o && (o.type === "pen" || o.type === "line" || o.type === "arrow" || CLOSED[o.type])) o.width = S.size;
    }
  });
  liveSlider(fsInput, fsOut, (v) => {
    S.fontSize = clamp(v, 10, 120);
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && o.type === "text") o.size = S.fontSize;
    }
  });
  liveSlider(opInput, opOut, (v) => {
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && o.type === "image") o.opacity = clamp(v, 10, 100) / 100;
    }
  });
  on(dashSeg, "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    const v = b.dataset.v === "1";
    const before = snap();
    S.dash = v;
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && (o.type === "line" || o.type === "arrow" || CLOSED[o.type])) o.dash = v;
    }
    setSeg(dashSeg, v ? "1" : "0");
    pushHistory(before);
    req();
  });
  on(fillSeg, "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    const before = snap();
    S.fill = b.dataset.v;
    if (S.sel) {
      const o = findObj(S.sel);
      if (o && CLOSED[o.type]) o.fill = S.fill;
    }
    setSeg(fillSeg, S.fill);
    pushHistory(before);
    req();
  });
  let colorBefore = null;
  on(colorInput, "pointerdown", () => {
    colorBefore = snap();
  });
  on(colorInput, "input", () => {
    if (!colorBefore) colorBefore = snap();
    applyColor(colorInput.value);
  });
  on(colorInput, "change", () => {
    if (colorBefore) {
      pushHistory(colorBefore);
      colorBefore = null;
    }
    applyColor(colorInput.value, true);
  });
  on(gridSel, "change", () => {
    const before = snap();
    S.grid = gridSel.value;
    pushHistory(before);
    req();
  });
  on(sizeSel, "change", () => {
    if (sizeSel.value === "custom") return;
    const p = sizeSel.value.split("x");
    applySize(Number(p[0]), Number(p[1]));
  });
  on($("#db-apply"), "click", () => {
    applySize(Number(bwIn.value), Number(bhIn.value));
  });
  on($("#db-front"), "click", () => moveLayer(true));
  on($("#db-back"), "click", () => moveLayer(false));
  on($("#db-dup"), "click", duplicateSel);
  on($("#db-del"), "click", () => {
    if (!S.sel) return;
    const before = snap();
    removeObj(S.sel);
    pushHistory(before);
    syncPanel();
    req();
  });
  on($("#db-clear"), "click", () => {
    if (!S.objects.length) {
      toast("画板已经是空的");
      return;
    }
    const before = snap();
    S.objects = [];
    S.sel = null;
    pushHistory(before);
    syncPanel();
    req();
    toast("已清空，可 Ctrl+Z 恢复");
  });
  on(undoBtn, "click", undo);
  on(redoBtn, "click", redo);
  on($("#db-zin"), "click", () => zoomAt(centerPt(), S.view.scale * 1.25));
  on($("#db-zout"), "click", () => zoomAt(centerPt(), S.view.scale / 1.25));
  on($("#db-zfit"), "click", fit);
  on($("#db-rotate"), "click", toggleOrientation);
  on(orientSeg, "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    const cur = orientationOf(S.w, S.h);
    if (b.dataset.v === cur) return;
    if (cur === "square") {
      toast("方形画板不用切换横竖，直接改尺寸即可");
      return;
    }
    toggleOrientation();
  });
  function setPanel(open) {
    const narrow = root.classList.contains("narrow");
    if (narrow) {
      panel.hidden = false;
      panel.classList.toggle("open", open);
      scrim.hidden = !open;
    } else {
      panel.hidden = !open;
      scrim.hidden = true;
    }
  }
  on($("#db-panel"), "click", () => setPanel(root.classList.contains("narrow") ? !panel.classList.contains("open") : panel.hidden));
  on($("#db-close"), "click", () => setPanel(false));
  on(scrim, "click", () => setPanel(false));
  on($("#db-export"), "click", () => {
    doExport();
  });
  on($("#db-save"), "click", () => {
    doExport();
  });
  async function pickFile(exts) {
    if (api && typeof api.openFile === "function") {
      return await api.openFile({ extensions: exts, signal: sig });
    }
    return await new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = exts.map((e) => "." + e).join(",");
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
  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        b ? resolve(b) : reject(new Error("图像编码失败"));
      }, type, quality);
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function svgString() {
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + S.w + '" height="' + S.h + '" viewBox="0 0 ' + S.w + " " + S.h + '">');
    if (S.bg !== "transparent") {
      out.push('<rect width="' + S.w + '" height="' + S.h + '" fill="' + S.bg + '"/>');
    }
    for (let i = 0; i < S.objects.length; i++) {
      const o = S.objects[i];
      const sw = Math.max(0.5, o.width || 2);
      const dash = o.dash ? ' stroke-dasharray="' + r2(Math.max(6, sw * 2.4)) + " " + r2(Math.max(6, sw * 2.4) * 0.8) + '"' : "";
      if (o.type === "pen" || o.type === "marker") {
        const d = [];
        for (let j = 0; j < o.pts.length; j++) {
          d.push((j ? "L" : "M") + r2(o.pts[j].x) + " " + r2(o.pts[j].y));
        }
        out.push('<path d="' + d.join(" ") + '" fill="none" stroke="' + o.color + '" stroke-width="' + r2(sw) + '" stroke-linecap="round" stroke-linejoin="round"' + (o.type === "marker" ? ' opacity="0.34"' : "") + "/>");
      } else if (o.type === "line" || o.type === "arrow") {
        const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
        const head = o.type === "arrow" ? Math.max(9, sw * 3.4) : 0;
        const ex = head ? o.x2 - Math.cos(ang) * head * 0.82 : o.x2;
        const ey = head ? o.y2 - Math.sin(ang) * head * 0.82 : o.y2;
        out.push('<line x1="' + r2(o.x1) + '" y1="' + r2(o.y1) + '" x2="' + r2(ex) + '" y2="' + r2(ey) + '" stroke="' + o.color + '" stroke-width="' + r2(sw) + '" stroke-linecap="round"' + dash + "/>");
        if (head) {
          const p1 = [o.x2, o.y2];
          const p2 = [o.x2 - head * Math.cos(ang - 0.42), o.y2 - head * Math.sin(ang - 0.42)];
          const p3 = [o.x2 - head * Math.cos(ang + 0.42), o.y2 - head * Math.sin(ang + 0.42)];
          out.push('<polygon points="' + [p1, p2, p3].map((p) => r2(p[0]) + "," + r2(p[1])).join(" ") + '" fill="' + o.color + '"/>');
        }
      } else if (o.type === "text") {
        const lines = String(o.text || "").split("\n");
        const lh = o.size * 1.3;
        out.push('<g font-family="' + esc(FONT) + '" font-size="' + r2(o.size) + '" fill="' + o.color + '">');
        for (let j = 0; j < lines.length; j++) {
          out.push('<text x="' + r2(o.x) + '" y="' + r2(o.y + j * lh + o.size * 0.82) + '">' + esc(lines[j]) + "</text>");
        }
        out.push("</g>");
      } else if (o.type === "image") {
        out.push('<image href="' + o.src + '" x="' + r2(o.x) + '" y="' + r2(o.y) + '" width="' + r2(o.w) + '" height="' + r2(o.h) + '" preserveAspectRatio="none"' + (o.opacity != null && o.opacity !== 1 ? ' opacity="' + o.opacity + '"' : "") + "/>");
      } else if (CLOSED[o.type]) {
        const fill = o.fill === "solid" ? o.color : o.fill === "soft" ? rgba(o.color, 0.16) : "none";
        if (o.type === "rect") {
          out.push('<rect x="' + r2(o.x) + '" y="' + r2(o.y) + '" width="' + r2(o.w) + '" height="' + r2(o.h) + '" fill="' + fill + '" stroke="' + o.color + '" stroke-width="' + r2(sw) + '"' + dash + "/>");
        } else if (o.type === "ellipse") {
          out.push('<ellipse cx="' + r2(o.x + o.w / 2) + '" cy="' + r2(o.y + o.h / 2) + '" rx="' + r2(o.w / 2) + '" ry="' + r2(o.h / 2) + '" fill="' + fill + '" stroke="' + o.color + '" stroke-width="' + r2(sw) + '"' + dash + "/>");
        } else {
          let pts;
          if (o.type === "triangle") pts = [[o.x + o.w / 2, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
          else if (o.type === "diamond") pts = [[o.x + o.w / 2, o.y], [o.x + o.w, o.y + o.h / 2], [o.x + o.w / 2, o.y + o.h], [o.x, o.y + o.h / 2]];
          else pts = starPts(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 5);
          out.push('<polygon points="' + pts.map((p) => r2(p[0]) + "," + r2(p[1])).join(" ") + '" fill="' + fill + '" stroke="' + o.color + '" stroke-width="' + r2(sw) + '" stroke-linejoin="round"' + dash + "/>");
        }
      }
    }
    out.push("</svg>");
    return out.join("");
  }
  async function doExport() {
    if (editing) commitEdit();
    if (busy) {
      toast("正在导出，请稍候");
      return;
    }
    const fmt = fmtSel.value;
    const mult = clamp(Number(scaleSel.value) || 2, 1, 3);
    const alpha = alphaChk.checked;
    const name = "画板-" + stamp();
    if (!S.objects.length && fmt !== "svg") {
      toast("画板还是空的");
      return;
    }
    busy = true;
    const lb = $("#db-save");
    lb.disabled = true;
    lb.textContent = "导出中…";
    try {
      if (fmt === "svg") {
        const blob2 = new Blob([svgString()], { type: "image/svg+xml" });
        const ok2 = await saveBlob(name + ".svg", blob2);
        toast(ok2 ? "SVG 已导出" : "已取消");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(S.w * mult);
      canvas.height = Math.round(S.h * mult);
      const c = canvas.getContext("2d");
      c.setTransform(mult, 0, 0, mult, 0, 0);
      if (fmt === "jpg") {
        c.fillStyle = "#FFFFFF";
        c.fillRect(0, 0, S.w, S.h);
      } else if (!alpha) {
        c.fillStyle = S.bg === "transparent" ? "#FFFFFF" : S.bg;
        c.fillRect(0, 0, S.w, S.h);
        if (S.grid !== "none") {
          const col = isDark(S.bg) ? "rgba(255,255,255,.20)" : "rgba(20,32,26,.14)";
          c.fillStyle = c.createPattern(tile(S.grid, col), "repeat");
          c.fillRect(0, 0, S.w, S.h);
        }
      }
      drawObjects(c);
      const blob = await toBlob(canvas, fmt === "jpg" ? "image/jpeg" : "image/png", fmt === "jpg" ? 0.94 : void 0);
      const ok = await saveBlob(name + "." + (fmt === "jpg" ? "jpg" : "png"), blob);
      toast(ok ? "已导出 " + (fmt === "jpg" ? "JPG" : "PNG") + "（" + mult + " 倍）" : "已取消");
    } catch (err) {
      toast("导出失败：" + (err && err.message || err));
    } finally {
      busy = false;
      lb.disabled = false;
      lb.textContent = "导出图片";
    }
  }
  async function importImage() {
    let f;
    try {
      f = await pickFile(["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"]);
    } catch (err) {
      toast("打开文件失败：" + (err && err.message || err));
      return;
    }
    if (!f || !f.blob) return;
    const url = URL.createObjectURL(f.blob);
    const img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("无法解码这张图片"));
        img.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      toast(err.message);
      return;
    }
    URL.revokeObjectURL(url);
    const iw = img.naturalWidth || img.width || 800;
    const ih = img.naturalHeight || img.height || 600;
    const k = Math.min(1, 2600 / Math.max(iw, ih));
    const cw = Math.max(1, Math.round(iw * k));
    const chh = Math.max(1, Math.round(ih * k));
    let src;
    try {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = chh;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, cw, chh);
      const photo = /\.(jpe?g|webp)$/i.test(f.name || "");
      src = photo ? c.toDataURL("image/jpeg", 0.92) : c.toDataURL("image/png");
    } catch (err) {
      toast("图片处理失败");
      return;
    }
    const fitK = Math.min(S.w / cw, S.h / chh) * 0.94;
    const w = cw * fitK, h = chh * fitK;
    const before = snap();
    const o = {
      id: uid(),
      type: "image",
      x: (S.w - w) / 2,
      y: (S.h - h) / 2,
      w,
      h,
      src,
      opacity: 1
    };
    S.objects.unshift(o);
    S.sel = o.id;
    setTool("select");
    pushHistory(before);
    syncPanel();
    req();
    toast("底图已导入，可拖动或换个底边角点缩放");
  }
  async function saveProject() {
    try {
      const clean = [];
      for (let i = 0; i < S.objects.length; i++) {
        const o = JSON.parse(JSON.stringify(S.objects[i]));
        delete o._hide;
        clean.push(o);
      }
      const data = JSON.stringify({
        app: "fftool.drawboard",
        v: 1,
        w: S.w,
        h: S.h,
        bg: S.bg,
        grid: S.grid,
        o: clean
      });
      const blob = new Blob([data], { type: "application/json" });
      const ok = await saveBlob("画板工程-" + stamp() + ".json", blob);
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
      toast("打开失败：" + (err && err.message || err));
      return;
    }
    if (!f || !f.blob) return;
    try {
      const text = await f.blob.text();
      const d = JSON.parse(text);
      if (!d || !Array.isArray(d.o)) throw new Error("不是画板工程文件");
      const before = snap();
      S.objects = d.o;
      S.w = d.w > 0 ? d.w : S.w;
      S.h = d.h > 0 ? d.h : S.h;
      S.bg = typeof d.bg === "string" ? d.bg : S.bg;
      S.grid = d.grid || "none";
      S.sel = null;
      pushHistory(before);
      syncBoardUI();
      syncPanel();
      fit();
      toast("已打开工程");
    } catch (err) {
      toast("打开失败：" + (err && err.message || err));
    }
  }
  on($("#db-open-img"), "click", importImage);
  on($("#db-save-proj"), "click", saveProject);
  on($("#db-open-proj"), "click", openProject);
  function layout() {
    const w = root.clientWidth;
    const narrow = w < 720;
    if (narrow !== root.classList.contains("narrow")) {
      root.classList.toggle("narrow", narrow);
      panel.hidden = false;
      panel.classList.remove("open");
      scrim.hidden = true;
    }
    const keepFit = fittedView && ["scale", "tx", "ty"].every((k) => Math.abs(S.view[k] - fittedView[k]) < 1e-3);
    if ((!inited || keepFit) && wrap.clientWidth > 0) {
      inited = true;
      fit();
    }
    req();
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  ro.observe(wrap);
  if (sig.addEventListener) sig.addEventListener("abort", () => ro.disconnect());
  const restored = loadDraft();
  try {
    const saved = localStorage.getItem("drawboard.color");
    if (saved && hexToRgb(saved)) S.color = saved;
  } catch (e) {
  }
  bwIn.value = S.w;
  bhIn.value = S.h;
  syncBoardUI();
  setTool("pen");
  syncSwatches();
  syncPanel();
  updateUI();
  layout();
  setTimeout(() => {
    if (!inited) {
      inited = true;
      fit();
    } else {
      req();
    }
  }, 120);
  if (restored) setTimeout(() => toast("已恢复上次的草稿"), 300);
  return function cleanup() {
    clearTimeout(toastTimer);
    clearTimeout(hintTimer);
    clearTimeout(saveTimer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    saveDraft();
    try {
      ro.disconnect();
    } catch (e) {
    }
    imgCache.clear();
    tileCache.clear();
  };
}
export {
  mount
};
