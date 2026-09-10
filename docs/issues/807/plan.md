---
github: https://github.com/hachej/boring-ui/issues/807
issue: 807
state: historical
updated: 2026-08-26
flag: not-needed
track: owner
---

# gh-807 — historical Decision-26 task/replay plan

## Status

This file is a tombstone, not canonical or dispatch authority.

The former #807 plan proposed a separate `taskId`/`AgentTask` admission
lifecycle, request fingerprints, `agent.db` replay authority, and a Step-1B MCP
consumer. Those contracts conflict with the frozen Decision-28 architecture:
A2a per-session record authority, the sole RequestKey-derived C6 host envelope,
C7 Seat/session projection, and canonical event projections. None of the former
slices, gates, acceptance criteria, Beads, or “current/canonical” language may
be implemented or used as a dependency.

The complete historical document remains recoverable from repository history at
`46fb4431def4a2f96ca3586ea15c08f5d02196ff:docs/issues/807/plan.md`. It is
retained there as research evidence only.

## Current authority

- Frozen architecture and ordering:
  [`../../plans/long-term/ratified/ARCHITECTURE-PLAN.md`](../../plans/long-term/ratified/ARCHITECTURE-PLAN.md)
- Reconciliation invariants:
  [`../../plans/long-term/ratified/RECONCILIATION.md`](../../plans/long-term/ratified/RECONCILIATION.md)
- Inbound MCP Access:
  [`../806/external-workspace-mcp-plan.md`](../806/external-workspace-mcp-plan.md)
- Outbound Composio Connector:
  [`../900/plan.md`](../900/plan.md)

Any future #807 durability work requires a fresh owner-approved recut over
A2a/C6/C7. It must project the canonical per-session record and envelope rather
than recreate the retired task ledger.
