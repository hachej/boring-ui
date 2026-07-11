# AC1-agent-consumption-contract — Plan

Status: decision settled ([DECISIONS.md #22](../../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges))
— canonical tracker is issue
[#636](https://github.com/hachej/boring-ui/issues/636). This stub reserves the
workpackage; the issue owns scope detail.

> Phase: Phase AC1 — agent consumption contract (types with P6-R; contracted
> mode after ID1)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Goal

Implement Decision 22: one A2A-shaped consumption contract; bindings
UI / MCP / HTTP API / CLI / native-internal / A2A-future; subagent vs
contracted consumption modes; governed-projection context flow.

## Scope (detail in issue #636)

1. Contract types in the contracts layer — task lifecycle incl.
   `input-required`, `contextId`, messages/parts, artifacts.
2. Native internal binding via resolver (agent A consumes agent B two-way).
3. Consumption modes in `AgentDefinition`: subagent (caller workspace) /
   contracted (own workspace).
4. Governed-projection briefs — generalize boring-governance
   `filesystemBindings` readonly projection to arbitrary source workspaces.
5. Spec items: `input-required` timeouts, cycle/depth guards, actor audit
   model, schema versioning.

## Sequencing

- Contract types land with/before P6-R.
- Subagent mode near M1.
- Contracted mode + projections gated behind ID1.

## Dependencies

- P1 / P6-R — the contracts layer and deployment resolution the types land
  beside.
- [ID1](../ID1-agent-identity/PLAN.md) — gates the contracted mode (external
  consumers are regular principals + workspaces).

**Layering constraint (Decision 22):** subagent and contracted modes are layers over ONE consumption pipeline (workspace-binding parameter + governance projection + metering) — never forked code paths. MCP is a door, not a distribution vector; external third parties contract agents from their own signed-up workspace.
