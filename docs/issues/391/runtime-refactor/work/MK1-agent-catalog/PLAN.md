> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# MK1-agent-catalog — Plan

Status: gap identified — not started.

> Phase: Phase MK1 — agent catalog (marketplace path, phase 4)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) ·
> Roadmap: [MARKETPLACE-PATH.md](../../MARKETPLACE-PATH.md)

## Goal

Discovery: public profiles for contractable agents (name, creator,
capabilities, pricing ref), a browse/search surface, and a per-agent
"contract this agent" entry point.

## Scope

- **v1 (small):** static profile pages rendered from `AgentDefinition`
  metadata — name, creator, capabilities, pricing reference (BL1). No
  dynamic ranking, reviews, or discovery ML.
- Browse/search surface over deployed, contractable agents.
- "Contract this agent" entry point that hands off into the AC1 contracted
  consumption flow.
- **Future:** A2A agent-card export (Decision 22's future A2A binding),
  once an external org needs multi-turn task-driving against hosted agents.

## Dependencies

- [P6-R](../P6-plugin-child-app/PLAN.md) — deployed agents to list; the
  workspace/deployment resolution that makes an `AgentDefinition` live.
- [AC1](../AC1-agent-consumption-contract/PLAN.md) — the contracting
  contract "contract this agent" hands off into.

## Exit (to be specified in beads)

A consumer can browse a catalog of contractable agents, view a profile with
capabilities and pricing, and enter the contracting flow from that profile.
