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

// src-tauri/builtin-tools/src/imagesearch.js
var SITES = [["sogou", "搜狗图片", "https://pic.sogou.com/"], ["baidu", "百度识图", "https://image.baidu.com/"], ["so", "360 识图", "https://st.so.com/"], ["google", "Google 图片", "https://images.google.com/"], ["yandex", "Yandex 图片", "https://yandex.com/images"], ["tineye", "TinEye", "https://www.tineye.com/"], ["trace", "trace.moe", "https://trace.moe/"], ["iqdb", "IQDB", "https://iqdb.org/"], ["saucenao", "SauceNAO", "https://saucenao.com/"]];
function mount({ openWebsite, copyText, signal }) {
  let busy = false;
  for (const [id, name, url] of SITES) {
    $(id).onclick = async () => {
      if (busy) return;
      busy = true;
      SITES.forEach(([key]) => $(key).disabled = true);
      try {
        await openWebsite(url, { title: name });
        if (!signal.aborted) status("已打开" + name + "。");
      } catch (e) {
        if (!signal.aborted) status(e.message || "无法打开网页，可复制链接后在浏览器访问。", true);
      } finally {
        if (!signal.aborted) {
          busy = false;
          SITES.forEach(([key]) => $(key).disabled = false);
        }
      }
    };
    copyButton("copy-" + id, () => url, copyText);
  }
}
export {
  mount
};
