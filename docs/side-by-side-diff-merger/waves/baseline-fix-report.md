# Baseline fix report (between Wave 1 and Wave 2)

Branch `feat/diff-merge`, started at HEAD `23f90b59`. Goal: make `npm run lint && npm run typecheck && npm test` green so later waves can use the literal gate.

## Result

| Check | Before | After |
| --- | --- | --- |
| `npm run lint` | 30 errors, 6 warnings | 0 errors, 6 warnings (warnings left alone) |
| `npm run typecheck` | green | green |
| `npm test` | 1 to 4 failures, varying per run | 163 files, 2276 tests, all passing |

The full gate exited 0 on two consecutive runs. A third plain `vitest run` was also green. `vite build` still succeeds, which confirms `tailwind.config.ts` loads.

## What was broken and what changed

### 1. Lint errors (30), one commit each

- `src/utils/json.ts` (25 `no-explicit-any`). Commit `fix(lint): replace any with unknown in json utils`.
  - Types moved from `any` to `unknown`: `JsonNode.value`, `JsonParseResult.data`, `queryJson` return, `runJsonQuery` data and value, `getJsonPaths` data, and the internal helpers.
  - `isContainer` is now a type guard (`value is Record<string, unknown>`). `isFilledContainer` is a guard too.
  - `buildJsonTree` now narrows with `Array.isArray(data)` instead of `type === 'array'`. These are equivalent, because `getJsonType` returns `'array'` only for arrays.
  - `yamlLines` now iterates `Object.entries`, which is the same as the old keys-plus-index loop.
  - No `eslint-disable` comments were used. The json viewer, repair and conversion tests (90 tests) pass unchanged, and typecheck is green.
- `src/components/ui/input.tsx` and `textarea.tsx` (`no-empty-object-type`). Commit `fix(lint): use type aliases for Input and Textarea props`.
  - `export interface XProps extends ... {}` became `export type XProps = React....Attributes<...>`. The exported name and shape are unchanged.
- `tailwind.config.ts` (2 `no-require-imports`). Commit `fix(lint): import tailwind plugins instead of require`.
  - The `require()` calls became ES imports of `tailwindcss-animate` and `@tailwindcss/typography`. `vite build` succeeds.
- `tests/tools/password-generator.test.ts` (`no-useless-escape`). Commit `fix(lint): drop useless regex escape in password test`.
  - `\[` inside the character class became `[`. The class matches the same characters.

### 2. Time Zone Converter test: "adds and removes zones in the list it shares with the Timestamp tool"

- **Root cause: environment, in the test.** This machine's local zone is `Europe/Berlin` (`timedatectl` and `Intl` agree). The component builds rows for `UTC`, `Local (<zone>)` and the saved zones, then dedupes by zone. Saving `Europe/Berlin` therefore merges it into the `Local (Europe/Berlin)` row, so no row is labelled `Europe/Berlin` and `getByText("Europe/Berlin")` fails.
- ICU data is fine (418 zones, and `Europe/Berlin` is present). The component behaviour is correct and was not changed.
- **Fix.** Commit `fix(test): make time zone converter add/remove test independent of the local zone`. The test now picks a zone that is not the local one (`America/New_York` when local is Berlin, otherwise `Europe/Berlin`). It also pins the input to `UTC` and `2024-01-15T12:00:00` so the expected offset is fixed. Every assertion is kept.
- **Left over, not fixed.** With `TZ=Asia/Tokyo`, "converts a time in a named zone to UTC and saved zones" fails for the same reason, because it saves `Asia/Tokyo`. It is outside the listed failures and passes on this machine and on UTC and Berlin hosts. A later cleanup could pin `TZ` in the vitest config.

### 3. Timeouts under full-suite load

- **Root cause: load.** Several tests lazy-load tools or do heavy work, and they pass alone but exceed the defaults when the suite runs in parallel. The failing set varied between runs: the two named tests, plus the stopwatch navigation test and the tab context menu test. The failures were either the 5 s test timeout or Testing Library's 1 s `findBy` or `waitFor` default.
- **Fix.** Commit `fix(test): raise test and async-util timeouts for suite-load flakiness`.
  - `vitest.config.ts`: `testTimeout: 30000`. This covers the ip-cidr subnet test and the other slow ones.
  - `tests/setup.ts`: `configure({ asyncUtilTimeout: 5000 })`, so async queries get 5 s instead of 1 s.
  - `tests/tools/json-workspace.test.tsx`: the per-test timeout went from 20 s to 30 s, and the explicit `findByRole("Run", { timeout })` went from 5 s to 15 s. This test overrides the global values.
  - No assertions were removed or weakened.

## Environment note

During verification the host was heavily loaded by test runs from another repository (load average 20 to 36). Under that load the json-workspace test needed more than 20 s, and the timing-based `cleanText > handles 1 MB of input quickly` test (1.5 s budget) failed once at 1.8 s. That second failure is not related to these changes. Both timeouts above were sized with that in mind. The gate was green on three consecutive runs once the load fell to about 8 to 25.

## Left

- The `Asia/Tokyo` local-zone sensitivity of the converter test (above).
- The `cleanText` 1 MB speed test is timing-sensitive on a busy machine.
- 6 lint warnings remain (left alone as instructed).
