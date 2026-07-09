# P8-verification — Plan

## V1 gate correction (binding, 2026-07-09)

P8 gates P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R, A1, and D1.
It executes and records the <=15-minute golden path, crash-safe idempotent
reapply, definition/deployment/resolved digests, and complete-snapshot rollback
proof. P4, E2, X1, P5b, P6 plugin/child-app expansion, P7, M2,
D2, S3, and S4 are explicitly post-v1 and do not gate P8.

> Phase: Phase 8 — Verification + cleanup · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) — the tests/review/acceptance regime P8 sweeps to green (invariant scripts, import audits, full build+test).
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the four-part surface contract + `createAgent()` façade P8 documents as the stable public API.

## Design context
Phase 8 is terminal v1 verification, not a deferred-deletion dump. Import
migrations happen in their owner PRs; surviving markers reopen the owner. P8
documents the public contract and runs the product golden path. It does not
require post-v1 presentation, mount, shared-tenancy, or control-plane work.

## Deliverables
Assert zero removal markers, update package docs, run the v1 component gates,
and execute the A1-to-D1 product proof. Track post-v1 work explicitly.

## Exit criteria
- Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants`.
- `@hachej/boring-agent` README documents the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- Remaining plan tasks converted into tracked beads/issues — nothing left only in prose.
- No code imports old moved paths for delivered P2/P3/T1/T2 relocations.
- All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.
- Executable A1→D1 proof records <=15 minutes, zero platform-source edits,
  source-checkout-independent materialization, all identity digests, idempotent
  reapply, complete-snapshot rollback, and secret-canary absence.
