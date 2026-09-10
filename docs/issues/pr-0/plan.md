---
github: https://github.com/hachej/boring-ui/pull/0
issue: pr-0
state: ready-for-agent
updated: 2026-09-10
track: fast
---

# Postgres Lock Test Flake delivery plan

## Problem

The Postgres credential workspace-lock lifecycle suite has failed six cases together at the job's 5-second boundary, then passed unchanged on rerun. This points to environment/readiness/contention and wall-clock coupling rather than six independent behavior regressions. The failure has made `main` red and blocked an unrelated PR.

There is no PR yet. The owned branch `fix/postgres-lock-flake` starts at `origin/main`. GitHub PR `0` and all three review-comment endpoints were checked and correctly returned no PR/404, so there are no review findings to fold before implementation.

## Solution

Keep one bounded test-infrastructure slice. Reproduce and classify the timing failure, then make the Postgres suite deterministic by preferring explicit database readiness and per-run isolation, virtual time for deadline-only behavior where compatible with real driver I/O, and larger bounds only for genuinely environmental setup. Preserve every lock, cancellation, serialization, late-query eviction, failed-unlock eviction, and saturated-pool assertion. Inspect the request-ledger SQLite contention case and change it only if it shares the same nondeterministic timing mechanism.

After repair, repeat affected suites at least five consecutive times, run relevant Agent checks/invariants, reconcile current `origin/main`, obtain independent exact-SHA standards/spec and thermo review with an explicit package-abstraction PASS, create the PR and present-pr artifact, and classify the final diff. Test-only automatic-eligible output is `factory: MERGE-READY <40-char sha>`; touching production credential code requires the protected merge route.

## Decisions

- Protected boundaries / owner decisions needed: none for the planned test-only repair. Any production credential, contract, package-boundary, or policy change escalates at merge.
- Expected package production additions + deletions: 0. Test files are excluded from the numerical trigger but remain subject to anti-weakening and abstraction review.
- Scope shape: one child Bead because diagnosis, repair, repetition proof, and delivery share one test seam and must remain revision-bound.
- Review: the host provides no pre-Gate independent-plan-review mechanism in this Orchestrator session. This gap is disclosed at Gate 1; mandatory independent code review remains in the Worker acceptance path.

## Flag / Abstraction

- Needed?: not needed; test-infrastructure repair.
- Path: no runtime feature flag.
- Rollback: revert the single repair commit/PR; no data or schema changes.

## Test Seams

- Highest public seam: real `CredentialVaultPersistenceV2.withWorkspaceLock` behavior against Postgres; real request-ledger claim contention against SQLite if implicated.
- Producer / consumer packages and semantic owners: internal `packages/agent` server persistence tests; no public export is planned to change.
- Abstraction gate proof: inspect changed imports, persistence factory contract, and at least one real caller; run import/invariant checks and record explicit independent PASS at the final SHA.
- Existing prior art: unique Postgres schema per test file already exists; diagnose service readiness and real-time waits around it.
- Avoid testing: mocks that bypass database lock behavior, skipped/todo/allowed-to-fail cases, relaxed expected errors, or assertions that permit a mutation after timeout/cancellation.

## Acceptance

- Every existing lock-lifecycle case remains enabled with equivalent behavioral assertions.
- The Postgres service is proven ready before timed behavior begins, and concurrent runs cannot share lock/database state unexpectedly.
- Deadline/cancellation tests do not depend on a congested host completing unrelated setup inside a tiny wall-clock window.
- The request-ledger SQLite case is either proven unrelated and left untouched, or repaired with equivalent deterministic contention.
- Before/after repetition evidence is reported; final affected suites pass at least 5/5 consecutive runs.
- Relevant package checks and current-main candidate validation pass on committed code.
- Independent exact-SHA review is clean for standards/spec and thermo and explicitly says `Abstraction review: PASS`.
- A PR from `fix/postgres-lock-flake` to `main` and present-pr artifact exist. No evidence commit is pushed after a clean green head.

## Proof

- Exact command: discover package scripts, then record the exact affected-suite command repeated at least five times with `DATABASE_URL` and environment stated; run relevant Agent typecheck/unit/invariant commands.
- UI proof: N/A; no UI change.
- Integration: exact head tested against then-current `origin/main` and CI status linked.
- Waiver: none.

## Slices

### Slice: Determinize lock regression suites and deliver PR
**Bead:** `factory-plugin-va0s.1`
**Delivers:** diagnosis, minimal test-infrastructure repair, 5x repetition evidence, package/current-main checks, exact-SHA independent reviews including abstraction PASS, PR/present-pr, and automatic or protected terminal receipt.
**Blocked by:** Gate 1 plan approval only; parent relation to `factory-plugin-va0s`.
**Proof:** affected suites ≥5 consecutive runs plus relevant Agent checks, CI, independent review, and exact-SHA delivery evidence.
**Review budget:** inside; maximum four review rounds and two dispatches for this Bead.

## Out of Scope

- Production lock semantics unless deterministic testing proves a real behavior defect and the protected route is used.
- Test deletion, skips, todos, allowed failures, assertion weakening, unrelated database refactors, other PRs/worktrees, deployment, or merge.

## Open Questions

None. Implementation choices are bounded by the acceptance criteria and do not require product intent.
