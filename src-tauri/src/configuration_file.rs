use std::io::Read;

const MAX_BYTES: usize = 20 * 1024 * 1024;

fn read(path: &str) -> Result<String, String> {
    let mut native = crate::file_sessions::open_native(path, false)?;
    if native.size > MAX_BYTES as u64 {
        return Err("配置文件不能超过 20 MiB，未导入。".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut native.file)
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取配置文件。")?;
    if bytes.len() > MAX_BYTES {
        return Err("配置文件不能超过 20 MiB，未导入。".into());
    }
    String::from_utf8(bytes).map_err(|_| "配置文件必须使用 UTF-8 编码。".into())
}

fn write(path: &str, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_BYTES {
        return Err("配置文件不能超过 20 MiB，未导出。".into());
    }
    crate::file_sessions::write_selected(path, contents.as_bytes())
}

#[tauri::command]
pub async fn read_configuration_file(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("只能从主界面读取配置文件。".into());
    }
    tauri::async_runtime::spawn_blocking(move || read(&path))
        .await
        .map_err(|_| "配置读取任务异常。")?
}

#[tauri::command]
pub async fn write_configuration_file(
    window: tauri::WebviewWindow,
    path: String,
    contents: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能从主界面导出配置文件。".into());
    }
    tauri::async_runtime::spawn_blocking(move || write(&path, &contents))
        .await
        .map_err(|_| "配置导出任务异常。")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_utf8_reads_and_atomic_exports_preserve_existing_backups_on_rejection() {
        let path =
            std::env::temp_dir().join(format!("firefly-config-{}.json", rand::random::<u64>()));
        let name = path.to_str().unwrap();
        write(name, "{\"中文\":true}").unwrap();
        assert_eq!(read(name).unwrap(), "{\"中文\":true}");
        assert!(write(name, &"x".repeat(MAX_BYTES + 1)).is_err());
        assert_eq!(read(name).unwrap(), "{\"中文\":true}");
        std::fs::write(&path, [0xff]).unwrap();
        assert!(read(name).unwrap_err().contains("UTF-8"));
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(MAX_BYTES as u64 + 1).unwrap();
        drop(file);
        assert!(read(name).unwrap_err().contains("20 MiB"));
        std::fs::remove_file(path).unwrap();
    }
}
