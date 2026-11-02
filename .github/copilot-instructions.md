# Shard: AI Development Guide

## Project Architecture

Shard is an offline-first desktop app, a fork of DevTools (me-shaon/devtools, MIT) with a sandboxed plugin system. The UI is React, TypeScript, Vite, Tailwind CSS, and shadcn/ui. The desktop runtime is Tauri 2.

```
src/
├── app/
│   ├── Shard.tsx           # App shell: sidebar, search, command palette, updates
│   └── toolRegistry.ts     # The 9 built-in tools and their lazy-loaded components
├── components/tools/       # Built-in tool components
├── lib/desktop.ts          # Bridge to the Tauri runtime
└── utils/                  # Pure tool logic, covered by unit tests

src-tauri/
├── src/main.rs             # Tauri entry point and the save_file command
├── tauri.conf.json         # Window, bundle, and updater configuration
└── capabilities/           # Permissions for the app window
```

## Adding a Tool

New tools are plugins, not built-in tools. The registry in `src/app/toolRegistry.ts` stays at the 9 core tools.

1. Start from the template in `packages/plugin-sdk/template`.
2. Put the plugin in the official repository, `kinan9011/shard-plugins`.
3. Add tests for non-trivial logic and run `npm run build` and `npm test` in the plugin folder.

## Desktop Runtime Rules

- Call Tauri APIs only through `src/lib/desktop.ts`. The UI must also work in a plain browser, where `getDesktopBridge()` returns `null`.
- Save files with `saveFile()` from `src/lib/desktop.ts`. Webviews do not handle blob downloads.
- Add a permission to `src-tauri/capabilities/default.json` only when a new plugin command needs it.
- Keep all tools offline. Do not add network calls or telemetry.

## Commands

```bash
npm run dev        # Tauri app with hot reload
npm run dev:web    # Web UI only, in a browser
npm test           # Unit tests (Vitest)
npm run build      # App and installers for the current platform
```

## Release

Follow `docs/release-process.md`. CI builds macOS, Windows, and Linux on each pull request and publishes releases from `v*` tags.
