---
github: https://github.com/hachej/boring-ui/pull/1571
issue: 1571
state: ready-for-agent
updated: 2026-09-09
track: fast
---

# PR 1571 Nodemailer Bump delivery

## Problem

PR #1571 bumps Nodemailer 9.0.4 → 9.1.1 and currently has a red changed-unit-test gate. The recorded failure is `packages/agent/src/server/agent-host/__tests__/requestLedger.test.ts` with `ERR_SQLITE_ERROR: database is locked`; it is outside the two-file dependency diff and may be a mainline concurrency flake. The branch is behind `origin/main` and must be validated as a current-main integration candidate.

PR conversation, reviews, and inline comments were all read before this plan; there are no review or inline comments and no prior Factory verdicts on the PR.

## Solution

Use one bounded delivery slice. Update the existing Dependabot branch from `origin/main` without force-push, preserve Nodemailer 9.1.1, reproduce the failure, and change code/tests only if evidence shows an attributable defect. Run affected checks against committed code, obtain independent exact-SHA standards/spec, thermo, and explicit package-abstraction PASS, create the non-UI present-pr/proof artifact, push only the existing branch, and classify the final diff. Post `factory: MERGE-READY <sha>` only if automatic-eligible and exact-head CI is green; otherwise return the protected revision for Gate 2.

## Decisions

- Protected boundaries / owner decisions needed: none expected. Routine dependency maintenance is automatic-eligible unless repair changes a public contract, package boundary, security/authority behavior, or another protected boundary.
- Expected package production additions + deletions: currently 2 manifest lines; far below the >500 trigger. Recalculate on the final diff.
- Gate 1 is required by the host's final instruction despite earlier lane prose saying it was pre-granted; the stricter/latest instruction is recorded here.
- No host-granted independent plan-review command is available. Per the plan procedure, this is disclosed at Gate 1; exact-SHA implementation review remains mandatory.

## Flag / Abstraction

- Needed?: no feature flag for a reversible dependency bump.
- Path: `packages/core/package.json`, lockfile, and only evidenced compatibility repairs/tests.
- Rollback: revert the final PR commits/dependency bump; do not delete or force-push.

## Test Seams

- Highest public seam: core mail behavior that imports Nodemailer; if no behavior changes, package tests plus lockfile/install resolution.
- Producer / consumer packages and semantic owners: Nodemailer external package → `packages/core`; inspect real mail call sites and exports.
- Abstraction gate proof: explicit independent review of imports, supported seams, callers, invariants, and affected tests at exact SHA.
- Existing prior art: current mail tests and CI commands.
- Avoid testing: do not weaken unrelated SQLite concurrency assertions or patch an unrelated flake without reproduction/causal evidence.

## Acceptance

- PR #1571 retains Nodemailer 9.1.1 and is conflict-free with current `origin/main`.
- Every review finding and attributable red check is repaired; unrelated flake classification is backed by reproduction evidence, but final exact-head CI must still be green.
- Relevant typecheck, unit, and invariant checks pass on committed code.
- Independent exact-SHA standards/spec, thermo, and package-abstraction verdicts are all PASS, with no open blocker/major findings.
- Non-UI proof and present-pr artifact are durable and linked from the PR.
- Final risk classification and current-main integration evidence are recorded.
- Automatic-eligible result posts `factory: MERGE-READY <exact sha>`; protected result returns to the Orchestrator for one revision-bound merge gate. No agent merges.

## Proof

- Exact commands: reproduce the named request-ledger test; run affected core/agent tests, repository typecheck/unit/invariants matching CI, and `gh pr checks 1571` at exact head.
- UI evidence: N/A; dependency/repair lane has no UI diff unless scope changes, in which case Playwright before/after evidence becomes mandatory.
- Manual steps: inspect resolved Nodemailer version, changed mail call sites, PR review surfaces, and current-main candidate.
- Waiver: none.

## Slices

### Slice: Repair, prove, review, and prepare PR #1571
**Bead:** `factory-plugin-z4hs.1`
**Delivers:** one complete, pushed, exact-revision delivery handoff for the existing PR, including repair if needed, checks, independent review, abstraction PASS, proof, present-pr, risk route, and MERGE-READY when eligible.
**Blocked by:** Gate 1 approval only; parent epic `factory-plugin-z4hs` records ownership/lineage.
**Proof:** commands and artifacts listed above, exact-head CI, review provenance, and PR comment receipt.
**Review budget:** inside; maximum four exact-SHA review rounds.

## Out of Scope

- Other PRs, the `pr-review-batch` epic, Dependabot rebasing commands, force-pushes, branch deletion, release/publish, and merging.

## Open Questions

None. Technical failures are repair work; only a newly discovered protected contract/product/security decision returns to the owner.
