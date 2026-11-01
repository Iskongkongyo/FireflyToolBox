//! A small, independent startup feed. Never cache failures or force-update state.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, time::Duration};
use tauri::Manager;
use url::Url;

const MAX_FEED_BYTES: usize = 256 * 1024;
const MAX_CONTENT_BYTES: usize = 128 * 1024;

#[derive(Debug, Deserialize, Serialize)]
pub struct Message {
    pub id: String,
    pub enabled: bool,
    #[serde(default = "default_show_once")]
    pub show_once: bool,
    pub title: String,
    pub content: String,
}

fn default_show_once() -> bool {
    true
}

#[derive(Deserialize)]
struct RawUpdate {
    #[serde(flatten)]
    message: Message,
    version: String,
    #[serde(default)]
    force: bool,
    downloads: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct Update {
    #[serde(flatten)]
    pub message: Message,
    pub version: String,
    pub force: bool,
    pub download_url: String,
}

#[derive(Debug, Serialize)]
pub struct Feed {
    pub configured: bool,
    pub update: Option<Update>,
    pub notification: Option<Message>,
}

fn checked_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "消息地址无效。")?;
    // Local HTTP is exclusively for debug builds and automated device tests.
    let debug_local = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"));
    if value.len() > 4096
        || (url.scheme() != "https" && !debug_local)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("消息地址须为不含账号和片段的 HTTPS 链接。".into());
    }
    Ok(url)
}

fn valid_message(message: &Message) -> bool {
    message.enabled
        && !message.id.trim().is_empty()
        && message.id.len() <= 160
        && !message.id.chars().any(char::is_control)
        && !message.title.trim().is_empty()
        && message.title.chars().count() <= 120
        && message.content.len() <= MAX_CONTENT_BYTES
}

fn download_url(value: &str) -> Option<String> {
    // Download links always require HTTPS, including debug builds.
    let url = Url::parse(value).ok()?;
    (value.len() <= 4096
        && url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host != "localhost" && !host.ends_with(".localhost"))
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}

fn parse_feed(body: &[u8], current: &str, platform: &str) -> Result<Feed, String> {
    if body.len() > MAX_FEED_BYTES {
        return Err("消息内容过大。".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(body.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(body))
            .map_err(|_| "消息 JSON 无效。")?;
    if !value.is_object() || value["schema_version"].as_u64() != Some(1) {
        return Err("消息格式版本不受支持。".into());
    }
    // A broken update must not suppress an otherwise valid announcement.
    let notification = serde_json::from_value::<Message>(value["notification"].clone())
        .ok()
        .filter(valid_message);
    let update = serde_json::from_value::<RawUpdate>(value["update"].clone())
        .ok()
        .and_then(|raw| {
            if !valid_message(&raw.message) {
                return None;
            }
            let next = semver::Version::parse(&raw.version).ok()?;
            let current = semver::Version::parse(current).ok()?;
            if !next.cmp_precedence(&current).is_gt() {
                return None;
            }
            Some(Update {
                download_url: download_url(raw.downloads.get(platform)?)?,
                message: raw.message,
                version: raw.version,
                force: raw.force,
            })
        });
    Ok(Feed {
        configured: true,
        update,
        notification,
    })
}

fn configured_url() -> Result<String, String> {
    if let Some(value) = option_env!("FIREFLY_MESSAGES_URL") {
        return Ok(value.trim().to_owned());
    }
    let config: serde_json::Value = serde_json::from_str(include_str!("../remote-messages.json"))
        .map_err(|_| "消息源配置无效。")?;
    config["url"]
        .as_str()
        .map(|value| value.trim().to_owned())
        .ok_or_else(|| "消息源配置无效。".into())
}

async fn request(client: &reqwest::Client, url: &Url, current: &str) -> Result<Feed, String> {
    let mut response = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| "无法连接消息服务器。")?
        .error_for_status()
        .map_err(|_| "消息服务器暂时不可用。")?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_FEED_BYTES as u64)
    {
        return Err("消息内容过大。".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "消息内容接收失败。")? {
        if body.len().saturating_add(chunk.len()) > MAX_FEED_BYTES {
            return Err("消息内容过大。".into());
        }
        body.extend_from_slice(&chunk);
    }
    parse_feed(&body, current, std::env::consts::OS)
}

async fn fetch(url: Url, current: &str) -> Result<Feed, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || checked_url(attempt.url().as_str()).is_err() {
                attempt.error("不支持的消息跳转。")
            } else {
                attempt.follow()
            }
        }))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "无法初始化消息请求。")?;
    let mut last = Err("无法获取消息。".into());
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        last = tokio::time::timeout(Duration::from_secs(8), request(&client, &url, current))
            .await
            .unwrap_or_else(|_| Err("消息请求超时。".into()));
        if last.is_ok() {
            break;
        }
    }
    last
}

#[tauri::command]
pub async fn fetch_remote_messages(window: tauri::WebviewWindow) -> Result<Feed, String> {
    if window.label() != "main" {
        return Err("仅主界面可检查更新与通知。".into());
    }
    let url = configured_url()?;
    if url.is_empty() {
        return Ok(Feed {
            configured: false,
            update: None,
            notification: None,
        });
    }
    let current = window.app_handle().package_info().version.to_string();
    fetch(checked_url(&url)?, &current).await
}

#[tauri::command]
pub fn open_remote_message_link(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if window.label() != "main" {
        return Err("仅主界面可打开消息链接。".into());
    }
    let destination = download_url(&url).ok_or("仅支持完整的 HTTPS 链接。")?;
    app.opener()
        .open_url(destination, None::<&str>)
        .map_err(|_| "无法打开浏览器。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> serde_json::Value {
        serde_json::json!({"schema_version":1,
            "update":{"id":"release-2","enabled":true,"title":"更新","content":"<h2>新版</h2>","version":"2.0.0","force":true,"downloads":{"windows":"https://example.com/windows.exe","android":"https://example.com/android.apk"}},
            "notification":{"id":"news-1","enabled":true,"title":"通知","content":"<p>你好</p>"}})
    }
    fn parse(value: &serde_json::Value, current: &str, platform: &str) -> Feed {
        parse_feed(&serde_json::to_vec(value).unwrap(), current, platform).unwrap()
    }
    #[test]
    fn version_platform_and_disabled_items() {
        let mut value = fixture();
        assert!(parse(&value, "0.1.69", "android")
            .update
            .unwrap()
            .download_url
            .ends_with("android.apk"));
        for version in ["2.0.0", "2.0.0+local", "3.0.0"] {
            assert!(parse(&value, version, "windows").update.is_none());
        }
        assert!(parse(&value, "2.0.0-beta.1", "windows").update.is_some());
        assert!(parse(&value, "1.0.0", "linux").update.is_none());
        value["update"]["enabled"] = false.into();
        value["notification"]["enabled"] = false.into();
        let result = parse(&value, "1.0.0", "windows");
        assert!(result.update.is_none() && result.notification.is_none());
    }
    #[test]
    fn updates_require_all_three_conditions_on_both_platforms_even_when_forced() {
        for platform in ["windows", "android"] {
            for (version, enabled, link, expected) in [
                ("0.1.70", true, "https://example.com/download", true),
                ("0.1.69", true, "https://example.com/download", false),
                ("0.1.68", true, "https://example.com/download", false),
                (
                    "0.1.69+build.2",
                    true,
                    "https://example.com/download",
                    false,
                ),
                ("0.1.69-rc.1", true, "https://example.com/download", false),
                ("0.1.70", false, "https://example.com/download", false),
                ("0.1.70", true, "", false),
                ("0.1.70", true, "http://example.com/download", false),
                ("not-a-version", true, "https://example.com/download", false),
            ] {
                let mut value = fixture();
                value["update"]["version"] = version.into();
                value["update"]["enabled"] = enabled.into();
                value["update"]["downloads"][platform] = link.into();
                assert_eq!(
                    parse(&value, "0.1.69", platform).update.is_some(),
                    expected,
                    "{platform}: {version}, {enabled}, {link}"
                );
            }
            let mut value = fixture();
            value["update"]["downloads"]
                .as_object_mut()
                .unwrap()
                .remove(platform);
            assert!(parse(&value, "0.1.69", platform).update.is_none());
            value = fixture();
            value["update"]["version"] = "1.10.0".into();
            assert!(parse(&value, "1.9.0", platform).update.is_some());
        }
    }
    #[test]
    fn show_once_defaults_to_true_and_requires_a_real_boolean() {
        let value = fixture();
        let result = parse(&value, "0.1.69", "windows");
        assert!(result.update.unwrap().message.show_once);
        assert!(result.notification.unwrap().show_once);
        for flag in [true, false] {
            let mut value = fixture();
            value["update"]["show_once"] = flag.into();
            value["notification"]["show_once"] = flag.into();
            let result = parse(&value, "0.1.69", "windows");
            assert_eq!(result.update.unwrap().message.show_once, flag);
            assert_eq!(result.notification.unwrap().show_once, flag);
        }
        for invalid in [
            serde_json::json!("false"),
            serde_json::json!(0),
            serde_json::Value::Null,
        ] {
            let mut value = fixture();
            value["update"]["show_once"] = invalid;
            let result = parse(&value, "0.1.69", "android");
            assert!(result.update.is_none() && result.notification.is_some());
        }
    }
    #[test]
    fn preserves_utf8_and_escaped_emoji_in_titles_and_html() {
        let mut value = fixture();
        let title = "🎉 流萤更新 👩🏽‍💻 ❤️";
        let content = "<h2>你好呀 🐱</h2><p>快乐开发 👨‍👩‍👧‍👦 👍🏽</p>";
        for kind in ["update", "notification"] {
            value[kind]["title"] = title.into();
            value[kind]["content"] = content.into();
        }
        let result = parse(&value, "0.1.69", "windows");
        let update = result.update.unwrap();
        let notification = result.notification.unwrap();
        assert_eq!(update.message.title, title);
        assert_eq!(update.message.content, content);
        assert_eq!(notification.title, title);
        assert_eq!(notification.content, content);
        let escaped = br#"{"schema_version":1,"notification":{"id":"escaped","enabled":true,"title":"\ud83c\udf89","content":"<p>\ud83d\udc9a</p>"}}"#;
        let result = parse_feed(escaped, "0.1.69", "android")
            .unwrap()
            .notification
            .unwrap();
        assert_eq!(result.title, "🎉");
        assert_eq!(result.content, "<p>💚</p>");
    }
    #[test]
    fn malformed_items_are_isolated_and_never_force_lock() {
        for invalid in [serde_json::json!({}), serde_json::Value::Null] {
            let mut value = fixture();
            value["update"] = invalid;
            let result = parse(&value, "1.0.0", "windows");
            assert!(result.update.is_none() && result.notification.is_some());
        }
        for url in [
            "javascript:alert(1)",
            "http://example.com/x",
            "https://user:pass@example.com/x",
            "file:///tmp/x",
            "https://tauri.localhost/x",
        ] {
            let mut value = fixture();
            value["update"]["downloads"]["windows"] = url.into();
            assert!(parse(&value, "1.0.0", "windows").update.is_none());
        }
        let mut value = fixture();
        value["notification"]["enabled"] = "true".into();
        assert!(parse(&value, "1.0.0", "windows").notification.is_none());
        value = fixture();
        value["update"]["force"] = "true".into();
        assert!(parse(&value, "1.0.0", "windows").update.is_none());
    }
    #[test]
    fn rejects_bad_envelopes_and_oversized_data() {
        for body in [
            b"[]".as_slice(),
            b"{}",
            b"{\"schema_version\":2}",
            b"not json",
        ] {
            assert!(parse_feed(body, "1.0.0", "windows").is_err());
        }
        assert!(parse_feed(&vec![b' '; MAX_FEED_BYTES + 1], "1.0.0", "windows").is_err());
        let mut value = fixture();
        value["notification"]["content"] = "x".repeat(MAX_CONTENT_BYTES + 1).into();
        assert!(parse(&value, "1.0.0", "windows").notification.is_none());
    }

    // Exercise real HTTP, including the two-attempt ceiling and byte limit.
    fn server(responses: Vec<Vec<u8>>) -> (Url, std::thread::JoinHandle<usize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = Url::parse(&format!(
            "http://{}/messages.json",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let handle = std::thread::spawn(move || {
            let mut count = 0;
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while std::time::Instant::now() < deadline && count < responses.len() {
                if let Ok((mut socket, _)) = listener.accept() {
                    socket
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let mut input = [0; 4096];
                    let size = socket.read(&mut input).unwrap();
                    let headers = String::from_utf8_lossy(&input[..size]).to_lowercase();
                    assert!(headers.contains("accept: application/json"));
                    let _ = socket.write_all(&responses[count]);
                    count += 1;
                } else {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            count
        });
        (url, handle)
    }
    fn response(status: &str, body: &[u8]) -> Vec<u8> {
        let mut bytes = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }
    #[tokio::test]
    async fn retries_once_after_server_failure_and_accepts_json_without_mime_header() {
        let body = serde_json::to_vec(&fixture()).unwrap();
        let (url, handle) = server(vec![
            response("503 Unavailable", b"offline"),
            response("200 OK", &body),
        ]);
        let result = fetch(url, "0.1.69").await.unwrap();
        assert!(result.notification.is_some());
        assert_eq!(handle.join().unwrap(), 2);
    }
    #[tokio::test]
    async fn never_exceeds_two_attempts_on_failure_or_excessive_length() {
        for bytes in [
            response("503 Unavailable", b"offline"),
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                MAX_FEED_BYTES + 1
            )
            .into_bytes(),
            response("200 OK", b"not json"),
        ] {
            let (url, handle) = server(vec![bytes.clone(), bytes]);
            assert!(fetch(url, "0.1.69").await.is_err());
            assert_eq!(handle.join().unwrap(), 2);
        }
    }
}
