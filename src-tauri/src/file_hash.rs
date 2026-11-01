use serde::Serialize;
use sha2::{digest::DynDigest, Digest};
use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
pub struct HashJobs(Mutex<HashMap<String, (Arc<AtomicBool>, Instant)>>);
#[derive(Clone, Serialize)]
pub struct HashProgress {
    pub request_id: String,
    pub processed: u64,
    pub total: Option<u64>,
}
#[derive(Serialize)]
pub struct HashResult {
    pub name: String,
    pub size: u64,
    pub algorithm: String,
    pub digest: String,
}
fn hasher(algorithm: &str) -> Result<Box<dyn DynDigest + Send>, String> {
    Ok(match algorithm {
        "md5" => Box::new(md5::Md5::new()),
        "sha1" => Box::new(sha1::Sha1::new()),
        "sha256" => Box::new(sha2::Sha256::new()),
        "sha384" => Box::new(sha2::Sha384::new()),
        "sha512" => Box::new(sha2::Sha512::new()),
        _ => return Err("不支持此哈希算法。".into()),
    })
}
fn calculate(
    mut file: impl Read,
    algorithm: &str,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<(u64, String), String> {
    let mut hash = hasher(algorithm)?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut size = 0;
    let start = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("文件哈希计算已取消。".into());
        }
        if start.elapsed() > Duration::from_secs(600) {
            return Err("哈希计算超过 10 分钟，已停止。".into());
        }
        let count = file
            .read(&mut buffer)
            .map_err(|_| "无法读取文件，请检查访问权限或重新选择文件。")?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > 16 * 1024 * 1024 * 1024 {
            return Err("文件超过 16 GiB 上限。".into());
        }
        hash.update(&buffer[..count]);
        progress(size);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("文件哈希计算已取消。".into());
    }
    Ok((
        size,
        hash.finalize().iter().map(|v| format!("{v:02x}")).collect(),
    ))
}
#[tauri::command]
pub fn cancel_hash_file(
    window: tauri::WebviewWindow,
    jobs: tauri::State<'_, HashJobs>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" || request_id.len() > 80 {
        return Err("哈希任务范围无效。".into());
    }
    let mut jobs = jobs.0.lock().map_err(|_| "哈希任务暂不可用。")?;
    jobs.retain(|_, (_, at)| at.elapsed() < Duration::from_secs(600));
    if let Some((cancel, _)) = jobs.get(&request_id) {
        cancel.store(true, Ordering::Relaxed);
    } else if jobs.len() < 128 {
        jobs.insert(
            request_id,
            (Arc::new(AtomicBool::new(true)), Instant::now()),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn hash_selected_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    algorithm: String,
    request_id: String,
) -> Result<HashResult, String> {
    if window.label() != "main" || request_id.is_empty() || request_id.len() > 80 {
        return Err("哈希任务范围无效。".into());
    }
    hasher(&algorithm)?;
    let cancel = {
        let state = app.state::<HashJobs>();
        let mut jobs = state.0.lock().map_err(|_| "哈希任务暂不可用。")?;
        jobs.retain(|_, (_, at)| at.elapsed() < Duration::from_secs(600));
        if jobs
            .values()
            .filter(|(flag, _)| !flag.load(Ordering::Relaxed))
            .count()
            >= 2
        {
            return Err("正在计算的文件过多，请稍后重试。".into());
        }
        jobs.entry(request_id.clone())
            .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
            .0
            .clone()
    };
    let worker_app = app.clone();
    let id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if cancel.load(Ordering::Relaxed) {
            return Err("文件哈希计算已取消。".into());
        }
        let file_path = if path.starts_with("content://") || path.starts_with("file://") {
            tauri_plugin_fs::FilePath::Url(url::Url::parse(&path).map_err(|_| "文件地址无效。")?)
        } else {
            tauri_plugin_fs::FilePath::Path(std::path::PathBuf::from(&path))
        };
        let file = worker_app
            .fs()
            .open(file_path, {
                let mut options = tauri_plugin_fs::OpenOptions::new();
                options.read(true);
                options
            })
            .map_err(|_| "无法打开文件，请重新选择并确认访问权限。")?;
        let metadata = file.metadata().ok();
        if metadata.as_ref().is_some_and(|m| m.is_dir()) {
            return Err("请选择文件，不支持目录。".into());
        }
        let total = metadata
            .as_ref()
            .and_then(|m| if m.len() > 0 { Some(m.len()) } else { None });
        if total.is_some_and(|size| size > 16 * 1024 * 1024 * 1024) {
            return Err("文件超过 16 GiB 上限。".into());
        }
        let mut last = Instant::now() - Duration::from_secs(1);
        let (size, digest) = calculate(file, &algorithm, &cancel, |processed| {
            if last.elapsed() > Duration::from_millis(120) {
                let _ = window.emit(
                    "firefly:hash-progress",
                    HashProgress {
                        request_id: id.clone(),
                        processed,
                        total,
                    },
                );
                last = Instant::now();
            }
        })?;
        let _ = window.emit(
            "firefly:hash-progress",
            HashProgress {
                request_id: id,
                processed: size,
                total: Some(size),
            },
        );
        Ok(HashResult {
            name: std::path::Path::new(&path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("所选文件")
                .to_string(),
            size,
            algorithm,
            digest,
        })
    })
    .await
    .map_err(|_| "文件哈希任务异常退出。".to_string())
    .and_then(|value| value);
    if let Ok(mut jobs) = app.state::<HashJobs>().0.lock() {
        jobs.remove(&request_id);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_digests_include_empty_files_and_binary_chunks() {
        let cancel = AtomicBool::new(false);
        assert_eq!(
            calculate(&b"abc"[..], "md5", &cancel, |_| {}).unwrap().1,
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert_eq!(
            calculate(&b"abc"[..], "sha1", &cancel, |_| {}).unwrap().1,
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            calculate(&b""[..], "sha256", &cancel, |_| {}).unwrap().1,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let data = vec![255u8; 1_000_000];
        assert_eq!(
            calculate(&data[..], "sha512", &cancel, |_| {}).unwrap().1,
            format!("{:x}", sha2::Sha512::digest(&data))
        );
    }
    #[test]
    fn cancellation_and_bad_algorithms_return_errors() {
        assert!(calculate(&b"abc"[..], "sha256", &AtomicBool::new(true), |_| {}).is_err());
        assert!(hasher("invalid").is_err());
    }
}
