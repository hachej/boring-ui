---
github: https://github.com/hachej/boring-ui/issues/1476
issue: 1476
state: ready-for-agent
updated: 2026-09-06
track: owner
---

# [Playground E2E CI] Run the workspace playground suite in CI

## Problem

`.github/workflows/ci.yml` correctly routes changes under `apps/workspace-playground/**` to the `e2e` job, but that job runs only root `pnpm e2e`. The root script builds agent/workspace dependencies and invokes `@hachej/boring-agent`'s `test:e2e`, whose config has `testDir: "."`; it never invokes `apps/workspace-playground/playwright.config.ts`. The playground suite—including the addressed multi-agent surface regression—therefore is not a CI gate.

The issue also reports `multi-agent-addressed-ui.spec.ts` as stale. Repository evidence has moved since intake: commit `2b35ebde3` replaced the removed `Open in new chat pane` menu-item path with the #1176 hover action `Open Scripted baseline in a split pane`, and current HEAD `c28bd0a7` contains that repair. The test still covers two-agent discovery, addressed API isolation, session replacement, split panes, capability isolation, and zero legacy-agent requests.

## Solution

Keep the repaired multi-agent spec and make the existing CI `e2e` job run the full workspace-playground Playwright config after the agent suite.

- In `.github/workflows/ci.yml`, retain the existing checkout/install/browser setup and `e2e` routing, but split execution into explicitly bounded agent and playground steps. Invoke the existing package script with `pnpm --filter workspace-playground run test:e2e`; do not add a duplicate root script.
- Bound the job and both runner steps with `timeout-minutes` so setup plus each suite cannot hang indefinitely. The implementation should select finite values consistent with the configs' 20-minute agent and proposed 20-minute playground global caps, leaving bounded setup overhead at job level.
- In `apps/workspace-playground/playwright.config.ts`, preserve one worker, serial execution, and one CI retry; add `forbidOnly`, a CI `globalTimeout`, line plus HTML reporters, `trace: "retain-on-failure"`, and `screenshot: "only-on-failure"`.
- After a playground failure, use the already-pinned `actions/upload-artifact@043fb46...` action to retain `apps/workspace-playground/playwright-report` and `apps/workspace-playground/test-results` as `workspace-playground-playwright-failure`, with `if-no-files-found: warn` and finite retention. Green runs should not upload failure-only evidence.

## Decisions

1. **Repair versus retirement:** keep the spec. The stale locator was already repaired in `2b35ebde3` and remains repaired at HEAD. Retirement would remove the only focused CI candidate that verifies addressed alpha/beta isolation and split-pane ownership.
2. **Command seam:** call the existing `workspace-playground` package's `test:e2e` script from CI. It already builds the exact dependency graph and executes the app-owned Playwright config.
3. **Coverage seam:** run the config's full `testMatch`, including `apps/workspace-playground/e2e/**/*.spec.ts` and `plugins/ask-user/e2e/**/*.spec.ts`, rather than cherry-picking the reported regression.
4. **Runtime:** keep deterministic `workers: 1` / `fullyParallel: false` and one CI retry. Bound the suite globally and the workflow steps/job rather than weakening per-test assertions.
5. **Artifacts:** generate Playwright HTML/test-result evidence and retain traces/screenshots only on failure; upload only after a failing playground step. No videos.
6. **Flag:** not needed. This is CI configuration and test evidence, not production runtime behavior.

## Flag / Abstraction

- Needed?: No.
- Path: Existing package script and Playwright config; no new abstraction.
- Rollback: Revert the implementation commit to restore the prior agent-only E2E job. The product runtime is unchanged.

## Test Seams

- Highest public seam: `CI=true pnpm --filter workspace-playground run test:e2e`, which starts the hermetic scripted-Pi playground through its app-owned Playwright `webServer` and executes the full configured suite.
- Focused regression seam: `CI=true pnpm --filter workspace-playground exec playwright test apps/workspace-playground/e2e/multi-agent-addressed-ui.spec.ts`.
- Existing prior art: `packages/agent/e2e/playwright.config.ts` already uses a CI global timeout, `forbidOnly`, line+HTML reporters, and failure-only trace/screenshot capture; `.github/workflows/ci.yml`'s UI-review job already uses pinned artifact upload and bounded steps.
- Avoid testing: internal React/Dockview implementation details, real model providers, or production auth. The existing scripted-Pi/API/browser seam is hermetic and sufficient.

## Acceptance

- Playground-path pull requests, `ci:e2e`/`ci:full` requests, release candidates, release branches, and main pushes continue to route through the existing `e2e` job.
- That job runs both the existing agent suite and the full `apps/workspace-playground/playwright.config.ts` test match.
- `multi-agent-addressed-ui.spec.ts` stays enabled and proves addressed alpha/beta sessions, replacement, capabilities, and split-pane ownership through the repaired hover action.
- CI rejects committed `.only`, retains one retry, and preserves serial playground workers.
- Workflow job and suite steps have explicit finite bounds; no failure can consume an unbounded runner.
- A playground failure produces Playwright HTML/test-result output with failure traces/screenshots and uploads it with finite retention; successful runs do not create the failure artifact.
- Existing PR/main summary jobs still gate on the `e2e` job.
- Workflow actions remain SHA-pinned.

## Proof

- Exact command: `CI=true pnpm --filter workspace-playground run test:e2e`
- Focused command: `CI=true pnpm --filter workspace-playground exec playwright test apps/workspace-playground/e2e/multi-agent-addressed-ui.spec.ts`
- Workflow policy: `pnpm check:action-pins`
- CI proof: the PR's `E2E` check is green at the implementation SHA and logs both named suite steps within their declared bounds.
- Failure artifact contract: inspect `workspace-playground-playwright-failure` on a failing playground run for `playwright-report/`, `test-results/`, traces, and failure screenshots. If no organic failure occurs, static workflow/config review proves wiring; do not introduce a committed failing test solely to manufacture evidence.
- Planning waiver: per owner constraint, no install, build, or test was run during planning; repository/config/history inspection only.

## Execution Discovery

Gate 1 initially approved one configuration slice. That slice was handed off and pushed at `24e2660167e8ca962cd19f8d2fff3cd1041f664a` with an approving fresh review, but its required full-suite proof exposed the previously invisible baseline: 40 tests ran, 29 passed, 4 skipped, and 7 failed. The focused multi-agent test failed before its repaired split-pane assertion because the API rejected the workspace selector as `WORKSPACE_UNINITIALIZED`. Other failures cover agent-host boot, deck/tasks fixtures, multi-filesystem behavior, and a dist-only release-candidate spec included in the ordinary match. The branch is also four commits behind current `origin/main`, including overlapping CI/config paths.

A known-red gate cannot meet the owner outcome. This is a material scope change, so implementation remains stopped pending revised Gate 1 approval.

## Slices

### Slice 1: Run playground suite with bounded failure evidence

**Bead:** `wt-391-forward-t9zq.1` — closed after complete handoff at `24e2660`  
**Delivers:** CI invocation, layered runtime bounds, failure evidence policy, and preservation of the already-repaired multi-agent spec.  
**Proof result:** Workflow/config checks and action pins passed; the newly invoked suite ran and exposed seven failures.  
**Review:** Fresh reviewer approved the config diff and noted suite execution remained unreviewed.

### Slice 2: Restore a green current-main playground suite

**Bead:** `wt-391-forward-t9zq.2` — P0, open, ready, unassigned  
**Delivers:** merge current `origin/main` without force-push, preserve slice 1, diagnose and repair the seven enumerated failures, route the dist-only release-candidate test correctly, and finish with green full-suite plus focused multi-agent proof.  
**Blocked by:** Slice 1, now closed/accepted.  
**File scope:** `apps/workspace-playground/playwright.config.ts`; the seven named failing specs and their existing fixtures; production source only where reproduction proves an actual regression.  
**Proof:** Green full package suite, green focused multi-agent spec, action-pin check, PR E2E, exact-SHA sandbox, and fresh review.  
**Review budget:** One additional Worker session; stop with a blocker handoff rather than widening beyond the enumerated failures.

## Dependency Graph

```text
wt-391-forward-t9zq (epic)
  ├── wt-391-forward-t9zq.1 (closed · CI wiring @ 24e2660)
  └── wt-391-forward-t9zq.2 (ready · green-suite restoration)
          depends on wt-391-forward-t9zq.1
```

`br dep cycles`: zero active cycles. Scoped `bv --robot-insights`: 3 nodes, 1 edge, topological order epic → slice 1 → slice 2 (data hash `bd55df7568adaab6`).

## Risks and Mitigations

- **Runtime growth:** full serial suite adds CI time. Mitigate with explicit suite/step/job caps, one retry, cancellation concurrency, and existing path routing.
- **False confidence from stale UI selectors:** current history and source confirm the reported locator is already repaired; focused execution must prove it at the implementation SHA.
- **Missing diagnostics:** configure report/test outputs plus failure trace/screenshots and upload both expected directories after failure with `warn` for partial output.
- **Overlapping servers/state:** retain one worker and the config's isolated fixture roots/ports; run suites sequentially in the existing job.
- **Artifact noise/cost:** upload only on playground failure and set finite retention.

## Out of Scope

- Reworking the playground suite, parallelizing its shared server/state, changing production multi-agent UI, adding browser projects, recording video, or changing unrelated package scripts.
- Closing issue #1476, Beads, opening a PR, or implementation before Gate 1 approval.

## Open Questions

- **Owner:** approve or reject the material expansion from two CI/config files to one bounded green-suite restoration slice covering the seven observed failures and current-main reconciliation.
- Exact finite timeout/retention numbers may be tuned within the acceptance contract, but cannot be removed or made unbounded.

## Review

No host-provided independent **plan-review** mechanism is available in this Orchestrator session. Per the owner constraint, no direct Codex/review loop or Worker substitute was run for either plan revision. The slice-1 implementation itself received an approving fresh review at `24e2660`; that is implementation review, not independent certification of this revised plan.
