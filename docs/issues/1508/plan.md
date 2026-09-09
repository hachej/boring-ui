---
github: https://github.com/hachej/boring-ui/issues/1508
issue: 1508
state: ready-for-agent
updated: 2026-09-02
flag: not-needed
track: fast
---

# gh-1508 factory demo farewell acceptance slice

## Problem

The deterministic demo repository exposes only `greeting(name)`. The live Factory acceptance run needs a second, precisely specified feature whose source change, test, and documentation can be observed end to end.

## Solution

Add a named `farewell(name)` export beside `greeting(name)`. It returns exactly ``Goodbye, ${name}.``. Extend the existing public module test and README with one direct usage example.

## Decisions

- Keep `farewell` in `src/greeting.js`; a one-function module does not justify another file.
- Test through the exported function with Node's existing test runner.
- Document an ESM import and call in the fixture README.
- Preserve all existing greeting behavior and unrelated live-worktree changes.

## Flag / Abstraction

- Needed?: No.
- Path: Direct fixture-only change.
- Rollback: Revert the single implementation commit.

## Test Seams

- Highest public seam: named export from `src/greeting.js`.
- Existing prior art: `test/greeting.test.js` uses `node:test` and strict equality.
- Avoid testing: implementation internals or playground orchestration.

## Acceptance

- `farewell` is a named export.
- `farewell(name)` returns exactly ``Goodbye, ${name}.`` including comma and trailing period.
- A focused test calls the export and asserts the exact output.
- The README shows import and usage.
- Existing greeting coverage stays green.

## Proof

- Exact command: `pnpm --dir apps/factory-playground/src/fixtures/demo-repo test`
- Screenshot/demo: Not applicable; this fixture has no UI.
- Manual steps: Read the README example and verify it matches the exported API.

## Slices

### Slice: farewell API, test, and usage docs

**Bead:** `wt-391-forward-1508-farewell-demo-l40y`  
**Delivers:** The exact named export, focused regression test, and README usage example.  
**Blocked by:** None.  
**Proof:** `pnpm --dir apps/factory-playground/src/fixtures/demo-repo test`  
**File scope:** `apps/factory-playground/src/fixtures/demo-repo/{src/greeting.js,test/greeting.test.js,README.md}`  
**Review budget:** Inside; three small existing files and one exact behavioral contract.

## Out of Scope

- Changes to playground orchestration, sandbox behavior, package metadata, or generated artifacts.
- Input validation, localization, punctuation options, or a generalized salutation abstraction.
- Assigning or claiming the Bead, implementation, merge, or production activation.

## Open Questions

None. Owner intent and exact output are explicit.

## Review Record

- Reviewer: `gpt-5.6-sol` / T1 cross-model, reasoning `xhigh`, read-only.
- Target: plan SHA-256 `502063e84ec17d135c5a3ba966d80397b8615b4be1932098afe7890c0d656e0c`; HTML SHA-256 `a536e042b75c700183515582a97f1caec61a9d9af290c751113942bf6294b7eb`.
- Verdict: **clean**; no material findings. Full record: `docs/issues/1508/adversarial-review-sol.txt`.
- Checked: exact API/output, bounded file scope, ESM/Node conventions, plan/HTML consistency, and baseline proof (`1` test passed).
- Residual risk: implementation proof remains for the Worker; final review must verify exact punctuation and both behaviors.

## Graph Validation

- `br dep cycles --blocking-only --json`: `0` active cycles.
- `bv --robot-insights`: final computation at `2026-09-02T20:00:04Z` (data hash `cd1e7fdb6ae3ed6b`); cycles computed as `0`, and the Bead has in-degree `0` and out-degree `0`.
- Final ready-state check: the Bead appears exactly once in `br ready --json`, status `open`, priority `P1`, assignee `null`.

## Gate 1

Owner decision: **approve** — “Approved for the live Factory acceptance run.” The implementation Bead was undeferred and labeled `ready-for-agent`; it remains unclaimed and unassigned.
