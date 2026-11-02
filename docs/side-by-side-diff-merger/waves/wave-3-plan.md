# Wave 3 Plan: Text mode screen (Tasks 7–10)

Base: `93799b69` on `feat/diff-merge`. Waves 1–2 are in: logic in `src/utils/diff-merge/*`, `editor.ts`, `useDiffEditors.ts`, `DiffPanes.tsx` (+ `PaneHeader`, `Gutter`, `ChangeMap`, `useGeometryTick`) in `src/components/tools/diff-merge/`. `src/components/tools/DiffMerge.tsx` is still the placeholder (`<div className="json-workspace" data-testid="diff-merge" />`). Folder mode is waves 4–5 and is not touched.

## Ordered task list

1. **Task 7**: `TextToolbar.tsx`, `StatusBar.tsx`, `TextDiffView.tsx`; `DiffMerge.tsx` renders `TextDiffView`; small additive hooks in `DiffPanes` / `PaneHeader`. Test `tests/tools/diff-merge-component.test.tsx`. Commit `feat(diff-merge): text toolbar, navigation, status bar and shortcuts`.
2. **Task 8**: `UnifiedPane.tsx`; `TextDiffView.tsx` (unified header, mounting); small additions to `ChangeMap.tsx`, `editor.ts`, `unified.ts`, `diff-merge.css`. Tests appended. Commit `feat(diff-merge): unified viewer with keep chips`.
3. **Task 9**: `Panels.tsx`; `TextToolbar.tsx`, `TextDiffView.tsx`, `DiffPanes.tsx`, `PaneHeader.tsx` (Save). Tests appended. Commit `feat(diff-merge): settings and shortcuts panels, collapse, export`.
4. **Task 10**: visual QA. No browser or GUI is allowed in this run, so it is a static, value-by-value audit of the CSS and components against the `.dc.html` source, plus the narrow-window fallback (`ResizeObserver`), a test that the design's `LEFT`/`RIGHT` sample yields 7 differences, and `npm run build:web`. Commit `style(diff-merge): match text-mode mockup in dark and light`.

Per task: failing test, watch it fail, implement, watch it pass, commit, tick the plan boxes, add a `Deviations:` note. Heartbeat about every 5 minutes. `orca orchestration check` between tasks and before `worker_done`.

## Files

Create:
- `src/components/tools/diff-merge/TextToolbar.tsx`
- `src/components/tools/diff-merge/StatusBar.tsx`
- `src/components/tools/diff-merge/TextDiffView.tsx`
- `src/components/tools/diff-merge/UnifiedPane.tsx`
- `src/components/tools/diff-merge/Panels.tsx`
- `tests/tools/diff-merge-component.test.tsx`
- `docs/side-by-side-diff-merger/waves/wave-3-report.md`

Modify:
- `src/components/tools/DiffMerge.tsx` (render `TextDiffView`)
- `src/components/tools/diff-merge/DiffPanes.tsx` (additive: `onMetaChange`, `openFile`, Save, clear fold set when collapse turns off)
- `src/components/tools/diff-merge/PaneHeader.tsx` (additive: Save button)
- `src/components/tools/diff-merge/ChangeMap.tsx` (additive: optional `view`, `ticks`)
- `src/components/tools/diff-merge/editor.ts` (export `FoldWidget`)
- `src/components/tools/diff-merge/diff-merge.css` (unified view, panels, toolbar helpers)
- `src/utils/diff-merge/unified.ts` (add `unifiedTicks`; test in `tests/tools/diff-merge-logic.test.ts`)
- `docs/side-by-side-diff-merger/implementation-plan.md` (ticks and `Deviations:` only)

Not touched: `project/`, Rust, `desktop.ts`, `toolRegistry.ts` (already registered and lazy).

## Final signatures

```ts
// TextToolbar.tsx
export function counterText(n: number, cur: number, empty: boolean): string;   // cur is the 0-based current index
export function TextToolbar(props: {
  settings: DiffSettings;              // effective settings (viewer forced to "unified" when narrow)
  onChange(patch: Partial<DiffSettings>): void;
  onReset(): void;
  count: number; current: number; empty: boolean;
  narrow: boolean;                     // hides the Viewer select
  onPrev(): void; onNext(): void; onSwap(): void;
  onModeChange?: (mode: "text" | "folders") => void;   // Text|Folders switch renders only when given
}): JSX.Element;

// StatusBar.tsx
export function StatusBar(props: { empty: boolean; line: number; col: number; language: string;
  stats: { added: number; removed: number; modified: number }; message: string | null; eol: Eol }): JSX.Element;

// TextDiffView.tsx
export function TextDiffView(props: { initial?: [PaneDoc, PaneDoc]; onModeChange?: (m: "folders") => void }): JSX.Element;

// UnifiedPane.tsx (master plan props + onCurrentChange)
export function UnifiedPane(props: { a: string; b: string; blocks: readonly DiffBlock[]; settings: DiffSettings;
  current: number; expanded: ReadonlySet<number>; onApply(i: number, dir: Direction): void;
  onExpand(runFrom: number): void; onCurrentChange(i: number): void }): JSX.Element;

// Panels.tsx
export function AnchoredPanel(props: { open: boolean; onClose(): void; anchorRef: RefObject<HTMLElement>;
  width: number; top?: number /* default 54 */; children: ReactNode }): JSX.Element | null;
export function SettingsPanel(props: { settings: DiffSettings; onChange(p: Partial<DiffSettings>): void; onReset(): void }): JSX.Element;
export function ShortcutsPanel(): JSX.Element;

// DiffPanes.tsx additions
export interface PaneMeta { name: string; eol: Eol; language: string | null }
//   prop  onMetaChange?(m: Record<"a" | "b", PaneMeta>): void
//   handle openFile(side: "a" | "b"): void

// ChangeMap.tsx additions: optional props  view?: EditorView | null;  ticks?: ReturnType<typeof mapTicks>
// unified.ts addition:  unifiedTicks(rows: readonly UnifiedRow[]): { top; height; kind; index }[]
// editor.ts addition:   export class FoldWidget
```

## Differences from the master plan, and why

1. **`counterText` takes a 0-based `cur`.** Matches the prototype (`cur + 1`). The plan does not say.
2. **Text|Folders switch.** Built into `TextToolbar` as the plan says, but rendered only when `onModeChange` is passed. `DiffMerge` passes none until Task 17, so no dead control ships.
3. **Gear and `?` buttons land in Task 7** (the control list is Task 7's); their panels land in Task 9.
4. **`DiffPanes` additions.** The status bar and unified header need each pane's language, name and EOL, which only `DiffPanes` knows, so it gets `onMetaChange`. Ctrl+O needs to open the picker, so the handle gets `openFile`. Task 9's per-pane Save and "toggling collapse off clears the Set" both live in `DiffPanes`/`PaneHeader`.
5. **Two fold sets.** `DiffPanes` already owns the side-by-side one. `TextDiffView` owns a second for the unified view. Both clear when collapse turns off; the unified one also clears on swap.
6. **Unified header lives in `TextDiffView.tsx`**, since `UnifiedPane` has no names or EOL props. `UnifiedPane` also renders its own change-map cell; it gets `onCurrentChange` so a tick click can navigate.
7. **Shortcuts use `onKeyDownCapture` on the root**, not bubble. CodeMirror's keymap binds `Mod-Shift-Arrow` (select by word) and would also fire after a bubble handler. Capture plus `stopPropagation` lets only our action run.
8. **Ctrl+Z / Ctrl+Shift+Z in the unified viewer** undo or redo the side the last unified apply changed. The status message says "Ctrl+Z to undo" and the hidden editors cannot take focus, so without this the hint would be false.
9. **The "Applied change" message** clears on the next diff recompute that did not come from the apply itself (a flag skips the one recompute the apply triggers). Settings changes that re-diff also clear it. Accepted.
10. **Task 10 without a browser.** The brief forbids launching a GUI, so the plan's "run `npm run dev:web` and compare" becomes a static audit plus tests and a production build. The report lists what still needs a human look.
11. **Save fallback names** when a side has no name: `original.txt` / `modified.txt`, and `original.patch` for a patch. Failure toast `"Could not save the file."` is invented copy (not in the design).

## Review Focus lines for this wave, and the pinning tests

- **1. Very large input: approximate notice** (`"Diff is approximate for very large input"`, `role="status"`). Test "shows the approximate notice when the diff is imprecise" renders two 2,000-line, fully different docs. A second assertion checks the notice is absent for a small diff. (Diff bounding itself was pinned in Wave 1.)
- **2. CRLF.** Test "status bar shows the original EOL" opens CRLF text and expects `UTF-8 · CRLF`. Test "Save and Copy result write the original EOL back" asserts the `Blob` passed to `saveFile` and the clipboard text contain `\r\n`.
- Lines 3, 4, 5 are pinned in Waves 1–2 and 5; this wave only must not regress them. The full suite covers 3 and 4.

## Verification commands

```
npx vitest run tests/tools/diff-merge-component.test.tsx     # per task: red, then green
npx vitest run tests/tools/diff-merge-logic.test.ts tests/tools/diff-merge-panes.test.tsx tests/tools/diff-merge-editors.test.tsx
npm run lint && npm run typecheck && npm test
npm run build:web
git status --short
git log --oneline 93799b69890f0cd1e7b8515d759eecdafc306820..HEAD
```

`npm test` is flaky under host load (two wall-clock perf tests failed once in Wave 2 at load average ~38). A failure there gets one rerun before it is called real.
