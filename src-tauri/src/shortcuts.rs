use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::io::Read;
#[cfg(target_os = "windows")]
use tauri::Manager;

pub const MAX_ICON_SOURCE_BYTES: usize = 1024 * 1024;

// A timed-out Binder call can still be running. Keep its single-flight lease
// until the worker actually returns, rather than spawning more blocked workers.
#[cfg(any(target_os = "android", test))]
#[derive(Default)]
pub struct ShortcutRequestGate {
    busy: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(any(target_os = "android", test))]
impl ShortcutRequestGate {
    pub async fn run<F>(&self, timeout: std::time::Duration, request: F) -> Result<String, String>
    where
        F: FnOnce() -> Result<String, String> + Send + 'static,
    {
        use std::sync::{atomic::Ordering, Arc};
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("桌面服务仍在处理上一次请求，请先返回桌面查看，稍后重试。".into());
        }
        struct Lease(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Lease {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let lease = Lease(self.busy.clone());
        let task = tauri::async_runtime::spawn_blocking(move || {
            let _lease = lease;
            request()
        });
        tokio::time::timeout(timeout, task)
            .await
            .map_err(|_| {
                "桌面快捷方式服务响应超时，请先返回桌面查看是否已创建；若未创建，请稍后重试。"
                    .to_owned()
            })?
            .map_err(|_| "快捷方式创建任务异常，请稍后重试。".to_owned())?
    }
}

pub fn validate_name(value: &str, windows: bool) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err("快捷方式名称须为 1 到 40 个字符，且不能包含控制字符。".into());
    }
    if windows {
        if name.ends_with('.') || name.chars().any(|ch| "\\/:*?\"<>|".contains(ch)) {
            return Err("Windows 快捷方式名称不能以句点结尾或包含 \\ / : * ? \" < > |。".into());
        }
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end()
            .to_uppercase();
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|suffix| {
                    matches!(
                        suffix,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            })
        {
            return Err("该名称是 Windows 保留名称，请换个名字。".into());
        }
    }
    Ok(name.to_owned())
}

pub fn icon_bytes(icon_data: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    let Some(value) = icon_data.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if !crate::modules::valid_png_icon_data(value, 256) {
        return Err("快捷方式图标须为完整 PNG，最大 256 × 256 像素、24 KiB。".into());
    }
    BASE64
        .decode(&value["data:image/png;base64,".len()..])
        .map(Some)
        .map_err(|_| "快捷方式图片格式无效。".into())
}

fn read_icon_file(path: &str) -> Result<Vec<u8>, String> {
    let mut native = crate::file_sessions::open_native(path, false)?;
    if native.size > MAX_ICON_SOURCE_BYTES as u64 {
        return Err("图片文件不能超过 1 MiB。".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut native.file)
        .take(MAX_ICON_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取快捷方式图片。")?;
    if bytes.len() > MAX_ICON_SOURCE_BYTES {
        return Err("图片文件不能超过 1 MiB。".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_shortcut_icon_file(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err("只能从主界面选择快捷方式图片。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        read_icon_file(&path).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "图片读取任务异常。")?
}

#[cfg(target_os = "windows")]
fn ico_bytes(png: &[u8]) -> Vec<u8> {
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    let mut ico = vec![
        0,
        0,
        1,
        0,
        1,
        0,
        width as u8,
        height as u8,
        0,
        0,
        1,
        0,
        32,
        0,
    ];
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22_u32.to_le_bytes());
    ico.extend_from_slice(png);
    ico
}

#[cfg(target_os = "windows")]
fn notify_windows_shortcut_created(path: &std::path::Path) {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event: i32, flags: u32, item1: *const c_void, item2: *const c_void);
    }
    const SHCNE_CREATE: i32 = 0x0000_0002;
    const SHCNE_UPDATEDIR: i32 = 0x0000_1000;
    const SHCNF_PATHW: u32 = 0x0005;
    const SHCNF_FLUSHNOWAIT: u32 = 0x3000;

    let notify = |event, path: &std::path::Path| {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // The UTF-16 buffer remains alive throughout the call. Start delivery
        // immediately, without waiting on a potentially busy Explorer process.
        unsafe {
            SHChangeNotify(
                event,
                SHCNF_PATHW | SHCNF_FLUSHNOWAIT,
                wide.as_ptr().cast(),
                std::ptr::null(),
            );
        }
    };
    // The link is saved under a temporary name and then moved. Notify the final
    // path and its containing view so Explorer discovers the completed link.
    notify(SHCNE_CREATE, path);
    if let Some(directory) = path.parent() {
        notify(SHCNE_UPDATEDIR, directory);
    }
}

#[cfg(target_os = "windows")]
fn write_windows_shortcut(
    directory: &std::path::Path,
    executable: &std::path::Path,
    tool_id: &str,
    name: &str,
    icon: &std::path::Path,
) -> Result<(), String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let name = validate_name(name, true)?;
    if !directory.is_dir() {
        return Err("无法访问桌面目录。".into());
    }
    let destination = directory.join(format!("{name}.lnk"));
    let temporary = directory.join(format!(".firefly-{:032x}.lnk", rand::random::<u128>()));
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  if (Test-Path -LiteralPath $env:FIREFLY_SHORTCUT_DESTINATION) { exit 2 }
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($env:FIREFLY_SHORTCUT_TEMPORARY)
  $link.TargetPath = $env:FIREFLY_SHORTCUT_EXE
  $link.Arguments = '--firefly-open-tool=' + $env:FIREFLY_SHORTCUT_TOOL
  $link.WorkingDirectory = [IO.Path]::GetDirectoryName($env:FIREFLY_SHORTCUT_EXE)
  # IconLocation is a COM property, not a command line. Quoting the path stores
  # literal quote characters and prevents the Shell from finding the icon.
  $link.IconLocation = $env:FIREFLY_SHORTCUT_ICON + ',0'
  $link.Save()
  try { [IO.File]::Move($env:FIREFLY_SHORTCUT_TEMPORARY, $env:FIREFLY_SHORTCUT_DESTINATION) }
  catch { if (Test-Path -LiteralPath $env:FIREFLY_SHORTCUT_DESTINATION) { exit 2 }; throw }
} catch { exit 3 }
finally { if (Test-Path -LiteralPath $env:FIREFLY_SHORTCUT_TEMPORARY) { Remove-Item -LiteralPath $env:FIREFLY_SHORTCUT_TEMPORARY } }
"#;
    let result = (|| {
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("FIREFLY_SHORTCUT_DESTINATION", &destination)
            .env("FIREFLY_SHORTCUT_TEMPORARY", &temporary)
            .env("FIREFLY_SHORTCUT_EXE", executable)
            .env("FIREFLY_SHORTCUT_TOOL", tool_id)
            .env("FIREFLY_SHORTCUT_ICON", icon)
            .spawn()
            .map_err(|_| "无法启动 Windows 快捷方式服务。")?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        notify_windows_shortcut_created(&destination);
                        Ok(())
                    } else {
                        Err(if status.code() == Some(2) {
                            "桌面上已有同名快捷方式，请换个名字。"
                        } else {
                            "创建桌面快捷方式失败，请检查桌面目录权限。"
                        }
                        .into())
                    }
                }
                Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("快捷方式服务超时或异常，请稍后重试。".into());
                }
            }
        }
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}

#[cfg(target_os = "windows")]
pub fn create_windows_shortcut(
    app: &tauri::AppHandle,
    tool_id: &str,
    name: &str,
    icon: Option<&[u8]>,
) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|_| "无法找到应用程序。")?;
    let desktop = app.path().desktop_dir().map_err(|_| "无法找到桌面目录。")?;
    let icon_path = if let Some(png) = icon {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| "无法找到应用数据目录。")?
            .join("shortcut-icons");
        std::fs::create_dir_all(&directory).map_err(|_| "无法保存快捷方式图片。")?;
        let path = directory.join(format!("{:032x}.ico", rand::random::<u128>()));
        std::fs::write(&path, ico_bytes(png)).map_err(|_| "无法保存快捷方式图片。")?;
        Some(path)
    } else {
        None
    };
    let result = write_windows_shortcut(
        &desktop,
        &executable,
        tool_id,
        name,
        icon_path.as_deref().unwrap_or(&executable),
    );
    if result.is_err() {
        if let Some(path) = icon_path {
            let _ = std::fs::remove_file(path);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn timed_out_requests_remain_single_flight_until_the_worker_returns() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        };
        use std::time::Duration;
        let gate = ShortcutRequestGate::default();
        let (release, wait) = mpsc::channel();
        let completed = Arc::new(AtomicBool::new(false));
        let worker_completed = completed.clone();
        let first = gate
            .run(Duration::from_millis(20), move || {
                let _ = wait.recv_timeout(Duration::from_secs(2));
                worker_completed.store(true, Ordering::Release);
                Ok("requested".into())
            })
            .await;
        assert!(first.unwrap_err().contains("超时"));
        assert!(gate
            .run(Duration::from_secs(1), || panic!(
                "must not start another worker"
            ))
            .await
            .unwrap_err()
            .contains("上一次请求"));
        release.send(()).unwrap();
        for _ in 0..100 {
            if !gate.busy.load(Ordering::Acquire) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(completed.load(Ordering::Acquire));
        assert_eq!(
            gate.run(Duration::from_secs(1), || Ok("requested".into()))
                .await
                .unwrap(),
            "requested"
        );
    }

    #[tokio::test]
    async fn failed_and_panicked_shortcut_workers_release_the_gate() {
        let gate = ShortcutRequestGate::default();
        let limit = std::time::Duration::from_secs(1);
        assert_eq!(
            gate.run(limit, || Err("denied".into())).await.unwrap_err(),
            "denied"
        );
        assert!(gate
            .run(limit, || panic!("test worker failure"))
            .await
            .unwrap_err()
            .contains("异常"));
        assert_eq!(
            gate.run(limit, || Ok("requested".into())).await.unwrap(),
            "requested"
        );
    }

    #[test]
    fn validates_names_for_each_platform_and_rejects_windows_device_aliases() {
        for name in [
            "CON",
            "con.txt",
            "NUL",
            "COM1",
            "LPT³",
            "name.",
            "CSV / JSON",
            "a\nb",
        ] {
            assert!(validate_name(name, true).is_err(), "{name}");
        }
        assert_eq!(validate_name(" CSV / JSON ", false).unwrap(), "CSV / JSON");
        assert!(validate_name("\t\n", false).is_err());
        assert!(validate_name(&"猫".repeat(41), false).is_err());
        assert_eq!(validate_name("工具 🐱", true).unwrap(), "工具 🐱");
    }

    #[test]
    fn icon_requires_a_complete_png_and_bounded_dimensions() {
        let png = include_bytes!("../icons/32x32.png");
        let data = format!("data:image/png;base64,{}", BASE64.encode(png));
        assert_eq!(icon_bytes(Some(&data)).unwrap().unwrap(), png);
        let truncated = format!("data:image/png;base64,{}", BASE64.encode(&png[..45]));
        assert!(icon_bytes(Some(&truncated)).is_err());
        assert_eq!(icon_bytes(None).unwrap(), None);
    }

    #[test]
    fn selected_icon_files_are_bounded_before_reading() {
        let path = std::env::temp_dir().join(format!(
            "firefly-shortcut-icon-{}.png",
            rand::random::<u64>()
        ));
        std::fs::write(&path, b"icon").unwrap();
        assert_eq!(read_icon_file(path.to_str().unwrap()).unwrap(), b"icon");
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(MAX_ICON_SOURCE_BYTES as u64 + 1).unwrap();
        drop(file);
        assert!(read_icon_file(path.to_str().unwrap())
            .unwrap_err()
            .contains("1 MiB"));
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(target_os = "windows")]
    fn inspect_windows_link(link: &std::path::Path) -> serde_json::Value {
        use std::{os::windows::process::CommandExt, process::Command};

        // WScript cannot reopen some supplementary-Unicode filenames. Inspect
        // an ASCII-named copy without changing the actual shortcut's name.
        let inspection = link.parent().unwrap().join("inspect.lnk");
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  [IO.File]::Copy($env:FIREFLY_TEST_LINK, $env:FIREFLY_TEST_INSPECT)
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:FIREFLY_TEST_INSPECT)
  @{target=$link.TargetPath; args=$link.Arguments; icon=$link.IconLocation; working=$link.WorkingDirectory} | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $env:FIREFLY_TEST_INSPECT) { Remove-Item -LiteralPath $env:FIREFLY_TEST_INSPECT }
}
"#,
            ])
            .creation_flags(0x08000000)
            .env("FIREFLY_TEST_LINK", link)
            .env("FIREFLY_TEST_INSPECT", &inspection)
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output.stderr);
        serde_json::from_slice(&output.stdout).unwrap()
    }

    #[cfg(target_os = "windows")]
    fn assert_windows_can_extract_icon(path: &std::path::Path) {
        use std::{ffi::c_void, os::windows::ffi::OsStrExt};

        #[link(name = "shell32")]
        extern "system" {
            fn ExtractIconExW(
                path: *const u16,
                index: i32,
                large: *mut *mut c_void,
                small: *mut *mut c_void,
                count: u32,
            ) -> u32;
        }
        #[link(name = "user32")]
        extern "system" {
            fn DestroyIcon(icon: *mut c_void) -> i32;
        }

        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut large = std::ptr::null_mut();
        let mut small = std::ptr::null_mut();
        let count = unsafe { ExtractIconExW(wide.as_ptr(), 0, &mut large, &mut small, 1) };
        let valid = (1..=2).contains(&count) && !large.is_null() && !small.is_null();
        for handle in [large, small] {
            if !handle.is_null() {
                unsafe { DestroyIcon(handle) };
            }
        }
        assert!(valid, "Windows cannot load icon from {path:?}: {count}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn actual_windows_links_preserve_unicode_paths_arguments_and_existing_files() {
        let root = std::env::temp_dir().join(format!("firefly-shortcut-{}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let executable = root.join("应用 files, tools.exe");
        std::fs::write(&executable, b"test fixture").unwrap();
        let name = "工具 JSON 🐱";
        write_windows_shortcut(&root, &executable, "json.format", name, &executable).unwrap();
        let link = root.join(format!("{name}.lnk"));
        let original = std::fs::read(&link).unwrap();
        assert!(
            write_windows_shortcut(&root, &executable, "url.convert", name, &executable)
                .unwrap_err()
                .contains("同名")
        );
        assert_eq!(std::fs::read(&link).unwrap(), original);
        let value = inspect_windows_link(&link);
        assert_eq!(value["args"], "--firefly-open-tool=json.format");
        assert_eq!(
            std::path::Path::new(value["target"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            executable.canonicalize().unwrap()
        );
        assert_eq!(
            value["icon"].as_str().unwrap(),
            format!("{},0", executable.display())
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        let resolved = root.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(resolved).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn default_and_custom_shortcut_icons_resolve_to_real_windows_icons() {
        let root =
            std::env::temp_dir().join(format!("firefly-shortcut-icons-{}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let executable = root.join("默认应用 files, tools.exe");
        let system_executable = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        std::fs::copy(system_executable, &executable).unwrap();
        let application_icon = root.join("应用图标 files, default.ico");
        std::fs::write(&application_icon, include_bytes!("../icons/icon.ico")).unwrap();
        let custom_icon = root.join("自定义图标 [1], custom.ico");
        std::fs::write(
            &custom_icon,
            ico_bytes(include_bytes!("../icons/32x32.png")),
        )
        .unwrap();

        for (name, icon) in [
            ("default-exe", &executable),
            ("application-icon", &application_icon),
            ("custom-png", &custom_icon),
        ] {
            write_windows_shortcut(&root, &executable, "json.format", name, icon).unwrap();
            let value = inspect_windows_link(&root.join(format!("{name}.lnk")));
            let (icon_file, index) = value["icon"].as_str().unwrap().rsplit_once(',').unwrap();
            assert_eq!(index.trim(), "0");
            let saved_icon = std::path::Path::new(icon_file);
            assert_eq!(
                saved_icon.canonicalize().unwrap(),
                icon.canonicalize().unwrap()
            );
            assert_windows_can_extract_icon(saved_icon);
        }
        let resolved = root.canonicalize().unwrap();
        assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(resolved).unwrap();
    }
}
