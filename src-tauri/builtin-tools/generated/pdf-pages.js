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
function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1048576).toFixed(2)} MiB`;
}

// src-tauri/builtin-tools/src/pdf-pages.js
function mount({ files, resources, tasks, signal }) {
  let file = null, pages = [], result = null, controller, busy = false, disposed = false, previewUrl = "", urls = [];
  const update = () => {
    for (const el of document.querySelectorAll("button,input,select")) el.disabled = busy || el.dataset.boundary === "true";
    $("unlock").disabled = busy || !file;
    $("process").disabled = busy || !pages.some((item) => item.selected);
    $("save").disabled = busy || !result;
    $("cancel").hidden = !busy;
    $("cancel").disabled = false;
  };
  const invalidate = () => {
    const old = result;
    result = null;
    void old?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    $("result").hidden = true;
    update();
  };
  function render() {
    $("pages").replaceChildren(...pages.map((item, index) => {
      const row = text("article", "", "card"), label = document.createElement("label"), checkbox = document.createElement("input");
      label.className = "check";
      checkbox.type = "checkbox";
      checkbox.checked = item.selected;
      checkbox.onchange = () => {
        item.selected = checkbox.checked;
        invalidate();
      };
      label.append(checkbox, document.createTextNode(`原第 ${item.index + 1} 页 → 位置 ${index + 1}`));
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = `第 ${item.index + 1} 页缩略图`;
      image.style.cssText = `display:block;max-width:160px;height:160px;object-fit:contain;margin:8px auto;transform:rotate(${item.rotate}deg)`;
      row.append(label, image);
      const rotation = document.createElement("select");
      for (const degree of [0, 90, 180, 270]) {
        const option = document.createElement("option");
        option.value = String(degree);
        option.textContent = "旋转 " + degree + "°";
        rotation.append(option);
      }
      rotation.value = String(item.rotate);
      rotation.onchange = () => {
        item.rotate = Number(rotation.value);
        invalidate();
        render();
      };
      row.append(rotation);
      const actions = text("div", "", "actions");
      for (const [title, delta] of [["上移", -1], ["下移", 1], ["移除", 0]]) {
        const button = text("button", title);
        button.dataset.boundary = String(delta < 0 && index === 0 || delta > 0 && index === pages.length - 1);
        button.onclick = () => {
          if (delta) [pages[index], pages[index + delta]] = [pages[index + delta], pages[index]];
          else pages.splice(index, 1);
          invalidate();
          render();
        };
        actions.append(button);
      }
      row.append(actions);
      return row;
    }));
    update();
  }
  async function job(work) {
    if (busy || disposed) return;
    busy = true;
    controller = new AbortController();
    const abort = () => controller?.abort();
    signal.addEventListener("abort", abort, { once: true });
    update();
    try {
      await work(controller.signal);
    } catch (error) {
      status(error.name === "AbortError" ? "已取消，可重新操作。" : error.message, true);
    } finally {
      signal.removeEventListener("abort", abort);
      controller = null;
      busy = false;
      if (!disposed) {
        update();
        render();
      }
    }
  }
  const clearPages = () => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    pages = [];
    invalidate();
    render();
  };
  async function readPages(current) {
    clearPages();
    const items = await tasks.run("读取 PDF 页面", async (context) => {
      status("正在读取 PDF 并生成缩略图…");
      const engine = await import(await resources.url("engine/pdf-engine.js", { signal: context.signal }));
      return engine.inspectPages(file, context, resources, $("password").value);
    }, { signal: current, timeoutMs: 6e5 });
    current.throwIfAborted();
    pages = items.map((item) => {
      const url = URL.createObjectURL(new Blob([item.preview], { type: "image/png" }));
      urls.push(url);
      return { ...item, url, selected: true, rotate: 0 };
    });
    $("source-info").textContent = `${file.name} · ${pages.length} 页 · ${size(file.size)}`;
    render();
    status("勾选页面，调整顺序和角度后导出。");
  }
  $("choose").onclick = () => void job(async (current) => {
    const next = await files.open({ extensions: ["pdf"], signal: current });
    if (!next) return;
    await file?.close();
    file = next;
    clearPages();
    $("source-info").textContent = `${file.name} · ${size(file.size)}`;
    await readPages(current);
  });
  $("unlock").onclick = () => void job(readPages);
  $("password").oninput = () => {
    clearPages();
    status("密码已更新，请重新读取页面。");
  };
  $("all").onclick = () => {
    pages.forEach((item) => item.selected = true);
    invalidate();
    render();
  };
  $("none").onclick = () => {
    pages.forEach((item) => item.selected = false);
    invalidate();
    render();
  };
  $("sort").onclick = () => {
    pages.sort((a, b) => a.index - b.index);
    invalidate();
    render();
  };
  $("split").onchange = invalidate;
  $("process").onclick = () => void job(async (current) => {
    const chosen = pages.filter((item) => item.selected).map(({ index, rotate }) => ({ index, rotate })), writer = await files.createWriter($("split").checked ? "split-pages.zip" : "edited-pages.pdf");
    invalidate();
    try {
      const output = await tasks.run("导出 PDF 页面", async (context) => {
        const engine = await import(await resources.url("engine/pdf-engine.js", { signal: context.signal }));
        const result2 = await engine.exportPages(file, chosen, $("split").checked, context, resources, writer, $("password").value);
        if (result2.bytes) await writer.write(result2.bytes, { signal: context.signal });
        return result2;
      }, { signal: current, timeoutMs: 6e5 });
      result = writer;
      previewUrl = URL.createObjectURL(new Blob([output.preview], { type: "image/png" }));
      $("preview-image").src = previewUrl;
      $("result").hidden = false;
      $("result-info").textContent = `${output.pages} 页 · ${size(writer.bytesWritten)}`;
      status("已导出选中页面，可以保存。");
    } catch (error) {
      await writer.abort();
      throw error;
    }
  });
  $("save").onclick = () => void job(async (current) => {
    if (result && await result.save({ signal: current })) {
      result = null;
      status("文件已保存。");
    } else status("已取消保存。");
  });
  $("cancel").onclick = () => controller?.abort();
  update();
  return () => {
    disposed = true;
    controller?.abort();
    void file?.close();
    invalidate();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
}
export {
  mount
};
