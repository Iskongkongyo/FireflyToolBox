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

// src-tauri/builtin-tools/src/life.js
function loadState(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// src-tauri/builtin-tools/src/utility.js
var TEXT_LIMIT = 1024 * 1024;
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("工具存储空间不足，当前修改尚未保存。请先导出或缩短内容。");
  }
}

// src-tauri/builtin-tools/src/random-data.js
function randomSource() {
  let buffer = new Uint32Array(512), index = buffer.length;
  return () => {
    if (index + 1 >= buffer.length) {
      crypto.getRandomValues(buffer);
      index = 0;
    }
    return BigInt(buffer[index++]) << 32n | BigInt(buffer[index++]);
  };
}
function randomBelow(bound, next = randomSource()) {
  if (bound < 1n || bound > 1n << 64n) throw new Error("随机范围无效。");
  if (bound === 1n) return 0n;
  const total = 1n << 64n, limit = total - total % bound;
  let value;
  do {
    value = next();
  } while (value >= limit);
  return value % bound;
}

// src-tauri/builtin-tools/src/palettes-data.js
var PALETTE_CATEGORIES = ["全部", "清新", "柔和", "自然", "复古", "商务", "暗色", "活力", "经典"];
var rows = [
  ["薄荷晨光", "清新", "绿 白 青", "EAF4EB CDE8D3 A9D4BD 70AE98 2F6B5E"],
  ["海盐苏打", "清新", "蓝 青 白", "F3FAFC D2EDF1 A2D3E2 64ACC3 276D88"],
  ["晴空云朵", "清新", "蓝 白", "F8FBFF E1EFFA B4D3ED 7BA8CF 426E9A"],
  ["青柠冰茶", "清新", "绿 黄", "F5F8E8 E3EDBD C4D982 93B75B 587F3E"],
  ["雨后薄荷", "清新", "绿 青", "F0F7F4 D2E7DD A8CEBE 70AD98 377864"],
  ["蓝莓酸奶", "清新", "紫 蓝 白", "F7F5FB E5DFF3 C9B9E5 9983C6 655092"],
  ["春日柚子", "清新", "黄 橙", "FFFBED FCEAC5 F7CE91 ECA963 C7783D"],
  ["浅海泡沫", "清新", "青 蓝", "F0FAF9 D1EDE9 9CCFCB 62A9A8 2C757C"],
  ["奶油杏桃", "柔和", "橙 粉 米", "FFF8EE FBE4CF F4CAB0 E8A48F BD756A"],
  ["樱花奶茶", "柔和", "粉 米 白", "FFF8F7 F4E3E5 E4C5CC C99DAD 986D86"],
  ["雾粉玫瑰", "柔和", "粉 红", "FCF6F7 EFDBE0 DBB8C5 BD8AA1 8D5A76"],
  ["薰衣草梦", "柔和", "紫 粉", "FAF7FC ECE0F3 D3BCDF B293C3 85679D"],
  ["柔雾天空", "柔和", "蓝 灰", "F7FAFC E5EDF3 C7D8E7 A1BED4 7597B4"],
  ["燕麦暖白", "柔和", "米 棕", "FCFAF5 F1EBDD E2D7C2 CBB895 9D8766"],
  ["蜜桃云霞", "柔和", "粉 橙 黄", "FFF6EC F7DECF EDBBC0 D897AB A77394"],
  ["柔黄月光", "柔和", "黄 米", "FFFDEC F7F0CF E6DEAA C6BE80 958C53"],
  ["森林苔径", "自然", "绿 棕", "F1F4E9 CBD5B5 9AAA7B 6B8057 3E583F"],
  ["山间溪流", "自然", "绿 蓝", "EAF1EB BFD2CB 8BADAB 577B83 304B5A"],
  ["秋日麦田", "自然", "黄 棕", "F7F0DE E6D7AA C8AC73 A2814C 715936"],
  ["沙漠绿洲", "自然", "米 绿", "F3EADA D8C6A0 A7B38E 688D78 355E54"],
  ["松林晨雾", "自然", "灰 绿", "EDF1EB CDD7C9 A3B39D 748C70 4A654D"],
  ["海岸岩石", "自然", "蓝 灰 米", "ECECE6 C9D3D3 98B1B7 668693 415B6E"],
  ["落日山谷", "自然", "橙 棕 绿", "F5E8D7 DFBE96 C78D65 98745C 566554"],
  ["秋叶火光", "自然", "红 橙 黄", "FFF1D6 E7C17E D39755 B65F3E 783F32"],
  ["胶片咖啡", "复古", "棕 米", "EFE6D5 CDBA96 A78E6C 80674F 503D32"],
  ["旧书墨绿", "复古", "绿 黄 棕", "EFE6CC D2C18C 9FA574 667A57 394F40"],
  ["复古海报", "复古", "红 蓝 黄", "F4E7C8 D7AE61 BF6351 577B8C 2D4D62"],
  ["砖红留声", "复古", "红 棕 米", "F3E7D6 D8BBA0 BD8D74 A55E4F 703C35"],
  ["暮色酒红", "复古", "红 紫", "EFE4E2 D3B6BA B28391 8B536A 5B304C"],
  ["青蓝瓷器", "复古", "蓝 白", "F1F1E8 CFDAD3 98B4B1 618D94 315E72"],
  ["芥末与墨", "复古", "黄 黑", "F0E8CE CDBC78 AA934D 64664B 303D3C"],
  ["铜绿时代", "复古", "绿 橙", "EEE8D9 CDBD9D A18865 728E7F 3B685D"],
  ["沉稳海军", "商务", "蓝 灰", "F5F7FA DCE4EE AFBFD3 718BAA 294363"],
  ["石墨蓝灰", "商务", "灰 蓝", "F4F5F7 DDDFe4 B3BCC9 7F8EA3 42556F"],
  ["现代青绿", "商务", "青 绿", "F3F8F7 D4E5E0 A3C9BC 5D9E8B 266A59"],
  ["靛蓝白纸", "商务", "蓝 白", "F8F9FD E2E6F3 B8C5E5 758FC1 3F5D97"],
  ["暖灰商务", "商务", "灰 米", "FAF9F6 E6E1D9 C7BEB1 9C9080 675D50"],
  ["科技钴蓝", "商务", "蓝 青", "F0F5FD CBDDF6 8EB4EA 4E8AD4 205DA7"],
  ["铜金深蓝", "商务", "蓝 金", "F5F1E8 DAC8A2 BAA072 6E8296 253D57"],
  ["黑白简约", "商务", "黑 白 灰", "FAFAFA E2E5E8 B0B6BF 66707D 242D38"],
  ["夜航灯火", "暗色", "蓝 黄", "111B2B 23334A 405C79 81B5D5 F1C77F"],
  ["深夜森林", "暗色", "绿 黑", "10241F 1C3A30 2D5C49 69A88A C5DDAA"],
  ["紫夜霓虹", "暗色", "紫 粉", "18152B 31254D 594078 9C70B5 ECA4CA"],
  ["煤黑与橙", "暗色", "黑 橙", "191B1F 333740 5C646E B57B47 F1AA61"],
  ["深海星光", "暗色", "蓝 青", "102435 1C4054 2F6A7A 6FB0BC B7DCDC"],
  ["酒红暗夜", "暗色", "红 紫", "241726 432B40 754A60 B37885 E5B5B3"],
  ["暗色科技", "暗色", "蓝 绿", "101821 243443 476079 83A7BE 95D5BB"],
  ["黑金夜色", "暗色", "黑 金", "191916 33332B 64604A A99B6C E2D39A"],
  ["夏日果汁", "活力", "橙 黄 绿", "FFF2B8 F7C65B F39442 DC6543 538F62"],
  ["珊瑚海浪", "活力", "红 青", "FFF0DE F1BD95 E98978 4DA5A7 296E86"],
  ["蓝橙撞色", "活力", "蓝 橙", "F4F8FD 8CB5E0 3E7FC0 F1B66B DE7D3B"],
  ["莓果气泡", "活力", "粉 紫 黄", "FDF0E3 F4BBAC DF7E95 A45C93 6A4D87"],
  ["草莓抹茶", "活力", "红 绿", "FFF6D9 C9DCA2 83B27B EB9B90 D46865"],
  ["柠檬蓝莓", "活力", "黄 蓝", "FFF4A7 E9CE57 9FB8E1 627CC0 374881"],
  ["日落派对", "活力", "橙 粉 紫", "FFF1BF F5BD77 EC8A79 BB678B 795080"],
  ["清爽运动", "活力", "蓝 绿", "EDF8F5 A7DCCB 44AD94 3A7DAB 225076"],
  ["黑白灰阶", "经典", "黑 白 灰", "FFFFFF E6E6E6 B3B3B3 666666 222222"],
  ["蓝白经典", "经典", "蓝 白", "FFFFFF EAF0F7 C4D3E5 6B90BE 224D80"],
  ["红白经典", "经典", "红 白", "FFFFFF F8E9E7 EAB8B2 CB6B61 963B35"],
  ["自然土色", "经典", "棕 米", "F8F4E8 E6D8B7 C5AF82 99805C 655438"],
  ["绿金经典", "经典", "绿 金", "F7F4E6 E3D4A4 BAA26C 5C7A5C 285844"],
  ["粉蓝搭配", "经典", "粉 蓝", "F9F5F7 E8CCD5 C9C9E0 99AFD0 5D7CA8"],
  ["互补紫黄", "经典", "紫 黄", "FBF5D6 E7D793 B9A4CF 876AA8 544169"],
  ["冷暖平衡", "经典", "蓝 橙 灰", "F7F1E7 D6C5B0 C39477 779CAC 3F687E"]
];
var PALETTES = rows.map(([name, category, tags, colors], index) => ({ id: "palette-" + index, name, category, tags: tags.split(" "), colors: colors.toUpperCase().split(" ").map((c) => "#" + c) }));
function contrastColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("颜色格式无效。");
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#FFFFFF";
}
function filterPalettes(query, category = "全部") {
  const words = String(query).trim().toLowerCase().replace(/([红粉白黄蓝紫橙绿黑棕灰])色/g, "$1").split(/\s+/).filter(Boolean);
  return PALETTES.filter((p) => (category === "全部" || p.category === category) && words.every((w) => [p.name, p.category, ...p.tags, ...p.colors].join(" ").toLowerCase().includes(w)));
}
function paletteCSS(p) {
  return ":root {\n" + p.colors.map((c, i) => `  --color-${i + 1}: ${c};`).join("\n") + "\n}";
}
function paletteSVG(p) {
  if (p.colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) throw new Error("配色数据无效。");
  const name = p.name.replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600" viewBox="0 0 1500 600"><rect width="1500" height="600" fill="#fff"/><text x="40" y="65" font-family="sans-serif" font-size="32" fill="#222">${name}</text>${p.colors.map((c, i) => `<rect x="${i * 300}" y="100" width="300" height="500" fill="${c}"/><text x="${i * 300 + 150}" y="550" text-anchor="middle" font-family="monospace" font-size="26" fill="${contrastColor(c)}">${c}</text>`).join("")}</svg>`;
}

// src-tauri/builtin-tools/src/palettes.js
function mount({ copyText, saveFile, signal }) {
  let category = "全部", shown = [], favorites = new Set((loadState("palette.favorites", []) || []).filter?.((id) => PALETTES.some((p) => p.id === id)) || []), saving = false;
  const copy = async (value) => {
    try {
      await copyText(value);
      if (!signal.aborted) status("已复制。");
    } catch (e) {
      if (!signal.aborted) status(e.message, true);
    }
  };
  function render() {
    [...$("categories").children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === category)));
    shown = filterPalettes($("search").value, category).filter((p) => !$("favorites-only").checked || favorites.has(p.id));
    $("palettes").replaceChildren();
    for (const p of shown) {
      const card = text("article", "", "card palette-card");
      card.id = p.id;
      const head = text("div", "", "palette-heading"), h = text("h2", p.name), fav = text("button", favorites.has(p.id) ? "★" : "☆", "palette-favorite");
      fav.setAttribute("aria-label", (favorites.has(p.id) ? "取消收藏：" : "收藏：") + p.name);
      fav.setAttribute("aria-pressed", String(favorites.has(p.id)));
      fav.onclick = () => {
        try {
          const next = new Set(favorites);
          next.has(p.id) ? next.delete(p.id) : next.add(p.id);
          persist("palette.favorites", [...next]);
          favorites = next;
          render();
        } catch (e) {
          status(e.message, true);
        }
      };
      head.append(h, fav);
      const swatches = text("div", "", "palette-swatches");
      for (const hex of p.colors) {
        const b = text("button", hex);
        b.style.backgroundColor = hex;
        b.style.color = contrastColor(hex);
        b.setAttribute("aria-label", "复制颜色 " + hex);
        b.onclick = () => void copy(hex);
        swatches.append(b);
      }
      const actions = text("div", "", "actions");
      for (const [label, value] of [["复制 HEX", p.colors.join(", ")], ["复制 CSS", paletteCSS(p)]]) {
        const b = text("button", label);
        b.onclick = () => void copy(value);
        actions.append(b);
      }
      const save = text("button", "保存 SVG");
      save.onclick = async () => {
        if (saving) return;
        saving = true;
        save.disabled = true;
        try {
          status(await saveFile(`${p.name}-配色.svg`, new Blob([paletteSVG(p)], { type: "image/svg+xml;charset=utf-8" }), { signal }) ? "配色 SVG 已保存。" : "已取消保存。");
        } catch (e) {
          if (!signal.aborted) status(e.message, true);
        } finally {
          saving = false;
          if (!signal.aborted) save.disabled = false;
        }
      };
      actions.append(save);
      card.append(head, text("p", p.category + " · " + p.tags.join(" / "), "hint"), swatches, actions);
      $("palettes").append(card);
    }
    $("count").textContent = `${shown.length} 组配色`;
    $("empty").hidden = !!shown.length;
    $("random").disabled = !shown.length;
  }
  for (const value of PALETTE_CATEGORIES) {
    const b = text("button", value);
    b.onclick = () => {
      category = value;
      render();
    };
    $("categories").append(b);
  }
  $("search").oninput = render;
  $("favorites-only").onchange = render;
  $("random").onclick = () => {
    if (!shown.length) return;
    const p = shown[Number(randomBelow(BigInt(shown.length)))], card = $(p.id);
    document.querySelectorAll(".palette-card.selected").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    status("推荐：" + p.name);
  };
  render();
}
export {
  mount
};
