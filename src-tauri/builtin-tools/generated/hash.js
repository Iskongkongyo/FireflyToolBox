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
function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1048576).toFixed(2)} MiB`;
}
function operation(signal) {
  let controller;
  return { start() {
    controller?.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    return controller.signal;
  }, cancel() {
    controller?.abort();
  }, dispose() {
    controller?.abort();
  } };
}

// src-tauri/builtin-tools/src/hash.js
function mount({ hashFile, copyText, signal }) {
  const op = operation(signal);
  let result;
  function verify() {
    if (!result) return;
    const expected = $("expected").value.replace(/\s+/g, "").toLowerCase();
    const match = expected === result.digest.toLowerCase();
    $("verification").textContent = !expected ? "填写预期摘要后可自动核对。" : !new RegExp(`^[0-9a-f]{${result.digest.length}}$`).test(expected) ? `预期摘要应为 ${result.digest.length} 位十六进制字符。` : match ? "校验通过：两个摘要一致。" : "校验未通过：两个摘要不同。";
    $("verification").classList.toggle("error", !!expected && !match);
  }
  $("expected").oninput = verify;
  $("cancel").onclick = () => op.cancel();
  $("choose").onclick = async () => {
    const job = op.start();
    result = null;
    $("results").hidden = true;
    $("choose").disabled = true;
    $("algorithm").disabled = true;
    $("cancel").hidden = false;
    $("progress").hidden = false;
    $("progress").value = 0;
    status("请选择文件…");
    try {
      const value = await hashFile({ algorithm: $("algorithm").value, signal: job, onProgress: ({ processed, total }) => {
        if (total) {
          $("progress").max = total;
          $("progress").value = processed;
        }
        status(total ? `已处理 ${size(processed)} / ${size(total)}（${Math.floor(processed / total * 100)}%）` : `已处理 ${size(processed)}`);
      } });
      if (!value) {
        status("已取消文件选择。");
        return;
      }
      result = value;
      $("digest").value = value.digest;
      $("info").replaceChildren();
      for (const [name, value2] of [["文件", result.name], ["大小", size(result.size)], ["算法", result.algorithm.toUpperCase()]]) $("info").append(text("dt", name), text("dd", value2));
      $("results").hidden = false;
      verify();
      status("计算完成。");
    } catch (error) {
      status(error.name === "AbortError" ? "计算已取消。" : error.message || String(error), true);
    } finally {
      $("choose").disabled = false;
      $("algorithm").disabled = false;
      $("cancel").hidden = true;
      $("progress").hidden = true;
    }
  };
  copyButton("copy", () => $("digest").value, copyText);
  return () => op.dispose();
}
export {
  mount
};
