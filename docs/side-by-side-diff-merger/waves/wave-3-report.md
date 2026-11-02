# Wave 3 Report: Text mode screen (Tasks 7–10)

**Outcome: gate green.** `npm run lint` 0 errors (6 warnings, all pre-existing, none in wave files), `npm run typecheck` clean, `npm test` 166 files / 2347 tests passed, `npm run build:web` passes. Tree clean. Task 10's visual pass could not be done in a browser (see Deferred).

## Built
- **Task 7**: `TextToolbar.tsx` (nav, Swap, Viewer / Ignore / Highlight selects, Collapse and Sync-scroll switches, gear, `?`, aria-live counter, optional Text | Folders switch), `StatusBar.tsx`, `TextDiffView.tsx` (settings state with `saveSettings`, current-change state, F7 / Shift+F7 wrap, Ctrl+Shift+←/→ apply, Ctrl+Shift+S swap, Ctrl+Shift+C collapse, Ctrl+O open, "Applied change n — Ctrl+Z to undo" message, approximate-input notice). `DiffMerge.tsx` renders it.
- **Task 8**: `UnifiedPane.tsx` (read-only CodeMirror, four gutters, Keep left / Keep right chips, −/+ markers, word marks, fold bars, change-map cell), unified header with Copy patch, Save patch and Copy result, `unifiedTicks` in `unified.ts`. Side-by-side editors stay mounted but hidden.
- **Task 9**: `Panels.tsx` (`AnchoredPanel`, `SettingsPanel`, `ShortcutsPanel`), collapse fold handling, per-pane Save, patch save.
- **Task 10**: static audit against the prototype, narrow-window fallback tests, switch-size fix, mockup sample test, `build:web`.
- Small additive changes outside the new files: `DiffPanes` (`onMetaChange`, `openFile`, Save, clears opened folds when collapse turns off), `PaneHeader` (Save), `ChangeMap` (`Pick<DiffEditors,"b"|"blocks">` plus optional `ticks`), `editor.ts` (`FoldWidget` exported), `diff-merge.css`.

## Tests
- `tests/tools/diff-merge-component.test.tsx`: 40 new tests. `diff-merge-logic.test.ts`: +2 (`unifiedTicks`). Diff-merge total 6 files, 101 tests; full suite 2347.
- TDD: Task 7's file was run red (module missing); `unifiedTicks` was run red; Task 9's panel, Save and fold tests were run red. The review fix's test was run against the old code and failed. A mutation check removed the collapse-off fold reset and "folds again" failed, then it was restored. Not red first: the narrow-window tests (the behaviour landed in Task 7, Task 10 only adds tests) and "collapse toggle folds long unchanged runs" (already worked).

## Review Focus pins
- **1, very large input:** "shows the approximate notice when the diff is imprecise" (two 2,000-line fully different docs) and "has no notice for a small diff". Diff bounding itself was Wave 1.
- **2, CRLF:** "status bar shows the original EOL" (`UTF-8 · CRLF`), "Copy result writes the modified text with its original EOL", "Save writes the pane's text with its original EOL". Copy patch and Save patch use LF.
- 3 and 4 stay pinned by Waves 1–2 and passed in the full suite. 5 is wave 5.

## Deviations (also under Tasks 7–10 in the master plan)
- `counterText` takes a 0-based `cur`.
- Text | Folders switch renders only when `onModeChange` is passed; `DiffMerge` passes none until Task 17.
- Shortcuts use `onKeyDownCapture` with `stopPropagation`, because CodeMirror binds `Mod-Shift-Arrow` itself.
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y in unified go to the side the last Keep chip changed. Without that the "Ctrl+Z to undo" hint would be false.
- Two fold sets (side-by-side in `DiffPanes`, unified in `TextDiffView`), both cleared when collapse turns off; unified also clears on swap and apply.
- `UnifiedPane` has an extra `onCurrentChange` prop; its header lives in `TextDiffView`. No syntax highlighting in unified.
- CodeMirror's `aria-hidden` on gutters is removed from the Keep-chip column so the chips are reachable.
- `AnchoredPanel` takes an optional `top` (default 54). Stepper buttons are named `Fewer context lines` / `More context lines`.
- Invented copy: `"Could not save the file."`, save fallbacks `original.txt` / `modified.txt` / `original.patch`.
- The "Applied change" message clears on the next recompute not caused by the apply; a settings change that re-diffs also clears it.

## Review (code-review, medium, 1 round)
Fixed:
- Unified-mode Ctrl+Z used a stale `lastDest` (initially `"b"`): after editing in side-by-side, switching to unified and pressing Ctrl+Z undid a hidden-editor edit. `lastDest` is now null until a Keep chip is used, and resets on view switch and swap. Test added.
- The unified fold-reset effect created a new empty Set on every run (extra render and unified rebuild). Now guarded like `DiffPanes`.
- Opened unified folds went stale after an apply (keys are line numbers). They are cleared on apply.
- The scroll-to-current effect used a one-shot `mounted` ref that behaves differently under StrictMode remounts. It now scrolls only when `current` actually changes.
- `joinEol` for Copy result was recomputed every render; now memoised.

Not changed:
- **`applying` flag could stay set if an apply caused no recompute.** An apply always changes the doc (source and destination block text differ) and a stale-click apply never calls `onApplied`, so the case did not reproduce.
- **Patch built eagerly while unified is shown.** The unified view is read-only, so it rebuilds only after an apply; `CopyButton` needs a value up front. Revisit if large files feel slow.
- **Capture-phase shortcuts apply to the whole tool root, including the panels.** The brief and master plan bind on the root. Ctrl+O is not in the shortcuts panel because the design lists exactly seven rows.

## Deferred / needs a human
- **Visual QA (Task 10)** was a static audit, not a rendered comparison: the run forbids launching a GUI. Check ribbon and arrow pixel positions, the unified current-block outline (drawn across separate gutter cells), and dark and light in `npm run dev:web`.
- **The design's sample gives 5 blocks, not 7.** `@codemirror/merge` groups hunks separated by one common line (the design's `SEG` splits them). Plan says expect 7. Fixing it means a line-level grouping step in Wave 1's `computeBlocks`, which changes block counts and word highlights. The test pins today's 5 with line ranges. Coordinator decision needed.
- The Text | Folders switch is wired in Task 17. Unified view has no syntax highlighting. The language Select still has no search box.
