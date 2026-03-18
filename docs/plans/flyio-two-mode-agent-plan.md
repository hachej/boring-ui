# Plan: Fly.io Deployment + Backend-Agent Mode

## Status

**Draft v3** — incorporates Codex review + scope simplification.

**Date**: 2026-03-18
**Supersedes**: Parts of `backend-architecture-plan.md` (sandbox backend selection, BoxLite, nsjail-as-primary)
**Builds on**: Existing `agents_mode` config (`frontend` / `backend`), bwrap PoC (archived on `sandbox-poc-archive` branch), Fly.io research
**Focus**: 1 solid app with agent running safely in the backend. Leverage FaaS. Keep it simple. Self-host option later.

---

## Executive Summary

Ship the current core mode on Fly.io, then add backend-agent mode where each workspace is an isolated Fly Machine.

**MVP simplification**: The agent harness runs directly on the workspace Machine. No bwrap, no sandbox layer. The Firecracker VM boundary IS the isolation — each workspace is a separate VM with its own kernel. Sandbox hardening (bwrap) is a post-MVP phase.

### Phases

| Phase | What | App changes? |
|---|---|---|
| 0 | Deploy core mode to Fly.io + clean up legacy deploy | No |
| 1 | Provisioner + router interfaces + Fly implementation | Backend only |
| 2 | Workspace Machine backend-agent process model | Backend only |
| 3 | Frontend integration | Frontend only |
| 4 | boring.app.toml + bui CLI | CLI only |
| Post-MVP | bwrap sandbox hardening (defense-in-depth) | Backend only |

### Non-goals (MVP)

- Sandbox isolation within the VM (bwrap) — VM boundary is sufficient for v1
- Credential brokering / short-lived leases
- Snapshots / templates / branch workspaces
- Audit / event journal
- Quotas, warm pools, canary rollout
- Rewriting the current frontend-agent path
- Baking Fly-specific assumptions into pane or router contracts

### Design principles

- Preserve `frontend` mode exactly. Don't change what works.
- Keep hosted provider logic behind interfaces (`WorkspaceProvisioner`, `WorkspaceRouter`) so Fly is the first implementation, not the only one.
- Ship phases incrementally — each phase is independently deployable.
- Self-hosting option stays open (interfaces, not Fly lock-in).

---

## Part 1: What Exists Today

### Agent Modes (boring.app.toml)

```toml
[agents]
mode = "frontend"  # or "backend"
default = "pi"
```

- `frontend`: PI agent runs in browser. `data.backend = "lightningfs"`. Files in IndexedDB, git via isomorphic-git, Python via Pyodide. Backend serves auth, PTY, control plane only. No sandbox execution server-side.
- `backend`: PI agent runs server-side via `PiHarness` (Node.js sidecar). `data.backend = "http"`. `pi_service/tools.mjs` calls `/w/{id}/api/v1/sandbox/exec` for tool execution.

### Sandbox code status

All sandbox implementations (bwrap, nsjail, BoxLite) were developed as PoCs and archived to branch `sandbox-poc-archive`. **No sandbox code exists on main.** Post-MVP, bwrap files will be cherry-picked from that branch for defense-in-depth hardening.

### Deploy artifacts to clean up (tracked on main)

| Artifact | Action |
|---|---|
| `deploy/edge/modal_app.py` | **Remove** (Modal replaced by Fly) |
| `deploy/edge/modal_app_sandbox.py` | **Remove** |
| `deploy/edge/Dockerfile.sandbox` | **Remove** |
| `deploy/edge/entrypoint.sh` | **Remove** |
| `deploy/edge/deploy.sh` | **Remove** |
| `deploy/edge/docker-compose.yml` | **Remove** |
| `deploy/edge/.env.example` | **Remove** |
| `deploy/edge/scripts/` | **Remove** |
| `deploy/edge/sprite/` | **Remove** |
| `deploy/core/docker-compose.yml` | **Remove** (replaced by fly.toml) |
| `deploy/core/.env.example` | **Remove** |
| `deploy/core/modal_app.py` | **Remove** |
| `deploy/core/modal_go_proxy.py` | **Remove** |
| `deploy/go/` | **Remove** (Go backend removed) |
| `deploy/shared/docker-compose.legacy.yml` | **Remove** |
| `deploy/shared/Dockerfile.frontend` | **Evaluate** — may fold into single Dockerfile |
| `deploy/shared/Dockerfile.backend` | **Keep** — base image for Fly.io |

---

## Part 2: Killing Edge Mode

The current "edge" mode is an overly complex hosted architecture that this plan replaces entirely. It will be fully removed in Phase 0.

### What edge mode is today

```
┌─ modal_app.py (boring-ui-edge) ──────────────────────────┐
│  Control plane on Modal                                   │
│  FastAPI + Neon DB + JWKS verification                    │
│  Serves auth, workspace CRUD                              │
└───────────────────────────────────────────────────────────┘
         │
┌─ modal_app_sandbox.py (boring-sandbox) ──────────────────┐
│  Separate Modal app                                       │
│  Gateway proxy (httpx, per-request app_config)            │
│  Provisioning poller (background task, 5s poll)           │
│  5-step provisioning pipeline:                            │
│    bundle → create sandbox → upload files →               │
│    bootstrap env → health check                           │
│  _AppPrefixStripMiddleware                                │
│  vendor/boring-sandbox git clone at build time            │
│  Cookie auth guard (cross-service session interop)        │
│  IPv6 workarounds (Supabase era, now dead code)           │
└───────────────────────────────────────────────────────────┘
         │
┌─ Sprite runtimes ────────────────────────────────────────┐
│  Each needs full boring-sandbox installed                  │
│  30-60s provisioning latency                              │
│  Modal container cycling issues                           │
│  socat relay for DB access                                │
└───────────────────────────────────────────────────────────┘
```

### What replaces it

```
Control Plane Machine         →  fly-replay header (zero proxy code)
Provisioning poller           →  2 Fly API calls (synchronous)
5-step bundle/upload pipeline →  Volume mount (persistent, instant)
boring-sandbox vendor clone   →  Same image everywhere
Gateway proxy                 →  Fly proxy (built-in)
Cookie auth guard             →  boring_session cookie (already works)
Sprite runtimes               →  Workspace Machines (auto-stop/suspend)
```

### Files removed (all tracked on main)

Everything under `deploy/edge/`:
- `modal_app.py`, `modal_app_sandbox.py` — Modal ASGI apps
- `Dockerfile.sandbox` — sandbox container image
- `docker-compose.yml`, `.env.example` — Docker Compose config
- `entrypoint.sh`, `deploy.sh` — shell scripts
- `scripts/build_macro_bundle.sh` — bundle pipeline
- `sprite/` — sprite deployment scripts

Also removed:
- `deploy/core/modal_app.py`, `deploy/core/modal_go_proxy.py` — Modal core mode
- `deploy/go/` — Go backend deployment (already dead)
- `deploy/shared/docker-compose.legacy.yml` — legacy compose

**vendor/boring-sandbox** (if submodule reference remains): remove reference.

---

## Part 3: Target Architecture

### frontend-agent Mode (current core — NO APP CHANGES)

This mode ships today and works. The plan does NOT touch any app code for this mode. Only deploy infrastructure moves to Fly.io.

```
┌─── Single Fly Machine ──────────────────────────────────┐
│                                                          │
│  boring-ui backend (Python) — UNCHANGED                  │
│    boring.app.toml: agents.mode = "frontend"             │
│    data.backend = "lightningfs"                          │
│    Serves: static frontend, PTY websocket, auth,         │
│            control plane API                             │
│                                                          │
│  Browser (PI agent + all data) — UNCHANGED               │
│    Files: LightningFS (IndexedDB)                        │
│    Git:   isomorphic-git (in-browser)                    │
│    Python: Pyodide (WASM)                                │
│    LLM:   direct API calls (key in browser)              │
│    Shell: interactive PTY only (/ws/pty)                  │
│    No server-side sandbox execution                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### backend-agent Mode (new — MVP)

```
┌──────── Control Plane Machine (always-on) ──────────────┐
│                                                          │
│  Image: boring-ui:latest                                 │
│  Env: DATABASE_URL, NEON_AUTH_*, BORING_SESSION_SECRET,  │
│       FLY_API_TOKEN, FLY_WORKSPACE_APP                   │
│                                                          │
│  Routers: control_plane only                             │
│  Role:                                                   │
│    /auth/*              → Neon Auth token exchange        │
│    /api/v1/workspaces   → CRUD via WorkspaceProvisioner  │
│    /w/{id}/**           → route via WorkspaceRouter      │
│                                                          │
└──────────────────────────────────────────────────────────┘
         │ WorkspaceRouter (Fly impl: fly-replay)
         ▼
┌──────── Workspace Machine (auto-stop per workspace) ────┐
│                                                          │
│  Firecracker VM = the isolation boundary                 │
│  Volume: /workspace (10-50GB)                            │
│  Image: boring-ui:latest (same image)                    │
│  Env: BORING_SESSION_SECRET, ANTHROPIC_API_KEY           │
│  Guest: shared-cpu-1x, 512MB                             │
│  Services: autostop=suspend, autostart=true              │
│                                                          │
│  Routers: files, git, pty, ui_state, chat_claude_code    │
│  agents_mode: backend                                    │
│                                                          │
│  PID 1: boring-ui backend                                │
│    - validates boring_session cookie (stateless HS256)   │
│    - spawns PiHarness (Node.js sidecar)                  │
│    - PiHarness makes LLM calls directly                  │
│    - pi_service/tools.mjs executes commands directly     │
│      on the workspace filesystem (no sandbox layer)      │
│                                                          │
│  No bwrap. No sandbox. The VM is the sandbox.            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Why no sandbox in MVP

| Concern | Why VM-level isolation is sufficient |
|---|---|
| Cross-workspace access | Impossible — different VM, different kernel |
| Agent destroys files | It's the user's own workspace. Volume snapshots exist. |
| Agent installs packages | Contained — dies when Machine stops |
| Fork bomb / resource abuse | Fly Machine resource limits |
| Agent reads secrets | Agent IS the backend — it needs ANTHROPIC_API_KEY to call LLMs. No untrusted tenants in v1. |
| Network exfiltration | Acceptable for v1 — single-tenant. Post-MVP: bwrap `--unshare-net`. |

### Interfaces (prevents Fly lock-in)

```python
# src/back/boring_ui/api/workspace/provisioner.py
class WorkspaceProvisioner(Protocol):
    async def create(self, workspace_id: str, region: str, size_gb: int) -> ProvisionResult: ...
    async def delete(self, machine_id: str, volume_id: str) -> None: ...
    async def status(self, machine_id: str) -> str: ...

# src/back/boring_ui/api/workspace/router.py
class WorkspaceRouter(Protocol):
    async def route(self, workspace_id: str, request: Request) -> Response: ...
```

Fly implementations: `FlyProvisioner`, `FlyReplayRouter`. Future: `HetznerProvisioner`, `HttpProxyRouter`.

---

## Part 4: Auth Flow (backend-agent)

Existing auth works as-is. No changes needed.

```
Browser → POST /auth/token-exchange → Control Plane
  ← Set-Cookie: boring_session=<HS256 JWT>

Browser → GET /w/{id}/api/v1/files/tree → Control Plane
  ← WorkspaceRouter.route() → fly-replay: instance=ws-{id}
  → Fly Proxy replays to Workspace Machine
  → Workspace Machine validates boring_session (stateless HS256)
  ← 200 OK
```

Workspace Machine needs ONE secret: `BORING_SESSION_SECRET`. No DB, no JWKS, no Neon Auth config.

---

## Part 5: Volume Lifecycle

### Create Workspace

```python
result = await provisioner.create(workspace_id, region="cdg", size_gb=10)
await db.execute(
    "UPDATE workspaces SET machine_id=$1, volume_id=$2, status='ready' WHERE id=$3",
    result.machine_id, result.volume_id, workspace_id,
)
```

### Workspace states (MVP)

| State | Machine | Volume | Cost |
|---|---|---|---|
| Active | running | mounted rw | ~$2.30/mo compute + $0.15/GB/mo storage |
| Idle | **suspended** | attached | $0 compute + $0.15/GB/mo storage |
| Deleted | deleted | deleted | $0 |

### Volume persistence

- Survives: stop, suspend, restart, redeploy
- Lost: explicit volume delete only
- Snapshots: daily automatic (Fly built-in), 5-day retention

---

## Part 6: Implementation Phases

### Phase 0: Deploy core mode to Fly.io + clean up legacy deploy

**Goal**: Current frontend-agent mode runs on Fly.io. Remove dead Modal/Docker Compose/Go deploy artifacts. No app code changes.

**New files**:
- `deploy/fly/fly.toml` — single-Machine config for core mode
- `deploy/fly/fly.secrets.sh` — set secrets from Vault

**Delete**: All Modal, Docker Compose, Go, and edge deploy artifacts (see Part 1 table).

**Keep**: `deploy/shared/Dockerfile.backend`, `deploy/README.md`, local dev (`bui run`).

**Verification**: `fly deploy` succeeds. Health check + auth + PTY work identically.

---

### Phase 1: Provisioner + router interfaces + Fly implementation

**Goal**: Control plane can create/delete workspace Machines and route requests to them. Behind provider-agnostic interfaces.

**New files**:
- `src/back/boring_ui/api/workspace/provisioner.py` — `WorkspaceProvisioner` protocol
- `src/back/boring_ui/api/workspace/fly_provisioner.py` — Fly Machines API implementation
- `src/back/boring_ui/api/workspace/fly_router.py` — `fly-replay` routing implementation

**Edit**:
- `workspace_router_hosted.py`: Wire to `FlyProvisioner` for workspace CRUD
- `workspace_boundary_router_hosted.py`: Wire to `FlyReplayRouter` (replace HTTP proxy)
- `config.py`: Add `fly_api_token`, `fly_workspace_app` fields
- DB schema: Add `machine_id`, `volume_id` columns to workspaces table

**Verification**: Integration test creates real Fly Machine + Volume, routes via fly-replay, checks health, deletes.

---

### Phase 2: Workspace Machine — backend-agent process model

**Goal**: Workspace Machine runs boring-ui in backend-agent mode. Agent runs directly on the Machine (no sandbox).

**Edit**:
- `app.py`: When `agents_mode == "backend"` and no DB configured, mount workspace routers only (no control_plane)
- `pi_service/tools.mjs`: Execute commands directly on workspace filesystem (already does this)
- Dockerfile: ensure Node.js + pi_service available in image

**New files**:
- `deploy/fly/fly.control-plane.toml` — control plane Machine config
- `deploy/fly/fly.workspaces.toml` — workspace Machine config

**Verification**: Workspace Machine starts, validates cookie, PiHarness spawns, agent executes `ls /workspace`, returns result.

---

### Phase 3: Frontend integration

**Goal**: Frontend handles backend-agent mode. Capabilities endpoint exposes workspace state.

**Edit**:
- `/api/capabilities` returns workspace runtime info (agent mode, placement)
- Frontend: backend-agent → agent panel uses `/ws/agent/normal/*`, no browser-side LLM
- PTY runs on workspace Machine

**Speculative pre-warming**: When the user hits the dashboard (list workspaces), the control plane fires a background `provisioner.resume()` on their most recent suspended workspace. By the time they click "Open", the Machine is already warm. Zero cost (suspend→resume is free until it runs), hides cold start completely.

**Verification**: Full E2E: sign up → create workspace → fly-replay → agent chat → file edit → git commit.

---

### Phase 4: boring.app.toml + bui CLI

**Goal**: `[deploy] platform = "fly"` + `bui deploy` wraps Fly.io provisioning. Child apps declare backend-agent mode without inheriting Fly-specific concepts.

```toml
[deploy]
platform = "fly"

[deploy.fly]
org = "boring"
control_plane_app = "boring-cp"
workspace_app = "boring-workspaces"
region = "cdg"
workspace_size_gb = 10
workspace_guest = { cpus = 1, memory_mb = 512, cpu_kind = "shared" }
```

---

## Part 7: Config Matrix

| Setting | frontend (single Machine) | backend: control plane | backend: workspace Machine |
|---|---|---|---|
| `agents.mode` | `frontend` | `backend` | `backend` |
| `[frontend.data] backend` | `lightningfs` | n/a | `http` |
| Fly Machines | 1 (always-on) | 1 (always-on) | N (auto-stop) |
| Routers | all | `control_plane` only | files, git, pty, chat_claude_code, ui_state |
| `DATABASE_URL` | required | required | not set |
| `BORING_SESSION_SECRET` | required | required | required (same value) |
| `ANTHROPIC_API_KEY` | not needed (browser) | not needed | required (PiHarness calls LLM directly) |
| `FLY_API_TOKEN` | not needed | required | not needed |
| PiHarness | not started | not started | started |
| Agent execution | browser (LightningFS + Pyodide) | n/a | direct on Machine (no sandbox) |
| Volume | none | none | Fly volume at /workspace |
| Auto-stop | never | never | suspend on idle |

---

## Part 8: Risk Assessment

| Risk | Mitigation |
|---|---|
| Fly.io rate limits (1 req/s create) | Pre-created machine pool for burst |
| Volume data loss (NVMe failure) | Fly daily snapshots + git push |
| Cold start (~1-2s from stopped) | Use `suspend` (~300ms resume) |
| Agent reads env secrets | Acceptable for v1 (single-tenant). Post-MVP: bwrap `--clearenv` |
| Agent network access | Acceptable for v1. Post-MVP: bwrap `--unshare-net` |
| Fly lock-in | WorkspaceProvisioner/Router interfaces decouple app from provider |
| Supply-chain CVE in base image | Dependabot + regular base image rebuilds + minimal `apt` surface |

---

## Part 9: Child App Considerations

boring-ui is a framework — child apps live in independent repos with their own `boring.app.toml`.

### What changes for child apps

**Nothing in frontend-agent mode.** `bui run` locally, `fly deploy` for hosted. Same as today.

**backend-agent mode is opt-in** per child app via `boring.app.toml`:

```toml
[agents]
mode = "backend"

[deploy]
platform = "fly"

[deploy.fly]
workspace_app = "myapp-workspaces"
```

### Framework vs child app responsibilities

| Concern | Framework (boring-ui) | Child app |
|---|---|---|
| `WorkspaceProvisioner` + Fly impl | Provides | Uses |
| `WorkspaceRouter` + Fly impl | Provides | Uses |
| `boring_session` cookie auth | Provides | Uses |
| Docker image | Base image | Extends or uses as-is |
| `boring.app.toml` schema | Defines | Fills in values |
| `fly.toml` generation | `bui deploy` generates | Runs `bui deploy` |
| Custom routers / panels | Schema supports | Registers own |
| Agent config | `[agents]` schema | Chooses mode + agent |

### Child app extensibility (already in framework)

All of these work today via `boring.app.toml` — no framework changes needed:

```toml
[backend]
# Custom FastAPI routers — mounted at /api/x/<module_name>
routers = ["myapp.routers.analytics:router", "myapp.routers.billing:router"]

[frontend.panels]
# Custom panels — registered in PaneRegistry, capability-gated
analytics = { component = "AnalyticsPanel", title = "Analytics", placement = "right" }

[agents.custom_agent]
# Custom agent harness
enabled = true
transport = "stdio"
command = ["python3", "-m", "myapp.agent"]
```

### Docker image strategy

The framework provides a base image with all core deps (Python, Node, git, etc.). Child apps can optionally layer on top:

```toml
[backend]
extra_requirements = ["pandas"]   # pip install at build time
extra_apt = ["ffmpeg"]            # apt install at build time
```

`bui deploy` generates a multi-stage Dockerfile: framework base → child layer. Child apps that don't need extras just use the base image as-is.

---

## Post-MVP: Sandbox Hardening

When needed (untrusted tenants, stricter isolation requirements), cherry-pick from `sandbox-poc-archive` branch:

- `bwrap.py` — bubblewrap backend with `--clearenv --unshare-all`, no `/proc`, user separation
- `validated_exec.py` — command allowlist fallback
- `backend.py` — `ExecutionBackend` protocol
- `presenter.py`, `auth.py`, `router.py` — sandbox HTTP surface

This adds defense-in-depth inside the VM: agent commands run in a namespace sandbox with scrubbed env, no network, no access to backend secrets. The VM boundary remains the primary isolation; bwrap hardens the agent-within-VM boundary.

---

## Post-MVP: Future Enhancements

From Codex review — valid but deferred:

- **Credential brokering**: Short-lived leases instead of raw API keys in workspace env
- **Workspace snapshots/templates/branching**: Product UX on top of Fly volume snapshots
- **Audit/event journal**: Per-command execution ledger
- **Warm pool**: Pre-booted machines for low-latency resume
- **Quotas + egress policy**: Default-deny network, explicit allowlists
- **Extended lifecycle states**: provisioning, warming, sealed, quarantined
- **Self-hosted backend**: `HetznerProvisioner` + bwrap (needs sandbox layer)

---

## Review Checklist

- [x] Codex review (interfaces, non-goals, future section incorporated)
- [ ] Gemini review
- [ ] Create beads for each phase
- [ ] Phase 0: Fly.io deploy + cleanup
- [ ] Phase 1: Provisioner + router interfaces
- [ ] Phase 2: Workspace Machine backend-agent
- [ ] Phase 3: Frontend integration
- [ ] Phase 4: boring.app.toml + bui CLI
