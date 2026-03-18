# Deployment

All deployment configs live in boring-ui. The sandbox data plane uses
`vendor/boring-sandbox/` (git submodule).

## Modes

| Mode | What runs | Use case |
|------|-----------|----------|
| **Core** | boring-ui backend + frontend | Standalone IDE, no sandbox |
| **Edge** | boring-ui control plane + boring-sandbox data plane + frontend | Full sandbox-backed deployment |

## Quick Reference

### Docker — Go backend image

```bash
docker build -f deploy/go/Dockerfile -t boring-ui-go .
docker run --rm -p 8000:8000 boring-ui-go
```

Service: `boring-ui-go` backend only (`/health` on :8000)

### Docker — Core mode

```bash
cp deploy/core/.env.example .env
docker compose -f deploy/core/docker-compose.yml up --build
```

Services: `backend` (FastAPI :8000), `frontend` (Vite :5173)

### Docker — Edge mode

```bash
cp deploy/edge/.env.example .env
# Ensure macro bundle exists at artifacts/boring-macro-bundle.tar.gz
docker compose -f deploy/edge/docker-compose.yml up --build
```

Services: `backend` (:18001), `sandbox` (:8081), `frontend` (:5174)

### Modal — Core mode

```bash
modal deploy deploy/core/modal_app.py
```

Single Modal app `boring-ui-core`. Requires `boring-ui-core-secrets` Modal secret.

### Modal — Go backend

```bash
modal deploy deploy/go/modal_app.py
```

Single Modal app `boring-ui-go`. Reuses `boring-ui-core-secrets` by default.

### Modal — Edge mode (full)

```bash
bash deploy/edge/deploy.sh
```

Deploys two Modal apps:
- `boring-ui-edge` — control plane (boring-ui)
- `boring-sandbox` — data plane (boring-sandbox gateway)

Use `--skip-sandbox` to deploy only the control plane.

### Sprite — Direct deploy

```bash
bash deploy/edge/sprite/deploy.sh <sprite-name>
```

Builds frontend + backend wheel, uploads to a Sprite instance, creates a service.

## File Layout

```
deploy/
├── core/
│   ├── modal_app.py                  # Core mode Modal app
│   ├── docker-compose.yml            # Core mode (backend + frontend)
│   └── .env.example                  # Core env template
├── go/
│   ├── Dockerfile                    # Go backend image (<30 MB target)
│   └── modal_app.py                  # Go backend Modal app
├── edge/
│   ├── modal_app.py                  # Edge control plane Modal app
│   ├── modal_app_sandbox.py          # Sandbox data plane Modal app
│   ├── deploy.sh                     # Deploy both edge apps
│   ├── docker-compose.yml            # Edge mode (backend + sandbox + frontend)
│   ├── .env.example                  # Edge env template
│   ├── Dockerfile.sandbox            # Sandbox container (boring-macro runtime)
│   ├── entrypoint.sh                 # Sandbox container entrypoint
│   ├── scripts/
│   │   └── build_macro_bundle.sh     # Build macro bundle (wheel + static + bootstrap)
│   └── sprite/
│       ├── README.md                 # Sprite deployment runbook
│       └── deploy.sh                 # Direct Sprite deploy script
├── shared/
│   ├── Dockerfile.backend            # boring-ui FastAPI backend
│   ├── Dockerfile.frontend           # Vite dev frontend
│   ├── nginx.sandbox-proxy.conf      # Nginx proxy for legacy edge profile
│   └── docker-compose.legacy.yml     # Legacy all-in-one (core + edge profiles)
└── README.md
```

## Submodule Setup

Edge mode requires the boring-sandbox submodule:

```bash
git submodule update --init vendor/boring-sandbox
```

The deploy scripts auto-init it if missing.

## Building the Macro Bundle

Required for Docker edge mode (`Dockerfile.sandbox` expects `artifacts/boring-macro-bundle.tar.gz`):

```bash
# Set boring-macro repo path (or it auto-discovers ../boring-macro)
export BORING_MACRO_ROOT=/path/to/boring-macro

# Optional: point to pre-built static assets
export BM_STATIC_PATH=/path/to/boring-macro/src/web/dist

# Build
bash deploy/edge/scripts/build_macro_bundle.sh

# Copy to expected location
cp /tmp/boring-macro-bundle.tar.gz artifacts/
```

The bundle includes: wheel, web_static assets, bootstrap.sh.

## Custom Backend Entry Points

Child apps can define a custom FastAPI app via `[backend].entry` in `boring.app.toml`:

```toml
[backend]
entry = "backend.app:app"
```

When set, `deploy/core/modal_app.py` imports this module instead of `boring_ui.runtime`.
The framework **automatically mounts the built frontend** (SPA fallback + static assets)
on the custom app if `BORING_UI_STATIC_DIR` is set and the app doesn't already define a
`/{full_path:path}` catch-all route.

If your custom app needs to control static serving itself, add your own SPA fallback route
and the framework will skip auto-mounting:

```python
from boring_ui.runtime import mount_static
mount_static(app, Path(os.environ["BORING_UI_STATIC_DIR"]))
```

## Secrets

### Docker

Set in `.env` file (see `.env.example` templates in `deploy/core/` and `deploy/edge/`).

### Modal

Create named secrets in Modal dashboard:

| Secret name | Used by | Required keys |
|---|---|---|
| `boring-ui-core-secrets` | Core + Edge control plane | `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `BORING_SETTINGS_KEY`, `BORING_UI_SESSION_SECRET` |
| `boring-ui-sandbox-secrets` | Edge control plane | `BORING_SANDBOX_API_KEY`, `BORING_SANDBOX_BASE_URL` |
| `boring-sandbox-secrets` | Sandbox gateway | `BORING_SESSION_SECRET` (must match `BORING_UI_SESSION_SECRET`) |
| `boring-sandbox-macro-secrets` | Sandbox gateway | Macro runtime config |
| `boring-sandbox-sprite-secrets` | Sandbox gateway | Sprite provisioning |
| `boring-sandbox-mail-secrets` | Sandbox gateway | Mail/notification config |
| `boring-sandbox-macro-runtime-secrets` | Sandbox gateway | Runtime env for macros |

Key interop requirement: `BORING_SESSION_SECRET` (sandbox) must equal `BORING_UI_SESSION_SECRET` (control plane) for session cookie validation across the edge boundary.
