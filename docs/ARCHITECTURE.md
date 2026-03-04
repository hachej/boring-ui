# Architecture

## System Overview

```
Browser                            Backend (FastAPI)                   External
┌──────────────────────┐           ┌──────────────────────────┐       ┌──────────┐
│  React + DockView    │  HTTP     │  app.py (create_app)     │       │ Filesystem│
│  ┌────────────────┐  │ ──────── │  ├── /api/capabilities   │ ───── │ Git repos │
│  │ PaneRegistry   │  │          │  ├── modules/files/      │       │ PTY procs │
│  │ LayoutManager  │  │  WS      │  ├── modules/git/        │       └──────────┘
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

1. **Config** (`config/appConfig.js`, `ConfigProvider.jsx`): Loads `app.config.js`, deep-merges with defaults, provides via React context. Controls branding, storage prefix, panel defaults, feature flags, and theme tokens.

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

### Frontend Networking

- `utils/apiBase.js`: Base URL resolution
- `utils/routes.js`: Canonical route definitions for API endpoints
- `utils/transport.js`: Shared fetch/WS transport helpers
- `utils/controlPlane.js`: Control-plane-aware URL building (hosted mode)
- `utils/workspaceNavigation.js`: Workspace-scoped navigation helpers

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
