---
github: https://github.com/hachej/boring-ui/pull/1572
issue: 1572
state: ready-for-agent
updated: 2026-09-09
track: fast
---

# PR 1572 Production Deps Group delivery

## Problem

PR #1572 began with nine production dependency bumps and is now conflict-prone against current `origin/main`. Exact-head CI at `851868da0` reports Runtime Refactor P8 plus summary failure; E2E/UI Review failed during external Playwright browser provisioning with an apt hash mismatch. The branch must be brought current, each retained bump bisected, and any bump that breaks a required check dropped. Earlier attempts were tracked by canonical batch Bead `factory-plugin-0hfc` under `pr-review-batch`; that batch is reference-only and must not be modified.

## Solution

First merge current `origin/main` into the PR branch and diagnose every failed job from its logs. Bisect retained bumps and remove every package bump that causes a required check failure; do not modify product source to accommodate a dependency, and remove prior source accommodations that exist only for a bump. Then run exact-head verification, independent standards/thermo/abstraction review, produce durable proof and the `present-pr` artifact, push the same branch, and classify the final diff for automatic `factory: MERGE-READY <sha>` versus one protected merge gate.

## Decisions

- Protected boundaries / owner decisions needed: none anticipated; dependency maintenance is automatic-eligible unless the repair changes a public/MCP contract, package ownership, protected authority, shared design language, exceeds 500 production-line changes under `packages/`, or requires a budget increase.
- Expected package production additions + deletions: dependency metadata only initially; final repair must calculate and record the exact count.
- Existing branch and PR only; no force-push, branch deletion, new PR, or merge by agents.
- Budget increases are not authorized by this plan and require the protected owner route.

## Flag / Abstraction

- Needed?: no feature flag for dependency maintenance.
- Path: preserve supported package exports and adapters; no deep-import compilation fixes.
- Rollback: revert repair commits and/or remove only a proven-blocked package bump; never revert unrelated mainline work.

## Test Seams

- Highest public seam: the real package/app callers of each changed dependency.
- Producer / consumer packages and semantic owners: inspect every touched package manifest, changed source caller, public export, and at least one real consumer path for each repaired seam.
- Abstraction gate proof: `pnpm audit:imports`, `pnpm lint:invariants`, affected package tests, and an explicit independent PASS bound to the final SHA.
- Existing prior art: current CI workflow commands and budget scripts; do not raise limits.
- Avoid testing: mocks of private dependency internals, weakened assertions, or skipped checks.

## Acceptance

- Existing PR is conflict-free with current `origin/main` and pushed to `dependabot/npm_and_yarn/production-dependencies-bf6c2aab7f`.
- Every current review comment and failed CI job is dispositioned with exact evidence.
- No product source is modified to accommodate a dependency; every bump that breaks a required check is dropped and named with evidence.
- Relevant lint, typecheck, unit, invariants, budgets, E2E/UI checks pass at exact head as applicable.
- Independent exact-SHA review reports standards/spec PASS, thermo PASS, and explicit package-abstraction PASS, with all findings resolved (maximum four review rounds).
- Durable proof and `present-pr` artifact exist; final risk classification is recorded.
- Terminal state is either `factory: MERGE-READY <exact sha>`, one exact-SHA protected merge card, or a concrete exhausted/external blocker.

## Proof

- Exact commands: read GitHub failed-job logs; run affected package lint/typecheck/unit suites, `pnpm audit:imports`, `pnpm lint:invariants`, all applicable budget checks, and exact-head CI.
- UI evidence: only if repair changes UI behavior/appearance; then capture revision-bound Playwright before/after video with the same scenario and assertions.
- Integration: validate the exact candidate against current `origin/main` and record both SHAs.
- Review: independent standards/spec, thermo, and explicit abstraction verdict on exact final SHA.
- Artifact: `.handoff/pr-1572-presentation.html` produced through `.agents/skills/present-pr/` and verified from the owner-facing path.

## Slices

### Slice: Repair and synchronize the dependency group
**Bead:** `factory-plugin-rvrw.1`
**Delivers:** failed-job diagnosis, current-main merge, per-bump bisect, removal of every check-breaking bump and any prior product-source accommodation, targeted invariant/budget proof, same-branch push, and complete handoff.
**Blocked by:** None
**File scope:** `package.json`, `pnpm-lock.yaml`, package/app manifests, `packages/cli/vite.config.ts` only to remove prior accommodation, and merge-conflict files from `origin/main`; no new product-source accommodations.
**Proof:** GitHub failed logs plus affected lint/typecheck/unit/invariant/budget commands at committed SHA.
**Review budget:** one implementation session and up to four independent review rounds.

### Slice: Validate and prepare final admission
**Bead:** `factory-plugin-rvrw.2`
**Delivers:** verify prior handoff and all PR comments, repair any exact-head residuals, full applicable CI/current-main integration proof, final fresh review with explicit abstraction PASS, risk-size classification, present-pr/show-me evidence, PR update, and the authorized terminal action.
**Blocked by:** Repair and synchronize the dependency group
**File scope:** residual files identified by exact-head CI/review, `docs/issues/1572/`, `.handoff/pr-1572-presentation.html`, and PR comments/body; no unrelated files.
**Proof:** exact-head green CI, revision-bound review record, integration candidate, durable artifact links, and terminal PR comment/card.
**Review budget:** one finalization session and remaining rounds up to the epic maximum of four.

## Out of Scope

- Modifying `pr-review-batch` or any other PR/worktree.
- Opening or merging a PR, force-pushing, changing Factory policy, deleting branches/files, weakening assertions, or increasing resource budgets without owner approval.

## Open Questions

- None before implementation. Technical failures are repair work; only a discovered protected contract/security/product decision or exhausted host budget is escalated.
