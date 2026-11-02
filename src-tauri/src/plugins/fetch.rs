//! `net.fetch` for plugins: the host makes the request, and only to hosts the user allowed.
//! The allowlist is the manifest's `network.hosts` plus `network:<host>` grants. Redirects are checked hop by hop.

use super::frame::encode_frame;
use super::manifest::Manifest;
use super::store::enabled_plugin;
use crate::folder_compare::blocking;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

pub const TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_BODY_BYTES: usize = 20 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const METHODS: [&str; 6] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    /// Lowercase host. `*.example.com` is stored without the `*`, as `.example.com`.
    host: String,
    wildcard: bool,
    port: Option<u16>,
}

fn parse_entry(text: &str) -> Option<Entry> {
    let text = text.to_ascii_lowercase();
    let (name, port) = match text.rsplit_once(':') {
        Some((name, port)) => (name, Some(port.parse::<u16>().ok()?)),
        None => (text.as_str(), None),
    };
    let (host, wildcard) = match name.strip_prefix("*.") {
        Some(rest) => (rest.to_string(), true),
        None => (name.to_string(), false),
    };
    (!host.is_empty()).then_some(Entry { host, wildcard, port })
}

/// The hosts a plugin may reach. Empty unless the user granted `network`.
#[derive(Clone, Debug, Default)]
pub struct Allowlist {
    entries: Vec<Entry>,
}

impl Allowlist {
    pub fn new(manifest: &Manifest, granted: &[String]) -> Self {
        if !granted.iter().any(|g| g == "network") {
            return Allowlist::default();
        }
        let declared = manifest.permissions.iter().filter(|p| p.name == "network").flat_map(|p| p.hosts.iter().flatten().map(String::as_str));
        let added = granted.iter().filter_map(|g| g.strip_prefix("network:"));
        Allowlist { entries: declared.chain(added).filter_map(parse_entry).collect() }
    }

    /// http(s) only. No port in the entry means the scheme's default port (80 or 443).
    pub fn allows(&self, url: &Url) -> bool {
        if !matches!(url.scheme(), "http" | "https") {
            return false;
        }
        let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else { return false };
        let host = host.to_ascii_lowercase();
        let default_port = if url.scheme() == "https" { 443 } else { 80 };
        self.entries.iter().any(|entry| {
            let host_ok = if entry.wildcard { host.len() > entry.host.len() + 1 && host.ends_with(&format!(".{}", entry.host)) } else { host == entry.host };
            host_ok && port == entry.port.unwrap_or(default_port)
        })
    }
}

#[derive(Deserialize, Debug, Default)]
pub struct FetchRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Clone, Copy)]
pub struct Limits {
    pub timeout: Duration,
    pub max_bytes: usize,
}

pub const LIMITS: Limits = Limits { timeout: TIMEOUT, max_bytes: MAX_BODY_BYTES };

#[derive(Debug)]
pub struct FetchResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub url: String,
    pub body: Vec<u8>,
}

pub(super) fn ensure_crypto_provider() {
    // reqwest is built without a provider (same as the updater). Install ring unless something already did.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

pub async fn fetch(allow: &Allowlist, request: FetchRequest, limits: Limits) -> Result<FetchResponse, String> {
    let url = Url::parse(&request.url).map_err(|_| format!("Not a valid URL: {}", request.url))?;
    if !allow.allows(&url) {
        return Err(format!("The plugin may not reach {}", url.host_str().unwrap_or("this address")));
    }
    let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return Err(format!("Method not allowed: {method}"));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;

    ensure_crypto_provider();
    let hops = Arc::new(allow.clone());
    // ponytail: a client per call (the redirect rule depends on this plugin's list). Cache per plugin if polling plugins show up.
    let client = reqwest::Client::builder()
        .timeout(limits.timeout)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("Too many redirects")
            } else if hops.allows(attempt.url()) {
                attempt.follow()
            } else {
                let host = attempt.url().host_str().unwrap_or("another address").to_string();
                attempt.error(format!("Redirected to a host the plugin may not reach: {host}"))
            }
        }))
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = client.request(method, url);
    for (name, value) in &request.headers {
        // The host and the length belong to the request the host builds. The rest speak for the app or the
        // user's browser identity, which a plugin must not claim.
        let name_lc = name.to_ascii_lowercase();
        if matches!(name_lc.as_str(), "host" | "content-length" | "cookie" | "origin" | "connection" | "transfer-encoding")
            || name_lc.starts_with("proxy-")
            || name_lc.starts_with("sec-")
        {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let mut response = builder.send().await.map_err(describe)?;
    if response.content_length().is_some_and(|len| len > limits.max_bytes as u64) {
        return Err(too_large(limits));
    }
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.as_str().to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let final_url = response.url().to_string();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(describe)? {
        if body.len() + chunk.len() > limits.max_bytes {
            return Err(too_large(limits));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(FetchResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        url: final_url,
        body,
    })
}

fn too_large(limits: Limits) -> String {
    format!("The response is larger than {} MB", limits.max_bytes / (1024 * 1024))
}

/// reqwest wraps the cause (a redirect we refused, a timeout) one level down.
pub(super) fn describe(error: reqwest::Error) -> String {
    use std::error::Error;
    if error.is_timeout() {
        return "The request timed out".to_string();
    }
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message = format!("{message}: {cause}");
        source = cause.source();
    }
    message
}

/// Reply to the frontend: the metadata as JSON, then the body bytes (see `encode_frame`).
#[tauri::command]
pub async fn plugin_fetch(app: tauri::AppHandle, id: String, request: FetchRequest) -> Result<tauri::ipc::Response, String> {
    let plugin = blocking(move || enabled_plugin(&app, &id)).await?;
    if !plugin.granted.iter().any(|g| g == "network") {
        return Err("permission_denied: network".to_string());
    }
    let allow = Allowlist::new(&plugin.manifest, &plugin.granted);
    let response = fetch(&allow, request, LIMITS).await?;
    let meta = serde_json::json!({
        "status": response.status,
        "statusText": response.status_text,
        "headers": response.headers,
        "url": response.url,
    });
    Ok(tauri::ipc::Response::new(encode_frame(&meta, &response.body)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn allow(entries: &[&str]) -> Allowlist {
        Allowlist { entries: entries.iter().filter_map(|e| parse_entry(e)).collect() }
    }

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn allowlist_matches_host_port_and_wildcards() {
        let list = allow(&["localhost:9092", "api.example.com", "*.cdn.example.com"]);
        assert!(list.allows(&url("http://localhost:9092/x")));
        assert!(!list.allows(&url("http://localhost:9093/x")));
        assert!(!list.allows(&url("http://localhost/x")));
        // No port: the scheme's default.
        assert!(list.allows(&url("https://api.example.com/x")) && list.allows(&url("http://API.example.com/x")));
        assert!(!list.allows(&url("https://api.example.com:8443/x")));
        assert!(list.allows(&url("https://a.cdn.example.com/x")) && list.allows(&url("https://a.b.cdn.example.com/x")));
        assert!(!list.allows(&url("https://cdn.example.com/x")), "the bare domain is not a subdomain");
        assert!(!list.allows(&url("https://evilcdn.example.com.attacker.net/x")));
        assert!(!list.allows(&url("https://notcdn.example.com/x")));
        assert!(!list.allows(&url("ftp://api.example.com/x")) && !list.allows(&url("file:///etc/passwd")));
    }

    #[test]
    fn network_must_be_granted_and_user_hosts_add_to_the_manifest_hosts() {
        let mut manifest = super::super::manifest::read(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugins/good-full")).unwrap();
        manifest.permissions.retain(|p| p.name == "network");
        let declared = manifest.permissions[0].hosts.clone().unwrap();
        let g = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(Allowlist::new(&manifest, &g(&["clipboard:write"])).entries.is_empty());
        // A host grant without the network grant itself is not enough.
        assert!(Allowlist::new(&manifest, &g(&["network:a.com"])).entries.is_empty());
        let list = Allowlist::new(&manifest, &g(&["network", "network:extra.example.org:9000"]));
        assert_eq!(list.entries.len(), declared.len() + 1);
        assert!(list.allows(&url("http://extra.example.org:9000/")));
    }

    /// Serves `make(port)`'s responses, one per connection, on a free local port.
    fn serve(make: impl FnOnce(u16) -> Vec<String> + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for response in make(port) {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let (mut buf, mut seen) = ([0u8; 4096], Vec::new());
                while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => seen.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = stream.write_all(response.as_bytes());
            }
        });
        port
    }

    fn ok(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Test: yes\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn get(list: &Allowlist, target: &str, limits: Limits) -> Result<FetchResponse, String> {
        let request = FetchRequest { url: target.to_string(), ..Default::default() };
        tauri::async_runtime::block_on(fetch(list, request, limits))
    }

    #[test]
    fn an_allowed_host_is_fetched() {
        let port = serve(|_| vec![ok("hello")]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let response = get(&list, &format!("http://127.0.0.1:{port}/x"), LIMITS).unwrap();
        assert_eq!((response.status, response.status_text.as_str(), response.body.as_slice()), (200, "OK", b"hello".as_slice()));
        assert!(response.headers.iter().any(|(k, v)| k == "x-test" && v == "yes"));
    }

    #[test]
    fn a_host_or_port_outside_the_list_is_refused_before_connecting() {
        let port = serve(|_| vec![ok("never")]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let other_port = get(&list, &format!("http://127.0.0.1:{}/", port.wrapping_add(1)), LIMITS).unwrap_err();
        assert!(other_port.contains("may not reach"), "{other_port}");
        let other_host = get(&list, &format!("http://localhost:{port}/"), LIMITS).unwrap_err();
        assert!(other_host.contains("may not reach"), "{other_host}");
        assert!(get(&list, "file:///etc/passwd", LIMITS).is_err());
        assert!(get(&list, "not a url", LIMITS).is_err());
        assert!(get(&Allowlist::default(), &format!("http://127.0.0.1:{port}/"), LIMITS).is_err());
    }

    #[test]
    fn a_redirect_to_a_blocked_host_is_an_error_and_one_to_an_allowed_host_is_followed() {
        let port = serve(|port| {
            vec![
                format!("HTTP/1.1 302 Found\r\nLocation: http://localhost:{port}/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
            ]
        });
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let error = get(&list, &format!("http://127.0.0.1:{port}/"), LIMITS).unwrap_err();
        assert!(error.contains("may not reach") && error.contains("localhost"), "{error}");

        let port = serve(|_| vec!["HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(), ok("landed")]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let response = get(&list, &format!("http://127.0.0.1:{port}/"), LIMITS).unwrap();
        assert_eq!(response.body, b"landed");
        assert!(response.url.ends_with("/next"));
    }

    #[test]
    fn a_response_over_the_cap_is_an_error() {
        let small = Limits { timeout: TIMEOUT, max_bytes: 10 };
        // Declared too large.
        let port = serve(|_| vec![ok("0123456789ABCDEF")]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let error = get(&list, &format!("http://127.0.0.1:{port}/"), small).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        // No Content-Length: counted as it arrives.
        let port = serve(|_| vec!["HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n0123456789ABCDEF".to_string()]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        let error = get(&list, &format!("http://127.0.0.1:{port}/"), small).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        // Exactly at the cap is fine.
        let port = serve(|_| vec![ok("0123456789")]);
        let list = allow(&[&format!("127.0.0.1:{port}")]);
        assert_eq!(get(&list, &format!("http://127.0.0.1:{port}/"), small).unwrap().body.len(), 10);
    }

    #[test]
    fn only_listed_methods_are_sent() {
        let list = allow(&["127.0.0.1:1"]);
        let request = FetchRequest { url: "http://127.0.0.1:1/".into(), method: Some("TRACE".into()), ..Default::default() };
        let error = tauri::async_runtime::block_on(fetch(&list, request, LIMITS)).unwrap_err();
        assert!(error.contains("Method not allowed"), "{error}");
    }
}
