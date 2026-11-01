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

// src-tauri/builtin-tools/src/morse-data.js
var MORSE = Object.fromEntries([
  ["A", ".-"],
  ["B", "-..."],
  ["C", "-.-."],
  ["D", "-.."],
  ["E", "."],
  ["F", "..-."],
  ["G", "--."],
  ["H", "...."],
  ["I", ".."],
  ["J", ".---"],
  ["K", "-.-"],
  ["L", ".-.."],
  ["M", "--"],
  ["N", "-."],
  ["O", "---"],
  ["P", ".--."],
  ["Q", "--.-"],
  ["R", ".-."],
  ["S", "..."],
  ["T", "-"],
  ["U", "..-"],
  ["V", "...-"],
  ["W", ".--"],
  ["X", "-..-"],
  ["Y", "-.--"],
  ["Z", "--.."],
  ["0", "-----"],
  ["1", ".----"],
  ["2", "..---"],
  ["3", "...--"],
  ["4", "....-"],
  ["5", "....."],
  ["6", "-...."],
  ["7", "--..."],
  ["8", "---.."],
  ["9", "----."],
  [".", ".-.-.-"],
  [",", "--..--"],
  ["?", "..--.."],
  ["'", ".----."],
  ["/", "-..-."],
  ["(", "-.--."],
  [")", "-.--.-"],
  [":", "---..."],
  ["=", "-...-"],
  ["+", ".-.-."],
  ["-", "-....-"],
  ['"', ".-..-."],
  ["@", ".--.-."]
]);
var REVERSE = Object.fromEntries(Object.entries(MORSE).map(([a, b]) => [b, a]));
function morseEncode(value) {
  if (!value.trim()) throw new Error("请输入英文、数字或常用标点。");
  if (value.length > 16384) throw new Error("输入超过 16384 字符，请缩短内容。");
  for (const c of value) if (!/\s/.test(c) && (!MORSE[c.toUpperCase()] || c.toUpperCase().length !== 1)) throw new Error(`不支持字符“${c}”，请使用英文、数字和速查表中的标点。`);
  return value.toUpperCase().split(/\r?\n/).map((line) => line.trim().split(/\s+/).filter(Boolean).map((word) => [...word].map((c) => {
    if (!MORSE[c]) throw new Error(`不支持字符“${c}”，请使用英文、数字和速查表中的标点。`);
    return MORSE[c];
  }).join(" ")).join(" / ")).join("\n");
}
function morseDecode(value) {
  const normalized = value.trim().replace(/[·•]/g, ".").replace(/[—–_]/g, "-");
  if (!normalized) throw new Error("请输入摩斯电码。");
  if (normalized.length > 65536) throw new Error("电码超过 64 KiB，请缩短内容。");
  return normalized.split(/\r?\n/).map((line) => line.split(/\s*\/\s*/).map((word) => word.trim().split(/\s+/).filter(Boolean).map((code) => {
    if (!REVERSE[code]) throw new Error(`无法识别电码“${code.slice(0, 24)}”，字母用空格分隔、单词用 / 分隔。`);
    return REVERSE[code];
  }).join("")).join(" ")).join("\n");
}

// src-tauri/builtin-tools/src/morse.js
function mount({ copyText }) {
  const clear = () => {
    $("output").value = "";
    status("");
  };
  for (const [c, code] of Object.entries(MORSE)) {
    const item = text("div", "");
    item.append(text("strong", c), text("code", code));
    $("codes").append(item);
  }
  $("input").oninput = clear;
  for (const [id, fn] of [["encode", morseEncode], ["decode", morseDecode]]) $(id).onclick = () => {
    try {
      $("output").value = fn($("input").value);
      status("已转换。");
    } catch (e) {
      clear();
      status(e.message, true);
    }
  };
  $("swap").onclick = () => {
    if (!$("output").value) return;
    $("input").value = $("output").value;
    clear();
  };
  $("clear").onclick = () => {
    $("input").value = "";
    clear();
  };
  copyButton("copy", () => $("output").value, copyText);
}
export {
  mount
};
