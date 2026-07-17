> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P7-multi-agent-inspection — Plan

Status: post-v1; not a #391 v1 exit gate. Route/scope/catalog/info are the
first slice; search, external hooks, and subagent grants are later slices.

> Phase: Phase 7 — Multi-agent routing/session/search · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [05-multi-agent-sessions-hooks.md](../../architecture/05-multi-agent-sessions-hooks.md) — the full requirement set: workspace agent registry, route/session-namespace scoping, session search (#379), external harness hooks (#380), and the checkable Tests list.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the steering surface: the workspace consumes the same public contracts (the scrubbed agent-list endpoint plus `/info`), never private core hooks; two-handles rule.

## Design context
Phase 7 makes agents individually addressable within one workspace. It owns the
first registry-backed routing layer, whose entries are stateless P6-R outputs;
P6-R itself remains registry-free. Routes resolve trusted `agentId` against
that P7 host registry. Internal stores/caches use a validated
structured scope containing tenant/workspace, agent, and public session id;
UUID uniqueness is not authorization. Each agent gets its own catalog and
readiness. Route/scope/catalog/info form the first P7 slice; derived `agent.db`
search, external hooks, and subagent grants are separately reviewable later
slices.

## Deliverables
Post-v1 P7 keeps JSONL compatibility for the default agent while using
structured trusted scope for authorization and derived `agent.db` indexes.

v2 additions:
- surface adapters address agents through the same `agentId` scoping; a Slack channel or embed binds to one `agentId` per addressing entry;
- **agent steering endpoints**: `GET /api/v1/agents` (scrubbed declared-agent
  list from the P7 host registry) and `GET /api/v1/agents/:agentId/info` (model,
  tools, readiness, channels, environments — eve `/eve/v1/info` analog)
  consumed by workspace panels. P7 creates this registry only for its named
  multi-agent routing consumer; it does not move persistence into P6-R.

## Exit criteria
As v1, plus: two surfaces bound to two agents in one workspace do not collide by namespace/scope/metadata; no implementation relies on duplicate `sessionId` store keys.
