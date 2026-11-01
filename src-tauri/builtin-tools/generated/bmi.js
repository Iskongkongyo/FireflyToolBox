// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
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

// src-tauri/builtin-tools/src/practical.js
var IMAGE_LIMIT = 64 * 1024 * 1024;
var BASE64_TEXT_LIMIT = 96 * 1024 * 1024;
function bmi(height, weight, unit = "kg") {
  const cm = Number(height), input = Number(weight);
  if (!String(height).trim() || !String(weight).trim() || !Number.isFinite(cm) || !Number.isFinite(input) || cm < 50 || cm > 250 || input <= 0 || input > (unit === "jin" ? 1e3 : 500)) throw new Error("请输入有效身高（50～250 cm）和体重（大于 0，最多 500 kg）。");
  if (!["kg", "jin"].includes(unit)) throw new Error("体重单位无效。");
  const kg = unit === "jin" ? input / 2 : input, square = (cm / 100) ** 2, value = kg / square;
  const category = value < 18.5 ? "体重偏低" : value < 24 ? "正常范围" : value < 28 ? "超重" : "肥胖";
  return { value, category, kg, lower: 18.5 * square, upper: 24 * square };
}

// src-tauri/builtin-tools/src/bmi.js
function mount({ copyText }) {
  let result = "";
  const invalidate = () => {
    result = "";
    $("results").hidden = true;
    $("copy").disabled = true;
    status("");
  };
  const calculate = () => {
    try {
      const data = bmi($("height").value, $("weight").value, $("unit").value);
      $("bmi-value").textContent = data.value.toFixed(2);
      $("category").textContent = data.category;
      const range = `该身高对应的正常体重范围：${data.lower.toFixed(1)} kg 至小于 ${data.upper.toFixed(1)} kg（约值）。`;
      $("range").textContent = range;
      result = `身高：${$("height").value} cm
体重：${data.kg} kg
BMI：${data.value.toFixed(2)}（${data.category}）
${range}
参考：中国成人标准；分类按未舍入值判定。`;
      $("results").hidden = false;
      $("copy").disabled = false;
      status("计算完成。");
    } catch (e) {
      invalidate();
      status(e.message, true);
    }
  };
  $("calculate").onclick = calculate;
  for (const id of ["height", "weight", "unit"]) {
    $(id).oninput = invalidate;
    $(id).onkeydown = (e) => {
      if (e.key === "Enter") calculate();
    };
  }
  $("clear").onclick = () => {
    $("height").value = "";
    $("weight").value = "";
    invalidate();
    $("height").focus();
  };
  copyButton("copy", () => result, copyText);
}
export {
  mount
};
