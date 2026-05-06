# @boring/core

Database, auth, and app factory for boring-ui apps.

```bash
pnpm add @boring/core
```

---

## What it provides

- **Database** — Drizzle ORM schema for users, workspaces, sessions, invites
- **Auth** — better-auth with workspace support, invite flows, email verification
- **App factory** — Fastify app with auth routes, middleware, and CORS wired in
- **Frontend shell** — `<BoringApp>` React provider with auth pages and workspace switcher

---

## Quickstart

Server:

```ts
import { createCoreApp, loadConfig } from "@boring/core/server"

const config = await loadConfig()
const app = await createCoreApp(config)
await app.listen({ port: config.port })
```

Frontend:

```tsx
import { BoringApp } from "@boring/core/front"
import { WorkspaceProvider, IdeLayout } from "@boring/workspace"

export function App() {
  return (
    <BoringApp>
      <Route path="/" element={<WorkspaceProvider><IdeLayout /></WorkspaceProvider>} />
    </BoringApp>
  )
}
```

---

## Config

Minimum `.env` to get started:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/boring
BETTER_AUTH_SECRET=<any 64-char hex string>
ANTHROPIC_API_KEY=sk-ant-...
```

Run migrations:

```bash
pnpm --filter @boring/core drizzle:migrate
```

---

## Package surfaces

```ts
import { ... } from "@boring/core/server"   // Fastify app factory, config
import { ... } from "@boring/core/front"    // React shell, auth pages
import { ... } from "@boring/core/db"       // Drizzle schema and client
```

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@boring/core` | DB, auth, app factory |
| `@boring/workspace` | Plugin system, layouts |
| `@boring/agent` | Agent runtime + tools |
