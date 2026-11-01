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
function workerJob(source, data, signal, timeout = 1500, transfer = []) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("已取消", "AbortError"));
      return;
    }
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    let worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      reject(error);
      return;
    }
    URL.revokeObjectURL(url);
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    const timer = setTimeout(() => finish(new Error("计算耗时过长，已中断。请缩小输入或简化表达式。")), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data: data2 }) => finish(data2.error ? new Error(data2.error) : null, data2.result);
    worker.onerror = () => finish(new Error("计算失败，请检查输入或设备兼容性。"));
    worker.postMessage(data, transfer);
  });
}

// src-tauri/builtin-tools/src/units-data.js
var unitGroups = {
  length: { name: "长度", units: { m: ["米", 1], km: ["千米", 1e3], cm: ["厘米", 0.01], mm: ["毫米", 1e-3], um: ["微米", 1e-6], inch: ["英寸", 0.0254], foot: ["英尺", 0.3048], yard: ["码", 0.9144], mile: ["英里", 1609.344] } },
  area: { name: "面积", units: { m2: ["平方米", 1], km2: ["平方千米", 1e6], cm2: ["平方厘米", 1e-4], ha: ["公顷", 1e4], mu: ["亩", 2e3 / 3], sqft: ["平方英尺", 0.09290304], acre: ["英亩", 4046.8564224] } },
  volume: { name: "体积", units: { m3: ["立方米", 1], L: ["升", 1e-3], mL: ["毫升", 1e-6], cm3: ["立方厘米", 1e-6], usgal: ["美制加仑", 0.003785411784], ukgal: ["英制加仑", 454609e-8] } },
  mass: { name: "重量", units: { kg: ["千克", 1], g: ["克", 1e-3], mg: ["毫克", 1e-6], tonne: ["吨", 1e3], lb: ["磅", 0.45359237], oz: ["盎司", 0.028349523125], jin: ["市斤（大陆）", 0.5], liang: ["市两（大陆）", 0.05] } },
  temperature: { name: "温度", units: { C: ["摄氏度", 1], F: ["华氏度", 1], K: ["开尔文", 1] } },
  speed: { name: "速度", units: { ms: ["米/秒", 1], kmh: ["千米/小时", 1 / 3.6], mph: ["英里/小时", 0.44704], knot: ["节", 1852 / 3600], fts: ["英尺/秒", 0.3048] } },
  time: { name: "时间", units: { s: ["秒", 1], min: ["分钟", 60], h: ["小时", 3600], d: ["天", 86400], week: ["周", 604800], ms: ["毫秒", 1e-3] } },
  data: { name: "数据容量", units: { B: ["字节 B", 1], bit: ["位 bit", 0.125], KB: ["KB（1000 B）", 1e3], MB: ["MB（1000 KB）", 1e6], GB: ["GB（1000 MB）", 1e9], TB: ["TB（1000 GB）", 1e12], KiB: ["KiB（1024 B）", 1024], MiB: ["MiB（1024 KiB）", 1048576], GiB: ["GiB（1024 MiB）", 1073741824], TiB: ["TiB（1024 GiB）", 1099511627776] } }
};
function convertUnit(group, from, to, value) {
  const def = unitGroups[group];
  if (!def?.units[from] || !def.units[to] || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("请选择有效单位并输入有限数值。");
  value = Number(value);
  let result;
  if (group === "temperature") {
    const kelvin = from === "C" ? value + 273.15 : from === "F" ? (value - 32) * 5 / 9 + 273.15 : value;
    if (kelvin < -1e-9) throw new Error("温度不能低于绝对零度。");
    result = to === "K" ? kelvin : to === "C" ? kelvin - 273.15 : (kelvin - 273.15) * 9 / 5 + 32;
  } else {
    if (group === "data" && value < 0) throw new Error("数据容量不能为负数。");
    result = value * def.units[from][1] / def.units[to][1];
  }
  if (!Number.isFinite(result)) throw new Error("数值过大。");
  return Math.abs(result) < 1e-12 ? 0 : result;
}

// src-tauri/builtin-tools/src/math-engine.js
function calculate(expression, { degrees = true, ans = 0 } = {}) {
  if (typeof expression !== "string" || expression.length > 512) throw new Error("表达式最多 512 字符。");
  const tokens = [];
  let at = 0;
  while (at < expression.length) {
    if (/\s/.test(expression[at])) {
      at++;
      continue;
    }
    const part = expression.slice(at), match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z]+|^[+\-*/^%(),]/.exec(part);
    if (!match) throw new Error("不支持的字符：" + expression[at]);
    tokens.push(match[0]);
    at += match[0].length;
  }
  let index = 0, depth = 0;
  const peek = () => tokens[index], take = () => tokens[index++], finite = (n) => {
    if (!Number.isFinite(n)) throw new Error("结果无定义或超出数值范围。");
    return n;
  }, trig = (n) => degrees ? n * Math.PI / 180 : n;
  const funcs = { sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, sin: (n) => Math.sin(trig(n)), cos: (n) => Math.cos(trig(n)), tan: (n) => Math.tan(trig(n)), asin: (n) => Math.asin(n) * (degrees ? 180 / Math.PI : 1), acos: (n) => Math.acos(n) * (degrees ? 180 / Math.PI : 1), atan: (n) => Math.atan(n) * (degrees ? 180 / Math.PI : 1), min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a % b };
  function primary() {
    if (++depth > 32) throw new Error("表达式嵌套过深。");
    let value;
    const token = take();
    if (token === "(") {
      value = add();
      if (take() !== ")") throw new Error("括号不匹配。");
    } else if (token && /^[\d.]/.test(token)) value = Number(token);
    else if (token && /^[A-Za-z]+$/.test(token)) {
      const name = token.toLowerCase();
      if (["pi", "e", "ans"].includes(name)) value = name === "pi" ? Math.PI : name === "e" ? Math.E : Number(ans);
      else {
        if (!funcs[name] || take() !== "(") throw new Error("未知函数或常量：" + name);
        const args = [add()];
        while (peek() === ",") {
          take();
          args.push(add());
          if (args.length > 16) throw new Error("参数过多。");
        }
        if (take() !== ")") throw new Error("函数括号不匹配。");
        if (!["min", "max"].includes(name) && args.length !== (["pow", "mod"].includes(name) ? 2 : 1)) throw new Error("函数参数个数无效。");
        value = funcs[name](...args);
      }
    } else throw new Error("表达式不完整。");
    depth--;
    while (peek() === "%") {
      take();
      value /= 100;
    }
    return finite(value);
  }
  const power = () => {
    const value = primary();
    return peek() === "^" ? (take(), finite(value ** unary())) : value;
  };
  const unary = () => peek() === "+" ? (take(), unary()) : peek() === "-" ? (take(), -unary()) : power();
  const multiply = () => {
    let value = unary();
    while (["*", "/"].includes(peek())) {
      const op = take(), right = unary();
      if (op === "/" && right === 0) throw new Error("不能除以零。");
      value = finite(op === "*" ? value * right : value / right);
    }
    return value;
  };
  function add() {
    let value = multiply();
    while (["+", "-"].includes(peek())) {
      const op = take(), right = multiply();
      value = finite(op === "+" ? value + right : value - right);
    }
    return value;
  }
  if (!tokens.length) throw new Error("请输入表达式。");
  const result = add();
  if (index !== tokens.length) throw new Error("运算符缺失或括号不匹配。");
  return finite(result);
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

// src-tauri/builtin-tools/src/utility-tools.js
function mount({ copyText, openFile, saveFile, signal }) {
  const mode = $("utility-tool").dataset.mode, calculator = mode === "math.calculate";
  let result = "", controller, busy = false, disposed = false, answer = 0, history = loadState("history", []);
  if (!Array.isArray(history)) history = [];
  history = history.filter((item) => item && typeof item.expression === "string" && item.expression.length <= 512 && ["string", "number"].includes(typeof item.result) && String(item.result).trim() && Number.isFinite(Number(item.result))).slice(0, 20);
  if (calculator) {
    $("utility-tool").classList.add("calculator-tool");
    $("utility-actions").hidden = true;
    $("utility-result").hidden = true;
    $("process").textContent = "计算 =";
    $("copy").textContent = "复制结果";
    $("save").textContent = "保存结果";
    $("calculator-actions").append($("process"), $("copy"), $("save"));
    $("calculator-status").append($("status"));
  }
  for (const key of ["units", "calculator", "replace", "data"]) $(key + "-settings").hidden = mode !== { units: "unit.convert", calculator: "math.calculate", replace: "text.replace", data: "data.convert" }[key];
  const update = () => {
    for (const el of document.querySelectorAll("button,input,select,textarea")) el.disabled = busy;
    $("copy").disabled = busy || !result;
    $("save").disabled = busy || !result;
    $("clear-history").disabled = busy || !history.length;
    $("cancel").hidden = !busy;
    $("cancel").disabled = false;
  };
  const show = (value) => {
    result = value;
    $("output").value = value;
    if (calculator) $("calculator-result").textContent = value || "—";
    update();
  };
  function choices(select, items) {
    select.replaceChildren(...Object.entries(items).map(([value, item]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = Array.isArray(item) ? item[0] : item.name;
      return option;
    }));
  }
  choices($("group"), unitGroups);
  function units() {
    const group = unitGroups[$("group").value];
    choices($("from"), group.units);
    choices($("to"), group.units);
    $("to").selectedIndex = Math.min(1, $("to").options.length - 1);
    convert();
  }
  function convert() {
    try {
      show(String(Number(convertUnit($("group").value, $("from").value, $("to").value, $("number").value).toPrecision(12))));
      status("已换算，结果按 12 位有效数字显示。");
    } catch (error) {
      show("");
      status(error.message, true);
    }
  }
  $("group").onchange = units;
  for (const id of ["from", "to", "number"]) $(id).oninput = convert;
  $("swap").onclick = () => {
    const from = $("from").value;
    $("from").value = $("to").value;
    $("to").value = from;
    convert();
  };
  function renderHistory() {
    $("history-empty").hidden = !!history.length;
    $("clear-history").disabled = !history.length;
    $("history").replaceChildren(...history.map((item) => {
      const button = text("button", "", "calculator-history-item"), angleKnown = ["deg", "rad"].includes(item.angleUnit);
      button.append(text("span", item.expression, "calculator-history-expression"), text("strong", String(item.result)), text("small", angleKnown ? item.angleUnit === "rad" ? "RAD 弧度" : "DEG 角度" : "旧记录未保存角度单位", "hint"));
      button.onclick = () => {
        $("expression").value = item.expression;
        if (angleKnown) $("angle-unit").value = item.angleUnit;
        answer = Number(item.result);
        show(String(item.result));
        status(angleKnown ? "已恢复这条计算记录。" : "已恢复历史结果；旧记录未保存角度单位，请按原计算方式选择。");
      };
      return button;
    }));
  }
  $("clear-history").onclick = () => {
    history = [];
    saveState("history", history);
    renderHistory();
  };
  async function process() {
    if (busy) return;
    if (mode === "unit.convert") {
      convert();
      return;
    }
    if (mode === "math.calculate") {
      try {
        answer = calculate($("expression").value, { degrees: $("angle-unit").value === "deg", ans: answer });
        show(String(Number(answer.toPrecision(14))));
        history.unshift({ expression: $("expression").value, result, angleUnit: $("angle-unit").value });
        history = history.slice(0, 20);
        saveState("history", history);
        renderHistory();
        status("计算完成。");
      } catch (error) {
        show("");
        status(error.message, true);
      }
      return;
    }
    busy = true;
    controller = new AbortController();
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      const input = $("input").value;
      if (new TextEncoder().encode(input).length > 2 * 1048576) throw new Error("输入最多 2 MiB。");
      const rules = mode === "text.replace" ? JSON.parse($("rules").value) : null, data = await workerJob(`"use strict";
(() => {
  // src-tauri/builtin-tools/src/data-convert-engine.js
  function parseDelimited(text, delimiter = ",") {
    if (![",", ";", "	", "|"].includes(delimiter)) throw new Error("分隔符无效。");
    text = text.replace(/^\\uFEFF/, "");
    if (!text) return [];
    const rows = [];
    let row = [], cell = "", quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else cell += ch;
        continue;
      }
      if (ch === '"') {
        if (cell || closed) throw new Error("引号必须出现在字段开头。");
        quoted = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = "";
        closed = false;
      } else if (ch === "\\r" || ch === "\\n") {
        if (ch === "\\r" && text[i + 1] === "\\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        closed = false;
      } else {
        if (closed) throw new Error("结束引号后出现额外字符。");
        cell += ch;
      }
      if (rows.length > 5e4 || row.length > 200) throw new Error("最多 5 万行、200 列。");
    }
    if (quoted) throw new Error("字段引号未闭合。");
    if (cell || row.length || closed || !/[\\r\\n]$/.test(text)) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  function csvToJson(text, { delimiter = ",", header = true } = {}) {
    const rows = parseDelimited(text, delimiter);
    if (!header) return rows;
    if (!rows.length) return [];
    const keys = rows.shift();
    if (keys.some((k) => !k) || new Set(keys).size !== keys.length) throw new Error("表头不能为空或重复。");
    return rows.map((row) => {
      if (row.length !== keys.length) throw new Error("各行列数与表头不一致。");
      return Object.fromEntries(keys.map((key, i) => [key, row[i]]));
    });
  }
  function jsonToCsv(value, { delimiter = ",", fields = "", header = true } = {}) {
    if (![",", ";", "	", "|"].includes(delimiter)) throw new Error("分隔符无效。");
    if (!Array.isArray(value) || value.length > 5e4) throw new Error("JSON 应为最多 5 万行的数组。");
    if (!value.length) return "";
    const arrays = Array.isArray(value[0]);
    if (value.some((row) => arrays ? !Array.isArray(row) : !row || typeof row !== "object" || Array.isArray(row))) throw new Error("行类型必须一致。");
    const keys = arrays ? Array.from({ length: Math.max(...value.map((row) => row.length)) }, (_, i) => String(i)) : fields.trim() ? fields.split(",").map((k) => k.trim()) : [...new Set(value.flatMap((row) => Object.keys(row)))];
    if (keys.length > 200 || new Set(keys).size !== keys.length) throw new Error("列数过多或选择字段重复。");
    const escape = (value2) => {
      const str = value2 == null ? "" : typeof value2 === "object" ? JSON.stringify(value2) : String(value2);
      return str.includes(delimiter) || /["\\r\\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
    };
    const lines = value.map((row) => keys.map((key) => escape(row[key])).join(delimiter));
    if (header && !arrays) lines.unshift(keys.map(escape).join(delimiter));
    return lines.join("\\r\\n");
  }
  function replaceRules(text, rules) {
    if (!Array.isArray(rules) || rules.length > 30) throw new Error("最多 30 条替换规则。");
    const report = [];
    let result = text;
    for (const rule of rules) {
      if (typeof rule.find !== "string" || !rule.find || typeof rule.replace !== "string") throw new Error("查找内容不能为空。");
      let count = 0;
      if (rule.regex) {
        if (!/^[gimsu]*$/.test(rule.flags ?? "") || new Set(rule.flags ?? "").size !== (rule.flags ?? "").length) throw new Error("正则标志无效。");
        const flags = (rule.flags ?? "").includes("g") ? rule.flags : (rule.flags ?? "") + "g", expression = new RegExp(rule.find, flags);
        let length = 0, last = 0;
        result = result.replace(expression, (...args) => {
          count++;
          const whole = args[0], groups = typeof args.at(-1) === "object" ? args.pop() : null, input = args.pop(), offset = args.pop();
          const value = rule.replace.replace(/\\$\\$|\\$&|\\$\`|\\$'|\\$\\d{1,2}|\\$<[^>]+>/g, (token) => {
            if (token === "$$") return "$";
            if (token === "$&") return whole;
            if (token === "$\`") return input.slice(0, offset);
            if (token === "$'") return input.slice(offset + whole.length);
            if (token.startsWith("$<")) return groups ? groups[token.slice(2, -1)] ?? "" : token;
            const index = Number(token.slice(1));
            if (index > 0 && index < args.length) return args[index] ?? "";
            const first = Number(token[1]);
            if (token.length === 3 && first > 0 && first < args.length) return (args[first] ?? "") + token[2];
            return token;
          });
          length += offset - last + value.length;
          last = offset + whole.length;
          if (length > 4 * 1048576) throw new Error("替换结果超过 4 MiB。");
          return value;
        });
      } else {
        const parts = result.split(rule.find);
        count = parts.length - 1;
        if (result.length - count * rule.find.length + count * rule.replace.length > 4 * 1048576) throw new Error("替换结果超过 4 MiB。");
        result = parts.join(rule.replace);
      }
      if (new TextEncoder().encode(result).length > 4 * 1048576) throw new Error("替换结果超过 4 MiB。");
      report.push(count);
    }
    return { text: result, counts: report };
  }

  // src-tauri/builtin-tools/src/utility-worker.js
  self.onmessage = ({ data }) => {
    try {
      self.postMessage({ result: data.mode === "text.replace" ? replaceRules(data.text, data.rules) : data.direction === "csv" ? { text: JSON.stringify(csvToJson(data.text, data.options), null, 2) } : { text: jsonToCsv(JSON.parse(data.text), data.options) } });
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
})();
`, { mode, text: input, rules, direction: $("direction").value, options: { delimiter: $("delimiter").value === "tab" ? "	" : $("delimiter").value, header: $("header").checked, fields: $("fields").value } }, controller.signal, 8e3);
      if (new TextEncoder().encode(data.text).length > 4 * 1048576) throw new Error("输出最多 4 MiB。");
      show(data.text);
      status(data.counts ? "各规则替换次数：" + data.counts.join("、") : "转换完成。");
    } catch (error) {
      status(error.name === "AbortError" ? "已取消，请调整规则后重试。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      busy = false;
      controller = null;
      if (!disposed) update();
    }
  }
  $("process").onclick = () => void process();
  $("expression").onkeydown = (event) => {
    if (event.key === "Enter") void process();
  };
  $("cancel").onclick = () => controller?.abort();
  if (calculator) {
    let insert2 = function(value, kind = "text") {
      let start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start, selected = input.value.slice(start, end), replacement = value, caret;
      if (kind === "text" && value === ")" && start === end && input.value[start] === ")") {
        input.focus();
        input.setSelectionRange(start + 1, start + 1);
        return;
      }
      if (kind === "clear") {
        input.value = "";
        input.focus();
        changed();
        return;
      }
      if (kind === "backspace") {
        if (start === end && start) start--;
        replacement = "";
      }
      if (kind === "function") {
        replacement = value + "(" + selected + ")";
        caret = start + value.length + 1 + (selected ? selected.length + 1 : 0);
      }
      if (kind === "square") {
        replacement = selected ? "(" + selected + ")^2" : "^2";
      }
      if (kind === "sign") {
        if (selected) replacement = "-(" + selected + ")";
        else {
          const before = input.value.slice(0, start), number = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(before), negative = /\(-((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\)$/.exec(before);
          if (number) {
            start = number.index;
            const minus = start - 1, unary = input.value[minus] === "-" && (minus === 0 || /[+\-*/^(,]/.test(input.value[minus - 1]));
            if (unary) {
              start = minus;
              replacement = number[0];
            } else replacement = start === 0 ? "-" + number[0] : "(-" + number[0] + ")";
          } else if (negative) {
            start = negative.index;
            replacement = negative[1];
          } else if (input.value) {
            start = 0;
            end = input.value.length;
            replacement = "-(" + input.value + ")";
          } else replacement = "-";
        }
      }
      if (input.value.length - (end - start) + replacement.length > 512) {
        status("表达式最多 512 字符。", true);
        return;
      }
      input.setRangeText(replacement, start, end, "end");
      if (caret !== void 0) input.setSelectionRange(caret, caret);
      input.focus();
      changed();
    };
    var insert = insert2;
    const input = $("expression"), changed = () => {
      show("");
      status("");
    };
    input.oninput = changed;
    $("angle-unit").onchange = changed;
    const functions = [["sin", "sin"], ["cos", "cos"], ["tan", "tan"], ["asin", "asin"], ["acos", "acos"], ["atan", "atan"], ["√", "sqrt"], ["x²", "^2", "square"], ["xʸ", "^", "text"], ["ln", "ln"], ["log", "log"], ["exp", "exp"], ["π", "pi", "text"], ["e", "e", "text"], ["ans", "ans", "text"], ["abs", "abs"], ["min", "min"], ["max", "max"]];
    const numbers = [["AC", "", "clear"], ["⌫", "", "backspace"], ["(", "("], [")", ")"], ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "/"], ["4", "4"], ["5", "5"], ["6", "6"], ["×", "*"], ["1", "1"], ["2", "2"], ["3", "3"], ["−", "-"], ["±", "-", "sign"], ["0", "0"], [".", "."], ["+", "+"], ["%", "%"], [",", ","]];
    for (const [id, keys] of [["calculator-functions", functions], ["calculator-numbers", numbers]]) for (const [label, value, kind] of keys) {
      const button = text("button", label);
      button.type = "button";
      button.className = kind === "clear" ? "calculator-clear" : ["÷", "×", "−", "+"].includes(label) ? "calculator-operator" : "";
      button.dataset.key = label;
      button.setAttribute("aria-label", { "⌫": "删除前一个字符", "AC": "清空表达式", "√": "平方根", "x²": "平方", "xʸ": "幂", "±": "负号", "%": "百分号", ",": "函数参数分隔符" }[label] ?? label);
      button.onclick = () => insert2(value, kind ?? (id === "calculator-functions" ? "function" : "text"));
      $(id).append(button);
    }
  }
  $("import").onclick = async () => {
    try {
      const file = await openFile({ extensions: ["txt", "csv", "tsv", "json"], signal });
      if (!file) return;
      if (file.blob.size > 2 * 1048576) throw new Error("输入最多 2 MiB。");
      $("input").value = await file.blob.text();
      status("已导入，点击处理查看结果。");
    } catch (error) {
      status(error.message, true);
    }
  };
  $("copy").onclick = async () => {
    try {
      await copyText(result);
      status("结果已复制。");
    } catch (error) {
      status(error.message, true);
    }
  };
  $("save").onclick = async () => {
    try {
      status(await saveFile(mode === "data.convert" ? $("direction").value === "csv" ? "converted.json" : "converted.csv" : "result.txt", new Blob([result], { type: "text/plain;charset=utf-8" }), { signal }) ? "文件已保存。" : "已取消保存。");
    } catch (error) {
      status(error.message, true);
    }
  };
  $("input-panel").hidden = !["text.replace", "data.convert"].includes(mode);
  $("import").hidden = $("input-panel").hidden;
  if (mode === "unit.convert") units();
  renderHistory();
  update();
  return () => {
    disposed = true;
    controller?.abort();
  };
}
export {
  mount
};
