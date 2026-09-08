# @hachej/boring-core — docs

`@hachej/boring-core` is the foundation package every boring-ui v2 child app imports
first. It owns persistence and identity (Postgres + Drizzle), authentication
(better-auth: email/password, verification, password reset, magic links, optional
Google), config loading (TOML + env, Zod-validated), the Fastify HTTP app factory, and
the React frontend shell with auth/workspace gating. Domain logic, agent runtime, and
workspace UI live in sibling packages (`@hachej/boring-agent`, `@hachej/boring-workspace`,
`@hachej/boring-ui-kit`); core composes them through its `app/*` surfaces.

## Architecture

```
Browser
  CoreFront / CoreWorkspaceAgentFront   (front shell: config + theme + auth + workspace gates)
        │ HTTP (cookie session, typed apiFetch -> HttpError)
  Fastify app (createCoreApp / createCoreWorkspaceAgentServer)
        │ authHook (req.user), helmet, CORS, rate limit, idempotency, error handler
  better-auth (sessions, email flows)  ──>  mail transport (resend/smtp/console)
        │
  Drizzle + Postgres  (users, sessions, workspaces, members, invites, settings, runtime handles)
```

Data flow: the browser fetches public runtime config, then auth/session; an
authenticated user always has a default workspace. `/workspace/:id` gates on workspace
identity match, then the workspace/agent surfaces warm in the background (see
`CHAT_FIRST_WORKSPACE_BOOT.md`).

### Source layout (`src/`)

- `server/` — `config/` (loadConfig, Zod schema), `auth/` (createAuth, authHook,
  requireWorkspaceMember), `db/` (schema, connection, stores, migrate), `routes/`
  (workspaces, members, settings, invites), `mail/` (transport + React Email templates),
  `middleware/` (idempotency), `provisioner/`, `runtime/` (sandbox handle store),
  `security/`, `telemetry/`, `app/` (`createCoreApp`).
- `front/` — `CoreFront` shell, `auth/` (pages + hooks), `workspace/` (members/invites/
  settings pages), `components/`, `hooks/`, `commands/`, `apiFetch`/`routes` utils.
- `app/` — composition layer that fuses core + workspace + agent: `server/`
  (`createCoreWorkspaceAgentServer`, `runCoreWorkspaceAgentServer`, dev/vercel handlers),
  `front/` (`CoreWorkspaceAgentFront`, chat-first shells), `vite/`
  (`createBoringAppViteAliases`).
- `shared/` — isomorphic types (`User`, `Workspace`, `CoreConfig`, `RuntimeConfig`) and
  errors (`HttpError`, `ErrorCode`, `ERROR_CODES`).

### Public entry points (package `exports`)

| Import | Env | Surface |
|--------|-----|---------|
| `@hachej/boring-core/server` | Node | `createCoreApp`, `loadConfig`, `createAuth`, route registrars, stores, mail, db helpers |
| `@hachej/boring-core/server/db` | Node | Drizzle schema, `createDatabase`, `runMigrations` |
| `@hachej/boring-core/front` | Browser | `CoreFront`, auth pages + hooks, workspace pages, `apiFetch`, `UserMenu`, `WorkspaceSwitcher` |
| `@hachej/boring-core/shared` | Any | types + `HttpError`/`ErrorCode` |
| `@hachej/boring-core/app/server` | Node | `createCoreWorkspaceAgentServer`, `runCoreWorkspaceAgentServer`, dev + vercel handlers |
| `@hachej/boring-core/app/front` | Browser | `CoreWorkspaceAgentFront`, chat-first shell options |
| `@hachej/boring-core/app/vite` | Node | `createBoringAppViteAliases` (React singleton dedupe) |
| `@hachej/boring-core/theme.css`, `/app/front/styles.css` | Browser | Core/app-shell styles that compose the shared `--boring-*` token system; workspace owns the base Tailwind token/reset contract |

## Key abstractions

- **App factory** — `createCoreApp(config, options)` returns a wired Fastify instance
  (auth hook, security, error handler, core routes). `createCoreWorkspaceAgentServer`
  (in `app/server`) extends it with workspace + agent routes; this is what real apps use.
- **Front shell** — `CoreFront` mounts config/theme/auth/workspace providers and gates.
  `CoreWorkspaceAgentFront` (in `app/front`) is the full composed shell used by child apps
  (e.g. `apps/full-app/src/front/main.tsx`). There is no `BoringApp` component.
- **Auth** — `createAuth` wraps better-auth; `authHook` populates `req.user`;
  `requireWorkspaceMember(role)` is a preHandler for membership/role checks. Child apps that
  serve auth from multiple hosts may pass `createCoreWorkspaceAgentServer({ authBaseURL: {
  allowedHosts, protocol } })`; entries must be exact `host[:port]` values (no wildcards,
  schemes, or paths). This changes only Better Auth callback resolution: `config.auth.url`
  remains canonical, forwarded host/protocol headers are not trusted, and unlisted hosts fail closed.
- **Stores** — `UserStore` / `WorkspaceStore` / `AuthProvider` interfaces with Postgres
  implementations; `CORE_STORES=local` selects in-memory dev stores for the base app
  factory (note: `createCoreWorkspaceAgentServer` requires `CORE_STORES=postgres`).
- **Config** — `loadConfig()` merges `boring.app.toml` + env, validates with
  `coreConfigSchema`, and exposes a redacted `RuntimeConfig` to the frontend.
- **Error contract** — one Fastify error handler emits `{ error, code, message, requestId }`;
  the client's `apiFetch` rehydrates these as `HttpError` with a typed `ErrorCode`.

## Architectural decisions

- Core owns persistence + identity; everything else injects stores via interfaces — keeps
  one source of truth for users/workspaces/sessions.
- Single config source (`boring.app.toml` + env, Zod-validated at boot) — fail fast,
  no scattered config.
- Postgres-only via Drizzle — one dialect, real migrations in `drizzle/`.
- Email flows ship as real React Email templates, not stubs — auth UX works out of the box.
- Hot reload is disabled in core (it is multi-workspace and resolves plugins statically);
  use standalone `@hachej/boring-workspace` server for plugin HMR/SSE.
- Client-rendered shell only (no SSR), fail-closed on config/auth fetch.

## Invite idempotency

`POST /api/v1/workspaces/:id/invites` accepts an optional `Idempotency-Key`.
After authorization and body validation, the key is scoped to the configured
app, create-invite operation, workspace, and actor. Reusing it with another
email or role returns `409 idempotency_key_conflict`; concurrent requests
return `409 idempotency_in_progress` until the owner records its response.
Completed responses replay for 24 hours from completion. Requests without a
key retain their existing behavior.

Apply migration `0028_invite_idempotency_claims` before deploying this code.
Custom `IdempotencyKeyStore` adapters must implement the new atomic `claim`
method: only one caller may receive `claimed`, and completed responses must
remain bound to the original request hash. The existing `find` and `set`
methods remain available; `find` returns completed responses only. Custom
middleware users must include operation and authorization scope in `guard`'s
scope string or request callback.

If the process stops or response persistence fails after the claim, its effects
may have happened. The claim stays unresolved and is not swept automatically;
inspect the invite/mail outcome before operational reconciliation. This avoids
blindly sending another invite; it does not promise exactly-once email delivery.
The new scoped key format cannot safely replay the old globally keyed cache.
A still-live legacy receipt returns `409 idempotency_key_conflict` without
replaying its tenant metadata or running effects. Wait for its existing
24-hour expiry or inspect the original outcome; do not blindly change keys.
Drain old in-flight invite requests before deploying: older servers do not
claim keys before effects, so unfinished requests without a receipt cannot be
detected by the new middleware.

## Docs

Architecture / contracts:
- [CHAT_FIRST_WORKSPACE_BOOT.md](./CHAT_FIRST_WORKSPACE_BOOT.md) — auth/workspace/agent
  gating contract: pre-auth draft, identity gate, background boot, readiness error codes.
- [PLUGIN_INTEGRATION.md](./PLUGIN_INTEGRATION.md) — how core consumes workspace plugins
  (static front/server plugins, default packages, why hot reload is off, UiBridge limits).

Operations:
- [DEPLOYMENT_WORKFLOW.md](./DEPLOYMENT_WORKFLOW.md) — ownership split across core/workspace/
  agent and the partly forward-looking deployment-snapshot release flow.

Reference app: [`apps/full-app`](../../../apps/full-app/) — production-shaped local
composition example (Postgres, Resend, vercel-sandbox). It is not a live deployment owner.

`docs/plans/archive/` holds historical planning and spec documents. They record how
features were designed and are not current truth — verify against code before relying on them.

Note: `packages/core/SIZE.md` is not documentation — it is the bundle-size baseline
enforced by CI (`pnpm ci:core-bundle-size`). Update it only via
`check-bundle-size.ts --update-baseline`.
