# @boring/core — Package Spec

**Status:** draft — interview-driven, 2026-04-24
**Path:** `boring-ui-v2/packages/core/`
**Siblings:** `@boring/agent` (already shipped v1), `@boring/workspace` (already shipped v1)

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

## Locked decisions (from 2026-04-24 interview)

| Decision | Choice |
|---|---|
| Package shape | **One combined package** (`@boring/core`) — no separate `@boring/cloud`. Local and real providers coexist behind interfaces. |
| DB stack | **Drizzle + Postgres (Neon)** — port v1 schema as-is (workspaces, members, invites, workspace_settings, user_settings). SQLite fallback is a v1.x concern. |
| Auth | **better-auth** with email/password + GitHub OAuth. Drizzle adapter against the same Postgres. `AuthProvider` interface kept as a seam for Neon/Clerk swap later. |
| Tenancy | Port v1: **workspaces + members + invites** with owner/editor/viewer roles. Matches agent's `workspaceId` per instance. |
| Frontend shell | `<BoringApp>` mounts **react-router v6** with a route slot (`<Outlet />` or `routes` prop). Default routes: `/auth/signin`, `/auth/signup`, `/auth/callback/github`, `/me`. Child apps add everything else. |
| UI primitives | Stay in **`@boring/workspace/ui-shadcn`** (current location). Core depends on workspace for UI; workspace does not depend on core. We invert the v1 dependency order — see §Dependency position. |
| Full-app wrapping | Server factory + frontend shell + config bridge + user/workspace management + auth — all four in-scope for v1. |

## Dependency position

v1 had `core ← workspace ← agent`. v2 fully inverts the chain:

```
  @boring/agent         (leaf — ZERO internal deps; ships standalone CLI)
        ^
        |
  @boring/workspace     (depends on agent; consumes ChatPanel as a pane,
                         workspace-only UI otherwise)
        ^
        |
  @boring/core          (depends on workspace; transitively on agent)
```

**Rationale for each edge:**

- **workspace → agent**: workspace's `ChatPanel` pane consumes `@boring/agent`'s `<ChatPanel />` React component + `useAgentChat()` hook. This matches the agent v1 spec's "sibling workspace package composes `<ChatPanel />` into a full-layout repo." Agent stays a leaf with no knowledge of workspace or core.
- **core → workspace**: core imports shadcn primitives from `@boring/workspace/ui-shadcn` for its sign-in page, user menu, workspace switcher. Workspace stays frontend-only from core's perspective.

**Agent's two integration shapes (both first-class):**

1. **Standalone** — `createAgentApp(config)` boots Fastify + agent routes directly. **Zero core dependency.** Uses agent's own in-memory session store. This is what `npx @boring/agent` runs. No DB, no auth, no workspaces table required.
2. **Embedded in a core app** — `registerAgentRoutes(app, opts)` Fastify plugin mounts onto a core-built server. Consumed by core apps that want multi-user + DB + auth + real workspace membership. Agent package exports both; the plugin path is a thin wrapper over the same internal `AgentRuntime`.

Agent's v1 spec listed a future `@boring/cloud` for workspace management. That role now belongs to `@boring/core`.

## Non-goals (v1)

- SQLite / libsql support. Postgres-only in v1.
- Social login beyond GitHub. Google/Apple/Discord are v1.x.
- Billing / Stripe integration.
- Server-side rendering. `<BoringApp>` is client-rendered only.
- GitHub App install flow — deferred to `@boring/agent` in v1.x, when agent grows a git tool. Agent will write its own encrypted keys via core's store API.
- Browser-only builds of core's server subpath (same import discipline as v1).

**Pulled back into v1 scope (reversal from earlier draft):**

- **Email verification + password reset + magic links** are IN SCOPE for v1. v1 of the old project already shipped all three; dropping them is a user-visible regression. better-auth enables each with ~1 config flag + a mail transport. Adds ~1 day total to M2. See AUTH.md.

## Subpath exports

```json
{
  "exports": {
    "./server": { "types": "./dist/server/index.d.ts", "import": "./dist/server/index.js" },
    "./server/db": { "types": "./dist/server/db/index.d.ts", "import": "./dist/server/db/index.js" },
    "./front": { "types": "./dist/front/index.d.ts", "import": "./dist/front/index.js" },
    "./shared": { "types": "./dist/shared/index.d.ts", "import": "./dist/shared/index.js" },
    "./theme.css": "./dist/front/theme.css"
  }
}
```

- No bare `@boring/core` import. Consumers pick a subpath.
- `./server` never imports browser modules; enforced by tsup config + lint rule.

## Layer 1 — Server

### `./server` — HTTP app factory

```ts
export async function createCoreApp(config: CoreConfig): Promise<FastifyInstance>
```

Boots Fastify with:

- **Request ID hook** + **secret redaction** (ported from v1).
- **DB pool** on `app.db` (Drizzle client, Postgres).
- **Auth** on `app.auth` (better-auth instance + cookie plugin).
- **Core routes** registered:
  - `GET /health` — liveness + DB ping.
  - `GET /api/v1/config` — runtime config for the frontend (redacted).
  - `GET /api/v1/me` — current user + settings.
  - `PUT /api/v1/me/settings` — update user settings.
  - `GET /api/v1/capabilities` — aggregated capabilities. Contributors register via `app.registerCapabilitiesContributor(name, fn)` at boot (see Capabilities contributor API below).
  - `GET /api/v1/workspaces` — list workspaces for current user.
  - `POST /api/v1/workspaces` — create.
  - `GET /api/v1/workspaces/:id/members` + invites CRUD.
  - `POST /auth/*` — better-auth's own routes (mounted via its Fastify plugin).
- **Static hosting** (ported from v1) when `config.staticDir` is set.

Downstream packages (`@boring/agent`) register their own routes by:

```ts
import { registerAgentRoutes } from '@boring/agent/server'
await app.register(registerAgentRoutes)  // agent route paths are absolute (/api/v1/agent/*)
```

**No `prefix` option** — agent route paths are already absolute (`/api/v1/agent/*`), double-prefixing would break them. `registerAgentRoutes` is a new export on `@boring/agent/server` (added in M4); `createAgentApp(config)` remains the standalone entrypoint and takes **no core dependency**.

### Capabilities contributor API

```ts
// Type
export type CapabilitiesContributor = (ctx: { db: Database; config: CoreConfig }) =>
  Partial<CapabilitiesResponse> | Promise<Partial<CapabilitiesResponse>>

// Registration (at boot, before app.listen)
app.registerCapabilitiesContributor('agent', agentCapabilities)
app.registerCapabilitiesContributor('workspace', workspaceCapabilities)
```

`GET /api/v1/capabilities` merges contributor outputs with a `{ [contributorName]: {...} }` shape. Core ships its own core-scoped capabilities as the first contributor. Contract-tested: disabling a contributor must drop exactly its keys from the response.

### `./server/auth` — better-auth

- `createAuth(config, db)` — returns the better-auth instance wired to Postgres via Drizzle adapter. Configured with email/password + GitHub OAuth.
- `authHook(app)` — Fastify `preHandler` that attaches `request.user` (or 401s for `/api/v1/*` paths). `/auth/*`, `/health`, `/api/v1/config` bypass.
- `requireWorkspaceMember(role?)` — Fastify hook that reads `workspaceId` from params and asserts membership/role via `WorkspaceStore`. Matches v1 semantics.

The `AuthProvider` interface from v1 is kept as a wrapper around better-auth so route handlers and `requireWorkspaceMember` don't import better-auth directly:

```ts
export interface AuthProvider {
  verifySession(token: string): Promise<SessionPayload | null>
  issueSession(user: { id: string; email: string }): Promise<string>
  cookieName(): string
}
```

Default implementation (`BetterAuthProvider`) delegates to better-auth. Route handlers only see the interface.

**Honest disclaimer on swap tightness**: the seam is a *partial* abstraction. Route handlers are insulated, but `/auth/*` route shapes, the React client (`useSession`/`signIn`/`signOut`), and sign-in page flows are all better-auth-shaped. Swapping to Neon/Clerk later means re-implementing those surfaces, not just replacing `BetterAuthProvider`. The seam is adequate for mid-stack consumers, not a full dependency-injection story.

**UserId continuity invariant**: `workspace_members.userId`, `workspace_invites.createdBy`, `user_settings.userId` all reference the `users.id` owned by better-auth. If we ever swap providers, the new provider must preserve userIds (or the swap ships with an ID-mapping migration). This is a load-bearing invariant, not an incidental coupling.

### `./server/db` — Drizzle schema + stores

Schema ports v1's tables with two deliberate changes: (1) v2 owns `users` (better-auth), so we **add** real FKs from `workspace_members.userId`, `workspace_invites.createdBy`, `user_settings.userId` → `users.id` which v1 couldn't have (Neon Auth owned users externally); (2) `users`/`sessions`/`accounts`/`verification_tokens` are new. Everything else matches v1 column-for-column. See `/home/ubuntu/projects/boring-ui/packages/cloud/src/server/db/schema.ts`:

- `users` — **new** table owned by better-auth (replaces v1's Neon Auth users).
- `sessions`, `accounts`, `verification_tokens` — better-auth internal tables.
- `workspaces` — id, appId, name, createdBy, createdAt, isDefault, machineId.
- `workspace_members` — (workspaceId, userId, role).
- `workspace_invites` — id, workspaceId, email, tokenHash, role, expiresAt, acceptedAt.
- `workspace_settings` — (workspaceId, key, value bytea with pgcrypto encryption).
- `user_settings` — (userId, appId, settings jsonb, email, display_name).

Stores (interfaces + Postgres impls):

- `UserStore` — `getById`, `getByEmail`, `upsert`, `getSettings`, `putSettings`.
- `WorkspaceStore` — CRUD + member/invite management + settings read/write. Port v1 contract (see `providers/types.ts`).

`LocalUserStore` + `LocalWorkspaceStore` (in-memory, from v1) are kept for tests and CLI zero-setup mode. The agent package's CLI shape can boot without Postgres by passing local stores.

### `./server/config` — config loader

Ports `loadConfig` from v1 with simplifications:

- Reads `boring.app.toml` for static branding + app id.
- Reads env for secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`).
- Zod-validates the merged config.
- `buildRuntimeConfigPayload(config)` returns the redacted client-facing subset served at `GET /api/v1/config`.

Removes v1's `controlPlaneProvider: 'local' | 'neon'` branching — v2 is Postgres-only.

## Layer 2 — Frontend

### `./front` — `<BoringApp>` shell

```tsx
export function BoringApp(props: {
  /** Additional routes the child app provides. Rendered inside the layout. */
  children: React.ReactNode
  /** Optional: override default auth page copy/branding. */
  authPages?: { signIn?: React.FC; signUp?: React.FC }
})
```

Mounts, in this order:

1. `<AppErrorBoundary>` — outermost, catches everything including provider errors.
2. `QueryClientProvider` (TanStack Query — used for `/api/v1/me`, workspace list, etc).
3. `ConfigProvider` — fetches `/api/v1/config` once, blocks render until loaded. `useConfig()` + `useConfigLoaded()`.
4. `ThemeProvider` — light/dark/system. `useTheme()` + `<ThemeToggle />` (ported from v1).
5. `AuthProvider` — wraps better-auth's React client. `useSession()`, `signIn()`, `signOut()`.
6. `UserIdentityProvider` — resolves `useUser()` from better-auth session; hydrates settings from `/api/v1/me`.
7. `<BrowserRouter>` — **mounted BEFORE** `WorkspaceAuthProvider` so workspaceId can be read from URL params.
8. `WorkspaceAuthProvider` — rendered inside the router. `useCurrentWorkspace()` + `useWorkspaceRole()`. Reads `workspaceId` from URL param (`/workspace/:id`) or falls back to user's default workspace.
9. `<Routes>` with default routes:
   - `/auth/signin` → `<SignInPage>` (email/pw + "Sign in with GitHub" button).
   - `/auth/signup` → `<SignUpPage>`.
   - `/auth/callback/github` → better-auth's callback handler.
   - `/auth/verify-email` → email verification landing.
   - `/auth/forgot-password` → password reset request.
   - `/auth/reset-password` → password reset form.
   - `/me` → user settings page.
   - Everything else → `children` (the child app's routes).
10. `<AuthGate>` — redirects unauthenticated users to `/auth/signin` for non-public routes.

### `./front/hooks` (ported from v1, updated for better-auth)

- `useSession()` — wraps better-auth React client.
- `useUser()` — current user + settings.
- `useCurrentWorkspace()` / `useWorkspaceRole()` / `useWorkspaceMembers()`.
- `useKeyboardShortcuts()` — v1 port.
- `useViewportBreakpoint()` / `useReducedMotion()` / `useBlobUrl()` — v1 ports.
- `useCapabilities()` — reads `GET /api/v1/capabilities`.

### `./front/components`

- `<SignInPage>` / `<SignUpPage>` — styled with `@boring/workspace/ui-shadcn` primitives.
- `<UserMenu>` — avatar + dropdown (sign out, settings). Consumed by child apps' headers.
- `<WorkspaceSwitcher>` — list + create + switch current workspace.
- `<AppErrorBoundary>` — v1 port.
- `<ThemeToggle>` — v1 port, styled with workspace primitives.

### `./front/utils` (ported from v1)

- `apiFetch` / `apiFetchJson` — credentialed fetch with auto-JSON + error class.
- `routes` / `routeHref` — typed route table.
- `getApiBase` / `buildApiUrl` — env-aware URL builder.
- `sanitizeMarkdown` / `sanitizeToolOutput` / `debounce` / a11y utilities.

## `./shared`

- `CoreConfig` — Zod-validated config type.
- `SessionPayload`, `User`, `Workspace`, `WorkspaceMember`, `WorkspaceInvite` — shared between server and frontend.
- `MemberRole = 'owner' | 'editor' | 'viewer'`.
- Typed HTTP error codes.

## Milestones

**M0 — scaffold (day 1).**
- Package skeleton (`package.json`, `tsup`, `tsconfig`, vitest configs).
- Subpath exports wired. Empty barrel files. `pnpm --dir packages/core typecheck` green.
- Agent + workspace added as deps.

**M1 — DB + schema (days 2-3).**
- Drizzle schema ported from v1 cloud.
- better-auth tables added via its Drizzle adapter generator.
- Migration script + `drizzle-kit generate` wired.
- `PostgresUserStore` + `PostgresWorkspaceStore` ported.
- `LocalUserStore` + `LocalWorkspaceStore` ported (test + CLI fallback).
- Integration tests against `boring_ui_test` DB.

**M2 — server app factory (days 4-6).**
- `createCoreApp(config)`.
- better-auth Fastify plugin mounted with email/pw + GitHub OAuth + **email verification + password reset + magic links** enabled.
- Mail transport integration (nodemailer or resend) required for the three email flows.
- `authHook`, `requireWorkspaceMember`, request-ID, secret redaction.
- Routes: `/health` (with DB ping), `/api/v1/config`, `/api/v1/me`, `/api/v1/workspaces/*`, `/api/v1/capabilities`.
- **Workspace-route authorization audit** (blocker): every `/api/v1/workspaces/:id/**` handler wears `requireWorkspaceMember(role?)`. Integration test asserts 403 for non-members on every workspace-scoped route. v1 shipped without this; v2 must not.
- Contract tests (supertest) for each route.

**M3 — frontend shell (days 7-9).**
- `<BoringApp>` provider stack (order per §Layer 2).
- `<SignInPage>` / `<SignUpPage>` / `<ForgotPasswordPage>` / `<ResetPasswordPage>` / `<VerifyEmailPage>`.
- `<AuthGate>`, `<UserMenu>`, `<WorkspaceSwitcher>`, `<ThemeToggle>`.
- Hooks: `useUser`, `useSession`, `useCurrentWorkspace`, `useCapabilities`.
- Storybook stories for each component.

**M4 — agent integration (days 10-11).**
- `@boring/agent/server` adds a new `registerAgentRoutes(app, opts)` Fastify plugin export. Mounts agent's `/api/v1/agent/*` routes onto a core-built server and uses core's `WorkspaceStore` + `UserStore` when present.
- `createAgentApp(config)` **unchanged** — remains the standalone entrypoint with zero core dependency. Both exports coexist; they share the internal `AgentRuntime`.
- When embedded via plugin, `workspaceId` is sourced from `WorkspaceStore` / URL param. Standalone keeps the configured-constant behavior from agent v1 spec.
- Agent registers a capabilities contributor via `app.registerCapabilitiesContributor('agent', ...)` in the plugin path only.

**M5 — apps/playground migration (day 12).**
- `apps/workspace-playground` wrapped in `<BoringApp>`.
- Add a new `apps/full-app` example that shows the canonical wiring (core + workspace + agent).
- Remove ad-hoc auth/config code from existing apps.

**M6 — hardening (days 13-14).**
- **Rate limiting** (`@fastify/rate-limit`) on `/auth/*` and `/api/v1/auth/*`. Default: 5 signin attempts / min / IP; 3 signups / hour / IP.
- **Helmet + CSP strict** defaults. CSP exceptions for CM6 (`style-src 'unsafe-inline'`) already shipped in workspace.
- **Graceful shutdown** on SIGTERM: stop accepting requests → drain in-flight → close DB pool → exit.
- **Deep `/health`** that pings DB (already in §Layer 1 route list).

**M7 — polish (days 15-16).**
- E2E Playwright: sign up → verify email → create workspace → forgot password round-trip → invite member → member signs up → accepts invite → both see workspace.
- Bundle size check (core front <80KB gz excluding workspace primitives).
- Docs: quickstart, customization ladder (token/className/asChild/pane/route override), API reference.

Total: ~16 working days to v1 (up from 14 due to email flows + hardening milestone).

## Open questions deferred to v1.x

- SQLite/libsql support for agent CLI zero-setup mode (currently handled via `LocalUserStore`).
- Additional OAuth providers (Google, Apple, Discord).
- GitHub App install flow (owned by `@boring/agent` when it grows git ops).
- Stripe / billing.
- Audit log table.
- Per-workspace API keys.
- GitHub App install flow (was in v1 cloud — agent package will re-own this when it needs per-workspace git operations).

## Files not to port from v1

- `@boring/cloud` as a separate package — collapsed into core.
- `NeonAuthProvider` / Neon Auth HTTP client — better-auth replaces.
- `registerAuthRoutes` (v1's hand-rolled auth routes) — better-auth's Fastify plugin replaces.
- Python-compat capabilities (`pythonCompat.ts`) — v2 has no Python server.
- `controlPlaneProvider: 'local' | 'neon'` branching in config — Postgres-only.

## Acceptance criteria

- `pnpm --dir packages/core typecheck && test && lint` all green.
- Fresh clone + `pnpm install` + `pnpm --dir apps/full-app dev` boots a working app with sign-in, GitHub OAuth, and a live workspace.
- No v2 app directly depends on `postgres`, `drizzle-orm`, or `better-auth` — everything goes through `@boring/core`.
- `@boring/agent` and `@boring/workspace` public APIs unchanged except for the (optional) core integration points.
