//! The `shard-plugin://<id>/<path>` protocol. It serves the files of an installed, enabled plugin
//! to its sandboxed frame. Nothing else is reachable through it: ids are validated, paths go through
//! `resolve_inside`, and an unknown or disabled plugin is a plain 404.

use super::manifest::valid_id;
use super::store::InstalledPlugin;
use crate::paths::resolve_inside;
use percent_encoding::percent_decode_str;
use std::fs;
use std::path::Path;
use tauri::http::{header, Response, StatusCode};

pub const SCHEME: &str = "shard-plugin";

/// On Windows, WebView2 maps a custom scheme to `http://<scheme>.localhost/`, so the id is the first path segment.
const WINDOWS_HOST: &str = "shard-plugin.localhost";

const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors *";

/// The policy for one plugin. The frame is sandboxed, so its origin is opaque, and WebKit (macOS,
/// Linux) then matches `'self'` against nothing for a custom scheme: scripts, styles and fetches
/// from the package would all be blocked. Naming the plugin's own origin next to `'self'` fixes
/// that without opening other plugins' files. `worker-src` allows `blob:` for the same reason: the
/// frame cannot start a worker from its own file (a worker script must have the page's origin, and
/// an opaque origin has none), so the SDK starts it from a Blob URL. Only the frame's own code can
/// make blobs of its origin. Windows serves plain http, where `'self'` works but
/// covers every plugin on the host, so there a plugin can fetch another plugin's package files.
/// That is accepted: package files are public, and a plugin's data lives in the host's store.
pub fn csp(id: &str, windows_form: bool) -> String {
    if windows_form {
        CSP.to_string()
    } else {
        CSP.replace("'self'", &format!("'self' {SCHEME}://{id}"))
    }
}

/// Splits a request into the plugin id and the file path inside the package. `None` when it has no valid id.
fn target(host: Option<&str>, path: &str) -> Option<(String, String)> {
    let path = path.trim_start_matches('/');
    let (id, rest) = match host {
        Some(WINDOWS_HOST) => path.split_once('/').unwrap_or((path, "")),
        Some(host) => (host, path),
        None => return None,
    };
    // Exact match: the frame's origin names the id as written, so a differently cased spelling is not served.
    if !valid_id(id) {
        return None;
    }
    let id = id.to_string();
    let rest = percent_decode_str(rest).decode_utf8().ok()?.into_owned();
    Some((id, rest))
}

pub fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "txt" | "md" => "text/plain; charset=utf-8",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// Reads the registry without touching it (`Store::load` moves a corrupt file aside, which a
/// read-only handler running on many threads must not do). Any failure means "not enabled".
// ponytail: one small file read per request; cache the enabled set if a plugin ships hundreds of assets.
fn is_enabled(root: &Path, id: &str) -> bool {
    fs::read_to_string(root.join("plugins.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<InstalledPlugin>>(&text).ok())
        .is_some_and(|list| list.iter().any(|plugin| plugin.id == id && plugin.enabled))
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(b"Not found".to_vec())
        .expect("static response")
}

/// The response for one request. `root` is the app data folder.
pub fn serve(root: &Path, host: Option<&str>, path: &str) -> Response<Vec<u8>> {
    let Some((id, rel)) = target(host, path) else { return not_found() };
    let windows_form = host == Some(WINDOWS_HOST);
    if !is_enabled(root, &id) {
        return not_found();
    }
    let Ok(file) = resolve_inside(&root.join("plugins").join(&id), &rel) else { return not_found() };
    if !fs::metadata(&file).map(|m| m.is_file()).unwrap_or(false) {
        return not_found();
    }
    let Ok(bytes) = fs::read(&file) else { return not_found() };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for(&rel))
        .header(header::CONTENT_SECURITY_POLICY, csp(&id, windows_form))
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        // Updates must show at once, and the package is already on local disk.
        .header(header::CACHE_CONTROL, "no-store")
        // The frame's origin is opaque ("null"), so its module scripts and its fetch() of a .wasm
        // file are cross-origin requests. The files are package files, not secrets.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .expect("valid response")
}

/// Adds the `shard-plugin` scheme to the app builder.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    use tauri::Manager;
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, |context, request, responder| {
        let root = context.app_handle().path().app_data_dir();
        let uri = request.uri().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let response = match root {
                Ok(root) => serve(&root, uri.host(), uri.path()),
                Err(_) => not_found(),
            };
            responder.respond(response);
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::store::Store;

    fn installed() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugins/good-minimal");
        store.install_folder(&fixture).unwrap();
        (dir, store)
    }

    fn status(root: &Path, host: &str, path: &str) -> StatusCode {
        serve(root, Some(host), path).status()
    }

    #[test]
    fn serves_a_file_with_the_sandbox_headers() {
        let (dir, _store) = installed();
        let response = serve(dir.path(), Some("hello-tool"), "/index.html");
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(headers[header::CONTENT_TYPE], "text/html; charset=utf-8");
        assert_eq!(headers[header::CONTENT_SECURITY_POLICY], csp("hello-tool", false).as_str());
        assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(response.body(), &fs::read(dir.path().join("plugins/hello-tool/index.html")).unwrap());
    }

    #[test]
    fn csp_keeps_the_fixed_policy_and_names_only_its_own_plugin() {
        assert_eq!(
            csp("hello-tool", true),
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors *"
        );
        let own = csp("hello-tool", false);
        assert!(own.contains("script-src 'self' shard-plugin://hello-tool 'wasm-unsafe-eval';"), "{own}");
        assert!(own.contains("connect-src 'self' shard-plugin://hello-tool;"), "{own}");
        assert!(own.contains("worker-src 'self' shard-plugin://hello-tool blob:;"), "{own}");
        assert!(own.ends_with("frame-ancestors *"));
        assert!(!own.contains("shard-plugin:;") && !own.contains("shard-plugin: "));
    }

    #[test]
    fn windows_form_gets_the_plain_policy() {
        let (dir, _store) = installed();
        let response = serve(dir.path(), Some(WINDOWS_HOST), "/hello-tool/index.html");
        assert_eq!(response.headers()[header::CONTENT_SECURITY_POLICY], csp("hello-tool", true).as_str());
    }

    #[test]
    fn windows_form_puts_the_id_in_the_path() {
        let (dir, _store) = installed();
        assert_eq!(status(dir.path(), WINDOWS_HOST, "/hello-tool/index.html"), StatusCode::OK);
        assert_eq!(status(dir.path(), WINDOWS_HOST, "/nope-tool/index.html"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), WINDOWS_HOST, "/"), StatusCode::NOT_FOUND);
    }

    #[test]
    fn unknown_disabled_and_invalid_plugins_are_404() {
        let (dir, store) = installed();
        assert_eq!(status(dir.path(), "nope-tool", "/index.html"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), "..", "/index.html"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), "Hello-Tool", "/index.html"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), ".staging", "/index.html"), StatusCode::NOT_FOUND);
        assert!(serve(dir.path(), None, "/index.html").status() == StatusCode::NOT_FOUND);
        store.set_enabled("hello-tool", false).unwrap();
        assert_eq!(status(dir.path(), "hello-tool", "/index.html"), StatusCode::NOT_FOUND);
        store.set_enabled("hello-tool", true).unwrap();
        assert_eq!(status(dir.path(), "hello-tool", "/index.html"), StatusCode::OK);
    }

    #[test]
    fn a_corrupt_registry_is_a_404_and_is_left_alone() {
        let (dir, _store) = installed();
        fs::write(dir.path().join("plugins.json"), "{not json").unwrap();
        assert_eq!(status(dir.path(), "hello-tool", "/index.html"), StatusCode::NOT_FOUND);
        assert_eq!(fs::read_to_string(dir.path().join("plugins.json")).unwrap(), "{not json");
        assert_eq!(fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().contains("corrupt")).count(), 0);
    }

    #[test]
    fn paths_cannot_leave_the_package() {
        let (dir, _store) = installed();
        fs::write(dir.path().join("plugins/secret.txt"), "secret").unwrap();
        for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/../../plugins.json", "//etc/passwd", "/%2fetc/passwd", "/sub/../../secret.txt"] {
            assert_eq!(status(dir.path(), "hello-tool", path), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[test]
    fn directories_and_missing_files_are_404() {
        let (dir, _store) = installed();
        fs::create_dir(dir.path().join("plugins/hello-tool/sub")).unwrap();
        assert_eq!(status(dir.path(), "hello-tool", "/sub"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), "hello-tool", "/"), StatusCode::NOT_FOUND);
        assert_eq!(status(dir.path(), "hello-tool", "/missing.js"), StatusCode::NOT_FOUND);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leaves_the_package_is_404() {
        let (dir, _store) = installed();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), dir.path().join("plugins/hello-tool/link.txt")).unwrap();
        assert_eq!(status(dir.path(), "hello-tool", "/link.txt"), StatusCode::NOT_FOUND);
    }

    #[test]
    fn mime_types_include_wasm() {
        assert_eq!(mime_for("a/b.wasm"), "application/wasm");
        assert_eq!(mime_for("x.JS"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("x.mjs"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("x.css"), "text/css; charset=utf-8");
        assert_eq!(mime_for("x.svg"), "image/svg+xml");
        assert_eq!(mime_for("x.woff2"), "font/woff2");
        assert_eq!(mime_for("x.unknown"), "application/octet-stream");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }

    #[test]
    fn serves_wasm_with_its_type() {
        let (dir, _store) = installed();
        fs::write(dir.path().join("plugins/hello-tool/m.wasm"), [0, 0x61, 0x73, 0x6d]).unwrap();
        let response = serve(dir.path(), Some("hello-tool"), "/m.wasm");
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/wasm");
    }

    #[test]
    fn serves_the_wasm_example_module() {
        let dir = tempfile::tempdir().unwrap();
        let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/examples/hash-wasm");
        Store::new(dir.path().to_path_buf()).install_folder(&example).unwrap();
        let response = serve(dir.path(), Some("hash-wasm"), "/hash.wasm");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/wasm");
        assert_eq!(response.body(), &fs::read(example.join("hash.wasm")).unwrap());
        assert_eq!(&response.body()[..4], b"\0asm");
        // Only the package files are installed, never a build folder.
        assert!(!dir.path().join("plugins/hash-wasm/target").exists());
    }
}
