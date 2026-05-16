# `@boring/agent`

`@boring/agent` is the coding-agent package: runtime, tools, chat UI, and standalone app shape.

## What it owns

- agent harness and tool loop
- tool catalog
- chat transport and streaming
- session behavior
- workspace/sandbox runtime abstractions
- execution modes
- embeddable chat UI
- standalone CLI/app behavior

## Execution modes

- `direct` — no isolation, local-dev friendly
- `local` — host filesystem plus `bwrap`
- `vercel-sandbox` — remote Firecracker microVM

These modes preserve the same mental model while swapping adapters underneath.

## Core runtime model

The package is organized around four core abstractions:

- Harness
- Catalog
- Workspace
- Sandbox

The important rule is that workspace and sandbox swap as a paired runtime mode adapter so the filesystem view stays coherent.

## What it provides to apps

- `ChatPanel`
- `useAgentChat()`
- `useSessions()`
- server route registration / app creation
- tool execution surface (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`)

## Important boundary

Agent is standalone-capable. It should not require runtime imports from core to function as a product on its own.

## Typical usage

Embedded:

```ts
import { registerAgentRoutes } from '@boring/agent/server'
await app.register(registerAgentRoutes)
```

Standalone:

```ts
import { createAgentApp } from '@boring/agent/server'
const app = await createAgentApp({ mode: 'local', workspaceRoot: process.cwd() })
```

## Related docs

- canonical spec: `packages/agent/docs/plans/agent-package-spec.md`
- package docs: `packages/agent/docs/`
- [Composition guide](../guides/composition.md)
