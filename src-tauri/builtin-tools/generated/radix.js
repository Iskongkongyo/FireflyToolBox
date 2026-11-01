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

// src-tauri/builtin-tools/src/algorithms.js
function radixConvert(value, from, to) {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  from = Number(from);
  to = Number(to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2 || from > 36 || to < 2 || to > 36) throw new Error("进制须为 2 到 36 的整数。");
  let raw = value.trim().toLowerCase(), negative = false;
  if (raw[0] === "-" || raw[0] === "+") {
    negative = raw[0] === "-";
    raw = raw.slice(1);
  }
  for (const [prefix, base] of [["0b", 2], ["0o", 8], ["0x", 16]]) {
    if (raw.startsWith(prefix) && from === base) raw = raw.slice(2);
  }
  if (!raw || raw.length > 4096) throw new Error("请输入不超过 4096 位的整数；暂不支持小数。");
  let number = 0n;
  for (const ch of raw) {
    const digit = digits.indexOf(ch);
    if (digit < 0 || digit >= from) throw new Error(`字符“${ch}”不属于 ${from} 进制。`);
    number = number * BigInt(from) + BigInt(digit);
  }
  if (negative) number = -number;
  return { output: number.toString(to), binary: number.toString(2), octal: number.toString(8), decimal: number.toString(10), hex: number.toString(16).toUpperCase() };
}

// src-tauri/builtin-tools/src/radix.js
function mount({ copyText }) {
  for (const id of ["from", "to"]) for (let i = 2; i <= 36; i++) {
    const option = text("option", `${i} 进制`);
    option.value = i;
    $(id).append(option);
  }
  $("from").value = "10";
  $("to").value = "16";
  $("input").value = "255";
  const clear = () => {
    $("output").value = "";
    status("");
  };
  $("input").oninput = clear;
  $("from").onchange = clear;
  $("to").onchange = clear;
  const run = () => {
    try {
      const result = radixConvert($("input").value, $("from").value, $("to").value);
      $("output").value = result.output;
      status("已转换。");
    } catch (error) {
      clear();
      status(error.message, true);
    }
  };
  $("swap").onclick = () => {
    const from = $("from").value;
    $("from").value = $("to").value;
    $("to").value = from;
    if ($("output").value) {
      $("input").value = $("output").value;
      run();
    } else clear();
  };
  $("run").onclick = run;
  copyButton("copy", () => $("output").value, copyText);
  run();
}
export {
  mount
};
