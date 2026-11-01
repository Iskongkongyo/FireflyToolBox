//! Cancelable HTTPS responses, pulled in bounded chunks by the trusted host.
use crate::web_request::{self, RequestError};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client, Method, Response,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{watch, Mutex as AsyncMutex},
    time::Instant,
};
use url::Url;

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const CHUNK_BYTES: usize = 256 * 1024;
#[derive(Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Options {
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub body_base64: Option<String>,
    pub timeout_ms: u64,
    pub max_response_bytes: usize,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            method: "GET".into(),
            headers: BTreeMap::new(),
            body_base64: None,
            timeout_ms: 15_000,
            max_response_bytes: 4 * 1024 * 1024,
        }
    }
}
struct Prepared {
    url: Url,
    allowed: Vec<String>,
    method: Method,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
}
fn invalid(code: &'static str, message: &str) -> RequestError {
    RequestError::new(code, message)
}
fn forbidden(name: &str) -> bool {
    matches!(
        name,
        "host"
            | "cookie"
            | "cookie2"
            | "set-cookie"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "upgrade"
            | "origin"
            | "referer"
            | "accept-encoding"
            | "te"
            | "trailer"
            | "keep-alive"
    ) || name.starts_with("proxy-")
        || name.starts_with("sec-")
}
fn prepare(url: &str, allowed: Vec<String>, options: &Options) -> Result<Prepared, RequestError> {
    let url = web_request::checked_url(url, &allowed)?;
    let method = match options.method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err(invalid("HTTP_METHOD_INVALID", "宿主请求支持 GET 和 POST。")),
    };
    if options.timeout_ms == 0
        || options.timeout_ms > 60_000
        || options.max_response_bytes == 0
        || options.max_response_bytes > MAX_BYTES
    {
        return Err(invalid(
            "HTTP_LIMIT_INVALID",
            "请求期限须在 1 至 60000 毫秒，响应额度须在 1 字节至 16 MiB。",
        ));
    }
    if options.headers.len() > 64 {
        return Err(invalid("HTTP_HEADER_INVALID", "请求头最多 64 项。"));
    }
    let mut headers = HeaderMap::new();
    let mut bytes = 0usize;
    for (name, value) in &options.headers {
        bytes = bytes.saturating_add(name.len()).saturating_add(value.len());
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| invalid("HTTP_HEADER_INVALID", "请求头名称无效。"))?;
        if forbidden(name.as_str()) || bytes > 16 * 1024 {
            return Err(invalid(
                "HTTP_HEADER_INVALID",
                "请求头超限或包含由宿主管理的字段。",
            ));
        }
        let value = HeaderValue::from_str(value)
            .map_err(|_| invalid("HTTP_HEADER_INVALID", "请求头值无效。"))?;
        headers.insert(name, value);
    }
    let body = if let Some(encoded) = &options.body_base64 {
        if method == Method::GET {
            return Err(invalid("HTTP_BODY_INVALID", "GET 请求不能携带正文。"));
        }
        if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
            return Err(invalid("HTTP_BODY_LIMIT", "请求正文最多 16 MiB。"));
        }
        let body = STANDARD
            .decode(encoded)
            .map_err(|_| invalid("HTTP_BODY_INVALID", "请求正文编码无效。"))?;
        if body.len() > MAX_BYTES {
            return Err(invalid("HTTP_BODY_LIMIT", "请求正文最多 16 MiB。"));
        }
        Some(body)
    } else {
        None
    };
    Ok(Prepared {
        url,
        allowed,
        method,
        headers,
        body,
    })
}
#[derive(Serialize)]
pub struct Metadata {
    pub status: u16,
    pub url: String,
    pub headers: Vec<(String, String)>,
}
struct Body {
    prepared: Option<Prepared>,
    response: Option<Response>,
    pending: Vec<u8>,
    offset: usize,
    received: usize,
}
struct Session {
    body: AsyncMutex<Body>,
    canceled: watch::Sender<bool>,
    deadline: Instant,
    max: usize,
    _lease: web_request::Lease,
}
#[derive(Clone, Default)]
pub struct HttpSessions {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    #[cfg(test)]
    client: Option<Client>,
}
fn canceled(session: &Session) -> RequestError {
    if Instant::now() >= session.deadline {
        invalid("HTTP_TIMEOUT", "HTTPS 请求已超过设置的期限。")
    } else {
        invalid("HTTP_CANCELED", "HTTPS 请求已取消。")
    }
}
fn network(error: reqwest::Error) -> RequestError {
    if error.is_timeout() {
        invalid("HTTP_TIMEOUT", "HTTPS 请求超时。")
    } else {
        invalid("HTTP_FAILED", "HTTPS 请求失败，请检查网络、证书或接口。")
    }
}
impl HttpSessions {
    pub fn create(
        &self,
        url: &str,
        allowed: Vec<String>,
        options: Options,
    ) -> Result<String, RequestError> {
        let prepared = prepare(url, allowed, &options)?;
        let lease = web_request::acquire()?;
        let mut random = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut random);
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let (sender, mut receiver) = watch::channel(false);
        let deadline = Instant::now() + Duration::from_millis(options.timeout_ms);
        let session = Arc::new(Session {
            body: AsyncMutex::new(Body {
                prepared: Some(prepared),
                response: None,
                pending: Vec::new(),
                offset: 0,
                received: 0,
            }),
            canceled: sender,
            deadline,
            max: options.max_response_bytes,
            _lease: lease,
        });
        self.sessions
            .lock()
            .map_err(|_| invalid("HTTP_FAILED", "请求会话不可用。"))?
            .insert(id.clone(), session);
        let owner = self.clone();
        let token = id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::select! { _ = tokio::time::sleep_until(deadline) => { owner.cancel(&token); }, _ = receiver.changed() => {} }
        });
        Ok(id)
    }
    fn session(&self, id: &str) -> Result<Arc<Session>, RequestError> {
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(invalid("HTTP_SESSION_INVALID", "请求会话编号无效。"));
        }
        self.sessions
            .lock()
            .map_err(|_| invalid("HTTP_FAILED", "请求会话不可用。"))?
            .get(id)
            .cloned()
            .ok_or_else(|| invalid("HTTP_SESSION_CLOSED", "请求会话已结束或超过期限。"))
    }
    pub fn cancel(&self, id: &str) -> bool {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(id));
        if let Some(session) = session {
            let _ = session.canceled.send(true);
            true
        } else {
            false
        }
    }
    fn client(&self) -> Result<Client, RequestError> {
        #[cfg(test)]
        if let Some(client) = &self.client {
            return Ok(client.clone());
        }
        Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .user_agent(concat!("FireflyToolbox/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| invalid("HTTP_FAILED", "无法创建 HTTPS 请求。"))
    }
    pub async fn start(&self, id: &str) -> Result<Metadata, RequestError> {
        let session = self.session(id)?;
        let result = async {
            let mut receiver = session.canceled.subscribe();
            if *receiver.borrow() || Instant::now() >= session.deadline {
                return Err(canceled(&session));
            }
            let mut body = session.body.lock().await;
            let request = body
                .prepared
                .take()
                .ok_or_else(|| invalid("HTTP_SESSION_INVALID", "请求已启动。"))?;
            let client = self.client()?;
            let (response, url) = tokio::select! {
                result = fetch(client, request) => result?,
                _ = receiver.changed() => return Err(canceled(&session)),
                _ = tokio::time::sleep_until(session.deadline) => return Err(canceled(&session)),
            };
            if response
                .content_length()
                .is_some_and(|length| length > session.max as u64)
            {
                return Err(invalid(
                    "HTTP_RESPONSE_LIMIT",
                    "接口响应超过设置的大小额度。",
                ));
            }
            if response.status().as_u16() < 200 {
                return Err(invalid("HTTP_STATUS_INVALID", "接口返回了不支持的状态。"));
            }
            let mut headers = Vec::new();
            let mut total = 0;
            for (name, value) in response.headers() {
                if matches!(name.as_str(), "set-cookie" | "set-cookie2") {
                    continue;
                }
                if let Ok(value) = value.to_str() {
                    total += name.as_str().len() + value.len();
                    if total > 65536 {
                        return Err(invalid("HTTP_HEADER_LIMIT", "响应头超过 64 KiB。"));
                    };
                    headers.push((name.as_str().to_owned(), value.to_owned()));
                }
            }
            if !headers.iter().any(|(name, _)| name == "content-type") {
                headers.push(("content-type".into(), "application/octet-stream".into()));
            }
            let metadata = Metadata {
                status: response.status().as_u16(),
                url: url.into(),
                headers,
            };
            body.response = Some(response);
            Ok(metadata)
        }
        .await;
        if result.is_err() {
            self.cancel(id);
        }
        result
    }
    pub async fn read(&self, id: &str) -> Result<Vec<u8>, RequestError> {
        let session = self.session(id)?;
        let result = async {
            let mut receiver = session.canceled.subscribe();
            if *receiver.borrow() || Instant::now() >= session.deadline { return Err(canceled(&session)); }
            let mut body = session.body.lock().await;
            while body.offset == body.pending.len() {
                let response = body.response.as_mut().ok_or_else(|| invalid("HTTP_SESSION_INVALID", "请求尚未返回响应头。"))?;
                let chunk = tokio::select! {
                    result = response.chunk() => result.map_err(network)?,
                    _ = receiver.changed() => return Err(canceled(&session)),
                    _ = tokio::time::sleep_until(session.deadline) => return Err(canceled(&session)),
                };
                let Some(chunk) = chunk else { return Ok(Vec::new()); };
                body.received = body.received.saturating_add(chunk.len());
                if body.received > session.max { return Err(invalid("HTTP_RESPONSE_LIMIT", "接口响应超过设置的大小额度。")); }
                body.pending = chunk.to_vec(); body.offset = 0;
            }
            let end = body.offset.saturating_add(CHUNK_BYTES).min(body.pending.len());
            let bytes = body.pending[body.offset..end].to_vec(); body.offset = end;
            Ok(bytes)
        }.await;
        if result.as_ref().map_or(true, Vec::is_empty) {
            self.cancel(id);
        }
        result
    }
}
async fn fetch(client: Client, mut request: Prepared) -> Result<(Response, Url), RequestError> {
    for hop in 0..=5 {
        web_request::checked_url(request.url.as_str(), &request.allowed)?;
        let mut builder = client
            .request(request.method.clone(), request.url.clone())
            .headers(request.headers.clone())
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        if let Some(body) = &request.body {
            builder = builder.body(body.clone());
        }
        if request.url.origin().ascii_serialization() == "https://weibo.com"
            && matches!(
                request.url.path(),
                "/ajax/side/hotSearch" | "/ajax/statuses/hot_band"
            )
        {
            builder = builder
                .header(reqwest::header::REFERER, "https://weibo.com/")
                .header(
                    reqwest::header::USER_AGENT,
                    concat!("Mozilla/5.0 FireflyToolbox/", env!("CARGO_PKG_VERSION")),
                );
        }
        let response = builder.send().await.map_err(network)?;
        let status = response.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
                if hop == 5 {
                    return Err(invalid("HTTP_REDIRECT_LIMIT", "接口重定向次数过多。"));
                }
                let target = request
                    .url
                    .join(
                        location
                            .to_str()
                            .map_err(|_| invalid("HTTP_URL_INVALID", "重定向地址无效。"))?,
                    )
                    .map_err(|_| invalid("HTTP_URL_INVALID", "重定向地址无效。"))?;
                web_request::checked_url(target.as_str(), &request.allowed)?;
                if request.method == Method::POST && matches!(status, 301..=303) {
                    request.method = Method::GET;
                    request.body = None;
                    for name in ["content-type", "content-language", "content-location"] {
                        request.headers.remove(name);
                    }
                }
                if target.origin() != request.url.origin() {
                    if request.body.as_ref().is_some_and(|body| !body.is_empty()) {
                        return Err(invalid(
                            "HTTP_REDIRECT_BODY",
                            "带正文的 POST 不向其他来源转发，请直接请求已声明的最终接口。",
                        ));
                    }
                    request.headers = request
                        .headers
                        .iter()
                        .filter(|(name, _)| {
                            matches!(
                                name.as_str(),
                                "accept" | "accept-language" | "content-type" | "content-language"
                            )
                        })
                        .map(|(name, value)| (name.clone(), value.clone()))
                        .collect();
                }
                request.url = target;
                continue;
            }
        }
        return Ok((response, request.url));
    }
    unreachable!()
}
fn scope(window: &tauri::WebviewWindow) -> Result<(), RequestError> {
    if window.label() != "main" {
        return Err(invalid("HTTP_SCOPE", "仅允许主界面管理 HTTPS 请求。"));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
#[tauri::command]
pub fn web_tool_http_create(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HttpSessions>,
    url: String,
    allowed_hosts: Vec<String>,
    options: Option<Options>,
) -> Result<String, RequestError> {
    scope(&window)?;
    state.create(&url, allowed_hosts, options.unwrap_or_default())
}
#[tauri::command]
pub async fn web_tool_http_start(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HttpSessions>,
    id: String,
) -> Result<Metadata, RequestError> {
    scope(&window)?;
    state.start(&id).await
}
#[tauri::command]
pub async fn web_tool_http_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HttpSessions>,
    id: String,
) -> Result<tauri::ipc::Response, RequestError> {
    scope(&window)?;
    state.read(&id).await.map(tauri::ipc::Response::new)
}
#[tauri::command]
pub fn web_tool_http_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HttpSessions>,
    id: String,
) -> Result<bool, RequestError> {
    scope(&window)?;
    Ok(state.cancel(&id))
}
