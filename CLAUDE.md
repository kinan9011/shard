# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Shard is an offline-first Tauri 2 desktop app (React 18, TypeScript, Vite, Tailwind, shadcn/ui) with a Rust backend. It is a fork of DevTools (me-shaon/devtools, MIT) rebranded as Shard. The repo folder is still named `devtools`; the GitHub repo is `kinan9011/shard`. Only **9 core tools** are built in. The other ~45 tools are sandboxed plugins that live in a separate repo, `kinan9011/shard-plugins`.

## Commands

```bash
npm run dev            # Tauri app with hot reload
npm run dev:web        # UI only in a browser (getDesktopBridge() returns null there)
npm test               # vitest run (all of tests/** and src/**)
npx vitest run tests/plugins/bridge.test.ts            # one file
npx vitest run tests/plugins/bridge.test.ts -t "name"  # one test
npm run lint           # eslint .
npm run typecheck      # app + node + plugin-sdk + sdk template tsconfigs (CI runs this)
cargo test --manifest-path src-tauri/Cargo.toml        # Rust tests
npm run sdk:build      # rebuild packages/plugin-sdk/dist and the copies bundled in examples/template
npm run build          # tauri build (installers for the current platform)
```

`task check` (Taskfile.yml) is the pre-push gate: lint, typecheck, vitest, cargo test. CI order is typecheck, `npm test`, `build:web`, then `.github/workflows/build-app.yml` per platform.

Vitest uses jsdom with a 30 s timeout, because app-level tests lazy-load tools. Test setup is `tests/setup.ts`.

### Desktop e2e

- Build with the `e2e` cargo feature: `npx tauri build --no-bundle --features e2e` (Windows also needs `--config e2e/tauri.e2e.conf.json`). The feature compiles `src-tauri/src/e2e.rs`, adds `e2e_*` commands, and redirects file saves to `SHARD_E2E_SAVE_DIR`. Release builds never enable it.
- `e2e/smoke.mjs`: WebdriverIO drives the app. Linux uses `tauri-driver` under `xvfb-run`; Windows attaches `msedgedriver` to a WebView2 debug port. Run it with `node e2e/smoke.mjs <binary>`.
- `e2e/selftest.js` is `include_str!`-ed into the binary and runs inside the webview when `SHARD_E2E_SELFTEST=1`. It is separate from the WebDriver smoke test and covers the plugin bridge round trip. It opens the palette with a synthetic keydown, not WebDriver key input.

## Architecture

### Frontend (`src/`)

- `app/Shard.tsx` is the shell: tabs, sidebar or launcher layout, command palette, first-run wizard, updates, deep links, global shortcut.
- `app/toolRegistry.ts` is the single list of built-in tools (`ALL_TOOLS`, lazy-loaded). Keep it at the 9 core tools. `catalog.ts`, `useToolCatalog.ts` and `installableTools.ts` merge the built-in tools with installed and installable plugins.
- **All Tauri calls go through `src/lib/desktop.ts`.** The UI must also work in a plain browser, so never import `@tauri-apps/*` elsewhere. Save files with `saveFile()`, because webviews can't do blob downloads.
- `utils/` holds pure tool logic. `tests/tools/` covers it.

### Plugin system (spans several files)

A plugin is a web UI plus a `plugin.json` manifest and an optional WASM backend. The security model is in `docs/plugins/security.md`. Read it before touching any of this.

- **Frame:** `src/components/plugins/PluginFrame.tsx` renders `<iframe sandbox="allow-scripts" src="shard-plugin://<id>/<entry>">`. There is no `allow-same-origin`, so the frame has an opaque origin and no Tauri IPC. Frame state is exposed as `data-state`; a frame with no handshake after 10 s becomes `crashed`.
- **Protocol:** `src-tauri/src/plugins/protocol.rs` serves only installed and enabled plugins, with paths confined by `resolve_inside`. The per-plugin CSP differs by platform. macOS and Linux (WebKit) name `shard-plugin://<id>` next to `'self'`. Windows serves `http://shard-plugin.localhost/`, and `wry` rewrites the host to `localhost`, so the handler hardcodes the Windows host there.
- **Bridge:** `packages/plugin-sdk/src/index.ts` (plugin side) talks over `postMessage` to `src/plugins/bridge.ts` (host side). The host checks `event.source`, takes the plugin id from the host and never from a message, and checks every call against the user's granted permissions (`permissions.ts`, `docs/plugins/permissions.md`). Never expose the Tauri invoke key to a frame.
- **Rust side** (`src-tauri/src/plugins/`): `manifest` (validation), `store` (installed plugins and grants), `zip` and `install` (zip, folder, URL and repo installs, SHA-256 checks), `repos` (repository list and synced catalogs), `storage`, `fetch` and `files` (permission-gated SDK calls), `signing`. The frontend wrappers are `src/plugins/api.ts` and the `use*` hooks.
- The SDK template (`packages/plugin-sdk/template`) and `plugins/examples/hello` carry **copies** of the built SDK (`shard-sdk.js` and `src/shard-sdk.ts`). After changing `packages/plugin-sdk/src/index.ts`, run `npm run sdk:build`. A test fails on a stale copy.

### Tauri backend (`src-tauri/`)

- `src/lib.rs` is the shared entry point (`run`) for desktop and Android, and defines the app-level commands.
- **Every new Tauri command must be added to both `generate_handler!` lists in `lib.rs`**: one under `#[cfg(not(feature = "e2e"))]` and one under `#[cfg(feature = "e2e")]`, which also carries the `e2e::*` commands. Add a permission to `capabilities/default.json` only when a command needs one.
- Other modules: `themes.rs` (custom themes), `folder_compare.rs` (Diff & Merge folder mode), `paths.rs` (`resolve_inside`).
- Config is split across `tauri.conf.json`, `tauri.macos.conf.json` and `tauri.updater.conf.json`.

## Conventions

- Keep tools offline. No network calls or telemetry. Update checks and plugin downloads are the only network use.
- New tools are plugins in `kinan9011/shard-plugins`, started from `packages/plugin-sdk/template`. Don't add built-in tools.
- Releases follow `docs/release-process.md`. `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `release-notes/vX.Y.Z.md` must stay in sync (`npm run release:prepare -- X.Y.Z`, then `release:check`). Release asset names are fixed because the README download links depend on them (`scripts/collect-release-assets.mjs`).
- The MIT `LICENSE` keeps both the original DevTools copyright and the Shard one. Don't remove either.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
