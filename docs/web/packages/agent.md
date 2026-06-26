# `@hachej/boring-agent`

`@hachej/boring-agent` is the coding-agent package: runtime, tools, chat UI, and standalone app shape.

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

- `ChatPanel` and related UI primitives from the front entry
- session/chat hooks from the front entry
- server route registration / app creation (`@hachej/boring-agent/server`)
- tool execution surface (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`)
- package-added tools such as `upload_file`, `plugin_diagnostics`, and isolated-code execution when that capability is enabled

> UI-aware tools (`get_ui_state`, `exec_ui`) and the `/api/v1/ui/*` routes live in `@hachej/boring-workspace`, not here. Standalone agent ships zero UI surface; hosts that want UI tooling compose via the workspace package.

## Important boundary

Agent is standalone-capable. It should not require runtime imports from core to function as a product on its own.

## Typical usage

Embedded:

```ts
import { registerAgentRoutes } from '@hachej/boring-agent/server'
await app.register(registerAgentRoutes)
```

Standalone:

```ts
import { createAgentApp } from '@hachej/boring-agent/server'
const app = await createAgentApp({ mode: 'local', workspaceRoot: process.cwd() })
```

## Related docs

- package docs: `packages/agent/docs/README.md`
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Composition guide](../guides/composition.md)
