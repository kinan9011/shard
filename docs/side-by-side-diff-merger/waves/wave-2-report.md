# Wave 2 Report: Side-by-side viewer (Tasks 5–6)

**Outcome: gate green.** `npm run lint` 0 errors (6 pre-existing warnings, none in wave files), `npm run typecheck` clean, `npm test` 165 files / 2305 tests passed. An earlier full run in the same session failed two wall-clock perf tests (`json-diff` "few MB quickly", one 1500 ms assertion) with the host at load average ~38; they passed on rerun at lower load. This is the known suite-load flakiness from the baseline fix.

## Built
- **Task 5**: `editor.ts` (`setDiff`, `diffState`, compartments, `paneExtensions`, highlight style, line/word/gap/fold decorations), `useDiffEditors.ts`, `diff-merge.css`; `tests/setup.ts` jsdom shims (`Range` geometry, `ResizeObserver`).
- **Task 6**: `DiffPanes.tsx` (handle: `apply`, `goTo`, `setDocs`, `getDocs`; sync scroll; language load and sniffing; file open, paste, clear, drop), `PaneHeader.tsx`, `Gutter.tsx` (SVG ribbons and `>>` / `<<` arrows), `ChangeMap.tsx`, plus a small `useGeometryTick.ts`.
- `DiffMerge.tsx` is still the placeholder. Wiring is wave 3.

## Tests
- New: `diff-merge-editors` 6, `diff-merge-panes` 23 (29 total). Full suite 2305 passed.
- TDD: both test files were run red (module missing) before implementing. A mutation check removed the stale-block guard and the "ignores a stale arrow click" test failed, then the guard was restored.

## Review Focus pins
- **3, trailing newline / empty side**: "applies at the end of a doc with no trailing newline…" and "pushes into an empty side", both through the real CodeMirror dispatch.
- **4, binary / non-UTF-8**: NUL file via Open, invalid-UTF-8 bytes without NUL, and a binary file dropped on a pane. Each asserts the toast `"This file is not UTF-8 text."` and an unchanged (empty) editor.
- **2, CRLF**: "Open normalises CRLF and remembers the original EOL", and Paste likewise. Copy writes `joinEol`.
- **1, huge input**: diff bounding is Wave 1. Here the hook diffs once per frame ("coalesces several edits into one recompute"), and re-dispatches decorations without re-diffing on `current` changes. `DiffEditors.precise` exposes the approximate signal; the notice UI is wave 3.
- **5**: not this wave.

## Deviations (also under Tasks 5 and 6 in the master plan)
- The hook diffs only on edits or `ignore` / `ignoreCase` changes; `current`, `highlight`, `collapse`, `contextLines` and `expanded` only re-dispatch from cached blocks.
- `diffState` is a plain `StateField<DiffDecoState>`; decorations sit in a second unexported field. (The wave-2 plan draft said otherwise; the implementation follows the master plan.) Extra exports: `EXPAND_EVENT`, `dmHighlightStyle`, `getDiffState`, `KIND_VAR`.
- `DiffPanes` owns the expanded-fold set (the master plan's props carry none).
- `apply` is a no-op if the block text no longer matches the editors (blocks lag an edit by a frame).
- Change-map ticks are buttons with `aria-label="Go to change n"`. Header Copy is `Copy Original|Modified`. With an empty side the header shows only Open and Paste.
- Gutter draws every block when there is no layout (jsdom).
- Clipboard failure toast copy is invented: `"Could not read the clipboard. Press Ctrl+V in the editor instead."`

## Review (code-review, medium, 1 round)
Fixed:
- Sync-scroll listeners were re-attached on every caret move (effect keyed on the whole `editors` object). Now keyed on the two views.
- Language-sniff debounce restarted on every caret move. Now keyed on views and `blocks`.
- `onStateChange` was returned from the effect (a returned value becomes the cleanup); now wrapped in braces and called through a ref.
- A synchronous recompute now cancels a pending frame, so a settings change plus an edit in one frame diffs once.
- Rename input: guard so Escape or Enter followed by blur cannot commit twice or commit a cancelled edit (not reproducible in jsdom, test added anyway).

Not changed:
- **Rename to an unrecognised name keeps the old language locked.** Accepted: a manual language choice is indistinguishable from a name-derived one.
- **Silent no-op for a stale arrow click.** Deliberate: the alternative is a wrong merge.
- **`collapsedRuns` is computed in the hook and again for the gutter.** Both read the same blocks and run on the same edits; no drift found. Could be exposed from the hook later.
- **`cursor` and `focused` live in `DiffEditors`** (as the plan specifies), so the object changes on caret moves. Effects that mattered now depend on the views only.
- **Sync-scroll echo guard** assumes one echo event per programmatic scroll; worst case is a swallowed scroll for one frame.

## Deferred
- Visual QA against the mockup (wave 3, Task 10): ribbon and arrow pixel positions are untested in jsdom, which has no layout.
- Ctrl+O and the other root-level shortcuts (Task 7). The empty-state hint text already names Ctrl+V and Ctrl+O.
- "Diff is approximate for very large input" notice (Task 7).
- Language Select lists every `language-data` entry; no search box.
