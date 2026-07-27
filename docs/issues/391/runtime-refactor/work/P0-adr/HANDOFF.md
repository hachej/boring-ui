> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# P0-adr — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] (no prerequisites — Phase 0 is the root)

## Beads
- [ ] BBP0-001 — Write the v2 runtime-free + surface-agnostic ADR entry
- [ ] BBP0-002 — Ratify all 11 locked decisions from `08` + the v2 north star
- [ ] BBP0-003 — Annotate runtime docs + §7e pairing invariant
- [ ] BBP0-004 — Draft #391 pointer comment + issue-body reconciliation
- [ ] BBP0-005 — Supersession confirmations inside the plan pack

## Verification commands
- [ ] `grep -o "docs/issues/391/[^) ]*" docs/DECISIONS.md` (and confirm each path exists)
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `git diff --stat` (shows only `docs/**` and `packages/agent/docs/runtime.md`)
- [ ] `gh issue view 391` (if `gh` available — shows the v2 pointer after BBP0-004 posts)

## Review gates
- [ ] Thermo architecture review of the pack (per `README.md` "Review rule") is clean before Phase 1 coding starts: no import cycle, no duplicated provisioning/readiness system, no fs/bash split brain, no cwd leak, no scope leak, no overclaimed issue closure.
- [ ] A reviewer confirms all 11 `08` decisions are recorded with a status and a source pointer, and that §7e's supersession note does not weaken the no-split-brain guarantee for boring-bash-active runtimes.
- [ ] No implementation bead in P1 starts until BBP0-001..005 are merged and #391 points to the v2 pack.

## Exit criteria
- [ ] A new locked decision (the v2 runtime-free + surface-agnostic ADR) is merged into `docs/DECISIONS.md` in the 4-field format, and all 11 locked decisions from `08` are each ratified with a status of `decided`/`deferred`.
- [ ] `packages/agent/docs/runtime.md` no longer implies pure/headless agents require a Workspace+Sandbox pair.
- [ ] `docs/DECISIONS.md` §7e ("Pairing invariant") carries a supersession note scoping the pairing to boring-bash-active runtimes only.
- [ ] Issue #391 body/pointer references the v2 pack; a ready-to-post comment body is drafted in-repo.
- [ ] Supersession confirmations are present in `00` open decisions and `VISION.md` locked decisions where `08`/`09` override older surface/runtime text.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
