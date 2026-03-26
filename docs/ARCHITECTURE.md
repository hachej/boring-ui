# Architecture

## System Overview

```
Browser                      Backend (TypeScript HTTP API)             External
┌──────────────────────┐           ┌──────────────────────────┐       ┌──────────┐
│  React + DockView    │  HTTP     │  app.ts (createApp)      │       │ Filesystem│
│  ┌────────────────┐  │ ──────── │  ├── /health + /api/     │ ───── │ Git repos │
│  │ PaneRegistry   │  │          │  │   capabilities        │       │ bwrap     │
│  │ LayoutManager  │  │  SSE     │  ├── http/fileRoutes.ts │       └──────────┘
│  │ ConfigProvider │  │          │  ├── http/gitRoutes.ts  │
│  │ CapabilityGate │  │ ──────── │  ├── http/execRoutes.ts │       ┌──────────┐
│  │ DataProviders  │  │          │  ├── http/githubRoutes.ts│ ──── │ Anthropic│
│  └────────────────┘  │          │  ├── http/piRoutes.ts   │       │ API      │
│                      │          │  ├── http/aiSdkRoutes.ts│       └──────────┘
│  Panels:             │          │  └── workspace/resolver.ts│
│  FileTree, Editor,   │          └──────────────────────────┘
│  Review, Agent,      │
│  Data Catalog        │
└──────────────────────┘
```

## Frontend Architecture

### Entry Flow

`main.jsx` -> `App.jsx` -> DockView layout with capability-gated panels

### Layers

1. **Config** (`src/server/services/runtimeConfig.ts`, `/__bui/config`, `config/appConfig.js`, `ConfigProvider.jsx`): Builds the runtime payload served from `/__bui/config`, deep-merges frontend config defaults, and provides the result via React context. Controls branding, panel defaults, feature flags, and theme tokens.

2. **Registry** (`registry/panes.js`): Declares all available panels with their component, placement, size constraints, and backend requirements (`requiresFeatures`, `requiresRouters`). Single source of truth for pane identity.

3. **Capabilities** (`hooks/useCapabilities.js`): Fetches `/api/capabilities` on mount. Provides a context with the feature/router availability map.

4. **Layout** (`layout/LayoutManager.js`): Manages DockView layout persistence in localStorage. Handles versioned migration, structural validation, last-known-good backup, and fallback to fresh defaults.

5. **Gate** (`components/CapabilityGate.jsx`): Wraps each panel. Checks registry requirements against capabilities context. Renders the real component or an error state (`PaneErrorState.jsx`).

6. **Panels** (`panels/`): DockView panel wrappers. Each delegates to a component in `components/`. Panels are the UI feature surface; components are reusable view logic.

7. **Providers** (`providers/companion/`, `providers/pi/`): Chat provider implementations for Companion and PI agents. Follow a registry pattern for pluggable AI backends.

### PI Native Tool Dimensions

PI native tooling is explicitly split along two dimensions:

1. **Chat/runtime surface** (PI native adapter): model/provider transport and session lifecycle.
2. **Filesystem backend** (active DataProvider): file/git/python execution primitives.

For PI native only:
- UI primitives (`open_file`, `list_tabs`) are frontend bridge tools and do not depend on DataProvider.
- Backend primitives (`read_file`, `write_file`, `rename_file`, `move_file`, `search_files`, `git_*`, optional `python_exec`) are DataProvider-bound.
- Tool composition happens in `providers/pi/defaultTools.js` and is injected by `providers/pi/nativeAdapter.jsx`.

Backend agent surfaces exposed through API endpoints (`agent-companion`, `agent-pi`, `agent-normal`) should use the frontend command API contract, not browser `window` bridge tools.

### Editor Content Sync Guardrails

Markdown editor state in `panels/EditorPanel.jsx` keeps two content tracks:
- live editor content (`content`)
- last persisted baseline (`savedContent`)

Dirty/autosave decisions compare against `savedContent`, not the transient live value. Parent parameter sync only reapplies content when the incoming `contentVersion` is newer than local. This prevents stale `initialContent` from resetting typed markdown after autosave or callback-only panel parameter updates.

### Frontend Networking

- `utils/apiBase.js`: Base URL resolution
- `utils/routes.js`: Canonical route definitions for API endpoints
- `utils/transport.js`: Shared fetch/WS transport helpers
- `utils/controlPlane.js`: Control-plane-aware URL building (hosted mode)
- `utils/workspaceNavigation.js`: Workspace-scoped navigation helpers

### Ownership Contract (vNext)

Route and service ownership follows the `boring-ui` core contract in `docs/plans/boring-ui-core-ownership-contract.md`:

1. `boring-ui` core owns auth/session (`/auth/*`), user identity (`/api/v1/me`), workspace lifecycle/settings, membership/invites, and workspace-level files/git authority.
2. `boring-macro` is domain-only and must stay under `/api/v1/macro/*`.
3. `boring-sandbox` is optional edge infrastructure only (proxy/routing/provisioning/token injection) and must not duplicate workspace/user business logic.

Enforcement notes:
1. `createApp()` does not mount `/api/v1/macro/*` routes in core.
2. Macro boundary guardrail tests live in `tests/unit/test_macro_boundary_guardrails.py`.
3. Workspace boundary pass-through (`/w/{workspace_id}/{path}`) only forwards `/auth/*`, `/api/v1/me*`, `/api/v1/workspaces*`, `/api/v1/files*`, and `/api/v1/git*`.
4. Final keep-vs-move audit: see Ownership Audit appendix at end of this file.
5. Cutover and rollback operations are documented in `docs/runbooks/OWNERSHIP_CUTOVER.md`.

Deployment can run in:

1. Core mode: frontend routes directly to `boring-ui`.
2. Edge mode: frontend keeps canonical routes while `boring-sandbox` pass-through sits at the edge.

Core mode runtime profiles:

1. `pi-lightningfs` (default): PI rail + browser LightningFS.
2. `pi-cheerpx`: PI rail + browser CheerpX runtime.
3. `pi-httpfs` (dev/debug): PI rail + backend files/git APIs.

Edge mode runtime profile:

1. `companion-httpfs` (default): Companion rail + backend files/git via edge proxy.

## Backend Architecture (TypeScript)

### Application Factory

`createApp()` in `src/server/app.ts` wires everything:
1. Loads `ServerConfig` from environment (fail-closed validation)
2. Registers plugins: CORS, cookie, request ID middleware
3. Mounts public routes: health, capabilities, `/__bui/config`
4. Mounts authenticated routes: files, git, exec, workspaces, me, collaboration, GitHub, UI state
5. Mounts workspace boundary routing (`/w/{id}/*`)
6. Optionally mounts static file serving + SPA fallback

### Module Structure

The TypeScript backend uses a service/transport separation pattern:

```
src/server/
├── app.ts                  Fastify app factory (createApp)
├── config.ts               Config loader + Zod-style validation
├── index.ts                Server entry point
├── services/               Domain services (transport-independent)
│   ├── capabilitiesImpl.ts Abstract capability vocabulary
│   ├── pythonCompatCapabilities.ts Legacy Python-compat response
│   ├── runtimeConfig.ts    /__bui/config payload builder
│   ├── gitImpl.ts          Git operations via simple-git
│   ├── githubImpl.ts       GitHub App JWT + OAuth
│   ├── uiStateImpl.ts      UI state persistence (in-memory)
│   ├── extensionTrust.ts   Extension trust model
│   └── (stubs)             files, exec, auth, workspaces, users, approval
├── http/                   Fastify HTTP routes
│   ├── health.ts           /health, /healthz, /api/capabilities, /__bui/config
│   ├── fileRoutes.ts       /api/v1/files/* (7 endpoints)
│   ├── gitRoutes.ts        /api/v1/git/* (16 endpoints)
│   ├── execRoutes.ts       /api/v1/exec (short + long-running jobs)
│   ├── workspaceRoutes.ts  /api/v1/workspaces/* (CRUD, settings, runtime)
│   ├── meRoutes.ts         /api/v1/me (identity, settings)
│   ├── collaborationRoutes.ts Members + invites
│   ├── githubRoutes.ts     GitHub OAuth + installations
│   ├── uiStateRoutes.ts    UI state snapshots + commands
│   ├── workspaceBoundary.ts /w/{id}/* → workspace-scoped routing
│   └── static.ts           Static file serving + SPA fallback
├── trpc/                   Child-app tRPC extension framework
│   └── framework.ts        Framework exports for child routers/tools
├── adapters/               Workspace backend implementations
│   ├── bwrapImpl.ts        Bubblewrap sandbox (production exec backend)
│   └── bwrap.ts            WorkspaceBackend interface
├── auth/                   Authentication
│   ├── session.ts          HS256 JWT session cookies (jose, PyJWT-compatible)
│   ├── middleware.ts        Fastify onRequest auth hook
│   ├── validation.ts        Redirect URL allowlisting, config checks
│   └── neonClient.ts        Neon Auth API client (stub)
├── workspace/              Workspace resolution
│   ├── resolver.ts          Backend resolver (bwrap/lightningfs/justbash)
│   ├── membership.ts        DB membership checks
│   ├── paths.ts             Safe path resolution
│   └── boundary.ts          Passthrough prefix constants
├── db/                     Database (Drizzle ORM + postgres.js)
│   ├── schema.ts            Drizzle schema (generated by drizzle-kit pull)
│   ├── relations.ts         Table relations
│   └── index.ts             Client factory
├── jobs/                   Long-running execution
│   └── execJob.ts           Job lifecycle (start/read/cancel)
└── middleware/              Cross-cutting concerns
    ├── requestId.ts          X-Request-Id propagation
    └── secretRedaction.ts    Pino log redaction
```

### Legacy Python Backend (src/back/)

The Python backend in `src/back/boring_ui/api/` is being replaced by the TypeScript backend above. During the dual-stack migration period, both exist. The Python backend is the reference implementation for parity testing via smoke suites.

### Auth Provider Architecture

The control plane supports two auth providers, selected via `CONTROL_PLANE_PROVIDER`:

| Provider | Auth mechanism | Database | When to use |
|---|---|---|---|
| `local` | Dev bypass (no real auth) | In-memory JSON | Local development |
| `neon` | Neon Auth (Better Auth) | Neon Postgres (Drizzle + postgres.js) | **Production default** |

**Neon Auth flow** (email/password):
1. Frontend calls boring-ui `POST /auth/sign-in` or `POST /auth/sign-up` on the same origin
2. boring-ui calls Neon Auth server-to-server and keeps provider-specific session handling out of the browser
3. For verify-email signup, Neon redirects back to boring-ui `/auth/callback?redirect_uri=/w/<workspace_id>/...`
4. boring-ui completes the follow-up Neon sign-in on the backend and redirects directly into the requested workspace path
5. boring-ui verifies the EdDSA JWT via JWKS (`/.well-known/jwks.json`, EdDSA/Ed25519)
6. boring-ui issues `boring_session` cookie (HS256 JWT, independent of provider)
7. All subsequent requests use the `boring_session` cookie

The older browser-driven Neon `/token` -> `/auth/token-exchange` flow still exists as a compatibility path, but it is no longer the preferred verify-email path.

**Session cookies** are boring-ui's own format (HS256 JWT signed with `BORING_UI_SESSION_SECRET`), not provider-specific. This enables cross-service interop with boring-sandbox regardless of auth provider.

**Database access** uses `drizzle-orm` with `postgres.js` in the TS server. Local mode still uses the dev bypass auth/control-plane path, while the Python backend remains only for parity and rollback workflows.

### Cross-Cutting Concerns

- **Path Security**: enforced by TS safe-path helpers and route-level validation in `workspace/resolver.ts`, `http/fileRoutes.ts`, `http/execRoutes.ts`, and `services/aiSdkTools.ts`.
- **CORS**: configured from `ServerConfig.corsOrigins` in `src/server/config.ts`.
- **Approval Workflow**: `src/server/services/approval.ts` defines the transport-independent store contract, but the full TS approval surface is still a follow-up port.

## Data Flow

### File Operation
```
FileTree -> fetch /api/v1/files/list -> http/fileRoutes.ts -> fs/promises
```

### AI SDK Chat Session
```
AgentPanel -> POST /api/v1/agent/chat -> http/aiSdkRoutes.ts -> services/aiSdkTools.ts -> Anthropic API
```

### Server PI Streaming
```
AgentPanel -> POST/SSE /api/v1/agent/pi/sessions/:id/stream -> http/piRoutes.ts -> agent/piRuntime.ts
```

## Key Design Decisions

1. **Capability gating over feature flags**: Backend advertises what's available; frontend adapts. No compile-time flags.
2. **Router registry pattern**: Backend features are independently mountable. Enables minimal deployments.
3. **Error-first degradation**: Missing capabilities show clear error states, never blank screens or silent failures.
4. **Config deep merge**: Override only what you need; defaults always provide a working baseline.
5. **Layout recovery chain**: Try saved -> validate -> migrate -> last-known-good -> fresh defaults.
6. **Service separation**: Distinct service boundaries established (workspace-core, pty-service, agent-*) for hosted deployment.
