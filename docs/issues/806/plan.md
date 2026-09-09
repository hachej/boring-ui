---
github: https://github.com/hachej/boring-ui/issues/806
issue: 806
state: historical
track: owner
flag: not-needed
updated: 2026-08-27
---

# gh-806 — historical Decision-26 inbound MCP plan

## Status

This file is a tombstone, not canonical or dispatch authority.

The former #806 plan recut Decision-26 Step-1B around a server-selected Agent,
static product binding, a separate admission/controller shape, and a
Decision-26 Bead chain. Decision 28 and the 2026-08-26 combined MCP program
supersede those contracts. None of the former shared-authority statements,
readiness claims, implementation slices, trigger conditions, Beads, or review
records may dispatch work or be used as dependencies.

The complete historical document remains recoverable from repository history at
`e95b683fa3ca68cccd01531da698914da820493f:docs/issues/806/plan.md`. It is
research evidence only.

## Current authority

- Direction and sequencing:
  [`../../direction/DIRECTION.md`](../../direction/DIRECTION.md)
- Frozen architecture and ordering:
  [`../../plans/long-term/ratified/ARCHITECTURE-PLAN.md`](../../plans/long-term/ratified/ARCHITECTURE-PLAN.md)
- Reconciliation invariants:
  [`../../plans/long-term/ratified/RECONCILIATION.md`](../../plans/long-term/ratified/RECONCILIATION.md)
- Canonical inbound MCP Access:
  [`external-workspace-mcp-plan.md`](external-workspace-mcp-plan.md)
- Canonical outbound Composio Connector:
  [`../900/plan.md`](../900/plan.md)

Any future #806 implementation must be dispatched from the canonical inbound
plan after its combined-plan, owner, frozen-DAG, and slice-specific gates. It
must not recreate the retired Decision-26 controller, task ledger, or Bead
chain.
