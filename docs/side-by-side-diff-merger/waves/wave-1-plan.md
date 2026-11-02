# Wave 1 Plan: Foundations (master-plan Tasks 1–4)

Branch `feat/diff-merge`, base `1d0aad9f`. Repo inspected at base: no earlier waves landed, so master-plan names hold.

## Repo state observed
- `node_modules/` is **missing**. Task 1 Step 3 (`npm i <8 CM packages>`) also installs everything else. If the install fails offline, escalate with `ask`.
- `src/app/toolRegistry.ts`: `text-compare` entry at ~line 104, `TOOL_COMPONENTS` ends at ~line 214; `lazyNamed` pattern confirmed.
- `src/app/DevToolsApp.tsx:70`: `WORKSPACE_TOOL_IDS` set literal.
- `src/utils/text-compare.ts:316`: `getUnifiedDiff(text1, text2, contextLines, options): string[]` returns `[]` when identical, else `["--- original", "+++ modified", "@@ ...", ...]`.
- `ToolWorkspace.tsx:30` storage pattern: `try { localStorage... } catch {}`.
- Design `wdiff` (`Diff Merge Tool.dc.html:317`): whitespace token is marked changed only when both neighbours are changed. `ribbonPath` (`:335`): `M0 a1 C c a1 c b1 W b1 L W b2 C c b2 c a2 0 a2 Z`, `c = W/2`. Both match the master plan.

## Ordered tasks
1. **Task 1**: register tool, install deps. Commit `feat(diff-merge): register Diff & Merge tool and add CodeMirror deps`.
2. **Task 2**: block model, ignore modes, EOL. Commit `feat(diff-merge): block model with ignore modes and EOL handling`.
3. **Task 3**: apply, inline, geometry, unified, patch, settings. Commit `feat(diff-merge): apply, inline ranges, geometry, unified doc, patch, settings`.
4. **Task 4**: language detection + binary guard. Commit `feat(diff-merge): language detection and binary guard`.

Each task: failing test → run, see fail → implement → run, see pass → commit. Tree clean at each boundary.

## Files
Create:
- `src/components/tools/DiffMerge.tsx`
- `src/utils/diff-merge/{blocks,ignore,apply,inline,geometry,unified,patch,settings,language}.ts`
- `tests/tools/diff-merge-blocks.test.ts`, `diff-merge-logic.test.ts`, `diff-merge-language.test.ts`

Modify:
- `package.json`, `package-lock.json` (npm i)
- `src/app/toolRegistry.ts` (import `GitMerge`, `ALL_TOOLS` entry after `text-compare`, `TOOL_COMPONENTS["diff-merge"]`)
- `src/app/DevToolsApp.tsx` (`WORKSPACE_TOOL_IDS` += `"diff-merge"`)
- `tests/tools/tool-registration.test.ts`, `tests/tools/tool-search-keywords.test.ts:15`
- `docs/side-by-side-diff-merger/implementation-plan.md` (tick boxes, optional `Deviations:`)

## Final signatures
Exactly as in master plan Tasks 1–4 (`DiffMerge`, `DiffBlock`/`computeBlocks`/`blockStats`/`splitEol`/`joinEol`/`DIFF_CONFIG`, `diffIgnoring`, `blockReplacement`, `inlineRanges`, `ribbonPath`/`mapLine`/`collapsedRuns`/`mapTicks`/`GUTTER_WIDTH`, `buildUnifiedDoc`, `buildPatch`, `DiffSettings`/`DEFAULT_SETTINGS`/`SETTINGS_KEY`/`loadSettings`/`saveSettings`, `languageForFile`/`detectLanguageName`/`languageLabel`/`isProbablyBinary`).

Differences / decisions (none contradict the master plan):
- **Dependency pinning**: `npm i` writes caret ranges; accepted.
- **`isProbablyBinary`**: master plan checks only for `0x00` in the first 8,000 bytes. Implemented as written. Non-UTF-8 decode failure is Wave 2 (Task 6) via `TextDecoder({fatal:true})`.
- **`DiffBlock.precise`**: set from the engine's `Chunk.precise`. Task 2 does not itself emit the "approximate" notice (UI wave); it exposes `precise` so the UI can.
- Any further difference found while coding goes in the report and a `Deviations:` note under the task.

## Review Focus for this wave and pinning tests
1. **Very large / minified input** → `computeBlocks` with `DIFF_CONFIG` (`scanLimit: 500`, `timeout: 1000`). Test: "stays fast on huge input" (50k lines < 3 s) in `diff-merge-blocks.test.ts`; I will add a one-2MB-line case. Notice string is UI (later wave).
2. **CRLF vs LF** → `splitEol`/`joinEol`. Test: "CRLF and LF compare equal after splitEol" plus joinEol round-trip.
3. **Missing trailing newline / empty side** → `blockReplacement`. Tests: "handles a last line without trailing newline", "pushes into an empty doc", "pushes a deletion".
4. **Binary guard** (UI toast belongs to Task 6) → `isProbablyBinary` test in `diff-merge-language.test.ts`.
5. Folder path escape: not this wave (Task 15).

## Verification commands
- Task 1: `npx vitest run tests/tools/tool-registration.test.ts tests/tools/tool-search-keywords.test.ts` (fail), then `npx vitest run tests/tools && npm run typecheck`.
- Task 2: `npx vitest run tests/tools/diff-merge-blocks.test.ts`.
- Task 3: `npx vitest run tests/tools/diff-merge-logic.test.ts`.
- Task 4: `npx vitest run tests/tools/diff-merge-language.test.ts`.
- Gate: `npm run lint && npm run typecheck && npm test`.
- Review: `git diff 1d0aad9f81bf8d0068b88e1607586092d6d3e06b..HEAD`.
- Final: `git status --short` clean.
