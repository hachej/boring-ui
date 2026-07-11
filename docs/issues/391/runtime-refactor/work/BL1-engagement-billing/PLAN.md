# BL1-engagement-billing — Plan

Status: gap identified by marketplace vision — not started.

> Phase: Phase BL1 — engagement billing (marketplace path, phase 4)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) ·
> Roadmap: [MARKETPLACE-PATH.md](../../MARKETPLACE-PATH.md)

## Goal

Turn engagements into money: pricing on contracted agents, invoice generation
per engagement/task, payout accounting for creators.

## Design constraint

Builds STRICTLY as a decorator on boring-governance's existing metering seam
(`createMeteringSink`, per-model/per-user EUR budgets) per
[Decision 22](../../../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)'s
layering constraint: contracted mode is subagent + binding parameter +
governance projection + metering — never a forked billing code path.

## Scope

- Pricing reference attached to a contracted `AgentDefinition`.
- Invoice generation per engagement/task, derived from metered usage.
- Payout accounting for creators (contracted-agent authors).
- **Workspace token/spend budgets** — the deferred budget work flagged as a
  tripwire in [ID1](../ID1-agent-identity/PLAN.md): open signup + no
  workspace budget = unbounded spend exposure. This must land before or with
  public exposure of contracted-mode agents; BL1 is where it lands.

## Dependencies

- [AC1](../AC1-agent-consumption-contract/PLAN.md) — contracted mode (own
  workspace, governed-projection briefs) is the invocation shape BL1 bills.
- [ID1](../ID1-agent-identity/PLAN.md) — the workspace-budget tripwire BL1
  resolves; also the identity layer invoices attach to.

## Exit (to be specified in beads)

A contracted agent has a pricing ref; completing an engagement/task produces
an invoice traceable to metered usage; the creator's payout ledger reflects
it; workspace-level spend budgets are enforced before any public,
externally-billable exposure ships.
