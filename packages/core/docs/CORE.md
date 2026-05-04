# @boring/core — canonical spec

**Status: Shipped through v7. Original M0-M7 ship commit: `ef6dad0`.**
**Path:** `boring-ui-v2/packages/core/`
**Interview-driven, last updated 2026-04-28.**
**This file fuses the previous 8 docs (README / QUICKSTART / API / CONFIG / AUTH / DB / MIGRATION / TRAPS-V1 / plans/core-package-spec) into one.** No cross-file navigation required.

**Reference app:**
- [`apps/full-app`](../../../apps/full-app/) — the canonical production-ready example (Fly.io, Postgres, Resend) and dev surface. See its [README](../../../apps/full-app/README.md) for run/deploy instructions.

## Table of contents

1. [Goal](#goal)
2. [Locked decisions](#locked-decisions)
3. [Dependency position](#dependency-position)
4. [Non-goals](#non-goals)
5. [Quickstart](#quickstart)
6. [Config](#config)
7. [API reference](#api-reference)
8. [Auth](#auth)
9. [DB](#db)
10. [Traps from v1 — locked decisions](#traps-from-v1--locked-decisions)
11. [Migration from v1](#migration-from-v1)
12. [Milestones](#milestones)
13. [Acceptance criteria](#acceptance-criteria)
14. [Deployment](#deployment)
15. [V7 surface area](#v7-surface-area)
16. [Open questions deferred to v1.x](#open-questions-deferred-to-v1x)

---

## Goal

`@boring/core` is the **foundation package** for boring-ui-v2 apps: DB, user + workspace management, auth, config, HTTP app factory, and frontend app shell. It is the thing a child app imports first, and the only place in the v2 repo that owns persistence and identity.

Shape of a child app after core lands:

```ts
// apps/ide/src/server/main.ts
import { createCoreApp, loadConfig } from '@boring/core/server'
import { registerAgentRoutes } from '@boring/agent/server'

const config = await loadConfig()
const app = await createCoreApp(config)  // Fastify + DB + auth + core routes
await app.register(registerAgentRoutes)  // agent routes mount onto core
await app.listen({ port: config.port })
```

```tsx
// apps/ide/src/front/main.tsx
import { BoringApp } from '@boring/core/front'
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { Route } from 'react-router-dom'

<BoringApp>
  <Route path="/" element={<WorkspaceProvider><IdeLayout /></WorkspaceProvider>} />
  <Route path="/billing" element={<MyBillingPage />} />
</BoringApp>
```

## Locked decisions

| Decision | Choice |
|---|---|
| Package shape | **One combined package** (`@boring/core`) — no separate `@boring/cloud`. Local and real providers coexist behind interfaces. |
| DB stack | **Drizzle + Postgres (Neon)**. SQLite fallback is a v1.x concern. |
| Auth | **better-auth** with email/password + email verification + password reset + magic links. Drizzle adapter against the same Postgres. `AuthProvider` interface kept as a partial swap seam. **GitHub OAuth deferred to v1.x** (bundled with agent's GitHub App install — both ship together so users do "Connect GitHub" once, not twice). |
| Tenancy | Port v1: **workspaces + members + invites** with owner/editor/viewer roles. Matches agent's `workspaceId` per instance. |
| Frontend shell | `<BoringApp>` mounts **react-router v6** with a route slot. Default routes: `/auth/signin`, `/auth/signup`, `/auth/callback/github`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/me`. |
| UI primitives | Stay in **`@boring/ui`**. Core depends on workspace for UI. |
| Full-app wrapping | Server factory + frontend shell + config bridge + user/workspace management + auth — all four in-scope for v1. |

## Dependency position

v1 had `core ← workspace ← agent`. v2 fully inverts the chain:

```
  @boring/agent         (leaf — ZERO internal deps; ships standalone CLI)
        ^
        |
  @boring/workspace     (depends on agent; consumes ChatPanel as a pane)
        ^
        |
  @boring/core          (depends on workspace; transitively on agent)
```

**Rationale for each edge:**

- **workspace → agent**: workspace's `ChatPanel` pane consumes `@boring/agent`'s `<ChatPanel />` React component + `useAgentChat()` hook. Agent stays a leaf with no knowledge of workspace or core.
- **core → workspace**: core imports shadcn primitives from `@boring/ui` for its sign-in page, user menu, workspace switcher.

**Agent's two integration shapes (both first-class):**

1. **Standalone** — `createAgentApp(config)` boots Fastify + agent routes directly. **Zero core dependency.** Uses agent's own in-memory session store. This is what `npx @boring/agent` runs. No DB, no auth, no workspaces table required.
2. **Embedded in a core app** — `registerAgentRoutes(app, opts)` Fastify plugin mounts onto a core-built server. Consumed by core apps that want multi-user + DB + auth + real workspace membership. Both exports share the same internal `AgentRuntime`.

## Non-goals

- SQLite / libsql support. Postgres-only in v1.
- Social login beyond GitHub. Google/Apple/Discord are v1.x.
- Billing / Stripe integration.
- Server-side rendering. `<BoringApp>` is client-rendered only.
- GitHub App install flow — deferred to `@boring/agent` in v1.x, when agent grows a git tool.
- Browser-only builds of core's server subpath.

**Pulled back into scope** (reversal from earlier draft):

- **Email verification + password reset + magic links** are IN SCOPE for v1. v1 of the old project already shipped all three; dropping would be a user-visible regression. better-auth enables each with ~1 config flag + a mail transport.

---

## Quickstart

### What you get

A new app depending on `@boring/core` boots with Postgres + Drizzle, better-auth (email/pw + verification + reset + magic links), session cookies, sign-in/up pages, user + workspace CRUD, `/api/v1/me`, `/api/v1/workspaces`, `/api/v1/capabilities`. (GitHub OAuth deferred to v1.x.)

### 1. Install

```bash
pnpm add @boring/core @boring/workspace fastify react react-dom react-router-dom
```

(`@boring/workspace` is a peer dep because core imports shadcn primitives from `@boring/ui`.)

### 2. Environment

`.env`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
BETTER_AUTH_SECRET=<32-byte random hex>
BETTER_AUTH_URL=http://localhost:3000
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<32-byte hex>
MAIL_FROM=noreply@myapp.dev
MAIL_TRANSPORT_URL=resend://re_xxxxxxxxxxxxxxxxxxxxxxxx   # default; any scheme above works
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

### 3. Migrate the DB

```bash
pnpm drizzle-kit generate --config node_modules/@boring/core/drizzle.config.ts
pnpm drizzle-kit migrate --config node_modules/@boring/core/drizzle.config.ts
```

Core ships a ready-to-run `drizzle.config.ts` that points at its own schema and your `DATABASE_URL`.

### 4. Server entrypoint

```ts
// src/server/main.ts
import { createCoreApp, loadConfig } from '@boring/core/server'

const config = await loadConfig()
const app = await createCoreApp(config)
// createCoreApp already applies: bodyLimit 16MB, secret redaction, request-ID,
// rate limits on specific auth endpoints (signin/signup/forgot-password/resend-verification —
// NOT on signout or session refresh), helmet+CSP, graceful-shutdown hook, and decorates
// `app.config` + `app.db` + `app.auth` + `app.userStore` + `app.workspaceStore`.

// Child-app routes
app.get('/api/v1/my-thing', async (req) => ({
  ok: true,
  appId: req.server.config.appId,  // typed access via app.decorate('config', ...)
}))

await app.listen({ port: config.port })
```

### 5. Frontend entrypoint

```tsx
// src/front/main.tsx
import { createRoot } from 'react-dom/client'
import { BoringApp } from '@boring/core/front'
import { Route } from 'react-router-dom'
import '@boring/core/theme.css'

import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'

createRoot(document.getElementById('root')!).render(
  <BoringApp>
    <Route path="/" element={<Dashboard />} />
    <Route path="/settings" element={<Settings />} />
  </BoringApp>,
)
```

`BoringApp` already mounts `/auth/*` + `/me`, the auth gate, and every provider.

### 6. Use the hooks

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

### 7. Compose with agent + workspace

**Frontend** — nested inside a router param so `workspaceId` is available to hooks:

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

`BoringApp` mounts `<BrowserRouter>` + `<Routes>` internally; you pass `<Route>` children. `WorkspaceAuthProvider` (inside `BoringApp`) reads the same `:id` param to drive `useCurrentWorkspace()`.

**Server** — two mount shapes; pick based on deployment:

```ts
// Shape A: embedded into a core-built app (multi-user, DB, auth).
import { createCoreApp, loadConfig } from '@boring/core/server'
import { registerAgentRoutes } from '@boring/agent/server'

const app = await createCoreApp(await loadConfig())
await app.register(registerAgentRoutes)  // paths absolute: /api/v1/agent/*
await app.listen({ port: 3000 })
```

```ts
// Shape B: standalone agent (npx @boring/agent).
// Zero core dependency; no DB, no auth, in-memory session store.
import { createAgentApp } from '@boring/agent/server'

const app = await createAgentApp({ /* agent-only config */ })
await app.listen({ port: 3000 })
```

### Development without Postgres

Set `CORE_STORES=local` and core uses `LocalUserStore` + `LocalWorkspaceStore` (in-memory). State vanishes on restart. Supported for tests + the agent CLI; **not a production mode**.

---

## Config

Two sources, merged and Zod-validated at boot:

1. **`boring.app.toml`** — static app identity + branding. Checked into the repo.
2. **Environment variables** — secrets + per-deployment overrides.

The frontend never sees raw config — it gets a redacted `RuntimeConfig` from `GET /api/v1/config`.

### `boring.app.toml`

```toml
[app]
id = "my-app"               # Unique app identifier; used as appId in workspaces and user_settings.

[frontend.branding]
name = "My App"
logo = "/logo.svg"          # Served from staticDir
favicon = "/favicon.ico"

[frontend.theme]
default = "system"          # "light" | "dark" | "system"

[features]
github_oauth = false   # v1: deferred to v1.x
invites_enabled = true
invite_ttl_days = 7
```

`invite_ttl_days` lives in `boring.app.toml`. `sendWelcomeEmail` is env-only (`SEND_WELCOME_EMAIL=false`) but still lands under `CoreConfig.features` after config load so feature flags stay grouped in one object.

### Environment variables

| Var | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes (prod) | Postgres connection string. |
| `BETTER_AUTH_SECRET` | yes | 32-byte hex. Signs session cookies. |
| `BETTER_AUTH_URL` | yes | Public URL of the deployment (used for OAuth callbacks). |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | yes (prod) | 32-byte hex. pgcrypto key for `workspace_settings.value`. Rotating it without re-encrypting rows breaks typed decrypts of existing values, though metadata reads still succeed; see [V7 surface area](#v7-surface-area). |
| `SEND_WELCOME_EMAIL` | no | Defaults to `true`. Set to `false` to suppress the post-signup welcome email for non-invite signups. |
| `MAIL_FROM` | yes (prod) | Sender address for verification / reset / magic-link emails. Without it those flows are disabled. |
| `MAIL_TRANSPORT_URL` | yes (prod) | URL scheme dispatched by core's transport parser. **Recommended default: `resend://<api-key>`** (Resend REST — no dependency on the resend npm package; core just hits `https://api.resend.com/emails`). Also supported: `smtp://user:pass@host:port`, `smtps://user:pass@host:port`, `console://` (dev-only — logs to stdout). Unknown scheme = boot-time `ConfigValidationError`. |
| `GITHUB_CLIENT_ID` | **v1.x — not used in v1** | Reserved for when GitHub OAuth ships in v1.x alongside GitHub App install. Set if `features.github_oauth = true`. |
| `GITHUB_CLIENT_SECRET` | **v1.x — not used in v1** | Same. |
| `PORT` | no | Fastify port (default 3000). |
| `HOST` | no | Fastify host (default 0.0.0.0). |
| `STATIC_DIR` | no | Directory served at `/`. |
| `CORE_STORES` | no | `postgres` (default) or `local`. |
| `LOG_LEVEL` | no | pino level (default `info`). |
| `CORS_ORIGINS` | yes (prod) | Comma-separated allowlist of origins for CORS (e.g. `https://app.example.com,https://admin.example.com`). Empty in dev = localhost auto-allow. |
| `BODY_LIMIT_BYTES` | no | Override Fastify body limit (default `16777216` / 16MB). |
| `SESSION_TTL_SECONDS` | no | Session cookie max-age (default `60*60*24*30` / 30 days, matches v1). |
| `SESSION_COOKIE_SECURE` | no | Force `Secure` cookie flag (default `true` when `BETTER_AUTH_URL` is https). |

### `CoreConfig` type

```ts
export interface CoreConfig {
  appId: string
  appName: string
  appLogo: string | null

  port: number
  host: string
  staticDir: string | null

  databaseUrl: string | null
  stores: 'postgres' | 'local'

  cors: {
    origins: string[]            // from CORS_ORIGINS; empty array in dev = localhost auto-allow
    credentials: true            // always true — better-auth needs cookie-based sessions
  }

  bodyLimit: number              // bytes; default 16 * 1024 * 1024

  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

  encryption: {
    workspaceSettingsKey: string // from WORKSPACE_SETTINGS_ENCRYPTION_KEY (32-byte hex)
  }

  auth: {
    secret: string
    url: string
    github?: { clientId: string; clientSecret: string }
    mail?: { from: string; transportUrl: string }
    sessionTtlSeconds: number    // default 60*60*24*30 (30 days, matches v1)
    sessionCookieSecure: boolean // derived from auth.url unless overridden
  }

  features: {
    githubOauth: boolean
    invitesEnabled: boolean
    sendWelcomeEmail: boolean   // default true; disables the post-signup welcome email when false
    inviteTtlDays: number       // default 7, validated to 1..30
  }
}
```

### `RuntimeConfig` (frontend-safe subset)

Served at `GET /api/v1/config`. No secrets.

```ts
export interface RuntimeConfig {
  appId: string
  appName: string
  appLogo: string | null
  apiBase: string
  features: { githubOauth: boolean; invitesEnabled: boolean; sendWelcomeEmail: boolean }
}
```

`sendWelcomeEmail` is surfaced here because the frontend-safe config payload mirrors the server feature flags, even though the welcome-email decision itself happens in the server-side post-signup hook.

`<ConfigProvider>` fetches this once on mount and blocks render until loaded. **On fetch failure**: throws to `<AppErrorBoundary>` with a `ConfigFetchError` after 3 retries (exponential backoff: 500ms, 1s, 2s). v1 failed-open to defaults; v2 fails-closed because auth + workspace hooks depend on `appId` being real. Users see a "Cannot reach server" boundary UI with a refresh button, not a hung blank page.

### Loader API

```ts
import { loadConfig, validateConfig, buildRuntimeConfigPayload } from '@boring/core/server'

const config = await loadConfig()
const runtimePayload = buildRuntimeConfigPayload(config)
```

Options:

```ts
loadConfig({
  tomlPath?: string             // default: ./boring.app.toml; relative to process.cwd()
  env?: Record<string, string>  // default: process.env
  allowMissingSecrets?: boolean // default: false — when true, fills placeholders for BETTER_AUTH_SECRET,
                                // DATABASE_URL, WORKSPACE_SETTINGS_ENCRYPTION_KEY, MAIL_* so `pnpm typecheck`
                                // can run in CI without vault access. Never use in production; boot will
                                // log a 'config:insecure-defaults' warn if any placeholder is active.
})
```

Throws `ConfigValidationError` (extends `Error`) with `.issues: ZodIssue[]` on any validation failure — one throw path for the caller to handle.

### Secret redaction

Fastify hook strips matching keys from logs: `secret`, `token`, `clientSecret`, `password`, `authorization`, `cookie` (case-insensitive substring). Extend via `app.addRedactionPaths([...])`.

### Not in v1 config

- `.env.*` layered files (use dotenv-expand in tooling).
- Per-workspace config overrides (use `workspace_settings`).
- Remote config service (Consul, etcd) — write your own loader, call `validateConfig()`.

---

## API reference

### Entry points

No bare `@boring/core` import. Consumers pick a subpath.

- `@boring/core/server` — Node-only: Fastify app factory, DB, auth, stores, config loader.
- `@boring/core/server/db` — Drizzle schema + migrations + store interfaces (separate subpath so migration tooling can import without the full server).
- `@boring/core/front` — Browser: `<BoringApp>` shell, hooks, components.
- `@boring/core/shared` — Isomorphic types + error codes.
- `@boring/core/theme.css` — Token bridge consumed by the frontend shell.

### `@boring/core/server` (planned)

```ts
// App factory
export function createCoreApp(config: CoreConfig, options?: CreateCoreAppOptions): Promise<FastifyInstance>
export interface CreateCoreAppOptions {
  /** Override the default BetterAuthProvider (for Neon, Clerk, WorkOS swap-outs). */
  authProvider?: AuthProvider
  /** Override the default PostgresUserStore (for tests or custom backends). */
  userStore?: UserStore
  /** Override the default PostgresWorkspaceStore. */
  workspaceStore?: WorkspaceStore
}

// Config
export function loadConfig(options?: LoadConfigOptions): Promise<CoreConfig>
export function validateConfig(config: unknown): CoreConfig
export function buildRuntimeConfigPayload(config: CoreConfig): RuntimeConfig

// Auth
export function createAuth(config: CoreConfig, db: Database): BetterAuthInstance
export const authHook: FastifyPluginAsync
// Factory that returns a preHandler hook — used as `{ preHandler: requireWorkspaceMember('editor') }`.
export function requireWorkspaceMember(role?: MemberRole): preHandlerHookHandler
export interface AuthProvider { /* see Auth */ }
export class BetterAuthProvider implements AuthProvider {}

// Stores
export interface UserStore { /* see DB */ }
export interface WorkspaceStore { /* see DB */ }
export class PostgresUserStore implements UserStore {}
export class PostgresWorkspaceStore implements WorkspaceStore {}
export class LocalUserStore implements UserStore {}
export class LocalWorkspaceStore implements WorkspaceStore {}

// Routes (internal — mounted by createCoreApp)
export const registerCoreRoutes: FastifyPluginAsync

// Capabilities contributor API
export type CapabilitiesContributor = (ctx: { db: Database; config: CoreConfig }) =>
  Partial<CapabilitiesResponse> | Promise<Partial<CapabilitiesResponse>>

declare module 'fastify' {
  interface FastifyInstance {
    registerCapabilitiesContributor(name: string, fn: CapabilitiesContributor): void
    addRedactionPaths(paths: string[]): void
    config: CoreConfig
    db: Database
    auth: BetterAuthInstance
    userStore: UserStore
    workspaceStore: WorkspaceStore
  }
}
```

#### Error handling contract

Every error emitted by core flows through a single Fastify `setErrorHandler`:

1. If error is an `HttpError`: respond with `err.status` and body `{ error: err.message, code: err.code, message: err.message, requestId }`.
2. If error is a Fastify validation error (Zod / JSON schema): respond 400 with `{ error: 'validation_failed', code: 'validation_failed', message: <first issue>, requestId }`.
3. If error is a `@fastify/rate-limit` rejection: respond 429 with `{ error: 'rate_limited', code: 'rate_limited', message: 'Too many requests. Retry after <N> seconds.', requestId }` + `Retry-After: <N>` header.
4. Anything else: log the full stack with pino at `error` level; respond 500 with `{ error: 'internal_error', code: 'internal_error', message: 'Internal server error', requestId }`. The real error details stay in logs.

Client-side `apiFetch` / `apiFetchJson` parses this shape into an `HttpError` instance. Consumers should never see raw Fastify-shaped errors.

#### Agent integration — two first-class shapes

```ts
// Shape A (embedded): agent exports a Fastify plugin that mounts onto a core app.
import { registerAgentRoutes } from '@boring/agent/server'
await app.register(registerAgentRoutes)   // paths absolute: /api/v1/agent/*

// Shape B (standalone): agent boots its own Fastify. NO core dependency.
import { createAgentApp } from '@boring/agent/server'
const app = await createAgentApp(agentOnlyConfig)
```

Both maintained by the agent package. Core never calls `createAgentApp`; standalone agent never imports core.

### `@boring/core/server/db` (planned)

```ts
export * from './schema'
export * from './relations'
export { createDb } from './connection'
```

See [DB](#db) for column detail.

### `@boring/core/front` (planned)

```tsx
export function BoringApp(props: BoringAppProps): JSX.Element

// Providers exposed for advanced wiring
export function ConfigProvider(...)
export function ThemeProvider(...)
export function AuthProvider(...)
export function UserIdentityProvider(...)
export function WorkspaceAuthProvider(...)

// Hooks
export function useConfig(): RuntimeConfig
export function useConfigLoaded(): boolean
export function useTheme(): ThemeApi
export function useSession(): SessionState
export function useUser(): User | null
export function useCurrentWorkspace(): Workspace | null
export function useWorkspaceRole(): MemberRole | null
export function useWorkspaceMembers(workspaceId: string): Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }>  // matches WorkspaceStore.listMembers enriched return type
export function useCapabilities(): CapabilitiesResponse
export function useKeyboardShortcuts(bindings: Binding[]): void  // Cmd→metaKey on Mac, ctrlKey on Win/Linux (OS-aware)
export function useViewportBreakpoint(): Breakpoint
export function useReducedMotion(): boolean
export function useBlobUrl(blob: Blob | null): string | null

// Components
export function SignInPage(): JSX.Element
export function SignUpPage(): JSX.Element
export function ForgotPasswordPage(): JSX.Element
export function ResetPasswordPage(): JSX.Element
export function VerifyEmailPage(): JSX.Element
export function UserMenu(): JSX.Element
export function WorkspaceSwitcher(): JSX.Element
export function ThemeToggle(): JSX.Element
export function AppErrorBoundary(props: { children: ReactNode }): JSX.Element
export function AuthGate(props: { children: ReactNode }): JSX.Element

// Utils
// Normative contract (see §Transport below):
// - Always sets `credentials: 'include'` (cookie-based sessions require it).
// - Prepends `getApiBase()` to relative paths.
// - On non-2xx: throws an `HttpError { status, code, message, requestId }` parsed from the {error, code, message} envelope.
// - Does NOT retry. No 401 auto-retry (dropped from v1).
export function apiFetch(url: string, init?: RequestInit): Promise<Response>
export function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T>
export function getApiBase(): string
export function buildApiUrl(path: string): string
export function getWsBase(): string
export function buildWsUrl(path: string): string
export function openWebSocket(path: string, protocols?: string | string[]): WebSocket
export function getHttpErrorDetail(err: unknown): { code: string; message: string; status?: number }
export const routes: RouteMap
export function routeHref(name: keyof RouteMap, params?: Record<string, string>): string
export function sanitizeMarkdown(input: string): string
export function sanitizeToolOutput(input: string): string
export function debounce<T>(fn: T, ms: number): T
```

### `@boring/core/shared` (planned)

```ts
export type User = {
  id: string
  email: string               // always stored lowercase + trimmed
  name: string | null
  emailVerified: boolean
  image: string | null
  createdAt: string           // ISO 8601
  updatedAt: string
}
export type Workspace = {
  id: string
  appId: string
  name: string                // 1-100 chars, duplicates allowed per user
  createdBy: string           // User.id
  createdAt: string
  deletedAt: string | null    // soft-delete marker
  isDefault: boolean
}
export type WorkspaceMember = {
  workspaceId: string
  userId: string
  role: MemberRole
  createdAt: string
}
export type WorkspaceInvite = {
  id: string
  workspaceId: string
  email: string               // lowercased + trimmed
  tokenHash: string           // sha256 of the raw token (raw token sent in email, never stored)
  role: MemberRole
  expiresAt: string           // default now + 7 days
  acceptedAt: string | null
  createdBy: string | null    // User.id or null (system-generated)
  createdAt: string
}

// Thrown by apiFetch / apiFetchJson and by server-side code paths that map to HTTP errors.
export class HttpError extends Error {
  readonly status: number     // 4xx / 5xx
  readonly code: ErrorCode     // strictly typed from ERROR_CODES; never a bare string
  readonly requestId?: string  // X-Request-Id header if present
  constructor(init: { status: number; code: ErrorCode; message: string; requestId?: string })
}

// Returned by useSession(). Wraps better-auth's React client.
export type SessionState = {
  data: { user: User; expiresAt: string } | null
  isPending: boolean
  error: HttpError | null
}
export type WorkspaceRuntime = {
  workspaceId: string
  spriteUrl: string | null
  spriteName: string | null
  state: 'pending' | 'ready' | 'error'
  lastError: string | null
  volumePath: string | null
  lastErrorOp: string | null
  provisioningStep: string | null
  stepStartedAt: string | null
  updatedAt: string
}
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type SessionPayload = { userId: string; email: string; issuedAt: number; expiresAt: number }
export type RuntimeConfig = { /* see Config */ }
/**
 * Aggregated shape returned by GET /api/v1/capabilities.
 * `core` is always present; other keys exist only if contributors are registered.
 * Contributors register via app.registerCapabilitiesContributor(name, fn) and run
 * ONCE at boot — result is memoized for the app lifetime (restart to refresh).
 */
export type CoreCapabilities = {
  version: string              // @boring/core package version from package.json
  features: {
    invitesEnabled: boolean    // from CoreConfig.features.invitesEnabled
    githubOauth: boolean       // from CoreConfig.features.githubOauth (and config.auth.github presence)
    emailFlows: boolean        // DERIVED — true iff config.auth.mail is set (not a separate CoreConfig field)
  }
  auth: {
    emailPassword: boolean     // always true in v1
    github: boolean
    emailVerification: boolean
    passwordReset: boolean
    magicLink: boolean
  }
}
// JSON-safe union (no `unknown` / `any`). Extension = augment this type via `declare module`.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export type CapabilitiesResponse = {
  core: CoreCapabilities
  agent?: { runtimeMode: 'direct' | 'local' | 'vercel-sandbox'; tools: string[]; modelProviders: string[] }
  workspace?: { panels: string[] }          // contributed by workspace if an app ever registers one
  [contributorName: string]: JsonValue | CoreCapabilities | undefined  // still extensible, but JSON-safe
}

// Exhaustive v1 enumeration. Any `code` string on an HTTP error envelope is one of these.
export const ERROR_CODES = {
  // Auth + session
  UNAUTHORIZED: 'unauthorized',                     // 401 — no / expired session
  FORBIDDEN: 'forbidden',                           // 403 — session valid but no permission
  WEAK_PASSWORD: 'weak_password',                   // 400 — fails NIST policy (see §Auth)
  EMAIL_IN_USE: 'email_in_use',                     // 409 — signup with existing email

  // Workspace membership
  NOT_MEMBER: 'not_member',                         // 403 — caller not in workspace
  LAST_OWNER: 'last_owner',                         // 409 — can't remove the last owner

  // Invites
  INVITE_NOT_FOUND: 'invite_not_found',             // 404
  INVITE_EXPIRED: 'invite_expired',                 // 410
  INVITE_ALREADY_ACCEPTED: 'invite_already_accepted', // 409
  INVITE_EMAIL_MISMATCH: 'invite_email_mismatch',   // 403 — invite's email ≠ user's email
  INVITE_LOCKED: 'invite_locked',                   // 423 — too many failed attempts

  // Provisioning
  PROVISION_FAILED: 'provision_failed',             // 500 — create or retry provisioner threw
  DESTROY_FAILED: 'destroy_failed',                 // 500 — destroyer threw; workspace row not deleted
  RUNTIME_UNMANAGED: 'runtime_unmanaged',           // 409 — retry requested without a provisioner/runtime
  INVALID_RETRY_STATE: 'invalid_retry_state',       // 409 — retry allowed only for error+provision

  // Validation + infra
  NOT_FOUND: 'not_found',                           // 404
  VALIDATION_FAILED: 'validation_failed',           // 400 — Zod body/query parse failure
  CONFIG_VALIDATION_FAILED: 'config_validation_failed', // boot-time
  CONFIG_FETCH_FAILED: 'config_fetch_failed',       // frontend failed to load /api/v1/config
  RATE_LIMITED: 'rate_limited',                     // 429 — see Retry-After header
  MAIL_DISABLED: 'mail_disabled',                   // informational — email flow requested but MAIL_* unset
  DB_UNAVAILABLE: 'db_unavailable',                 // 503 — DB ping fails on /health
  INTERNAL_ERROR: 'internal_error',                 // 500 fallback
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
```

### HTTP surface

Served by `createCoreApp(config)`:

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + DB ping |
| GET | `/api/v1/config` | Redacted runtime config |
| GET | `/api/v1/me` | Current user + settings (401 if no session) |
| PUT | `/api/v1/me/settings` | Update user settings |
| GET | `/api/v1/capabilities` | Aggregated capabilities. Shape `{ core: {...}, agent?: {...}, workspace?: {...} }` keyed by contributor. |
| GET | `/api/v1/workspaces` | List user's workspaces |
| POST | `/api/v1/workspaces` | Create workspace |
| GET | `/api/v1/workspaces/:id` | Get workspace |
| PUT | `/api/v1/workspaces/:id` | Update workspace |
| DELETE | `/api/v1/workspaces/:id` | Delete workspace. In managed mode, core calls `provisioner.destroy(id)` first; if that throws, response is 500 `DESTROY_FAILED` and the runtime row is left in `state='error'` with `lastErrorOp='destroy'`. |
| GET | `/api/v1/workspaces/:id/settings` | List settings **metadata only** (see DB §Encrypted settings) |
| PUT | `/api/v1/workspaces/:id/settings` | Write encrypted settings |
| GET | `/api/v1/workspaces/:id/members` | List members |
| POST | `/api/v1/workspaces/:id/members` | Add member |
| PATCH | `/api/v1/workspaces/:id/members/:userId/role` | Update a member role. Owners only. Demoting the last owner returns 409 `LAST_OWNER`. |
| DELETE | `/api/v1/workspaces/:id/members/:userId` | Remove member |
| GET | `/api/v1/workspaces/:id/invites` | List invites |
| POST | `/api/v1/workspaces/:id/invites` | Create invite |
| POST | `/api/v1/workspaces/:id/invites/:inviteId/accept` | Accept invite (workspace-scoped) |
| DELETE | `/api/v1/workspaces/:id/invites/:inviteId` | Revoke invite |
| POST | `/api/v1/invites/resolve` | Resolve a raw invite token into `{ workspaceName, role, expiresAt }` for `/invites/:token`. Returns 423 `INVITE_LOCKED` when prior accept failures have already locked the token. |
| POST | `/api/v1/invites/accept` | Accept a raw invite token. Signed-in users only. Wrong-email accept attempts surface 403 `INVITE_EMAIL_MISMATCH`. |
| GET | `/api/v1/workspaces/:id/runtime` | Current runtime state (`pending` / `ready` / `error`). **Auto-creates a `ready` row on first read** if none exists. |
| POST | `/api/v1/workspaces/:id/runtime/retry` | Re-trigger provisioning only when `state='error'` and `lastErrorOp='provision'`. 409 `RUNTIME_UNMANAGED` if no provisioner/runtime; 409 `INVALID_RETRY_STATE` for any other state. |
| ANY | `/auth/*` | better-auth routes (its actual API path naming): `/auth/sign-in/email`, `/auth/sign-up/email`, `/auth/sign-out`, `/auth/callback/:provider`, `/auth/verify-email`, `/auth/send-verification-email`, `/auth/forget-password`, `/auth/reset-password`, `/auth/magic-link/send`, `/auth/magic-link/verify`. **These are the BACKEND API paths called by the React `authClient`. Frontend ROUTE slugs (where users land in the URL bar) are different and intentionally friendlier — see §Layer 2 default routes (`/auth/signin`, `/auth/signup`, `/auth/forgot-password`, etc.). The two surfaces map: SignInPage at `/auth/signin` calls `authClient.signIn.email()` which POSTs to `/auth/sign-in/email`.** |

Every `/api/v1/workspaces/:id/**` handler wears `requireWorkspaceMember(role?)`. See [Auth](#auth) and [Traps from v1](#traps-from-v1--locked-decisions).

---

## Auth

### v1 shape

- **[better-auth](https://www.better-auth.com)** — email/password + email verification + password reset + magic links. (GitHub OAuth deferred to v1.x.)
- **Drizzle adapter** against the same Postgres instance core uses.
- Tables owned by better-auth: `users`, `sessions`, `accounts`, `verification_tokens`.
- Session = signed cookie with explicit flags (match v1 contract): `HttpOnly; SameSite=Lax; Path=/; Max-Age=<SESSION_TTL_SECONDS>; Secure` (when `BETTER_AUTH_URL` is https). Auto-rotated by better-auth.
- Cookie name: `{appId}_session` (per-app scoping, fixes v1's global `boring_session` leakage).
- `AuthProvider` interface wraps better-auth so route handlers don't import it directly.

### Why better-auth over v1's hand-rolled AuthProvider

| Capability | v1 (hand-rolled) | v2 (better-auth) |
|---|---|---|
| Email + password | yes | yes |
| Session rotation | no | yes |
| GitHub OAuth | ~1 week | ~1 hour |
| Google/Apple/Discord | ~1 week each | ~1 hour each |
| Magic links | shipped in v1 app | one config flag |
| Email verification | shipped in v1 app | one config flag |
| Password reset | shipped in v1 app | one config flag |
| 2FA (TOTP) | not implemented | plugin |
| React hooks | `useWorkspaceAuth` only | `useSession`, `signIn`, `signOut` |
| Drizzle adapter | n/a | first-party |

### Security additions core layers on top of better-auth

better-auth handles sessions + OAuth + email flows but does NOT do these by default. Core applies them wholesale:

- **Redirect URI sanitization** — every `redirect_uri` / `callback_url` / magic-link `next` param is passed through `safeRedirect(url, config)` (exported from `@boring/core/server`) which strips `/[\0\r\n<>"'` + backtick `]/` and rejects non-allowlisted hosts. Open-redirect + CRLF-injection protection.
- **Email normalization** — `email.trim().toLowerCase()` before any DB lookup or compare at route handlers. Stops `Foo@Bar.com` + `foo@bar.com ` from creating two accounts. Applied before better-auth sees the email.
- **Password policy (NIST 2017)** — minimum 8 characters, no class requirements, blocklist the top-10k most common passwords (`@zxcvbn-ts/core` with the en-US wordlist, or equivalent static JSON list bundled in core). Implemented as a better-auth `password` validator. Reject with `HttpError(400, 'weak_password', 'This password is too common. Please choose another.')`. The blocklist is server-only; never shipped to the client.
- **Rate limiting** — `@fastify/rate-limit` layered on specific BACKEND API paths only (NOT the user-facing frontend route slugs; NOT on `/auth/*` wholesale which would rate-limit sign-out and session refresh). Limits:
  - `/auth/sign-in/email` — 5/min/IP
  - `/auth/sign-up/email` — 3/hour/IP
  - `/auth/forget-password` — 3/hour/IP (better-auth's actual spelling — "forget" not "forgot")
  - `/auth/send-verification-email` — 3/hour/IP
  - `POST /api/v1/workspaces/:id/invites` — 20/hour/workspace (invite-spam protection)
  - `/auth/sign-out` and any other `/auth/*` not in this list are explicitly NOT rate-limited.
  Configured in M6. Frontend route slugs `/auth/signin`, `/auth/forgot-password` etc. are NOT rate-limited (they're React route pages, not API endpoints).

### Wiring (planned, internal)

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'

export function createAuth(config: CoreConfig, db: Database) {
  const mail = config.auth.mail  // may be undefined in dev
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: config.auth.secret,
    baseURL: config.auth.url,
    emailAndPassword: {
      enabled: true,
      sendResetPassword: mail && ((...args) => sendResetEmail(mail, ...args)),
    },
    emailVerification: mail
      ? { sendOnSignUp: true, sendVerificationEmail: (...args) => sendVerificationEmail(mail, ...args) }
      : undefined,
    plugins: mail ? [magicLink({ sendMagicLink: (...args) => sendMagicLinkEmail(mail, ...args) })] : [],
    socialProviders: config.auth.github
      ? { github: { clientId: config.auth.github.clientId, clientSecret: config.auth.github.clientSecret } }
      : {},
  })
}
```

Fastify mount:

```ts
app.all('/auth/*', async (req, reply) => {
  const res = await auth.handler(req.raw)
  return reply.from(res)
})
```

### AuthProvider interface (swap seam)

```ts
export interface AuthProvider {
  verifySession(token: string): Promise<SessionPayload | null>
  issueSession(user: { id: string; email: string }): Promise<string>
  cookieName(): string
}

export class BetterAuthProvider implements AuthProvider { /* delegates */ }
```

Route handlers accept `AuthProvider`, not the better-auth instance. Swap via `createCoreApp(config, { authProvider: new MyProvider(...) })`.

**Honest disclaimer on swap tightness**: the seam is a *partial* abstraction. Route handlers are insulated, but `/auth/*` route shapes, the React client (`useSession` / `signIn` / `signOut`), and sign-in page flows are all better-auth-shaped. Swapping to Neon/Clerk later means re-implementing those surfaces, not just replacing `BetterAuthProvider`.

**UserId continuity invariant**: `workspace_members.userId`, `workspace_invites.createdBy`, `user_settings.userId` all reference `users.id` owned by better-auth. Any provider swap must preserve userIds (or ship an ID-mapping migration). Load-bearing.

### `authHook` — Fastify auth middleware

```ts
app.register(authHook, {
  public: [/^\/auth\//, /^\/health$/, /^\/api\/v1\/config$/],
})
```

Attaches `request.user` (type `User | null`). 401s for non-public `/api/v1/*` paths with no valid session.

### `requireWorkspaceMember` — per-route guard

```ts
app.get(
  '/api/v1/workspaces/:id/settings',
  { preHandler: requireWorkspaceMember('editor') },
  async (req) => { /* ... */ },
)
```

Reads `:id` from params, checks the user's role, 403s if insufficient. Role hierarchy: `owner > editor > viewer`. `'editor'` accepts `editor` and `owner`.

**M2 blocker**: every `/api/v1/workspaces/:id/**` handler must wear this. Integration test asserts 403 for non-members on every workspace-scoped route. v1 did not have this; v2 audits before ship.

### Post-signup side effects

better-auth calls a post-signup hook once the user row is inserted. Core registers one hook that runs in a single DB transaction with the user insert:

1. **If the signup request carries an invite token** (query string `?invite_token=<raw>` on `<SignUpPage>`, forwarded to `authClient.signUp.email(..., { headers: { 'x-invite-token': raw } })`):
   - Hash the raw token (`sha256`), look up `workspace_invites` via `WorkspaceStore.getInviteByTokenHash(hash)`.
   - Validate: invite not expired, not accepted, `invite.email === user.email` (case-insensitive).
   - Call `WorkspaceStore.acceptInvite(workspaceId, inviteId, userId)`.
   - On any validation failure: swallow the invite (log warn, continue to step 2). User is still signed up; they just don't get the invited workspace. Signal the failure to the frontend via a short-lived cookie `boring_invite_failed` (non-HttpOnly, `Max-Age=60`, `Path=/`, value = one of `'invite_expired' | 'invite_already_accepted' | 'invite_email_mismatch' | 'invite_not_found'` (matches ERROR_CODES enum exactly — no separate naming convention for the cookie)). The post-signup landing page reads the cookie, deletes it, and shows the matching toast. Cookie-based signaling avoids leaking state into the URL and doesn't force an extra `/api/v1/me` round-trip just to discover a signup-with-caveat.
2. **Else** (no invite token or invite failed): auto-create a default workspace via `WorkspaceStore.create(userId, 'My Workspace', appId)` with `isDefault: true`. This guarantees every signed-in user has at least one workspace (matches v1 UX; keeps `<WorkspaceSwitcher>` out of an empty state).

Email verification (if enabled) is orthogonal: a verification email is sent regardless of the invite path.

### Email sending

Three layers, implemented in `packages/core/src/server/mail/`.

**1. Transport** — interface `MailTransport { send(email: RenderedEmail): Promise<{ id: string }> }` where `RenderedEmail = { to: string; subject: string; html: string; text: string }`. `createMailTransport(url)` dispatches by URL scheme:

- **`resend://<api-key>` — default recommended provider.** Direct `fetch POST https://api.resend.com/emails` with `Authorization: Bearer <api-key>`. No dependency on the `resend` npm package; core just speaks HTTP. Fastest to a working deploy (one API key, no SMTP credentials, no relay setup).
- `smtp://` / `smtps://` — [nodemailer](https://nodemailer.com) SMTP transport. For self-hosters running their own relay or a different provider (SES, Postmark, Mailgun — all expose SMTP).
- `console://` — logs `{ to, subject, html, text }` to stdout at `info` level. Dev only; `MAIL_FROM` may be any placeholder.
- Unknown scheme → `ConfigValidationError` at boot.

The transport layer is a seam. Adding a new scheme (e.g. `postmark://<api-key>`) is ~20 LOC + adding it to `createMailTransport`'s switch — useful if someone wants a non-REST non-SMTP provider.

**2. Templates** — each transactional email is a React component under `packages/core/src/server/mail/templates/*.tsx` built with [`@react-email/components`](https://react.email). Rendered at send time via `@react-email/render`'s `renderAsync()` → `{ html, text }`. CSS inlined by react-email.

Shipped templates:

| Component | Props | Triggered by |
|---|---|---|
| `VerifyEmail` | `{ verifyUrl, appName, expiresInHours }` | better-auth `emailVerification.sendVerificationEmail` |
| `ResetPassword` | `{ resetUrl, appName, expiresInHours }` | better-auth `emailAndPassword.sendResetPassword` |
| `MagicLink` | `{ loginUrl, appName, expiresInMinutes }` | better-auth `magicLink` plugin |
| `WorkspaceInvite` | `{ acceptUrl, inviterName, workspaceName, role, expiresInDays }` | `WorkspaceStore.createInvite` |
| `Welcome` | `{ appName, getStartedUrl }` | post-signup hook when NOT signing up via invite (optional, feature-flag `features.sendWelcomeEmail`) |

**3. Wiring** — `createAuth(config, db)` closes over the mail transport and passes rendered-email callbacks to better-auth. Invite emails are sent inline by the `POST /api/v1/workspaces/:id/invites` handler (not a better-auth hook). Example:

```ts
emailVerification: mail && {
  sendOnSignUp: true,
  sendVerificationEmail: async ({ user, url }) => {
    const { html, text } = await renderAsync(
      <VerifyEmail verifyUrl={url} appName={config.appName} expiresInHours={24} />
    )
    await transport.send({
      to: user.email,
      subject: `Verify your email for ${config.appName}`,
      html,
      text,
    })
  },
}
```

**Graceful degradation** when `MAIL_FROM` / `MAIL_TRANSPORT_URL` are unset:

- `createAuth` disables the 3 email flows; better-auth throws `mail_disabled` if any email-gated action is triggered.
- `createInvite` (the store method) ALWAYS returns `{ invite, rawToken }` — store layer doesn't know about mail. The HTTP route handler (`POST /api/v1/workspaces/:id/invites`) is responsible for the mail-disabled fallback: if mail config is missing, it persists the invite via the store, skips sending, and returns the HTTP envelope `{ invite, warning: 'mail_disabled' }`. Frontend shows a toast on the warning. Layer separation: store = persistence, route = side effects + envelope shaping.
- `console://` is the recommended dev default when no real mail provider is configured.

### User deletion orchestrator

`DELETE /api/v1/me` (and equivalent admin endpoints) goes through `deleteUserCompletely(userId)` exported from `@boring/core/server`. Step order (atomic where possible):

1. Call `WorkspaceStore.getWorkspacesWhereSoleOwner(userId)` to find workspaces where the user is the only owner. If any returned: throw `HttpError(409, 'last_owner', 'Transfer ownership of <N> workspace(s) before deleting your account.')`. Orchestrator does NOT auto-transfer. (The method abstracts the SQL so `LocalWorkspaceStore` can also satisfy the contract.)
2. Delete all `workspace_members` rows where `user_id = userId` (not sole-owner now; safe).
3. Revoke all pending invites where `created_by = userId`.
4. Call better-auth's `users.delete(userId)`. Cascades:
   - `sessions`, `accounts`, `verification_tokens` (owned by better-auth).
   - `user_settings` (FK `ON DELETE CASCADE`).
5. Does NOT remove workspaces the user created (they belong to the workspace now, not the creator). If the departing user was the last member, workspace is left orphaned until manual cleanup.

Because `workspace_members.user_id` and `workspace_invites.created_by` are `ON DELETE RESTRICT`, a raw `DELETE FROM users` would fail loud — the orchestrator is the only safe path.

### React client

```tsx
import { useSession, signIn, signOut } from '@boring/core/front'

function Header() {
  const { data: session, isPending } = useSession()
  if (isPending) return <Spinner />
  if (!session) return <button onClick={() => signIn()}>Sign in</button>
  return <UserMenu user={session.user} onSignOut={signOut} />
}
```

`<AuthGate>` wraps the router and redirects unauthenticated users to `/auth/signin` for non-public routes.

### Sign-in / sign-up / reset / verify pages

Core ships `<SignInPage>`, `<SignUpPage>`, `<ForgotPasswordPage>`, `<ResetPasswordPage>`, `<VerifyEmailPage>` — styled with `@boring/ui`. Override individually via `<BoringApp authPages={...}>`:

```ts
export interface BoringAppAuthPagesOverride {
  signIn?: React.FC
  signUp?: React.FC
  forgotPassword?: React.FC
  resetPassword?: React.FC
  verifyEmail?: React.FC
}
```

Overridden components receive `{ onSubmit, oauthProviders, error, isPending, inviteToken? }` props (via React context); omitted overrides fall back to core's defaults.

**Split of responsibility:** better-auth owns the **backend** for every flow below. Core ships the **UI form** that calls better-auth's client methods. Nothing in core re-implements tokens, expiry, or email sending.

| Page | UX core owns | better-auth client call |
|---|---|---|
| `<SignInPage>` | Email/password form + "Sign in with GitHub" button + error state + "Forgot password?" link | `authClient.signIn.email()` / `authClient.signIn.social({ provider: 'github' })` |
| `<SignUpPage>` | Email/password/name form + client-side password strength hint + post-signup "check your email" message | `authClient.signUp.email()` |
| `<VerifyEmailPage>` | Reads `?token=` from URL, calls verify, shows success/expired/invalid state, **resend-verification button with 60s cooldown** | `authClient.verifyEmail({ token })` + `authClient.sendVerificationEmail({ email })` |
| `<ForgotPasswordPage>` | Email input form + success state ("check your inbox") + rate-limit-hit state | `authClient.forgetPassword({ email, redirectTo: '/auth/reset-password' })` |
| `<ResetPasswordPage>` | Reads `?token=` from URL, **two password fields with client-side match check**, submit → redirect to `/auth/signin` with toast | `authClient.resetPassword({ token, newPassword })` |

This list reframes the "v1 auth parity" concern: v1 shipped its own token+email plumbing; v2 only ships the UI shells. Less code, same UX.

Override via:

```tsx
<BoringApp authPages={{ signIn: MyBrandedSignIn, signUp: MyBrandedSignUp }}>
  {/* ... */}
</BoringApp>
```

### In v1

- Email + password.
- ~~GitHub OAuth.~~ Deferred to v1.x (bundled with agent's GitHub App install — see §Open questions deferred).
- Email verification (better-auth `emailVerification: { sendOnSignUp: true }`).
- Password reset (better-auth `emailAndPassword: { sendResetPassword }`).
- Magic links (better-auth `magicLink` plugin).

All three email flows require a mail transport. Without `MAIL_FROM` + `MAIL_TRANSPORT_URL`, the flows are disabled with a boot-time warning.

### Not in v1

- Google / Apple / Discord / other OAuth providers (one-line adds in `createAuth`, unshipped).
- 2FA / TOTP (better-auth plugin; deferred).
- Session revocation UI (`DELETE /api/v1/me/sessions/:id`).
- API keys (per-workspace tokens for headless access) — v1.x.

---

## DB

### Stack

- **[Drizzle ORM](https://orm.drizzle.team)** — schema, query builder, migration generation.
- **`postgres`** (porsager) — driver.
- **Postgres** — only supported dialect in v1.

### Schema overview

Tables split across two owners.

**better-auth-owned** (DO NOT edit directly; better-auth's generator manages these):

- `users` — `id` (uuid), `email`, `name`, `emailVerified`, `image`, `createdAt`, `updatedAt`.
- `sessions` — session records with rotation.
- `accounts` — linked OAuth accounts.
- `verification_tokens` — email-verification / magic-link tokens.

**Core-owned** (ported from v1 `@boring/cloud/db/schema.ts`, then narrowed by v7):

- `workspaces` — `id`, `appId`, `name`, `createdBy`, `createdAt`, `deletedAt`, `isDefault`. v7 intentionally removed the deferred Fly columns `machineId`, `volumeId`, and `flyRegion`.
- `workspaceMembers` — `(workspaceId, userId)` composite pk, `role` (`owner`|`editor`|`viewer`), `createdAt`.
- `workspaceInvites` — `id`, `workspaceId`, `email`, `tokenHash`, `role`, `expiresAt` (computed from `features.inviteTtlDays` in the store layer), `acceptedAt`, `createdBy`, `failedAttempts`, `lockedUntil`. Invite emails are sent via the same `MAIL_TRANSPORT_URL` / `MAIL_FROM` transport as auth flows; no separate mailer.
- `workspaceSettings` — `(workspaceId, key)` composite pk, `value` (bytea, pgcrypto-encrypted), `updatedAt`.
- `workspaceRuntimes` — `workspaceId` pk, `spriteUrl`, `spriteName`, `state`, `lastError`, `volumePath`, `lastErrorOp`, `updatedAt`, `provisioningStep`, `stepStartedAt`. Runtime state is narrowed to `pending | ready | error`.
- `idempotencyKeys` — `key`, `scope`, `responseStatus`, `responseBody`, `createdAt`. Used by idempotent invite creation and any future retried write endpoints.
- `userSettings` — `(userId, appId)` composite pk, `settings` jsonb, `email`, `displayName`, `updatedAt`.

### Foreign keys

- `workspaceMembers.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceInvites.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceSettings.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceRuntimes.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceMembers.userId → users.id` **(NEW in v2)** with `ON DELETE RESTRICT` — deleting a user who's still a member fails loud; orchestrator strips memberships first. v1 couldn't have this because Neon Auth owned users externally.
- `workspaceInvites.createdBy → users.id` **(NEW in v2)** with `ON DELETE RESTRICT`.
- `userSettings.userId → users.id` **(NEW in v2)** with `ON DELETE CASCADE` — user settings are purely user-owned; cascade is safe.

better-auth-owned FKs (managed by its migration generator): `sessions.userId` and `accounts.userId` both `ON DELETE CASCADE` (configured via better-auth's Drizzle adapter options).

### Stores

All persistence goes through one of two interfaces. Route handlers import the interface, not the implementation.

#### `UserStore`

```ts
export interface UserStore {
  getById(id: string): Promise<User | null>
  getByEmail(email: string): Promise<User | null>
  upsert(userId: string, data: { email: string; name?: string }): Promise<User>
  // All user-level settings (displayName + settings JSON + email-for-display) are owned here,
  // keyed by (userId, appId). WorkspaceStore does NOT duplicate these methods.
  getUserSettings(userId: string, appId: string): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
  putUserSettings(
    userId: string,
    appId: string,
    updates: { displayName?: string; email?: string; settings?: Record<string, unknown> },
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
}
```

Implementations: `PostgresUserStore` (Drizzle), `LocalUserStore` (in-memory).

**Note vs v1**: v2 `UserStore` is keyed by `(userId, appId)`, fixing v1's app-unscoped query bug.

#### `WorkspaceStore`

```ts
export interface WorkspaceStore {
  // Workspace CRUD
  create(userId: string, name: string, appId: string, opts?: { isDefault?: boolean }): Promise<Workspace>
  list(userId: string, appId: string): Promise<Workspace[]>  // always filtered by appId (cross-app scoping)
  get(id: string): Promise<Workspace | null>
  update(id: string, updates: Partial<Pick<Workspace, 'name'>>): Promise<Workspace | null>
  delete(id: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.NOT_FOUND }>

  // Used by deleteUserCompletely orchestrator. Implementations compute this in SQL (Postgres)
  // or by iterating the in-memory store (Local). Returns workspaces where the user is the
  // SOLE owner (no other members with role='owner'). Empty array = safe to delete user.
  getWorkspacesWhereSoleOwner(userId: string): Promise<Workspace[]>

  // Membership
  isMember(workspaceId: string, userId: string): Promise<boolean>
  getMemberRole(workspaceId: string, userId: string): Promise<MemberRole | null>
  // Enriched member records include the joined User for frontend rendering (email, name, avatar).
  // No separate GET /api/v1/users/:id endpoint — core does not expose user lookups outside membership lists.
  listMembers(workspaceId: string): Promise<Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }>>
  upsertMember(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember>
  updateMemberRole(workspaceId: string, userId: string, role: MemberRole): Promise<{ member?: WorkspaceMember; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER }>
  // Narrow subset of ERROR_CODES; implementation MUST NOT return a code outside this union.
  // `removed: true` + undefined code = success. `removed: false` + code = semantic failure.
  removeMember(workspaceId: string, userId: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER }>

  // Invites
  listInvites(workspaceId: string): Promise<WorkspaceInvite[]>
  // Returns both the persisted invite row AND the raw token. The raw token is never stored
  // (only its sha256 hash lives in `workspace_invites.tokenHash`). The HTTP handler uses the
  // raw token to build the accept URL for the email (e.g. https://app/accept?invite_token=<raw>).
  // After this method returns, the caller MUST NOT log or persist the rawToken anywhere.
  createInvite(workspaceId: string, email: string, role: MemberRole, invitedBy: string | null, opts?: { ttlDays?: number }): Promise<{ invite: WorkspaceInvite; rawToken: string }>
  getInvite(workspaceId: string, inviteId: string): Promise<WorkspaceInvite | null>
  // Used by the post-signup hook to resolve ?invite_token=<raw> from the signup URL.
  // Implementation hashes the raw token (sha256) and queries by tokenHash. Returns null if
  // no invite matches, even if the token format is valid.
  getInviteByTokenHash(tokenHash: string): Promise<WorkspaceInvite | null>
  revokeInvite(workspaceId: string, inviteId: string): Promise<boolean>
  incrementInviteFailedAttempts(inviteId: string): Promise<{ failedAttempts: number; lockedUntil: string | null }>
  resetInviteFailedAttempts(inviteId: string): Promise<void>
  // Throws HttpError on any failure (no silent returns):
  //   INVITE_NOT_FOUND (404), INVITE_EXPIRED (410), INVITE_ALREADY_ACCEPTED (409),
  //   INVITE_EMAIL_MISMATCH (403 — invite's email ≠ user's current email, case-insensitive).
  // Success always returns both fields populated.
  acceptInvite(workspaceId: string, inviteId: string, userId: string): Promise<{ invite: WorkspaceInvite; member: WorkspaceMember }>

  // Workspace-level settings (encrypted). User-level settings (displayName, email, settings JSON)
  // live on UserStore — not duplicated here.
  getWorkspaceSettings(workspaceId: string): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>  // METADATA ONLY — see §Encrypted settings
  putWorkspaceSettings(workspaceId: string, settings: Record<string, string>): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>  // returns refreshed metadata, matching v1's "return updated settings" contract

  // Runtime state (used by agent package's provisioning state machine)
  // Semantics: getWorkspaceRuntime auto-creates a `ready` row if the workspace exists
  //   but has no runtime (matches v1). Returns null only if the workspace itself
  //   is missing or soft-deleted. `workspaces.create` seeds runtime as a side-effect.
  getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  putWorkspaceRuntime(workspaceId: string, state: Partial<WorkspaceRuntime>): Promise<WorkspaceRuntime>
  // retryWorkspaceRuntime moves state from `error` → `pending` and clears lastError.
  // No-op (returns null) if current state is not `error`.
  retryWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>

  // Typed decrypted accessors — registered by integrations, not generic.
  // Integrations (agent, GitHub plugin, etc.) extend this surface with typed
  // methods via module augmentation or by attaching to the store instance.
  // See §Encrypted settings and §Extension points below.

  // UI state
  getUiState(userId: string, workspaceId: string): Promise<Record<string, unknown> | null>
  putUiState(userId: string, workspaceId: string, state: Record<string, unknown>): Promise<void>
}
```

Implementations: `PostgresWorkspaceStore` (Drizzle + pgcrypto), `LocalWorkspaceStore` (in-memory).

### Workspace semantics & defaults (v1)

Behavior of the workspace store that isn't obvious from the interface signatures.

- **Cross-app scoping**: `list(userId)` is ALWAYS filtered by the current session's `appId`. The store method takes `appId` at the route layer (from `request.server.config.appId`), not as a method parameter. A user signed into app X cannot see their workspaces from app Y. Matches v1 behavior.
- **Rename uniqueness**: `workspaces.name` has no unique constraint. A user can have two workspaces named "My App." Matches v1; documented so implementers don't add surprise constraints.
- **Default flag at create time**: `create(..., { isDefault })` lets the route layer or post-signup hook mark the initial workspace as default without a follow-up update.
- **Default workspace after delete**: if a user soft-deletes their only `is_default=true` workspace, they have no default until they create another one. The `<WorkspaceSwitcher>` falls back to the first non-deleted workspace or prompts to create one. v1.1 will add automatic promotion of the oldest sibling (tracked in §Traps from v1).
- **Managed vs unmanaged delete**: when a `provisioner` is present, `DELETE /api/v1/workspaces/:id` destroys filesystem state first and only then soft-deletes the workspace row. If destroy throws, the route returns 500 `destroy_failed` and the runtime is left in `error` with `lastErrorOp='destroy'`. Without a provisioner, delete is just the DB soft-delete.
- **Invite TTL**: `createInvite` computes `expiresAt` from `CoreConfig.features.inviteTtlDays` (default 7, range 1-30). There is no SQL default anymore.
- **Invite email transport**: same `MAIL_TRANSPORT_URL` + `MAIL_FROM` as auth flows. If mail config is missing at boot, invites can be created (token hash stored) but emails are not sent — consumers get a `mail_disabled` warning in the response.
- **Pagination**: `list()` returns all workspaces for the user+app. Expected scale <20 per user; cursor-based pagination is deferred to v1.x.
- **Listing order**: `list()` returns workspaces ordered by `createdAt DESC`, with `is_default=true` first if present.

### Extension points for typed encrypted settings

Consumers that need to decrypt workspace settings register typed accessors at boot:

```ts
// In e.g. @boring/agent's plugin:
declare module '@boring/core/server' {
  interface WorkspaceStore {
    getWorkspaceGitHubInstallation(workspaceId: string): Promise<{ installationId: string; accountLogin: string } | null>
    setWorkspaceGitHubInstallation(workspaceId: string, value: { installationId: string; accountLogin: string }): Promise<void>
    clearWorkspaceGitHubInstallation(workspaceId: string): Promise<void>  // maps to v1's clearWorkspaceGitHubConnection
  }
}
```

Core exposes a low-level `decryptSetting(workspaceId, key): Promise<string | null>` + `encryptAndPut(workspaceId, key, value)` for integrations to build typed accessors on. This matches v1's pattern (generic settings list stays metadata-only; typed methods per-integration decrypt internally).

### Migrations

```bash
pnpm drizzle-kit generate --config node_modules/@boring/core/drizzle.config.ts
pnpm drizzle-kit migrate --config node_modules/@boring/core/drizzle.config.ts
```

Core ships its own `drizzle.config.ts` pointing at its schema. Migration SQL lives in `packages/core/drizzle/`. Child apps with their own tables run their own `drizzle-kit` against their own config. Core never touches tables it doesn't own.

### Workspace settings encryption

`workspaceSettings.value` is stored as PostgreSQL `bytea` and encrypted/decrypted in Postgres with `pgcrypto`:

- Write path: `pgp_sym_encrypt(plaintext, WORKSPACE_SETTINGS_ENCRYPTION_KEY)`.
- Read path: `pgp_sym_decrypt(value, WORKSPACE_SETTINGS_ENCRYPTION_KEY)::text`.
- Algorithm/format: pgcrypto OpenPGP symmetric encryption packet stored directly in `bytea`.
- Nonce/salt: pgcrypto embeds fresh per-encryption random data in the ciphertext packet; there is no separate nonce column. Rewriting the same plaintext with the same key produces different ciphertext bytes.
- AAD/binding: no additional authenticated data is passed, so ciphertext is not explicitly bound to `workspace_id` or `key`.

`WORKSPACE_SETTINGS_ENCRYPTION_KEY` is the single configured symmetric passphrase for v2. The current deployment contract uses a 32-byte hex string and deliberately does not implement a keyring.

**Key-rotation behavior**: if `WORKSPACE_SETTINGS_ENCRYPTION_KEY` is rotated without re-encrypting existing rows, `pgp_sym_decrypt` fails for old rows. v2 contract:

- Generic `getWorkspaceSettings(workspaceId)` returns the affected key with `configured: false`. No plaintext is returned.
- Typed accessors (e.g. `getWorkspaceGitHubInstallation`) return `null` on decrypt failure. No throw.
- Core does not auto-migrate old rows. Rotation is a planned-outage operation.

**Rotation procedure**:

1. Block writes to workspace settings, either by maintenance mode or a feature flag in the app shell.
2. Take a database backup.
3. Run a one-shot rotation script that reads each `workspace_settings` row, decrypts with the old key, re-encrypts with the new key, and updates the row in one transaction or controlled batches.
4. Deploy the new `WORKSPACE_SETTINGS_ENCRYPTION_KEY`.
5. Verify representative typed decrypts and generic metadata reads.
6. Unblock writes.

```sql
-- Insert
INSERT INTO workspace_settings (workspace_id, key, value)
VALUES ($1, $2, pgp_sym_encrypt($3, $4))

-- Metadata-only select (what generic API returns)
SELECT key, (value IS NOT NULL) AS configured, updated_at
FROM workspace_settings
WHERE workspace_id = $1
```

**Contract preserved from v1**: `WorkspaceStore.getWorkspaceSettings(workspaceId)` returns `Array<{key, configured, updated_at}>` — it does NOT decrypt values. Typed accessors (e.g. `getGitHubInstallation`) decrypt internally. This prevents accidental secret-logging and isolates key-rotation failures to typed code paths.

### Local mode

`CORE_STORES=local` wires `LocalUserStore` + `LocalWorkspaceStore`. State vanishes on restart. For tests + agent CLI zero-setup.

### Not in v1

- SQLite / libsql dialect.
- Audit log table.
- Soft-delete for users (better-auth owns users; hard-delete for now).
- Per-workspace API keys.
- Multi-region / read-replica awareness.

---

## Traps from v1 — locked decisions

Source: 2026-04-24 forensic trap-scan of `packages/boring-ui` v1. Bug line references point at v1 source, not v2.

### 🔴 Fixed in v2

Items v2 fixes on the way in.

#### Workspace-route authorization audit (M2 blocker)

**v1 bug**: most `/api/v1/workspaces/:id/**` routes only check `verifySession`, not membership (`packages/workspace/src/server/http/workspaceRoutes.ts:27, 109, 161, 191`). Any authenticated user who guesses a workspace UUID can read/update/delete it.

**v2 fix**: every workspace-scoped handler wears `requireWorkspaceMember(role?)`. Integration test covers every route. M2 ships with an audit.

#### Email verification + password reset + magic links

**v1 behavior**: shipped all three (`packages/cloud/src/server/http/authRoutes.ts:964, 999`; `packages/cloud/src/front/pages/AuthPage.jsx:214`).

**v2 action**: keep all three. better-auth enables each with a config flag + mail transport. ~1 day total.

#### Rate limiting / helmet / CSP / graceful shutdown / deep health

**v1 gap**: none of these exist (`apps/ide/src/server/app.ts:57, 68`; `packages/core/src/server/http/health.ts:32`).

**v2 action**: dedicated hardening milestone (M6). `@fastify/rate-limit` on auth routes, helmet + CSP, SIGTERM drain, `/health` that pings DB.

#### PostgresUserStore app_id ignored

**v1 bug**: `PostgresUserStore.ts:16, 33` queries by `user_id` only, not `(user_id, app_id)`. `putSettings` (v1's name; v2 renamed to `putUserSettings`) at line 103 is a no-op if no row exists.

**v2 fix**: composite key `(userId, appId)` everywhere. `putUserSettings` is a real upsert. Integration test covers cross-app isolation.

#### `pending_login` URL-embedded credentials

**v1 bug**: signup creates a `pending_login` JWE containing email+password and puts it in the email-verification callback query (`packages/cloud/src/server/http/authRoutes.ts:696, 932`). Even encrypted, this hits URL logs.

**v2 action**: dropped entirely. better-auth uses server-side nonce storage for post-verification continuation.

#### Session scoping

**v1 bug**: JWT optionally carries `app_id` but middleware ignores it (`packages/core/src/server/auth/session.ts:81`, `middleware.ts:41`). Default cookie is global `boring_session` (`config.ts:344`). Cross-app leakage risk on same domain.

**v2 fix**: better-auth sessions, per-app cookie name (`{appId}_session`), server-side revocation via `sessions` table.

### 🟠 Accepted as known issues — carried to v1.1

Intentionally NOT fixed in v1. Documented so implementers don't "fix" them (and the tests that encode the behavior) under schedule pressure.

#### Invite-accept TOCTOU race

**v1 bug**: route-layer validation of `accepted_at`, expiry, email followed by separate UPDATE statements (`packages/cloud/src/server/services/workspacePersistence.ts:850`). Concurrent accepts can both succeed; expired invites accept under race.

**v1.1 fix plan**: single transaction with conditional `UPDATE workspace_invites ... WHERE accepted_at IS NULL AND expires_at > now() RETURNING`; insert into `workspace_members` in the same tx.

**Mitigation for v1**: narrow window; requires two legitimate requests to collide; impact is a single extra membership row for a duplicate invite. Not a security hole, data-integrity edge.

#### Last-owner-removal race

**v1 bug**: remove-member reads owner count then deletes in separate statements (`workspacePersistence.ts:736`; `packages/core/src/server/providers/local/workspaceStore.ts:161`). Two concurrent owner-removes can strand a workspace with zero owners.

**v1.1 fix plan**: `SELECT ... FOR UPDATE` on owner rows before DELETE.

**Mitigation for v1**: rare; recoverable via admin SQL.

#### Default-workspace promotion on delete

**v1 bug**: deleting the default doesn't promote another (`workspacePersistence.ts:454`); DB has a partial unique index on `(created_by, app_id) WHERE is_default = true` (`schema.ts:67`).

**v1.1 fix plan**: on soft-delete of a default, promote the oldest sibling.

### 🟡 Behavioral quirks documented (not bugs)

#### Encrypted workspace_settings — metadata-only contract

**v1 behavior** (`workspacePersistence.ts:647`): generic `getWorkspaceSettings` returns `Array<{key, configured, updated_at}>` — does NOT decrypt. Typed accessors (e.g. `getGitHubInstallation`) decrypt internally.

**v2 status**: **preserved by design.** Safer default — consumers can't accidentally log decrypted secrets; key rotation doesn't break generic endpoints.

#### Workspace soft-delete leaves orphans

**v1 behavior**: `DELETE` sets `deleted_at` only. Members, invites, settings, runtime rows remain. Backing FS directory remains.

**v2 status**: **preserved as-is.** User-accepted known limitation. Operators schedule manual cleanup if needed. `v1.x` option: cascade-delete or scheduled GC (not planned).

#### Dev auto-login dropped

**v1 behavior**: local mode injects a `dev-local` cookie at app boot (`apps/ide/src/server/app.ts:79`); frontend `apiFetch` retries one 401 per page load (`packages/core/src/front/utils/transport.js:14`).

**v2 action**: both dropped. Dev uses `LocalUserStore` with a seeded `dev@local` user + signs in through `/auth/signin`. One code path.

### Contracts preserved from v1

Easy to break accidentally; pinned here.

- **Error envelope**: `{ error: string, code: string, message: string }` on every route (v1 `authRoutes.ts:590`, `collaborationRoutes.ts:14`).
- **Request ID**: trust inbound `x-request-id` else UUID, echo in response (v1 `requestId.ts:15`).
- **Validation rules**:
  - Workspace name: 1-100 chars (`workspaceRoutes.ts:54`).
  - Settings key: 1-128 chars (`workspaceRoutes.ts:254`).
  - Settings value: non-empty string.
  - Max 50 settings keys per PUT.
  - Invite email: RFC-5322 permissive regex (`collaborationRoutes.ts:11`).
  - **Email normalization**: `email.trim().toLowerCase()` before any lookup/compare. Prevents duplicate accounts from casing/whitespace.
  - **Redirect URI validation**: every `redirect_uri` / `callback_url` / magic-link `next` param runs through `safeRedirect(url, config)` before any redirect. Policy (v2 explicit, not a v1 port):
    - Reject if it contains `/[\0\r\n<>"'` + backtick `]/` (CRLF / HTML injection).
    - Accept relative paths (`/foo/bar`) without further check.
    - Accept absolute URLs ONLY if their origin is in `config.cors.origins`. Reject everything else.
    - Fallback on rejection: redirect to `/` instead of echoing the bad value.
    - better-auth does NOT enforce this; core wraps every better-auth redirect emission.
- **Secret redaction**: pino path redaction + regex pass (`secretRedaction.ts:7`). Paths: `secret`, `token`, `clientSecret`, `password`, `authorization`, `cookie` (case-insensitive substring).
- **Fastify body limit**: `bodyLimit: 16 * 1024 * 1024` (16MB). v1 default. Required so `PUT /api/v1/workspaces/:id/settings` and workspace UI-state writes (via `WorkspaceStore.putUiState`) don't fail silently under Fastify's 1MB default. Configurable via `BODY_LIMIT_BYTES` / `CoreConfig.bodyLimit`.
- **Typed config decorator**: `app.decorate('config', config)` so route handlers access `request.server.config` without importing the loader. v1 pattern.
- **Identity caching across transient failures**: v1 `useWorkspaceAuth` preserves the last-known user identity for `MAX_PRESERVED_IDENTITY_AGE_MS = 30_000` so a blink 401/network blip doesn't bounce the user to sign-in. v2 `useSession` must exhibit the same behavior — either via better-auth's built-in retry or by wrapping `useSession` in a thin cache layer. Integration test: simulate a 401 burst and assert the session-aware UI does not redirect to `/auth/signin`.
- **OS-aware keyboard modifiers**: `useKeyboardShortcuts` maps `Cmd` to `metaKey` on Mac and `ctrlKey` on Windows/Linux. Port detection from v1 `useKeyboardShortcuts.js`.

### Dropped from v2 (intentional)

- `pythonCompat.ts` capability shape + legacy feature aliases.
- Dual GitHub alias routes (`/github/*` + `/auth/github/*`).
- `controlPlaneProvider: 'local' | 'neon'` config branching (Postgres-only).
- `pending_login` URL-embedded credentials (above).
- Dev auto-login + 401 retry (above).
- **v1 GitHub methods on stores** (`getWorkspaceGitHubConnection`, `setWorkspaceGitHubConnection`, `clearWorkspaceGitHubConnection`, `getUserGitHubLink`, `setUserGitHubLink`) — dropped from v2's core `WorkspaceStore` / `UserStore` interfaces. The `@boring/agent` package will re-add them as typed accessors via the extension-point pattern (see §DB → Extension points) when agent grows git ops in v1.x. Until then, any integration that needs GitHub installation state reads/writes `workspace_settings` directly via `decryptSetting` / `encryptAndPut`.
- **v1 verification-token auto-session** — in v1, clicking a verification link ran a custom token-exchange endpoint that auto-started a session (so the user didn't need to sign in again after verifying). v2 delegates entirely to better-auth's `/auth/verify-email` handler, which does auto-session by default. No custom token-exchange code is ported; the UX is preserved because better-auth behaves the same way out of the box. Verified via M7 E2E.
- **v1 `/w/:id/*` server-side workspace boundary** — v1 used a server-side route prefix `/w/:id/*` to enforce workspace context. v2 replaces this with the frontend-side `/workspace/:id` react-router param + the per-route `requireWorkspaceMember` hook on `/api/v1/workspaces/:id/**`. Server-side routes don't need a `/w/:id` prefix because `:id` is always on the API path directly. Apps that relied on v1's `/w/` URL structure must migrate their frontend links.

---

## Migration from v1

### High-level changes

| Concern | v1 | v2 |
|---|---|---|
| Package split | `@boring/core` (OSS) + `@boring/cloud` (private) | **One** `@boring/core` (combined) |
| Dependency order | `core ← workspace ← agent ← cloud` | `agent (leaf) ← workspace ← core`. Agent standalone has zero core dep; plugin path depends on core. |
| UI primitives | Vendored in `@boring/core/front/design-system` | Live in `@boring/ui`; core imports from there |
| Auth | Hand-rolled `AuthProvider` + `LocalAuthProvider` / `NeonAuthProvider` | **better-auth** (email/pw + GitHub OAuth + verification + reset + magic links). `AuthProvider` interface kept as partial swap seam |
| Control plane branching | `controlPlaneProvider: 'local' \| 'neon'` in config + runtime branching | **Removed** — Postgres-only; local = in-memory stores |
| DB | Drizzle + Postgres (Neon), schema in `@boring/cloud/db` | Drizzle + Postgres, schema in `@boring/core/server/db` |
| Frontend shell | Providers exported individually; child app wires them | **`<BoringApp>`** single wrapper with react-router mounted |
| Router | No router in core; each app picks | react-router v6 mounted inside `<BoringApp>` |
| Sign-in page | Lived in `@boring/cloud/front/AuthPage` | Lives in `@boring/core/front/SignInPage` + friends |

### Removed APIs (no compat shim)

- `@boring/cloud/server/NeonAuthProvider` — better-auth replaces. For Neon Auth specifically, write a `NeonAuthProvider implements AuthProvider` yourself and pass to `createCoreApp`.
- `@boring/cloud/server/http/registerAuthRoutes` — better-auth's Fastify plugin handles `/auth/*`.
- `@boring/cloud/server/http/registerGitHubRoutes` — GitHub App install flow re-owned by `@boring/agent` when/if agent needs per-workspace git ops. Not in core.
- `@boring/core/server/runtimeConfig.ts` control-plane branching — config is flat.
- `@boring/core/server/capabilities/pythonCompat.ts` — no Python server.
- `@boring/core/server/providers/local/LocalAuthProvider` — better-auth covers local dev.

### Renames

| v1 | v2 |
|---|---|
| `@boring/core/front/design-system/ui/*` | `@boring/ui/*` |
| `@boring/core/front/UserIdentityContext` | `@boring/core/front/UserIdentityProvider` (+ `useUser()`) |
| `@boring/cloud/front/AuthPage` | `@boring/core/front/SignInPage` + `SignUpPage` + reset/verify pages |
| `@boring/cloud/server/db/*` | `@boring/core/server/db/*` |
| `@boring/cloud/server/providers/*` | `@boring/core/server/*` |
| `registerCoreRoutes({ auth, userStore, workspaceStore })` | `createCoreApp(config)` — wiring is internal |

### New APIs

- `createCoreApp(config)` — replaces the v1 "register-a-handful-of-plugins-in-the-right-order" boilerplate.
- `<BoringApp>` — replaces the v1 provider pyramid.
- `useSession`, `signIn`, `signOut` — better-auth React client.
- `useCurrentWorkspace`, `useWorkspaceRole`, `useWorkspaceMembers` — workspace-aware hooks.
- `registerCapabilitiesContributor(name, fn)` — typed capabilities contribution API.

### Migration steps for a v1 app

1. Replace `@boring/core` + `@boring/cloud` with `@boring/core`.
2. Update imports (`@boring/cloud/server` → `@boring/core/server`; `@boring/core/front/design-system/ui` → `@boring/ui`).
3. Delete hand-wired Fastify registration (`authHook`, `requestIdHook`, `secretRedaction`, `registerCoreRoutes`, `registerAuthRoutes`, `registerCollaborationRoutes`). Replace with `const app = await createCoreApp(config)`.
4. Delete the frontend provider pyramid. Replace with `<BoringApp>{routes}</BoringApp>`.
5. Remove `controlPlaneProvider` branching.
6. Auth migration (see below) if you were on Neon Auth.
7. Run `drizzle-kit migrate` against core's config.
8. Delete `AuthPage.tsx`. Override branding via `<BoringApp authPages={{ signIn: MyAuthPage }}>` if needed.
9. Remove `<BrowserRouter>` from `main.tsx` — `<BoringApp>` mounts it. Move `<Route>` into `children`.
10. `pnpm typecheck && test`. E2E: sign up → verify email → create workspace → invite → accept.

### Database migration

v1 → v2 is additive:

- Adds better-auth tables (`users`, `sessions`, `accounts`, `verification_tokens`).
- Keeps v1 tables unchanged.

#### Neon Auth → better-auth ETL (pseudocode)

**The SQL below is a sketch — final column names depend on better-auth's generated schema, which isn't finalized until M1 lands. Validate against the actual generated schema before running.**

```sql
-- SKETCH
INSERT INTO users (id, email, name, email_verified, created_at)
SELECT id, email, name, true, created_at
FROM neon_auth.users
ON CONFLICT (id) DO NOTHING;
```

**UserId continuity is load-bearing**: `workspace_members.user_id`, `workspace_invites.created_by`, `user_settings.user_id` all reference `users.id`. The ETL preserves IDs 1:1 so existing memberships + invites keep working. Renaming/regenerating IDs requires migrating those tables in the same transaction.

After ETL, better-auth owns users. Users sign in again once (password reset flow for email/pw; re-click "Sign in with GitHub" for OAuth). Sessions do not carry over.

### Rollback

v2 is a hard cut — no coexistence. Restore v1 from git + restore the DB from a pre-migration snapshot. better-auth tables can be dropped cleanly; `users` is trickier if you kept the same DB. Migrate a staging DB copy first.

---

## Milestones

Each milestone has a **Done when** checklist. A milestone is not complete until every item passes in CI.

**M0 — scaffold (day 1).**

Work:
- Package skeleton, subpath exports, typecheck green.
- Agent + workspace added as deps.

Done when:
- `packages/core/package.json` declares all 5 exports (`./server`, `./server/db`, `./front`, `./shared`, `./theme.css`) with types+import maps.
- Empty barrel files at each entry point; `pnpm --dir packages/core typecheck` green.
- `pnpm --dir packages/core test` green (empty suite, but vitest wired).
- `@boring/workspace` listed as a workspace dep; `import { Button } from '@boring/ui'` resolves without error from `packages/core/src/front/_smoke.ts`.
- CI workflow runs typecheck + test on PRs.

**M1 — DB + schema (days 2-3).**

Work:
- Drizzle schema ported from v1 cloud + new FKs.
- better-auth tables via its Drizzle adapter generator (with `sessions.userId` / `accounts.userId` `ON DELETE CASCADE`).
- `PostgresUserStore` + `PostgresWorkspaceStore` + `LocalUserStore` + `LocalWorkspaceStore`.
- `deleteUserCompletely(userId)` orchestrator.

Done when:
- All 10 tables present in `packages/core/src/server/db/schema.ts` matching §DB verbatim, including FK cascade policies.
- `pnpm --dir packages/core drizzle:generate` produces migration SQL; the generated SQL file is committed.
- Integration tests (against `boring_ui_test` DB) cover: workspace create/list/get/update/soft-delete; member upsert/remove with `last_owner` + `not_member` codes; invite create/list/get/revoke/accept with all 4 failure codes; settings write/read (metadata-only contract); runtime auto-create-on-read; **cross-app isolation** (user A in app X can't see app Y workspaces); userStore composite key `(userId, appId)` + `putUserSettings` upsert.
- **Accepted-bugs tests**: invite-accept TOCTOU test asserts the race is present (documents known issue); last-owner race same. These are "red" tests flipped to `test.fails()` or marked `.skip` with a bead reference to v1.1 fix.
- Shared `describeStoreConformance()` suite runs identically against Postgres and Local impls; green for both.
- `deleteUserCompletely` test: user with sole-owner workspace → throws `last_owner`; user with no workspaces → completes; user with co-owned workspace → completes, membership gone.

**M2 — server app factory (days 4-6).**

Work:
- `createCoreApp(config, options?)` — bodyLimit 16MB, helmet, CSP, CORS, request-ID, secret redaction, rate-limit, auth hook, error handler, graceful shutdown.
- better-auth wiring with 5 email flows (verify / resend / reset / forgot / magic-link).
- Mail transport layer (resend default, smtp via nodemailer, console fallback).
- react-email templates for all 5 transactional emails.
- `safeRedirect` util + wiring.
- Post-signup hook: invite-accept-in-transaction OR default-workspace create.
- Routes: `/health` (with DB ping), `/api/v1/config`, `/api/v1/me`, `/api/v1/workspaces/*`, `/api/v1/workspaces/:id/runtime*`, `/api/v1/capabilities`.
- **Workspace-route authorization audit** (blocker).

Done when:
- Every HTTP route in §API reference returns the correct status + `{ error, code, message, requestId }` body shape on both happy and error paths.
- better-auth is wired; an integration test with a mock `MailTransport` verifies that signup → verification email rendered + sent, forgot-password → reset email, magic-link signin → login email, invite creation → invite email.
- `safeRedirect` unit tests cover: CRLF rejection, relative path accept, off-allowlist host reject, in-allowlist host accept, fallback to `/`.
- **Parameterized membership audit** test iterates every `/api/v1/workspaces/:id/**` route and asserts 403 for a non-member and 2xx for a member — fails CI if a new workspace route is added without the guard.
- Rate-limit integration test: hammer each rate-limited endpoint from a single IP; asserts 429 + `Retry-After` header at the configured limit; asserts `/auth/signout` is NOT rate-limited.
- Contract suite (supertest) has one happy-path test per endpoint + one representative error path per endpoint.
- Managed DELETE failure semantics: if `provisioner.destroy()` throws, route returns 500 `destroy_failed`, runtime is left in `error`, and the workspace row is not deleted (integration test).
- Runtime retry guardrail semantics: `/api/v1/workspaces/:id/runtime/retry` returns 409 `runtime_unmanaged` without a provisioner/runtime and 409 `invalid_retry_state` unless the current runtime is `error` with `lastErrorOp='provision'`.
- Invite TTL / idempotency / membership invariants: config tests reject out-of-range `features.inviteTtlDays`, invite-store tests cover applying the configured TTL, repeated invite POSTs with the same idempotency key return the cached response, and both PATCH-role + DELETE-member flows surface `LAST_OWNER` when they would strand a workspace.
- Invite token-flow coverage: `/api/v1/invites/resolve` and `/api/v1/invites/accept` have happy-path coverage plus error-path coverage for `INVITE_NOT_FOUND`, `INVITE_LOCKED`, `INVITE_EXPIRED`, and `INVITE_EMAIL_MISMATCH`.
- Post-signup hook test: signup with valid `invite_token` → user joins the invited workspace (no default created); signup without token → default workspace created; signup with expired/wrong-email token → default workspace created + toast flag.
- Graceful-shutdown test: spawn the app, send SIGTERM, assert exit 0 within 30s and in-flight request completes.

**M3 — frontend shell (days 7-9).**

Work:
- `<BoringApp>` provider stack matching §Layer 2 order.
- 5 auth pages with better-auth client calls.
- `<AuthGate>`, `<UserMenu>`, `<WorkspaceSwitcher>`, `<ThemeToggle>`.
- Hooks, utils, HttpError class, apiFetch with normative contract.

Done when:
- `<BoringApp>` mounts providers in the documented order; reordering breaks a provider-order assertion test.
- All 5 auth pages render, submit, and call the correct `authClient.*` method (Playwright component tests with mocked network).
- `<VerifyEmailPage>` resend button has a 60s cooldown (disabled + timer).
- `<ResetPasswordPage>` rejects submit when the two password fields don't match (client-side).
- `<ConfigProvider>` retry-and-fail test: mock fetch to fail 3× consecutively; assert `<AppErrorBoundary>` catches `ConfigFetchError` with its refresh button.
- `useKeyboardShortcuts` OS-aware test: vitest stubs `navigator.platform`; assert Mac maps `Cmd→metaKey`, Win/Linux maps `Cmd→ctrlKey`.
- `apiFetch` throws `HttpError` with correct `{status, code, message, requestId}` on non-2xx; always sends `credentials: 'include'`.
- Storybook stories exist for all 5 auth pages + `<UserMenu>`, `<WorkspaceSwitcher>`, `<ThemeToggle>`; `pnpm storybook:build` green.
- Bundle-size smoke: core frontend entry <80KB gz (excluding workspace's shadcn primitives and react).

**M4 — agent integration (days 10-11).**

Work:
- `@boring/agent/server` exports `registerAgentRoutes` Fastify plugin.
- Plugin path wires agent's session store to core's `WorkspaceStore` runtime.
- Agent capabilities contributor.

Done when:
- Embedded test: boot `createCoreApp` + register `registerAgentRoutes`; `GET /api/v1/agent/catalog` returns 200; `GET /api/v1/capabilities` body has `.agent` key with `runtimeMode` + `tools` shape.
- Standalone test: boot `createAgentApp` without core; assert the agent package has **zero** runtime imports from `@boring/core` (tsc-driven dependency graph check).
- Round-trip test (embedded): create workspace via core, claim it via agent, run a tool, assert agent wrote to core's `WorkspaceStore.putUiState`.

**M5 — apps migration (day 12).**

Work:
- `apps/full-app` is the single reference example, boots end-to-end with `pnpm --filter full-app dev`.
- All ad-hoc auth/config has been pulled out of side examples; only `apps/full-app` survives.

Done when:
- `pnpm --filter full-app dev` boots; manual smoke + Playwright headless: sign in as `dev@local`, land on `/workspace/:id`, create a second workspace, switch between them.
- grep of the monorepo shows zero direct imports of `better-auth`, `drizzle-orm`, or `postgres` outside `packages/core`.

**M6 — hardening (days 13-14).**

Work:
- `@fastify/rate-limit` per-endpoint config.
- helmet + CSP strict defaults.
- Graceful shutdown on SIGTERM/SIGINT.
- Deep `/health`.

Done when:
- Rate-limit limits match §Auth's list exactly; test asserts `/auth/signout` passes through without limit.
- Helmet headers present on every response; CSP has the CM6 `style-src 'unsafe-inline'` exception and blocks inline-script by default; Playwright CSP test passes for `apps/full-app`.
- `/health` returns 200 when DB reachable, 503 + `db_unavailable` code when DB down (integration test with a paused Postgres container).
- SIGTERM clean-drain test: app drains in-flight, closes DB pool, exits 0 within 30s.
- SIGTERM timeout test: inject a slow route that takes 40s; send SIGTERM; assert app exits 1 with `shutdown:grace-exceeded` log line after 30s. (SIGKILL path is not testable from Node — mentioned in docs only.)

**M7 — polish (days 15-16).**

Work:
- E2E Playwright covering the full user story.
- Bundle-size regression check.
- Docs finalization.

Done when:
- Playwright E2E passes headless on CI: sign up via email → receive verification email (captured from `console://` transport in test mode) → click link → verified → create workspace → forgot-password round-trip → invite teammate (second Playwright browser) → teammate signs up via invite link → both see the same workspace.
- Bundle size deltas recorded in `packages/core/SIZE.md`; CI fails if core front entry grows >10% without an approval label.
- CORE.md has a "Shipped" banner at the top with the merge commit SHA.

Total: **~16 working days to v1** (up from 14 due to email flows + hardening milestone).

---

## Acceptance criteria

- `pnpm --dir packages/core typecheck && test && lint` all green.
- Fresh clone → `pnpm install` → `pnpm --dir apps/full-app dev` boots a working app with email/password sign-in, email verification, magic links, and a live workspace. (GitHub OAuth in v1.x.)
- No v2 app directly depends on `postgres`, `drizzle-orm`, or `better-auth` — everything goes through `@boring/core`.
- `@boring/agent` and `@boring/workspace` public APIs unchanged except for the (optional) core integration points (`registerAgentRoutes`, workspace's new `ChatPanel` import from agent).
- Integration test asserts 403 for non-members on every `/api/v1/workspaces/:id/**` route.
- Contract test asserts capabilities aggregation: disabling a contributor drops exactly its keys.

---

## Deployment

**Target: long-running Docker container on a PaaS** (Fly.io, Render, Railway, or any Docker host). `createCoreApp` is a Fastify server with a warm DB pool; it maps 1:1 to this deployment model. Serverless and bare-metal are out of v1 scope.

### What core requires from the environment

| Requirement | Detail |
|---|---|
| **Postgres** | Reachable via `DATABASE_URL`. For horizontally-scaled deployments, use a connection pooler (Neon pooler, pgbouncer, Supavisor) — core does not ship its own. Pool size defaults to 10; override via `PGPOOL_MAX` if needed (v1.x). |
| **Env vars** | Every required var from §Config. Platform secret stores work fine. |
| **Inbound** | Port `$PORT` accepting HTTPS. PaaS handles TLS termination; core speaks HTTP to its edge proxy. |
| **Outbound** | mail API (`api.resend.com` or SMTP host). v1.x adds `api.github.com` for OAuth. |
| **Reverse-proxy** | Fastify configured with `trustProxy: true` for `X-Forwarded-For` parsing through Fly/Render/Railway edge. M2_FACTORY enforces this. |
| **pgcrypto extension** | Enabled by the first migration via `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Required for `workspace_settings` encryption. M1_DRIZZLE_CONFIG enforces this. |
| **Filesystem** | Stateless by default. Only needed if `STATIC_DIR` points at a volume. |
| **Signals** | PaaS sends SIGTERM on deploy; core drains for 30s then exits cleanly. |

### Migration timing

`drizzle-kit migrate` must run **before** `createCoreApp` serves traffic. Two supported patterns:

1. **Release phase / pre-deploy job** (Fly `release_command`, Render pre-deploy, Railway `railway run`): the platform runs migrations once per deploy, then starts the web service.
2. **In-process at boot** — core exports `runMigrations(config)` that child apps can call before `createCoreApp`. Race-prone with multiple replicas (all replicas try to migrate); acceptable for small apps or single-replica setups. Use advisory locks inside `runMigrations` to serialize across replicas.

### Reference Dockerfile

Core ships `packages/core/Dockerfile.reference` that child apps extend. Skeleton:

```dockerfile
FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile && pnpm -r build
EXPOSE 3000
CMD ["node", "apps/full-app/dist/server/main.js"]
```

### Runtime topology reference

```
┌─────────────────┐     HTTPS     ┌─────────────────┐
│  PaaS edge (TLS)│ ───────────▶ │  Docker: core   │
└─────────────────┘               │   Fastify :3000 │
                                  └──────┬──────────┘
                                         │ DATABASE_URL (pooled)
                                         ▼
                                  ┌─────────────────┐
                                  │  Postgres (Neon │
                                  │  / Supabase /   │
                                  │  self-hosted)   │
                                  └─────────────────┘
                                         │ outbound
                                         ▼
                                  ┌─────────────────┐
                                  │  Resend /       │
                                  │  GitHub OAuth   │
                                  └─────────────────┘
```

### Health checks

- **Liveness**: `GET /health` with DB ping (`SELECT 1`) and a 2s timeout. Returns 200 `{ ok: true }` if DB reachable; 503 `{ error: 'db_unavailable', code: 'db_unavailable', message, requestId }` on DB unreachable/timeout. Hook into the platform's liveness probe with a 5s interval, 3 retries, 30s initial delay.
- **Readiness**: same endpoint. Core is ready once migrations complete and DB pool is warm. If `runMigrations` is in-process, readiness blocks on it.

### Not in v1

- Serverless (Vercel / AWS Lambda) — requires per-request DB connection strategy + refactoring `createCoreApp`'s boot flow to support cold starts.
- Bare-metal / systemd — child apps document their own unit files.
- Kubernetes helm chart — v1.x if demand shows.
- Blue-green / canary orchestration — PaaS-level concern, not core's.

## V7 surface area

This section is the shortest path to what v7 actually shipped. Use it as the app-author view; keep the spec for design history and deferred ideas.

### Workspace provisioner SPI

`createCoreApp(config, { provisioner })` now accepts an optional `WorkspaceProvisioner`:

```ts
export interface WorkspaceProvisioner {
  provision(ctx: {
    workspaceId: string
    workspaceName: string
    ownerId: string
    appId: string
  }): Promise<{ volumePath: string }>
  destroy(workspaceId: string): Promise<void>
}
```

Two integration modes are supported:

- **Managed**: pass a provisioner. `POST /api/v1/workspaces` provisions immediately, persists `runtime.volumePath`, and `DELETE /api/v1/workspaces/:id` calls `destroy()` before soft-delete.
- **Managed auto-heal caveat**: `GET /api/v1/workspaces/:id/runtime` still auto-creates a missing runtime row as `ready`, even when a provisioner exists. Treat that as migration-gap recovery, not proof that provisioning finished correctly.
- **Unmanaged**: omit the provisioner. Workspaces are just DB rows. `POST /api/v1/workspaces/:id/runtime/retry` returns 409 `runtime_unmanaged`.

Filesystem driver wiring:

```ts
import { createCoreApp, createFsProvisioner, loadConfig } from '@boring/core/server'

const config = await loadConfig()
const app = await createCoreApp(config, {
  provisioner: createFsProvisioner({
    rootDir: '/var/lib/my-app/workspaces',
  }),
})
```

`createFsProvisioner({ rootDir })` is the only concrete v7 driver. It requires an absolute root, creates `rootDir/<workspaceId>` with mode `0700`, rejects path traversal, and removes the directory recursively on destroy.

Future-driver guidance: if you add an async/cloud provisioner later, do not stretch the current `pending | ready | error` runtime shape. Re-introduce a richer state machine, worker handoff, and fencing so provisioning side effects stay serialized.

### Workspace UI pages

`<BoringApp>` now mounts these workspace-management routes by default:

| Route | Auth requirement | Notes |
|---|---|---|
| `/w/:id/settings` | Signed-in workspace member | Anyone in the workspace can load the page. Rename/save uses editor-or-better APIs; delete and runtime retry stay owner-gated. |
| `/w/:id/members` | Signed-in workspace member | Owners can promote/demote and remove others. Any member can leave their own membership unless they are the last owner. |
| `/w/:id/invites` | Signed-in workspace member | Members can view outstanding invites; owner-only actions create and revoke invites. |
| `/invites/:token` | Public route shell; accept requires sign-in | `AuthGate` treats `/invites/*` as public so signed-out users can land on the page, inspect the invite, then sign in and resume acceptance. |

These routes are registered inside `BoringApp` itself; child apps do not need to add their own route definitions unless they want to override the defaults.

### Command palette integration

Core exports a pure builder from `@boring/core/front`:

```ts
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getWorkspaceCommands } from '@boring/core/front'
import { useCommandRegistry } from '@boring/workspace'

export function WorkspaceCommandBridge() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const commandRegistry = useCommandRegistry()

  useEffect(() => {
    if (!id) return
    for (const command of getWorkspaceCommands(id, navigate)) {
      commandRegistry.registerCommand({
        id: command.id,
        title: command.label,
        run: command.run,
      })
    }
  }, [commandRegistry, id, navigate])

  return null
}
```

`getWorkspaceCommands(workspaceId, navigate)` returns three shipped entries today: settings, members, and invites. `@boring/workspace`'s `CommandConfig` expects `title`, so the adapter maps `WorkspaceCommand.label` into that field when registering. The core return type stays framework-light (`{ id, label, keywords?, run }`) so apps can adapt it to `@boring/workspace`, a custom palette, or any other command surface without pulling in React hooks.

### Workspace settings encryption

Shipped algorithm and storage contract:

- Encryption happens in Postgres via `pgcrypto` `pgp_sym_encrypt(...)` / `pgp_sym_decrypt(...)::text`.
- Ciphertext is stored directly in `workspace_settings.value bytea`.
- `getWorkspaceSettings(workspaceId)` returns metadata only: `Array<{ key, configured, updated_at }>` and never plaintext.
- Typed accessors are responsible for decrypting individual keys and for handling key-rotation mismatches.

Rotation procedure:

1. Lock workspace-settings writes behind a feature flag or maintenance gate.
2. Take a backup.
3. Run a one-shot rotation script that reads rows with the old key, decrypts, re-encrypts with the new key, and writes them back in batches.
4. Deploy the new `WORKSPACE_SETTINGS_ENCRYPTION_KEY`.
5. Verify representative typed reads and generic metadata reads.
6. Unlock writes.

Operational guidance:

- Planning number: start with **~5-15 seconds of write downtime per 1000 rows** for a single-worker batch rotation on app-local Postgres. This is an estimate, not a benchmark from this repo; large ciphertext payloads or cross-region DB links will push it higher.
- Staging test: copy a few hundred representative `workspace_settings` rows into staging, rotate with a fake old/new key pair, verify generic `/settings` still returns metadata, then run the typed accessor(s) your app actually depends on before scheduling production downtime.

### Migration notes

The v7 substrate migration makes four operator-visible changes:

- It drops `workspaces.machine_id`, `workspaces.volume_id`, and `workspaces.fly_region`. Any leftover data in those columns is intentionally discarded.
- It narrows `workspace_runtimes.state` to `pending | ready | error`.
- It adds `workspace_runtimes.volume_path`, `workspace_runtimes.last_error_op`, invite breaker columns, and the `idempotency_keys` table.

Preflight cleanup for old runtime rows:

```sql
SELECT workspace_id, state, updated_at
FROM workspace_runtimes
WHERE state IN ('provisioning', 'destroying', 'destroyed');

UPDATE workspace_runtimes
SET state = 'error',
    last_error = COALESCE(last_error, 'v7 migration cleanup: legacy runtime state'),
    updated_at = NOW()
WHERE state IN ('provisioning', 'destroying', 'destroyed');
```

That cleanup query is intentionally conservative: it forces operators to inspect stuck legacy runtime rows instead of silently treating them as healthy. After the migration lands, only `error` rows whose `last_error_op='provision'` are retryable through `/api/v1/workspaces/:id/runtime/retry`; destroy-side failures are retried by issuing `DELETE` again after fixing the underlying problem. Also note that `GET /api/v1/workspaces/:id/runtime` still auto-heals a missing runtime row to `ready`, even in managed mode, so a missing row should be treated as a migration gap to investigate rather than proof that provisioning completed.

### Configuration additions

New load-bearing config in v7:

- `features.inviteTtlDays`: global invite TTL in days, default `7`, validated to `1..30`, applied in the store layer rather than as a SQL default.
- `encryption.workspaceSettingsKey`: still the same config key, but now explicitly documented as a rotation-sensitive operational key.
- `provisioner`: **not** an env var. Apps wire it at the `createCoreApp(config, { provisioner })` call site so filesystem/cloud runtime ownership stays explicit in server code.

### V7 error codes

New runtime / invite-breaker codes added by the v7 implementation:

| Code | Meaning |
|---|---|
| `provision_failed` | Workspace create or runtime retry failed while calling the managed provisioner. |
| `destroy_failed` | Managed workspace delete failed while destroying backing runtime state. |
| `runtime_unmanaged` | Runtime retry was requested for a workspace with no managed provisioner/runtime. |
| `invalid_retry_state` | Runtime retry was requested outside the `error + lastErrorOp='provision'` precondition. |
| `invite_locked` | Too many failed invite accept attempts temporarily locked the token. |

Existing codes that became especially load-bearing in the v7 UI and multi-user flows:

| Code | Meaning |
|---|---|
| `last_owner` | A member remove/demote action would leave the workspace with zero owners. |
| `invite_not_found` | Token or invite id did not resolve to a live invite. |
| `invite_email_mismatch` | The signed-in user's email does not match the invite email. This is the shipped code name for the v7 spec's earlier `WRONG_USER_EMAIL` placeholder. |

## Open questions deferred to v1.x

- SQLite/libsql support for agent CLI zero-setup (currently handled via `LocalUserStore`).
- **GitHub OAuth login** (`<SignInPage>` "Sign in with GitHub" button) — deferred to v1.x to ship together with agent's GitHub App install flow. Users do "Connect GitHub" once instead of twice. Adds ~1 day when it lands (better-auth `socialProviders: { github: { ... } }` is one config block + one button).
- Additional OAuth providers (Google, Apple, Discord) — beyond GitHub, all v1.x+.
- GitHub App install flow (owned by `@boring/agent` when it grows git ops).
- Stripe / billing.
- Audit log table.
- Per-workspace API keys (headless access).
- 2FA / TOTP.
- Session revocation UI (`DELETE /api/v1/me/sessions/:id`).
- Fixes for the three accepted-known-issues race conditions (invite-accept TOCTOU, last-owner race, default promotion).
- **Email change post-signup** — email is immutable in v1. Users who need a new email create a new account. `<UserSettings>` disables the email field.
- **Workspace transfer / changeOwner** — no dedicated method in v1. Workaround: owner promotes target via `upsertMember('owner')` then removes self via `removeMember` (which trips the last-owner race, documented). Proper atomic transfer ships with v1.1's last-owner fix.
- **Workspace list pagination** — `list(userId)` returns all. Cursor-based pagination (`{ cursor?, limit? }` → `{ items, nextCursor }`) is deferred; expected scale <20 workspaces per user.
- **Workspace archive** (pause without delete) — not planned.
- **Account linking** (one user + multiple OAuth providers on different emails) — better-auth supports it, UX not scoped.
- **Logout-all-sessions UI** — backend exists (sessions table), UI not in v1.
- **Impersonation / admin-as-user** — not scoped.
- Cascade delete / scheduled GC for soft-deleted workspaces.
