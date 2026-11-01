use serde::Serialize;
use std::path::Path;

#[derive(Default, Serialize)]
pub struct CacheReport {
    pub disk_cache_cleared: bool,
    pub temporary_files: usize,
    pub temporary_bytes: u64,
    pub skipped_files: usize,
    pub memory_bytes: u64,
    pub warnings: Vec<String>,
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// Only the named runtime-temp directory is disposable. The adjacent browser
/// profile, SQLite database, settings and shortcut icons are never traversed.
pub fn clear_runtime_temp(cache_dir: &Path) -> Result<CacheReport, String> {
    let root = cache_dir.join("runtime-temp");
    let mut report = CacheReport::default();
    if !root.exists() {
        return Ok(report);
    }
    if is_link(&std::fs::symlink_metadata(&root).map_err(|_| "无法检查临时目录。")?) {
        return Err("临时目录包含链接，未清理。".into());
    }
    let cache_root = cache_dir
        .canonicalize()
        .map_err(|_| "无法定位应用缓存目录。")?;
    let target = root.canonicalize().map_err(|_| "无法定位临时目录。")?;
    if !target.starts_with(&cache_root) || target == cache_root {
        return Err("临时目录不在指定缓存目录内，未清理。".into());
    }
    clear_directory(&target, &target, &mut report)?;
    Ok(report)
}

fn clear_directory(
    directory: &Path,
    allowed: &Path,
    report: &mut CacheReport,
) -> Result<(), String> {
    let entries = std::fs::read_dir(directory).map_err(|_| "无法读取临时目录。")?;
    for entry in entries {
        let Ok(entry) = entry else {
            report.skipped_files += 1;
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            report.skipped_files += 1;
            continue;
        };
        if is_link(&metadata) {
            report.skipped_files += 1;
            continue;
        }
        let Ok(resolved) = path.canonicalize() else {
            report.skipped_files += 1;
            continue;
        };
        if !resolved.starts_with(allowed) || resolved == allowed {
            report.skipped_files += 1;
            continue;
        }
        if metadata.is_dir() {
            if clear_directory(&resolved, allowed, report).is_err()
                || std::fs::remove_dir(&resolved).is_err()
            {
                report.skipped_files += 1;
            }
        } else if metadata.is_file() {
            if std::fs::remove_file(&resolved).is_ok() {
                report.temporary_files += 1;
                report.temporary_bytes += metadata.len();
            } else {
                report.skipped_files += 1;
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub async fn clear_disk_cache(window: tauri::WebviewWindow) -> Result<bool, String> {
    use webview2_com::{
        ClearBrowsingDataCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        },
    };
    use windows_core::Interface;
    let (sender, receiver) = std::sync::mpsc::channel();
    window
        .with_webview(move |view| {
            let failure_sender = sender.clone();
            let result = unsafe {
                (|| {
                    let profile = view
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_13>()?
                        .Profile()?
                        .cast::<ICoreWebView2Profile2>()?;
                    profile.ClearBrowsingData(
                        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                        &ClearBrowsingDataCompletedHandler::create(Box::new(move |status| {
                            let result = status
                                .map(|_| true)
                                .map_err(|error| format!("浏览器磁盘缓存清理失败：{error}"));
                            let _ = sender.send(result);
                            Ok(())
                        })),
                    )
                })()
            };
            if let Err(error) = result {
                let _ = failure_sender.send(Err(format!("浏览器缓存接口不可用：{error}")));
            }
        })
        .map_err(|_| "无法连接浏览器缓存接口。")?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(20))
    })
    .await
    .map_err(|_| "缓存清理任务异常。")?
    .map_err(|_| "浏览器缓存清理超时，请稍后重试。")?
}

#[cfg(target_os = "android")]
pub async fn clear_disk_cache(_window: tauri::WebviewWindow) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use jni::{
            objects::{JClass, JObject, JString, JValue},
            JavaVM,
        };
        let context = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "Android 缓存服务不可用。")?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| "无法连接 Android 缓存服务。")?;
        let app_context = unsafe { JObject::from_raw(context.context().cast()) };
        let loader = env
            .call_method(
                &app_context,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|_| "缓存服务类加载器不可用。")?;
        let name = JObject::from(
            env.new_string("firefly.toolbox.CacheBridge")
                .map_err(|_| "无法编码缓存服务类名。")?,
        );
        let class = JClass::from(
            env.call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )
            .and_then(|value| value.l())
            .map_err(|_| "缓存服务不可用，请安装新版应用。")?,
        );
        let response = env
            .call_static_method(class, "clear", "()Ljava/lang/String;", &[])
            .and_then(|value| value.l())
            .map_err(|_| "无法清理 Android 缓存。")?;
        let response: String = env
            .get_string(&JString::from(response))
            .map_err(|_| "缓存服务返回值无效。")?
            .into();
        if response == "ok" {
            Ok(true)
        } else {
            Err(response)
        }
    })
    .await
    .map_err(|_| "Android 缓存任务异常。")?
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub async fn clear_disk_cache(_window: tauri::WebviewWindow) -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleaning_only_removes_named_runtime_files() {
        let root = std::env::temp_dir().join(format!(
            "firefly-cache-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("runtime-temp/nested")).unwrap();
        std::fs::create_dir_all(root.join("WebView2/Local Storage")).unwrap();
        std::fs::write(root.join("runtime-temp/nested/work.tmp"), b"temporary").unwrap();
        let protected = root.join("WebView2/Local Storage/user.data");
        std::fs::write(&protected, b"persistent notes").unwrap();
        let report = clear_runtime_temp(&root).unwrap();
        assert_eq!(report.temporary_files, 1);
        assert_eq!(std::fs::read(&protected).unwrap(), b"persistent notes");
        assert_eq!(clear_runtime_temp(&root).unwrap().temporary_files, 0);
        // Resolved test root is the exact, unique directory created above.
        let target = root.canonicalize().unwrap();
        assert!(target.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(target).unwrap();
    }
}
