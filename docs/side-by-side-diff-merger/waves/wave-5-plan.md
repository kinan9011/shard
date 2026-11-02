# Wave 5 Plan: Folder UI, docs, release (Tasks 14–17)

Base: `f32e45d1` on `feat/diff-merge`. Waves 1–4 are in: Text mode (TS), the Rust folder backend and the desktop bridge. Wave 5 adds the pure folder model, the Folders screen, the merge dialog, mode switching, README and release notes. No Rust change and no new dependency.

## Repo facts checked

- `src/lib/desktop.ts` already exports `isDesktop`, `pickFolder`, `scanFolder`, `compareContents`, `readTextFile`, `writeTextFile`, `applyFolderMerge`, `undoFolderMerge`, `revealPath` and the types `FolderEntry`, `FolderMergeReport`, `FolderUndoReport`. `FolderMergeReport.backupDir` is `string | null`. `applyFolderMerge` takes `{ path, action: "toRight" | "toLeft" }[]`.
- `scan` returns files and folders, `/`-separated, with `isDir`. The model keeps files only.
- `src/components/tools/DiffMerge.tsx` is `return <TextDiffView />`. `TextDiffView` takes `initial?: [PaneDoc, PaneDoc]` and `onModeChange?`. `DiffPanes` uses `initial` only when the editors are created, so docs that arrive later must go through `panes.setDocs`.
- `TextToolbar` renders the `Text | Folders` switch as two `aria-pressed` buttons. The master plan and the Task 17 test want `role="radiogroup"` with radios. One existing test (`diff-merge-component.test.tsx:190`) asserts the buttons and will change.
- `AnchoredPanel` (`Panels.tsx`) is `role="dialog"`, right-aligned to its anchor, `top` in px. `ShortcutsPanel` is text-mode only (fixed list).
- `DiffPanes` already supports `headerHeight={36}` and `showHeaders={false}`. `PaneEmpty` is in `ToolWorkspace.tsx`. `counterText` is exported from `TextToolbar.tsx`; `Choice` (Radix Select group) is not.
- No checkbox in `src/components/ui`. A native `<input type="checkbox">` is used.
- `scripts/prepare-release.mjs` bumps `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `Cargo.lock`, and creates `release-notes/vX.Y.Z.md`. `docs/release-process.md` says an agent runs it. Current version is `2.7.0`. I run `release:prepare -- 2.8.0`, write the notes, run `release:check -- v2.8.0`. No tag, no push.
- Rust `folder_compare` does not preserve mtimes when it copies, so "Size and date" will show a copied file as different again after a rescan. Not changed here (deferred).

## Ordered task list

1. **Task 14**: `src/utils/diff-merge/folder.ts` + `tests/tools/diff-merge-folder.test.ts`. Commit `feat(diff-merge): folder compare model and copy`.
2. **Task 15**: `ModeSwitch.tsx`, `FolderView.tsx`, `FolderToolbar.tsx`, `FolderTable.tsx`, `ActionMenu.tsx`; edit `DiffMerge.tsx`, `TextToolbar.tsx`, `Panels.tsx`; `tests/tools/diff-merge-folder-view.test.tsx`. Commit `feat(diff-merge): folder compare screen with actions and per-file merge`.
3. **Task 16**: `MergeDialog.tsx`; edit `FolderView.tsx`; append tests. Commit `feat(diff-merge): merge dialog, done notice, undo and backup reveal`.
4. **Task 17**: `DiffMerge.tsx` (both views mounted, carry docs), `TextDiffView.tsx` (apply late `initial`), README, version bump + `release-notes/v2.8.0.md`; append test to `diff-merge-component.test.tsx`; static visual audit. Commit `feat(diff-merge): mode switching, docs and release notes`.

Per task: failing test, watch it fail, implement, watch it pass, commit, tick the plan boxes, add a `Deviations:` note, `orca orchestration check`. Heartbeat about every 5 minutes.

## Files

Create:
- `src/utils/diff-merge/folder.ts`
- `src/components/tools/diff-merge/ModeSwitch.tsx`
- `src/components/tools/diff-merge/folder/{FolderView,FolderToolbar,FolderTable,ActionMenu,MergeDialog}.tsx`
- `tests/tools/diff-merge-folder.test.ts`, `tests/tools/diff-merge-folder-view.test.tsx`
- `release-notes/v2.8.0.md`
- `docs/side-by-side-diff-merger/waves/wave-5-plan.md`, `wave-5-report.md`

Modify:
- `src/components/tools/DiffMerge.tsx`
- `src/components/tools/diff-merge/{TextDiffView,TextToolbar,Panels}.tsx`
- `tests/tools/diff-merge-component.test.tsx` (switch test becomes radios; new Task 17 test; desktop mock gains the folder functions)
- `README.md`, `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (version only, via the script)
- `implementation-plan.md` (ticks and `Deviations:` only)

Not touched: `project/`, Rust sources, `desktop.ts`, capabilities.

## Final signatures

### `folder.ts` (as the master plan, plus)

```ts
import type { FolderEntry, FolderMergeReport } from "@/lib/desktop";
export type RowKind = "left" | "right" | "diff" | "same";
export type MergeAction = "toRight" | "toLeft" | "ignore" | "none";
export type CompareBy = "content" | "size-date" | "size";
export interface FileRow { path; name; dir; depth: 0 | 1; kind; left; right; action }   // name = basename, dir = "" or "a/b/"
export interface FolderGroup { dir: string; summary: string; rows: FileRow[] }
export function pairEntries / needsContentCheck / classify / defaultAction / allowedActions / cycleAction
export function groupRows / filterRows / planCounts / plannedText / mergeSubtitle / doneNotice / formatSize / formatDate
// additions (pure helpers the screen needs, kept out of components):
export function makeRow(p: { path: string; left: FolderEntry | null; right: FolderEntry | null }, kind: RowKind, action: MergeAction): FileRow;
export function mergeOps(rows: FileRow[]): { path: string; action: "toRight" | "toLeft" }[];   // toRight rows first, then toLeft
```

Decisions where the master plan is silent:
- `classify` with kind `same` for `content` only when `equalContent === true`. An unknown result is `diff`, never `same`.
- `allowedActions("same")` is `["none"]`.
- `planCounts.replaces` holds rows whose action is `toRight`/`toLeft` and whose destination exists (kind `diff`).
- `plannedText` has the `Planned:` prefix only when something moves. Parts with 0 are dropped. All zero gives `""`.
- `doneNotice`: `Merged {n} item(s):` then only the non-empty clauses (`{r} copied to the right`, `{l} copied to the left`). Backup sentence: 1 backup names the file, more says `{n} replaced copies were backed up first.`, none omits it.
- `mergeSubtitle`/`doneNotice` use plain ternaries for 1 vs many.

### Components

```ts
export function ModeSwitch({ mode, onChange }: { mode: "text" | "folders"; onChange(m: "text" | "folders"): void }): JSX.Element  // radiogroup + radios, arrow keys
export function FolderView({ onOpenInText }: { onOpenInText(docs: [PaneDoc, PaneDoc]): void; onModeChange?(m: "text" | "folders"): void }): JSX.Element
// FolderToolbar / FolderTable / ActionMenu / MergeDialog are presentational; state lives in FolderView.
export function MergeDialog(p: { rows: FileRow[]; open: boolean; onCancel(): void; onConfirm(backup: boolean): void }): JSX.Element | null
// DiffMerge: mode state, pending docs; both views mounted. TextDiffView keeps `initial` and applies a changed `initial` with panes.setDocs.
// Panels.tsx: AnchoredPanel gets `align?: "end" | "start"` (default "end") and `role?: string`; ShortcutsPanel gets `items?` and `note?`. Defaults keep today's behaviour.
// TextToolbar.tsx: exports `Choice`; the mode switch becomes <ModeSwitch>.
```

### Differences from the master plan

1. **`ModeSwitch.tsx` is a new file.** The switch has to exist in the text toolbar (already, wave 3), in the folder toolbar (prototype) and as radios (Task 15 and 17 tests). One component avoids two copies.
2. **`onModeChange` on `FolderView`** (an extra optional prop) so the folder toolbar's switch can go back to Text.
3. **Start merge, the dialog and the footer count the visible rows** (after the Show chips and the filter box), not every row. Otherwise turning a chip off would still copy files the user cannot see. The chip counts and the footer totals still use all rows.
4. **Merge ops order is toRight first, then toLeft**, not path order. The master plan's Task 16 test expects `only-left.db` before `api`.
5. **Tests click `getAllByText("go.mod")[0]`**, because both sides show the name, so `getByText` finds two.
6. **`ActionMenu` positions through `AnchoredPanel`'s new `align="start"`**, so it opens right of the action cell like the prototype (`left: calc(50% + 34px)`), and it uses `role="menu"` through the new `role` prop. This is a small edit to a wave 3 file.
7. **Lower split appears only for a file on both sides.** With nothing selected the table takes the full height. This avoids copy that the prototype does not have. The no-folders-yet state uses `PaneEmpty` `"Choose two folders to compare"` / `"Pick the left and right folder with Browse."` (new copy, nothing in the prototype covers it).
8. **Task 17 Step 4 (`npm run tauri dev`) is not run.** The brief forbids launching any GUI. It becomes a static audit of the folder components against `Folder Compare.dc.html` (grid templates, heights, chip titles, colours, copy), plus a test for the browser notice. Same treatment as wave 3 Task 10.
9. **Version bump to 2.8.0** through `release:prepare`, as `docs/release-process.md` requires for release notes. No tag.

## Review Focus lines for this wave

| # | Line | Pinned by |
|---|---|---|
| 5 | Folder paths that escape their root (`../x`, absolute, symlink out) are rejected before any read, write or delete | Rust tests from wave 4 do the rejecting. Wave 5 pins the UI side in `diff-merge-folder-view.test.tsx`: "shows the backend's rejection as a toast and writes nothing" (`applyFolderMerge` rejects with `Path escapes the folder.`: toast, no notice, no extra rescan). Also `folder.ts` never builds a path itself: the test "model only forwards backend paths" checks `mergeOps` output equals the row paths unchanged. |
| 4 | Binary or non-UTF-8 file is refused, never loaded | "binary file shows the Binary or non-text file empty state" (`readTextFile` rejects: `PaneEmpty`, no editors) |
| – | Any desktop-only action is unreachable in the browser | "browser shows desktop-only notice" (no scan, no pick) |
| – | Nothing is written without confirmation | "Ctrl+Enter opens the dialog; Escape cancels without writing" |
| – | Undo reports files it could not restore | "undo with unrestorable files shows an error toast" |

Lines 1–3 (large input, EOL, trailing newline) belong to waves 1–3. Wave 5 reuses `DiffPanes` unchanged; "Save both" writes `joinEol(text, eol)` so a CRLF file stays CRLF (pinned by "Save both writes both sides with their EOL and rescans").

## Verification commands

Per task:
- Task 14: `npx vitest run tests/tools/diff-merge-folder.test.ts`
- Task 15: `npx vitest run tests/tools/diff-merge-folder-view.test.tsx tests/tools/diff-merge-component.test.tsx`
- Task 16: `npx vitest run tests/tools/diff-merge-folder-view.test.tsx`
- Task 17: `npx vitest run tests/tools/diff-merge-component.test.tsx`; `npm run release:check -- v2.8.0`

Before each commit: `npm run typecheck && npm run lint`.

Gate (Phase C): `npm run lint && npm run typecheck && npm test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build:web`, then check the build output keeps CodeMirror out of `index-*.js`.

Review: `git diff f32e45d1700553649023df4dcf771757171a9ae5..HEAD`, code-review skill, at most 2 fix rounds.

Safety: all new tests mock `@/lib/desktop`. No test or command touches a real folder. No GUI, no `tauri dev`, no push, no tag.
