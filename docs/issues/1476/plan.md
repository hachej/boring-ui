---
github: https://github.com/hachej/boring-ui/issues/1476
issue: 1476
state: ready-for-agent
updated: 2026-09-10
track: owner
---

# [Playground E2E CI Retry] Deliver a green, bounded playground CI gate

## Problem

Commit `24e2660167e8ca962cd19f8d2fff3cd1041f664a` adds the workspace-playground Playwright suite to the existing E2E workflow with layered timeouts and failure artifacts. Its first execution exposed seven existing failures, and the branch is now 31 commits behind `origin/main`. There is no pull request for `epic/playground-e2e-ci`; GitHub PR #1476 does not exist, while issue #1476 is the canonical issue.

The replacement lane must preserve uncommitted Beads/docs evidence, merge current main first, repair the suite without weakening it, then open the intended PR and supply revision-bound proof.

## Solution

1. Preserve the prior evidence and merge current `origin/main` into the branch without force-pushing. Keep the bounded workflow/config behavior from `24e266016` and validate the Beads ledger has no duplicate IDs.
2. Reproduce the current-main suite and repair the enumerated failures at their real contract seam. Keep the repaired multi-agent split-pane assertion, and route the release-candidate-only scenario intentionally rather than excluding ordinary coverage to hide failures.
3. At the final SHA, run sandbox and GitHub CI proof, obtain independent standards/thermo review plus an explicit cross-package abstraction PASS, create the present-pr artifact, and open the intended PR to `main`.

## Decisions

- **Prior work:** retain commit `24e266016` and all uncommitted evidence; prior canonical lineage is `wt-391-forward-t9zq` / `.1` under `pr-review-batch`, which this lane references but never modifies.
- **Integration strategy:** merge current main; no rebase, force-push, branch deletion, or evidence deletion.
- **Test strategy:** run the full app-owned `test:e2e` seam and focused multi-agent spec; repair proven drift, never weaken assertions or fake green proof.
- **PR state:** no PR currently exists. The final delivery slice opens one from the existing branch rather than creating a new branch.
- **Protected boundary:** expanding an existing required E2E check changes CI enforcement, so the final revision takes the single Gate 2 owner-approval route.
- **Package size:** expected package production change is zero unless reproduction proves a package regression; final diff classification recalculates exact additions/deletions.

## Flag / Abstraction

- Needed?: No runtime flag; this is CI/test gating.
- Path: Existing workflow E2E job → existing workspace-playground package script → app Playwright config.
- Rollback: Revert feature commits. Never force-push or delete evidence.

## Test Seams

- Highest public seam: `CI=true pnpm --filter workspace-playground run test:e2e`.
- Focused seam: `CI=true pnpm --filter workspace-playground exec playwright test apps/workspace-playground/e2e/multi-agent-addressed-ui.spec.ts`.
- Workflow seam: `pnpm check:action-pins` and green PR E2E logs at the exact head.
- Invariants: `pnpm lint:invariants`, affected typecheck/unit checks, and independent coding-invariants abstraction review of imports/contracts/callers.
- Environment: dependency installs use `TMPDIR=/var/tmp`; exact-SHA sandbox proof is mandatory.

## Acceptance

- Branch contains current `origin/main` and prior commit `24e266016`, with no force-push and zero duplicate Bead IDs.
- Existing E2E job runs both agent and workspace-playground suites under finite job/step/config bounds.
- Full CI-mode workspace-playground suite and focused multi-agent scenario are green without weakened assertions or hidden ordinary coverage.
- Failure-only report/results/trace/screenshot artifact wiring remains SHA-pinned and finite-retention.
- Intended PR from `epic/playground-e2e-ci` to `main` exists, is conflict-free, and has green required checks at the exact final SHA.
- Independent standards/spec and thermo verdicts are PASS; abstraction review is explicitly PASS with inspected seams/callers.
- Present-pr and proof artifacts resolve from the workspace root.
- Exactly one merge-approval card is raised for the protected CI enforcement boundary; the Orchestrator never merges.

## Proof

- Local/sandbox: full and focused Playwright commands, affected checks, `pnpm check:action-pins`, `pnpm lint:invariants`.
- GitHub: exact-head required checks and E2E logs/artifacts.
- Review: revision-bound independent standards/spec, thermo, and explicit abstraction PASS.
- Artifact: `.handoff/` present-pr HTML plus `docs/issues/1476/show-me-<sha>.md`.
- UI video: N/A unless the final diff changes product UI behavior; if it does, revision-bound before/after Playwright video becomes mandatory.

## Slices

### Slice 1: Reconcile current main and preserve bounded CI wiring
**Bead:** `wt-391-forward-nhhc.1`  
**Delivers:** evidence preservation, current-main merge, conflict resolution, retained CI wiring, duplicate-ID check.  
**Blocked by:** None.  
**Proof:** ancestry/status, ledger duplicate check, action pins, exact-SHA sandbox and fresh review.  
**Review budget:** one Worker session.

### Slice 2: Restore the current-main playground suite to green
**Bead:** `wt-391-forward-nhhc.2`  
**Delivers:** evidence-based repair of the seven known failure families without coverage weakening.  
**Blocked by:** `wt-391-forward-nhhc.1`.  
**Proof:** green full/focused Playwright, affected checks, invariants/action pins, exact-SHA sandbox and fresh review.  
**Review budget:** one Worker session; stop with exact blocker if enumerated scope does not fit.

### Slice 3: Prove the final revision and prepare PR 1476
**Bead:** `wt-391-forward-nhhc.3`  
**Delivers:** PR, exact-SHA CI/sandbox evidence, independent standards/thermo/abstraction PASS, risk classification, proof comment, present-pr artifact.  
**Blocked by:** `wt-391-forward-nhhc.2`.  
**Proof:** green PR checks and resolvable owner-facing artifacts bound to final SHA.  
**Review budget:** up to four total review rounds; never retry a capped review or Bead.

## Dependency Graph

```text
wt-391-forward-nhhc (epic)
  └─ wt-391-forward-nhhc.1 reconcile main
       └─ wt-391-forward-nhhc.2 restore green suite
            └─ wt-391-forward-nhhc.3 final proof + PR
```

`br dep cycles` reports no cycles. `bv --robot-insights` reports the repository graph as a DAG. The scoped ready queue contains only `.1`.

## Risks

- Current-main conflicts could alter CI intent: preserve both parent ancestries and re-run action-pin/config checks.
- The suite may expose product regressions: production edits require reproduction evidence and affected contract proof.
- CI runtime may grow: retain serial execution and layered finite bounds.
- Required-check semantics are protected: Gate 2 is mandatory at the final SHA.
- Existing evidence could be lost: prior canonical files are copied to `*-prior.*`; no deletion or destructive reset is permitted.

## Out of Scope

No other epic or PR; no main checkout changes; no branch/file deletion; no force-push; no unrelated suite rewrite; no assertion weakening; no merge.

## Review

No independent plan-review mechanism is exposed to this Orchestrator. The Gate 1 card records that limitation rather than substituting a Worker or self-certification. Prior implementation review at `24e266016` approved only the two-file CI/config change, not this current-main repair plan.
