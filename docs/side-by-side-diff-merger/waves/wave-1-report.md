# Wave 1 Report: Foundations (Tasks 1–4)

**Outcome: code complete, gate NOT green.** `npm run lint` and one test fail on code this wave did not touch (details below). Typecheck passes.

## Built
- **Task 1**: `diff-merge` registered (`GitMerge`, "Text Tools", keywords per Global Constraints), lazy component, `WORKSPACE_TOOL_IDS`, placeholder `DiffMerge.tsx`. 8 CodeMirror packages installed.
- **Task 2**: `blocks.ts` (`computeBlocks`, `blockStats`, `splitEol`, `joinEol`, `DIFF_CONFIG`), `ignore.ts` (`diffIgnoring`).
- **Task 3**: `apply.ts`, `inline.ts`, `geometry.ts`, `unified.ts`, `patch.ts`, `settings.ts`.
- **Task 4**: `language.ts`.
- Added leaf `config.ts` (holds `DIFF_CONFIG`; `blocks.ts` re-exports it) to break an import cycle.

## Tests
- New: `diff-merge-blocks` 8, `diff-merge-logic` 18, `diff-merge-language` 7 (33 total). Plus `diff-merge` added to the registration test and the search test updated.
- Full suite on final HEAD: 2272 passed, 4 failed (see Gate).

## Review Focus pins
1. Huge input: "stays fast on huge input" (50k lines) and "one 2 MB line", both under 3 s.
2. CRLF/LF: "CRLF and LF compare equal after splitEol".
3. Trailing newline / empty side: last-line, empty-doc, deletion, append-at-unterminated-end and ignore-mode last-block tests.
4. Binary guard: `isProbablyBinary` tests (UI toast is Task 6).
5. Folder paths: not this wave.

## Deviations (also under Task 3 in the master plan)
- `DiffBlock` gained `textA` / `textB`; `inlineRanges(block, mode)` needs the text for word expansion.
- `buildPatch` strips a shared trailing `\n` first, to avoid a phantom context line.
- `buildUnifiedDoc` emits word marks only for `modified` blocks.
- `collapsedRuns` keeps the pinned `linesB` parameter, which is unused.
- `DIFF_CONFIG` lives in `config.ts`, re-exported from `blocks.ts`.
- Added tests beyond the plan: 2 MB line, append at unterminated end, unified marks and folds, `mapTicks`, patch newline, ignore-mode last block, sniffing edge cases.
- Test-first order in Task 1: the red run happened after `npm i`, because `node_modules` was absent.

## Gate
- `npm run typecheck`: pass.
- `npm run lint`: **fails, 30 errors** in files outside this wave: `src/utils/json.ts` (25), `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `tailwind.config.ts` (2), `tests/tools/password-generator.test.ts`. None are in wave files, which lint clean. Not fixed, since they are outside this wave's ownership.
- `npm test`: `tests/tools/time-zone-converter-component.test.tsx` "adds and removes zones…" **fails deterministically and also fails at base** (checked with my changes stashed). Other failures vary per run and pass when rerun alone (5 s timeouts under full-suite load): `devtools-navigation`, `ip-cidr-component`, `json-workspace`, `key-generator-component`, `devtools-shortcuts`, `certificate-decoder-component`.

## Review (code-review, medium, 1 round)
Fixed:
- Shebang rule was too loose (`pwsh` matched Shell).
- ES-module `import x from 'y'` was detected as Python.
- Circular import between `blocks.ts` and `ignore.ts`.
- Inner char diff in `ignore.ts` ran without a timeout.

Rejected:
- "Ignore-mode offsets clamp breaks apply": false positive, since CodeMirror derives chunk offsets itself. Pinned by a test.
- "Unified fold straddles a block": speculative, since runs sit in unchanged stretches.

## Deferred
- `buildPatch` has no `\ No newline at end of file` marker, and phantom-line handling when only one side ends in `\n`.
- `splitEol` ignores lone `\r` and mixed endings.
- Sniffer ignores a BOM, and its Go rule is loose.
- Dead `linesB` parameter on `collapsedRuns`.
- The "Diff is approximate for very large input" notice is UI work (a later wave); `DiffBlock.precise` exposes the signal.
