# #391 vision — typed Workspaces with Workspace-owned agents

> Strategic direction only. [`../plan.md`](../plan.md) is the delivery authority.
> [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md) defines
> ingress, delegation, A2A, and contracted-agent modes.

## North star

A developer can define focused agents as declarative identity/instructions plus
trusted plugins, bind them to a durable Workspace product type, serve the
Workspace through authenticated surfaces, and later compose or contract agents
without changing the Workspace authorization/runtime model.

## Product principles

1. **Core is agent-agnostic.** Core authenticates, verifies membership, and
   persists Workspace facts including `workspaceTypeId`; it does not inspect or
   compose agents.
2. **Workspace owns orchestration.** Workspace resolves static default/allowed
   agent policy, owns one WorkspaceRuntime, and maintains lazy typed agent
   singletons.
3. **Agent executes one type.** Agent receives a requested trusted type and an
   existing WorkspaceRuntime; it never creates a second Workspace/Sandbox.
4. **Product routing is explicit.** Domain narrows Workspace type; membership
   authorizes the Workspace; Workspace type selects server-owned agent policy.
5. **Static before dynamic.** Product policy and installed plugins are validated
   at startup and changed by deploy/restart, not by registry/control plane.
6. **Behavior is trusted code plus declarative instructions.** Authored JSON
   never selects packages, tools, credentials, models, MCP commands, or runtime
   policy.
7. **Shared trust is explicit.** Agents in one Workspace share filesystem,
   process, Sandbox, and runtime authority. Different tools/prompts are not
   isolation.
8. **Identity remains durable.** Workspace type and session acting-agent type
   are trusted metadata; existing history remains readable.
9. **Protocols stay at edges.** UI/MCP/HTTP/CLI/A2A are bindings. Same-process
   collaboration stays native.
10. **Cross-workspace work stays governed.** Contracted agents use separate
    Workspaces, readonly input projections, and returned artifacts—never live
    cross-workspace grants.
11. **One runtime path.** Omitted product policy normalizes to
    `default → primary` through the same orchestrator as explicit hosts.
12. **Generality follows consumers.** Pi packaging, delegation backends,
    durability, extraction, channels, billing, mounts, and marketplace work need
    named pressure and independent approval.
13. **EU-sovereign operation remains possible.** US-hosted providers remain
    optional.

## Delivery horizons

### Horizon 1A — domain-routed default-agent products

- exact domain → persisted Workspace type → authorized Workspace;
- static `defaultAgentTypeId` + `allowedAgentTypeIds` backend policy;
- one shared WorkspaceRuntime and lazy AgentBinding per type;
- human ingress starts with the default only;
- two-agent shared-runtime backend conformance;
- full-app compatibility and Seneca two-product proof.

### Horizon 1B — authenticated MCP

External MCP reaches that same authorized Workspace and server-selected default
agent. MCP is ingress, not distribution.

### Horizon 2 — activate Workspace-local collaboration

Adapt native subagents to the shared WorkspaceRuntime, permit trusted targeting
of allowed types, and retain per-agent/session attribution. Human selector,
switching, and fork UX are separate product choices.

### Horizon 3 — durable/external expansion

Add durable tasks/events/replay/approvals/recovery, external A2A, hardened
transports, runtime extraction, bounded custom sandbox tools, and channels as
real consumers require them.

### Later — contracted agent platform

A contracted agent owns a separate Workspace/Sandbox, receives a governed
readonly projection, and returns artifacts. Identity, billing, budgets, customer
data hygiene, and marketplace UX are separately gated.

## Pi direction

The intended future seam is a Boring Pi package/extension capable of adding
Boring context/tools to any Pi agent. That package does not own Core auth,
Workspace policy, server routes, Workspace/Sandbox lifecycle, provisioning, or
singleton maps. The exact extension API and a Workspace-native `pi-subagents`
executor remain follow-up decisions.

## Explicitly retired

- AgentHost/controller/reconciler/desired-state/deployment-publication
  content-addressed-storage machinery;
- hostname or agent identity as workspace authority;
- authored tool/package/MCP executable catalogs;
- Core-owned agent behavior resolution;
- separate materialized-agent development app;
- multiple Workspace/Sandbox owners inside one Workspace;
- mutable runtime agent registry/control plane.
