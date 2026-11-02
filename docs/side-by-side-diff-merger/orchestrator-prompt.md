# Orchestrator prompt: build Diff & Merge, one fresh session per wave

Paste everything below the line into a Claude Code session started in the repo root (`/home/kinan/Other/Develope/GitHub/devtools`). That session becomes the **coordinator**. It never writes code itself.

Prerequisites:
- Orca is running.
- Orca's Claude agent default args are `--dangerously-skip-permissions` (Orca Settings → Agents). This was already set when the prompt was written. Each worker the coordinator starts therefore runs with all permissions skipped.

---

You are the **coordinator** for building the Diff &amp; Merge tool. Use **Orca orchestration** to run five waves. Each wave runs in its own brand-new Claude worker session. That worker plans the wave, implements it, reviews it, commits it and reports. You then close that session and start a new one for the next wave. You supervise and verify; you do not edit source files.

## 0. Load the tooling first

1. Resolve the Orca CLI: `ORCA_CLI_COMMAND` if set, otherwise `orca-ide` (Linux, outside an Orca terminal). Never run bare `orca`. Use that same executable for the entire run. If it fails, report the exact error and stop.
2. Run `orca-ide skills get orchestration` and follow it. Prefer `--json`. For recovery, load `references/recovery-and-cleanup.md` only when a gate in the guide tells you to.
3. Read these files yourself so you can validate worker output:
   - `docs/side-by-side-diff-merger/implementation-plan.md`. It is the master plan: Global Constraints, Review Focus, Waves and Tasks 1–17.
   - `docs/side-by-side-diff-merger/design-brief.md`.
   - The design prototypes in `docs/side-by-side-diff-merger/project/`. Do not render them or take screenshots.

## 1. Setup (you do this once, before Wave 1)

1. Run `orca-ide status --json`. If Orca is not running, run `orca-ide open --json` and retry.
2. Check `git status --short`. The only untracked path allowed is `docs/side-by-side-diff-merger/`. If anything else is dirty, stop and tell the user.
3. Create the feature branch and commit the docs, so every fresh session can read them:
   ```
   git switch -c feat/diff-merge
   git add docs/side-by-side-diff-merger
   git commit -m "docs: add Diff & Merge implementation plan and design handoff"
   ```
   All workers use `--worktree current`. Waves run strictly one after another, so there are no conflicts. Do not create other worktrees. Do not push. Do not open a PR.
4. Bind one Run: `orca-ide orchestration run-create --objective "Build Diff & Merge (5 waves)" --json`. After a restart, use `run-use --id <run_id>`.
5. Record `BASE_SHA` with `git rev-parse HEAD`. It is updated after each wave.

## 2. The waves

| Wave | Master-plan tasks | Gate (you run it yourself after the worker reports) |
|---|---|---|
| 1 Foundations | 1–4 | `npm run lint && npm run typecheck && npm test` |
| 2 Side-by-side viewer | 5–6 | same as Wave 1 |
| 3 Text mode screen | 7–10 | same as Wave 1 |
| 4 Folder backend (Rust) | 11–13 | `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && npm run typecheck && npm test` |
| 5 Folder UI, docs, release | 14–17 | `npm run lint && npm run typecheck && npm test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build:web` |

## 3. Per-wave loop (repeat for waves 1 to 5, in order)

For wave N:

1. **Start a fresh session.**
   - Run `orca-ide orchestration worker-start --spec "<WORKER BRIEF for wave N, from section 4>" --task-title "Wave N: <name>" --worktree current --agent claude --json`.
   - Do not pass `--model` or `--effort` unless the user named them. Do not reuse a terminal from an earlier wave.
   - If `worker-start` exits non-zero, do not relaunch. Read `failedStage` and `residualResources` and follow `references/recovery-and-cleanup.md`.
2. **Wait.**
   - Run `orca-ide orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json` and repeat. A timeout is a checkpoint, not a failure.
   - Answer `question` messages with `reply`. Prefer a decisive answer from the master plan over bouncing it to the user. Only ask the user if the plan and the design contradict each other.
   - After 3 empty waits, follow the guide's `worker-list` enumeration. If a worker is stuck on a permission prompt, tell the user to set Orca's Claude default args to `--dangerously-skip-permissions`.
3. **Validate the `worker_done`.** All of these must hold:
   - It came from the expected Dispatch with `--outcome succeeded`.
   - `git status --short` is clean.
   - `git log --oneline BASE_SHA..HEAD` shows at least one commit per master-plan task in the wave, plus the wave-plan commit, plus the wave-report commit.
   - `docs/side-by-side-diff-merger/waves/wave-N-plan.md` and `wave-N-report.md` exist and are committed.
   - **You run the gate from section 2 yourself** in the repo root. Do not trust the worker's claim.
4. **If validation fails**, do not continue to the next wave.
   - Start a **new** fresh worker. Its spec is the section 4 brief for the same wave plus an extra block: `FIX PASS: the previous attempt left these failures: <exact command output, trimmed to the failing parts>. Skip tasks that are already done and committed. Fix only what is failing.`
   - Allow at most 2 fix passes per wave. After that, stop and report to the user: the wave, the failing output and `git log`.
5. **Close out the wave.**
   - Settle the worker with `orca-ide orchestration worker-release --dispatch <dispatch_id> --json`. This closes that session. Do not use `terminal close`.
   - Confirm `orca-ide orchestration worker-list --terminal-state reclaimable --json` returns none.
   - Tag the wave: `git tag diff-merge-wave-N`.
   - Update `BASE_SHA` to `git rev-parse HEAD`.
   - Print one progress line: `Wave N done: <n> commits, gate green`.
6. Go to wave N+1. Never carry a session over.

After wave 5, report to the user per wave: outcome, commit range, gate result and anything deferred. Then list manual checks for them. Wave 5 Task 17 Step 4 needs the real desktop app and human eyes: `npm run tauri dev`, compared against the mockups in dark and light. Do not push, open a PR or merge.

## 4. Worker brief (use this template for every wave; fill the braces)

Pass the following as the `--spec` text:

> **WAVE {N}: {name}.** You are a worker in a brand-new session. You have no memory of earlier waves. You run with all permissions skipped, so follow the safety rules below exactly.
>
> **Target.** Repo `/home/kinan/Other/Develope/GitHub/devtools`, branch `feat/diff-merge`. Implement master-plan Tasks {task numbers} from `docs/side-by-side-diff-merger/implementation-plan.md`. Read that file's header, **Global Constraints**, **Review Focus**, **File Structure**, and the full text of your tasks. Read the design prototypes under `docs/side-by-side-diff-merger/project/` as the visual spec for what you build (`Diff Merge Tool.dc.html` for text mode, `Folder Compare.dc.html` for folders). Do not render them.
>
> **Run these four phases in order, in this one session, without stopping between them.**
>
> **Phase A, PLAN (behave exactly like Claude Code plan mode).**
> - Read-only except for one new file. Do not edit source, install packages or change config in this phase.
> - Inspect the repo as it is now. Earlier waves changed it, so names and signatures may differ from the master plan.
> - Write `docs/side-by-side-diff-merger/waves/wave-{N}-plan.md` with:
>   - the ordered task list;
>   - exact file paths to create or modify;
>   - the final signatures you will implement, and any differences from the master plan with the reason;
>   - the Review Focus lines for this wave and the test that pins each;
>   - the exact commands you will run to verify.
> - Commit it: `git add docs/side-by-side-diff-merger/waves && git commit -m "docs(diff-merge): wave {N} plan"`.
> - Print `PLAN COMPLETE, ENTERING EXECUTE`, then continue immediately. Do not wait for approval. Nobody is there to give it.
>
> **Phase B, EXECUTE.**
> - Implement each task in order, following its steps exactly: write the failing test, run it and see it fail, implement, run it and see it pass, then commit.
> - Use `superpowers:test-driven-development`.
> - Make the commit at the end of each task with the message the master plan gives. The tree must be clean at each task boundary.
> - Follow the master plan's Global Constraints, including exact copy strings and design values.
> - You may tick the `- [ ]` boxes in `implementation-plan.md` and append a short `Deviations:` note under a task. Do not otherwise edit the master plan or anything under `docs/side-by-side-diff-merger/project/`.
>
> **Phase C, REVIEW.**
> - Run the full gate: `{gate command}`. Fix any failure.
> - Review `git diff {BASE_SHA}..HEAD` against the master plan, the design prototypes and this wave's Review Focus lines. Use the `code-review` skill, or `superpowers:requesting-code-review`.
> - Fix real findings and re-run the gate. Do at most 2 review-and-fix rounds.
> - Commit any fixes: `fix(diff-merge): wave {N} review`.
> - Write `docs/side-by-side-diff-merger/waves/wave-{N}-report.md` with: what was built, test counts, deviations, review findings and fixes, and anything deferred. Commit it: `docs(diff-merge): wave {N} report`.
>
> **Phase D, REPORT.** Ensure `git status --short` is clean. Then send `worker_done` once, using the exact command from your live preamble, with:
> - `--outcome succeeded` only if the gate is green and the tree is clean, otherwise `--outcome failed`;
> - a three-sentence summary;
> - `--files-modified` and `--report-path docs/side-by-side-diff-merger/waves/wave-{N}-report.md`.
>
> Stop after that.
>
> **Constraints.**
> - Only the wave's own scope. Do not start work belonging to a later wave.
> - Never run `git push`, `git reset --hard`, `git checkout -- .`, `git clean`, `git rebase` or `--no-verify`. Never rewrite history. Never switch branches.
> - Never delete or edit anything under `docs/side-by-side-diff-merger/project/`.
> - Add no npm or Rust dependency beyond what the master plan names.
> - Any test or manual check that touches the file system (waves 4 and 5) uses only temp directories you create yourself. Never read, write, copy or delete real user folders or this repo's working tree through the folder-compare code.
> - Do not run `npm run tauri dev` or any GUI. Verification is by tests and builds only.
>
> **Ownership.** You may edit the files the wave's tasks name, their tests, and `docs/side-by-side-diff-merger/waves/*`.
>
> **Coordination.**
> - Send heartbeats at the cadence in your preamble.
> - Between tasks, run `orca-ide orchestration check --terminal <your_handle> --json` as the preamble says, and again just before `worker_done`.
> - Decide small ambiguities yourself using the master plan and note them in the report.
> - Use `ask` only when blocked: the plan and the design contradict each other, or a required tool is missing.
>
> **Observable acceptance.**
> - {gate command} passes.
> - `git log --oneline {BASE_SHA}..HEAD` shows one commit per task, the plan commit and the report commit.
> - `git status --short` is clean.
> - The two wave docs exist.

Fill-ins for the braces:
- `{task numbers}`, `{name}` and `{gate command}` come from the table in section 2.
- `{BASE_SHA}` is the current value you recorded.
- `{N}` is the wave number.
