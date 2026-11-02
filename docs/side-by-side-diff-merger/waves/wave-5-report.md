# Wave 5 Report: Folder UI, docs, release (Tasks 14–17)

Base `f32e45d1`. All four tasks are done. The full gate is green:
`npm run lint` (0 errors, 6 warnings, all in files this wave did not touch), `npm run typecheck`, `npm test`, `cargo test`, `npm run build:web`.

## Commits

```
84053917 docs(diff-merge): wave 5 plan
1084a526 feat(diff-merge): folder compare model and copy                                  (Task 14)
cd1332bf feat(diff-merge): folder compare screen with actions and per-file merge          (Task 15)
a649f7df feat(diff-merge): merge dialog, done notice, undo and backup reveal              (Task 16)
5fdc601c feat(diff-merge): mode switching, docs and release notes                         (Task 17)
39451a8b fix(diff-merge): wave 5 review
(this)    docs(diff-merge): wave 5 report
```

## What was built

- **`src/utils/diff-merge/folder.ts`**: the pure model. Pairing, classification, default and allowed actions, grouping, filters, plan counts, and every copy string (planned text, merge subtitle, done notice, size and date formats). Extra helpers `makeRow` and `mergeOps`.
- **Folders screen** (`folder/FolderView`, `FolderToolbar`, `FolderTable`, `ActionMenu`, `MergeDialog`):
  - Path bars with Browse and swap, scan, content compare in batches of 500, progress line, Refresh that keeps chosen actions.
  - Show chips with counts, Compare by, filter box, shortcuts panel.
  - Table with the spec's grid, selection (click, Ctrl, Shift, arrows), `Space` / `Delete` / `Ctrl+Shift+←→` / `Enter` / `Ctrl+Enter`, action chips and menu, windowing past 2,000 rows.
  - Lower split reusing `DiffPanes`, with nav, counter, `Open in Text view` and `Save both`. A binary file shows `Binary or non-text file`.
  - Merge dialog (540px, focus trap, Escape), done notice with `Undo merge` and `Show backup`, error toasts.
  - Browser build shows `Folder compare needs the desktop app`.
- **`ModeSwitch`**: one radiogroup used by both toolbars. `DiffMerge` keeps both screens mounted; `TextDiffView` loads a pair that arrives after mount.
- **Docs and release**: README entry, `release-notes/v2.8.0.md`, version bumped to 2.8.0 with `release:prepare` (`release:check -- v2.8.0` passes). No tag, no push.

## Tests

- Full suite: **2393 tests in 168 files** (2351 in 166 at the start of the wave): +42 tests, +2 files.
- New: 14 in `diff-merge-folder.test.ts`, 26 in `diff-merge-folder-view.test.tsx` (including the `FolderTable` windowing test), 2 in `diff-merge-component.test.tsx`. One existing test changed (the switch is now radios).
- Rust: 30 tests, unchanged.
- Every folder test mocks `@/lib/desktop`. Nothing touched a real folder or the working tree. No GUI was started.

## Review Focus coverage

| Line | Pinned by |
|---|---|
| 5. Paths that escape the root | Rust tests from wave 4 reject them. UI side: "shows the backend's rejection as a toast and changes nothing else"; `mergeOps` forwards backend paths unchanged. |
| 4. Binary or non-UTF-8 file | "binary file shows the Binary or non-text file empty state" |
| Browser has no folder actions | "browser shows desktop-only notice" |
| Nothing written without confirmation | "Ctrl+Enter opens the dialog; Escape cancels without writing", "Cancel closes the dialog without writing" |
| Undo reports what it could not restore | "undo with unrestorable files shows an error toast" |
| CRLF survives Save both | "Save both writes both sides with their EOL and rescans" |

## Deviations (also in the plan's `Deviations:` notes)

- **D1.** New `ModeSwitch.tsx`; `TextToolbar` uses it and exports `Choice`; `AnchoredPanel` got `align` and `role`; `ShortcutsPanel` got `items` and `note`.
- **D2.** Start merge, the dialog, the footer plan and the write set use the rows that pass the Show chips and the filter, never identical rows. Rationale: nothing is copied that the user cannot see. See "Review" for the trade-off.
- **D3.** Merge ops are ordered toRight first, then toLeft (the master plan's test expects that order).
- **D4.** Task 17 Step 4 (`tauri dev`) was a static audit against `Folder Compare.dc.html`, because the brief forbids launching a GUI. I compared grid templates, heights, paddings, chip titles, colours and copy; one border colour on the hint strip was corrected. Pixel positions in a real window were **not** checked. The browser notice is pinned by a test.
- **D5.** New copy where the prototype has none: `Choose two folders to compare` / `Pick the left and right folder with Browse.`, and the chip title `No action yet` for an undecided one-sided row.
- **D6.** Singular wording where the spec gives only the plural: `is ignored`, `has no action yet`, `1 file could not be restored because it was not backed up.`
- **D7.** The `Not changed` names in the dialog are capped at 8, then `and N more`.
- **D8.** The version was bumped to 2.8.0 (package.json, lock, Cargo.toml, Cargo.lock) as `docs/release-process.md` requires for release notes.
- **D9.** Build check: the build lists `DiffMerge-*.js` (about 450 kB) as its own lazy chunk. I could not grep `dist/` for CodeMirror symbols (the shell denied it), so "CodeMirror not in `index-*.js`" rests on that chunk listing and on the lazy import in the tool registry.

## Review (code-review skill, medium; 1 round)

Fixed:
- "Merge by hand below" from a chip menu acted on the wrong file. It now loads the row the menu was opened from, then focuses its left editor.
- Actions applied to selected rows that a filter had hidden. They now change visible rows only.
- Undo could run alongside a merge or a scan. It now takes the busy flag, and its button is disabled while busy.
- Refresh dropped the `Undo merge` banner. Refresh now keeps it.
- `groupRows` copied the group array per row (O(n²)). A 60,000-file folder now groups in well under a second, pinned by a test.
- `doneNotice` read `Merged 0 items: .` when nothing was copied. It now reads `Merged 0 items.`
- `Save both` skipped the rescan after a failed second write. It now rescans.

Not changed:
- **Filter scopes the merge (D2).** The reviewer pointed out that a filter silently narrows what Start merge copies. That is the chosen behaviour (the alternative copies files the user cannot see). The Start count, the dialog and the footer all say what will happen. Revisit if users expect "everything marked".
- **A new merge or a browse replaces the previous `Undo merge` banner**, and with it the only handle on the earlier journal. The journal and backups stay on disk. Deferred.
- **`Save both` rewrites both sides** even when only one was edited, as the master plan specifies.
- **A scan or compare failure aborts the whole comparison** (toast, no partial list). Carried over from wave 4.
- **Size and date mode** may show a merged file as different again, because the Rust copy does not preserve modification times. Backend change, deferred.
- **Selection** is not pruned after a rescan; it is filtered to visible rows when used, which covers the observed symptoms.

## Deferred

- Partial scan results for unreadable subfolders, with a flagged-folder row.
- Preserving mtimes on copy (Rust).
- Undo history across more than one merge.
- Empty folders are not shown, only files.
- A real-window visual check of states 2a–2d in dark and light, and of the Windows build.
