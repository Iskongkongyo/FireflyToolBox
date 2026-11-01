use std::collections::{BTreeMap, HashMap};
use toolbox_storage::{ModuleRecord, Store};

fn builtin_icon(id: &str) -> &'static str {
    match id {
        "screen.check" => "shapes",
        "quote.card" => "spark",
        "currency.today" => "chart",
        "icon.design" => "shapes",
        "rc4.convert" => "lock",
        "drawing.board" => "image",
        "mind.map" => "shapes",
        "image.color" => "image",
        "currency.exchange" => "chart",

        "fuel.price" => "bolt",
        "gold.price" => "chart",
        "time.world" => "clock",
        "text.magic" => "code",
        "color.palettes" => "shapes",

        "password.generate" => "lock",
        "fun.woodfish" => "bolt",
        "flowers.catalog" => "shapes",
        "earth.globe" => "globe",
        "dev.commands" => "code",

        "json.format" | "base64.convert" | "unicode.convert" | "regex.test" | "web.source"
        | "text.diff" | "morse.convert" | "firefly.meow" => "code",
        "url.convert" | "link.shortener" | "github.download" => "link",
        "score.board" | "health.bmi" => "chart",
        "sha256.hash" | "radix.convert" => "hash",
        "time.unix" | "cron.expression" | "focus.pomodoro" | "history.today" => "clock",
        "uuid.generate" | "decision.wheel" | "random.generate" => "spark",
        "text.dedup" | "text.case" | "notes.memo" | "poem.acrostic" | "translate.baidu" => "text",
        "color.convert" | "emoji.catalog" | "family.kinship" => "shapes",
        "jwt.decode" | "ssl.certificate" => "lock",
        "bing.wallpaper" | "image.exif" | "image.base64" | "image.stitch" | "image.compress"
        | "image.convert" | "image.hidden" | "image.watermark" | "image.pixelate" => "image",
        "audio.compress" | "audio.convert" => "file",
        "file.hash" | "markdown.editor" => "file",
        "date.countdown" | "news.briefing" | "date.calendar" => "calendar",
        "qr.decode" | "qr.generate" | "image.search" => "search",
        "news.it" | "fun.reaction" => "bolt",
        _ => "globe",
    }
}

fn fill_missing_icons(record: &mut ModuleRecord) {
    if let Some(tools) = record.manifest["tools"].as_array_mut() {
        for tool in tools {
            if tool["icon"].is_null() && tool["icon_data"].is_null() {
                if let Some(id) = tool["id"].as_str() {
                    tool["icon"] = builtin_icon(id).into();
                }
            }
        }
    }
}

pub fn tool_id(module_id: &str) -> Option<&str> {
    module_id
        .strip_prefix("builtin.")
        .filter(|id| toolbox_core::tool_exists(id))
}

pub fn bundled(module_id: &str) -> Option<ModuleRecord> {
    let id = tool_id(module_id)?;
    let tool = toolbox_core::list_tools()
        .iter()
        .find(|tool| tool.id == id)?;
    if toolbox_core::interactive_tool(id) {
        return web_record(module_id, tool);
    }
    let text_schema = serde_json::json!({"type":"object", "properties":{"text":{"type":"string"}}, "required":["text"], "additionalProperties":false});
    let manifest = serde_json::json!({
        "schema_version":6, "module_id":module_id, "version":env!("CARGO_PKG_VERSION"),
        "api_version":"1", "min_app_version":if id=="sha256.hash"{"0.1.15"}else if id=="unicode.convert"{"0.1.8"}else{"0.1.2"}, "name":{"zh-CN":tool.name},
        "author":"FireflyToolbox", "license":"MIT", "platforms":["windows","android"],
        "permissions":[], "network":{"hosts":[]},
        "limits":{"input_bytes":1048576,"output_bytes":4194304,"timeout_ms":3000,"heap_bytes":67108864},
        "tools":[{
            "id":tool.id,"name":{"zh-CN":tool.name},"description":{"zh-CN":tool.description},
            "category":tool.category,"tags":tool.tags,"aliases":tool.aliases,"icon":builtin_icon(id),"entry":"main.js",
            "input_schema":text_schema,"output_schema":text_schema,
            "ui":{"kind":"text","input_field":"text","output_field":"text"},
            "actions":toolbox_core::tool_actions(id).iter().map(|action| serde_json::json!({
                "id":action.id,"label":{"zh-CN":action.label},"input_types":action.input_types,
            })).collect::<Vec<_>>(),
        }],
    });
    let source = format!("// 默认入口复用应用提供的纯计算函数；可修改或替换 run 的实现。\nexport function run(input, action) {{\n  return {{ text: firefly.runBuiltin({}, action, input.text) }};\n}}\n", serde_json::to_string(id).ok()?);
    Some(ModuleRecord {
        module_id: module_id.into(),
        manifest,
        scripts: BTreeMap::from([("main.js".into(), source)]),
    })
}

fn image_resource_tool(id: &str) -> bool {
    matches!(
        id,
        "image.convert" | "image.compress" | "image.watermark" | "image.pixelate" | "image.edit"
    )
}
fn pdf_resource_tool(id: &str) -> bool {
    matches!(
        id,
        "image.pdf"
            | "pdf.image"
            | "pdf.merge"
            | "document.pdf"
            | "pdf.document"
            | "pdf.pages"
            | "pdf.encrypt"
            | "pdf.decrypt"
    )
}
fn pdf_security_tool(id: &str) -> bool {
    matches!(id, "pdf.encrypt" | "pdf.decrypt")
}
fn code_resource_tool(id: &str) -> bool {
    matches!(id, "html.format" | "js.format" | "css.format")
}

pub fn resource_tool(id: &str) -> bool {
    id == "image.ocr"
        || image_resource_tool(id)
        || code_resource_tool(id)
        || pdf_resource_tool(id)
        || matches!(
            id,
            "audio.compress"
                | "audio.convert"
                | "audio.speed"
                | "audio.edit"
                | "video.edit"
                | "media.info"
                | "video.speed"
                | "video.compress"
                | "video.audio"
                | "video.convert"
                | "video.gif"
                | "gif.video"
        )
}

/// Shared read-only factory engines are embedded once, outside catalog/source JSON.
pub fn bundled_resource(module_id: &str, path: &str) -> Option<std::sync::Arc<[u8]>> {
    let id = tool_id(module_id)?;
    if !resource_tool(id) {
        return None;
    }
    let image = image_resource_tool(id);
    let pdf = pdf_resource_tool(id);
    let ocr = id == "image.ocr";
    let code = code_resource_tool(id);
    match path {
        "engine/code-worker.js" if code => crate::builtin_assets::load(
            "code-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/code-worker.js.zlib"),
        ),
        "engine/code-licenses.json" if code => crate::builtin_assets::load(
            "code-licenses.json",
            include_bytes!("../builtin-tools/generated/media-assets/code-licenses.json.zlib"),
        ),
        "engine/pdf-security-worker.js" if pdf_security_tool(id) => crate::builtin_assets::load(
            "pdf-security-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-security-worker.js.zlib"),
        ),
        "engine/ocr-worker.js" if ocr => crate::builtin_assets::load(
            "ocr-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/ocr-worker.js.zlib"),
        ),
        "engine/ocr-runtime.wasm" if ocr => crate::builtin_assets::load(
            "ocr-runtime.wasm",
            include_bytes!("../builtin-tools/generated/media-assets/ocr-runtime.wasm.zlib"),
        ),
        "engine/ocr-prepare-worker.js" if ocr => crate::builtin_assets::load(
            "ocr-prepare-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/ocr-prepare-worker.js.zlib"),
        ),
        "engine/ppocr-det.bin" if ocr => crate::builtin_assets::load(
            "ppocr-det.bin",
            include_bytes!("../builtin-tools/generated/media-assets/ppocr-det.bin.zlib"),
        ),
        "engine/ppocr-rec.bin" if ocr => crate::builtin_assets::load(
            "ppocr-rec.bin",
            include_bytes!("../builtin-tools/generated/media-assets/ppocr-rec.bin.zlib"),
        ),
        "engine/ppocr-keys.json" if ocr => crate::builtin_assets::load(
            "ppocr-keys.json",
            include_bytes!("../builtin-tools/generated/media-assets/ppocr-keys.json.zlib"),
        ),
        "engine/ocr-licenses.json" if ocr => crate::builtin_assets::load(
            "ocr-licenses.json",
            include_bytes!("../builtin-tools/generated/media-assets/ocr-licenses.json.zlib"),
        ),
        "engine/pdf-engine.js" if pdf => crate::builtin_assets::load(
            "pdf-engine.js",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-engine.js.zlib"),
        ),
        "engine/pdf-worker.js" if pdf => crate::builtin_assets::load(
            "pdf-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-worker.js.zlib"),
        ),
        "engine/pdf-decrypt-worker.js" if pdf => crate::builtin_assets::load(
            "pdf-decrypt-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-decrypt-worker.js.zlib"),
        ),
        "engine/qpdf.js" if pdf => crate::builtin_assets::load(
            "qpdf.js",
            include_bytes!("../builtin-tools/generated/media-assets/qpdf.js.zlib"),
        ),
        "engine/qpdf.wasm" if pdf => crate::builtin_assets::load(
            "qpdf.wasm",
            include_bytes!("../builtin-tools/generated/media-assets/qpdf.wasm.zlib"),
        ),
        "engine/pdf-data.bin" if pdf => crate::builtin_assets::load(
            "pdf-data.bin",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-data.bin.zlib"),
        ),
        "engine/cjk-regular.ttf" if pdf => crate::builtin_assets::load(
            "cjk-regular.ttf",
            include_bytes!("../builtin-tools/generated/media-assets/cjk-regular.ttf.zlib"),
        ),
        "engine/cjk-bold.ttf" if pdf => crate::builtin_assets::load(
            "cjk-bold.ttf",
            include_bytes!("../builtin-tools/generated/media-assets/cjk-bold.ttf.zlib"),
        ),
        "engine/pdf-licenses.json" if pdf => crate::builtin_assets::load(
            "pdf-licenses.json",
            include_bytes!("../builtin-tools/generated/media-assets/pdf-licenses.json.zlib"),
        ),
        "engine/ffmpeg-core.js" if !image && !pdf && !ocr && !code => crate::builtin_assets::load(
            "ffmpeg-core.js",
            include_bytes!("../builtin-tools/generated/media-assets/ffmpeg-core.js.zlib"),
        ),
        "engine/ffmpeg-core.wasm" if !image && !pdf && !ocr && !code => {
            crate::builtin_assets::load(
                "ffmpeg-core.wasm",
                include_bytes!("../builtin-tools/generated/media-assets/ffmpeg-core.wasm.zlib"),
            )
        }
        "engine/media-worker.js" if !image && !pdf && !ocr && !code => crate::builtin_assets::load(
            "media-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/media-worker.js.zlib"),
        ),
        "engine/magick.wasm" if image || pdf || ocr => crate::builtin_assets::load(
            "magick.wasm",
            include_bytes!("../builtin-tools/generated/media-assets/magick.wasm.zlib"),
        ),
        "engine/image-format-worker.js" if image || pdf || ocr => crate::builtin_assets::load(
            "image-format-worker.js",
            include_bytes!("../builtin-tools/generated/media-assets/image-format-worker.js.zlib"),
        ),
        "engine/licenses.json" => crate::builtin_assets::load(
            "licenses.json",
            include_bytes!("../builtin-tools/generated/media-assets/licenses.json.zlib"),
        ),
        _ => None,
    }
}

pub fn resources(
    store: &Store,
    record: &ModuleRecord,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut assets = store
        .module_resources(&record.module_id)
        .map_err(|_| "无法读取工具资源。")?;
    let manifest = crate::modules::parse_record(record)?;
    for resource in &manifest.resources {
        if assets.contains_key(&resource.path) {
            continue;
        }
        if let Some(data) = bundled_resource(&record.module_id, &resource.path) {
            if crate::modules::resource_digest(&data) == resource.sha256 {
                assets.insert(resource.path.clone(), data.to_vec());
            }
        }
    }
    assets.retain(|path, _| {
        manifest
            .resources
            .iter()
            .any(|resource| &resource.path == path)
    });
    Ok(assets)
}

// Preserve the supplied packages' author, styles, capabilities and limits.
// Built-in IDs are separate from already imported copies of those packages.
fn supplied_web_record(module_id: &str, tool_id: &str) -> Option<ModuleRecord> {
    let (manifest, html, css, script) = match tool_id {
        "screen.check" => (
            include_str!("../builtin-tools/src/screen-check.manifest.json"),
            include_str!("../builtin-tools/src/screen-check.html"),
            include_str!("../builtin-tools/src/screen-check.css"),
            include_str!("../builtin-tools/generated/screen-check.js"),
        ),
        "quote.card" => (
            include_str!("../builtin-tools/src/quote-card.manifest.json"),
            include_str!("../builtin-tools/src/quote-card.html"),
            include_str!("../builtin-tools/src/quote-card.css"),
            include_str!("../builtin-tools/generated/quote-card.js"),
        ),
        "drawing.board" => (
            include_str!("../builtin-tools/src/drawing.manifest.json"),
            include_str!("../builtin-tools/src/drawing.html"),
            include_str!("../builtin-tools/src/drawing.css"),
            include_str!("../builtin-tools/generated/drawing.js"),
        ),
        "mind.map" => (
            include_str!("../builtin-tools/src/mindmap.manifest.json"),
            include_str!("../builtin-tools/src/mindmap.html"),
            include_str!("../builtin-tools/src/mindmap.css"),
            include_str!("../builtin-tools/generated/mindmap.js"),
        ),
        "text.diff" => (
            include_str!("../builtin-tools/src/diff.manifest.json"),
            include_str!("../builtin-tools/src/diff.html"),
            include_str!("../builtin-tools/src/diff.css"),
            include_str!("../builtin-tools/generated/diff.js"),
        ),
        "markdown.editor" => (
            include_str!("../builtin-tools/src/markdown.manifest.json"),
            include_str!("../builtin-tools/src/markdown.html"),
            include_str!("../builtin-tools/src/markdown.css"),
            include_str!("../builtin-tools/generated/markdown.js"),
        ),
        _ => return None,
    };
    let mut manifest: serde_json::Value = serde_json::from_str(manifest).ok()?;
    manifest["module_id"] = module_id.into();
    manifest["version"] = env!("CARGO_PKG_VERSION").into();
    manifest["min_app_version"] = env!("CARGO_PKG_VERSION").into();
    manifest["tools"][0]["id"] = tool_id.into();
    // The package serializer omits empty resources. Keep factory metadata in
    // that same form so an unchanged export/import is not marked as an edit.
    if manifest["resources"].as_array().is_some_and(Vec::is_empty) {
        manifest.as_object_mut()?.remove("resources");
    }
    Some(ModuleRecord {
        module_id: module_id.into(),
        manifest,
        scripts: BTreeMap::from([
            ("index.html".into(), html.into()),
            ("style.css".into(), css.into()),
            ("main.js".into(), script.into()),
        ]),
    })
}

fn web_record(module_id: &str, tool: &toolbox_core::ToolDescriptor) -> Option<ModuleRecord> {
    if let Some(record) = supplied_web_record(module_id, tool.id) {
        return Some(record);
    }
    let (html, script, icon) = match tool.id {
        "github.download" => (
            include_str!("../builtin-tools/src/github-download.html"),
            include_str!("../builtin-tools/generated/github-download.js"),
            "link",
        ),
        "file.links" => (
            include_str!("../builtin-tools/src/file-links.html"),
            include_str!("../builtin-tools/generated/file-links.js"),
            "link",
        ),
        "identity.lookup" => (
            include_str!("../builtin-tools/src/identity.html"),
            include_str!("../builtin-tools/generated/identity.js"),
            "search",
        ),
        "bankcard.lookup" => (
            include_str!("../builtin-tools/src/bankcard.html"),
            include_str!("../builtin-tools/generated/bankcard.js"),
            "chart",
        ),
        "pdf.encrypt" => (
            include_str!("../builtin-tools/generated/media-assets/pdf.encrypt.html"),
            include_str!("../builtin-tools/generated/pdf-security.js"),
            "lock",
        ),
        "pdf.decrypt" => (
            include_str!("../builtin-tools/generated/media-assets/pdf.decrypt.html"),
            include_str!("../builtin-tools/generated/pdf-security.js"),
            "lock",
        ),
        "html.format" => (
            include_str!("../builtin-tools/generated/media-assets/html.format.html"),
            include_str!("../builtin-tools/generated/code-tools.js"),
            "code",
        ),
        "js.format" => (
            include_str!("../builtin-tools/generated/media-assets/js.format.html"),
            include_str!("../builtin-tools/generated/code-tools.js"),
            "code",
        ),
        "css.format" => (
            include_str!("../builtin-tools/generated/media-assets/css.format.html"),
            include_str!("../builtin-tools/generated/code-tools.js"),
            "code",
        ),
        "unit.convert" => (
            include_str!("../builtin-tools/generated/media-assets/unit.convert.html"),
            include_str!("../builtin-tools/generated/utility-tools.js"),
            "calculator",
        ),
        "math.calculate" => (
            include_str!("../builtin-tools/generated/media-assets/math.calculate.html"),
            include_str!("../builtin-tools/generated/utility-tools.js"),
            "calculator",
        ),
        "text.replace" => (
            include_str!("../builtin-tools/generated/media-assets/text.replace.html"),
            include_str!("../builtin-tools/generated/utility-tools.js"),
            "text",
        ),
        "data.convert" => (
            include_str!("../builtin-tools/generated/media-assets/data.convert.html"),
            include_str!("../builtin-tools/generated/utility-tools.js"),
            "file",
        ),
        "zip.manage" => (
            include_str!("../builtin-tools/src/zip-tools.html"),
            include_str!("../builtin-tools/generated/zip-tools.js"),
            "folder",
        ),
        "media.info" => (
            include_str!("../builtin-tools/src/media-info.html"),
            include_str!("../builtin-tools/generated/media-info.js"),
            "file",
        ),
        "audio.edit" => (
            include_str!("../builtin-tools/generated/media-assets/audio.edit.html"),
            include_str!("../builtin-tools/generated/media-edit.js"),
            "file",
        ),
        "video.edit" => (
            include_str!("../builtin-tools/generated/media-assets/video.edit.html"),
            include_str!("../builtin-tools/generated/media-edit.js"),
            "image",
        ),
        "image.edit" => (
            include_str!("../builtin-tools/src/image-edit.html"),
            include_str!("../builtin-tools/generated/image-edit.js"),
            "image",
        ),
        "pdf.pages" => (
            include_str!("../builtin-tools/src/pdf-pages.html"),
            include_str!("../builtin-tools/generated/pdf-pages.js"),
            "file",
        ),
        "text.count" => (
            include_str!("../builtin-tools/src/textcount.html"),
            include_str!("../builtin-tools/generated/textcount.js"),
            "text",
        ),
        "boxoffice.live" => (
            include_str!("../builtin-tools/src/boxoffice.html"),
            include_str!("../builtin-tools/generated/boxoffice.js"),
            "chart",
        ),
        "image.ocr" => (
            include_str!("../builtin-tools/src/ocr.html"),
            include_str!("../builtin-tools/generated/ocr.js"),
            "image",
        ),
        "ai.resources" => (
            include_str!("../builtin-tools/src/ai-hub.html"),
            include_str!("../builtin-tools/generated/ai-hub.js"),
            "spark",
        ),
        "video.speed" => (
            include_str!("../builtin-tools/generated/media-assets/video.speed.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "image",
        ),
        "audio.speed" => (
            include_str!("../builtin-tools/generated/media-assets/audio.speed.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "file",
        ),
        "image.pdf" => (
            include_str!("../builtin-tools/generated/media-assets/image.pdf.html"),
            include_str!("../builtin-tools/generated/pdf-tools.js"),
            "file",
        ),
        "pdf.image" => (
            include_str!("../builtin-tools/generated/media-assets/pdf.image.html"),
            include_str!("../builtin-tools/generated/pdf-tools.js"),
            "image",
        ),
        "pdf.merge" => (
            include_str!("../builtin-tools/generated/media-assets/pdf.merge.html"),
            include_str!("../builtin-tools/generated/pdf-tools.js"),
            "file",
        ),
        "document.pdf" => (
            include_str!("../builtin-tools/generated/media-assets/document.pdf.html"),
            include_str!("../builtin-tools/generated/pdf-tools.js"),
            "file",
        ),
        "pdf.document" => (
            include_str!("../builtin-tools/generated/media-assets/pdf.document.html"),
            include_str!("../builtin-tools/generated/pdf-tools.js"),
            "file",
        ),
        "image.watermark" => (
            include_str!("../builtin-tools/generated/media-assets/image.watermark.html"),
            include_str!("../builtin-tools/generated/image-effects.js"),
            "image",
        ),
        "image.pixelate" => (
            include_str!("../builtin-tools/generated/media-assets/image.pixelate.html"),
            include_str!("../builtin-tools/generated/image-effects.js"),
            "image",
        ),
        "audio.compress" => (
            include_str!("../builtin-tools/generated/media-assets/audio.compress.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "file",
        ),
        "audio.convert" => (
            include_str!("../builtin-tools/generated/media-assets/audio.convert.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "file",
        ),
        "video.compress" => (
            include_str!("../builtin-tools/generated/media-assets/video.compress.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "image",
        ),
        "video.audio" => (
            include_str!("../builtin-tools/generated/media-assets/video.audio.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "file",
        ),
        "video.convert" => (
            include_str!("../builtin-tools/generated/media-assets/video.convert.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "image",
        ),
        "video.gif" => (
            include_str!("../builtin-tools/generated/media-assets/video.gif.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "image",
        ),
        "gif.video" => (
            include_str!("../builtin-tools/generated/media-assets/gif.video.html"),
            include_str!("../builtin-tools/generated/media.js"),
            "image",
        ),
        "currency.today" => (
            include_str!("../builtin-tools/src/daily-rates.html"),
            include_str!("../builtin-tools/generated/daily-rates.js"),
            "chart",
        ),
        "icon.design" => (
            include_str!("../builtin-tools/src/icon-design.html"),
            include_str!("../builtin-tools/generated/icon-design.js"),
            "shapes",
        ),
        "rc4.convert" => (
            include_str!("../builtin-tools/src/rc4.html"),
            include_str!("../builtin-tools/generated/rc4.js"),
            "lock",
        ),
        "image.color" => (
            include_str!("../builtin-tools/src/color-picker.html"),
            include_str!("../builtin-tools/generated/color-picker.js"),
            "image",
        ),
        "currency.exchange" => (
            include_str!("../builtin-tools/src/exchange.html"),
            include_str!("../builtin-tools/generated/exchange.js"),
            "chart",
        ),

        "fuel.price" => (
            include_str!("../builtin-tools/src/fuel.html"),
            include_str!("../builtin-tools/generated/fuel.js"),
            "bolt",
        ),
        "gold.price" => (
            include_str!("../builtin-tools/src/gold.html"),
            include_str!("../builtin-tools/generated/gold.js"),
            "chart",
        ),
        "time.world" => (
            include_str!("../builtin-tools/src/worldtime.html"),
            include_str!("../builtin-tools/generated/worldtime.js"),
            "clock",
        ),
        "text.magic" => (
            include_str!("../builtin-tools/src/magic.html"),
            include_str!("../builtin-tools/generated/magic.js"),
            "code",
        ),
        "color.palettes" => (
            include_str!("../builtin-tools/src/palettes.html"),
            include_str!("../builtin-tools/generated/palettes.js"),
            "shapes",
        ),

        "password.generate" => (
            include_str!("../builtin-tools/src/password.html"),
            include_str!("../builtin-tools/generated/password.js"),
            "lock",
        ),
        "fun.woodfish" => (
            include_str!("../builtin-tools/src/woodfish.html"),
            include_str!("../builtin-tools/generated/woodfish.js"),
            "bolt",
        ),
        "flowers.catalog" => (
            include_str!("../builtin-tools/src/flowers.html"),
            include_str!("../builtin-tools/generated/flowers.js"),
            "shapes",
        ),
        "earth.globe" => (
            include_str!("../builtin-tools/src/globe.html"),
            include_str!("../builtin-tools/generated/globe.js"),
            "globe",
        ),
        "dev.commands" => (
            include_str!("../builtin-tools/src/commands.html"),
            include_str!("../builtin-tools/generated/commands.js"),
            "code",
        ),

        "fun.reaction" => (
            include_str!("../builtin-tools/src/reaction.html"),
            include_str!("../builtin-tools/generated/reaction.js"),
            "bolt",
        ),
        "random.generate" => (
            include_str!("../builtin-tools/src/random.html"),
            include_str!("../builtin-tools/generated/random.js"),
            "spark",
        ),
        "link.shortener" => (
            include_str!("../builtin-tools/src/shortlink.html"),
            include_str!("../builtin-tools/generated/shortlink.js"),
            "link",
        ),
        "poem.acrostic" => (
            include_str!("../builtin-tools/src/poem.html"),
            include_str!("../builtin-tools/generated/poem.js"),
            "text",
        ),
        "translate.baidu" => (
            include_str!("../builtin-tools/src/translate.html"),
            include_str!("../builtin-tools/generated/translate.js"),
            "text",
        ),
        "morse.convert" => (
            include_str!("../builtin-tools/src/morse.html"),
            include_str!("../builtin-tools/generated/morse.js"),
            "code",
        ),
        "image.hidden" => (
            include_str!("../builtin-tools/src/hiddenimage.html"),
            include_str!("../builtin-tools/generated/hiddenimage.js"),
            "image",
        ),
        "family.kinship" => (
            include_str!("../builtin-tools/src/kinship.html"),
            include_str!("../builtin-tools/generated/kinship.js"),
            "shapes",
        ),
        "firefly.meow" => (
            include_str!("../builtin-tools/src/meow.html"),
            include_str!("../builtin-tools/generated/meow.js"),
            "code",
        ),
        "image.search" => (
            include_str!("../builtin-tools/src/imagesearch.html"),
            include_str!("../builtin-tools/generated/imagesearch.js"),
            "search",
        ),
        "weather.forecast" => (
            include_str!("../builtin-tools/src/weather.html"),
            include_str!("../builtin-tools/generated/weather.js"),
            "globe",
        ),
        "date.calendar" => (
            include_str!("../builtin-tools/src/calendar.html"),
            include_str!("../builtin-tools/generated/calendar.js"),
            "calendar",
        ),
        "qr.generate" => (
            include_str!("../builtin-tools/src/qrgenerate.html"),
            include_str!("../builtin-tools/generated/qrgenerate.js"),
            "search",
        ),
        "image.stitch" => (
            include_str!("../builtin-tools/src/imagestitch.html"),
            include_str!("../builtin-tools/generated/imagestitch.js"),
            "image",
        ),
        "image.compress" => (
            include_str!("../builtin-tools/src/imagecompress.html"),
            include_str!("../builtin-tools/generated/imagecompress.js"),
            "image",
        ),
        "image.convert" => (
            include_str!("../builtin-tools/src/imageconvert.html"),
            include_str!("../builtin-tools/generated/imageconvert.js"),
            "image",
        ),
        "health.bmi" => (
            include_str!("../builtin-tools/src/bmi.html"),
            include_str!("../builtin-tools/generated/bmi.js"),
            "chart",
        ),
        "phone.location" => (
            include_str!("../builtin-tools/src/phone.html"),
            include_str!("../builtin-tools/generated/phone.js"),
            "globe",
        ),
        "image.base64" => (
            include_str!("../builtin-tools/src/imagebase64.html"),
            include_str!("../builtin-tools/generated/imagebase64.js"),
            "image",
        ),
        "regex.test" => (
            include_str!("../builtin-tools/src/regex.html"),
            include_str!("../builtin-tools/generated/regex.js"),
            "code",
        ),
        "cron.expression" => (
            include_str!("../builtin-tools/src/cron.html"),
            include_str!("../builtin-tools/generated/cron.js"),
            "clock",
        ),
        "radix.convert" => (
            include_str!("../builtin-tools/src/radix.html"),
            include_str!("../builtin-tools/generated/radix.js"),
            "hash",
        ),
        "file.hash" => (
            include_str!("../builtin-tools/src/hash.html"),
            include_str!("../builtin-tools/generated/hash.js"),
            "file",
        ),
        "web.source" => (
            include_str!("../builtin-tools/src/source.html"),
            include_str!("../builtin-tools/generated/source.js"),
            "code",
        ),
        "ssl.certificate" => (
            include_str!("../builtin-tools/src/certificate.html"),
            include_str!("../builtin-tools/generated/certificate.js"),
            "lock",
        ),
        "decision.wheel" => (
            include_str!("../builtin-tools/src/decision.html"),
            include_str!("../builtin-tools/generated/decision.js"),
            "spark",
        ),
        "focus.pomodoro" => (
            include_str!("../builtin-tools/src/pomodoro.html"),
            include_str!("../builtin-tools/generated/pomodoro.js"),
            "clock",
        ),
        "history.today" => (
            include_str!("../builtin-tools/src/history.html"),
            include_str!("../builtin-tools/generated/history.js"),
            "clock",
        ),
        "bing.wallpaper" => (
            include_str!("../builtin-tools/src/bing.html"),
            include_str!("../builtin-tools/generated/bing.js"),
            "image",
        ),
        "score.board" => (
            include_str!("../builtin-tools/src/score.html"),
            include_str!("../builtin-tools/generated/score.js"),
            "hash",
        ),
        "trending.live" => (
            include_str!("../builtin-tools/src/trending.html"),
            include_str!("../builtin-tools/generated/trending.js"),
            "globe",
        ),
        "date.countdown" => (
            include_str!("../builtin-tools/src/countdown.html"),
            include_str!("../builtin-tools/generated/countdown.js"),
            "calendar",
        ),
        "notes.memo" => (
            include_str!("../builtin-tools/src/memo.html"),
            include_str!("../builtin-tools/generated/memo.js"),
            "text",
        ),
        "image.exif" => (
            include_str!("../builtin-tools/src/exif.html"),
            include_str!("../builtin-tools/generated/exif.js"),
            "image",
        ),
        "emoji.catalog" => (
            include_str!("../builtin-tools/src/emoji.html"),
            include_str!("../builtin-tools/generated/emoji.js"),
            "shapes",
        ),
        "qr.decode" => (
            include_str!("../builtin-tools/src/qr.html"),
            include_str!("../builtin-tools/generated/qr.js"),
            "search",
        ),
        "domain.whois" => (
            include_str!("../builtin-tools/src/whois.html"),
            include_str!("../builtin-tools/generated/whois.js"),
            "globe",
        ),
        "network.ip" => (
            include_str!("../builtin-tools/src/ip.html"),
            include_str!("../builtin-tools/generated/ip.js"),
            "globe",
        ),
        "news.briefing" => (
            include_str!("../builtin-tools/src/briefing.html"),
            include_str!("../builtin-tools/generated/briefing.js"),
            "calendar",
        ),
        "news.it" => (
            include_str!("../builtin-tools/src/itnews.html"),
            include_str!("../builtin-tools/generated/itnews.js"),
            "bolt",
        ),
        _ => return None,
    };
    let hosts = match tool.id {
        "github.download" => vec![
            "https://cdn.jsdelivr.net",
            "https://cdn.statically.io",
            "https://pd.zwc365.com",
            "https://ghfast.top",
            "https://github.com",
            "https://raw.githubusercontent.com",
            "https://codeload.github.com",
        ],
        "file.links" => vec![
            "https://catbox.moe",
            "https://litterbox.catbox.moe",
            "https://uguu.se",
            "https://postimg.cc",
            "https://postimages.org",
            "https://gofile.io",
            "https://ibb.co",
            "https://imgbb.com",
        ],
        "bankcard.lookup" => vec!["https://lookup.binlist.net"],
        "boxoffice.live" => vec!["https://piaofang.maoyan.com"],
        "ai.resources" => vec![
            "https://prompts.chat",
            "https://skills.sh",
            "https://api.github.com",
            "https://github.com",
            "https://ai-bot.cn",
            "https://www.futurepedia.io",
            "https://theresanaiforthat.com",
        ],
        "currency.exchange" | "currency.today" => vec!["https://api.frankfurter.dev"],
        "fuel.price" => vec!["https://60s.7se.cn", "https://60s.crystelf.top"],
        "gold.price" => vec![
            "https://60s.7se.cn",
            "https://60s.crystelf.top",
            "https://api.gold-api.com",
        ],
        "link.shortener" => vec![
            "https://*",
            "https://is.gd",
            "https://v.gd",
            "https://spoo.me",
            "https://ulvis.net",
            "https://suo.yt",
        ],
        "poem.acrostic" => vec!["https://api.tangdouz.com"],
        "translate.baidu" => vec![
            "https://fanyi.baidu.com",
            "https://fanyi.youdao.com",
            "https://translate.google.com",
            "https://fanyi.sogou.com",
            "https://www.deepl.com",
            "https://www.bing.com",
        ],
        "image.search" => vec![
            "https://pic.sogou.com",
            "https://image.baidu.com",
            "https://st.so.com",
            "https://images.google.com",
            "https://yandex.com",
            "https://www.tineye.com",
            "https://trace.moe",
            "https://iqdb.org",
            "https://saucenao.com",
        ],
        "web.source" | "ssl.certificate" | "domain.whois" => vec!["https://*"],
        "network.ip" => vec!["https://api.live.bilibili.com"],
        "phone.location" => vec!["https://cx.shouji.360.cn"],
        "weather.forecast" => vec![
            "https://www.nmc.cn",
            "https://api.open-meteo.com",
            "https://geocoding-api.open-meteo.com",
        ],
        "news.briefing" => vec![
            "https://60s-static.viki.moe",
            "https://cdn.jsdelivr.net",
            "https://raw.githubusercontent.com",
        ],
        "news.it" => vec!["https://www.ithome.com"],
        "history.today" => vec!["https://baike.baidu.com"],
        "bing.wallpaper" => vec!["https://www.bing.com", "https://cn.bing.com"],
        "trending.live" => vec![
            "https://top.baidu.com",
            "https://weibo.com",
            "https://www.iesdouyin.com",
            "https://www.toutiao.com",
            "https://api.zhihu.com",
            "https://api.bilibili.com",
            "https://tieba.baidu.com",
        ],
        _ => vec![],
    };
    let resource_based = resource_tool(tool.id);
    let resources: serde_json::Value = if resource_based {
        serde_json::from_str(if tool.id == "image.ocr" {
            include_str!("../builtin-tools/generated/media-assets/ocr-resources.json")
        } else if code_resource_tool(tool.id) {
            include_str!("../builtin-tools/generated/media-assets/code-resources.json")
        } else if pdf_security_tool(tool.id) {
            include_str!("../builtin-tools/generated/media-assets/pdf-security-resources.json")
        } else if pdf_resource_tool(tool.id) {
            include_str!("../builtin-tools/generated/media-assets/pdf-resources.json")
        } else if image_resource_tool(tool.id) {
            include_str!("../builtin-tools/generated/media-assets/image-resources.json")
        } else {
            include_str!("../builtin-tools/generated/media-assets/video-resources.json")
        })
        .ok()?
    } else {
        serde_json::json!([])
    };
    let mut record = ModuleRecord {
        module_id: module_id.into(),
        manifest: serde_json::json!({
            "schema_version":7,"module_id":module_id,"version":env!("CARGO_PKG_VERSION"),"api_version":"1","min_app_version":env!("CARGO_PKG_VERSION"),
            "name":{"zh-CN":tool.name},"author":"FireflyToolbox","license":"MIT","platforms":["windows","android"],
            "permissions":if hosts.is_empty() {vec![]} else {vec!["network"]},"network":{"hosts":hosts},
            "limits":{"input_bytes":8388608,"output_bytes":4194304,"timeout_ms":15000,"heap_bytes":67108864},
            "tools":[{"id":tool.id,"name":{"zh-CN":tool.name},"description":{"zh-CN":tool.description},"category":tool.category,"tags":tool.tags,"aliases":tool.aliases,"icon":icon,
                "runtime":"browser","entry":"index.html","input_schema":null,"output_schema":null,"ui":{"kind":"web","script":"main.js","style":"style.css"},
                "actions":[{"id":"open","label":{"zh-CN":"打开工具"}}]}]
        }),
        scripts: BTreeMap::from([
            ("index.html".into(), html.into()),
            (
                "style.css".into(),
                format!(
                    "{}\n{}\n{}\n{}\n{}",
                    include_str!("../builtin-tools/src/common.css"),
                    include_str!("../builtin-tools/src/life.css"),
                    include_str!("../builtin-tools/src/utility.css"),
                    include_str!("../builtin-tools/src/new-tools.css"),
                    include_str!("../builtin-tools/src/creative-tools.css")
                ),
            ),
            ("main.js".into(), script.into()),
        ]),
    };
    if tool.id == "zip.manage" {
        record.manifest["limits"]["input_bytes"] = 67108864u64.into();
        record.manifest["limits"]["output_bytes"] = 134217728u64.into();
    }
    if matches!(
        tool.id,
        "image.hidden" | "image.stitch" | "image.exif" | "image.base64" | "image.color"
    ) {
        record.manifest["limits"]["input_bytes"] = if tool.id == "image.exif" {
            268435456u64
        } else if tool.id == "image.base64" {
            100663296u64
        } else {
            67108864u64
        }
        .into();
        record.manifest["limits"]["output_bytes"] = if tool.id == "image.exif" {
            16777216u64
        } else if tool.id == "image.base64" {
            100663296u64
        } else if tool.id == "image.color" {
            4194304u64
        } else {
            134217728u64
        }
        .into();
    }
    if resource_based {
        record.manifest["license"] = if code_resource_tool(tool.id) {
            "MIT AND BSD-2-Clause"
        } else if pdf_security_tool(tool.id) {
            "Apache-2.0"
        } else if pdf_resource_tool(tool.id) {
            "MIT AND Apache-2.0 AND OFL-1.1"
        } else if tool.id == "image.ocr" {
            "MIT AND Apache-2.0"
        } else if image_resource_tool(tool.id) {
            "Apache-2.0"
        } else {
            "GPL-2.0-or-later"
        }
        .into();
        record.manifest["resources"] = resources;
        record.manifest["limits"]["input_bytes"] = if tool.id == "image.ocr" {
            33554432u64
        } else if pdf_security_tool(tool.id) {
            67108864u64
        } else if code_resource_tool(tool.id) {
            1048576u64
        } else if image_resource_tool(tool.id) {
            268435456u64
        } else if pdf_resource_tool(tool.id) {
            134217728u64
        } else {
            2147483648u64
        }
        .into();
        record.manifest["limits"]["output_bytes"] = if tool.id == "image.ocr" {
            4194304u64
        } else if code_resource_tool(tool.id) {
            4194304u64
        } else if pdf_resource_tool(tool.id) {
            67108864u64
        } else if image_resource_tool(tool.id) {
            536870912u64
        } else {
            2147483648u64
        }
        .into();
    }
    if tool.id == "identity.lookup" {
        record.manifest["license"] = "MIT AND WTFPL".into();
    }
    Some(record)
}

pub fn records(store: &Store) -> Result<Vec<ModuleRecord>, String> {
    let overrides: HashMap<_, _> = store
        .builtin_module_overrides()
        .map_err(|_| "无法读取应用自带工具的修改。")?
        .into_iter()
        .map(|record| (record.module_id.clone(), record))
        .collect();
    let displays: HashMap<_, _> = store
        .builtin_tool_displays()
        .map_err(|_| "无法读取应用自带工具信息。")?
        .into_iter()
        .map(|display| (display.id.clone(), display))
        .collect();
    let legacy_sources = store
        .builtin_tool_sources()
        .map_err(|_| "无法读取应用自带工具源码。")?;
    let mut result = Vec::new();
    for tool in toolbox_core::list_tools() {
        let module_id = format!("builtin.{}", tool.id);
        if let Some(record) = overrides.get(&module_id) {
            let mut record = record.clone();
            fill_missing_icons(&mut record);
            result.push(record);
            continue;
        }
        let mut record = bundled(&module_id).ok_or("应用自带工具清单无效。")?;
        if let Some(display) = displays.get(tool.id) {
            record.manifest["name"]["zh-CN"] = display.name.clone().into();
            record.manifest["tools"][0]["name"]["zh-CN"] = display.name.clone().into();
            record.manifest["tools"][0]["description"]["zh-CN"] =
                display.description.clone().into();
            record.manifest["tools"][0]["category"] = display.category.clone().into();
        }
        if let Some(source) = legacy_sources.get(tool.id) {
            record.scripts.insert("main.js".into(), source.clone());
        }
        result.push(record);
    }
    Ok(result)
}

pub fn modified(record: &ModuleRecord) -> bool {
    bundled(&record.module_id).is_some_and(|default| {
        default.manifest != record.manifest || default.scripts != record.scripts
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplied_tools_keep_their_author_limits_and_display_policy() {
        for (id, original_id, output, fullscreen) in [
            (
                "screen.check",
                "firefly.screen_check.check",
                1048576u64,
                true,
            ),
            ("quote.card", "firefly.quote_card.make", 33554432u64, false),
            (
                "drawing.board",
                "firefly.draw_board.board",
                33554432u64,
                true,
            ),
            ("mind.map", "firefly.mind_map.board", 33554432u64, true),
            (
                "text.diff",
                "firefly.diff_check.compare",
                33554432u64,
                false,
            ),
            (
                "markdown.editor",
                "firefly.md_editor.editor",
                33554432u64,
                true,
            ),
        ] {
            let record = bundled(&format!("builtin.{id}")).unwrap();
            let manifest = crate::modules::parse_record(&record).unwrap();
            assert_eq!(manifest.tools[0].id, id);
            assert_ne!(manifest.tools[0].id, original_id);
            assert!(toolbox_core::interactive_tool(id));
            assert_eq!(record.manifest["author"], "流萤可爱捏");
            assert_eq!(record.manifest["license"], "MIT");
            assert_eq!(manifest.limits.output_bytes, output as usize);
            assert_eq!(
                manifest.limits.input_bytes,
                if matches!(id, "screen.check" | "quote.card") {
                    1048576
                } else {
                    33554432
                }
            );
            assert_eq!(
                record.manifest["tools"][0]["ui"]["fullscreen"]
                    .as_bool()
                    .unwrap_or(false),
                fullscreen
            );
            assert_eq!(record.scripts.len(), 3);
            crate::validate_module_entries(&record, &manifest).unwrap();
            assert!(!modified(&record));
            if id == "quote.card" {
                assert_eq!(
                    manifest.network.hosts,
                    [
                        "https://v1.hitokoto.cn",
                        "https://v1.jinrishici.com",
                        "https://api.shadiao.pro",
                        "https://api.btstu.cn"
                    ]
                );
            } else {
                assert!(manifest.network.hosts.is_empty());
            }
        }
    }

    #[test]
    fn supplied_builtins_export_round_trip_and_restore_as_factory_tools() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        for id in [
            "screen.check",
            "quote.card",
            "drawing.board",
            "mind.map",
            "text.diff",
            "markdown.editor",
        ] {
            let module_id = format!("builtin.{id}");
            let factory = bundled(&module_id).unwrap();
            let packed =
                crate::modules::pack_package_full(&factory, &BTreeMap::new(), true).unwrap();
            let round_trip = crate::modules::unpack_package_full(&packed, true)
                .unwrap()
                .record;
            assert_eq!(round_trip.manifest, factory.manifest);
            assert_eq!(round_trip.scripts, factory.scripts);
            let mut edited = factory.clone();
            edited.manifest["tools"][0]["name"]["zh-CN"] = "编辑后的内置工具".into();
            store.save_builtin_module(&edited, id).unwrap();
            assert!(records(&store)
                .unwrap()
                .iter()
                .find(|r| r.module_id == module_id)
                .is_some_and(modified));
            store.reset_builtin_module(&module_id, id).unwrap();
            let restored = records(&store)
                .unwrap()
                .into_iter()
                .find(|r| r.module_id == module_id)
                .unwrap();
            assert_eq!(restored.manifest, factory.manifest);
            assert_eq!(restored.scripts, factory.scripts);
            assert!(!modified(&restored));
        }
    }
    #[test]
    fn web_catalog_is_v7_and_text_tools_keep_their_protocol_and_quotas() {
        let mut web = 0;
        let mut text = 0;
        for tool in toolbox_core::list_tools() {
            let record = bundled(&format!("builtin.{}", tool.id)).unwrap();
            let manifest = crate::modules::parse_record(&record).unwrap();
            if toolbox_core::interactive_tool(tool.id) {
                web += 1;
                assert_eq!(manifest.schema_version, 7, "{}", tool.id);
                assert_eq!(manifest.min_app_version, env!("CARGO_PKG_VERSION"));
                assert_eq!(manifest.tools[0].ui.kind, "web");
            } else {
                text += 1;
                assert_eq!(manifest.schema_version, 6, "{}", tool.id);
                assert!(manifest.tools[0].runtime.is_none());
                assert_eq!(manifest.limits.input_bytes, 1048576);
                assert_eq!(manifest.limits.output_bytes, 4194304);
            }
        }
        assert_eq!((web, text), (100, 11));
        let small = bundled("builtin.github.download").unwrap();
        assert_eq!(small.manifest["limits"]["input_bytes"], 8388608);
        assert_eq!(small.manifest["limits"]["output_bytes"], 4194304);
    }
    #[test]
    fn all_builtin_tools_have_icons_and_existing_custom_icons_are_preserved() {
        for tool in toolbox_core::list_tools() {
            let record = bundled(&format!("builtin.{}", tool.id)).unwrap();
            assert!(
                record.manifest["tools"][0]["icon"].as_str().is_some(),
                "{}",
                tool.id
            );
        }
        let mut record = bundled("builtin.json.format").unwrap();
        record.manifest["tools"][0]
            .as_object_mut()
            .unwrap()
            .remove("icon");
        fill_missing_icons(&mut record);
        assert_eq!(record.manifest["tools"][0]["icon"], "code");
        record.manifest["tools"][0]["icon"] = "heart".into();
        fill_missing_icons(&mut record);
        assert_eq!(record.manifest["tools"][0]["icon"], "heart");
    }
}
