# M2-mcp-agent-surface — Plan

Status: priority-2 recut required after M1 + AR1. D1 uses the existing
HTTP/workspace surface and does not depend on M2.

> **Dispatch supersession (2026-07-11).** The registry/P7/T1/T2 design below is
> non-dispatchable history. Recut the smallest canonical MCP surface that
> consumes the M1 ingress and AR1 destination-local artifact contract without
> waiting for P7, T2, generic E1 attachments, or a control plane. Preserve
> bearer/workspace authority, bounded payloads, idempotency, and stable errors.

> Phase: Phase M2 - MCP as an agent surface · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) - MCP as a committed agent surface, four-part surface contract, two-handles rule.
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) - duality with E2 environment projection; M2 exposes an agent, E2 exposes an environment.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - canonical
  `AgentDefinition`/`AgentDeployment` and resolved-agent registry.
- [P7-multi-agent-inspection](../P7-multi-agent-inspection/TODO.md) - declared-agent registry and `/info` endpoint.
- [T1-durable-events](../T1-durable-events/TODO.md) and [T2-transport](../T2-transport/TODO.md) - durable stream, `resolveInput`, and public transport.

## Design context

M2 turns the M1 outreach sidecar into a registry-driven surface. An MCP endpoint
is mounted from host/deployment-owned `McpAgentExposureConfig` and delegates to
the matching immutable `ResolvedAgent`; exposure is not agent behavior and is
absent from `AgentDefinition`. The endpoint uses the same public agent contract
as every other surface. M1's `ManagedAgentVerticalConfig` may survive only as a
temporary projection whose behavior comes from the canonical definition and
whose exposure fields come from host deployment config.

**Amendment (2026-07-08):** M2 `demoPolicy`/`exposureId` must also be reusable
as the D2 per-tenant subdomain trial gate, not only as a per-agent MCP mount.

M2 is the ingress dual of E2. E2 projects an environment over MCP; M2 exposes a
boring agent over MCP. They can reuse SDK transport patterns, but the authority
model is different: M2 never exposes raw environment tools unless the agent
definition and resolved environment facts grant them through the normal agent.

## Deliverables

- Per-agent MCP mount config derived from `AgentDeployment` plus host-owned
  exposure policy and bound to a `ResolvedAgent`.
- Auth modes: `bearer` and `public-demo`.
- `demoPolicy`, `exposureId`, and exposure URL/result URL shape carried only by
  deployment/host exposure config.
- Per-tenant subdomain trial-gate projection for D2 using the same `demoPolicy`/`exposureId`.
- MCP result/share URL shape documented and tested: no absolute paths, no raw workspace/session roots, no secrets.
- M1's caller-stable subject-scoped idempotency, dedupe-before-quota/conflict,
  and explicit input/progress/poll/final/artifact/aggregate byte budgets remain
  mandatory in this canonical surface; public-demo uses a host-issued demo
  principal rather than an unscoped global key.
- Conformance proof that the MCP surface resolves agents through P7 registry/info and drives sessions through T1/T2 transport.
- M1 projection migration note: no hardcoded production demo verticals outside fixtures.

## Exit criteria

- A stock MCP client can connect to a per-agent MCP endpoint selected by `agentId`.
- Bearer mode requires valid tenant/workspace authority; public-demo mode obeys `demoPolicy`.
- Delegation creates sessions through the public transport and streams/replays through T1/T2.
- Lost-response retry under a new protocol request id returns the original
  delegation, and every MCP payload class is bounded.
- Result payloads expose final text plus safe artifact/share URLs only.
- The endpoint behavior comes from `ResolvedAgent`; exposure comes from a
  validated `AgentDeployment`/host-owned `McpAgentExposureConfig` binding.
