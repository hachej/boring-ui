---
github: https://github.com/hachej/boring-ui/issues/1461
issue: 1461
state: ready-for-agent
updated: 2026-09-10
track: delivery
---

# Command Palette Replay Delivery

## Objective

Deliver the completed, pushed Command Palette Replay work at `0dea40589e661bbfe94de791e20f64149fe15ef2` through the existing `epic/command-palette-replay` branch: preserve prior evidence, integrate current `origin/main`, create the one PR, obtain exact-head CI and independent review, then route the final diff under the risk-based policy. Never redo the implementation from scratch, create a second PR, force-push, merge, or modify the canonical batch epic.

Canonical lineage: `wt-391-forward-qbys` under `pr-review-batch`. This delivery epic only references that lineage.

## Known state

- Engineering and 5/5 retained replay proof are complete and pushed at `0dea40589` (tested source `efdb52bca`).
- No PR exists for `epic/command-palette-replay`; all attempted PR #1461 review endpoints return 404 because #1461 is currently the issue number.
- Dirty evidence is intentional pending inspection: `.beads/issues.jsonl`, `factory-epic-request.md`, and `plan-review.html`; none may be deleted.
- `.beads/issues.jsonl` currently parses with 551 unique records and zero duplicate IDs before this delivery graph is committed.
- Current branch carries only `tools/ui-review/**` implementation/tests and `docs/issues/1461/runs-evidence/**` relative to main; no product UI/package source is in the known feature diff.

## Decisions

1. Preserve and commit real evidence before merging main, so conflict resolution has a clean audit boundary.
2. Merge, never rebase/force-push, current `origin/main` into the owned branch.
3. Create exactly one PR with current-main template content, retained replay evidence, lineage, and present-pr artifact.
4. Reuse the completed 5/5 proof unless a code change invalidates it; exact-head CI and independent standards/spec, thermo, and explicit abstraction review remain mandatory.
5. Fix technical failures within scope. Ask the owner only for a genuine protected-boundary decision or exhausted cap.
6. On the exact green reviewed SHA, post `factory: MERGE-READY <sha>` if automatic-eligible; otherwise raise exactly one merge-approval card. The Orchestrator never merges.

## Slices

### 1. Preserve delivery evidence — `wt-391-forward-amnk.1`

Inspect and commit the existing dirty issue evidence and Beads JSONL, with zero duplicate IDs. Push without force. No implementation work.

### 2. Integrate main and open PR — `wt-391-forward-amnk.2`

Blocked by slice 1. Merge current `origin/main`, resolve only real conflicts, push, create the single PR, and generate the present-pr artifact.

### 3. Verify exact PR head — `wt-391-forward-amnk.3`

Blocked by slice 2. Read all PR review surfaces, wait for exact-head CI, repair only technical failures, run relevant checks, and obtain exact-final-SHA standards/spec + thermo + explicit package-abstraction PASS. Maximum four review rounds.

### 4. Classify and hand off PR — `wt-391-forward-amnk.4`

Blocked by slice 3. Compute risk from the complete base-to-head diff, update the PR body/show-me/presentation, and finish at MERGE-READY or one protected-boundary owner card.

## Dependency graph

```text
wt-391-forward-amnk (epic)
  └─ .1 preserve evidence
       └─blocks→ .2 merge main + open PR
                    └─blocks→ .3 exact-head CI/review
                                 └─blocks→ .4 classify + hand off
```

## Proof path

- Evidence integrity: parse `.beads/issues.jsonl`; zero duplicate IDs; retain source/test/evidence SHAs and 5/5 manifests.
- Integration: record current-main SHA, merge SHA, push receipt, conflict-free PR.
- PR: template-conforming body, present-pr artifact, and durable evidence links.
- Verification: exact-head required CI; relevant review-tools tests/typecheck/invariants; independent standards/spec and thermo verdict; explicit abstraction PASS.
- UI evidence: product UI/video remains N/A only if final diff still changes test tooling rather than product UI/CSS; retained Playwright desktop/mobile scenario screenshots and reports remain linked.
- Delivery: deterministic protected-boundary classification, package production line count/exclusions, and exact-SHA MERGE-READY comment or one owner card.

## Risk and rollback

Expected automatic-eligible because known production changes are scenario-local under `tools/ui-review`, with no auth, billing, permissions, secrets, migrations, public/MCP contract, package-boundary, shared design-system, release, deletion-heavy, or `packages/` production-size trigger. This is provisional until recomputed on the final diff after the main merge.

Rollback is a revert of the feature/evidence commits or the eventual PR merge commit. There is no data migration, release, or product-state mutation.

## Plan review / Gate 1 override

The kickoff contains an earlier pre-grant for this repair/delivery lane and a later explicit instruction requiring Gate 1 by the host deadline. The later instruction is treated as authoritative: this graph is gated and no Worker is dispatched before approval. No host-provided independent plan-review mechanism is available; the owner decides from this delivery plan and visual artifact. Existing implementation evidence is preserved rather than re-reviewed during planning.
