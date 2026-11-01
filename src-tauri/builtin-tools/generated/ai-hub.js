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

// src-tauri/builtin-tools/src/life.js
async function jsonRequest(request, url, signal) {
  const response = await request(url, { signal });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}，请稍后重试。`);
  try {
    return await response.json();
  } catch {
    throw new Error("来源返回了无法解析的数据，请稍后重试。");
  }
}

// src-tauri/builtin-tools/src/ai-data.js
function publicPrompts(payload) {
  if (!Array.isArray(payload?.prompts)) throw new Error("提示词接口格式已变化。");
  return payload.prompts.slice(0, 24).map((item) => ({ name: String(item.title ?? "").slice(0, 150), content: String(item.content ?? "").slice(0, 5e4), description: String(item.description ?? "").slice(0, 500), url: "https://prompts.chat/prompts/" + encodeURIComponent(String(item.id ?? "")), source: "prompts.chat · CC0" })).filter((item) => item.name && item.content);
}
function publicSkills(payload) {
  const rows = Array.isArray(payload?.skills) ? payload.skills : Array.isArray(payload) ? payload : [];
  if (!rows.length) throw new Error("未找到 Skills。");
  return rows.slice(0, 50).map((item) => {
    const id = item.id ?? "", valid = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(id);
    return { name: String(item.name ?? item.skillId ?? "").slice(0, 150), description: item.installs ? `安装次数：${item.installs}` : "官方技能目录", url: valid ? "https://skills.sh/" + id : typeof item.html_url === "string" && item.html_url.startsWith("https://github.com/openai/skills/tree/") ? item.html_url : "", source: valid ? String(item.source) : "OpenAI Skills" };
  }).filter((item) => item.name && item.url);
}
var navigation = [["AI工具集", "中文 AI 工具导航", "https://ai-bot.cn/"], ["Futurepedia", "AI 工具目录", "https://www.futurepedia.io/"], ["There’s An AI For That", "按任务检索 AI 工具", "https://theresanaiforthat.com/"], ["prompts.chat", "公开提示词与角色库", "https://prompts.chat/"], ["Skills.sh", "Agent Skills 目录", "https://skills.sh/"], ["OpenAI Skills", "官方技能源码，各技能分别授权", "https://github.com/openai/skills"], ["Anthropic Skills", "官方技能目录，需检查各目录许可", "https://github.com/anthropics/skills"]];

// src-tauri/builtin-tools/src/ai-hub.js
function mount({ request, copyText, openWebsite, signal }) {
  const op = operation(signal);
  let tab = "prompts", rows = [], busy = false, requestSequence = 0;
  const show = () => {
    $("list").replaceChildren();
    for (const row of rows) {
      const item = text("article", "", "card");
      item.append(text("h2", row.name), text("p", row.description ?? "", "hint"), text("p", row.source ?? "", "hint"));
      if (row.content) {
        const details = document.createElement("details"), summary = text("summary", "查看提示词"), body = text("pre", row.content);
        body.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto";
        details.append(summary, body);
        item.append(details);
      }
      const actions = text("div", "", "actions");
      if (row.content) {
        const copy = text("button", "复制提示词");
        copy.onclick = async () => {
          try {
            await copyText(row.content);
            status("提示词已复制。");
          } catch (error) {
            status(error.message, true);
          }
        };
        actions.append(copy);
      }
      if (row.url) {
        const open = text("button", "打开来源");
        open.onclick = async () => {
          try {
            await openWebsite(row.url, { title: row.name });
          } catch (error) {
            status(error.message, true);
          }
        };
        actions.append(open);
      }
      item.append(actions);
      $("list").append(item);
    }
  };
  async function load() {
    if (busy) return;
    if (tab === "navigation") {
      rows = navigation.map(([name, description, url]) => ({ name, description, url, source: "网站入口" }));
      show();
      $("refresh").disabled = false;
      status("选择网站，查看对应资源。");
      return;
    }
    busy = true;
    $("refresh").disabled = true;
    const current = op.start(), sequence = ++requestSequence;
    status("正在读取公开数据…");
    try {
      let fresh;
      if (tab === "prompts") fresh = publicPrompts(await jsonRequest(request, "https://prompts.chat/api/prompts?type=TEXT&perPage=24&sort=popular&page=1", current));
      else fresh = publicSkills(await jsonRequest(request, "https://api.github.com/repos/openai/skills/contents/skills/.curated", current));
      if (current.aborted || sequence !== requestSequence) return;
      rows = fresh;
      show();
      status(`已获取 ${rows.length} 条 · ${(/* @__PURE__ */ new Date()).toLocaleString()}`);
    } catch (error) {
      if (sequence === requestSequence) status(error.name === "AbortError" ? "已取消。" : "数据暂时无法获取：" + error.message, true);
    } finally {
      if (sequence === requestSequence) {
        busy = false;
        if (!signal.aborted) $("refresh").disabled = false;
      }
    }
  }
  for (const button of document.querySelectorAll("[data-tab]")) button.onclick = () => {
    requestSequence++;
    op.cancel();
    busy = false;
    tab = button.dataset.tab;
    rows = [];
    show();
    for (const node of document.querySelectorAll("[data-tab]")) node.classList.toggle("selected", node === button);
    void load();
  };
  $("refresh").onclick = () => void load();
  void load();
  return () => op.dispose();
}
export {
  mount
};
