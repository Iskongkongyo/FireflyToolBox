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

// src-tauri/builtin-tools/src/flowers-data.js
var FLOWER_CATEGORIES = ["全部", "爱情", "友情", "亲情", "祝福", "纪念"];
var guide = (slug) => `https://www.plantsandflowersfoundationholland.org/en/flowerguide/${slug}/`;
var rows = [
  ["rose", "玫瑰", "月季 切花月季 rose", "爱情 友情 亲情", "爱与美；表达心意的经典花材", "红：热烈的爱；粉：欣赏与感谢；白：纯洁与新开始；黄：友谊与快乐", "春至秋，品种差异较大", "常 常 常 常", "常见切花品种全年供应，节日前价格可能上涨"],
  ["carnation", "康乃馨", "香石竹 carnation", "亲情 祝福", "关爱、敬意与感谢", "粉：感恩；红：爱与敬意；白：纯洁的心意", "春至秋", "常 常 常 常", "设施栽培切花全年常见，母亲节前建议预订"],
  ["lily", "百合", "lily", "爱情 亲情 祝福 纪念", "纯洁、祝福；中文语境常借“百年好合”表达婚礼祝愿", "白：纯洁与纪念；粉：温柔与祝福；橙：活力", "晚春至夏", "常 常 常 常", "设施栽培全年常见；花香和花粉因品种而异"],
  ["tulip", "郁金香", "tulip", "爱情 友情 祝福", "爱、优雅与新的开始", "红：爱情；粉：温柔；黄：明朗与快乐；白：纯洁", "春季", "常 少 少 常", "冬春更常见，反季节货源和价格需问花店"],
  ["gerbera", "非洲菊", "扶郎花 太阳花 gerbera", "友情 亲情 祝福", "快乐、朝气与积极的心意", "黄与橙：明朗；粉：温暖；红：热情；白：清新", "春至秋", "常 常 常 常", "温室切花通常全年供应"],
  ["sunflower", "向日葵", "sunflower", "友情 亲情 祝福", "阳光、力量与仰慕，适合鼓励对方", "黄：阳光与活力；橙红：温暖与热情", "夏至秋", "季 常 常 季", "夏秋盛季；反季节可有设施或调运花材"],
  ["peony", "芍药", "草本牡丹 peony", "爱情 祝福", "浪漫、幸福与美好祝愿", "粉：温柔浪漫；白：清雅；红：热烈", "晚春至初夏", "常 季 少 少", "鲜切花季节性明显，常见于春末初夏；不同产地可延长供应"],
  ["hydrangea", "绣球", "八仙花 hydrangea", "爱情 亲情 祝福", "感恩、团聚与丰盛的心意", "粉：浪漫；蓝：平静；白：清雅；紫：欣赏", "晚春至秋", "季 常 常 季", "春夏秋更常见，反季节通常需确认或预订"],
  ["lisianthus", "洋桔梗", "草原龙胆 lisianthus", "爱情 友情 亲情", "欣赏、感谢与温柔的爱", "白：纯净；粉：温柔；紫：优雅；绿：清新", "夏至秋", "常 常 常 常", "温室切花全年常见，颜色品种依供应而定"],
  ["freesia", "小苍兰", "香雪兰 freesia", "友情 亲情 祝福", "信任、友谊与纯真", "白：清新；黄：快乐；紫：雅致", "春季", "常 少 季 常", "冬春更常见，其他季节可询问进口或设施花材"],
  ["ranunculus", "花毛茛", "洋牡丹 陆莲花 ranunculus", "爱情 友情 祝福", "魅力、欣赏与明媚心情", "粉：浪漫；橙黄：活泼；白：清雅", "春季", "常 少 季 常", "鲜切花常见于冬春，其他季节供应较少"],
  ["chrysanthemum", "菊花", "chrysanthemum", "亲情 祝福 纪念", "中文语境可寓长寿与高洁；白黄菊也常用于追思", "白黄：常用于纪念；粉紫：花艺装饰与祝愿，需留意当地习俗", "秋季为主", "常 常 常 常", "设施栽培全年常见；送礼用途需结合当地文化"],
  ["alstroemeria", "六出花", "秘鲁百合 水仙百合 alstroemeria", "友情 亲情 祝福", "友谊、陪伴与相互支持", "粉：温暖；黄橙：活力；白：清新", "晚春至夏秋", "常 常 常 常", "温室切花通常全年可供应"],
  ["anthurium", "红掌", "火鹤花 anthurium", "爱情 祝福", "热情、欢迎与祝愿", "红：热烈；粉：温柔；白绿：清雅", "温暖环境下可多季开花", "常 常 常 常", "温室花材与盆栽全年常见"],
  ["orchid", "蝴蝶兰", "兰花 phalaenopsis orchid", "亲情 祝福", "优雅、珍爱与美好祝愿，常用作节庆盆花", "粉：温柔；紫：优雅；白：清雅；黄：明朗", "多在冬春，栽培可调节", "常 常 常 常", "盆栽全年可供应，春节前品种通常更丰富"],
  ["calla", "马蹄莲", "海芋 calla zantedeschia", "爱情 祝福 纪念", "优雅与纯净，常用于婚礼或庄重花艺", "白：纯洁；粉紫：浪漫雅致；黄：明朗", "春至夏", "常 季 季 常", "白色品种较常见，彩色品种的季节和货源差异较大"],
  ["gypsophila", "满天星", "霞草 baby’s breath gypsophila", "爱情 友情 亲情", "陪伴、纯洁与细腻的心意，常作配花", "白：纯净；粉蓝等常为染色花材，颜色更多表达审美偏好", "晚春至夏", "常 常 常 常", "鲜切花与干花全年常见，选购时区分染色与天然色"],
  ["gladiolus", "剑兰", "唐菖蒲 gladiolus", "亲情 祝福", "敬意、力量与坚定", "红：热情；粉：温暖；白：清雅；紫：庄重", "夏至秋", "季 常 常 季", "春夏秋较常见，冬季货源依产地与设施栽培而定"],
  ["delphinium", "飞燕草", "翠雀 delphinium", "友情 祝福", "轻盈、保护与积极的祝愿", "蓝紫：宁静雅致；粉：温柔；白：清新", "晚春至夏", "常 常 季 季", "春夏较常见，其他季节可能需要预订"],
  ["iris", "鸢尾", "iris", "友情 祝福", "信念、希望与智慧", "蓝紫：信念与雅致；黄：明朗；白：纯净", "春至初夏", "常 季 少 季", "春季更常见，反季节品种和供应需确认"],
  ["lavender", "薰衣草", "lavender", "爱情 友情", "宁静、守候与柔和的心意", "紫：安静与浪漫，花色更多是品种差异", "夏季", "少 常 季 少", "鲜花季节性强；干花通常全年可购买"],
  ["lily-of-the-valley", "铃兰", "君影草 lily of the valley", "爱情 祝福", "幸福归来与纯洁的祝愿", "白：清雅与纯洁；少数品种为浅粉", "春季", "季 少 少 少", "鲜切花供应少且季节性明显，通常需要提前确认"],
  ["dahlia", "大丽花", "天竺牡丹 dahlia", "爱情 祝福", "优雅、力量与美好承诺", "红：热烈；粉：柔和；黄橙：明朗；白：清雅", "夏至秋", "少 常 常 少", "夏秋更常见；鲜切花依区域供应"],
  ["amaryllis", "朱顶红", "孤挺花 amaryllis hippeastrum", "亲情 祝福", "自信、力量与节庆祝福", "红：热情；白：清雅；粉：柔和", "春季，促成栽培可在冬季", "常 季 季 常", "冬春盆花和切花较常见，其他季节需确认"]
];
var FLOWERS = rows.map(([slug, name, aliases, categories, meaning, colors, bloom, seasons, supply]) => ({ id: slug, name, aliases, categories: categories.split(" "), meaning, colors, bloom, seasons: seasons.split(" "), supply, source: guide(slug) }));
function filterFlowers(query, category = "全部", season = "all") {
  const words = String(query).trim().toLocaleLowerCase().replace(/([红粉白黄蓝紫橙绿])色/g, "$1").split(/\s+/).filter(Boolean);
  return FLOWERS.filter((f) => (category === "全部" || f.categories.includes(category)) && (season === "all" || f.seasons[Number(season)] !== "少") && words.every((word) => [f.name, f.aliases, f.meaning, f.colors, f.bloom, f.supply, ...f.categories].join(" ").toLocaleLowerCase().includes(word)));
}
function flowerSummary(f) {
  return `${f.name}
常见寓意：${f.meaning}
颜色：${f.colors}
自然花期：${f.bloom}
供应参考：${f.supply}`;
}

// src-tauri/builtin-tools/src/flowers.js
function mount({ copyText }) {
  let category = "全部";
  for (const value of FLOWER_CATEGORIES) {
    const b = text("button", value);
    b.onclick = () => {
      category = value;
      render();
    };
    $("categories").append(b);
  }
  function render() {
    const values = filterFlowers($("search").value, category, $("season").value);
    $("flowers").replaceChildren();
    $("count").textContent = `找到 ${values.length} 种花卉`;
    $("empty").hidden = !!values.length;
    [...$("categories").children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === category)));
    for (const f of values) {
      const card = text("article", "", "card flower-card"), heading = text("div", "", "flower-heading"), symbol = text("span", f.name.slice(0, 1), "flower-symbol"), title = text("h2", f.name);
      heading.append(symbol, title);
      card.append(heading, text("p", f.categories.join(" · "), "hint"), text("p", f.meaning));
      const list = text("dl", "", "meta");
      for (const [k, v] of [["常见颜色", f.colors], ["自然花期", f.bloom], ["花店供应", f.supply]]) list.append(text("dt", k), text("dd", v));
      const seasons = text("div", "", "flower-seasons");
      f.seasons.forEach((v, i) => {
        const n = text("span", `${["春", "夏", "秋", "冬"][i]} · ${v === "常" ? "常见" : v === "季" ? "季节性" : "较少"}`);
        n.dataset.supply = v;
        seasons.append(n);
      });
      const copy = text("button", "复制花语", "mobile-full-row");
      copy.onclick = async () => {
        try {
          await copyText(flowerSummary(f));
          status(`已复制${f.name}的花语。`);
        } catch (e) {
          status(e.message, true);
        }
      };
      card.append(list, seasons, copy);
      $("flowers").append(card);
    }
  }
  $("search").oninput = render;
  $("season").onchange = render;
  render();
}
export {
  mount
};
