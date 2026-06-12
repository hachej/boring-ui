# Composition guide

This page shows how the three packages fit together in a real app shell.

## Mental model

- core provides the application foundation
- agent provides coding-agent runtime and chat
- workspace provides IDE-style UI structure

## Server composition

Core creates the Fastify app. Agent mounts onto it.

```ts
import { createCoreApp, loadConfig } from '@hachej/boring-core/server'
import { registerAgentRoutes } from '@hachej/boring-agent/server'

const config = await loadConfig()
const app = await createCoreApp(config)
await app.register(registerAgentRoutes)
await app.listen({ port: config.port })
```

This keeps auth, persistence, and user/workspace ownership in core while exposing agent capabilities through mounted routes.

## Frontend composition

Core provides the top-level shell (`CoreFront`, which wraps the config/theme/auth providers). Workspace provides layout. Agent provides chat UI.

```tsx
import { CoreFront } from '@hachej/boring-core/front'
import { WorkspaceProvider, IdeLayout } from '@hachej/boring-workspace'
import { ChatPanel } from '@hachej/boring-agent'
import { Route } from 'react-router-dom'

function WorkspaceRoute() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}

<CoreFront>
  <Route path="/" element={<WorkspaceRoute />} />
</CoreFront>
```

> Many apps compose this wiring for you. `@hachej/boring-core/app/front` ships `CoreWorkspaceAgentFront`, a higher-level shell that mounts core providers, workspace layout, and the injected agent chat in one component.

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
- [Core package](../packages/core.md)
- [Agent package](../packages/agent.md)
- [Workspace package](../packages/workspace.md)
