---
github: https://github.com/hachej/boring-ui/pull/1540
issue: 1540
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# PR 1540 Package Cleanup delivery repair

## Problem

PR #1540 is deletion-heavy package cleanup at `b9774a46d`. GitHub CI is green, but the owner's exact-head local-simulation review found 21 CLI, 14 Core, and 92 Workspace failures. The branch is also 12 commits behind `origin/main`. Lineage: canonical batch Bead `wt-391-forward-clu5.7` under `pr-review-batch` (read-only historical reference; unavailable in this lane's Beads store).

## Solution

Integrate current `origin/main`, reproduce the affected package suites in a clean local-simulation sandbox, and repair only branch-caused setup/composition failures without restoring dead private modules or weakening tests. Then run exact-SHA package, invariant, and integration-candidate proof; obtain independent standards/spec, thermo, and explicit package-abstraction PASS; publish durable proof and the present-pr artifact; finally raise the protected merge gate for the exact reviewed SHA.

## Decisions

- Protected boundaries / owner decisions needed: final merge approval because this is deletion-heavy and changes package boundaries. No technical repair question is routed to the owner.
- Expected package production additions + deletions: current PR is 3,786 deletions and 66 additions over 48 files; the >500 package production-line trigger and deletion-heavy trigger both apply.
- Base integration: merge or rebase current `origin/main` without force-push; validate the resulting exact candidate.

## Flag / Abstraction

- Needed?: no runtime flag; this removes unreachable private code.
- Rollback: revert the cleanup commit(s); no destructive data migration.
- Abstraction gate: mandatory independent PASS against ratified architecture, inspecting package exports, imports, and real CLI/Core/Workspace callers.

## Test Seams

- Highest public seam: package manifests/exports and real CLI/Core/Workspace composition tests.
- Producer / consumer packages: Agent, Core, Workspace, CLI, Boring Bash, and Boring Sandbox; public package boundaries remain canonical.
- Proof: clean frozen install, package build, six affected package typechecks/tests, `pnpm lint:invariants`, current-main integration candidate, and explicit independent abstraction review.
- Avoid testing: deleted private implementations in isolation; do not re-add vacuous tests or weaken environment-sensitive assertions.

## Acceptance

- Branch is conflict-free with current `origin/main` and pushed without force.
- CLI, Core, and Workspace local-simulation failures are reproduced and repaired or proven unrelated with deterministic setup; all required affected-package checks pass at exact head.
- Independent exact-SHA standards/spec and thermo review is clean, with explicit package-abstraction PASS (maximum four rounds).
- PR contains revision-bound proof, risk classification, lineage reference, and owner-facing present-pr/show-me artifacts.
- The Orchestrator raises one exact-SHA merge approval card and does not merge.

## Proof

- `CI=true pnpm install --frozen-lockfile`
- `pnpm run build:packages`
- affected package typechecks and tests for agent, boring-bash, boring-sandbox, CLI, core, and workspace
- `pnpm lint:invariants` and applicable import checks
- GitHub checks plus controlled current-main integration validation
- UI before/after video: N/A unless repair changes UI behavior; if it does, add revision-bound Playwright before/after evidence.

## Slices

### Slice: Integrate and repair
**Delivers:** Merge/rebase current main, reproduce the three red suites, repair branch-caused failures, and commit deterministic regression/setup coverage.
**Blocked by:** None.
**File scope:** package source/tests/manifests/lockfile plus these plan artifacts.
**Proof:** clean install/build, focused reproductions, affected package typechecks/tests, invariants.

### Slice: Exact-SHA review and proof
**Delivers:** exact-head full affected-package proof and independent standards/spec, thermo, and abstraction verdict; fixes and re-review if findings occur.
**Blocked by:** Integrate and repair.
**File scope:** package files only for review findings; durable Bead/PR proof records.
**Proof:** exact commands/results and revision-bound reviewer provenance.

### Slice: Present protected merge candidate
**Delivers:** final risk count, present-pr HTML, show-me document, PR body/comment updates, and complete handoff for Gate 2.
**Blocked by:** Exact-SHA review and proof.
**File scope:** `docs/issues/1540/**`, `.handoff/**`, PR body/comments.
**Proof:** artifact opens, links resolve, PR head equals reviewed/pushed SHA, GitHub checks are read back.

## Out of Scope

Restoring unrelated retired modules, changing ratified package ownership, modifying other PRs/worktrees, merging, publishing, force-pushing, or deleting additional files without written owner permission.

## Open Questions

None. Technical failures are repair work; architectural uncertainty blocks the abstraction verdict rather than becoming a proof waiver.
