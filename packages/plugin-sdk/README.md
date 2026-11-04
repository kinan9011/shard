# Shard plugin SDK (v1)

The way a plugin talks to the Shard app. A plugin's page runs in a sandboxed frame with no access to
the app, so every host call goes through `postMessage`. The SDK hides that behind a few promises.
It has no dependencies.

`storage`, `toast` and `theme` are open to every plugin. `clipboard`, `files` and `net` need a permission that the
plugin declares in `plugin.json` and the user grants. See [docs/plugins/permissions.md](../../docs/plugins/permissions.md).

## Use it

The plugin's content security policy allows scripts from the plugin's own files only, so ship the SDK
inside your package. `npm run sdk:build` (in the Shard repo) writes both builds to
`packages/plugin-sdk/dist/` and copies the ES module to `plugins/examples/hello/shard-sdk.js`.

```html
<script type="module" src="app.js"></script>
```

```js
import { connect, PermissionError } from "./shard-sdk.js";

const sdk = connect();
const { pluginId, theme } = await sdk.ready();
```

Without modules, load `shard-sdk.iife.js` and use `window.ShardSDK.connect()`.

## Plugin template

`template/` is a starter project: Vite, React and the app's Tailwind tokens, with the SDK built in and
the theme wired up. Copy it, change `public/plugin.json` and `package.json`, and edit `src/App.tsx`.

- `npm run dev`: a browser preview (there is no host, so SDK calls fail with a timeout).
- `npm run build`: `dist/` (the package), `release/<id>-<version>.zip` and `release/<id>-<version>.zip.sha256`.
  Install the zip, or `dist/`, with **Plugins → Install from folder / zip**.
- `src/shard-sdk.ts` is a copy of `src/index.ts` (a plugin can load only files of its own package).
  `npm run sdk:build` refreshes it, and a test fails when it is stale.
- `tailwind.preset.ts` carries the app's tokens (`bg-background`, `text-muted-foreground`, ...). The
  colors are CSS variables that the host sends in `theme.vars`: apply them to `:root` as the template does.

The official plugin repository, [`kinan9011/shard-plugins`](https://github.com/kinan9011/shard-plugins), holds the official plugins' sources and the release workflow that builds `index.json` (see `docs/plugins/index-format.md`).

## API

| Call | Result |
| --- | --- |
| `connect(options?)` | The SDK object. `options`: `timeoutMs` (default 15000), `target` (default `window.parent`), `self` (default `window`). |
| `sdk.ready()` | `{ pluginId, theme, locale, visible }`. Call it first, and within 10 s of loading: a plugin that has not done the handshake by then gets the "This plugin stopped working" screen. The app sends theme and visibility updates only after it. |
| `sdk.theme.get()` | The current `Theme`. |
| `sdk.theme.onChange(callback)` | Calls `callback(theme)` when the app theme or color scheme changes. Returns a function that unsubscribes. |
| `sdk.locale.get()` | The app language as `{ lang, dir }`: a BCP 47 tag such as `"de"` or `"zh-CN"`, and `"ltr"` or `"rtl"` (Arabic and Hebrew). No permission needed. |
| `sdk.locale.onChange(callback)` | Calls `callback(locale)` when the user switches the app language. Returns a function that unsubscribes. Set `document.documentElement.lang` and `.dir` from it to follow the app. Text fields in your plugin should use `dir="auto"` so a user can still type in the other direction. |
| `sdk.onVisibilityChange(callback)` | Calls `callback(true)` when the plugin's tab is shown and `callback(false)` when another tab covers it (the tab stays loaded). Pause timers and animations while hidden. Returns a function that unsubscribes. |
| `sdk.onInput(callback)` | Calls `callback(text)` when the user sends text to your plugin from another tool ("Send to…") or from a paste suggestion. No permission needed: the user chose to hand it over. Text sent before your first `onInput` call (for example while the frame was loading) is held and given to that first callback, so register right after `await sdk.ready()`. Up to 1 MB. Returns a function that unsubscribes. |
| `sdk.toast(message, kind?)` | Shows a notification in the app. `kind` is `info` (default), `success`, `warning` or `error`. The message is 1 to 500 characters, and the app shows your plugin's name next to it. |
| `sdk.storage.get(key)` | The stored value, or `null`. |
| `sdk.storage.set(key, value)` | Stores any JSON value except `null` and `undefined`. |
| `sdk.storage.remove(key)` | Deletes the key. |
| `sdk.clipboard.readText()` | The clipboard text. Needs `clipboard:read`. |
| `sdk.clipboard.writeText(text)` | Copies text, up to 1 MB. Needs `clipboard:write`. |
| `sdk.files.open({ accept?, as? })` | Shows the open dialog. `accept` is a list of extensions, `as` is `"text"` (default) or `"bytes"`. Resolves to `{ name, size, text }` or `{ name, size, bytes }`, or `null` when cancelled. Over 50 MB rejects. Needs `files:open`. |
| `sdk.files.save(name, data)` | Shows the save dialog with `name` suggested. `data` is a string, `Uint8Array` or `ArrayBuffer` (up to 50 MB). Resolves to `false` when cancelled. Needs `files:save`. |
| `sdk.net.fetch(url, init?)` | An HTTP(S) request made by the app. `init` is `{ method?, headers?, body? }` with a text body. Resolves to `{ status, ok, statusText, headers, url, body, text(), json() }`, also for 4xx and 5xx. Needs `network`. |

`loadWasm` and `spawnWorker` are plain functions, not host calls, and need no permission (see [WASM and workers](#wasm-and-workers)).

| Call | Result |
| --- | --- |
| `loadWasm(path, imports?)` | Fetches `path` (relative to the page), instantiates it, and resolves to `{ module, instance }`. |
| `spawnWorker(path, options?)` | Starts a Web Worker from a script of your package and resolves to the `Worker`. |

An uncaught error in the plugin (the `error` event) is reported to the app, which shows "This plugin stopped working" with Reload and Disable. Catch errors you can handle. A hidden plugin tab is also `inert`: it receives no focus or clicks.

A failed call rejects with `SdkError`. Its `code` is `bad_request` (wrong arguments),
`unknown_method`, `timeout`, `permission_denied` or `failed` (the host could not do it, for example storage is full, or
`net.fetch` was refused because the host is not allowed).

A call without the grant rejects with `PermissionError` (a subclass of `SdkError`, `code` `permission_denied`).
Its `permission` property names what was missing, so you can show a hint or fall back:

```js
try {
  await sdk.clipboard.writeText(text);
} catch (error) {
  if (error instanceof PermissionError) sdk.toast(`Copy is turned off (${error.permission})`, "warning");
  else throw error;
}
```

`files.open` and `files.save` wait for the user, so they have no timeout. `net.fetch` waits up to 40 seconds.

### Theme

`Theme` is `{ isDark, scheme, vars }`. `vars` holds the app's CSS custom properties (`--background`,
`--foreground`, `--primary`, `--border`, `--radius`, `--font-ui`, …). The color values are HSL
components, so use them as `hsl(var(--background))`. Set them on `:root` to match the app:

```js
function applyTheme({ vars, isDark }) {
  for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
  document.documentElement.classList.toggle("dark", isDark);
}
applyTheme(theme);
sdk.theme.onChange(applyTheme);
```

### WASM and workers

Set `"runtime": "wasm"` or `"web+wasm"` in `plugin.json` and ship the `.wasm` file in the package. WebAssembly runs
in your own frame, with no access to the system. The policy allows it (`'wasm-unsafe-eval'`).

```js
import { connect, loadWasm, spawnWorker } from "./shard-sdk.js";

const { instance, module } = await loadWasm("hash.wasm");   // instance.exports is yours to call
const worker = await spawnWorker("worker.js");              // keep heavy work off the UI thread
worker.postMessage({ module });                             // send the compiled module, not a URL
```

`loadWasm` streams the module and, if that fails, reads the bytes and instantiates them. A missing file rejects
with an `SdkError` that names the HTTP status.

Your frame has an opaque origin, and a browser starts a worker only from a script of the page's own origin, so
`new Worker("worker.js")` fails there. `spawnWorker` reads the script and always starts the worker from a Blob URL.
Because a Blob worker's location is `blob:`, it cannot resolve relative paths: send it a compiled
`WebAssembly.Module` (as above) or absolute URLs.

`plugins/examples/hash-wasm` is a full example: a Rust crate without wasm-bindgen that exports `alloc`,
`dealloc` and `sha256` over linear memory. Build it with `task plugin:example-wasm`.

### Storage

Each plugin has its own key-value store, saved on disk by the app. Keys are 1 to 256 bytes. All values
of a plugin together may use 1 MB; a `set` that would go over rejects with `failed` and changes nothing.
Uninstalling a plugin deletes its data. A call that rejects with `timeout` may still have finished on the app side, so read the value back before you retry a `set`.

## Wire protocol

All messages carry `v: 1`. The SDK and the app ignore anything else, and ignore any message that does not
come from the other side's window (`event.source`).

```
plugin → app   { v: 1, id: "k3-1", method: "storage.get", params: { key: "opened" } }
app → plugin   { v: 1, id: "k3-1", result: 4 }
               { v: 1, id: "k3-1", error: { code: "failed", message: "…" } }
               { v: 1, id: "k3-1", error: { code: "permission_denied", message: "…", permission: "network" } }
app → plugin   { v: 1, event: "theme", data: { isDark, scheme, vars } }
```

Methods: `ready`, `theme.get`, `toast`, `storage.get`, `storage.set`, `storage.remove`, `clipboard.readText`,
`clipboard.writeText`, `files.open`, `files.save`, `net.fetch`. The app answers a call that takes longer than
10 seconds with `timeout` (35 seconds for `net.fetch`, no limit for `files.*`), and the SDK gives up after `timeoutMs`.
The host side is `src/plugins/bridge.ts`.
