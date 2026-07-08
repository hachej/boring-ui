# M2-mcp-agent-surface - Plan

> Phase: Phase M2 - MCP as an agent surface · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) - MCP as a committed agent surface, four-part surface contract, two-handles rule.
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) - duality with E2 environment projection; M2 exposes an agent, E2 exposes an environment.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - canonical `AgentDefinitionDeclaration` and `AgentRegistry`.
- [P7-multi-agent-inspection](../P7-multi-agent-inspection/TODO.md) - declared-agent registry and `/info` endpoint.
- [T1-durable-events](../T1-durable-events/TODO.md) and [T2-transport](../T2-transport/TODO.md) - durable stream, `resolveInput`, and public transport.

## Design context

M2 turns the M1 outreach sidecar into a registry-driven surface. An MCP endpoint
is mounted per agent from the canonical `AgentDefinitionDeclaration`; it is not a
separate vertical-agent schema. The endpoint uses the same public agent contract
as workspace, Slack, and embeds. M1's `ManagedAgentVerticalConfig` may survive
only as a temporary projection derived from the canonical definition.

M2 is the ingress dual of E2. E2 projects an environment over MCP; M2 exposes a
boring agent over MCP. They can reuse SDK transport patterns, but the authority
model is different: M2 never exposes raw environment tools unless the agent
definition and resolved environment facts grant them through the normal agent.

## Deliverables

- Per-agent MCP mount config derived from the P6a definition registry.
- Auth modes: `bearer` and `public-demo`.
- `demoPolicy`, `exposureId`, and exposure URL/result URL shape carried from the definition or a lossless projection.
- MCP result/share URL shape documented and tested: no absolute paths, no raw workspace/session roots, no secrets.
- Conformance proof that the MCP surface resolves agents through P7 registry/info and drives sessions through T1/T2 transport.
- M1 projection migration note: no hardcoded production demo verticals outside fixtures.

## Exit criteria

- A stock MCP client can connect to a per-agent MCP endpoint selected by `agentId`.
- Bearer mode requires valid tenant/workspace authority; public-demo mode obeys `demoPolicy`.
- Delegation creates sessions through the public transport and streams/replays through T1/T2.
- Result payloads expose final text plus safe artifact/share URLs only.
- The endpoint config comes from `AgentDefinitionDeclaration` or a lossless projection.
