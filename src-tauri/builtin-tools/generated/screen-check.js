// src-tauri/builtin-tools/src/screen-check.js
var PROFILE_KEY = "screen_check.prefs.v1";
var ALL_GROUPS = ["color", "ramp", "sharp", "motion"];
var TESTS = [
  // ---------- 纯色 ----------
  { id: "white", group: "color", kind: "solid", color: "#ffffff", name: "纯白", tip: "查找不亮的暗点、偏色像素与屏面灰尘" },
  { id: "black", group: "color", kind: "solid", color: "#000000", name: "纯黑", tip: "查找常亮的亮点、四角漏光与灰雾" },
  { id: "red", group: "color", kind: "solid", color: "#ff0000", name: "纯红", tip: "红通道单独点亮，看是否有不发光或错色的子像素" },
  { id: "green", group: "color", kind: "solid", color: "#00ff00", name: "纯绿", tip: "绿通道单独点亮，人眼对绿点最敏感" },
  { id: "blue", group: "color", kind: "solid", color: "#0000ff", name: "纯蓝", tip: "蓝通道单独点亮，检查暗点与偏色" },
  { id: "cyan", group: "color", kind: "solid", color: "#00ffff", name: "青色", tip: "青 = 绿 + 蓝，红子像素不亮会显成黑色小点" },
  { id: "magenta", group: "color", kind: "solid", color: "#ff00ff", name: "品红", tip: "品红 = 红 + 蓝，绿子像素不亮会显成黑色小点" },
  { id: "yellow", group: "color", kind: "solid", color: "#ffff00", name: "黄色", tip: "黄 = 红 + 绿，蓝子像素不亮会显成黑色小点" },
  { id: "gray50", group: "color", kind: "solid", color: "#808080", name: "50% 灰", tip: "最均衡的检查底色，亮点与暗点同时可见" },
  { id: "gray20", group: "color", kind: "solid", color: "#333333", name: "20% 灰", tip: "压暗后看均匀性：脏屏斑块、四角发暗、边缘泛白" },
  // ---------- 渐变与灰阶 ----------
  { id: "grayramp", group: "ramp", kind: "ramp", name: "灰度渐变", tip: "黑到白的平滑过渡，出现一根根竖条就是色阶断层" },
  { id: "rgbramp", group: "ramp", kind: "ramp", rgb: true, name: "RGB 渐变", tip: "三条单通道渐变，检查色彩过渡是否顺滑" },
  { id: "graysteps", group: "ramp", kind: "steps", name: "32 级灰阶", tip: "每一格都应能单独分辨，相邻两格粘在一起说明灰阶不足" },
  { id: "darkdetail", group: "ramp", kind: "near", name: "暗部细节", tip: "0–32 的暗部台阶，能数出的格子越多越好，0 与 4 应可区分" },
  { id: "lightdetail", group: "ramp", kind: "near", name: "亮部细节", tip: "223–255 的亮部台阶，注意高光是否整片死白" },
  // ---------- 锐度与几何 ----------
  { id: "checker", group: "sharp", kind: "checker", name: "1px 棋盘", tip: "按物理像素绘制的棋盘，出现水波纹或彩色摩尔纹说明画面被缩放" },
  { id: "grid", group: "sharp", kind: "grid", name: "网格与圆", tip: "线条应横平竖直、粗细一致，圆不变形成椭圆" },
  { id: "text", group: "sharp", kind: "text", name: "小字与竖线", tip: "最小字仍清晰可辨、1px 竖线不糊，说明点对点显示正常" },
  // ---------- 动态 ----------
  { id: "motion", group: "motion", kind: "motion", anim: true, name: "运动方块", tip: "快速方块拖出彩色尾巴或残影，说明响应时间偏慢" },
  { id: "flicker", group: "motion", kind: "flicker", anim: true, name: "滚动条纹", tip: "条纹滚动时出现断带、双影或闪烁，可能是 PWM 调光频闪" },
  { id: "burnin", group: "motion", kind: "burnin", anim: true, name: "烧屏残影", tip: "图案每 1.4 秒黑白反转，切换后仍隐约看到上一幅即为残影" }
];
var LANES = [
  { speed: 280, dir: 1, shape: "square", color: "#ffffff" },
  { speed: 560, dir: -1, shape: "circle", color: "#8ff0c8" },
  { speed: 1150, dir: 1, shape: "stripe", color: "#ffffff" },
  { speed: 1950, dir: -1, shape: "square", color: "#ffd85e" }
];
function mount(app) {
  const signal = app && app.signal;
  const stage = document.querySelector("#stage");
  const cv = document.querySelector("#cv");
  const g = cv.getContext("2d", { alpha: false });
  const hintEl = document.querySelector("#hint");
  const hintName = document.querySelector("#hintName");
  const hintTip = document.querySelector("#hintTip");
  const bar = document.querySelector("#bar");
  const metaName = document.querySelector("#metaName");
  const metaCount = document.querySelector("#metaCount");
  const btnPrev = document.querySelector("#btnPrev");
  const btnNext = document.querySelector("#btnNext");
  const btnAuto = document.querySelector("#btnAuto");
  const btnCfg = document.querySelector("#btnCfg");
  const btnClose = document.querySelector("#btnClose");
  const panel = document.querySelector("#panel");
  const prog = document.querySelector("#prog");
  const intro = document.querySelector("#intro");
  const btnStart = document.querySelector("#btnStart");
  const prefs = loadPrefs();
  let order = [];
  let index = 0;
  let W = 1;
  let H = 1;
  let DPR = 1;
  let raf = 0;
  let autoTimer = 0;
  let idleTimer = 0;
  let frameTime = 0;
  let clockStart = 0;
  let autoPlay = false;
  let disposed = false;
  function loadPrefs() {
    const base = { autoMs: 5e3, dither: false, hint: true, groups: ALL_GROUPS.slice(), seen: false };
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return base;
      if ([3e3, 5e3, 8e3, 15e3].includes(saved.autoMs)) base.autoMs = saved.autoMs;
      if (typeof saved.dither === "boolean") base.dither = saved.dither;
      if (typeof saved.hint === "boolean") base.hint = saved.hint;
      if (typeof saved.seen === "boolean") base.seen = saved.seen;
      if (Array.isArray(saved.groups)) {
        const kept = ALL_GROUPS.filter((id) => saved.groups.includes(id));
        if (kept.length) base.groups = kept;
      }
      return base;
    } catch (error) {
      return base;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(prefs));
    } catch (error) {
    }
    try {
      const flush = app && app.storage && app.storage.flush;
      if (typeof flush === "function") Promise.resolve(flush.call(app.storage)).catch(() => {
      });
    } catch (error) {
    }
  }
  function sizeCanvas() {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    DPR = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(W * DPR));
    const ph = Math.max(1, Math.round(H * DPR));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);
  }
  function resetTransform() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function drawRamp(test) {
    const pw = cv.width;
    const ph = cv.height;
    const bands = test.rgb ? 3 : 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let b = 0; b < bands; b += 1) {
      const y0 = Math.round(ph * b / bands);
      const y1 = Math.round(ph * (b + 1) / bands);
      const off = document.createElement("canvas");
      off.width = pw;
      off.height = 1;
      const octx = off.getContext("2d");
      const img = octx.createImageData(pw, 1);
      const data = img.data;
      for (let x = 0; x < pw; x += 1) {
        let t = pw > 1 ? x / (pw - 1) : 0;
        if (prefs.dither) t = Math.max(0, Math.min(1, t + (Math.random() - 0.5) / 255));
        const v = Math.round(t * 255);
        let r = v;
        let gr = v;
        let bl = v;
        if (test.rgb) {
          if (b === 0) {
            gr = 0;
            bl = 0;
          } else if (b === 1) {
            r = 0;
            bl = 0;
          } else {
            r = 0;
            gr = 0;
          }
        }
        const o = x * 4;
        data[o] = r;
        data[o + 1] = gr;
        data[o + 2] = bl;
        data[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      g.drawImage(off, 0, y0, pw, y1 - y0);
    }
    resetTransform();
  }
  function drawSteps() {
    const n = 32;
    for (let i = 0; i < n; i += 1) {
      const v = Math.round(i / (n - 1) * 255);
      const x0 = Math.round(i * W / n);
      const x1 = Math.round((i + 1) * W / n);
      g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      g.fillRect(x0, 0, x1 - x0, H);
    }
  }
  function drawNear(test) {
    const light = test.id === "lightdetail";
    const start = light ? 223 : 0;
    const count = 9;
    g.fillStyle = light ? "#ffffff" : "#000000";
    g.fillRect(0, 0, W, H);
    let size = Math.min(W * 0.088, H * 0.26);
    let gap = Math.max(4, Math.round(size * 0.24));
    const span = (sz) => count * sz + (count - 1) * gap;
    if (span(size) > W * 0.9) {
      size = Math.max(8, (W * 0.9 - (count - 1) * gap) / count);
      gap = Math.max(3, Math.round(size * 0.24));
    }
    const title = light ? "亮部细节 223 – 255" : "暗部细节 0 – 32";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = Math.max(11, Math.round(Math.min(15, W * 0.022))) + "px system-ui, -apple-system, sans-serif";
    g.fillStyle = light ? "#8a8a8a" : "#7d7d7d";
    g.fillText(title, W / 2, H * 0.3);
    const total = span(size);
    let x = Math.round((W - total) / 2);
    const y = Math.round(H * 0.42);
    const ph = Math.round(size);
    const labelFont = Math.max(10, Math.round(Math.min(13, size * 0.3)));
    g.font = labelFont + "px system-ui, -apple-system, sans-serif";
    g.textBaseline = "top";
    for (let i = 0; i < count; i += 1) {
      const v = start + i * 4;
      const px = Math.round(x);
      const pw = Math.round(size);
      g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      g.fillRect(px, y, pw, ph);
      g.fillStyle = light ? "#7a7a7a" : "#8a8a8a";
      g.fillText(String(v), px + pw / 2, y + ph + 10);
      x += size + gap;
    }
  }
  function drawChecker() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const pw = cv.width;
    const ph = cv.height;
    const tile = document.createElement("canvas");
    tile.width = 2;
    tile.height = 2;
    const tctx = tile.getContext("2d");
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, 2, 2);
    tctx.fillStyle = "#000000";
    tctx.fillRect(0, 0, 1, 1);
    tctx.fillRect(1, 1, 1, 1);
    g.fillStyle = g.createPattern(tile, "repeat");
    g.fillRect(0, 0, pw, ph);
    resetTransform();
  }
  function drawGrid() {
    g.fillStyle = "#0a0f0e";
    g.fillRect(0, 0, W, H);
    const step = Math.max(28, Math.round(Math.min(W, H) / 12));
    g.strokeStyle = "rgba(120, 220, 180, 0.32)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += step) {
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = 0; y <= H; y += step) {
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(W, Math.round(y) + 0.5);
    }
    g.stroke();
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.42;
    g.strokeStyle = "rgba(255, 255, 255, 0.88)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - R * 1.16, cy);
    g.lineTo(cx + R * 1.16, cy);
    g.moveTo(cx, cy - R * 1.16);
    g.lineTo(cx, cy + R * 1.16);
    g.stroke();
    g.strokeStyle = "rgba(255, 255, 255, 0.55)";
    g.lineWidth = 1;
    g.strokeRect(8.5, 8.5, W - 17, H - 17);
    const ly = Math.round(H - Math.max(60, H * 0.12));
    g.fillStyle = "rgba(255, 255, 255, 0.8)";
    let lx = Math.round(Math.max(16, W * 0.06));
    const spacings = [2, 3, 4, 6, 8];
    for (let s = 0; s < spacings.length; s += 1) {
      const sp = spacings[s];
      for (let k = 0; k < 8; k += 1) g.fillRect(lx + k * sp, ly, 1, Math.round(Math.min(56, H * 0.09)));
      lx += 8 * sp + 18;
    }
  }
  function drawText() {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    const pad = Math.round(Math.max(14, Math.min(W, H) * 0.05));
    const rows = [
      [10, "屏幕检测 Screen Test 0123456789 iIl1|j"],
      [11, "屏幕检测 Screen Test 0123456789 iIl1|j"],
      [12, "屏幕检测 0123456789 iIl1|j"],
      [14, "ABC abc 123 iIl1| 小字"],
      [18, "Sharpness 清晰度"],
      [24, "Aa 屏 123"],
      [34, "Aa 屏"]
    ];
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillStyle = "#000000";
    let y = pad;
    for (let i = 0; i < rows.length; i += 1) {
      const size = rows[i][0];
      g.font = size + 'px system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif';
      g.fillText(rows[i][1], pad, y);
      y += Math.round(size * 1.9);
    }
    const maxW = Math.max(80, W - pad * 2);
    const para = "这段文字用于检查中文字形笔画是否清晰、边缘是否发虚。出现彩色边缘说明子像素渲染异常，整体发糊则说明画面被缩放。";
    g.font = '13px system-ui, -apple-system, "PingFang SC", sans-serif';
    let line = "";
    const lines = [];
    for (let i = 0; i < para.length; i += 1) {
      const next = line + para[i];
      if (g.measureText(next).width > maxW && line) {
        lines.push(line);
        line = para[i];
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    y += 4;
    for (let i = 0; i < lines.length; i += 1) {
      g.fillText(lines[i], pad, y);
      y += 21;
    }
    const lineY = y + 10;
    const lineH = Math.round(Math.min(48, H * 0.09));
    if (lineY + lineH + 24 < H) {
      g.fillStyle = "#000000";
      let lx = pad;
      const spacings = [2, 3, 4, 6, 8];
      for (let s = 0; s < spacings.length; s += 1) {
        const sp = spacings[s];
        for (let k = 0; k < 10; k += 1) g.fillRect(lx + k * sp, lineY, 1, lineH);
        lx += 10 * sp + 16;
      }
      const dotY = lineY + lineH + 10;
      if (dotY + 8 < H) {
        for (let k = 0; k < 60; k += 1) g.fillRect(pad + k * 8, dotY, 1, 1);
        g.fillRect(pad + 480, dotY, 3, 3);
      }
    }
    const sh = Math.round(Math.min(64, H * 0.12));
    const sy = H - pad - sh;
    const sw = Math.min(W - pad * 2, 260);
    if (sy > lineY + lineH + 16 && sw > 30) {
      const colors = ["#ff0000", "#00ff00", "#0000ff"];
      for (let x = 0; x < sw; x += 1) {
        g.fillStyle = colors[x % 3];
        g.fillRect(pad + x, sy, 1, sh);
      }
      g.fillStyle = "#555555";
      g.font = "11px system-ui, sans-serif";
      g.textBaseline = "alphabetic";
      g.fillText("RGB 子像素条纹（正常应混成白色）", pad, sy - 8);
    }
  }
  function drawMotion() {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, W, H);
    const laneH = H / LANES.length;
    const size = Math.max(14, Math.min(laneH * 0.44, 72));
    for (let i = 0; i < LANES.length; i += 1) {
      const lane = LANES[i];
      const cy = laneH * i + laneH / 2;
      g.strokeStyle = "rgba(255, 255, 255, 0.1)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, Math.round(cy) + 0.5);
      g.lineTo(W, Math.round(cy) + 0.5);
      g.stroke();
      g.fillStyle = "rgba(255, 255, 255, 0.28)";
      g.font = "11px system-ui, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(lane.speed + " px/s", 10, cy - laneH / 2 + 8);
      const spanLen = W + size * 2;
      const p = frameTime * lane.speed % spanLen;
      const x = lane.dir > 0 ? -size + p : W + size - p;
      g.fillStyle = lane.color;
      if (lane.shape === "circle") {
        g.beginPath();
        g.arc(x, cy, size / 2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#000000";
        g.beginPath();
        g.arc(x, cy, size / 6, 0, Math.PI * 2);
        g.fill();
      } else if (lane.shape === "stripe") {
        const bw = Math.max(6, size * 0.55);
        g.fillRect(x - bw / 2, cy - laneH * 0.4, bw, laneH * 0.8);
        g.fillStyle = "#000000";
        for (let k = 0; k < 4; k += 1) {
          g.fillRect(x - bw / 2, cy - laneH * 0.4 + k * laneH * 0.2, bw, Math.max(2, laneH * 0.05));
        }
      } else {
        g.fillRect(x - size / 2, cy - size / 2, size, size);
        g.fillStyle = "#000000";
        g.fillRect(x - size / 2, cy - size * 0.04, size, size * 0.08);
      }
    }
  }
  function drawFlicker() {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, W, H);
    const stripe = 12;
    const period = stripe * 2;
    const offset = frameTime * 150 % period;
    const bandH = H * 0.5;
    g.fillStyle = "#ffffff";
    for (let x = -offset; x < W; x += period) g.fillRect(x, 0, stripe, bandH);
    const s2 = 3;
    const p2 = s2 * 2;
    const o2 = frameTime * 58 % p2;
    const y2 = bandH + H * 0.05;
    const h2 = H * 0.17;
    for (let x = -o2; x < W; x += p2) g.fillRect(x, y2, s2, h2);
    const refH = Math.max(14, Math.round(H * 0.035));
    const refY = y2 + h2 + H * 0.09;
    if (refY + refH + 90 < H) {
      g.fillStyle = "rgba(255, 255, 255, 0.88)";
      g.fillRect(W * 0.06, refY, Math.min(W * 0.88, 420), refH);
      g.fillStyle = "rgba(255, 255, 255, 0.42)";
      g.font = "11.5px system-ui, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText("静止参照：上下两带的条纹不应出现断续、重影或色边", W * 0.06, refY - 8);
    }
  }
  function drawBurnin() {
    const phase = Math.floor(frameTime / 1.4) % 2;
    const inv = phase === 1;
    const bg = inv ? "#ffffff" : "#000000";
    const fg = inv ? "#000000" : "#ffffff";
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = fg;
    const big = Math.round(Math.min(W * 0.24, H * 0.22));
    g.font = "700 " + big + 'px system-ui, -apple-system, "PingFang SC", sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("残影", W / 2, H * 0.42);
    const bw = Math.min(W * 0.1, 90);
    const bh = Math.min(H * 0.09, 70);
    const gap = bw * 0.4;
    const totalW = 5 * bw + 4 * gap;
    const startX = (W - totalW) / 2;
    const by = H * 0.66;
    for (let i = 0; i < 5; i += 1) {
      g.fillRect(startX + i * (bw + gap), by, bw, bh);
    }
    g.fillRect(startX, by, totalW, Math.max(3, bh * 0.06));
    g.strokeStyle = fg;
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, H - 2);
    g.font = "12px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.globalAlpha = 0.45;
    g.fillText("图案每 1.4 秒反转一次，请盯住中心文字观察残留", 12, 12);
    g.globalAlpha = 1;
  }
  function draw(test) {
    switch (test.kind) {
      case "ramp":
        drawRamp(test);
        break;
      case "steps":
        drawSteps();
        break;
      case "near":
        drawNear(test);
        break;
      case "checker":
        drawChecker();
        break;
      case "grid":
        drawGrid();
        break;
      case "text":
        drawText();
        break;
      case "motion":
        drawMotion();
        break;
      case "flicker":
        drawFlicker();
        break;
      case "burnin":
        drawBurnin();
        break;
      default:
        break;
    }
  }
  function stopFrame() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  function startFrame(test) {
    stopFrame();
    clockStart = performance.now() - frameTime * 1e3;
    const tick = (now) => {
      if (disposed || signal && signal.aborted) return;
      frameTime = (now - clockStart) / 1e3;
      draw(test);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function render() {
    if (disposed) return;
    const test = order[index];
    if (!test) return;
    stopFrame();
    frameTime = 0;
    metaName.textContent = test.name;
    metaCount.textContent = index + 1 + " / " + order.length;
    hintName.textContent = test.name;
    hintTip.textContent = test.tip;
    hintEl.classList.toggle("off", !prefs.hint);
    if (test.kind === "solid") {
      cv.style.display = "none";
      stage.style.background = test.color;
    } else {
      cv.style.display = "block";
      stage.style.background = "#000000";
      sizeCanvas();
      draw(test);
      if (test.anim) startFrame(test);
    }
    showChrome();
    scheduleAuto();
  }
  function go(delta) {
    if (!order.length) return;
    index = (index + delta + order.length) % order.length;
    render();
  }
  function scheduleAuto() {
    window.clearTimeout(autoTimer);
    autoTimer = 0;
    prog.style.width = "0px";
    if (!autoPlay || disposed) return;
    const total = prefs.autoMs;
    prog.style.transition = "none";
    prog.style.width = "0px";
    void prog.offsetWidth;
    prog.style.transition = "width " + total + "ms linear";
    prog.style.width = "100%";
    autoTimer = window.setTimeout(() => {
      if (disposed || !autoPlay) return;
      go(1);
    }, total);
  }
  function setAuto(next) {
    autoPlay = next;
    btnAuto.classList.toggle("on", autoPlay);
    btnAuto.textContent = autoPlay ? "暂停" : "自动";
    if (autoPlay) {
      scheduleAuto();
    } else {
      window.clearTimeout(autoTimer);
      autoTimer = 0;
      prog.style.transition = "none";
      prog.style.width = "0px";
    }
  }
  function showChrome() {
    stage.classList.remove("idle");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!panel.hidden || !intro.hidden) return;
      stage.classList.add("idle");
    }, 2400);
  }
  function syncPanel() {
    const segs = panel.querySelectorAll(".seg[data-key]");
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      const key = seg.getAttribute("data-key");
      const value = prefs[key];
      const current = typeof value === "boolean" ? value ? "1" : "0" : String(value);
      const buttons = seg.querySelectorAll("button");
      for (let k = 0; k < buttons.length; k += 1) {
        const btn = buttons[k];
        btn.classList.toggle("on", current === btn.getAttribute("data-v"));
      }
    }
    const chips = panel.querySelectorAll('.chips[data-key="groups"] button');
    for (let i = 0; i < chips.length; i += 1) {
      const btn = chips[i];
      btn.classList.toggle("on", prefs.groups.indexOf(btn.getAttribute("data-g")) >= 0);
    }
  }
  function rebuild() {
    const current = order[index] ? order[index].id : null;
    order = TESTS.filter((t) => prefs.groups.indexOf(t.group) >= 0);
    if (!order.length) {
      prefs.groups = ALL_GROUPS.slice();
      order = TESTS.slice();
    }
    let next = 0;
    for (let i = 0; i < order.length; i += 1) {
      if (order[i].id === current) {
        next = i;
        break;
      }
    }
    index = next;
    render();
  }
  function openPanel(open) {
    panel.hidden = !open;
    stage.classList.toggle("panel-open", open);
    btnCfg.classList.toggle("on", open);
    if (open) {
      syncPanel();
      window.clearTimeout(autoTimer);
      autoTimer = 0;
      prog.style.transition = "none";
      prog.style.width = "0px";
      showChrome();
    } else {
      scheduleAuto();
      showChrome();
    }
  }
  function dismissIntro() {
    if (intro.hidden) return;
    intro.hidden = true;
    prefs.seen = true;
    savePrefs();
    showChrome();
  }
  const onClickStage = () => {
    if (!intro.hidden) {
      dismissIntro();
      return;
    }
    if (!panel.hidden) {
      openPanel(false);
      return;
    }
    go(1);
  };
  const onPointerActivity = () => {
    if (!intro.hidden) return;
    showChrome();
  };
  const onKey = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Tab") return;
    if (!intro.hidden) {
      event.preventDefault();
      dismissIntro();
      return;
    }
    if (key === "ArrowRight" || key === " " || key === "Spacebar" || key === "Enter" || key === "PageDown") {
      event.preventDefault();
      if (!panel.hidden) return;
      go(1);
      return;
    }
    if (key === "ArrowLeft" || key === "PageUp") {
      event.preventDefault();
      if (!panel.hidden) return;
      go(-1);
      return;
    }
    if (key === "a" || key === "A") {
      setAuto(!autoPlay);
      return;
    }
    if (key === "o" || key === "O") {
      openPanel(panel.hidden);
      return;
    }
    if (key === "h" || key === "H") {
      prefs.hint = !prefs.hint;
      hintEl.classList.toggle("off", !prefs.hint);
      syncPanel();
      savePrefs();
    }
  };
  const onPanelClick = (event) => {
    event.stopPropagation();
    const btn = event.target.closest ? event.target.closest("button") : null;
    if (!btn) return;
    const seg = btn.closest(".seg[data-key]");
    if (seg) {
      const key = seg.getAttribute("data-key");
      const raw = btn.getAttribute("data-v");
      prefs[key] = key === "autoMs" ? Number(raw) : raw === "1";
      savePrefs();
      syncPanel();
      render();
      return;
    }
    const chips = btn.closest('.chips[data-key="groups"]');
    if (chips) {
      const gid = btn.getAttribute("data-g");
      const set = new Set(prefs.groups);
      if (set.has(gid)) {
        if (set.size <= 1) return;
        set.delete(gid);
      } else {
        set.add(gid);
      }
      prefs.groups = ALL_GROUPS.filter((id) => set.has(id));
      savePrefs();
      syncPanel();
      rebuild();
    }
  };
  const onResize = () => {
    const test = order[index];
    if (!test || test.kind === "solid") return;
    sizeCanvas();
    if (!test.anim) draw(test);
  };
  let resizeTick = 0;
  const queueResize = () => {
    if (resizeTick) return;
    resizeTick = requestAnimationFrame(() => {
      resizeTick = 0;
      onResize();
    });
  };
  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(queueResize);
    observer.observe(stage);
  }
  const stopBubble = (e) => e.stopPropagation();
  const noMenu = (e) => e.preventDefault();
  stage.addEventListener("click", onClickStage);
  stage.addEventListener("pointermove", onPointerActivity, { passive: true });
  stage.addEventListener("touchstart", onPointerActivity, { passive: true });
  stage.addEventListener("contextmenu", noMenu);
  bar.addEventListener("click", stopBubble);
  panel.addEventListener("click", onPanelClick);
  intro.addEventListener("click", stopBubble);
  btnStart.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissIntro();
  });
  btnPrev.addEventListener("click", () => go(-1));
  btnNext.addEventListener("click", () => go(1));
  btnAuto.addEventListener("click", () => setAuto(!autoPlay));
  btnCfg.addEventListener("click", () => openPanel(panel.hidden));
  btnClose.addEventListener("click", () => openPanel(false));
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", queueResize);
  order = TESTS.filter((t) => prefs.groups.indexOf(t.group) >= 0);
  if (!order.length) {
    prefs.groups = ALL_GROUPS.slice();
    order = TESTS.slice();
  }
  index = 0;
  if (!prefs.seen) intro.hidden = false;
  render();
  showChrome();
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopFrame();
    window.clearTimeout(autoTimer);
    window.clearTimeout(idleTimer);
    if (resizeTick) cancelAnimationFrame(resizeTick);
    if (observer) observer.disconnect();
    stage.removeEventListener("click", onClickStage);
    stage.removeEventListener("pointermove", onPointerActivity);
    stage.removeEventListener("touchstart", onPointerActivity);
    stage.removeEventListener("contextmenu", noMenu);
    bar.removeEventListener("click", stopBubble);
    panel.removeEventListener("click", onPanelClick);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", queueResize);
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
