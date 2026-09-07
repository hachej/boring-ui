# [Invite Idempotency] PR #1547 delivery plan

## Objective

Drive the existing PR to one exact-SHA protected-boundary merge decision: integrate current `origin/main`, repair the red real-sandbox Core package test without weakening assertions, obtain revision-bound independent review (standards/spec, thermo, and explicit package-abstraction PASS), and publish durable proof plus the `present-pr` artifact.

Lineage: canonical batch Bead `wt-391-forward-clu5.4` under `pr-review-batch`. This lane does not modify that batch epic.

## Known review state

At `4ff283b563c67302058868905f8cc0866b7a0efe`, GitHub checks and focused idempotency/typecheck/build/invariant proofs passed, and prior adversarial review was CLEAN. The required clean-sandbox command `pnpm --filter @hachej/boring-core test` was red (10 files / 63 tests plus 5 unhandled errors in one run), so owner review requested repair. The PR currently reports mergeable/CLEAN, but `origin/main` has moved and must be integrated and revalidated.

## Dependency-correct Beads

1. `wt-391-forward-rvzi.1` — **Repair package proof and integrate main**
   - Merge current `origin/main`; reproduce and repair package-test failures; preserve atomic invite claim/replay semantics; rerun focused and package checks.
   - Scope: `packages/core/**`, required merge-conflict resolutions, and these planning artifacts.
2. `wt-391-forward-rvzi.2` — **Verify final revision and prepare owner handoff**
   - Depends on `.1`.
   - Revalidate exact SHA/current-main candidate; fresh independent standards/spec + thermo + explicit abstraction PASS; classify diff; produce proof and `present-pr`; update/push the existing PR only.

## Proof and delivery

- Exact committed SHA in a clean sandbox with isolated PostgreSQL where needed.
- `pnpm --filter @hachej/boring-core test`
- focused route/PostgreSQL idempotency tests; Core typecheck/build; `pnpm lint:invariants`; relevant E2E
- current-main integration validation and GitHub-check readback
- independent review provenance and explicit package-abstraction verdict
- no UI video expected because the current diff has no UI files; reclassify if that changes
- protected route: auth/schema/migration changes require one Gate 2 owner merge card at the final reviewed SHA; the Orchestrator never merges

## Risk and rollback

Protected boundaries: authentication/authorization behavior and a database migration/schema change. Package production diff also exceeds the 500-line threshold before exclusions are finalized. Rollback is an authorized revert of the PR commits/migration effects; migration/data implications must be stated precisely in final proof.

## Plan-review note

No separate independent plan-review mechanism is exposed to this Orchestrator before Gate 1. The existing implementation review was read but is not represented as plan certification. The owner decides at Gate 1 under the host's explicit requirement, which overrides the earlier pre-grant sentence in the same kickoff.
