# #391 vision — domain-routed agent workspaces and pluggable consumption

> Strategic direction only. [`../plan.md`](../plan.md) is the active delivery and
> dispatch authority. [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md)
> defines the future delegation/MCP/A2A modes.

## North star

A developer can define a focused agent product, bind it to a workspace type,
serve it through a domain and multiple authenticated surfaces, and later compose
or contract agents without changing the workspace authorization/runtime model.

## Product principles

1. **Product routing is explicit.** Domain selects workspace type; workspace type selects allowed agent behavior.
2. **Workspace-first authority.** Authentication and membership—not hostname, type, or agent ID—authorize workspace access.
3. **Workspace type is durable.** It is persisted on the workspace so UI, MCP, CLI, and A2A resolve the same product without depending on hostname.
4. **One runtime owner.** Workspace and Sandbox compose and dispose as one lifecycle pair.
5. **Static before dynamic.** Normal migrations and deployment-static configuration precede registries, install/update APIs, or control planes.
6. **Behavior is server-owned.** Prompts, tools, Pi options, roots, credentials, and runtime handles never become client authority.
7. **Identity stays precise.** Workspace type, acting agent, sessions, prompts, tools, receipts, logs, tasks, and artifacts remain attributable.
8. **Shared trust is explicit.** Multiple agents in one workspace share filesystem/process/runtime authority; different tools/prompts are not isolation.
9. **Protocols stay at edges.** UI/MCP/HTTP/CLI/A2A are bindings; same-process delegation stays native.
10. **Cross-workspace access stays governed.** Contracted agents receive readonly projections and return artifacts; no second live ACL system.
11. **Packages stay acyclic.** Agent contracts import no runtime package values; Workspace composes; Core authorizes; hosts supply policy.
12. **Generality follows consumers.** Durability, extraction, mounts, channels, marketplace, and fleet UX require named product pressure.
13. **EU-sovereign operation remains possible.** US-hosted providers stay optional, never mandatory defaults.
14. **Existing user data survives.** Workspace records, Pi sessions, and published package contracts are compatibility surfaces.

## Delivery horizons

### Horizon 1 — domain-routed single-agent products

- **1A web:** domain → persisted workspace type → one agent type → authorized workspace.
- **1B MCP:** authenticated external MCP reaches the same workspace and sole agent.
- Full-app stays one default type/primary agent.
- Seneca proves two real domain/type/agent products.

### Horizon 2 — several agents in one workspace

A workspace type may allow several agents and one default/selector. Agents share
one workspace runtime and can delegate through existing native subagents while
keeping separate behavior/session attribution.

### Horizon 3 — durable and external expansion

Add durable tasks/events, replay, approvals, recovery, external A2A,
`boring-sandbox`/`boring-bash` extraction, sandbox custom tools, and channels as
real consumers require them.

### Later — contracted agent platform

An agent may contract another agent that owns a separate workspace/sandbox. The
caller supplies a governed readonly projection and receives artifacts. Identity,
billing, budgets, customer-data hygiene, and marketplace UX are separately gated.

## Explicitly retired

The deleted AgentHost controller, revisions/publication engine, active pointer,
reconciler, desired-state store, CAS/content-addressed rollout, compiled
deployment resolution, and hostname-as-authority path are not part of this
architecture. Historical files remain evidence only.
