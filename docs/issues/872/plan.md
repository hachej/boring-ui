---
github: https://github.com/hachej/boring-ui/issues/872
issue: 872
state: ready-for-agent
updated: 2026-07-21
flag: not-needed
track: fast
---

# gh-872 Automation list should update immediately after manual run

## Problem

Manual automation runs complete through `runNow`, but the automation list/card state is not guaranteed to reflect the newly created run until the user refreshes or manually reloads state.

## Solution

Update the automation front-end state immediately on successful manual run, and cover the behavior with a regression test. The current `AutomationPanel.runNow()` already inserts the returned run into `details[automation.id].runs`; the implementation should verify why the visible list/card still misses it and then fix the smallest stale state/cache seam.

Likely seams to inspect:
- `plugins/boring-automation/src/front/AutomationPanel.tsx` `runNow()` and expanded-details rendering.
- `plugins/boring-automation/src/front/AutomationCard.tsx` run-history props/rendering.
- `plugins/boring-automation/src/front/__tests__/AutomationPanel.test.tsx` for manual-run coverage.

## Decisions

- Start with a failing reproduction test: current code already expands the card and inserts the returned run, so the executor must first prove the stale-list path before changing behavior.
- Treat this as a UI state bug, not a server lifecycle change, unless tests prove `runNow()` returns insufficient data or blocks too long for useful immediate feedback.
- Do not add polling for this bug; show a visible in-progress state immediately when manual run starts, then insert/refresh the real run history when `runNow()` returns.
- Keep the expanded card open after manual run so the new run history is visible.
- Definition of "list updates": the affected automation card must visibly show the in-progress manual run immediately and real run history after completion without page refresh; do not add a broader collapsed-card summary unless needed by the repro.

## Flag / Abstraction
- Needed?: no
- Path: direct front-end state/test fix
- Rollback: revert the UI state update/test

## Test Seams
- Highest public seam: `AutomationPanel` user interaction test for clicking run/manual start and seeing returned run without invoking page refresh.
- Existing prior art: `plugins/boring-automation/src/front/__tests__/AutomationPanel.test.tsx`.
- Avoid testing: implementation details of React state setters unless needed to isolate a race.

## Acceptance

- Triggering a manual automation run causes the run to appear in the automation card/list immediately.
- No browser/page refresh is required.
- The run button still prevents duplicate starts while one run is in progress.
- Error path still reloads runs or surfaces an error without corrupting existing history.

## Proof
- Exact command: `pnpm --filter @hachej/boring-automation test` or the repo's equivalent focused test command for `AutomationPanel.test.tsx`.
- Screenshot/demo: optional manual demo of run history updating in-place.
- Manual steps: open automation list, start an automation manually, verify the card/list shows the new run immediately.
- Waiver if proof is not possible: document missing automation runtime and include focused test output.

## Slices

### Slice: Reproduce and fix manual-run list refresh
**Delivers:** failing test or documented manual repro first, then the smallest UI fix plus regression test.
**Blocked by:** None.
**Proof:** focused automation front-end test and/or manual demo.
**Review budget:** inside.

## Out of Scope

- Scheduled-run live updates.
- Automation run streaming/progress UI.
- Server-side run history storage changes unless the returned manual run is incomplete.

## Grill / Unknowns

### Known-knowns
- `AutomationPanel.runNow()` calls `client.runNow(automation.id)`, expands the automation, and inserts the returned run into `details[automation.id].runs`.
- There is already a manual refresh path via `loadRuns()` and initial list loading via `loadAutomations()`.

### Known-unknowns
- Whether the stale display is because `AutomationCard` does not render `details.runs`, because the manual run response is delayed until completion, or because list/card metadata has a separate `lastRun` field.

### Unknown-knowns
- The product expectation for where the new run should appear: expanded history only, collapsed card summary, or both.

### Unknown-unknowns / blindspots
- **Concurrency:** double-click or two tabs could produce duplicate optimistic entries unless deduped by run id.
- **Failure mode:** if `runNow()` returns after completion, the list may still feel stale during execution; a queued/running optimistic placeholder may be needed if the API blocks too long.
- **Scale:** full `loadRuns()` after every manual run is acceptable for one automation but could be wasteful if used broadly.
- **Rollback:** no on-disk/schema change expected.

**Resolved decision:** Show a visible in-progress state immediately when the manual run starts, then insert/refresh the real run history when `runNow()` returns.
**Why it matters:** If `runNow()` is synchronous and can take a while, only updating after return still feels stale.
**Evidence:** `AutomationPanel.runNow()` awaits `client.runNow()` before inserting a run.
**Chosen answer:** use `runningNowIds` or an equivalent transient UI state for immediate feedback; do not invent fake persistent run ids unless a repro proves it is necessary.

## Next Action

`/exec #872`
