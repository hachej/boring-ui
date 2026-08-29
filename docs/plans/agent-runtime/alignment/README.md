# Alignment

This area holds the cross-plan reconciliation record: who owns what across
the agent-runtime planning set, which older work packages are still worth
doing versus superseded, and — the live document — what the adversarial
alignment audits found and how each conflict was resolved.

## Files

- `CONTRADICTIONS.md` — **start here.** The 2026-08-26 alignment audit of the
  multi-agent pack against the ratified plan and this absorbed set: three
  confirmed conflicts (relay mechanism, storage-shape suspension,
  per-workspace fleet assumption), each with its applied resolution, plus the
  running per-area review verdict table.
- `OWNERSHIP.md` — the historical plan ownership map (July 2026).
- `ROADMAP-ALIGNMENT.md` — the work-package alignment matrix (July 2026).

## Status

`CONTRADICTIONS.md` is live and grows as area reviews conclude. The ownership
map and alignment matrix are frozen July records carrying **Historical — do
not dispatch** banners; sequencing authority for everything they mention
lives in `docs/direction/DIRECTION.md`.

**Current-truth ledger for the frozen files** (2026-08-26 area review —
where reality moved past them):

- Sessions belong to the **Agent** (session records + gateway, D29 /
  `VISION.md` invariants) — not to the Workspace as both files assume.
- **#805** fleet-package plan: A1 shipped; the remainder is reference-only
  per DIRECTION — not "active".
- **#808** is closed, replaced by **#1012** for sandbox/remote work.
- The **F0b inventory refresh** is done (`F0B-INVENTORY.md`, PR #1388
  merged) — not future work.
- **Hosted default-agent persistence shipped** (PR #1156, Wave 1 closed) —
  not scheduled.
- **Durable events/replay is not "later"**: Level-D durable streams are the
  current pre-engine keystone (D29 addendum, premise [durable-streams]).
- **Workspace-local collaboration is not F7-sequenced** any more — it sits
  behind durable streams, the thread-storage spike, and audit-grade
  attribution.
- **Billing/pricing authority moved to the tenant repositories**; the
  platform keeps only neutral usage facts.
- The `docs/issues/391/` folder the ownership map points at is a pointer
  stub; the planning docs live in this pack.
