# Architecture overview

boring-ui v2 is built as three publishable packages with intentionally separated responsibilities.

## Stack order

```text
apps/*  →  @hachej/boring-workspace  →  @hachej/boring-core
  │                  ↑
  └──────→  @hachej/boring-agent
```

There is also an important product view:

- `@hachej/boring-agent` is standalone-capable
- `@hachej/boring-workspace` is the workspace UI layer
- `@hachej/boring-core` is the app foundation that owns persistence and identity

## Package roles

### `@hachej/boring-core`
Owns:
- Postgres/Drizzle data model
- auth via better-auth
- app config loading and validation
- Fastify app factory
- frontend provider shell via `<BoringApp>`
- users, workspaces, invites, membership, capabilities

Core is the only package that owns persistence and identity.

### `@hachej/boring-agent`
Owns:
- coding-agent runtime
- tool execution model
- chat transport and session behavior
- execution modes: `direct`, `local`, `vercel-sandbox`
- embeddable chat UI
- standalone CLI / app shape

Agent is designed to run without runtime dependency on core.

### `@hachej/boring-workspace`
Owns:
- IDE-style layouts and Dockview composition
- plugin registries and panel contracts
- workspace UI bridge
- plugin-owned catalogs, tabs, panels, commands, surface resolvers
- default workspace plugins and app composition helpers

Workspace base code stays agent-neutral; app composition layers may wire agent in.

## The big boundary decisions

### Core owns DB and identity
If something needs durable app-level persistence or user/workspace membership, it belongs in core.

### Agent and workspace stay DB-free
Both packages are designed with injection seams so core or a future cloud package can provide storage-backed implementations without forcing DB code into agent or workspace internals.

### Workspace and agent are composable, not fused
The workspace package can host an injected chat experience, but the workspace package should not hardwire itself to agent internals in shared/base layers.

## Why this split exists

v1 mixed chat, layout, sandboxing, and deploy concerns into a single product shape. v2 separates them so users can adopt only what they need:

- just the agent
- workspace UI plus injected chat
- full app shell with auth and persistence

## Key invariants

- no `node:*` imports in `src/shared/**`
- no `Buffer` in shared code; use `Uint8Array`
- routes and tools receive `Workspace`, not a root path
- path validation belongs to adapters
- workspace and sandbox swap as a paired runtime mode adapter
- `UiBridge.postCommand` is the single dispatch source
- workspace base front/shared code has zero value imports from `@hachej/boring-agent`
- every error has a stable code

## Where to go next

- [Package map](./package-map.md)
- [Getting started](../guides/getting-started.md)
- [Composition guide](../guides/composition.md)
