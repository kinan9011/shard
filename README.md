<div align="center">

# Shard

### Your everyday developer tools. One private desktop workspace.

**Format JSON. Decode JWTs. Compare files. Test regex. Keep moving.**

Shard brings the utilities developers use every day into one desktop app—so you can stop jumping between browser tabs, keep your work organized, and process data locally.

**Free & open source · macOS, Windows & Linux · No account · No telemetry**

[**Download Shard**](https://github.com/kinan9011/shard/releases/latest) · [**Explore the tools**](#what-can-you-do-with-shard) · [**Browse plugins**](https://github.com/kinan9011/shard-plugins)

</div>

![Shard desktop workspace with JSON Viewer and open tool tabs](assets/screenshots/hero.png)

> **Built for daily work, not another browser tab.** Shard includes **9 essential built-in tools**, with **around 45 additional tools** available as plugins. Its core tools work offline; plugins can request specific permissions, including network access, before installation.

<sub>Shard is an independent fork of DevTools. [Origins, attribution and license](#license-origins-and-credits).</sub>

## Why Shard?

| Without Shard | With Shard |
| --- | --- |
| Switch between unrelated utility websites | Open your tools in one searchable workspace |
| Paste working data into online tools | Process data locally with the built-in tools |
| Lose your inputs when switching tasks | Keep tools and their inputs open in tabs |
| Hunt for a formatter, validator or converter | Search, pin favorites, or paste content to get a tool suggestion |
| Install a large toolbox for occasional tasks | Add the plugins you want, with permissions you approve |

### What makes it different

- **Local-first by design.** No account, analytics or telemetry. Built-in tools run locally; only update checks, downloads and explicitly permitted plugin network operations need connectivity.
- **One workspace, many workflows.** Tabs preserve your inputs. Search, recent tools and up to 12 pinned favorites keep frequently used utilities close.
- **Paste and go.** Paste a JWT, JSON, URL, UUID, timestamp, cron expression, certificate or cURL command outside an input field, and Shard suggests a relevant tool. It does not read your clipboard automatically.
- **Extend on your terms.** Install plugins from repositories or other supported sources. Review permissions first; the plugin host enforces approved access to files, clipboard and network.
- **Make it yours.** Sidebar or Launcher layout, light and dark themes, configurable shortcuts and eight interface languages—including right-to-left support.

## Get started in three steps

1. **[Get Shard for your platform](#download)** and launch the desktop app.
2. **Choose your workspace.** Pick a language, appearance and Sidebar or Launcher layout during first-run setup.
3. **Try a tool.** Open **JSON Viewer** to format data, press **Cmd+K** (macOS) or **Ctrl+K** (Windows/Linux) to find another tool, or open **Plugins** to add more.

**Tip:** Press **Ctrl+Shift+Space** to open Shard's tool search from another app. You can change or disable this shortcut in settings.

## What can you do with Shard?

| Job to do | Tool | How it helps |
| --- | --- | --- |
| Make sense of an API response | **JSON Viewer** | Format, query, repair and convert JSON to YAML or XML |
| Check a token | **JWT Decoder** | Decode claims, check expiry and verify supported signatures |
| Compare configurations or outputs | **JSON Diff** | Find structural changes and copy a JSON Patch |
| Review changes in code or text | **Text Compare / Diff & Merge** | Navigate line, word and character diffs; merge changes and compare folders |
| Debug a pattern | **Regex Tester** | View live matches, capture groups and replacements |
| Generate models from a response | **JSON to Code** | Produce types for TypeScript, Go, Rust, Python, Swift and Kotlin |
| Validate a payload | **JSON Schema Validator** | Find schema errors and jump to problematic values |
| Try a quick frontend idea | **Code Playground** | Experiment with JavaScript, HTML and CSS |
| Convert files, text or developer formats | **Optional plugins** | Add image, encoding, formatting, security, time, network and other utilities |

The **nine built-in tools** are always available. Additional tools come from the plugin catalog, so the app can grow with your workflow.

## See Shard in action

| Light workspace | Dark workspace |
| :---: | :---: |
| ![Home with pinned tools](assets/screenshots/home-light.png) | ![Dark mode with JSON Viewer](assets/screenshots/dark-mode.png) |
| **Compare & merge** | **Manage plugins** |
| ![Side-by-side Diff & Merge workspace](assets/screenshots/diff-merge.png) | ![Plugins browser, installed tools and repositories](assets/screenshots/plugins.png) |

<details>
<summary><strong>See more screenshots</strong> — permissions, search, layouts and onboarding</summary>

| Plugin permissions | Find any tool |
| :---: | :---: |
| ![Plugin permission approval dialog](assets/screenshots/plugin-permissions.png) | ![Command palette with tool search](assets/screenshots/command-palette.png) |
| First-run setup | Launcher layout |
| ![First-run layout selection](assets/screenshots/first-run.png) | ![Launcher-style workspace](assets/screenshots/launcher.png) |
| Language and theme setup | |
| ![First-run language and theme selection](assets/screenshots/first-run-language.png) | |

</details>

## Download

Choose the installer for your operating system. You can also [view the latest GitHub release](https://github.com/kinan9011/shard/releases/latest).

| Operating system | Download |
| --- | --- |
| **macOS — Apple Silicon** | [Download `.dmg`](https://github.com/kinan9011/shard/releases/latest/download/Shard-macos-arm64.dmg) |
| **macOS — Intel** | [Download `.dmg`](https://github.com/kinan9011/shard/releases/latest/download/Shard-macos-x64.dmg) |
| **Windows** | [Download installer `.exe`](https://github.com/kinan9011/shard/releases/latest/download/Shard-windows-setup.exe) |
| **Linux — Debian / Ubuntu / Mint** | [x64 `.deb`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-amd64.deb) · [ARM64 `.deb`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-arm64.deb) |
| **Linux — Fedora / RHEL / openSUSE** | [x64 `.rpm`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-x86_64.rpm) · [ARM64 `.rpm`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-aarch64.rpm) |
| **Linux — portable** | [x64 `.AppImage`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-x86_64.AppImage) · [ARM64 `.AppImage`](https://github.com/kinan9011/shard/releases/latest/download/Shard-linux-arm64.AppImage) |

<details>
<summary><strong>Installation notes and automatic updates</strong></summary>

- **macOS:** Open the downloaded `.dmg` and move the app to Applications.
- **Windows:** Run the downloaded setup installer.
- **Linux:** Install the `.deb` or `.rpm` for your distribution. For AppImage, mark the file as executable before launching it (for example, `chmod +x Shard-linux-x86_64.AppImage`).
- **Updates:** By default, Shard checks for updates at startup and every six hours, downloads updates in the background and installs them when you quit. You can use **Restart now** to apply a downloaded update, or turn off **Update automatically** and manage updates yourself. Checking for and downloading updates requires an internet connection.

</details>

## Plugins: install only what you need

Shard includes a plugin manager and a growing collection of extra developer utilities.

**[Browse the official plugin repository](https://github.com/kinan9011/shard-plugins)** · **[Explore themes](https://github.com/kinan9011/shard-themes)** · **[Build a plugin](packages/plugin-sdk/README.md)**

**Examples of available plugins:**

| Development | Data & conversion | Everyday utilities |
| --- | --- | --- |
| Code Formatter | CSV ↔ JSON | Password Generator |
| cURL to Code | Base64 | QR Generator |
| X.509 Certificate Decoder | Config Converter | Image Converter |
| Mermaid Renderer | URL Encoder | Time Zone Converter |
| HAR Viewer | HTML to JSX | Secret & PII Redactor |

**Security and control:** Plugin interfaces run in sandboxed frames. You approve requested permissions for clipboard, files and network access to named hosts before installation, and you can change permissions afterward. Repository packages use SHA-256 checksums; installations from outside configured repositories are marked unverified and require a separate setting. See the [plugin security model and limitations](docs/plugins/security.md).

<details>
<summary><strong>View the full plugin catalog</strong></summary>

**AI tools:** AI Text Cleaner; Image Metadata Cleaner; Secret & PII Redactor; Token Counter; Video Metadata Cleaner.

**Converters:** Base64; Case Converter; Compression; CSV to JSON; cURL to Code; Escape Tools; HTML to JSX; Markdown; Number Base; PHP Tools; SVG to CSS; URL Encoder; Config Converter.

**Development tools:** ASN.1 Inspector; X.509 Certificate Decoder; Code Formatter; HTML Preview; Mermaid Renderer; Semver Calculator; XML Inspector.

**Generators:** Bcrypt Generator; Hash Generator; Key Pair Generator; Lorem Ipsum; Password Generator; QR Generator; Random String; UUID Generator.

**Media:** Color Palette; Image Converter; QR Reader.

**Network:** HAR Viewer; IP / CIDR Calculator.

**Text tools:** API Formatter; Line Tools; String Inspector.

**Time & date:** Cron Calculator; Date Difference; Date Format Translator; Stopwatch; Time Zone Converter; Timestamp.

**Utilities:** Checksum; chmod Calculator; Unit Converter.

For descriptions and current availability, see the [official plugin repository](https://github.com/kinan9011/shard-plugins).

</details>

## Fits your workflow

- **Keyboard-first search:** Cmd+K on macOS, Ctrl+K on Windows and Linux.
- **Pinned tools:** Add up to 12 favorites to Home. Cmd/Ctrl+1–5 opens the first five pins.
- **Global quick access:** Ctrl+Shift+Space opens or hides the tool search, including from another application.
- **Layouts and appearance:** Choose Sidebar or Launcher, use light or dark mode, and customize shortcuts.
- **Languages:** English, Arabic, German, Spanish, French, Hebrew, Japanese and Chinese, with right-to-left layout for Arabic and Hebrew. Choose a language on first run or under **Settings → General**; plugins follow it.
- **Deep links:** Open specific tools from Raycast, Alfred, Shortcuts or scripts using `shard://` links.

```text
shard://open/json-viewer   Open the JSON Viewer
shard://search?q=regex    Search for a tool
shard://home              Return to Home
```

[See tool IDs in the registry](src/app/toolRegistry.ts).

## Frequently asked questions

**Is Shard free?**  
Yes. Shard is free and open source under the [MIT License](LICENSE).

**Does Shard need an account or an internet connection?**  
No account is required. The built-in tools run offline. Update checks and downloads, plugin downloads, and plugin features that you authorize to access the network require connectivity.

**Does Shard collect usage analytics or telemetry?**  
No. The project states that Shard does not include analytics or telemetry. Review plugin permissions separately before installing third-party code.

**Is it safe to paste sensitive data?**  
The built-in tools process data locally, but always consider your own security requirements. Plugins are separate components: review their permissions and the [documented security limitations](docs/plugins/security.md), especially if a plugin requests file or network access.

**Can I add my own tools?**  
Yes. Shard supports plugins with a manifest, a web interface and an optional WebAssembly backend. Start with the [plugin SDK](packages/plugin-sdk/README.md), [manifest guide](docs/plugins/manifest.md) and [permissions guide](docs/plugins/permissions.md).

**Can I switch languages or layouts later?**  
Yes. Choose your language in **Settings → General** and configure your workspace and appearance in the app.

## For contributors

Shard is built with **Tauri 2, React 18, TypeScript, Vite, Tailwind CSS and shadcn/ui**. It uses a Rust backend and the operating system's webview.

### Run from source

Requires Node.js **22+**, npm, stable Rust and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/kinan9011/shard.git
cd shard
npm ci
npm run dev
```

For a browser-only UI preview, run `npm run dev:web` (desktop integrations and the updater are unavailable in this mode).

<details>
<summary><strong>Build, test and development commands</strong></summary>

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and the Tauri desktop app with hot reload |
| `npm run dev:web` | Run the web UI in a browser |
| `npm run build:web` | Build the frontend into `dist/` |
| `npm run build` | Build desktop app and installers for the current platform |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Run ESLint |
| `npm run dist:mac` | Build macOS packages |
| `npm run dist:win` | Build the Windows NSIS installer |
| `npm run dist:linux` | Build Linux AppImage, Debian and RPM packages |
| `npm run brand:build` | Regenerate brand assets |

On Debian/Ubuntu, install the native development dependencies:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libxdo-dev libssl-dev patchelf file rpm
```

See the [release process](docs/release-process.md) and [desktop smoke test](e2e/smoke.mjs). Bundled installers are written to `src-tauri/target/release/bundle/`.

For the Linux desktop smoke test, install `xvfb` and `webkit2gtk-driver`, then run:

```bash
sudo apt-get install -y xvfb webkit2gtk-driver
cargo install tauri-driver --locked
npm run build
xvfb-run node e2e/smoke.mjs
```

**Project layout:** `src/` contains the React app, components and tools; `src-tauri/` contains the Rust backend and packaging; `tests/` and `e2e/` cover automated checks; and `packages/plugin-sdk/` documents extensions.

**Adding a tool:** New tools should be plugins; the nine core tools are intentionally fixed. Start with the [plugin SDK](packages/plugin-sdk/README.md), follow the [repository index specification](docs/plugins/index-format.md), and submit the plugin to the [official plugin repository](https://github.com/kinan9011/shard-plugins) with tests.

</details>

### Contribute or report an issue

Bug reports, feature proposals and pull requests are welcome. For major changes, open an issue first. Include steps to reproduce and relevant environment information for bug reports, and screenshots for UI changes.

[**Report a bug or suggest a feature**](https://github.com/kinan9011/shard/issues) · [**View the source**](https://github.com/kinan9011/shard) · [**Browse plugins**](https://github.com/kinan9011/shard-plugins)

## License, origins and credits

Shard is available under the [MIT License](LICENSE).

**Fork attribution:** Shard is an independent fork of [DevTools](https://github.com/me-shaon/devtools) by [Ahmed Shamim](https://github.com/me-shaon). It is not affiliated with or endorsed by the original author. Shard retains the original MIT copyright and permission notices in its [LICENSE](LICENSE) file.

- Copyright © Ahmed Shamim, original DevTools project.
- Copyright © 2026 kinan9011, Shard modifications.

The current logo, icons and favicon are inherited from DevTools and are being replaced with Shard-specific branding. See the [brand asset guide](assets/brand/README.md). Third-party packages retain their own licenses.

---

<div align="center">

**Fewer tabs. Faster fixes. Your tools, your computer.**

[**Download Shard**](https://github.com/kinan9011/shard/releases/latest) · [**Explore plugins**](https://github.com/kinan9011/shard-plugins) · [**Star the project**](https://github.com/kinan9011/shard)

</div>
