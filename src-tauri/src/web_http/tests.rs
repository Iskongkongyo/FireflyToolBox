use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Server {
    origin: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn server() -> Server {
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(
            include_bytes!("../../test-data/web-http/server.der").to_vec(),
        )],
        rustls::pki_types::PrivatePkcs8KeyDer::from(
            include_bytes!("../../test-data/web-http/server-key.der").to_vec(),
        )
        .into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut stream) = acceptor.accept(socket).await else {
                    return;
                };
                let mut input = Vec::new();
                let mut buffer = [0u8; 8192];
                let end = loop {
                    let Ok(count) = stream.read(&mut buffer).await else {
                        return;
                    };
                    if count == 0 {
                        return;
                    }
                    input.extend_from_slice(&buffer[..count]);
                    if let Some(end) = input.windows(4).position(|window| window == b"\r\n\r\n") {
                        break end + 4;
                    }
                    if input.len() > 65536 {
                        return;
                    }
                };
                let head = String::from_utf8_lossy(&input[..end]);
                let mut lines = head.lines();
                let line = lines.next().unwrap_or("");
                let method = line.split_whitespace().next().unwrap_or("").to_owned();
                let target = line.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let headers: BTreeMap<String, String> = lines
                    .filter_map(|line| {
                        line.split_once(':').map(|(name, value)| {
                            (name.to_ascii_lowercase(), value.trim().to_owned())
                        })
                    })
                    .collect();
                let length: usize = headers
                    .get("content-length")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                while input.len() - end < length {
                    let Ok(count) = stream.read(&mut buffer).await else {
                        return;
                    };
                    if count == 0 {
                        return;
                    };
                    input.extend_from_slice(&buffer[..count]);
                }
                let url = Url::parse(&format!("https://localhost{target}")).unwrap();
                if url.path() == "/slow-headers" {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                if url.path() == "/redirect" {
                    let params: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
                    let status = params.get("status").map(String::as_str).unwrap_or("302");
                    let location = params.get("to").map(String::as_str).unwrap_or("/echo");
                    let reply = format!("HTTP/1.1 {status} Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    let _ = stream.write_all(reply.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    return;
                }
                if url.path() == "/slow-body" {
                    let _ = stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\na",
                        )
                        .await;
                    let _ = stream.flush().await;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let _ = stream.write_all(b"b").await;
                    let _ = stream.shutdown().await;
                    return;
                }
                if let Some(length) = url
                    .path()
                    .strip_prefix("/chunked/")
                    .and_then(|value| value.parse::<usize>().ok())
                {
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await;
                    let bytes = vec![42u8; 16384];
                    for offset in (0..length).step_by(bytes.len()) {
                        let size = bytes.len().min(length - offset);
                        if stream
                            .write_all(format!("{size:x}\r\n").as_bytes())
                            .await
                            .is_err()
                            || stream.write_all(&bytes[..size]).await.is_err()
                            || stream.write_all(b"\r\n").await.is_err()
                        {
                            return;
                        }
                    }
                    let _ = stream.write_all(b"0\r\n\r\n").await;
                    let _ = stream.shutdown().await;
                    return;
                }
                let output = if let Some(size) = url
                    .path()
                    .strip_prefix("/bytes/")
                    .and_then(|value| value.parse::<usize>().ok())
                {
                    vec![42u8; size]
                } else if url.path() == "/count" {
                    serde_json::to_vec(&serde_json::json!({"length":length})).unwrap()
                } else {
                    serde_json::to_vec(&serde_json::json!({"method":method,"headers":headers,"body":STANDARD.encode(&input[end..end+length])})).unwrap()
                };
                let head = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: private=test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",output.len());
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&output).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    Server { origin, task }
}
fn sessions() -> HttpSessions {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .add_root_certificate(
            reqwest::Certificate::from_der(include_bytes!("../../test-data/web-http/root.der"))
                .unwrap(),
        )
        .build()
        .unwrap();
    HttpSessions {
        client: Some(client),
        ..Default::default()
    }
}
async fn response(
    sessions: &HttpSessions,
    url: &str,
    allowed: Vec<String>,
    options: Options,
) -> Result<(Metadata, Vec<u8>), RequestError> {
    let id = sessions.create(url, allowed, options)?;
    let metadata = sessions.start(&id).await?;
    let mut bytes = Vec::new();
    loop {
        let chunk = sessions.read(&id).await?;
        assert!(chunk.len() <= CHUNK_BYTES);
        if chunk.is_empty() {
            break;
        };
        bytes.extend(chunk);
    }
    Ok((metadata, bytes))
}
#[test]
fn request_options_reject_forbidden_headers_invalid_limits_and_oversized_bodies() {
    let origin = "https://example.com";
    let allowed = vec![origin.to_owned()];
    for name in [
        "Cookie",
        "HOST",
        "Origin",
        "Referer",
        "Sec-Fetch-Site",
        "Proxy-Authorization",
        "Content-Length",
        "Transfer-Encoding",
    ] {
        let options = Options {
            headers: BTreeMap::from([(name.into(), "x".into())]),
            ..Default::default()
        };
        assert_eq!(
            prepare(origin, allowed.clone(), &options)
                .err()
                .unwrap()
                .code,
            "HTTP_HEADER_INVALID"
        );
    }
    for options in [
        Options {
            timeout_ms: 0,
            ..Default::default()
        },
        Options {
            timeout_ms: 60001,
            ..Default::default()
        },
        Options {
            max_response_bytes: MAX_BYTES + 1,
            ..Default::default()
        },
        Options {
            max_response_bytes: 0,
            ..Default::default()
        },
    ] {
        assert!(prepare(origin, allowed.clone(), &options).is_err());
    }
    let mut options = Options {
        method: "POST".into(),
        body_base64: Some(STANDARD.encode(vec![42u8; MAX_BYTES])),
        ..Default::default()
    };
    assert_eq!(
        prepare(origin, allowed.clone(), &options)
            .unwrap()
            .body
            .unwrap()
            .len(),
        MAX_BYTES
    );
    options.body_base64 = Some(STANDARD.encode(vec![42u8; MAX_BYTES + 1]));
    assert_eq!(
        prepare(origin, allowed.clone(), &options)
            .err()
            .unwrap()
            .code,
        "HTTP_BODY_LIMIT"
    );
    options.method = "GET".into();
    options.body_base64 = Some(String::new());
    assert_eq!(
        prepare(origin, allowed, &options).err().unwrap().code,
        "HTTP_BODY_INVALID"
    );
}
#[tokio::test]
async fn https_streams_post_redirect_limits_cancellation_and_slot_reuse() {
    let a = server().await;
    let b = server().await;
    let sessions = sessions();
    let allowed = vec![a.origin.clone(), b.origin.clone()];
    let options = Options {
        method: "POST".into(),
        headers: BTreeMap::from([
            ("Authorization".into(), "Bearer test-only".into()),
            ("X-Api-Key".into(), "test-only".into()),
        ]),
        body_base64: Some(STANDARD.encode("中文 body")),
        ..Default::default()
    };
    let (metadata, bytes) = response(
        &sessions,
        &format!("{}/echo", a.origin),
        allowed.clone(),
        options.clone(),
    )
    .await
    .unwrap();
    assert!(!metadata
        .headers
        .iter()
        .any(|(name, _)| name == "set-cookie"));
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["method"], "POST");
    assert_eq!(value["headers"]["authorization"], "Bearer test-only");
    assert_eq!(
        STANDARD.decode(value["body"].as_str().unwrap()).unwrap(),
        "中文 body".as_bytes()
    );
    for code in [302, 303, 307, 308] {
        let url = format!("{}/redirect?status={code}&to=/echo", a.origin);
        let (_, bytes) = response(&sessions, &url, allowed.clone(), options.clone())
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            value["method"],
            if code == 302 || code == 303 {
                "GET"
            } else {
                "POST"
            }
        );
        assert_eq!(
            value["body"],
            if code == 302 || code == 303 {
                String::new()
            } else {
                STANDARD.encode("中文 body")
            }
        );
    }
    let mut redirect = Url::parse(&format!("{}/redirect", a.origin)).unwrap();
    redirect
        .query_pairs_mut()
        .append_pair("status", "307")
        .append_pair("to", &format!("{}/echo", b.origin));
    let id = sessions
        .create(redirect.as_str(), allowed.clone(), options.clone())
        .unwrap();
    assert_eq!(
        sessions.start(&id).await.err().unwrap().code,
        "HTTP_REDIRECT_BODY"
    );
    let get = Options {
        headers: options.headers.clone(),
        ..Default::default()
    };
    let (_, bytes) = response(&sessions, redirect.as_str(), allowed.clone(), get)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(value["headers"].get("authorization").is_none());
    assert!(value["headers"].get("x-api-key").is_none());
    let (_, bytes) = response(
        &sessions,
        &format!("{}/bytes/{MAX_BYTES}", a.origin),
        allowed.clone(),
        Options {
            max_response_bytes: MAX_BYTES,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(bytes.len(), MAX_BYTES);
    assert!(bytes.iter().all(|byte| *byte == 42));
    drop(bytes);
    for path in [
        format!("/bytes/{}", MAX_BYTES + 1),
        format!("/chunked/{}", MAX_BYTES + 1),
    ] {
        let error = response(
            &sessions,
            &format!("{}{path}", a.origin),
            allowed.clone(),
            Options {
                max_response_bytes: MAX_BYTES,
                ..Default::default()
            },
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, "HTTP_RESPONSE_LIMIT", "{path}");
    }
    let id = sessions
        .create(
            &format!("{}/slow-headers", a.origin),
            allowed.clone(),
            Options {
                timeout_ms: 50,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        sessions.start(&id).await.err().unwrap().code,
        "HTTP_TIMEOUT"
    );
    let id = sessions
        .create(
            &format!("{}/slow-body", a.origin),
            allowed.clone(),
            Options::default(),
        )
        .unwrap();
    sessions.start(&id).await.unwrap();
    let started = Instant::now();
    assert_eq!(sessions.read(&id).await.unwrap(), b"a");
    assert!(started.elapsed() < Duration::from_millis(700));
    let owner = sessions.clone();
    let token = id.clone();
    let reading = tokio::spawn(async move { owner.read(&token).await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(sessions.cancel(&id));
    assert_eq!(reading.await.unwrap().err().unwrap().code, "HTTP_CANCELED");
    let mut tokens = Vec::new();
    for _ in 0..4 {
        tokens.push(
            sessions
                .create(&a.origin, allowed.clone(), Options::default())
                .unwrap(),
        );
    }
    assert_eq!(
        sessions
            .create(&a.origin, allowed.clone(), Options::default())
            .err()
            .unwrap()
            .code,
        "HTTP_BUSY"
    );
    for token in tokens {
        assert!(sessions.cancel(&token));
    }
    let id = sessions
        .create(
            &a.origin,
            allowed.clone(),
            Options {
                timeout_ms: 20,
                ..Default::default()
            },
        )
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(sessions.start(&id).await.is_err());
    let strict = HttpSessions::default();
    let id = strict
        .create(&a.origin, allowed, Options::default())
        .unwrap();
    assert_eq!(strict.start(&id).await.err().unwrap().code, "HTTP_FAILED");
    assert!(sessions.sessions.lock().unwrap().is_empty());
}
