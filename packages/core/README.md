# @hachej/boring-core

Database, auth, and app factory for boring-ui apps.

```bash
pnpm add @hachej/boring-core
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
import { createCoreApp, loadConfig } from "@hachej/boring-core/server"

const config = await loadConfig()
const app = await createCoreApp(config)
await app.listen({ port: config.port })
```

Frontend:

```tsx
import { BoringApp } from "@hachej/boring-core/front"
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"

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
pnpm --filter @hachej/boring-core drizzle:migrate
```

---

## Package surfaces

```ts
import { ... } from "@hachej/boring-core/server"   // Fastify app factory, config
import { ... } from "@hachej/boring-core/front"    // React shell, auth pages
import { ... } from "@hachej/boring-core/db"       // Drizzle schema and client
```

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@hachej/boring-agent` | Agent runtime + tools |
| `@hachej/boring-workspace` | Plugin system, workbench |
| `@hachej/boring-core` | DB, auth, app factory |
| `@hachej/boring-ui-kit` | Shared UI primitives |
| `@hachej/boring-ui-cli` | Zero-setup CLI |
