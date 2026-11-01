// src-tauri/builtin-tools/src/common.js
var $ = (id) => document.getElementById(id);
function status(text2, error = false) {
  $("status").textContent = text2;
  $("status").classList.toggle("error", error);
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function copyButton(id, getText, copyText) {
  $(id).onclick = async () => {
    try {
      const value = getText();
      if (!value) {
        status("请先生成或读取结果。");
        return;
      }
      await copyText(value);
      status("已复制。");
    } catch (error) {
      status(error.message || String(error), true);
    }
  };
}
function httpsURL(value) {
  const raw = value.trim();
  if (!raw) throw new Error("请输入域名或 HTTPS 地址。");
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("地址格式无效，请填写域名或完整 HTTPS 地址。");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("仅支持不含账号信息的 HTTPS 地址。");
  return url;
}
function operation(signal) {
  let controller;
  return { start() {
    controller?.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    return controller.signal;
  }, cancel() {
    controller?.abort();
  }, dispose() {
    controller?.abort();
  } };
}

// src-tauri/builtin-tools/src/certificate.js
function mount({ inspectCertificate, copyText, signal }) {
  const op = operation(signal);
  let summary = "";
  $("url").value = "https://www.baidu.com";
  $("cancel").onclick = () => op.cancel();
  const algorithms = { "1.2.840.113549.1.1.1": "RSA", "1.2.840.10045.2.1": "EC", "1.3.101.112": "Ed25519", "1.2.840.113549.1.1.11": "SHA-256 with RSA", "1.2.840.113549.1.1.12": "SHA-384 with RSA", "1.2.840.113549.1.1.13": "SHA-512 with RSA", "1.2.840.10045.4.3.2": "ECDSA with SHA-256" };
  const date = (value) => `${new Date(value * 1e3).toLocaleString("zh-CN", { hour12: false })}
${new Date(value * 1e3).toISOString()}`;
  $("inspect").onclick = async () => {
    const job = op.start();
    $("inspect").disabled = true;
    $("cancel").hidden = false;
    $("results").hidden = true;
    summary = "";
    status("正在查询证书…");
    try {
      const url = httpsURL($("url").value), info = await inspectCertificate(url.href, { signal: job });
      const rows = [["服务器", `${info.host}:${info.port}`], ["有效期状态", info.valid_now ? `有效（约剩余 ${info.days_remaining} 天）` : "未生效或已过期"], ["域名匹配", info.hostname_matches ? "匹配" : "不匹配"], ["证书链（内置根证书）", info.trusted ? "验证通过" : `未通过：${info.trust_error}`], ["生效时间（本机时区 / UTC）", date(info.not_before)], ["到期时间（本机时区 / UTC）", date(info.not_after)], ["主体", info.subject], ["颁发者", info.issuer], ["序列号", info.serial], ["证书域名 / IP", info.domains.length ? info.domains.join("\n") : "未声明 SAN 域名"], ["签名算法", algorithms[info.signature_algorithm] || info.signature_algorithm], ["公钥算法", algorithms[info.public_key_algorithm] || info.public_key_algorithm], ["TLS 协议", String(info.tls_version).replace("TLSv1_3", "TLS 1.3").replace("TLSv1_2", "TLS 1.2")], ["加密套件", info.cipher], ["服务器提供的证书数", info.chain_length], ["SHA-256 指纹", info.fingerprint_sha256]];
      $("info").replaceChildren();
      for (const [key, value] of rows) $("info").append(text("dt", key), text("dd", value));
      summary = rows.map(([key, value]) => `${key}：${value}`).join("\n\n");
      $("results").hidden = false;
      status(info.trusted && info.valid_now && info.hostname_matches ? "证书查询完成。" : "证书已读取，请关注有效期、域名匹配和证书链状态。", !info.trusted || !info.valid_now || !info.hostname_matches);
    } catch (error) {
      status(error.name === "AbortError" ? "查询已取消。" : error.message, true);
    } finally {
      $("inspect").disabled = false;
      $("cancel").hidden = true;
    }
  };
  copyButton("copy", () => summary, copyText);
  return () => op.dispose();
}
export {
  mount
};
