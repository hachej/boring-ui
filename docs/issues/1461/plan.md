---
github: https://github.com/hachej/boring-ui/issues/1461
issue: 1461
state: ready-for-agent
updated: 2026-09-06
flag: not-needed
track: fast
---

# gh-1461 deterministic command-palette replay

## Problem

Bombadil can begin its instrumented mobile page while the app shell still reflects a different effective viewport. The retained failing run `33182547405` proves the record/replay split before hard gates: recording offered `Open app navigation` at `(28,30)`, while replay offered the top-bar command-palette trigger at `(199.4,23.5)`. Bombadil rejects that changed action set before final-state or hard-gate validation. This is distinct from #1390's navigation settle and mobile hard-gate work.

## Solution

Keep the correction inside the `workspace-command-palette` review scenario. During extraction, compare the actual browser width with the rendered plugin-tabs shell's `data-mobile-shell` contract. If they disagree, signal the shell's existing resize reconciliation and expose only `Wait`; root click actions remain unavailable until the marker agrees. Once aligned, retain the existing safe action policy and user-visible behavior. Bump the scenario revision so old reproduce bundles fail ownership rather than replay under changed semantics.

This is the smallest seam that addresses the observed race: no command-palette product UI, breakpoint, hard gate, CI workflow, or Bombadil dependency changes.

## Decisions

- Reconcile the test browser to the existing `<640px` compact contract; do not invent another readiness definition.
- Gate only root action enumeration. Dialog mode actions remain meaningful and unchanged after the palette opens.
- Use one bounded resize signal per mismatched extraction and `Wait` until agreement; never click a stale-layout candidate.
- Preserve both legitimate entry paths after agreement: compact navigation and the direct palette trigger.
- Retain five complete consecutive proof runs at one fixed source SHA, following #1431's independently inspectable evidence bar.

## Flag / Abstraction

- Needed?: No; tool-only deterministic test behavior.
- Path: Scenario-local boot/action readiness contract.
- Rollback: Revert the implementation commit and its docs-only evidence commit; the prior scenario revision invalidates no current product data.

## Test Seams

- Highest public seam: `createSafeCommandPaletteActions` plus the registered `workspace-command-palette` review command.
- Existing prior art: `exploration.test.ts` pins initial/navigation settle actions; `registry.test.ts` pins replay selection and scenario contracts; #1431 defines retained repeatability evidence.
- Avoid testing: Bombadil internals, arbitrary sleeps, product component implementation details, or relaxed hard gates.

## Acceptance

1. A viewport/shell mismatch offers `Wait` only and requests the existing resize reconciliation; neither of the swapping root candidates is enumerable.
2. A matched compact shell still offers `Open app navigation`; a matched desktop shell still offers `Search catalogs and commands`.
3. Once the command palette is open, Commands/Files/Escape/type actions retain their current safe behavior.
4. Replay ownership uses a bumped spec revision; old bundles cannot be silently reused.
5. Tool unit tests and typecheck pass without product-source or workflow changes.
6. At one fixed source SHA, the exact registered review command passes five consecutive foreground runs; any failure resets the count.
7. Each run retains sanitized logs, selection, manifest, hard gates, reports, screenshots, and reproduce bundles, with aggregate counts and SHA-256 digests.
8. An adversarial fresh review of the exact source SHA is clean or all findings are dispositioned before handoff.

## Proof

- Unit: `pnpm --filter @hachej/boring-ui-review-tools test`
- Types: `pnpm --filter @hachej/boring-ui-review-tools typecheck`
- Exact repeatability command, five consecutive times at one source SHA: `pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-command-palette --critic=fixture`
- Retained path: `docs/issues/1461/runs-evidence/README.md` and `run-01/` through `run-05/`.
- Each run keeps sanitized `output.log`, `selection.json`, `manifest.json`, `hard-gates.json`, `report.md`, `report.html`, selected screenshots, and selected `reproduce/**` bundles. The README records source SHA, evidence commit SHA, exact command, wall duration, exit, hard-gate totals, replay-verification lines, file inventory, and SHA-256 digests. Generated output is captured outside the tracked tree first, then copied, so all five runs test an unchanged source tree.
- Manual inspection: confirm each run shows verified desktop and mobile Bombadil replay, zero hard-gate failures, and the same candidate revision/tree hash. Redact secrets and host paths before commit.

## Slices

### Slice: stabilize palette replay and retain 5/5 proof

**Bead:** `wt-391-forward-qbys.1`  
**Delivers:** Scenario-local viewport/shell readiness, deterministic root action enumeration, regression tests, revision bump, exact-SHA adversarial review, and retained 5/5 proof.  
**Blocked by:** Gate 1 approval only; parent epic `wt-391-forward-qbys`.  
**Proof:** Unit + typecheck + five consecutive exact registered reviews with retained evidence.  
**File scope:** `tools/ui-review/src/review-specs/workspace-command-palette/{bombadil.spec.ts,scenarioActions.ts,spec.ts}`, `tools/ui-review/src/__tests__/{exploration.test.ts,registry.test.ts}`, `docs/issues/1461/runs-evidence/**`.  
**Review budget:** Inside one Worker session; one tool-owned behavior seam and its evidence.

## Out of Scope

- Product command-palette, workspace layout, or breakpoint changes.
- Generic Bombadil changes, retries for arbitrary replay divergence, hard-gate weakening, or CI workflow edits.
- Reopening #1390, chasing unrelated UI Review failures, or changing another epic.

## Risks

- Extractor-triggered resize could loop: only signal on a measured mismatch and prove matched states do not signal.
- A `Wait`-only guard could hide permanent boot failure: the bounded Bombadil run still fails if agreement never occurs; no success fallback or retry is added.
- Evidence can become non-reviewable or alter the tested tree: capture outside the tree, sanitize, hash, then add in a docs-only evidence commit that cites the tested source SHA.
- Five greens can miss a low-rate flake: the requested bar is 5/5 consecutive plus exact replay artifacts; CI remains corroborating evidence, not a substitute.

## Open Questions

None. If implementation proves the resize signal cannot reconcile Bombadil's emulated viewport, stop and return the Bead for re-plan rather than widening into product code.

## Review Record

No host-provided independent plan-review mechanism is available in this Orchestrator session. Per the Factory request, no direct Codex/review loop was substituted; Julien decides at Gate 1 with this plan and visual artifacts.

## Graph Validation

- Canonical DB: `.beads/beads.db` in this epic worktree (`br where` verified).
- `br dep cycles --blocking-only --json`: zero active cycles.
- `bv --robot-insights --label epic:command-palette-replay`: data hash `d8d07432d8393aa6`, two scoped open Beads, zero blocking edges/cycles.
- `br ready --label epic:command-palette-replay --unassigned`: implementation Bead `wt-391-forward-qbys.1` is the sole ready unassigned child; dispatch remains forbidden until Gate 1 approval.
