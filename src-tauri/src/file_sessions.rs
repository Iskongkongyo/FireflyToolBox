//! User-picked files stay in Rust. Opaque run-scoped handles expose bounded chunks.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use serde::Serialize;
use std::borrow::Cow;
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager,
};

pub const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_HANDLES: usize = 128;

#[derive(Default, Clone)]
pub struct FileSessions(Arc<Mutex<Sessions>>);

impl FileSessions {
    pub fn clear(&self) -> Result<(), String> {
        let mut sessions = self.0.lock().map_err(|_| "文件会话暂不可用。")?;
        for run in sessions.runs.values() {
            run.cancelled.store(true, Ordering::Relaxed);
        }
        for job in sessions.busy.values() {
            job.cancelled.store(true, Ordering::Relaxed);
        }
        sessions.runs.clear();
        // Close preview handles before dropping writers so Windows can delete them.
        sessions.busy.clear();
        let mut files: Vec<_> = sessions.files.drain().map(|(_, file)| file).collect();
        for entry in &mut files {
            entry.file.take();
        }
        drop(files);
        Ok(())
    }
}
#[derive(Default)]
struct Sessions {
    runs: HashMap<String, Run>,
    files: HashMap<String, OpenFile>,
    busy: HashMap<String, BusyFile>,
}
fn ensure_handle_capacity(sessions: &Sessions) -> Result<(), String> {
    if sessions.files.len() + sessions.busy.len() >= MAX_HANDLES {
        return Err("FILE_BUSY: 同时打开的文件句柄最多 128 个。".into());
    }
    Ok(())
}
struct BusyFile {
    run: String,
    cancelled: Arc<AtomicBool>,
    preview: Option<File>,
    size: u64,
    mime_type: String,
}
struct Run {
    cancelled: Arc<AtomicBool>,
    input_limit: u64,
    output_limit: u64,
}
struct OpenFile {
    run: String,
    file: Option<File>,
    temporary: Option<PathBuf>,
    position: u64,
    size: u64,
    limit: u64,
    writable: bool,
    seekable: bool,
    mime_type: String,
}
impl Drop for OpenFile {
    fn drop(&mut self) {
        self.file.take();
        if let Some(path) = &self.temporary {
            let _ = std::fs::remove_file(path);
        }
    }
}
#[derive(Serialize)]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub seekable: bool,
}
pub struct NativeFile {
    pub file: File,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
}

fn token() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn scope(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("FILE_SCOPE: 仅允许主界面处理用户选取的文件。".into())
    }
}
fn active<'a>(sessions: &'a Sessions, run: &str) -> Result<&'a Run, String> {
    sessions
        .runs
        .get(run)
        .filter(|r| !r.cancelled.load(Ordering::Relaxed))
        .ok_or_else(|| "FILE_CANCELED: 文件会话已关闭。".into())
}

#[cfg(target_os = "android")]
fn android_file(path: &str, write: bool) -> Result<NativeFile, String> {
    use jni::{
        objects::{JClass, JObject, JString, JValue},
        JavaVM,
    };
    use std::os::fd::FromRawFd;
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
        .map_err(|_| "FILE_OPEN: 无法连接 Android 文件接口。")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|_| "FILE_OPEN: 无法连接 Android 文件线程。")?;
    let context = unsafe { JObject::from_raw(context.context().cast()) };
    let loader = env
        .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .and_then(|value| value.l())
        .map_err(|_| "FILE_OPEN: Android 类加载器不可用。")?;
    let class_name = JObject::from(
        env.new_string("firefly.toolbox.FileBridge")
            .map_err(|_| "FILE_OPEN: Android 文件类名无效。")?,
    );
    let class = JClass::from(
        env.call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&class_name)],
        )
        .and_then(|value| value.l())
        .map_err(|_| "FILE_OPEN: Android 文件桥接类不可用。")?,
    );
    let payload = env
        .new_string(serde_json::json!({"path":path,"write":write}).to_string())
        .map_err(|_| "FILE_OPEN: 无法传递文件信息。")?;
    let payload_obj = JObject::from(payload);
    let value = env.call_static_method(
        class,
        "open",
        "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
        &[JValue::Object(&context), JValue::Object(&payload_obj)],
    );
    let value = match value {
        Ok(value) => value,
        Err(_) => {
            let _ = env.exception_clear();
            return Err("FILE_OPEN: Android 文件打开失败。".into());
        }
    };
    let value = JString::from(value.l().map_err(|_| "FILE_OPEN: Android 文件结果无效。")?);
    let json: String = env
        .get_string(&value)
        .map_err(|_| "FILE_OPEN: Android 文件结果无效。")?
        .into();
    let data: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| "FILE_OPEN: Android 文件结果无效。")?;
    let fd = data["fd"]
        .as_i64()
        .filter(|fd| *fd >= 0 && *fd <= i32::MAX as i64)
        .ok_or_else(|| {
            format!(
                "FILE_OPEN: {}",
                data["error"].as_str().unwrap_or("无法打开文件。")
            )
        })?;
    // File owns the detached descriptor, including on every subsequent error.
    let file = unsafe { File::from_raw_fd(fd as i32) };
    Ok(NativeFile {
        file,
        name: data["name"]
            .as_str()
            .unwrap_or("selected-file.bin")
            .to_owned(),
        mime_type: data["mime"]
            .as_str()
            .unwrap_or("application/octet-stream")
            .to_owned(),
        size: data["size"].as_u64().unwrap_or(0),
    })
}

pub fn open_native(path: &str, write: bool) -> Result<NativeFile, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        return android_file(path, write);
    }
    let path = Path::new(path);
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("FILE_OPEN: 不能打开文件链接。".into());
            }
        }
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("FILE_OPEN: 请选择普通文件。".into());
        }
    }
    let file = if write {
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)
    } else {
        File::open(path)
    }
    .map_err(|_| "FILE_OPEN: 无法打开所选文件。")?;
    let size = file
        .metadata()
        .map_err(|_| "FILE_OPEN: 无法读取文件信息。")?
        .len();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("selected-file.bin")
        .to_owned();
    let mime_type = crate::modules::resource_mime(&name.to_ascii_lowercase())
        .unwrap_or("application/octet-stream")
        .to_owned();
    Ok(NativeFile {
        file,
        name,
        mime_type,
        size,
    })
}

pub fn read_package_file(path: &str) -> Result<Vec<u8>, String> {
    let mut native = open_native(path, false)?;
    if native.size > crate::modules::MAX_PACKAGE_BYTES as u64 {
        return Err("工具包不能超过 128 MiB。".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut native.file)
        .take(crate::modules::MAX_PACKAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取工具包。")?;
    if bytes.len() > crate::modules::MAX_PACKAGE_BYTES {
        return Err("工具包不能超过 128 MiB。".into());
    }
    Ok(bytes)
}

/// Desktop exports replace atomically; Android provider commits use bounded IO.
pub fn write_selected(path: &str, bytes: &[u8]) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut native = open_native(path, true)?;
        native
            .file
            .write_all(bytes)
            .map_err(|_| "FILE_WRITE: 文件写入失败。")?;
        return native
            .file
            .flush()
            .map_err(|_| "FILE_WRITE: 文件写入失败。".into());
    }
    let destination = Path::new(path);
    reject_link(destination)?;
    let temporary = destination.with_extension(format!("firefly-{}.tmp", token()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "FILE_WRITE: 无法创建输出文件。")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "FILE_WRITE: 文件写入失败。")?;
        drop(file);
        std::fs::rename(&temporary, destination)
            .map_err(|_| "FILE_WRITE: 无法替换输出文件。".into())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

fn reject_link(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("FILE_WRITE: 输出位置不能是链接。".into());
            }
        }
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("FILE_WRITE: 输出位置不是普通文件。".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn web_file_begin_run(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    input_limit: u64,
    output_limit: u64,
) -> Result<(), String> {
    scope(&window)?;
    if run.len() != 36 || !run.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("FILE_SCOPE: 文件会话 ID 无效。".into());
    }
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    if sessions.runs.len() >= 4 || sessions.runs.contains_key(&run) {
        return Err("FILE_BUSY: 文件会话过多。".into());
    }
    sessions.runs.insert(
        run,
        Run {
            cancelled: Arc::new(AtomicBool::new(false)),
            input_limit: input_limit.min(crate::modules::MAX_FILE_BYTES),
            output_limit: output_limit.min(crate::modules::MAX_FILE_BYTES),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn web_file_open(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    path: String,
) -> Result<FileInfo, String> {
    scope(&window)?;
    let (limit, cancelled) = {
        let sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
        let r = active(&sessions, &run)?;
        (r.input_limit, r.cancelled.clone())
    };
    let mut native = tauri::async_runtime::spawn_blocking(move || open_native(&path, false))
        .await
        .map_err(|_| "FILE_OPEN: 文件线程失败。")??;
    if cancelled.load(Ordering::Relaxed) {
        return Err("FILE_CANCELED: 文件会话已关闭。".into());
    }
    if native.size > limit {
        return Err("FILE_INPUT_LIMIT: 所选文件超过工具读取上限。".into());
    }
    let seekable = native.file.stream_position().is_ok();
    let id = token();
    let info = FileInfo {
        id: id.clone(),
        name: native.name,
        mime_type: native.mime_type,
        size: native.size,
        seekable,
    };
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    active(&sessions, &run)?;
    ensure_handle_capacity(&sessions)?;
    sessions.files.insert(
        id,
        OpenFile {
            run,
            file: Some(native.file),
            temporary: None,
            position: 0,
            size: native.size,
            limit,
            writable: false,
            seekable,
            mime_type: info.mime_type.clone(),
        },
    );
    Ok(info)
}

fn read_chunk(
    sessions: &mut Sessions,
    run: &str,
    id: &str,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    active(sessions, run)?;
    if length == 0 || length > CHUNK_BYTES {
        return Err("FILE_CHUNK_LIMIT: 每次读取最多 1 MiB。".into());
    }
    let entry = sessions
        .files
        .get_mut(id)
        .filter(|entry| entry.run == run && !entry.writable)
        .ok_or("FILE_SCOPE: 文件句柄无效。")?;
    if offset > entry.limit {
        return Err("FILE_INPUT_LIMIT: 读取位置超限。".into());
    }
    let file = entry.file.as_mut().ok_or("FILE_CANCELED: 文件已关闭。")?;
    if offset != entry.position {
        if !entry.seekable {
            return Err("FILE_SEEK_UNSUPPORTED: 此文件仅支持顺序读取。".into());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| "FILE_READ: 文件定位失败。")?;
    }
    let remaining = entry.limit.saturating_sub(offset);
    if remaining == 0 {
        let mut byte = [0];
        if file
            .read(&mut byte)
            .map_err(|_| "FILE_READ: 文件读取失败。")?
            != 0
        {
            return Err("FILE_INPUT_LIMIT: 文件实际大小超过读取上限。".into());
        }
        return Ok(vec![]);
    }
    let mut bytes = vec![0; length.min(remaining as usize)];
    let mut used = 0;
    while used < bytes.len() {
        let read = file
            .read(&mut bytes[used..])
            .map_err(|_| "FILE_READ: 文件读取失败。")?;
        if read == 0 {
            break;
        }
        used += read;
    }
    bytes.truncate(used);
    entry.position = offset + used as u64;
    Ok(bytes)
}

#[tauri::command]
pub async fn web_file_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    id: String,
    offset: u64,
    length: usize,
) -> Result<Response, String> {
    scope(&window)?;
    let (entry, cancelled, local_cancel) = {
        let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
        let cancelled = active(&sessions, &run)?.cancelled.clone();
        if !sessions
            .files
            .get(&id)
            .is_some_and(|entry| entry.run == run && !entry.writable)
        {
            return Err("FILE_SCOPE: 文件无效或正在读取。".into());
        }
        let entry = sessions
            .files
            .remove(&id)
            .ok_or("FILE_SCOPE: 文件不存在。")?;
        let local_cancel = Arc::new(AtomicBool::new(false));
        sessions.busy.insert(
            id.clone(),
            BusyFile {
                run: run.clone(),
                cancelled: local_cancel.clone(),
                preview: if entry.seekable {
                    entry.file.as_ref().and_then(|file| file.try_clone().ok())
                } else {
                    None
                },
                size: entry.size,
                mime_type: entry.mime_type.clone(),
            },
        );
        (entry, cancelled, local_cancel)
    };
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Native reads run off the UI thread and never hold the session registry.
        let mut isolated = Sessions::default();
        isolated.runs.insert(
            run.clone(),
            Run {
                cancelled: cancelled.clone(),
                input_limit: entry.limit,
                output_limit: 0,
            },
        );
        isolated.files.insert(id.clone(), entry);
        let result = read_chunk(&mut isolated, &run, &id, offset, length);
        let mut sessions = shared.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
        sessions.busy.remove(&id);
        if cancelled.load(Ordering::Relaxed) || local_cancel.load(Ordering::Relaxed) {
            return Err("FILE_CANCELED: 文件读取已取消。".into());
        }
        if let Some(entry) = isolated.files.remove(&id) {
            sessions.files.insert(id, entry);
        }
        result.map(Response::new)
    })
    .await
    .map_err(|_| "FILE_READ: 文件读取线程失败。")?
}

#[tauri::command]
pub fn web_file_create_writer(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, FileSessions>,
    run: String,
) -> Result<String, String> {
    scope(&window)?;
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    let limit = active(&sessions, &run)?.output_limit;
    ensure_handle_capacity(&sessions)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| "FILE_WRITE: 缓存目录不可用。")?;
    std::fs::create_dir_all(&cache).map_err(|_| "FILE_WRITE: 无法创建缓存目录。")?;
    let directory = cache.join("runtime-temp");
    std::fs::create_dir_all(&directory).map_err(|_| "FILE_WRITE: 无法创建临时目录。")?;
    if !directory
        .canonicalize()
        .map_err(|_| "FILE_WRITE: 临时目录无效。")?
        .starts_with(
            cache
                .canonicalize()
                .map_err(|_| "FILE_WRITE: 缓存目录无效。")?,
        )
    {
        return Err("FILE_WRITE: 临时目录越界。".into());
    }
    let id = token();
    let temporary = directory.join(format!("stream-{id}.tmp"));
    let file = OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| "FILE_WRITE: 无法创建临时文件。")?;
    sessions.files.insert(
        id.clone(),
        OpenFile {
            run,
            file: Some(file),
            temporary: Some(temporary),
            position: 0,
            size: 0,
            limit,
            writable: true,
            seekable: true,
            mime_type: "application/octet-stream".into(),
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn web_file_preview_writer(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    id: String,
    name: String,
) -> Result<FileInfo, String> {
    scope(&window)?;
    if name.trim().is_empty() || name.chars().count() > 120 {
        return Err("FILE_NAME_INVALID: 输出文件名无效。".into());
    }
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    active(&sessions, &run)?;
    ensure_handle_capacity(&sessions)?;
    let entry = sessions
        .files
        .get_mut(&id)
        .filter(|entry| entry.run == run && entry.writable)
        .ok_or("FILE_SCOPE: 输出句柄无效。")?;
    entry
        .file
        .as_mut()
        .ok_or("FILE_CANCELED: 输出已关闭。")?
        .flush()
        .map_err(|_| "FILE_WRITE: 无法刷新输出。")?;
    let file = File::open(
        entry
            .temporary
            .as_ref()
            .ok_or("FILE_SCOPE: 输出不是临时文件。")?,
    )
    .map_err(|_| "FILE_READ: 无法预览输出。")?;
    let size = entry.size;
    let preview_id = token();
    let mime_type = crate::modules::resource_mime(&name.to_ascii_lowercase())
        .unwrap_or("application/octet-stream")
        .to_owned();
    sessions.files.insert(
        preview_id.clone(),
        OpenFile {
            run,
            file: Some(file),
            temporary: None,
            position: 0,
            size,
            limit: size,
            writable: false,
            seekable: true,
            mime_type: mime_type.clone(),
        },
    );
    Ok(FileInfo {
        id: preview_id,
        name,
        mime_type,
        size,
        seekable: true,
    })
}

fn write_chunk(sessions: &mut Sessions, run: &str, id: &str, bytes: &[u8]) -> Result<u64, String> {
    active(sessions, run)?;
    if bytes.len() > CHUNK_BYTES {
        return Err("FILE_CHUNK_LIMIT: 每次写入最多 1 MiB。".into());
    }
    let entry = sessions
        .files
        .get_mut(id)
        .filter(|entry| entry.run == run && entry.writable)
        .ok_or("FILE_SCOPE: 输出句柄无效。")?;
    if entry.size.saturating_add(bytes.len() as u64) > entry.limit {
        return Err("FILE_OUTPUT_LIMIT: 输出文件超过工具保存上限。".into());
    }
    entry
        .file
        .as_mut()
        .ok_or("FILE_CANCELED: 输出已关闭。")?
        .write_all(bytes)
        .map_err(|_| "FILE_WRITE: 临时文件写入失败。")?;
    entry.size += bytes.len() as u64;
    Ok(entry.size)
}

#[tauri::command]
pub fn web_file_transport(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    transport: tauri::State<'_, crate::file_transport::FileTransport>,
) -> Result<Option<String>, String> {
    scope(&window)?;
    if cfg!(target_os = "android") {
        transport.start(state.inner().clone()).map(Some)
    } else {
        Ok(None)
    }
}

fn file_chunk_body(body: &InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    let invalid = || "FILE_DATA_INVALID: 文件块数据无效。".to_owned();
    let bytes = match body {
        InvokeBody::Raw(bytes) => Cow::Borrowed(bytes.as_slice()),
        InvokeBody::Json(serde_json::Value::Array(values)) => {
            if values.len() > CHUNK_BYTES {
                return Err("FILE_CHUNK_LIMIT: 每次写入最多 1 MiB。".into());
            }
            Cow::Owned(
                values
                    .iter()
                    .map(|value| {
                        value
                            .as_u64()
                            .and_then(|value| u8::try_from(value).ok())
                            .ok_or_else(invalid)
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        InvokeBody::Json(value) if value["encoding"] == "base64" => {
            let value = value["data"].as_str().ok_or_else(invalid)?;
            if value.len() > CHUNK_BYTES.div_ceil(3) * 4 {
                return Err("FILE_CHUNK_LIMIT: 每次写入最多 1 MiB。".into());
            }
            Cow::Owned(STANDARD.decode(value).map_err(|_| invalid())?)
        }
        _ => return Err(invalid()),
    };
    if bytes.len() > CHUNK_BYTES {
        return Err("FILE_CHUNK_LIMIT: 每次写入最多 1 MiB。".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn web_file_write(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    request: Request<'_>,
) -> Result<u64, String> {
    scope(&window)?;
    let run = request
        .headers()
        .get("x-firefly-run")
        .and_then(|v| v.to_str().ok())
        .ok_or("FILE_SCOPE: 缺少文件会话。")?;
    let id = request
        .headers()
        .get("x-firefly-file")
        .and_then(|v| v.to_str().ok())
        .ok_or("FILE_SCOPE: 缺少输出句柄。")?;
    let bytes = file_chunk_body(request.body())?;
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    write_chunk(&mut sessions, run, id, &bytes)
}

#[tauri::command]
pub async fn web_file_save_writer(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    id: String,
    path: String,
) -> Result<(), String> {
    scope(&window)?;
    let (mut entry, cancelled, local_cancel) = {
        let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
        let cancelled = active(&sessions, &run)?.cancelled.clone();
        if !sessions
            .files
            .get(&id)
            .is_some_and(|entry| entry.run == run && entry.writable)
        {
            return Err("FILE_SCOPE: 输出句柄无效。".into());
        }
        let local_cancel = Arc::new(AtomicBool::new(false));
        sessions.busy.insert(
            id.clone(),
            BusyFile {
                run: run.clone(),
                cancelled: local_cancel.clone(),
                preview: None,
                size: 0,
                mime_type: String::new(),
            },
        );
        (
            sessions
                .files
                .remove(&id)
                .ok_or("FILE_SCOPE: 输出不存在。")?,
            cancelled,
            local_cancel,
        )
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let input = entry.file.as_mut().ok_or("FILE_CANCELED: 输出已关闭。")?;
        input
            .flush()
            .and_then(|_| input.seek(SeekFrom::Start(0)).map(|_| ()))
            .map_err(|_| "FILE_WRITE: 临时输出读取失败。")?;
        if cancelled.load(Ordering::Relaxed) || local_cancel.load(Ordering::Relaxed) {
            return Err("FILE_CANCELED: 保存已取消。".into());
        }
        let uri = path.starts_with("content://");
        let temporary = if uri {
            None
        } else {
            reject_link(Path::new(&path))?;
            Some(Path::new(&path).with_extension(format!("firefly-{}.tmp", token())))
        };
        let output_path = temporary.as_ref().and_then(|p| p.to_str()).unwrap_or(&path);
        let result = (|| {
            let mut output = open_native(output_path, true)?.file;
            let mut buffer = vec![0u8; CHUNK_BYTES];
            loop {
                if cancelled.load(Ordering::Relaxed) || local_cancel.load(Ordering::Relaxed) {
                    return Err("FILE_CANCELED: 保存已取消。".into());
                }
                let count = input
                    .read(&mut buffer)
                    .map_err(|_| "FILE_READ: 临时输出读取失败。")?;
                if count == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..count])
                    .map_err(|_| "FILE_WRITE: 输出保存失败。")?;
            }
            output.flush().map_err(|_| "FILE_WRITE: 输出保存失败。")?;
            drop(output);
            if let Some(temporary) = &temporary {
                std::fs::rename(temporary, &path).map_err(|_| "FILE_WRITE: 无法替换输出文件。")?;
            }
            Ok(())
        })();
        if result.is_err() {
            if let Some(path) = &temporary {
                let _ = std::fs::remove_file(path);
            }
        }
        result
    })
    .await
    .map_err(|_| "FILE_WRITE: 保存线程失败。")?;
    if let Ok(mut sessions) = state.0.lock() {
        sessions.busy.remove(&id);
    }
    result
}

#[tauri::command]
pub fn web_file_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
    id: String,
) -> Result<(), String> {
    scope(&window)?;
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    if sessions
        .files
        .get(&id)
        .is_some_and(|entry| entry.run == run)
    {
        sessions.files.remove(&id);
    }
    if let Some(job) = sessions.busy.get(&id) {
        if job.run == run {
            job.cancelled.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn web_file_close_run(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FileSessions>,
    run: String,
) -> Result<(), String> {
    scope(&window)?;
    let mut sessions = state.0.lock().map_err(|_| "FILE_BUSY: 文件状态不可用。")?;
    if let Some(run) = sessions.runs.remove(&run) {
        run.cancelled.store(true, Ordering::Relaxed);
    }
    sessions.files.retain(|_, entry| entry.run != run);
    Ok(())
}

fn read_positioned(file: &File, offset: u64, length: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = vec![0; length];
    let mut used = 0;
    while used < length {
        #[cfg(windows)]
        let count = {
            use std::os::windows::fs::FileExt;
            file.seek_read(&mut bytes[used..], offset + used as u64)?
        };
        #[cfg(not(windows))]
        let count = {
            use std::os::unix::fs::FileExt;
            file.read_at(&mut bytes[used..], offset + used as u64)?
        };
        if count == 0 {
            break;
        }
        used += count;
    }
    bytes.truncate(used);
    Ok(bytes)
}

/// Random I/O for Emscripten Workers, confined to this run's temporary writer.
/// Selected user files cannot be modified through this protocol.
pub fn workspace_response(
    state: &FileSessions,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<_, &'static str> {
        if !matches!(request.method().as_str(), "GET" | "POST" | "OPTIONS") {
            return Err("405");
        }
        let decoded = request.uri().path().replace("%2F", "/").replace("%2f", "/");
        let parts: Vec<_> = decoded.trim_start_matches('/').split('/').collect();
        if parts.len() != 2 {
            return Err("404");
        }
        let mut sessions = state.0.lock().map_err(|_| "503")?;
        active(&sessions, parts[0]).map_err(|_| "410")?;
        let entry = sessions
            .files
            .get_mut(parts[1])
            .filter(|f| f.run == parts[0] && f.writable && f.temporary.is_some())
            .ok_or("404")?;
        let mut body = vec![];
        let mut status = 200;
        let mut content_range = None;
        if request.method() == "POST" {
            let query = request.uri().query().ok_or("400")?;
            let (key, value) = query.split_once('=').ok_or("400")?;
            let value = value.parse::<u64>().map_err(|_| "400")?;
            let file = entry.file.as_mut().ok_or("410")?;
            if key == "size" && request.body().is_empty() {
                if value > entry.limit {
                    return Err("413");
                }
                file.set_len(value).map_err(|_| "507")?;
                entry.size = value;
                entry.position = value;
            } else if key == "offset" {
                if request.body().len() > CHUNK_BYTES {
                    return Err("413");
                }
                let end = value
                    .checked_add(request.body().len() as u64)
                    .filter(|end| *end <= entry.limit)
                    .ok_or("413")?;
                file.seek(SeekFrom::Start(value)).map_err(|_| "500")?;
                file.write_all(request.body()).map_err(|_| "507")?;
                entry.size = entry.size.max(end);
                entry.position = end;
            } else {
                return Err("400");
            }
        } else if request.method() == "GET" {
            let value = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("bytes="))
                .ok_or("416")?;
            let (start, end) = value.split_once('-').ok_or("416")?;
            let start = start.parse::<u64>().map_err(|_| "416")?;
            let end = end
                .parse::<u64>()
                .map_err(|_| "416")?
                .min(entry.size.saturating_sub(1));
            if start >= entry.size || end < start || end - start >= CHUNK_BYTES as u64 {
                return Err("416");
            }
            body = read_positioned(
                entry.file.as_ref().ok_or("410")?,
                start,
                (end - start + 1) as usize,
            )
            .map_err(|_| "500")?;
            status = 206;
            content_range = Some(format!("bytes {start}-{end}/{}", entry.size));
        }
        let mut builder = tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", "application/octet-stream")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type, Range")
            .header("Access-Control-Expose-Headers", "Content-Range")
            .header("Cache-Control", "no-store");
        if let Some(value) = content_range {
            builder = builder.header("Content-Range", value);
        }
        builder.body(body).map_err(|_| "500")
    })();
    result.unwrap_or_else(|code| {
        tauri::http::Response::builder()
            .status(code.parse::<u16>().unwrap_or(500))
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store")
            .body(vec![])
            .expect("valid response")
    })
}

/// Read-only media URL capability. Range requests never allocate the whole file.
pub fn preview_response(
    state: &FileSessions,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<_, String> {
        if !matches!(request.method().as_str(), "GET" | "HEAD") {
            return Err("405".into());
        }
        let decoded_path = request.uri().path().replace("%2F", "/").replace("%2f", "/");
        let mut parts = decoded_path.trim_start_matches('/').split('/');
        let run = parts.next().ok_or("404")?;
        let id = parts.next().ok_or("404")?;
        if parts.next().is_some() {
            return Err("404".into());
        }
        let (file, size, mime, cancelled) = {
            let sessions = state.0.lock().map_err(|_| "503")?;
            let cancelled = active(&sessions, run).map_err(|_| "410")?.cancelled.clone();
            if let Some(entry) = sessions
                .files
                .get(id)
                .filter(|f| f.run == run && !f.writable && f.seekable)
            {
                (
                    entry
                        .file
                        .as_ref()
                        .ok_or("404")?
                        .try_clone()
                        .map_err(|_| "500")?,
                    entry.size,
                    entry.mime_type.clone(),
                    cancelled,
                )
            } else if let Some(job) = sessions
                .busy
                .get(id)
                .filter(|job| job.run == run && !job.cancelled.load(Ordering::Relaxed))
            {
                (
                    job.preview
                        .as_ref()
                        .ok_or("404")?
                        .try_clone()
                        .map_err(|_| "500")?,
                    job.size,
                    job.mime_type.clone(),
                    cancelled,
                )
            } else {
                return Err("404".into());
            }
        };
        if size == 0 {
            return Err("416".into());
        }
        let range = request.headers().get("range").and_then(|v| v.to_str().ok());
        let (start, requested_end) = if let Some(value) = range {
            let value = value
                .strip_prefix("bytes=")
                .filter(|v| !v.contains(','))
                .ok_or("416")?;
            let (start, end) = value.split_once('-').ok_or("416")?;
            if start.is_empty() {
                let suffix = end.parse::<u64>().map_err(|_| "416")?;
                if suffix == 0 {
                    return Err("416".into());
                }
                (size.saturating_sub(suffix), size - 1)
            } else {
                (
                    start.parse::<u64>().map_err(|_| "416")?,
                    if end.is_empty() {
                        size - 1
                    } else {
                        end.parse::<u64>().map_err(|_| "416")?
                    },
                )
            }
        } else {
            if size > CHUNK_BYTES as u64 {
                return Err("413".into());
            }
            (0, size - 1)
        };
        if start >= size || requested_end < start {
            return Err("416".into());
        }
        let end = requested_end
            .min(size - 1)
            .min(start + CHUNK_BYTES as u64 - 1);
        let length = (end - start + 1) as usize;
        let body = if request.method() == "HEAD" {
            vec![]
        } else {
            if cancelled.load(Ordering::Relaxed) {
                return Err("410".into());
            }
            read_positioned(&file, start, length).map_err(|_| "500")?
        };
        let mut builder = tauri::http::Response::builder()
            .status(if range.is_some() { 206 } else { 200 })
            .header("Content-Type", mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Length", length)
            .header("Access-Control-Allow-Origin", "*")
            .header(
                "Access-Control-Expose-Headers",
                "Content-Range, Accept-Ranges, Content-Length",
            )
            .header("Cache-Control", "no-store");
        if range.is_some() {
            builder = builder.header("Content-Range", format!("bytes {start}-{end}/{size}"));
        }
        builder.body(body).map_err(|_| "500".into())
    })();
    result.unwrap_or_else(|code| {
        tauri::http::Response::builder()
            .status(code.parse::<u16>().unwrap_or(500))
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store")
            .body(vec![])
            .expect("valid response")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_file_operations_share_128_slots_and_released_handles_can_be_reused() {
        let (mut sessions, reader, path) = fixture(8, false);
        for index in 1..128 {
            assert!(ensure_handle_capacity(&sessions).is_ok(), "slot {index}");
            let preview = sessions.files[&reader]
                .file
                .as_ref()
                .unwrap()
                .try_clone()
                .unwrap();
            sessions.busy.insert(
                format!("busy-{index}"),
                BusyFile {
                    run: "owner".into(),
                    cancelled: Arc::new(AtomicBool::new(false)),
                    preview: Some(preview),
                    size: 8,
                    mime_type: "audio/wav".into(),
                },
            );
        }
        assert!(ensure_handle_capacity(&sessions)
            .unwrap_err()
            .starts_with("FILE_BUSY:"));
        sessions.busy.remove("busy-127");
        assert!(ensure_handle_capacity(&sessions).is_ok());
        let state = FileSessions(Arc::new(Mutex::new(sessions)));
        state.clear().unwrap();
        let cleared = state.0.lock().unwrap();
        assert!(cleared.files.is_empty() && cleared.busy.is_empty());
        assert!(ensure_handle_capacity(&cleared).is_ok());
        assert!(
            !path.exists(),
            "closing all handles removes the temporary file"
        );
    }

    #[test]
    fn file_chunks_accept_android_base64_json_and_raw_without_changing_bytes() {
        let bytes: Vec<u8> = (0..CHUNK_BYTES).map(|index| (index % 256) as u8).collect();
        let bodies = [
            InvokeBody::Raw(bytes.clone()),
            InvokeBody::Json(serde_json::json!(bytes)),
            InvokeBody::Json(
                serde_json::json!({"encoding":"base64", "data":STANDARD.encode(&bytes)}),
            ),
        ];
        for body in bodies {
            assert_eq!(&*file_chunk_body(&body).unwrap(), bytes.as_slice());
        }
        for value in [
            serde_json::json!([-1]),
            serde_json::json!([256]),
            serde_json::json!([1.5]),
            serde_json::json!([true]),
            serde_json::json!({"encoding":"base64","data":"invalid!"}),
            serde_json::json!(null),
        ] {
            assert!(file_chunk_body(&InvokeBody::Json(value))
                .unwrap_err()
                .starts_with("FILE_DATA_INVALID:"));
        }
        let oversized = vec![0u8; CHUNK_BYTES + 1];
        for body in [
            InvokeBody::Raw(oversized.clone()),
            InvokeBody::Json(serde_json::json!(oversized)),
            InvokeBody::Json(
                serde_json::json!({"encoding":"base64", "data":STANDARD.encode(&oversized)}),
            ),
        ] {
            assert!(file_chunk_body(&body)
                .unwrap_err()
                .starts_with("FILE_CHUNK_LIMIT:"));
        }
    }

    #[tokio::test]
    async fn loopback_transport_preserves_nonzero_ranges_post_bytes_and_revocation() {
        let data: Vec<u8> = (0..3 * CHUNK_BYTES + 37)
            .map(|index| (index % 251) as u8)
            .collect();
        let (mut sessions, reader_id, _) = fixture(data.len() as u64, false);
        let reader = sessions.files.get_mut(&reader_id).unwrap();
        reader.file.as_mut().unwrap().write_all(&data).unwrap();
        reader.size = data.len() as u64;
        let (mut output, writer_id, _) = fixture(2 * CHUNK_BYTES as u64, true);
        sessions
            .files
            .insert(writer_id.clone(), output.files.remove(&writer_id).unwrap());
        let files = FileSessions(Arc::new(Mutex::new(sessions)));
        let transport = crate::file_transport::FileTransport::default();
        let base = transport.start(files.clone()).unwrap();
        assert_eq!(base, transport.start(files.clone()).unwrap());
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let input = format!("{base}/ff-file/owner/{reader_id}");
        let writer = format!("{base}/ff-work/owner/{writer_id}");
        for start in [0, CHUNK_BYTES - 7, CHUNK_BYTES + 103, 2 * CHUNK_BYTES + 11] {
            let end = start + 25;
            let response = client
                .get(&input)
                .header("Range", format!("bytes={start}-{end}"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 206);
            assert_eq!(response.bytes().await.unwrap().as_ref(), &data[start..=end]);
        }
        let preflight = client
            .request(reqwest::Method::OPTIONS, &writer)
            .header("Origin", "null")
            .header("Access-Control-Request-Method", "POST")
            .send()
            .await
            .unwrap();
        assert_eq!(preflight.status(), 204);
        assert_eq!(preflight.headers()["access-control-allow-origin"], "*");
        assert_eq!(
            preflight.headers()["access-control-allow-private-network"],
            "true"
        );
        let payload = &data[..CHUNK_BYTES + 17];
        for (offset, chunk) in payload.chunks(CHUNK_BYTES).enumerate() {
            assert_eq!(
                client
                    .post(format!("{writer}?offset={}", offset * CHUNK_BYTES))
                    .body(chunk.to_vec())
                    .send()
                    .await
                    .unwrap()
                    .status(),
                200
            );
        }
        let tail = client
            .get(&writer)
            .header(
                "Range",
                format!("bytes={}-{}", CHUNK_BYTES, CHUNK_BYTES + 16),
            )
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(tail.as_ref(), &payload[CHUNK_BYTES..]);
        assert_eq!(
            client
                .post(format!("{writer}?offset={}", 2 * CHUNK_BYTES))
                .body(vec![1])
                .send()
                .await
                .unwrap()
                .status(),
            413
        );
        assert_eq!(
            client
                .post(format!("{base}/ff-work/owner/{reader_id}?offset=0"))
                .body(vec![1])
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert_eq!(
            client
                .get(&input)
                .header("Host", "evil.invalid")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let wrong = input.replace(&base, &format!("{base}0"));
        assert_eq!(client.get(wrong).send().await.unwrap().status(), 404);
        assert_eq!(
            client
                .post(format!("{writer}?size=5"))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let bytes = client
            .get(&writer)
            .header("Range", "bytes=0-4")
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), &payload[..5]);
        files.0.lock().unwrap().runs.remove("owner");
        assert_eq!(
            client
                .get(&input)
                .header("Range", "bytes=0-4")
                .send()
                .await
                .unwrap()
                .status(),
            410
        );
    }
    #[test]
    fn workspace_random_io_is_bounded_scoped_and_never_writes_selected_inputs() {
        let (sessions, id, _) = fixture(8, true);
        let state = FileSessions(Arc::new(Mutex::new(sessions)));
        let request = |method: &str, owner: &str, query: &str, bytes: Vec<u8>| {
            tauri::http::Request::builder()
                .method(method)
                .uri(format!("ff-work://localhost/{owner}/{id}{query}"))
                .body(bytes)
                .unwrap()
        };
        assert_eq!(
            workspace_response(
                &state,
                &request("POST", "other", "?offset=0", b"x".to_vec())
            )
            .status(),
            404
        );
        assert_eq!(
            workspace_response(
                &state,
                &request("POST", "owner", "?offset=0", b"abcd".to_vec())
            )
            .status(),
            200
        );
        assert_eq!(
            workspace_response(
                &state,
                &request("POST", "owner", "?offset=1", b"xy".to_vec())
            )
            .status(),
            200
        );
        assert_eq!(
            workspace_response(
                &state,
                &request("POST", "owner", "?offset=7", b"xy".to_vec())
            )
            .status(),
            413
        );
        let read = tauri::http::Request::builder()
            .uri(format!("ff-work://localhost/owner/{id}"))
            .header("Range", "bytes=0-3")
            .body(vec![])
            .unwrap();
        assert_eq!(workspace_response(&state, &read).body(), b"axyd");
        assert_eq!(
            workspace_response(&state, &request("POST", "owner", "?size=2", vec![])).status(),
            200
        );
        assert_eq!(workspace_response(&state, &read).body(), b"ax");
        state.0.lock().unwrap().files.get_mut(&id).unwrap().writable = false;
        assert_eq!(
            workspace_response(
                &state,
                &request("POST", "owner", "?offset=0", b"z".to_vec())
            )
            .status(),
            404
        );
        state.0.lock().unwrap().runs.remove("owner");
        assert_eq!(workspace_response(&state, &read).status(), 410);
    }
    fn fixture(limit: u64, writable: bool) -> (Sessions, String, PathBuf) {
        let path = std::env::temp_dir().join(format!("firefly-stream-test-{}.bin", token()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        if !writable {
            file.write_all(b"abcdefgh").unwrap();
            file.seek(SeekFrom::Start(0)).unwrap();
        }
        let id = token();
        let mut state = Sessions::default();
        state.runs.insert(
            "owner".into(),
            Run {
                cancelled: Arc::new(AtomicBool::new(false)),
                input_limit: limit,
                output_limit: limit,
            },
        );
        state.runs.insert(
            "other".into(),
            Run {
                cancelled: Arc::new(AtomicBool::new(false)),
                input_limit: limit,
                output_limit: limit,
            },
        );
        state.files.insert(
            id.clone(),
            OpenFile {
                run: "owner".into(),
                file: Some(file),
                temporary: Some(path.clone()),
                position: 0,
                size: if writable { 0 } else { 8 },
                limit,
                writable,
                seekable: true,
                mime_type: "audio/wav".into(),
            },
        );
        (state, id, path)
    }
    #[test]
    fn readers_enforce_run_ownership_and_chunk_size_and_support_random_access() {
        let (mut state, id, path) = fixture(8, false);
        assert!(read_chunk(&mut state, "other", &id, 0, 1)
            .unwrap_err()
            .contains("SCOPE"));
        assert!(read_chunk(&mut state, "owner", &id, 0, CHUNK_BYTES + 1)
            .unwrap_err()
            .contains("CHUNK"));
        assert_eq!(read_chunk(&mut state, "owner", &id, 5, 3).unwrap(), b"fgh");
        assert_eq!(read_chunk(&mut state, "owner", &id, 1, 2).unwrap(), b"bc");
        state.runs["owner"].cancelled.store(true, Ordering::Relaxed);
        assert!(read_chunk(&mut state, "owner", &id, 0, 1)
            .unwrap_err()
            .contains("CANCELED"));
        drop(state);
        assert!(!path.exists());
    }
    #[test]
    fn writer_quota_rejects_excess_without_appending_and_drop_removes_temp_file() {
        let (mut state, id, path) = fixture(4, true);
        assert_eq!(write_chunk(&mut state, "owner", &id, b"abc").unwrap(), 3);
        assert!(write_chunk(&mut state, "owner", &id, b"de")
            .unwrap_err()
            .contains("OUTPUT_LIMIT"));
        assert_eq!(state.files[&id].size, 3);
        assert_eq!(write_chunk(&mut state, "owner", &id, b"d").unwrap(), 4);
        assert!(write_chunk(&mut state, "other", &id, b"x")
            .unwrap_err()
            .contains("SCOPE"));
        drop(state);
        assert!(!path.exists());
    }

    #[test]
    fn cache_cleanup_revokes_runs_and_closes_all_file_handles_before_removing_writers() {
        let (sessions, id, path) = fixture(8, true);
        let cancelled = sessions.runs["owner"].cancelled.clone();
        let state = FileSessions(Arc::new(Mutex::new(sessions)));
        state.clear().unwrap();
        assert!(cancelled.load(Ordering::Relaxed));
        assert!(!path.exists());
        let sessions = state.0.lock().unwrap();
        assert!(sessions.runs.is_empty());
        assert!(!sessions.files.contains_key(&id));
    }
    #[test]
    fn media_range_responses_are_exact_and_revoked_with_the_run() {
        let (state, id, _) = fixture(8, false);
        let state = FileSessions(Arc::new(Mutex::new(state)));
        let request = tauri::http::Request::builder()
            .uri(format!("ff-file://localhost/owner/{id}"))
            .header("Range", "bytes=2-4")
            .body(vec![])
            .unwrap();
        let response = preview_response(&state, &request);
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], "bytes 2-4/8");
        assert_eq!(response.body(), b"cde");
        let request = tauri::http::Request::builder()
            .uri(format!("ff-file://localhost/other/{id}"))
            .header("Range", "bytes=0-")
            .body(vec![])
            .unwrap();
        assert_eq!(preview_response(&state, &request).status(), 404);
        state.0.lock().unwrap().runs.remove("owner");
        let request = tauri::http::Request::builder()
            .uri(format!("ff-file://localhost/owner/{id}"))
            .body(vec![])
            .unwrap();
        assert_eq!(preview_response(&state, &request).status(), 410);
    }
}
