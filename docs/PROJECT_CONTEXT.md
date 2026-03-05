# Project Context

boring-ui is a composable, capability-gated web IDE framework. It provides a panel-based UI shell (React + DockView) backed by a modular FastAPI backend. Panels declare their backend requirements and the system automatically degrades gracefully when features are unavailable.

## What It Does

boring-ui gives you a browser-based IDE experience with:
- A file tree with git status integration
- A TipTap-based markdown/code editor
- Claude AI chat sessions via WebSocket streaming
- Shell terminals via PTY WebSocket
- A tool approval workflow for AI agent actions
- Companion and PI agent integrations (pluggable chat providers)
- Layout persistence with versioned migration and recovery

The key design property: you compose the backend from independent routers and the frontend adjusts automatically via capability gating.

## Stack

- **Frontend**: React 18, Vite 5, TailwindCSS 4, DockView (panel layout), Zustand (state), xterm.js (terminal), TipTap (editor)
- **Backend**: Python 3, FastAPI, uvicorn, ptyprocess (PTY), websockets
- **Tests**: Vitest (unit), Playwright (e2e), pytest (backend)
- **Build**: Vite for frontend (dev + lib modes), pip/pyproject.toml for backend
- **Deploy**: Core mode (single `boring-ui` backend) or optional edge mode with `boring-sandbox`

## Deployment Modes and Runtime Profiles

- **Core mode**: frontend routes directly to `boring-ui` (no edge sandbox in request path).
- **Edge mode (optional)**: frontend routes through `boring-sandbox` edge pass-through/provisioning layer; workspace business logic still lives in `boring-ui`.

Core mode runtime profiles:
- `pi-lightningfs` (default): PI rail + browser-local LightningFS.
- `pi-cheerpx`: PI rail + browser VM/sandbox filesystem.
- `pi-httpfs` (dev/debug): PI rail + backend filesystem APIs.

Edge mode runtime profile:
- `companion-httpfs` (default): Companion rail + backend filesystem via edge proxy.

## Repo Layout

```
boring-ui/
src/front/          React frontend (App.jsx, components, panels, hooks, layout, registry)
src/back/boring_ui/ Python backend (FastAPI app factory, config, modules)
docs/               Architecture, design docs, execution plans, runbooks
tests/              Backend pytest tests
scripts/            Gates, E2E runner, utilities
app.config.js       Frontend configuration overrides
vite.config.ts      Vite build configuration
pyproject.toml      Python packaging
```

## Key Abstractions

| Abstraction | Location | Purpose |
|---|---|---|
| PaneRegistry | `src/front/registry/panes.js` | Maps pane IDs to components + capability requirements |
| CapabilityGate | `src/front/components/CapabilityGate.jsx` | Wraps panes; shows error state when backend lacks required features |
| LayoutManager | `src/front/layout/LayoutManager.js` | Persists/restores/migrates DockView layout state |
| RouterRegistry | `src/back/boring_ui/api/capabilities.py` | Registers backend routers; powers `/api/capabilities` |
| APIConfig | `src/back/boring_ui/api/config.py` | Central config dataclass injected into all router factories |
| create_app() | `src/back/boring_ui/api/app.py` | Application factory wiring routers, middleware, and capabilities |

## Recent Work

The `control-plan-decoupling` branch completed the bd-3g1g epic (Service Split + Control-Plane Decoupling + Legacy Cutover). boring-ui now has distinct service boundaries (workspace-core, pty-service, agent-normal, agent-companion, agent-pi), canonical transport helpers replacing hardcoded gateway patterns, and all legacy code paths removed. See `docs/exec-plans/completed/bd-3g1g/` for the full plan and closure artifacts.

## Related Repositories

- **boring-sandbox**: Optional edge proxy/orchestration layer (routing/provisioning/token injection) with no duplicated workspace business logic
- **boring-coding**: Shared workflow docs, agent conventions, tooling
