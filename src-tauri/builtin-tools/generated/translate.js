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

// src-tauri/builtin-tools/src/translate.js
var translationSites = [
  ["百度翻译", "https://fanyi.baidu.com/", "百度翻译网站入口。"],
  ["有道翻译", "https://fanyi.youdao.com/", "有道翻译网站入口。"],
  ["谷歌翻译", "https://translate.google.com/", "Google Translate 网站入口。"],
  ["搜狗翻译", "https://fanyi.sogou.com/", "搜狗翻译网站入口。"],
  ["DeepL", "https://www.deepl.com/", "DeepL 翻译网站入口。"],
  ["必应翻译", "https://www.bing.com/translator", "Microsoft Translator 网站入口。"]
];
function mount({ openWebsite, copyText, signal }) {
  let busy = false, disposed = false;
  const buttons = [];
  $("sites").replaceChildren(...translationSites.map(([name, url, hint]) => {
    const item = text("article", ""), actions = text("div", "", "actions"), open = text("button", "打开 " + name, "primary"), copy = text("button", "复制入口链接");
    buttons.push(open);
    item.append(text("h2", name), text("p", hint, "hint"), actions);
    actions.append(open, copy);
    open.onclick = async () => {
      if (busy || disposed || signal.aborted) return;
      busy = true;
      buttons.forEach((button) => button.disabled = true);
      try {
        await openWebsite(url, { title: name });
        if (!signal.aborted && !disposed) status("已打开 " + name + "，请在网站内进行翻译。");
      } catch (error) {
        if (!signal.aborted && !disposed) status(error.message || "无法打开，可复制入口链接后在浏览器访问。", true);
      } finally {
        busy = false;
        if (!disposed && !signal.aborted) buttons.forEach((button) => button.disabled = false);
      }
    };
    copy.onclick = async () => {
      if (disposed || signal.aborted) return;
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
  mount,
  translationSites
};
