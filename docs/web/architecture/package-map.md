# Package map

This page answers a common contributor question: **where should this code live?**

## `@boring/core`

Put code here when it involves:

- users
- sessions tied to auth
- workspace membership and invites
- database schema or migrations
- config loading / validation
- Fastify app bootstrap for the app shell
- frontend app-wide providers such as auth/config/theme shell
- capabilities aggregation

Examples:
- `createCoreApp()`
- `loadConfig()`
- workspace CRUD
- invite acceptance
- current-user APIs

## `@boring/agent`

Put code here when it involves:

- LLM conversation loop
- tool registration or execution
- harness, catalog, workspace/sandbox runtime interfaces
- chat streaming
- agent session handling
- standalone agent app / CLI behavior
- execution mode adapters
- agent-side file, shell, or tool HTTP surfaces

Examples:
- `ChatPanel`
- `useAgentChat()`
- `createAgentApp()`
- `registerAgentRoutes()`
- `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`

## `@boring/workspace`

Put code here when it involves:

- layouts
- Dockview shell behavior
- panel registry
- plugin output contracts
- command palette entries
- catalog and surface resolver behavior
- UI bridge client behavior
- plugin-owned frontend/server/shared code

Examples:
- `WorkspaceProvider`
- `IdeLayout`
- plugin `panel`, `left-tab`, `command`, `catalog`, `surface-resolver`

## Smell checks

### If it needs the database
It probably belongs in core.

### If it must run in standalone agent mode
It probably belongs in agent.

### If it is about opening panels, tabs, or workspace surfaces
It probably belongs in workspace.

### If shared workspace code wants to import agent internals
Stop and check the invariant. Base workspace front/shared code should stay agent-neutral.

## Cross-package composition

Typical app-shell composition looks like:

1. core boots server and auth
2. agent routes mount into the server
3. workspace renders layout and injected chat UI
4. app-specific routes or pages compose on top

See also:
- [Architecture overview](./overview.md)
- [Composition guide](../guides/composition.md)
