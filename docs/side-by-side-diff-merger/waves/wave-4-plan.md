# Wave 4 Plan: Folder backend (Tasks 11–13)

Base: `825e0862` on `feat/diff-merge`. Waves 1–3 are in (Text mode, TS only). Wave 4 touches no UI. Only Rust (`src-tauri/src/folder_compare.rs`, `main.rs`) and the TS bridge (`src/lib/desktop.ts`) change. Folder UI is wave 5.

Repo facts checked:
- `src-tauri/src/` has only `main.rs` and `e2e.rs`. `mod e2e` is gated by the `e2e` feature, so `mod folder_compare;` is added ungated.
- `generate_handler!` appears twice in `main()`: a `#[cfg(not(feature = "e2e"))]` list (one line) and a `#[cfg(feature = "e2e")]` list. Both get the new commands. The master plan's line numbers `276-291` are right.
- No `tempfile` crate and no new crates are allowed. Rust tests build unique dirs under `std::env::temp_dir()` from pid + an atomic counter.
- `serde`, `serde_json`, `tauri-plugin-dialog` and `tauri-plugin-opener` are already dependencies. `opener:default` already grants `allow-reveal-item-in-dir`, so no capability change is needed. Custom app commands need no permission entry.
- `tests/lib/desktop.test.ts` mocks `@tauri-apps/api/core` (`tauri.isTauri`, `tauri.invoke`) and `@tauri-apps/plugin-opener` with only `openUrl`. The mock gains `revealItemInDir`. Tests use `loadDesktop()` (`vi.resetModules` + dynamic import).

## Ordered task list

1. **Task 11**: `folder_compare.rs` (new) with `FileEntry`, `MAX_ENTRIES`, `resolve_inside`, `scan`, `same_content`, plus tests. `main.rs` gets `mod folder_compare;`. Commit `feat(diff-merge): path-confined folder scan and content compare`.
2. **Task 12**: `apply_ops`, `undo`, journal, the seven Tauri commands, registration in both handler lists, tests. Commit `feat(diff-merge): folder merge with journal, backup and undo commands`.
3. **Task 13**: bridge functions in `desktop.ts`, tests appended to `tests/lib/desktop.test.ts`. Commit `feat(diff-merge): desktop bridge for folder compare`.

Per task: failing test, watch it fail, implement, watch it pass, commit, tick plan boxes, add a `Deviations:` note. Heartbeat about every 5 minutes. `orca orchestration check` between tasks and before `worker_done`.

## Files

Create:
- `src-tauri/src/folder_compare.rs`
- `docs/side-by-side-diff-merger/waves/wave-4-plan.md`, `wave-4-report.md`

Modify:
- `src-tauri/src/main.rs` (`mod folder_compare;`, both handler lists)
- `src/lib/desktop.ts` (bridge functions, import `revealItemInDir`)
- `tests/lib/desktop.test.ts` (opener mock gains `revealItemInDir`, new tests)
- `docs/side-by-side-diff-merger/implementation-plan.md` (ticks and `Deviations:` only)

Not touched: `project/`, `Cargo.toml`, capabilities, all UI.

## Final signatures

```rust
// folder_compare.rs
#[derive(Serialize, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
pub struct FileEntry { pub path: String, pub is_dir: bool, pub size: u64, pub modified_ms: u64 }
pub const MAX_ENTRIES: usize = 100_000;
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String>;
pub fn scan(root: &Path) -> Result<Vec<FileEntry>, String>;       // calls scan_limited(root, MAX_ENTRIES)
fn scan_limited(root: &Path, max: usize) -> Result<Vec<FileEntry>, String>;   // test seam
pub fn same_content(a: &Path, b: &Path) -> std::io::Result<bool>;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)] pub enum MergeAction { ToRight, ToLeft }   // no rename_all, see D1
#[derive(Deserialize)] pub struct MergeOp { pub path: String, pub action: MergeAction }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct MergeReport { pub copied_right: Vec<String>, pub copied_left: Vec<String>, pub backed_up: Vec<String>, pub journal: String, pub backup_dir: Option<String> }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct UndoReport { pub restored: usize, pub removed: usize, pub unrestorable: Vec<String> }
pub fn apply_ops(left: &Path, right: &Path, ops: &[MergeOp], work_dir: &Path, backup: bool) -> Result<MergeReport, String>;
pub fn undo(journal: &Path) -> Result<UndoReport, String>;
pub fn read_text(root: &Path, rel: &str) -> Result<String, String>;      // testable core of read_text_file
pub fn write_text(root: &Path, rel: &str, contents: &str) -> Result<(), String>;

// commands, in main.rs-registered module; camelCase args from JS
#[tauri::command] async fn pick_folder(app: AppHandle) -> Option<String>;
#[tauri::command] async fn scan_folder(root: String) -> Result<Vec<FileEntry>, String>;
#[tauri::command] async fn compare_contents(left_root: String, right_root: String, paths: Vec<String>) -> Result<Vec<bool>, String>;
#[tauri::command] async fn read_text_file(root: String, path: String) -> Result<String, String>;
#[tauri::command] async fn write_text_file(root: String, path: String, contents: String) -> Result<(), String>;
#[tauri::command] async fn apply_folder_merge(app: AppHandle, left_root: String, right_root: String, ops: Vec<MergeOp>, backup: bool) -> Result<MergeReport, String>;
#[tauri::command] async fn undo_folder_merge(app: AppHandle, journal: String) -> Result<UndoReport, String>;
```

```ts
// desktop.ts: exactly the master plan's interfaces and functions (FolderEntry, FolderMergeReport,
// FolderUndoReport, isDesktop, pickFolder, scanFolder, compareContents, readTextFile,
// writeTextFile, applyFolderMerge, undoFolderMerge, revealPath).
```

### Differences from the master plan, with reasons

- **D1: `MergeAction` has no `rename_all = "camelCase"`.** The master plan's Rust attribute would make serde expect `"toRight"`. Its Task 13 test pins the wire value as `"ToRight"`. The test and the "map to the Rust enum names `ToRight`/`ToLeft`" step win. A Rust test pins the wire format by deserializing `{"path":"x","action":"ToRight"}`.
- **D2: commands are `async` and run the fs work in `tauri::async_runtime::spawn_blocking`.** Tauri 2 runs sync commands on the main thread. A 100k-entry scan or a large merge would freeze the window. `blocking_pick_folder` must not run on the main thread either. This is the same reason the existing `save_file` is `async`. Args stay owned `String`s so async commands are legal. Signatures are otherwise as planned. The pure `pub fn`s stay sync and are what the tests call.
- **D3: `undo_folder_merge` takes `app` too.** The journal path comes from the webview. The command canonicalizes it and requires it to be `<app data>/diff-merge-backups/<run>/journal.json`, so a crafted path cannot make undo read or write elsewhere.
- **D4: the journal records more than `{dest, existed, backup}`.** It stores `leftRoot`/`rightRoot` (canonical), and per entry `side`, `rel`, `dest`, `existed`, `backup`, `createdDirs`. `undo` re-resolves each destination with `resolve_inside(root, rel)` and requires every backup path to sit under the journal's own run dir. A tampered journal therefore cannot escape either root. `rel` also gives the names the report needs (`backed_up`, `unrestorable` are relative paths, as the plan's test expects). `createdDirs` lets undo remove directories the merge created, and only those.
- **D5: `apply_ops` validation is stricter than the plan.** All of this is checked before anything is written:
  - every `rel` passes `resolve_inside`;
  - the source is an existing regular file;
  - the destination is not a directory;
  - no path appears twice, because two backups would collide on one backup path;
  - the two roots differ.
- **D6: a failed copy mid-run rolls back.** Completed entries are journaled and undone, then `Err` is returned. This avoids leaving a half-merged tree with no journal.
- **D7: `read_text_file` also rejects NUL bytes** with the same `"This file is not UTF-8 text."` error (Review Focus 4). A larger file returns `"This file is larger than 5 MiB."`.
- **D8: `scan` skips entries whose name is not valid UTF-8.** A lossy path would not round-trip into `resolve_inside`. The report notes this.
- **D9: `compare_contents` propagates a missing or unreadable file as `Err` naming the path.** It does not guess `false`.

## Review Focus lines for this wave, and the pinning test

Wave 4 owns the Rust half of Review Focus 5 (the frontend half is Task 15 in wave 5). The other four lines belong to earlier or later waves, but Task 12's `read_text_file` implements the backend side of line 4.

| Focus | Test |
|---|---|
| 5: `../x` rejected before any read, write or delete | `rejects_escaping_paths` (`../x`, `/etc/passwd`, `a/../../x`); `merge_rejects_escaping_op` also asserts nothing was written |
| 5: absolute path rejected | `rejects_escaping_paths` |
| 5: symlink pointing outside rejected | `rejects_symlink_out_of_root` (unix), `merge_rejects_dest_through_symlink` (unix) |
| 5: a tampered journal cannot escape | `undo_ignores_journal_paths_outside_roots` |
| 5: scan never follows symlinks | `scans_recursively_without_following_symlinks` (also asserts a symlinked dir contents are absent, unix) |
| 4 (backend): non-UTF-8 or binary file refused | `read_text_rejects_non_utf8_and_nul` expects exactly `"This file is not UTF-8 text."` |
| Scan cap | `scan_stops_past_the_limit` uses `scan_limited(root, 2)` and expects `"Folder has more than 100,000 files."` |
| Backup and undo are exact | `merge_copies_backs_up_and_undoes`, `merge_without_backup_reports_unrestorable`, `undo_removes_directories_it_created` |
| Wire contract | `merge_action_wire_names` (Rust), `folder bridge maps to commands` (TS) |
| Outside desktop | `folder bridge refuses outside the desktop app` (TS) |

## Verification commands

Per task:
- Task 11: `cargo test --manifest-path src-tauri/Cargo.toml folder_compare` (fail, then pass).
- Task 12: the same filter, then `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- Task 13: `npx vitest run tests/lib/desktop.test.ts` (fail, then pass).

Full gate (Phase C):
`cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && npm run typecheck && npm test`

Also run `cargo check --manifest-path src-tauri/Cargo.toml --features e2e` to prove the e2e handler list compiles, and `npm run lint` if the script exists.

File-system safety: every Rust test uses only directories it creates under `std::env::temp_dir()` and removes them at the end. No test points at a real user folder or this repo.
