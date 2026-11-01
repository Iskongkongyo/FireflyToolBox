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

// src-tauri/builtin-tools/src/file-links.js
var sites = [
  ["Catbox", "https://catbox.moe/", "文件与图片托管，上传后获取文件地址。"],
  ["Litterbox", "https://litterbox.catbox.moe/", "Catbox 的临时文件托管，可在网站选择保存期限。"],
  ["Uguu", "https://uguu.se/", "临时文件分享，适合短时间传递文件。"],
  ["Postimages", "https://postimg.cc/", "图片上传，获取图片直链、分享页面或嵌入代码。"],
  ["Gofile", "https://gofile.io/", "多类型文件与文件夹分享，直链可用性以网站为准。"],
  ["ImgBB", "https://ibb.co/", "图片托管，上传后选择图片链接或嵌入代码。"]
];
function mount({ openWebsite, copyText, signal }) {
  let busy = false, disposed = false;
  const buttons = [];
  $("sites").replaceChildren(...sites.map(([name, url, hint]) => {
    const item = text("article", ""), actions = text("div", "", "actions"), open = text("button", "打开 " + name, "primary"), copy = text("button", "复制入口链接");
    buttons.push(open);
    item.append(text("h2", name), text("p", hint, "hint"), actions);
    actions.append(open, copy);
    open.onclick = async () => {
      if (busy || disposed) return;
      busy = true;
      buttons.forEach((button) => button.disabled = true);
      try {
        await openWebsite(url, { title: name + " 文件上传" });
        if (!signal.aborted && !disposed) status("已打开 " + name + "，请在网站内选择文件上传。");
      } catch (error) {
        if (!signal.aborted && !disposed) status(error.message || "无法打开，可复制入口链接后在浏览器访问。", true);
      } finally {
        busy = false;
        if (!disposed && !signal.aborted) buttons.forEach((button) => button.disabled = false);
      }
    };
    copy.onclick = async () => {
      try {
        await copyText(url);
        if (!disposed && !signal.aborted) status("已复制 " + name + " 入口链接。");
      } catch (error) {
        if (!disposed && !signal.aborted) status(error.message, true);
      }
    };
    return item;
  }));
  return () => {
    disposed = true;
  };
}
export {
  mount
};
