# Quickstart

Status: **planned** — this is the target DX for v1. Code examples will work once M2 + M3 land (see [plans/core-package-spec.md](./plans/core-package-spec.md) §Milestones).

## What you get

A new app depending on `@boring/core` boots with:

- Postgres connection + Drizzle client.
- better-auth with email/password + GitHub OAuth.
- Session cookie + auth middleware.
- Sign-in / sign-up / OAuth-callback pages.
- User + workspace CRUD API.
- Theme toggle + error boundary.
- `/api/v1/me`, `/api/v1/workspaces`, `/api/v1/capabilities`.

No code from you for any of that — just configure and go.

## 1. Install

```bash
pnpm add @boring/core @boring/workspace fastify react react-dom react-router-dom
```

(`@boring/workspace` is a peer dep because core imports shadcn primitives from `@boring/workspace/ui-shadcn`.)

## 2. Environment

`.env`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
BETTER_AUTH_SECRET=<32-byte random hex>
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=<from github oauth app>
GITHUB_CLIENT_SECRET=<from github oauth app>
```

`boring.app.toml`:

```toml
[app]
id = "my-app"

[frontend.branding]
name = "My App"
logo = "/logo.svg"
```

## 3. Migrate the DB

```bash
pnpm drizzle-kit generate --config node_modules/@boring/core/drizzle.config.ts
pnpm drizzle-kit migrate --config node_modules/@boring/core/drizzle.config.ts
```

(Core ships a ready-to-run `drizzle.config.ts` that points at its own schema and your `DATABASE_URL`.)

## 4. Server entrypoint

```ts
// src/server/main.ts
import { createCoreApp, loadConfig } from '@boring/core/server'

const config = await loadConfig()
const app = await createCoreApp(config)

// Child-app routes
app.get('/api/v1/my-thing', async () => ({ ok: true }))

await app.listen({ port: config.port })
console.log(`listening on ${config.port}`)
```

## 5. Frontend entrypoint

```tsx
// src/front/main.tsx
import { createRoot } from 'react-dom/client'
import { BoringApp } from '@boring/core/front'
import { Route } from 'react-router-dom'
import '@boring/core/theme.css'
import './index.css'

import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'

createRoot(document.getElementById('root')!).render(
  <BoringApp>
    <Route path="/" element={<Dashboard />} />
    <Route path="/settings" element={<Settings />} />
  </BoringApp>,
)
```

That's it. `BoringApp` already mounts:

- `/auth/signin`, `/auth/signup`, `/auth/callback/github`, `/me`.
- Auth gate redirecting unauthenticated users to sign-in.
- Config/Theme/Auth/User/Workspace providers.
- TanStack Query client.

## 6. Use the hooks inside your pages

```tsx
import { useUser, useCurrentWorkspace, UserMenu, WorkspaceSwitcher } from '@boring/core/front'

export function Dashboard() {
  const user = useUser()
  const workspace = useCurrentWorkspace()

  return (
    <div>
      <header className="flex justify-between p-4">
        <WorkspaceSwitcher />
        <UserMenu />
      </header>
      <main>Hello {user?.name}, welcome to {workspace?.name}</main>
    </div>
  )
}
```

## 7. Compose with agent + workspace

**Frontend — nested inside a router param so `workspaceId` is available to hooks:**

```tsx
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { useParams } from 'react-router-dom'

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  return (
    <WorkspaceProvider workspaceId={id!}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}

<BoringApp>
  <Route path="/workspace/:id" element={<WorkspaceRoute />} />
</BoringApp>
```

`BoringApp` mounts `<BrowserRouter>` + `<Routes>` internally; you pass `<Route>` children. `WorkspaceAuthProvider` (inside `BoringApp`) reads the same `:id` param from the URL to drive `useCurrentWorkspace()`.

**Server — two mount shapes; pick based on deployment:**

```ts
// Shape A: embedded into a core-built app (multi-user, DB, auth).
import { createCoreApp, loadConfig } from '@boring/core/server'
import { registerAgentRoutes } from '@boring/agent/server'

const app = await createCoreApp(await loadConfig())
await app.register(registerAgentRoutes)  // paths are absolute (/api/v1/agent/*)
await app.listen({ port: 3000 })
```

```ts
// Shape B: standalone agent (npx @boring/agent / self-host zero-setup).
// Zero core dependency; no DB, no auth, in-memory session store.
import { createAgentApp } from '@boring/agent/server'

const app = await createAgentApp({ /* agent-only config */ })
await app.listen({ port: 3000 })
```

Both shapes share agent's internal `AgentRuntime` — the only difference is who owns sessions, users, and workspace membership.

## Development without Postgres

Set `CORE_STORES=local` and core will use `LocalUserStore` + `LocalWorkspaceStore` (in-memory). State vanishes on restart. Useful for the agent CLI zero-setup mode and unit tests; **not a supported production mode**.

## Further reading

- [AUTH](./AUTH.md) — customizing providers, adding OAuth.
- [DB](./DB.md) — schema and migrations.
- [CONFIG](./CONFIG.md) — every env var and TOML key.
- [API](./API.md) — full export surface.
- [plans/core-package-spec.md](./plans/core-package-spec.md) — design rationale.
