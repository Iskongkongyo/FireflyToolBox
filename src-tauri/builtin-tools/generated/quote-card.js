// src-tauri/builtin-tools/src/quote-card.js
var PROFILE_KEY = "quote_card.prefs.v1";
var FAV_KEY = "quote_card.favs.v1";
var RATIOS = [
  { id: "3-4", w: 1080, h: 1440, label: "3:4" },
  { id: "9-16", w: 1080, h: 1920, label: "9:16" },
  { id: "4-5", w: 1080, h: 1350, label: "4:5" }
];
var FONT_FAMILY = {
  song: '"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,"Times New Roman",serif',
  hei: '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif',
  kai: 'KaiTi,"STKaiti","Kaiti SC","LXGW WenKai",serif'
};
var NO_HEAD = "，。、；：？！）】》」』”’,.;:?!)]}%";
var NO_TAIL = "（【《「『“‘([{";
var LOCAL = {
  quote: [
    { text: "把日子过成一张白纸，也是一种本事。", author: "" },
    { text: "慢一点没关系，方向对就行。", author: "" },
    { text: "不是所有的雪都要落在山顶，落在屋檐上也算过冬。", author: "" },
    { text: "喜欢的反义词不是讨厌，是没空。", author: "" },
    { text: "你要允许自己有一段不发光的时期。", author: "" },
    { text: "真正的松弛，是知道最坏的结果也能接住。", author: "" },
    { text: "别急着证明自己，先把事情做完。", author: "" },
    { text: "一个人也可以是一支队伍。", author: "" },
    { text: "把话说慢一点，把事做快一点。", author: "" },
    { text: "情绪是天气，不是气候。", author: "" },
    { text: "与其等风来，不如把帆修好。", author: "" },
    { text: "你不是懒，你只是还没找到想做的事。", author: "" },
    { text: "所有的顺其自然，背后都是尽力之后。", author: "" },
    { text: "别用别人的尺子，量自己的日子。", author: "" },
    { text: "有些答案，要走过一段路才听得见。", author: "" },
    { text: "把复杂的事做简单是本事，把简单的事做久是运气。", author: "" },
    { text: "允许花只开一半。", author: "" },
    { text: "世界很大，但你的今天只有二十四小时。", author: "" },
    { text: "不必每件事都有意义，开心也算。", author: "" },
    { text: "长大就是学会自己给自己打气。", author: "" },
    { text: "认真生活的人，身上是有光的。", author: "" },
    { text: "今天没做完的，明天还等你。", author: "" },
    { text: "会累，说明在往上走。", author: "" },
    { text: "你不是在浪费时间，你是在等自己。", author: "" },
    { text: "把喜欢的事做成习惯，习惯会替你坚持。", author: "" },
    { text: "生活不会一直好，但可以一直往前。", author: "" }
  ],
  poem: [
    { text: "人生如逆旅，我亦是行人。", author: "苏轼《临江仙》" },
    { text: "长风破浪会有时，直挂云帆济沧海。", author: "李白《行路难》" },
    { text: "山重水复疑无路，柳暗花明又一村。", author: "陆游《游山西村》" },
    { text: "落霞与孤鹜齐飞，秋水共长天一色。", author: "王勃《滕王阁序》" },
    { text: "但愿人长久，千里共婵娟。", author: "苏轼《水调歌头》" },
    { text: "海内存知己，天涯若比邻。", author: "王勃《送杜少府之任蜀州》" },
    { text: "会当凌绝顶，一览众山小。", author: "杜甫《望岳》" },
    { text: "采菊东篱下，悠然见南山。", author: "陶渊明《饮酒》" },
    { text: "行到水穷处，坐看云起时。", author: "王维《终南别业》" },
    { text: "千磨万击还坚劲，任尔东西南北风。", author: "郑燮《竹石》" },
    { text: "莫愁前路无知己，天下谁人不识君。", author: "高适《别董大》" },
    { text: "春风得意马蹄疾，一日看尽长安花。", author: "孟郊《登科后》" },
    { text: "沉舟侧畔千帆过，病树前头万木春。", author: "刘禹锡《酬乐天扬州初逢席上见赠》" },
    { text: "众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。", author: "辛弃疾《青玉案·元夕》" },
    { text: "天生我材必有用，千金散尽还复来。", author: "李白《将进酒》" },
    { text: "不畏浮云遮望眼，自缘身在最高层。", author: "王安石《登飞来峰》" },
    { text: "一蓑烟雨任平生。", author: "苏轼《定风波》" },
    { text: "何当共剪西窗烛，却话巴山夜雨时。", author: "李商隐《夜雨寄北》" },
    { text: "江畔何人初见月？江月何年初照人？", author: "张若虚《春江花月夜》" },
    { text: "明月松间照，清泉石上流。", author: "王维《山居秋暝》" }
  ],
  joke: [
    { text: "我问冰箱：你冷吗？它说：我不冷，我只是有点冻人。", author: "" },
    { text: "手机电量剩 1% 的时候最诚实，它会告诉你谁才是它最想联系的人。", author: "" },
    { text: "闹钟的作用不是叫醒我，是通知我：又可以再睡五分钟了。", author: "" },
    { text: "我决定从明天开始减肥，因为明天永远是个好日子。", author: "" },
    { text: "蚊子为什么只咬我？因为我血型好，是 O 型自助餐。", author: "" },
    { text: "你最近在忙什么？忙着解释我最近在忙什么。", author: "" },
    { text: "钱包瘦了，人却胖了，这大概就是能量守恒。", author: "" },
    { text: "我妈说我房间像猪窝，我说猪哪有这么多书。", author: "" },
    { text: "领导说要有格局，于是我把辞职信写在了 A3 纸上。", author: "" },
    { text: "猫从不道歉，它只会换个姿势继续睡。", author: "" },
    { text: "我给植物取名「加油」，它还是死了，看来它不想加油。", author: "" },
    { text: "健身卡的有效期和我的决心一样，都是三个月。", author: "" },
    { text: "天气预报说今天有雨，于是我带了伞，结果雨在朋友圈下了。", author: "" },
    { text: "一个人吃饭叫孤独，两个人吃饭叫凑单。", author: "" },
    { text: "我的存款和我的头发一样，都在悄悄变少。", author: "" },
    { text: "电脑卡了可以重启，人卡了只能睡一觉。", author: "" },
    { text: "别人减肥是掉秤，我减肥是掉头发。", author: "" },
    { text: "小时候以为长大就能自己决定吃什么，长大后发现决定权交给了外卖。", author: "" },
    { text: "所谓成熟，就是学会了在群里发表情包代替说话。", author: "" },
    { text: "我家 Wi-Fi 比我更有存在感，一断网全家都慌了。", author: "" },
    { text: "拖延症唯一的好处是：你永远有事可做。", author: "" },
    { text: "我问镜子谁是世界上最好看的人，镜子碎了。", author: "" }
  ],
  soup: [
    { text: "你不是输在起跑线，你是根本没去起跑线。", author: "" },
    { text: "努力不一定成功，但不努力一定很舒服，只是舒服不了太久。", author: "" },
    { text: "别担心别人比你强，他们只是比你早开始。", author: "" },
    { text: "你觉得累，是因为在往上走，也可能是因为背了太多没用的东西。", author: "" },
    { text: "你不是没有天赋，你只是没有练。", author: "" },
    { text: "梦想还是要有的，万一实现了呢？但先交房租。", author: "" },
    { text: "你不是不想努力，你只是想让努力有点回报。", author: "" },
    { text: "成年人的崩溃是静音的，因为要面子，也因为话费。", author: "" },
    { text: "你的焦虑大部分来自：想得太多，做得太少，睡得不够。", author: "" },
    { text: "别人在偷偷努力，你在偷偷刷手机，然后你们都偷偷地长大了。", author: "" }
  ]
};
var SOURCES = [
  { id: "hitokoto", label: "每日一言", kind: "hitokoto", tag: "一言" },
  { id: "poem", label: "今日诗词", kind: "jinrishici", tag: "诗词" },
  { id: "joke", label: "冷笑话", kind: "local", cat: "joke", tag: "笑话" },
  { id: "du", label: "毒鸡汤", kind: "shadiao", path: "/du", tag: "毒汤" },
  { id: "chp", label: "彩虹屁", kind: "shadiao", path: "/chp", tag: "彩虹" },
  { id: "yan", label: "段子", kind: "btstu", tag: "段子" },
  { id: "quote", label: "金句", kind: "local", cat: "quote", tag: "金句" },
  { id: "guwen", label: "古诗文", kind: "local", cat: "poem", tag: "诗文" }
];
var HITOKOTO_CATS = [
  { id: "any", label: "全部" },
  { id: "d", label: "文学" },
  { id: "i", label: "诗词" },
  { id: "j", label: "网易云" },
  { id: "k", label: "哲学" },
  { id: "l", label: "抖机灵" }
];
var THEMES = [
  {
    id: "xuan",
    name: "宣纸",
    hint: "米色纸纹 · 朱印",
    swatch: "linear-gradient(145deg,#f8f2e7 0%,#e6dcc7 100%)",
    dot: "#8b7d66",
    ink: "#211e1a",
    sub: "#8b7d66",
    family: "song",
    weight: "400",
    lineHeight: 1.85,
    area: (W, H) => ({ x: 172, y: 300, w: W - 344, h: H - 660, align: "center", max: 92, valign: "center" }),
    bg(g, W, H) {
      g.fillStyle = "#f4eee3";
      g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W * 0.5, H * 0.44, H * 0.18, W * 0.5, H * 0.44, H * 0.8);
      rg.addColorStop(0, "rgba(255,253,248,0.9)");
      rg.addColorStop(1, "rgba(203,187,155,0.55)");
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.12);
      g.strokeStyle = "rgba(58,48,34,0.4)";
      g.lineWidth = 2;
      g.strokeRect(56, 56, W - 112, H - 112);
      g.strokeStyle = "rgba(58,48,34,0.16)";
      g.lineWidth = 1;
      g.strokeRect(74, 74, W - 148, H - 148);
    },
    decor(g, W, H, item) {
      seal(g, W - 162, H - 372, 84, item.cat);
      g.save();
      g.fillStyle = "rgba(96,78,54,0.62)";
      g.font = "23px " + FONT_FAMILY.song;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const chars = Array.from(item.cat || "一言");
      for (let i = 0; i < chars.length; i += 1) g.fillText(chars[i], 113, 176 + i * 38);
      g.restore();
    },
    meta: { y: (H) => H - 224, size: 30, align: "center", family: "song", color: "rgba(74,62,44,0.72)", dateSize: 22, dateGap: 54, dateColor: "rgba(74,62,44,0.42)" }
  },
  {
    id: "night",
    name: "夜幕",
    hint: "深蓝 · 星点",
    swatch: "linear-gradient(150deg,#0a1020,#18233c 55%,#2b3f66)",
    dot: "#7f8fb0",
    ink: "#eff4fc",
    sub: "#7f8fb0",
    family: "song",
    weight: "400",
    lineHeight: 1.9,
    area: (W, H) => ({ x: 156, y: 320, w: W - 312, h: H - 600, align: "center", max: 86, valign: "center" }),
    bg(g, W, H) {
      const lg = g.createLinearGradient(0, 0, W * 0.7, H);
      lg.addColorStop(0, "#090f1d");
      lg.addColorStop(0.55, "#121c31");
      lg.addColorStop(1, "#1d2942");
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W * 0.24, H * 0.14, 8, W * 0.24, H * 0.14, H * 0.9);
      rg.addColorStop(0, "rgba(88,136,220,0.32)");
      rg.addColorStop(1, "rgba(88,136,220,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 110; i += 1) {
        const x = RAND() * W;
        const y = RAND() * H * 0.8;
        const r = RAND() * 1.6 + 0.4;
        g.fillStyle = "rgba(214,232,255," + (RAND() * 0.45 + 0.12).toFixed(3) + ")";
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      const fade = g.createLinearGradient(0, H * 0.6, 0, H);
      fade.addColorStop(0, "rgba(6,10,20,0)");
      fade.addColorStop(1, "rgba(6,10,20,0.55)");
      g.fillStyle = fade;
      g.fillRect(0, 0, W, H);
    },
    decor(g, W, H, item, box) {
      g.save();
      g.fillStyle = "rgba(150,180,232,0.72)";
      g.font = "22px " + FONT_FAMILY.song;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText("/ " + (item.cat || "一言"), 156, 240);
      g.restore();
      if (box) {
        const h = Math.min(box.height, 300);
        const lg = g.createLinearGradient(0, box.top, 0, box.top + h);
        lg.addColorStop(0, "rgba(126,175,255,0.85)");
        lg.addColorStop(1, "rgba(126,175,255,0)");
        g.fillStyle = lg;
        g.fillRect(box.left - 46, box.top + 6, 3, h);
      }
    },
    meta: { y: (H) => H - 230, size: 29, align: "center", family: "song", color: "rgba(168,186,216,0.85)", dateSize: 21, dateGap: 50, dateColor: "rgba(140,158,190,0.5)" }
  },
  {
    id: "mist",
    name: "晨雾",
    hint: "莫兰迪绿 · 大引号",
    swatch: "linear-gradient(160deg,#f0f4ec,#d7e1d3)",
    dot: "#6f8177",
    ink: "#2b3a31",
    sub: "#6f8177",
    family: "hei",
    weight: "400",
    lineHeight: 1.95,
    area: (W, H) => ({ x: 150, y: 320, w: W - 300, h: H - 590, align: "left", max: 82, valign: "center" }),
    bg(g, W, H) {
      const lg = g.createLinearGradient(0, 0, W * 0.4, H);
      lg.addColorStop(0, "#eef3ea");
      lg.addColorStop(1, "#d6e0d1");
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W * 0.78, H * 0.16, 10, W * 0.78, H * 0.16, H * 0.62);
      rg.addColorStop(0, "rgba(255,255,255,0.85)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
      g.save();
      g.fillStyle = "rgba(43,58,49,0.07)";
      g.font = "520px " + FONT_FAMILY.song;
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText("“", 44, 90);
      g.restore();
      grain(g, W, H, 0.05);
    },
    decor(g, W, H, item) {
      g.save();
      g.fillStyle = "rgba(43,58,49,0.5)";
      g.font = "21px " + FONT_FAMILY.hei;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText(tracked(item.cat || "一言"), 150, 246);
      g.fillRect(150, 262, 46, 2);
      g.restore();
    },
    meta: { y: (H) => H - 226, size: 27, align: "left", family: "hei", color: "rgba(43,58,49,0.72)", dateSize: 21, dateGap: 48, dateColor: "rgba(43,58,49,0.4)" }
  },
  {
    id: "film",
    name: "胶片",
    hint: "暖橙 · 漏光",
    swatch: "linear-gradient(150deg,#f5bb85,#c25a34)",
    dot: "#f7d6bd",
    ink: "#fff7ec",
    sub: "#f4d2b8",
    family: "song",
    weight: "400",
    lineHeight: 1.9,
    area: (W, H) => ({ x: 140, y: 320, w: W - 280, h: H - 610, align: "center", max: 82, valign: "center" }),
    bg(g, W, H) {
      const lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, "#f7c696");
      lg.addColorStop(0.48, "#e08a58");
      lg.addColorStop(1, "#b4562f");
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);
      const leak = g.createRadialGradient(W * 0.14, H * 0.08, 10, W * 0.14, H * 0.08, H * 0.7);
      leak.addColorStop(0, "rgba(255,242,214,0.62)");
      leak.addColorStop(1, "rgba(255,242,214,0)");
      g.fillStyle = leak;
      g.fillRect(0, 0, W, H);
      const vig = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.3, W * 0.5, H * 0.5, H * 0.9);
      vig.addColorStop(0, "rgba(70,26,10,0)");
      vig.addColorStop(1, "rgba(70,26,10,0.34)");
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.16);
      g.strokeStyle = "rgba(255,246,232,0.32)";
      g.lineWidth = 1;
      g.strokeRect(40, 40, W - 80, H - 80);
    },
    decor(g, W, H, item) {
      g.save();
      g.fillStyle = "rgba(255,247,236,0.75)";
      g.font = "20px " + FONT_FAMILY.hei;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText(tracked((item.cat || "一言") + " · " + dateText()), 74, 104);
      g.restore();
    },
    meta: { y: (H) => H - 200, size: 28, align: "left", family: "song", color: "rgba(255,244,230,0.9)", dateSize: 20, dateGap: 44, dateColor: "rgba(255,238,220,0.6)", dateSuffix: "  KODAK 400" }
  },
  {
    id: "press",
    name: "报刊",
    hint: "白纸黑字 · 细线",
    swatch: "linear-gradient(145deg,#ffffff,#ecece6)",
    dot: "#4a4a45",
    ink: "#141414",
    sub: "#5f5f5f",
    family: "song",
    weight: "600",
    lineHeight: 1.55,
    area: (W, H) => ({ x: 128, y: 320, w: W - 256, h: H - 600, align: "left", max: 96, valign: "center" }),
    bg(g, W, H) {
      g.fillStyle = "#fbfbf7";
      g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.07);
      g.fillStyle = "#141414";
      g.fillRect(128, 132, W - 256, 3);
      g.fillRect(128, H - 132, W - 256, 3);
      g.fillStyle = "rgba(20,20,20,0.10)";
      g.fillRect(128, 148, W - 256, 1);
    },
    decor(g, W, H, item) {
      g.save();
      g.fillStyle = "#141414";
      g.font = "22px " + FONT_FAMILY.hei;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText(tracked(item.cat || "一言"), 128, 186);
      g.textAlign = "right";
      g.fillStyle = "rgba(20,20,20,0.55)";
      g.fillText(dateText(), W - 128, 186);
      g.restore();
    },
    meta: { y: (H) => H - 196, size: 27, align: "right", family: "song", color: "rgba(20,20,20,0.65)", dateSize: 20, dateGap: 46, dateColor: "rgba(20,20,20,0.35)", noDate: true }
  },
  {
    id: "neon",
    name: "霓虹",
    hint: "暗夜 · 荧光渐变",
    swatch: "linear-gradient(150deg,#06080d,#0d2a2a 60%,#241a3d)",
    dot: "#5cf2c8",
    ink: "#dffaf2",
    sub: "#6fe6cd",
    family: "hei",
    weight: "500",
    lineHeight: 1.85,
    area: (W, H) => ({ x: 128, y: 330, w: W - 256, h: H - 600, align: "left", max: 78, valign: "center" }),
    bg(g, W, H) {
      g.fillStyle = "#05070c";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(90,240,210,0.055)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x += 54) {
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, H);
      }
      for (let y = 0; y <= H; y += 54) {
        g.moveTo(0, y + 0.5);
        g.lineTo(W, y + 0.5);
      }
      g.stroke();
      const b1 = g.createRadialGradient(W * 0.78, H * 0.18, 10, W * 0.78, H * 0.18, H * 0.55);
      b1.addColorStop(0, "rgba(20,227,176,0.22)");
      b1.addColorStop(1, "rgba(20,227,176,0)");
      g.fillStyle = b1;
      g.fillRect(0, 0, W, H);
      const b2 = g.createRadialGradient(W * 0.15, H * 0.85, 10, W * 0.15, H * 0.85, H * 0.5);
      b2.addColorStop(0, "rgba(139,92,246,0.2)");
      b2.addColorStop(1, "rgba(139,92,246,0)");
      g.fillStyle = b2;
      g.fillRect(0, 0, W, H);
    },
    fill(g, lay) {
      const lg = g.createLinearGradient(0, lay.y, 0, lay.y + lay.h);
      lg.addColorStop(0, "#6bffd8");
      lg.addColorStop(0.55, "#7fc4ff");
      lg.addColorStop(1, "#c79bff");
      return lg;
    },
    glow: { color: "rgba(70,232,206,0.5)", blur: 38 },
    decor(g, W, H, item, box) {
      g.save();
      g.fillStyle = "rgba(126,240,216,0.75)";
      g.font = "22px " + FONT_FAMILY.hei;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText("// " + tracked(item.cat || "一言"), 128, 240);
      g.strokeStyle = "rgba(110,240,214,0.45)";
      g.lineWidth = 2;
      const m = 46;
      const l = 34;
      const corners = [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]];
      for (let i = 0; i < corners.length; i += 1) {
        const c = corners[i];
        g.beginPath();
        g.moveTo(c[0] + c[2] * l, c[1]);
        g.lineTo(c[0], c[1]);
        g.lineTo(c[0], c[1] + c[3] * l);
        g.stroke();
      }
      g.restore();
    },
    meta: { y: (H) => H - 220, size: 27, align: "left", family: "hei", color: "rgba(140,240,220,0.85)", dateSize: 20, dateGap: 46, dateColor: "rgba(120,210,200,0.45)" }
  }
];
var THEME_MAP = {};
for (let i = 0; i < THEMES.length; i += 1) THEME_MAP[THEMES[i].id] = THEMES[i];
var RAND = Math.random;
function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rad);
  g.lineTo(x + w, y + h - rad);
  g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  g.lineTo(x + rad, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rad);
  g.lineTo(x, y + rad);
  g.quadraticCurveTo(x, y, x + rad, y);
  g.closePath();
}
function tracked(str) {
  return Array.from(str).join(" ");
}
function dateText() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => n < 10 ? "0" + n : "" + n;
  return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate());
}
var grainTile = null;
function grain(g, W, H, alpha) {
  if (!grainTile) {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 160;
    const cx = c.getContext("2d");
    const img = cx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 30;
    }
    cx.putImageData(img, 0, 0);
    grainTile = c;
  }
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = "overlay";
  const pat = g.createPattern(grainTile, "repeat");
  if (pat) {
    g.fillStyle = pat;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}
function seal(g, x, y, size, label) {
  g.save();
  g.translate(x + size / 2, y + size / 2);
  g.rotate(-0.035);
  g.fillStyle = "#b23a2c";
  rr(g, -size / 2, -size / 2, size, size, 8);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 2;
  rr(g, -size / 2 + 7, -size / 2 + 7, size - 14, size - 14, 4);
  g.stroke();
  g.fillStyle = "rgba(255,252,246,0.95)";
  g.font = Math.round(size * 0.42) + "px " + FONT_FAMILY.song;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ch = Array.from(label || "言")[0];
  g.fillText(ch, 0, size * 0.03);
  g.restore();
}
function wrapText(g, text, maxW) {
  const chars = Array.from(text);
  const lines = [];
  let line = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    const next = line + ch;
    if (line && g.measureText(next).width > maxW) {
      if (NO_HEAD.indexOf(ch) >= 0 && line.length > 1) {
        const moved = line.slice(-1);
        lines.push(line.slice(0, -1));
        line = moved + ch;
      } else if (NO_TAIL.indexOf(line.slice(-1)) >= 0 && line.length > 1) {
        const moved = line.slice(-1);
        lines.push(line.slice(0, -1));
        line = moved + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function splitColumns(text, rows) {
  const chars = Array.from(text.replace(/\n/g, ""));
  const cols = [];
  for (let i = 0; i < chars.length; i += rows) cols.push(chars.slice(i, i + rows));
  for (let c = 1; c < cols.length; c += 1) {
    if (cols[c].length && NO_HEAD.indexOf(cols[c][0]) >= 0 && cols[c - 1].length > 1) {
      cols[c].unshift(cols[c - 1].pop());
    }
  }
  if (cols.length > 1) {
    const last = cols[cols.length - 1];
    const onlyPunct = last.length <= 2 && last.every((ch) => NO_HEAD.indexOf(ch) >= 0);
    if (onlyPunct) {
      cols[cols.length - 2] = cols[cols.length - 2].concat(last);
      cols.pop();
    }
  }
  return cols;
}
function wrapBalanced(g, text, maxW) {
  const lines = wrapText(g, text, maxW);
  if (lines.length <= 1) return lines;
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) total += g.measureText(lines[i]).width;
  const target = Math.min(maxW, total / lines.length * 1.05);
  if (target < maxW * 0.55) return lines;
  const balanced = wrapText(g, text, target);
  return balanced.length <= lines.length ? balanced : lines;
}
function fontStr(size, family, weight) {
  return (weight || "400") + " " + Math.round(size) + "px " + family;
}
function layout(g, item, area, th, opts) {
  const text = item.text.trim() || "　";
  const family = FONT_FAMILY[opts.font === "auto" ? th.family : opts.font];
  const vertical = opts.vertical;
  const min = 24;
  for (let size = area.max; size >= min; size -= 2) {
    g.font = fontStr(size, family, th.weight);
    if (!vertical) {
      const lines = wrapBalanced(g, text, area.w);
      const lineH = size * th.lineHeight;
      const blockH = lines.length * lineH;
      if (blockH <= area.h && lines.length <= 14) {
        let blockW = 0;
        for (let i = 0; i < lines.length; i += 1) {
          blockW = Math.max(blockW, g.measureText(lines[i]).width);
        }
        return { size, family, vertical: false, lines, lineH, blockW, blockH };
      }
    } else {
      const step2 = size * 1.5;
      const rows2 = Math.max(1, Math.floor(area.h / step2));
      const cols2 = splitColumns(text, rows2);
      const colW = size * 1.42;
      const blockW = cols2.length * colW;
      if (blockW <= area.w && cols2.length <= 12) {
        return { size, family, vertical: true, cols: cols2, step: step2, colW, blockW, blockH: rows2 * step2 };
      }
    }
  }
  g.font = fontStr(min, family, th.weight);
  if (!vertical) {
    let lines = wrapBalanced(g, text, area.w);
    const lineH = min * th.lineHeight;
    const maxLines = Math.max(1, Math.floor(area.h / lineH));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + "…";
    }
    let blockW = 0;
    for (let i = 0; i < lines.length; i += 1) blockW = Math.max(blockW, g.measureText(lines[i]).width);
    return { size: min, family, vertical: false, lines, lineH, blockW, blockH: lines.length * lineH };
  }
  const step = min * 1.5;
  const rows = Math.max(1, Math.floor(area.h / step));
  const cols = splitColumns(text, rows).slice(0, Math.max(1, Math.floor(area.w / (min * 1.42))));
  return { size: min, family, vertical: true, cols, step, colW: min * 1.42, blockW: cols.length * min * 1.42, blockH: rows * step };
}
function drawBody(g, lay, area, th, opts) {
  g.save();
  g.textBaseline = "alphabetic";
  g.fillStyle = th.fill ? th.fill(g, { y: area.y, h: area.h }) : th.ink;
  if (th.glow) {
    g.shadowColor = th.glow.color;
    g.shadowBlur = th.glow.blur;
  }
  g.font = fontStr(lay.size, lay.family, th.weight);
  if (!lay.vertical) {
    const left = area.align === "center" ? area.x + (area.w - lay.blockW) / 2 : area.x;
    const top = area.valign === "top" ? area.y : area.y + (area.h - lay.blockH) / 2;
    g.textAlign = "left";
    for (let i = 0; i < lay.lines.length; i += 1) {
      const y = top + i * lay.lineH + lay.size * 0.82;
      const x = area.align === "center" ? area.x + (area.w - g.measureText(lay.lines[i]).width) / 2 : left;
      g.fillText(lay.lines[i], x, y);
    }
  } else {
    const blockLeft = area.align === "center" ? area.x + (area.w - lay.blockW) / 2 : area.x + area.w - lay.blockW;
    const top = area.y + Math.max(0, (area.h - lay.blockH) / 2);
    g.textAlign = "center";
    for (let c = 0; c < lay.cols.length; c += 1) {
      const col = lay.cols[c];
      const x = blockLeft + lay.blockW - lay.colW / 2 - c * lay.colW;
      for (let k = 0; k < col.length; k += 1) {
        g.fillText(col[k], x, top + k * lay.step + lay.size * 0.84);
      }
    }
  }
  g.restore();
}
function drawMeta(g, W, H, item, th) {
  const cfg = th.meta;
  if (typeof cfg.y !== "function") return;
  const y = cfg.y(H);
  g.save();
  g.textBaseline = "alphabetic";
  g.font = fontStr(cfg.size, FONT_FAMILY[cfg.family], "400");
  g.textAlign = cfg.align === "right" ? "right" : cfg.align === "center" ? "center" : "left";
  const x = cfg.align === "right" ? W - 128 : cfg.align === "center" ? W / 2 : 128;
  if (item.author) {
    g.fillStyle = cfg.color;
    g.fillText("—— " + item.author, x, y);
  }
  if (cfg.noDate) {
    g.restore();
    return;
  }
  g.font = fontStr(cfg.dateSize, FONT_FAMILY[cfg.family], "400");
  g.fillStyle = cfg.dateColor;
  g.fillText(dateText() + (cfg.dateSuffix || ""), x, y + cfg.dateGap);
  g.restore();
}
function paint(canvas, scale, st) {
  const ratio = RATIOS.filter((r) => r.id === st.ratio)[0] || RATIOS[0];
  const W = ratio.w;
  const H = ratio.h;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const g = canvas.getContext("2d");
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, W, H);
  const th = THEME_MAP[st.theme] || THEMES[0];
  RAND = mulberry32(hashStr(st.item.text + th.id));
  th.bg(g, W, H);
  const area = th.area(W, H);
  const lay = layout(g, st.item, area, th, st);
  const box = textBox(area, lay);
  if (th.decor) th.decor(g, W, H, st.item, box);
  drawBody(g, lay, area, th, st);
  drawMeta(g, W, H, st.item, th);
  return { W, H, lay, th };
}
function textBox(area, lay) {
  if (!lay.vertical) {
    const left2 = area.align === "center" ? area.x + (area.w - lay.blockW) / 2 : area.x;
    const top2 = area.valign === "top" ? area.y : area.y + (area.h - lay.blockH) / 2;
    return { left: left2, top: top2, width: lay.blockW, height: lay.blockH };
  }
  const left = area.align === "center" ? area.x + (area.w - lay.blockW) / 2 : area.x + area.w - lay.blockW;
  const top = area.y + Math.max(0, (area.h - lay.blockH) / 2);
  return { left, top, width: lay.blockW, height: lay.blockH };
}
function pickLocal(cat) {
  const pool = LOCAL[cat] || LOCAL.quote;
  const i = Math.floor(Math.random() * pool.length);
  return pool[i];
}
function normalize(src, raw) {
  if (src.kind === "hitokoto") {
    if (!raw || !raw.hitokoto) throw new Error("bad");
    const author = raw.from_who || raw.from || "";
    return { text: raw.hitokoto, author, cat: hitokotoLabel(raw.type) || "一言" };
  }
  if (src.kind === "jinrishici") {
    if (!raw || !raw.content) throw new Error("bad");
    const a = (raw.author ? raw.author : "") + (raw.origin ? "《" + raw.origin + "》" : "");
    return { text: raw.content, author: a, cat: "诗词" };
  }
  if (src.kind === "shadiao") {
    if (!raw || !raw.data || !raw.data.text) throw new Error("bad");
    return { text: raw.data.text, author: "", cat: raw.data.type || src.tag };
  }
  if (src.kind === "btstu") {
    if (!raw || !raw.text) throw new Error("bad");
    return { text: raw.text, author: "", cat: "段子" };
  }
  throw new Error("bad");
}
function hitokotoLabel(type) {
  const map = { a: "动画", b: "漫画", c: "游戏", d: "文学", e: "原创", f: "网络", g: "其他", h: "影视", i: "诗词", j: "网易云", k: "哲学", l: "抖机灵" };
  return map[type] || "";
}
function sourceUrl(src, hitokotoCat) {
  if (src.kind === "hitokoto") {
    const c = hitokotoCat && hitokotoCat !== "any" ? "&c=" + hitokotoCat : "";
    return "https://v1.hitokoto.cn/?encode=json" + c;
  }
  if (src.kind === "jinrishici") return "https://v1.jinrishici.com/all.json";
  if (src.kind === "shadiao") return "https://api.shadiao.pro" + src.path;
  if (src.kind === "btstu") return "https://api.btstu.cn/yan/api.php?charset=utf-8&encode=json";
  return "";
}
function mount(app) {
  const signal = app && app.signal;
  const $ = (sel) => document.querySelector(sel);
  const canvas = $("#card");
  const statusEl = $("#status");
  const srcChips = $("#srcChips");
  const subChips = $("#subChips");
  const themeList = $("#themeList");
  const favList = $("#favList");
  const favCount = $("#favCount");
  const writeBox = $("#writeBox");
  const btnNext = $("#btnNext");
  const btnSave = $("#btnSave");
  const btnFav = $("#btnFav");
  const btnCopy = $("#btnCopy");
  const btnRandom = $("#btnRandom");
  const btnWrite = $("#btnWrite");
  const btnApply = $("#btnApply");
  const txt = $("#txt");
  const who = $("#who");
  const chkVertical = $("#chkVertical");
  const chkHi = $("#chkHi");
  const segFont = $("#segFont");
  const segRatio = $("#segRatio");
  const sizeHint = $("#sizeHint");
  const prefs = loadPrefs();
  const state = {
    item: { text: LOCAL.quote[0].text, author: "", cat: "金句" },
    theme: prefs.theme,
    ratio: prefs.ratio,
    font: prefs.font,
    vertical: prefs.vertical,
    hi: prefs.hi,
    source: prefs.source,
    hkCat: prefs.hkCat
  };
  let favorites = loadFavs();
  let busy = false;
  let pending = 0;
  let statusTimer = 0;
  let disposed = false;
  function loadPrefs() {
    const base = { theme: "xuan", ratio: "3-4", font: "auto", vertical: false, hi: true, source: "hitokoto", hkCat: "any" };
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return base;
      const s = JSON.parse(raw);
      if (typeof s.theme === "string" && THEME_MAP[s.theme]) base.theme = s.theme;
      if (RATIOS.some((r) => r.id === s.ratio)) base.ratio = s.ratio;
      if (s.font === "auto" || FONT_FAMILY[s.font]) base.font = s.font;
      if (typeof s.vertical === "boolean") base.vertical = s.vertical;
      if (typeof s.hi === "boolean") base.hi = s.hi;
      if (SOURCES.some((x) => x.id === s.source)) base.source = s.source;
      if (HITOKOTO_CATS.some((c) => c.id === s.hkCat)) base.hkCat = s.hkCat;
      return base;
    } catch (e) {
      return base;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({
        theme: state.theme,
        ratio: state.ratio,
        font: state.font,
        vertical: state.vertical,
        hi: state.hi,
        source: state.source,
        hkCat: state.hkCat
      }));
    } catch (e) {
    }
    try {
      const flush = app && app.storage && app.storage.flush;
      if (typeof flush === "function") Promise.resolve(flush.call(app.storage)).catch(() => {
      });
    } catch (e) {
    }
  }
  function loadFavs() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter((x) => x && typeof x.text === "string").slice(0, 60);
    } catch (e) {
      return [];
    }
  }
  function saveFavs() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    } catch (e) {
      toast("收藏空间已满，请先删掉几条");
    }
    try {
      const flush = app && app.storage && app.storage.flush;
      if (typeof flush === "function") Promise.resolve(flush.call(app.storage)).catch(() => {
      });
    } catch (e) {
    }
  }
  function toast(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (!disposed) statusEl.classList.remove("show");
    }, 2600);
  }
  let raf = 0;
  function syncSizeHint() {
    const r = RATIOS.filter((x) => x.id === state.ratio)[0] || RATIOS[0];
    const s = state.hi ? 2 : 1;
    sizeHint.textContent = "PNG · " + r.w * s + " × " + r.h * s;
  }
  function render() {
    if (disposed) return;
    syncSizeHint();
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (disposed) return;
      try {
        paint(canvas, 1, state);
        canvas.setAttribute("aria-label", "卡片预览：" + state.item.text + (state.item.author ? " —— " + state.item.author : ""));
      } catch (e) {
        toast("绘制失败：" + (e && e.message ? e.message : "未知错误"));
      }
    });
  }
  async function httpJSON(url) {
    if (typeof app.request === "function") {
      const res2 = await app.request(url, { timeoutMs: 8e3, signal });
      if (!res2.ok) throw new Error("HTTP " + res2.status);
      return res2.json();
    }
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }
  async function next(showToast) {
    if (busy || disposed) return;
    const src = SOURCES.filter((s) => s.id === state.source)[0] || SOURCES[0];
    busy = true;
    btnNext.classList.add("loading");
    const token = ++pending;
    const fallback = () => {
      const item = pickLocal(src.cat || "quote");
      return { text: item.text, author: item.author, cat: src.tag || "一言" };
    };
    try {
      if (src.kind === "local") {
        const item = pickLocal(src.cat);
        setItem({ text: item.text, author: item.author, cat: src.tag });
        if (showToast) toast("已换一句");
      } else {
        const raw = await httpJSON(sourceUrl(src, state.hkCat));
        if (token !== pending || disposed) return;
        setItem(normalize(src, raw));
        if (showToast) toast("已换一句");
      }
    } catch (e) {
      if (token !== pending || disposed) return;
      setItem(fallback());
      toast("接口没响应，已用内置语料");
    } finally {
      if (token === pending) {
        busy = false;
        btnNext.classList.remove("loading");
      }
    }
  }
  function setItem(item) {
    state.item = {
      text: String(item.text || "").replace(/\s+\n/g, "\n").trim(),
      author: item.author ? String(item.author).trim() : "",
      cat: item.cat || "一言"
    };
    render();
  }
  function buildSources() {
    srcChips.innerHTML = "";
    SOURCES.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (s.id === state.source ? " on" : "");
      b.textContent = s.label;
      b.setAttribute("data-src", s.id);
      srcChips.appendChild(b);
    });
    subChips.innerHTML = "";
    HITOKOTO_CATS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "subchip" + (c.id === state.hkCat ? " on" : "");
      b.textContent = c.label;
      b.setAttribute("data-cat", c.id);
      subChips.appendChild(b);
    });
    subChips.hidden = state.source !== "hitokoto";
  }
  function buildThemes() {
    themeList.innerHTML = "";
    THEMES.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "theme" + (t.id === state.theme ? " on" : "");
      b.setAttribute("data-theme", t.id);
      b.title = t.hint;
      b.innerHTML = '<i style="background:' + t.swatch + '"></i><b>' + t.name + "</b>";
      themeList.appendChild(b);
    });
  }
  function syncUI() {
    segFont.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-v") === state.font);
    });
    segRatio.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-v") === state.ratio);
    });
    chkVertical.checked = state.vertical;
    chkHi.checked = state.hi;
    srcChips.querySelectorAll(".chip").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-src") === state.source);
    });
    subChips.hidden = state.source !== "hitokoto";
    subChips.querySelectorAll(".subchip").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-cat") === state.hkCat);
    });
    themeList.querySelectorAll(".theme").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-theme") === state.theme);
    });
  }
  function buildFavs() {
    favList.innerHTML = "";
    favCount.textContent = favorites.length ? favorites.length + " 条" : "空";
    if (!favorites.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "还没有收藏，点上面的「收藏」把喜欢的句子存下来。";
      favList.appendChild(p);
      return;
    }
    favorites.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "fav";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fav-main";
      b.setAttribute("data-i", String(i));
      b.textContent = f.text.length > 22 ? f.text.slice(0, 22) + "…" : f.text;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "fav-del";
      del.setAttribute("data-del", String(i));
      del.setAttribute("aria-label", "删除收藏");
      del.textContent = "✕";
      row.appendChild(b);
      row.appendChild(del);
      favList.appendChild(row);
    });
  }
  function exportCanvas() {
    const c = document.createElement("canvas");
    paint(c, state.hi ? 2 : 1, state);
    return c;
  }
  async function saveImage() {
    if (busy) return;
    btnSave.disabled = true;
    const old = btnSave.textContent;
    btnSave.textContent = "生成中…";
    try {
      const c = exportCanvas();
      const blob = await new Promise((resolve, reject) => {
        c.toBlob((b) => b ? resolve(b) : reject(new Error("导出失败")), "image/png");
      });
      const name = "卡片-" + dateText().replace(/\./g, "") + "-" + String(Date.now()).slice(-4) + ".png";
      let saved = false;
      if (typeof app.saveFile === "function") {
        saved = await app.saveFile(name, blob, { signal });
        toast(saved ? "已保存 " + name : "已取消保存");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4e3);
        toast("已下载 " + name);
        saved = true;
      }
      if (!saved) toast("已取消");
    } catch (e) {
      toast("保存失败：" + (e && e.message ? e.message : "未知错误"));
    } finally {
      if (!disposed) {
        btnSave.disabled = false;
        btnSave.textContent = old;
      }
    }
  }
  async function copyText() {
    const line = state.item.author ? state.item.text + "\n—— " + state.item.author : state.item.text;
    try {
      if (typeof app.copyText === "function") {
        await app.copyText(line);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(line);
      } else {
        throw new Error("unsupported");
      }
      toast("文字已复制");
    } catch (e) {
      toast("复制失败，请手动选中");
    }
  }
  function addFav() {
    const item = state.item;
    const exist = favorites.some((f) => f.text === item.text);
    if (exist) {
      toast("已经在收藏里了");
      return;
    }
    favorites.unshift({ text: item.text, author: item.author, cat: item.cat, ts: Date.now() });
    favorites = favorites.slice(0, 60);
    saveFavs();
    buildFavs();
    toast("已收藏");
  }
  const onNext = () => next(true);
  const onSave = () => saveImage();
  const onFav = () => addFav();
  const onCopy = () => copyText();
  const onRandom = () => {
    const t = THEMES[Math.floor(Math.random() * THEMES.length)];
    const s = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    state.theme = t.id;
    state.source = s.id;
    syncUI();
    savePrefs();
    render();
    next(true);
  };
  const onSrcClick = (e) => {
    const b = e.target.closest("[data-src]");
    if (!b) return;
    state.source = b.getAttribute("data-src");
    syncUI();
    savePrefs();
    next(true);
  };
  const onSubClick = (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.hkCat = b.getAttribute("data-cat");
    syncUI();
    savePrefs();
    next(true);
  };
  const onThemeClick = (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    state.theme = b.getAttribute("data-theme");
    syncUI();
    savePrefs();
    render();
  };
  const onFontClick = (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    state.font = b.getAttribute("data-v");
    syncUI();
    savePrefs();
    render();
  };
  const onRatioClick = (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    state.ratio = b.getAttribute("data-v");
    syncUI();
    savePrefs();
    render();
  };
  const onVertical = () => {
    state.vertical = chkVertical.checked;
    savePrefs();
    render();
  };
  const onHi = () => {
    state.hi = chkHi.checked;
    syncSizeHint();
    savePrefs();
  };
  const onWrite = () => {
    writeBox.hidden = !writeBox.hidden;
    btnWrite.textContent = writeBox.hidden ? "展开" : "收起";
    if (!writeBox.hidden) {
      txt.value = state.item.text;
      who.value = state.item.author;
      window.setTimeout(() => txt.focus(), 60);
    }
  };
  const onApply = () => {
    const text = txt.value.trim();
    if (!text) {
      toast("先写一句吧");
      return;
    }
    let cat = "手写";
    if (who.value.trim()) cat = "手写";
    setItem({ text, author: who.value.trim(), cat });
    toast("已生成");
  };
  const onFavList = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const i = Number(del.getAttribute("data-del"));
      favorites.splice(i, 1);
      saveFavs();
      buildFavs();
      toast("已删除");
      return;
    }
    const main = e.target.closest("[data-i]");
    if (main) {
      const i = Number(main.getAttribute("data-i"));
      const f = favorites[i];
      if (f) {
        setItem({ text: f.text, author: f.author, cat: f.cat || "收藏" });
        toast("已载入");
      }
    }
  };
  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      next(true);
    }
  };
  btnNext.addEventListener("click", onNext);
  btnSave.addEventListener("click", onSave);
  btnFav.addEventListener("click", onFav);
  btnCopy.addEventListener("click", onCopy);
  btnRandom.addEventListener("click", onRandom);
  btnWrite.addEventListener("click", onWrite);
  btnApply.addEventListener("click", onApply);
  srcChips.addEventListener("click", onSrcClick);
  subChips.addEventListener("click", onSubClick);
  themeList.addEventListener("click", onThemeClick);
  segFont.addEventListener("click", onFontClick);
  segRatio.addEventListener("click", onRatioClick);
  chkVertical.addEventListener("change", onVertical);
  chkHi.addEventListener("change", onHi);
  favList.addEventListener("click", onFavList);
  document.addEventListener("keydown", onKey);
  buildSources();
  buildThemes();
  buildFavs();
  syncUI();
  const item0 = pickLocal("quote");
  state.item = { text: item0.text, author: item0.author, cat: "金句" };
  render();
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(statusTimer);
    btnNext.removeEventListener("click", onNext);
    btnSave.removeEventListener("click", onSave);
    btnFav.removeEventListener("click", onFav);
    btnCopy.removeEventListener("click", onCopy);
    btnRandom.removeEventListener("click", onRandom);
    btnWrite.removeEventListener("click", onWrite);
    btnApply.removeEventListener("click", onApply);
    srcChips.removeEventListener("click", onSrcClick);
    subChips.removeEventListener("click", onSubClick);
    themeList.removeEventListener("click", onThemeClick);
    segFont.removeEventListener("click", onFontClick);
    segRatio.removeEventListener("click", onRatioClick);
    chkVertical.removeEventListener("change", onVertical);
    chkHi.removeEventListener("change", onHi);
    favList.removeEventListener("click", onFavList);
    document.removeEventListener("keydown", onKey);
  };
  if (signal) {
    if (signal.aborted) cleanup();
    else signal.addEventListener("abort", cleanup, { once: true });
  }
  return cleanup;
}
export {
  mount
};
