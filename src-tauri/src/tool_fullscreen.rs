#[cfg(target_os = "windows")]
use {std::sync::Mutex, tauri::Manager};

#[derive(Default)]
pub struct ToolFullscreenState(#[cfg(target_os = "windows")] Mutex<Option<bool>>);

#[cfg(target_os = "windows")]
pub fn set(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let state = window
        .try_state::<ToolFullscreenState>()
        .ok_or("工具全屏状态尚未初始化。")?;
    let mut previous = state.0.lock().map_err(|_| "无法读取全屏状态。")?;
    if enabled {
        if previous.is_none() {
            let original = window.is_fullscreen().map_err(|_| "无法读取窗口状态。")?;
            window
                .set_fullscreen(true)
                .map_err(|_| "无法进入系统全屏。")?;
            *previous = Some(original);
        }
    } else if let Some(original) = *previous {
        window
            .set_fullscreen(original)
            .map_err(|_| "无法恢复窗口状态。")?;
        *previous = None;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set(_window: &tauri::WebviewWindow, _enabled: bool) -> Result<(), String> {
    Err("此窗口接口仅用于 Windows；移动端使用系统界面接口。".into())
}

#[tauri::command]
pub fn set_web_tool_fullscreen(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主界面可管理工具全屏。".into());
    }
    set(&window, enabled)
}
