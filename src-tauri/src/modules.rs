use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
#[cfg(any(target_os = "windows", target_os = "android"))]
use rquickjs::{
    loader::{BuiltinLoader, BuiltinResolver},
    Context, Ctx, Exception, Function, Module, Object, Runtime, Value,
};
use semver::Version;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::io::Write;
use std::{
    collections::{BTreeMap, HashSet},
    sync::{atomic::AtomicBool, Arc},
};
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::{
    io::{Cursor, Read},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use toolbox_storage::ModuleRecord;

pub const MAX_PACKAGE_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_SOURCE_TOTAL_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SOURCE_FILES: usize = 128;
pub const MAX_RESOURCE_BYTES: usize = 96 * 1024 * 1024;
const MAX_UNPACKED_BYTES: usize = 128 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES: usize = 384;
const TEXT_PACKAGE_BYTES: usize = 2 * 1024 * 1024;
// Text workers keep their existing request bound independently of v7 source sizes.
const MAX_TEXT_REQUEST_BYTES: usize = 96 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_NETWORK_HOSTS: usize = 64;
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_HEAP_BYTES: usize = 64 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 3000;
const MAX_BROWSER_TIMEOUT_MS: u64 = 15_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub module_id: String,
    pub version: String,
    pub api_version: String,
    pub min_app_version: String,
    pub name: BTreeMap<String, String>,
    pub author: String,
    pub license: String,
    pub platforms: Vec<String>,
    pub permissions: Vec<String>,
    pub network: Network,
    pub limits: Limits,
    pub tools: Vec<ModuleTool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<Resource>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub path: String,
    #[serde(default)]
    pub size: usize,
    #[serde(default)]
    pub sha256: String,
}

pub struct ModulePackage {
    pub record: ModuleRecord,
    pub resources: BTreeMap<String, Vec<u8>>,
}

pub fn resource_mime(path: &str) -> Option<&'static str> {
    Some(match path.rsplit('.').next()? {
        "wasm" => "application/wasm",
        "js" => "text/javascript",
        "json" => "application/json",
        "bin" => "application/octet-stream",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "jxl" => "image/jxl",
        "tif" | "tiff" => "image/tiff",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => return None,
    })
}

pub fn resource_digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

pub fn validate_resources(
    manifest: &Manifest,
    resources: &BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    if resources.len() != manifest.resources.len() {
        return Err("工具包二进制资源缺失或包含未声明文件。".into());
    }
    let mut total = 0usize;
    for resource in &manifest.resources {
        let bytes = resources
            .get(&resource.path)
            .ok_or("工具包缺少已声明资源。")?;
        total = total.saturating_add(bytes.len());
        if bytes.is_empty()
            || bytes.len() != resource.size
            || bytes.len() > MAX_RESOURCE_BYTES
            || resource_digest(bytes) != resource.sha256
            || (resource.path.ends_with(".wasm") && !bytes.starts_with(b"\0asm\x01\0\0\0"))
            || (resource.path.ends_with(".js") && std::str::from_utf8(bytes).is_err())
        {
            return Err(format!("资源大小、摘要或格式无效：{}。", resource.path));
        }
    }
    if total > MAX_UNPACKED_BYTES {
        return Err("工具包资源总量超过 128 MiB。".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Network {
    pub hosts: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub input_bytes: usize,
    pub output_bytes: usize,
    pub timeout_ms: u64,
    pub heap_bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleTool {
    pub id: String,
    pub name: BTreeMap<String, String>,
    pub description: BTreeMap<String, String>,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub ui: ToolUi,
    pub actions: Vec<ModuleAction>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolUi {
    pub kind: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fullscreen: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input_field: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub output_field: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleAction {
    pub id: String,
    pub label: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_types: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModuleSummary {
    pub module_id: String,
    pub version: String,
    pub name: String,
    pub author: String,
    pub tools: Vec<String>,
    pub tool_ids: Vec<String>,
    pub categories: Vec<String>,
    pub network_hosts: Vec<String>,
    pub builtin: bool,
    pub modified: bool,
}

#[derive(Serialize)]
pub struct ModuleDetails {
    pub manifest: Manifest,
    pub scripts: BTreeMap<String, String>,
    pub builtin: bool,
    pub modified: bool,
}

pub fn label(values: &BTreeMap<String, String>) -> String {
    values
        .get("zh-CN")
        .or_else(|| values.get("en"))
        .or_else(|| values.values().next())
        .cloned()
        .unwrap_or_default()
}

pub fn parse_record(record: &ModuleRecord) -> Result<Manifest, String> {
    let manifest: Manifest = serde_json::from_value(record.manifest.clone())
        .map_err(|_| "模块清单格式无效。".to_owned())?;
    let modern = manifest.schema_version == 7;
    if record.scripts.is_empty()
        || record.scripts.len() > if modern { MAX_SOURCE_FILES } else { 16 }
        || record.scripts.iter().any(|(name, source)| {
            !valid_resource_path(name)
                || source.is_empty()
                || source.len()
                    > if modern {
                        MAX_SOURCE_BYTES
                    } else {
                        1024 * 1024
                    }
        })
        || record.scripts.values().map(String::len).sum::<usize>()
            > if modern {
                MAX_SOURCE_TOTAL_BYTES
            } else {
                TEXT_PACKAGE_BYTES
            }
    {
        return Err("模块脚本路径或大小无效。".into());
    }
    if modern
        && record
            .scripts
            .values()
            .map(String::len)
            .sum::<usize>()
            .saturating_add(manifest.resources.iter().fold(0usize, |total, resource| {
                total.saturating_add(resource.size)
            }))
            > MAX_UNPACKED_BYTES
    {
        return Err("工具源码与资源总量超过 128 MiB。".into());
    }
    validate_manifest(&manifest, &record.scripts)?;
    if record.module_id != manifest.module_id {
        return Err("模块 ID 与清单不一致。".into());
    }
    Ok(manifest)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn manifest_json_error(error: serde_json::Error) -> String {
    let detail = error.to_string();
    let field = |prefix: &str| {
        detail
            .strip_prefix(prefix)
            .and_then(|rest| rest.split_once('`'))
            .map(|(name, _)| name)
    };
    let reason = if let Some(name) = field("missing field `") {
        format!("缺少必填字段 {name}")
    } else if let Some(name) = field("unknown field `") {
        format!("包含不支持的字段 {name}")
    } else if detail.starts_with("invalid type") {
        let expected = detail
            .split("expected ")
            .nth(1)
            .and_then(|part| part.split(" at line ").next());
        match expected {
            Some("a string") => "字段类型错误，需要字符串".to_owned(),
            Some("a sequence") => "字段类型错误，需要数组".to_owned(),
            Some("a map") => "字段类型错误，需要对象".to_owned(),
            Some("a boolean") => "字段类型错误，需要布尔值".to_owned(),
            _ => "字段类型错误".to_owned(),
        }
    } else if error.is_syntax() || error.is_eof() {
        "JSON 语法错误".to_owned()
    } else {
        "字段内容无效".to_owned()
    };
    if error.line() > 0 {
        format!(
            "模块清单 JSON 格式无效：{reason}（第 {} 行第 {} 列）。",
            error.line(),
            error.column()
        )
    } else {
        format!("模块清单 JSON 格式无效：{reason}。")
    }
}

pub fn summary(manifest: &Manifest) -> ModuleSummary {
    let mut categories = Vec::new();
    for tool in &manifest.tools {
        if !categories.contains(&tool.category) {
            categories.push(tool.category.clone());
        }
    }
    ModuleSummary {
        module_id: manifest.module_id.clone(),
        version: manifest.version.clone(),
        name: label(&manifest.name),
        author: manifest.author.clone(),
        tools: manifest
            .tools
            .iter()
            .map(|tool| label(&tool.name))
            .collect(),
        tool_ids: manifest.tools.iter().map(|tool| tool.id.clone()).collect(),
        categories,
        network_hosts: manifest.network.hosts.clone(),
        builtin: crate::builtin_modules::tool_id(&manifest.module_id).is_some(),
        modified: false,
    }
}

pub fn runnable_here(manifest: &Manifest) -> bool {
    cfg!(any(target_os = "windows", target_os = "android"))
        && manifest
            .platforms
            .iter()
            .any(|platform| platform == std::env::consts::OS)
}

fn valid_id(id: &str) -> bool {
    id.len() <= 100
        && id.split('.').count() >= 2
        && id.split('.').all(|part| {
            !part.is_empty()
                && part.len() <= 40
                && part.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_lowercase()
                        || (index > 0 && (byte.is_ascii_digit() || byte == b'_'))
                })
        })
}

fn valid_entry(name: &str) -> bool {
    name.len() <= 120 && name.ends_with(".js") && valid_resource_path(name)
}

fn valid_resource_path(name: &str) -> bool {
    valid_package_path(name)
        && (name.ends_with(".js") || name.ends_with(".html") || name.ends_with(".css"))
}

pub fn valid_package_path(name: &str) -> bool {
    name.len() <= 120
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        })
}

fn text_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "additionalProperties": false
    })
}

fn valid_localized(values: &BTreeMap<String, String>, max_len: usize) -> bool {
    !values.is_empty()
        && values.len() <= 4
        && values.iter().all(|(locale, value)| {
            !locale.is_empty()
                && locale.len() <= 16
                && !value.trim().is_empty()
                && value.chars().count() <= max_len
        })
}

pub(crate) fn valid_icon_data(value: &str) -> bool {
    valid_png_icon_data(value, 96)
}

pub(crate) fn valid_png_icon_data(value: &str, max_dimension: u32) -> bool {
    let Some(encoded) = value.strip_prefix("data:image/png;base64,") else {
        return false;
    };
    if encoded.len() > 32_768 {
        return false;
    }
    let Ok(bytes) = BASE64.decode(encoded) else {
        return false;
    };
    if bytes.len() < 45
        || bytes.len() > 24 * 1024
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[12..16] != b"IHDR"
        || u32::from_be_bytes(bytes[8..12].try_into().unwrap()) != 13
    {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || width > max_dimension
        || height == 0
        || height > max_dimension
        || bytes[24] != 8
        || !matches!(bytes[25], 2 | 6)
    {
        return false;
    }
    let mut offset = 8usize;
    let mut saw_idat = false;
    while offset + 12 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let Some(end) = offset
            .checked_add(12)
            .and_then(|start| start.checked_add(length))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        let kind = &bytes[offset + 4..offset + 8];
        if kind == b"IDAT" {
            saw_idat = true;
        }
        if kind == b"IEND" {
            return saw_idat && length == 0 && end == bytes.len();
        }
        offset = end;
    }
    false
}

pub fn validate_manifest(
    manifest: &Manifest,
    scripts: &BTreeMap<String, String>,
) -> Result<(), String> {
    if !matches!(manifest.schema_version, 1..=7) || manifest.api_version != "1" {
        return Err("不支持此模块清单或宿主 API 版本。".into());
    }
    if manifest.schema_version != 7
        && manifest
            .tools
            .iter()
            .any(|tool| tool.ui.kind == "web" || tool.runtime.as_deref() == Some("browser"))
    {
        return Err(
            "网页工具仅支持清单 v7 和 HTML/CSS/JS 页面入口，请重新制作旧版网页工具包。".into(),
        );
    }
    if manifest.schema_version < 4 && scripts.keys().any(|path| !valid_entry(path)) {
        return Err("旧版模块只能包含 JS 脚本。".into());
    }
    let app_version = Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "应用版本无效。")?;
    let min_version =
        Version::parse(&manifest.min_app_version).map_err(|_| "模块最低应用版本无效。")?;
    Version::parse(&manifest.version).map_err(|_| "模块版本无效。")?;
    if min_version > app_version {
        return Err("模块需要更新版本的流萤百宝箱。".into());
    }
    let builtin_id = crate::builtin_modules::tool_id(&manifest.module_id);
    if manifest.module_id.starts_with("builtin.") && builtin_id.is_none() {
        return Err("应用自带工具包 ID 不存在，不能占用 builtin 命名空间。".into());
    }
    if let Some(id) = builtin_id {
        let web = toolbox_core::interactive_tool(id);
        let schema = if web { 7 } else { 6 };
        let minimum = if web {
            Version::new(0, 1, 28)
        } else {
            Version::new(0, 1, 2)
        };
        if manifest.schema_version != schema
            || min_version < minimum
            || manifest.tools.len() != 1
            || manifest.tools[0].id != id
        {
            return Err(
                "应用自带网页工具需使用清单 v7，文本工具需使用清单 v6，且不能改变原有工具 ID。"
                    .into(),
            );
        }
    }
    if !valid_id(&manifest.module_id)
        || manifest.module_id.starts_with("custom.")
        || !valid_localized(&manifest.name, 80)
        || manifest.author.trim().is_empty()
        || manifest.author.chars().count() > 100
        || manifest.license.trim().is_empty()
        || manifest.license.chars().count() > 100
        || manifest.platforms.is_empty()
        || manifest.platforms.len() > 4
        || manifest.tools.is_empty()
        || manifest.tools.len() > 16
    {
        return Err("模块标识或元数据无效。".into());
    }
    if !manifest.platforms.iter().all(|platform| {
        matches!(
            platform.as_str(),
            "windows" | "linux" | "macos" | "android" | "ios"
        )
    }) {
        return Err("模块平台声明无效。".into());
    }
    let browser_only = manifest
        .tools
        .iter()
        .all(|tool| tool.runtime.as_deref() == Some("browser"));
    if manifest.schema_version == 7 {
        let mut paths = HashSet::new();
        if min_version < Version::new(0, 1, 27)
            || !browser_only
            || manifest.tools.iter().any(|tool| tool.ui.kind != "web")
            || manifest.resources.len() > 128
            || manifest.resources.iter().any(|resource| {
                !valid_package_path(&resource.path)
                    || resource_mime(&resource.path).is_none()
                    || scripts.contains_key(&resource.path)
                    || !paths.insert(resource.path.to_ascii_lowercase())
                    || resource.size == 0
                    || resource.size > MAX_RESOURCE_BYTES
                    || resource.sha256.len() != 64
                    || !resource
                        .sha256
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
        {
            return Err(
                "资源工具需使用清单 v7、应用 0.1.27、网页入口及有效资源路径/大小/SHA-256。".into(),
            );
        }
    } else if !manifest.resources.is_empty() {
        return Err("独立资源需要清单 v7。".into());
    }
    let network_enabled = !manifest.network.hosts.is_empty();
    if (!manifest.permissions.is_empty() || network_enabled)
        && (!browser_only
            || manifest.schema_version < 3
            || manifest.permissions.len() != 1
            || manifest.permissions[0] != "network"
            || !network_enabled
            || manifest.network.hosts.len() > MAX_NETWORK_HOSTS
            || manifest.network.hosts.iter().any(|host| {
                if host == "https://*" {
                    return match builtin_id {
                        Some("web.source" | "ssl.certificate") => {
                            min_version < Version::new(0, 1, 8)
                        }
                        Some("domain.whois") => min_version < Version::new(0, 1, 12),
                        Some("link.shortener") => min_version < Version::new(0, 1, 20),
                        _ => true,
                    };
                }
                if host.contains('*') {
                    return true;
                }
                url::Url::parse(host).map_or(true, |url| {
                    url.scheme() != "https"
                        || url.host_str().is_none()
                        || url.path() != "/"
                        || url.query().is_some()
                        || url.fragment().is_some()
                        || !url.username().is_empty()
                        || url.password().is_some()
                        || url.origin().ascii_serialization() != *host
                })
            }))
    {
        return Err("模块网络声明无效；浏览器模块需同时声明 network 权限和 HTTPS 来源。".into());
    }
    if manifest.limits.input_bytes == 0
        || manifest.limits.input_bytes
            > if manifest.schema_version == 7 {
                MAX_FILE_BYTES as usize
            } else {
                1024 * 1024
            }
        || manifest.limits.output_bytes == 0
        || manifest.limits.output_bytes
            > if manifest.schema_version == 7 {
                MAX_FILE_BYTES as usize
            } else {
                MAX_OUTPUT_BYTES
            }
        || manifest.limits.timeout_ms == 0
        || manifest.limits.timeout_ms
            > if browser_only {
                MAX_BROWSER_TIMEOUT_MS
            } else {
                MAX_TIMEOUT_MS
            }
        || manifest.limits.heap_bytes < 1024 * 1024
        || manifest.limits.heap_bytes > MAX_HEAP_BYTES
    {
        return Err("模块资源上限无效。".into());
    }
    let mut ids = HashSet::new();
    for tool in &manifest.tools {
        let web_tool = tool.ui.kind == "web";
        let tool_name = label(&tool.name);
        if !scripts.contains_key(&tool.entry) {
            return Err(format!("工具「{tool_name}」缺少入口文件 {}。", tool.entry));
        }
        if web_tool {
            for (kind, path) in [
                ("JS", tool.ui.script.as_deref()),
                ("CSS", tool.ui.style.as_deref()),
            ] {
                let path =
                    path.ok_or_else(|| format!("网页工具「{tool_name}」缺少 {kind} 文件声明。"))?;
                if !scripts.contains_key(path) {
                    return Err(format!("网页工具「{tool_name}」缺少 {kind} 文件 {path}。"));
                }
            }
        }
        if (builtin_id.is_none()
            && (!tool.id.starts_with(&format!("{}.", manifest.module_id))
                || toolbox_core::tool_exists(&tool.id)))
            || !valid_id(&tool.id)
            || !ids.insert(&tool.id)
            || !valid_localized(&tool.name, 80)
            || !valid_localized(&tool.description, 500)
            || tool.category.trim().is_empty()
            || tool.category.chars().count() > 40
            || tool.icon.as_deref().is_some_and(|icon| {
                !matches!(
                    icon,
                    "code"
                        | "text"
                        | "spark"
                        | "shapes"
                        | "bolt"
                        | "hash"
                        | "image"
                        | "file"
                        | "folder"
                        | "link"
                        | "globe"
                        | "search"
                        | "clock"
                        | "calendar"
                        | "calculator"
                        | "lock"
                        | "terminal"
                        | "database"
                        | "chart"
                        | "heart"
                )
            })
            || (tool.icon.is_some() && tool.icon_data.is_some())
            || (manifest.schema_version == 1 && tool.icon_data.is_some())
            || tool
                .icon_data
                .as_deref()
                .is_some_and(|data| !valid_icon_data(data))
            || tool.tags.len() > 8
            || tool.aliases.len() > 8
            || tool
                .tags
                .iter()
                .chain(tool.aliases.iter())
                .any(|value| value.chars().count() > 32)
            || tool
                .runtime
                .as_deref()
                .is_some_and(|runtime| runtime != "browser")
            || (tool.runtime.is_some() && manifest.schema_version < 3)
            || if web_tool {
                manifest.schema_version != 7
                    || tool.runtime.as_deref() != Some("browser")
                    || !tool.entry.ends_with(".html")
                    || !valid_resource_path(&tool.entry)
                    || !scripts.contains_key(&tool.entry)
                    || tool
                        .ui
                        .script
                        .as_deref()
                        .is_none_or(|path| !valid_entry(path) || !scripts.contains_key(path))
                    || tool.ui.style.as_deref().is_none_or(|path| {
                        !path.ends_with(".css")
                            || !valid_resource_path(path)
                            || !scripts.contains_key(path)
                    })
                    || !tool.ui.input_field.is_empty()
                    || !tool.ui.output_field.is_empty()
                    || !tool.input_schema.is_null()
                    || !tool.output_schema.is_null()
                    || tool.actions.len() != 1
            } else {
                manifest.schema_version == 4
                    || !valid_entry(&tool.entry)
                    || !scripts.contains_key(&tool.entry)
                    || tool.input_schema != text_schema()
                    || tool.output_schema != text_schema()
                    || tool.ui.kind != "text"
                    || tool.ui.input_field != "text"
                    || tool.ui.output_field != "text"
                    || tool.ui.script.is_some()
                    || tool.ui.style.is_some()
                    || tool.ui.fullscreen
            }
            || tool.actions.is_empty()
            || tool.actions.len() > 8
        {
            return Err("模块工具声明无效；请检查文本或网页工具的入口与资源。".into());
        }
        let mut action_ids = HashSet::new();
        for action in &tool.actions {
            if action.id.is_empty()
                || action.id.len() > 40
                || !action
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
                || !action_ids.insert(&action.id)
                || !valid_localized(&action.label, 40)
                || action.input_types.as_ref().is_some_and(|types| {
                    manifest.schema_version < 5
                        || tool.ui.kind != "text"
                        || types.len() > toolbox_core::INPUT_TYPES.len()
                        || types
                            .iter()
                            .any(|kind| !toolbox_core::valid_input_type(kind))
                        || types.iter().collect::<HashSet<_>>().len() != types.len()
                })
            {
                return Err("模块操作声明无效。".into());
            }
        }
    }
    // Browser entries are loaded as standalone bundled files. Extra source files
    // cannot be resolved from their blob URLs at runtime.
    let referenced: HashSet<&str> = manifest
        .tools
        .iter()
        .flat_map(|tool| {
            [
                Some(tool.entry.as_str()),
                tool.ui.script.as_deref(),
                tool.ui.style.as_deref(),
            ]
            .into_iter()
            .flatten()
        })
        .collect();
    if browser_only
        && scripts
            .keys()
            .any(|path| !referenced.contains(path.as_str()))
    {
        return Err("浏览器模块含有未被工具引用的资源；请先打包相对导入。".into());
    }
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn unpack_package(bytes: &[u8]) -> Result<ModuleRecord, String> {
    unpack_package_internal(bytes, true)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn unpack_package_internal(
    bytes: &[u8],
    require_current_platform: bool,
) -> Result<ModuleRecord, String> {
    Ok(unpack_package_full(bytes, require_current_platform)?.record)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn unpack_package_full(
    bytes: &[u8],
    require_current_platform: bool,
) -> Result<ModulePackage, String> {
    if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
        return Err("工具包不能超过 128 MiB。".into());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "所选文件不是有效的 .fftool 工具包。")?;
    let manifest_text = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| "工具包缺少 manifest.json。")?;
        if file.size() > 64 * 1024 {
            return Err("工具清单过大。".into());
        }
        let mut data = Vec::new();
        file.by_ref()
            .take(64 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| "无法读取工具清单。")?;
        if data.len() > 64 * 1024 {
            return Err("工具清单过大。".into());
        }
        data
    };
    let manifest: Manifest = serde_json::from_slice(&manifest_text).map_err(manifest_json_error)?;
    let modern = manifest.schema_version == 7;
    let package_limit = if modern {
        MAX_PACKAGE_BYTES
    } else {
        TEXT_PACKAGE_BYTES
    };
    if bytes.len() > package_limit
        || archive.is_empty()
        || archive.len() > if modern { MAX_PACKAGE_ENTRIES } else { 20 }
    {
        return Err("工具包大小或条目数量超限；旧版包仍限 2 MiB。".into());
    }
    let declared: HashSet<_> = manifest.resources.iter().map(|r| r.path.as_str()).collect();
    let mut scripts = BTreeMap::new();
    let mut resources = BTreeMap::new();
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|_| "无法读取工具包。")?;
        let name = std::str::from_utf8(file.name_raw())
            .map_err(|_| "工具文件名必须为 UTF-8。")?
            .to_owned();
        if !seen.insert(name.to_ascii_lowercase())
            || !valid_package_path(name.trim_end_matches('/'))
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("工具包包含不安全的路径、链接或重复文件。".into());
        }
        if file.is_dir() {
            continue;
        }
        let asset = declared.contains(name.as_str());
        if name != "manifest.json" && !asset && !valid_resource_path(&name) {
            return Err("工具包包含未声明的资源。".into());
        }
        let limit = if asset && modern {
            MAX_RESOURCE_BYTES
        } else if modern {
            MAX_SOURCE_BYTES
        } else {
            1024 * 1024
        };
        if file.size() > limit as u64
            || (file.compressed_size() > 0
                && file.size() > file.compressed_size().saturating_mul(100))
        {
            return Err("工具文件大小或压缩比超限。".into());
        }
        total = total.saturating_add(file.size() as usize);
        if total > package_limit {
            return Err("工具包解包后总量超限。".into());
        }
        let mut content = Vec::new();
        file.by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut content)
            .map_err(|_| "工具文件读取失败。")?;
        if content.len() > limit {
            return Err("工具文件过大。".into());
        }
        if name == "manifest.json" {
            continue;
        }
        if asset {
            resources.insert(name, content);
        } else {
            scripts.insert(
                name,
                String::from_utf8(content).map_err(|_| "工具源码必须为 UTF-8。")?,
            );
        }
    }
    let record = ModuleRecord {
        module_id: manifest.module_id.clone(),
        manifest: serde_json::to_value(&manifest).map_err(|_| "工具清单格式无效。")?,
        scripts,
    };
    parse_record(&record)?;
    validate_resources(&manifest, &resources)?;
    if require_current_platform && !runnable_here(&manifest) {
        return Err("当前平台尚未开放此工具的执行。".into());
    }
    Ok(ModulePackage { record, resources })
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn pack_package(record: &ModuleRecord) -> Result<Vec<u8>, String> {
    pack_package_internal(record, true)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn pack_package_internal(
    record: &ModuleRecord,
    require_current_platform: bool,
) -> Result<Vec<u8>, String> {
    pack_package_full(record, &BTreeMap::new(), require_current_platform)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn pack_package_full(
    record: &ModuleRecord,
    resources: &BTreeMap<String, Vec<u8>>,
    require_current_platform: bool,
) -> Result<Vec<u8>, String> {
    let manifest = parse_record(record)?;
    validate_resources(&manifest, resources)?;
    if require_current_platform && !runnable_here(&manifest) {
        return Err("当前平台尚未开放此工具的执行。".into());
    }
    let manifest_json = serde_json::to_vec(&manifest).map_err(|_| "工具清单无法导出。")?;
    if manifest_json.len() > 64 * 1024 {
        return Err("工具清单过大。".into());
    }
    let package_limit = if manifest.schema_version == 7 {
        MAX_PACKAGE_BYTES
    } else {
        TEXT_PACKAGE_BYTES
    };
    let total = manifest_json.len()
        + record.scripts.values().map(String::len).sum::<usize>()
        + resources.values().map(Vec::len).sum::<usize>();
    if total > package_limit {
        return Err("工具包解包后总量超限。".into());
    }
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    archive
        .start_file("manifest.json", options)
        .map_err(|_| "无法创建工具包。")?;
    archive
        .write_all(&manifest_json)
        .map_err(|_| "无法写入工具清单。")?;
    for (name, source) in &record.scripts {
        archive
            .start_file(name, options)
            .map_err(|_| "无法创建源码条目。")?;
        archive
            .write_all(source.as_bytes())
            .map_err(|_| "无法写入源码。")?;
    }
    for (name, data) in resources {
        archive
            .start_file(name, options)
            .map_err(|_| "无法创建资源条目。")?;
        archive.write_all(data).map_err(|_| "无法写入资源。")?;
    }
    let bytes = archive
        .finish()
        .map_err(|_| "无法完成工具包。")?
        .into_inner();
    if bytes.len() > package_limit {
        return Err("工具包大小超限。".into());
    }
    Ok(bytes)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[derive(Serialize, Deserialize)]
struct WorkerRequest {
    scripts: BTreeMap<String, String>,
    entry: String,
    action: String,
    input: String,
    timeout_ms: u64,
    heap_bytes: usize,
    output_bytes: usize,
    validate_only: bool,
    #[serde(default)]
    syntax_only: bool,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[derive(Serialize, Deserialize)]
struct WorkerReply {
    text: Option<String>,
    error: Option<String>,
}

pub enum WorkerMode {
    Execute,
    Validate,
    Syntax,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn js_error(ctx: &Ctx<'_>, fallback: &str) -> String {
    let caught = ctx.catch();
    let detail = caught
        .as_exception()
        .map(|error| {
            let message = error.message().unwrap_or_default();
            let stack = error.stack().unwrap_or_default();
            format!("{message}\n{stack}")
        })
        .or_else(|| caught.as_string().and_then(|value| value.to_string().ok()));
    match detail.filter(|detail| !detail.trim().is_empty()) {
        Some(detail) => format!(
            "{fallback}\n{}",
            detail.chars().take(8192).collect::<String>()
        ),
        None => fallback.to_owned(),
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn execute(request: WorkerRequest) -> Result<String, String> {
    let runtime = Runtime::new().map_err(|_| "无法启动 JS 运行时。")?;
    runtime.set_memory_limit(request.heap_bytes);
    runtime.set_max_stack_size(512 * 1024);
    let mut resolver = BuiltinResolver::default();
    let mut loader = BuiltinLoader::default();
    for (name, source) in &request.scripts {
        resolver.add_module(name.clone());
        loader.add_module(name.clone(), source.as_bytes().to_vec());
    }
    runtime.set_loader(resolver, loader);
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::full(&runtime).map_err(|_| "无法创建 JS 上下文。")?;
    context.with(|ctx| {
        let host = Object::new(ctx.clone()).map_err(|_| "无法创建纯计算接口。")?;
        let run_builtin = Function::new(
            ctx.clone(),
            |call_ctx: Ctx<'_>, tool_id: String, action: String, input: String| {
                toolbox_core::run_tool(&tool_id, &action, &input)
                    .map_err(|error| Exception::throw_message(&call_ctx, &error.message))
            },
        )
        .map_err(|_| "无法创建纯计算函数。")?;
        host.set("runBuiltin", run_builtin)
            .map_err(|_| "无法初始化纯计算接口。")?;
        ctx.globals()
            .set("firefly", host)
            .map_err(|_| "无法初始化工具宿主。")?;
        let source = request
            .scripts
            .get(&request.entry)
            .ok_or("模块入口脚本不存在。")?;
        let declared = Module::declare(ctx.clone(), request.entry, source.as_bytes())
            .map_err(|_| js_error(&ctx, "JS 工具语法无效。"))?;
        if request.syntax_only {
            return Ok(String::new());
        }
        let (module, promise) = declared
            .eval()
            .map_err(|_| js_error(&ctx, "JS 工具初始化失败。"))?;
        loop {
            match promise.result::<()>() {
                Some(Ok(())) => break,
                Some(Err(_)) => return Err(js_error(&ctx, "JS 工具初始化失败。")),
                None if Instant::now() < deadline && ctx.execute_pending_job() => {}
                None => return Err("JS 模块初始化超时或等待了不支持的异步任务。".into()),
            }
        }
        let run: Function = module
            .get("run")
            .map_err(|_| "JS 模块必须导出 run 函数。")?;
        if request.validate_only {
            return Ok(String::new());
        }
        let input_json = serde_json::json!({"text": request.input}).to_string();
        let input: Value = ctx
            .json_parse(input_json)
            .map_err(|_| "无法传入模块输入。")?;
        let output: Value = run
            .call((input, request.action))
            .map_err(|_| js_error(&ctx, "JS 工具执行失败或超时。"))?;
        let output = if let Some(promise) = output.as_promise() {
            loop {
                match promise.result::<Value>() {
                    Some(Ok(value)) => break value,
                    Some(Err(_)) => return Err(js_error(&ctx, "JS 异步任务执行失败或超时。")),
                    None if Instant::now() < deadline && ctx.execute_pending_job() => {}
                    None => return Err("JS 异步任务超时或等待了不支持的宿主事件。".into()),
                }
            }
        } else {
            output
        };
        let json = ctx
            .json_stringify(output)
            .map_err(|_| "模块输出不是有效 JSON。")?
            .ok_or("模块没有返回结果。")?
            .to_string()
            .map_err(|_| "模块输出无法读取。")?;
        if json.len() > request.output_bytes.saturating_mul(6).saturating_add(128) {
            return Err("模块输出过大。".into());
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&json).map_err(|_| "模块输出不是有效 JSON。")?;
        let object = parsed
            .as_object()
            .ok_or("模块必须返回 { text: string }。")?;
        if object.len() != 1 {
            return Err("模块必须返回 { text: string }。".into());
        }
        let text = object
            .get("text")
            .and_then(serde_json::Value::as_str)
            .ok_or("模块必须返回 { text: string }。")?;
        if text.len() > request.output_bytes {
            return Err("模块输出过大。".into());
        }
        Ok(text.to_owned())
    })
}

#[cfg(target_os = "windows")]
pub fn worker_main() {
    let result = (|| {
        let mut bytes = Vec::new();
        std::io::stdin()
            .take((MAX_TEXT_REQUEST_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取模块请求。")?;
        if bytes.len() > MAX_TEXT_REQUEST_BYTES {
            return Err("模块请求过大。".into());
        }
        let request: WorkerRequest =
            serde_json::from_slice(&bytes).map_err(|_| "模块请求格式无效。")?;
        execute(request)
    })();
    let reply = match result {
        Ok(text) => WorkerReply {
            text: Some(text),
            error: None,
        },
        Err(error) => WorkerReply {
            text: None,
            error: Some(error),
        },
    };
    if let Ok(bytes) = serde_json::to_vec(&reply) {
        let _ = std::io::stdout().write_all(&bytes);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn worker_main() {}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_firefly_toolbox_ModuleService_runNative(
    mut env: jni::JNIEnv<'_>,
    _: jni::objects::JClass<'_>,
    request: jni::objects::JString<'_>,
) -> jni::sys::jstring {
    let outcome = (|| {
        let json: String = env
            .get_string(&request)
            .map_err(|_| "模块请求无法读取。")?
            .into();
        if json.len() > MAX_TEXT_REQUEST_BYTES {
            return Err("模块请求过大。".into());
        }
        let request: WorkerRequest =
            serde_json::from_str(&json).map_err(|_| "模块请求格式无效。")?;
        execute(request)
    })();
    let reply = match outcome {
        Ok(text) => WorkerReply {
            text: Some(text),
            error: None,
        },
        Err(error) => WorkerReply {
            text: None,
            error: Some(error),
        },
    };
    let json = serde_json::to_string(&reply)
        .unwrap_or_else(|_| "{\"text\":null,\"error\":\"模块结果无效。\"}".into());
    env.new_string(json)
        .map_or(std::ptr::null_mut(), jni::objects::JString::into_raw)
}

#[cfg(target_os = "android")]
fn android_bridge(method: &str, payload: Option<(&str, u64)>) -> Result<String, String> {
    use jni::{
        objects::{JClass, JObject, JString, JValue},
        JavaVM,
    };
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
        .map_err(|_| "Android 模块执行器不可用。")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "无法连接 Android 模块执行器。")?;
    // FindClass on an attached Rust thread uses the system class loader. Resolve
    // the application class through the Context instead.
    let app_context = unsafe { JObject::from_raw(context.context().cast()) };
    let loader = env
        .call_method(
            &app_context,
            "getClassLoader",
            "()Ljava/lang/ClassLoader;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|_| "Android 模块类加载器不可用。")?;
    let class_name = JObject::from(
        env.new_string("firefly.toolbox.ModuleBridge")
            .map_err(|_| "Android 模块类名无法编码。")?,
    );
    let class = JClass::from(
        env.call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&class_name)],
        )
        .and_then(|value| value.l())
        .map_err(|_| "Android 模块桥接类不可用。")?,
    );
    if let Some((json, timeout_ms)) = payload {
        let request = JObject::from(env.new_string(json).map_err(|_| "模块请求无法编码。")?);
        let result = env
            .call_static_method(
                class,
                method,
                "(Landroid/content/Context;Ljava/lang/String;J)Ljava/lang/String;",
                &[
                    JValue::Object(&app_context),
                    JValue::Object(&request),
                    JValue::Long(timeout_ms as i64),
                ],
            )
            .map_err(|_| "Android 模块执行器调用失败。")?
            .l()
            .map_err(|_| "Android 模块结果无效。")?;
        let text: String = env
            .get_string(&JString::from(result))
            .map_err(|_| "Android 模块结果无法读取。")?
            .into();
        Ok(text)
    } else {
        env.call_static_method(class, method, "()V", &[])
            .map_err(|_| "无法取消 Android 模块。")?;
        Ok(String::new())
    }
}

#[cfg(target_os = "android")]
pub fn run_in_worker(
    scripts: BTreeMap<String, String>,
    entry: String,
    action: String,
    input: String,
    limits: &Limits,
    cancelled: Arc<AtomicBool>,
    mode: WorkerMode,
) -> Result<String, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("模块执行已取消。".into());
    }
    let timeout_ms = limits.timeout_ms.min(MAX_TIMEOUT_MS);
    let payload = serde_json::to_string(&WorkerRequest {
        scripts,
        entry,
        action,
        input,
        timeout_ms,
        heap_bytes: limits.heap_bytes.min(MAX_HEAP_BYTES),
        output_bytes: limits.output_bytes.min(MAX_OUTPUT_BYTES),
        validate_only: !matches!(mode, WorkerMode::Execute),
        syntax_only: matches!(mode, WorkerMode::Syntax),
    })
    .map_err(|_| "模块请求无法序列化。")?;
    let handle =
        std::thread::spawn(move || android_bridge("execute", Some((&payload, timeout_ms))));
    // Include service connection time as well as the script/watchdog budget.
    let deadline = Instant::now() + Duration::from_millis(timeout_ms + 5000);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = android_bridge("cancel", None);
            return Err("模块执行已取消。".into());
        }
        if handle.is_finished() {
            let json = handle
                .join()
                .map_err(|_| "Android 模块执行器异常退出。")??;
            let reply: WorkerReply =
                serde_json::from_str(&json).map_err(|_| "Android 模块结果格式无效。")?;
            return reply
                .text
                .ok_or_else(|| reply.error.unwrap_or_else(|| "模块执行失败。".into()));
        }
        if Instant::now() >= deadline {
            let _ = android_bridge("cancel", None);
            return Err("模块执行超时，已终止执行器。".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(all(test, any(target_os = "windows", target_os = "android")))]
pub(crate) fn validate_test_entry(
    scripts: BTreeMap<String, String>,
    entry: String,
    limits: &Limits,
    web: bool,
) -> Result<String, String> {
    let mode = if web {
        WorkerMode::Syntax
    } else {
        WorkerMode::Validate
    };
    execute(WorkerRequest {
        scripts,
        entry,
        action: String::new(),
        input: String::new(),
        timeout_ms: limits.timeout_ms.min(MAX_TIMEOUT_MS),
        heap_bytes: limits.heap_bytes.min(MAX_HEAP_BYTES),
        output_bytes: limits.output_bytes.min(MAX_OUTPUT_BYTES),
        validate_only: !matches!(mode, WorkerMode::Execute),
        syntax_only: matches!(mode, WorkerMode::Syntax),
    })
}

#[cfg(target_os = "windows")]
pub fn run_in_worker(
    scripts: BTreeMap<String, String>,
    entry: String,
    action: String,
    input: String,
    limits: &Limits,
    cancelled: Arc<AtomicBool>,
    mode: WorkerMode,
) -> Result<String, String> {
    use std::process::{Command, Stdio};
    if cancelled.load(Ordering::Relaxed) {
        return Err("模块执行已取消。".into());
    }
    let request = WorkerRequest {
        scripts,
        entry,
        action,
        input,
        timeout_ms: limits.timeout_ms.min(MAX_TIMEOUT_MS),
        heap_bytes: limits.heap_bytes.min(MAX_HEAP_BYTES),
        output_bytes: limits.output_bytes.min(MAX_OUTPUT_BYTES),
        validate_only: !matches!(mode, WorkerMode::Execute),
        syntax_only: matches!(mode, WorkerMode::Syntax),
    };
    let payload = serde_json::to_vec(&request).map_err(|_| "无法序列化模块请求。")?;
    let exe = std::env::current_exe().map_err(|_| "无法找到模块执行器。")?;
    let mut child = Command::new(exe)
        .arg("--firefly-module-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动模块执行器。")?;
    let mut output = child.stdout.take().ok_or("无法读取模块执行结果。")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .by_ref()
            .take((MAX_OUTPUT_BYTES * 7) as u64)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    if child
        .stdin
        .take()
        .ok_or("无法传入模块请求。")?
        .write_all(&payload)
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("模块执行器未能接收请求。".into());
    }
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms + 1500);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("模块执行已取消。".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let bytes = reader
                    .join()
                    .map_err(|_| "无法读取模块结果。")?
                    .map_err(|_| "无法读取模块结果。")?;
                if !status.success() {
                    return Err("模块执行器异常退出。".into());
                }
                let reply: WorkerReply =
                    serde_json::from_slice(&bytes).map_err(|_| "模块执行器返回了无效结果。")?;
                return reply
                    .text
                    .ok_or_else(|| reply.error.unwrap_or_else(|| "模块执行失败。".into()));
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("模块执行超时，已终止执行器。".into());
            }
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn run_in_worker(
    _: BTreeMap<String, String>,
    _: String,
    _: String,
    _: String,
    _: &Limits,
    _: Arc<AtomicBool>,
    _: WorkerMode,
) -> Result<String, String> {
    Err("当前平台尚未开放第三方 JS 模块执行。".into())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn module_summary_keeps_searchable_ids_and_distinct_groups_for_unavailable_tools() {
        let mut manifest: Manifest =
            serde_json::from_str(include_str!("../../examples/modules/reverse/manifest.json"))
                .unwrap();
        let template = manifest.tools[0].clone();
        manifest.platforms = vec!["ios".into()];
        manifest.tools = [
            ("first", "工具 A", "文本处理"),
            ("second", "工具 B", "编解码"),
            ("third", "工具 C", "文本处理"),
        ]
        .into_iter()
        .map(|(suffix, name, category)| {
            let mut tool = template.clone();
            tool.id = format!("{}.{}", manifest.module_id, suffix);
            tool.name = BTreeMap::from([("zh-CN".into(), name.into())]);
            tool.category = category.into();
            tool
        })
        .collect();
        let result = summary(&manifest);
        assert_eq!(result.tools, ["工具 A", "工具 B", "工具 C"]);
        assert_eq!(
            result.tool_ids,
            [
                "dev.example.reverse.first",
                "dev.example.reverse.second",
                "dev.example.reverse.third"
            ]
        );
        assert_eq!(result.categories, ["文本处理", "编解码"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn builtin_packages_preserve_all_actions_and_default_results() {
        for descriptor in toolbox_core::list_tools() {
            let record =
                crate::builtin_modules::bundled(&format!("builtin.{}", descriptor.id)).unwrap();
            let resources = crate::builtin_modules::resources(
                &toolbox_storage::Store::open(std::path::Path::new(":memory:")).unwrap(),
                &record,
            )
            .unwrap();
            let round_trip =
                unpack_package_full(&pack_package_full(&record, &resources, true).unwrap(), true)
                    .unwrap()
                    .record;
            let manifest = parse_record(&round_trip).unwrap();
            let tool = &manifest.tools[0];
            assert!(tool.icon.is_some(), "{}", descriptor.id);
            assert_eq!(
                manifest.schema_version,
                if tool.ui.kind == "web" { 7 } else { 6 },
                "{}",
                descriptor.id
            );
            if tool.ui.kind == "web" {
                crate::validate_module_entries(&round_trip, &manifest).unwrap();
                assert!(!tool.runtime.is_none());
                continue;
            }
            assert_eq!(tool.id, descriptor.id);
            assert_eq!(
                tool.actions.len(),
                toolbox_core::tool_actions(descriptor.id).len()
            );
            for action in &tool.actions {
                let input = match (descriptor.id, action.id.as_str()) {
                    ("unicode.convert", "decode") => "\\u4F60\\u597D\\uD83D\\uDE00",
                    ("unicode.convert", "from_points") => "U+4F60 U+597D U+1F600",
                    ("json.format", _) => "{\"后\":2,\"前\":1}",
                    ("base64.convert", "decode") => "5rWB6JCk",
                    ("url.convert", "decode") => "a%20b",
                    ("time.unix", "to_date") => "0",
                    ("time.unix", _) => "1970-01-01T00:00:00Z",
                    ("uuid.generate", "generate") => "",
                    ("uuid.generate", _) => "123e4567-e89b-42d3-a456-426614174000",
                    ("color.convert", "to_rgb") => "#0F8",
                    ("color.convert", _) => "rgb(0, 255, 136)",
                    ("jwt.decode", _) => "eyJhbGciOiJub25lIn0.eyJzdWIiOiLmtYHokKQifQ.sig",
                    _ => "Ab 世界\nb\nAb 世界",
                };
                let output = execute(WorkerRequest {
                    scripts: round_trip.scripts.clone(),
                    entry: tool.entry.clone(),
                    action: action.id.clone(),
                    input: input.into(),
                    timeout_ms: manifest.limits.timeout_ms,
                    heap_bytes: manifest.limits.heap_bytes,
                    output_bytes: manifest.limits.output_bytes,
                    validate_only: false,
                    syntax_only: false,
                })
                .unwrap_or_else(|error| panic!("{} / {}: {error}", descriptor.id, action.id));
                if descriptor.id == "uuid.generate" && action.id == "generate" {
                    assert_eq!(
                        toolbox_core::run_tool("uuid.generate", "validate", &output).unwrap(),
                        output
                    );
                    assert_eq!(&output[14..15], "4");
                } else {
                    assert_eq!(
                        output,
                        toolbox_core::run_tool(descriptor.id, &action.id, input).unwrap(),
                        "{} / {}",
                        descriptor.id,
                        action.id
                    );
                }
            }
        }
    }

    #[test]
    fn whois_wildcard_requires_its_reserved_identity_and_new_app_version() {
        let mut record = crate::builtin_modules::bundled("builtin.domain.whois").unwrap();
        assert!(parse_record(&record).is_ok());
        record.manifest["min_app_version"] = "0.1.11".into();
        assert!(parse_record(&record).is_err());
        record.manifest["min_app_version"] = "0.1.12".into();
        record.module_id = "local.whois".into();
        record.manifest["module_id"] = "local.whois".into();
        record.manifest["tools"][0]["id"] = "local.whois.query".into();
        assert!(parse_record(&record).is_err());
    }
    #[test]
    fn short_link_wildcard_cannot_be_reused_by_ordinary_packages_or_older_apps() {
        let mut record = crate::builtin_modules::bundled("builtin.link.shortener").unwrap();
        assert!(parse_record(&record).is_ok());
        record.manifest["min_app_version"] = "0.1.19".into();
        assert!(parse_record(&record).is_err());
        record.manifest["min_app_version"] = "0.1.20".into();
        record.module_id = "local.shortlink".into();
        record.manifest["module_id"] = "local.shortlink".into();
        record.manifest["tools"][0]["id"] = "local.shortlink.tool".into();
        assert!(parse_record(&record).is_err());
    }

    #[test]
    fn builtin_identity_cannot_be_claimed_by_an_unrelated_package() {
        let mut record = crate::builtin_modules::bundled("builtin.json.format").unwrap();
        for (field, value) in [
            ("schema_version", serde_json::json!(5)),
            ("min_app_version", serde_json::json!("0.1.1")),
            ("module_id", serde_json::json!("builtin.unknown.tool")),
            ("module_id", serde_json::json!("json")),
        ] {
            let original = record.manifest[field].clone();
            record.manifest[field] = value;
            assert!(parse_record(&record).is_err(), "{field}");
            record.manifest[field] = original;
        }
        record.manifest["tools"][0]["id"] = serde_json::json!("base64.convert");
        assert!(parse_record(&record).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn builtin_helper_reports_bad_input_and_can_be_replaced() {
        let mut record = crate::builtin_modules::bundled("builtin.json.format").unwrap();
        let request = |scripts| WorkerRequest {
            scripts,
            entry: "main.js".into(),
            action: "format".into(),
            input: "{bad}".into(),
            timeout_ms: 1000,
            heap_bytes: 8 * 1024 * 1024,
            output_bytes: 1024,
            validate_only: false,
            syntax_only: false,
        };
        let error = execute(request(record.scripts.clone())).unwrap_err();
        assert!(error.contains("JSON"), "{error}");
        record.scripts.insert(
            "main.js".into(),
            "export function run(input, action) { return { text: action + ':' + input.text }; }"
                .into(),
        );
        assert_eq!(execute(request(record.scripts)).unwrap(), "format:{bad}");
    }

    #[cfg(target_os = "windows")]
    use zip::write::SimpleFileOptions;

    #[cfg(target_os = "windows")]
    fn package(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn skill_templates_are_importable_packages() {
        let guide =
            include_str!("../../skills/firefly-module-author/SKILL.md").replace("\r\n", "\n");
        let section = |start: &str, end: &str| -> &str {
            guide
                .split_once(start)
                .unwrap()
                .1
                .split_once(end)
                .unwrap()
                .0
        };
        let code = |section: &str, language: &str| -> String {
            section
                .split_once(&format!("```{language}\n"))
                .unwrap()
                .1
                .split_once("\n```")
                .unwrap()
                .0
                .to_owned()
        };

        let quickjs = section("## 文本处理模板", "## 网页工具模板");
        let quickjs_package = package(&[
            ("manifest.json", &code(quickjs, "json")),
            ("main.js", &code(quickjs, "js")),
        ]);
        unpack_package(&quickjs_package).expect("SKILL QuickJS 清单必须可导入");

        let web = section("## 网页工具模板", "## v7 资源与大文件");
        let web_package = package(&[
            ("manifest.json", &code(web, "json")),
            ("index.html", &code(web, "html")),
            ("style.css", &code(web, "css")),
            ("main.js", &code(web, "js")),
        ]);
        unpack_package(&web_package).expect("SKILL 网页工具清单必须可导入");

        if let Ok(path) = std::env::var("FIREFLY_MODULE_PACKAGE") {
            let bytes = std::fs::read(path).expect("无法读取待验证的 .fftool");
            unpack_package(&bytes).expect("生成的 .fftool 必须通过安装器的原生清单校验");
        }
    }

    #[test]
    fn import_reports_manifest_parse_reason() {
        let missing_field = package(&[
            ("manifest.json", "{}"),
            ("main.js", "export function run() {}"),
        ]);
        let error = unpack_package(&missing_field).unwrap_err();
        assert!(error.contains("缺少必填字段 schema_version"), "{error}");

        let invalid_json = package(&[
            ("manifest.json", "{"),
            ("main.js", "export function run() {}"),
        ]);
        let error = unpack_package(&invalid_json).unwrap_err();
        assert!(error.contains("JSON 语法错误"), "{error}");
        assert!(error.contains("第 1 行"), "{error}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn accepts_example_package_and_rejects_unsafe_entries() {
        let manifest = include_str!("../../examples/modules/reverse/manifest.json");
        let script = include_str!("../../examples/modules/reverse/main.js");
        let helper = include_str!("../../examples/modules/reverse/helper.js");
        let bytes = package(&[
            ("manifest.json", manifest),
            ("main.js", script),
            ("helper.js", helper),
        ]);
        let record = unpack_package(&bytes).unwrap();
        assert_eq!(record.module_id, "dev.example.reverse");
        let parsed = parse_record(&record).unwrap();
        assert_eq!(parsed.tools.len(), 1);
        let mut with_icon = record.clone();
        with_icon.manifest["tools"][0]["icon"] = serde_json::json!("spark");
        let exported = pack_package(&with_icon).unwrap();
        let restored = unpack_package(&exported).unwrap();
        assert_eq!(restored.scripts, record.scripts);
        assert_eq!(
            parse_record(&restored).unwrap().tools[0].icon.as_deref(),
            Some("spark")
        );
        with_icon.manifest["tools"][0]["icon"] = serde_json::json!("chart");
        assert!(pack_package(&with_icon).is_ok());
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
        with_icon.manifest["tools"][0]["icon"] = serde_json::Value::Null;
        with_icon.manifest["tools"][0]["icon_data"] = serde_json::json!(png);
        assert!(pack_package(&with_icon).is_err());
        with_icon.manifest["schema_version"] = serde_json::json!(2);
        let exported = pack_package(&with_icon).unwrap();
        let restored = unpack_package(&exported).unwrap();
        assert_eq!(
            parse_record(&restored).unwrap().tools[0]
                .icon_data
                .as_deref(),
            Some(png)
        );
        with_icon.manifest["tools"][0]["icon"] = serde_json::json!("code");
        assert!(pack_package(&with_icon).is_err());
        with_icon.manifest["tools"][0]["icon"] = serde_json::Value::Null;
        with_icon.manifest["tools"][0]["icon_data"] =
            serde_json::json!("data:image/svg+xml;base64,PHN2Zz4=");
        assert!(pack_package(&with_icon).is_err());
        with_icon.manifest["tools"][0]["icon_data"] = serde_json::Value::Null;
        with_icon.manifest["tools"][0]["icon"] = serde_json::json!("../unsafe.svg");
        assert!(pack_package(&with_icon).is_err());
        assert_eq!(
            execute(WorkerRequest {
                scripts: record.scripts,
                entry: parsed.tools[0].entry.clone(),
                action: "reverse".into(),
                input: "abc".into(),
                timeout_ms: parsed.limits.timeout_ms,
                heap_bytes: parsed.limits.heap_bytes,
                output_bytes: parsed.limits.output_bytes,
                validate_only: false,
                syntax_only: false,
            })
            .unwrap(),
            "cba"
        );
        let unsafe_bytes = package(&[("manifest.json", manifest), ("../main.js", script)]);
        assert!(unpack_package(&unsafe_bytes).is_err());
        let mut invalid: serde_json::Value = serde_json::from_str(manifest).unwrap();
        invalid["permissions"] = serde_json::json!(["network"]);
        let invalid_text = invalid.to_string();
        assert!(unpack_package(&package(&[
            ("manifest.json", &invalid_text),
            ("main.js", script)
        ]))
        .is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn executes_es_module_and_rejects_wrong_output() {
        let limits = Limits {
            input_bytes: 1024,
            output_bytes: 1024,
            timeout_ms: 1000,
            heap_bytes: 8 * 1024 * 1024,
        };
        let valid = WorkerRequest {
            scripts: BTreeMap::from([
                ("main.js".into(), "import { reverse } from './helper.js'; export function run(input, action) { return { text: action + ':' + reverse(input.text) }; }".into()),
                ("helper.js".into(), "export function reverse(text) { return text.split('').reverse().join(''); }".into()),
            ]),
            entry: "main.js".into(),
            action: "reverse".into(), input: "abc".into(), timeout_ms: limits.timeout_ms,
            heap_bytes: limits.heap_bytes, output_bytes: limits.output_bytes,
            validate_only: false,
            syntax_only: false,
        };
        assert_eq!(execute(valid).unwrap(), "reverse:cba");
        let missing_dependency = WorkerRequest {
            scripts: BTreeMap::from([(
                "main.js".into(),
                "import './missing.js'; export function run() { return { text: '' }; }".into(),
            )]),
            entry: "main.js".into(),
            action: String::new(),
            input: String::new(),
            timeout_ms: 1000,
            heap_bytes: limits.heap_bytes,
            output_bytes: 1024,
            validate_only: true,
            syntax_only: false,
        };
        assert!(execute(missing_dependency).is_err());
        let invalid = WorkerRequest {
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run() { return 42; }".into(),
            )]),
            entry: "main.js".into(),
            action: "run".into(),
            input: String::new(),
            timeout_ms: 1000,
            heap_bytes: limits.heap_bytes,
            output_bytes: 1024,
            validate_only: false,
            syntax_only: false,
        };
        assert!(execute(invalid).is_err());
        let looping = WorkerRequest {
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run() { while (true) {} }".into(),
            )]),
            entry: "main.js".into(),
            action: "run".into(),
            input: String::new(),
            timeout_ms: 20,
            heap_bytes: limits.heap_bytes,
            output_bytes: 1024,
            validate_only: false,
            syntax_only: false,
        };
        assert!(execute(looping).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_async_run_and_rejects_unsettled_tasks() {
        let request = |source: &str| WorkerRequest {
            scripts: BTreeMap::from([("main.js".into(), source.into())]),
            entry: "main.js".into(),
            action: "run".into(),
            input: "hello".into(),
            timeout_ms: 1000,
            heap_bytes: 8 * 1024 * 1024,
            output_bytes: 1024,
            validate_only: false,
            syntax_only: false,
        };
        assert_eq!(
            execute(request(
                "export async function run(input) { const text = await Promise.resolve(input.text.toUpperCase()); return { text }; }"
            ))
            .unwrap(),
            "HELLO"
        );
        assert!(execute(request(
            "export async function run() { throw Error('failed'); }"
        ))
        .is_err());
        assert!(execute(request(
            "export function run() { return new Promise(() => {}); }"
        ))
        .is_err());
    }

    #[test]
    fn execution_errors_include_message_and_source_location() {
        let error = execute(WorkerRequest {
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run() {\n  throw new Error('preview failure');\n}".into(),
            )]),
            entry: "main.js".into(),
            action: "run".into(),
            input: String::new(),
            timeout_ms: 1000,
            heap_bytes: 8 * 1024 * 1024,
            output_bytes: 1024,
            validate_only: false,
            syntax_only: false,
        })
        .unwrap_err();
        assert!(error.contains("preview failure"), "{error}");
        assert!(error.contains("main.js"), "{error}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn web_tools_require_v7_and_preserve_quickjs_text_packages() {
        let package = unpack_package(&package(&[
            (
                "manifest.json",
                include_str!("../../examples/modules/image-card/manifest.json"),
            ),
            (
                "index.html",
                include_str!("../../examples/modules/image-card/index.html"),
            ),
            (
                "style.css",
                include_str!("../../examples/modules/image-card/style.css"),
            ),
            (
                "main.js",
                include_str!("../../examples/modules/image-card/main.js"),
            ),
        ]))
        .unwrap();
        for version in 1..=6 {
            let mut old = package.clone();
            old.manifest["schema_version"] = version.into();
            assert!(
                parse_record(&old).unwrap_err().contains("v7"),
                "web v{version}"
            );
            assert!(pack_package(&old).is_err());
        }
        let builtin = crate::builtin_modules::bundled("builtin.json.format").unwrap();
        assert_eq!(parse_record(&builtin).unwrap().schema_version, 6);
        let mut browser_text = builtin.clone();
        browser_text.module_id = "local.browser_text".into();
        browser_text.manifest["module_id"] = "local.browser_text".into();
        browser_text.manifest["tools"][0]["id"] = "local.browser_text.main".into();
        browser_text.manifest["tools"][0]["runtime"] = "browser".into();
        for version in 3..=7 {
            browser_text.manifest["schema_version"] = version.into();
            assert!(
                parse_record(&browser_text).is_err(),
                "browser text v{version}"
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn v7_web_modules_support_multiple_entries_and_scoped_network() {
        let mut manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../examples/modules/image-card/manifest.json"
        ))
        .unwrap();
        manifest["permissions"] = serde_json::json!(["network"]);
        manifest["network"]["hosts"] = serde_json::json!(["https://example.com"]);
        let mut second = manifest["tools"][0].clone();
        second["id"] = "dev.example.image_card.second".into();
        second["entry"] = "second.html".into();
        manifest["tools"].as_array_mut().unwrap().push(second);
        let scripts = BTreeMap::from([
            ("index.html".into(), "<p>First</p>".into()),
            ("second.html".into(), "<p>Second</p>".into()),
            ("style.css".into(), "body{}".into()),
            ("main.js".into(), "export function mount() {}".into()),
        ]);
        assert!(
            validate_manifest(&serde_json::from_value(manifest.clone()).unwrap(), &scripts).is_ok()
        );
        let mut extra = scripts.clone();
        extra.insert("unused.js".into(), "export {}".into());
        assert!(
            validate_manifest(&serde_json::from_value(manifest.clone()).unwrap(), &extra).is_err()
        );
        manifest["limits"]["timeout_ms"] = 15_001.into();
        assert!(
            validate_manifest(&serde_json::from_value(manifest.clone()).unwrap(), &scripts)
                .is_err()
        );
        manifest["limits"]["timeout_ms"] = 15_000.into();
        manifest["network"]["hosts"] = serde_json::json!(["http://example.com"]);
        assert!(validate_manifest(&serde_json::from_value(manifest).unwrap(), &scripts).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn web_network_allows_64_exact_origins_and_two_gib_file_quotas() {
        let mut manifest: Manifest = serde_json::from_str(include_str!(
            "../../examples/modules/image-card/manifest.json"
        ))
        .unwrap();
        let scripts = BTreeMap::from([
            ("index.html".into(), "<p>Network</p>".into()),
            ("style.css".into(), "body{}".into()),
            ("main.js".into(), "export function mount() {}".into()),
        ]);
        manifest.permissions = vec!["network".into()];
        manifest.network.hosts = (0..64)
            .map(|index| format!("https://host{index}.example.com"))
            .collect();
        manifest.limits.input_bytes = MAX_FILE_BYTES as usize;
        manifest.limits.output_bytes = MAX_FILE_BYTES as usize;
        assert!(validate_manifest(&manifest, &scripts).is_ok());
        manifest
            .network
            .hosts
            .push("https://extra.example.com".into());
        assert!(validate_manifest(&manifest, &scripts).is_err());
        manifest.network.hosts.pop();
        for invalid in [
            "https://*",
            "http://host63.example.com",
            "https://host63.example.com/path",
        ] {
            manifest.network.hosts[63] = invalid.into();
            assert!(validate_manifest(&manifest, &scripts).is_err(), "{invalid}");
        }
        manifest.network.hosts[63] = "https://host63.example.com".into();
        manifest.limits.input_bytes += 1;
        assert!(validate_manifest(&manifest, &scripts).is_err());
        manifest.limits.input_bytes -= 1;
        manifest.limits.output_bytes += 1;
        assert!(validate_manifest(&manifest, &scripts).is_err());
    }

    #[test]
    fn fullscreen_is_optional_boolean_and_only_valid_for_web_tools() {
        let source = include_str!("../../examples/modules/image-card/manifest.json");
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        let ordinary: Manifest = serde_json::from_value(value.clone()).unwrap();
        assert!(!ordinary.tools[0].ui.fullscreen);
        assert!(serde_json::to_value(&ordinary).unwrap()["tools"][0]["ui"]
            .get("fullscreen")
            .is_none());
        value["tools"][0]["ui"]["fullscreen"] = true.into();
        let full: Manifest = serde_json::from_value(value.clone()).unwrap();
        let scripts = BTreeMap::from([
            ("index.html".into(), "<main/>".into()),
            ("style.css".into(), "body{}".into()),
            ("main.js".into(), "export function mount(){}".into()),
        ]);
        assert!(validate_manifest(&full, &scripts).is_ok());
        value["tools"][0]["ui"]["fullscreen"] = "true".into();
        assert!(serde_json::from_value::<Manifest>(value).is_err());
        let mut text: Manifest =
            serde_json::from_str(include_str!("../../examples/modules/reverse/manifest.json"))
                .unwrap();
        let text_scripts = BTreeMap::from([(
            "main.js".into(),
            "export function run(){return {text:''}}".into(),
        )]);
        assert!(validate_manifest(&text, &text_scripts).is_ok());
        text.tools[0].ui.fullscreen = true;
        assert!(validate_manifest(&text, &text_scripts).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn web_tool_package_round_trips_and_requires_its_resources() {
        let manifest = include_str!("../../examples/modules/image-card/manifest.json");
        let html = include_str!("../../examples/modules/image-card/index.html");
        let css = include_str!("../../examples/modules/image-card/style.css");
        let script = include_str!("../../examples/modules/image-card/main.js");
        let bytes = package(&[
            ("manifest.json", manifest),
            ("index.html", html),
            ("style.css", css),
            ("main.js", script),
        ]);
        let record = unpack_package(&bytes).unwrap();
        let parsed = parse_record(&record).unwrap();
        assert_eq!(parsed.schema_version, 7);
        assert_eq!(parsed.tools[0].ui.kind, "web");
        assert!(unpack_package(&pack_package(&record).unwrap()).is_ok());
        let mut image_input: serde_json::Value = serde_json::from_str(manifest).unwrap();
        image_input["limits"]["input_bytes"] = serde_json::json!(MAX_FILE_BYTES);
        assert!(validate_manifest(
            &serde_json::from_value(image_input.clone()).unwrap(),
            &record.scripts
        )
        .is_ok());
        image_input["limits"]["input_bytes"] = serde_json::json!(MAX_FILE_BYTES + 1);
        assert!(validate_manifest(
            &serde_json::from_value(image_input).unwrap(),
            &record.scripts
        )
        .is_err());
        let adjust = unpack_package(&package(&[
            (
                "manifest.json",
                include_str!("../../examples/modules/image-adjust/manifest.json"),
            ),
            (
                "index.html",
                include_str!("../../examples/modules/image-adjust/index.html"),
            ),
            (
                "style.css",
                include_str!("../../examples/modules/image-adjust/style.css"),
            ),
            (
                "main.js",
                include_str!("../../examples/modules/image-adjust/main.js"),
            ),
        ]))
        .unwrap();
        assert_eq!(
            parse_record(&adjust).unwrap().limits.input_bytes,
            8 * 1024 * 1024
        );
        assert!(unpack_package(&package(&[
            ("manifest.json", manifest),
            ("index.html", html),
            ("main.js", script),
        ]))
        .is_err());
        let mut old: serde_json::Value = serde_json::from_str(manifest).unwrap();
        old["schema_version"] = serde_json::json!(3);
        assert!(unpack_package(&package(&[
            ("manifest.json", &old.to_string()),
            ("index.html", html),
            ("style.css", css),
            ("main.js", script),
        ]))
        .is_err());
    }
}
