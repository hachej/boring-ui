---
github: https://github.com/hachej/boring-ui/pull/1545
issue: 1545
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# PR 1545 — Gateway Retry delivery repair

## Problem

PR #1545 is green and mergeable at `25b2d76e39650de4b42cc75b7f19a9bfdd5f1075`, but its latest Factory review requests changes. The SQLite regression calls two synchronous `prepare()` implementations through `Promise.all`, so it does not prove real concurrent writers. The canonical gateway plan also documents the superseded retry contract.

The public `AgentRequestLedger` seam is protected. Delivery therefore ends at one exact-SHA owner merge decision after current-main integration, complete proof, and independent standards/spec, thermo, and package-abstraction PASS verdicts.

## Solution

1. Integrate current `origin/main` into `epic/gateway-retry` without force-pushing.
2. Replace the serial-looking SQLite assertion with a genuinely concurrent test using separate workers/processes (or an equally real overlapping-writer mechanism). Mark one row retryable, release the parallel attempts together, prove exactly one `reclaimed` result, prove the loser is `existing`, and prove only the winner may start the effect.
3. Reconcile `docs/plans/agent-runtime/gateway/plan.md` with `markAdmissionRetryable`, the retryable pending marker, and atomic reclaim semantics.
4. Validate the exact committed candidate in a controlled sandbox, obtain independent review with explicit abstraction PASS, update the PR proof/present-pr artifact, and hand the protected revision to the owner. No UI changes are planned, so test/CI evidence replaces Playwright video.

## Decisions

| Decision | Chosen | Why |
|---|---|---|
| Concurrency proof | Real separate parallel actors against one SQLite WAL database | Exercises lock/CAS behavior that same-thread `Promise.all` cannot |
| Runtime scope | No production change unless the real test exposes a defect | The review asks for proof and contract reconciliation, not speculative redesign |
| Main reconciliation | Merge/rebase current main without force-push; worker chooses the non-destructive method | Branch must be conflict-free and owner forbids force-push |
| Delivery route | Protected owner merge gate | Public ledger/API contract changed; 79 package production lines is below the size trigger but does not remove contract risk |

## Flag / Abstraction

- Needed?: No feature flag; this repairs an existing gateway retry contract.
- Path: `AgentGateway` → `AgentRequestLedger.prepare/markAdmissionRetryable` → in-memory/SQLite adapters → gateway/conformance callers.
- Rollback: revert the Gateway Retry commit(s) together, including contract docs and custom-ledger API updates. No schema migration is introduced.
- Protected seam: `AgentRequestLedger` public/server contract and cross-package callers; explicit independent abstraction PASS is mandatory.

## Test Seams

- Highest public seam: gateway conformance and live effect-admission behavior through `AgentRequestLedger`.
- Required concrete seam: two genuinely parallel actors, independent SQLite connections, one shared database file.
- Existing prior art: request-ledger, effect-admission, lifecycle, and gateway-conformance Vitest suites.
- Avoid testing: mocked SQLite, same-event-loop synchronous `Promise.all`, fake lock behavior, weakened assertions, or proof waivers.

## Acceptance

- Exactly one parallel retry receives `ownership: 'reclaimed'`; the loser receives `ownership: 'existing'` and cannot admit/begin a duplicate effect.
- The canonical gateway plan exactly describes the retry marker and atomic reclaim contract.
- Branch is integrated and conflict-free against the then-current `origin/main`.
- Focused suites, full `@hachej/boring-agent` tests with Vercel credentials unset, package typecheck, invariants, and applicable import checks pass at the exact final SHA.
- Independent fresh review is clean for standards/spec and thermo and records explicit package-abstraction `PASS`, with producer, seam, and real callers inspected.
- PR proof and present-pr/show-me artifacts bind evidence, risk classification, CI, rollback, and review provenance to the exact final SHA.
- One owner merge card is raised; no agent merges.

## Proof

- Focused: `pnpm --filter @hachej/boring-agent exec vitest run src/server/agent-host/__tests__/effectAdmission.test.ts src/server/agent-host/__tests__/requestLedger.test.ts src/server/agent-host/__tests__/lifecycle.test.ts src/server/agent-host/testing/__tests__/gatewayConformance.test.ts`
- Full package: `env -u VERCEL_TOKEN -u VERCEL_PROJECT_ID -u VERCEL_TEAM_ID -u VERCEL_ORG_ID pnpm --filter @hachej/boring-agent test`
- Typecheck: `pnpm --filter @hachej/boring-agent typecheck`
- Invariants: `pnpm lint:invariants` and applicable import/package-boundary checks.
- Integration: validate exact head combined with current `origin/main`; record both SHAs and GitHub checks.
- UI evidence: N/A — no UI files or behavior are in scope.

## Slices

### Slice: Repair concurrency proof and canonical contract

**Bead:** `wt-391-forward-uchc.1`
**Delivers:** genuine concurrent SQLite regression, canonical plan reconciliation, and current-main integration.
**Blocked by:** None.
**Proof:** focused/full agent tests, typecheck, invariants, and concurrency result at committed SHA.
**Review budget:** inside one Worker session; repair is limited to two known findings plus merge conflicts.

### Slice: Prove and present the exact final revision

**Bead:** `wt-391-forward-uchc.2`
**Delivers:** exact-SHA sandbox proof, independent standards/spec + thermo + explicit abstraction PASS, risk classification, present-pr/PR evidence, and merge-gate handoff.
**Blocked by:** `wt-391-forward-uchc.1`.
**Proof:** exact commands/results, reviewer provenance, GitHub check links, and current-main candidate result.
**Review budget:** maximum four review rounds for the lane; a new repair finding returns to a new dependent repair Bead rather than being waived.

## Lineage

Canonical batch Bead `wt-391-forward-clu5.5` under `pr-review-batch`; stopped attempts `7eecd7da` and `7c7db6f9`; prior review worker `0fddbe28`. The lane does not modify the batch epic. Worker transcripts are deliberately unavailable to this Orchestrator; the durable PR request-changes comment at `25b2d76e` is the admitted end-state and explicitly records both outstanding findings and prior proof.

## Out of Scope

- New gateway behavior beyond repairing a defect exposed by the real concurrency test.
- UI changes or Playwright video.
- Schema migrations, releases, branch deletion, force-push, opening another PR, merging, or modifying the batch epic.

## Open Questions

None. Technical failures and review findings return to repair within the configured dispatch/review caps.
