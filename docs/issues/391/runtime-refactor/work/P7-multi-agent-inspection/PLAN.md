# P7-multi-agent-inspection — Plan

> Phase: Phase 7 — Multi-agent routing/session/search · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [05-multi-agent-sessions-hooks.md](../../architecture/05-multi-agent-sessions-hooks.md) — the full requirement set: workspace agent registry, route/session-namespace scoping, session search (#379), external harness hooks (#380), and the checkable Tests list.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the steering surface: the workspace consumes the same public contracts (the scrubbed agent-list endpoint plus `/info`), never private core hooks; two-handles rule.

## Design context
Phase 7 makes agents individually addressable within one workspace. Routes resolve a validated `agentId` per request via the canonical `/api/v1/agents/:agentId/...` path-prefix family (locked at pass 3 — no header form) against the Phase 6a `AgentRegistry`; unknown agents fail closed. `agentId` enters the binding scope `key` for all agents and the `sessionNamespace` for non-default agents only (the default agent keeps its pre-P7 namespace so on-disk JSONL sessions load unchanged). Each `(workspaceId, agentId)` gets its own tool catalog and `ReadyStatusTracker`. It adds a boring-bash-free scoped session-search API, external-harness hook target resolution routed onto the single T1 approval channel, the public `GET /api/v1/agents` list endpoint plus `/info` inspection endpoint (the steering mechanisms S3 consumes), surface adapters binding one `agentId` per addressing entry, and the first real subagent environment grant (E1-deferred BBE1-005). No competing registry — it scopes against Phase 6a's.

## Deliverables
Unchanged from v1 (`agentId`-scoped routes against the Phase 6a `AgentRegistry`; per-agent catalog/readiness; scoped session search; external hook target resolution). The binding/route scope key includes `agentId` for **all** agents; **`sessionNamespace` includes `agentId` for non-default agents only — the default agent keeps its pre-P7 `sessionNamespace` unchanged** as an explicit on-disk JSONL-compatibility exception.

v2 additions:
- surface adapters address agents through the same `agentId` scoping; a Slack channel or embed binds to one `agentId` per addressing entry;
- **agent steering endpoints**: `GET /api/v1/agents` (scrubbed declared-agent list from the Phase 6a registry/declaration) and `GET /api/v1/agents/:agentId/info` (model, tools, readiness, channels, environments — eve `/eve/v1/info` analog) consumed by workspace panels: the steering-surface mechanism (08, 00 "North star").

## Exit criteria
As v1, plus: two surfaces bound to two agents in one workspace do not collide.
