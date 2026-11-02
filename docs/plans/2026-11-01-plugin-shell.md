# DevTools 3: Plugin Shell — implementation plan (waves)

## Context
The user designed DevTools 3 in `docs/Design/side-by-side-diff-merger/project/Plugin Shell.dc.html`.
Tools become installable plugins: web UI with an optional WASM backend. Plugins come from
GitHub repositories (an `index.json` listing many plugins, or a single-plugin repo published
as GitHub Releases), or from a zip, a folder or a repo URL. Permissions are declared and
approved by the user. Packages are checked by SHA-256.
The design shows two layouts: Sidebar (default, screens 1a 01–09) and Launcher (option,
screens 1b 01–09). It also covers first run (2a), Settings → Appearance (2b) and editing
pinned tools on Home (2c).
The other two mockups (`Diff Merge Tool.dc.html`, `Folder Compare.dc.html`) are **already
built** on `feat/diff-merge`. They are out of scope.

Decisions made with the user:
- **9 core built-ins**: JSON Viewer, Code Playground, Regex Tester, JSON to Code, JSON Schema
  Validator, JSON Diff, Text Compare, Diff & Merge, JWT Decoder. They can be hidden but not
  uninstalled.
- **The other 62 tools stay built in for now.** They are marked `legacy` (they will become
  plugins). This plan ports 5 pilot tools. The rest get later waves, one per category, into
  `kinan9011/devtools-plugins`.
- **Branch**: commit the current work on `feat/diff-merge`, then branch `feat/plugin-shell` from it.
- **Both layouts**: Sidebar first. Launcher comes in late waves.

Locked architecture (from the earlier discussion and the design):
- **Plugin UI** runs in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the
  origin is opaque), served by a Tauri custom protocol `devtools-plugin://<id>/…`. It has no
  Tauri IPC. All host access goes through a `postMessage` SDK that the host checks against
  the permissions the user granted.
- **WASM** runs inside the plugin's own iframe or worker (browser WASM). There is no WASM
  runtime on the Rust side.
- **Native work** (downloads, unzip, file dialogs, HTTP with a host allowlist) lives in core
  Rust and is exposed as SDK calls.
- **Verification**: SHA-256 from the index or from a release asset. Sideloads (zip, folder,
  URL outside any repository) are unverified and gated by the setting "Allow installs from
  outside these repositories". Signatures are a follow-up, not v1.

## Rules for every wave
- One wave = one session = one or a few commits on `feat/plugin-shell`. The app runs and all
  tests pass at the end of every wave.
- Gate: `npm run typecheck && npm run lint && npm test && (cd src-tauri && cargo test && cargo clippy -- -D warnings)`.
- New Tauri commands go into **both** `generate_handler!` lists in `src-tauri/src/main.rs`
  (normal and `e2e`).
- Reuse: `resolve_inside` (moved to `src-tauri/src/paths.rs` in W3), the `blocking()` helper
  pattern from `folder_compare.rs`, `useDialogFocus`, `AnchoredPanel`, shadcn `ui/*`,
  `CopyButton`, sonner toasts, `ajv` (already a dependency) for manifest/index validation,
  `semver` (JS dependency; Rust crate is already in Cargo.lock), and `fflate` only if the
  frontend ever needs zip (it shouldn't: unzip happens in Rust).
- UI waves match the design pixel for pixel (spacing, sizes, copy) using the existing tokens
  in `src/index.css` and `src/themes.css`. Design hex values map to tokens, not literals.
- Copy is taken verbatim from the design text.

## Shared formats (fixed in W2, referenced by later waves)
**`plugin.json` (manifest)**
```json
{
  "id": "kafka-inspector",            // ^[a-z0-9][a-z0-9-]{1,63}$, unique; never a core/legacy tool id
  "name": "Kafka Inspector",
  "version": "0.3.1",                 // semver
  "description": "Browse topics and decode messages from a local broker.",
  "longDescription": "…",             // detail Overview (plain text / limited markdown)
  "category": "Development",          // free string; matched to sidebar categories
  "keywords": ["kafka", "avro"],
  "icon": "icon.svg",                 // file in package, or "lucide:<Name>"
  "entry": "index.html",
  "runtime": "web" | "wasm" | "web+wasm",
  "permissions": [
    { "name": "network", "hosts": ["localhost:9092"], "reason": "Connect to localhost:9092 and brokers you add", "optional": false },
    { "name": "files:open", "reason": "Read files you open in the tool" },
    { "name": "clipboard:write", "reason": "Copy decoded messages", "optional": true }
  ],
  "minAppVersion": "3.0.0",
  "license": "MIT",
  "source": "https://github.com/kinan9011/kafka-inspector",
  "screenshots": ["shot1.png"],
  "changelog": "CHANGELOG.md"
}
```
**Permission names (v1)**: `clipboard:read`, `clipboard:write`, `files:open`, `files:save`,
`network` (needs `hosts`; HTTP(S) only), `storage` (implicit, per-plugin key-value store,
1 MB, always granted). `wasm` is implied by `runtime` and shown as an informational row
("Runs sandboxed, with no direct access to your system").

**`index.json` (multi-plugin repo, at repo root on the default branch)**
```json
{ "schema": 1, "name": "DevTools Official",
  "plugins": [ { "id": "…", "name": "…", "version": "…", "description": "…", "category": "…",
    "runtime": "web", "permissions": [ … same shape … ], "minAppVersion": "3.0.0",
    "url": "https://github.com/…/releases/download/…/kafka-inspector-0.3.1.zip",
    "sha256": "<64 hex>", "size": 2516582, "released": "2026-10-18",
    "changelog": "Adds …", "icon": "https://raw…/icon.svg" } ] }
```
**Single-plugin repo (GitHub Releases)**: the latest release has the assets `plugin.json`,
`plugin.zip` and `plugin.zip.sha256`. Detection uses no GitHub API (60 requests per hour
unauthenticated):
- `GET raw.githubusercontent.com/<o>/<r>/HEAD/index.json`. A 200 means an index repo.
- Otherwise `GET github.com/<o>/<r>/releases/latest/download/plugin.json`. A 200 means a
  releases repo.
- Otherwise the error "Not a plugin repository".

**On-disk layout** (`app_data_dir`):
- `plugins/<id>/` holds the unpacked package.
- `plugins/.staging/` holds temporary unpacks.
- `plugins.json` is the installed registry: id, version, source (`{kind: repo|zip|folder|url, repo?, url?}`),
  sha256, verified, enabled, granted permissions, installedAt.
- `repos.json` holds repositories: url, name, type, enabled, lastSync, lastError, official flag.
- `repo-cache/<hash>.json` holds the last fetched index for each repository.
- `plugin-data/<id>.json` holds SDK storage.

---

## Wave 0 — Housekeeping: commit current work, branch, save plan
1. On `feat/diff-merge`, verify the uncommitted resizable-panes work:
   `npm run typecheck && npx vitest run tests/tools/diff-merge-panes.test.tsx`.
2. Commit `src/components/tools/diff-merge/DiffPanes.tsx`, `folder/FolderView.tsx`,
   `src/index.css` and `tests/tools/diff-merge-panes.test.tsx` as
   `feat(diff-merge): resizable left/right and table/diff splits`.
3. Commit `docs/Design/` as `docs: add DevTools 3 plugin shell design handoff`.
4. Run `git switch -c feat/plugin-shell`.
5. Copy this plan to `docs/plans/2026-11-01-plugin-shell.md` and commit it as
   `docs: plugin shell implementation plan`.

**Done when** `git status` is clean on `feat/plugin-shell` and the 3 commits are visible in the log.

---

## Phase A — Foundations (no visible UI change)

### Wave 1 — Tool catalog abstraction
**Goal**: the shell renders tools from a catalog that can hold dynamic plugin tools, not
only the `ALL_TOOLS` const.
- `src/app/toolRegistry.ts`: add `kind: "core" | "legacy"` to every entry (9 core per the
  decision list, the rest legacy). Keep `ALL_TOOLS`, `TOOL_COMPONENTS` and `BuiltinToolId`
  (rename the existing `ToolId` and keep an alias for now).
- New `src/app/catalog.ts`: `CatalogTool = { id: string; name; category; keywords; icon: IconRef;
  source: "core" | "legacy" | "plugin"; pluginId?: string }`, `buildCatalog(builtins, plugins, hidden)`
  and `groupByCategory()`.
- New `src/app/useToolCatalog.ts`: a hook that returns the catalog. Plugins are an empty
  list for now. It reads a hidden set from localStorage `devtools-hidden-tools`.
- Switch `DevToolsApp.tsx`, `CommandPalette.tsx` and `PasteSuggestions.tsx` from
  `ALL_TOOLS`/`CATEGORIES`/`TOOL_BY_ID` to the catalog. Tabs, recents and favorites store
  string ids, so unknown ids are dropped on load.
- `write_tool_manifest` (Raycast export) keeps working from the catalog.
- **Tests**: `tests/app/catalog.test.ts` covers grouping, hidden filtering and unknown-id
  pruning. Existing `tests/app/devtools-*.test.tsx` stay green.

### Wave 2 — Split the shell: Sidebar, Home, ToolHost out of DevToolsApp
**Goal**: make the 1,179-line `src/app/DevToolsApp.tsx` small enough for the later UI waves.
No behaviour change.
- Extract `src/components/app/Sidebar.tsx` (category tree, search, footer with version and
  What's new), `src/components/app/Home.tsx` (current workspace home), `src/components/app/ToolHost.tsx`
  (memoised `ToolPanel` and the Suspense per tab) and `src/components/app/TopTabs.tsx`.
- `DevToolsApp` keeps the state and routing. Add a `view` state:
  `{ kind: "home" } | { kind: "tool"; id } | { kind: "plugins"; tab } | { kind: "settings"; section }`.
  Only home and tool are used for now.
- **Tests**: the existing navigation, tab menu, shortcuts, paste and theme suites pass
  unchanged. That is the acceptance check.

### Wave 3 — Manifest and index spec, validators (TS + Rust)
- Docs: `docs/plugins/manifest.md`, `docs/plugins/index-format.md` and
  `docs/plugins/permissions.md`, using the formats above.
- TS: `src/plugins/schema.ts` (ajv JSON schemas for the manifest and the index),
  `src/plugins/types.ts`, and `validateManifest()`/`validateIndex()` that return readable errors.
- Rust: move `resolve_inside` from `folder_compare.rs` to `src-tauri/src/paths.rs` and
  re-export it. Add `src-tauri/src/plugins/mod.rs` and `plugins/manifest.rs`: serde structs
  plus `validate()` (id regex, semver via the `semver` crate, entry exists, permission names
  known, `network` has `hosts`, the id doesn't collide with a builtin id list passed from TS
  at startup or hardcoded from `toolRegistry`).
- Add `semver` and `sha2` as direct dependencies in `src-tauri/Cargo.toml` (both already in the lock).
- **Tests**: Rust unit tests with good and bad fixtures in `src-tauri/tests/fixtures/plugins/`.
  TS tests in `tests/plugins/schema.test.ts`.

### Wave 4 — Rust plugin store: install from folder, list, enable, uninstall
- `src-tauri/src/plugins/store.rs`: load and save `plugins.json` (write to temp, then
  rename). Folder install: validate the manifest → copy to `.staging/<uuid>` → compute the
  package sha256 (sorted file list plus contents, for display) → atomically replace
  `plugins/<id>`. An existing install of the same id counts as an update.
- Limits: 100 MB total, 5,000 files, no symlinks (skip with a warning), no absolute or `..`
  paths.
- Commands: `plugins_list`, `plugin_install_folder(path)`, `plugin_uninstall(id)`,
  `plugin_set_enabled(id, enabled)` and `plugin_pick_folder` (reuse `pick_folder`).
  They return `InstalledPlugin` DTOs.
- TS: `src/plugins/api.ts` (typed invoke wrappers, with a no-op in the web build where
  `isDesktop()` is false; see `src/lib/desktop.ts`) and `src/plugins/usePlugins.ts`
  (state plus refresh).
- `useToolCatalog` now merges enabled plugins (`source: "plugin"`).
- **Tests**: Rust store tests in a `tempfile` dir (install, reinstall, uninstall, a corrupt
  `plugins.json` gets backed up and reset, limit violations). TS tests for the catalog merge.

### Wave 5 — Plugin protocol and sandboxed frame (includes the IPC isolation spike)
- `src-tauri/src/plugins/protocol.rs`: `register_asynchronous_uri_scheme_protocol("devtools-plugin")`.
  It maps `devtools-plugin://<id>/<path>` (on Windows `http://devtools-plugin.localhost/<id>/…`)
  to `plugins/<id>/` through `resolve_inside`, guesses the MIME type (including
  `application/wasm`), returns 404 for disabled or unknown plugins, and sets the header
  `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors *`.
- `src/components/plugins/PluginFrame.tsx`: `<iframe sandbox="allow-scripts" src=…>`,
  full size, `title=` the plugin name, plus loading and error states. `ToolHost` renders it
  when a catalog tool has `source: "plugin"`.
- Example `plugins/examples/hello/` (manifest plus `index.html`, static, no SDK yet).
- **Spike checks, recorded in `docs/plugins/security.md`**: inside the frame,
  `window.__TAURI_INTERNALS__` is undefined, `fetch("ipc://localhost/…")` fails, and
  `parent.document` throws. Check this on Linux (webkitgtk) and on Windows if available.
  If IPC leaks, tighten `src-tauri/capabilities/default.json` with an explicit `"local": true`
  and remote URL deny, and re-test. **This wave blocks every later wave.**
- **Tests**: Rust protocol path tests (traversal, disabled plugin, MIME). A React test that
  `PluginFrame` renders the sandbox attribute exactly. The `e2e/selftest.js` smoke test
  opens the hello plugin.

### Wave 6 — Plugin SDK v1 and host bridge (no permissions yet)
- Package `packages/plugin-sdk/`, zero dependencies:
  - `src/index.ts` exports `connect()` → `{ ready(), theme.get()/onChange(), toast(msg, kind), storage.get/set/remove }`.
    It uses request/response over `postMessage` with ids, `{v:1}` versioning and timeouts.
  - Build with Vite library mode to ESM plus an IIFE (`window.DevToolsSDK`).
  - Write a README.
- Host: `src/plugins/bridge.ts`. The listener accepts a message only when
  `event.source === frame.contentWindow`, it checks the message shape, and it dispatches
  from a method table. The theme snapshot is the computed CSS custom properties from
  `:root` plus `isDark` and the scheme. It is sent on `ready` and whenever the theme or
  scheme changes (hook into the existing theme effect in `DevToolsApp`).
- Storage: Rust commands `plugin_storage_get/set` writing `plugin-data/<id>.json` (1 MB cap).
- Update the hello example to use the SDK so it matches the app theme.
- **Tests**: bridge unit tests with a fake `MessageEvent` (rejects a foreign `source`,
  rejects unknown methods, times out). An SDK round-trip test in jsdom with two windows.

### Wave 7 — Permissions: model, grants, enforcement
- `src/plugins/permissions.ts` holds permission metadata: label, icon, the default reason
  copy from the design ("Network", "Files", "Clipboard", "WASM backend") and
  required/optional.
- Grants are stored per plugin in `plugins.json` (`granted: string[]`), managed by
  `plugin_set_grants(id, grants)`.
- Bridge methods gated by grant:
  - `clipboard.writeText` and `clipboard.readText` use the existing clipboard-manager plugin
    from the host side.
  - `files.open({accept})` uses the host dialog through `tauri-plugin-dialog` and returns
    `{name, size, text | bytes}` with a 50 MB cap.
  - `files.save({name, data})` reuses the existing `save_file` command.
  - `net.fetch(url, init)` goes to Rust `plugin_fetch(id, req)`, which uses reqwest with a
    host:port allowlist built from the manifest `hosts` plus hosts the user added, a 30 s
    timeout, a 20 MB response cap and no redirects to other hosts.
- An ungranted call returns `{error: "permission_denied", permission}`. The SDK throws a
  typed `PermissionError`.
- Add `reqwest` (rustls, the same version as the lock) as a direct dependency.
- **Tests**: a deny/allow matrix in bridge tests. Rust `plugin_fetch` allowlist tests against
  a local `TcpListener` (allowed host, blocked host, redirect to a blocked host, oversized
  body).

### Wave 8 — WASM backend support and example
- SDK helper `loadWasm(path)` (`WebAssembly.instantiateStreaming` with an
  `fetch(new URL(path, location.href))` fallback) and `spawnWorker(path)`. This needs the
  sandboxed frame to be able to create workers from the plugin origin. If webkitgtk blocks
  workers in opaque-origin frames, fall back to a Blob-URL worker and document it.
- Example `plugins/examples/hash-wasm/`: a tiny Rust crate (`crate-type = ["cdylib"]`, no
  wasm-bindgen, exporting `sha256` over linear memory) plus a web UI. Add a `Taskfile.yml`
  target `plugin:example-wasm` that builds it with `cargo build --target wasm32-unknown-unknown --release`.
- **Tests**: a protocol test that `.wasm` is served as `application/wasm`. A manual check
  that the example hashes a file in the app. A selftest assertion that the module loads.

---

## Phase B — Distribution

### Wave 9 — Install from zip
- `src-tauri/src/plugins/zip.rs`: unzip with the `zip` crate (direct dependency, already in
  the lock) into `.staging`.
  - Guard against zip-slip with the same path rules as W4.
  - Accept a package root either at the top level or inside a single top folder.
  - Enforce the same limits, and reject encrypted entries.
  - Compute the sha256 of the zip file itself; this is the canonical checksum from now on.
- Hand off to the W4 install pipeline.
- Commands: `plugin_inspect_zip(path)` (returns the manifest plus sha256 without
  installing, for the preview UI) and `plugin_install_zip(path, expectedSha?)`.
- **Tests**: fixture zips (nested root, zip-slip, too big, missing manifest, checksum
  mismatch).

### Wave 10 — Repositories: add, detect, sync
- `src-tauri/src/plugins/repos.rs`: `repos.json`. Detection follows the rules in *Shared
  formats*. Parse `github.com/<o>/<r>` URLs, with or without `.git` or a trailing slash.
  Sync fetches the index or the release `plugin.json`, validates it, writes
  `repo-cache/<hash>.json`, and records `lastSync`/`lastError` (for example
  `index.json not found (404)`).
- The official repo `github.com/kinan9011/devtools-plugins` is seeded on first launch. It
  can be turned off but not removed.
- Commands: `repo_list`, `repo_add(url)`, `repo_remove(url)`, `repo_set_enabled`,
  `repo_sync(url?)` (all when no url), `repo_catalog()` (merged entries tagged with their
  repo name).
- Settings in `repos.json`: `checkOnStart: bool` and `allowOutside: bool`.
- **Tests**: Rust tests with a mock HTTP server (`tiny_http` dev-dependency, or the
  std-listener helper from W7): index repo, releases repo, 404, invalid JSON, schema error,
  official repo protected.

### Wave 11 — Install and update from repositories, install from repo URL
- `plugin_install_from_repo(repoUrl, id)`: download `url` with progress events
  (`plugin://progress` event: id, received, total) → verify the sha256 equals the index
  value → W9 pipeline → record source `{kind: "repo", repo}` and `verified: true`.
- `plugin_lookup_url(url)` does the detection for one URL and returns a preview: name,
  version, size, runtime, whether the checksum matches. `plugin_install_from_url(url, addRepo)`
  installs; when `addRepo` is set it also calls `repo_add`.
- A sideload (folder, zip, or URL without a repo) is refused unless `allowOutside` is set.
  Such installs are recorded as `verified: false`.
- Updates: `plugin_updates()` compares installed versions with repo versions by semver.
  It returns `{id, from, to, changelog, newPermissions[]}`. `plugin_update(id)` reuses the
  install path. If `newPermissions` is non-empty, the grant set needs re-approval (the UI
  enforces this in W16, and Rust keeps the old grants until `plugin_set_grants`).
  `minAppVersion` above the app version hides the update ("Requires DevTools X").
- Check on start: if `checkOnStart` is set, sync all repos in the background and emit
  `plugins://updates` with the count.
- **Tests**: Rust tests for a checksum mismatch (install aborted, nothing left in staging),
  an update with a new permission, minAppVersion filtering and the `allowOutside` gate.

---

## Phase C — Sidebar layout UI (design 1a, dark and light)
Each UI wave adds a React Testing Library test file under `tests/plugins/`, mocks
`src/plugins/api.ts`, and checks the main copy and interactions.

### Wave 12 — Plugins page shell and Browse list (screen 02 A)
- `view.kind === "plugins"` renders `src/components/plugins/PluginsPage.tsx`:
  - Title "Plugins", subtitle "Add tools from your repositories, a zip file, a folder or a
    repo URL.", and the button "Install from file or URL" (opens W15, disabled until then).
  - Tabs "Browse", "Installed" with an updates count badge, "Repositories" with a count.
- `BrowseTab.tsx`:
  - Left filter column: a Repository select ("All repositories"), Category with counts, and
    Runtime chips (Web / Web + WASM).
  - Search plus "N plugins from M repositories" and "Sort: Name".
  - List rows: name, runtime badge, description, "repo · version", and an action
    (Install / Installed / Update to x).
- Data: `repo_catalog()` joined with `plugins_list()` in `usePluginCatalog()`.
- Temporary entry point: a "Plugins" item in the sidebar footer (the final placement comes in W18).

### Wave 13 — Plugin detail pane (screen 03 A)
- List and detail split: a 380 px list, and a detail pane for the selected plugin.
- Header: name, "author · from owner/repo", badges (runtime, "Third-party" when the plugin
  isn't from the official repo, version) and the primary action.
- Tabs: Overview (description, details grid: Version + released, Size, Runtime, Requires,
  License, Source link, and Checksum "SHA-256 9c41f2…be07a matches release"), Permissions N
  (rows with icon, reason and Required/Optional) and Changelog.
- `src/components/plugins/PermissionList.tsx` is reused by W14.

### Wave 14 — Permission approval and the install flow (screen 07 A)
- `PermissionDialog.tsx`:
  - Title "Allow <name> to:" and "Version x from <source>".
  - The permission list. Optional permissions have a switch (default on). Required ones show
    a "Required" tag.
  - A verification line: "SHA-256 checksum matches the release." or the unverified warning.
    For third-party plugins add "Third-party plugin. It isn't listed in the DevTools
    Official repository."
  - Footer "Optional permissions can be changed later in Installed." with Cancel and
    "Allow and install".
- Flow hook `useInstallFlow()`: Install → dialog (skip it when the plugin asks for no
  permissions; then a toast is the only confirmation) → `plugin_install_from_repo` with
  inline progress on the row/button → `plugin_set_grants` → toast "Installed" plus an "Open"
  action.
- Error toasts: checksum mismatch, network, minAppVersion.

### Wave 15 — Install from zip, folder or URL dialog (screen 06 A)
- `InstallDialog.tsx`:
  - Title "Install plugin" and subtitle "From a zip file, a folder, or a GitHub repository URL."
  - Drop zone "Drop a plugin .zip or folder here" (Tauri `onDragDropEvent` on the window,
    active only while the dialog is open) with the buttons "Choose zip file" and "Choose folder".
  - Divider "or from a repository URL", a URL input, and "Look up".
  - Preview card: "<name> <version>", "Latest GitHub release vX · size · runtime" and
    "Checksum matches".
  - Checkbox "Add this repository so the plugin gets updates", with Cancel and Continue.
- Continue leads to the W14 permission dialog.
- When `allowOutside` is off, show an inline explanation with a link to the Repositories tab.

### Wave 16 — Installed and updates tab (screen 04 A)
- "Updates available · N" with "Update all". Rows show name, from → to, the changelog line,
  and Update. When an update adds permissions, show the "New permission" tag and send
  Update through the permission dialog in "update" mode, highlighting the new rows.
- "Installed plugins · N" table: Name, Version, Source, Runtime, Enabled (switch), and a
  row menu (Permissions… which reopens the dialog in "manage" mode, Uninstall with confirm,
  Show in folder).
- Built-in line: "N built-in tools · JSON Viewer, Code Playground, Regex Tester and N more.
  Built in, so they can be hidden but not uninstalled." with "Show", which expands a list
  with Hide/Show switches backed by the W1 hidden set.

### Wave 17 — Repositories tab (screen 05 A)
- A URL input "https://github.com/owner/repo" and "Add repository", with the helper text
  from the design.
- Table: Repository (name, Official tag, url), Type (index.json / GitHub Releases), Plugins
  count, Status ("Synced 10 min ago" in relative time, or the error in destructive colour),
  On (switch), and a menu (Sync now / Retry, Remove). The Official row has no Remove.
- Footer toggles: "Check for updates When the app starts" and "Allow installs from zip
  files, folders and URLs outside these repositories".

### Wave 18 — Sidebar and Home integration (screens 01 A, 09 A)
- Sidebar: plugin tools merge into their categories. A "Plugins" destination with the
  update badge and "Settings" sit at the bottom, above "v3.0.0 · What's new". Remove the W12
  temporary entry.
- Home: the update banner "2 plugin updates are ready: A and B." with Review (→ Installed
  tab). The "Quick access" grid shows a "Plugin" tag on plugin tools.
- Empty states (09 A): a sidebar card "No tools installed" with "Browse plugins". The Home
  card offers "Browse plugins" and "Install from file or URL". These show when every
  built-in is hidden and no plugins are installed.
- Command palette: plugin tools are searchable. Add the commands "Open Plugins" and
  "Check for plugin updates".
- Deep links: `devtoolsapp://tool/<pluginId>` works for plugins too (`src/utils/deep-link.ts`).

### Wave 19 — Settings page: shell and Appearance (screen 2b)
- `view.kind === "settings"` renders `src/components/app/settings/SettingsPage.tsx`, with
  section nav General / Appearance / Home / Plugins / Shortcuts / About.
- Appearance moves the logic from `AppearanceMenu.tsx`: Theme (System / Light / Dark), the
  colour scheme picker, "Sidebar categories" (Remember / All open / All closed) and "Open
  tools in" (New tab / Current tab). The Layout cards are rendered but Launcher is disabled
  with "Coming soon" until W23.
- `AppearanceMenu` becomes a shortcut that opens Settings → Appearance (or is removed, with
  tests updated).

### Wave 20 — Settings: General, Shortcuts, Plugins, About
- Shortcuts reuses the body of `ShortcutSettingsDialog.tsx` (extracted into a component;
  the dialog keeps working or is retired).
- General holds auto-update (`devtools-auto-update`) and the global shortcut.
- Plugins links to the Repositories toggles.
- About shows the version, What's new and links.
- **Tests**: update `devtools-shortcuts`, `devtools-theme` and `devtools-auto-update` for
  the new entry points.

### Wave 21 — Home: pinned tools with edit mode (screen 2c)
- Migrate `devtools-favorites` to `devtools-pinned` (an ordered string id list, max 12).
  The sidebar gets a "Pinned" group at the top.
- Edit mode: "Pinned tools · Drag to reorder" with Add tool / Done, tiles that can be
  dragged (native HTML5 drag-and-drop plus keyboard reordering with Alt+↑/↓; no new
  dependency), remove ×, and an "Add tool" tile.
- The add picker uses `AnchoredPanel`: search, rows with a Built-in / Plugin / "Not
  installed" tag (not-installed rows come from the repo catalog and install on pick through
  W14), and the footer "6 of 12 pinned · Enter to pin".
- **Tests**: migration, reorder by keyboard, the cap of 12, and pick-to-install.

### Wave 22 — First-run wizard, steps 2–3 (screen 08 A)
- Shown when `devtools-first-run-done` is unset and the app is ≥ 3.0.0. Existing users
  upgrading see only a one-time "Plugins are here" banner, not the wizard.
- Step header "1 Layout · 2 Pick starter tools · 3 Pin tools to Home". Step 1 is skipped
  until W25.
- Step 2: plugins from the official repo grouped by category, with checkboxes. The footer
  "Step 2 of 3 · N plugins selected · X MB" with Skip and "Install and continue" (batch
  install with one combined permission dialog listing each plugin's permissions). The note
  "Built-in: …" lists the 9 core tools.
- Step 3: pick pinned tools (reuses the W21 picker).
- Offline: step 2 shows "Couldn't reach DevTools Official" with Retry and Skip.

---

## Phase D — Launcher layout (design 1b)

### Wave 23 — Layout setting and Launcher top bar plus Home (screen 01 B)
- Setting `devtools-layout: "sidebar" | "launcher"`, applied live in Settings → Appearance.
- Launcher shell: a 52 px header with the logo, open-tool tabs (reuse `TopTabs`), the
  "Find a tool or command Ctrl+K" search trigger, and a Plugins button with a badge.
  No sidebar.
- Launcher Home: the search hero "Find a tool, or paste JSON, a JWT, a URL or a timestamp",
  the paste hint, "Pinned · Drag to reorder", category groups as chip rows, and the "Get
  more tools" card.

### Wave 24 — Launcher plugin screens (02 B – 07 B)
- `PluginsPage` gets a `variant="cards"` prop.
- Browse becomes a 3-column card grid, with category chips replacing the filter column.
- Detail becomes a full page with a back link "← Plugins", a two-column layout (content plus
  a 320 px aside with Details and "Asks for"), and a screenshot from the manifest.
- Installed becomes a banner plus "Plugins · N" cards and the "Built-in · N Can be hidden,
  not uninstalled" chips.
- Repositories becomes cards with Sync now / Remove / Retry and the line "Official
  repository can be turned off, not removed".
- The dialogs (W14, W15) are shared unchanged.

### Wave 25 — First-run layout step and launcher variants (2a, 08 B, 09 B)
- Step 1 "How do you want to move between tools?" with Sidebar (Default, preselected) and
  Launcher cards, and "Step 1 of 3 · Continue".
- Launcher first run (08 B): bundles ("Web & APIs", "Data & SQL", "Ops & infrastructure",
  "Security") defined in the official `index.json` under an optional `bundles` key (add it
  to the schema in this wave), "Choose plugins one by one" (switches to the step 2 list),
  and the footer "N bundles · N plugins · X MB".
- Launcher empty state (09 B).

---

## Phase E — Ecosystem and pilot ports

### Wave 26 — Plugin template, build script, official repo bootstrap
- `packages/plugin-sdk/template/`: a Vite plus React (optional) plugin template that uses
  the SDK, the Tailwind preset from the app tokens, `plugin.json` and a `build` script that
  outputs `dist/` plus `<id>-<version>.zip` plus `.sha256`.
- `scripts/plugin-index.mjs` builds or updates `index.json` from a folder of built plugin
  zips.
- New repo `kinan9011/devtools-plugins` (created with `gh` after the user confirms):
  `plugins/<id>/` sources, a GitHub Actions workflow that builds changed plugins on tag,
  uploads release assets and commits the updated `index.json`, and a README for authors.

### Wave 27 — Port pilot 1: Hash Generator (WASM) and UUID Generator (web)
- Move `HashGenerator` and `UuidGenerator` plus their utils to plugins in
  `devtools-plugins`. Hash uses the W8 WASM pattern.
- In this repo, remove the legacy entries from `toolRegistry.ts`, delete the components and
  utils that only they used, and move their tests to the plugin repo.
- Id migration: `src/app/legacyMigration.ts` maps old tool ids to plugin ids. On upgrade, if
  a ported tool was pinned, open or recent, show the Home banner "Hash Generator is now a
  plugin. Install" (one click, repo source, the permission dialog only if needed). Its
  pin, tab and recent slots are kept and resolve once installed.

### Wave 28 — Port pilot 2: Cron Calculator, Markdown, Color Palette
- Same steps as W27. Markdown needs `clipboard:write`. Color Palette needs none.
- Update the paste-suggestion detectors (`src/utils/clipboard-detect.ts`) so that a ported
  tool's suggestion shows "Install <tool>" when it isn't installed.

### Wave 29 — Hardening and release prep
- Security pass on `docs/plugins/security.md`: protocol CSP, iframe flags, bridge message
  validation, fetch allowlist, zip limits, and symlink handling. Fuzz the manifest
  validation with proptest (optional).
- Crash isolation: a plugin frame that errors shows "This plugin stopped working · Reload ·
  Disable" (`error` event plus a 10 s handshake timeout).
- Performance: hidden plugin tabs get `inert` and the SDK `onVisibilityChange` (mirrors
  `useToolActive`).
- Update the e2e smoke test (`e2e/smoke.mjs`, `e2e/selftest.js`): install the hello plugin
  from a folder fixture, open it, uninstall it.
- Bump the version to 3.0.0 (`package.json`), write release notes in `release-notes/`, and
  update the README.

### Later (not in this plan)
- Port the remaining legacy tools, one wave per category.
- Signed packages (ed25519, reusing the updater key tooling).
- Auth token for private GitHub repos.
- Raw TCP for plugins (Kafka needs it; v1 is HTTP only).
- Plugin-to-plugin dependencies.

## Critical files
- `src/app/toolRegistry.ts`, `src/app/DevToolsApp.tsx`, `src/components/app/CommandPalette.tsx`,
  `src/components/app/AppearanceMenu.tsx`, `src/components/app/ShortcutSettingsDialog.tsx`
- `src-tauri/src/main.rs`, `src-tauri/src/folder_compare.rs` (the `resolve_inside` source),
  `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`
- New: `src/app/catalog.ts`, `src/plugins/*`, `src/components/plugins/*`,
  `src/components/app/settings/*`, `src-tauri/src/plugins/*`, `src-tauri/src/paths.rs`,
  `packages/plugin-sdk/*`, `plugins/examples/*`, `docs/plugins/*`

## Verification (whole plan)
- Per wave: the gate commands above, plus the wave's own tests.
- UI waves: run the app (`npm run dev`, the run skill) and compare each screen with its
  `data-screen-label` in `Plugin Shell.dc.html`, in dark and light.
- End to end, after W11 and again after W29:
  1. Add the hello example's local index through a fixture repo served by `python -m http.server`.
  2. Install, approve the permissions, open the plugin, and check that the theme follows the
     app toggle.
  3. Deny clipboard and check that the plugin gets `PermissionError`.
  4. Publish a new version, check that the update badge shows, and update.
  5. Uninstall.
  6. Check the sideload gate and that a checksum mismatch is refused.
