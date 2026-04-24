# API

Planned export surface for `@boring/core` v1. Nothing in this file is shipped yet — see [plans/core-package-spec.md](./plans/core-package-spec.md) §Milestones for land order.

## Entry Points

No bare `@boring/core` import. Consumers pick a subpath.

- `@boring/core/server` — Node-only: Fastify app factory, DB, auth, stores, config loader.
- `@boring/core/server/db` — Drizzle schema + migrations + store interfaces (separate subpath so migrations tooling can import without pulling the server).
- `@boring/core/front` — Browser: `<BoringApp>` shell, hooks, components.
- `@boring/core/shared` — Isomorphic types and error codes.
- `@boring/core/theme.css` — Token bridge consumed by the frontend shell.

## `@boring/core/server` (planned)

```ts
// App factory
export function createCoreApp(config: CoreConfig): Promise<FastifyInstance>

// Config
export function loadConfig(options?: LoadConfigOptions): Promise<CoreConfig>
export function validateConfig(config: unknown): CoreConfig
export function buildRuntimeConfigPayload(config: CoreConfig): RuntimeConfig

// Auth
export function createAuth(config: CoreConfig, db: Database): BetterAuthInstance
export const authHook: FastifyPluginAsync
export function requireWorkspaceMember(role?: MemberRole): FastifyPluginCallback
export interface AuthProvider { /* see AUTH.md */ }
export class BetterAuthProvider implements AuthProvider {}

// Stores (interfaces + impls)
export interface UserStore { /* see DB.md */ }
export interface WorkspaceStore { /* see DB.md */ }
export class PostgresUserStore implements UserStore {}
export class PostgresWorkspaceStore implements WorkspaceStore {}
export class LocalUserStore implements UserStore {}       // in-memory, for tests + CLI
export class LocalWorkspaceStore implements WorkspaceStore {}

// Routes (internal — mounted by createCoreApp)
export const registerCoreRoutes: FastifyPluginAsync

// Capabilities contributor API
export type CapabilitiesContributor = (ctx: { db: Database; config: CoreConfig }) =>
  Partial<CapabilitiesResponse> | Promise<Partial<CapabilitiesResponse>>

declare module 'fastify' {
  interface FastifyInstance {
    registerCapabilitiesContributor(name: string, fn: CapabilitiesContributor): void
  }
}
```

### Agent integration — two first-class shapes

```ts
// Shape A (embedded): agent exports a Fastify plugin that mounts onto a core app.
import { registerAgentRoutes } from '@boring/agent/server'
await app.register(registerAgentRoutes)   // paths absolute: /api/v1/agent/*

// Shape B (standalone): agent boots its own Fastify. NO core dependency.
import { createAgentApp } from '@boring/agent/server'
const app = await createAgentApp(agentOnlyConfig)
```

Both are maintained by the agent package. Core never calls `createAgentApp`; standalone agent never imports core.

## `@boring/core/server/db` (planned)

```ts
export * from './schema'          // Drizzle pgTable definitions
export * from './relations'       // Drizzle relations
export { createDb } from './connection'  // postgres driver + Drizzle client
```

Schema tables (see [DB.md](./DB.md) for column detail):

- `users`, `sessions`, `accounts`, `verification_tokens` — owned by better-auth.
- `workspaces`, `workspaceMembers`, `workspaceInvites`, `workspaceSettings`, `userSettings` — ported from v1.

## `@boring/core/front` (planned)

```tsx
// Shell
export function BoringApp(props: BoringAppProps): JSX.Element

// Providers (exposed individually for advanced wiring)
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
export function useWorkspaceMembers(workspaceId: string): WorkspaceMember[]
export function useCapabilities(): CapabilitiesResponse
export function useKeyboardShortcuts(bindings: Binding[]): void
export function useViewportBreakpoint(): Breakpoint
export function useReducedMotion(): boolean
export function useBlobUrl(blob: Blob | null): string | null

// Components
export function SignInPage(): JSX.Element
export function SignUpPage(): JSX.Element
export function UserMenu(): JSX.Element
export function WorkspaceSwitcher(): JSX.Element
export function ThemeToggle(): JSX.Element
export function AppErrorBoundary(props: { children: ReactNode }): JSX.Element
export function AuthGate(props: { children: ReactNode }): JSX.Element

// Utils
export function apiFetch(url: string, init?: RequestInit): Promise<Response>
export function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T>
export function getApiBase(): string
export function buildApiUrl(path: string): string
export const routes: RouteMap
export function routeHref(name: keyof RouteMap, params?: Record<string, string>): string
export function sanitizeMarkdown(input: string): string
export function sanitizeToolOutput(input: string): string
export function debounce<T>(fn: T, ms: number): T
```

## `@boring/core/shared` (planned)

```ts
export type User = { id: string; email: string; name: string | null; createdAt: string }
export type Workspace = { id: string; name: string; appId: string; createdBy: string; /* ... */ }
export type WorkspaceMember = { workspaceId: string; userId: string; role: MemberRole; createdAt: string }
export type WorkspaceInvite = { /* ... */ }
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type SessionPayload = { userId: string; email: string; issuedAt: number; expiresAt: number }
export type RuntimeConfig = { appId: string; appName: string; apiBase: string; features: Record<string, boolean> }
export type CapabilitiesResponse = { /* aggregated */ }

// Error codes
export const ERROR_CODES = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  VALIDATION_FAILED: 'validation_failed',
  WORKSPACE_FULL: 'workspace_full',
  INVITE_EXPIRED: 'invite_expired',
  /* ... */
} as const
```

## HTTP Surface (planned)

Served by `createCoreApp(config)`:

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + DB ping |
| GET | `/api/v1/config` | Redacted runtime config |
| GET | `/api/v1/me` | Current user + settings (401 if no session) |
| PUT | `/api/v1/me/settings` | Update user settings |
| GET | `/api/v1/capabilities` | Aggregated capabilities. Shape: `{ core: {...}, agent?: {...}, workspace?: {...} }` keyed by contributor. Contributors register via `app.registerCapabilitiesContributor(name, fn)` at boot. |
| GET | `/api/v1/workspaces` | List user's workspaces |
| POST | `/api/v1/workspaces` | Create workspace |
| GET | `/api/v1/workspaces/:id` | Get workspace |
| PUT | `/api/v1/workspaces/:id` | Update workspace |
| DELETE | `/api/v1/workspaces/:id` | Delete (soft) |
| GET | `/api/v1/workspaces/:id/members` | List members |
| POST | `/api/v1/workspaces/:id/members` | Add member |
| DELETE | `/api/v1/workspaces/:id/members/:userId` | Remove member |
| GET | `/api/v1/workspaces/:id/invites` | List invites |
| POST | `/api/v1/workspaces/:id/invites` | Create invite |
| POST | `/api/v1/workspaces/:id/invites/:inviteId/accept` | Accept invite (workspace-scoped, matches `WorkspaceStore.acceptInvite(workspaceId, inviteId, userId)`) |
| DELETE | `/api/v1/workspaces/:id/invites/:inviteId` | Revoke invite |
| ANY | `/auth/*` | better-auth routes (sign in, sign up, OAuth callbacks, sign out) |
