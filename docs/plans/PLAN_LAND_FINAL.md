# Plan: Land Final Architecture on Main + Running Backend-Agent App

## Status

**v5 FINAL** — 2026-03-18 (6 review rounds: Codex R1, Gemini R1, Codex R2, Gemini R2, Codex R3, Gemini R3 + Codex R4 — GREEN)

**Goal**: Two phases:
- **Phase 1**: Merge `supabase-neon-cleanup` onto `main` — clean codebase with Supabase/Companion/CheerpX removed, agent harness + workspace context + Fly.io infra unified
- **Phase 2**: Wire + run — fully running app with PI agent in backend mode on a dedicated workspace VM

---

## Phase 1: Merge

### Strategy: Merge + Resolve, Not Cherry-Pick

The 6 commits on `supabase-neon-cleanup` are deeply interdependent. Dry-run merge shows **13 conflicts** (5 content + 8 modify/delete), all straightforward.

### What Lands

| # | Feature | Source | LOC impact |
|---|---------|--------|------------|
| 1 | Supabase removal | branch | -1,800 (delete) + 7 renames |
| 2 | Companion + CheerpX removal | branch | -7,700 (delete) |
| 3 | Agent harness (PiHarness, Registry, ToolGateway) | branch | +700 (new) |
| 4 | Workspace context (resolver, paths) | branch | +400 (new) |
| 5 | Frontend overhaul (AgentPanel, runtimeConfig, App.jsx) | branch | net -200 |
| 6 | PI service tools (tools.mjs) | branch | +415 (new) |
| 7 | Backend infra (runtime_config, observability, request_id) | branch | +400 (new) |

### What Does NOT Land

- bui CLI deploy.go Docker rewrite — keep main's Fly deploy
- Docker deploy artifacts — keep main's Fly configs
- Sandbox package — stays archived, no imports

### Conflict Resolution Table

| File | Type | Resolution |
|------|------|------------|
| `bui/cmd/deploy.go` | content | **Keep main** (Fly deploy) |
| `bui/config/config.go` | content | **Union**: Fly fields (main) + agent fields (branch) |
| `deploy/README.md` | content | **Keep main** |
| `config.py` | content | **Branch** + remove sandbox fields + **preserve main's workspace role split** (`agents_mode == "backend" and not effective_database_url -> control_plane_enabled = False`) |
| `workspace/__init__.py` | add/add | **Union**: provisioner protocols (main, eager imports) + context helpers (branch, lazy `__getattr__`) |
| `deploy/core/*.env.example` | modify/delete | Accept deletion |
| `deploy/core/docker-compose.yml` | modify/delete | Accept deletion |
| `deploy/edge/*.env.example` | modify/delete | Accept deletion |
| `deploy/edge/docker-compose.yml` | modify/delete | Accept deletion |
| `deploy/shared/docker-compose.legacy.yml` | modify/delete | Accept deletion |
| `docs/PROJECT_CONTEXT.md` | modify/delete | Accept deletion |
| `docs/plans/backend-architecture-plan.md` | modify/delete | Accept deletion |
| `deploy/shared/Dockerfile.backend` | content | **Keep branch** but strip nsjail entirely (build stage, binary, apt deps). Add pi_service COPY + npm ci. Use nodesource Node >= 18. |

### Sandbox + nsjail Complete Removal (6 source files + 9 test files + 1 new route)

No sandbox package, no nsjail, no bwrap, no BoxLite. Each workspace has its own Fly VM — the VM IS the isolation. Strip everything:

**Source files:**
1. `pi_harness.py` — inline `create_workspace_token` (~15 lines PyJWT)
2. `tool_gateway.py` — define `ExecutionResult` dataclass locally
3. `capabilities.py` — remove sandbox router registration + contract metadata
4. `config.py` — remove `sandbox_backend` field, `resolve_sandbox_backend()`, `create_execution_backend()`, **AND the `__post_init__` call to `resolve_sandbox_backend()`** (otherwise every `APIConfig()` instantiation crashes)
5. `app.py` — remove `'sandbox'` from `enabled_routers`, `enabled_features`, `router_args`, docstring
6. `resolver.py` — set `execution_backend_factory=None`

**New: direct exec route** (~50 lines) — mount at workspace-scoped path `/w/{workspace_id}/api/v1/sandbox/exec` (tools.mjs constructs URLs as `/w/{workspaceId}/api/v1/sandbox/exec`, NOT bare `/api/v1/sandbox/exec`). Implementation: `asyncio.create_subprocess_shell` with timeout.

**Test files (9):**
- `test_agent_tool_gateway.py` — update `ExecutionResult` import
- `test_child_cli_contract.py` — remove `NsjailBackend` import + tests
- `test_path_safety.py` — remove `NsjailBackend`/`ValidatedExecBackend` imports + tests
- `test_config.py` — remove `monkeypatch.setattr('boring_ui.api.sandbox.*')` tests
- `test_capabilities.py` — remove `'sandbox' in features/router_names` assertions
- `test_bd_3g1g_5_3_capabilities_metadata.py` — remove sandbox metadata assertions
- `test_create_app.py` — update endpoint assertions (if file exists on branch)
- `test_backend_dockerfile_tools.py` — remove nsjail COPY assertion
- `test_deployment_scripts.py` — remove `test_prod_dockerfile_marks_nsjail_setuid_root`, fix KVM test

### Dockerfile Fix (BLOCKER from Gemini R2)

The branch's `Dockerfile.backend` needs 3 changes:
- **Add**: `COPY src/pi_service ./src/pi_service` + `COPY package.json package-lock.json ./` + `RUN npm ci --production` (PI sidecar needs `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`)
- **Remove**: nsjail entirely — build stage, binary copy, nsjail apt build-deps (~200MB savings). VM boundary is the isolation. nsjail is not coming back.
- **Fix**: Node.js >= 18 via nodesource PPA (Debian `apt install nodejs` ships ancient versions, ESM `import` requires >= 14, PI deps need >= 18)

### Post-merge verification

```bash
python3 -c "from boring_ui.api.app import create_app; print('OK')"
python3 -m pytest tests/unit/ -v
npx vite build
```

### Remove Docker/Hetzner deploy artifacts

These come from the branch merge but conflict with Fly.io strategy. All contain nsjail/sandbox refs:

```
git rm deploy/python/Dockerfile
git rm deploy/python/Dockerfile.boxlite-guest
git rm deploy/python/Caddyfile
git rm deploy/python/Caddyfile.prod
git rm deploy/docker-compose.prod.yml
```

Keep `deploy/shared/Dockerfile.backend` (Fly base image — nsjail stripped in Dockerfile Fix step).

### Also verify after merge

- `app.py`: DB import is `from .modules.control_plane import db_client as control_plane_db_client` (NOT old `supabase` path)
- `boring.app.toml`: `[deploy] platform = "fly"` (NOT `"docker"` from branch)

---

## Phase 2: Wire + Run Backend-Agent Mode

### Step 1: Verify PiHarness lifespan wiring (already done)

The branch's `app.py` **already contains** the full PiHarness lifespan wiring:
- Lifespan context manager starts/stops `pi_harness`
- Conditional creation of `PiHarness(config)` when `agents_mode == "backend"`
- `AgentRegistry.from_config(config)`, route registration

**This is a verify step, not an implementation step.** Confirm it survived the merge cleanly.

### Step 2: Direct exec endpoint implementation

Create `src/back/boring_ui/api/modules/exec/router.py`:

```python
# Workspace-scoped route: /w/{workspace_id}/api/v1/sandbox/exec
# Body: { command, cwd, timeout_seconds }
# Returns: { exit_code, stdout, stderr, duration_ms, truncated }
# Implementation: asyncio.create_subprocess_shell with timeout
# No auth on internal calls (workspace Machine validates session at boundary)
```

Register in `app.py` router args. Add `/api/v1/sandbox` to `_WORKSPACE_PASSTHROUGH_ROOTS` in `workspace_boundary_router_hosted.py` (needed for local dev when control plane and workspace run in same process; Fly `fly-replay` bypasses this in production).

**Files**: new `modules/exec/router.py` (~50 lines), `app.py` (register route), `workspace_boundary_router_hosted.py` (add passthrough root)

### Step 3: Workspace role split — verify workspace Machine routing

Main already has workspace role split (bd-gbqy.7): when `AGENTS_MODE=backend` and no `DATABASE_URL`, the app mounts only workspace routers (files, git, pty, exec, agent) — no control plane.

Verify this works with the merged code:
```bash
AGENTS_MODE=backend BORING_UI_WORKSPACE_ROOT=/tmp/test-ws \
  python3 -c "from boring_ui.api.app import create_app; app = create_app(); print('workspace mode OK')"
```

**Files**: verify only, likely no changes needed

### Step 4: PiHarness + tools.mjs integration test

Start the full stack locally:

```bash
# Terminal 1: Backend in workspace mode
export AGENTS_MODE=backend
export BORING_UI_WORKSPACE_ROOT=/tmp/test-workspace
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export BORING_SESSION_SECRET=dev-secret
mkdir -p $BORING_UI_WORKSPACE_ROOT
python3 -c "from boring_ui.api.app import create_app; import uvicorn; app = create_app(); uvicorn.run(app, host='0.0.0.0', port=8000)"

# Terminal 2: Verify
curl http://localhost:8000/healthz
curl http://localhost:8000/api/capabilities | python3 -m json.tool

# Test exec endpoint (workspace-scoped path)
curl -X POST http://localhost:8000/w/default/api/v1/sandbox/exec \
  -H 'Content-Type: application/json' \
  -d '{"command": "echo hello && ls /tmp/test-workspace"}'

# Test file operations
curl http://localhost:8000/api/v1/files/list?path=.
```

### Step 5: Frontend backend-agent mode test

```bash
# Terminal 3: Frontend dev server
npx vite --host 0.0.0.0 --port 5173
```

Open browser: `http://localhost:5173`
- Frontend fetches `/__bui/config` -> detects `agents.mode = "backend"`
- Agent panel shows PI agent (server-side, not browser)
- Chat with agent -> agent calls tools via backend -> files appear on disk
- Edit file in Editor panel -> file saved via `/api/v1/files/write` -> agent sees changes

### Step 6: Fly.io deploy (two Machines)

**Control plane Machine** (always-on):
```bash
fly deploy --config deploy/fly/fly.control-plane.toml

fly secrets set \
  DATABASE_URL="..." \
  BORING_SESSION_SECRET="..." \
  NEON_AUTH_BASE_URL="..." \
  FLY_API_TOKEN="..." \
  FLY_WORKSPACE_APP="boring-workspaces"
```

**Workspace Machine app** (per-workspace):
```bash
fly apps create boring-workspaces

fly deploy --app boring-workspaces --config deploy/fly/fly.workspaces.toml

fly secrets set --app boring-workspaces \
  BORING_SESSION_SECRET="..." \
  ANTHROPIC_API_KEY="..." \
  BORING_UI_WORKSPACE_ROOT="/workspace"
```

### Step 7: E2E verification on Fly

```
Browser -> https://boring-cp.fly.dev/auth/login
  -> Sign in (Neon Auth)
  -> Create workspace
    -> Control plane calls FlyProvisioner.create()
    -> Fly Machine + Volume created in boring-workspaces app
  -> Open workspace
    -> /w/{id}/** -> fly-replay -> workspace Machine
    -> PiHarness starts, PI sidecar boots
  -> Test 1: Agent file edit
    -> "Create a hello.py file"
    -> Agent calls write_file -> PUT /w/{id}/api/v1/files/write -> file on /workspace volume
    -> "Run it"
    -> Agent calls exec -> POST /w/{id}/api/v1/sandbox/exec -> subprocess -> output
  -> Test 2: Direct file edit
    -> Open hello.py in Editor panel
    -> Edit content, save
    -> PUT /w/{id}/api/v1/files/write (same endpoint, user-initiated)
    -> Agent sees updated file on next read
  -> Close workspace
    -> Machine suspends (auto-stop)
    -> Volume persists
  -> Reopen -> Machine resumes (~300ms) -> files still there
```

---

## Summary: Effort Estimate

| Phase | What | Type | Effort |
|-------|------|------|--------|
| 1.1 | Merge + resolve 13 conflicts | Merge | ~30 min |
| 1.2 | Strip sandbox + nsjail (15 files) + fix `__post_init__` | Edit (deletions) | ~30 min |
| 1.3 | Remove Docker/nsjail deploy artifacts | Delete | ~5 min |
| 1.4 | Reconcile app.py (verify DB import, role split) | Edit | ~30 min |
| 1.5 | Fix tests + verify boring.app.toml | Edit | ~30 min |
| 1.6 | Fix Dockerfile (add pi_service, npm, remove nsjail) | Edit | ~15 min |
| **Phase 1 total** | | | **~2.5 hours** |
| 2.1 | Verify PiHarness lifespan (already wired) | Verify | ~10 min |
| 2.2 | Direct exec endpoint (workspace-scoped) | New (~50 lines) | ~30 min |
| 2.3 | Workspace role split verify | Verify | ~15 min |
| 2.4 | Local integration test | Test | ~30 min |
| 2.5 | Frontend backend-mode test | Test | ~30 min |
| 2.6 | Fly.io deploy | Deploy | ~1 hour |
| 2.7 | E2E on Fly (agent + direct file edit) | Test | ~30 min |
| **Phase 2 total** | | | **~3 hours** |
| **Grand total** | | | **~5.5 hours** |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Merge conflicts break imports | 11 conflicts identified, all resolvable |
| Sandbox imports cause ImportError | Strip 6 source + 7 test files, including `__post_init__` call |
| `app.py` supabase->control_plane import rename | Manual verify — auto-merge may pick wrong side |
| config.py loses workspace role split | Explicitly preserve main's `control_plane_enabled = False` logic |
| Dockerfile missing pi_service + npm | Fix in Phase 1.6 — add COPY + npm ci |
| Dockerfile Node.js too old | Use nodesource PPA for Node >= 18 |
| tools.mjs calls workspace-scoped exec URL | Mount exec route at `/w/{workspace_id}/api/v1/sandbox/exec` |
| Wrong env var for workspace root | Use `BORING_UI_WORKSPACE_ROOT` everywhere (not `WORKSPACE_ROOT`) |
| `boring.app.toml` lands with `platform = "docker"` | Fix to `"fly"` in Phase 1 |
| Tests assert sandbox features | Update 7 test files in Phase 1.5 |
| Exec endpoint auth unspecified | Workspace Machine validates `boring_session` at boundary; internal exec has no separate auth (single-tenant MVP) |

---

## Reviews

### Codex R1: APPROVE WITH CONDITIONS
- Sandbox ImportError blocker -> fixed (strip all refs)
- 3 missed conflicts -> added (11 total)
- `vite.config.ts` concern -> not actually deleted
- app.py DB import rename -> manual verify added
- config.go should union -> changed to union

### Gemini R1: 3 blockers found
- `app.py` not in sandbox strip -> added
- `resolver.py` cascading failure -> added
- PI exec endpoint removed -> direct exec route added
- 6+ test files missed -> full table added
- config.py conflict description wrong -> corrected

### Codex R2: APPROVE WITH CONDITIONS
- `app.py` sandbox refs -> confirmed + added
- `@app.on_event` deprecated -> use branch's lifespan
- `boring.app.toml` platform -> fix to "fly"
- `tools.mjs` exec endpoint -> direct exec route
- `test_agent_tool_gateway.py` -> added to test table

### Gemini R2: FAIL — 4 blockers
- Dockerfile missing `src/pi_service/` + `npm install` -> **fixed**: add COPY + npm ci in Phase 1.6
- `config.py __post_init__` calls `resolve_sandbox_backend()` -> **fixed**: added to sandbox strip item 4
- nsjail build in Dockerfile pointless -> **fixed**: remove from Dockerfile
- Wrong env var `WORKSPACE_ROOT` -> **fixed**: all refs now `BORING_UI_WORKSPACE_ROOT`

### Codex R3: APPROVE WITH CONDITIONS
- Phase 2 Step 1 already done in branch -> **fixed**: changed to "verify" step
- tools.mjs uses workspace-scoped URL `/w/{id}/api/v1/sandbox/exec` -> **fixed**: mount at correct path
- Branch lacks main's workspace role split -> **fixed**: added to config.py conflict resolution
- Wrong env var -> **fixed**: `BORING_UI_WORKSPACE_ROOT` everywhere

### Gemini R3: APPROVE WITH CONDITIONS (1 minor)
- Add `/api/v1/sandbox` to workspace boundary passthrough roots -> **fixed**: added to Step 2

### Codex R4: APPROVE WITH CONDITIONS (incremental)
- 2 more test files: `test_backend_dockerfile_tools.py`, `test_deployment_scripts.py` -> **fixed**: added to test list (9 total)
- 13 conflicts not 11 (2 trivial modify/delete) -> **fixed**: updated count + table
- `deploy/python/` nsjail refs -> **fixed**: all Docker artifacts deleted in Phase 1.3
