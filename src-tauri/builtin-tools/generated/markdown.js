// src-tauri/builtin-tools/src/markdown-insert.js
function headingEdit(text, start, end, level) {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error("标题级别无效。");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new Error("选区已变化。");
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const effectiveEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const next = text.indexOf("\n", effectiveEnd), to = next < 0 ? text.length : next;
  const lines = text.slice(from, to).split("\n"), multiple = lines.length > 1;
  const transformed = lines.map((line) => {
    if (multiple && !line.trim()) return { text: line, oldPrefix: 0, newPrefix: 0 };
    const match = /^([ \t]*)(#{1,6})[ \t]+([\s\S]*)$/.exec(line);
    const body = match ? match[3] : line.replace(/^[ \t]*/, "");
    if (!level && !match) return { text: line, oldPrefix: 0, newPrefix: 0 };
    const prefix = level ? "#".repeat(level) + " " : match[1];
    return { text: prefix + body, oldPrefix: line.length - body.length, newPrefix: prefix.length };
  });
  const insert = transformed.map((line) => line.text).join("\n");
  const position = (value) => {
    if (value > to) return value + insert.length - (to - from);
    let oldOffset = from, newOffset = from;
    for (let i = 0; i < lines.length; i++) {
      if (value <= oldOffset + lines[i].length) return newOffset + Math.min(transformed[i].text.length, transformed[i].newPrefix + Math.max(0, value - oldOffset - transformed[i].oldPrefix));
      oldOffset += lines[i].length + 1;
      newOffset += transformed[i].text.length + 1;
    }
    return newOffset;
  };
  return { start: from, end: to, insert, selectionStart: position(start), selectionEnd: position(end) };
}
function tableMarkdown(rows, columns) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 100) throw new Error("内容行数需为 1～100 的整数。");
  if (!Number.isInteger(columns) || columns < 1 || columns > 20) throw new Error("列数需为 1～20 的整数。");
  const header = "| " + Array.from({ length: columns }, (_, i) => "列 " + (i + 1)).join(" | ") + " |";
  const rule = "| " + Array(columns).fill("---").join(" | ") + " |";
  const row = "| " + Array(columns).fill("").join(" | ") + " |";
  return [header, rule, ...Array(rows).fill(row)].join("\n") + "\n";
}

// src-tauri/builtin-tools/src/markdown.js
function es(s) {
  return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}
function safeUrl(u, forImage) {
  const s = String(u || "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low.indexOf("javascript:") === 0 || low.indexOf("vbscript:") === 0) return "";
  if (low.indexOf("data:") === 0) return forImage && low.indexOf("data:image/") === 0 ? s : "";
  return s;
}
function anchor(href, label) {
  return '<a href="' + es(href) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
}
var PH_OPEN = "";
var PH_CLOSE = "";
function inline(raw) {
  const store = [];
  const ph = (html) => {
    store.push(html);
    return PH_OPEN + (store.length - 1) + PH_CLOSE;
  };
  let s = String(raw);
  s = s.replace(/(`+)([\s\S]*?)\1/g, (m, ticks, body) => {
    const code = body.replace(/^ ([\s\S]*) $/, "$1");
    return ph("<code>" + es(code) + "</code>");
  });
  s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (m, alt, url, title) => {
    const u = safeUrl(url, true);
    if (!u) return es(alt);
    return ph('<img src="' + es(u) + '" alt="' + es(alt) + '"' + (title ? ' title="' + es(title) + '"' : "") + ' loading="lazy">');
  });
  s = s.replace(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (m, label, url, title) => {
    const u = safeUrl(url, false);
    if (!u) return es(label);
    const t = title ? ' title="' + es(title) + '"' : "";
    return ph('<a href="' + es(u) + '"' + t + ' target="_blank" rel="noopener noreferrer">' + inline(label) + "</a>");
  });
  s = es(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
  s = s.replace(/\*(?=\S)([\s\S]*?\S)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/&lt;(https?:\/\/[^\s&]+?)&gt;/g, (m, u) => ph(anchor(u, es(u))));
  s = s.replace(/(^|[\s（(])(https?:\/\/[^\s<）)，。、；"']+)/g, (m, pre, u) => pre + ph(anchor(u, es(u))));
  return s.replace(/\u0001(\d+)\u0002/g, (m, i) => store[Number(i)] || "");
}
var RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^`~]*)$/;
var RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
var RE_HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
var RE_QUOTE = /^\s{0,3}>\s?([\s\S]*)$/;
var RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+([\s\S]*)$/;
var RE_TDELIM = /^\s{0,3}\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
function indentOf(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}
function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  const head = lines[i];
  if (head.indexOf("|") < 0) return false;
  const next = lines[i + 1];
  return next.indexOf("|") >= 0 && RE_TDELIM.test(next) && next.indexOf("-") >= 0;
}
function startsBlock(lines, i) {
  const line = lines[i];
  return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || RE_LIST.test(line) || isTableStart(lines, i);
}
function codeBlock(code, info) {
  const lang = String(info || "").trim().split(/\s+/)[0] || "";
  return '<div class="cb"><div class="cbh"><span class="cbl">' + es(lang || "text") + '</span><button class="cbtn" type="button">复制</button></div><pre><code>' + es(code) + "</code></pre></div>";
}
function splitRow(line) {
  let s = line.trim();
  if (s.charAt(0) === "|") s = s.slice(1);
  if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function parseTable(lines, i) {
  const align = splitRow(lines[i + 1]).map((c) => {
    const l = c.charAt(0) === ":";
    const r = c.charAt(c.length - 1) === ":";
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const rows = [];
  let j = i + 2;
  while (j < lines.length && lines[j].trim() && lines[j].indexOf("|") >= 0) {
    rows.push(splitRow(lines[j]));
    j++;
  }
  const cell = (tag, text, idx) => "<" + tag + (align[idx] ? ' style="text-align:' + align[idx] + '"' : "") + ">" + inline(text) + "</" + tag + ">";
  const head = splitRow(lines[i]);
  const out = ['<div class="tbl"><table><thead><tr>'];
  for (let k = 0; k < head.length; k++) out.push(cell("th", head[k], k));
  out.push("</tr></thead><tbody>");
  for (let r = 0; r < rows.length; r++) {
    out.push("<tr>");
    for (let k = 0; k < head.length; k++) out.push(cell("td", rows[r][k] == null ? "" : rows[r][k], k));
    out.push("</tr>");
  }
  out.push("</tbody></table></div>");
  return { html: out.join(""), next: j };
}
function parseList(lines, i) {
  const first = RE_LIST.exec(lines[i]);
  const base = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    const m = RE_LIST.exec(lines[i]);
    if (!m) break;
    const ind = m[1].length;
    if (ind < base) break;
    if (ind > base) {
      const sub = parseList(lines, i);
      if (!items.length) items.push({ body: [""], extra: [] });
      items[items.length - 1].extra.push(sub.html);
      i = sub.next;
      continue;
    }
    const body = [m[3]];
    i++;
    while (i < lines.length) {
      const L = lines[i];
      if (!L.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          const mm2 = RE_LIST.exec(lines[j]);
          const ind2 = mm2 ? mm2[1].length : indentOf(lines[j]);
          if (ind2 > base) {
            body.push("");
            i++;
            continue;
          }
        }
        break;
      }
      const mm = RE_LIST.exec(L);
      if (mm && mm[1].length <= base) break;
      if (indentOf(L) > base) {
        body.push(L.replace(/^[ \t]+/, ""));
        i++;
        continue;
      }
      break;
    }
    items.push({ body, extra: [] });
  }
  const start = ordered ? Number(/^(\d+)/.exec(first[2])[1]) : 1;
  const tag = ordered ? "ol" : "ul";
  let hasTask = false;
  const out = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const body = it.body.slice();
    let task = null;
    const tm = /^\[([ xX])\]\s*([\s\S]*)$/.exec(body[0] || "");
    if (tm) {
      hasTask = true;
      task = tm[1].toLowerCase() === "x";
      body[0] = tm[2];
    }
    let inner;
    if (body.length === 1) inner = inline(body[0]);
    else if (!body.join("").trim()) inner = "";
    else inner = parseBlocks(body);
    const box = task === null ? "" : '<span class="cbx' + (task ? " on" : "") + '">' + (task ? "✓" : "") + "</span>";
    out.push("<li" + (task === null ? "" : ' class="task"') + ">" + box + inner + it.extra.join("") + "</li>");
  }
  const attrs = (ordered && start !== 1 ? ' start="' + start + '"' : "") + (hasTask ? ' class="has-task"' : "");
  return { html: "<" + tag + attrs + ">" + out.join("") + "</" + tag + ">", next: i };
}
function paraInline(lines) {
  let s = lines.join("\n");
  s = s.replace(/\\\n/g, "").replace(/ {2,}\n/g, "").replace(/\n/g, " ");
  return inline(s).replace(/\u0003/g, "<br>");
}
function parseBlocks(lines) {
  const out = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m = RE_FENCE.exec(line);
    if (m) {
      const fenceChar = m[1].charAt(0);
      const fenceLen = m[1].length;
      const info = m[2];
      const buf2 = [];
      i++;
      while (i < n) {
        const t = lines[i];
        const tq = t.trim();
        if (tq.length >= fenceLen && tq.split("").every((c) => c === fenceChar)) {
          i++;
          break;
        }
        buf2.push(t);
        i++;
      }
      out.push(codeBlock(buf2.join("\n"), info));
      continue;
    }
    m = RE_HEAD.exec(line);
    if (m) {
      const lv = m[1].length;
      out.push("<h" + lv + ">" + inline(m[2]) + "</h" + lv + ">");
      i++;
      continue;
    }
    if (RE_HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const buf2 = [];
      while (i < n) {
        const mm = RE_QUOTE.exec(lines[i]);
        if (mm) {
          buf2.push(mm[1]);
          i++;
          continue;
        }
        if (!lines[i].trim() && i + 1 < n && RE_QUOTE.test(lines[i + 1])) {
          buf2.push("");
          i++;
          continue;
        }
        break;
      }
      out.push("<blockquote>" + parseBlocks(buf2) + "</blockquote>");
      continue;
    }
    if (isTableStart(lines, i)) {
      const t = parseTable(lines, i);
      out.push(t.html);
      i = t.next;
      continue;
    }
    if (RE_LIST.test(line)) {
      const r = parseList(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }
    const buf = [line];
    i++;
    while (i < n && lines[i].trim() && !startsBlock(lines, i)) {
      buf.push(lines[i]);
      i++;
    }
    out.push("<p>" + paraInline(buf) + "</p>");
  }
  return out.join("\n");
}
function renderMarkdown(src) {
  const text = String(src == null ? "" : src).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return parseBlocks(text.split("\n"));
}
var FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
var FONT_SERIF = 'Georgia, "Songti SC", "Noto Serif CJK SC", "SimSun", serif';
var FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';
var PV_LIGHT = {
  bg: "#FFFFFF",
  ink: "#242A2C",
  ink2: "#6B7472",
  head: "#14181A",
  line: "rgba(0,0,0,.1)",
  soft: "#F5F7F4",
  codeBg: "#F4F6F3",
  codeInk: "#2B6F60",
  acc: "#1D9E75",
  link: "#1673D2",
  linkLine: "rgba(22,115,210,.32)",
  codeHead: "#EDF0EC",
  th: "#F6F8F5",
  tbl: "rgba(0,0,0,.09)"
};
var PV_DARK = {
  bg: "#171D1B",
  ink: "#C4CAC7",
  ink2: "#8B9390",
  head: "#E7EBE9",
  line: "rgba(255,255,255,.12)",
  soft: "#1F2624",
  codeBg: "#141A18",
  codeInk: "#7FD3BB",
  acc: "#5DCAA5",
  link: "#6CB6FF",
  linkLine: "rgba(108,182,255,.34)",
  codeHead: "#111716",
  th: "#1E2523",
  tbl: "rgba(255,255,255,.1)"
};
function pvVars(sel, v) {
  return sel + "{--pv-bg:" + v.bg + ";--pv-ink:" + v.ink + ";--pv-ink2:" + v.ink2 + ";--pv-head:" + v.head + ";--pv-line:" + v.line + ";--pv-soft:" + v.soft + ";--pv-code-bg:" + v.codeBg + ";--pv-code-ink:" + v.codeInk + ";--pv-acc:" + v.acc + ";--pv-link:" + v.link + ";--pv-code-head:" + v.codeHead + ";--pv-th:" + v.th + ";--pv-tbl:" + v.tbl + ";--pv-link-line:" + v.linkLine + ";}";
}
function pvRules(s) {
  const r = [];
  r.push(s + "{color:var(--pv-ink);background:var(--pv-bg);line-height:1.78;word-wrap:break-word;-webkit-font-smoothing:antialiased;font-size:16px;}");
  r.push(s + " > *:first-child{margin-top:0;}");
  r.push(s + " > *:last-child{margin-bottom:0;}");
  r.push(s + " h1," + s + " h2," + s + " h3," + s + " h4," + s + " h5," + s + " h6{color:var(--pv-head);line-height:1.34;font-weight:650;margin:1.5em 0 .55em;letter-spacing:-.005em;}");
  r.push(s + " h1{font-size:1.72em;padding-bottom:.26em;border-bottom:1px solid var(--pv-line);}");
  r.push(s + " h2{font-size:1.36em;padding-bottom:.2em;border-bottom:1px solid var(--pv-line);}");
  r.push(s + " h3{font-size:1.15em;}");
  r.push(s + " h4{font-size:1.03em;}");
  r.push(s + " h5," + s + " h6{font-size:.96em;color:var(--pv-ink2);}");
  r.push(s + " p{margin:.85em 0;}");
  r.push(s + " a{color:var(--pv-link);text-decoration:none;border-bottom:1px solid var(--pv-link-line);}");
  r.push(s + " a:hover{border-bottom-color:currentColor;}");
  r.push(s + " strong{font-weight:680;color:var(--pv-head);}");
  r.push(s + " em{font-style:italic;}");
  r.push(s + " del{color:var(--pv-ink2);}");
  r.push(s + " code{font-family:" + FONT_MONO + ";font-size:.87em;background:var(--pv-code-bg);color:var(--pv-code-ink);padding:.14em .36em;border-radius:5px;border:1px solid var(--pv-line);}");
  r.push(s + " pre{margin:0;padding:14px 16px;overflow-x:auto;background:var(--pv-code-bg);-webkit-overflow-scrolling:touch;}");
  r.push(s + " pre code{background:none;border:0;padding:0;color:var(--pv-ink);font-size:.86em;line-height:1.72;white-space:pre;}");
  r.push(s + " .cb{margin:1.05em 0;border:1px solid var(--pv-line);border-radius:10px;overflow:hidden;background:var(--pv-code-bg);}");
  r.push(s + " .cbh{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 12px;background:var(--pv-code-head);border-bottom:1px solid var(--pv-line);}");
  r.push(s + " .cbl{font-family:" + FONT_MONO + ";font-size:11px;letter-spacing:.04em;color:var(--pv-ink2);}");
  r.push(s + " .cbtn{border:1px solid var(--pv-line);background:transparent;color:var(--pv-ink2);font:inherit;font-size:11px;line-height:1;padding:5px 9px;border-radius:6px;cursor:pointer;}");
  r.push(s + " .cbtn:hover{color:var(--pv-acc);border-color:var(--pv-acc);}");
  r.push(s + " blockquote{margin:1em 0;padding:.05em 0 .05em 14px;border-left:3px solid var(--pv-acc);color:var(--pv-ink2);}");
  r.push(s + " blockquote p{margin:.35em 0;}");
  r.push(s + " ul," + s + " ol{margin:.65em 0;padding-left:1.5em;}");
  r.push(s + " ul{list-style:disc;}" + s + " ul ul{list-style:circle;}");
  r.push(s + " ol{list-style:decimal;}");
  r.push(s + " li{margin:.26em 0;}");
  r.push(s + " li > p{margin:.25em 0;}");
  r.push(s + " ul.has-task{list-style:none;padding-left:.15em;}");
  r.push(s + " ul.has-task ul{list-style:none;}");
  r.push(s + " .cbx{display:inline-block;width:.92em;height:.92em;margin-right:.45em;vertical-align:-.06em;border-radius:4px;border:1.5px solid var(--pv-ink2);font-size:.72em;line-height:1;text-align:center;color:#fff;}");
  r.push(s + " .cbx.on{background:var(--pv-acc);border-color:var(--pv-acc);}");
  r.push(s + " .tbl{overflow-x:auto;margin:1.05em 0;}");
  r.push(s + " table{border-collapse:collapse;width:100%;font-size:.94em;}");
  r.push(s + " th," + s + " td{border:1px solid var(--pv-tbl);padding:7px 12px;text-align:left;vertical-align:top;}");
  r.push(s + " th{background:var(--pv-th);font-weight:600;color:var(--pv-head);white-space:nowrap;}");
  r.push(s + " hr{border:0;border-top:1px solid var(--pv-line);margin:1.8em 0;}");
  r.push(s + " img{max-width:100%;height:auto;border-radius:8px;display:block;margin:.9em 0;}");
  r.push(s + " p + p{margin-top:.7em;}");
  return r.join("\n");
}
function appPreviewCss() {
  return pvVars(".mprev", PV_LIGHT) + "\n" + pvVars('html[data-theme="dark"] .mprev', PV_DARK) + "\n" + pvRules(".mprev");
}
function exportCss() {
  return pvVars("body", PV_LIGHT) + "\n@media (prefers-color-scheme:dark){" + pvVars("body", PV_DARK) + "}\n" + pvRules("body") + "\nbody{max-width:820px;margin:0 auto;padding:44px 24px 96px;box-sizing:border-box;min-height:100%;}\n@media (max-width:600px){body{padding:24px 16px 64px;font-size:15px;}}";
}
var TEMPLATES = {
  blank: { label: "空白文档", text: "" },
  meeting: {
    label: "会议记录",
    text: [
      "# 会议记录",
      "",
      "- **时间**：2026-10-29 14:00",
      "- **地点**：线上",
      "- **参会**：",
      "- **记录**：",
      "",
      "## 议题",
      "",
      "1. 上周进展回顾",
      "2. 本周待定事项",
      "",
      "## 讨论要点",
      "",
      "> 把关键结论写在这里，方便回看。",
      "",
      "- 结论一：",
      "- 结论二：",
      "",
      "## 待办",
      "",
      "- [ ] 事项 A（负责人 / 截止日期）",
      "- [ ] 事项 B",
      ""
    ].join("\n")
  },
  weekly: {
    label: "每周小结",
    text: [
      "# 本周小结（第 44 周）",
      "",
      "## 完成",
      "",
      "- [x] ",
      "- [x] ",
      "",
      "## 进行中",
      "",
      "- [ ] ",
      "",
      "## 问题与风险",
      "",
      "| 问题 | 影响 | 处理方式 |",
      "| --- | --- | --- |",
      "|  |  |  |",
      "",
      "## 下周计划",
      "",
      "1. ",
      "2. ",
      ""
    ].join("\n")
  },
  reading: {
    label: "读书笔记",
    text: [
      "# 《书名》读书笔记",
      "",
      "**作者**： ｜ **读完时间**：",
      "",
      "## 一句话总结",
      "",
      "> ",
      "",
      "## 关键观点",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## 摘录",
      "",
      "> 摘录原文……",
      ">",
      "> —— 第 12 页",
      "",
      "## 我的想法",
      "",
      "",
      ""
    ].join("\n")
  },
  readme: {
    label: "项目 README",
    text: [
      "# 项目名",
      "",
      "一句话说明这个项目是做什么的。",
      "",
      "## 特性",
      "",
      "- 特性一",
      "- 特性二",
      "",
      "## 快速开始",
      "",
      "```bash",
      "npm install",
      "npm run dev",
      "```",
      "",
      "## 用法",
      "",
      "| 参数 | 说明 | 默认值 |",
      "| --- | --- | --- |",
      "| `--port` | 监听端口 | `8080` |",
      "",
      "## 许可",
      "",
      "MIT",
      ""
    ].join("\n")
  }
};
var WELCOME = [
  "# 欢迎使用 Markdown 编辑器",
  "",
  "左边写，右边看。这是一份可直接改成自己文档的示例。",
  "",
  "## 常用语法",
  "",
  "**粗体**、*斜体*、~~删除线~~、`行内代码`，以及 [链接](https://example.com)。",
  "",
  "> 引用用来放结论或摘录，会和正文明显区分开。",
  "",
  "### 列表",
  "",
  "- 无序列表",
  "- 支持二级缩进",
  "  - 像这样",
  "- 也可以放**重点**",
  "",
  "1. 有序列表",
  "2. 按顺序写步骤",
  "",
  "### 任务清单",
  "",
  "- [x] 打开编辑器",
  "- [x] 输入一点文字",
  "- [ ] 试试工具栏上的按钮",
  "",
  "### 表格",
  "",
  "| 快捷键 | 功能 | 说明 |",
  "| --- | :--: | --- |",
  "| `Ctrl+B` | 粗体 | 再按一次取消 |",
  "| `Ctrl+I` | 斜体 | |",
  "| `Ctrl+K` | 链接 | |",
  "| `Tab` | 缩进 | 选中多行可整体缩进 |",
  "",
  "### 代码块",
  "",
  "```js",
  "function greet(name) {",
  "  return `你好，${name}`;",
  "}",
  "```",
  "",
  "---",
  "",
  "右上角可以切换 **分栏 / 仅编辑 / 仅预览**，拖动中间的竖条能调整比例。",
  "需要带走时点「导出」，可以存成 `.md` 或独立的 `.html` 网页。",
  ""
].join("\n");
function svg(body) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
}
var ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  split: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 5v14"/>'),
  edit: svg('<path d="M4.5 19.5l1-3.4L15.9 5.7a1.9 1.9 0 012.7 0l.5.5a1.9 1.9 0 010 2.7L8.7 19.3z"/><path d="M14.4 7.2l2.6 2.6"/>'),
  eye: svg('<path d="M2.8 12S6.6 5.8 12 5.8 21.2 12 21.2 12 17.4 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.7"/>'),
  sync: svg('<path d="M4.5 9.5A7.5 7.5 0 0118 7.2"/><path d="M18 4v3.6h-3.6"/><path d="M19.5 14.5A7.5 7.5 0 016 16.8"/><path d="M6 20v-3.6h3.6"/>'),
  ul: svg('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.6" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17" r="1.1" fill="currentColor" stroke="none"/>'),
  task: svg('<rect x="3.6" y="4.6" width="7" height="7" rx="1.6"/><path d="M5.3 8.1l1.5 1.5 2.4-2.6"/><path d="M14 8.1h6.4M14 15.9h6.4"/>'),
  link: svg('<path d="M10.2 13.8a3.6 3.6 0 005.1 0l2.6-2.6a3.6 3.6 0 10-5.1-5.1l-1.2 1.2"/><path d="M13.8 10.2a3.6 3.6 0 00-5.1 0l-2.6 2.6a3.6 3.6 0 105.1 5.1l1.2-1.2"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.4" cy="9.8" r="1.5"/><path d="M20.5 15.6l-4.8-4.4-8.4 7.8"/>'),
  table: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.8"/><path d="M3.5 9.6h17M9.2 9.6V19M15 9.6V19"/>'),
  close: svg('<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>')
};
function mount(api) {
  const root = document.getElementById("md");
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const sig = api && api.signal ? api.signal : new AbortController().signal;
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, Object.assign({ signal: sig }, opts || {}));
  };
  const ta = $("#md-ta");
  const prev = $("#md-prev");
  const pane = $("#md-ppane");
  const epane = $("#md-epane");
  const split = $("#md-split");
  const main = $("#md-main");
  const tool = $("#md-tool");
  const nameIn = $("#md-name");
  const dot = $("#md-dot");
  const statL = $("#md-stat");
  const statR = $("#md-saved");
  const pop = $("#md-pop");
  const shade = $("#md-shade");
  const syncBtn = $("#md-sync");
  const tableDialog = $("#md-table-dialog");
  const tableRows = $("#md-table-rows"), tableColumns = $("#md-table-cols");
  const S = {
    mode: "split",
    sync: true,
    fs: 16,
    serif: false,
    ratio: 50,
    name: "未命名.md",
    saved: "",
    at: 0,
    dirty: false
  };
  let renderTimer = 0;
  let saveTimer = 0;
  let draftRevision = 0;
  let toastTimer = 0;
  let syncLock = false;
  let popAnchor = null;
  let rafId = 0;
  let tableSelection = null, tableCommitted = false;
  const KEY_DRAFT = "md.draft.v1";
  const KEY_PREF = "md.pref.v1";
  function syncTheme() {
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", t);
  }
  syncTheme();
  try {
    const mo = new MutationObserver(syncTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (sig.addEventListener) sig.addEventListener("abort", () => mo.disconnect());
  } catch (e) {
  }
  try {
    const st = document.createElement("style");
    st.id = "md-pv-style";
    st.textContent = appPreviewCss();
    document.head.appendChild(st);
    if (sig.addEventListener) sig.addEventListener("abort", () => {
      st.remove();
    });
  } catch (e) {
  }
  function toast(msg, ms) {
    pop.hidden = true;
    let t = document.getElementById("md-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "md-toast";
      t.className = "mdtoast";
      root.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms || 1900);
  }
  function render(force) {
    const html = renderMarkdown(ta.value);
    prev.innerHTML = html || '<p class="empty">还没有内容，从左边开始写吧。</p>';
    prev.style.fontSize = S.fs + "px";
    prev.style.fontFamily = S.serif ? FONT_SERIF : FONT_SANS;
    updateStats();
    if (force) updateSavedLabel();
  }
  function scheduleRender() {
    if (renderTimer) return;
    const delay = ta.value.length > 6e4 ? 380 : 90;
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      render();
    }, delay);
  }
  function textInfo() {
    const t = ta.value;
    const lines = t ? t.split("\n").length : 0;
    const cjk = (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
    const rest = t.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g, " ");
    const words = (rest.match(/[A-Za-z0-9_]+/g) || []).length;
    const count = cjk + words;
    const min = Math.max(1, Math.round(cjk / 380 + words / 200));
    return { chars: t.length, lines, count, min };
  }
  function updateStats() {
    const i = textInfo();
    statL.textContent = i.count + " 字 · " + i.lines + " 行 · 约 " + i.min + " 分钟";
  }
  function updateSavedLabel() {
    if (S.dirty) {
      statR.textContent = "未写入草稿…";
      statR.classList.remove("saved");
      return;
    }
    if (!S.at) {
      statR.textContent = "空白文档";
      statR.classList.remove("saved");
      return;
    }
    const d = new Date(S.at);
    const p = (n) => (n < 10 ? "0" : "") + n;
    statR.textContent = "草稿已保存 " + p(d.getHours()) + ":" + p(d.getMinutes());
    statR.classList.add("saved");
  }
  function loadPref() {
    try {
      const raw = localStorage.getItem(KEY_PREF);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.mode === "split" || p.mode === "edit" || p.mode === "prev") S.mode = p.mode;
      if (typeof p.sync === "boolean") S.sync = p.sync;
      if (p.fs >= 12 && p.fs <= 26) S.fs = p.fs;
      if (typeof p.serif === "boolean") S.serif = p.serif;
      if (p.ratio >= 20 && p.ratio <= 80) S.ratio = p.ratio;
    } catch (e) {
    }
  }
  function savePref() {
    try {
      localStorage.setItem(KEY_PREF, JSON.stringify({
        mode: S.mode,
        sync: S.sync,
        fs: S.fs,
        serif: S.serif,
        ratio: Math.round(S.ratio)
      }));
    } catch (e) {
    }
  }
  function scheduleSave() {
    draftRevision++;
    S.dirty = true;
    dot.hidden = false;
    updateSavedLabel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 500);
  }
  async function saveDraft() {
    clearTimeout(saveTimer);
    const revision = draftRevision, text = ta.value;
    let ok = writeDraft();
    if (ok && api && api.storage && typeof api.storage.flush === "function") {
      try {
        await api.storage.flush();
      } catch (e) {
        ok = false;
        if (!sig.aborted) toast("草稿未能写入设备，请及时导出");
      }
    }
    if (revision !== draftRevision) return;
    S.dirty = !ok;
    dot.hidden = ok;
    if (ok) {
      S.at = Date.now();
      S.saved = text;
    }
    updateSavedLabel();
  }
  function writeDraft() {
    try {
      localStorage.setItem(KEY_DRAFT, JSON.stringify({ n: S.name, t: ta.value, at: Date.now() }));
      return true;
    } catch (e) {
      toast("文档太大，草稿没能保存，请及时导出");
      return false;
    }
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
      if (!d || typeof d.t !== "string") return false;
      ta.value = d.t;
      if (typeof d.n === "string" && d.n) S.name = d.n;
      S.saved = d.t;
      S.at = d.at || 0;
      return true;
    } catch (e) {
      return false;
    }
  }
  on(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden" && S.dirty) {
      clearTimeout(saveTimer);
      saveDraft();
    }
  });
  on(window, "pagehide", () => {
    if (S.dirty) saveDraft();
  });
  function setMode(mode, quiet) {
    S.mode = mode;
    root.classList.remove("mode-split", "mode-edit", "mode-prev");
    root.classList.add("mode-" + mode);
    const bs = $("#md-mode").querySelectorAll("button");
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].dataset.v === mode);
    applyRatio();
    savePref();
    if (!quiet) setTimeout(render, 0);
  }
  function layout() {
    const narrow = root.clientWidth < 760;
    root.classList.toggle("narrow", narrow);
    split.setAttribute("aria-orientation", narrow ? "horizontal" : "vertical");
    applyRatio();
  }
  function applyRatio() {
    const r = Math.max(20, Math.min(80, S.ratio));
    if (S.mode !== "split") {
      epane.style.flex = "";
      epane.style.height = "";
      return;
    }
    if (root.classList.contains("narrow")) {
      epane.style.flex = "0 0 " + r + "%";
    } else {
      epane.style.flex = "0 0 " + r + "%";
    }
  }
  let dragging = false;
  on(split, "pointerdown", (e) => {
    dragging = true;
    split.classList.add("drag");
    try {
      split.setPointerCapture(e.pointerId);
    } catch (err) {
    }
    e.preventDefault();
  });
  on(split, "pointermove", (e) => {
    if (!dragging) return;
    const r = main.getBoundingClientRect();
    const narrow = root.classList.contains("narrow");
    const pct = narrow ? (e.clientY - r.top) / Math.max(1, r.height) * 100 : (e.clientX - r.left) / Math.max(1, r.width) * 100;
    S.ratio = Math.max(20, Math.min(80, pct));
    applyRatio();
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    split.classList.remove("drag");
    savePref();
  }
  on(split, "pointerup", endDrag);
  on(split, "pointercancel", endDrag);
  on(split, "dblclick", () => {
    S.ratio = 50;
    applyRatio();
    savePref();
  });
  function linkScroll(src, dst) {
    if (!S.sync || S.mode !== "split" || syncLock) return;
    const a = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    syncLock = true;
    dst.scrollTop = a * Math.max(0, dst.scrollHeight - dst.clientHeight);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      syncLock = false;
      rafId = 0;
    });
  }
  on(ta, "scroll", () => linkScroll(ta, pane));
  on(pane, "scroll", () => linkScroll(pane, ta));
  function applyEdit(start, end, text, ss, se) {
    ta.focus();
    try {
      ta.setSelectionRange(start, end);
    } catch (e) {
    }
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      const v = ta.value;
      ta.value = v.slice(0, start) + text + v.slice(end);
      onInput();
    }
    if (ss != null) {
      try {
        ta.setSelectionRange(ss, se);
      } catch (e) {
      }
    }
  }
  function lineBounds(v, s, e) {
    const ls = v.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    let le = v.indexOf("\n", e);
    if (le < 0) le = v.length;
    return [ls, le];
  }
  function eachLine(fn) {
    const v = ta.value;
    const b = lineBounds(v, ta.selectionStart, ta.selectionEnd);
    const lines = v.slice(b[0], b[1]).split("\n");
    const out = lines.map(fn).join("\n");
    applyEdit(b[0], b[1], out, b[0], b[0] + out.length);
  }
  function wrapInline(mark, hint) {
    const v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = v.slice(s, e);
    const pre = v.slice(Math.max(0, s - mark.length), s);
    const post = v.slice(e, e + mark.length);
    if (sel && pre === mark && post === mark) {
      applyEdit(s - mark.length, e + mark.length, sel, s - mark.length, s - mark.length + sel.length);
      return;
    }
    if (sel) {
      applyEdit(s, e, mark + sel + mark, s + mark.length, e + mark.length);
    } else {
      const ph = hint;
      applyEdit(s, e, mark + ph + mark, s + mark.length, s + mark.length + ph.length);
    }
  }
  function headingCycle() {
    eachLine((ln) => {
      const m = /^(\s*)(#{1,6})\s+([\s\S]*)$/.exec(ln);
      const lv = m ? m[2].length : 0;
      const nxt = lv >= 6 ? 0 : lv + 1;
      if (!nxt) return m ? m[1] + m[3] : ln;
      return "#".repeat(nxt) + " " + (m ? m[3] : ln.replace(/^\s*/, ""));
    });
  }
  function toggleList(kind) {
    eachLine((ln) => {
      const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s*)?([\s\S]*)$/.exec(ln);
      const indent = m ? m[1] : (/^[ \t]*/.exec(ln) || [""])[0];
      const body = m ? m[4] : ln.replace(/^\s*/, "");
      const hasTask = m && m[3] !== void 0;
      const same = !!m && (kind === "task" ? hasTask : kind === "ul" ? /^[-*+]$/.test(m[2]) && !hasTask : /^\d/.test(m[2]) && !hasTask);
      if (same) return indent + body;
      const mark = kind === "ul" ? "- " : kind === "ol" ? "1. " : "- [ ] ";
      return indent + mark + body;
    });
  }
  function toggleQuote() {
    eachLine((ln) => {
      const m = /^(\s*)>\s?([\s\S]*)$/.exec(ln);
      if (m) return m[1] + m[2];
      return "> " + ln;
    });
  }
  function insertBlock(text) {
    const v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const atLineStart = v.slice(ls, s).trim() === "";
    const pre = atLineStart || s === 0 ? "" : "\n";
    const payload = pre + text;
    applyEdit(s, e, payload, s + payload.length, s + payload.length);
  }
  function selectionSnapshot() {
    return { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  }
  function headingMenu(anchor2) {
    if (!pop.hidden && popAnchor === anchor2) {
      closePop();
      anchor2.focus();
      return;
    }
    const selection = selectionSnapshot(), from = selection.start === 0 ? 0 : selection.text.lastIndexOf("\n", selection.start - 1) + 1;
    const match = /^ {0,3}(#{1,6})[ \t]+/.exec(selection.text.slice(from));
    const level = match ? match[1].length : 0;
    openPop(anchor2, [{ head: "选择标题级别" }, ...Array.from({ length: 7 }, (_, value) => ({
      t: value ? "H" + value + " " + ["", "一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"][value] : "正文",
      on: value === level,
      headingLevel: value,
      act: () => {
        if (selection.text !== ta.value) {
          toast("内容已变化，请重新选择标题。");
          return;
        }
        const edit = headingEdit(selection.text, selection.start, selection.end, value);
        applyEdit(edit.start, edit.end, edit.insert, edit.selectionStart, edit.selectionEnd);
      }
    }))]);
    pop.querySelector('[aria-checked="true"]')?.focus();
  }
  function updateTableSummary() {
    try {
      tableMarkdown(tableRows.valueAsNumber, tableColumns.valueAsNumber);
      $("#md-table-summary").textContent = tableColumns.value + " 列、" + tableRows.value + " 行内容，另含 1 行表头";
      $("#md-table-error").hidden = true;
    } catch (error) {
      $("#md-table-summary").textContent = "内容行数 1～100，列数 1～20，均需为整数。";
    }
  }
  function openTable() {
    closePop();
    tableSelection = selectionSnapshot();
    tableCommitted = false;
    $("#md-table-error").hidden = true;
    updateTableSummary();
    tableDialog.showModal();
    tableRows.focus();
    tableRows.select();
  }
  on(tableRows, "input", updateTableSummary);
  on(tableColumns, "input", updateTableSummary);
  on($("#md-table-cancel"), "click", () => tableDialog.close());
  on($("#md-table-insert"), "click", (event) => {
    event.preventDefault();
    const selection = tableSelection;
    if (!selection) return;
    try {
      const table = tableMarkdown(tableRows.valueAsNumber, tableColumns.valueAsNumber);
      if (ta.value !== selection.text) throw new Error("内容已变化，请关闭后重新打开表格设置。");
      const before = selection.text.slice(0, selection.start), after = selection.text.slice(selection.end);
      const prefix = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const suffix = after && !after.startsWith("\n") ? "\n" : "";
      const payload = prefix + table + suffix, cell = table.indexOf("\n", table.indexOf("\n") + 1) + 3;
      tableCommitted = true;
      tableDialog.close();
      applyEdit(selection.start, selection.end, payload, selection.start + prefix.length + cell, selection.start + prefix.length + cell);
    } catch (error) {
      $("#md-table-error").textContent = error.message;
      $("#md-table-error").hidden = false;
      if (!Number.isInteger(tableRows.valueAsNumber) || tableRows.valueAsNumber < 1 || tableRows.valueAsNumber > 100) tableRows.focus();
      else tableColumns.focus();
    }
  });
  on(tableDialog, "keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.matches("input")) {
      event.preventDefault();
      $("#md-table-insert").click();
    }
  });
  on(tableDialog, "close", () => {
    if (tableDialog.open) return;
    if (!tableCommitted && tableSelection && !sig.aborted) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(tableSelection.start, tableSelection.end);
    }
    tableSelection = null;
  });
  on(tableDialog, "click", (event) => {
    const r = tableDialog.getBoundingClientRect();
    if (event.target === tableDialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) tableDialog.close();
  });
  const CODE = "```\n代码写在这里\n```\n";
  const TOOLBAR = [
    { act: "h", g: '<span class="gl h">H</span>', tip: "标题：选择正文或 H1～H6 (Ctrl+H 循环切换)" },
    { sep: 1 },
    { act: "bold", g: '<span class="gl b">B</span>', tip: "粗体 (Ctrl+B)" },
    { act: "italic", g: '<span class="gl i">I</span>', tip: "斜体 (Ctrl+I)" },
    { act: "strike", g: '<span class="gl s">S</span>', tip: "删除线" },
    { act: "code", g: '<span class="gl c">&lt;/&gt;</span>', tip: "行内代码 (Ctrl+`)" },
    { sep: 1 },
    { act: "quote", g: '<span class="gl h">&gt;</span>', tip: "引用" },
    { act: "ul", svg: "ul", tip: "无序列表" },
    { act: "ol", g: '<span class="gl h">1.</span>', tip: "有序列表" },
    { act: "task", svg: "task", tip: "任务清单" },
    { sep: 1 },
    { act: "link", svg: "link", tip: "插入链接 (Ctrl+K)" },
    { act: "image", svg: "image", tip: "插入图片文件" },
    { act: "table", svg: "table", tip: "插入表格" },
    { act: "codeblock", g: '<span class="gl c">{ }</span>', tip: "围栏代码块" },
    { act: "hr", g: '<span class="gl h">—</span>', tip: "分隔线" }
  ];
  (function buildToolbar() {
    const html = [];
    for (let i = 0; i < TOOLBAR.length; i++) {
      const t = TOOLBAR[i];
      if (t.sep) {
        html.push('<span class="mtsep"></span>');
        continue;
      }
      html.push('<button class="mtb" type="button"' + (t.act === "h" ? ' aria-haspopup="menu" aria-expanded="false"' : t.act === "table" ? ' aria-haspopup="dialog"' : "") + ' data-act="' + t.act + '" title="' + t.tip + '" aria-label="' + t.tip + '">' + (t.svg ? ICON[t.svg] : t.g) + "</button>");
    }
    tool.innerHTML = html.join("");
    on(tool, "click", (e) => {
      const b = e.target.closest ? e.target.closest(".mtb") : null;
      if (b) doAct(b.dataset.act, b);
    });
  })();
  function doAct(kind, anchor2) {
    switch (kind) {
      case "h":
        headingMenu(anchor2);
        break;
      case "bold":
        wrapInline("**", "粗体文字");
        break;
      case "italic":
        wrapInline("*", "斜体文字");
        break;
      case "strike":
        wrapInline("~~", "删除线");
        break;
      case "code":
        wrapInline("`", "code");
        break;
      case "quote":
        toggleQuote();
        break;
      case "ul":
        toggleList("ul");
        break;
      case "ol":
        toggleList("ol");
        break;
      case "task":
        toggleList("task");
        break;
      case "link":
        insertLink();
        break;
      case "image":
        pickImage();
        break;
      case "table":
        openTable();
        break;
      case "codeblock":
        insertBlock(CODE);
        break;
      case "hr":
        insertBlock("---\n");
        break;
      default:
        break;
    }
  }
  function insertLink() {
    const v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = v.slice(s, e).trim();
    if (sel) {
      const text = "[" + sel + "](https://)";
      applyEdit(s, e, text, s + sel.length + 3, s + sel.length + 11);
    } else {
      const text = "[链接文字](https://)";
      applyEdit(s, e, text, s + 1, s + 5);
    }
  }
  on(ta, "keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Tab") {
      e.preventDefault();
      const v = ta.value;
      const ss = ta.selectionStart, se = ta.selectionEnd;
      const multi = v.slice(ss, se).indexOf("\n") >= 0;
      if (multi || e.shiftKey) {
        eachLine((ln) => {
          if (e.shiftKey) return ln.replace(/^ {1,2}/, "");
          return "  " + ln;
        });
      } else {
        applyEdit(ss, se, "  ", ss + 2, ss + 2);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      const v = ta.value;
      const s = ta.selectionStart;
      if (s !== ta.selectionEnd) return;
      const ls = v.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
      const line = v.slice(ls, s);
      const m = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d{1,9})([.)])\s+|(>\s?))([\s\S]*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[7].trim()) {
        applyEdit(ls, s, "", ls, ls);
        return;
      }
      let next = m[1];
      if (m[2]) next += m[2] + " " + (m[3] ? "[ ] " : "");
      else if (m[4]) next += Number(m[4]) + 1 + m[5] + " ";
      else next += m[6];
      applyEdit(s, s, "\n" + next, s + 1 + next.length, s + 1 + next.length);
      return;
    }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        wrapInline("**", "粗体文字");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        wrapInline("*", "斜体文字");
        return;
      }
      if (k === "k") {
        e.preventDefault();
        insertLink();
        return;
      }
      if (k === "h") {
        e.preventDefault();
        headingCycle();
        return;
      }
      if (k === "`") {
        e.preventDefault();
        wrapInline("`", "code");
        return;
      }
      if (k === "1") {
        e.preventDefault();
        setMode("split");
        return;
      }
      if (k === "2") {
        e.preventDefault();
        setMode("edit");
        return;
      }
      if (k === "3") {
        e.preventDefault();
        setMode("prev");
        return;
      }
      if (k === "s") {
        e.preventDefault();
        saveMarkdown();
        return;
      }
    }
    if (e.key === "Escape") closePop();
  });
  function onInput() {
    scheduleRender();
    scheduleSave();
  }
  on(ta, "input", onInput);
  on(ta, "paste", () => setTimeout(onInput, 0));
  function closePop() {
    pop.hidden = true;
    popAnchor?.setAttribute("aria-expanded", "false");
    popAnchor = null;
  }
  function openPop(anchor2, items) {
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.sep) {
        rows.push('<div class="popsep"></div>');
        continue;
      }
      if (it.head) {
        rows.push('<div class="poph">' + es(it.head) + "</div>");
        continue;
      }
      const headingAttrs = it.headingLevel == null ? "" : ' role="menuitemradio" aria-checked="' + !!it.on + '" data-heading-level="' + it.headingLevel + '"';
      rows.push("<button" + headingAttrs + ' class="popi' + (it.on ? " on" : "") + (it.danger ? " danger" : "") + '" type="button" data-i="' + i + '"><span class="pt">' + es(it.t) + "</span>" + (it.h ? '<span class="ph">' + es(it.h) + "</span>" : "") + "</button>");
    }
    pop.innerHTML = rows.join("");
    pop.hidden = false;
    popAnchor = anchor2;
    anchor2.setAttribute("aria-expanded", "true");
    const r = anchor2.getBoundingClientRect();
    pop.style.visibility = "hidden";
    pop.style.left = "8px";
    pop.style.top = "8px";
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
    const b = e.target.closest ? e.target.closest(".popi") : null;
    if (!b) return;
    const items = pop.__items || [];
    const it = items[Number(b.dataset.i)];
    closePop();
    if (it && it.act) {
      if (it.headingLevel != null) it.act();
      else setTimeout(it.act, 0);
    }
  });
  on(pop, "keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...pop.querySelectorAll("button")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  });
  on(document, "pointerdown", (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (popAnchor && popAnchor.contains(e.target)) return;
    closePop();
  }, true);
  on(document, "keydown", (e) => {
    if (e.key === "Escape") closePop();
  });
  on(window, "resize", () => closePop());
  function ask(msg) {
    return new Promise((resolve) => {
      $("#md-qt").textContent = msg;
      shade.hidden = false;
      const done = (v) => {
        shade.hidden = true;
        $("#md-ok").onclick = null;
        $("#md-cancel").onclick = null;
        shade.onclick = null;
        resolve(v);
      };
      $("#md-ok").onclick = () => done(true);
      $("#md-cancel").onclick = () => done(false);
      shade.onclick = (e) => {
        if (e.target === shade) done(false);
      };
      setTimeout(() => {
        try {
          $("#md-ok").focus();
        } catch (e) {
        }
      }, 30);
    });
  }
  function baseName() {
    let n = (S.name || "未命名.md").trim();
    n = n.replace(/[\\/:*?"<>|]/g, "_");
    if (!/\.[A-Za-z0-9]{1,6}$/.test(n)) n += ".md";
    return n;
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
  async function copyText(text) {
    if (api && typeof api.copyText === "function") {
      try {
        await api.copyText(text);
        return true;
      } catch (e) {
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
    }
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
      return true;
    } catch (e) {
      return false;
    }
  }
  async function openFile() {
    let f;
    try {
      f = await pickFile(["md", "markdown", "txt", "text"]);
    } catch (err) {
      toast("打开失败");
      return;
    }
    if (!f || !f.blob) return;
    try {
      const text = await f.blob.text();
      ta.value = text;
      S.name = f.name || "未命名.md";
      nameIn.value = S.name;
      S.saved = text;
      S.at = Date.now();
      S.dirty = false;
      dot.hidden = true;
      render(true);
      render();
      updateSavedLabel();
      saveDraft();
      ta.scrollTop = 0;
      pane.scrollTop = 0;
      toast("已打开 " + S.name);
    } catch (err) {
      toast("读取失败：" + (err && err.message || err));
    }
  }
  async function saveMarkdown() {
    try {
      const ok = await saveBlob(baseName(), new Blob([ta.value], { type: "text/markdown;charset=utf-8" }));
      toast(ok ? "已保存 " + baseName() : "已取消");
    } catch (err) {
      toast("保存失败：" + (err && err.message || err));
    }
  }
  async function exportHtml() {
    try {
      const body = renderMarkdown(ta.value).replace(/<button class="cbtn"[^>]*>复制<\/button>/g, "");
      const title = es(S.name.replace(/\.[A-Za-z0-9]{1,6}$/, "") || "Markdown");
      const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + title + "</title>\n<style>\n" + exportCss() + "\n</style>\n</head>\n<body>\n" + body + "\n</body>\n</html>\n";
      const name = baseName().replace(/\.md$/i, "") + ".html";
      const ok = await saveBlob(name, new Blob([html], { type: "text/html;charset=utf-8" }));
      toast(ok ? "已导出 " + name : "已取消");
    } catch (err) {
      toast("导出失败：" + (err && err.message || err));
    }
  }
  async function pickImage() {
    let f;
    try {
      f = await pickFile(["png", "jpg", "jpeg", "webp", "gif"]);
    } catch (err) {
      toast("插入失败");
      return;
    }
    if (!f || !f.blob) return;
    if (f.blob.size > 12 * 1024 * 1024) {
      toast("图片太大（上限 12 MB）");
      return;
    }
    const url = URL.createObjectURL(f.blob);
    const img = new Image();
    try {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("无法解码这张图片"));
        img.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      toast(err.message);
      return;
    }
    URL.revokeObjectURL(url);
    const iw = img.naturalWidth || 800;
    const ih = img.naturalHeight || 600;
    const k = Math.min(1, 1400 / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));
    let src;
    try {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, w, h);
      src = /\.(jpe?g|webp)$/i.test(f.name || "") ? c.toDataURL("image/jpeg", 0.9) : c.toDataURL("image/png");
    } catch (err) {
      toast("图片处理失败");
      return;
    }
    const alt = (f.name || "image").replace(/\.[^.]+$/, "");
    const md = "![" + alt + "](" + src + ")";
    insertBlock(md + "\n");
    if (src.length > 9e5) toast("图片已内嵌，文档会明显变大");
    else toast("图片已插入");
  }
  function newDoc() {
    const start = (tpl) => {
      ta.value = typeof tpl === "string" ? tpl : "";
      S.name = "未命名.md";
      nameIn.value = S.name;
      S.saved = ta.value;
      S.at = Date.now();
      S.dirty = false;
      dot.hidden = true;
      render(true);
      updateSavedLabel();
      saveDraft();
      ta.scrollTop = 0;
      ta.focus();
      try {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (e) {
      }
    };
    const run = async () => {
      if (!ta.value.trim()) {
        start("");
        toast("已新建空白文档");
        return;
      }
      const ok = await ask("新建会替换当前内容，确定吗？");
      if (ok) {
        start("");
        render();
        toast("已新建空白文档，可 Ctrl+Z 找回");
      }
    };
    run();
  }
  function useTemplate(key) {
    const t = TEMPLATES[key];
    if (!t) return;
    const run = async () => {
      if (ta.value.trim()) {
        const ok = await ask("套用模板会替换当前内容，确定吗？");
        if (!ok) return;
      }
      ta.value = t.text;
      S.saved = t.text;
      S.dirty = false;
      dot.hidden = true;
      render(true);
      saveDraft();
      ta.focus();
      try {
        ta.setSelectionRange(0, 0);
      } catch (e) {
      }
      toast("已套用模板：" + t.label);
    };
    run();
  }
  $("#md-menu").innerHTML = ICON.menu;
  $("#md-export").innerHTML = "导出";
  syncBtn.innerHTML = ICON.sync;
  const modeBtns = $("#md-mode").querySelectorAll("button");
  modeBtns[0].innerHTML = ICON.split;
  modeBtns[1].innerHTML = ICON.edit;
  modeBtns[2].innerHTML = ICON.eye;
  on($("#md-mode"), "click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if (b && b.dataset.v) setMode(b.dataset.v);
  });
  on($("#md-menu"), "click", () => {
    const items = [
      { t: "新建文档", h: "Ctrl+N", act: newDoc },
      { t: "打开文件…", h: ".md .txt", act: openFile },
      { t: "保存为 Markdown", h: "Ctrl+S", act: saveMarkdown },
      { sep: 1 },
      { head: "插入" },
      { t: "插入图片…", act: pickImage },
      { sep: 1 },
      { head: "模板" }
    ];
    Object.keys(TEMPLATES).forEach((k) => {
      if (k === "blank") return;
      items.push({ t: TEMPLATES[k].label, act: () => useTemplate(k) });
    });
    items.push({ sep: 1 });
    items.push({ head: "阅读" });
    items.push({ t: "字号", h: S.fs + "px", act: () => cycleFont(1) });
    items.push({ t: "衬线字体", on: S.serif, act: () => toggleSerif() });
    openPop($("#md-menu"), items);
  });
  on($("#md-aa"), "click", () => {
    openPop($("#md-aa"), [
      { head: "阅读字号" },
      { t: "字号增大", h: "+" + (S.fs >= 22 ? "（已最大）" : "1"), act: () => cycleFont(1) },
      { t: "字号减小", h: S.fs <= 13 ? "（已最小）" : "-1", act: () => cycleFont(-1) },
      { sep: 1 },
      { t: "无衬线字体", on: !S.serif, act: () => setSerif(false) },
      { t: "衬线字体", on: S.serif, act: () => setSerif(true) }
    ]);
  });
  on($("#md-export"), "click", () => {
    openPop($("#md-export"), [
      { head: "导出" },
      { t: "导出 HTML 网页", h: ".html", act: exportHtml },
      { t: "保存 Markdown", h: ".md", act: saveMarkdown },
      { sep: 1 },
      { t: "复制 Markdown", act: async () => {
        const ok = await copyText(ta.value);
        toast(ok ? "已复制 Markdown" : "复制失败");
      } },
      { t: "复制渲染后的 HTML", act: async () => {
        const ok = await copyText(prev.innerHTML);
        toast(ok ? "已复制 HTML" : "复制失败");
      } }
    ]);
  });
  function cycleFont(d) {
    S.fs = Math.max(13, Math.min(22, S.fs + d));
    render();
    savePref();
    closePop();
  }
  function setSerif(v) {
    S.serif = !!v;
    render();
    savePref();
    closePop();
  }
  function toggleSerif() {
    setSerif(!S.serif);
  }
  on(syncBtn, "click", () => {
    S.sync = !S.sync;
    syncBtn.classList.toggle("on", S.sync);
    syncBtn.title = "同步滚动：" + (S.sync ? "开" : "关");
    savePref();
    toast(S.sync ? "同步滚动已开启" : "同步滚动已关闭");
  });
  on(nameIn, "input", () => {
    S.name = nameIn.value || "未命名.md";
    scheduleSave();
  });
  on(nameIn, "keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      nameIn.blur();
    }
  });
  on(prev, "click", (e) => {
    const b = e.target.closest ? e.target.closest(".cbtn") : null;
    if (!b) return;
    const box = b.closest(".cb");
    const code = box ? box.querySelector("code") : null;
    if (!code) return;
    copyText(code.textContent).then((ok) => {
      b.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        b.textContent = "复制";
      }, 1300);
    });
  });
  on(window, "keydown", (e) => {
    if (tableDialog.open) return;
    if (!shade.hidden) {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#md-ok").click();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      saveMarkdown();
    } else if (k === "n") {
      e.preventDefault();
      newDoc();
    } else if (k === "1") {
      e.preventDefault();
      setMode("split");
    } else if (k === "2") {
      e.preventDefault();
      setMode("edit");
    } else if (k === "3") {
      e.preventDefault();
      setMode("prev");
    }
  });
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  if (sig.addEventListener) sig.addEventListener("abort", () => ro.disconnect());
  loadPref();
  const hadDraft = loadDraft();
  if (!hadDraft) {
    ta.value = WELCOME;
    S.saved = WELCOME;
  }
  nameIn.value = S.name;
  syncBtn.classList.toggle("on", S.sync);
  syncBtn.title = "同步滚动：" + (S.sync ? "开" : "关");
  setMode(S.mode, true);
  layout();
  render();
  if (hadDraft) {
    updateSavedLabel();
    setTimeout(() => toast("已恢复上次的草稿"), 350);
  } else {
    saveDraft();
  }
  return function cleanup() {
    if (tableDialog.open) tableDialog.close();
    clearTimeout(renderTimer);
    clearTimeout(saveTimer);
    clearTimeout(toastTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (S.dirty) saveDraft();
    try {
      ro.disconnect();
    } catch (e) {
    }
  };
}
export {
  mount
};
