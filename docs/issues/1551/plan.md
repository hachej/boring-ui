---
github: https://github.com/hachej/boring-ui/pull/1551
issue: 1551
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# PR 1551 — Changed Workspace Verification delivery

## Problem

PR #1551 was previously reviewed at `93ca43a932946559c990b983ef009927e833fdea`, but current `origin/main` is `aaa713a19cd4a4236a27f96b5c3eb77261a15ebb`. The delivery lane must reconcile the PR with current main and satisfy the newly adopted exact-revision verification, thermo, and cross-package abstraction gates.

## Solution

Use one bounded Worker slice to inspect all PR feedback and the prior batch lineage (`wt-391-forward-clu5.9`), integrate current main without force-pushing, repair any conflict/finding/CI regression, rerun exact-SHA proof, obtain independent standards/spec + thermo review with an explicit abstraction PASS, push the existing branch, and prepare the present-pr artifact. The Orchestrator then classifies the final diff and routes it without merging.

## Decisions

- Protected boundaries / owner decisions needed: none expected during repair; the final actual diff is reclassified before delivery.
- Expected package production additions + deletions: zero; the only current package change is a test fixture cleanup.
- Branch strategy: merge or rebase current `origin/main`, but never force-push.
- Existing exact-SHA approval: reusable only if the exact head remains unchanged; a changed head requires revision-bound evidence and the applicable final gate.

## Flag / Abstraction

- Needed?: no feature flag; this is verification tooling, docs, and test cleanup.
- Path: shared script helper used by changed-workspace test/typecheck runners.
- Rollback: revert the PR commits or final integration commit.

## Test Seams

- Highest public seam: changed-workspace CLI entrypoints running against real temporary Git repositories.
- Producer / consumer: `scripts/lib/changed-workspaces.mjs` consumed by both changed-workspace runners; Workspace hook test cleanup remains test-only.
- Abstraction proof: inspect package imports/contracts and real callers, run invariant checks and affected suites, record explicit independent PASS.
- Avoid testing: mocks that bypass Git change discovery or package selection.

## Acceptance

- PR is conflict-free with current main and pushed only to `epic/changed-workspace-verification`.
- All review comments/findings and red checks are resolved.
- Relevant exact-SHA tests, typecheck, invariants, and CI are green.
- Independent review records standards/spec, thermo, and explicit package-abstraction PASS on the final SHA.
- Present-pr artifact and complete Bead handoff link durable proof.
- Final route is one exact-SHA merge-approval card when protected/host-required, or `factory: MERGE-READY <sha>` only when automatic eligibility is actually enabled.

## Proof

- `pnpm test:changed-workspaces`
- focused filesystem hook test
- `pnpm --filter @hachej/boring-workspace... run build`
- `pnpm --dir packages/workspace run typecheck`
- `pnpm --dir packages/workspace exec vitest run --no-file-parallelism`
- `pnpm lint:invariants`
- final-head GitHub CI and exact-SHA independent review
- UI before/after video: N/A unless the reconciled final diff changes UI behavior

## Slices

### Slice: Reconcile, verify, and prepare final delivery
**Bead:** `wt-391-forward-76c7.1`
**Delivers:** current-main integration, repairs, exact-SHA proof/review, push, present-pr artifact, and handoff.
**Blocked by:** Gate 1 approval only.
**Proof:** commands and review record above.
**Review budget:** inside; maximum four review rounds.

## Out of Scope

- Merging PR #1551.
- Modifying the canonical batch epic or any other PR/worktree.
- New product behavior, releases, or proof waivers.

## Open Questions

None. Technical failures are repair work within the stated budget.
