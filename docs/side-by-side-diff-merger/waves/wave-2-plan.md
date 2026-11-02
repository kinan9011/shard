# Wave 2 Plan: Side-by-side viewer (Tasks 5–6)

Base: `688e2555` on `feat/diff-merge`. Wave 1 logic modules are in `src/utils/diff-merge/` (`blocks`, `config`, `ignore`, `apply`, `inline`, `geometry`, `unified`, `patch`, `settings`, `language`). `src/components/tools/DiffMerge.tsx` is still the placeholder. `src/components/tools/diff-merge/` does not exist yet.

## Ordered task list

1. **Task 5** — `tests/setup.ts` jsdom shims; `editor.ts`, `useDiffEditors.ts`, `diff-merge.css`; test `tests/tools/diff-merge-editors.test.tsx`. Commit `feat(diff-merge): CodeMirror pane extensions and two-editor hook`.
2. **Task 6** — `PaneHeader.tsx`, `Gutter.tsx`, `ChangeMap.tsx`, `DiffPanes.tsx`; test `tests/tools/diff-merge-panes.test.tsx`. Commit `feat(diff-merge): side-by-side panes with ribbons, merge arrows, change map, sync scroll`.

Per task: red test → watch it fail → implement → green → commit. Heartbeat every ~5 min; `orca-ide orchestration check` between tasks and before `worker_done`.

## Files

Create:
- `src/components/tools/diff-merge/editor.ts`
- `src/components/tools/diff-merge/useDiffEditors.ts`
- `src/components/tools/diff-merge/diff-merge.css`
- `src/components/tools/diff-merge/PaneHeader.tsx`
- `src/components/tools/diff-merge/Gutter.tsx`
- `src/components/tools/diff-merge/ChangeMap.tsx`
- `src/components/tools/diff-merge/DiffPanes.tsx`
- `tests/tools/diff-merge-editors.test.tsx`
- `tests/tools/diff-merge-panes.test.tsx`
- `docs/side-by-side-diff-merger/waves/wave-2-report.md`

Modify: `tests/setup.ts` (shims: `Range.prototype.getClientRects`, `Range.prototype.getBoundingClientRect`, `globalThis.ResizeObserver`, each only if missing); `implementation-plan.md` (tick boxes, `Deviations:` notes only).

Not touched: `DiffMerge.tsx` (placeholder stays; wiring is wave 3), anything under `project/`, Rust, `desktop.ts`.

## Final signatures

`editor.ts` — exactly as the master plan:

```ts
export interface DiffDecoState { side: "a" | "b"; blocks: readonly DiffBlock[]; current: number; highlight: HighlightMode; runs: readonly CollapsedRun[] }
export const setDiff: StateEffectType<DiffDecoState>;
export const diffState: StateField<DiffDecoState>;
export const languageConf: Compartment; export const wrapConf: Compartment; export const whitespaceConf: Compartment;
export function paneExtensions(side: "a" | "b", placeholderText: string): Extension;
```

Additions, not in the master plan (all additive, needed by tasks 5 and 6):
- `export const dmHighlightStyle: HighlightStyle` (plan names it but does not list it as an export).
- `export const EXPAND_EVENT = "dm-expand"`.
- `diffState` holds `DiffDecoState` and a `DecorationSet` internally (field value is `{ state: DiffDecoState; decos: DecorationSet }`); the exported type of the field is therefore `StateField<{state, decos}>`. The master plan types it as `StateField<DiffDecoState>`; no consumer in tasks 5–6 reads it except the Gutter via a tiny helper `getDiffState(view): DiffDecoState`. *Reason:* decorations must be mapped across doc changes between an edit and the rAF recompute, so the field needs to own the set.

`useDiffEditors.ts` — as the master plan:

```ts
export interface DiffEditors { a: EditorView | null; b: EditorView | null; blocks: readonly DiffBlock[]; precise: boolean; focused: "a" | "b"; cursor: { line: number; col: number } }
export function useDiffEditors(hostA: RefObject<HTMLDivElement>, hostB: RefObject<HTMLDivElement>,
  opts: { settings: DiffSettings; current: number; expanded: ReadonlySet<number>; initialA?: string; initialB?: string }): DiffEditors;
```

`precise` = every block `precise` (true when there are no blocks). The "Diff is approximate for very large input" notice is wave 3 UI; this wave only exposes the signal.

`DiffPanes.tsx` — as the master plan:

```ts
export interface PaneDoc { name: string; text: string; eol: Eol; language: string | null }
export interface DiffPanesHandle { editors: DiffEditors; apply(index: number, dir: Direction, mode: "replace" | "append"): void;
  goTo(index: number): void; setDocs(a: PaneDoc, b: PaneDoc): void; getDocs(): [PaneDoc, PaneDoc] }
export const DiffPanes: ForwardRefExoticComponent<{ settings: DiffSettings; current: number; onCurrentChange(i: number): void;
  onApplied(index: number): void; onStateChange(e: DiffEditors): void; headerHeight?: 38 | 36; showHeaders?: boolean;
  initial?: [PaneDoc, PaneDoc] } & RefAttributes<DiffPanesHandle>>;
```

Internal helpers (not exported unless a test needs them): `PaneHeader` props `{ side, label, doc, lineCount, focused, onName, onLanguage, onLoadFile(file), onPaste(), onClear(), copyValue }`; `Gutter` props `{ editors, current, onApply }`; `ChangeMap` props `{ editors, current, onGoTo }`.

## Differences from the master plan (and why)

1. **Expanded-fold state lives in `DiffPanes`.** The hook takes `expanded`, the fold widget fires `dm-expand`, but `DiffPanesProps` has no `expanded`. So `DiffPanes` listens for `dm-expand` on its root and keeps the `Set<number>` itself. *Reason:* otherwise collapse can never expand.
2. **Line count** is lines without the phantom empty last line: `"a\nb\n"` → `"2 lines"`, `""` → `"0 lines"`. The test in the master plan expects `"2 lines"` for a two-line doc with trailing newline.
3. **Header actions in empty state.** With an empty doc the header shows only Open and Paste (as the design's state 1a does); Clear and Copy show once text exists. No line count / language until text exists? The design's empty header shows the `Plain text` badge but no count, so the count is hidden when the doc is empty.
4. **`current` clamp** after a recompute is done in `DiffPanes` (an effect calling `onCurrentChange`), matching the plan's "parent clamps".
5. **Language auto-detect trigger.** `DiffPanes` re-runs the debounced (300 ms) `detectLanguageName` when `editors.blocks` changes identity (once per recompute). A side whose language was set by file name or by the user's Select is "locked" and skipped. Clear unlocks.
6. **rAF fallback.** The hook uses `requestAnimationFrame` per plan; if jsdom lacks it the code falls back to `setTimeout(…, 0)`.
7. **Highlight/ignore/collapse changes** (settings) recompute synchronously in an effect; only doc edits go through rAF.

## Review Focus lines for this wave

| # | Line | Pinned by |
|---|---|---|
| 4 | Binary or non-UTF-8 file opened or dropped: refuse with toast `"This file is not UTF-8 text."`, never load garbage | `diff-merge-panes.test.tsx` "rejects a binary file" (NUL byte via the Open input); plus "rejects non-UTF-8 bytes" (`0xFF 0xFE 0xFA`, no NUL) and "rejects a binary file dropped on a pane"; asserts the editor stays empty |
| 3 | Missing trailing newline / empty side: applying at the end must not drop or duplicate the final newline; pushing into an empty doc works | `diff-merge-panes.test.tsx` "applies at the end of a doc with no trailing newline" and "pushes into an empty side" (through `DiffPanes.apply`, i.e. the real CodeMirror dispatch) |
| 1 | Huge input stays responsive (diff bounded) | Wave 1 pins the diff. This wave: `useDiffEditors` calls `computeBlocks` once per rAF, not per keystroke, pinned by "coalesces edits into one recompute" (spy count on `requestAnimationFrame` callbacks / blocks identity). The approximate notice itself is wave 3 |
| 2 | CRLF/LF | Open path runs `splitEol`; pinned by "Open normalises CRLF and keeps the EOL" (`getDocs()[0].eol === "CRLF"`, text without `\r`); Copy value uses `joinEol` |
| 5 | Folder paths | Not this wave |

## Verification commands

```
npx vitest run tests/tools/diff-merge-editors.test.tsx          # red then green, Task 5
npx vitest run tests/tools/diff-merge-panes.test.tsx            # red then green, Task 6
npx vitest run tests/tools/diff-merge-blocks.test.ts tests/tools/diff-merge-logic.test.ts tests/tools/diff-merge-language.test.ts
npm run lint && npm run typecheck && npm test                    # full gate, Phase C
git diff 688e2555308a1f6fac490e2b4eb087d86beefc6f..HEAD          # review
git status --short                                               # must be empty
```

Design values to reproduce (from Global Constraints and `Diff Merge Tool.dc.html`): grid `minmax(0,1fr) 64px minmax(0,1fr) 14px`; header row 38px (36px in the folder split); arrows 18×18 radius 4, `>>` at left 3, `<<` at left 43; current arrows are chips (`--dm-raised`, `0 0 0 1px border, 0 1px 2px rgb(0 0 0 / .15)`), others transparent with `fg / .7`; gutter borders `border / .6`, map left border `/ .5` and background `muted / .3`; header background `muted / .35`, bottom border `border / .5`; fold bar `muted` background with dashed top and bottom borders, 22px; ribbons for collapsed runs use `hsl(var(--muted))`.
