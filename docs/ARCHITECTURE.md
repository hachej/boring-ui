# Architecture

## System Overview

```
Browser                            Backend (FastAPI)                   External
┌──────────────────────┐           ┌──────────────────────────┐       ┌──────────┐
│  React + DockView    │  HTTP     │  app.py (create_app)     │       │ Filesystem│
│  ┌────────────────┐  │ ──────── │  ├── /api/capabilities   │ ───── │ Git repos │
│  │ PaneRegistry   │  │          │  ├── modules/files/      │       │ PTY procs │
│  │ LayoutManager  │  │  WS      │  ├── modules/git/        │       └──────────┘
│  │ ControlPlane   │  │          │  ├── modules/control_plane│
│  │ ConfigProvider │  │ ──────── │  ├── modules/pty/        │
│  │ CapabilityGate │  │          │  ├── modules/stream/     │       ┌──────────┐
│  └────────────────┘  │          │  ├── modules/agent_normal│       │ Claude   │
│                      │          │  ├── approval.py         │ ───── │ API      │
│  Panels:             │          │  ├── policy.py           │       └──────────┘
│  FileTree, Editor,   │          │  └── workspace_plugins.py│
│  Terminal, Shell,    │          └──────────────────────────┘
│  Review, Companion,  │
│  PI                  │
└──────────────────────┘
```

## Frontend Architecture

### Entry Flow

`main.jsx` -> `App.jsx` -> DockView layout with capability-gated panels

### Layers

1. **Config** (`app_config_loader.py`, `/__bui/config`, `config/appConfig.js`, `ConfigProvider.jsx`): Loads `boring.app.toml`, serves the runtime payload from `/__bui/config`, deep-merges frontend config defaults, and provides the result via React context. Controls branding, panel defaults, feature flags, and theme tokens.

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
1. `create_app()` does not mount `/api/v1/macro/*` routes in core.
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

## Backend Architecture

### Application Factory

`create_app()` in `app.py` wires everything:
1. Creates `APIConfig` (workspace root, CORS, PTY providers, companion/PI URLs)
2. Builds a `RouterRegistry` with all available routers
3. Mounts only the enabled subset of routers
4. Mounts capabilities endpoint reflecting actual availability
5. Optionally mounts workspace plugins (`/api/x`)

### Module Structure

Each backend module follows router/service separation:

```
modules/
├── files/          File CRUD: list, read, write, delete, rename, move, search
│   ├── router.py   FastAPI endpoints
│   └── service.py  Business logic (path validation, storage ops)
├── git/            Git operations: status, diff, show
│   ├── router.py
│   └── service.py
├── control_plane/  Workspace/user/collab metadata foundation
│   ├── router.py   Foundation API at /api/v1/control-plane/*
│   ├── auth_router.py Auth/session routes at /auth/* (local mode)
│   ├── auth_router_neon.py Auth/session routes at /auth/* (Neon Auth / Better Auth)
│   ├── me_router.py User identity/settings at /api/v1/me* (local mode)
│   ├── me_router_neon.py User identity/settings at /api/v1/me* (Neon hosted mode)
│   ├── workspace_router.py Workspace lifecycle/settings at /api/v1/workspaces* (local mode)
│   ├── workspace_router_hosted.py Workspace lifecycle/settings at /api/v1/workspaces* (Neon hosted mode)
│   ├── collaboration_router.py Membership/invite routes at /api/v1/workspaces/{id}/{members,invites}* (local mode)
│   ├── collaboration_router_hosted.py Membership/invite routes at /api/v1/workspaces/{id}/{members,invites}* (Neon hosted mode)
│   ├── workspace_boundary_router.py Reserved + pass-through routes at /w/{workspace_id}/... (local mode)
│   ├── workspace_boundary_router_hosted.py Reserved + pass-through routes at /w/{workspace_id}/... (Neon hosted mode)
│   ├── auth_session.py HMAC session cookie primitives
│   ├── service.py  Domain facade for users/workspaces/members/invites/settings/runtime
│   ├── repository.py JSON-backed repository contracts + local implementation
│   ├── models.py   Persisted state model
│   ├── common.py   Shared hosted control-plane helpers
│   ├── db_client.py Asyncpg pool + Neon host handling
│   └── membership.py Hosted membership helpers
├── pty/            PTY terminal sessions via WebSocket
│   ├── router.py   WS endpoint at /ws/pty
│   ├── lifecycle.py REST lifecycle at /api/v1/pty/*
│   └── service.py
├── stream/         Claude chat stream via WebSocket
│   ├── router.py   WS endpoint at /ws/agent/normal/stream
│   └── service.py
└── agent_normal/   Agent-normal runtime session management
    └── router.py   REST at /api/v1/agent/normal/*
```

### Auth Provider Architecture

The control plane supports two auth providers, selected via `CONTROL_PLANE_PROVIDER`:

| Provider | Auth mechanism | Database | When to use |
|---|---|---|---|
| `local` | Dev bypass (no real auth) | In-memory JSON | Local development |
| `neon` | Neon Auth (Better Auth) | Neon Postgres (asyncpg) | **Production default** |

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

**Database access** uses `asyncpg` with raw SQL for the hosted Neon path; local development uses the JSON-backed repository.

### Cross-Cutting Concerns

- **Path Security**: `APIConfig.validate_path()` prevents traversal attacks. All file ops must call this.
- **CORS**: Configured via `APIConfig.cors_origins`, defaults allow dev origins.
- **Workspace Plugins**: Optional, disabled by default. Execute local Python modules. Guarded by allowlist.
- **Approval Workflow**: `approval.py` + `policy.py`. In-memory store for tool use approval requests.

## Data Flow

### File Operation
```
FileTree -> fetch /api/v1/files/list -> files/router.py -> files/service.py -> os.listdir
```

### Chat Session
```
Terminal -> WS /ws/agent/normal/stream -> stream/router.py -> stream_bridge.py -> Claude API
```

### PTY Shell
```
Shell -> WS /ws/pty?provider=shell -> pty/router.py -> pty/service.py -> ptyprocess.spawn('bash')
```

## Key Design Decisions

1. **Capability gating over feature flags**: Backend advertises what's available; frontend adapts. No compile-time flags.
2. **Router registry pattern**: Backend features are independently mountable. Enables minimal deployments.
3. **Error-first degradation**: Missing capabilities show clear error states, never blank screens or silent failures.
4. **Config deep merge**: Override only what you need; defaults always provide a working baseline.
5. **Layout recovery chain**: Try saved -> validate -> migrate -> last-known-good -> fresh defaults.
6. **Service separation**: Distinct service boundaries established (workspace-core, pty-service, agent-*) for hosted deployment.
