# P6-plugin-child-app — Plan

> Phase: Phase 6 — Plugin and child-app integration (split into P6a / P6b) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [04-plugin-child-app-runtime.md](../../architecture/04-plugin-child-app-runtime.md) — child-app target, "consume, do not define" the shared child-app platform, plugin manifest requirements, hosted fail-closed, `RuntimePluginContext`, shared per-workspace runtime, hot reload.
- [05-multi-agent-sessions-hooks.md](../../architecture/05-multi-agent-sessions-hooks.md) — the workspace agent registry / `agents: [...]` declaration P6a seeds and Phase 7 consumes.

## V1 scope correction (binding, 2026-07-09)

- **P6-D (after P1):** behavior-only versioned `AgentDefinition`, separate
  versioned `AgentDeployment`, canonical definition/deployment digests, and a
  minimal immutable bundle-version Map. Deployment carries only opaque
  `environmentAttachmentRefs`, so this slice has no E1/boring-bash dependency.
- **P6-R (after E1 + P5a + P3 BBP3-020):** pure host resolver to immutable
  `ResolvedAgent`; it consumes P3's workspace-level activated-plugin snapshot
  without adding a plugin loader or per-agent policy. Session snapshot records
  definition, deployment, plugin, and resolved-snapshot identity; a durable
  immutable generation store keeps sessions reproducible across reload/restart
  while their generation remains active. V1 runs one boot-time host/plugin
  generation per dedicated site: a different generation drains and durably
  retires prior-generation sessions instead of adding multi-generation request
  routing. Resolution stages only; routing reads a host-owned completed-
  generation pointer, so D1 has one publication authority.
- **Post-v1:** manifest requirements/skill filtering, hosted plugins, shared
  runtime/reload, per-agent plugin composition, and child-app scoping. Plugin
  UI/routes wait for P7's trusted `agentId` routing.

## Design context

V1 uses P6 only to establish canonical definition/deployment data and host
resolution. Plugin and child-app generality are retained below as post-v1 work;
they cannot delay A1 or D1.

Definitions contain behavior and requirements only. Environment attachments,
runtime/model/sandbox/governance policy, exposure, tenant roots, hostname, seed
sources, and pricing do not belong to `AgentDefinition`. V1 also rejects
`pluginRefs`; the post-v1 composition bead introduces that field with its
resolver under an additive schema version.

P6-D validates/digests attachment reference ids only. P6-R is the first layer
that resolves those ids to E1 attachments and policy facts.

## Deliverables

### P6-D/P6-R — v1
Definition/deployment schemas, canonical digests, bundle-version registry,
immutable resolved snapshot/digest consuming P3's activated-plugin snapshot,
source-labeled static prompt plan/digest, current pointer registry, durable
immutable generation store with content-addressed host/plugin artifact pins,
owner-keyed pin acquisition/deletion recovery journal, active-authority
requirement validation, one-generation transition/session-retirement contract,
and session definition/deployment/plugin/resolution metadata. A1 and D1 are the
concrete consumers.

### Plugin core expansion — post-v1
Import-free manifest validation, skill filters, plugin runtime context, hosted
mode, shared runtime/reload, and per-agent composition. Agent-scoped
tools/skills/MCP may resolve after P6-R; workspace UI/routes require P7 routing.

### Phase 6b — child-app / Macro scoping (follow-up outside the epic exit)
Consume the resolved child-app context and narrow Macro requirements only after
#376 exports the owner-approved type. No local fallback shape. This work is
post-v1 and never gates P8.

### Deferred design notes

**Amendment (2026-07-06, #550 gap 10) — plugin-owned migrations trigger:** `PostgresModelBudgetStore` and migrations 0015/0016 live in core because core owns drizzle. That stays the model for now. **Trigger to revisit:** if internal plugins multiply and need their own tables, design plugin-owned migration infra then — P6 does not build it, and no P6 bead may add a second migration owner in the meantime.

## Exit criteria

### V1
Separate versioned schemas and deterministic definition/deployment/resolved
digests; immutable resolved snapshot and static prompt plan; A1 local
development and D1 dedicated delivery consume the same bundle; no behavior
field has a second source of truth; a retained session can reconstruct only its
pinned generation after reload/restart and never drifts to the current agent
pointer.

### Phase 6b (when unblocked)
Child-app/workspace-kind requirement narrowing; Macro requirements do not leak into a generic workspace.
