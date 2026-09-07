---
github: https://github.com/hachej/boring-ui/pull/1382
issue: 1382
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# [Objectives Plugin] Deliver PR #1382

## Problem

PR #1382 is mergeable but unstable at `9fcadae0719e5677f458eff99094391714fb777b`: the Runtime Refactor P8 workflow check fails, the branch predates current `origin/main`, and its prior review/proof is not revision-bound to a current-main integration candidate. The PR introduces a thin, restart-durable Objective primitive plugin using ratified vocabulary. Its durable-primitive architecture decision is protected and therefore requires an exact-SHA owner merge decision after proof.

All three GitHub review surfaces were read before planning (`gh pr view --comments`, pull reviews API, and pull comments API); they currently contain no review comments or reviews. Earlier-attempt lineage remains `wt-391-forward-clu5.12` under `pr-review-batch` and is not modified by this lane.

## Solution

Use one serial delivery slice on the existing branch. Rebase onto current `origin/main`, repair P8 and any findings without weakening checks, verify the affected package and repo invariants, capture revision-bound UI before/after evidence, then obtain independent standards/spec and thermo review with an explicit package-abstraction PASS on the exact final SHA. Push only `weekend/objectives-plugin`, produce durable proof plus the `present-pr` artifact, validate against current main, classify the final diff, and raise one exact-SHA merge card. Never merge, force-push, delete branches/files, or modify another epic.

## Decisions

- Protected boundary: the owner has already classified the durable Objective primitive / architecture decision as protected; Gate 2 is required at the reviewed final SHA.
- Gate 1 transport: the request contains an earlier pre-grant statement but ends with an explicit instruction not to skip Gate 1. The later host instruction governs this plan, so approval is requested before dispatch.
- Current diff: 4,471 additions, 0 deletions across 50 files at the old merge base; zero production-code lines under `packages/**`. Final classification must be recomputed after rebase/repairs and may only escalate.
- Independent plan review: no separate tier-1 fresh-eyes plan-review mechanism is exposed to this Orchestrator. The owner decides with that limitation disclosed; the implementation review ladder remains mandatory and capped at four rounds.

## Flag / Abstraction

- Needed?: No new rollout flag is planned; this PR is not registered into app composition and rollback is branch/commit revert before merge.
- Path: plugin-owned front/server/shared seams under `plugins/objectives/**`.
- Rollback: reject the exact candidate or revert its merge commit; no migration or release is authorized.
- Abstraction gate: inspect plugin exports/imports, bridge/tool contracts, real callers, ratified ARCHITECTURE-PLAN and RECONCILIATION; record an explicit independent PASS or stop blocked.

## Test Seams

- Highest public seam: Objective plugin registration/export, `objective.v1` bridge operations, and agent tools.
- Producer / consumer owners: objective server store/handlers produce; plugin front client/pane and tool callers consume; host/runtime authority stays outside plugin-specific state.
- Exact baseline checks: package typecheck, unit tests, build; `pnpm lint:invariants`; `pnpm audit:imports`; the exact Runtime Refactor P8 command recovered from CI.
- UI proof: deterministic Playwright journey with the same fixture and viewport against base and final candidate, recording before/after video and assertions.
- Avoid: mocked private implementation as boundary proof, waived red checks, weakened assertions, or stale review/proof after a SHA change.

## Acceptance

- Branch is based on current `origin/main`, conflict-free, and pushed without force.
- Runtime Refactor P8 and all required/relevant checks are green at the final committed revision.
- Behavior tests cover repairs; UI before/after video and deterministic scenario evidence are durable and owner-accessible.
- Independent exact-SHA review returns standards/spec PASS, thermo PASS, and explicit package-abstraction PASS; no blocker/major findings remain.
- Present-PR and proof artifacts name base/head/current-main SHAs, commands/results, review provenance, risk triggers, package-line calculation, rollback, and links.
- One protected merge approval card is raised at the exact SHA; the Orchestrator never merges.

## Proof

- `pnpm --filter @hachej/objectives typecheck`
- `pnpm --filter @hachej/objectives test`
- `pnpm --filter @hachej/objectives build`
- `pnpm lint:invariants`
- `pnpm audit:imports`
- Runtime Refactor P8 command copied from the failing CI job
- Revision-bound Playwright base/candidate scenario with assertions and video
- GitHub required checks and current-main candidate validation
- Independent review record and present-pr artifact

## Slices

### Slice: Repair, verify, and prepare exact-SHA delivery
**Bead:** `wt-391-forward-5m2v.1`  
**Delivers:** Rebase, technical repairs, tests, UI proof, independent review loop, abstraction PASS, current-main validation, present-pr/proof artifacts, push, final risk classification, and protected merge handoff preparation.  
**Blocked by:** Gate 1 approval only.  
**Proof:** Commands and artifacts listed above, all bound to the final SHA.  
**Review budget:** Inside; maximum four independent review rounds and two Worker dispatches.

## Out of Scope

- Merging PR #1382.
- Publishing/releasing the plugin or registering it in another app.
- Changing the protected architecture ruling.
- Force-pushing, deleting files/branches, or touching another worktree/PR/epic.

## Open Questions

None. Technical failures and ordinary review findings are repair work; only a genuine protected product/security/contract decision or exhausted budget returns to the owner.
