---
github: https://github.com/hachej/boring-ui/pull/1310
issue: 1310
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# PR 1310 — Agent Package Lifecycle delivery plan

## Problem

PR #1310 implements repo/local Agent package lifecycle behavior but is 78 commits behind current `origin/main` and carries unresolved review findings about fleet failure isolation, retry semantics, catalog DTO projection, scope, and stale review/proof. The existing PR is the only delivery surface. Historical lineage is batch Bead `wt-391-forward-xp3s.4` under `pr-review-batch`; this epic does not modify that batch.

## Solution

Merge current `origin/main` into `exec/wt-391-forward-xp3s.4`, repair every outstanding finding at the public package seams, restore ratified per-package failure isolation, and update regression coverage. Then independently review the exact final SHA for standards/spec, thermo, and cross-package abstraction, validate it against current main, package durable proof and the canonical `present-pr` artifact, and route the protected final diff to one exact-SHA merge approval card. Never merge, force-push, delete files, or open another PR.

## Decisions

- Preserve #1107's ratified isolation: an absent fleet config and one invalid package do not take down unrelated valid seats; present-but-invalid declared fleet state remains explicit and tested at the appropriate boundary.
- A response marked retryable must be retryable under the documented idempotency-key contract; tests must cover the real same-key path or the claim must be narrowed.
- Preserve catalog `version` when a digest is unavailable; expose digest only when known.
- Remove single-use ceremony where safe, without deleting files absent explicit written permission.
- Treat the final result as protected unless an exact final-diff review proves no public API, MCP, package-boundary, or other protected trigger. Current evidence strongly indicates a public package seam, so Gate 2 is expected.

## Flag / Abstraction

- Needed?: Existing `BORING_AGENT_FLEET`; no new rollout flag.
- Path: Agent definition discovery/configuration → Agent host/gateway projection → CLI/workspace consumers.
- Rollback: Revert the PR's repair commits or the complete PR merge; no migration or data deletion is introduced.

## Test Seams

- Highest public seam: configured fleet loading/default resolution and AgentGateway catalog/describe/effect lifecycle as consumed by CLI and Workspace.
- Existing prior art: lifecycle conformance, configured fleet, Agent host lifecycle/describe, workspace server/discovery conflict, CLI host, playground factory-Agent, and Core Agent Seats/store tests.
- Avoid testing: private implementation mocks that bypass the package seam; export-identity-only assertions; weakened mixed-fleet sibling-survival coverage.

## Acceptance

1. Branch contains current `origin/main`, is mergeable, and all PR checks are green.
2. Every PR review finding is explicitly fixed or dispositioned: fleet absence/per-package isolation, same-key retry behavior, version-only projection, test integrity, scope, and ceremony.
3. Relevant Agent, Workspace, CLI, playground, and Core tests/typechecks plus import/invariant checks pass on committed code.
4. Independent exact-SHA review records standards/spec, thermo, and explicit abstraction `PASS`, with packages, public seams, real callers, commands, and dispositions.
5. Final proof records base/head/current-main SHAs, package production line count/exclusions, risk route, CI/review links, non-UI evidence, integration result, and rollback.
6. Canonical `present-pr` and show-me artifacts resolve from the bound worktree; the Orchestrator raises exactly one protected merge card or posts `factory: MERGE-READY <sha>` only if deterministically automatic-eligible.

## Proof

- Exact commands: affected Vitest suites in `packages/agent`, `packages/workspace`, `packages/cli`, `apps/workspace-playground`, and Core; affected package typechecks; `pnpm audit:imports`; `pnpm lint:invariants` or `bash scripts/check-invariants.sh packages/agent`; `git diff --check origin/main...HEAD`; `gh pr checks 1310`.
- Integration: record current `origin/main`, merge candidate, `git rev-list --left-right --count origin/main...HEAD`, and GitHub mergeability/check results.
- Screenshot/demo: N/A unless final diff changes UI; current diff is server/package contract and tests only.
- Review: independent fresh review of exact final SHA, max four rounds, including explicit package-abstraction PASS.
- Artifact: canonical `present-pr` output plus `docs/issues/1310/show-me-<short-sha>.md` at Gate 2.

## Slices

### Slice: Repair lifecycle contracts and tests
**Bead:** `wt-391-forward-0ms8.1`  
**Delivers:** Current-main merge, review repairs, regression tests, green affected checks, pushed exact SHA, complete handoff.  
**Blocked by:** None.  
**Proof:** Affected package tests/typechecks, import/invariant checks, diff check, PR checks, adversarial exact-SHA review.  
**Review budget:** Inside one Worker session; first of at most four review rounds.

### Slice: Review final package abstraction and integration candidate
**Bead:** `wt-391-forward-0ms8.2`  
**Delivers:** Independent standards/spec and thermo verdicts, explicit abstraction PASS, review repairs if needed, current-main integration validation.  
**Blocked by:** `wt-391-forward-0ms8.1`.  
**Proof:** Revision-bound review record, real producer/consumer inspection, commands/results, clean mergeability.  
**Review budget:** Inside one Worker session; total epic review cap remains four.

### Slice: Package proof and delivery handoff
**Bead:** `wt-391-forward-0ms8.3`  
**Delivers:** Canonical present-pr artifact, PR proof/card, deterministic risk classification, exact-SHA handoff to the Orchestrator.  
**Blocked by:** `wt-391-forward-0ms8.2`.  
**Proof:** Owner-facing artifacts resolve, CI and review links match the exact SHA, risk calculation is reproducible.  
**Review budget:** Inside one Worker session.

## Out of Scope

- Modifying the historical `pr-review-batch` epic or source Bead.
- Opening another PR, force-pushing, merging, publishing, releasing, migrations, or deleting files.
- Core persisted-default work separately owned by historical sibling work unless current-main integration requires a compatibility repair within this PR.

## Open Questions

- None required before dispatch. Gate 1 ratifies restoration of the documented per-package/absent-config isolation rule.

## Planning review record

- All PR comments, review API results, inline comments, current diff, CI, and owner-adopted procedures from `origin/main` were inspected.
- No independent plan-review mechanism is available to this Orchestrator before Gate 1; the required worker review ladder is encoded in the Beads. `bv --robot-insights` was attempted twice and timed out after 120s and 60s; `br dep cycles` passed with no cycles.
