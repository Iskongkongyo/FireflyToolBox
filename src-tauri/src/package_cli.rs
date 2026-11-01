use crate::modules;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use toolbox_storage::ModuleRecord;

const MAX_FILE: usize = modules::MAX_SOURCE_BYTES;
const MAX_PACKAGE: usize = modules::MAX_PACKAGE_BYTES;
const USAGE: &str = "用法：firefly-toolbox.exe --pack-fftool <工具目录> [输出.fftool]；--check-fftool <工具包.fftool>；--help-fftool";

pub fn run(args: &[OsString]) -> Option<i32> {
    let command = args.first()?.to_str()?;
    if !matches!(
        command,
        "--pack-fftool" | "--check-fftool" | "--help-fftool"
    ) {
        return None;
    }
    let result = match (command, args.len()) {
        ("--help-fftool", 1) => Ok(
            serde_json::json!({"ok":true,"usage":USAGE,"version":env!("CARGO_PKG_VERSION"),"requires_project":false,"requires_node":false}),
        ),
        ("--pack-fftool", 2 | 3) => pack(Path::new(&args[1]), args.get(2).map(Path::new)),
        ("--check-fftool", 2) => check(Path::new(&args[1])),
        _ => Err(USAGE.to_owned()),
    };
    let (code, report) = match result {
        Ok(report) => (0, report),
        Err(error) => (1, serde_json::json!({"ok":false,"error":error})),
    };
    // JSON on stdout is also usable from Python or a PowerShell pipeline for a GUI exe.
    let _ = writeln!(std::io::stdout(), "{report}");
    Some(code)
}

fn pack(directory: &Path, output: Option<&Path>) -> Result<serde_json::Value, String> {
    let package = read_directory_full(directory)?;
    let record = package.record;
    let manifest = modules::parse_record(&record)?;
    let bytes = modules::pack_package_full(&record, &package.resources, false)?;
    crate::validate_module_entries(&record, &manifest)?;
    let output = output.map(Path::to_path_buf).unwrap_or_else(|| {
        directory.join(format!(
            "{}-{}.fftool",
            manifest.module_id, manifest.version
        ))
    });
    let output = absolute(&output)?;
    write_package(&output, &bytes)?;
    Ok(
        serde_json::json!({"ok":true,"output":output,"bytes":bytes.len(),"module":modules::summary(&manifest),"current_platform_supported":modules::runnable_here(&manifest),"validation":"manifest_and_js_entries","execution_tested":false}),
    )
}

fn check(path: &Path) -> Result<serde_json::Value, String> {
    let path = absolute(path)?;
    let bytes = read_limited(&path, MAX_PACKAGE)?;
    let record = modules::unpack_package_internal(&bytes, false)?;
    let manifest = modules::parse_record(&record)?;
    crate::validate_module_entries(&record, &manifest)?;
    Ok(
        serde_json::json!({"ok":true,"input":path,"module":modules::summary(&manifest),"current_platform_supported":modules::runnable_here(&manifest),"validation":"manifest_and_js_entries","execution_tested":false}),
    )
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| "无法读取当前目录。")?
            .join(path)
    })
}

fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| format!("无法读取文件 {}。", path.display()))?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err(format!("文件不是普通文件或属于链接：{}。", path.display()));
    }
    if metadata.len() == 0 || metadata.len() > limit as u64 {
        return Err(format!(
            "文件为空或超过 {} KiB：{}。",
            limit / 1024,
            path.display()
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
        .map_err(|_| format!("无法读取文件 {}。", path.display()))?;
    if bytes.len() > limit {
        return Err(format!("文件过大：{}。", path.display()));
    }
    Ok(bytes)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
}

fn checked_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.len() > 120
        || relative.starts_with('/')
        || relative.contains(['\\', ':'])
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("文件路径无效：{relative}。"));
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        let metadata = fs::symlink_metadata(&path).map_err(|_| format!("缺少文件 {relative}。"))?;
        if is_link(&metadata) {
            return Err(format!("工具目录不能包含链接：{relative}。"));
        }
    }
    let actual = fs::canonicalize(path).map_err(|_| format!("无法读取文件 {relative}。"))?;
    if !actual.starts_with(root) {
        return Err("文件超出了工具目录。".into());
    }
    Ok(actual)
}

fn read_directory_full(directory: &Path) -> Result<modules::ModulePackage, String> {
    let root = fs::canonicalize(directory).map_err(|_| "工具目录不存在。")?;
    if !root.is_dir() {
        return Err("请选择包含 manifest.json 的工具目录。".into());
    }
    let bytes = read_limited(&checked_path(&root, "manifest.json")?, 64 * 1024)?;
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err("manifest.json 必须使用 UTF-8 无 BOM 编码。".into());
    }
    let mut manifest: modules::Manifest =
        serde_json::from_slice(&bytes).map_err(modules::manifest_json_error)?;
    let mut resources = BTreeMap::new();
    for resource in &mut manifest.resources {
        let bytes = read_limited(
            &checked_path(&root, &resource.path)?,
            modules::MAX_RESOURCE_BYTES,
        )?;
        let digest = modules::resource_digest(&bytes);
        if (!resource.sha256.is_empty() && resource.sha256 != digest)
            || (resource.size != 0 && resource.size != bytes.len())
        {
            return Err(format!("资源摘要或大小不匹配：{}。", resource.path));
        }
        resource.size = bytes.len();
        resource.sha256 = digest;
        resources.insert(resource.path.clone(), bytes);
    }
    let mut files = BTreeMap::new();
    collect_files(&root, &root, 0, &mut 0, &mut files, &resources)?;
    let record = ModuleRecord {
        module_id: manifest.module_id.clone(),
        manifest: serde_json::to_value(&manifest).map_err(|_| "清单格式无效。")?,
        scripts: files,
    };
    modules::parse_record(&record)?;
    modules::validate_resources(&manifest, &resources)?;
    Ok(modules::ModulePackage { record, resources })
}

fn collect_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    visited: &mut usize,
    files: &mut BTreeMap<String, String>,
    resources: &BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    if depth > 16 {
        return Err("工具目录层级过深。".into());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|_| "无法读取工具目录。")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "无法读取工具文件。")?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        *visited += 1;
        if *visited > 4096 {
            return Err("目录内容过多，请只保留工具源码和资源。".into());
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| "无法读取工具文件。")?;
        if is_link(&metadata) {
            return Err(format!("工具目录不能包含链接：{}。", path.display()));
        }
        if metadata.is_dir() {
            collect_files(root, &path, depth + 1, visited, files, resources)?;
        } else if matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("js" | "html" | "css")
        ) {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "文件超出了工具目录。")?
                .to_str()
                .ok_or("文件名编码无效。")?
                .replace('\\', "/");
            if resources.contains_key(&relative) {
                continue;
            }
            if files.len() >= modules::MAX_SOURCE_FILES {
                return Err("v7 工具包最多包含 128 个源码文件，旧版最多 16 个。".into());
            }
            let content = read_limited(&path, MAX_FILE)?;
            let mut source = String::from_utf8(content)
                .map_err(|_| format!("文件必须为 UTF-8：{relative}。"))?;
            if matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("html" | "css")
            ) {
                source = embed_assets(root, &source)?;
            }
            if source.len() > MAX_FILE {
                return Err(format!("内嵌资源后源码超过 8 MiB：{relative}。"));
            }
            files.insert(relative, source);
        }
    }
    Ok(())
}

fn embed_assets(root: &Path, source: &str) -> Result<String, String> {
    let mut output = String::new();
    let mut remaining = source;
    while let Some(start) = remaining.find("{{asset:") {
        output.push_str(&remaining[..start]);
        let rest = &remaining[start + 8..];
        let (relative, next) = rest.split_once("}}").ok_or("静态资源引用未完成。")?;
        let extension = Path::new(relative)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let mime = match extension {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "woff" => "font/woff",
            "woff2" => "font/woff2",
            _ => return Err(format!("不支持的静态资源：{relative}。")),
        };
        let bytes = read_limited(&checked_path(root, relative)?, 512 * 1024)?;
        output.push_str(&format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        if output.len() > MAX_FILE {
            return Err("内嵌资源后源码超过 8 MiB。".into());
        }
        remaining = next;
    }
    output.push_str(remaining);
    Ok(output)
}

fn write_package(output: &Path, bytes: &[u8]) -> Result<(), String> {
    if !output
        .extension()
        .is_some_and(|value| value.eq_ignore_ascii_case("fftool"))
    {
        return Err("输出文件必须以 .fftool 结尾。".into());
    }
    if let Ok(metadata) = fs::symlink_metadata(output) {
        if !metadata.is_file() || is_link(&metadata) {
            return Err("输出位置不是普通文件。".into());
        }
    }
    let parent = output.parent().ok_or("输出目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建输出目录。")?;
    let temporary = output.with_extension(format!(
        "fftool.tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "系统时间无效。")?
            .as_nanos()
    ));
    let outcome = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "无法写入工具包。")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "工具包写入失败。")?;
        drop(file);
        fs::rename(&temporary, output)
            .map_err(|_| "无法保存工具包，请关闭占用该文件的程序。".to_owned())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distribution_package_can_target_android_without_changing_windows_import_rules() {
        let mut record = crate::builtin_modules::bundled("builtin.json.format").unwrap();
        record.manifest["platforms"] = serde_json::json!(["android"]);
        assert!(modules::pack_package(&record).is_err());
        let bytes = modules::pack_package_internal(&record, false).unwrap();
        assert!(modules::unpack_package(&bytes).is_err());
        assert_eq!(
            modules::unpack_package_internal(&bytes, false)
                .unwrap()
                .scripts,
            record.scripts
        );
    }
    #[test]
    fn unrelated_startup_arguments_do_not_enter_cli_mode() {
        assert!(run(&["--firefly-open-tool=json.format".into()]).is_none());
        assert!(run(&[]).is_none());
    }
}
