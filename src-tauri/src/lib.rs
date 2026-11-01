#[cfg(target_os = "windows")]
mod browser_progress;
mod builtin_assets;
mod builtin_modules;
mod cache;
mod certificates;
mod configuration_file;
#[cfg(target_os = "windows")]
mod data_directory;
mod file_hash;
mod file_sessions;
mod file_transport;
mod modules;
#[cfg(target_os = "windows")]
mod package_cli;
#[cfg(any(target_os = "windows", target_os = "android"))]
mod package_host;
#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[path = "package_host_unsupported.rs"]
mod package_host;
mod remote_messages;
#[cfg(all(test, target_os = "windows"))]
mod resource_tests;
mod shortcuts;
mod sync_data;
mod sync_transport;
mod tool_fullscreen;
mod tool_repository;
mod web_http;
mod web_request;
mod web_storage;

use serde::Serialize;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;
#[cfg(target_os = "windows")]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};
#[cfg(target_os = "windows")]
use tauri_plugin_autostart::ManagerExt;
#[cfg(target_os = "windows")]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use toolbox_core::{CustomTool, DetectionResult, ToolDescriptor, ToolError};
use toolbox_storage::{ConfigurationSnapshot, Store, Website};

pub fn run_module_worker() {
    modules::worker_main();
}

#[cfg(target_os = "windows")]
pub fn run_package_command(args: &[std::ffi::OsString]) -> Option<i32> {
    package_cli::run(args)
}

struct AppState(Mutex<Store>);
struct ModuleRuns(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
async fn web_tool_request(
    window: tauri::WebviewWindow,
    url: String,
    allowed_hosts: Vec<String>,
) -> Result<web_request::WebResponse, web_request::RequestError> {
    if window.label() != "main" {
        return Err(web_request::RequestError::new(
            "HTTP_SCOPE",
            "只能由主界面的网页工具请求联网。",
        ));
    }
    web_request::get(url, allowed_hosts).await
}

#[tauri::command]
async fn web_tool_certificate(
    window: tauri::WebviewWindow,
    url: String,
    allowed_hosts: Vec<String>,
) -> Result<certificates::CertificateInfo, web_request::RequestError> {
    if window.label() != "main" {
        return Err(web_request::RequestError::new(
            "HTTP_SCOPE",
            "只能由主界面查询证书。",
        ));
    }
    certificates::inspect(url, allowed_hosts).await
}
#[tauri::command]
fn web_tool_open_external(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    allowed_hosts: Vec<String>,
) -> Result<(), web_request::RequestError> {
    use tauri_plugin_opener::OpenerExt;
    if window.label() != "main" {
        return Err(web_request::RequestError::new(
            "HTTP_SCOPE",
            "只能由主界面的网页工具打开浏览器。",
        ));
    }
    let destination = web_request::checked_external_url(&url, &allowed_hosts)?;
    app.opener()
        .open_url(destination.to_string(), None::<&str>)
        .map_err(|_| {
            web_request::RequestError::new(
                "HTTP_OPEN_FAILED",
                "无法使用系统浏览器打开，请复制链接后访问。",
            )
        })
}
#[tauri::command]
async fn web_tool_resolve_link(
    window: tauri::WebviewWindow,
    url: String,
    allowed_hosts: Vec<String>,
) -> Result<web_request::LinkResolution, web_request::RequestError> {
    if window.label() != "main" {
        return Err(web_request::RequestError::new(
            "HTTP_SCOPE",
            "只能由主界面的网页工具还原链接。",
        ));
    }
    web_request::resolve_link(url, allowed_hosts).await
}

#[tauri::command]
async fn clear_runtime_cache(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<cache::CacheReport, String> {
    if window.label() != "main" {
        return Err("只能从主界面清理缓存。".into());
    }
    let repository_memory = tool_repository::clear(&app);
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法定位应用缓存目录。")?;
    let sessions = app.state::<file_sessions::FileSessions>().inner().clone();
    let mut report = tauri::async_runtime::spawn_blocking(move || {
        let mut warnings = Vec::new();
        if let Err(error) = sessions.clear() {
            warnings.push(error);
        }
        let mut report = match cache::clear_runtime_temp(&directory) {
            Ok(report) => report,
            Err(error) => {
                warnings.push(error);
                cache::CacheReport::default()
            }
        };
        match builtin_assets::clear_cache() {
            Ok(bytes) => report.memory_bytes = bytes,
            Err(error) => warnings.push(error),
        }
        report.warnings = warnings;
        report
    })
    .await
    .map_err(|_| "临时数据清理任务异常。")?;
    report.memory_bytes += repository_memory;
    match cache::clear_disk_cache(window).await {
        Ok(cleared) => report.disk_cache_cleared = cleared,
        Err(error) => report.warnings.push(error),
    }
    Ok(report)
}

#[derive(Clone, Serialize)]
struct ListedAction {
    id: String,
    label: String,
    input_types: Vec<String>,
    consumes_input: bool,
    accepts_empty_input: bool,
}

#[derive(Serialize)]
struct ListedTool {
    id: String,
    name: String,
    description: String,
    category: String,
    tags: Vec<String>,
    aliases: Vec<String>,
    actions: Vec<ListedAction>,
    custom: bool,
    module_id: Option<String>,
    runtime: Option<String>,
    ui_kind: Option<String>,
    icon: Option<String>,
    icon_data: Option<String>,
    pipeline_compatible: bool,
    builtin: bool,
}

impl From<&ToolDescriptor> for ListedTool {
    fn from(tool: &ToolDescriptor) -> Self {
        Self {
            id: tool.id.into(),
            name: tool.name.into(),
            description: tool.description.into(),
            category: tool.category.into(),
            tags: tool.tags.iter().map(|tag| (*tag).into()).collect(),
            aliases: tool.aliases.iter().map(|alias| (*alias).into()).collect(),
            actions: toolbox_core::tool_actions(tool.id)
                .iter()
                .map(|action| ListedAction {
                    id: action.id.into(),
                    label: action.label.into(),
                    input_types: action
                        .input_types
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect(),
                    consumes_input: action.consumes_input,
                    accepts_empty_input: !action.consumes_input,
                })
                .collect(),
            custom: false,
            module_id: None,
            runtime: None,
            ui_kind: None,
            icon: None,
            icon_data: None,
            pipeline_compatible: true,
            builtin: true,
        }
    }
}

impl From<CustomTool> for ListedTool {
    fn from(tool: CustomTool) -> Self {
        Self {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            category: "自定义工具".into(),
            tags: tool.tags,
            aliases: Vec::new(),
            actions: vec![ListedAction {
                id: "run".into(),
                label: "运行".into(),
                input_types: Vec::new(),
                consumes_input: true,
                accepts_empty_input: false,
            }],
            custom: true,
            module_id: None,
            runtime: None,
            ui_kind: None,
            icon: tool.icon.or_else(|| Some("automation".into())),
            icon_data: tool.icon_data,
            pipeline_compatible: false,
            builtin: false,
        }
    }
}

fn tool_module_records(store: &Store) -> Result<Vec<toolbox_storage::ModuleRecord>, String> {
    let mut records = builtin_modules::records(store)?;
    records.extend(store.modules().map_err(|_| "无法读取工具包。")?);
    Ok(records)
}

fn tool_module_record(
    store: &Store,
    id: &str,
) -> Result<Option<toolbox_storage::ModuleRecord>, String> {
    if builtin_modules::tool_id(id).is_some() {
        Ok(builtin_modules::records(store)?
            .into_iter()
            .find(|record| record.module_id == id))
    } else {
        store.module(id).map_err(|_| "无法读取工具包。".into())
    }
}

fn tool_module_summary(
    record: &toolbox_storage::ModuleRecord,
) -> Result<modules::ModuleSummary, String> {
    let manifest = modules::parse_record(record)?;
    let mut summary = modules::summary(&manifest);
    summary.modified = builtin_modules::modified(record);
    Ok(summary)
}

fn tool_catalog(store: &Store, include_deleted: bool) -> Result<Vec<ListedTool>, String> {
    let deleted: HashSet<_> = store
        .deleted_builtin_tool_ids()
        .map_err(|_| "无法读取已删除工具。")?
        .into_iter()
        .collect();
    let mut tools: Vec<ListedTool> = if cfg!(any(target_os = "windows", target_os = "android")) {
        Vec::new()
    } else {
        toolbox_core::list_tools()
            .iter()
            .filter(|tool| deleted.contains(tool.id) == include_deleted)
            .map(ListedTool::from)
            .collect()
    };
    for record in tool_module_records(store)? {
        let manifest = modules::parse_record(&record)?;
        let builtin = builtin_modules::tool_id(&manifest.module_id).is_some();
        if include_deleted && !builtin {
            continue;
        }
        if !include_deleted && !modules::runnable_here(&manifest) {
            continue;
        }
        for tool in manifest.tools {
            if deleted.contains(&tool.id) != include_deleted {
                continue;
            }
            let pipeline_compatible = tool.ui.kind == "text" && tool.runtime.is_none();
            let native_actions = if builtin {
                toolbox_core::tool_actions(&tool.id)
            } else {
                &[]
            };
            tools.push(ListedTool {
                id: tool.id,
                name: modules::label(&tool.name),
                description: modules::label(&tool.description),
                category: tool.category,
                tags: tool.tags,
                aliases: tool.aliases,
                actions: tool
                    .actions
                    .into_iter()
                    .map(|action| {
                        let native = native_actions.iter().find(|item| item.id == action.id);
                        ListedAction {
                            id: action.id,
                            label: modules::label(&action.label),
                            input_types: if tool.ui.kind == "text" {
                                action.input_types.unwrap_or_else(|| vec!["text".into()])
                            } else {
                                Vec::new()
                            },
                            consumes_input: native.map_or(true, |item| item.consumes_input),
                            accepts_empty_input: native
                                .map_or(tool.ui.kind == "text", |item| !item.consumes_input),
                        }
                    })
                    .collect(),
                custom: false,
                module_id: Some(manifest.module_id.clone()),
                runtime: tool.runtime,
                ui_kind: Some(tool.ui.kind),
                icon: tool.icon,
                icon_data: tool.icon_data,
                pipeline_compatible,
                builtin,
            });
        }
    }
    if include_deleted {
        return Ok(tools);
    }
    tools.extend(
        store
            .custom_tools()
            .map_err(|_| "无法读取自动化工具。")?
            .into_iter()
            .map(ListedTool::from),
    );
    let contracts: HashMap<(String, String), ListedAction> = tools
        .iter()
        .flat_map(|tool| {
            tool.actions
                .iter()
                .map(move |action| ((tool.id.clone(), action.id.clone()), action.clone()))
        })
        .collect();
    for custom in store.custom_tools().map_err(|_| "无法读取自动化工具。")? {
        if validate_text_steps(&tools, &custom.steps).is_err() {
            continue;
        }
        let Some(first) = custom.steps.first() else {
            continue;
        };
        if let Some(contract) = contracts.get(&(first.tool_id.clone(), first.action.clone())) {
            if let Some(tool) = tools.iter_mut().find(|tool| tool.id == custom.id) {
                tool.actions[0].input_types = contract.input_types.clone();
                tool.actions[0].accepts_empty_input = contract.accepts_empty_input;
            }
        }
    }
    Ok(tools)
}

fn listed_tools(store: &Store) -> Result<Vec<ListedTool>, String> {
    tool_catalog(store, false)
}

fn tool_exists(store: &Store, id: &str) -> Result<bool, String> {
    if toolbox_core::tool_exists(id) {
        return store
            .deleted_builtin_tool_ids()
            .map(|deleted| !deleted.iter().any(|item| item == id))
            .map_err(|_| "无法检查工具。".into());
    }
    if id.starts_with("custom.") {
        return store
            .custom_tool(id)
            .map(|tool| tool.is_some())
            .map_err(|_| "无法检查工具。".into());
    }
    Ok(store
        .modules()
        .map_err(|_| "无法检查模块。")?
        .iter()
        .any(|record| {
            modules::parse_record(record)
                .is_ok_and(|manifest| manifest.tools.iter().any(|tool| tool.id == id))
        }))
}

#[cfg(target_os = "android")]
fn android_shortcut_bridge(method: &str, payload: &str) -> Result<String, String> {
    use jni::{
        objects::{JClass, JObject, JString, JValue},
        JavaVM,
    };
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
        .map_err(|_| "Android 快捷方式服务不可用。")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "无法连接 Android 快捷方式服务。")?;
    let app_context = unsafe { JObject::from_raw(context.context().cast()) };
    let loader = env
        .call_method(
            &app_context,
            "getClassLoader",
            "()Ljava/lang/ClassLoader;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|_| "Android 快捷方式类加载器不可用。")?;
    let class_name = JObject::from(
        env.new_string("firefly.toolbox.ShortcutBridge")
            .map_err(|_| "Android 快捷方式类名无法编码。")?,
    );
    let class = JClass::from(
        env.call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&class_name)],
        )
        .and_then(|value| value.l())
        .map_err(|_| "Android 快捷方式桥接类不可用。")?,
    );
    let argument = JObject::from(
        env.new_string(payload)
            .map_err(|_| "快捷方式请求无法编码。")?,
    );
    let result = env
        .call_static_method(
            class,
            method,
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&app_context), JValue::Object(&argument)],
        )
        .and_then(|value| value.l())
        .map_err(|_| "Android 快捷方式调用失败。")?;
    let text: String = env
        .get_string(&JString::from(result))
        .map_err(|_| "快捷方式结果无法读取。")?
        .into();
    Ok(text)
}

#[tauri::command]
async fn create_tool_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    tool_id: String,
    name: String,
    icon_data: Option<String>,
) -> Result<String, String> {
    let name = shortcuts::validate_name(&name, cfg!(target_os = "windows"))?;
    {
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        if !listed_tools(&store)?.iter().any(|tool| tool.id == tool_id) {
            return Err("请选择当前可用的工具。".into());
        }
    }
    let icon = shortcuts::icon_bytes(icon_data.as_deref())?;
    #[cfg(target_os = "android")]
    let _ = (&app, &icon);
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            shortcuts::create_windows_shortcut(&app, &tool_id, &name, icon.as_deref())
        })
        .await
        .map_err(|_| "快捷方式创建任务异常。")??;
        return Ok("created".into());
    }
    #[cfg(target_os = "android")]
    {
        let payload = serde_json::json!({ "toolId": tool_id, "name": name, "iconData": icon_data.unwrap_or_default() });
        static GATE: std::sync::OnceLock<shortcuts::ShortcutRequestGate> =
            std::sync::OnceLock::new();
        let result = GATE
            .get_or_init(shortcuts::ShortcutRequestGate::default)
            .run(std::time::Duration::from_secs(10), move || {
                android_shortcut_bridge("create", &payload.to_string())
            })
            .await?;
        return match result.as_str() {
            "requested" => Ok("requested".into()),
            "exists" => Err("桌面上已有此工具的同名快捷方式，请换个名字。".into()),
            "pending" => {
                Err("已发起此快捷方式的创建请求，请先返回桌面查看或处理系统确认，稍后再试。".into())
            }
            "unsupported" => {
                Err("当前桌面启动器未开放添加快捷方式；可在系统设置中检查相关权限。".into())
            }
            "bad_icon" => Err("快捷方式图片无法解码。".into()),
            _ => Err("无法请求创建桌面快捷方式。".into()),
        };
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        let _ = (app, tool_id, icon);
        Err("当前平台尚不支持创建快捷方式。".into())
    }
}

#[tauri::command]
fn open_shortcut_settings() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return match android_shortcut_bridge("openSettings", "")?.as_str() {
            "ok" => Ok(()),
            _ => Err("无法打开应用设置页面。".into()),
        };
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("此操作仅适用于 Android。".into())
    }
}

#[tauri::command]
fn take_shortcut_launch() -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return android_shortcut_bridge("takeLaunch", "");
    }
    #[cfg(target_os = "windows")]
    {
        static TAKEN: AtomicBool = AtomicBool::new(false);
        if TAKEN.swap(true, Ordering::Relaxed) {
            return Ok(String::new());
        }
        return Ok(std::env::args()
            .find_map(|arg| arg.strip_prefix("--firefly-open-tool=").map(str::to_owned))
            .unwrap_or_default());
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        Ok(String::new())
    }
}

#[cfg(target_os = "windows")]
struct DesktopSettingsState {
    close_to_tray: AtomicBool,
    close_behavior_path: PathBuf,
}

#[cfg(target_os = "windows")]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn show_splash(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if window.label() != "splashscreen" {
            return Err("只能显示应用启动画面。".to_owned());
        }
        window.show().map_err(|_| "无法显示启动画面。".to_owned())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("此操作仅适用于 Windows。".to_owned())
    }
}

#[tauri::command]
fn finish_splash(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if window.label() != "splashscreen" {
            return Err("只能从启动画面完成启动。".to_owned());
        }
        let main = window
            .app_handle()
            .get_webview_window("main")
            .ok_or("无法找到应用主窗口。")?;
        if !main.is_maximized().unwrap_or(false) {
            if let Ok(position) = window.outer_position() {
                let _ = main.set_position(tauri::Position::Physical(position));
            }
        }
        main.show().map_err(|_| "无法显示应用主窗口。")?;
        main.set_focus().map_err(|_| "无法切换到应用主窗口。")?;
        window
            .close()
            .map_err(|_| "无法关闭启动画面。".to_owned())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("此操作仅适用于 Windows。".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开应用", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &open, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("应用图标缺失").clone())
        .tooltip("流萤百宝箱")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                show_main_window(app);
                let _ = app.emit_to("main", "firefly:open-settings", ());
            }
            "open" => show_main_window(app),
            "quit" => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = tool_fullscreen::set(&main, false);
                }
                let _ = app.save_window_state(StateFlags::SIZE | StateFlags::MAXIMIZED);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
fn desktop_close_behavior(app: tauri::AppHandle) -> Result<&'static str, String> {
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<DesktopSettingsState>();
        Ok(if state.close_to_tray.load(Ordering::Relaxed) {
            "tray"
        } else {
            "exit"
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("此设置仅适用于 Windows。".to_owned())
    }
}

#[tauri::command]
fn set_desktop_close_behavior(app: tauri::AppHandle, behavior: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if behavior != "tray" && behavior != "exit" {
            return Err("关闭行为无效。".to_owned());
        }
        let state = app.state::<DesktopSettingsState>();
        std::fs::write(&state.close_behavior_path, &behavior).map_err(|_| "无法保存关闭行为。")?;
        state
            .close_to_tray
            .store(behavior == "tray", Ordering::Relaxed);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, behavior);
        Err("此设置仅适用于 Windows。".to_owned())
    }
}

#[tauri::command]
fn desktop_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        app.autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("此设置仅适用于 Windows。".to_owned())
    }
}

#[tauri::command]
fn set_desktop_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
        .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enabled);
        Err("此设置仅适用于 Windows。".to_owned())
    }
}

#[tauri::command]
fn list_tools(state: tauri::State<'_, AppState>) -> Result<Vec<ListedTool>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    listed_tools(&store)
}

#[tauri::command]
fn list_deleted_builtin_tools(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ListedTool>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    tool_catalog(&store, true)
}

#[tauri::command]
fn delete_builtin_tool(state: tauri::State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .delete_builtin_tool(&tool_id)
        .map_err(|_| "无法删除应用自带工具。".into())
}

#[tauri::command]
fn restore_builtin_tools(
    state: tauri::State<'_, AppState>,
    tool_ids: Vec<String>,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .restore_builtin_tools(&tool_ids)
        .map_err(|_| "无法恢复工具，请选择应用自带工具后重试。".into())
}

#[tauri::command]
fn search_tools(state: tauri::State<'_, AppState>, query: &str) -> Result<Vec<ListedTool>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    let query = query.trim().to_lowercase();
    Ok(listed_tools(&store)?
        .into_iter()
        .filter(|tool| {
            query.is_empty()
                || [&tool.name, &tool.description, &tool.category]
                    .iter()
                    .any(|value| value.to_lowercase().contains(&query))
                || tool
                    .tags
                    .iter()
                    .chain(tool.aliases.iter())
                    .any(|value| value.to_lowercase().contains(&query))
        })
        .collect())
}

#[tauri::command]
async fn run_text_tool(
    state: tauri::State<'_, AppState>,
    runs: tauri::State<'_, ModuleRuns>,
    tool_id: String,
    action: String,
    input: String,
    record_usage: bool,
    request_id: Option<String>,
) -> Result<String, ToolError> {
    {
        let store = state
            .0
            .lock()
            .map_err(|_| ToolError::new("storage_unavailable", "数据库暂不可用。"))?;
        if !tool_exists(&store, &tool_id)
            .map_err(|message| ToolError::new("storage_unavailable", message))?
        {
            return Err(ToolError::new(
                "unknown_tool",
                "工具已删除或不存在，请先恢复工具。",
            ));
        }
    }
    let result = if tool_id.starts_with("custom.") {
        if action != "run" {
            return Err(ToolError::new("unknown_action", "不支持此工具操作。"));
        }
        let steps = {
            let store = state
                .0
                .lock()
                .map_err(|_| ToolError::new("storage_unavailable", "数据库暂不可用。"))?;
            let tool = store
                .custom_tool(&tool_id)
                .map_err(|_| ToolError::new("storage_unavailable", "无法读取自定义工具。"))?
                .ok_or_else(|| ToolError::new("unknown_tool", "自动化工具不存在。"))?;
            resolve_text_steps(&store, &tool.steps)?
        };
        execute_text_pipeline(&runs, steps, input, request_id).await
    } else if !cfg!(any(target_os = "windows", target_os = "android"))
        && toolbox_core::tool_exists(&tool_id)
    {
        toolbox_core::run_tool(&tool_id, &action, &input)
    } else {
        let (scripts, entry, limits) = {
            let store = state
                .0
                .lock()
                .map_err(|_| ToolError::new("storage_unavailable", "数据库暂不可用。"))?;
            let mut selected = None;
            for record in tool_module_records(&store)
                .map_err(|message| ToolError::new("storage_unavailable", message))?
            {
                let manifest = modules::parse_record(&record)
                    .map_err(|_| ToolError::new("invalid_module", "模块数据无效。"))?;
                if !modules::runnable_here(&manifest) {
                    continue;
                }
                if let Some(tool) = manifest.tools.iter().find(|tool| tool.id == tool_id) {
                    if !tool.actions.iter().any(|item| item.id == action) {
                        return Err(ToolError::new("unknown_action", "不支持此模块操作。"));
                    }
                    if tool.runtime.as_deref() == Some("browser") {
                        return Err(ToolError::new(
                            "browser_runtime",
                            "此模块需要浏览器运行环境。",
                        ));
                    }
                    selected = Some((record.scripts, tool.entry.clone(), manifest.limits));
                    break;
                }
            }
            selected.ok_or_else(|| ToolError::new("unknown_tool", "模块工具不存在。"))?
        };
        execute_module_request(&runs, scripts, entry, action, input, limits, request_id).await
    };
    if result.is_ok() && record_usage {
        if let Ok(store) = state.0.lock() {
            let _ = store.record_tool_use(&tool_id);
        }
    }
    result
}

async fn execute_module_request(
    runs: &ModuleRuns,
    scripts: BTreeMap<String, String>,
    entry: String,
    action: String,
    input: String,
    limits: modules::Limits,
    request_id: Option<String>,
) -> Result<String, ToolError> {
    if input.len() > limits.input_bytes {
        return Err(ToolError::new("input_too_large", "工具输入超过大小上限。"));
    }
    let request_id = request_id
        .filter(|id| {
            id.len() == 36
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        })
        .ok_or_else(|| ToolError::new("invalid_request", "模块请求 ID 无效。"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = runs
            .0
            .lock()
            .map_err(|_| ToolError::new("module_error", "模块执行状态不可用。"))?;
        if active.len() >= 4 || active.contains_key(&request_id) {
            return Err(ToolError::new("busy", "正在运行的模块过多，请稍后重试。"));
        }
        active.insert(request_id.clone(), cancelled.clone());
    }
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        modules::run_in_worker(
            scripts,
            entry,
            action,
            input,
            &limits,
            cancelled,
            modules::WorkerMode::Execute,
        )
    })
    .await;
    if let Ok(mut active) = runs.0.lock() {
        active.remove(&request_id);
    }
    outcome
        .map_err(|_| ToolError::new("module_error", "模块执行器无法返回结果。"))?
        .map_err(|message| ToolError::new("module_error", message))
}

#[derive(Clone)]
enum TextStep {
    Builtin(toolbox_core::ToolStep),
    Script {
        scripts: BTreeMap<String, String>,
        entry: String,
        action: String,
        limits: modules::Limits,
    },
}

fn validate_text_steps(
    catalog: &[ListedTool],
    steps: &[toolbox_core::ToolStep],
) -> Result<(), String> {
    if steps.is_empty() || steps.len() > 8 {
        return Err("请选择 1 到 8 个处理步骤。".into());
    }
    for (index, step) in steps.iter().enumerate() {
        let tool = catalog
            .iter()
            .find(|tool| tool.id == step.tool_id && tool.pipeline_compatible)
            .ok_or_else(|| format!("第 {} 步的工具已移除或不支持纯文本自动化。", index + 1))?;
        let action = tool
            .actions
            .iter()
            .find(|action| action.id == step.action)
            .ok_or_else(|| format!("第 {} 步的操作已移除。", index + 1))?;
        if index > 0 && !action.consumes_input {
            return Err("不使用上一步结果的生成操作只能放在第一步。".into());
        }
    }
    Ok(())
}

fn resolve_text_steps(
    store: &Store,
    steps: &[toolbox_core::ToolStep],
) -> Result<Vec<TextStep>, ToolError> {
    let catalog =
        listed_tools(store).map_err(|message| ToolError::new("storage_unavailable", message))?;
    validate_text_steps(&catalog, steps)
        .map_err(|message| ToolError::new("invalid_step", message))?;
    let records = tool_module_records(store)
        .map_err(|message| ToolError::new("storage_unavailable", message))?;
    let mut resolved = Vec::new();
    for step in steps {
        if !cfg!(any(target_os = "windows", target_os = "android"))
            && toolbox_core::tool_exists(&step.tool_id)
        {
            resolved.push(TextStep::Builtin(step.clone()));
            continue;
        }
        let mut selected = None;
        for record in &records {
            let manifest = modules::parse_record(record)
                .map_err(|message| ToolError::new("invalid_tool", message))?;
            if let Some(tool) = manifest.tools.iter().find(|tool| tool.id == step.tool_id) {
                selected = Some(TextStep::Script {
                    scripts: record.scripts.clone(),
                    entry: tool.entry.clone(),
                    action: step.action.clone(),
                    limits: manifest.limits,
                });
                break;
            }
        }
        resolved.push(selected.ok_or_else(|| ToolError::new("unknown_tool", "文本工具不存在。"))?);
    }
    Ok(resolved)
}

async fn execute_text_pipeline(
    runs: &ModuleRuns,
    steps: Vec<TextStep>,
    input: String,
    request_id: Option<String>,
) -> Result<String, ToolError> {
    if input.len() > toolbox_core::MAX_TEXT_BYTES {
        return Err(ToolError::new("input_too_large", "输入超过 1 MiB 限制。"));
    }
    let request_id = request_id
        .filter(|id| id.len() == 36 && id.bytes().all(|ch| ch.is_ascii_hexdigit() || ch == b'-'))
        .ok_or_else(|| ToolError::new("invalid_request", "自动化请求 ID 无效。"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = runs
            .0
            .lock()
            .map_err(|_| ToolError::new("busy", "执行状态暂不可用。"))?;
        if active.len() >= 4 || active.contains_key(&request_id) {
            return Err(ToolError::new("busy", "正在运行的任务过多。"));
        }
        active.insert(request_id.clone(), cancelled.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut value = input;
        let count = steps.len();
        for (index, step) in steps.into_iter().enumerate() {
            if cancelled.load(Ordering::Relaxed) {
                return Err(ToolError::new("cancelled", "自动化执行已取消。"));
            }
            if std::time::Instant::now() >= deadline {
                return Err(ToolError::new("timeout", "自动化执行超过总时间上限。"));
            }
            value = match step {
                TextStep::Builtin(step) => {
                    toolbox_core::run_tool(&step.tool_id, &step.action, &value)?
                }
                TextStep::Script {
                    scripts,
                    entry,
                    action,
                    mut limits,
                } => {
                    limits.input_bytes = limits.input_bytes.min(toolbox_core::MAX_TEXT_BYTES);
                    if value.len() > limits.input_bytes {
                        return Err(ToolError::new(
                            "input_too_large",
                            format!("第 {} 步输入超过该工具的上限。", index + 1),
                        ));
                    }
                    limits.timeout_ms = limits.timeout_ms.min(
                        deadline
                            .saturating_duration_since(std::time::Instant::now())
                            .as_millis()
                            .max(1) as u64,
                    );
                    modules::run_in_worker(
                        scripts,
                        entry,
                        action,
                        value,
                        &limits,
                        cancelled.clone(),
                        modules::WorkerMode::Execute,
                    )
                    .map_err(|message| {
                        ToolError::new(
                            "step_failed",
                            format!("第 {} 步执行失败：{message}", index + 1),
                        )
                    })?
                }
            };
            if index + 1 < count && value.len() > toolbox_core::MAX_TEXT_BYTES {
                return Err(ToolError::new(
                    "intermediate_too_large",
                    "中间结果超过 1 MiB，无法继续处理。",
                ));
            }
        }
        Ok(value)
    })
    .await
    .map_err(|_| ToolError::new("execution_failed", "自动化执行器异常。"));
    if let Ok(mut active) = runs.0.lock() {
        active.remove(&request_id);
    }
    result?
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[tauri::command]
async fn preview_tool_package(
    runs: tauri::State<'_, ModuleRuns>,
    bytes: Vec<u8>,
    input: String,
    action: String,
    request_id: String,
) -> Result<String, ToolError> {
    let record = modules::unpack_package(&bytes)
        .map_err(|message| ToolError::new("invalid_tool", message))?;
    let manifest = modules::parse_record(&record)
        .map_err(|message| ToolError::new("invalid_tool", message))?;
    if manifest.tools.len() != 1 {
        return Err(ToolError::new("invalid_tool", "预览仅支持单个工具。"));
    }
    let tool = &manifest.tools[0];
    if tool.runtime.is_some() || tool.ui.kind != "text" {
        return Err(ToolError::new("invalid_tool", "网页工具请使用页面预览。"));
    }
    if !tool.actions.iter().any(|item| item.id == action) {
        return Err(ToolError::new("unknown_action", "不支持此工具操作。"));
    }
    let entry = tool.entry.clone();
    execute_module_request(
        &runs,
        record.scripts,
        entry,
        action,
        input,
        manifest.limits,
        Some(request_id),
    )
    .await
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
async fn preview_tool_package(
    _runs: tauri::State<'_, ModuleRuns>,
    _bytes: Vec<u8>,
    _input: String,
    _action: String,
    _request_id: String,
) -> Result<String, ToolError> {
    Err(ToolError::new("unavailable", "当前平台尚未开放工具预览。"))
}

#[tauri::command]
fn cancel_module_run(runs: tauri::State<'_, ModuleRuns>, request_id: String) -> bool {
    if let Ok(active) = runs.0.lock() {
        if let Some(cancelled) = active.get(&request_id) {
            cancelled.store(true, Ordering::Relaxed);
            return true;
        }
    }
    false
}

#[tauri::command]
fn initialize_website_progress(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    label: String,
) -> Result<(), String> {
    if window.label() != "main" || !label.starts_with("website-") {
        return Err("网页窗口无效。".into());
    }
    #[cfg(target_os = "windows")]
    {
        let webview = app.get_webview_window(&label).ok_or("网页窗口不存在。")?;
        browser_progress::update(webview.as_ref()).map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
fn record_tool_open(state: tauri::State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    record_opened_tool(&store, &tool_id)
}

fn record_opened_tool(store: &Store, tool_id: &str) -> Result<(), String> {
    if !tool_exists(store, tool_id)? {
        return Err("工具已删除或不存在。".into());
    }
    store
        .record_tool_use(tool_id)
        .map_err(|_| "无法记录最近使用。".into())
}

#[tauri::command]
fn list_recent_tools(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .recent_tools()
        .map_err(|_| "无法读取最近使用。".to_owned())
}

#[tauri::command]
fn clear_recent_tools(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .clear_recent_tools()
        .map_err(|_| "无法清空最近使用。".to_owned())
}

#[tauri::command]
fn list_custom_tools(state: tauri::State<'_, AppState>) -> Result<Vec<CustomTool>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .custom_tools()
        .map_err(|_| "无法读取自定义工具。".to_owned())
}

#[tauri::command]
fn save_custom_tool(
    state: tauri::State<'_, AppState>,
    mut tool: CustomTool,
) -> Result<CustomTool, String> {
    tool.name = tool.name.trim().to_owned();
    tool.description = tool.description.trim().to_owned();
    tool.tags = tool
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect();
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    validate_custom_tool(&tool)?;
    validate_text_steps(&listed_tools(&store)?, &tool.steps)?;
    if tool.id.is_empty()
        && store
            .custom_tools()
            .map_err(|_| "无法读取自定义工具。")?
            .len()
            >= 200
    {
        return Err("自定义工具最多保存 200 个。".to_owned());
    }
    store
        .save_custom_tool(&tool)
        .map_err(|_| "无法保存自定义工具。".to_owned())
}

fn validate_custom_tool(tool: &CustomTool) -> Result<(), String> {
    if tool.icon.is_some() && tool.icon_data.is_some() {
        return Err("请选择一种工具图标。".into());
    }
    if tool.icon.as_deref().is_some_and(|icon| {
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
    }) || tool
        .icon_data
        .as_deref()
        .is_some_and(|data| !modules::valid_icon_data(data))
    {
        return Err("请选择应用内置图标，或导入有效的 PNG 图标。".into());
    }
    if tool.name.is_empty()
        || tool.name.chars().count() > 80
        || tool.description.chars().count() > 500
        || tool.tags.len() > 8
        || tool.tags.iter().any(|tag| tag.chars().count() > 32)
    {
        return Err("请填写名称，并检查描述和标签长度。".to_owned());
    }
    if tool.steps.is_empty() || tool.steps.len() > 8 {
        return Err("请选择 1 到 8 个处理步骤。".into());
    }
    Ok(())
}

#[tauri::command]
fn delete_custom_tool(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .delete_custom_tool(&id)
        .map_err(|_| "无法删除自定义工具。".to_owned())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[tauri::command]
fn inspect_module(bytes: Vec<u8>) -> Result<modules::ModuleSummary, String> {
    let record = modules::unpack_package(&bytes)?;
    let manifest = modules::parse_record(&record)?;
    Ok(modules::summary(&manifest))
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn validate_module_entries(
    record: &toolbox_storage::ModuleRecord,
    manifest: &modules::Manifest,
) -> Result<(), String> {
    let mut checked_entries = HashSet::new();
    for tool in &manifest.tools {
        let entry = if tool.ui.kind == "web" {
            tool.ui.script.as_ref().ok_or("网页工具缺少 JS 文件。")?
        } else {
            &tool.entry
        };
        if checked_entries.insert(entry) {
            let browser = tool.runtime.as_deref() == Some("browser");
            let scripts = module_validation_sources(&record.scripts, entry, browser)?;
            #[cfg(not(test))]
            let result = modules::run_in_worker(
                scripts,
                entry.clone(),
                String::new(),
                String::new(),
                &manifest.limits,
                Arc::new(AtomicBool::new(false)),
                if browser {
                    modules::WorkerMode::Syntax
                } else {
                    modules::WorkerMode::Validate
                },
            );
            #[cfg(test)]
            let result =
                modules::validate_test_entry(scripts, entry.clone(), &manifest.limits, browser);
            result.map_err(|message| format!("模块入口 {entry} 验证失败：{message}"))?;
        }
    }
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn module_validation_sources(
    scripts: &BTreeMap<String, String>,
    entry: &str,
    browser: bool,
) -> Result<BTreeMap<String, String>, String> {
    if browser {
        // Browser entries are standalone bundles. HTML, CSS and other entries
        // are neither imported nor executed by this syntax-only worker.
        let source = scripts.get(entry).ok_or("模块入口脚本不存在。")?;
        Ok(BTreeMap::from([(entry.to_owned(), source.clone())]))
    } else {
        Ok(scripts.clone())
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[tauri::command]
fn create_module_package(
    manifest: modules::Manifest,
    scripts: BTreeMap<String, String>,
) -> Result<Vec<u8>, String> {
    let record = toolbox_storage::ModuleRecord {
        module_id: manifest.module_id.clone(),
        manifest: serde_json::to_value(&manifest).map_err(|_| "模块清单格式无效。")?,
        scripts,
    };
    let bytes = modules::pack_package(&record)?;
    validate_module_entries(&record, &manifest)?;
    Ok(bytes)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
fn create_module_package(
    _manifest: modules::Manifest,
    _scripts: BTreeMap<String, String>,
) -> Result<Vec<u8>, String> {
    Err("当前平台尚未开放第三方 JS 模块。".into())
}

#[tauri::command]
fn get_module_details(
    state: tauri::State<'_, AppState>,
    module_id: String,
) -> Result<modules::ModuleDetails, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    let record = tool_module_record(&store, &module_id)?.ok_or("工具包不存在。")?;
    let manifest = modules::parse_record(&record)?;
    let builtin = builtin_modules::tool_id(&module_id).is_some();
    let modified = builtin_modules::modified(&record);
    Ok(modules::ModuleDetails {
        manifest,
        scripts: record.scripts,
        builtin,
        modified,
    })
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[tauri::command]
fn export_module(state: tauri::State<'_, AppState>, module_id: String) -> Result<Vec<u8>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    let record = tool_module_record(&store, &module_id)?.ok_or("工具包不存在。")?;
    modules::pack_package(&record)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
fn export_module(
    _state: tauri::State<'_, AppState>,
    _module_id: String,
) -> Result<Vec<u8>, String> {
    Err("当前平台尚未开放第三方 JS 模块。".into())
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
fn inspect_module(_bytes: Vec<u8>) -> Result<modules::ModuleSummary, String> {
    Err("当前平台尚未开放第三方 JS 模块。".into())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
#[tauri::command]
fn install_module(
    state: tauri::State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<modules::ModuleSummary, String> {
    let package = modules::unpack_package_full(&bytes, true)?;
    let record = package.record;
    let manifest = modules::parse_record(&record)?;
    validate_module_entries(&record, &manifest)?;
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    install_tool_module_resources(&store, &record, &manifest, &package.resources)
}

#[cfg(all(test, any(target_os = "windows", target_os = "android")))]
fn install_tool_module(
    store: &Store,
    record: &toolbox_storage::ModuleRecord,
    manifest: &modules::Manifest,
) -> Result<modules::ModuleSummary, String> {
    install_tool_module_resources(store, record, manifest, &BTreeMap::new())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn install_tool_module_resources(
    store: &Store,
    record: &toolbox_storage::ModuleRecord,
    manifest: &modules::Manifest,
    resources: &BTreeMap<String, Vec<u8>>,
) -> Result<modules::ModuleSummary, String> {
    modules::validate_resources(manifest, resources)?;
    let installed = store.modules().map_err(|_| "无法读取模块。")?;
    let builtin_id = builtin_modules::tool_id(&record.module_id);
    if installed.len() >= 100
        && builtin_id.is_none()
        && !installed
            .iter()
            .any(|item| item.module_id == record.module_id)
    {
        return Err("最多安装 100 个模块。".into());
    }
    let mut stored = installed;
    stored.extend(
        store
            .builtin_module_overrides()
            .map_err(|_| "无法读取应用自带工具的修改。")?,
    );
    let existing_bytes: usize = stored
        .iter()
        .filter(|item| item.module_id != record.module_id)
        .flat_map(|item| item.scripts.values())
        .map(String::len)
        .sum();
    let incoming_bytes: usize = record.scripts.values().map(String::len).sum();
    if existing_bytes.saturating_add(incoming_bytes) > 64 * 1024 * 1024 {
        return Err("已安装模块源码总量不能超过 64 MiB。".into());
    }
    let mut incoming_resource_bytes = 0u64;
    let mut hashes = HashSet::new();
    for resource in &manifest.resources {
        if hashes.insert(&resource.sha256)
            && !store
                .resource_used_elsewhere(&record.module_id, &resource.sha256)
                .map_err(|_| "无法读取资源配额。")?
        {
            incoming_resource_bytes += resource.size as u64;
        }
    }
    if store
        .resource_bytes_except(&record.module_id)
        .map_err(|_| "无法读取资源配额。")?
        .saturating_add(incoming_resource_bytes)
        > 512 * 1024 * 1024
    {
        return Err("已安装工具资源总量不能超过 512 MiB。".into());
    }
    let catalog = tool_module_records(store)?;
    if let Some(previous) = catalog
        .iter()
        .find(|item| item.module_id == record.module_id)
    {
        let old = modules::parse_record(previous)?;
        let old_ids: HashSet<_> = old.tools.iter().map(|tool| &tool.id).collect();
        let new_ids: HashSet<_> = manifest.tools.iter().map(|tool| &tool.id).collect();
        if old_ids != new_ids {
            return Err("更新模块时不能改变已有工具 ID；请先卸载旧模块。".into());
        }
        let old_version =
            semver::Version::parse(&old.version).map_err(|_| "已安装模块版本无效。")?;
        let new_version =
            semver::Version::parse(&manifest.version).map_err(|_| "模块版本无效。")?;
        if new_version < old_version
            && !(builtin_id.is_some() && !builtin_modules::modified(previous))
        {
            return Err("不能安装比现有版本更旧的模块。".into());
        }
    }
    for previous in catalog
        .iter()
        .filter(|item| item.module_id != record.module_id)
    {
        let old = modules::parse_record(previous)?;
        if old
            .tools
            .iter()
            .any(|tool| manifest.tools.iter().any(|incoming| incoming.id == tool.id))
        {
            return Err("模块工具 ID 与已安装模块冲突。".into());
        }
    }
    if let Some(tool_id) = builtin_id {
        store
            .save_builtin_module_with_resources(record, tool_id, resources)
            .map_err(|_| "无法保存应用自带工具的修改。")?;
    } else {
        store
            .install_module_with_resources(record, resources)
            .map_err(|_| "无法安装工具包。")?;
    }
    tool_module_summary(record)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
fn install_module(
    _state: tauri::State<'_, AppState>,
    _bytes: Vec<u8>,
) -> Result<modules::ModuleSummary, String> {
    Err("当前平台尚未开放第三方 JS 模块。".into())
}

#[tauri::command]
fn list_modules(state: tauri::State<'_, AppState>) -> Result<Vec<modules::ModuleSummary>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    let deleted = store
        .deleted_builtin_tool_ids()
        .map_err(|_| "无法读取已删除工具。")?;
    tool_module_records(&store)?
        .iter()
        .filter(|record| {
            !builtin_modules::tool_id(&record.module_id)
                .is_some_and(|id| deleted.iter().any(|deleted_id| deleted_id == id))
        })
        .map(tool_module_summary)
        .collect()
}

#[tauri::command]
fn reset_builtin_module(
    state: tauri::State<'_, AppState>,
    module_id: String,
) -> Result<(), String> {
    let tool_id = builtin_modules::tool_id(&module_id).ok_or("此工具不属于应用自带工具。")?;
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .reset_builtin_module(&module_id, tool_id)
        .map_err(|_| "无法恢复工具默认内容。".into())
}

#[tauri::command]
fn delete_module(state: tauri::State<'_, AppState>, module_id: String) -> Result<(), String> {
    if builtin_modules::tool_id(&module_id).is_some() {
        return Err("应用自带工具请通过删除工具和恢复工具操作管理。".into());
    }
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    let record = store
        .module(&module_id)
        .map_err(|_| "无法读取模块。")?
        .ok_or("模块不存在。")?;
    let manifest = modules::parse_record(&record)?;
    let tool_ids = manifest
        .tools
        .iter()
        .map(|tool| tool.id.clone())
        .collect::<Vec<_>>();
    store
        .delete_module(&module_id, &tool_ids)
        .map_err(|_| "无法卸载模块。".into())
}

#[tauri::command]
fn delete_module_tool(
    state: tauri::State<'_, AppState>,
    module_id: String,
    tool_id: String,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    delete_module_tools_from_store(&store, &module_id, &[tool_id])
}

fn delete_module_tools_from_store(
    store: &Store,
    module_id: &str,
    tool_ids: &[String],
) -> Result<(), String> {
    if builtin_modules::tool_id(&module_id).is_some() {
        return Err("应用自带工具请通过删除工具和恢复工具操作管理。".into());
    }
    let mut record = store
        .module(&module_id)
        .map_err(|_| "无法读取模块。")?
        .ok_or("模块不存在。")?;
    let mut manifest = modules::parse_record(&record)?;
    if tool_ids.is_empty()
        || tool_ids
            .iter()
            .any(|id| !manifest.tools.iter().any(|tool| &tool.id == id))
    {
        return Err("工具不属于此模块。".into());
    }
    let selected: HashSet<_> = tool_ids.iter().collect();
    manifest.tools.retain(|tool| !selected.contains(&tool.id));
    if manifest.tools.is_empty() {
        return store
            .delete_module(module_id, tool_ids)
            .map_err(|_| "无法删除工具。".into());
    }
    if manifest
        .tools
        .iter()
        .all(|tool| tool.runtime.as_deref() == Some("browser"))
    {
        let used: HashSet<&str> = manifest
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
        record
            .scripts
            .retain(|path, _| used.contains(path.as_str()));
    }
    record.manifest = serde_json::to_value(&manifest).map_err(|_| "模块清单格式无效。")?;
    modules::parse_record(&record)?;
    store
        .delete_module_tools(&record, tool_ids)
        .map_err(|_| "无法删除工具。".into())
}

fn delete_tools_from_store(store: &mut Store, tool_ids: &[String]) -> Result<usize, String> {
    let selected: HashSet<_> = tool_ids.iter().collect();
    if tool_ids.is_empty() || tool_ids.len() > 1000 || selected.len() != tool_ids.len() {
        return Err("请选择 1 到 1000 个不同的工具。".into());
    }
    let catalog = listed_tools(store)?;
    let tools = catalog
        .iter()
        .filter(|tool| selected.contains(&tool.id))
        .collect::<Vec<_>>();
    if tools.len() != tool_ids.len() {
        return Err("工具列表已变化，请刷新后重新选择。".into());
    }
    store.atomic_update(|staging| {
        let mut modules: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for tool in &tools {
            if tool.custom {
                staging
                    .delete_custom_tool(&tool.id)
                    .map_err(|_| format!("无法删除自动化工具「{}」。", tool.name))?;
            } else if tool.builtin {
                staging
                    .delete_builtin_tool(&tool.id)
                    .map_err(|_| format!("无法删除应用自带工具「{}」。", tool.name))?;
            } else if let Some(module_id) = &tool.module_id {
                modules
                    .entry(module_id.clone())
                    .or_default()
                    .push(tool.id.clone());
            } else {
                return Err(format!("无法确认「{}」的工具来源。", tool.name));
            }
        }
        for (module_id, ids) in modules {
            delete_module_tools_from_store(staging, &module_id, &ids)?;
        }
        Ok(tool_ids.len())
    })
}

#[tauri::command]
fn delete_tools(state: tauri::State<'_, AppState>, tool_ids: Vec<String>) -> Result<usize, String> {
    let mut store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    delete_tools_from_store(&mut store, &tool_ids)
}

#[tauri::command]
fn export_configuration(
    state: tauri::State<'_, AppState>,
) -> Result<ConfigurationSnapshot, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .export_configuration()
        .map_err(|_| "无法导出配置。".to_owned())
}

#[tauri::command]
fn import_configuration(
    state: tauri::State<'_, AppState>,
    backup: ConfigurationSnapshot,
) -> Result<(), String> {
    if backup.schema_version != 3
        || backup.websites.len() > 1000
        || backup.favorites.len() > 1000
        || serde_json::to_vec(&backup)
            .map_err(|_| "配置格式无效。")?
            .len()
            > 16 * 1024 * 1024
    {
        return Err("配置版本、数量或大小不受支持。".to_owned());
    }
    let mut website_ids = HashSet::new();
    for site in &backup.websites {
        if site.id <= 0 || !website_ids.insert(site.id) {
            return Err("网站 ID 无效或重复。".to_owned());
        }
        validate_website(site)?;
    }
    let mut favorite_ids = HashSet::new();
    for id in &backup.favorites {
        if !favorite_ids.insert(id.as_str()) || !toolbox_core::tool_exists(id) {
            return Err("收藏包含未知或重复工具。".to_owned());
        }
    }
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .replace_configuration(&backup)
        .map_err(|_| "无法导入配置，原数据已保留。".to_owned())
}

#[tauri::command]
async fn detect_text(app: tauri::AppHandle, input: String) -> Result<Vec<DetectionResult>, String> {
    if input.len() > toolbox_core::MAX_TEXT_BYTES {
        return Err("待识别内容不能超过 1 MiB。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let catalog = {
            let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
            listed_tools(&store)?
        };
        Ok(recommend_text_tools(&input, &catalog))
    })
    .await
    .map_err(|_| "识别任务异常，请稍后重试。")?
}

fn recommend_text_tools(input: &str, catalog: &[ListedTool]) -> Vec<DetectionResult> {
    let mut results = toolbox_core::detect_text(&input);
    for result in &mut results {
        result.actions.clear();
        for tool in catalog {
            for action in &tool.actions {
                if tool.ui_kind.as_deref() != Some("web")
                    && action.consumes_input
                    && action.input_types.iter().any(|kind| kind == result.type_id)
                {
                    result.actions.push(toolbox_core::DetectionAction {
                        id: action.id.clone(),
                        label: format!("{} · {}", tool.name, action.label),
                        tool_id: tool.id.clone(),
                    });
                }
            }
        }
    }
    results.retain(|result| !result.actions.is_empty());
    results
}

#[cfg(test)]
mod integration_contract_tests {
    use super::*;

    #[test]
    fn opening_text_and_automation_tools_records_history_and_rejects_unknown_ids() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let automation = store
            .save_custom_tool(&CustomTool {
                id: String::new(),
                name: "Flow".into(),
                description: String::new(),
                tags: vec![],
                icon: None,
                icon_data: None,
                steps: vec![toolbox_core::ToolStep {
                    tool_id: "text.case".into(),
                    action: "upper".into(),
                }],
            })
            .unwrap();
        record_opened_tool(&store, "text.case").unwrap();
        record_opened_tool(&store, &automation.id).unwrap();
        record_opened_tool(&store, "text.case").unwrap();
        assert!(record_opened_tool(&store, "unknown.tool").is_err());
        let recent = store.recent_tools().unwrap();
        assert_eq!(recent.len(), 2);
        assert!(recent.contains(&"text.case".to_string()) && recent.contains(&automation.id));
    }

    #[test]
    fn detection_only_recommends_current_text_actions_that_consume_the_input() {
        let descriptor = toolbox_core::list_tools()
            .iter()
            .find(|tool| tool.id == "json.format")
            .unwrap();
        let mut tool = ListedTool::from(descriptor);
        tool.name = "Edited JSON".into();
        tool.actions[0].consumes_input = false;
        assert!(recommend_text_tools("{}", &[tool]).is_empty());
        let mut tool = ListedTool::from(descriptor);
        tool.ui_kind = Some("web".into());
        assert!(recommend_text_tools("{}", &[tool]).is_empty());
        let mut tool = ListedTool::from(descriptor);
        tool.name = "Edited JSON".into();
        let results = recommend_text_tools("{}", &[tool]);
        assert_eq!(results[0].actions.len(), 1);
        assert!(results[0].actions[0].label.contains("Edited JSON"));
    }

    #[cfg(target_os = "windows")]
    fn batch_module(web: bool) -> toolbox_storage::ModuleRecord {
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.module_id = "local.batch".into();
        record.manifest["module_id"] = "local.batch".into();
        record.manifest["schema_version"] = 5.into();
        record.manifest["min_app_version"] = "0.1.5".into();
        record.manifest["tools"][0]["id"] = "local.batch.first".into();
        let mut second = record.manifest["tools"][0].clone();
        second["id"] = "local.batch.second".into();
        if web {
            record.manifest["schema_version"] = 7.into();
            record.manifest["min_app_version"] = env!("CARGO_PKG_VERSION").into();
            for (tool, entry, script) in [
                (&mut record.manifest["tools"][0], "first.html", "first.js"),
                (&mut second, "second.html", "second.js"),
            ] {
                tool["entry"] = entry.into();
                tool["runtime"] = "browser".into();
                tool["input_schema"] = serde_json::Value::Null;
                tool["output_schema"] = serde_json::Value::Null;
                tool["ui"] = serde_json::json!({"kind":"web","script":script,"style":"shared.css"});
                tool["actions"] = serde_json::json!([{"id":"open","label":{"zh-CN":"打开"}}]);
            }
            record.scripts = BTreeMap::from([
                ("first.html".into(), "<p>First</p>".into()),
                ("first.js".into(), "export function mount() {}".into()),
                ("second.html".into(), "<p>Second</p>".into()),
                ("second.js".into(), "export function mount() {}".into()),
                ("shared.css".into(), "body{}".into()),
            ]);
        } else {
            second["entry"] = "js/second.js".into();
            record.scripts = BTreeMap::from([
                (
                    "main.js".into(),
                    "import {run} from './js/helper.js'; export {run};".into(),
                ),
                (
                    "js/second.js".into(),
                    "import {run} from './helper.js'; export {run};".into(),
                ),
                (
                    "js/helper.js".into(),
                    "export function run(input) {return input;}".into(),
                ),
            ]);
        }
        record.manifest["tools"]
            .as_array_mut()
            .unwrap()
            .push(second);
        modules::parse_record(&record).unwrap();
        record
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn batch_delete_combines_origins_cleans_history_and_preserves_recoverable_builtin_edits() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.install_module(&batch_module(false)).unwrap();
        let mut builtin = builtin_modules::bundled("builtin.json.format").unwrap();
        builtin.manifest["tools"][0]["name"]["zh-CN"] = "Edited JSON".into();
        store.save_builtin_module(&builtin, "json.format").unwrap();
        let automation = store
            .save_custom_tool(&CustomTool {
                icon: None,
                icon_data: None,
                id: String::new(),
                name: "Flow".into(),
                description: String::new(),
                tags: vec![],
                steps: vec![toolbox_core::ToolStep {
                    tool_id: "local.batch.first".into(),
                    action: "format".into(),
                }],
            })
            .unwrap();
        let identity = store.sync_identity("automation", &automation.id).unwrap();
        for id in [
            "json.format",
            "local.batch.first",
            "local.batch.second",
            &automation.id,
        ] {
            store.set_favorite(id, true).unwrap();
            store.record_tool_use(id).unwrap();
        }
        assert_eq!(
            delete_tools_from_store(
                &mut store,
                &[
                    "json.format".into(),
                    "local.batch.first".into(),
                    automation.id.clone()
                ]
            )
            .unwrap(),
            3
        );
        assert_eq!(store.favorites().unwrap(), ["local.batch.second"]);
        assert_eq!(store.recent_tools().unwrap(), ["local.batch.second"]);
        assert!(store.custom_tools().unwrap().is_empty());
        assert!(store
            .sync_local_id("automation", &identity)
            .unwrap()
            .is_none());
        let remaining = store.module("local.batch").unwrap().unwrap();
        assert_eq!(
            modules::parse_record(&remaining).unwrap().tools[0].id,
            "local.batch.second"
        );
        assert!(remaining.scripts.contains_key("js/helper.js"));
        assert_eq!(store.deleted_builtin_tool_ids().unwrap(), ["json.format"]);
        store
            .restore_builtin_tools(&["json.format".into()])
            .unwrap();
        assert_eq!(
            listed_tools(&store)
                .unwrap()
                .into_iter()
                .find(|t| t.id == "json.format")
                .unwrap()
                .name,
            "Edited JSON"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn batch_delete_rejects_stale_empty_or_duplicate_selections_without_deleting_valid_tools() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.set_favorite("json.format", true).unwrap();
        for ids in [
            vec![],
            vec!["json.format".into(), "missing.tool".into()],
            vec!["json.format".into(), "json.format".into()],
        ] {
            assert!(delete_tools_from_store(&mut store, &ids).is_err());
            assert!(store.deleted_builtin_tool_ids().unwrap().is_empty());
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn batch_delete_last_two_package_tools_uninstalls_once_and_cleans_both_favorites() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.install_module(&batch_module(false)).unwrap();
        for id in ["local.batch.first", "local.batch.second"] {
            store.set_favorite(id, true).unwrap();
        }
        assert_eq!(
            delete_tools_from_store(
                &mut store,
                &["local.batch.first".into(), "local.batch.second".into()]
            )
            .unwrap(),
            2
        );
        assert!(store.module("local.batch").unwrap().is_none());
        assert!(store.favorites().unwrap().is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn batch_delete_web_entry_persists_resource_pruning_and_keeps_shared_styles() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.install_module(&batch_module(true)).unwrap();
        delete_tools_from_store(&mut store, &["local.batch.first".into()]).unwrap();
        let remaining = store.module("local.batch").unwrap().unwrap();
        assert!(!remaining.scripts.contains_key("first.html"));
        assert!(!remaining.scripts.contains_key("first.js"));
        assert!(remaining.scripts.contains_key("shared.css"));
        assert!(remaining.scripts.contains_key("second.js"));
        modules::parse_record(&remaining).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn deleted_builtins_leave_the_active_catalog_and_restore_their_modified_contract() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.manifest["tools"][0]["name"]["zh-CN"] = serde_json::json!("我的 JSON");
        let source = "export function run(input) { return { text: 'modified:' + input.text }; }";
        record.scripts.insert("main.js".into(), source.into());
        store.save_builtin_module(&record, "json.format").unwrap();
        let steps = vec![toolbox_core::ToolStep {
            tool_id: "json.format".into(),
            action: "format".into(),
        }];
        let automated = store
            .save_custom_tool(&CustomTool {
                icon: None,
                icon_data: None,
                id: String::new(),
                name: "自动化".into(),
                description: String::new(),
                tags: vec![],
                steps: steps.clone(),
            })
            .unwrap();
        store.delete_builtin_tool("json.format").unwrap();
        let catalog = listed_tools(&store).unwrap();
        assert!(!catalog.iter().any(|tool| tool.id == "json.format"));
        assert!(!tool_exists(&store, "json.format").unwrap());
        assert!(resolve_text_steps(&store, &steps).is_err());
        assert!(!recommend_text_tools("{\"a\":1}", &catalog)
            .iter()
            .flat_map(|item| &item.actions)
            .any(|action| action.tool_id == "json.format" || action.tool_id == automated.id));
        let deleted = tool_catalog(&store, true).unwrap();
        assert_eq!(deleted.len(), 1);
        assert!(deleted[0].builtin);
        assert_eq!(deleted[0].name, "我的 JSON");
        store
            .restore_builtin_tools(&["json.format".into()])
            .unwrap();
        assert!(tool_catalog(&store, true).unwrap().is_empty());
        assert!(tool_exists(&store, "json.format").unwrap());
        assert!(
            recommend_text_tools("{\"a\":1}", &listed_tools(&store).unwrap())
                .iter()
                .flat_map(|item| &item.actions)
                .any(|action| action.tool_id == automated.id)
        );
        match &resolve_text_steps(&store, &steps).unwrap()[0] {
            TextStep::Script { scripts, .. } => assert_eq!(scripts["main.js"], source),
            _ => panic!("恢复后必须执行原有用户源码"),
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn builtin_edits_feed_the_catalog_detection_and_pipeline_snapshot() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let initial = listed_tools(&store).unwrap();
        assert_eq!(initial.len(), toolbox_core::list_tools().len());
        assert!(initial.iter().all(|tool| tool.builtin
            && tool.module_id.is_some()
            && tool.pipeline_compatible == (tool.ui_kind.as_deref() == Some("text"))));
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.manifest["name"]["zh-CN"] = serde_json::json!("我的 JSON 工具");
        record.manifest["tools"][0]["name"]["zh-CN"] = serde_json::json!("我的 JSON 工具");
        record.manifest["tools"][0]["actions"][0]["input_types"] = serde_json::json!(["text"]);
        let edited_source =
            "export function run(input) { return { text: 'changed:' + input.text }; }";
        record
            .scripts
            .insert("main.js".into(), edited_source.into());
        let manifest = modules::parse_record(&record).unwrap();
        let installed = install_tool_module(&store, &record, &manifest).unwrap();
        assert!(installed.builtin && installed.modified);
        let catalog = listed_tools(&store).unwrap();
        let tool = catalog
            .iter()
            .find(|tool| tool.id == "json.format")
            .unwrap();
        assert_eq!(tool.name, "我的 JSON 工具");
        assert_eq!(catalog.len(), initial.len());
        assert!(recommend_text_tools("plain text", &catalog)
            .iter()
            .flat_map(|result| &result.actions)
            .any(|action| action.tool_id == "json.format" && action.id == "format"));
        let steps = [
            toolbox_core::ToolStep {
                tool_id: "json.format".into(),
                action: "format".into(),
            },
            toolbox_core::ToolStep {
                tool_id: "text.case".into(),
                action: "upper".into(),
            },
        ];
        let snapshot = resolve_text_steps(&store, &steps).unwrap();
        store
            .reset_builtin_module("builtin.json.format", "json.format")
            .unwrap();
        assert!(snapshot
            .iter()
            .all(|step| matches!(step, TextStep::Script { .. })));
        match &snapshot[0] {
            TextStep::Script { scripts, .. } => assert_eq!(scripts["main.js"], edited_source),
            _ => panic!("应用自带工具必须走模块执行器"),
        }
        assert!(
            !tool_module_summary(
                &tool_module_record(&store, "builtin.json.format")
                    .unwrap()
                    .unwrap()
            )
            .unwrap()
            .modified
        );
        assert_eq!(
            listed_tools(&store)
                .unwrap()
                .iter()
                .find(|tool| tool.id == "json.format")
                .unwrap()
                .name,
            toolbox_core::list_tools()
                .iter()
                .find(|tool| tool.id == "json.format")
                .unwrap()
                .name
        );
        let uuid = toolbox_core::ToolStep {
            tool_id: "uuid.generate".into(),
            action: "generate".into(),
        };
        assert!(resolve_text_steps(&store, &[uuid.clone()]).is_ok());
        assert!(resolve_text_steps(&store, &[steps[1].clone(), uuid]).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn builtin_updates_do_not_consume_imported_module_slots() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut imported = builtin_modules::bundled("builtin.json.format").unwrap();
        imported.manifest["schema_version"] = serde_json::json!(5);
        for index in 0..100 {
            imported.module_id = format!("local.quota_{index}");
            imported.manifest["module_id"] = imported.module_id.clone().into();
            imported.manifest["tools"][0]["id"] = format!("{}.tool", imported.module_id).into();
            let manifest = modules::parse_record(&imported).unwrap();
            install_tool_module(&store, &imported, &manifest).unwrap();
        }
        let mut builtin = builtin_modules::bundled("builtin.json.format").unwrap();
        builtin.scripts.insert(
            "main.js".into(),
            "export function run(input) { return input; }".into(),
        );
        let manifest = modules::parse_record(&builtin).unwrap();
        assert!(
            install_tool_module(&store, &builtin, &manifest)
                .unwrap()
                .modified
        );
        assert_eq!(store.modules().unwrap().len(), 100);
        assert_eq!(
            tool_module_records(&store).unwrap().len(),
            100 + toolbox_core::list_tools().len()
        );
        imported.module_id = "local.quota_extra".into();
        imported.manifest["module_id"] = imported.module_id.clone().into();
        imported.manifest["tools"][0]["id"] = "local.quota_extra.tool".into();
        assert!(install_tool_module(
            &store,
            &imported,
            &modules::parse_record(&imported).unwrap()
        )
        .unwrap_err()
        .contains("100"));
        builtin.manifest["version"] = "0.1.1".into();
        assert!(
            install_tool_module(&store, &builtin, &modules::parse_record(&builtin).unwrap())
                .unwrap_err()
                .contains("更旧")
        );
    }

    #[test]
    fn installed_text_tool_joins_detection_and_pipeline_from_its_contract() {
        let path = std::env::temp_dir().join(format!(
            "firefly-contract-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = Store::open(&path).unwrap();
            let mut manifest: serde_json::Value =
                serde_json::from_str(include_str!("../../examples/modules/reverse/manifest.json"))
                    .unwrap();
            manifest["schema_version"] = serde_json::json!(5);
            manifest["tools"][0]["actions"][0]["input_types"] = serde_json::json!(["json"]);
            let id = manifest["tools"][0]["id"].as_str().unwrap().to_owned();
            let action = manifest["tools"][0]["actions"][0]["id"]
                .as_str()
                .unwrap()
                .to_owned();
            store
                .install_module(&toolbox_storage::ModuleRecord {
                    module_id: manifest["module_id"].as_str().unwrap().into(),
                    manifest,
                    scripts: BTreeMap::from([(
                        "main.js".into(),
                        include_str!("../../examples/modules/reverse/main.js").into(),
                    )]),
                })
                .unwrap();
            let catalog = listed_tools(&store).unwrap();
            assert!(
                catalog
                    .iter()
                    .find(|tool| tool.id == id)
                    .unwrap()
                    .pipeline_compatible
            );
            assert!(recommend_text_tools("{\"a\":1}", &catalog)
                .iter()
                .flat_map(|item| &item.actions)
                .any(|item| item.tool_id == id));
            let steps = vec![
                toolbox_core::ToolStep {
                    tool_id: id.clone(),
                    action,
                },
                toolbox_core::ToolStep {
                    tool_id: "text.case".into(),
                    action: "upper".into(),
                },
            ];
            assert_eq!(resolve_text_steps(&store, &steps).unwrap().len(), 2);
            let automated = store
                .save_custom_tool(&CustomTool {
                    icon: None,
                    icon_data: None,
                    id: String::new(),
                    name: "JSON 自动化".into(),
                    description: String::new(),
                    tags: vec![],
                    steps,
                })
                .unwrap();
            assert!(
                recommend_text_tools("{\"a\":1}", &listed_tools(&store).unwrap())
                    .iter()
                    .flat_map(|item| &item.actions)
                    .any(|item| item.tool_id == automated.id)
            );
            store
                .delete_module("dev.example.reverse", &[id.clone()])
                .unwrap();
            assert!(
                !recommend_text_tools("{\"a\":1}", &listed_tools(&store).unwrap())
                    .iter()
                    .flat_map(|item| &item.actions)
                    .any(|item| item.tool_id == id)
            );
            assert!(resolve_text_steps(
                &store,
                &[toolbox_core::ToolStep {
                    tool_id: id,
                    action: "reverse".into()
                }]
            )
            .is_err());
        }
        std::fs::remove_file(path).unwrap();
    }
}

#[tauri::command]
fn list_favorites(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store.favorites().map_err(|_| "无法读取收藏。".to_owned())
}

#[tauri::command]
fn set_favorite(
    state: tauri::State<'_, AppState>,
    tool_id: &str,
    favorite: bool,
) -> Result<(), String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    if !tool_exists(&store, tool_id)? {
        return Err("未知工具。".to_owned());
    }
    store
        .set_favorite(tool_id, favorite)
        .map_err(|_| "无法更新收藏。".to_owned())
}

#[tauri::command]
fn replace_favorites(
    state: tauri::State<'_, AppState>,
    tool_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    for id in &tool_ids {
        if !tool_exists(&store, id)? {
            return Err("包含未知工具。".to_owned());
        }
    }
    store
        .replace_favorites(&tool_ids)
        .map_err(|_| "无法保存收藏。")?;
    store.favorites().map_err(|_| "无法读取收藏。".to_owned())
}

#[tauri::command]
fn list_websites(state: tauri::State<'_, AppState>) -> Result<Vec<Website>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store.websites().map_err(|_| "无法读取网站。".to_owned())
}

#[derive(Serialize)]
struct SavedWebsite {
    id: i64,
    websites: Vec<Website>,
}

#[tauri::command]
fn save_website(
    state: tauri::State<'_, AppState>,
    mut website: Website,
) -> Result<SavedWebsite, String> {
    website.name = website.name.trim().to_owned();
    website.url = website.url.trim().to_owned();
    website.description = website.description.trim().to_owned();
    website.tags = website.tags.trim().to_owned();
    validate_website(&website)?;
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    if website.id == 0 && store.websites().map_err(|_| "无法读取网站。")?.len() >= 1000 {
        return Err("网站最多保存 1000 个。".to_owned());
    }
    let id = store
        .save_website(&website)
        .map_err(|_| "无法保存网站。".to_owned())?;
    let websites = store.websites().map_err(|_| "无法读取网站。".to_owned())?;
    Ok(SavedWebsite { id, websites })
}

fn validate_website(website: &Website) -> Result<(), String> {
    if website.id < 0
        || website.name.is_empty()
        || website.name.len() > 120
        || website.url.len() > 2048
        || website.description.len() > 1000
        || website.tags.len() > 500
    {
        return Err("请填写网站名称，并检查文字长度。".to_owned());
    }
    let parsed = url::Url::parse(&website.url).map_err(|_| "网站地址无效。".to_owned())?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("只支持不含账号信息的 HTTP 或 HTTPS 网站地址。".to_owned());
    }
    Ok(())
}

#[tauri::command]
fn delete_website(state: tauri::State<'_, AppState>, id: i64) -> Result<Vec<Website>, String> {
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    store
        .delete_website(id)
        .map_err(|_| "无法删除网站。".to_owned())?;
    store.websites().map_err(|_| "无法读取网站。".to_owned())
}

#[derive(Serialize)]
struct WebsiteShortcut {
    name: String,
    url: String,
}

#[cfg(target_os = "windows")]
fn parse_website_shortcut_contents(bytes: &[u8]) -> Result<String, String> {
    let contents = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little_endian = bytes[0] == 0xff;
        let pairs = bytes[2..].chunks_exact(2);
        if !pairs.remainder().is_empty() {
            return Err("网站快捷方式编码无效。".into());
        }
        let units: Vec<u16> = pairs
            .map(|pair| {
                if little_endian {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| "网站快捷方式编码无效。")?
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    let mut in_shortcut = false;
    for line in contents.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.starts_with('[') && line.ends_with(']') {
            in_shortcut = line[1..line.len() - 1].eq_ignore_ascii_case("InternetShortcut");
            continue;
        }
        if !in_shortcut {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("URL") {
            continue;
        }
        let value = value.trim().trim_matches('"');
        if value.len() > 2048 {
            break;
        }
        let url = url::Url::parse(value).map_err(|_| "网站快捷方式中的网址无效。")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("网站快捷方式仅支持 HTTP 或 HTTPS 网址。".into());
        }
        return Ok(url.to_string());
    }
    Err(".url 文件中未找到有效的网站地址。".into())
}

#[tauri::command]
fn read_website_shortcut(path: String) -> Result<WebsiteShortcut, String> {
    #[cfg(target_os = "windows")]
    {
        let file = Path::new(&path);
        if !file
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("url"))
        {
            return Err("请拖入 .url 网站快捷方式文件。".into());
        }
        let metadata = std::fs::metadata(file).map_err(|_| "无法读取网站快捷方式。")?;
        if !metadata.is_file() || metadata.len() > 64 * 1024 {
            return Err("网站快捷方式文件过大或无效。".into());
        }
        let bytes = std::fs::read(file).map_err(|_| "无法读取网站快捷方式。")?;
        if bytes.len() > 64 * 1024 {
            return Err("网站快捷方式文件过大。".into());
        }
        let url = parse_website_shortcut_contents(&bytes)?;
        let fallback = url::Url::parse(&url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_owned))
            .unwrap_or_else(|| "网站".into());
        let name = file
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("")
            .trim();
        let name = if name.is_empty() {
            fallback
        } else {
            name.chars().take(120).collect()
        };
        Ok(WebsiteShortcut { name, url })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("仅 Windows 版本支持拖入 .url 文件。".into())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod website_shortcut_tests {
    use super::parse_website_shortcut_contents;

    #[test]
    fn reads_shortcut_url_in_utf8_and_utf16() {
        let text = "[InternetShortcut]\r\nURL=https://example.com/path?q=1\r\n";
        assert_eq!(
            parse_website_shortcut_contents(text.as_bytes()).unwrap(),
            "https://example.com/path?q=1"
        );
        let mut utf16 = vec![0xff, 0xfe];
        utf16.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(
            parse_website_shortcut_contents(&utf16).unwrap(),
            "https://example.com/path?q=1"
        );
    }

    #[test]
    fn rejects_non_web_shortcuts() {
        assert!(
            parse_website_shortcut_contents(b"[InternetShortcut]\nURL=file:///C:/secret.txt")
                .is_err()
        );
        assert!(parse_website_shortcut_contents(
            b"[InternetShortcut]\nIconFile=https://example.com"
        )
        .is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    if let Err(error) = data_directory::migrate() {
        data_directory::show_migration_error(&error);
        return;
    }
    let builder = tauri::Builder::default()
        .manage(tool_fullscreen::ToolFullscreenState::default())
        .manage(tool_repository::RepositoryState::default())
        .register_asynchronous_uri_scheme_protocol("ff-work", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(file_sessions::workspace_response(
                    &app.state::<file_sessions::FileSessions>(),
                    &request,
                ))
            });
        })
        .register_asynchronous_uri_scheme_protocol("ff-file", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(file_sessions::preview_response(
                    &app.state::<file_sessions::FileSessions>(),
                    &request,
                ))
            });
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::SIZE | StateFlags::MAXIMIZED)
            .with_denylist(&["splashscreen"])
            .build(),
    );
    builder
        .setup(|app| {
            #[cfg(target_os = "windows")]
            let shortcut_launch = std::env::args().any(|arg| {
                arg.strip_prefix("--firefly-open-tool=")
                    .is_some_and(|tool_id| !tool_id.is_empty())
            });
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join("firefly.sqlite"))?;
            app.manage(AppState(Mutex::new(store)));
            app.manage(ModuleRuns(Mutex::new(HashMap::new())));
            app.manage(file_hash::HashJobs::default());
            app.manage(file_sessions::FileSessions::default());
            app.manage(web_http::HttpSessions::default());
            app.manage(file_transport::FileTransport::default());
            app.manage(sync_data::SyncState::default());
            #[cfg(target_os = "windows")]
            {
                let close_behavior_path = data_dir.join("desktop-close-behavior.txt");
                let close_to_tray = std::fs::read_to_string(&close_behavior_path)
                    .map(|value| value.trim() != "exit")
                    .unwrap_or(true);
                app.manage(DesktopSettingsState {
                    close_to_tray: AtomicBool::new(close_to_tray),
                    close_behavior_path,
                });
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ))?;
                setup_tray(app)?;
                if shortcut_launch {
                    let main = app
                        .get_webview_window("main")
                        .ok_or("无法找到应用主窗口。")?;
                    main.show()?;
                    main.set_focus()?;
                    app.get_webview_window("splashscreen")
                        .ok_or("无法找到启动画面。")?
                        .close()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if window.label().starts_with("website-")
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
            {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    let _ = browser_progress::update(webview.as_ref());
                }
            }
            #[cfg(target_os = "windows")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let app = window.app_handle();
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = tool_fullscreen::set(&main, false);
                    }
                    let state = app.state::<DesktopSettingsState>();
                    let _ = app.save_window_state(StateFlags::SIZE | StateFlags::MAXIMIZED);
                    api.prevent_close();
                    if state.close_to_tray.load(Ordering::Relaxed) {
                        let _ = window.hide();
                    } else {
                        app.exit(0);
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            sync_data::sync_share,
            sync_data::sync_status,
            sync_data::sync_close,
            sync_data::sync_receive,
            sync_data::sync_preview,
            sync_data::sync_apply,
            list_tools,
            remote_messages::fetch_remote_messages,
            remote_messages::open_remote_message_link,
            tool_fullscreen::set_web_tool_fullscreen,
            tool_repository::repository_catalog,
            tool_repository::repository_describe,
            tool_repository::repository_prepare,
            tool_repository::repository_cancel,
            tool_repository::repository_release,
            tool_repository::repository_save,
            tool_repository::repository_install,
            web_tool_request,
            web_http::web_tool_http_create,
            web_http::web_tool_http_start,
            web_http::web_tool_http_read,
            web_http::web_tool_http_cancel,
            web_storage::load_tool_storage,
            web_storage::save_tool_storage,
            web_storage::clear_preview_tool_storage,
            web_tool_open_external,
            web_tool_resolve_link,
            web_tool_certificate,
            file_hash::hash_selected_file,
            file_hash::cancel_hash_file,
            file_sessions::web_file_begin_run,
            file_sessions::web_file_transport,
            file_sessions::web_file_open,
            file_sessions::web_file_read,
            file_sessions::web_file_create_writer,
            file_sessions::web_file_preview_writer,
            file_sessions::web_file_write,
            file_sessions::web_file_save_writer,
            file_sessions::web_file_close,
            file_sessions::web_file_close_run,
            package_host::inspect_module_file,
            package_host::install_module_file,
            package_host::export_module_file,
            package_host::validate_module_draft,
            package_host::install_module_draft,
            package_host::export_module_draft_file,
            package_host::read_module_resource,
            package_host::stage_module_resource,
            package_host::discard_module_resources,
            clear_runtime_cache,
            list_deleted_builtin_tools,
            delete_builtin_tool,
            restore_builtin_tools,
            search_tools,
            run_text_tool,
            cancel_module_run,
            record_tool_open,
            initialize_website_progress,
            list_recent_tools,
            clear_recent_tools,
            list_custom_tools,
            save_custom_tool,
            delete_custom_tool,
            inspect_module,
            create_module_package,
            preview_tool_package,
            get_module_details,
            reset_builtin_module,
            export_module,
            install_module,
            list_modules,
            delete_module,
            delete_module_tool,
            delete_tools,
            export_configuration,
            import_configuration,
            configuration_file::read_configuration_file,
            configuration_file::write_configuration_file,
            detect_text,
            list_favorites,
            set_favorite,
            replace_favorites,
            list_websites,
            save_website,
            delete_website,
            read_website_shortcut,
            finish_splash,
            show_splash,
            desktop_close_behavior,
            set_desktop_close_behavior,
            desktop_autostart_enabled,
            set_desktop_autostart,
            create_tool_shortcut,
            shortcuts::read_shortcut_icon_file,
            open_shortcut_settings,
            take_shortcut_launch
        ])
        .run(tauri::generate_context!())
        .expect("无法启动流萤百宝箱");
}
