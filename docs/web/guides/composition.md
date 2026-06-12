# Composition guide

This page shows how the three packages fit together in a real app shell.

## Mental model

- core provides the application foundation
- agent provides coding-agent runtime and chat
- workspace provides IDE-style UI structure

## Server composition

For the full app-shell path, use the composed server surface from core:

```ts
import { createCoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

const app = await createCoreWorkspaceAgentServer({
  // config, plugins, stores, and runtime options live here
})
```

Use lower-level `createCoreApp(...)` + `registerAgentRoutes(...)` only when you
intentionally need custom wiring across core, workspace, and agent. The
composed server surface is the safe default.

## Frontend composition

For the common app-shell path, use the composed front surface from core:

```tsx
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'

export function App() {
  return (
    <CoreWorkspaceAgentFront
      apiBaseUrl=""
      chatEntryMode="chat-first"
      plugins={[]}
    />
  )
}
```

That component composes the core shell, workspace runtime, and injected chat
surface for the standard boring-ui app shape.

If you need lower-level control, the layering is still:
- core for config/theme/auth/workspace identity
- workspace for layout and plugin host
- agent for the chat panel

## Why this composition works

- core owns auth and app-wide providers
- workspace owns panel/layout orchestration
- agent owns the chat runtime and UI

Each package contributes one layer without collapsing boundaries.

## Standalone agent shape

Agent can also run without core:

```ts
import { createAgentApp } from '@hachej/boring-agent/server'

const app = await createAgentApp({ mode: 'direct', workspaceRoot: process.cwd() })
await app.listen({ port: 3000 })
```

That is useful for the CLI/product shape where no app-shell persistence is needed.

## Common mistake to avoid

Do not put database-backed workspace concerns into agent or workspace internals. If the feature needs durable identity or membership state, core should own it and inject any required adapters.

## See also

- [Architecture overview](../architecture/overview.md)
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Core package](../packages/core.md)
- [Agent package](../packages/agent.md)
- [Workspace package](../packages/workspace.md)
