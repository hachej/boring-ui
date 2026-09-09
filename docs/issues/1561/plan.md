---
github: https://github.com/hachej/boring-ui/pull/1561
issue: 1561
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# PR 1561 Native Creation Ratification delivery

## Problem

The existing docs-only ratification PR must be brought to a revision-bound, owner-reviewable merge state without rewriting the owner-authored rulings or modifying downstream epic `native-creation`. Earlier attempts were tracked under `pr-review-batch`; this lane now owns PR #1561 only.

## Solution

Audit every PR review surface and the full docs diff, reconcile the branch with current `origin/main`, verify strategy links/anchors and docs packaging, obtain an independent exact-SHA standards/spec review with an explicit package-abstraction verdict, then generate the required present-PR and proof artifacts and raise one protected merge decision.

## Decisions

- Protected boundary: yes. The PR ratifies product direction and architectural/automation authority documents, so final merge requires exact-SHA owner approval.
- Rulings are fixed input and must not be rewritten.
- Diff is docs and Beads metadata only; no runtime behavior or UI changes. UI video is not applicable.
- No new PR, force-push, branch deletion, or merge.

## Flag / Abstraction

- Needed?: No runtime flag; documentation ratification only.
- Rollback: revert the final PR commits before downstream implementation relies on the ratification.
- Abstraction: independent review must explicitly PASS or BLOCK the package-abstraction gate, including inspection of `packages/workspace/docs/PLUGIN_SYSTEM.md` and governing ratified contracts.

## Test Seams

- Highest seam: strategy-document graph, relative links/anchors, docs packaging, and correspondence between rulings, DIRECTION, downstream plan references, and PR description.
- Proof: `scripts/check-strategy-docs.sh`, repository link/anchor checker discovered in-tree, relevant docs/package checks, GitHub CI, and current-main integration validation.
- Avoid: application/UI tests that cannot exercise a docs-only change; do not claim skipped jobs as proof.

## Acceptance

- All PR comments, reviews, inline comments, Factory verdicts, and CI history are audited; every finding is resolved or named as a blocker.
- Branch is conflict-free with current `origin/main` and pushed without force.
- Link/anchor and docs packaging checks pass at the committed head.
- No stale operative reference treats PR #1548 as active authority; historical/folded references remain accurately labeled.
- Independent exact-SHA standards/spec review is clean, thermo is correctly marked docs-exempt, and package-abstraction verdict is explicitly PASS.
- Present-PR HTML, show-me/proof record, and PR Owner Review card are revision-bound and owner-accessible.
- Exactly one merge-approval Inbox card is raised; Orchestrator never merges.

## Proof

- Exact commands and outputs are recorded in the Bead handoff and PR proof comment.
- GitHub checks and run-history failures/reruns are linked.
- UI evidence: N/A (docs-only; no UI behavior/appearance change).
- Integration proof names current main SHA and validated candidate SHA.

## Slices

### Slice: Audit and verify
**Delivers:** Full review/CI/diff audit, current-main reconciliation if needed, link/anchor and docs packaging verification, surgical repairs only.
**Blocked by:** None.
**File scope:** Existing PR docs and `.beads/issues.jsonl` only when a verified defect requires repair; no ruling rewrite.
**Proof:** Exact local checks, git/PR evidence, clean worktree, pushed SHA.

### Slice: Independent exact-SHA review
**Delivers:** Standards/spec verdict, docs thermo exemption, explicit package-abstraction PASS/BLOCKED, and finding dispositions at the audit slice SHA.
**Blocked by:** Audit and verify.
**File scope:** Review/handoff records only; repairs return through the same owned PR scope.
**Proof:** Reviewer identity/session, exact SHA, commands/context inspected, verdict.

### Slice: Package owner handoff
**Delivers:** Present-PR HTML, show-me actual-diff view, proof/Owner Review PR comment, final CI/current-main status, and protected risk classification.
**Blocked by:** Independent exact-SHA review.
**File scope:** `.handoff/`, `docs/issues/1561/`, and PR body/comments only.
**Proof:** Artifact paths open in Workspace, PR comment URL, exact head SHA, final checks.

## Out of Scope

- Implementing downstream epic #1562 / `native-creation` beads.
- Rewriting or reopening owner rulings.
- Merging PR #1561 or modifying PR #1548.

## Open Questions

None. Technical failures are repair work; a product/security/contract blocker is escalated only if independent review proves one.
