# Diff & Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JetBrains-style **Diff & Merge** tool (id `diff-merge`) with two modes:
- **Text:** two editable code panes joined by curved ribbons, with `>>` / `<<` merge arrows, word highlights, navigation, ignore and highlight modes, collapse, a unified viewer, settings, shortcuts and export.
- **Folders (desktop only):** compare two directories, choose an action per file, run the merge with a backup, undo it, and merge single files by hand in an embedded text diff.

**Architecture:**
- **Pure logic** lives in `src/utils/diff-merge/*` and is unit-tested.
  - Text diffing reuses `@codemirror/merge`'s `Chunk.build` / `diff` engine, plus our own ignore-mode override.
- **Text panes** are two independent CodeMirror 6 `EditorView`s. They are **not** a `MergeView`, because the design needs unaligned panes, curved ribbons and an optional sync scroll.
  - Decorations come from a shared `StateField`.
  - The 64px gutter is a React SVG overlay positioned from each editor's line geometry.
- **Folder mode** adds one Rust module (`src-tauri/src/folder_compare.rs`) of path-confined commands, exposed through `src/lib/desktop.ts`.

**Tech Stack:**
- React 18, TypeScript, Vite 5, Tailwind/shadcn (Radix Select and Switch)
- CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `search`, `merge`, `language-data`) and `@lezer/highlight`
- Tauri 2 (Rust, `tauri-plugin-dialog` already present), `@tauri-apps/plugin-opener` (already present)
- Vitest 3 with jsdom and Testing Library, `cargo test`

**Spec:**
- `docs/side-by-side-diff-merger/project/Diff Merge Tool.dc.html`: Text mode, states 1a–1g in dark and light.
- `docs/side-by-side-diff-merger/project/Folder Compare.dc.html`: Folders mode, states 2a–2d.
- `docs/side-by-side-diff-merger/design-brief.md`: the brief given to the designer.
- Behaviour reference: the JetBrains screenshots in `docs/side-by-side-diff-merger/project/uploads/`.
- Executors read the `.dc.html` source directly for any pixel value not repeated here. Don't render them.

## Global Constraints

**Repo rules**
- Offline only, no network calls. Tauri is reached only through `src/lib/desktop.ts`, as `.github/copilot-instructions.md` requires.
- Business logic stays pure in `src/utils/diff-merge/`. Components hold no diff logic.
- Tool metadata: name `"Diff & Merge"`, id `"diff-merge"`, lucide icon `GitMerge`, category `"Text Tools"`, keywords `["diff", "merge", "compare", "side by side", "jetbrains", "patch", "folder compare", "directory diff"]`.
- New npm deps, and only these: `@codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/search @codemirror/merge @codemirror/language-data @lezer/highlight`. No new Rust crates.

**Theme and colour**
- Colours come only from existing tokens in `src/index.css` (`--success`, `--destructive`, `--warning`, `--primary`, `--ring`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--accent`, `--card`, `--foreground`), used as `hsl(var(--x) / alpha)`.
- Dark mode follows the `.dark` class on `<html>`.
- Modified changes use `--warning`, added use `--success`, removed use `--destructive`, and the current change gets a `--ring` outline.

**Design values (verbatim from the spec)**
- Change alphas, light / dark:

  | token | light | dark |
  |---|---|---|
  | `--dm-a-line` | `.08` | `.10` |
  | `--dm-a-word` | `.20` | `.26` |
  | `--dm-a-cur` | `.14` | `.17` |
  | `--dm-a-rib` | `.09` | `.10` |

- Syntax colours, light / dark:

  | token | light | dark |
  |---|---|---|
  | `--dm-s-kw` | `#6d42ba` | `#bb9aec` |
  | `--dm-s-str` | `#aa3540` | `#e9a394` |
  | `--dm-s-lit` | `#2865b5` | `#91b9ee` |
  | `--dm-s-num` | `#805720` | `#dec28e` |
  | `--dm-s-fn` | `#2865b5` | `#91b9ee` |

  Comments use `--muted-foreground`.
- `--dm-raised`: light `#ffffff`, dark `#2b3750`.
- Editor text: `13px/22px var(--font-code)`, pane top padding `6px`.
- Line numbers: `12px`, column width `44px`, `padding-right:12px`.
- Text grid: `grid-template-columns: minmax(0,1fr) 64px minmax(0,1fr) 14px`. The pane-header row is `38px`, or `36px` in the folder lower split. The footer is `32px`.
- Merge arrow chips are `18×18` with radius 4. `>>` sits at `left:3px`, `<<` at `left:43px` (`64 − 21`).

**Copy strings (exact)**
- Counter, chosen in this order:
  1. `"Nothing to compare"` when both sides are empty.
  2. `"No differences"` (success colour) when the sides match.
  3. `"{cur} of {n} differences"`, or `"1 of 1 difference"` when there is one.
- Status message after applying: `"Applied change {n} — Ctrl+Z to undo"`.
- Empty panes:
  - Header labels `"Original"` and `"Modified"`, badge `"Plain text"`.
  - Placeholders `"Paste the original text"` and `"Paste the modified text"`.
  - Overlay title `"Paste text or drop a file"`.
  - Hints `"Ctrl+V to paste, Ctrl+O to open a file"` (left) and `"Differences appear as soon as both sides have text"` (right).
  - Footer `"Ready"`.
- All other strings: copy verbatim from the `.dc.html` files (dropdown labels, settings, shortcuts, folder chips, menu, dialog, notice, status).

**Keyboard**
- Shortcuts bind on the tool's root element, not on `window`. The app already owns `Ctrl+W` and `Ctrl+Tab` (`src/app/DevToolsApp.tsx:697-711`).
- Text mode: `F7`, `Shift+F7`, `Ctrl+Shift+→`, `Ctrl+Shift+←`, `Ctrl+Shift+S`, `Ctrl+Shift+C`, `Ctrl+O`; undo is CodeMirror's own history.
- Folder mode: `Space`, `Delete`, `Enter`, `Ctrl+Enter`, `Ctrl+Shift+→`, `Ctrl+Shift+←`.

**Persistence and accessibility**
- Settings persist in localStorage under `devtools-diff-merge-settings`, read and written inside try/catch. Pasted texts are never persisted.
- Every icon button has an `aria-label` and a `title` naming its shortcut.
- Arrow tooltips read exactly `"Apply left to right (change {n})"` and `"Apply right to left (change {n})"`.

## Review Focus

1. **Very large or minified input** (50k lines, or one 2 MB line). The UI must stay responsive. The diff falls back to imprecise mode (`scanLimit: 500`, `timeout: 1000`) and shows a notice: `"Diff is approximate for very large input"`. Tested in Task 2.
2. **CRLF vs LF.** The same content with different line endings shows 0 differences. The status bar shows the original EOL (`LF` / `CRLF`), and Copy/Save write that EOL back. Tested in Task 2.
3. **Missing trailing newline / empty side.** Applying a change at the end of either document must not drop or duplicate the final newline. Pushing into an empty document works. Tested in Task 3.
4. **Binary or non-UTF-8 file opened or dropped.** Refuse with the toast `"This file is not UTF-8 text."`. Never load garbage into the editor. Tested in Task 6.
5. **Folder paths that escape their root** (`../x`, an absolute path, a symlink pointing outside). Rejected before any read, write or delete. Tested in Task 15.

---

## File Structure

```
src/utils/diff-merge/
  blocks.ts      DiffBlock types, computeBlocks, blockStats, splitEol/joinEol
  ignore.ts      diffIgnoring (ignore-whitespace / ignore-case diff override)
  apply.ts       blockReplacement (replace / append change spec)
  inline.ts      inlineRanges per highlight mode
  geometry.ts    ribbonPath, mapLine (sync scroll), collapsedRuns, mapTicks
  unified.ts     buildUnifiedDoc
  language.ts    languageForFile, detectLanguageName, isProbablyBinary
  settings.ts    DiffSettings, DEFAULT_SETTINGS, loadSettings, saveSettings
  patch.ts       buildPatch
  folder.ts      folder pairing, classification, grouping, filters, plan/summary strings
src/components/tools/DiffMerge.tsx            root: Text | Folders switch (registry entry)
src/components/tools/diff-merge/
  diff-merge.css           tokens + CodeMirror theme classes
  editor.ts                CM extensions: setDiff effect, diff StateField, decorations, fold widgets, compartments, highlight style
  useDiffEditors.ts        creates/destroys both EditorViews, recomputes blocks, sync scroll
  DiffPanes.tsx            pane headers + editors + Gutter + ChangeMap (shared by Text and Folder modes)
  PaneHeader.tsx           file name, language badge, line count, Open/Paste/Clear/Copy
  Gutter.tsx               SVG ribbons + >> / << buttons
  ChangeMap.tsx            14px change strip
  UnifiedPane.tsx          read-only unified editor with old/new numbers and Keep chips
  TextToolbar.tsx          nav, Swap, Viewer/Ignore/Highlight selects, toggles, gear, help, counter
  Panels.tsx               AnchoredPanel + SettingsPanel + ShortcutsPanel
  StatusBar.tsx
  TextDiffView.tsx         Text mode screen
  folder/FolderView.tsx    Folders mode screen
  folder/FolderToolbar.tsx
  folder/FolderTable.tsx
  folder/ActionMenu.tsx
  folder/MergeDialog.tsx
src/lib/desktop.ts                 + folder bridge functions
src-tauri/src/folder_compare.rs    path-confined fs helpers + commands
src-tauri/src/main.rs              register commands
tests/tools/diff-merge-*.test.ts(x)
```

---

# Wave 1: Foundations

### Task 1: Register the tool and install CodeMirror

**Files:**
- Modify: `package.json` (via `npm i`)
- Modify: `src/app/toolRegistry.ts` (`ALL_TOOLS` next to the `text-compare` entry at about line 104, and `TOOL_COMPONENTS` at about line 200)
- Modify: `src/app/DevToolsApp.tsx:70` (add `"diff-merge"` to `WORKSPACE_TOOL_IDS`)
- Create: `src/components/tools/DiffMerge.tsx`
- Modify: `tests/tools/tool-registration.test.ts`, `tests/tools/tool-search-keywords.test.ts:15`

**Interfaces:**
- Produces: `export function DiffMerge(): JSX.Element` in `src/components/tools/DiffMerge.tsx`. For now it is a placeholder: a root `div.json-workspace` with `data-testid="diff-merge"`.

- [x] **Step 1: Write the failing tests.**
  - Add `"diff-merge"` to the `it.each` list in `tool-registration.test.ts`.
  - The name `"Diff & Merge"` starts with "diff", so it scores 692, above Text Compare's exact keyword at 650. In `tool-search-keywords.test.ts`, replace line 15 with:

```ts
expect(ids("diff")[0]).toBe("diff-merge");
expect(ids("diff")).toContain("text-compare");
```

- [x] **Step 2: Run the tests and confirm they fail.**
  - Run `npx vitest run tests/tools/tool-registration.test.ts tests/tools/tool-search-keywords.test.ts`.
  - Expected: FAIL. `TOOL_COMPONENTS["diff-merge"]` is undefined.
- [x] **Step 3: Install the CodeMirror packages:** `npm i @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/search @codemirror/merge @codemirror/language-data @lezer/highlight`.
- [x] **Step 4: Register the tool.**
  - Add the `ALL_TOOLS` entry from Global Constraints, importing `GitMerge` from `lucide-react`.
  - Add `"diff-merge": lazyNamed(() => import("@/components/tools/DiffMerge"), "DiffMerge")`.
  - Add the id to `WORKSPACE_TOOL_IDS`.
  - Create the placeholder component.
- [x] **Step 5: Run the tests and confirm they pass.** Run `npx vitest run tests/tools && npm run typecheck`. Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "feat(diff-merge): register Diff & Merge tool and add CodeMirror deps"`

### Task 2: Block model, ignore modes and EOL handling

**Files:**
- Create: `src/utils/diff-merge/blocks.ts`, `src/utils/diff-merge/ignore.ts`
- Test: `tests/tools/diff-merge-blocks.test.ts`

**Interfaces:**
- Produces, in `blocks.ts`:

```ts
export type BlockKind = "added" | "removed" | "modified";
export interface LineRange { from: number; to: number }            // 0-based line indexes, `to` exclusive
export interface InnerChange { fromA: number; toA: number; fromB: number; toB: number } // relative to block start (CM Change semantics)
export interface DiffBlock {
  index: number; kind: BlockKind;
  fromA: number; toA: number; fromB: number; toB: number;          // char offsets, same meaning as @codemirror/merge Chunk
  linesA: LineRange; linesB: LineRange;
  changes: readonly InnerChange[];
  precise: boolean;
}
export type IgnoreMode = "none" | "trim" | "whitespace" | "whitespace-lines";
export interface DiffOptions { ignore: IgnoreMode; ignoreCase: boolean }
export const DIFF_CONFIG = { scanLimit: 500, timeout: 1000 } as const;
export function computeBlocks(a: string, b: string, opts: DiffOptions): DiffBlock[];
export function blockStats(blocks: readonly DiffBlock[]): { added: number; removed: number; modified: number };
export type Eol = "LF" | "CRLF";
export function splitEol(raw: string): { text: string; eol: Eol };   // CRLF if the first line break is \r\n; text normalised to \n
export function joinEol(text: string, eol: Eol): string;
```

- Produces, in `ignore.ts`: `export function diffIgnoring(a: string, b: string, opts: DiffOptions): Change[]`, where `Change` comes from `@codemirror/merge`.

- [x] **Step 1: Write the failing tests.**

```ts
const none = { ignore: "none", ignoreCase: false } as const;
it("classifies blocks", () => {
  const bl = computeBlocks("a\nb\nc\n", "a\nB\nc\nd\n", none);
  expect(bl.map((x) => x.kind)).toEqual(["modified", "added"]);
  expect(bl[0].linesA).toEqual({ from: 1, to: 2 });
  expect(bl[1].linesA).toEqual({ from: 3, to: 3 });
  expect(bl[1].linesB).toEqual({ from: 3, to: 4 });
  expect(blockStats(bl)).toEqual({ added: 1, removed: 0, modified: 1 });
});
it("identical texts give no blocks", () => expect(computeBlocks("x\n", "x\n", none)).toEqual([]));
it("ignores whitespace-only changes", () => {
  expect(computeBlocks("  if x:\n", "if  x:\n", { ignore: "whitespace", ignoreCase: false })).toEqual([]);
  expect(computeBlocks("x  \n", "x\n", { ignore: "trim", ignoreCase: false })).toEqual([]);
  expect(computeBlocks("x\n  if y:\n", "x\n if y :\n", { ignore: "trim", ignoreCase: false })).toHaveLength(1);
});
it("ignores blank lines", () =>
  expect(computeBlocks("a\n\n\nb\n", "a\nb\n", { ignore: "whitespace-lines", ignoreCase: false })).toEqual([]));
it("ignores case", () => expect(computeBlocks("Foo\n", "foo\n", { ignore: "none", ignoreCase: true })).toEqual([]));
it("CRLF and LF compare equal after splitEol", () => {
  const a = splitEol("x\r\ny\r\n"), b = splitEol("x\ny\n");
  expect(a).toEqual({ text: "x\ny\n", eol: "CRLF" });
  expect(computeBlocks(a.text, b.text, none)).toEqual([]);
  expect(joinEol(a.text, "CRLF")).toBe("x\r\ny\r\n");
});
it("stays fast on huge input", () => {
  const big = Array.from({ length: 50_000 }, (_, i) => `line ${i * 7919 % 10007}`).join("\n");
  const t = performance.now();
  computeBlocks(big, big.replace(/7/g, "8"), none);
  expect(performance.now() - t).toBeLessThan(3000);
});
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-blocks.test.ts`. Expected: FAIL (module not found).
- [x] **Step 3: Implement `computeBlocks`.**
  - Call `Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), conf)`.
    - `conf` is `DIFF_CONFIG` when `opts.ignore === "none" && !opts.ignoreCase`.
    - Otherwise `conf` is `{ ...DIFF_CONFIG, override: (x, y) => diffIgnoring(x, y, opts) }`.
  - Map each Chunk to a `DiffBlock`:
    - Line ranges come from `doc.lineAt(...)`. `to` is exclusive; when `fromA === toA` (empty side), use an empty range at that line.
    - `kind` is `added` when `linesA` is empty, `removed` when `linesB` is empty, and `modified` otherwise.
- [x] **Step 4: Implement `diffIgnoring`.** This algorithm isn't determined by the tests, so here it is in full:
  1. Split both texts into lines. Normalise each line:
     - `trim`: `line.trim()`
     - `whitespace` and `whitespace-lines`: `line.replace(/\s+/g, "")`
     - then `.toLowerCase()` if `ignoreCase`
  2. For `whitespace-lines`, drop lines whose normalised key is `""` and keep a map from the kept index to the original line index.
  3. Give each distinct key one UTF-16 code unit (`0x100 + id`, skipping `0xD800–0xDFFF`). Encode each side as a string of those code units.
     - If there are more than 60,000 distinct keys, fall back to `diff(a, b, DIFF_CONFIG)`. Mark this with `// ponytail: line-key encoding caps at ~60k distinct lines; fallback is plain diff`.
  4. Run `diff(encA, encB, DIFF_CONFIG)`. Each change is a range of line indexes; map it back to raw char offsets (start of the first line to end of the last line plus its `\n`).
  5. For each change that has text on both sides, run `diff(rawSliceA, rawSliceB)` and offset the results, so word marks are still produced. Otherwise emit the whole span.
- [x] **Step 5: Implement `blockStats`, `splitEol` and `joinEol`.**
- [x] **Step 6: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): block model with ignore modes and EOL handling"`

### Task 3: Apply, inline ranges, geometry, unified doc, patch, settings

**Files:**
- Create: `src/utils/diff-merge/apply.ts`, `inline.ts`, `geometry.ts`, `unified.ts`, `patch.ts`, `settings.ts`
- Test: `tests/tools/diff-merge-logic.test.ts`

**Interfaces:**
- Consumes: `DiffBlock`, `computeBlocks`, `LineRange` (Task 2), and `getUnifiedDiff` (`src/utils/text-compare.ts:316`).
- Produces:

```ts
// apply.ts
export type Direction = "toRight" | "toLeft";
export function blockReplacement(block: DiffBlock, a: string, b: string, dir: Direction, mode: "replace" | "append"):
  { from: number; to: number; insert: string };   // change spec in the DESTINATION doc (b for toRight, a for toLeft)
// inline.ts
export type HighlightMode = "words" | "lines" | "chars" | "none";
export function inlineRanges(block: DiffBlock, mode: HighlightMode): { a: [number, number][]; b: [number, number][] }; // absolute offsets
// geometry.ts
export const GUTTER_WIDTH = 64;
export function ribbonPath(a1: number, a2: number, b1: number, b2: number, width?: number): string;
export function mapLine(blocks: readonly DiffBlock[], line: number, from: "a" | "b"): number; // fractional line on the other side
export interface CollapsedRun { a: LineRange; b: LineRange; hidden: number }
export function collapsedRuns(blocks: readonly DiffBlock[], linesA: number, linesB: number, context: number, expanded: ReadonlySet<number>): CollapsedRun[]; // `expanded` holds a.from of runs the user opened
export function mapTicks(blocks: readonly DiffBlock[], linesB: number): { top: number; height: number; kind: BlockKind; index: number }[]; // percentages
// unified.ts
export interface UnifiedRow { old: number | null; new: number | null; mark: "+" | "−" | ""; kind: BlockKind | null; block: number | null; first: boolean; fold: CollapsedRun | null }
export function buildUnifiedDoc(a: string, b: string, blocks: readonly DiffBlock[], highlight: HighlightMode, runs: readonly CollapsedRun[]):
  { text: string; rows: UnifiedRow[]; marks: [number, number, "add" | "del"][] };
// patch.ts
export function buildPatch(a: string, b: string, nameA: string, nameB: string, context?: number): string; // "" when identical
// settings.ts
export interface DiffSettings { viewer: "side" | "unified"; ignore: IgnoreMode; highlight: HighlightMode; collapse: boolean; syncScroll: boolean;
  contextLines: number; wrap: boolean; showWhitespace: boolean; ignoreCase: boolean; detectLanguage: boolean }
export const DEFAULT_SETTINGS: DiffSettings; // side, none, words, false, true, 3, false, false, false, true
export const SETTINGS_KEY = "devtools-diff-merge-settings";
export function loadSettings(storage?: Storage): DiffSettings;  // merges over defaults, rejects bad enums, clamps contextLines to 0..20
export function saveSettings(s: DiffSettings, storage?: Storage): void;
```

- [x] **Step 1: Write the failing tests.** Use `none` from Task 2. Helpers:
  - `apply(a, b, dir, mode, i = 0)` computes the blocks, calls `blockReplacement`, and returns the patched destination string.
  - `blk(a, b)` returns `computeBlocks(a, b, none)`.

```ts
it("replace left→right makes the block equal", () =>
  expect(apply("a\nX\nc\n", "a\nY\nc\n", "toRight", "replace")).toBe("a\nX\nc\n"));
it("replace right→left", () => expect(apply("a\nX\nc\n", "a\nY\nc\n", "toLeft", "replace")).toBe("a\nY\nc\n"));
it("append keeps the target and adds the source after it", () =>
  expect(apply("a\nX\nc\n", "a\nY\nc\n", "toRight", "append")).toBe("a\nY\nX\nc\n"));
it("pushes a deletion", () => expect(apply("a\nb\n", "a\n", "toRight", "replace")).toBe("a\nb\n"));
it("handles a last line without trailing newline", () => {
  expect(apply("a\nb", "a\nc", "toRight", "replace")).toBe("a\nb");
  expect(apply("a\nb\nc", "a\nc", "toLeft", "replace")).toBe("a\nc");
});
it("pushes into an empty doc", () => expect(apply("x\n", "", "toRight", "replace")).toBe("x\n"));
it("word mode expands to whole words", () => {
  const [bl] = blk("read_csv(p)\n", "read_ods(p)\n");
  expect(inlineRanges(bl, "words")).toEqual({ a: [[0, 8]], b: [[0, 8]] });
  expect(inlineRanges(bl, "lines")).toEqual({ a: [], b: [] });
});
it("ribbon path matches the design formula", () =>
  expect(ribbonPath(6, 28, 50, 116)).toBe("M0 6 C32 6 32 50 64 50 L64 116 C32 116 32 28 0 28 Z"));
it("maps lines across a block", () => {
  const bl = blk("a\nb\nc\nd\n", "a\nX\nY\nZ\nW\nd\n");
  expect(mapLine(bl, 0, "a")).toBe(0);
  expect(mapLine(bl, 3, "a")).toBe(5);
  expect(mapLine(bl, 2, "a")).toBeCloseTo(3); // proportional inside the block
});
it("collapses runs longer than 2×context+1", () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
  const runs = collapsedRuns(blk(a, a.replace("l19", "x")), 20, 20, 3, new Set());
  expect(runs).toEqual([{ a: { from: 3, to: 16 }, b: { from: 3, to: 16 }, hidden: 13 }]);
  expect(collapsedRuns(blk(a, a.replace("l19", "x")), 20, 20, 3, new Set([3]))).toEqual([]);
});
it("unified doc lists removed lines before added ones", () => {
  const { text, rows } = buildUnifiedDoc("a\nb\n", "a\nc\n", blk("a\nb\n", "a\nc\n"), "none", []);
  expect(text).toBe("a\nb\nc\n");
  expect(rows.map((r) => r.mark)).toEqual(["", "−", "+", ""]);
  expect(rows[1]).toMatchObject({ old: 2, new: null, first: true, block: 0 });
});
it("patch uses file names", () => {
  expect(buildPatch("a\n", "b\n", "x.py", "y.py").split("\n").slice(0, 2)).toEqual(["--- a/x.py", "+++ b/y.py"]);
  expect(buildPatch("a\n", "a\n", "x", "y")).toBe("");
});
it("settings round-trip and reject garbage", () => {
  const s = new Map<string, string>(); const st = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => s.set(k, v) } as Storage;
  saveSettings({ ...DEFAULT_SETTINGS, wrap: true }, st);
  expect(loadSettings(st).wrap).toBe(true);
  s.set(SETTINGS_KEY, '{"ignore":"bogus","contextLines":99}');
  expect(loadSettings(st)).toMatchObject({ ignore: "none", contextLines: 20 });
  s.set(SETTINGS_KEY, "not json");
  expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
});
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-logic.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement `blockReplacement`.**
  - **`replace`** mirrors `@codemirror/merge`'s `revertClicked`: take the source slice `[srcFrom, max(srcFrom, srcTo − 1))`, add `"\n"` if the source is non-empty and `destTo <= dest.length`, and replace `[destFrom, min(dest.length, destTo)]`.
  - **`append`** inserts the source block's lines at `destTo`, or at the end of the destination line when `destTo > dest.length`. Prefix a `"\n"` when the destination doesn't end with one.
- [x] **Step 4: Implement `inlineRanges`.**
  - `chars`: the raw inner changes, made absolute.
  - `words`: expand each range to `/[\p{L}\p{N}_]/u` word boundaries, merge overlapping or touching ranges, and fill whitespace-only gaps between two changed ranges (as the design's `wdiff` fill does).
  - `lines` and `none`: return empty arrays.
- [x] **Step 5: Implement the geometry, unified and patch functions.**
  - `ribbonPath` is the design's curved formula, copied exactly: `M0 a1 C c a1 c b1 W b1 L W b2 C c b2 c a2 0 a2 Z` with `c = W/2`.
  - `collapsedRuns` walks the unchanged stretches between blocks, including the leading and trailing ones. For each stretch of `n > 2·context + 1` lines, it hides `[start + context, end − context)` unless `expanded` has `a.from`.
  - `mapTicks`: `top = linesB.from / linesB_total · 100`, `height = max(lineCount, 0.4) / total · 100`.
  - `buildUnifiedDoc`:
    - Emits unchanged lines, then for each block its `A` lines (`−`) followed by its `B` lines (`+`). Every collapsed run becomes a single fold row whose text line is empty.
    - `marks` come from `inlineRanges`, remapped to unified offsets.
  - `buildPatch`: replace the first two lines of `getUnifiedDiff(a, b, context)` (`--- original` / `+++ modified`) with `--- a/${nameA}` / `+++ b/${nameB}`, join with `"\n"`, and add a trailing `"\n"`. Return `""` when there are no `@@` hunks.
- [x] **Step 6: Implement `settings.ts`.** Wrap all storage access in try/catch, following the pattern in `ToolWorkspace.tsx:30`.
- [x] **Step 7: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 8: Commit.** `git commit -m "feat(diff-merge): apply, inline ranges, geometry, unified doc, patch, settings"`

Deviations:
- `DiffBlock` (Task 2) gained `textA` / `textB` (the block's own slice of each side). `inlineRanges(block, mode)` needs the text to expand to word boundaries, and the plan's two-argument signature gives it none.
- `buildPatch` strips one shared trailing `\n` before calling `getUnifiedDiff`. Otherwise its split adds a phantom empty context line that `patch(1)` rejects.
- `buildUnifiedDoc` only emits word marks for `modified` blocks; whole-line added/removed blocks get none.

### Task 4: Language detection and binary guard

**Files:**
- Create: `src/utils/diff-merge/language.ts`
- Test: `tests/tools/diff-merge-language.test.ts`

**Interfaces:**
- Produces:
  - `languageForFile(name: string): LanguageDescription | null`, which uses `LanguageDescription.matchFilename(languages, name)` from `@codemirror/language-data`.
  - `detectLanguageName(text: string): string | null`, which returns a `languages[].name`.
  - `languageLabel(name: string | null): string`, which falls back to `"Plain text"`.
  - `isProbablyBinary(bytes: Uint8Array): boolean`.

- [x] **Step 1: Write the failing tests.**

```ts
expect(languageForFile("check_invoices.py")?.name).toBe("Python");
expect(languageForFile("notes")).toBeNull();
expect(detectLanguageName('{"a": 1}')).toBe("JSON");
expect(detectLanguageName("#!/usr/bin/env bash\necho")).toBe("Shell");
expect(detectLanguageName("<?php echo 1;")).toBe("PHP");
expect(detectLanguageName("import pandas as pd\ndef f():\n  pass")).toBe("Python");
expect(detectLanguageName("package main\nfunc main() {}")).toBe("Go");
expect(detectLanguageName("hello world")).toBeNull();
expect(languageLabel(null)).toBe("Plain text");
expect(isProbablyBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
expect(isProbablyBinary(new TextEncoder().encode("plain ü text"))).toBe(false);
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-language.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - `detectLanguageName` checks rules in order, first match wins:
    1. A shebang containing `sh|bash|zsh` → `"Shell"`, or containing `python` → `"Python"`.
    2. `<?php` → `"PHP"`.
    3. `JSON.parse` succeeds on trimmed text starting with `{` or `[` → `"JSON"`.
    4. `^<\?xml` → `"XML"`.
    5. `^\s*<(!doctype html|html)` (case-insensitive) → `"HTML"`.
    6. `^package \w+` together with `func ` → `"Go"`.
    7. A line matching `^(def |import |from \S+ import )` → `"Python"`.
    8. Otherwise `null`.
  - `isProbablyBinary` returns true if the first 8,000 bytes contain `0x00`.
- [x] **Step 4: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "feat(diff-merge): language detection and binary guard"`

---

# Wave 2: Side-by-side viewer

### Task 5: Editor extensions and the two-editor hook

**Files:**
- Create: `src/components/tools/diff-merge/editor.ts`, `useDiffEditors.ts`, `diff-merge.css`
- Modify: `tests/setup.ts`. CodeMirror needs these in jsdom: if missing, define `Range.prototype.getClientRects` (returns an empty list), `Range.prototype.getBoundingClientRect` (returns `new DOMRect()`) and `globalThis.ResizeObserver` (a no-op class).
- Test: `tests/tools/diff-merge-editors.test.tsx`

**Interfaces:**
- Consumes: Task 2 and Task 3 functions.
- Produces, in `editor.ts`:

```ts
export interface DiffDecoState { side: "a" | "b"; blocks: readonly DiffBlock[]; current: number; highlight: HighlightMode; runs: readonly CollapsedRun[] }
export const setDiff: StateEffectType<DiffDecoState>;
export const diffState: StateField<DiffDecoState>;
export const languageConf: Compartment; export const wrapConf: Compartment; export const whitespaceConf: Compartment;
export function paneExtensions(side: "a" | "b", placeholderText: string): Extension;
```

- `paneExtensions` bundles:
  - From CodeMirror: `lineNumbers`, `history`, `drawSelection`, `highlightActiveLine`, `bracketMatching`, `highlightSelectionMatches`, `keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])`, `placeholder(placeholderText)`.
  - `syntaxHighlighting(dmHighlightStyle)`.
  - The three compartments.
  - `diffState` and the decorations derived from it:
    - Line classes `dm-line dm-add|dm-del|dm-mod`, plus `dm-cur` on the current block.
    - Mark class `dm-word` for inline ranges.
    - A 2px `dm-gap` block widget where one side is empty.
    - Block-replace fold widgets for `runs`. The widget renders the design's fold bar (`"{n} unchanged lines"`, `"Click to expand"`) and dispatches `new CustomEvent("dm-expand", { bubbles: true, detail: run.a.from })` on click.
- Produces, in `useDiffEditors.ts`:

```ts
export interface DiffEditors { a: EditorView | null; b: EditorView | null; blocks: readonly DiffBlock[]; precise: boolean; focused: "a" | "b"; cursor: { line: number; col: number } }
export function useDiffEditors(hostA: RefObject<HTMLDivElement>, hostB: RefObject<HTMLDivElement>,
  opts: { settings: DiffSettings; current: number; expanded: ReadonlySet<number>; initialA?: string; initialB?: string }): DiffEditors;
```

- [x] **Step 1: Write the failing test.** A `Harness` component renders two host divs and the hook, and exposes the result through a callback ref.

```tsx
it("computes blocks and decorates both editors", async () => {
  const { container } = render(<Harness a={"a\nb\n"} b={"a\nc\n"} />);
  await waitFor(() => expect(latest().blocks).toHaveLength(1));
  expect(container.querySelectorAll(".dm-mod")).toHaveLength(2);
});
it("recomputes after an edit", async () => {
  render(<Harness a={"a\n"} b={"a\n"} />);
  await waitFor(() => expect(latest().a).not.toBeNull());
  act(() => latest().b!.dispatch({ changes: { from: 0, insert: "z" } }));
  await waitFor(() => expect(latest().blocks).toHaveLength(1));
});
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-editors.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement `editor.ts`.**
  - `dmHighlightStyle` maps tags to the design's syntax tokens:
    - `keyword` → `var(--dm-s-kw)`
    - `string` → `--dm-s-str`
    - `number` → `--dm-s-num`
    - `bool`, `null`, `atom`, `standard(variableName)` → `--dm-s-lit`
    - `function(definition(variableName))` → `--dm-s-fn`
    - `comment` → `hsl(var(--muted-foreground))`
  - Decorations are rebuilt only when `setDiff` arrives.
- [x] **Step 4: Implement `useDiffEditors`.**
  - Create both views in a `useEffect` and destroy them on unmount.
  - An `updateListener` on doc change schedules one `requestAnimationFrame` that:
    - recomputes `computeBlocks(a, b, { ignore, ignoreCase })` and `collapsedRuns(...)` (when `settings.collapse`);
    - dispatches `setDiff` to both views;
    - sets React state.
  - Reconfigure the compartments when `settings.wrap` or `settings.showWhitespace` change (`EditorView.lineWrapping`, `highlightWhitespace()`).
  - Track the focused side and the cursor line and column for the status bar.
- [x] **Step 5: Write `diff-merge.css`.**
  - Define the `--dm-*` tokens on `.dm-root` and `.dark .dm-root`, using the values in Global Constraints.
  - Style:
    - `.cm-editor`: font `13px/22px var(--font-code)`; `.cm-content` padding-top `6px`.
    - `.cm-gutters`: transparent, no border. `.cm-lineNumbers .cm-gutterElement`: `width 44px`, `font-size 12px`, `padding-right 12px`, `hsl(var(--muted-foreground))`.
    - Change lines: `.dm-add`, `.dm-del` and `.dm-mod` backgrounds use `hsl(var(--success|--destructive|--warning) / var(--dm-a-line))`.
    - `.dm-cur`: background alpha `--dm-a-cur`, plus `box-shadow: inset 0 0 0 1px hsl(var(--ring))` on the block's first and last line. Use `dm-cur-first` / `dm-cur-last` classes so the ring outlines the whole block.
    - `.dm-word`: alpha `--dm-a-word`.
    - `.dm-gap`: `2px solid hsl(var(--kind))`.
    - The fold bar, using the design's `foldH` styles.
  - Import the file from `DiffPanes.tsx` so it lands in the lazy chunk.
- [x] **Step 6: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): CodeMirror pane extensions and two-editor hook"`

Deviations:
- `useDiffEditors` runs `computeBlocks` only on doc edits (rAF-coalesced) or when `ignore` / `ignoreCase` change. A change of `current`, `highlight`, `collapse`, `contextLines` or `expanded` only re-dispatches `setDiff` from the cached blocks, so navigating does not re-diff a large file.
- `diffState` stays a plain `StateField<DiffDecoState>`; the `DecorationSet` lives in a second, unexported field (mapped across edits until the next `setDiff`). Exported extras: `EXPAND_EVENT`, `dmHighlightStyle`, `getDiffState`.
- Decoration rules: the gap widget is a block widget classed `dm-gap dm-gap-added|removed|modified`; word marks are emitted only for `modified` blocks (as in the unified doc).

### Task 6: DiffPanes: headers, gutter ribbons, change map, sync scroll, files

**Files:**
- Create: `DiffPanes.tsx`, `PaneHeader.tsx`, `Gutter.tsx`, `ChangeMap.tsx` (in `src/components/tools/diff-merge/`)
- Test: `tests/tools/diff-merge-panes.test.tsx`

**Interfaces:**
- Consumes: `useDiffEditors` and `DiffEditors` (Task 5); `ribbonPath`, `mapLine`, `mapTicks`, `GUTTER_WIDTH` (Task 3); `languageForFile`, `detectLanguageName`, `languageLabel`, `isProbablyBinary` (Task 4); `splitEol`, `joinEol` (Task 2); `CopyButton` (`src/components/tools/CopyButton.tsx`); `Select` (`src/components/ui/select.tsx`).
- Produces:

```ts
export interface PaneDoc { name: string; text: string; eol: Eol; language: string | null }  // language = LanguageDescription name
export interface DiffPanesHandle { editors: DiffEditors; apply(index: number, dir: Direction, mode: "replace" | "append"): void;
  goTo(index: number): void; setDocs(a: PaneDoc, b: PaneDoc): void; getDocs(): [PaneDoc, PaneDoc] }
export const DiffPanes: ForwardRefExoticComponent<{ settings: DiffSettings; current: number; onCurrentChange(i: number): void;
  onApplied(index: number): void; onStateChange(e: DiffEditors): void; headerHeight?: 38 | 36; showHeaders?: boolean;
  initial?: [PaneDoc, PaneDoc] } & RefAttributes<DiffPanesHandle>>;
```

- [x] **Step 1: Write the failing tests.**

```tsx
it("renders arrows per change and applies left→right", async () => {
  const ref = createRef<DiffPanesHandle>();
  render(<DiffPanes ref={ref} settings={DEFAULT_SETTINGS} current={0} onCurrentChange={() => {}} onApplied={() => {}} onStateChange={() => {}}
    initial={[doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]} />);
  const btn = await screen.findByRole("button", { name: "Apply left to right (change 1)" });
  expect(screen.getByRole("button", { name: "Apply right to left (change 1)" })).toBeInTheDocument();
  fireEvent.click(btn);
  await waitFor(() => expect(ref.current!.getDocs()[1].text).toBe("a\nb\n"));
});
it("ctrl-click appends", async () => {
  /* same setup */ fireEvent.click(btn, { ctrlKey: true });
  await waitFor(() => expect(ref.current!.getDocs()[1].text).toBe("a\nc\nb\n"));
});
it("rejects a binary file", async () => {
  /* render with empty docs */
  const input = screen.getByLabelText("Open file into Original") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 0, 2])], "x.bin")] } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This file is not UTF-8 text."));
});
it("shows line counts and language from the file name", async () => {
  expect(await screen.findByText("2 lines")).toBeInTheDocument();
  expect(screen.getAllByText("Python")[0]).toBeInTheDocument();
});
```

  Mock `sonner` with `vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }))`.

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-panes.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement `PaneHeader`.** It follows the design (`Diff Merge Tool.dc.html:125-146`):
  - **Name:** click to edit through an inline `<input>`; Enter or blur commits. With no file, the name shows `"Original"` / `"Modified"`.
  - **Language badge:** a Select listing `"Plain text"` plus `languages.map(l => l.name)`.
  - **Line count:** `"{n} lines"`.
  - **Text buttons `Open`, `Paste`, `Clear`, `Copy`:**
    - **Open** uses a hidden `<input type=file aria-label="Open file into Original|Modified">`. Read the bytes with `file.arrayBuffer()`. If `isProbablyBinary`, or `new TextDecoder("utf-8", { fatal: true })` throws, show `toast.error("This file is not UTF-8 text.")`. Otherwise pass the text through `splitEol`, set the name and set the language with `languageForFile`.
    - **Paste** reads `navigator.clipboard.readText()`.
    - **Copy** uses `CopyButton` with `joinEol(text, eol)`.
  - **Focus:** the focused pane draws the `2px hsl(var(--ring))` underline.
  - **Drag and drop:** dropping a file on a pane loads it the same way. Use the inline handler pattern from `HarViewer.tsx:460-472`.
  - **Language selection:**
    1. A file-name match wins.
    2. Otherwise, if `settings.detectLanguage`, use `detectLanguageName` (debounced 300 ms).
    3. Load the language with `LanguageDescription.load()` and reconfigure `languageConf`.
- [x] **Step 4: Implement `Gutter`.**
  - It is a 64px column with an absolute `<svg>`, re-rendered on both editors' `scroll` events (throttled with rAF) and on geometry changes.
  - For each block, find the y range on each side: `view.lineBlockAt(doc.line(from + 1).from).top + view.documentPadding.top − view.scrollDOM.scrollTop`. An empty side becomes a zero-height range at the boundary.
  - Draw `ribbonPath`:
    - Fill `hsl(var(--kind) / var(--dm-a-rib))`.
    - On the current block, fill with `--dm-a-cur` and add a `hsl(var(--ring))` stroke.
    - Collapsed runs draw the muted ribbon from the design.
  - Buttons: `>>` at `left:3`, `<<` at `left:43`, `top = y + 2`, or `y − 9` when that side is empty.
    - Styling follows the design: the current block's arrows are chips (`--dm-raised` with a border shadow); the others are transparent with `fg / .7`.
    - `onClick(e)` calls `apply(i, dir, e.ctrlKey || e.metaKey ? "append" : "replace")`.
  - Render only blocks whose range intersects the visible height.
- [x] **Step 5: Implement `apply`.**
  - Dispatch `blockReplacement(...)` to the destination view with `userEvent: "input.merge"`, so it is undoable with Ctrl+Z.
  - Then focus the destination view and call `onApplied(index)`.
  - When blocks are recomputed, the parent clamps `current`.
- [x] **Step 6: Implement `ChangeMap`.**
  - A 14px strip with a thumb: `top = scrollTop/scrollHeight`, `height = clientHeight/scrollHeight` of B.
  - Ticks come from `mapTicks`, use the design's `mapEl` styles, and the current tick gets a `0 0 0 2px hsl(var(--ring))` ring.
  - Clicking a tick calls `goTo(index)`. Clicking elsewhere scrolls B proportionally.
  - `title="Change map"`.
- [x] **Step 7: Implement sync scroll.** When `settings.syncScroll` is on and the source pane scrolls:
  1. Find the top line and its fraction: `view.lineBlockAtHeight(scrollTop − documentPadding.top)`.
  2. Map it to the other side with `mapLine(blocks, line + frac, side)`.
  3. Set the other pane's `scrollTop` to the mapped line's top.
  4. Use a `syncing` flag, cleared on the next frame, so the panes don't ping-pong.
- [x] **Step 8: Implement `goTo(i)`.**
  - Put the B cursor at the block start.
  - Scroll both editors with `EditorView.scrollIntoView(pos, { y: "center" })`, applying the sync rule.
  - Call `onCurrentChange(i)`.
- [x] **Step 9: Lay out `DiffPanes`.**
  - Grid `minmax(0,1fr) 64px minmax(0,1fr) 14px`, rows `{headerHeight}px minmax(0,1fr)`.
  - Borders follow the design: the gutter has `1px hsl(var(--border) / .6)` on left and right; the map has a left border `/ .5` and background `hsl(var(--muted) / .3)`.
  - **Empty overlay:** when a doc is empty, show the empty-state overlay (`pointer-events:none`) using the exact copy from Global Constraints.
- [x] **Step 10: Run and confirm the tests pass.** Run `npx vitest run tests/tools/diff-merge-panes.test.tsx`. Expected: PASS.
- [x] **Step 11: Commit.** `git commit -m "feat(diff-merge): side-by-side panes with ribbons, merge arrows, change map, sync scroll"`

Deviations:
- `DiffPanes` owns the expanded-fold set (listens for `dm-expand` on its root) because `DiffPanesProps` carries no `expanded`; it resets on Open, Clear, Paste, `setDocs`.
- `apply` refuses to run when the block text no longer matches the editors (blocks lag an edit by one frame). A stale arrow click is a no-op, never a wrong merge.
- Change-map ticks are `<button aria-label="Go to change n">` rather than bare divs, for keyboard and screen-reader access. Header Copy is named `Copy Original|Modified`.
- Open and Paste tidy up: with an empty side the header shows only Open and Paste, with no line count (design state 1a). Lines are counted without the phantom last line (`"a\nb\n"` is `2 lines`).
- Extra: `useGeometryTick.ts` (rAF-throttled scroll and resize tick shared by Gutter and ChangeMap). With no layout (jsdom, `clientHeight` 0) the gutter draws every block instead of none.
- Clipboard failure toast copy is not in the design: `"Could not read the clipboard. Press Ctrl+V in the editor instead."`

---

# Wave 3: Text mode screen

### Task 7: Toolbar, counter, navigation, status bar, keyboard

**Files:**
- Create: `TextToolbar.tsx`, `StatusBar.tsx`, `TextDiffView.tsx`
- Modify: `src/components/tools/DiffMerge.tsx` (render `TextDiffView`; add the mode switch, which is wired up in Task 17)
- Test: `tests/tools/diff-merge-component.test.tsx`

**Interfaces:**
- Consumes: `DiffPanes` and `DiffPanesHandle` (Task 6); `DiffSettings`, `loadSettings`, `saveSettings` (Task 3); `blockStats` (Task 2).
- Produces:
  - `TextDiffView({ initial?: [PaneDoc, PaneDoc] })`. Folder mode uses `initial` for "Open in Text view".
  - `counterText(n: number, cur: number, empty: boolean): string`, exported from `TextToolbar.tsx`.

- [x] **Step 1: Write the failing tests.**

```tsx
it("counts and navigates", async () => {
  render(<DiffMerge />);
  await typeInto("Original", "a\nb\nc\nd\n"); await typeInto("Modified", "a\nB\nc\nD\n");
  expect(await screen.findByText("1 of 2 differences")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByTestId("diff-merge"), { key: "F7" });
  expect(await screen.findByText("2 of 2 differences")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByTestId("diff-merge"), { key: "F7" });
  expect(await screen.findByText("1 of 2 differences")).toBeInTheDocument(); // wraps
});
it("empty and identical states", async () => {
  render(<DiffMerge />);
  expect(screen.getByText("Nothing to compare")).toBeInTheDocument();
  expect(screen.getByText("Ready")).toBeInTheDocument();
  await typeInto("Original", "x"); await typeInto("Modified", "x");
  expect(await screen.findByText("No differences")).toBeInTheDocument();
});
it("applies with Ctrl+Shift+→ and reports undo hint", async () => {
  /* two differences */ fireEvent.keyDown(root, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
  expect(await screen.findByText("Applied change 1 — Ctrl+Z to undo")).toBeInTheDocument();
  expect(await screen.findByText("1 of 1 difference")).toBeInTheDocument();
});
it("swaps sides", async () => { /* Ctrl+Shift+S → getDocs reversed via the Original header name */ });
it("status shows stats", async () => expect(await screen.findByText("1 modified")).toBeInTheDocument());
```

  `typeInto(label, text)` finds the editor by its header label and dispatches the text through `EditorView.findFromDOM`.

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-component.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement `TextToolbar`.** It follows `Diff Merge Tool.dc.html:91-121` exactly. Controls in order:
  1. The `Text | Folders` segmented switch. In the design it sits only in the folder toolbar; we also put it first here, because otherwise text mode has no way into Folders.
  2. Previous (`title "Previous difference (Shift+F7)"`) and Next (`"Next difference (F7)"`).
  3. `Swap`.
  4. `Viewer` Select: `Side-by-side`, `Unified`.
  5. `Ignore` Select: `Do not ignore`, `Trim whitespace`, `Ignore whitespace`, `Ignore whitespace and empty lines`.
  6. `Highlight` Select: `Words`, `Lines`, `Characters`, `None`.
  7. `Collapse unchanged` Switch and `Sync scroll` Switch. Sync scroll is disabled in Unified.
  8. Gear (`"Settings"`) and `?` (`"Keyboard shortcuts"`).
  9. The counter, with `aria-live="polite"`.
  - In the empty state the nav group has opacity `.6`.
  - Every change goes through `saveSettings`.
- [x] **Step 4: Implement `StatusBar`.** It follows `:216-227`, left to right:
  - `Ln {line}, Col {col}`
  - the language label
  - `"{a} added"` (success) · `"{d} removed"` (destructive) · `"{m} modified"` (warning)
  - the optional message with a check icon (cleared on the next edit)
  - right-aligned: `UTF-8 · {eol}`, where `eol` is the focused pane's EOL
  - shield-check icon + `Local processing`

  In the empty state it shows `Ready`.

  If any block is `!precise`, show the notice `"Diff is approximate for very large input"` as a `role="status"` bar under the toolbar.
- [x] **Step 5: Implement keyboard handling.** An `onKeyDown` on the root (`data-testid="diff-merge"`) handles:
  - `F7` and `Shift+F7`: next and previous, wrapping.
  - `Ctrl/Cmd+Shift+ArrowRight|ArrowLeft`: apply the current change.
  - `Ctrl/Cmd+Shift+S`: swap.
  - `Ctrl/Cmd+Shift+C`: toggle collapse.
  - `Ctrl/Cmd+O`: open a file into the focused pane.

  Call `preventDefault` for each.

  Swap exchanges the two `PaneDoc`s through `setDocs`.
- [x] **Step 6: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): text toolbar, navigation, status bar and shortcuts"`

Deviations:
- `counterText`'s `cur` is the 0-based index (the prototype shows `cur + 1`).
- The Text | Folders switch is built into `TextToolbar` but renders only when `onModeChange` is passed; `DiffMerge` passes none until Task 17. Gear and `?` buttons are present (they toggle `aria-expanded`); their panels arrive in Task 9.
- `DiffPanes` gained `onMetaChange` (the status bar needs the focused pane's language and EOL) and a handle method `openFile(side)` for Ctrl+O.
- Shortcuts use `onKeyDownCapture` on the root with `stopPropagation`: CodeMirror binds `Mod-Shift-Arrow` itself and would otherwise also fire.
- The "Applied change" message clears on the next recompute that did not come from the apply (a ref flag skips that one). A settings change that re-diffs also clears it.
- Narrow-window state (`narrow`, from a `ResizeObserver`, below 900px) is already wired here; the unified viewer it forces arrives in Task 8.

### Task 8: Unified viewer

**Files:**
- Create: `UnifiedPane.tsx`
- Modify: `TextDiffView.tsx`
- Test: append to `tests/tools/diff-merge-component.test.tsx`

**Interfaces:**
- Consumes: `buildUnifiedDoc`, `UnifiedRow` (Task 3); `DiffPanesHandle.apply` and `getDocs` (Task 6); `buildPatch` (Task 3).
- Produces: `UnifiedPane({ a, b, blocks, settings, current, expanded, onApply(i, dir), onExpand(runFrom) })`.

- [x] **Step 1: Write the failing test.**

```tsx
it("unified view shows −/+ rows and Keep chips apply", async () => {
  /* a\nb\n vs a\nc\n */ selectOption("Viewer", "Unified");
  expect(await screen.findByText("−")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep left (change 1)" }));
  expect(await screen.findByText("No differences")).toBeInTheDocument();
});
```

- [x] **Step 2: Run and confirm failure.** Expected: FAIL.
- [x] **Step 3: Build the read-only `EditorView`.**
  - `EditorState.readOnly.of(true)`, with `doc = buildUnifiedDoc(...).text`.
  - Four `gutter()`s built from `rows`, as in the design's `uniEl`:
    1. Actions, 52px: on a row with `first`, two 18px chips. `Keep left` (`»` icon) applies `toRight`; `Keep right` (`«` icon) applies `toLeft`. aria-labels are `"Keep left (change {n})"` and `"Keep right (change {n})"`.
    2. Old line number, 40px.
    3. New line number, 40px.
    4. Marker, 20px. `−` uses the destructive colour, `+` the success colour.
  - Line decorations: `dm-del` / `dm-add`, with `dm-cur` on the current block, which gets the inset ring.
  - `marks` become `dm-word`.
  - Fold rows render the same fold widget as side-by-side.
- [x] **Step 4: Unified header and map.**
  - The single header row shows `"{nameA} → {nameB}"`, the language badge, and the text buttons `Copy patch` (`buildPatch`) and `Copy result` (B text with its EOL). This is the design's unified-state header row.
  - The change map works the same as in side-by-side.
  - The side-by-side editors stay mounted but hidden, so their undo history survives switching views.
- [x] **Step 5: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "feat(diff-merge): unified viewer with keep chips"`

Deviations:
- `UnifiedPane` takes one extra prop, `onCurrentChange`, so a change-map tick can navigate, and it renders two grid cells (editor and map). `ChangeMap` now takes `Pick<DiffEditors, "b" | "blocks">` plus optional `ticks`; the pure `unifiedTicks(rows)` lives in `unified.ts`.
- The unified header is built in `TextDiffView.tsx` (`UnifiedPane` has no names or EOL). The language badge is read-only text, B's language falling back to A's. `Save patch` arrives in Task 9.
- `TextDiffView` keeps its own set of opened folds for the unified view; `DiffPanes` keeps the side-by-side one.
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y in unified mode go to the side the last Keep chip changed (the hidden editors cannot take focus).
- CodeMirror marks `.cm-gutters` `aria-hidden`; the Keep chips are real buttons, so that attribute is removed from the action column and kept on the number and marker columns.
- No syntax highlighting in the unified viewer (the language packs load in `DiffPanes`; the plan gives `UnifiedPane` no language prop).

### Task 9: Settings and shortcuts panels, collapse, export

**Files:**
- Create: `Panels.tsx`
- Modify: `TextToolbar.tsx`, `TextDiffView.tsx`
- Test: append to `tests/tools/diff-merge-component.test.tsx`

**Interfaces:**
- Consumes: `DiffSettings`, `DEFAULT_SETTINGS`, `saveSettings` (Task 3); `saveFile(data: Blob, fileName: string): Promise<boolean>` (`src/lib/desktop.ts:336`).
- Produces:
  - `AnchoredPanel({ open, onClose, anchorRef, width, children })`. It closes on Escape or an outside pointerdown, and focuses its first control when opened. We hand-roll it because the repo has no popover component, and it is reused by `ActionMenu`.
  - `SettingsPanel`.
  - `ShortcutsPanel`.

- [x] **Step 1: Write the failing tests.**

```tsx
it("settings persist and reset", async () => {
  render(<DiffMerge />); fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("switch", { name: "Wrap long lines" }));
  expect(JSON.parse(localStorage.getItem("devtools-diff-merge-settings")!).wrap).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
  expect(screen.getByRole("switch", { name: "Wrap long lines" })).not.toBeChecked();
});
it("context lines stepper clamps 0..20", () => { /* click − four times from 3 → shows 0 */ });
it("shortcuts panel lists F7", () => {
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  expect(screen.getByText("Push change to the right")).toBeInTheDocument();
});
it("collapse toggle folds long unchanged runs", async () => {
  /* 30 equal lines + 1 change */ fireEvent.click(screen.getByRole("switch", { name: "Collapse unchanged" }));
  expect(await screen.findByText("21 unchanged lines")).toBeInTheDocument();
});
```

- [x] **Step 2: Run and confirm failure.** Expected: FAIL.
- [x] **Step 3: Implement `SettingsPanel`.** It follows the design (`:230-247`), `300px` wide:
  - Heading `Compare settings`.
  - `Context lines` (hint `Kept around changes when collapsed`), a −/value/+ stepper.
  - Switches: `Wrap long lines`, `Show whitespace`, `Ignore case`, `Detect language from content`.
  - Footer button `Reset to defaults`.
- [x] **Step 4: Implement `ShortcutsPanel`.** Copy the 7 rows from `:251-261` verbatim, plus the footer `"Click the change map on the right edge to jump to a change."`.
- [x] **Step 5: Wire collapse expansion.**
  - The root listens for `dm-expand` and adds `detail` to the `expanded` Set.
  - Toggling collapse off clears the Set.
- [x] **Step 6: Add export.** The `Copy patch` and `Save patch` items reuse the unified header buttons. In side-by-side, add a `Save` text button on each pane header. Saving calls `saveFile(new Blob([joinEol(text, eol)]), name)`, or `"{nameA}.patch"` for a patch.
- [x] **Step 7: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 8: Commit.** `git commit -m "feat(diff-merge): settings and shortcuts panels, collapse, export"`

Deviations:
- `AnchoredPanel` takes an optional `top` (default 54, the design's value) and aligns its right edge to the anchor's; Escape also returns focus to the anchor. `onClose` is read through a ref, so a new inline callback never re-focuses the panel.
- The context-lines stepper buttons are named `Fewer context lines` / `More context lines` (the design shows bare − and +).
- "Collapse toggle folds long unchanged runs": both panes show the fold bar, so the test uses `findAllByText`. 27 unchanged lines before one change give `21 unchanged lines`.
- Task 9 step 5 needed one `DiffPanes` change: it clears its fold set when `collapse` turns off. `TextDiffView` clears the unified set the same way (Task 8).
- Save: `DiffPanes` calls `saveFile` itself; with no name it saves `original.txt` / `modified.txt`, a patch saves `{nameA}.patch` (`original.patch` with no name). A failed save shows the invented toast `"Could not save the file."`.
- `Save` shows only on a filled pane, like Clear and Copy.

### Task 10: Text-mode visual QA against the mockup

**Files:**
- Modify: `diff-merge.css` and components, only where they deviate from the mockup.

- [x] **Step 1: Run `npm run dev:web` and open Diff & Merge.**
- [x] **Step 2: Paste the design's sample texts.** Use `LEFT` and `RIGHT` from `Diff Merge Tool.dc.html:278-280` (expand `...CHUNK`). Expected: `7 differences`, the same block kinds as the design's `SEG`, and a curved ribbon per block.
- [x] **Step 3: Compare each state 1a–1g in dark and light** against the `.dc.html` values: toolbar spacing, header 38px, the 64px gutter, arrow chip positions, the 14px map, footer 32px, panel positions (`top:54px`), alphas and syntax colours.
  - Fix any differences in the CSS.
  - Test the narrow-window fallback: below `900px` container width, force `viewer: "unified"` and hide the Viewer select. Use a `ResizeObserver` on the root.
- [x] **Step 4: Run `npm run lint && npm run typecheck && npm test`.** Expected: all PASS.
- [x] **Step 5: Commit.** `git commit -m "style(diff-merge): match text-mode mockup in dark and light"`

Deviations:
- **No browser was available** (the run forbids launching any GUI), so Steps 1–3 became a static audit: every toolbar, header, gutter, footer, panel and unified-row value was compared with the `.dc.html` source, and one real mismatch was fixed (the settings-panel switches are 34×19 with a 15px thumb, not the 44×24 default). Pixel positions of ribbons and arrows, and the dark and light look, still need a human pass in `npm run dev:web`. `npm run build:web` passes.
- **7 differences is not reproducible with the engine.** The design's `LEFT`/`RIGHT` (read from the `.dc.html` in a test) give 5 blocks, all modified, not the design's 7 (`SEG`: added, modified, removed, then four modified). `@codemirror/merge` groups hunks that are separated by one common line; the design splits them. Pinned in a test with the current line ranges. A line-level grouping step in `computeBlocks` (Wave 1 code) would be the fix; it was not done here because it changes block counts, word highlights and the Wave 1–2 tests.
- The narrow-window fallback was already wired in Task 7; Task 10 adds its tests (a stubbed `ResizeObserver`; a width of 0 means unknown, not narrow; the forced viewer is never saved).

---

# Wave 4: Folder compare backend (desktop)

### Task 11: Path confinement, scanning and content comparison (Rust)

**Files:**
- Create: `src-tauri/src/folder_compare.rs`
- Modify: `src-tauri/src/main.rs` (add `mod folder_compare;`)

**Interfaces:**
- Produces:

```rust
#[derive(Serialize, Debug, PartialEq)] #[serde(rename_all = "camelCase")]
pub struct FileEntry { pub path: String, pub is_dir: bool, pub size: u64, pub modified_ms: u64 } // path relative, '/' separators
pub const MAX_ENTRIES: usize = 100_000;
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String>;
pub fn scan(root: &Path) -> Result<Vec<FileEntry>, String>;
pub fn same_content(a: &Path, b: &Path) -> std::io::Result<bool>;
```

- [x] **Step 1: Write the failing Rust tests** in `#[cfg(test)] mod tests`. They use a temp dir under `std::env::temp_dir()` with a unique name, removed at the end.

```rust
#[test] fn rejects_escaping_paths() {
    let root = tmp();
    assert!(resolve_inside(&root, "../x").is_err());
    assert!(resolve_inside(&root, "/etc/passwd").is_err());
    assert!(resolve_inside(&root, "a/../../x").is_err());
    assert!(resolve_inside(&root, "a/b.txt").unwrap().starts_with(root.canonicalize().unwrap()));
}
#[cfg(unix)] #[test] fn rejects_symlink_out_of_root() {
    let root = tmp(); std::os::unix::fs::symlink("/tmp", root.join("out")).unwrap();
    assert!(resolve_inside(&root, "out/x").is_err());
}
#[test] fn scans_recursively_without_following_symlinks() {
    let root = tmp(); fs::create_dir_all(root.join("d")).unwrap(); fs::write(root.join("d/f.txt"), "hi").unwrap();
    let e = scan(&root).unwrap();
    assert!(e.iter().any(|x| x.path == "d/f.txt" && x.size == 2 && !x.is_dir));
}
#[test] fn compares_content() {
    let r = tmp(); fs::write(r.join("a"), "x").unwrap(); fs::write(r.join("b"), "x").unwrap(); fs::write(r.join("c"), "y").unwrap();
    assert!(same_content(&r.join("a"), &r.join("b")).unwrap());
    assert!(!same_content(&r.join("a"), &r.join("c")).unwrap());
}
```

- [x] **Step 2: Run and confirm failure.** Run `cargo test --manifest-path src-tauri/Cargo.toml folder_compare`. Expected: FAIL (not defined).
- [x] **Step 3: Implement `resolve_inside`.**
  1. Reject an absolute `rel`, or any component that is `..` or a prefix.
  2. Join it to `root.canonicalize()`.
  3. Canonicalize the deepest existing ancestor and require it to `starts_with` the canonical root. Return the joined path.
- [x] **Step 4: Implement `scan`.**
  - Iterative `fs::read_dir` stack using `symlink_metadata`; skip symlinks.
  - Return `Err("Folder has more than 100,000 files.")` past `MAX_ENTRIES`.
  - `modified_ms` from `metadata.modified()`, as `UNIX_EPOCH` milliseconds.
- [x] **Step 5: Implement `same_content`.** Compare sizes first, then compare 64 KiB chunks.
- [x] **Step 6: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): path-confined folder scan and content compare"`

Deviations: `scan` also takes a test seam `scan_limited(root, max)`; it sorts entries by path and skips names that are not valid UTF-8. `resolve_inside` also refuses a dangling symlink and accepts `.` components. See `waves/wave-4-plan.md`.

### Task 12: Merge with journal and backup, undo, and the commands

**Files:**
- Modify: `src-tauri/src/folder_compare.rs`, and `src-tauri/src/main.rs:276-291`. Register the commands in **both** `generate_handler!` lists (normal and `e2e`).

**Interfaces:**
- Produces:

```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase")] pub enum MergeAction { ToRight, ToLeft }
#[derive(Deserialize)] pub struct MergeOp { pub path: String, pub action: MergeAction }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct MergeReport { pub copied_right: Vec<String>, pub copied_left: Vec<String>, pub backed_up: Vec<String>, pub journal: String, pub backup_dir: Option<String> }
#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct UndoReport { pub restored: usize, pub removed: usize, pub unrestorable: Vec<String> }
pub fn apply_ops(left: &Path, right: &Path, ops: &[MergeOp], work_dir: &Path, backup: bool) -> Result<MergeReport, String>;
pub fn undo(journal: &Path) -> Result<UndoReport, String>;
// commands (camelCase args on the JS side):
#[tauri::command] fn pick_folder(app: AppHandle) -> Option<String>;                       // app.dialog().file().blocking_pick_folder()
#[tauri::command] fn scan_folder(root: String) -> Result<Vec<FileEntry>, String>;
#[tauri::command] fn compare_contents(left_root: String, right_root: String, paths: Vec<String>) -> Result<Vec<bool>, String>;
#[tauri::command] fn read_text_file(root: String, path: String) -> Result<String, String>;  // ≤ 5 MiB, UTF-8 else Err("This file is not UTF-8 text.")
#[tauri::command] fn write_text_file(root: String, path: String, contents: String) -> Result<(), String>; // temp file + rename (pattern from write_tool_manifest main.rs:96-100)
#[tauri::command] fn apply_folder_merge(app: AppHandle, left_root: String, right_root: String, ops: Vec<MergeOp>, backup: bool) -> Result<MergeReport, String>;
#[tauri::command] fn undo_folder_merge(journal: String) -> Result<UndoReport, String>;
```

- [x] **Step 1: Write the failing Rust tests.**

```rust
#[test] fn merge_copies_backs_up_and_undoes() {
    let (l, r, w) = (tmp(), tmp(), tmp());
    fs::write(l.join("new.txt"), "L").unwrap();
    fs::write(l.join("same.txt"), "L2").unwrap(); fs::write(r.join("same.txt"), "R2").unwrap();
    fs::create_dir_all(l.join("d")).unwrap(); fs::write(l.join("d/deep.txt"), "D").unwrap();
    let ops = vec![op("new.txt", ToRight), op("same.txt", ToRight), op("d/deep.txt", ToRight)];
    let rep = apply_ops(&l, &r, &ops, &w, true).unwrap();
    assert_eq!(fs::read_to_string(r.join("same.txt")).unwrap(), "L2");
    assert_eq!(fs::read_to_string(r.join("d/deep.txt")).unwrap(), "D");
    assert_eq!(rep.backed_up, vec!["same.txt"]);
    let u = undo(Path::new(&rep.journal)).unwrap();
    assert_eq!(fs::read_to_string(r.join("same.txt")).unwrap(), "R2");
    assert!(!r.join("new.txt").exists());
    assert_eq!((u.restored, u.removed), (1, 2));
}
#[test] fn merge_without_backup_reports_unrestorable() { /* backup=false, replace same.txt, undo → unrestorable == ["same.txt"] */ }
#[test] fn merge_rejects_escaping_op() { assert!(apply_ops(&tmp(), &tmp(), &[op("../x", ToRight)], &tmp(), true).is_err()); }
```

- [x] **Step 2: Run and confirm failure.** Run `cargo test --manifest-path src-tauri/Cargo.toml folder_compare`. Expected: FAIL.
- [x] **Step 3: Implement `apply_ops`.**
  1. Validate every op with `resolve_inside` before touching anything. On any error, abort with nothing written.
  2. Create `work_dir/<unix_ms>/`.
  3. For each op: if the destination exists and `backup` is set, copy it to `<run>/backup/<right|left>/<rel>`. Then `create_dir_all` the parent and `fs::copy` from source to destination.
  4. Write `<run>/journal.json`, a list of `{ dest, existed, backup: Option<path> }`.
- [x] **Step 4: Implement `undo`.**
  - Read the journal and process its entries in reverse:
    - If the entry has a backup: copy it back and count it as restored.
    - Else if `!existed`: remove the destination and count it as removed.
    - Otherwise: add it to `unrestorable`.
- [x] **Step 5: Implement the commands.**
  - `work_dir` is `app.path().app_data_dir()?.join("diff-merge-backups")`.
  - `backup_dir` in the report is `Some(<run>/backup)` when anything was backed up.
- [x] **Step 6: Run and confirm the tests pass.** Run `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`. Expected: PASS.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): folder merge with journal, backup and undo commands"`

Deviations (details in `waves/wave-4-plan.md`): `MergeAction` has no `rename_all`, so the wire value is `"ToRight"` as Task 13's test pins it. Commands are `async` with `spawn_blocking`. `undo_folder_merge` also takes `app` and only accepts a `journal.json` under the app's backups folder. The journal also stores roots, `side`, `rel` and `createdDirs`, and undo re-resolves every path inside its root. `apply_ops` also rejects duplicate paths, a missing source, a folder in the way and identical roots, and rolls back on a mid-run failure. `read_text` / `write_text` are the testable cores of the two file commands; `read_text_file` also refuses NUL bytes. Fixed one existing `clippy::collapsible_match` in `main.rs` (tray "quit" arm) so `-D warnings` passes.

### Task 13: Desktop bridge functions

**Files:**
- Modify: `src/lib/desktop.ts`
- Test: append to `tests/lib/desktop.test.ts`, which already mocks `@tauri-apps/api/core` at line 14.

**Interfaces:**
- Produces:

```ts
export interface FolderEntry { path: string; isDir: boolean; size: number; modifiedMs: number }
export interface FolderMergeReport { copiedRight: string[]; copiedLeft: string[]; backedUp: string[]; journal: string; backupDir: string | null }
export interface FolderUndoReport { restored: number; removed: number; unrestorable: string[] }
export const isDesktop: () => boolean;   // isTauri()
export function pickFolder(): Promise<string | null>;
export function scanFolder(root: string): Promise<FolderEntry[]>;
export function compareContents(leftRoot: string, rightRoot: string, paths: string[]): Promise<boolean[]>;
export function readTextFile(root: string, path: string): Promise<string>;
export function writeTextFile(root: string, path: string, contents: string): Promise<void>;
export function applyFolderMerge(leftRoot: string, rightRoot: string, ops: { path: string; action: "toRight" | "toLeft" }[], backup: boolean): Promise<FolderMergeReport>;
export function undoFolderMerge(journal: string): Promise<FolderUndoReport>;
export function revealPath(path: string): Promise<void>;   // revealItemInDir from @tauri-apps/plugin-opener
```

- [x] **Step 1: Write the failing test.**

```ts
it("folder bridge maps to commands", async () => {
  tauri.isTauri.mockReturnValue(true); tauri.invoke.mockResolvedValue([]);
  await scanFolder("/a");
  expect(tauri.invoke).toHaveBeenCalledWith("scan_folder", { root: "/a" });
  await applyFolderMerge("/l", "/r", [{ path: "x", action: "toRight" }], true);
  expect(tauri.invoke).toHaveBeenCalledWith("apply_folder_merge", { leftRoot: "/l", rightRoot: "/r", ops: [{ path: "x", action: "ToRight" }], backup: true });
});
it("folder bridge refuses outside the desktop app", async () => {
  tauri.isTauri.mockReturnValue(false);
  await expect(scanFolder("/a")).rejects.toThrow("Folder compare needs the desktop app.");
});
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/lib/desktop.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - Each function guards with `if (!isTauri()) throw new Error("Folder compare needs the desktop app.")`, then calls `invoke`.
  - Map `action` to the Rust enum names `ToRight` / `ToLeft`.
- [x] **Step 4: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "feat(diff-merge): desktop bridge for folder compare"`

Deviations: none to the interfaces. Extra tests cover the remaining commands' argument names, pass-through of backend error text, and the `toLeft` mapping; the opener mock in `tests/lib/desktop.test.ts` gained `revealItemInDir`.

---

# Wave 5: Folder compare UI

### Task 14: Folder model (pairing, kinds, grouping, filters, copy strings)

**Files:**
- Create: `src/utils/diff-merge/folder.ts`
- Test: `tests/tools/diff-merge-folder.test.ts`

**Interfaces:**
- Consumes: `FolderEntry` (Task 13).
- Produces:

```ts
export type RowKind = "left" | "right" | "diff" | "same";
export type MergeAction = "toRight" | "toLeft" | "ignore" | "none";
export type CompareBy = "content" | "size-date" | "size";
export interface FileRow { path: string; name: string; dir: string; depth: 0 | 1; kind: RowKind; left: FolderEntry | null; right: FolderEntry | null; action: MergeAction }
export interface FolderGroup { dir: string; summary: string; rows: FileRow[] }   // dir "" = root (no folder row)
export function pairEntries(left: FolderEntry[], right: FolderEntry[]): { path: string; left: FolderEntry | null; right: FolderEntry | null }[]; // files only, sorted by path
export function needsContentCheck(p: { left: FolderEntry | null; right: FolderEntry | null }, by: CompareBy): boolean; // both present && same size && by === "content"
export function classify(p: { left: FolderEntry | null; right: FolderEntry | null }, by: CompareBy, equalContent?: boolean): RowKind;
export function defaultAction(kind: RowKind): MergeAction;  // left→toRight, right→toLeft, diff/same→none
export function allowedActions(kind: RowKind): MergeAction[]; // left: toRight,ignore,none · right: toLeft,ignore,none · diff: all four
export function cycleAction(row: FileRow): MergeAction;       // Space: next in allowedActions order
export function groupRows(rows: FileRow[]): FolderGroup[];    // root first, then dirs sorted; summary "{n} differences" / "1 difference"
export function filterRows(rows: FileRow[], show: ReadonlySet<RowKind>, query: string): FileRow[]; // case-insensitive substring on path
export function planCounts(rows: FileRow[]): { toRight: number; toLeft: number; ignored: number; noAction: number; replaces: FileRow[] };
export function plannedText(c: ReturnType<typeof planCounts>): string;
export function mergeSubtitle(writes: number, replaces: number): string;
export function doneNotice(r: FolderMergeReport): string;
export function formatSize(n: number): string;   // en-US grouping
export function formatDate(ms: number): string;  // dd.MM.yy HH:mm local
```

- [x] **Step 1: Write the failing tests.** Expected strings are copied from the spec.

```ts
const f = (path: string, size = 1, modifiedMs = 0) => ({ path, isDir: false, size, modifiedMs });
it("pairs and classifies", () => {
  const p = pairEntries([f("a"), f("b", 2)], [f("b", 3), f("c")]);
  expect(p.map((x) => x.path)).toEqual(["a", "b", "c"]);
  expect(classify(p[0], "content")).toBe("left");
  expect(classify(p[1], "content")).toBe("diff");                // sizes differ, no content check needed
  expect(needsContentCheck({ left: f("x", 5), right: f("x", 5) }, "content")).toBe(true);
  expect(classify({ left: f("x", 5), right: f("x", 5) }, "content", true)).toBe("same");
  expect(classify({ left: f("x", 5, 1), right: f("x", 5, 2) }, "size-date")).toBe("diff");
});
it("default and allowed actions", () => {
  expect(defaultAction("left")).toBe("toRight");
  expect(defaultAction("right")).toBe("toLeft");
  expect(defaultAction("diff")).toBe("none");
  expect(allowedActions("left")).toEqual(["toRight", "ignore", "none"]);
});
it("groups by parent dir with summaries", () => {
  const g = groupRows([row("go.mod"), row(".data/a.db"), row(".data/b.db")]);
  expect(g.map((x) => [x.dir, x.summary, x.rows[0].depth])).toEqual([["", "1 difference", 0], [".data/", "2 differences", 1]]);
});
it("plan and status copy", () => {
  expect(plannedText({ toRight: 3, toLeft: 4, ignored: 2, noAction: 2, replaces: [] }))
    .toBe("Planned: 3 to the right · 4 to the left · 2 ignored · 2 without an action");
  expect(plannedText({ toRight: 0, toLeft: 0, ignored: 2, noAction: 2, replaces: [] })).toBe("2 ignored · 2 without an action");
  expect(mergeSubtitle(7, 1)).toBe("7 files will be written. 1 existing file will be replaced.");
  expect(doneNotice({ copiedRight: ["a", "b", "go.sum"], copiedLeft: ["c", "d", "e", "f"], backedUp: ["go.sum"], journal: "", backupDir: "/x" }))
    .toBe("Merged 7 items: 3 copied to the right, 4 copied to the left. The replaced copy of go.sum was backed up first.");
  expect(formatSize(241644888)).toBe("241,644,888");
});
```

- [x] **Step 2: Run and confirm failure.** Run `npx vitest run tests/tools/diff-merge-folder.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.** Pluralise with plain ternaries:
  - `mergeSubtitle` with 0 replacements omits the second sentence.
  - `doneNotice` with more than one backup says `"{n} replaced copies were backed up first."`, and with none omits that sentence.
- [x] **Step 4: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "feat(diff-merge): folder compare model and copy"`

Deviations: added `makeRow` and `mergeOps` (pure helpers the screen needs). `classify` treats an unknown content result as `diff`. `allowedActions("same")` is `["none"]`. `plannedText` drops zero parts and the `Planned:` prefix when nothing moves. `doneNotice` omits an empty copy clause.

### Task 15: Folder screen: toolbar, path bars, table, action menu

**Files:**
- Create: `folder/FolderView.tsx`, `folder/FolderToolbar.tsx`, `folder/FolderTable.tsx`, `folder/ActionMenu.tsx`
- Modify: `src/components/tools/DiffMerge.tsx` (mode state `"text" | "folders"`)
- Test: `tests/tools/diff-merge-folder-view.test.tsx`

**Interfaces:**
- Consumes:
  - Task 14 functions; the Task 13 bridge, mocked in tests with `vi.mock("@/lib/desktop", ...)`.
  - `AnchoredPanel` (Task 9); `DiffPanes` (Task 6); `PaneEmpty` (`ToolWorkspace.tsx:121`).
- Produces: `FolderView({ onOpenInText(docs: [PaneDoc, PaneDoc]): void })`.

- [x] **Step 1: Write the failing tests.** Mock `scanFolder`, `compareContents`, `pickFolder` and `readTextFile`.

```tsx
it("browser shows desktop-only notice", () => {
  isDesktop.mockReturnValue(false); render(<DiffMerge />); fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
  expect(screen.getByText("Folder compare needs the desktop app")).toBeInTheDocument();
});
it("lists rows with kinds, counts and actions", async () => {
  isDesktop.mockReturnValue(true); pickFolder.mockResolvedValueOnce("/L").mockResolvedValueOnce("/R");
  scanFolder.mockImplementation(async (r) => (r === "/L" ? [f("go.mod", 5), f("only-left.db")] : [f("go.mod", 6), f("api")]));
  /* switch to Folders, click both Browse */
  expect(await screen.findByText("only-left.db")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Left only 1" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Start merge (2)")).toBeInTheDocument();      // left-only toRight + right-only toLeft
  expect(screen.getByText("Planned: 1 to the right · 1 to the left · 1 without an action")).toBeInTheDocument();
});
it("space cycles the action, Delete ignores, menu sets it", async () => {
  /* focus go.mod row */ fireEvent.keyDown(row, { key: " " });
  expect(within(row).getByTitle("Copy left to right")).toBeInTheDocument();
  fireEvent.keyDown(row, { key: "Delete" }); expect(within(row).getByTitle("Ignored")).toBeInTheDocument();
  fireEvent.click(within(row).getByTitle("Ignored"));
  fireEvent.click(screen.getByRole("menuitem", { name: /Copy right to left/ }));
  expect(within(row).getByTitle("Copy right to left")).toBeInTheDocument();
});
it("filter chips and filter box hide rows", async () => { /* toggle "Left only" off → only-left.db gone; type "api" → only api */ });
it("selecting a diff text file loads the lower diff", async () => {
  readTextFile.mockResolvedValueOnce("a\n").mockResolvedValueOnce("b\n");
  fireEvent.click(screen.getByText("go.mod"));
  expect(await screen.findByText("1 of 1 difference")).toBeInTheDocument();
});
```

- [x] **Step 2: Run and confirm failure.** Expected: FAIL.
- [x] **Step 3: Implement the mode switch and `FolderToolbar`.**
  - The `Text | Folders` switch is a `role="radiogroup"` with radios, styled exactly as in the spec: container `h32 p2 gap2 radius7 bg muted`, active item `--dm-raised` with a `0 0 0 1px hsl(var(--muted-foreground))` shadow.
  - In the browser (`!isDesktop()`), Folders mode renders `PaneEmpty` with:
    - title `"Folder compare needs the desktop app"`
    - hint `"Download DevTools for macOS, Windows or Linux to compare folders."`
  - `FolderToolbar`, left group:
    - `Refresh` (`title "Compare again"`).
    - `Show` chips (`aria-pressed`; each label includes its count, e.g. `"Left only 3"`):
      - `Left only`: arrow-right, destructive.
      - `Right only`: arrow-left, success.
      - `Different`: `≠`, warning.
      - `Identical`: `=`, default **off**.
    - `Compare by` Select: `Content`, `Size and date`, `Size`.
    - Filter input, 200px wide, placeholder `"Filter by name or path"`.
  - Right group: `?` (opens a shortcuts panel with the folder keys), then the primary button `Start merge ({n})`, where `n = toRight + toLeft`. With `n = 0` it reads `Start merge` and is disabled.
- [x] **Step 4: Implement the path bars and scanning.**
  - Grid `1fr 44px 1fr`. Each bar has a folder icon, the path (code font, 12px, ellipsis) and `Browse` (`pickFolder`). The centre column holds a swap icon.
  - Once both roots are set, run `Promise.all([scanFolder(L), scanFolder(R)])`, then `pairEntries`.
  - Collect the paths where `needsContentCheck` is true and call `compareContents` in batches of 500.
  - `classify` each pair and set `defaultAction`.
  - Show a progress line in the status bar while running: `"Comparing… {done}/{total}"`.
  - Refresh re-runs the scan and keeps user-chosen actions for paths whose kind is unchanged.
- [x] **Step 5: Implement `FolderTable`.**
  - Grid `minmax(0,1fr) 96px 136px 52px 136px 96px minmax(0,1fr)`. Header is 30px (`Name, Size, Modified, Action, Modified, Size, Name`); rows are 28px.
  - Folder group rows span the full width and show the full dir path plus the summary.
  - Name colours, the selected style (`bg hsl(var(--accent))` with `inset 2px 0 0 hsl(var(--primary))`) and the ignored dimming (`.5`) follow the spec.
  - Action chips (28×20) use the spec's titles: `Copy left to right`, `Copy right to left`, `Ignored`, `Different, no action yet`.
  - Virtualise only past 2,000 rows, using simple windowing on scrollTop with fixed 28px rows. Mark it with `// ponytail: fixed-height windowing; swap for a lib if rows get variable height`.
  - Selection: click selects one row, Ctrl/Cmd+click toggles a row, Shift+click selects a range. Keys and menu choices apply to every selected row, limited to each row's `allowedActions`.
- [x] **Step 6: Implement the keyboard handling on the table.**
  - `Space`: `cycleAction`.
  - `Delete`: ignore.
  - `Ctrl+Shift+→` / `Ctrl+Shift+←`: set the action.
  - `Enter`: focus the lower left editor ("Merge by hand below").
  - `ArrowUp` / `ArrowDown`: move the selection.
  - `Ctrl+Enter`: open the merge dialog (Task 16).
- [x] **Step 7: Implement `ActionMenu`.**
  - It is an `AnchoredPanel`, 264px wide, `role="menu"`, positioned below the row's action cell.
  - Heading: `"{name} differs on both sides"`, `"{name} is only on the left"` or `"{name} is only on the right"`.
  - Items: `Copy left to right` (`Ctrl+Shift+→`), `Copy right to left` (`Ctrl+Shift+←`), `Ignore` (`Delete`), a separator, `Decide later` (with a check mark when it is current), `Merge by hand below` (`Enter`).
  - Items outside `allowedActions` are hidden.
- [x] **Step 8: Wire the lower split and footer.**
  - **Lower split:** selecting a file that exists on both sides loads it:
    - `readTextFile` on each side gives the two texts.
    - Render `<DiffPanes headerHeight={36} showHeaders={false}>` under a 36px header containing the name, language badge, the ↑/↓ nav, `"{cur} of {n} differences"`, `Open in Text view` (`onOpenInText`) and `Save both` (`writeTextFile` on both sides, then a re-scan of that path).
    - If `readTextFile` rejects, show `PaneEmpty` with the title `"Binary or non-text file"` and the hint `"Only text files can be merged line by line."`.
    - The hint strip text is copied verbatim from the spec.
  - **Footer:**
    - `"{total} differences"`
    - `"{l} left only"` · `"{r} right only"` · `"{d} different"` · `"{s} identical hidden"`, where the last part appears only while the Identical chip is off
    - `plannedText(...)`
    - `Local processing`
- [x] **Step 9: Run and confirm the tests pass.** Run `npx vitest run tests/tools/diff-merge-folder-view.test.tsx`. Expected: PASS.
- [x] **Step 10: Commit.** `git commit -m "feat(diff-merge): folder compare screen with actions and per-file merge"`

Deviations: new `ModeSwitch.tsx` (radiogroup shared by the text and folder toolbars; `TextToolbar` now uses it and exports `Choice`). `AnchoredPanel` gained `align` and `role`, `ShortcutsPanel` gained `items` and `note`. `FolderView` takes an optional `onModeChange`. Start merge, the footer plan and the merge itself use the rows that pass the Show chips and the filter, never hidden ones, and never count identical rows. Tests click `getAllByText("go.mod")[0]` because both sides show the name. Lower split only opens for a file on both sides. New copy where the prototype has none: `"Choose two folders to compare"` / `"Pick the left and right folder with Browse."`, and the chip title `"No action yet"` for an undecided one-sided row. The Start merge button is wired to the dialog in Task 16.

### Task 16: Merge dialog, done notice, undo and show backup

**Files:**
- Create: `folder/MergeDialog.tsx`
- Modify: `folder/FolderView.tsx`
- Test: append to `tests/tools/diff-merge-folder-view.test.tsx`

**Interfaces:**
- Consumes: `applyFolderMerge`, `undoFolderMerge`, `revealPath` (Task 13); `planCounts`, `mergeSubtitle`, `doneNotice` (Task 14).
- Produces: `MergeDialog({ rows, open, onCancel, onConfirm(backup: boolean) })`.

- [x] **Step 1: Write the failing tests.**

```tsx
it("confirms, merges, shows notice, undoes", async () => {
  applyFolderMerge.mockResolvedValue({ copiedRight: ["only-left.db"], copiedLeft: ["api"], backedUp: [], journal: "/j", backupDir: null });
  fireEvent.click(screen.getByText("Start merge (2)"));
  const dlg = await screen.findByRole("dialog", { name: "Start merge" });
  expect(within(dlg).getByText("2 files will be written.")).toBeInTheDocument();
  expect(within(dlg).getByRole("checkbox", { name: "Back up files before replacing them" })).toBeChecked();
  fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
  expect(applyFolderMerge).toHaveBeenCalledWith("/L", "/R", [{ path: "only-left.db", action: "toRight" }, { path: "api", action: "toLeft" }], true);
  expect(await screen.findByText("Merged 2 items: 1 copied to the right, 1 copied to the left.")).toBeInTheDocument();
  expect(scanFolder).toHaveBeenCalledTimes(4);  // rescan after merge
  fireEvent.click(screen.getByRole("button", { name: "Undo merge" }));
  expect(undoFolderMerge).toHaveBeenCalledWith("/j");
});
it("Ctrl+Enter opens the dialog; Escape cancels without writing", async () => { /* … */ expect(applyFolderMerge).not.toHaveBeenCalled(); });
```

- [x] **Step 2: Run and confirm failure.** Expected: FAIL.
- [x] **Step 3: Implement `MergeDialog`.** It follows spec section 7:
  - **Container:** a `role="dialog"` overlay `rgb(10 14 22 / .38)` over the card only, with a 540px box. It has `aria-labelledby` the title, traps focus, and closes on Escape.
  - **Header:** title `Start merge` and subtitle `mergeSubtitle`.
  - **Groups:**
    - `Copy to the right` lists each path. A `diff` row gets the warning note `"replaces the right copy"`.
    - `Copy to the left` does the same, with `"replaces the left copy"`.
    - `Not changed` is a prose line: `"{ignored paths} are ignored. {none paths} have no action yet."` Each sentence is omitted when its list is empty.
  - **Checkbox:** `Back up files before replacing them`, checked by default.
  - **Footer buttons:** `Cancel` and `Start merge`.
- [x] **Step 4: Handle the merge result.**
  - **On confirm:** call `applyFolderMerge`, then show the success notice bar (spec section 8): `doneNotice(report)` with `Undo merge` and `Show backup`. `Show backup` appears only when `backupDir` is set and calls `revealPath(backupDir)`. Then rescan.
  - **Undo merge:** call `undoFolderMerge(journal)` and rescan.
    - If `unrestorable.length`, show `toast.error("{n} files could not be restored because they were not backed up.")`.
    - Otherwise show `toast.info("Merge undone.")`.
  - **Errors** from any command show `toast.error(message)` and write nothing extra.
- [x] **Step 5: Run and confirm the tests pass.** Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "feat(diff-merge): merge dialog, done notice, undo and backup reveal"`

Deviations: the dialog lists only the rows the merge acts on (visible, identical rows left out). Singular wording where the spec gives only the plural: `is ignored` / `has no action yet`, and `1 file could not be restored because it was not backed up.` The `Not changed` names are capped at 8, then `and N more`. When an undo leaves unrestorable files, the notice stays so the user can retry (the backend keeps the journal). Focus starts on Cancel, so a stray Enter cannot start the merge.

### Task 17: Mode switching, folder visual QA, docs and release

**Files:**
- Modify: `src/components/tools/DiffMerge.tsx`, `README.md` (Text Tools list, around line 142), `release-notes/v2.8.0.md` (create it, per `docs/release-process.md`), and the folder components (styling only).
- Test: append to `tests/tools/diff-merge-component.test.tsx`

- [x] **Step 1: Write the failing test.**

```tsx
it("Open in Text view carries both files into Text mode", async () => {
  /* folder setup, select go.mod */ fireEvent.click(screen.getByRole("button", { name: "Open in Text view" }));
  expect(await screen.findByRole("radio", { name: "Text" })).toBeChecked();
  expect(screen.getAllByText("go.mod").length).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run and confirm failure.** Expected: FAIL.
- [x] **Step 3: Implement mode switching.**
  - `DiffMerge` keeps the `mode` state and passes the `PaneDoc`s from `onOpenInText` as `TextDiffView`'s `initial`.
  - Both views stay mounted (hidden with the `hidden` attribute), so state survives switching.
- [x] **Step 4: Do the visual QA.**
  - Run `npm run tauri dev` (the desktop app). Compare two real folders and check states 2a–2d in dark and light against `Folder Compare.dc.html` (spec values).
  - Run the browser build too and check that the Folders notice renders.
- [x] **Step 5: Update the README and release notes.**
  - README: `- **Diff & Merge** - JetBrains-style side-by-side diff with one-click merge arrows, word highlights, unified view and folder compare (desktop)`.
  - Release notes: a user-facing entry.
- [x] **Step 6: Run the full check suite.** Run `npm run lint && npm run typecheck && npm test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build:web`. Expected: all PASS. The build output shows CodeMirror in a separate lazy chunk, not in `index-*.js`.
- [x] **Step 7: Commit.** `git commit -m "feat(diff-merge): mode switching, docs and release notes"`

Deviations: Step 4 was a static audit of the folder components against `Folder Compare.dc.html` (grid templates, heights, paddings, chip titles, colours, copy), not a `tauri dev` run; the browser notice is pinned by a test. `release:prepare -- 2.8.0` bumped the version files, as `docs/release-process.md` requires; no tag, no push. `TextDiffView` applies a changed `initial` with `panes.setDocs`, because `DiffPanes` reads `initial` only when the editors are created. Folder paths and the Windows build were not exercised.

---

## Verification (end to end)

1. `npm run lint && npm run typecheck && npm test && cargo test --manifest-path src-tauri/Cargo.toml` is all green.
2. `npm run dev:web`: run through text states 1a–1g using the design's sample files.
   - Expected: `7 differences`. `>>`, `<<` and Ctrl-click append each work, and Ctrl+Z undoes.
   - F7 wraps. Ignore whitespace hides indentation-only changes. Collapse shows fold bars. Unified Keep chips work.
   - Settings persist after a reload.
   - Dark and light both match the mockup.
3. `npm run tauri dev`: compare two copies of a project folder where you changed, added and deleted files.
   - Set actions, Start merge with backup, then check the files on disk. Undo, then check they are restored. Show backup opens the backup folder.
   - Try a folder containing a symlink that points outside it: it must not be followed or written through.
4. `npm run build:web`: the `diff-merge` chunk is separate and the main bundle size is roughly unchanged.

## Self-review notes

- **Spec coverage:**

  | Spec | Task |
  |---|---|
  | 1a default | 6–7 |
  | 1b collapse | 9 |
  | 1c applied | 6–7 |
  | 1d settings | 9 |
  | 1e help | 9 |
  | 1f unified | 8 |
  | 1g empty | 6–7 |
  | 2a table and lower diff | 15 |
  | 2b menu | 15 |
  | 2c dialog | 16 |
  | 2d done | 16 |
  | Brief: large-file notice | 7 |
  | Brief: narrow window | 10 |
  | Brief: export | 9 |

- **Deliberate deviations:**
  - The `Text | Folders` switch also appears in the text toolbar, so text mode has a way into Folders.
  - Below 900px the view falls back to unified.
  - The language badge shows the CodeMirror language name. For example `go.mod` shows "Plain text", not the mockup's "Go module".
