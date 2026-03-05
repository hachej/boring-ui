# Runbooks

Operational runbooks for common tasks.

## Ownership Migration

- [Ownership Migration Cutover and Rollback](./OWNERSHIP_CUTOVER.md)
- [Modes and Profiles Contract](./MODES_AND_PROFILES.md)

## Development

### Start Local Dev Environment

```bash
# Terminal 1: Frontend dev server (HMR)
npm install
npm run dev
# -> http://localhost:5173

# Terminal 2: Backend API
uv sync
uv run python -m uvicorn boring_ui.runtime:app --host 0.0.0.0 --port 8000 --reload
```

### Start Optional Companion / PI Services

```bash
# Separate terminal(s)
npm run companion:service
npm run pi:service
```

### Run Tests

```bash
# Frontend unit tests
npm run test:run

# Frontend unit tests (watch mode)
npm test

# Frontend E2E tests
npm run test:e2e

# Backend tests
python3 -m pytest tests/ -v

# Lint
npm run lint

# Smoke gate
scripts/gates/smoke.sh
```

### Build for Production

```bash
# App build
npm run build

# Library build (for use as npm package)
npm run build:lib

# Preview production build
npm run preview
```

### Launch Full Stack by Deployment Mode

```bash
# Core mode (single backend; default)
python3 scripts/run_full_app.py --config app.full.toml --deploy-mode core

# Edge mode (frontend points at edge proxy)
python3 scripts/run_full_app.py \
  --config app.full.toml \
  --deploy-mode edge \
  --edge-proxy-url http://127.0.0.1:8080

# Shell wrapper (supports positional config + same flags)
bash scripts/run_full_app.sh app.full.toml --deploy-mode core
```

### Docker Compose Ownership (boring-ui)

`boring-ui` now owns a local Docker Compose harness for deployment-mode testing:
this validates production topology and routing contracts, while the frontend
container itself is still Vite-based for fast smoke verification.

Use mode-specific compose files as canonical entry points:
- `deploy/docker/docker-compose.front.yml` for `core`
- `deploy/docker/docker-compose.sandbox.yml` for `edge`

`deploy/docker/docker-compose.yml` is a legacy convenience wrapper and is not
the canonical contract for downstream apps.

```bash
# Core mode (frontend -> boring-ui backend directly)
docker compose -f deploy/docker/docker-compose.front.yml up --build backend frontend

# Edge mode (frontend -> sandbox artifact service)
# 1) Build/refresh the macro artifact in boring-ui-owned path
mkdir -p artifacts
BUNDLE_OUTPUT="$PWD/artifacts/boring-macro-bundle.tar.gz" \
  bash deploy/sandbox/scripts/build_macro_bundle.sh /home/ubuntu/projects/boring-macro
# 2) Start sandbox + frontend from boring-ui compose
docker compose -f deploy/docker/docker-compose.sandbox.yml up --build sandbox frontend
```

`backend` is started automatically via `depends_on` in `docker-compose.sandbox.yml`.

Environment-file shortcuts:

```bash
# Core mode
cp deploy/docker/.env.core.example .env.core
docker compose --env-file .env.core -f deploy/docker/docker-compose.front.yml up --build backend frontend

# Edge mode
cp deploy/docker/.env.edge.example .env.edge
docker compose --env-file .env.edge -f deploy/docker/docker-compose.sandbox.yml up --build sandbox frontend
```

### Modal Deployment

```bash
# Core mode (boring-ui control-plane owner)
modal deploy deploy/modal/modal_app_front.py::core

# Edge mode (reuse existing boring-sandbox Modal app)
bash deploy/modal/deploy_sandbox_mode.sh gateway
# optional light entrypoint:
# bash deploy/modal/deploy_sandbox_mode.sh gateway_ui_light
```

Supabase-backed control-plane (same model as legacy sandbox) is enabled in compose by default.
Set the following env vars before boot:

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export SUPABASE_JWT_SECRET="<jwt-secret>"
export SUPABASE_DB_URL="postgresql://postgres.<project-ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
export BORING_SETTINGS_KEY="<settings-encryption-key>"
export BORING_UI_SESSION_SECRET="<cookie-signing-secret>"
```

Initialize schema once per database:

```bash
psql "$SUPABASE_DB_URL" -f deploy/sql/control_plane_supabase_schema.sql
```

`boring-ui` backend resolves the Supabase pooler host to IPv4 for container-runtime compatibility.

Endpoints:
- Core mode frontend: `http://localhost:5173`
- Edge mode frontend: `http://localhost:5174`
- Core mode backend API: `http://localhost:8000`
- Edge mode API/gateway: `http://localhost:8081`

`boring-sandbox` remains optional for edge provisioning/proxy/token-injection concerns only.

Smoke-check canonical control-plane ownership after boot:

```bash
curl -i http://127.0.0.1:8000/auth/session
curl -i http://127.0.0.1:8000/api/v1/me
curl -i http://127.0.0.1:8000/api/v1/workspaces
```

### Mode Compatibility Matrix

| Mode | Frontend API base (`VITE_API_URL`) | Request path owner | Expected behavior |
| --- | --- | --- | --- |
| Core (frontend-only workspace wiring) | `boring-ui` backend URL | `boring-ui` directly | Canonical `/auth/*`, `/api/v1/me*`, `/api/v1/workspaces*`, `/api/v1/files*`, `/api/v1/git*` routes served by core. |
| Edge (front+back with edge proxy) | `boring-sandbox` proxy URL | `boring-sandbox` pass-through -> `boring-ui` | Same canonical routes; sandbox only proxies/routing/provisioning/token injection (no workspace/user business logic). |

Verification commands:

```bash
# Unit compatibility checks (deploy mode env contract + control-plane route helpers)
PATH="/usr/bin:/bin:$PATH" npm run test:run -- -t "transport|controlPlane|workspaceNavigation"
pytest tests/ -v -k "run_full_app or deployment or control_plane or workspace"

# E2E canonical transport + user menu control-plane flows
npm run test:e2e -- --grep "Canonical Transport Regression|User Menu Control-Plane Flows"
```

## Downstream Packaging Helper

For apps embedding boring-ui (for example `boring-macro`), use:

```bash
python3 scripts/package_app_assets.py \
  --frontend-dir /path/to/app/frontend \
  --static-dir /path/to/app/runtime_static \
  --companion-source /path/to/boring-ui/src/companion_service/launch.sh \
  --companion-target /path/to/app/runtime_companion/launch.sh
```

`boring-macro` can call boring-ui-owned deploy scripts directly (recommended):

```make
BORING_UI_REPO ?= ../boring-ui

	up-core:
		docker compose -f $(BORING_UI_REPO)/deploy/docker/docker-compose.front.yml up --build backend frontend

bundle-sandbox:
	mkdir -p $(BORING_UI_REPO)/artifacts
	BUNDLE_OUTPUT="$(BORING_UI_REPO)/artifacts/boring-macro-bundle.tar.gz" \
	  bash $(BORING_UI_REPO)/deploy/sandbox/scripts/build_macro_bundle.sh $(CURDIR)

	up-edge: bundle-sandbox
		docker compose -f $(BORING_UI_REPO)/deploy/docker/docker-compose.sandbox.yml up --build sandbox frontend
```

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for chat sessions | (required for chat) |
| `CORS_ORIGINS` | Comma-separated allowed origins | Dev origins + `*` |
| `COMPANION_URL` | Companion service URL | None (embedded mode) |
| `PI_URL` | PI service URL | None (embedded mode) |
| `PI_MODE` | PI rendering: `embedded` or `iframe` | `embedded` |
| `WORKSPACE_PLUGINS_ENABLED` | Enable workspace plugins | `false` |
| `WORKSPACE_PLUGIN_ALLOWLIST` | Comma-separated allowed plugins | (empty = all if enabled) |
| `BORING_UI_SESSION_SECRET` | HMAC secret for `/auth/session` cookie signing | auto-generated (ephemeral) |
| `AUTH_SESSION_COOKIE_NAME` | Session cookie name for `/auth/*` routes | `boring_session` |
| `AUTH_SESSION_TTL_SECONDS` | Session cookie TTL in seconds | `86400` |
| `AUTH_SESSION_SECURE_COOKIE` | Set session cookie `Secure` flag | `false` |
| `AUTH_DEV_LOGIN_ENABLED` | Enable query-param local login/callback adapter | `false` |
| `LOCAL_PARITY_MODE` | `http` to exercise hosted code path locally | (unset) |
| `VITE_DEPLOY_MODE` | Frontend deploy mode contract: `core` or `edge` | mode-specific |
| `VITE_UI_PROFILE` | UI runtime profile (`pi-lightningfs`, `pi-cheerpx`, `pi-httpfs`, `companion-httpfs`) | mode-specific |
| `VITE_AGENT_RAIL_MODE` | Explicit rail override (`pi`, `companion`, `native`, `all`) | derived from profile |
| `VITE_DATA_BACKEND` | Explicit data backend override (`lightningfs`, `cheerpx`, `http`) | derived from profile |
| `VITE_PROXY_API_TARGET` | Docker/dev proxy target for backend APIs in Vite | unset |
| `VITE_COMPANION_PROXY_TARGET` | Docker/dev proxy target for companion API/WS in Vite | unset |
| `BORING_UI_WORKSPACE_ROOT` | Workspace root for `@workspace` plugin alias resolution | unset |
| `WORKSPACE_ROOT` | Fallback workspace root alias for local plugin loading | unset |

### Hosted Mode (Parity Testing)

To test hosted-mode code paths locally:

```bash
export LOCAL_PARITY_MODE=http
# Frontend will rewrite /api/* to /api/v1/* as in hosted mode
```

### Local Auth Session Flow

For local control-plane testing, `boring-ui` provides core-owned auth/session routes:

```bash
# Enable local dev login adapter and set a deterministic local secret
export AUTH_DEV_LOGIN_ENABLED=true
export BORING_UI_SESSION_SECRET="dev-only-local-secret"

# Login shortcut (creates session cookie and redirects)
curl -i "http://localhost:8000/auth/login?user_id=u1&email=user@example.com&redirect_uri=/"

# Inspect current authenticated session
curl -i --cookie "boring_session=<cookie-value>" http://localhost:8000/auth/session

# Logout and clear cookie
curl -i --cookie "boring_session=<cookie-value>" http://localhost:8000/auth/logout
```

Expected unauthenticated behavior:
- `GET /auth/session` returns `401` with code `SESSION_REQUIRED` when no cookie is present.
- Invalid or expired cookies return `401` with code `SESSION_INVALID` or `SESSION_EXPIRED`.

### Workspace Lifecycle/Settings Control Plane

`boring-ui` core also owns canonical workspace lifecycle/settings routes:

- `GET /api/v1/workspaces`
- `POST /api/v1/workspaces`
- `GET /api/v1/workspaces/{workspace_id}/runtime`
- `POST /api/v1/workspaces/{workspace_id}/runtime/retry`
- `GET /api/v1/workspaces/{workspace_id}/settings`
- `PUT /api/v1/workspaces/{workspace_id}/settings`

User identity/settings routes are also core-owned:

- `GET /api/v1/me`
- `GET /api/v1/me/settings`
- `PUT /api/v1/me/settings`

Collaboration routes are core-owned:

- `GET /api/v1/workspaces/{workspace_id}/members`
- `PUT /api/v1/workspaces/{workspace_id}/members/{user_id}`
- `GET /api/v1/workspaces/{workspace_id}/invites`
- `POST /api/v1/workspaces/{workspace_id}/invites`
- `POST /api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept`

Workspace boundary routes are core-owned:

- `GET /w/{workspace_id}/setup`
- `GET /w/{workspace_id}/runtime`
- `POST /w/{workspace_id}/runtime/retry`
- `GET/PUT /w/{workspace_id}/settings`
- `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS /w/{workspace_id}/{path}` (allowed internal families only, reserved subpaths take precedence)

### Macro Domain Boundary

`boring-macro` is an extension-only surface and must not re-own workspace/user/collaboration logic.

- Allowed macro extension family: `/api/v1/macro/*`
- Core-owned workspace/control-plane families remain in `boring-ui`:
  - `/auth/*`
  - `/api/v1/me*`
  - `/api/v1/workspaces*`
  - `/api/v1/files/*`
  - `/api/v1/git/*`

Boundary validation commands:

```bash
pytest tests/ -v -k "macro and boundary"
python3 scripts/check_forbidden_direct_routes.py
```

### Sandbox Edge Pass-Through Contract (Optional)

If `boring-sandbox` is used in front of `boring-ui`, keep it edge-only:

1. Proxy canonical routes without re-owning business logic:
   - `/auth/*`
   - `/api/v1/me*`
   - `/api/v1/workspaces*`
   - `/api/v1/files/*`
   - `/api/v1/git/*`
   - `/w/{workspace_id}/*`
2. Preserve session/auth context (`Cookie`, `Authorization`) and request tracing headers.
3. Do not rewrite control-plane response envelopes, status codes, or ownership semantics.
4. Keep provisioning/routing/token-injection concerns in sandbox; keep workspace/user/collaboration logic in `boring-ui`.

Quick validation:

```bash
pytest tests/ -v -k "edge or sandbox or passthrough"
```

## Troubleshooting

### Layout Corrupted / Blank Screen
Clear localStorage for the app's storage prefix:
```javascript
// In browser console
Object.keys(localStorage).filter(k => k.startsWith('boring-ui')).forEach(k => localStorage.removeItem(k))
location.reload()
```

### Capabilities Endpoint Returns Unexpected Features
Check which routers are enabled in `create_app()`. The `/api/capabilities` response reflects exactly what was mounted. Verify with:
```bash
curl http://localhost:8000/api/capabilities | python3 -m json.tool
```

### PTY WebSocket Won't Connect
1. Verify `pty` is in enabled routers
2. Check PTY providers in config: `curl http://localhost:8000/api/config`
3. Ensure the provider name in the WS query matches a configured provider

### Chat Sessions Not Working
1. Check capabilities: `curl http://localhost:8000/api/capabilities`
2. If using companion, verify `COMPANION_URL` (or companion service availability)
3. If using Claude stream, verify `ANTHROPIC_API_KEY` and `chat_claude_code` capability
