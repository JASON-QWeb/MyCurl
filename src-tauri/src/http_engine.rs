//! Rust 原生 HTTP 引擎（基于 reqwest + rustls + tokio），支持流式推送、重定向追踪、代理与取消

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart::{Form, Part};
use reqwest::redirect::Policy;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use url::Url;

const MAX_REDIRECTS: usize = 10;
const VERSION: &str = env!("CARGO_PKG_VERSION");

const FORBIDDEN_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "expect",
    "content-length",
    "host",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPayload {
    pub request_id: Option<String>,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: RequestBodyPayload,
    #[serde(default)]
    pub options: RequestOptionsPayload,
}

#[derive(Debug, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestBodyPayload {
    #[default]
    None,
    Text {
        text: String,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    Base64 {
        data: String,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    Multipart {
        fields: Vec<MultipartFieldPayload>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartFieldPayload {
    pub name: String,
    pub value: Option<String>,
    #[serde(default)]
    pub is_file: bool,
    pub file_name: Option<String>,
    pub data: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptionsPayload {
    #[serde(default = "default_true")]
    pub verify_ssl: bool,
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub proxy: String,
}

fn default_true() -> bool {
    true
}
fn default_timeout() -> u64 {
    120_000
}

impl Default for RequestOptionsPayload {
    fn default() -> Self {
        Self {
            verify_ssl: true,
            follow_redirects: true,
            timeout_ms: default_timeout(),
            proxy: String::new(),
        }
    }
}

/// 通过 Tauri Channel 流式返回给前端的事件（与本地 Node 服务的 NDJSON 协议完全对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum StreamEvent {
    #[serde(rename = "head")]
    Head {
        status: u16,
        #[serde(rename = "statusText")]
        status_text: String,
        headers: Vec<(String, String)>,
        url: String,
        method: String,
        redirects: Vec<String>,
        ttfb: f64,
        #[serde(rename = "requestHeaders")]
        request_headers: Vec<(String, String)>,
    },
    #[serde(rename = "data")]
    Data { b64: String },
    #[serde(rename = "end")]
    End {
        time: f64,
        size: usize,
        #[serde(rename = "wireSize")]
        wire_size: usize,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        code: String,
        time: f64,
    },
}

/// 管理正在执行中的请求取消句柄
#[derive(Default)]
pub struct CancelRegistry {
    tokens: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl CancelRegistry {
    pub fn register(&self, id: String) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = guard.insert(id, tx) {
            let _ = prev.send(());
        }
        rx
    }

    pub fn cancel(&self, id: &str) -> bool {
        let mut guard = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = guard.remove(id) {
            let _ = tx.send(());
            return true;
        }
        false
    }

    pub fn remove(&self, id: &str) {
        let mut guard = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(id);
    }
}

fn friendly_error(err: &reqwest::Error) -> (String, String) {
    if err.is_timeout() {
        return (
            "请求超时（可在设置或请求设置中调整超时时间）".to_string(),
            "ETIMEDOUT".to_string(),
        );
    }
    if err.is_connect() {
        let raw = err.to_string();
        if raw.contains("dns") || raw.contains("failed to lookup") {
            return (
                "无法解析域名，请检查地址或网络连接".to_string(),
                "ENOTFOUND".to_string(),
            );
        }
        if raw.contains("certificate") || raw.contains("tls") || raw.contains("SSL") {
            return (
                format!("TLS / 证书校验失败（可在设置中关闭 SSL 校验）：{raw}"),
                "CERT_ERROR".to_string(),
            );
        }
        return (
            format!("无法连接到目标服务器：{raw}"),
            "ECONNREFUSED".to_string(),
        );
    }
    if err.is_builder() {
        return (
            format!("无效的请求配置：{err}"),
            "INVALID_REQUEST".to_string(),
        );
    }
    (err.to_string(), "HTTP_ERROR".to_string())
}

fn build_client(opts: &RequestOptionsPayload) -> Result<Client, String> {
    let mut builder = Client::builder()
        .redirect(Policy::none()) // 由我们手动处理重定向以完整记录链路与跨域脱敏
        .danger_accept_invalid_certs(!opts.verify_ssl);

    if opts.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(opts.timeout_ms));
    }

    let proxy = opts.proxy.trim();
    if !proxy.is_empty() {
        let uri = if proxy.contains("://") {
            proxy.to_string()
        } else {
            format!("http://{proxy}")
        };
        let p = reqwest::Proxy::all(&uri).map_err(|e| format!("代理配置无效：{e}"))?;
        builder = builder.proxy(p);
    }

    builder
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

fn has_header(headers: &[(String, String)], name: &str) -> bool {
    headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name))
}

fn build_header_map(pairs: &[(String, String)]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (k, v) in pairs {
        let name =
            HeaderName::from_bytes(k.as_bytes()).map_err(|_| format!("非法的请求头名称：{k}"))?;
        let val = HeaderValue::from_str(v).map_err(|_| format!("非法的请求头值：{k}"))?;
        map.append(name, val);
    }
    Ok(map)
}

/// 核心执行函数，供 Tauri 命令与单元测试共同调用
pub async fn execute<F>(payload: SendPayload, mut cancel_rx: oneshot::Receiver<()>, mut emit: F)
where
    F: FnMut(StreamEvent),
{
    let start = Instant::now();
    let elapsed_ms = || start.elapsed().as_secs_f64() * 1000.0;

    let client = match build_client(&payload.options) {
        Ok(c) => c,
        Err(msg) => {
            emit(StreamEvent::Error {
                message: msg,
                code: "CLIENT_INIT".to_string(),
                time: elapsed_ms(),
            });
            return;
        }
    };

    let mut current_url = match Url::parse(payload.url.trim()) {
        Ok(u) => u,
        Err(e) => {
            emit(StreamEvent::Error {
                message: format!("无效的 URL：{e}"),
                code: "ERR_INVALID_URL".to_string(),
                time: elapsed_ms(),
            });
            return;
        }
    };

    let mut method = match Method::from_bytes(payload.method.trim().to_uppercase().as_bytes()) {
        Ok(m) => m,
        Err(_) => {
            emit(StreamEvent::Error {
                message: format!("不支持的 HTTP 方法：{}", payload.method),
                code: "INVALID_METHOD".to_string(),
                time: elapsed_ms(),
            });
            return;
        }
    };

    // 规范化请求头
    let mut headers: Vec<(String, String)> = payload
        .headers
        .into_iter()
        .filter(|(k, _)| {
            let lower = k.trim().to_ascii_lowercase();
            !lower.is_empty() && !FORBIDDEN_HEADERS.contains(&lower.as_str())
        })
        .collect();

    enum PreparedBody {
        None,
        Bytes(Vec<u8>),
        Multipart(Vec<MultipartFieldPayload>),
    }

    let mut body = match payload.body {
        RequestBodyPayload::None => PreparedBody::None,
        RequestBodyPayload::Text { text, content_type } => {
            if text.is_empty() {
                PreparedBody::None
            } else {
                if let Some(ct) = content_type {
                    if !ct.is_empty() && !has_header(&headers, "content-type") {
                        headers.push(("Content-Type".to_string(), ct));
                    }
                }
                PreparedBody::Bytes(text.into_bytes())
            }
        }
        RequestBodyPayload::Base64 { data, content_type } => match BASE64.decode(data.as_bytes()) {
            Ok(bytes) => {
                if let Some(ct) = content_type {
                    if !ct.is_empty() && !has_header(&headers, "content-type") {
                        headers.push(("Content-Type".to_string(), ct));
                    }
                }
                PreparedBody::Bytes(bytes)
            }
            Err(e) => {
                emit(StreamEvent::Error {
                    message: format!("Base64 请求体解码失败：{e}"),
                    code: "BAD_BODY".to_string(),
                    time: elapsed_ms(),
                });
                return;
            }
        },
        RequestBodyPayload::Multipart { fields } => {
            headers.retain(|(k, _)| !k.eq_ignore_ascii_case("content-type"));
            PreparedBody::Multipart(fields)
        }
    };

    if !has_header(&headers, "user-agent") {
        headers.push(("User-Agent".to_string(), format!("MyCurl/{VERSION}")));
    }
    if !has_header(&headers, "accept") {
        headers.push(("Accept".to_string(), "*/*".to_string()));
    }

    let mut redirects: Vec<String> = Vec::new();
    let mut hop = 0usize;

    let (resp, ttfb) = loop {
        let header_map = match build_header_map(&headers) {
            Ok(m) => m,
            Err(msg) => {
                emit(StreamEvent::Error {
                    message: msg,
                    code: "INVALID_HEADER".to_string(),
                    time: elapsed_ms(),
                });
                return;
            }
        };

        let mut req_builder = client
            .request(method.clone(), current_url.clone())
            .headers(header_map);
        match &body {
            PreparedBody::None => {}
            PreparedBody::Bytes(b) => {
                req_builder = req_builder.body(b.clone());
            }
            PreparedBody::Multipart(fields) => {
                let mut form = Form::new();
                for f in fields {
                    if f.is_file {
                        let bytes = f
                            .data
                            .as_deref()
                            .and_then(|d| BASE64.decode(d.as_bytes()).ok())
                            .unwrap_or_default();
                        let mut part = Part::bytes(bytes)
                            .file_name(f.file_name.clone().unwrap_or_else(|| "file".to_string()));
                        if let Some(ct) = f.content_type.as_deref() {
                            if let Ok(p) = part.mime_str(ct) {
                                part = p;
                            } else {
                                part = Part::bytes(
                                    f.data
                                        .as_deref()
                                        .and_then(|d| BASE64.decode(d.as_bytes()).ok())
                                        .unwrap_or_default(),
                                )
                                .file_name(
                                    f.file_name.clone().unwrap_or_else(|| "file".to_string()),
                                );
                            }
                        }
                        form = form.part(f.name.clone(), part);
                    } else {
                        form = form.text(f.name.clone(), f.value.clone().unwrap_or_default());
                    }
                }
                req_builder = req_builder.multipart(form);
            }
        }

        let resp = tokio::select! {
            _ = &mut cancel_rx => {
                emit(StreamEvent::Error {
                    message: "请求已取消".to_string(),
                    code: "ABORT_ERR".to_string(),
                    time: elapsed_ms(),
                });
                return;
            }
            r = req_builder.send() => match r {
                Ok(resp) => resp,
                Err(e) => {
                    let (message, code) = friendly_error(&e);
                    emit(StreamEvent::Error { message, code, time: elapsed_ms() });
                    return;
                }
            }
        };

        let ttfb = elapsed_ms();
        let code = resp.status().as_u16();
        let is_redirect = matches!(code, 301 | 302 | 303 | 307 | 308);
        if payload.options.follow_redirects && is_redirect && hop < MAX_REDIRECTS {
            if let Some(loc) = resp.headers().get("location").and_then(|v| v.to_str().ok()) {
                if let Ok(next_url) = current_url.join(loc) {
                    redirects.push(format!("{code} → {next_url}"));
                    if code == 303 || ((code == 301 || code == 302) && method == Method::POST) {
                        method = Method::GET;
                        body = PreparedBody::None;
                        headers.retain(|(k, _)| !k.eq_ignore_ascii_case("content-type"));
                    }
                    if next_url.host_str() != current_url.host_str()
                        || next_url.port_or_known_default() != current_url.port_or_known_default()
                    {
                        headers.retain(|(k, _)| {
                            !k.eq_ignore_ascii_case("authorization")
                                && !k.eq_ignore_ascii_case("cookie")
                        });
                    }
                    current_url = next_url;
                    hop += 1;
                    continue;
                }
            }
        }

        break (resp, ttfb);
    };

    let status = resp.status();
    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    emit(StreamEvent::Head {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers: resp_headers,
        url: current_url.to_string(),
        method: method.as_str().to_string(),
        redirects,
        ttfb,
        request_headers: headers,
    });

    let mut total_size = 0usize;
    let mut stream = resp.bytes_stream();

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                emit(StreamEvent::Error {
                    message: "请求已取消".to_string(),
                    code: "ABORT_ERR".to_string(),
                    time: elapsed_ms(),
                });
                return;
            }
            next = stream.next() => match next {
                Some(Ok(chunk)) => {
                    total_size += chunk.len();
                    emit(StreamEvent::Data { b64: BASE64.encode(&chunk) });
                }
                Some(Err(e)) => {
                    let (message, code) = friendly_error(&e);
                    emit(StreamEvent::Error { message, code, time: elapsed_ms() });
                    return;
                }
                None => break,
            }
        }
    }

    emit(StreamEvent::End {
        time: elapsed_ms(),
        size: total_size,
        wire_size: total_size,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_execute_post_json_against_local_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap();
            let req_text = String::from_utf8_lossy(&buf[..n]);
            assert!(req_text.contains("POST /v1/chat/completions"));
            assert!(req_text.contains("Bearer sk-rust-test"));

            let body = r#"{"choices":[{"message":{"content":"你好，来自 Rust 核心"}}]}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(resp.as_bytes()).await.unwrap();
        });

        let payload = SendPayload {
            request_id: Some("req_test".to_string()),
            method: "POST".to_string(),
            url: format!("http://{addr}/v1/chat/completions"),
            headers: vec![
                (
                    "Authorization".to_string(),
                    "Bearer sk-rust-test".to_string(),
                ),
                ("Content-Type".to_string(), "application/json".to_string()),
            ],
            body: RequestBodyPayload::Text {
                text: r#"{"model":"model-j"}"#.to_string(),
                content_type: Some("application/json".to_string()),
            },
            options: RequestOptionsPayload::default(),
        };

        let (_tx, rx) = oneshot::channel();
        let mut events = Vec::new();
        execute(payload, rx, |ev| events.push(ev)).await;

        let mut status = 0u16;
        let mut raw_bytes = Vec::new();
        let mut ended = false;
        for ev in events {
            match ev {
                StreamEvent::Head { status: s, .. } => status = s,
                StreamEvent::Data { b64 } => raw_bytes.extend(BASE64.decode(b64).unwrap()),
                StreamEvent::End { .. } => ended = true,
                StreamEvent::Error { message, .. } => panic!("unexpected error: {message}"),
            }
        }
        assert_eq!(status, 200);
        assert!(ended);
        let text = String::from_utf8(raw_bytes).unwrap();
        assert!(text.contains("你好，来自 Rust 核心"));
    }
}
