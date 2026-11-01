//! Android needs real HTTP for Worker random I/O: WebView protocol interception
//! loses POST bodies and can apply Range twice. Only loopback and opaque file
//! capabilities are served; no filesystem paths or general network proxy exist.
use crate::file_sessions::{self, FileSessions, CHUNK_BYTES};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::{Bytes, Incoming},
    server::conn::http1,
    service::service_fn,
    Request, Response,
};
use hyper_util::rt::TokioIo;
use rand::RngCore;
use std::{
    convert::Infallible,
    net::{Ipv4Addr, TcpListener},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Default)]
pub struct FileTransport(Mutex<Option<Server>>);

struct Server {
    base_url: String,
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FileTransport {
    pub fn start(&self, files: FileSessions) -> Result<String, String> {
        let mut server = self.0.lock().map_err(|_| "FILE_BUSY: 文件通道不可用。")?;
        if let Some(server) = server.as_ref() {
            return Ok(server.base_url.clone());
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "FILE_UNAVAILABLE: 无法创建本机文件通道。")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "FILE_UNAVAILABLE: 无法设置文件通道。")?;
        let address = listener
            .local_addr()
            .map_err(|_| "FILE_UNAVAILABLE: 文件通道地址不可用。")?;
        let mut token = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut token);
        let token: String = token.iter().map(|byte| format!("{byte:02x}")).collect();
        let authority = address.to_string();
        let base_url = format!("http://{authority}/{token}");
        let task = tauri::async_runtime::spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                return;
            };
            let permits = Arc::new(tokio::sync::Semaphore::new(16));
            while let Ok((stream, peer)) = listener.accept().await {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let Ok(permit) = permits.clone().try_acquire_owned() else {
                    continue;
                };
                let files = files.clone();
                let authority = authority.clone();
                let token = token.clone();
                tauri::async_runtime::spawn(async move {
                    let _permit = permit;
                    let service = service_fn(move |request| {
                        serve(request, files.clone(), authority.clone(), token.clone())
                    });
                    let _ = tokio::time::timeout(
                        Duration::from_secs(15),
                        http1::Builder::new()
                            .keep_alive(false)
                            .max_buf_size(16 * 1024)
                            .serve_connection(TokioIo::new(stream), service),
                    )
                    .await;
                });
            }
        });
        *server = Some(Server {
            base_url: base_url.clone(),
            task,
        });
        Ok(base_url)
    }
}

fn failure(status: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("valid HTTP status")
}

async fn serve(
    request: Request<Incoming>,
    files: FileSessions,
    authority: String,
    token: String,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let response = handle(request, files, &authority, &token).await;
    let mut response = response.map(|bytes| Full::new(Bytes::from(bytes)));
    let headers = response.headers_mut();
    headers.insert("access-control-allow-origin", "*".parse().unwrap());
    headers.insert(
        "access-control-allow-methods",
        "GET, HEAD, POST, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        "access-control-allow-headers",
        "Content-Type, Range".parse().unwrap(),
    );
    headers.insert(
        "access-control-allow-private-network",
        "true".parse().unwrap(),
    );
    headers.insert(
        "access-control-expose-headers",
        "Content-Range, Accept-Ranges, Content-Length"
            .parse()
            .unwrap(),
    );
    headers.insert("cache-control", "no-store".parse().unwrap());
    Ok(response)
}

async fn handle(
    request: Request<Incoming>,
    files: FileSessions,
    authority: &str,
    token: &str,
) -> Response<Vec<u8>> {
    if request
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        != Some(authority)
    {
        return failure(403);
    }
    let prefix = format!("/{token}/");
    let Some(path) = request.uri().path().strip_prefix(&prefix) else {
        return failure(404);
    };
    let Some((protocol, path)) = path.split_once('/') else {
        return failure(404);
    };
    if !matches!(protocol, "ff-file" | "ff-work") {
        return failure(404);
    }
    let uri = format!(
        "{protocol}://localhost/{path}{}",
        request
            .uri()
            .query()
            .map(|query| format!("?{query}"))
            .unwrap_or_default()
    );
    let Ok(uri) = uri.parse() else {
        return failure(400);
    };
    let protocol = protocol.to_owned();
    if request.method() == "OPTIONS" {
        return failure(204);
    }
    if request
        .headers()
        .get("content-length")
        .is_some_and(|value| {
            value
                .to_str()
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .is_none_or(|length| length > CHUNK_BYTES)
        })
    {
        return failure(413);
    }
    let (mut parts, body) = request.into_parts();
    let Ok(body) = Limited::new(body, CHUNK_BYTES).collect().await else {
        return failure(413);
    };
    parts.uri = uri;
    let request = Request::from_parts(parts, body.to_bytes().to_vec());
    tauri::async_runtime::spawn_blocking(move || {
        if protocol == "ff-file" {
            file_sessions::preview_response(&files, &request)
        } else {
            file_sessions::workspace_response(&files, &request)
        }
    })
    .await
    .unwrap_or_else(|_| failure(500))
}
