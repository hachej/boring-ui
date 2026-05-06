# boring-ui

The boring foundation for agent-powered products.

One chat. Panes. A command palette. That's it.

No opinionated layouts, no AI chrome, no dashboard bloat — just the three primitives every agent UI needs, wired to a production-ready backend. You own the product; boring-ui handles the scaffolding.

---

## What you get

**One chat** — a persistent conversation surface that drives the agent. Not a widget, not a sidebar hack. The chat *is* the interface.

**Panes** — a panel registry for whatever the agent produces: files, code, documents, data, artifacts. Each pane is a plugin. Add yours, remove the defaults.

**Command palette** — keyboard-first access to everything. Ships ready, extensible by default.

Plus the backend you'd have to build anyway: Postgres + Drizzle, auth + workspaces, a Fastify app factory, and three runtime modes for the agent (`direct`, `local`, `vercel-sandbox`).

---

## Packages

| Package | What it is |
|---|---|
| `@boring/core` | DB, auth, app factory, frontend shell |
| `@boring/agent` | Coding agent runtime + tool catalog |
| `@boring/workspace` | Chat layout, file tree, panel registry |

---

## Quickstart

```bash
pnpm install
cp apps/full-app/.env.example apps/full-app/.env
pnpm --filter @boring/core drizzle:migrate
pnpm --filter full-app dev
```

Then open `http://localhost:3000`.

---

## Server

```ts
import { createCoreApp, loadConfig } from '@boring/core/server'
import { registerAgentRoutes } from '@boring/agent/server'

const config = await loadConfig()
const app = await createCoreApp(config)
await app.register(registerAgentRoutes)
await app.listen({ port: config.port })
```

## Frontend

```tsx
import { BoringApp } from '@boring/core/front'
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'

<BoringApp>
  <Route path="/" element={<WorkspaceProvider><IdeLayout /></WorkspaceProvider>} />
</BoringApp>
```

---

## Repo shape

```
packages/core       → app foundation
packages/agent      → coding agent
packages/workspace  → workspace UI shell
apps/full-app       → reference production app
```

---

Built with TypeScript, React 19, Tailwind v4, Fastify, Drizzle, better-auth.
