> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# P0-adr — Plan

> Phase: Phase 0 — ADR, naming lock, invariant update · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — intent/strategy, package-ownership table, non-negotiable invariants, and the open-decisions list this ADR ratifies.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the 11 locked decisions + the four-part surface contract + north star this phase records into `docs/DECISIONS.md`.
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) — backing detail for decision 7 (environments as attachable resources).

## Design context
Phase 0 writes zero product code. It ratifies the plan-pack architecture into the repo's durable decision registry (`docs/DECISIONS.md` — the ADR surface; there is no separate `docs/adr/` tree) and points issue #391 at the v2 pack so Phase 1 starts from a ratified contract. Core decision: `@hachej/boring-agent` becomes a headless, surface-agnostic model/session/tool core with **zero value imports** from `@hachej/boring-bash`; boring-bash owns fs/exec/file-UI/runtime-mode resolution; boring-sandbox owns concrete providers, lifecycle, capability facts, and mounts; surfaces (workspace UI, Slack, spreadsheet, CLI) are thin ingress/egress adapters over one event-stream contract. The 11 locked decisions from `08`, plus the v2 north star and the EU-sovereign invariant, are recorded with an explicit `decided`/`deferred` status and a source pointer. Runtime docs and the §7e pairing invariant are annotated so nothing implies a pure/headless agent needs a Workspace+Sandbox pair. Everything here is ratification of existing design — no new decisions are invented.

## Deliverables
- ADR: `@hachej/boring-agent` becomes runtime-free **and surface-agnostic**; `@hachej/boring-bash` owns files/bash/file UI; surfaces are thin adapters (08).
- Update `docs/DECISIONS.md` §7 and `packages/agent/docs/runtime.md`.
- Lock package name: `@hachej/boring-bash` **[landed — package exists]**.
- Namespace semantics: one `/workspace` view superseded by named `(filesystem, path)` bindings **[landed via #416; pack already carries the V1 caveat]**.
- Lock v2 decisions from 08: event envelope over AI-SDK chunks; pure mode via sealed pi harness; per-channel surface packages; readonly fs is v1 (resolved); three-package runtime stack (`boring-agent` ← `boring-bash` ← `boring-sandbox`).
- State that the old monolithic plan is superseded by this plan pack, and that 08 supersedes the surface-related open decisions in 00.

## Exit criteria
- ADR accepted; plan pack (incl. 08) thermo-reviewed; issue #391 points to the v2 pack.
