use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
use url::Url;

const MAX_BODY: usize = 4 * 1024 * 1024;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Serialize)]
pub struct RequestError {
    pub code: &'static str,
    pub message: String,
}
impl RequestError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
#[derive(Serialize)]
pub struct WebResponse {
    pub status: u16,
    pub url: String,
    pub content_type: String,
    pub body_base64: String,
}
#[derive(Serialize)]
pub struct LinkResolution {
    pub url: String,
    pub hops: Vec<String>,
    pub status: u16,
    pub http_stopped: bool,
}
fn link_destination(current: &Url, location: &str, hops: &[String]) -> Result<Url, RequestError> {
    let next = current
        .join(location)
        .map_err(|_| RequestError::new("HTTP_URL_INVALID", "跳转地址无效。"))?;
    if next.as_str().len() > 4096
        || next.host_str().is_none()
        || !matches!(next.scheme(), "http" | "https")
        || !next.username().is_empty()
        || next.password().is_some()
    {
        return Err(RequestError::new(
            "HTTP_URL_INVALID",
            "跳转包含不支持的协议、账号信息或过长地址。",
        ));
    }
    if hops.contains(&next.to_string()) {
        return Err(RequestError::new(
            "HTTP_REDIRECT_LOOP",
            "检测到循环跳转，已停止还原。",
        ));
    }
    Ok(next)
}
pub async fn resolve_link(
    value: String,
    allowed: Vec<String>,
) -> Result<LinkResolution, RequestError> {
    let url = checked_url(&value, &allowed)?;
    let _lease = acquire()?;
    tokio::time::timeout(Duration::from_secs(15), async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .build()
            .map_err(network_error)?;
        let mut current = url;
        let mut hops = vec![current.to_string()];
        for hop in 0..=5 {
            checked_url(current.as_str(), &allowed)?;
            let mut response = client
                .head(current.clone())
                .send()
                .await
                .map_err(network_error)?;
            if matches!(response.status().as_u16(), 405 | 501) {
                response = client
                    .get(current.clone())
                    .send()
                    .await
                    .map_err(network_error)?;
            }
            let status = response.status().as_u16();
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                if hop == 5 {
                    return Err(RequestError::new(
                        "HTTP_REDIRECT_LIMIT",
                        "跳转超过 5 次，已停止还原。",
                    ));
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| {
                        RequestError::new("HTTP_REDIRECT_INVALID", "服务器没有返回有效跳转地址。")
                    })?;
                let next = link_destination(&current, location, &hops)?;
                hops.push(next.to_string());
                if next.scheme() == "http" {
                    return Ok(LinkResolution {
                        url: next.to_string(),
                        hops,
                        status,
                        http_stopped: true,
                    });
                }
                current = next;
            } else {
                return Ok(LinkResolution {
                    url: current.to_string(),
                    hops,
                    status,
                    http_stopped: false,
                });
            }
        }
        unreachable!()
    })
    .await
    .map_err(|_| RequestError::new("HTTP_TIMEOUT", "短链还原超过 15 秒，请稍后重试。"))?
}
pub(crate) struct Lease;
impl Drop for Lease {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::Relaxed);
    }
}

pub(crate) fn checked_url(value: &str, allowed: &[String]) -> Result<Url, RequestError> {
    if value.len() > 4096 || allowed.len() > crate::modules::MAX_NETWORK_HOSTS {
        return Err(RequestError::new(
            "HTTP_URL_INVALID",
            "请求地址或允许来源无效。",
        ));
    }
    let url = Url::parse(value)
        .map_err(|_| RequestError::new("HTTP_URL_INVALID", "请输入完整的 HTTPS 请求地址。"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(RequestError::new(
            "HTTP_URL_INVALID",
            "只支持不含账号信息的 HTTPS 请求地址。",
        ));
    }
    let origin = url.origin().ascii_serialization();
    if !allowed
        .iter()
        .any(|host| host == &origin || host == "https://*")
    {
        return Err(RequestError::new(
            "HTTP_ORIGIN_DENIED",
            format!("请将 {origin} 加入“允许联网的 HTTPS 来源”。"),
        ));
    }
    Ok(url)
}

pub async fn get(value: String, allowed: Vec<String>) -> Result<WebResponse, RequestError> {
    let url = checked_url(&value, &allowed)?;
    let _lease = acquire()?;
    tokio::time::timeout(Duration::from_secs(15), get_inner(url, &allowed))
        .await
        .map_err(|_| RequestError::new("HTTP_TIMEOUT", "接口请求超过 15 秒，已停止。"))?
}
pub(crate) fn checked_external_url(value: &str, allowed: &[String]) -> Result<Url, RequestError> {
    // Browser opening requires an exact declared origin, including for tools
    // that separately have permission to resolve arbitrary HTTPS redirects.
    let url = checked_url(value, allowed)?;
    if !allowed
        .iter()
        .any(|host| host == &url.origin().ascii_serialization())
    {
        return Err(RequestError::new(
            "HTTP_ORIGIN_DENIED",
            "打开浏览器须声明确切的 HTTPS 来源。",
        ));
    }
    Ok(url)
}

pub(crate) fn acquire() -> Result<Lease, RequestError> {
    ACTIVE
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
            (count < 4).then_some(count + 1)
        })
        .map_err(|_| RequestError::new("HTTP_BUSY", "正在请求的接口过多，请稍后重试。"))?;
    Ok(Lease)
}

async fn get_inner(mut url: Url, allowed: &[String]) -> Result<WebResponse, RequestError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("FireflyToolbox/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| RequestError::new("HTTP_FAILED", "无法创建 HTTPS 请求。"))?;
    for hop in 0..=5 {
        checked_url(url.as_str(), allowed)?;
        let mut builder = client.get(url.clone());
        // These public feeds expect the same browser headers as their website.
        // Keep this compatibility behavior scoped; never add cookies or forward
        // the Referer to a redirect destination on another origin.
        if url.origin().ascii_serialization() == "https://weibo.com"
            && matches!(
                url.path(),
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
        let mut response = builder.send().await.map_err(network_error)?;
        let status = response.status();
        if matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
                if hop == 5 {
                    return Err(RequestError::new(
                        "HTTP_REDIRECT_LIMIT",
                        "接口重定向次数过多。",
                    ));
                }
                let location = location
                    .to_str()
                    .map_err(|_| RequestError::new("HTTP_FAILED", "接口重定向地址无效。"))?;
                url = url
                    .join(location)
                    .map_err(|_| RequestError::new("HTTP_URL_INVALID", "接口重定向地址无效。"))?;
                checked_url(url.as_str(), allowed)?;
                continue;
            }
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BODY as u64)
        {
            return Err(RequestError::new(
                "HTTP_RESPONSE_LIMIT",
                "接口响应超过 4 MiB。",
            ));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network_error)? {
            append_body(&mut bytes, &chunk)?;
        }
        return Ok(WebResponse {
            status: status.as_u16(),
            url: url.into(),
            content_type,
            body_base64: STANDARD.encode(bytes),
        });
    }
    Err(RequestError::new(
        "HTTP_REDIRECT_LIMIT",
        "接口重定向次数过多。",
    ))
}

fn append_body(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), RequestError> {
    if bytes.len().saturating_add(chunk.len()) > MAX_BODY {
        return Err(RequestError::new(
            "HTTP_RESPONSE_LIMIT",
            "接口响应超过 4 MiB。",
        ));
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

fn network_error(error: reqwest::Error) -> RequestError {
    if error.is_timeout() {
        RequestError::new("HTTP_TIMEOUT", "接口请求超时，请检查网络后重试。")
    } else {
        RequestError::new(
            "HTTP_FAILED",
            "HTTPS 请求失败，请检查网络、证书或接口是否可访问。",
        )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn external_browser_requires_exact_https_origin() {
        let hosts = vec!["https://github.com".to_string()];
        assert!(super::checked_external_url(
            "https://github.com/owner/repo/releases/download/v1/app.zip",
            &hosts
        )
        .is_ok());
        for value in [
            "http://github.com/a",
            "https://user:pass@github.com/a",
            "https://github.com:444/a",
            "https://github.com.evil.test/a",
            "file:///test",
        ] {
            assert!(super::checked_external_url(value, &hosts).is_err());
        }
        assert!(
            super::checked_external_url("https://other.example/a", &["https://*".to_string()])
                .is_err()
        );
    }
    use super::*;
    #[test]
    fn all_64_declared_origins_are_usable_and_65_are_rejected() {
        let mut hosts: Vec<String> = (0..64)
            .map(|index| format!("https://host{index}.example.com"))
            .collect();
        for host in &hosts {
            let value = format!("{host}/download?name=test");
            assert!(checked_url(&value, &hosts).is_ok());
            assert!(checked_external_url(&value, &hosts).is_ok());
        }
        assert_eq!(
            checked_url("https://undeclared.example.com/", &hosts)
                .unwrap_err()
                .code,
            "HTTP_ORIGIN_DENIED"
        );
        hosts.push("https://extra.example.com".into());
        assert_eq!(
            checked_url("https://host63.example.com/", &hosts)
                .unwrap_err()
                .code,
            "HTTP_URL_INVALID"
        );
        assert!(checked_external_url("https://host63.example.com/", &hosts).is_err());
    }

    #[test]
    fn link_destinations_handle_relative_locations_and_reject_unsafe_or_cyclic_targets() {
        let current = Url::parse("https://example.com/short/a").unwrap();
        let hops = vec![current.to_string()];
        assert_eq!(
            link_destination(&current, "../target", &hops)
                .unwrap()
                .as_str(),
            "https://example.com/target"
        );
        assert_eq!(
            link_destination(&current, "http://example.net/target", &hops)
                .unwrap()
                .scheme(),
            "http"
        );
        for location in [
            "javascript:alert(1)",
            "file:///x",
            "https://user:password@example.net/",
            current.as_str(),
        ] {
            assert!(link_destination(&current, location, &hops).is_err());
        }
    }
    #[tokio::test]
    #[ignore = "requires a live Frankfurter reference exchange-rate service"]
    async fn live_reference_exchange_rate() {
        let allowed = vec!["https://api.frankfurter.dev".to_owned()];
        let response = get(
            "https://api.frankfurter.dev/v2/rate/USD/CNY".into(),
            allowed.clone(),
        )
        .await
        .unwrap();
        assert_eq!(response.status, 200);
        let value: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
        assert_eq!(value["base"], "USD");
        assert_eq!(value["quote"], "CNY");
        assert!(value["rate"].as_f64().unwrap() > 0.0);
        assert_eq!(value["date"].as_str().unwrap().len(), 10);
        let response = get("https://api.frankfurter.dev/v2/currencies".into(), allowed)
            .await
            .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
        assert!(value
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["iso_code"] == "CNY"));
        let response = get(
            "https://api.frankfurter.dev/v2/rates?base=CNY".into(),
            vec!["https://api.frankfurter.dev".to_owned()],
        )
        .await
        .unwrap();
        assert_eq!(response.status, 200);
        let value: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
        let rows = value.as_array().unwrap();
        assert!(rows.len() > 100);
        assert!(rows.iter().all(|row| row["base"] == "CNY"));
        assert!(rows.iter().any(|row| row["quote"] == "USD"));
    }

    #[tokio::test]
    #[ignore = "requires live public fuel and gold price services"]
    async fn live_fuel_and_gold_quotes() {
        for (url, kind) in [
            (
                "https://60s.7se.cn/v2/fuel-price?region=%E4%B8%8A%E6%B5%B7",
                "fuel",
            ),
            ("https://60s.7se.cn/v2/gold-price", "gold"),
            ("https://api.gold-api.com/price/XAU", "spot"),
        ] {
            let origin = Url::parse(url).unwrap().origin().ascii_serialization();
            let response = get(url.into(), vec![origin]).await.unwrap();
            assert_eq!(response.status, 200);
            let value: serde_json::Value =
                serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
            let data = value.get("data").unwrap_or(&value);
            match kind {
                "fuel" => {
                    assert!(data["region"].as_str().unwrap().contains("上海"));
                    assert!(data["items"].as_array().unwrap().len() >= 3);
                }
                "gold" => {
                    assert!(!data["metals"].as_array().unwrap().is_empty());
                    assert!(!data["stores"].as_array().unwrap().is_empty());
                }
                _ => {
                    assert_eq!(data["symbol"], "XAU");
                    assert!(data["price"].as_f64().unwrap() > 0.0);
                }
            }
        }
    }

    #[tokio::test]
    #[ignore = "requires a live public Ulvis service"]
    async fn live_ulvis_shortening_and_official_lookup() {
        let allowed = vec!["https://ulvis.net".to_owned()];
        let response = get(
            "https://ulvis.net/API/write/get?url=https%3A%2F%2Fsaucenao.com%2F&type=json&private=1"
                .into(),
            allowed.clone(),
        )
        .await
        .unwrap();
        assert_eq!(response.status, 200);
        let data: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
        assert_eq!(data["success"], true);
        let short = Url::parse(data["data"]["url"].as_str().unwrap()).unwrap();
        assert_eq!(short.host_str(), Some("ulvis.net"));
        let response = get(
            format!(
                "https://ulvis.net/API/read/get?id={}&type=json",
                short.path().trim_start_matches('/')
            ),
            allowed,
        )
        .await
        .unwrap();
        let data: serde_json::Value =
            serde_json::from_slice(&STANDARD.decode(response.body_base64).unwrap()).unwrap();
        assert_eq!(data["success"], true);
        assert_eq!(data["data"]["full"], "https://saucenao.com/");
    }

    #[tokio::test]
    #[ignore = "requires a live HTTPS shortening service"]
    async fn live_short_link_resolution_without_body_read() {
        let resolved = resolve_link("https://is.gd/AG3Hwv".into(), vec!["https://*".into()])
            .await
            .unwrap();
        assert!(
            resolved.url.starts_with("https://example.com"),
            "{}",
            resolved.url
        );
        assert!(resolved.hops.len() > 1);
    }
    #[tokio::test]
    #[ignore = "requires live public word and poem services"]
    async fn live_anonymous_baidu_words_and_acrostic() {
        for(url,host,key)in [("https://fanyi.baidu.com/sug?kw=hello","https://fanyi.baidu.com","data"),("https://api.tangdouz.com/a/cts/cts.php?nr=%E6%B5%81%E8%90%A4%E5%B7%A5%E5%85%B7&return=json","https://api.tangdouz.com","lines")]{
            let response=get(url.into(),vec![host.into()]).await.unwrap();assert_eq!(response.status,200);
            let body=STANDARD.decode(response.body_base64).unwrap();let value:serde_json::Value=serde_json::from_slice(&body).unwrap();
            assert!(!value[key].as_array().unwrap().is_empty());
        }
    }
    #[test]
    fn response_limit_applies_to_accumulated_chunks_without_accepting_excess() {
        let mut body = vec![0; MAX_BODY - 2];
        append_body(&mut body, &[1, 2]).unwrap();
        assert_eq!(body.len(), MAX_BODY);
        assert_eq!(
            append_body(&mut body, &[3]).unwrap_err().code,
            "HTTP_RESPONSE_LIMIT"
        );
        assert_eq!(body.len(), MAX_BODY);
    }
    #[test]
    #[ignore = "requires a live HTTPS connection"]
    fn live_https_request_works_without_browser_cors() {
        let value = std::env::var("FIREFLY_NETWORK_TEST_URL")
            .unwrap_or_else(|_| "https://www.baidu.com".into());
        let origin = Url::parse(&value).unwrap().origin().ascii_serialization();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let response = runtime.block_on(get(value, vec![origin])).unwrap();
        let bytes = STANDARD.decode(response.body_base64).unwrap();
        assert!(!bytes.is_empty());
        assert!(bytes.len() <= MAX_BODY);
        println!(
            "HTTPS status={}, response_bytes={}, content_type={}",
            response.status,
            bytes.len(),
            response.content_type
        );
    }
    #[test]
    fn request_and_redirect_origins_require_exact_https_allowlist_matches() {
        let allowed = vec!["https://api.example.com".into()];
        assert!(checked_url("https://api.example.com/path?q=1", &allowed).is_ok());
        for url in [
            "http://api.example.com",
            "https://api.example.com.evil.test",
            "https://api.example.com:8443",
            "https://user:pass@api.example.com",
            "file:///secret",
            "https://other.example.com",
        ] {
            assert!(checked_url(url, &allowed).is_err(), "{url}");
        }
        assert!(checked_url("https://api.example.com", &[]).is_err());
        let redirect = checked_url("https://api.example.com/a", &allowed)
            .unwrap()
            .join("https://other.example.com/b")
            .unwrap();
        assert_eq!(
            checked_url(redirect.as_str(), &allowed).unwrap_err().code,
            "HTTP_ORIGIN_DENIED"
        );
    }
    #[test]
    #[ignore = "requires a live RDAP service"]
    fn live_rdap_lookup_follows_authoritative_https_redirects() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let response = runtime
            .block_on(get(
                "https://rdap.org/domain/example.com".into(),
                vec!["https://*".into()],
            ))
            .unwrap();
        assert_eq!(response.status, 200);
        let bytes = STANDARD.decode(response.body_base64).unwrap();
        let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(data["objectClassName"], "domain");
        assert!(response.url.starts_with("https://"));
        println!(
            "RDAP status={}, authoritative_url={}",
            response.status, response.url
        );
    }
}
