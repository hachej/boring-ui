# Runbooks

Operational runbooks for common tasks.

## Infrastructure

- [Neon Setup](./NEON_SETUP.md) — Neon Postgres + Neon Auth setup for boring-ui and child projects
- [PI Agent API Keys](./PI_AGENT_API_KEYS.md) — Managing PI agent provider keys
- [Smoke Test Suite](./SMOKE_TESTS.md) — focused and full-stack smokes for boring-ui and child apps
- [UI Baseline and Inventory](./UI_BASELINE_INVENTORY.md) — AST primitive inventory + deterministic visual baseline artifacts
- [Root Package Entrypoints](./ROOT_PACKAGE_ENTRYPOINTS.md) — import/export contract and build+resolution smoke proof
- [Shared Style Runtime Contract](./SHARED_STYLE_RUNTIME_CONTRACT.md) — Phase 1 runtime-facing style assumptions and intentionally undecided boundaries
- [Shadcn Baseline](./SHADCN_BASELINE.md) — pinned toolchain versions, checked-in bootstrap config, npm-only invocation contract
- [Upstream Shadcn Ownership](./UPSTREAM_SHADCN.md) — generated-vs-customized ownership tracker for shadcn artifacts
- [Phase 1 Buttons and Badges Migration](./PHASE1_BUTTON_BADGE_MIGRATION.md) — shared-primitive migration slice notes and wrapper exceptions
- [Phase 1 Overlay and Menu Migration](./PHASE1_OVERLAY_MENU_MIGRATION.md) — dialog/dropdown migration notes and intentional custom overlays
- [Phase 1 Form Primitive Migration](./PHASE1_FORM_PRIMITIVE_MIGRATION.md) — input/textarea/label/select migration notes and intentional native exceptions
- [Phase 1 Low-Risk Primitive Migration](./PHASE1_LOW_RISK_PRIMITIVE_MIGRATION.md) — tooltip/avatar/tabs/separator migration notes and intentional custom exceptions
- [Phase 1 Guardrails and CSS Retirement](./PHASE1_GUARDRAILS_CSS_RETIREMENT.md) — lint/backstop checks and phased retirement of replaced legacy primitive CSS

## Ownership Migration

- [Ownership Migration Cutover and Rollback](./OWNERSHIP_CUTOVER.md)
- [Modes and Profiles Contract](./MODES_AND_PROFILES.md)

## Quick Mode Choice

Canonical target for new backend-agent work:
- Single `boring-ui` TypeScript backend on a normal Linux host or Fly.io
- Canonical hosted/runtime profile:
  `[workspace] backend = "bwrap"`, `[agent] runtime = "pi"`, `[agent] placement = "browser"`
- Optional server-side agent profile:
  `[workspace] backend = "bwrap"`, `[agent] runtime = "ai-sdk"`, `[agent] placement = "server"`
- `edge` is a legacy compatibility deployment path, not the recommended default
- The Python backend is retained only for rollback/parity workflows, not as the primary path

Use `core` when you want the simplest standalone deployment:
- Frontend -> `boring-ui` backend directly
- Default UI profile today: `pi-lightningfs`

Use `edge` only when you need legacy edge proxy/provisioning/token-injection behavior:
- Frontend -> `boring-sandbox` -> `boring-ui`
- Default UI profile: `companion-httpfs`
- Workspace/user/membership/files/git ownership remains in `boring-ui`
- `boring-sandbox` stays edge-only; it is not part of the canonical backend-agent architecture

## Development

### Settings surfaces

- User settings: `/auth/settings`
- Workspace settings: `/w/<workspace_id>/settings`

Keep workspace-scoped configuration such as GitHub integration on the workspace settings page. User settings should only hold user-scoped preferences.

### GitHub in core mode

For `core` + `pi-lightningfs`, GitHub setup is a user-plus-workspace flow:

1. link the user's GitHub account
2. verify or install the GitHub App for that account
3. bind the workspace to one installation
4. select one repo from that installation's accessible repo list

New workspaces may inherit the user's saved default installation, but repo selection remains explicit per workspace. Only after repo selection should the workspace be considered fully linked. On an empty LightningFS workspace, the browser repo is then bootstrapped from that selected GitHub repo when the workspace opens.

### Start Local Dev Environment

```bash
# Terminal 1: TypeScript backend API
npm install
npm run server:dev

# Terminal 2: Frontend dev server (HMR)
npm run dev
# -> http://localhost:5173
```

To exercise the hosted filesystem path locally instead of the default browser-local
LightningFS profile:

```bash
WORKSPACE_BACKEND=bwrap npm run server:dev
```

### Start Optional Companion / PI Services

```bash
# Legacy debugging only. Not part of the canonical TS runtime path.
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

# TS backend tests
npm run server:test
npm run server:typecheck

# Legacy Python parity / rollback tests
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

### Launch Full Stack

```bash
# Backend API + runtime config bridge
npm run server:dev

# Frontend dev server
npm run dev
```

The frontend now boots from the TypeScript backend-served runtime payload at `/__bui/config`; there is no generated `app.config.js` step in the dev flow.

### Docker Compose Ownership (boring-ui)

`boring-ui` now owns a local Docker Compose harness for deployment-mode testing:
this validates production topology and routing contracts, while the frontend
container itself is still Vite-based for fast smoke verification.

Use mode-specific compose files as canonical entry points:
- `deploy/core/docker-compose.yml` for `core`
- `deploy/edge/docker-compose.yml` for `edge`

`deploy/shared/docker-compose.legacy.yml` is a legacy convenience wrapper and is not
the canonical contract for downstream apps.

```bash
# Core mode (frontend -> boring-ui backend directly)
docker compose -f deploy/core/docker-compose.yml up --build backend frontend

# Edge mode (frontend -> sandbox artifact service)
# 1) Build/refresh the macro artifact in boring-ui-owned path
mkdir -p artifacts
BUNDLE_OUTPUT="$PWD/artifacts/boring-macro-bundle.tar.gz" \
  bash deploy/edge/scripts/build_macro_bundle.sh /home/ubuntu/projects/boring-macro
# 2) Start sandbox + frontend from boring-ui compose
docker compose -f deploy/edge/docker-compose.yml up --build sandbox frontend
```

`backend` is started automatically via `depends_on` in `deploy/edge/docker-compose.yml`.

Environment-file shortcuts:

```bash
# Core mode
cp deploy/core/.env.example .env.core
docker compose --env-file .env.core -f deploy/core/docker-compose.yml up --build backend frontend

# Edge mode
cp deploy/edge/.env.example .env.edge
docker compose --env-file .env.edge -f deploy/edge/docker-compose.yml up --build sandbox frontend
```

### Modal Deployment

```bash
# Build frontend first
npm run build

# Core mode (boring-ui control-plane owner)
modal deploy deploy/core/modal_app.py

# Edge mode (control plane + sandbox data plane)
modal deploy deploy/edge/modal_app.py
```

**Neon (production default)**:

Set `boring-ui-core-secrets` Modal secret with:

```bash
modal secret create boring-ui-core-secrets \
  CONTROL_PLANE_PROVIDER=neon \
  DATABASE_URL="postgresql://neondb_owner:<pass>@ep-<id>-pooler.<region>.aws.neon.tech/neondb?sslmode=require" \
  NEON_AUTH_BASE_URL="https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth" \
  NEON_AUTH_JWKS_URL="https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth/.well-known/jwks.json" \
  BORING_UI_SESSION_SECRET="<cookie-signing-secret>" \
  BORING_SETTINGS_KEY="<settings-encryption-key>" \
  --force
```

See [Neon Setup](./NEON_SETUP.md) for full setup instructions.

Neon Auth note: `emailVerified: false` is expected by default (Better Auth does not send verification emails unless an email provider is configured). For child apps in boringdata, use the `boring-ui` email sender provider configured via `boringdatasetup`.

Initialize schema once per database:

```bash
bui neon setup
```

The supported bootstrap path provisions the Neon project, applies the current control-plane schema, enables Neon Auth, and stores the generated secrets.

`boring-ui` preserves Neon pooler hostnames for TLS SNI routing.
For non-pooler Postgres hosts, backend may apply IPv4 resolution for container compatibility.

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

### Neon QA (Production)

```bash
# Source Neon credentials from local config
export $(grep -v '^#' .boring/neon-config.env | xargs)
export CONTROL_PLANE_PROVIDER=neon
export BORING_UI_SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export BORING_SETTINGS_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"

# Start TS backend
npm run server:start

# Smoke check
curl -s http://localhost:8000/api/capabilities | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('auth',{}), indent=2))"
curl -i http://localhost:8000/auth/login
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
		docker compose -f $(BORING_UI_REPO)/deploy/core/docker-compose.yml up --build backend frontend

bundle-sandbox:
	mkdir -p $(BORING_UI_REPO)/artifacts
	BUNDLE_OUTPUT="$(BORING_UI_REPO)/artifacts/boring-macro-bundle.tar.gz" \
	  bash $(BORING_UI_REPO)/deploy/edge/scripts/build_macro_bundle.sh $(CURDIR)

	up-edge: bundle-sandbox
		docker compose -f $(BORING_UI_REPO)/deploy/edge/docker-compose.yml up --build sandbox frontend
```

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for chat sessions | (required for chat) |
| `CORS_ORIGINS` | Comma-separated allowed origins | Dev origins (`localhost`/`127.0.0.1` on common ports) |
| `COMPANION_URL` | Companion service URL | None (embedded mode) |
| `PI_URL` | PI service URL | None (embedded mode) |
| `PI_MODE` | PI rendering: `embedded` or `iframe` | `embedded` |
| `WORKSPACE_PLUGINS_ENABLED` | Enable workspace plugins | `false` |
| `WORKSPACE_PLUGIN_ALLOWLIST` | Comma-separated allowed plugins | (empty = all if enabled) |
| `CONTROL_PLANE_PROVIDER` | Auth provider: `neon` (production) or `local` (dev) | `local` (auto-detects from env) |
| `DATABASE_URL` | Postgres connection string (Neon pooler recommended) | None |
| `NEON_AUTH_BASE_URL` | Neon Auth / Better Auth base URL | None |
| `NEON_AUTH_JWKS_URL` | Neon Auth JWKS endpoint for EdDSA JWT verification | Derived from base URL |
| `BORING_UI_SESSION_SECRET` | HMAC secret for `/auth/session` cookie signing. **Must be stable across deploys** — see [Session Persistence](./NEON_SETUP.md#session-persistence-across-deploys) | auto-generated (ephemeral — invalidated on restart) |
| `BORING_SETTINGS_KEY` | Encryption key for stored settings | None |
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

### Users Logged Out After Redeploy
If `BORING_UI_SESSION_SECRET` is not set, boring-ui generates an ephemeral secret on each startup. All session cookies become invalid on redeploy. Fix: set a stable secret in your Modal/env config. See [Session Persistence](./NEON_SETUP.md#session-persistence-across-deploys).

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
