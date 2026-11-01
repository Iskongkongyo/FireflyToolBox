//! Large packages and resources use native files/binary IPC, never JS number arrays.
use crate::{file_sessions, modules, AppState};
use std::collections::BTreeMap;
use tauri::{ipc::Response, Manager};
use toolbox_storage::{ModuleRecord, Store};

fn scope(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("仅允许主界面管理工具资源。".into())
    }
}

fn draft(
    store: &Store,
    manifest: modules::Manifest,
    scripts: BTreeMap<String, String>,
    resource_module_id: Option<String>,
    resource_draft_id: Option<String>,
) -> Result<modules::ModulePackage, String> {
    let record = ModuleRecord {
        module_id: manifest.module_id.clone(),
        manifest: serde_json::to_value(&manifest).map_err(|_| "工具清单无效。")?,
        scripts,
    };
    modules::parse_record(&record)?;
    let mut resources = BTreeMap::new();
    if !manifest.resources.is_empty() {
        let source = resource_module_id.as_deref().unwrap_or(&manifest.module_id);
        let mut available = match crate::tool_module_record(store, source)? {
            Some(record) => crate::builtin_modules::resources(store, &record)?,
            None => BTreeMap::new(),
        };
        if let Some(id) = resource_draft_id.as_deref() {
            for (path, data) in store
                .resource_drafts(id)
                .map_err(|_| "无法读取资源草稿。")?
            {
                if manifest.resources.iter().any(|resource| {
                    resource.path == path && resource.sha256 == modules::resource_digest(&data)
                }) {
                    available.insert(path, data);
                }
            }
        }
        for resource in &manifest.resources {
            resources.insert(
                resource.path.clone(),
                available
                    .remove(&resource.path)
                    .ok_or("工具资源不存在；请从包含资源的工具包导入。")?,
            );
        }
    }
    modules::validate_resources(&manifest, &resources)?;
    crate::validate_module_entries(&record, &manifest)?;
    Ok(modules::ModulePackage { record, resources })
}

#[tauri::command]
pub async fn inspect_module_file(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<modules::ModuleSummary, String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = file_sessions::read_package_file(&path)?;
        let package = modules::unpack_package_full(&bytes, true)?;
        Ok(modules::summary(&modules::parse_record(&package.record)?))
    })
    .await
    .map_err(|_| "工具包检查线程失败。")?
}

#[tauri::command]
pub async fn install_module_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<modules::ModuleSummary, String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = file_sessions::read_package_file(&path)?;
        let package = modules::unpack_package_full(&bytes, true)?;
        let manifest = modules::parse_record(&package.record)?;
        crate::validate_module_entries(&package.record, &manifest)?;
        let state = app.state::<AppState>();
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        crate::install_tool_module_resources(&store, &package.record, &manifest, &package.resources)
    })
    .await
    .map_err(|_| "工具包安装线程失败。")?
}

#[tauri::command]
pub async fn export_module_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    module_id: String,
    path: String,
) -> Result<(), String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (record, resources) = {
            let state = app.state::<AppState>();
            let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
            let record = crate::tool_module_record(&store, &module_id)?.ok_or("工具包不存在。")?;
            let resources = crate::builtin_modules::resources(&store, &record)?;
            (record, resources)
        };
        let bytes = modules::pack_package_full(&record, &resources, true)?;
        file_sessions::write_selected(&path, &bytes)
    })
    .await
    .map_err(|_| "工具包导出线程失败。")?
}

#[tauri::command]
pub async fn validate_module_draft(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    manifest: modules::Manifest,
    scripts: BTreeMap<String, String>,
    resource_module_id: Option<String>,
    resource_draft_id: Option<String>,
) -> Result<modules::ModuleSummary, String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        let package = draft(
            &store,
            manifest,
            scripts,
            resource_module_id,
            resource_draft_id.clone(),
        )?;
        Ok(modules::summary(&modules::parse_record(&package.record)?))
    })
    .await
    .map_err(|_| "工具草稿校验线程失败。")?
}

#[tauri::command]
pub async fn install_module_draft(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    manifest: modules::Manifest,
    scripts: BTreeMap<String, String>,
    resource_module_id: Option<String>,
    resource_draft_id: Option<String>,
) -> Result<modules::ModuleSummary, String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        let package = draft(
            &store,
            manifest,
            scripts,
            resource_module_id,
            resource_draft_id.clone(),
        )?;
        let manifest = modules::parse_record(&package.record)?;
        let installed = crate::install_tool_module_resources(
            &store,
            &package.record,
            &manifest,
            &package.resources,
        )?;
        if let Some(id) = resource_draft_id.as_deref() {
            let _ = store.delete_resource_drafts(id, None);
        }
        Ok(installed)
    })
    .await
    .map_err(|_| "工具草稿安装线程失败。")?
}

#[tauri::command]
pub async fn export_module_draft_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    manifest: modules::Manifest,
    scripts: BTreeMap<String, String>,
    resource_module_id: Option<String>,
    resource_draft_id: Option<String>,
    path: String,
) -> Result<(), String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let package = {
            let state = app.state::<AppState>();
            let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
            draft(
                &store,
                manifest,
                scripts,
                resource_module_id,
                resource_draft_id.clone(),
            )?
        };
        let bytes = modules::pack_package_full(&package.record, &package.resources, true)?;
        file_sessions::write_selected(&path, &bytes)
    })
    .await
    .map_err(|_| "工具草稿导出线程失败。")?
}

#[tauri::command]
// Window/state are injected by Tauri; the remaining fields identify one chunk.
#[allow(clippy::too_many_arguments)]
pub fn read_module_resource(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    module_id: String,
    path: String,
    offset: u64,
    length: usize,
    expected_sha256: Option<String>,
    resource_draft_id: Option<String>,
) -> Result<Response, String> {
    scope(&window)?;
    if length == 0 || length > file_sessions::CHUNK_BYTES {
        return Err("资源块不能超过 1 MiB。".into());
    }
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    if let (Some(scope), Some(hash)) = (resource_draft_id.as_deref(), expected_sha256.as_deref()) {
        if offset > modules::MAX_RESOURCE_BYTES as u64 {
            return Err("资源读取位置越界。".into());
        }
        if let Some(bytes) = store
            .draft_resource_chunk(scope, &path, hash, offset, length)
            .map_err(|_| "资源草稿读取失败。")?
        {
            return Ok(Response::new(bytes));
        }
    }
    let stored_json = store
        .module_manifest(&module_id)
        .map_err(|_| "无法读取工具。")?;
    let json = stored_json
        .or_else(|| crate::builtin_modules::bundled(&module_id).map(|record| record.manifest))
        .ok_or("工具包不存在。")?;
    let manifest: modules::Manifest = serde_json::from_value(json).map_err(|_| "工具清单无效。")?;
    let resource = manifest
        .resources
        .iter()
        .find(|resource| resource.path == path)
        .ok_or("不能读取未声明的工具资源。")?;
    if expected_sha256
        .as_deref()
        .is_some_and(|hash| hash != resource.sha256)
    {
        return Err("RESOURCE_STALE: 工具资源已更新，请重新打开工具。".into());
    }
    if offset > resource.size as u64 {
        return Err("资源读取位置越界。".into());
    }
    let length = length.min(resource.size.saturating_sub(offset as usize));
    let bytes = store
        .resource_chunk(&module_id, &path, offset, length)
        .map_err(|_| "资源读取失败。")?;
    let bytes = match bytes {
        Some(bytes) => bytes,
        None => {
            let factory = crate::builtin_modules::bundled(&module_id).ok_or("工具资源不存在。")?;
            let factory_manifest: modules::Manifest =
                serde_json::from_value(factory.manifest).map_err(|_| "工具清单无效。")?;
            if !factory_manifest
                .resources
                .iter()
                .any(|r| r.path == path && r.sha256 == resource.sha256)
            {
                return Err("工具资源不存在。".into());
            }
            let data = crate::builtin_modules::bundled_resource(&module_id, &path)
                .ok_or("工具资源不存在。")?;
            data.get(offset as usize..offset as usize + length)
                .ok_or("工具资源内容不完整。")?
                .to_vec()
        }
    };
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn stage_module_resource(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
    resource_draft_id: String,
) -> Result<modules::Resource, String> {
    scope(&window)?;
    if resource_draft_id.len() != 36
        || !resource_draft_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err("资源草稿 ID 无效。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let mut file = file_sessions::open_native(&path, false)?;
        if file.size > modules::MAX_RESOURCE_BYTES as u64 {
            return Err("单个资源不能超过 96 MiB。".into());
        }
        let mut data = Vec::new();
        Read::by_ref(&mut file.file)
            .take(modules::MAX_RESOURCE_BYTES as u64 + 1)
            .read_to_end(&mut data)
            .map_err(|_| "无法读取资源文件。")?;
        if data.is_empty() || data.len() > modules::MAX_RESOURCE_BYTES {
            return Err("资源为空或超过 96 MiB。".into());
        }
        let digest = modules::resource_digest(&data);
        let lower = file.name.to_ascii_lowercase();
        let extension = if data.starts_with(b"\0asm\x01\0\0\0") {
            "wasm"
        } else {
            lower.rsplit('.').next().unwrap_or("bin")
        };
        let mut name = file
            .name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                    ch
                } else {
                    '_'
                }
            })
            .take(90)
            .collect::<String>();
        if !name.ends_with(&format!(".{extension}")) {
            name = format!("resource_{}.{extension}", &digest[..12]);
        }
        let asset_path = format!("assets/{name}");
        if !modules::valid_package_path(&asset_path)
            || modules::resource_mime(&asset_path).is_none()
        {
            return Err(
                "不支持此资源类型；可选择 WASM、图片、字体、媒体、JS、JSON 或 BIN。".into(),
            );
        }
        if (asset_path.ends_with(".wasm") && !data.starts_with(b"\0asm\x01\0\0\0"))
            || (asset_path.ends_with(".js") && std::str::from_utf8(&data).is_err())
        {
            return Err("WASM 或 Worker 资源格式无效。".into());
        }
        let resource = modules::Resource {
            path: asset_path.clone(),
            size: data.len(),
            sha256: digest,
        };
        let state = app.state::<AppState>();
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        store
            .save_resource_draft(&resource_draft_id, &asset_path, &data)
            .map_err(|_| "无法保存资源草稿；每包资源最多 128 MiB/128 个，总资源最多 512 MiB。")?;
        Ok(resource)
    })
    .await
    .map_err(|_| "资源读取线程失败。")?
}

#[tauri::command]
pub fn discard_module_resources(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    resource_draft_id: String,
    path: Option<String>,
) -> Result<(), String> {
    scope(&window)?;
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .delete_resource_drafts(&resource_draft_id, path.as_deref())
        .map_err(|_| "资源草稿清理失败。".into())
}
