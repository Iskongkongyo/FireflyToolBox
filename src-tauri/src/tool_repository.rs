//! Public FFTools catalog. URLs are constructed here, never supplied by tools.
use crate::{file_sessions, modules, AppState};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::sync::{watch, Semaphore};
use url::Url;

const OWNER: &str = "Iskongkongyo";
const REPOSITORY: &str = "FFTools";
const BRANCH: &str = "main";
const MAX_JSON: usize = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 1000;
const CACHE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    Auto,
    Github,
    Ghproxy,
}

#[derive(Clone, Copy, Debug)]
enum Provider {
    Github,
    Ghproxy,
    Ghfast,
    Jsdelivr,
}
impl Provider {
    fn label(self) -> &'static str {
        match self {
            Self::Github => "GitHub 直连",
            Self::Ghproxy => "GH-Proxy",
            Self::Ghfast => "GHFast",
            Self::Jsdelivr => "jsDelivr",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub category: String,
    pub size: u64,
    pub sha: String,
    pub title: String,
    pub description: String,
    pub updated_at: String,
    pub metadata_loaded: bool,
    pub module_id_hint: Option<String>,
    pub version_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Catalog {
    pub repository_url: String,
    pub commit: String,
    pub fetched_at: u64,
    pub source: String,
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub skipped_entries: Vec<SkippedEntry>,
    #[serde(default)]
    pub from_cache: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkippedEntry {
    pub path: String,
    pub reason: String,
}

struct ParsedTree {
    entries: Vec<Entry>,
    skipped_entries: Vec<SkippedEntry>,
}
#[derive(Serialize, Deserialize)]
struct DiskCatalog {
    version: u32,
    catalog: Catalog,
}

#[derive(Clone)]
struct Prepared {
    token: String,
    entry: Entry,
    commit: String,
    source: String,
    bytes: Arc<Vec<u8>>,
    manifest: Option<modules::Manifest>,
    inspection_error: Option<String>,
}
#[derive(Serialize)]
pub struct PreparedView {
    token: String,
    entry_id: String,
    file_name: String,
    bytes: u64,
    source: String,
    commit: String,
    cached: bool,
    summary: Option<modules::ModuleSummary>,
    license: String,
    description: String,
    platforms: Vec<String>,
    compatible: bool,
    inspection_error: Option<String>,
    installed_version: Option<String>,
}

pub struct RepositoryState {
    catalog: Mutex<Option<Catalog>>,
    disk_write: Mutex<()>,
    refresh: tokio::sync::Mutex<()>,
    descriptions: Semaphore,
    operation: Arc<Semaphore>,
    prepared: Mutex<Option<Arc<Prepared>>>,
    job: Mutex<Option<(String, watch::Sender<bool>)>>,
    cancelled: Mutex<Vec<String>>,
    generation: AtomicU64,
}
impl Default for RepositoryState {
    fn default() -> Self {
        Self {
            catalog: Mutex::new(None),
            disk_write: Mutex::new(()),
            refresh: tokio::sync::Mutex::new(()),
            descriptions: Semaphore::new(3),
            operation: Arc::new(Semaphore::new(1)),
            prepared: Mutex::new(None),
            job: Mutex::new(None),
            cancelled: Mutex::new(Vec::new()),
            generation: AtomicU64::new(0),
        }
    }
}

fn scope(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("仅主界面可访问工具下载。".into())
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && value.to_ascii_lowercase().ends_with(".fftool")
}
fn api(path: &[&str]) -> Url {
    let mut value = Url::parse("https://api.github.com/").unwrap();
    value
        .path_segments_mut()
        .unwrap()
        .extend(["repos", OWNER, REPOSITORY])
        .extend(path);
    value
}
fn raw(commit: &str, path: &str) -> Url {
    let mut value = Url::parse("https://raw.githubusercontent.com/").unwrap();
    value
        .path_segments_mut()
        .unwrap()
        .extend([OWNER, REPOSITORY, commit])
        .extend(path.split('/'));
    value
}
fn routed(original: &Url, provider: Provider) -> Url {
    match provider {
        Provider::Github => original.clone(),
        Provider::Ghproxy => Url::parse(&format!("https://gh-proxy.com/{original}")).unwrap(),
        Provider::Ghfast => Url::parse(&format!("https://ghfast.top/{original}")).unwrap(),
        Provider::Jsdelivr => {
            let segments: Vec<_> = original.path().trim_start_matches('/').split('/').collect();
            Url::parse(&format!(
                "https://cdn.jsdelivr.net/gh/{OWNER}/{REPOSITORY}@{}/{}",
                segments[2],
                segments[3..].join("/")
            ))
            .unwrap()
        }
    }
}
fn metadata_routes(route: Route) -> Vec<Provider> {
    match route {
        Route::Auto => vec![Provider::Ghproxy, Provider::Github],
        Route::Github => vec![Provider::Github],
        Route::Ghproxy => vec![Provider::Ghproxy],
    }
}
fn file_routes(route: Route, size: u64) -> Vec<Provider> {
    if !matches!(route, Route::Auto) {
        return metadata_routes(route);
    }
    let mut providers = vec![Provider::Ghproxy, Provider::Ghfast];
    if size <= 20 * 1024 * 1024 {
        providers.push(Provider::Jsdelivr);
    }
    providers.push(Provider::Github);
    providers
}

// Only specially built debug clients can use a local HTTP test server. It does
// not change the repository identity and never shares the production disk cache.
fn test_base() -> Option<Url> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let value = option_env!("FIREFLY_REPOSITORY_TEST_URL")?;
    let url = Url::parse(value).ok()?;
    (url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}
fn endpoint(url: &Url) -> Url {
    if let Some(mut base) = test_base() {
        base.query_pairs_mut().append_pair("url", url.as_str());
        base
    } else {
        url.clone()
    }
}
fn allowed_redirect(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() || url.as_str().len() > 4096 {
        return false;
    }
    (url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some(
                "api.github.com"
                    | "github.com"
                    | "raw.githubusercontent.com"
                    | "objects.githubusercontent.com"
                    | "media.githubusercontent.com"
                    | "gh-proxy.com"
                    | "ghfast.top"
                    | "cdn.jsdelivr.net"
            )
        ))
        || test_base().is_some_and(|base| base.origin() == url.origin())
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 || !allowed_redirect(attempt.url()) {
                attempt.error("不支持的下载跳转。")
            } else {
                attempt.follow()
            }
        }))
        .user_agent("FireflyToolbox-PublicRepository/1")
        .build()
        .map_err(|_| "无法初始化工具下载网络。".into())
}
fn http_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        403 | 429 => "线路访问受限或达到频率上限，请切换线路或稍后重试。".into(),
        404 => "仓库文件已变化或不存在，请刷新工具列表。".into(),
        _ => format!("服务器返回 HTTP {}。", status.as_u16()),
    }
}
async fn json(
    client: &reqwest::Client,
    original: Url,
    route: Route,
) -> Result<(serde_json::Value, String), String> {
    let mut last = "无法访问仓库。".to_owned();
    for provider in metadata_routes(route) {
        let result = async {
            let mut response = client
                .get(endpoint(&routed(&original, provider)))
                .header("Accept", "application/vnd.github+json")
                .header("Accept-Encoding", "identity")
                .timeout(Duration::from_secs(6))
                .send()
                .await
                .map_err(|_| "连接超时或网络不可用。".to_owned())?;
            if !response.status().is_success() {
                return Err(http_error(response.status()));
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_JSON as u64)
            {
                return Err("仓库索引超过容量限制。".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "仓库信息接收失败。".to_owned())?
            {
                if bytes.len().saturating_add(chunk.len()) > MAX_JSON {
                    return Err("仓库索引超过容量限制。".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|_| "线路未返回有效仓库数据。".into())
        }
        .await;
        match result {
            Ok(value) => return Ok((value, provider.label().into())),
            Err(error) => last = format!("{}：{error}", provider.label()),
        }
    }
    Err(last)
}

fn hints(file_name: &str) -> (Option<String>, Option<String>) {
    let stem = file_name.strip_suffix(".fftool").unwrap_or(file_name);
    for (index, _) in stem.match_indices('-') {
        let (id, version) = (&stem[..index], &stem[index + 1..]);
        if id.contains('.')
            && id.len() <= 100
            && id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.')
            && semver::Version::parse(version).is_ok()
        {
            return (Some(id.into()), Some(version.into()));
        }
    }
    (None, None)
}
fn parse_tree(value: &serde_json::Value) -> Result<ParsedTree, String> {
    if value["truncated"].as_bool() != Some(false) {
        return Err("仓库目录不完整，暂时无法展示；请稍后刷新。".into());
    }
    let tree = value["tree"].as_array().ok_or("仓库目录格式无效。")?;
    let mut entries = Vec::new();
    let mut skipped_entries = Vec::new();
    for item in tree {
        if item["type"] != "blob" || !matches!(item["mode"].as_str(), Some("100644" | "100755")) {
            continue;
        }
        let Some(path) = item["path"].as_str().filter(|path| valid_path(path)) else {
            continue;
        };
        if entries.len() + skipped_entries.len() >= MAX_ENTRIES {
            return Err("工具数量超过 1000 项，暂时无法完整展示。".into());
        }
        let sha = item["sha"].as_str().filter(|sha| valid_sha(sha));
        let size = item["size"].as_u64();
        let reason = match (sha, size) {
            (None, _) => Some("文件摘要无效。"),
            (_, None) => Some("文件大小无效。"),
            (_, Some(0)) => Some("文件为空。"),
            (_, Some(size)) if size > modules::MAX_PACKAGE_BYTES as u64 => {
                Some("文件大小超过 128 MiB。")
            }
            _ => None,
        };
        if let Some(reason) = reason {
            skipped_entries.push(SkippedEntry {
                path: path.into(),
                reason: reason.into(),
            });
            continue;
        }
        let (sha, size) = (sha.unwrap(), size.unwrap());
        let file_name = path.rsplit('/').next().unwrap().to_owned();
        let category = path
            .rsplit_once('/')
            .map(|(folder, _)| folder.to_owned())
            .unwrap_or_else(|| "其他工具".into());
        let (module_id_hint, version_hint) = hints(&file_name);
        let title = file_name.trim_end_matches(".fftool").to_owned();
        entries.push(Entry {
            id: format!("{sha}:{path}"),
            path: path.into(),
            file_name,
            category,
            size,
            sha: sha.into(),
            title,
            description: String::new(),
            updated_at: String::new(),
            metadata_loaded: false,
            module_id_hint,
            version_hint,
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ParsedTree {
        entries,
        skipped_entries,
    })
}

fn cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|_| "无法读取缓存目录。")?
        .join("runtime-temp")
        .join("tool-repository")
        .join("catalog-v1.json"))
}
fn load_cache(app: &tauri::AppHandle, state: &RepositoryState) {
    if test_base().is_some()
        || state
            .catalog
            .lock()
            .map(|value| value.is_some())
            .unwrap_or(true)
    {
        return;
    }
    let result = (|| {
        let path = cache_path(app).ok()?;
        if std::fs::metadata(&path).ok()?.len() > MAX_JSON as u64 {
            return None;
        }
        let disk: DiskCatalog = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
        if disk.version != CACHE_VERSION
            || disk.catalog.repository_url != format!("https://github.com/{OWNER}/{REPOSITORY}")
            || !valid_sha(&disk.catalog.commit)
            || disk.catalog.entries.len() + disk.catalog.skipped_entries.len() > MAX_ENTRIES
        {
            return None;
        }
        if disk.catalog.entries.iter().any(|entry| {
            !valid_path(&entry.path)
                || !valid_sha(&entry.sha)
                || entry.id != format!("{}:{}", entry.sha, entry.path)
                || entry.size == 0
                || entry.size > modules::MAX_PACKAGE_BYTES as u64
        }) {
            return None;
        }
        if disk
            .catalog
            .skipped_entries
            .iter()
            .any(|entry| !valid_path(&entry.path))
        {
            return None;
        }
        Some(disk.catalog)
    })();
    if let Ok(mut current) = state.catalog.lock() {
        if current.is_none() {
            *current = result;
        }
    }
}
fn persist(app: &tauri::AppHandle, state: &RepositoryState) {
    if test_base().is_some() {
        return;
    }
    let Ok(_write) = state.disk_write.lock() else {
        return;
    };
    let Some(catalog) = state.catalog.lock().ok().and_then(|value| value.clone()) else {
        return;
    };
    let Ok(path) = cache_path(app) else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(&DiskCatalog {
        version: CACHE_VERSION,
        catalog,
    }) else {
        return;
    };
    if bytes.len() > MAX_JSON || std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let temporary = parent.join(format!("catalog-{:032x}.tmp", rand::random::<u128>()));
    if std::fs::write(&temporary, bytes).is_ok() && std::fs::rename(&temporary, &path).is_ok() {
        return;
    }
    let _ = std::fs::remove_file(temporary);
}
fn entry(state: &RepositoryState, id: &str) -> Result<(Entry, String), String> {
    let current = state.catalog.lock().map_err(|_| "无法读取工具列表。")?;
    let current = current.as_ref().ok_or("请先刷新工具列表。")?;
    let entry = current
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .cloned()
        .ok_or("工具列表已变化，请刷新后重试。")?;
    Ok((entry, current.commit.clone()))
}

#[tauri::command]
pub async fn repository_catalog(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RepositoryState>,
    route: Route,
    refresh: bool,
) -> Result<Catalog, String> {
    scope(&window)?;
    load_cache(&app, &state);
    if !refresh {
        if let Some(mut value) = state
            .catalog
            .lock()
            .map_err(|_| "无法读取列表缓存。")?
            .clone()
        {
            value.from_cache = true;
            return Ok(value);
        }
    }
    let generation = state.generation.load(Ordering::SeqCst);
    // A new page can arrive while the previous page's first request still runs.
    // Wait for that request, then reuse its cache instead of stranding the page.
    let _refresh = state.refresh.lock().await;
    if generation != state.generation.load(Ordering::SeqCst) {
        return Err("缓存已清理，请重新刷新列表。".into());
    }
    if !refresh {
        if let Some(mut value) = state
            .catalog
            .lock()
            .map_err(|_| "无法读取列表缓存。")?
            .clone()
        {
            value.from_cache = true;
            return Ok(value);
        }
    }
    let client = client()?;
    let (head, _) = json(&client, api(&["git", "ref", "heads", BRANCH]), route).await?;
    let commit = head["object"]["sha"]
        .as_str()
        .filter(|sha| valid_sha(sha))
        .ok_or("仓库版本信息无效。")?
        .to_owned();
    let mut url = api(&["git", "trees", &commit]);
    url.query_pairs_mut().append_pair("recursive", "1");
    let (tree, source) = json(&client, url, route).await?;
    let ParsedTree {
        mut entries,
        skipped_entries,
    } = parse_tree(&tree)?;
    if let Some(previous) = state
        .catalog
        .lock()
        .map_err(|_| "无法读取工具列表。")?
        .as_ref()
        .filter(|value| value.commit == commit)
    {
        for entry in &mut entries {
            if let Some(cached) = previous
                .entries
                .iter()
                .find(|old| old.id == entry.id && old.metadata_loaded)
            {
                *entry = cached.clone();
            }
        }
    }
    let catalog = Catalog {
        repository_url: format!("https://github.com/{OWNER}/{REPOSITORY}"),
        commit,
        fetched_at: now(),
        source,
        entries,
        skipped_entries,
        from_cache: false,
    };
    {
        let mut current = state.catalog.lock().map_err(|_| "无法保存工具列表。")?;
        if generation != state.generation.load(Ordering::SeqCst) {
            return Err("缓存已清理，请重新刷新列表。".into());
        }
        *current = Some(catalog.clone());
    }
    persist(&app, &state);
    Ok(catalog)
}

#[tauri::command]
pub async fn repository_describe(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RepositoryState>,
    id: String,
    route: Route,
) -> Result<Entry, String> {
    scope(&window)?;
    let _permit = state
        .descriptions
        .acquire()
        .await
        .map_err(|_| "名称读取已取消。")?;
    let generation = state.generation.load(Ordering::SeqCst);
    let (mut item, commit) = entry(&state, &id)?;
    if item.metadata_loaded {
        return Ok(item);
    }
    let mut url = api(&["commits"]);
    url.query_pairs_mut()
        .append_pair("path", &item.path)
        .append_pair("sha", &commit)
        .append_pair("per_page", "5");
    let (history, _) = json(&client()?, url, route).await?;
    let commits = history.as_array().ok_or("工具名称记录无效。")?;
    let selected = commits
        .iter()
        .find(|value| {
            value["commit"]["message"].as_str().is_some_and(|message| {
                let title = message.lines().next().unwrap_or("").trim();
                !title.is_empty() && title != item.category && title != "Add files via upload"
            })
        })
        .or_else(|| commits.first())
        .ok_or("暂无此工具的提交记录。")?;
    let message = selected["commit"]["message"].as_str().unwrap_or("");
    item.title = message
        .lines()
        .next()
        .unwrap_or(&item.title)
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    if item.title.is_empty() {
        item.title = item.file_name.clone();
    }
    item.description = message
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .chars()
        .take(500)
        .collect();
    item.updated_at = selected["commit"]["committer"]["date"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(40)
        .collect();
    item.metadata_loaded = true;
    {
        let mut catalog = state.catalog.lock().map_err(|_| "无法保存工具名称。")?;
        if generation == state.generation.load(Ordering::SeqCst) {
            if let Some(current) = catalog.as_mut() {
                if let Some(target) = current.entries.iter_mut().find(|entry| entry.id == id) {
                    *target = item.clone();
                }
            }
        }
    }
    persist(&app, &state);
    Ok(item)
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    request_id: &'a str,
    received: u64,
    total: u64,
    source: &'a str,
}
fn verify(bytes: &[u8], entry: &Entry) -> Result<(), String> {
    if bytes.len() as u64 != entry.size {
        return Err("文件大小与仓库索引不一致，请刷新列表或切换线路。".into());
    }
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", bytes.len()).as_bytes());
    hash.update(bytes);
    if format!("{:x}", hash.finalize()) != entry.sha.to_ascii_lowercase() {
        return Err("文件摘要与仓库索引不一致，已阻止安装；可切换线路重试。".into());
    }
    Ok(())
}
async fn bytes(
    window: &tauri::WebviewWindow,
    item: &Entry,
    commit: &str,
    route: Route,
    request_id: &str,
) -> Result<(Vec<u8>, String), String> {
    let client = client()?;
    let original = raw(commit, &item.path);
    let mut last = String::new();
    for provider in file_routes(route, item.size) {
        let source = provider.label();
        let result = async {
            let _ = window.emit(
                "firefly:repository-progress",
                Progress {
                    request_id,
                    received: 0,
                    total: item.size,
                    source,
                },
            );
            let request = client
                .get(endpoint(&routed(&original, provider)))
                .header("Accept-Encoding", "identity")
                .timeout(Duration::from_secs((60 + item.size / 1048576 * 6).min(600)));
            let mut response = tokio::time::timeout(Duration::from_secs(12), request.send())
                .await
                .map_err(|_| "等待下载响应超时，可切换线路重试。".to_owned())?
                .map_err(|_| "下载连接超时或网络不可用。".to_owned())?;
            if !response.status().is_success() {
                return Err(http_error(response.status()));
            }
            if response.content_length().is_some_and(|length| {
                length != item.size || length > modules::MAX_PACKAGE_BYTES as u64
            }) {
                return Err("线路返回的文件大小不正确。".into());
            }
            let mut bytes = Vec::new();
            let mut last_notice = std::time::Instant::now();
            loop {
                let chunk = tokio::time::timeout(Duration::from_secs(15), response.chunk())
                    .await
                    .map_err(|_| "下载长时间没有响应，可切换线路重试。".to_owned())?
                    .map_err(|_| "文件接收失败。".to_owned())?;
                let Some(chunk) = chunk else {
                    break;
                };
                if bytes.len().saturating_add(chunk.len()) as u64 > item.size {
                    return Err("线路返回的文件超过索引大小。".into());
                }
                bytes.extend_from_slice(&chunk);
                if last_notice.elapsed() > Duration::from_millis(100) {
                    let _ = window.emit(
                        "firefly:repository-progress",
                        Progress {
                            request_id,
                            received: bytes.len() as u64,
                            total: item.size,
                            source,
                        },
                    );
                    last_notice = std::time::Instant::now();
                }
            }
            verify(&bytes, item)?;
            let _ = window.emit(
                "firefly:repository-progress",
                Progress {
                    request_id,
                    received: item.size,
                    total: item.size,
                    source,
                },
            );
            Ok(bytes)
        }
        .await;
        match result {
            Ok(bytes) => return Ok((bytes, source.into())),
            Err(error) => last = format!("{source}：{error}"),
        }
    }
    Err(last)
}
fn view(app: &tauri::AppHandle, prepared: &Prepared, cached: bool) -> Result<PreparedView, String> {
    let mut inspection_error = prepared.inspection_error.clone();
    let mut installed_version = None;
    let compatible = if let Some(manifest) = &prepared.manifest {
        let state = app.try_state::<AppState>().ok_or("应用尚未准备好。")?;
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        if let Some(record) = crate::tool_module_record(&store, &manifest.module_id)? {
            installed_version = Some(modules::parse_record(&record)?.version);
        }
        let supported = manifest
            .platforms
            .iter()
            .any(|value| value == std::env::consts::OS);
        if !supported {
            inspection_error = Some("此工具包暂不支持当前平台，仍可保存文件。".into());
        }
        let downgrade = installed_version
            .as_ref()
            .and_then(|old| semver::Version::parse(old).ok())
            .zip(semver::Version::parse(&manifest.version).ok())
            .is_some_and(|(old, new)| new < old);
        if downgrade {
            inspection_error = Some("本机已安装更新的版本，不能降级；仍可保存文件。".into());
        }
        supported && !downgrade
    } else {
        false
    };
    Ok(PreparedView {
        token: prepared.token.clone(),
        entry_id: prepared.entry.id.clone(),
        file_name: prepared.entry.file_name.clone(),
        bytes: prepared.bytes.len() as u64,
        source: prepared.source.clone(),
        commit: prepared.commit.clone(),
        cached,
        summary: prepared.manifest.as_ref().map(modules::summary),
        license: prepared
            .manifest
            .as_ref()
            .map(|value| value.license.clone())
            .unwrap_or_default(),
        description: prepared
            .manifest
            .as_ref()
            .and_then(|value| value.tools.first())
            .map(|tool| modules::label(&tool.description))
            .unwrap_or_default(),
        platforms: prepared
            .manifest
            .as_ref()
            .map(|value| value.platforms.clone())
            .unwrap_or_default(),
        compatible,
        inspection_error,
        installed_version,
    })
}

struct Job<'a> {
    state: &'a RepositoryState,
    id: String,
}
impl Drop for Job<'_> {
    fn drop(&mut self) {
        if let Ok(mut job) = self.state.job.lock() {
            if job.as_ref().is_some_and(|(id, _)| id == &self.id) {
                *job = None;
            }
        }
    }
}

#[tauri::command]
pub async fn repository_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RepositoryState>,
    id: String,
    route: Route,
    request_id: String,
) -> Result<PreparedView, String> {
    scope(&window)?;
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("下载请求无效。".into());
    }
    let permit = state
        .operation
        .clone()
        .try_acquire_owned()
        .map_err(|_| "当前已有工具包操作，请稍后重试。")?;
    {
        let mut cancelled = state.cancelled.lock().map_err(|_| "无法读取取消请求。")?;
        if let Some(index) = cancelled.iter().position(|id| id == &request_id) {
            cancelled.remove(index);
            return Err("已取消下载。".into());
        }
    }
    let generation = state.generation.load(Ordering::SeqCst);
    let (item, commit) = entry(&state, &id)?;
    let cached = state
        .prepared
        .lock()
        .map_err(|_| "无法读取下载缓存。")?
        .clone();
    if let Some(cached) =
        cached.filter(|value| value.entry.id == id && value.entry.size == item.size)
    {
        let mut reused = (*cached).clone();
        reused.token = format!("{:032x}", rand::random::<u128>());
        reused.entry = item;
        reused.commit = commit;
        let result = view(&app, &reused, true)?;
        let mut target = state.prepared.lock().map_err(|_| "无法保存下载缓存。")?;
        if generation != state.generation.load(Ordering::SeqCst) {
            return Err("缓存已释放，请重新下载。".into());
        }
        *target = Some(Arc::new(reused));
        return Ok(result);
    }
    let (sender, mut cancel) = watch::channel(false);
    {
        let mut job = state.job.lock().map_err(|_| "无法创建下载任务。")?;
        let mut cancelled = state.cancelled.lock().map_err(|_| "无法读取取消请求。")?;
        if let Some(index) = cancelled.iter().position(|id| id == &request_id) {
            cancelled.remove(index);
            let _ = sender.send(true);
        }
        *job = Some((request_id.clone(), sender));
    }
    let _job = Job {
        state: &state,
        id: request_id.clone(),
    };
    let work = async {
        let (bytes, source) = bytes(&window, &item, &commit, route, &request_id).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let inspected = modules::unpack_package_full(&bytes, true)
                .and_then(|package| modules::parse_record(&package.record));
            let (manifest, inspection_error) = match inspected {
                Ok(manifest) => (Some(manifest), None),
                Err(error) => (None, Some(error)),
            };
            let prepared = Prepared {
                token: format!("{:032x}", rand::random::<u128>()),
                entry: item,
                commit,
                source,
                bytes: Arc::new(bytes),
                manifest,
                inspection_error,
            };
            (Arc::new(prepared), permit)
        })
        .await
        .map_err(|_| "工具包检查线程失败。".to_owned())
    };
    let (prepared, _permit) = tokio::select! { result = work => result?, _ = cancel.changed() => return Err("已取消下载。".into()) };
    let result = view(&app, &prepared, false)?;
    {
        let mut target = state.prepared.lock().map_err(|_| "无法保存下载缓存。")?;
        if *cancel.borrow() || generation != state.generation.load(Ordering::SeqCst) {
            return Err("已取消下载。".into());
        }
        *target = Some(prepared);
    }
    Ok(result)
}
fn prepared(state: &RepositoryState, token: &str) -> Result<Arc<Prepared>, String> {
    state
        .prepared
        .lock()
        .map_err(|_| "无法读取工具包。")?
        .as_ref()
        .filter(|value| value.token == token)
        .cloned()
        .ok_or("下载缓存已释放，请重新下载。".into())
}

#[tauri::command]
pub fn repository_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RepositoryState>,
    request_id: String,
) -> Result<(), String> {
    scope(&window)?;
    if request_id.len() > 64 {
        return Err("取消请求无效。".into());
    }
    let job = state.job.lock().map_err(|_| "无法取消下载。")?;
    if let Some((_, sender)) = job.as_ref().filter(|(id, _)| id == &request_id) {
        let _ = sender.send(true);
    } else {
        let mut cancelled = state.cancelled.lock().map_err(|_| "无法取消下载。")?;
        if cancelled.len() >= 64 {
            cancelled.remove(0);
        };
        cancelled.push(request_id);
    }
    Ok(())
}
#[tauri::command]
pub fn repository_release(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RepositoryState>,
    token: String,
) -> Result<(), String> {
    scope(&window)?;
    let mut current = state.prepared.lock().map_err(|_| "无法释放缓存。")?;
    if current.as_ref().is_some_and(|value| value.token == token) {
        *current = None;
    }
    Ok(())
}
#[tauri::command]
pub async fn repository_save(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RepositoryState>,
    token: String,
    path: String,
) -> Result<(), String> {
    scope(&window)?;
    let _permit = state
        .operation
        .clone()
        .try_acquire_owned()
        .map_err(|_| "当前已有工具包操作。")?;
    let data = prepared(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || file_sessions::write_selected(&path, &data.bytes))
        .await
        .map_err(|_| "工具包保存线程失败。")?
}
#[tauri::command]
pub async fn repository_install(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RepositoryState>,
    token: String,
    allow_network: bool,
    expected_version: Option<String>,
) -> Result<modules::ModuleSummary, String> {
    scope(&window)?;
    let _permit = state
        .operation
        .clone()
        .try_acquire_owned()
        .map_err(|_| "当前已有工具包操作。")?;
    let data = prepared(&state, &token)?;
    if data.inspection_error.is_some() {
        return Err("工具包未通过检查，不能安装。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let package = modules::unpack_package_full(&data.bytes, true)?;
        let manifest = modules::parse_record(&package.record)?;
        if !manifest
            .platforms
            .iter()
            .any(|value| value == std::env::consts::OS)
        {
            return Err("此工具包不支持当前平台。".into());
        }
        if !manifest.network.hosts.is_empty() && !allow_network {
            return Err("请先确认工具包的联网来源。".into());
        }
        crate::validate_module_entries(&package.record, &manifest)?;
        let state = app.try_state::<AppState>().ok_or("应用尚未准备好。")?;
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        let current = crate::tool_module_record(&store, &manifest.module_id)?
            .map(|record| modules::parse_record(&record).map(|value| value.version))
            .transpose()?;
        if current != expected_version {
            return Err("本机工具版本已变化，请重新检查后安装。".into());
        }
        crate::install_tool_module_resources(&store, &package.record, &manifest, &package.resources)
    })
    .await
    .map_err(|_| "工具包安装线程失败。")?
}

pub fn clear(app: &tauri::AppHandle) -> u64 {
    let Some(state) = app.try_state::<RepositoryState>() else {
        return 0;
    };
    let Ok(_write) = state.disk_write.lock() else {
        return 0;
    };
    let Ok(mut catalog) = state.catalog.lock() else {
        return 0;
    };
    let Ok(mut prepared) = state.prepared.lock() else {
        return 0;
    };
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(job) = state.job.lock() {
        if let Some((_, sender)) = job.as_ref() {
            let _ = sender.send(true);
        }
    }
    *catalog = None;
    prepared
        .take()
        .map(|value| value.bytes.len() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tree() -> serde_json::Value {
        serde_json::json!({"truncated":false,"tree":[
            {"path":"效率工具/demo.tool-1.2.3.fftool","type":"blob","mode":"100644","sha":"0123456789abcdef0123456789abcdef01234567","size":123},
            {"path":"README.md","type":"blob","mode":"100644","sha":"0123456789abcdef0123456789abcdef01234567","size":12},
            {"path":"link.fftool","type":"blob","mode":"120000","sha":"0123456789abcdef0123456789abcdef01234567","size":12}
        ]})
    }
    #[test]
    fn catalog_reads_nested_packages_and_ignores_non_files() {
        let entries = parse_tree(&tree()).unwrap().entries;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].category, "效率工具");
        assert_eq!(entries[0].module_id_hint.as_deref(), Some("demo.tool"));
        assert_eq!(entries[0].version_hint.as_deref(), Some("1.2.3"));
        for path in [
            "../bad.fftool",
            "/bad.fftool",
            "group/../bad.fftool",
            "group\\bad.fftool",
            "bad\n.fftool",
        ] {
            assert!(!valid_path(path));
        }
        let mut value = tree();
        value["truncated"] = true.into();
        assert!(parse_tree(&value).is_err());
    }
    #[test]
    fn invalid_packages_are_isolated_and_reported_without_hiding_valid_tools() {
        let mut value = tree();
        for (name, size, sha) in [
            (
                "empty",
                serde_json::json!(0),
                serde_json::json!("0123456789abcdef0123456789abcdef01234567"),
            ),
            (
                "large",
                serde_json::json!(modules::MAX_PACKAGE_BYTES + 1),
                serde_json::json!("0123456789abcdef0123456789abcdef01234567"),
            ),
            (
                "unknown-size",
                serde_json::json!(null),
                serde_json::json!("0123456789abcdef0123456789abcdef01234567"),
            ),
            (
                "bad-sha",
                serde_json::json!(12),
                serde_json::json!("invalid"),
            ),
        ] {
            value["tree"].as_array_mut().unwrap().push(serde_json::json!({
                "path":format!("{name}.fftool"), "type":"blob", "mode":"100644", "size":size, "sha":sha
            }));
        }
        let parsed = parse_tree(&value).unwrap();
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.skipped_entries.len(), 4);
        assert_eq!(parsed.skipped_entries[0].path, "empty.fftool");
        assert!(parsed.skipped_entries[0].reason.contains("为空"));
        value["tree"][0]["size"] = 0.into();
        let parsed = parse_tree(&value).unwrap();
        assert!(parsed.entries.is_empty());
        assert_eq!(parsed.skipped_entries.len(), 5);
        value["tree"] = serde_json::json!(vec![value["tree"][0].clone(); MAX_ENTRIES + 1]);
        assert!(parse_tree(&value).is_err());
    }
    #[test]
    fn pinned_urls_encode_paths_and_cannot_redirect_to_arbitrary_hosts() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        let url = raw(commit, "效率工具/hello world#?.fftool");
        assert_eq!(url.host_str(), Some("raw.githubusercontent.com"));
        assert!(url.as_str().contains("%20"));
        assert!(url.as_str().contains("%23%3F"));
        assert_eq!(
            routed(&url, Provider::Ghproxy).host_str(),
            Some("gh-proxy.com")
        );
        let cdn = routed(&url, Provider::Jsdelivr);
        assert!(cdn.as_str().contains(&format!("FFTools@{commit}/")));
        assert!(cdn.as_str().contains("%20"));
        for address in [
            "http://github.com/",
            "https://github.com.evil.example/",
            "https://127.0.0.1/",
            "https://user:password@api.github.com/",
        ] {
            assert!(!allowed_redirect(&Url::parse(address).unwrap()));
        }
        assert!(allowed_redirect(
            &Url::parse("https://raw.githubusercontent.com/").unwrap()
        ));
    }
    #[test]
    fn git_blob_verification_rejects_wrong_sizes_and_corrupted_payloads() {
        let bytes = b"package-data";
        let mut entry = parse_tree(&tree()).unwrap().entries.remove(0);
        entry.size = bytes.len() as u64;
        let mut hash = Sha1::new();
        hash.update(format!("blob {}\0", bytes.len()));
        hash.update(bytes);
        entry.sha = format!("{:x}", hash.finalize());
        assert!(verify(bytes, &entry).is_ok());
        assert!(verify(b"package-datb", &entry).is_err());
        assert!(verify(b"package", &entry).is_err());
    }
    #[test]
    fn route_selection_is_explicit_and_large_files_skip_the_cdn() {
        assert_eq!(metadata_routes(Route::Github).len(), 1);
        assert_eq!(metadata_routes(Route::Ghproxy).len(), 1);
        assert_eq!(file_routes(Route::Auto, 1024).len(), 4);
        assert_eq!(file_routes(Route::Auto, 21 * 1024 * 1024).len(), 3);
        assert_eq!(hints("plain-name.fftool"), (None, None));
        assert_eq!(
            hints("example.tool-1.2.3-beta.1.fftool").1.as_deref(),
            Some("1.2.3-beta.1")
        );
    }
    #[tokio::test]
    async fn real_http_json_handles_failures_and_bounded_responses() {
        use std::io::{Read, Write};
        for (status, body, valid) in [
            (
                "200 OK",
                br#"{"object":{"sha":"0123456789abcdef0123456789abcdef01234567"}}"#.as_slice(),
                true,
            ),
            ("403 Forbidden", b"limited".as_slice(), false),
            ("200 OK", b"<html>not json</html>".as_slice(), false),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
            let response = [
                format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .into_bytes(),
                body.to_vec(),
            ]
            .concat();
            let handle = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0; 4096];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(&response);
            });
            assert_eq!(
                json(&client().unwrap(), url, Route::Github).await.is_ok(),
                valid
            );
            handle.join().unwrap();
        }
    }
}
