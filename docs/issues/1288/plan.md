---
github: https://github.com/hachej/boring-ui/pull/1288
issue: 1288
state: ready-for-agent
updated: 2026-09-09
track: owner
---

# Durable Factory Dispatch Retry — bounded PR repair

## Problem

PR #1288 is conflict-dirty against current `origin/main` and exact-head CI is red. The latest independent review also blocks admission on two concrete defects: PATCH returns `AutomationSummary` instead of the complete public `Automation` (dropping `promptRef`), and accepted ambiguity lacks bounded terminal reconciliation. This delivery lane replaces the stalled `br-1276` batch attempt without modifying that batch epic.

## Solution

Use one bounded repair slice, as ordered: merge current `origin/main` normally (never rebase/force-push), restore the complete PATCH response contract with a parent-red regression test, repair all exact-head CI failures including the channel test, dispose every still-applicable review finding without scope growth, and update PR proof/body. Run exact-SHA package checks and independent fresh review with an explicit package-abstraction verdict; push only `br-1276-orchestrator-plugin`.

## Decisions

- Protected boundaries / owner decisions needed: final classification only. The existing diff touches public API/automation authority/package seams, so a clean final revision is expected to require Gate 2 unless exact final classification proves automatic eligibility and host enforcement permits it.
- Expected package production additions + deletions: current PR body reports 73, but the Worker must recompute against the current merge base after merging `origin/main`.
- Scope is owner-bounded repair only: no new features, branch deletion, force-push, or new PR.

## Flag / Abstraction

- Needed?: not-flaggable; repair an existing dispatch/public contract path.
- Path: automation route → operations/store → public Automation response; dispatch run reconciliation → occupancy release.
- Rollback: forward-revert the bounded repair/merge commits; never rewrite branch history.

## Test Seams

- Highest public seam: PATCH `/automations/:id` returns a complete `Automation`, preserving `promptRef`; exact-channel behavior remains asserted.
- Producer / consumer packages and semantic owners: `plugins/boring-automation` owns automation HTTP/store contracts; full-app and workspace/CLI are real composition consumers.
- Abstraction gate proof: inspect public exports, PATCH caller(s), automation composition, imports, and ratified architecture; record an explicit independent PASS at exact SHA.
- Existing prior art: PR #1288 comments and lineage Bead `br-1276` under `pr-review-batch`.
- Avoid testing: string-only assertions or weakened expectations that do not exercise the public response.

## Acceptance

- Current `origin/main` is merged and pushed with zero duplicate Bead ids and no unresolved conflicts.
- PATCH returns complete `Automation`; a regression test fails without the fix and proves `promptRef` survives.
- Every exact-head CI failure, including the channel test, is repaired without weakened assertions.
- Outstanding applicable review findings are fixed or explicitly dispositioned; independent exact-SHA fresh review is clean and records standards/spec, thermo, and `Abstraction review: PASS`.
- Relevant typecheck, unit, lint/invariant checks and GitHub CI are green at the exact final SHA.
- Present-PR and revision-bound proof are durable and the final risk route is recorded.

## Proof

- Exact commands: affected boring-automation tests/typecheck, failing channel test, `pnpm lint:invariants`/applicable import checks, and exact-head GitHub Actions.
- UI video: N/A unless the final repair changes user-visible UI; if it does, capture revision-bound Playwright before/after video.
- Manual: inspect PATCH response for `promptRef`, confirm PR is clean against current main, verify PR artifact links resolve.
- Waiver: none.

## Slices

### Slice: Repair and deliver PR #1288
**Bead:** materialized as the sole child of this epic.
**Delivers:** merge-main repair, complete PATCH contract and regression, CI/channel repair, review-finding disposition, exact-SHA proof/review/push/presentation.
**Blocked by:** Gate 1 approval only.
**Proof:** commands and acceptance above, plus complete Bead handoff with SHA/provenance.
**Review budget:** one implementation dispatch and up to four exact-SHA review rounds; the host reports no rounds used in this replacement epic.

## Out of Scope

New product features, PR splitting/new PRs, modifying the `pr-review-batch` epic, force-push, merging, releases, branch/file deletion without written owner permission.

## Open Questions

None. Technical failures and review findings are repair work within the bounded lane.
