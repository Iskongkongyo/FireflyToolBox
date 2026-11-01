//! Short-lived IPv4 LAN transport. HTTP carries only SPAKE2 messages and AEAD ciphertext.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const MAX_SNAPSHOT: usize = 128 * 1024 * 1024;
const MAX_WIRE: usize = MAX_SNAPSHOT * 4 / 3 + 4096;
const CLIENT: &[u8] = b"firefly-lan-sync-v1-receiver";
const SERVER: &[u8] = b"firefly-lan-sync-v1-sender";

#[derive(Clone, Serialize)]
pub struct ShareInfo {
    pub addresses: Vec<String>,
    pub code: String,
    pub expires_at: u64,
}
#[derive(Clone, Serialize)]
pub struct ShareStatus {
    pub state: String,
    pub attempts_left: usize,
}
pub struct Sharing {
    pub info: ShareInfo,
    pub stop: AtomicBool,
    status: Mutex<ShareStatus>,
}
impl Sharing {
    pub fn status(&self) -> ShareStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub fn close(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
impl Drop for Sharing {
    fn drop(&mut self) {
        self.close();
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PairRequest {
    message: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PairReply {
    id: String,
    message: String,
    challenge: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FetchRequest {
    id: String,
    proof: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FetchReply {
    data: String,
}

pub fn local_ip(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local() || ip.is_loopback()
}
fn random_hex() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|v| format!("{v:02x}")).collect()
}
fn seal(key: &[u8], data: &[u8], purpose: &[u8]) -> Result<String, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "同步密钥无效。")?;
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: data,
                aad: purpose,
            },
        )
        .map_err(|_| "无法加密同步数据。")?;
    Ok(STANDARD.encode([nonce.as_slice(), &encrypted].concat()))
}
fn unseal(key: &[u8], value: &str, purpose: &[u8]) -> Result<Vec<u8>, String> {
    if value.len() > MAX_WIRE {
        return Err("同步数据过大。".into());
    }
    let bytes = STANDARD.decode(value).map_err(|_| "同步数据格式无效。")?;
    if bytes.len() < 40 {
        return Err("同步数据格式无效。".into());
    }
    XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| "同步密钥无效。")?
        .decrypt(
            XNonce::from_slice(&bytes[..24]),
            Payload {
                msg: &bytes[24..],
                aad: purpose,
            },
        )
        .map_err(|_| "配对码错误或数据校验失败，请核对后重试。".into())
}

pub fn start(data: Vec<u8>) -> Result<Arc<Sharing>, String> {
    if data.len() > MAX_SNAPSHOT {
        return Err("同步内容超过 128 MiB 快照额度，请减少同步项目或改用工具包导入。".into());
    }
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| "无法开启局域网同步，请检查网络或防火墙。")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法开启同步监听。")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法读取同步地址。")?
        .port();
    let mut addresses: Vec<_> = if_addrs::get_if_addrs()
        .map_err(|_| "无法读取本机局域网地址。")?
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            std::net::IpAddr::V4(ip) if local_ip(ip) && !ip.is_loopback() => {
                Some(format!("{ip}:{port}"))
            }
            _ => None,
        })
        .collect();
    addresses.sort();
    addresses.dedup();
    if addresses.is_empty() {
        return Err("未找到局域网 IPv4 地址，请连接 Wi-Fi、有线网络或手机热点。".into());
    }
    let code = format!("{:08}", OsRng.gen_range(0..100_000_000u32));
    let sharing = Arc::new(Sharing {
        info: ShareInfo {
            addresses,
            code,
            expires_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                + 600,
        },
        stop: AtomicBool::new(false),
        status: Mutex::new(ShareStatus {
            state: "waiting".into(),
            attempts_left: 5,
        }),
    });
    let thread_state = sharing.clone();
    std::thread::Builder::new()
        .name("firefly-lan-sync".into())
        .spawn(move || serve(listener, data, thread_state))
        .map_err(|_| "无法开启同步线程。")?;
    Ok(sharing)
}

fn read_request(stream: &mut TcpStream) -> Result<(String, Vec<u8>), String> {
    let started = Instant::now();
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 1024];
    let header_end = loop {
        if started.elapsed() > Duration::from_secs(5) {
            return Err("请求超时。".into());
        }
        let count = stream.read(&mut buffer).map_err(|_| "请求读取失败。")?;
        if count == 0 {
            return Err("请求不完整。".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            break index + 4;
        }
        if bytes.len() > 8192 {
            return Err("请求头过大。".into());
        }
    };
    if header_end > 8192 {
        return Err("请求头过大。".into());
    }
    let header = std::str::from_utf8(&bytes[..header_end]).map_err(|_| "请求头无效。")?;
    let mut lines = header.lines();
    let first = lines.next().ok_or("请求无效。")?;
    let path = match first {
        "POST /pair HTTP/1.1" => "/pair",
        "POST /fetch HTTP/1.1" => "/fetch",
        _ => return Err("请求入口无效。".into()),
    };
    let mut length = None;
    for line in lines.filter(|v| !v.is_empty()) {
        let (key, value) = line.split_once(':').ok_or("请求头无效。")?;
        match key.to_ascii_lowercase().as_str() {
            "content-length" if length.is_none() => {
                length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|_| "请求长度无效。")?,
                )
            }
            "content-length" | "transfer-encoding" | "origin" => {
                return Err("请求不受支持。".into())
            }
            _ => {}
        }
    }
    let length = length
        .filter(|n| *n > 0 && *n <= 4096)
        .ok_or("请求长度无效。")?;
    while bytes.len() < header_end + length {
        if started.elapsed() > Duration::from_secs(5) {
            return Err("请求超时。".into());
        }
        let count = stream.read(&mut buffer).map_err(|_| "请求读取失败。")?;
        if count == 0 {
            return Err("请求不完整。".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    if bytes.len() != header_end + length {
        return Err("请求长度不匹配。".into());
    }
    Ok((path.into(), bytes[header_end..].to_vec()))
}
fn reply(stream: &mut TcpStream, status: u16, data: &[u8]) -> std::io::Result<()> {
    write!(stream,"HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",if status==200{"OK"}else{"Bad Request"},data.len())?;
    stream.write_all(data)
}
fn serve(listener: TcpListener, data: Vec<u8>, sharing: Arc<Sharing>) {
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut pending: HashMap<String, (Vec<u8>, String, Instant)> = HashMap::new();
    let mut attempts = 0;
    while !sharing.stop.load(Ordering::Relaxed) && Instant::now() < deadline {
        pending.retain(|_, (_, _, at)| at.elapsed() < Duration::from_secs(60));
        let (mut stream, peer) = match listener.accept() {
            Ok(value) => value,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(75));
                continue;
            }
            Err(_) => break,
        };
        if !matches!(peer,SocketAddr::V4(addr) if local_ip(*addr.ip())) {
            continue;
        }
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
        let request = read_request(&mut stream);
        let result: Result<Vec<u8>, String> = (|| {
            if sharing.stop.load(Ordering::Relaxed) || Instant::now() >= deadline {
                return Err("同步已停止。".into());
            }
            let (path, body) = request?;
            if path == "/pair" {
                if attempts >= 5 {
                    return Err("配对尝试次数已用完，请发送端重新开启同步。".into());
                }
                attempts += 1;
                sharing
                    .status
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .attempts_left = 5 - attempts;
                let request: PairRequest =
                    serde_json::from_slice(&body).map_err(|_| "配对请求无效。")?;
                let incoming = STANDARD
                    .decode(request.message)
                    .map_err(|_| "配对请求无效。")?;
                let (state, outgoing) = Spake2::<Ed25519Group>::start_b(
                    &Password::new(sharing.info.code.as_bytes()),
                    &Identity::new(CLIENT),
                    &Identity::new(SERVER),
                );
                let key = state.finish(&incoming).map_err(|_| "配对请求无效。")?;
                let id = random_hex();
                let token = random_hex();
                let challenge = seal(&key, token.as_bytes(), b"challenge")?;
                pending.insert(id.clone(), (key, token, Instant::now()));
                serde_json::to_vec(&PairReply {
                    id,
                    message: STANDARD.encode(outgoing),
                    challenge,
                })
                .map_err(|_| "配对响应失败。".into())
            } else {
                let request: FetchRequest =
                    serde_json::from_slice(&body).map_err(|_| "同步请求无效。")?;
                let (key, token, _) = pending
                    .remove(&request.id)
                    .ok_or("配对已失效，请重新连接。")?;
                if unseal(&key, &request.proof, b"proof")? != token.as_bytes() {
                    return Err("配对校验失败。".into());
                }
                let response = serde_json::to_vec(&FetchReply {
                    data: seal(&key, &data, b"snapshot")?,
                })
                .map_err(|_| "同步响应失败。")?;
                sharing
                    .status
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .state = "transferring".into();
                Ok(response)
            }
        })();
        let is_transfer = sharing.status().state == "transferring";
        match result {
            Ok(body) => {
                let sent = reply(&mut stream, 200, &body).is_ok();
                if is_transfer {
                    sharing
                        .status
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .state = if sent { "sent" } else { "interrupted" }.into();
                    sharing.close();
                    break;
                }
            }
            Err(error) => {
                let _ = reply(
                    &mut stream,
                    400,
                    &serde_json::to_vec(&serde_json::json!({"error":error})).unwrap_or_default(),
                );
            }
        }
        if attempts >= 5 && pending.is_empty() {
            sharing
                .status
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .state = "locked".into();
            break;
        }
    }
    let mut status = sharing.status.lock().unwrap_or_else(|e| e.into_inner());
    if status.state == "waiting" {
        status.state = if Instant::now() >= deadline {
            "expired"
        } else {
            "stopped"
        }
        .into();
    }
    sharing.stop.store(true, Ordering::Relaxed);
}

fn address(value: &str) -> Result<SocketAddrV4, String> {
    let value = value
        .trim()
        .strip_prefix("http://")
        .unwrap_or(value.trim())
        .trim_end_matches('/');
    let addr = value
        .parse::<SocketAddrV4>()
        .map_err(|_| "请填写发送端显示的 IPv4 地址和端口，如 192.168.1.8:12345。")?;
    if !local_ip(*addr.ip()) || addr.port() == 0 {
        return Err("只能连接局域网 IPv4 地址。".into());
    }
    Ok(addr)
}
async fn post<T: Serialize, R: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    data: &T,
    limit: usize,
) -> Result<R, String> {
    let body = serde_json::to_vec(data).map_err(|_| "请求格式无效。")?;
    let mut response = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "无法连接发送端，请检查同一局域网、地址、防火墙和应用是否仍在前台。")?;
    let success = response.status().is_success();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "传输中断，请重新连接。")?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("同步响应超过大小上限。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !success {
        let message = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_owned));
        return Err(message
            .filter(|v| v.len() < 300)
            .unwrap_or_else(|| "发送端拒绝了同步请求，请重新配对。".into()));
    }
    serde_json::from_slice(&bytes).map_err(|_| "对方不是兼容的流萤百宝箱同步服务。".into())
}
pub async fn receive(endpoint: String, code: String) -> Result<Vec<u8>, String> {
    let addr = address(&endpoint)?;
    if code.len() != 8 || !code.bytes().all(|v| v.is_ascii_digit()) {
        return Err("请输入发送端的 8 位配对码。".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "无法创建同步连接。")?;
    let (state, outgoing) = Spake2::<Ed25519Group>::start_a(
        &Password::new(code.as_bytes()),
        &Identity::new(CLIENT),
        &Identity::new(SERVER),
    );
    let paired: PairReply = post(
        &client,
        &format!("http://{addr}/pair"),
        &PairRequest {
            message: STANDARD.encode(outgoing),
        },
        4096,
    )
    .await?;
    let key = state
        .finish(
            &STANDARD
                .decode(paired.message)
                .map_err(|_| "配对响应无效。")?,
        )
        .map_err(|_| "配对响应无效。")?;
    let token = unseal(&key, &paired.challenge, b"challenge")?;
    let response: FetchReply = post(
        &client,
        &format!("http://{addr}/fetch"),
        &FetchRequest {
            id: paired.id,
            proof: seal(&key, &token, b"proof")?,
        },
        MAX_WIRE,
    )
    .await?;
    let data = unseal(&key, &response.data, b"snapshot")?;
    if data.len() > MAX_SNAPSHOT {
        return Err("同步内容超过大小上限。".into());
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_cipher_rejects_wrong_code_tampering_and_wrong_message_type() {
        let (a, ma) = Spake2::<Ed25519Group>::start_a(
            &Password::new(b"12345678"),
            &Identity::new(CLIENT),
            &Identity::new(SERVER),
        );
        let (b, mb) = Spake2::<Ed25519Group>::start_b(
            &Password::new(b"12345678"),
            &Identity::new(CLIENT),
            &Identity::new(SERVER),
        );
        let ka = a.finish(&mb).unwrap();
        let kb = b.finish(&ma).unwrap();
        let encrypted = seal(&kb, b"private tools", b"snapshot").unwrap();
        assert_eq!(
            unseal(&ka, &encrypted, b"snapshot").unwrap(),
            b"private tools"
        );
        assert!(unseal(&ka, &encrypted, b"proof").is_err());
        assert!(unseal(&[1; 32], &encrypted, b"snapshot").is_err());
        let mut bytes = STANDARD.decode(&encrypted).unwrap();
        bytes[25] ^= 1;
        assert!(unseal(&ka, &STANDARD.encode(bytes), b"snapshot").is_err());
    }
    #[test]
    fn rejects_public_hosts_dns_and_bad_addresses() {
        for endpoint in [
            "8.8.8.8:1234",
            "example.com:1234",
            "192.168.1.2:0",
            "192.168.1.2:1234/x",
            "[::1]:1234",
        ] {
            assert!(address(endpoint).is_err());
        }
        assert!(address("192.168.1.2:1234").is_ok());
    }
    #[test]
    fn rejects_browser_requests_and_ambiguous_http_framing() {
        for header in [
            "Origin: http://evil.test\r\nContent-Length: 2",
            "Transfer-Encoding: chunked\r\nContent-Length: 2",
            "Content-Length: 2\r\nContent-Length: 2",
            "Content-Length: 999999",
        ] {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let addr = listener.local_addr().unwrap();
            let worker = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                read_request(&mut socket).is_err()
            });
            let mut client = TcpStream::connect(addr).unwrap();
            client
                .write_all(format!("POST /pair HTTP/1.1\r\n{header}\r\n\r\n{{}}").as_bytes())
                .unwrap();
            assert!(worker.join().unwrap());
        }
    }
    #[test]
    fn local_transfer_is_encrypted_authenticated_and_single_use() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = listener.local_addr().unwrap().to_string();
        let sharing = Arc::new(Sharing {
            info: ShareInfo {
                addresses: vec![endpoint.clone()],
                code: "12345678".into(),
                expires_at: 0,
            },
            stop: AtomicBool::new(false),
            status: Mutex::new(ShareStatus {
                state: "waiting".into(),
                attempts_left: 5,
            }),
        });
        let worker = sharing.clone();
        let thread = std::thread::spawn(move || serve(listener, b"test snapshot".to_vec(), worker));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(runtime
            .block_on(receive(endpoint.clone(), "87654321".into()))
            .is_err());
        assert_eq!(
            runtime
                .block_on(receive(endpoint, "12345678".into()))
                .unwrap(),
            b"test snapshot"
        );
        thread.join().unwrap();
        assert_eq!(sharing.status().state, "sent");
    }
}
