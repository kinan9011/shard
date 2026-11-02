# Plugin security: sandbox and IPC isolation

A plugin's UI is untrusted web content. It must not be able to call the app's Tauri commands
(file access, the plugin store, the updater). This page records how that is enforced and how it was
checked. Wave 5 of the plugin shell plan is a gate: later waves build on this result.

## The model

- The UI runs in `<iframe sandbox="allow-scripts" src="shard-plugin://<id>/<entry>">`
  (`src/components/plugins/PluginFrame.tsx`). There is no `allow-same-origin`, so the frame's origin is
  opaque. It cannot read the app's DOM, storage or cookies, and the app cannot be read from it.
- Files come from the `shard-plugin` protocol (`src-tauri/src/plugins/protocol.rs`). On Windows
  WebView2 serves it as `http://shard-plugin.localhost/<id>/<path>`.
  - Only installed and **enabled** plugins are served. Unknown, disabled or invalid ids are a 404.
  - Paths go through `resolve_inside` on `plugins/<id>/`: no `..`, no absolute paths, no link that
    leaves the package. Directories and missing files are a 404.
- Each response carries
  `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors *`,
  plus `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
  - **`'self'` does not work in WebKit here.** In a sandboxed frame the origin is opaque, and on
    WebKit (macOS, Linux) `'self'` then matches nothing for a custom scheme. The first spike run
    showed it: every script was blocked. So on non-Windows platforms the policy names the plugin's own
    origin next to each `'self'` (`'self' shard-plugin://<id>`). That allows the plugin's own files and
    no other plugin's. Windows serves plain http, where `'self'` works, and gets the policy unchanged.
  - **`Access-Control-Allow-Origin: *`** is sent because the frame's origin is `null`, which makes its
    module scripts and its `fetch()` of `.wasm` files cross-origin requests. The files are package
    files, not secrets, and only enabled plugins are served at all.
  - **Workers.** A worker script must have the same origin as its page, and an opaque origin never
    matches, so `new Worker("worker.js")` cannot work in a plugin frame. `spawnWorker()` in the SDK
    reads the script and starts the worker from a Blob URL instead, and the policy allows that with
    `worker-src ... blob:`. Only the frame's own code can create blobs of its origin, so this opens no
    new source. A Blob worker's location is `blob:`, so it cannot resolve relative URLs: send it a
    compiled `WebAssembly.Module` (the `hash-wasm` example does) or absolute URLs.
- Network access from the frame is blocked by `connect-src` (no external `fetch`). Plugin network
  access is a host call checked against the `network` permission (W7).

## Why the frame cannot reach Tauri IPC

Checked in the Tauri 2.12.5 and wry 0.57.1 sources:

1. **Capabilities do not apply.** `Webview::is_local_url` (`tauri/src/webview/mod.rs`) accepts only the
   `tauri://` protocol and the app URL. `shard-plugin://` is a remote origin, and
   `capabilities/default.json` grants nothing to remote URLs (it has no `remote` entry).
2. **The invoke key.** Every IPC message must contain `__TAURI_INVOKE_KEY__`, a random value created
   per run. It is injected by an initialization script with `for_main_frame_only: true`, so only the
   app's top frame has it. A frame cannot read it from the app (opaque origin, `parent.document`
   throws). A message without it, or with a wrong one, is refused (`tauri/src/ipc/protocol.rs`).
3. `window.__TAURI_INTERNALS__`, `window.__TAURI__` and `window.ipc` are injected the same way, so they
   are `undefined` in the plugin frame.

Point 2 matters on WebKitGTK and macOS: the native message handler `window.webkit.messageHandlers.ipc`
exists in **every** frame, and wry reports the top-level URL as the sender. So the handler is
reachable from a plugin frame, and the invoke key is the only guard. Keep it that way: never put the
key, or a function that uses it, where a plugin frame can read it (the SDK bridge in W6 only uses
`postMessage`, with the host checking `event.source`).

## The spike

Run by the end-to-end self-test (`e2e/selftest.js`, step "keeps Tauri IPC out of the plugin frame").
It installs `e2e/fixtures/ipc-spike` (id `e2e-ipc-spike`) and `plugins/examples/hello`, opens them as
the user would, and the spike page (`e2e/fixtures/ipc-spike/spike.js`) reports back with `postMessage`.

Checks inside the frame (all must be `true`):

| Check | Meaning |
| --- | --- |
| `noTauriInternals`, `noTauriGlobal`, `noIpcObject` | The Tauri globals are undefined. |
| `parentDocumentThrows`, `parentTauriThrows` | The frame cannot read the app. |
| `fetch ipc://localhost/…` and `fetch http://ipc.localhost/…` fail | The IPC fetch channels are closed. |
| `ownFileFetchAllowed`, `ownStylesheetLoads` | The CSP does not block the plugin's own files. |
| `otherOriginFetchBlocked`, `inlineScriptBlockedByCsp` | The CSP blocks everything else. |
| `keyless ipc message sent`, `guessed-key ipc message sent` | The frame posted `plugin_set_enabled {id: "e2e-ipc-spike", enabled: false}` to the native handler, once without a key and once with a wrong key. |

After the report the test reads `plugins_list` and requires the spike plugin to still be **enabled**.
If either message had been run, the plugin would be disabled.

### Result: Linux (WebKitGTK 2.52.6, Tauri 2.12.5, debug build, Xvfb)

```
{"noTauriInternals":true,"noTauriGlobal":true,"noIpcObject":true,"parentDocumentThrows":true,
 "parentTauriThrows":true,"fetch ipc://localhost/plugin_set_enabled fails":true,
 "fetch http://ipc.localhost/plugin_set_enabled fails":true,"ownFileFetchAllowed":true,
 "otherOriginFetchBlocked":true,"ownStylesheetLoads":true,"inlineScriptBlockedByCsp":true,
 "info: webkit ipc handler reachable":true,"keyless ipc message sent":true,
 "guessed-key ipc message sent":true}
- keeps Tauri IPC out of the plugin frame ... ok
```

The native handler **is** reachable from the frame (`info: webkit ipc handler reachable`), and both
messages were sent, but neither command ran: the spike plugin was still enabled afterwards. No change
to `capabilities/default.json` was needed.

### Result: WASM and workers on Linux (wave 8)

Self-test step "loads the WASM example's module and hashes in a worker and on the main thread"
(`plugins/examples/hash-wasm`), WebKitGTK 2.52.6, Tauri 2.12.5, debug build, Xvfb:

- `WebAssembly.instantiateStreaming` and the byte fallback both work in the sandboxed frame
  (`'wasm-unsafe-eval'`, `application/wasm`, CORS header).
- A worker started from the plugin's own URL (`new Worker("worker.js")`) fails, as the spec says it must.
  A `data:` worker fails too.
- A worker started from a Blob URL works, and a compiled `WebAssembly.Module` can be sent to it with
  `postMessage`. That is what `spawnWorker()` does. `location.origin` in the frame is not always the
  string `"null"` in WebKit, so the SDK does not branch on it and always uses the Blob URL.

### Result: Windows (WebView2)

**Not tested** (open item for 3.0.0): no Windows machine was available for this wave. Run
`npx tauri build --no-bundle --features e2e --config e2e/tauri.e2e.conf.json` and the self-test there
before the first release that contains plugins. Windows needs the same checks, and its URL form
(`http://shard-plugin.localhost/<id>/…`) and its `'self'` CSP matching are covered only by unit tests.

### Result: macOS

**Not tested** (open item for 3.0.0). It uses WKWebView, where the same two guards apply. Run the self-test
(`SHARD_E2E_SELFTEST=1`, see `e2e/selftest.js`) once on a Mac.

## If this ever fails

If a check turns `false` (IPC reachable from a plugin frame), stop shipping plugins. First tighten
`src-tauri/capabilities/default.json` (`"local": true` and an explicit deny of remote URLs) and run
the self-test again. Do not work around it in later waves.

## Zip packages (W9)

`plugin_inspect_zip(path)` and `plugin_install_zip(path, expectedSha?)` unpack a zip into
`plugins/.staging`, then run the same install pipeline as a folder install.

- **Paths**: an entry is refused when its name is empty, absolute, contains `..` or `.`, a backslash,
  a colon or a NUL. Finder and Explorer metadata (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, `._*`) is ignored
  wherever it sits. Links and other non-regular entries are skipped with a warning.
- **Root**: `plugin.json` at the top of the zip, or inside the one top folder (and nothing else at the top).
- **Limits**: 100 MB, 5,000 files and 5,000 folders, counted from the bytes actually written (a zip bomb stops at
  the limit). Encrypted entries are refused.
- **Checksum**: the SHA-256 of the zip file is the package's canonical checksum. It is stored as
  `sha256` and compared with `expectedSha` before anything is unpacked. The zip is first copied into
  staging while it is hashed, and the copy is what gets unpacked, so the hash is of the installed bytes. A sideload is recorded as
  `verified: false`.

## Hardening review (W29)

A pass over every layer a plugin touches, done for 3.0.0. Each line names where it is enforced and which test covers it.

| Layer | What holds | Where |
| --- | --- | --- |
| Protocol CSP | The fixed policy above on every response, with `nosniff` and `no-store`. Only enabled plugins are served. | `src-tauri/src/plugins/protocol.rs` (`csp_keeps_the_fixed_policy_and_names_only_its_own_plugin`) |
| Frame flags | `sandbox="allow-scripts"` and nothing else: no `allow-same-origin`, no popups, no forms, no top navigation. | `PluginFrame.tsx`, `tests/plugins/plugin-frame.test.tsx`, the self-test checks the attribute |
| Bridge messages | Only messages whose `source` is the plugin's own frame count. A message needs `v: 1`, a string `id` and a string `method`. Methods come from a fixed table (`hasOwnProperty`, so `__proto__` and `constructor` are unknown methods). The plugin id comes from the host, never from the message. | `src/plugins/bridge.ts`, `tests/plugins/bridge.test.ts` |
| Bridge arguments | Every method validates its own arguments: key 1 to 256 bytes, clipboard text up to 1 MB, file data up to 50 MB, file names without `/`, `\` or NUL, URL up to 2,048 characters, toast 1 to 500 characters. Storage is 1 MB per plugin. | `bridge.ts`, `src-tauri/src/plugins/storage.rs` |
| Bridge limits | Each call has a timeout (10 s, 35 s for `net.fetch`, none for file dialogs). A dialog allows one call at a time, and `net.fetch` six. | `bridge.ts` (`CALL_TIMEOUTS`, `limited`) |
| Permissions | Checked in the bridge on every call, and again in Rust for the commands that take a plugin id (`plugin_fetch` for `network`, the file-open command for `files:open`). Clipboard calls are checked in the bridge, the only path a frame has to them. A revoke applies on the next call. | `bridge.ts` (`gated`), `src-tauri/src/plugins/fetch.rs`, `files.rs` |
| Fetch allowlist | HTTP and HTTPS only. A host must be in the manifest's `network` hosts or granted by the user, with its port (default 80 or 443). Redirects are checked hop by hop (at most 5). `Host`, `Content-Length` and browser-identity headers cannot be set by a plugin. 30 s and 20 MB per request. | `src-tauri/src/plugins/fetch.rs` |
| Zip packages | Entry names are checked (no absolute paths, `..`, backslashes, colons, NUL). Limits are 100 MB, 5,000 files and 5,000 folders, counted on the bytes written. Encrypted entries are refused. | `src-tauri/src/plugins/zip.rs`, see [Zip packages](#zip-packages-w9) |
| Symlinks | A folder or zip install skips links and warns. Served paths go through `resolve_inside`, which also refuses a link that leaves the package. A link that replaces the entry file is refused. | `store.rs` (`symlinks_are_skipped_with_a_warning`), `protocol.rs`, `paths.rs` |
| Checksums | A repository install compares SHA-256 before anything is unpacked. A sideload is recorded as unverified and needs the "outside these repositories" setting. | `install.rs`, `zip.rs` |
| Crash isolation | A frame that reports an uncaught error (the SDK sends it), or does not finish the `ready` handshake within 10 s shows "This plugin stopped working" with Reload and Disable (a plugin that was only slow recovers when it says `ready`). The rest of the app keeps running. | `PluginFrame.tsx`, `HANDSHAKE_TIMEOUT_MS` |
| Hidden tabs | The panel of a plugin tab that is not selected is `inert` (no focus, no clicks), and the plugin is told with `onVisibilityChange` so it can pause. | `ToolHost.tsx`, `bridge.ts` (`notifyVisibilityChanged`) |

### Known limits (3.0.0)

- **IPC isolation is verified on Linux only.** The spike has not run on Windows (WebView2) or macOS (WKWebView). The two guards that keep the frame away from Tauri IPC (no capability for the remote `shard-plugin` origin, and the per-run invoke key) are the same on every platform, but run the self-test on each before trusting it there. See the results above.
- **DNS rebinding in `plugin_fetch`.** The allowlist matches the host name in the URL. A name the user allowed that resolves to a private or loopback address (a DNS answer the plugin's author controls, or a rebinding trick) is requested. The app does not resolve the name first and does not block private ranges, because a plugin such as a broker inspector legitimately talks to `localhost` and LAN hosts. Mitigation: the user sees the hosts at install time and grants `network` only to plugins they trust. Follow-up: resolve once, check the address against the user's list, and connect to that address.
- **Remote images in the Markdown plugin's preview are blocked.** The CSP has `img-src 'self' data: blob:` and no network image source, so `![x](https://…)` does not load. This is intended: allowing remote images would let a document ping a server when it renders. The plugin shows a note. Images as `data:` URLs work.
- **No fuzzing of the manifest validator.** The optional proptest pass was skipped, since it needs a new Rust dev dependency. The validator has unit tests in `src-tauri/src/plugins/manifest.rs`, and the TypeScript validator has its own suite (`tests/plugins/schema.test.ts`).
- **Plugins are not signed** (a SHA-256 from the index is the only check). Signed packages are a follow-up.
