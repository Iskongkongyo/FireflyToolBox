use crate::web_request::{self, RequestError};
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use x509_parser::{extensions::GeneralName, prelude::*};

#[derive(Debug)]
struct InspectVerifier {
    strict: Arc<dyn ServerCertVerifier>,
    status: Arc<Mutex<Option<String>>>,
}
impl ServerCertVerifier for InspectVerifier {
    fn verify_server_cert(
        &self,
        leaf: &CertificateDer<'_>,
        chain: &[CertificateDer<'_>],
        name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let result = self.strict.verify_server_cert(leaf, chain, name, ocsp, now);
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(result.err().map(|e| e.to_string()).unwrap_or_default());
        // Inspection sends no HTTP request or credentials. Keep handshake-signature verification below.
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.strict.verify_tls12_signature(message, cert, dss)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.strict.verify_tls13_signature(message, cert, dss)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.strict.supported_verify_schemes()
    }
}
#[derive(Serialize)]
pub struct CertificateInfo {
    host: String,
    port: u16,
    subject: String,
    issuer: String,
    serial: String,
    domains: Vec<String>,
    not_before: i64,
    not_after: i64,
    valid_now: bool,
    days_remaining: i64,
    hostname_matches: bool,
    trusted: bool,
    trust_error: String,
    fingerprint_sha256: String,
    signature_algorithm: String,
    public_key_algorithm: String,
    tls_version: String,
    cipher: String,
    chain_length: usize,
}
fn parse(
    der: &CertificateDer<'_>,
    name: &ServerName<'_>,
    host: String,
    port: u16,
    now: i64,
) -> Result<CertificateInfo, RequestError> {
    let (_, cert) = X509Certificate::from_der(der.as_ref()).map_err(|_| {
        RequestError::new("TLS_CERT_INVALID", "服务器证书不是可解析的 X.509 证书。")
    })?;
    let mut domains = vec![];
    if let Some(san) = cert
        .subject_alternative_name()
        .map_err(|_| RequestError::new("TLS_CERT_INVALID", "证书域名扩展无效。"))?
    {
        for item in &san.value.general_names {
            match item {
                GeneralName::DNSName(value) => domains.push(value.to_string()),
                GeneralName::IPAddress(bytes) => {
                    if bytes.len() == 4 {
                        domains.push(
                            std::net::Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3])
                                .to_string(),
                        );
                    } else if bytes.len() == 16 {
                        let mut ip = [0u8; 16];
                        ip.copy_from_slice(bytes);
                        domains.push(std::net::Ipv6Addr::from(ip).to_string());
                    }
                }
                _ => {}
            }
        }
    }
    let not_before = cert.validity().not_before.timestamp();
    let not_after = cert.validity().not_after.timestamp();
    let hostname_matches = webpki::EndEntityCert::try_from(der)
        .is_ok_and(|cert| cert.verify_is_valid_for_subject_name(name).is_ok());
    Ok(CertificateInfo {
        host,
        port,
        subject: cert.subject().to_string(),
        issuer: cert.issuer().to_string(),
        serial: cert.raw_serial_as_string(),
        domains,
        not_before,
        not_after,
        valid_now: now >= not_before && now <= not_after,
        days_remaining: (not_after - now).div_euclid(86400),
        hostname_matches,
        trusted: false,
        trust_error: String::new(),
        fingerprint_sha256: Sha256::digest(der.as_ref())
            .iter()
            .map(|v| format!("{v:02X}"))
            .collect::<Vec<_>>()
            .join(":"),
        signature_algorithm: cert.signature_algorithm.algorithm.to_id_string(),
        public_key_algorithm: cert.public_key().algorithm.algorithm.to_id_string(),
        tls_version: String::new(),
        cipher: String::new(),
        chain_length: 0,
    })
}
pub async fn inspect(value: String, allowed: Vec<String>) -> Result<CertificateInfo, RequestError> {
    let url = web_request::checked_url(&value, &allowed)?;
    let _lease = web_request::acquire()?;
    tokio::time::timeout(Duration::from_secs(15), async {
        let host = match url
            .host()
            .ok_or_else(|| RequestError::new("TLS_URL_INVALID", "HTTPS 地址缺少域名。"))?
        {
            url::Host::Domain(host) => host.to_string(),
            url::Host::Ipv4(ip) => ip.to_string(),
            url::Host::Ipv6(ip) => ip.to_string(),
        };
        let port = url.port_or_known_default().unwrap_or(443);
        let name = ServerName::try_from(host.clone())
            .map_err(|_| RequestError::new("TLS_URL_INVALID", "域名或 IP 地址无效。"))?;
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let strict = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            provider.clone(),
        )
        .build()
        .map_err(|_| RequestError::new("TLS_FAILED", "无法准备证书验证。"))?;
        let status = Arc::new(Mutex::new(None));
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| RequestError::new("TLS_FAILED", "无法准备 TLS 协议。"))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(InspectVerifier {
                strict,
                status: status.clone(),
            }))
            .with_no_client_auth();
        let socket = tokio::net::TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|_| {
                RequestError::new(
                    "TLS_CONNECT_FAILED",
                    "无法连接服务器，请检查域名、端口与网络。",
                )
            })?;
        let stream = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name.clone(), socket)
            .await
            .map_err(|_| {
                RequestError::new(
                    "TLS_HANDSHAKE_FAILED",
                    "TLS 握手失败，服务器可能未开启 TLS 或协议不兼容。",
                )
            })?;
        let session = &stream.get_ref().1;
        let chain = session
            .peer_certificates()
            .ok_or_else(|| RequestError::new("TLS_NO_CERT", "服务器没有提供证书。"))?;
        if chain.len() > 16 || chain.iter().map(|c| c.len()).sum::<usize>() > 256 * 1024 {
            return Err(RequestError::new("TLS_CERT_LIMIT", "服务器证书链过大。"));
        }
        let leaf = chain
            .first()
            .ok_or_else(|| RequestError::new("TLS_NO_CERT", "服务器没有提供证书。"))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let mut info = parse(leaf, &name, host, port, now)?;
        let checked = status
            .lock()
            .map_err(|_| RequestError::new("TLS_FAILED", "无法读取证书验证状态。"))?
            .clone();
        info.trusted = checked.as_ref().is_some_and(String::is_empty);
        info.trust_error = checked.unwrap_or_else(|| "未取得验证结果。".into());
        info.tls_version = session
            .protocol_version()
            .map(|value| format!("{value:?}"))
            .unwrap_or_default();
        info.cipher = session
            .negotiated_cipher_suite()
            .map(|value| format!("{:?}", value.suite()))
            .unwrap_or_default();
        info.chain_length = chain.len();
        Ok(info)
    })
    .await
    .map_err(|_| RequestError::new("TLS_TIMEOUT", "证书查询超过 15 秒，请检查网络和端口。"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn certificate_metadata_preserves_san_dates_and_exact_hostname_rules() {
        let key = rcgen::KeyPair::generate().unwrap();
        let params = rcgen::CertificateParams::new(vec![
            "localhost".into(),
            "*.example.test".into(),
            "127.0.0.1".into(),
        ])
        .unwrap();
        let certificate = params.self_signed(&key).unwrap();
        let name = ServerName::try_from("app.example.test").unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let info = parse(
            certificate.der(),
            &name,
            "app.example.test".into(),
            443,
            now,
        )
        .unwrap();
        assert!(info.hostname_matches && info.valid_now);
        assert!(info.domains.contains(&"127.0.0.1".into()));
        assert_eq!(info.fingerprint_sha256.split(':').count(), 32);
        let nested = ServerName::try_from("deep.app.example.test").unwrap();
        assert!(
            !parse(
                certificate.der(),
                &nested,
                "deep.app.example.test".into(),
                443,
                now
            )
            .unwrap()
            .hostname_matches
        );
        assert!(
            !parse(
                certificate.der(),
                &name,
                "app.example.test".into(),
                443,
                info.not_after + 1
            )
            .unwrap()
            .valid_now
        );
    }
    #[test]
    fn loopback_tls_inspection_reads_untrusted_certificate_without_sending_http() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let key = rcgen::KeyPair::generate().unwrap();
            let cert = rcgen::CertificateParams::new(vec!["localhost".into()])
                .unwrap()
                .self_signed(&key)
                .unwrap();
            let config = rustls::ServerConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![cert.der().clone()],
                rustls::pki_types::PrivateKeyDer::Pkcs8(key.serialize_der().into()),
            )
            .unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let (socket, _) = listener.accept().await.unwrap();
                let mut tls = tokio_rustls::TlsAcceptor::from(Arc::new(config))
                    .accept(socket)
                    .await
                    .unwrap();
                let mut bytes = [0u8; 64];
                let read = tls.read(&mut bytes).await;
                assert!(!matches!(read,Ok(count)if count>0));
            });
            let url = format!("https://{address}");
            let info = inspect(url.clone(), vec![url]).await.unwrap();
            assert!(!info.trusted);
            assert!(!info.hostname_matches);
            assert!(!info.trust_error.is_empty());
            assert_eq!(info.chain_length, 1);
            server.await.unwrap();
        });
    }
    #[test]
    #[ignore = "requires a live HTTPS connection"]
    fn live_certificate_inspection() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let info = runtime
            .block_on(inspect(
                "https://www.baidu.com".into(),
                vec!["https://www.baidu.com".into()],
            ))
            .unwrap();
        assert!(info.hostname_matches);
        assert!(!info.subject.is_empty());
        assert!(!info.domains.is_empty());
        println!(
            "certificate host={}, trusted={}, valid_now={}",
            info.host, info.trusted, info.valid_now
        );
    }
}
