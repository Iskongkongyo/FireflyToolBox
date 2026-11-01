use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use uuid::Uuid;
mod unicode;

pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const URL_COMPONENT_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

#[derive(Clone, Serialize)]
pub struct ToolDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub tags: &'static [&'static str],
    pub aliases: &'static [&'static str],
}

#[derive(Clone, Debug, Serialize)]
pub struct ToolAction {
    pub id: &'static str,
    pub label: &'static str,
    pub input_types: &'static [&'static str],
    pub consumes_input: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolStep {
    pub tool_id: String,
    pub action: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomTool {
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub icon_data: Option<String>,
    /// Empty for a new tool; persisted IDs have the form custom.<database id>.
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub steps: Vec<ToolStep>,
}

const FORMAT_ACTION: &[ToolAction] = &[ToolAction {
    id: "format",
    label: "格式化",
    input_types: &["json"],
    consumes_input: true,
}];
const CONVERT_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "encode",
        label: "编码",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "decode",
        label: "解码",
        input_types: &["base64"],
        consumes_input: true,
    },
];
// Preserve the original SHA-256 action for saved automations.
const HASH_ACTION: &[ToolAction] = &[
    ToolAction {
        id: "hash",
        label: "SHA-256",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "md5",
        label: "MD5",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "sha1",
        label: "SHA-1",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "sha224",
        label: "SHA-224",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "sha384",
        label: "SHA-384",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "sha512",
        label: "SHA-512",
        input_types: &["text"],
        consumes_input: true,
    },
];
const UNIX_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "to_date",
        label: "转 UTC 日期",
        input_types: &["unix_timestamp"],
        consumes_input: true,
    },
    ToolAction {
        id: "to_timestamp",
        label: "转 Unix 秒",
        input_types: &["datetime"],
        consumes_input: true,
    },
];
const UUID_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "generate",
        label: "生成 UUID",
        input_types: &[],
        consumes_input: false,
    },
    ToolAction {
        id: "validate",
        label: "校验 UUID",
        input_types: &["uuid"],
        consumes_input: true,
    },
];
const DEDUP_ACTION: &[ToolAction] = &[ToolAction {
    id: "dedup",
    label: "去重",
    input_types: &["text"],
    consumes_input: true,
}];
const CASE_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "upper",
        label: "转大写",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "lower",
        label: "转小写",
        input_types: &["text"],
        consumes_input: true,
    },
];
const COLOR_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "to_rgb",
        label: "HEX 转 RGB",
        input_types: &["hex_color"],
        consumes_input: true,
    },
    ToolAction {
        id: "to_hex",
        label: "RGB 转 HEX",
        input_types: &["rgb_color"],
        consumes_input: true,
    },
];
const JWT_ACTION: &[ToolAction] = &[ToolAction {
    id: "decode",
    label: "解析 JWT",
    input_types: &["jwt"],
    consumes_input: true,
}];

const URL_CONVERT_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "encode",
        label: "编码",
        input_types: &["url", "text"],
        consumes_input: true,
    },
    ToolAction {
        id: "decode",
        label: "解码",
        input_types: &["url_encoding"],
        consumes_input: true,
    },
];

pub const INPUT_TYPES: &[(&str, &str)] = &[
    ("text", "普通文本"),
    ("json", "JSON"),
    ("jwt", "JWT"),
    ("uuid", "UUID"),
    ("unix_timestamp", "Unix 时间戳"),
    ("datetime", "日期时间"),
    ("base64", "Base64"),
    ("url", "网址"),
    ("url_encoding", "URL 编码"),
    ("hex_color", "HEX 颜色"),
    ("rgb_color", "RGB 颜色"),
];
pub fn valid_input_type(id: &str) -> bool {
    INPUT_TYPES.iter().any(|(value, _)| *value == id)
}

pub fn tool_actions(id: &str) -> &'static [ToolAction] {
    match id {
        "unicode.convert" => UNICODE_ACTIONS,
        id if interactive_tool(id) => OPEN_ACTION,
        "json.format" => FORMAT_ACTION,
        "base64.convert" => CONVERT_ACTIONS,
        "url.convert" => URL_CONVERT_ACTIONS,
        "sha256.hash" => HASH_ACTION,
        "time.unix" => UNIX_ACTIONS,
        "uuid.generate" => UUID_ACTIONS,
        "text.dedup" => DEDUP_ACTION,
        "text.case" => CASE_ACTIONS,
        "color.convert" => COLOR_ACTIONS,
        "jwt.decode" => JWT_ACTION,
        _ => &[],
    }
}

pub fn validate_pipeline(steps: &[ToolStep]) -> Result<(), ToolError> {
    if steps.is_empty() || steps.len() > 8 {
        return Err(ToolError::new(
            "invalid_steps",
            "请选择 1 到 8 个处理步骤。",
        ));
    }
    for (index, step) in steps.iter().enumerate() {
        if !tool_actions(&step.tool_id)
            .iter()
            .any(|action| action.id == step.action)
        {
            return Err(ToolError::new(
                "invalid_step",
                "自定义工具包含不支持的处理步骤。",
            ));
        }
        if index > 0 && step.tool_id == "uuid.generate" && step.action == "generate" {
            return Err(ToolError::new("invalid_step", "UUID 生成只能放在第一步。"));
        }
    }
    Ok(())
}

pub fn run_pipeline(steps: &[ToolStep], input: &str) -> Result<String, ToolError> {
    validate_pipeline(steps)?;
    if input.is_empty() && !(steps[0].tool_id == "uuid.generate" && steps[0].action == "generate") {
        return Err(ToolError::new("empty_input", "请输入内容。"));
    }
    if input.len() > MAX_TEXT_BYTES {
        return Err(ToolError::new("input_too_large", "输入超过 1 MiB 限制。"));
    }
    let mut value = input.to_owned();
    for (index, step) in steps.iter().enumerate() {
        value = run_tool(&step.tool_id, &step.action, &value)?;
        if index + 1 < steps.len() && value.len() > MAX_TEXT_BYTES {
            return Err(ToolError::new(
                "intermediate_too_large",
                "中间结果超过 1 MiB，无法继续处理。",
            ));
        }
    }
    Ok(value)
}

const OPEN_ACTION: &[ToolAction] = &[ToolAction {
    id: "open",
    label: "打开工具",
    input_types: &[],
    consumes_input: false,
}];
const UNICODE_ACTIONS: &[ToolAction] = &[
    ToolAction {
        id: "encode",
        label: "转为 \\uXXXX",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "decode",
        label: "解码 Unicode 转义",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "to_points",
        label: "转为 U+ 码点",
        input_types: &["text"],
        consumes_input: true,
    },
    ToolAction {
        id: "from_points",
        label: "解码 U+ 码点",
        input_types: &["text"],
        consumes_input: true,
    },
];
pub fn interactive_tool(id: &str) -> bool {
    matches!(
        id,
        "regex.test"
            | "cron.expression"
            | "radix.convert"
            | "web.source"
            | "file.hash"
            | "ssl.certificate"
            | "decision.wheel"
            | "focus.pomodoro"
            | "history.today"
            | "bing.wallpaper"
            | "score.board"
            | "trending.live"
            | "date.countdown"
            | "notes.memo"
            | "image.exif"
            | "emoji.catalog"
            | "qr.decode"
            | "text.diff"
            | "markdown.editor"
            | "domain.whois"
            | "network.ip"
            | "news.briefing"
            | "news.it"
            | "health.bmi"
            | "phone.location"
            | "image.base64"
            | "image.stitch"
            | "image.compress"
            | "image.convert"
            | "unit.convert"
            | "math.calculate"
            | "text.replace"
            | "data.convert"
            | "file.links"
            | "github.download"
            | "identity.lookup"
            | "bankcard.lookup"
            | "html.format"
            | "js.format"
            | "css.format"
            | "pdf.encrypt"
            | "pdf.decrypt"
            | "zip.manage"
            | "media.info"
            | "audio.edit"
            | "video.edit"
            | "image.edit"
            | "pdf.pages"
            | "text.count"
            | "boxoffice.live"
            | "image.ocr"
            | "ai.resources"
            | "video.speed"
            | "audio.speed"
            | "image.pdf"
            | "pdf.image"
            | "pdf.merge"
            | "document.pdf"
            | "pdf.document"
            | "image.watermark"
            | "image.pixelate"
            | "audio.compress"
            | "audio.convert"
            | "video.compress"
            | "video.audio"
            | "video.convert"
            | "video.gif"
            | "gif.video"
            | "weather.forecast"
            | "date.calendar"
            | "qr.generate"
            | "morse.convert"
            | "image.hidden"
            | "family.kinship"
            | "firefly.meow"
            | "image.search"
            | "fun.reaction"
            | "random.generate"
            | "link.shortener"
            | "poem.acrostic"
            | "translate.baidu"
            | "password.generate"
            | "fun.woodfish"
            | "flowers.catalog"
            | "earth.globe"
            | "dev.commands"
            | "fuel.price"
            | "gold.price"
            | "time.world"
            | "text.magic"
            | "color.palettes"
            | "icon.design"
            | "rc4.convert"
            | "drawing.board"
            | "mind.map"
            | "image.color"
            | "currency.exchange"
            | "currency.today"
            | "screen.check"
            | "quote.card"
    )
}
pub const TOOLS: &[ToolDescriptor] = &[
    ToolDescriptor {
        id: "screen.check",
        name: "屏幕坏点检测",
        description: "21 项全屏图案巡检：纯色找坏点亮斑、灰阶看断层与暗部细节、棋盘与网格查锐度几何、运动与条纹查拖影和 PWM 频闪；点击切换、自动巡演、可自定检测范围，全程离线",
        category: "效率工具",
        tags: &["屏幕检测", "坏点", "显示器", "灰阶"],
        aliases: &["坏点检测", "亮点暗点", "屏幕测试", "显示器测试", "漏光", "烧屏", "dead pixel"],
    },
    ToolDescriptor {
        id: "quote.card",
        name: "一句话卡片",
        description: "把每日一言、今日诗词、冷笑话、毒鸡汤、彩虹屁或自己写的一句话，生成 3:4 / 9:16 / 4:5 竖版分享图；六套模板含宣纸朱印、夜幕星点、莫兰迪、胶片漏光、报刊与霓虹，支持竖排文字与高清导出，接口不通时自动用内置语料",
        category: "趣味与AI",
        tags: &["卡片", "一言", "分享图", "诗词"],
        aliases: &["一句话", "每日一言", "语录卡片", "文字海报", "分享图", "笑话", "毒鸡汤", "诗词卡片"],
    },
    ToolDescriptor {
        id: "github.download",
        name: "GitHub 下载加速",
        description: "选择 jsDelivr、Statically、pd.zwc365.com 或 ghfast.top，转换仓库文件、Raw 文件、Release 附件或源码压缩包链接，支持复制与打开。",
        category: "开发与文本",
        tags: &["GitHub", "下载", "加速", "CDN", "代理"],
        aliases: &["GitHub proxy", "GitHub download", "jsdelivr", "ghfast"],
    },
    ToolDescriptor {
        id: "file.links",
        name: "文件直链获取",
        description: "选择 Catbox、Litterbox、Uguu、Postimages、Gofile 或 ImgBB，在网站内上传文件并获取分享链接或直链。",
        category: "文件与文档",
        tags: &["文件", "直链", "图床", "上传", "分享"],
        aliases: &["file hosting", "direct file link", "catbox", "gofile"],
    },
    ToolDescriptor {
        id: "identity.lookup",
        name: "身份证查询",
        description: "离线校验身份证号码结构与校验码，显示地区、出生日期、性别与年龄。",
        category: "生活与查询",
        tags: &["身份证", "地区", "年龄", "校验"],
        aliases: &["identity card", "ID number", "身份证校验"],
    },
    ToolDescriptor {
        id: "bankcard.lookup",
        name: "银行卡查询",
        description: "本地银行与卡种识别、Luhn 校验和公开 BIN 发卡机构地区查询",
        category: "生活与查询",
        tags: &["银行卡", "银行", "BIN", "地区", "校验"],
        aliases: &["bank card", "BIN lookup", "IIN"],
    },
    ToolDescriptor {
        id: "pdf.encrypt",
        name: "PDF 加密",
        description: "离线使用 AES-256 加密 PDF，设置打开密码与阅读权限；保留页面内容，另存结果，原文件不变。",
        category: "文件与文档",
        tags: &["PDF", "加密", "密码"],
        aliases: &["PDF encrypt", "PDF password"],
    },
    ToolDescriptor {
        id: "pdf.decrypt",
        name: "PDF 解密",
        description: "使用正确密码离线移除 PDF 加密，保留页面内容；另存结果，原文件不变。",
        category: "文件与文档",
        tags: &["PDF", "解密", "密码"],
        aliases: &["PDF decrypt", "PDF unlock"],
    },
    ToolDescriptor {
        id: "html.format",
        name: "HTML 格式化与压缩",
        description: "离线排版与压缩 HTML，支持导入、复制和保存；不运行代码，也不加载代码中的外部资源。",
        category: "开发与文本",
        tags: &["HTML", "格式化", "压缩", "代码"],
        aliases: &["HTML formatter", "HTML minify", "HTML美化"],
    },
    ToolDescriptor {
        id: "js.format",
        name: "JS 格式化与压缩",
        description: "离线排版与压缩 JavaScript，可选模块和表达式优化；不运行代码，也不加载代码中的外部资源。",
        category: "开发与文本",
        tags: &["JavaScript", "JS", "格式化", "压缩"],
        aliases: &["JavaScript formatter", "JS minify", "JS美化"],
    },
    ToolDescriptor {
        id: "css.format",
        name: "CSS 格式化与压缩",
        description: "离线排版与压缩 CSS，保留规则顺序和许可注释；不运行代码，也不加载代码中的外部资源。",
        category: "开发与文本",
        tags: &["CSS", "格式化", "压缩", "样式"],
        aliases: &["CSS formatter", "CSS minify", "CSS美化"],
    },
    ToolDescriptor {
        id: "json.format",
        name: "JSON 格式化",
        description: "美化与校验 JSON",
        category: "开发与文本",
        tags: &["JSON", "文本", "开发"],
        aliases: &["json formatter", "json pretty", "json beautify"],
    },
    ToolDescriptor {
        id: "base64.convert",
        name: "Base64 编解码",
        description: "编码文本或解码 UTF-8 文本",
        category: "开发与文本",
        tags: &["Base64", "编码", "文本"],
        aliases: &["base64 encode", "base64 decode"],
    },
    ToolDescriptor {
        id: "url.convert",
        name: "URL 编解码",
        description: "编码或解码 URL 组件",
        category: "开发与文本",
        tags: &["URL", "百分号编码", "网络"],
        aliases: &["url encode", "url decode", "percent encoding"],
    },
    ToolDescriptor {
        id: "sha256.hash",
        name: "文本哈希",
        description: "计算 UTF-8 文本的 MD5、SHA-1 和 SHA-2 系列摘要",
        category: "开发与文本",
        tags: &[
            "MD5", "SHA-1", "SHA-224", "SHA-256", "SHA-384", "SHA-512", "哈希", "摘要",
        ],
        aliases: &["sha256", "hash", "md5", "sha1", "text hash", "SHA-256 哈希"],
    },
    ToolDescriptor {
        id: "time.unix",
        name: "Unix 时间戳",
        description: "Unix 秒或毫秒与 UTC 日期互转",
        category: "生活与查询",
        tags: &["时间", "日期", "Unix"],
        aliases: &["timestamp", "epoch"],
    },
    ToolDescriptor {
        id: "uuid.generate",
        name: "UUID",
        description: "生成随机 UUID v4（不使用输入）或校验已有 UUID",
        category: "开发与文本",
        tags: &["UUID", "随机", "标识符"],
        aliases: &["uuid v4", "guid"],
    },
    ToolDescriptor {
        id: "text.dedup",
        name: "文本去重",
        description: "按行去重，保留首次出现顺序",
        category: "开发与文本",
        tags: &["文本", "去重", "行"],
        aliases: &["deduplicate", "unique lines"],
    },
    ToolDescriptor {
        id: "text.case",
        name: "大小写转换",
        description: "将文本转换为大写或小写",
        category: "开发与文本",
        tags: &["文本", "大小写", "转换"],
        aliases: &["uppercase", "lowercase"],
    },
    ToolDescriptor {
        id: "color.convert",
        name: "颜色转换",
        description: "HEX 与 RGB 颜色值互转",
        category: "图片与影音",
        tags: &["颜色", "HEX", "RGB"],
        aliases: &["hex color", "rgb color"],
    },
    ToolDescriptor {
        id: "jwt.decode",
        name: "JWT 解析",
        description: "查看 JWT Header 与 Payload；不验证签名",
        category: "开发与文本",
        tags: &["JWT", "JSON", "Token"],
        aliases: &["jwt decode", "json web token"],
    },
    ToolDescriptor {
        id: "regex.test",
        name: "正则表达式",
        description: "常用正则模板、匹配详情、捕获组与替换预览；匹配在独立 Worker 中运行，超时会中断。",
        category: "开发与文本",
        tags: &["正则", "匹配", "Regex"],
        aliases: &["regular expression", "regexp"],
    },
    ToolDescriptor {
        id: "cron.expression",
        name: "Cron 表达式",
        description: "使用常用模板生成、解析 5 字段 Unix Cron 或首位带秒的 6 字段格式，查看后续执行时间。",
        category: "开发与文本",
        tags: &["Cron", "定时", "表达式"],
        aliases: &["crontab", "cron schedule"],
    },
    ToolDescriptor {
        id: "radix.convert",
        name: "进制转换",
        description: "2–36 进制整数转换，支持大整数和负数",
        category: "开发与文本",
        tags: &["进制", "二进制", "十六进制"],
        aliases: &["number base", "binary", "hexadecimal"],
    },
    ToolDescriptor {
        id: "web.source",
        name: "网页源代码",
        description: "读取 HTTPS 服务器返回的原始源码，查看状态、内容类型和地址，支持复制与保存。",
        category: "开发与文本",
        tags: &["HTML", "源码", "HTTPS"],
        aliases: &["view source", "page source"],
    },
    ToolDescriptor {
        id: "file.hash",
        name: "文件哈希校验",
        description: "在本机分块计算 MD5、SHA-1、SHA-256/384/512，比较预期摘要；支持大文件与取消，文件内容不会上传。",
        category: "文件与文档",
        tags: &["文件", "哈希", "MD5", "SHA-1"],
        aliases: &["file checksum", "sha512", "md5"],
    },
    ToolDescriptor {
        id: "ssl.certificate",
        name: "SSL 证书查看",
        description: "直连 HTTPS 服务器，查看证书有效期、颁发者、域名匹配与 SHA-256 指纹。",
        category: "开发与文本",
        tags: &["SSL", "TLS", "证书"],
        aliases: &["x509", "certificate"],
    },
    ToolDescriptor {
        id: "unicode.convert",
        name: "Unicode 编解码",
        description: "支持 \\uXXXX、\\u{...} 和 U+ 码点，正确处理 emoji 与代理对",
        category: "开发与文本",
        tags: &["Unicode", "编码", "转义"],
        aliases: &["unicode escape", "code point"],
    },
    ToolDescriptor {
        id: "decision.wheel",
        name: "做个决定",
        description: "编辑决定内容与转盘选项，随机选择一个结果，每个选项拥有相同的机会。",
        category: "效率工具",
        tags: &["决定", "转盘", "随机"],
        aliases: &["decision", "wheel"],
    },
    ToolDescriptor {
        id: "focus.pomodoro",
        name: "番茄时钟",
        description: "专注与休息交替计时，支持自定义时长、暂停和提示音。",
        category: "效率工具",
        tags: &["番茄", "专注", "时钟"],
        aliases: &["pomodoro", "focus timer"],
    },
    ToolDescriptor {
        id: "history.today",
        name: "历史上的今天",
        description: "按日期查询历史事件、人物和资料",
        category: "生活与查询",
        tags: &["历史", "今天", "百科"],
        aliases: &["on this day", "history"],
    },
    ToolDescriptor {
        id: "bing.wallpaper",
        name: "必应壁纸",
        description: "浏览最近八天的必应每日壁纸，预览与保存图片",
        category: "图片与影音",
        tags: &["必应", "壁纸", "图片"],
        aliases: &["bing wallpaper", "daily image"],
    },
    ToolDescriptor {
        id: "score.board",
        name: "记分牌",
        description: "为比赛、桌游或小活动记录比分，支持编辑队伍、加减分、撤销和复制比分。",
        category: "趣味与AI",
        tags: &["记分", "比分", "比赛"],
        aliases: &["scoreboard", "score"],
    },
    ToolDescriptor {
        id: "trending.live",
        name: "实时热榜",
        description: "浏览百度、微博、抖音、头条、知乎、B站和贴吧热门榜单",
        category: "生活与查询",
        tags: &["热榜", "热搜", "热点"],
        aliases: &["trending", "hot search"],
    },
    ToolDescriptor {
        id: "date.countdown",
        name: "倒数日",
        description: "记录重要日期，显示剩余或已过天数，支持每年重复",
        category: "生活与查询",
        tags: &["日期", "倒数日", "纪念日"],
        aliases: &["countdown", "anniversary", "days until"],
    },
    ToolDescriptor {
        id: "notes.memo",
        name: "备忘录",
        description: "随手记录多篇笔记，内容自动保存，支持搜索和文本导入导出。",
        category: "效率工具",
        tags: &["笔记", "备忘", "记录"],
        aliases: &["memo", "notes", "notepad"],
    },
    ToolDescriptor {
        id: "image.exif",
        name: "EXIF 查看器",
        description: "按类别查看图片拍摄时间、相机参数，以及 EXIF、GPS、IPTC、XMP 和 ICC 配置文件等元数据。",
        category: "图片与影音",
        tags: &["EXIF", "图片", "相机", "GPS"],
        aliases: &["photo metadata", "exif reader"],
    },
    ToolDescriptor {
        id: "emoji.catalog",
        name: "常用Emoji",
        description: "精选常用表情，按分类与中英文名称检索、复制和收藏",
        category: "趣味与AI",
        tags: &["Emoji", "表情", "符号"],
        aliases: &["emoji", "emoticons", "Emoji 大全"],
    },
    ToolDescriptor {
        id: "qr.decode",
        name: "二维码解析",
        description: "从图片识别二维码，查看、复制和保存结果",
        category: "开发与文本",
        tags: &["二维码", "QR", "图片"],
        aliases: &["qr code", "qrcode decoder"],
    },
    ToolDescriptor {
        id: "text.diff",
        name: "两文本差异对比",
        description: "并排或单栏对比文本与文件，支持词级高亮、忽略选项、差异块双向合并与撤销，并可复制或另存合并后的完整内容。",
        category: "开发与文本",
        tags: &["对比", "diff", "文本", "代码", "合并"],
        aliases: &["两文件对比", "文件对比", "差异对比", "文本比较", "代码对比", "diff", "compare", "版本对比"],
    },
    ToolDescriptor {
        id: "markdown.editor",
        name: "Markdown 编辑器",
        description: "全屏 Markdown 编辑与预览，可选择正文或 H1～H6 标题、自定义表格行列数，支持草稿自动保存以及 Markdown / HTML 导出。",
        category: "文件与文档",
        tags: &["Markdown", "编辑器", "笔记", "文档", "预览", "表格", "标题"],
        aliases: &["markdown", "md", "Markdown编辑器", "md编辑器", "笔记", "写作", "markdown预览"],
    },
    ToolDescriptor {
        id: "domain.whois",
        name: "Whois 查询",
        description: "查询域名注册商、注册与到期时间、状态和域名服务器",
        category: "开发与文本",
        tags: &["Whois", "RDAP", "域名"],
        aliases: &["domain lookup", "whois"],
    },
    ToolDescriptor {
        id: "network.ip",
        name: "IP 查询",
        description: "查询 IP 归属地区、运营商与网络机构，留空可查询当前出口地址。",
        category: "开发与文本",
        tags: &["IP", "归属", "网络"],
        aliases: &["ip lookup", "ip address"],
    },
    ToolDescriptor {
        id: "news.briefing",
        name: "60秒早报",
        description: "按日期阅读每日新闻摘要，复制与保存全文",
        category: "生活与查询",
        tags: &["早报", "新闻", "60秒"],
        aliases: &["daily briefing", "60s news"],
    },
    ToolDescriptor {
        id: "news.it",
        name: "IT快讯",
        description: "从 IT之家官方 RSS 阅读最新科技新闻，支持筛选与复制文章链接。",
        category: "生活与查询",
        tags: &["科技", "IT之家", "快讯"],
        aliases: &["it news", "ithome"],
    },
    ToolDescriptor {
        id: "health.bmi",
        name: "BMI 计算器",
        description: "输入身高与体重，计算成人体质指数与正常体重范围。",
        category: "生活与查询",
        tags: &["BMI", "身高", "体重", "健康"],
        aliases: &["bmi calculator", "体质指数", "体重指数"],
    },
    ToolDescriptor {
        id: "phone.location",
        name: "手机号归属地",
        description: "查询中国大陆手机号的号码段地区和运营商",
        category: "生活与查询",
        tags: &["手机号", "归属地", "运营商", "号码段"],
        aliases: &["phone lookup", "手机归属地", "归属地查询"],
    },
    ToolDescriptor {
        id: "image.base64",
        name: "图片与Base64互转",
        description: "图片与 Base64 双向转换，保留原始图片内容，支持预览、复制和保存。",
        category: "图片与影音",
        tags: &["图片", "Base64", "Data URL", "转换"],
        aliases: &[
            "image base64",
            "base64 image",
            "Base64 转图片",
            "图片转 Base64",
            "图片转Base64",
        ],
    },
    ToolDescriptor {
        id: "image.stitch",
        name: "图片拼接",
        description: "横向、纵向或网格拼接图片，调整图片顺序、间距与背景。",
        category: "图片与影音",
        tags: &["图片", "拼接", "长图", "网格"],
        aliases: &["image stitch", "image collage", "图片合并"],
    },
    ToolDescriptor {
        id: "image.compress",
        name: "图片压缩",
        description: "在本机调整图片质量，比较压缩前后的文件大小。",
        category: "图片与影音",
        tags: &["图片", "压缩", "JPEG", "WebP"],
        aliases: &["image compress", "图片瘦身"],
    },
    ToolDescriptor {
        id: "image.convert",
        name: "图片格式转换",
        description: "离线转换 PNG、JPEG、WebP、TIFF、AVIF、JXL 等格式，支持大图片，保留透明背景或填充颜色。",
        category: "图片与影音",
        tags: &["图片", "格式", "PNG", "JPEG", "WebP", "TIFF", "AVIF", "JXL"],
        aliases: &["image convert", "图片转换"],
    },
    ToolDescriptor {
        id: "image.watermark",
        name: "图片水印",
        description: "离线添加文字或图片水印，支持平铺、四角、居中、透明度、大小与角度，保留原图尺寸并支持透明图片。",
        category: "图片与影音",
        tags: &["图片", "水印", "文字", "透明度", "旋转"],
        aliases: &["image watermark", "添加水印"],
    },
    ToolDescriptor {
        id: "image.pixelate",
        name: "图片像素化",
        description: "离线通过像素块大小调整马赛克效果，保留原图尺寸与透明背景。",
        category: "图片与影音",
        tags: &["图片", "像素", "马赛克", "模糊"],
        aliases: &["image pixelate", "图片马赛克"],
    },
    ToolDescriptor {
        id: "audio.compress",
        name: "音频压缩",
        description: "离线调整音频质量、码率、采样率与声道，比较压缩大小，文件无需上传。",
        category: "图片与影音",
        tags: &["音频", "压缩", "码率", "MP3", "Opus"],
        aliases: &["audio compress", "音频瘦身"],
    },
    ToolDescriptor {
        id: "audio.convert",
        name: "音频格式转换",
        description: "离线互转 MP3、M4A、WAV、FLAC、OGG、Opus，文件无需上传。",
        category: "图片与影音",
        tags: &["音频", "格式", "MP3", "WAV", "FLAC", "OGG"],
        aliases: &["audio convert", "音频格式互转"],
    },
    ToolDescriptor {
        id: "video.speed",
        name: "视频倍速",
        description: "离线快放或慢放视频，保持音调并选择输出质量，文件无需上传。",
        category: "图片与影音",
        tags: &["视频", "倍速", "慢放", "变速"],
        aliases: &["video speed", "视频变速"],
    },
    ToolDescriptor {
        id: "audio.speed",
        name: "音频倍速",
        description: "离线进行 0.25～4 倍音频变速，可保持原始音调，文件无需上传。",
        category: "图片与影音",
        tags: &["音频", "倍速", "音调", "慢放"],
        aliases: &["audio speed", "音频变速"],
    },
    ToolDescriptor {
        id: "image.pdf",
        name: "图片转 PDF",
        description: "离线排序多张图片，选择纸张、方向、边距与质量生成 PDF，检查首页预览后保存，文件无需上传。",
        category: "文件与文档",
        tags: &["图片", "PDF", "转换", "排序"],
        aliases: &["image to pdf", "图片合成PDF"],
    },
    ToolDescriptor {
        id: "pdf.image",
        name: "PDF 转图片",
        description: "离线按页码与 DPI 输出 PNG/JPEG，检查首页预览后打包保存为 ZIP，文件无需上传。",
        category: "文件与文档",
        tags: &["PDF", "图片", "页码", "PNG", "JPEG"],
        aliases: &["pdf to image", "PDF转图片"],
    },
    ToolDescriptor {
        id: "pdf.merge",
        name: "PDF 合并",
        description: "离线调整多个 PDF 的顺序与页码范围，合并为一个文件，检查首页预览后保存，文件无需上传。",
        category: "文件与文档",
        tags: &["PDF", "合并", "顺序", "页码"],
        aliases: &["pdf merge", "合并PDF"],
    },
    ToolDescriptor {
        id: "document.pdf",
        name: "文档转 PDF",
        description: "离线将 DOCX、TXT、Markdown、HTML 重排为中文 PDF，检查首页预览后保存，文件无需上传。",
        category: "文件与文档",
        tags: &["文档", "PDF", "DOCX", "TXT", "Markdown"],
        aliases: &["document to pdf", "Word转PDF"],
    },
    ToolDescriptor {
        id: "pdf.document",
        name: "PDF 转文档",
        description: "离线导出文字或图片版 DOCX、TXT、Markdown、HTML，检查首页预览后保存，文件无需上传。",
        category: "文件与文档",
        tags: &["PDF", "DOCX", "文字", "文档"],
        aliases: &["pdf to document", "PDF转Word"],
    },
    ToolDescriptor {
        id: "text.count",
        name: "字数统计",
        description: "实时统计总字符、不含空格字符、字符类型、行数与英文字词，支持中文、英文及 Unicode 文本。",
        category: "开发与文本",
        tags: &["文本", "字数", "字符", "空格", "行数"],
        aliases: &["word count", "文本统计"],
    },
    ToolDescriptor {
        id: "boxoffice.live",
        name: "实时票房",
        description: "猫眼官方电影票房与排片看板，支持内嵌、刷新和独立打开",
        category: "生活与查询",
        tags: &["票房", "电影", "猫眼", "实时"],
        aliases: &["box office", "电影票房"],
    },
    ToolDescriptor {
        id: "image.ocr",
        name: "文字识别",
        description: "离线识别中文、英文和日文，框选文字区域并复制或保存结果，图片留在本机。",
        category: "趣味与AI",
        tags: &["OCR", "识别", "文字", "图片", "中英文", "日文", "裁剪"],
        aliases: &["ocr", "图片转文字"],
    },
    ToolDescriptor {
        id: "ai.resources",
        name: "AI 资源精选",
        description: "公开提示词、官方 Skills 精选与 AI 导航入口",
        category: "趣味与AI",
        tags: &["AI", "提示词", "Skills", "导航"],
        aliases: &["AI prompts", "AI导航"],
    },
    ToolDescriptor {
        id: "unit.convert",
        name: "单位换算",
        description: "长度、面积、体积、重量、温度、速度、时间与容量换算",
        category: "生活与查询",
        tags: &["单位", "换算", "温度", "重量", "容量"],
        aliases: &["unit convert", "单位转换"],
    },
    ToolDescriptor {
        id: "math.calculate",
        name: "科学计算器",
        description: "括号、百分比、幂、三角函数与本地计算历史",
        category: "生活与查询",
        tags: &["计算器", "数学", "科学", "百分比"],
        aliases: &["calculator", "科学计算"],
    },
    ToolDescriptor {
        id: "text.replace",
        name: "文本批量替换",
        description: "顺序执行普通或正则替换规则，预览修改结果",
        category: "开发与文本",
        tags: &["文本", "替换", "正则", "批量"],
        aliases: &["text replace", "批量替换"],
    },
    ToolDescriptor {
        id: "data.convert",
        name: "CSV / JSON 互转",
        description: "分隔符、表头、字段选择与结构化数据导出",
        category: "文件与文档",
        tags: &["CSV", "JSON", "TSV", "转换", "表格"],
        aliases: &["csv json", "数据转换"],
    },
    ToolDescriptor {
        id: "zip.manage",
        name: "ZIP 压缩与解压",
        description: "离线将多个文件打包为 ZIP，浏览归档目录并选择文件提取。",
        category: "文件与文档",
        tags: &["ZIP", "压缩", "解压", "文件"],
        aliases: &["zip archive", "文件解压"],
    },
    ToolDescriptor {
        id: "media.info",
        name: "媒体文件信息",
        description: "离线读取容器与音视频流信息，查看编码、时长、分辨率、帧率、码率与音频参数，不转码、不上传。",
        category: "文件与文档",
        tags: &["媒体", "信息", "编码", "码率", "帧率"],
        aliases: &["media info", "媒体属性"],
    },
    ToolDescriptor {
        id: "audio.edit",
        name: "音频剪辑",
        description: "选择起止片段、淡入淡出，试听并导出音频",
        category: "图片与影音",
        tags: &["音频", "剪辑", "截取", "淡入", "淡出"],
        aliases: &["audio edit", "音频截取"],
    },
    ToolDescriptor {
        id: "video.edit",
        name: "视频剪辑",
        description: "截取片段、裁剪画面、旋转、镜像与静音导出",
        category: "图片与影音",
        tags: &["视频", "剪辑", "裁剪", "旋转", "静音"],
        aliases: &["video edit", "视频截取"],
    },
    ToolDescriptor {
        id: "image.edit",
        name: "图片裁剪与旋转",
        description: "自由或固定比例裁剪、旋转、镜像并保存图片",
        category: "图片与影音",
        tags: &["图片", "裁剪", "旋转", "镜像"],
        aliases: &["image crop", "图片编辑"],
    },
    ToolDescriptor {
        id: "pdf.pages",
        name: "PDF 页面管理",
        description: "通过缩略图选页、删除、重排、旋转与拆分 PDF，离线保存导出。",
        category: "文件与文档",
        tags: &["PDF", "页面", "拆分", "旋转", "排序"],
        aliases: &["pdf pages", "PDF拆分"],
    },
    ToolDescriptor {
        id: "video.compress",
        name: "视频压缩",
        description: "选择 1080p、720p、360p 等清晰度和质量，离线压缩视频，文件无需上传。",
        category: "图片与影音",
        tags: &["视频", "压缩", "清晰度", "1080p"],
        aliases: &["video compress"],
    },
    ToolDescriptor {
        id: "video.audio",
        name: "视频转音频",
        description: "离线从视频提取 MP3、M4A、WAV、FLAC、OGG 或 Opus 音频，文件无需上传。",
        category: "图片与影音",
        tags: &["视频", "音频", "MP3", "WAV"],
        aliases: &["video to audio"],
    },
    ToolDescriptor {
        id: "video.convert",
        name: "视频格式转换",
        description: "离线互转 MP4、WebM、MKV、MOV、AVI，选择输出质量，文件无需上传。",
        category: "图片与影音",
        tags: &["视频", "格式", "MP4", "WebM"],
        aliases: &["video convert"],
    },
    ToolDescriptor {
        id: "video.gif",
        name: "视频转 GIF",
        description: "离线选择片段、帧率、清晰度和色彩质量，生成 GIF 动图，文件无需上传。",
        category: "图片与影音",
        tags: &["视频", "GIF", "动图", "帧率"],
        aliases: &["video to gif"],
    },
    ToolDescriptor {
        id: "gif.video",
        name: "GIF 转视频",
        description: "离线保留动画帧时间，将 GIF 转为 MP4 或 WebM，文件无需上传。",
        category: "图片与影音",
        tags: &["GIF", "视频", "动画", "MP4"],
        aliases: &["gif to video"],
    },
    ToolDescriptor {
        id: "weather.forecast",
        name: "天气预报",
        description: "选择中国气象或全球来源与城市，查看实况、七天预报、降水、风及日出日落。",
        category: "生活与查询",
        tags: &["天气", "气象", "温度", "预报", "空气质量"],
        aliases: &["weather", "天气查询"],
    },
    ToolDescriptor {
        id: "date.calendar",
        name: "万年历",
        description: "查看公历、农历、节气与节日，支持农历转公历和日期跳转。",
        category: "生活与查询",
        tags: &["日历", "农历", "节气", "节日", "黄历"],
        aliases: &["calendar", "lunar calendar"],
    },
    ToolDescriptor {
        id: "qr.generate",
        name: "二维码生成",
        description: "生成文字、网址、Wi-Fi 与联系人二维码，支持配色、图标、多种图片格式及矢量导出。",
        category: "开发与文本",
        tags: &["二维码", "QR", "Wi-Fi", "SVG", "生成"],
        aliases: &["qrcode generate", "qr encode"],
    },
    ToolDescriptor {
        id: "morse.convert",
        name: "摩斯电码",
        description: "英文、数字、常用标点与摩斯电码互转，字母用空格分隔、单词用 / 分隔。",
        category: "开发与文本",
        tags: &["摩斯", "电码", "Morse", "编码"],
        aliases: &["morse code", "摩尔斯电码"],
    },
    ToolDescriptor {
        id: "image.hidden",
        name: "隐藏图",
        description: "生成类似幻影坦克的透明 PNG，亮背景显示一张图、暗背景显示另一张图，支持亮度及色彩调整。",
        category: "图片与影音",
        tags: &["图片", "隐藏", "幻影坦克", "透明", "PNG"],
        aliases: &["mirage tank", "隐藏图片"],
    },
    ToolDescriptor {
        id: "family.kinship",
        name: "亲戚称呼",
        description: "按关系链计算亲戚称呼，支持姻亲与长幼关系，也可反向查看对方怎么称呼你。",
        category: "生活与查询",
        tags: &["亲戚", "称呼", "关系", "家庭", "辈分"],
        aliases: &["kinship", "亲戚关系计算器"],
    },
    ToolDescriptor {
        id: "firefly.meow",
        name: "流萤喵语",
        description: "把文字变成喵语或自动连续还原原文，兼容项目原版四字符三连映射。",
        category: "开发与文本",
        tags: &["流萤", "喵语", "编码", "还原"],
        aliases: &["meow", "喵语转换"],
    },
    ToolDescriptor {
        id: "image.search",
        name: "以图搜图",
        description: "选择九个常用图片及动画截图检索网站，打开后上传图片或粘贴图片链接。",
        category: "图片与影音",
        tags: &["图片", "搜图", "识图", "Google", "Yandex", "TinEye", "动画"],
        aliases: &[
            "reverse image search",
            "图片搜索",
            "搜狗",
            "百度",
            "360",
            "trace.moe",
            "IQDB",
            "SauceNAO",
        ],
    },
    ToolDescriptor {
        id: "fun.reaction",
        name: "反应力测试",
        description: "按住中间卡片等待，变绿并出现“抬起”时立即松开，记录最快与近五次平均成绩。",
        category: "趣味与AI",
        tags: &["反应", "测试", "速度", "成绩"],
        aliases: &["reaction test", "反应速度"],
    },
    ToolDescriptor {
        id: "random.generate",
        name: "随机生成",
        description: "在本机生成随机整数或字符串，自定义范围、数量与字符库。",
        category: "趣味与AI",
        tags: &["随机", "数字", "字符串", "生成"],
        aliases: &["random", "随机数"],
    },
    ToolDescriptor {
        id: "link.shortener",
        name: "短链接生成与还原",
        description: "选择免费服务生成短链接，支持 suo.yt 自定义短码，或通过服务器跳转还原目标地址。",
        category: "效率工具",
        tags: &["链接", "短链", "还原", "网址"],
        aliases: &[
            "short url",
            "expand url",
            "短网址",
            "suo.yt",
            "spoo.me",
            "ulvis.net",
        ],
    },
    ToolDescriptor {
        id: "poem.acrostic",
        name: "藏头诗生成",
        description: "输入藏头汉字，从已有诗句组合五言或七言藏头诗。",
        category: "趣味与AI",
        tags: &["藏头诗", "诗句", "生成"],
        aliases: &["acrostic poem"],
    },
    ToolDescriptor {
        id: "translate.baidu",
        name: "翻译",
        description: "选择百度、有道、谷歌、搜狗、DeepL 或必应翻译，在网站内输入文字或上传支持的文件。",
        category: "开发与文本",
        tags: &[
            "翻译", "百度", "有道", "谷歌", "搜狗", "DeepL", "必应", "中英",
        ],
        aliases: &[
            "translate",
            "translation",
            "youdao",
            "google translate",
            "sogou",
        ],
    },
    ToolDescriptor {
        id: "password.generate",
        name: "密码生成",
        description: "设置字符范围，生成 6–32 位安全随机密码，支持复制与收藏；也可输入密码实时查看强度。",
        category: "开发与文本",
        tags: &["密码", "随机", "强度", "收藏"],
        aliases: &["password generator"],
    },
    ToolDescriptor {
        id: "fun.woodfish",
        name: "电子木鱼",
        description: "敲击木鱼、声音开关与本次和累计计数",
        category: "趣味与AI",
        tags: &["木鱼", "敲击", "放松"],
        aliases: &["wooden fish"],
    },
    ToolDescriptor {
        id: "flowers.catalog",
        name: "花语大全",
        description: "查看常见花卉的寓意、颜色、自然花期与四季供应参考，为爱情、友情、亲情和祝福挑选心意。",
        category: "生活与查询",
        tags: &["花语", "花卉", "爱情", "友情", "亲情"],
        aliases: &["flower meanings"],
    },
    ToolDescriptor {
        id: "earth.globe",
        name: "地球仪",
        description: "离线探索地球，拖动旋转、缩放，查看国家或地区名称，搜索定位并查看经纬度。",
        category: "生活与查询",
        tags: &["地球", "地图", "经纬度", "国家", "地区"],
        aliases: &["globe", "earth"],
    },
    ToolDescriptor {
        id: "dev.commands",
        name: "常用命令",
        description: "离线查询 Linux、Git、SQL、ADB、Curl、Python、NPM 等十类常用命令，并复制示例。",
        category: "开发与文本",
        tags: &[
            "命令", "Linux", "Git", "SQL", "ADB", "Curl", "Python", "NPM",
        ],
        aliases: &["command cheatsheet", "Markdown", "Docker", "Windows"],
    },
    ToolDescriptor {
        id: "fuel.price",
        name: "全国油价查询",
        description: "查询全国 31 个省级地区的汽油和柴油参考价格",
        category: "生活与查询",
        tags: &["油价", "汽油", "柴油", "92", "95", "98"],
        aliases: &["fuel price", "全国油价"],
    },
    ToolDescriptor {
        id: "gold.price",
        name: "今日黄金价格",
        description: "国际现货、国内参考、品牌零售、投资金条与回收报价",
        category: "生活与查询",
        tags: &["黄金", "金价", "贵金属", "回收", "金条", "XAU"],
        aliases: &["gold price"],
    },
    ToolDescriptor {
        id: "time.world",
        name: "世界时间",
        description: "查看全球主要城市的当前时间与时差，自动按各地时区和夏令时规则显示，支持收藏常用城市。",
        category: "生活与查询",
        tags: &["时间", "时区", "城市", "世界", "夏令时"],
        aliases: &["world clock", "timezone"],
    },
    ToolDescriptor {
        id: "text.magic",
        name: "魔法内容",
        description: "按间隔在内容中插入不可见字符，支持类型选择、清理指定类型和位置预览。",
        category: "趣味与AI",
        tags: &["魔法", "零宽", "不可见", "文本"],
        aliases: &["invisible text", "zero width", "魔法文字"],
    },
    ToolDescriptor {
        id: "color.palettes",
        name: "配色方案",
        description: "按风格与颜色挑选 64 组离线配色，支持分类搜索、收藏和 HEX/CSS/SVG 导出，点击色块复制 HEX。",
        category: "图片与影音",
        tags: &["配色", "颜色", "调色板", "HEX", "CSS"],
        aliases: &["color palette", "颜色搭配"],
    },
    ToolDescriptor {
        id: "icon.design",
        name: "图标设计",
        description: "用图标或文字设计应用图标，调整圆角、内容比例与背景色，导出 PNG 或 Windows ICO。",
        category: "图片与影音",
        tags: &["图标", "设计", "PNG", "ICO", "圆角"],
        aliases: &["app icon", "icon maker"],
    },
    ToolDescriptor {
        id: "rc4.convert",
        name: "RC4互转",
        description: "RC4 加密解密，支持 UTF-8、HEX、Base64 和 RC4-drop",
        category: "开发与文本",
        tags: &["RC4", "加密", "解密", "HEX", "Base64"],
        aliases: &["RC4 cipher", "RC4转换"],
    },
    ToolDescriptor {
        id: "drawing.board",
        name: "画板",
        description: "全屏矢量画板：画笔、荧光笔、直线、箭头、矩形、椭圆、三角、菱形、星形、文字与橡皮，随心调色与粗细；画板可一键切换横版 / 竖版（内容自动居中适应），可导入底图、换底色与网格，支持缩放平移、撤销重做、草稿自动保存，并能导出 PNG / JPG / SVG 或保存工程文件",
        category: "图片与影音",
        tags: &["画板", "绘图", "标注", "涂鸦", "白板"],
        aliases: &["画板", "白板", "涂鸦", "绘图", "标注", "画图", "drawing"],
    },
    ToolDescriptor {
        id: "mind.map",
        name: "思维导图",
        description: "全屏思维导图：双击改文字、Tab 加子节点、回车加同级，节点颜色按分支继承；支持折叠分支、拖动节点改父级、双向或右向布局、撤销重做、拖拽平移与缩放；可保存工程、导出 PNG / SVG / Markdown 大纲，含 5 套模板与草稿自动保存",
        category: "效率工具",
        tags: &["思维导图", "脑图", "梳理", "结构", "大纲"],
        aliases: &["思维导图", "脑图", "mindmap", "mind map", "导图", "结构图", "大纲"],
    },
    ToolDescriptor {
        id: "image.color",
        name: "图片取色",
        description: "导入图片，移动鼠标或手指读取原图像素颜色，拖动放大镜精细定位，支持 HEX/RGB/HSL 和复制。",
        category: "图片与影音",
        tags: &["取色", "颜色", "放大镜", "HEX", "RGB", "HSL"],
        aliases: &["color picker", "image eyedropper"],
    },
    ToolDescriptor {
        id: "currency.exchange",
        name: "汇率转换",
        description: "全球币种每日参考汇率，显示来源日期并在本机换算",
        category: "生活与查询",
        tags: &["汇率", "货币", "人民币", "美元"],
        aliases: &["exchange rate", "currency converter"],
    },
    ToolDescriptor {
        id: "currency.today",
        name: "今日汇率",
        description: "人民币基准的每日外币参考汇率、双向对照与来源日期",
        category: "生活与查询",
        tags: &["汇率", "人民币", "货币", "今日", "美元"],
        aliases: &["daily exchange rates", "CNY rates"],
    },
];

#[derive(Clone, Debug, Serialize)]
pub struct ToolError {
    pub code: &'static str,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl ToolError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            line: None,
            column: None,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct DetectionResult {
    pub type_id: &'static str,
    pub label: &'static str,
    pub confidence: f32,
    pub actions: Vec<DetectionAction>,
}

#[derive(Clone, Serialize)]
pub struct DetectionAction {
    pub id: String,
    pub label: String,
    pub tool_id: String,
}

pub fn list_tools() -> &'static [ToolDescriptor] {
    TOOLS
}

pub fn tool_exists(id: &str) -> bool {
    TOOLS.iter().any(|tool| tool.id == id)
}

pub fn search_tools(query: &str) -> Vec<ToolDescriptor> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return TOOLS.to_vec();
    }
    TOOLS
        .iter()
        .filter(|tool| {
            tool.name.to_lowercase().contains(&query)
                || tool.description.to_lowercase().contains(&query)
                || tool.category.to_lowercase().contains(&query)
                || tool
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains(&query))
                || tool
                    .aliases
                    .iter()
                    .any(|alias| alias.to_lowercase().contains(&query))
        })
        .cloned()
        .collect()
}

pub fn format_json(input: &str) -> Result<String, ToolError> {
    if input.trim().is_empty() {
        return Err(ToolError::new("empty_input", "请输入 JSON 内容。"));
    }
    if input.len() > MAX_TEXT_BYTES {
        return Err(ToolError::new("input_too_large", "输入超过 1 MiB 限制。"));
    }
    let value: serde_json::Value = serde_json::from_str(input).map_err(|error| ToolError {
        code: "invalid_json",
        message: format!("JSON 语法错误：{error}"),
        line: Some(error.line()),
        column: Some(error.column()),
    })?;
    let output = serde_json::to_string_pretty(&value)
        .map_err(|_| ToolError::new("format_failed", "无法格式化 JSON。"))?;
    if output.len() > MAX_OUTPUT_BYTES {
        return Err(ToolError::new("output_too_large", "结果超过 4 MiB 限制。"));
    }
    Ok(output)
}

fn parse_hex_color(input: &str) -> Result<(u8, u8, u8), ToolError> {
    let value = input.trim().strip_prefix('#').unwrap_or(input.trim());
    let expanded = match value.len() {
        3 if value.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            value.chars().flat_map(|ch| [ch, ch]).collect::<String>()
        }
        6 if value.bytes().all(|byte| byte.is_ascii_hexdigit()) => value.to_owned(),
        _ => {
            return Err(ToolError::new(
                "invalid_color",
                "请输入 #RGB 或 #RRGGBB 颜色值。",
            ))
        }
    };
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&expanded[range], 16).unwrap();
    Ok((parse(0..2), parse(2..4), parse(4..6)))
}

fn parse_rgb_color(input: &str) -> Result<(u8, u8, u8), ToolError> {
    let value = input.trim();
    let inner = value
        .strip_prefix("rgb(")
        .and_then(|part| part.strip_suffix(')'))
        .ok_or_else(|| ToolError::new("invalid_color", "请输入 rgb(红, 绿, 蓝) 颜色值。"))?;
    let components = inner
        .split(',')
        .map(|part| part.trim().parse::<u8>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ToolError::new("invalid_color", "RGB 分量必须是 0 到 255 的整数。"))?;
    if components.len() != 3 {
        return Err(ToolError::new("invalid_color", "RGB 必须包含三个分量。"));
    }
    Ok((components[0], components[1], components[2]))
}

fn valid_percent_encoding(input: &str) -> bool {
    let bytes = input.as_bytes();
    (0..bytes.len()).all(|index| {
        bytes[index] != b'%'
            || (index + 2 < bytes.len()
                && bytes[index + 1].is_ascii_hexdigit()
                && bytes[index + 2].is_ascii_hexdigit())
    })
}

fn decode_jwt(input: &str) -> Result<String, ToolError> {
    let parts: Vec<_> = input.trim().splitn(4, '.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        return Err(ToolError::new(
            "invalid_jwt",
            "JWT 应包含 Header、Payload 和签名三段。",
        ));
    }
    let decode = |part: &str| -> Result<serde_json::Value, ToolError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(part)
            .map_err(|_| ToolError::new("invalid_jwt", "JWT 编码无效。"))?;
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| ToolError::new("invalid_jwt", "JWT Header 或 Payload 不是有效 JSON。"))?;
        if !value.is_object() {
            return Err(ToolError::new(
                "invalid_jwt",
                "JWT Header 和 Payload 必须是 JSON 对象。",
            ));
        }
        Ok(value)
    };
    let header = decode(parts[0])?;
    let payload = decode(parts[1])?;
    Ok(format!(
        "Header:\n{}\n\nPayload:\n{}\n\n注意：仅解析内容，未验证签名。",
        serde_json::to_string_pretty(&header).unwrap(),
        serde_json::to_string_pretty(&payload).unwrap()
    ))
}

pub fn run_tool(tool_id: &str, action: &str, input: &str) -> Result<String, ToolError> {
    if input.is_empty() && (tool_id, action) != ("uuid.generate", "generate") {
        return Err(ToolError::new("empty_input", "请输入内容。"));
    }
    if input.len() > MAX_TEXT_BYTES {
        return Err(ToolError::new("input_too_large", "输入超过 1 MiB 限制。"));
    }
    let output = match (tool_id, action) {
        ("unicode.convert", "encode") => unicode::encode(input),
        ("unicode.convert", "decode") => unicode::decode(input)?,
        ("unicode.convert", "to_points") => unicode::points(input),
        ("unicode.convert", "from_points") => unicode::from_points(input)?,
        (id, "open") if interactive_tool(id) => {
            return Err(ToolError::new(
                "interactive_tool",
                "请打开工具界面使用此功能。",
            ))
        }
        ("json.format", "format") => return format_json(input),
        ("base64.convert", "encode") => STANDARD.encode(input),
        ("base64.convert", "decode") => {
            let bytes = STANDARD
                .decode(input.trim())
                .map_err(|_| ToolError::new("invalid_base64", "Base64 内容无效。"))?;
            String::from_utf8(bytes)
                .map_err(|_| ToolError::new("invalid_utf8", "解码结果不是 UTF-8 文本。"))?
        }
        ("url.convert", "encode") => utf8_percent_encode(input, URL_COMPONENT_SET).to_string(),
        ("url.convert", "decode") => {
            if !valid_percent_encoding(input) {
                return Err(ToolError::new(
                    "invalid_url_encoding",
                    "URL 百分号编码无效。",
                ));
            }
            percent_decode_str(input)
                .decode_utf8()
                .map_err(|_| ToolError::new("invalid_utf8", "解码结果不是 UTF-8 文本。"))?
                .into_owned()
        }
        ("sha256.hash", "hash") => format!("{:x}", Sha256::digest(input.as_bytes())),
        ("sha256.hash", "md5") => format!("{:x}", md5::Md5::digest(input.as_bytes())),
        ("sha256.hash", "sha1") => format!("{:x}", sha1::Sha1::digest(input.as_bytes())),
        ("sha256.hash", "sha224") => format!("{:x}", sha2::Sha224::digest(input.as_bytes())),
        ("sha256.hash", "sha384") => format!("{:x}", sha2::Sha384::digest(input.as_bytes())),
        ("sha256.hash", "sha512") => format!("{:x}", sha2::Sha512::digest(input.as_bytes())),
        ("time.unix", "to_date") => {
            let raw = input.trim();
            let number = raw
                .parse::<i64>()
                .map_err(|_| ToolError::new("invalid_timestamp", "请输入 Unix 秒或毫秒整数。"))?;
            let date = if raw.trim_start_matches('-').len() >= 12 {
                Utc.timestamp_millis_opt(number).single()
            } else {
                Utc.timestamp_opt(number, 0).single()
            }
            .ok_or_else(|| ToolError::new("invalid_timestamp", "时间戳超出支持范围。"))?;
            date.to_rfc3339()
        }
        ("time.unix", "to_timestamp") => {
            let raw = input.trim();
            let date = DateTime::parse_from_rfc3339(raw)
                .map(|date| date.with_timezone(&Utc))
                .or_else(|_| {
                    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S")
                        .map(|date| DateTime::<Utc>::from_naive_utc_and_offset(date, Utc))
                })
                .map_err(|_| {
                    ToolError::new(
                        "invalid_date",
                        "请输入 RFC 3339 日期或 YYYY-MM-DD HH:MM:SS（UTC）。",
                    )
                })?;
            date.timestamp().to_string()
        }
        ("uuid.generate", "generate") => Uuid::new_v4().to_string(),
        ("uuid.generate", "validate") => Uuid::parse_str(input.trim())
            .map_err(|_| ToolError::new("invalid_uuid", "UUID 格式无效。"))?
            .to_string(),
        ("text.dedup", "dedup") => {
            let mut seen = HashSet::new();
            input
                .lines()
                .filter(|line| seen.insert(*line))
                .collect::<Vec<_>>()
                .join("\n")
        }
        ("text.case", "upper") => input.to_uppercase(),
        ("text.case", "lower") => input.to_lowercase(),
        ("color.convert", "to_rgb") => {
            let (red, green, blue) = parse_hex_color(input)?;
            format!("rgb({red}, {green}, {blue})")
        }
        ("color.convert", "to_hex") => {
            let (red, green, blue) = parse_rgb_color(input)?;
            format!("#{red:02X}{green:02X}{blue:02X}")
        }
        ("jwt.decode", "decode") => decode_jwt(input)?,
        _ => return Err(ToolError::new("unknown_action", "不支持此工具操作。")),
    };
    if output.len() > MAX_OUTPUT_BYTES {
        return Err(ToolError::new("output_too_large", "结果超过 4 MiB 限制。"));
    }
    Ok(output)
}

pub fn detect_text(input: &str) -> Vec<DetectionResult> {
    if input.trim().is_empty() || input.len() > MAX_TEXT_BYTES {
        return Vec::new();
    }
    let value = input.trim();
    let mut results = Vec::new();
    let mut add = |type_id, label, confidence, id: &str, action_label: &str, tool_id: &str| {
        results.push(DetectionResult {
            type_id,
            label,
            confidence,
            actions: vec![DetectionAction {
                id: id.to_owned(),
                label: action_label.to_owned(),
                tool_id: tool_id.to_owned(),
            }],
        });
    };
    if matches!(
        serde_json::from_str::<serde_json::Value>(value),
        Ok(serde_json::Value::Object(_) | serde_json::Value::Array(_))
    ) {
        add("json", "JSON", 1.0, "format", "格式化 JSON", "json.format");
    }
    if decode_jwt(value).is_ok() {
        add(
            "jwt",
            "JWT",
            1.0,
            "decode",
            "解析 JWT（不验证签名）",
            "jwt.decode",
        );
    }
    if Uuid::parse_str(value).is_ok() {
        add(
            "uuid",
            "UUID",
            if value.len() == 32 { 0.4 } else { 1.0 },
            "validate",
            "校验 UUID",
            "uuid.generate",
        );
    }
    let digits = value.strip_prefix('-').unwrap_or(value);
    let timestamp = value.parse::<i64>().ok().and_then(|number| {
        if digits.len() >= 12 {
            Utc.timestamp_millis_opt(number).single()
        } else {
            Utc.timestamp_opt(number, 0).single()
        }
    });
    if !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()) && timestamp.is_some()
    {
        // Other integer lengths can be IDs or phone numbers. Keep manual
        // suggestions, but never auto-prompt for these ambiguous numbers.
        let confidence = if matches!(digits.len(), 9 | 10 | 12 | 13) && !digits.starts_with('0') {
            0.8
        } else {
            0.35
        };
        add(
            "unix_timestamp",
            "Unix 时间戳",
            confidence,
            "to_date",
            "转 UTC 日期",
            "time.unix",
        );
    }
    if value.len() >= 4
        && STANDARD
            .decode(value)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .is_some_and(|decoded| {
                decoded
                    .chars()
                    .all(|ch| !ch.is_control() || matches!(ch, '\r' | '\n' | '\t'))
            })
    {
        add(
            "base64",
            "Base64",
            if value.len() >= 8 { 0.65 } else { 0.45 },
            "decode",
            "解码 Base64",
            "base64.convert",
        );
    }
    if value.contains('%')
        && valid_percent_encoding(value)
        && percent_decode_str(value)
            .decode_utf8()
            .is_ok_and(|decoded| decoded != value)
    {
        add(
            "url_encoding",
            "URL 编码",
            0.7,
            "decode",
            "URL 解码",
            "url.convert",
        );
    }
    if !value.chars().any(char::is_whitespace)
        && url::Url::parse(value)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
    {
        add("url", "网址", 0.9, "encode", "URL 编码", "url.convert");
    }
    if value.starts_with('#') && parse_hex_color(value).is_ok() {
        add(
            "hex_color",
            "HEX 颜色",
            0.95,
            "to_rgb",
            "转 RGB",
            "color.convert",
        );
    }
    if value.starts_with("rgb(") && parse_rgb_color(value).is_ok() {
        add(
            "rgb_color",
            "RGB 颜色",
            0.95,
            "to_hex",
            "转 HEX",
            "color.convert",
        );
    }
    if DateTime::parse_from_rfc3339(value).is_ok()
        || NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").is_ok()
    {
        add(
            "datetime",
            "日期时间",
            0.9,
            "to_timestamp",
            "转时间戳",
            "time.unix",
        );
    }
    if results.iter().all(|result| result.confidence < 0.5) {
        results.push(DetectionResult {
            type_id: "text",
            label: "普通文本",
            confidence: 0.2,
            actions: vec![],
        });
    }
    // Suggestions come from registered action contracts, never by executing a script.
    for result in &mut results {
        for tool in list_tools() {
            for action in tool_actions(tool.id) {
                if action.input_types.contains(&result.type_id)
                    && !result
                        .actions
                        .iter()
                        .any(|item| item.tool_id == tool.id && item.id == action.id)
                {
                    result.actions.push(DetectionAction {
                        id: action.id.into(),
                        label: format!("{} · {}", tool.name, action.label),
                        tool_id: tool.id.into(),
                    });
                }
            }
        }
    }
    results.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_hash_algorithms_preserve_exact_utf8_input_and_legacy_sha256_action() {
        assert_eq!(
            run_tool("sha256.hash", "hash", "abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            run_tool("sha256.hash", "md5", "abc").unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha1", "abc").unwrap(),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha224", "abc").unwrap(),
            "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7"
        );
        assert_eq!(run_tool("sha256.hash", "sha384", "abc").unwrap(), "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
        assert_eq!(run_tool("sha256.hash", "sha512", "abc").unwrap(), "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
        assert_eq!(
            run_tool("sha256.hash", "hash", "流萤\n ").unwrap(),
            "60fdc3c7331035418164ae2c779beb1a62b48df2efa57229c9b6c712919c763a"
        );
        assert_eq!(
            run_tool("sha256.hash", "md5", "流萤\n ").unwrap(),
            "b196eba6b8cb7ec39c77a32eeaad5d95"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha1", "流萤\n ").unwrap(),
            "9d57980130eb20a45a8d2e519b63bf45ae5592f3"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha224", "流萤\n ").unwrap(),
            "05c781ae466e04ed1e51d7bf40c0d1d60af3f319b01d7b705c9ff890"
        );
        assert_eq!(run_tool("sha256.hash", "sha384", "流萤\n ").unwrap(), "8722aa0cf2a615de12b0f191c9634e83e6716f3247fccbf20e541587a81b960c3433a72384375308da74aa04a151f2c6");
        assert_eq!(run_tool("sha256.hash", "sha512", "流萤\n ").unwrap(), "e9031b1e5a01fe1eb2a0afc2376f9caffd8749a016ee2de64e008e08f1bf67969d70e91df5c99e3360d4492c1c20f7c48b7c9141e0289f1430e66f780ab214e1");
        assert_eq!(
            run_tool("sha256.hash", "hash", " a\r\nb ").unwrap(),
            "c7cc88510c42775a6126483872077b3bcaf3a09ff4a4379d3fc8248d1994d293"
        );
        assert_eq!(
            run_tool("sha256.hash", "md5", " a\r\nb ").unwrap(),
            "7a81315401ba8966047f552f1f1f2f87"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha1", " a\r\nb ").unwrap(),
            "69f791f19feb3817ffde3ff7992581467311c587"
        );
        assert_eq!(
            run_tool("sha256.hash", "sha224", " a\r\nb ").unwrap(),
            "5733fa7a8798e7a98cf98743566f2b68e90015dec77271f3ea4301ef"
        );
        assert_eq!(run_tool("sha256.hash", "sha384", " a\r\nb ").unwrap(), "04003ebffa80941357a98fea7ab872ff7e00cb74a674a75a65ec61e51c7992078e8bfb654414d4cb4da12ca48f997e4c");
        assert_eq!(run_tool("sha256.hash", "sha512", " a\r\nb ").unwrap(), "89f2a3a38709858309b52ad4e0c25a55c3ad8947e99e891bfad1aa69b4260ab924d0fa0036b3eab6c4e3317d7c2f09e9be558776445ecc163a1f3e3ed731ca1f");
        assert_eq!(tool_actions("sha256.hash").len(), 6);
        assert!(!tool_exists("text.sort"));
        assert!(!tool_exists("text.stats"));
        for id in ["text.sort", "text.stats"] {
            assert!(tool_actions(id).is_empty());
            assert!(run_tool(id, "count", "abc").is_err());
        }
    }

    #[test]
    fn json_format_preserves_member_order_and_unicode() {
        let output = format_json("{\"后\":2,\"前\":1}").unwrap();
        assert_eq!(output, "{\n  \"后\": 2,\n  \"前\": 1\n}");
    }

    #[test]
    fn json_error_has_location() {
        let error = format_json("{\"a\": }").err().unwrap();
        assert_eq!(error.code, "invalid_json");
        assert_eq!(error.line, Some(1));
    }

    #[test]
    fn input_limit_is_bytes() {
        let input = "中".repeat(MAX_TEXT_BYTES / 3 + 1);
        assert_eq!(format_json(&input).err().unwrap().code, "input_too_large");
        assert!(detect_text(&input).is_empty());
    }

    #[test]
    fn detection_and_search_are_metadata_only() {
        assert_eq!(
            detect_text("{\"ok\":true}")[0].actions[0].tool_id,
            "json.format"
        );
        let plain = detect_text("not json");
        assert_eq!(plain[0].type_id, "text");
        assert!(plain[0].confidence < 0.5);
        assert!(plain[0]
            .actions
            .iter()
            .any(|action| action.tool_id == "text.dedup"));
        assert_eq!(detect_text("1712345678")[0].type_id, "unix_timestamp");
        assert_eq!(detect_text("a%20b")[0].actions[0].tool_id, "url.convert");
        assert_eq!(detect_text("SGVsbG8=")[0].type_id, "base64");
        assert_eq!(search_tools("beautify")[0].id, "json.format");
        assert!(search_tools("secret clipboard content").is_empty());
    }

    #[test]
    fn detection_rejects_partial_percent_sequences_and_ranks_encoded_urls_first() {
        for input in ["hello%20world%GG", "hello%20world%", "%E4%ZZ"] {
            assert!(!detect_text(input)
                .iter()
                .any(|result| result.type_id == "url_encoding"));
        }
        let results = detect_text("https://example.com/a%20b");
        assert_eq!(results[0].type_id, "url");
        assert!(results
            .iter()
            .any(|result| result.type_id == "url_encoding"));
        assert!(!detect_text("https://exa\nmple.com")
            .iter()
            .any(|result| result.type_id == "url"));
    }

    #[test]
    fn detection_supports_short_base64_and_windows_lines_without_auto_prompting_for_short_tokens() {
        for input in ["YQ==", "5Lit"] {
            let results = detect_text(input);
            let base64 = results
                .iter()
                .find(|result| result.type_id == "base64")
                .unwrap();
            assert!(base64.confidence < 0.5);
        }
        let input = STANDARD.encode("first\r\nsecond\r\n");
        assert!(detect_text(&input)
            .iter()
            .any(|result| result.type_id == "base64" && result.confidence >= 0.5));
        assert!(!detect_text("AAAA")
            .iter()
            .any(|result| result.type_id == "base64"));
    }

    #[test]
    fn ambiguous_numeric_ids_remain_manual_and_all_timestamp_suggestions_are_convertible() {
        for input in ["13800138000", "1234", "0", "0000000123", "17123456780000"] {
            let results = detect_text(input);
            assert!(
                results.iter().all(|result| result.confidence < 0.5),
                "{input}"
            );
            for result in results
                .iter()
                .filter(|result| result.type_id == "unix_timestamp")
            {
                assert!(run_tool("time.unix", &result.actions[0].id, input).is_ok());
            }
        }
        for input in ["1712345678", "1712345678000", "-315619200"] {
            assert!(detect_text(input)
                .iter()
                .any(|result| result.type_id == "unix_timestamp" && result.confidence >= 0.5));
        }
        assert!(!detect_text("9223372036854775807")
            .iter()
            .any(|result| result.type_id == "unix_timestamp"));
    }

    #[test]
    fn delimiter_heavy_invalid_tokens_do_not_become_jwt_suggestions() {
        assert!(!detect_text(&".".repeat(MAX_TEXT_BYTES))
            .iter()
            .any(|result| result.type_id == "jwt"));
    }

    #[test]
    fn simple_uuid_or_md5_values_do_not_trigger_automatic_clipboard_suggestions() {
        let plain = detect_text("550e8400e29b41d4a716446655440000");
        assert!(plain.iter().all(|result| result.confidence < 0.5));
        assert!(plain.iter().any(|result| result.type_id == "uuid"));
        assert!(detect_text("550e8400-e29b-41d4-a716-446655440000")
            .iter()
            .any(|result| result.type_id == "uuid" && result.confidence >= 0.5));
    }

    #[test]
    fn common_tools_process_text_and_reject_invalid_input() {
        assert_eq!(
            run_tool("base64.convert", "encode", "流萤").unwrap(),
            "5rWB6JCk"
        );
        assert_eq!(
            run_tool("base64.convert", "decode", "5rWB6JCk").unwrap(),
            "流萤"
        );
        assert_eq!(
            run_tool("base64.convert", "decode", "not base64!")
                .unwrap_err()
                .code,
            "invalid_base64"
        );
        assert_eq!(run_tool("url.convert", "encode", "a b").unwrap(), "a%20b");
        assert_eq!(run_tool("url.convert", "decode", "a%20b").unwrap(), "a b");
        assert_eq!(
            run_tool("url.convert", "decode", "%GG").unwrap_err().code,
            "invalid_url_encoding"
        );
        assert_eq!(
            run_tool("sha256.hash", "hash", "abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            run_tool("sha256.hash", "decode", "abc").unwrap_err().code,
            "unknown_action"
        );
    }

    #[test]
    fn pipeline_runs_in_order_and_rejects_unknown_or_oversized_steps() {
        let steps = vec![
            ToolStep {
                tool_id: "url.convert".into(),
                action: "encode".into(),
            },
            ToolStep {
                tool_id: "base64.convert".into(),
                action: "encode".into(),
            },
        ];
        assert_eq!(run_pipeline(&steps, "a b").unwrap(), "YSUyMGI=");
        assert_eq!(run_pipeline(&steps, "").unwrap_err().code, "empty_input");
        assert_eq!(validate_pipeline(&[]).unwrap_err().code, "invalid_steps");
        assert_eq!(
            validate_pipeline(&vec![steps[0].clone(); 9])
                .unwrap_err()
                .code,
            "invalid_steps"
        );
        assert_eq!(
            validate_pipeline(&[ToolStep {
                tool_id: "custom.1".into(),
                action: "run".into()
            }])
            .unwrap_err()
            .code,
            "invalid_step"
        );
        assert_eq!(
            validate_pipeline(&[
                ToolStep {
                    tool_id: "text.case".into(),
                    action: "upper".into()
                },
                ToolStep {
                    tool_id: "uuid.generate".into(),
                    action: "generate".into()
                },
            ])
            .unwrap_err()
            .code,
            "invalid_step"
        );
        let expanding = vec![
            ToolStep {
                tool_id: "base64.convert".into(),
                action: "encode".into(),
            },
            ToolStep {
                tool_id: "sha256.hash".into(),
                action: "hash".into(),
            },
        ];
        assert_eq!(
            run_pipeline(&expanding, &"a".repeat(800_000))
                .unwrap_err()
                .code,
            "intermediate_too_large"
        );
        let generated = run_pipeline(
            &[ToolStep {
                tool_id: "uuid.generate".into(),
                action: "generate".into(),
            }],
            "",
        )
        .unwrap();
        assert!(Uuid::parse_str(&generated).is_ok());
    }

    #[test]
    fn m1_tools_cover_all_registered_actions_and_errors() {
        assert_eq!(TOOLS.len(), 111);
        assert!(TOOLS.iter().all(|tool| !tool_actions(tool.id).is_empty()));
        assert_eq!(
            run_tool("time.unix", "to_timestamp", "1970-01-01T00:00:00Z").unwrap(),
            "0"
        );
        assert_eq!(
            run_tool("time.unix", "to_date", "0").unwrap(),
            "1970-01-01T00:00:00+00:00"
        );
        assert_eq!(
            run_tool("time.unix", "to_date", "bad").unwrap_err().code,
            "invalid_timestamp"
        );
        let uuid = run_tool("uuid.generate", "generate", "").unwrap();
        assert_eq!(run_tool("uuid.generate", "validate", &uuid).unwrap(), uuid);
        assert_eq!(
            run_tool("uuid.generate", "validate", "bad")
                .unwrap_err()
                .code,
            "invalid_uuid"
        );
        assert_eq!(run_tool("text.dedup", "dedup", "a\nb\na").unwrap(), "a\nb");
        assert_eq!(
            run_tool("text.case", "upper", "Hi 世界").unwrap(),
            "HI 世界"
        );
        assert_eq!(
            run_tool("color.convert", "to_rgb", "#0F8").unwrap(),
            "rgb(0, 255, 136)"
        );
        assert_eq!(
            run_tool("color.convert", "to_hex", "rgb(0, 255, 136)").unwrap(),
            "#00FF88"
        );
        assert_eq!(
            run_tool("color.convert", "to_hex", "rgb(999, 0, 0)")
                .unwrap_err()
                .code,
            "invalid_color"
        );
        let token = format!(
            "{}.{}.sig",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(r#"{"sub":"流萤"}"#)
        );
        let decoded = run_tool("jwt.decode", "decode", &token).unwrap();
        assert!(decoded.contains("流萤"));
        assert!(decoded.contains("未验证签名"));
        assert_eq!(
            run_tool("jwt.decode", "decode", "invalid")
                .unwrap_err()
                .code,
            "invalid_jwt"
        );
    }
}
