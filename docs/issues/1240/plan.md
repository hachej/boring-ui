---
github: https://github.com/hachej/boring-ui/issues/1240
issue: 1240
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# Sandbox Alias Cleanup — PR #1256 repair plan

## Problem

PR #1256 is conflict-heavy and mixes two concerns: a useful alias/source-resolution cleanup and a runtime descriptor/host-policy refactor that the ratified R-33-15 authority-vs-mechanism research rejects. The current branch head is `2d82adf9201d67792124640cacb752ba57258d2d`; current `origin/main` is `d19b04d357ea7d2caae20a44a657edb3ee4c582e`, 79 commits ahead of the branch, and GitHub reports `DIRTY` / `CONFLICTING`.

Lineage: `wt-391-forward-pr-1256-r2-research-reconcile-e9t9` under `pr-review-batch`. That historical batch is read-only for this lane.

## Solution

Salvage the narrow, behavior-neutral alias cleanup onto current main in the existing PR branch. Keep `tsconfig.base.json`'s `boring-source` condition, the provider-agnostic `scripts/vite-sandbox-alias.ts`, sandbox package export-condition entries, and the consumer tsconfig/Vitest alias deletion they enable. Remove/revert the PR-added runtime descriptor registry, host-policy coupling, runtime-mode widening, and remote-worker changes so PR #1256 does not establish an authority-bearing contract contrary to R-33-15. Preserve all current-main runtime, Agent Seats, remote-worker capability, and host-policy behavior while resolving the merge.

No new PR, force-push, branch deletion, production merge, or unrelated cleanup is allowed.

## Decisions

- **Protected boundaries / owner decisions needed:** Gate 1 explicitly authorizes removal of the PR-added descriptor-registry files and reversion of its runtime contract changes. Final diff is reclassified at exact SHA; any remaining package-boundary/public-contract change takes Gate 2.
- **Chosen scope:** alias/source-resolution cleanup only. The optional runtime-mode catalog de-duplication is excluded because widening `remote-worker` and sharing a catalog across V0/V1 factories creates the A2 contract footgun.
- **Architecture basis:** R-33-15 requires descriptor mechanism facts to remain separate from host/deployment policy (production admission, scope issuance, extensions, company-context access, provisioning, persistence). The mixed `SandboxRuntimeModeDescriptorV1` is deferred to its owning architecture lane.
- **Expected package production size:** final count must be recomputed after salvage. Current unsalvaged approximation is 1,373 changed package-production lines and therefore protected; the targeted alias-only diff should be far smaller, but rollout rules still preserve the exact-SHA merge gate if any protected trigger remains.
- **Deletion permission:** approval of this plan is requested as explicit permission to delete only files introduced by this PR for the rejected descriptor-registry/runtime-contract half; no canonical-main file is deleted.

## Flag / Abstraction

- Needed?: no runtime flag; behavior-neutral build/test resolution cleanup.
- Path: TypeScript resolves sandbox source through the package's `boring-source` export condition; Vitest uses one provider-agnostic helper.
- Rollback: revert the salvage commit(s), restoring per-consumer aliases.

## Test Seams

- **Highest public seam:** downstream TypeScript and Vitest consumers resolving supported `@hachej/boring-sandbox` exports with `packages/boring-sandbox/dist` absent.
- **Producer / consumers:** `packages/boring-sandbox/package.json` exports; agent, cli, core, workspace, apps, and plugin config consumers.
- **Abstraction proof:** inspect package exports plus real consumer configs; run import/invariant checks, affected typechecks/tests, build-artifact closure, and clean source-resolution simulation.
- **Avoid testing:** private registry internals or mocked fixture-only provider registration; the registry is out of scope.

## Acceptance

- Existing branch is reconciled with current `origin/main` without force-push and GitHub reports conflict-free.
- Final diff contains only alias/source-resolution changes and necessary behavior-neutral proof, unless an exact documented main-compatibility fix is required.
- No `SandboxRuntimeModeDescriptorV1` registry/host-policy contract, no remote-worker V0/V1 mode widening, and no provider-mechanism ownership move remains in the PR.
- Relevant package typechecks, tests, builds, `pnpm lint:invariants`, and source-resolution simulations pass at the committed SHA.
- Independent exact-SHA standards/spec and thermo review passes, with an explicit cross-package abstraction PASS.
- A durable `present-pr` artifact and exact-SHA proof comment are attached. This is non-UI work, so UI video is N/A unless the final diff unexpectedly changes UI.

## Proof

- `git diff --check`
- affected package build/typecheck/unit commands selected from package scripts
- `pnpm lint:invariants` and applicable import audit
- clean-install/source-resolution simulation with sandbox `dist` absent
- GitHub required checks on final pushed SHA
- independent fresh review: standards/spec, thermo, explicit abstraction verdict
- integration validation against then-current `origin/main`

## Slices

### Slice 1: Salvage alias-only diff onto current main
**Delivers:** merge current `origin/main`, resolve conflicts semantically, retain only alias/source-resolution cleanup, remove the rejected registry/host-policy/runtime-mode half, and add focused resolution regressions where needed.
**Blocked by:** Gate 1 approval.
**File scope:** branch-wide reconciliation; final retained scope limited to sandbox package exports, root/source-resolution helper, consumer tsconfig/Vitest configs, and directly necessary tests/build manifests.
**Proof:** diff inventory, no rejected runtime-contract symbols/changes, focused resolution tests, package typechecks.
**Review budget:** one Worker session.

### Slice 2: Verify and repair the reconciled candidate
**Delivers:** current-main integration verification, relevant package builds/typechecks/tests/invariants, source-resolution simulation, and technical repairs only.
**Blocked by:** Slice 1.
**File scope:** tests/configs in retained alias scope; no new contract or feature scope.
**Proof:** exact commands/results at committed SHA.
**Review budget:** one Worker session.

### Slice 3: Exact-SHA review and owner-ready proof
**Delivers:** independent standards/spec + thermo review, explicit package-abstraction PASS, final risk classification, GitHub CI disposition, present-pr artifact, proof comment, and push to the existing PR branch.
**Blocked by:** Slice 2.
**File scope:** proof/presentation artifacts and review-finding fixes within retained alias scope only.
**Proof:** reviewer provenance and verdict bound to exact SHA, artifact links, CI links, base/head classification.
**Review budget:** up to four review rounds; stop on exhaustion.

## Out of Scope

- Designing or landing D31/runtime-admission policy.
- Provider descriptor registries, host-policy relocation, or remote-worker V1 cutover.
- New PRs, merges, releases, deployments, or changes to the historical batch epic.
- UI behavior or appearance.

## Open Questions

- None before implementation. Any review finding that requires a new runtime/public contract is a protected owner decision rather than repair scope.

## Review record

The existing PR's adversarial Opus review is folded into this plan: it classified the PR as “two PRs wearing one coat,” recommended landing alias cleanup and reworking the descriptor registry against #1317/R-33-15, identified A1–A4 and a false fixture acceptance test, and marked stale CI as non-admissible. No separate host-provided fresh-eyes planning mechanism is available to this Orchestrator; the prior independent review supplies the adversarial plan input. Final code still requires fresh exact-SHA review.
