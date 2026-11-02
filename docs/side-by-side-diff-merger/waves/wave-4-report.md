# Wave 4 Report: Folder backend (Tasks 11–13)

Base `825e0862`. All three tasks are done. The full gate is green:
`cargo test`, `cargo clippy -- -D warnings`, `npm run typecheck`, `npm test`.
`cargo check --features e2e` and `cargo clippy --all-targets -- -D warnings` are also clean.

## Commits

```
d389d32a docs(diff-merge): wave 4 plan
bf1bfd44 feat(diff-merge): path-confined folder scan and content compare        (Task 11)
edc3f4e4 feat(diff-merge): folder merge with journal, backup and undo commands  (Task 12)
abe1ce7d feat(diff-merge): desktop bridge for folder compare                     (Task 13)
ce65f1c8 fix(diff-merge): wave 4 review
(this)    docs(diff-merge): wave 4 report
```

## What was built

- **`src-tauri/src/folder_compare.rs`** (new, registered with `mod folder_compare;`):
  - `resolve_inside` rejects absolute paths, `..`, drive prefixes, symlinks that lead out of the root, and dangling symlinks.
  - `scan` is iterative, never follows symlinks, and is capped at 100,000 entries (test seam `scan_limited`).
  - `same_content` compares size, then 64 KiB chunks.
  - `apply_ops` validates every op first, then copies with an optional backup and a JSON journal. `undo` reverses from the journal.
  - `read_text` and `write_text` back the two file commands.
  - Seven `#[tauri::command]`s are registered in **both** `generate_handler!` lists.
- **`src/lib/desktop.ts`**: `isDesktop`, `pickFolder`, `scanFolder`, `compareContents`, `readTextFile`, `writeTextFile`, `applyFolderMerge`, `undoFolderMerge`, `revealPath`, and the three report types. Each function throws `"Folder compare needs the desktop app."` outside Tauri.
- No new crates or npm packages. No capability change: `opener:default` already grants `reveal-item-in-dir`.

## Tests

- Rust: 30 tests in total, 24 new in `folder_compare` (6 existing in `main.rs`). They cover:
  - path confinement, including symlinks;
  - the scan cap and symlink skipping;
  - chunked compare;
  - merge, backup and undo, with and without a backup;
  - rollback on a failed copy and on a failed backup;
  - a tampered journal;
  - the wire names;
  - the read-text limits;
  - the atomic write.
- TS: 4 new tests in `tests/lib/desktop.test.ts` (24 in the file). The repo total is 2351 across 166 files.
- Every Rust test uses temp dirs it creates and removes itself. Nothing touched a real folder or the working tree.
- The permission-based failure tests (`chmod 000`) are `#[cfg(unix)]` and would not fail as root.

## Deviations (also in the plan's `Deviations:` notes)

- **D1.** `MergeAction` has no `rename_all`. The master plan's Rust attribute and its Task 13 test disagree, so the test won: the wire value is `"ToRight"`. A Rust test pins it.
- **D2.** Commands are `async` and run on `spawn_blocking`. A sync command would run on the main thread and freeze the window.
- **D3.** `undo_folder_merge` takes `app` and only accepts a `journal.json` inside `<app data>/diff-merge-backups`.
- **D4.** The journal stores more than the plan listed (roots, `side`, `rel`, `createdDirs`). `undo` re-resolves every path inside its root, so a tampered journal cannot escape.
- **D5.** `apply_ops` also rejects a missing source, a folder in the way, identical roots, and two ops that reach one destination.
- **D6.** A mid-run failure rolls back. The error says when files could not be restored.
- **D7.** `read_text_file` also refuses NUL bytes, and over 5 MiB gives `"This file is larger than 5 MiB."`.
- **D8.** `scan` skips names that are not valid UTF-8.
- **D9.** `compare_contents` returns `false` for anything that is not a regular file on both sides. A real I/O error (such as permission denied) fails the whole call and names the path.
- `main.rs`: fixed one existing `clippy::collapsible_match` (tray "quit" arm), since the gate needs `-D warnings`. Behaviour is unchanged.
- Tooling: the `clippy` component was not installed for the active toolchain and was added with `rustup component add clippy`. It is not a crate dependency.

## Review (code-review skill, medium; 1 round)

Fixed:
- A rollback aborted when the failing step's backup never existed. Entries are now journaled only after their backup is made.
- With `backup=false`, a failed merge claimed "rolled back" although files could not be restored. The message now lists them.
- `undo` stopped at the first I/O error. It now continues, reports the failed files as `unrestorable`, and keeps the journal for retry.
- A finished undo could be replayed over later edits. The journal is deleted after a clean undo.
- Two paths could reach one destination through a symlink or a case-insensitive name. Ops are now deduped on the canonical destination too.
- `write_text` replaced a symlink. It now writes through it, and the temp name is unique per call.
- `compare_contents` failed the whole call when a path was a folder on either side. It now reports that path as different (`compare_paths`).
- `pick_folder` now blocks on a `spawn_blocking` thread.

Not changed:
- `created_dirs` double-ownership claim. Entries are journaled sequentially, so each directory belongs to exactly one entry.
- Case-insensitive dedupe on the relative string. A lowercase key would wrongly reject `A.txt` and `a.txt` on Linux. The canonical-destination check covers existing files.

## Deferred

- A scan fails as a whole when one subfolder is unreadable. The error names the folder, but there is no partial listing. A partial listing needs a UI model for flagged folders, which is wave 5.
- Time-of-check/time-of-use races between validation and copy are not closed, as in the plan.
- Backups do not preserve modification times.
- Wave 5 owns the frontend half of Review Focus 5 (Task 15).
