# Backend Architecture Plan: Python (FastAPI) with Isolated Agent Execution

## Status

New plan candidate. Intended to supersede the Go-based plan after review, not by blind replacement:
- Go backend: 70% done but not fully working. Would require finishing + sidecar complexity.
- Node.js rewrite: Clean architecture but full rewrite effort.
- **Python (FastAPI): 100% working, deployed, battle-tested.** Enhance with sandbox + PI sidecar.

**Decision**: Keep Python. Ship faster. Add the three missing pieces (workspace resolver, nsjail sandbox, PI sidecar integration) to the working backend.

**Prior work**: `docs/plans/backend-architecture-plan.md` (Go-based, retained for reference). Research in `docs/plans/backend-problem-statement-research/`.

---

## Executive Summary

The target is the existing Python (FastAPI) backend enhanced with workspace-scoped resolution, nsjail-isolated agent execution, and a pluggable agent harness — deployable locally, in Docker, or on hosted infrastructure without code changes.

**Eight key decisions:**

1. **Python (FastAPI) is the canonical backend.** It's 100% working, deployed, and battle-tested. All modules (files, git, pty, stream, controlplane, auth, GitHub) are production-ready. Child app TOML loading (`app_config_loader.py`) already works. Go backend retained as optional alternative but not the primary path.
2. **Pluggable agent architecture with PI as default.** Agents are behind a Python `AgentHarness` protocol. PI agent (Node.js sidecar, 12+ LLM providers) is the default. Claude Agent SDK (Python — `claude-agent-sdk`) is a future alternative. Child apps can register custom agents.
3. **First deployment: self-hosted VM (OVH or Hetzner) with Docker.** Full Linux kernel enables nsjail namespace isolation.
4. **nsjail for per-command isolation with a stateful host filesystem.** Each agent command runs in an isolated Linux namespace (PID, mount, net). The workspace directory is bind-mounted read-write — files and installed packages persist across commands. Zero overhead.
5. **Path safety should be strengthened, not weakened.** Keep the existing Python `resolve()` + `is_relative_to()` checks as fallback, but move toward a dedicated Linux helper around `openat2(..., RESOLVE_BENEATH)` where available. nsjail mount boundary is the second layer for exec.
6. **One workspace, one source of truth.** Frontend file tree, backend files/git endpoints, and PI agent all operate on the same mounted filesystem via a per-request workspace context.
7. **Exactly two app-level agent modes exist.** `frontend` mode (browser PI, LightningFS, Pyodide) and `backend` mode (server PI, nsjail). The app chooses one in `boring.app.toml`; this is not a runtime user toggle.
8. **Simplify the current deployment model.** The canonical architecture should not depend on the historical `core` vs `edge` split. `edge mode` and `boring-sandbox` should be treated as legacy compatibility/deployment paths, not as required architecture for the new backend-agent system.

---

## Part 1: What Already Works (Python Backend)

The Python backend at `src/back/boring_ui/api/` is **complete and deployed**. Every module is production-ready:

| Module | Location | Routes | Status |
|---|---|---|---|
| **Files** | `modules/files/` | list, read, write, delete, rename, move, search | Working |
| **Git** | `modules/git/` | status, diff, show, branches, init, add, commit, push, pull, clone, merge, remote | Working |
| **PTY** | `modules/pty/` | WebSocket terminal sessions, multi-client, idle cleanup | Working |
| **Stream** | `modules/stream/` | Claude CLI bridge, WebSocket streaming, session management | Working |
| **Control Plane** | `modules/control_plane/` | Users, workspaces, memberships, invites, settings, runtime | Working |
| **Auth** | `control_plane/auth_*` | Local, Supabase, Neon Auth (Better Auth), JWKS JWT validation | Working |
| **GitHub** | `modules/github_auth/` | OAuth flow, installation management, git credential resolution | Working |
| **UI State** | `modules/ui_state/` | Panel state persistence, UI commands | Working |
| **Agent Normal** | `modules/agent_normal/` | Session lifecycle, attachment uploads | Working |
| **Capabilities** | `capabilities.py` | Feature flags, router registry, service discovery | Working |

**Infrastructure that already works:**
- `APIConfig` — centralized config with path validation
- `LocalStorage` / `S3Storage` — file operations with boundary checks
- `SubprocessGitBackend` — git via subprocess with credential management
- `RouterRegistry` — modular router composition with capability reporting
- `app_config_loader.py` — child app TOML config loading (dynamic router import)
- `WorkspacePluginManager` — existing extension point for workspace-local routes/plugins
- Session cookies (HS256 JWT, shared with boring-sandbox)
- Policy enforcement via `X-Scope-Context` header
- Database: local JSON + asyncpg (Neon/Supabase)
- Deployment: Modal child-app path exists today; Docker/VM path should be formalized as part of this work

**What this means**: We are NOT rewriting the backend. We are adding three new capabilities to a working system.

**Best ideas to borrow from the Go work** (not the code, the thinking):
- Explicit request middleware for workspace context injection
- Tighter module ownership boundaries
- More explicit capability reporting
- Cleaner API error envelopes
- Request ID propagation across middleware and downstream services
- Better deployment packaging (single-image Docker)
- More systematic unit coverage for middleware, auth, and workspace resolution

---

## Part 2: What Must Be Added (Three Pieces)

### Piece 1: Per-Request Workspace Context

**The problem**: `APIConfig.workspace_root` is a single value set at startup. All modules use it. Multi-workspace requires per-request resolution.

**The solution**:

```python
# src/back/boring_ui/api/workspace_context.py

class WorkspaceContextResolver:
    """Resolves workspace ID → filesystem root per request."""

    def __init__(self, base_root: Path, single_mode: bool = False):
        self.base_root = base_root
        self.single_mode = single_mode

    def resolve(self, workspace_id: str | None) -> Path:
        if self.single_mode or not workspace_id:
            return self.base_root
        root = (self.base_root / workspace_id).resolve()
        if not root.is_relative_to(self.base_root):
            raise ValueError(f"Workspace path escapes base root: {workspace_id}")
        return root

class WorkspaceContext:
    """Per-request workspace context. Injected via FastAPI dependency."""
    workspace_id: str | None
    root_path: Path
    storage: Storage
    git_backend: GitBackend
    execution_backend: ExecutionBackend
```

**Integration**: FastAPI dependency injection. The workspace boundary router (`/w/{workspace_id}/*`) already exists — extend it to inject `WorkspaceContext` into route handlers.

```python
async def get_workspace_context(
    request: Request,
    workspace_id: str = Path(...),
    resolver: WorkspaceContextResolver = Depends(get_resolver),
) -> WorkspaceContext:
    root = resolver.resolve(workspace_id)
    return WorkspaceContext(
        workspace_id=workspace_id,
        root_path=root,
        storage=LocalStorage(root),
        git_backend=SubprocessGitBackend(root),
        execution_backend=get_execution_backend(),
    )
```

**Migration effort**: Small. Existing modules already take `config` and `storage` as constructor args. Change them to accept `WorkspaceContext` from the request instead of from app startup.

### Piece 2: nsjail Sandbox (Execution Backend)

**The problem**: PI agent needs to run shell commands isolated to one workspace.

**The solution**:

```python
# src/back/boring_ui/api/sandbox/backend.py

class ExecutionBackend(Protocol):
    async def run(
        self,
        *,
        workspace_root: Path,
        command: str | None = None,       # shell command string (nsjail mode)
        argv: list[str] | None = None,    # explicit argv, shell-free (validated exec mode)
        cwd: str = ".",
        env: dict[str, str] | None = None,
        timeout_seconds: int = 60,
    ) -> ExecutionResult: ...

@dataclass
class ExecutionResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    truncated: bool
```

Important design rule:

- canonical tools should live as internal Python services first
- thin HTTP wrappers can expose them outward
- the backend should not force itself to call localhost HTTP just to read files or run git

**Two implementations**:

```python
# src/back/boring_ui/api/sandbox/nsjail.py
class NsjailBackend:
    """Production: per-command namespace isolation."""
    async def run(self, *, workspace_root, command, **kw) -> ExecutionResult:
        proc = await asyncio.create_subprocess_exec(
            'nsjail', '--mode', 'once',
            '--bindmount', f'{workspace_root}:/workspace',
            '--bindmount', f'{workspace_root}/.pip-local:/usr/local/lib/python3/dist-packages',
            '--bindmount_ro', '/usr/lib/python3:/usr/lib/python3',
            '--bindmount_ro', '/usr/bin:/usr/bin',
            '--cwd', f'/workspace/{cwd}',
            '--time_limit', str(timeout_seconds),
            '--', 'bash', '-c', command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds + 5)
        return ExecutionResult(exit_code=proc.returncode, stdout=stdout.decode(), ...)

# src/back/boring_ui/api/sandbox/validated_exec.py
class ValidatedExecBackend:
    """Dev fallback: command allowlist + rlimits. No real isolation."""
    ALLOWED = {'cat', 'cp', 'diff', 'echo', 'find', 'grep', 'git', 'head', ...}
    async def run(self, *, workspace_root, command, **kw) -> ExecutionResult:
        # Parse command, validate against allowlist, subprocess.run with rlimits
        ...
```

**Endpoint**:

```
POST /w/{workspace_id}/api/v1/sandbox/exec
{
  "command": "grep -r TODO src/",
  "cwd": ".",
  "timeout_seconds": 60
}
→ { "exit_code": 0, "stdout": "...", "stderr": "", "duration_ms": 45, "truncated": false }
```

**Presentation layer** (output formatting for LLM):

```python
# src/back/boring_ui/api/sandbox/presenter.py
class ExecutionPresenter:
    def format(self, result: ExecutionResult) -> str:
        # Truncation, binary detection, metadata footer, error hints
        ...
```

**nsjail mount config** (same as Go plan — language-agnostic):

| Mount | Source | Target | Mode |
|---|---|---|---|
| Workspace | `/workspaces/{id}/` | `/workspace` | read-write |
| Pip packages | `/workspaces/{id}/.pip-local/` | `/usr/local/lib/python3/dist-packages` | read-write |
| System Python | `/usr/lib/python3/` | same | read-only |
| System binaries | `/usr/bin/`, `/lib/` | same | read-only |
| Child CLI | on PATH | on PATH | read-only |
| Temp | tmpfs | `/tmp` | ephemeral |

### Piece 3: Agent Harness (Pluggable, PI Default)

**The architecture**: Shared tools + swappable harness.

```python
# src/back/boring_ui/api/agents/harness.py

class AgentHarness(Protocol):
    """Pluggable agent harness. PI is the default."""
    @property
    def name(self) -> str: ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def healthy(self) -> HarnessHealth: ...
    def routes(self) -> list[APIRouter]: ...

    # Session lifecycle (required for multi-turn chat)
    async def create_session(self, ctx: WorkspaceContext, req: SessionRequest) -> SessionInfo: ...
    async def stream(self, ctx: WorkspaceContext, session_id: str) -> AsyncIterator: ...
    async def send_user_message(self, ctx: WorkspaceContext, session_id: str, message: str) -> None: ...
    async def terminate_session(self, ctx: WorkspaceContext, session_id: str) -> None: ...
```

**PI harness** (Node.js sidecar — same pattern as Go plan, but Python-first naming):

```python
# src/back/boring_ui/api/agents/pi_harness.py

class PiHarness:
    """Manages Node.js PI service sidecar. Proxies routes."""
    name = "pi"

    async def start(self):
        self.process = await asyncio.create_subprocess_exec(
            'node', 'src/pi_service/server.mjs',
            env={**os.environ, 'PI_PORT': '8789', 'BORING_BACKEND_URL': 'http://localhost:8000'}
        )

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient() as c:
                r = await c.get('http://localhost:8789/health')
                return r.status_code == 200
        except: return False

    def routes(self) -> list[APIRouter]:
        # Reverse proxy /w/{id}/api/v1/agent/pi/* → localhost:8789
        ...
```

**Shared tool endpoints** — the existing files/git modules ARE the tools. The PI service calls them via HTTP:

| PI Tool | Calls | Already Exists? |
|---|---|---|
| `read_file(path)` | `GET /w/{id}/api/v1/files/read` | **Yes** |
| `write_file(path, content)` | `PUT /w/{id}/api/v1/files/write` | **Yes** |
| `list_dir(path)` | `GET /w/{id}/api/v1/files/list` | **Yes** |
| `exec(command)` | `POST /w/{id}/api/v1/sandbox/exec` | **New** (Piece 2) |
| `git_status()` | `GET /w/{id}/api/v1/git/status` | **Yes** |
| `git_diff(path)` | `GET /w/{id}/api/v1/git/diff` | **Yes** |
| `git_commit(msg)` | `POST /w/{id}/api/v1/git/commit` | **Yes** |

6 of 7 tools already exist. Only the sandbox exec endpoint is new.

**ToolGateway** — tools should be defined once as internal Python services:

```python
# src/back/boring_ui/api/agents/tool_gateway.py

class ToolGateway:
    """Shared tools for all agent harnesses. Internal Python services first, HTTP second."""

    def __init__(self, ctx: WorkspaceContext):
        self.ctx = ctx

    async def read_file(self, path: str) -> str:
        return self.ctx.storage.read_file(Path(path))

    async def write_file(self, path: str, content: str) -> None:
        self.ctx.storage.write_file(Path(path), content)

    async def exec(self, command: str, cwd: str = ".") -> ExecutionResult:
        return await self.ctx.execution_backend.run(
            workspace_root=self.ctx.root_path, command=command, cwd=cwd
        )

    async def git_status(self) -> list[dict]:
        return self.ctx.git_backend.status()
    # ... etc
```

This avoids the backend calling itself over localhost HTTP just to read files or run git. The PI sidecar (Node.js) still calls HTTP endpoints since it's a separate process, but a future Python-native Claude SDK harness can call `ToolGateway` directly in-process — zero overhead.

**Claude Agent SDK harness** (deferred — future work):

```python
# Future: src/back/boring_ui/api/agents/claude_sdk_harness.py
# Uses claude-agent-sdk Python package
# Same shared tool endpoints
# Anthropic-only, but native Python integration
```

The current `stream` module should be treated as a compatibility bridge during migration, not the permanent Claude harness architecture.

**Agent registry** reads `boring.app.toml`:

```toml
[agents]
default = "pi"

[agents.pi]
enabled = true
port = 8789
```

Capabilities endpoint reports: `agents: ["pi"]`.

---

## Part 3: Child App Compatibility

**Already works** — no changes needed for most features:

| Feature | Status | Why |
|---|---|---|
| `[backend].routers` — dynamic import | **Works** | `app_config_loader.py` already loads routers from TOML paths |
| `[frontend.panels]` — custom panels | **Works** | PaneRegistry + `/__bui/config` endpoint |
| `[cli].name` — child app CLI | **Works** | `bui run` delegates to binary |
| `boring.app.toml` config contract | **Works** | `app_config_loader.py` is the loader |
| `bui deploy` (Modal) | **Works** | Current deployment path |
| `bui dev` | **Works** | Starts uvicorn + vite |

**What must be added for child apps**:
- `bui deploy` with `platform = "docker"` (new deploy target)
- `[agents]` section in TOML config (read by agent registry)
- `/__bui/config` includes agent list for frontend

**What must NOT change**:
- `app_config_loader.py` — this is the bridge that makes child apps work
- Router registry pattern — child apps register custom FastAPI routers
- Panel registration — child apps declare panels in TOML
- current child-app deployment compatibility while the new backend-agent path is being introduced

---

## Part 4: Simplification Of The Current Setup

The plan should explicitly simplify the current product and deployment surface, not just add backend-agent features on top of all existing modes.

### What should be simplified

- remove the `core` vs `edge` split from the **canonical** architecture
- stop treating `boring-sandbox` as a required part of the hosted product model
- stop requiring `DEPLOY_MODE=edge` and frontend `edge` profile branching for the main path
- collapse legacy transport/profile branching around companion-era assumptions
- keep only the minimum compatibility shims needed during migration

### Do we still need edge mode?

For the Python-first backend-agent architecture: **no, not as a first-class mode**.

Reason:

- the new target is one FastAPI backend plus an optional local Node sidecar
- workspace isolation is provided by `nsjail`, not by an extra edge proxy layer
- workspace state lives on the mounted filesystem; it does not need an external edge data plane
- the old edge path mainly exists to support `boring-sandbox` proxy/orchestration concerns from the previous architecture

The recommended stance is:

- `edge mode` becomes a **legacy compatibility path**
- the new canonical deployment path is a single backend deployment on a normal Linux host
- once the backend-agent deployment is validated, frontend config and docs should stop centering `core/edge` as the primary mental model

### What should remain after simplification

- workspace-scoped routes such as `/w/{workspace_id}/...`
- backend vs frontend **agent** mode as an app-level configuration choice
- child-app configuration through `boring.app.toml`

### What should be deprecated after validation

- `DEPLOY_MODE=edge`
- `companion-httpfs` as the main hosted profile
- dedicated edge deployment docs as the recommended path
- any requirement that `boring-sandbox` sit in front of the backend for normal hosted operation

---

## Part 5: Frontend

### Two App-Level Agent Modes

```toml
[agents]
mode = "frontend"     # PI runs in browser, user's API key, LightningFS
mode = "backend"      # PI runs server-side, nsjail sandbox
```

| Aspect | Frontend Mode (existing) | Backend Mode (new) |
|---|---|---|
| PI runs in | Browser (pi-agent-core) | Server (Node.js sidecar) |
| API keys | User provides | Backend config |
| Filesystem | LightningFS | Host disk via backend API |
| Python exec | Pyodide (WASM) | nsjail (real Python) |
| Git | isomorphic-git | SubprocessGitBackend |
| Works offline | Yes | No |

Both modes use the same PI chat UI shape, but the app chooses one mode in config. There is no runtime selector.

### What Gets Removed

| Component | Reason |
|---|---|
| Companion adapter + panel (~40 files) | Legacy Claude CLI frontend — replaced by standard PI chat UI |
| CheerpX data provider | Experimental |
| `DATA_BACKEND_OVERRIDE` | Cleanup |

### What Stays

- All frontend PI components (nativeAdapter, backendAdapter, defaultTools, providerKeys)
- All browser-local providers (LightningFS, Pyodide, isomorphic-git)
- DockView, CapabilityGate, FileTree, Editor, GitChanges, React Query, Auth
- HTTP data provider (backend mode)

### Immediate guardrail

Do **not** delete browser mode until backend mode is proven in deployed validation. De-emphasize companion-era assumptions first; remove browser-local mode only when the backend-agent path is stable.

---

## Part 6: Hosting & Deployment

Same as Go plan — language-agnostic:

```
Server (Ubuntu 24.04)
+-- Docker Compose
|   +-- boring-ui (Python FastAPI + Node.js PI sidecar + nsjail)
|   |   +-- WORKSPACE_ROOT=/data/workspaces
|   |   +-- SANDBOX_BACKEND=nsjail
|   |   +-- DATABASE_URL=postgres://neon/...
|   +-- Caddy (TLS termination)
+-- nsjail (in container image)
+-- /data/workspaces/ (block volume)
```

Dockerfile:
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y \
    git curl jq tree ripgrep nsjail nodejs npm
COPY . /app
RUN pip install /app
RUN cd /app && npm ci
EXPOSE 8000
CMD ["uvicorn", "boring_ui.api.app:create_app", "--host", "0.0.0.0", "--port", "8000"]
```

Provider: Hetzner Cloud (cheapest MVP) or OVH (sovereignty).

**Preserve current Python deploy path while migrating**:

- `deploy/core/modal_app.py` is still the canonical child-app deployment template today
- this work should add a Docker/VM-first deployment path for backend agents
- do not break the existing child-app path until the new deployment path is validated

**Deployment-path comparison**:

| Path | Recommendation | Why |
|---|---|---|
| Linux VM + Docker Compose | Primary first target | Full namespace support, simplest storage model, lowest architectural risk |
| Hetzner or OVH VPS | Primary provider class | Cheap, simple, predictable kernel behavior, direct sovereignty path |
| Fly.io / Cloud Run / gVisor-style managed runtimes | Secondary only | Useful later, but namespace availability and filesystem semantics are less predictable for real sandboxed CLI execution |
| Modal Python path | Preserve during migration, not long-term canonical for this feature | Existing child-app path still matters, but is not the cleanest endpoint for workspace-isolated backend agents |

---

## Part 7: Migration Phases

### Phase 0: Simplification decisions

**Goal**: Freeze the target shape before implementation so we do not carry forward legacy architecture by inertia.

**Changes**:
1. Mark `edge mode` as legacy compatibility, not canonical
2. Mark `boring-sandbox` as non-required for the new architecture
3. Define one recommended hosted deployment path: FastAPI + Node sidecar + nsjail on Linux host
4. Define agent mode as app-level `frontend` or `backend`, not `core` vs `edge`

### Phase 1: Workspace Context (per-request root)

**Goal**: All modules resolve workspace root per-request, not per-process.

**Changes**:
1. Create `src/back/boring_ui/api/workspace_context.py` — `WorkspaceContextResolver`, `WorkspaceContext`
2. FastAPI dependency that resolves workspace context from route params
3. Update file/git/pty/stream modules to accept `WorkspaceContext`
4. Existing path validation (`config.validate_path()`) stays — now per-workspace

**Effort**: 2-3 days. The modules already accept `config` + `storage` as constructor args. Change to per-request `WorkspaceContext`.

### Phase 2: nsjail Sandbox (parallel with Phase 1)

**Goal**: Isolated command execution with persistent filesystem.

**Changes**:
1. Create `src/back/boring_ui/api/sandbox/` — `ExecutionBackend` protocol, `NsjailBackend`, `ValidatedExecBackend`, `ExecutionPresenter`
2. Add `POST /w/{id}/api/v1/sandbox/exec` endpoint
3. Add nsjail to Dockerfile
4. Add Python packages to Docker image (pre-installed)
5. Create `.pip-local/` on workspace provisioning
6. Config: `SANDBOX_BACKEND` env var

**Effort**: 3-5 days. nsjail is mature. Main work is mount configuration.

### Phase 3: PI Agent Harness + Sidecar

**Goal**: PI agent integrated as a pluggable harness with workspace-scoped tools.

**Changes**:
1. Create `src/back/boring_ui/api/agents/` — `AgentHarness` protocol, `PiHarness`, agent registry
2. `PiHarness` manages Node.js sidecar lifecycle (start, health, restart)
3. Proxy PI routes through FastAPI to localhost:8789
4. Add workspace-scoped tools to `src/pi_service/server.mjs` (7 tools calling backend HTTP API)
5. Agent registry reads `[agents]` from `boring.app.toml`
6. Capabilities endpoint reports available agents
7. Add `/__bui/config` agent list for frontend

**Effort**: 3-5 days. PI service already exists. The work is wiring tools + sidecar management.

### Phase 4: Frontend Updates

**Goal**: Add backend PI mode, remove companion, and align the frontend to app-level agent mode config.

**Changes**:
1. Add backend PI chat panel (WebSocket client to `/w/{id}/ws/agent/pi/sessions/{sid}/stream`)
2. Frontend reads `/__bui/config` for app-level agent mode
3. Remove companion adapter + panel (~40 files)
4. Remove CheerpX provider
5. Remove `DATA_BACKEND_OVERRIDE`

**Effort**: 3-5 days.

### Phase 5: Deployment + cleanup

**Goal**: Production deployment on Hetzner/OVH + cleanup after validation.

**Changes**:
1. Dockerfile with FastAPI + nsjail + Node.js + Python packages
2. Docker Compose with Caddy
3. `bui deploy` with `platform = "docker"` support
4. GitHub Actions CI/CD pipeline
5. Reassess whether any Go artifacts should be kept as reference or optional tooling
6. Port existing Go-specific tests to Python equivalents where needed
7. Run smoke tests against deployed instance

**Effort**: 3-5 days.

### Timeline

```
Week 1:  Phase 1 (workspace context) + Phase 2 (nsjail sandbox) — parallel
Week 2:  Phase 3 (PI harness + sidecar tools)
Week 3:  Phase 4 (frontend) + Phase 5 (deployment + cleanup)
```

Total: ~3 weeks. Faster than Go plan because the backend already works.

### Go/No-Go Gates

| Gate | When | Criteria | Fallback |
|---|---|---|---|
| **nsjail isolation** | End of Week 1 | Cannot read host `/etc/passwd` or sibling workspaces | ValidatedExecBackend for dev |
| **Pip persistence** | End of Week 1 | `pip install X` → `import X` works across commands | Pre-installed packages only |
| **PI round-trip** | End of Week 2 | User message → PI tool call → sandbox exec → response | Debug tool wiring |
| **Smoke tests pass** | End of Week 3 | Existing smoke test suite passes against new deployment | Fix issues |

---

## Part 8: Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **PI sidecar crashes** | Agent unavailable | Health check + auto-restart, persist to DB, `pi: false` in capabilities |
| **nsjail config** | Commands fail silently | Test each mount in CI. Start permissive. |
| **asyncio + subprocess** | Zombie processes, signal handling | Use `asyncio.create_subprocess_exec` with proper cleanup. Test kill-on-timeout. |
| **Workspace context migration** | Regressions in file/git ops | Keep backward-compatible fallback to `config.workspace_root`. Run existing tests. |
| **Companion removal** | Users lose Claude Code UI | Standard PI chat UI covers same use cases. Stream module stays for direct CLI bridge. |

---

## Part 9: Observability Requirements

This should be designed in from the start, not deferred to the end.

Required:

- request IDs on every HTTP and WebSocket flow (same header for both: `X-Request-ID`)
- WebSocket agent streams MUST carry the same request-ID for trace correlation
- structured logs for workspace resolution, harness lifecycle, and execution backend calls
- basic metrics for execution count, duration, timeout rate, and harness health
- a clear upgrade path to OpenTelemetry-style tracing if sidecar interactions become hard to debug

---

## Part 10: Current State Assessment

### What already exists and should be reused

- Python FastAPI app factory and router composition
- child-app loading through `app_config_loader.py`
- backend files and git services
- PTY sessions and lifecycle routes
- stream and agent-normal modules as current agent-runtime reference material
- control-plane auth, workspace, membership, and settings flows
- GitHub integration and workspace/user settings split
- frontend browser-mode agent path
- Python deployment template used by child apps
- substantial backend and frontend test coverage

### What is structurally wrong today

- one process-wide `workspace_root` still leaks through too many modules
- agent/runtime pieces are not yet cleanly harness-pluggable
- execution safety is not yet expressed as a first-class backend abstraction
- the current Claude stream path is transport-specific, not a reusable harness contract
- deployment paths and docs still reflect a mixed Python/Go transitional state

---

## Part 11: What's Different from the Go Plan

| Aspect | Go Plan | Python Plan |
|---|---|---|
| Backend | Go (70% done, not fully working) | **Python (100% working, deployed)** |
| Effort | Finish Go + add features (~4 weeks) | **Add features to working code (~3 weeks)** |
| Child app TOML loading | Needs new Go loader | **Already works** (`app_config_loader.py`) |
| Dynamic router import | Compiled registration (Go limitation) | **Dynamic import** (Python native) |
| Path safety | `openat2` + `RESOLVE_BENEATH` | **Preferred: `openat2` helper where available; fallback: existing `resolve()` + `is_relative_to()` checks** |
| Sandbox | nsjail via `os/exec` | **nsjail via `asyncio.create_subprocess_exec`** (same binary) |
| PI sidecar | Go manages Node.js child | **Python manages Node.js child** (same pattern) |
| Agent interface | Go `Agent` interface | **Python `AgentHarness` Protocol** |
| Claude Agent SDK | Future: TypeScript sidecar | **Future: native Python (`claude-agent-sdk`)** |
| Deployment binary | Single static binary | **Python + uvicorn** (Docker image) |
| Existing tests | Go tests (partial) | **Python tests (complete, passing)** |

**Key advantages of Python path**:
- Zero rewrite — enhance working code
- Child app compatibility is free (TOML loader exists)
- Dynamic router import (Python native, no compile step)
- Claude Agent SDK has official Python package (future native integration)
- All tests already exist and pass
- Python deployment path already exists today; Docker/VM backend-agent deployment is the new path to formalize

---

## Part 12: Exit Criteria

The work is done only when:

- the Python backend is still the canonical runtime
- backend agent mode works with a shared workspace tool gateway
- at least one real backend harness is production-ready
- the path to an Anthropic Claude harness via Python SDK is in place
- child apps still load through `boring.app.toml`
- tests are green
- smoke tests are green
- a real server deployment is validated
- docs are updated

---

## Part 13: Decisions and Non-Goals

### Decisions

- Python remains canonical backend
- Go becomes a reference implementation source, not the main path
- PI sidecar is the first backend harness
- Claude Agent SDK (Python) is the future Anthropic-specific harness, not the CLI bridge
- nsjail is the production execution path on Linux hosts
- Child-app compatibility preserved throughout
- Edge mode becomes legacy, not canonical
- Agent mode is app-level config (frontend or backend), not a runtime user toggle

### Non-Goals

- Full Node.js backend rewrite
- Immediate deletion of browser PI mode
- Immediate deletion of current Python Modal deployment paths
- Finishing the Go backend before shipping the Python agent features
- Forcing every child app into backend mode on day one
- Making the current Claude CLI stream bridge the permanent Claude harness

### Explicit Rejections

- Do not make Go the canonical runtime before the Python backend-agent path ships
- Do not use the current Claude CLI stream bridge as the permanent Claude harness architecture
- Do not depend on gVisor-style managed isolation as the primary security boundary
- Do not remove child-app router loading, settings providers, or deploy compatibility to simplify the plan
- Do not delete browser-local mode until backend mode is deployed and validated

---

## Appendix: Coverage Comparison vs Go Plan

Every item from the Go plan is covered:

| Go Plan Item | Python Plan Equivalent |
|---|---|
| Workspace resolver (`internal/workspace/`) | `workspace_context.py` + FastAPI dependency |
| Sandbox interface (`internal/sandbox/`) | `sandbox/backend.py` + `nsjail.py` + `validated_exec.py` |
| Presentation layer (`internal/agent/`) | `sandbox/presenter.py` |
| PI module (`internal/modules/pi/`) | `agents/pi_harness.py` |
| Agent registry (`internal/agents/`) | `agents/registry.py` |
| TOML config loader | **Already exists** (`app_config_loader.py`) |
| Path safety (`openat2`) | Add a Python helper where available; keep `config.validate_path()` as fallback |
| `/__bui/config` endpoint | Add to capabilities.py |
| Sandbox HTTP endpoint | Add FastAPI route |
| Custom CLI tools | Same (bring-your-own-binary, mount into nsjail) |
| Frontend PI chat panel | Same |
| Frontend companion removal | Same |
| Agent mode selector | Same |
| Docker Compose deployment | Same (different Dockerfile base) |
| Hetzner VPS + CI/CD | Same |
| Smoke tests | **Already exist** — port + extend |
