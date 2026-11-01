use crate::AppState;
use tauri::Manager;

fn check_size(json: &str) -> Result<(), String> {
    if json.len() > toolbox_storage::TOOL_STORAGE_BYTES {
        return Err("STORAGE_LIMIT: 每个工具的持久存储最多 1 MiB。".into());
    }
    Ok(())
}
fn scope(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("STORAGE_SCOPE: 仅允许主界面管理工具存储。".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn load_tool_storage(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    module_id: String,
    legacy_json: String,
    read_only: Option<bool>,
) -> Result<Option<String>, String> {
    scope(&window)?;
    check_size(&legacy_json)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state
            .0
            .lock()
            .map_err(|_| "STORAGE_FAILED: 工具存储暂不可用。")?;
        if read_only.unwrap_or(false) {
            store
                .stored_tool_storage_json(&module_id)
                .map_err(|_| "STORAGE_FAILED: 无法读取工具数据，原数据已保留。".into())
        } else {
            store
                .load_tool_storage_json(&module_id, &legacy_json)
                .map(Some)
                .map_err(|_| "STORAGE_FAILED: 无法读取或迁移工具数据，原数据已保留。".into())
        }
    })
    .await
    .map_err(|_| "STORAGE_FAILED: 工具存储线程不可用。")?
}
#[tauri::command]
pub async fn save_tool_storage(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    module_id: String,
    values_json: String,
) -> Result<(), String> {
    scope(&window)?;
    check_size(&values_json)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state
            .0
            .lock()
            .map_err(|_| "STORAGE_FAILED: 工具存储暂不可用。")?;
        store
            .save_tool_storage_json(&module_id, &values_json)
            .map_err(|_| "STORAGE_FAILED: 无法保存工具数据，请重试或导出数据。".into())
    })
    .await
    .map_err(|_| "STORAGE_FAILED: 工具存储线程不可用。")?
}
#[tauri::command]
pub async fn clear_preview_tool_storage(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    scope(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state
            .0
            .lock()
            .map_err(|_| "STORAGE_FAILED: 工具存储暂不可用。")?;
        store
            .clear_preview_tool_storage()
            .map_err(|_| "STORAGE_FAILED: 无法清理预览数据。".into())
    })
    .await
    .map_err(|_| "STORAGE_FAILED: 工具存储线程不可用。")?
}
