# Modes and Profiles

This document is the canonical deployment/runtime contract for `boring-ui`.

## Deployment Modes

Two deployment modes exist:

1. `core`
2. `edge`

## Architecture Diagram

```mermaid
flowchart LR
    subgraph CoreMode["Core Mode"]
      CFE["Frontend"]
      CBE["boring-ui backend"]
      CFE -->|/auth, /api/v1/me, /api/v1/workspaces, /api/v1/files, /api/v1/git| CBE
      CFE -->|PI rail + LightningFS/CheerpX/HTTP profiles| CFE
    end

    subgraph EdgeMode["Edge Mode"]
      EFE["Frontend"]
      ESG["boring-sandbox gateway / companion surface"]
      EBE["boring-ui backend"]
      EFE -->|canonical routes| ESG
      ESG -->|core-owned families pass-through| EBE
      ESG -->|companion families| ESG
    end
```

### `core` mode

- Request path: `frontend -> boring-ui`
- Ownership: `boring-ui` directly owns auth/session, workspace/user/collaboration, and files/git APIs.
- Typical use: frontend-only workspace deployments.

### `edge` mode

- Request path: `frontend -> boring-sandbox -> boring-ui`
- Ownership: `boring-sandbox` is edge-only (proxy/routing/provisioning/token injection).
- Workspace/user/collaboration business logic remains in `boring-ui`.

### Edge Mode Request Flow (Detailed)

In edge mode, routing is split by API family:

| Route family | Owner | Typical handler |
| --- | --- | --- |
| `/auth/*` | `boring-ui` | core backend auth/session |
| `/api/v1/me*` | `boring-ui` | core backend user identity/settings |
| `/api/v1/workspaces*` | `boring-ui` | core backend workspace/membership/invites/settings |
| `/api/v1/files/*` | `boring-ui` | core backend file service |
| `/api/v1/git/*` | `boring-ui` | core backend git service |
| `/ws/agent/companion/*`, `/api/v1/agent/companion/*` | companion runtime surface | sandbox/gateway companion service boundary |

Practical meaning:

1. Files/git/workspace APIs are still core-owned.
2. Sandbox/gateway does transport/provisioning/token-injection; it does not duplicate workspace logic.
3. Frontend talks to canonical paths; edge routing decides where each family lands.

## UI Runtime Profiles

Profiles define the chat rail + filesystem backend pairing.

| Profile | Agent rail | Data backend | Typical usage |
| --- | --- | --- | --- |
| `pi-lightningfs` | `pi` | `lightningfs` | Default core mode profile |
| `pi-cheerpx` | `pi` | `cheerpx` | Browser VM/sandbox runtime |
| `pi-httpfs` | `pi` | `http` | Dev/debug against backend workspace |
| `companion-httpfs` | `companion` | `http` | Default edge mode profile |

## Recommended Defaults

| Deploy mode | Default profile |
| --- | --- |
| `core` | `pi-lightningfs` |
| `edge` | `companion-httpfs` |

## Environment Variables

Primary mode/profile variables:

- `VITE_DEPLOY_MODE=core|edge`
- `VITE_UI_PROFILE=pi-lightningfs|pi-cheerpx|pi-httpfs|companion-httpfs`

Optional explicit overrides (usually not needed if profile is set):

- `VITE_AGENT_RAIL_MODE=pi|companion|native|all`
- `VITE_DATA_BACKEND=lightningfs|cheerpx|http`

Profile-specific tuning:

- `VITE_LIGHTNINGFS_NAME` (for `lightningfs`)
- `VITE_CHEERPX_WORKSPACE_ROOT`
- `VITE_CHEERPX_PRIMARY_DISK_URL`
- `VITE_CHEERPX_OVERLAY_NAME`
- `VITE_CHEERPX_ESM_URL`

## Copy/Paste Profile Presets

Core + PI + LightningFS:

```bash
VITE_DEPLOY_MODE=core
VITE_UI_PROFILE=pi-lightningfs
```

Core + PI + CheerpX:

```bash
VITE_DEPLOY_MODE=core
VITE_UI_PROFILE=pi-cheerpx
VITE_CHEERPX_WORKSPACE_ROOT=/workspace
```

Core + PI + HTTP FS (dev/debug):

```bash
VITE_DEPLOY_MODE=core
VITE_UI_PROFILE=pi-httpfs
```

Edge + Companion + HTTP FS:

```bash
VITE_DEPLOY_MODE=edge
VITE_UI_PROFILE=companion-httpfs
```

## Compose Entry Points

Core mode:

```bash
docker compose -f deploy/docker/docker-compose.front.yml up --build backend frontend

# with template env file
cp deploy/docker/.env.core.example .env.core
docker compose --env-file .env.core -f deploy/docker/docker-compose.front.yml up --build backend frontend
```

Edge mode:

```bash
docker compose -f deploy/docker/docker-compose.sandbox.yml up --build sandbox frontend

# with template env file
cp deploy/docker/.env.edge.example .env.edge
docker compose --env-file .env.edge -f deploy/docker/docker-compose.sandbox.yml up --build sandbox frontend
```

`backend` is started automatically via `depends_on` in `docker-compose.sandbox.yml`.

Notes:

1. `deploy/docker/docker-compose.front.yml` and `deploy/docker/docker-compose.sandbox.yml` are the canonical files.
2. `deploy/docker/docker-compose.yml` is a legacy convenience wrapper and not the recommended downstream contract.

In the local edge compose harness:

1. `frontend` proxies core API families to `backend`.
2. `frontend` proxies companion API/WS families to `sandbox`.
3. This mirrors production ownership while keeping local startup simple.

## `run_full_app.py` Entry Point

Core mode:

```bash
python3 scripts/run_full_app.py --deploy-mode core --ui-profile pi-lightningfs
```

Edge mode:

```bash
python3 scripts/run_full_app.py \
  --deploy-mode edge \
  --edge-proxy-url http://127.0.0.1:8080 \
  --ui-profile companion-httpfs
```

In edge mode, `run_full_app.py` expects an edge proxy to already be running at `--edge-proxy-url`; it does not start `boring-sandbox` itself.

## Vertical App Reuse Pattern

For downstream apps (for example `boring-macro`), treat this as the contract:

1. Pick deploy mode (`core` or `edge`).
2. Pick exactly one UI profile.
3. Keep workspace contract on `boring-ui` (`/auth/*`, `/api/v1/me*`, `/api/v1/workspaces*`, `/api/v1/files*`, `/api/v1/git*`).
4. Add domain APIs under your own namespace (for example `/api/v1/macro/*`).
