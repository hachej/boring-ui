# P8-verification — Plan

> Phase: Phase 8 — Cleanup and deprecation · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) — the tests/review/acceptance regime P8 sweeps to green (invariant scripts, import audits, full build+test).
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the four-part surface contract + `createAgent()` façade P8 documents as the stable public API.

## Design context
Phase 8 is the terminal **verification** phase — not a deferred-deletion dump. Every import migration already happened in-PR under the no-compat policy, so P8 asserts the repo is actually clean rather than doing late cleanup. It wires a repo-wide `TODO(remove:*)` marker gate into `pnpm lint:invariants` (zero markers at exit; a surviving marker reopens the phase of its named deletion-bead owner, never absorbed here), confirms every P2/P3/P4/T1/T2 old-moved-path import gate is present and green, confirms X1 mount gates including `bench:mounts` are green, documents the four-part surface contract + the nine-member `createAgent()` façade as stable public API, and files every deferred/un-beaded plan task as a tracked issue. P8 gates on every prior delivered phase EXCEPT P6b — it only verifies the P6b follow-up issue is filed and never waits on P6b landing (the anti-deadlock guarantee).

## Deliverables
v2 rewrite — Phase 8 is a **verification** phase, not a deferred-deletion dump: assert zero `TODO(remove:*)` markers remain repo-wide (add the check to the invariant scripts); update package docs; convert remaining plan tasks into beads/issues. There is no "migration window" — all import migrations happened in-PR per the no-compat policy. **P8 gates on every prior delivered phase EXCEPT P6b** (P1–P7, T1–T2, E1–E2, **X1**, S1–S3, Phase 5, P6a): P6b is a tracked follow-up (HARD BLOCKED on the shared child-app platform type), so P8 only verifies the P6b follow-up issue is filed and never waits on P6b landing.

## Exit criteria
- Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants`.
- `@hachej/boring-agent` README documents the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- Remaining plan tasks converted into tracked beads/issues — nothing left only in prose.
- No code imports old moved paths (grep gates green for every P2/P3/P4/T1/T2 relocation).
- All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.
