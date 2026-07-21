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

Data flow: the browser fetches public runtime config, then auth/session. Compatibility
hosts retain the current default-Workspace behavior. Typed product hosts derive only a
product scope before authentication and never create a Workspace implicitly;
post-authenticated typed selection and creation are separate flows. `/workspace/:id`
gates on workspace identity match, then the workspace/agent surfaces warm in the
background (see `CHAT_FIRST_WORKSPACE_BOOT.md`).

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
  `requireWorkspaceMember(role)` is a preHandler for membership/role checks.
- **Stores** — `UserStore` / `WorkspaceStore` / `AuthProvider` interfaces with Postgres
  implementations; `CORE_STORES=local` selects in-memory dev stores for the base app
  factory (note: `createCoreWorkspaceAgentServer` requires `CORE_STORES=postgres`).
- **Config** — `loadConfig()` merges `boring.app.toml` + env, validates with
  `coreConfigSchema`, and exposes a redacted `RuntimeConfig` to the frontend.
- **Error contract** — one Fastify error handler emits `{ error, code, message, requestId }`;
  the client's `apiFetch` rehydrates these as `HttpError` with a typed `ErrorCode`.

### Typed product-domain host configuration

`createCoreWorkspaceAgentServer` accepts one server-only typed-product bundle:

```ts
await createCoreWorkspaceAgentServer({
  coreProductRouting: {
    domains: [
      { hostname: 'legal.products.example.com', workspaceTypeId: 'legal' },
      { hostname: 'research.products.example.com', workspaceTypeId: 'research' },
    ],
    workspaceProducts: [
      { workspaceTypeId: 'legal', label: 'Legal', allowWorkspaceCreation: true },
      { workspaceTypeId: 'research', label: 'Research', allowWorkspaceCreation: false },
    ],
  },
  workspacePolicyWorkspaceTypeIds: ['legal', 'research'],
  sharedAuthCookieDomain: 'products.example.com',
})
```

Typed mode requires exact Core/Workspace type-ID coverage, an explicit narrowest
registrable cookie parent, HTTPS + secure cookies, and an exact CORS-origin set for
the declared product domains. Better Auth sessions are shared across those trusted
subdomains; unsafe auth mutations and redirects from any other origin fail closed.
The cookie domain is never inferred from `Host` or forwarding headers.

Omit all three options for compatibility mode. Supplying only a companion option,
combining typed routing with `requestScopeResolver`, using `legacy-unsafe` proxy trust,
or configuring an incomplete/broad origin or cookie scope fails startup with a stable
error code. `CoreProductRequestScope` contains only hostname-derived type/create-policy
facts; it is not membership or Workspace authority. Until the C2 post-authenticated
membership/type guard lands, typed mode intentionally returns a stable 503 for every
non-public `/api/v1/*` surface; do not enable it for product traffic yet. After building
Core, run the deterministic browser/server proof against an isolated Postgres database
with `C1_PROOF_DATABASE_URL=... node scripts/c1-shared-auth-browser-proof.mjs`;
the Core auth suite covers the same Better Auth signup/session/origin/redirect/logout
flow directly.

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

## Docs

Architecture / contracts:
- [CHAT_FIRST_WORKSPACE_BOOT.md](./CHAT_FIRST_WORKSPACE_BOOT.md) — auth/workspace/agent
  gating contract: pre-auth draft, identity gate, background boot, readiness error codes.
- [PLUGIN_INTEGRATION.md](./PLUGIN_INTEGRATION.md) — how core consumes workspace plugins
  (static front/server plugins, default packages, why hot reload is off, UiBridge limits).

Operations:
- [DEPLOYMENT_WORKFLOW.md](./DEPLOYMENT_WORKFLOW.md) — ownership split across core/workspace/
  agent and the (partly forward-looking) Fly.io + deployment-snapshot release flow.

Reference app: [`apps/full-app`](../../../apps/full-app/) — canonical production example
(Fly.io, Postgres, Resend, vercel-sandbox); see its README for run/deploy steps.

`docs/plans/archive/` holds historical planning and spec documents. They record how
features were designed and are not current truth — verify against code before relying on them.

Note: `packages/core/SIZE.md` is not documentation — it is the bundle-size baseline
enforced by CI (`pnpm ci:core-bundle-size`). Update it only via
`check-bundle-size.ts --update-baseline`.
