# Backend Architecture Plan: Hosting-Agnostic Backend with Isolated Agent Execution

## Status

Synthesized plan document. Consolidates research from four AI providers, validated by two rounds of external review (Gemini, OpenAI o3), a BoxLite PoC, and a subsequent pivot to nsjail after evaluating BoxLite's weight vs actual requirements.

**Input**: `docs/plans/backend-problem-statement.md` + `docs/plans/backend-problem-statement-research/`
**External review**: Gemini + o3 reviewed two rounds. Both approved the architecture direction.
**Key pivot**: BoxLite micro-VMs evaluated and rejected as too heavy. nsjail (per-command namespace isolation) with a stateful host filesystem delivers the same product outcomes at zero overhead.

---

## Executive Summary

The target is a single Go backend binary with one integrated PI agent, workspace-scoped filesystem operations, and isolated agent execution — deployable locally, in Docker, or on hosted infrastructure without code changes.

**Six key decisions:**

1. **Go is the canonical backend.** It has feature parity, 30+ recent commits, CI pipeline, Dockerfile, and is already the default in config. The Python backend is legacy and will be removed.
2. **Pluggable agent architecture with PI as default.** Agents are behind a Go `Agent` interface. PI agent (Node.js sidecar, 12+ LLM providers) is the default. Claude Code SDK (claude CLI) is an alternative for Anthropic-only deployments. Child apps can register custom agents. The existing stream module becomes the claude-code agent backend.
3. **First deployment: self-hosted VM (OVH or Hetzner) with Docker.** Full Linux kernel enables nsjail namespace isolation. Fly.io is a documented alternative.
4. **nsjail for per-command isolation with a stateful host filesystem.** Each agent command runs in an isolated Linux namespace (PID, mount, net). The workspace directory is bind-mounted read-write — files and installed packages persist across commands, sessions, and restarts. Python deps persist via a workspace-local `.pip-local` directory. Custom CLI tools mounted read-only from the host. Zero RAM overhead, zero boot time, full shell power inside the namespace. Command allowlist + rlimits as fallback for hosts without namespace support.
5. **Kernel-backed path safety.** Use `openat2` + `RESOLVE_BENEATH` where available (Linux 5.6+) for file operations, with `filepath.EvalSymlinks` + prefix check as fallback.
6. **One workspace, one source of truth.** Frontend file tree, backend files/git endpoints, and PI agent all operate on the same mounted filesystem via a per-request workspace resolver.

---

## Part 1: Target Architecture

### One Container, Two Processes

```
+------------------------------------------------------------------+
|                        One Container                              |
|                                                                   |
|  +------------------------------+  +--------------------------+  |
|  |       Go Backend (:8000)     |  |  Node.js PI Service      |  |
|  |                              |  |  (:8789)                  |  |
|  |  Layer 1: HTTP Surface       |  |                           |  |
|  |  - chi router, auth, CORS    |  |  pi-agent-core            |  |
|  |  - workspace boundary        |  |  - Agent loop             |  |
|  |  - PI route proxy ---------> |  |  - Tool execution         |  |
|  |                              |  |  - SSE streaming          |  |
|  |  Layer 2: Modules            |  |                           |  |
|  |  - files, git, github        |  |  pi-ai (12+ providers)    |  |
|  |  - controlplane, uistate     |  |  - Anthropic, OpenAI      |  |
|  |  - pty, sandbox endpoint     |  |  - Google, Bedrock, Azure |  |
|  |                              |  |  - Mistral, Groq, etc.    |  |
|  |  Layer 3: Workspace Resolver |  |                           |  |
|  |  - WORKSPACE_ROOT + ID       | <-  Tools call Go backend:   |  |
|  |                              |  |  - files/* git/*           |  |
|  |  Layer 4: Sandbox            | <-  - sandbox/exec           |  |
|  |  - nsjail (primary)          |  |                           |  |
|  |  - exec fallback             |  |  Session management       |  |
|  |  - presentation layer        |  |                           |  |
|  |                              |  |  - create, stream, stop   |  |
|  |  Layer 5: Infrastructure     |  |  - history persistence    |  |
|  |  - Storage, DB, Auth, PathFS |  |                           |  |
|  +------------------------------+  +--------------------------+  |
|                                                                   |
+------------------------------------------------------------------+
```

### Why Two Processes, Not One

The `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` packages already provide:

- Direct LLM API calls for 12+ providers (Anthropic, OpenAI, Google, Bedrock, Azure, Mistral, Groq, XAI, Cerebras, OpenRouter, HuggingFace)
- A complete agent tool execution loop with streaming
- Session management with SSE
- Custom base URLs for sovereign endpoints

Reimplementing this in Go would duplicate months of proven work. The sidecar pattern (Go handles workspace ops + isolation, Node.js handles LLM ops + agent loop) keeps each process doing what it's best at.

**Tradeoff**: Node.js runtime adds ~60MB to container image and ~1ms latency per localhost tool call. Both are acceptable.

### Why nsjail + Stateful Host Filesystem

The agent needs: isolated process execution + persistent workspace state + Python with packages. nsjail delivers all three with zero overhead.

**How it works**: Each agent command runs inside an ephemeral Linux namespace (isolated PID, mount, net). But the workspace directory lives on the HOST disk, bind-mounted read-write into every command. Files and packages persist because they're on disk, not in the sandbox.

```
HOST FILESYSTEM (permanent):                NSJAIL NAMESPACE (per-command, ephemeral):
/workspaces/abc/                            /workspace/          ← bind-mount (read-write)
  ├── src/main.py                           /usr/lib/python3/    ← bind-mount (read-only)
  ├── .pip-local/pandas/                    /usr/local/lib/python3/dist-packages/
  └── .boring/cli/                              ← bind-mount from .pip-local/ (read-write)
                                            /opt/boring/bin/     ← custom CLI (read-only)
/usr/lib/python3/ (Docker image)            /tmp                 ← tmpfs (ephemeral)
/opt/boring/bin/  (custom CLI tools)
```

**What's isolated** (ephemeral, per-command): process, PID namespace, mount namespace, network namespace.
**What's persistent** (on host disk): workspace files, installed Python packages, git history, agent-created data.

| Requirement | How nsjail delivers it |
|---|---|
| Isolated process | PID/mount/net namespace per command |
| Full shell power | `bash -c "..."` inside namespace — pipes, redirects, globs all work |
| Stateful filesystem | Workspace bind-mounted read-write from host disk |
| Python deps persist | `.pip-local/` dir mounted at Python's site-packages path |
| Custom CLI tools | `/opt/boring/bin/` mounted read-only |
| Pre-installed packages | System Python packages in Docker image, mounted read-only |
| Zero overhead | No VM, no daemon, no boot time. nsjail setup is ~1ms. |

### BoxLite Evaluated and Rejected

BoxLite (micro-VM per workspace) was evaluated via PoC: 7s cold boot, 21ms warm commands, ~500MB RAM per workspace. It provides stronger isolation (own kernel) and native statefulness, but the weight is disproportionate to the actual need. The product needs "run python in a sandbox with persistent files" — not a full VM per workspace.

nsjail gives the same product outcomes (isolated exec, persistent files, persistent packages, full shell) at zero overhead. The `Sandbox` interface is backend-agnostic, so BoxLite can be added later as a premium tier if VM-grade isolation becomes a requirement.

### Workspace Environment Strategy

Two layers of tool availability, both persistent:

**Layer 1 — Pre-installed in Docker image** (available to all workspaces, read-only):

```dockerfile
# deploy/go/Dockerfile (additions to Go backend image)
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv git curl jq tree ripgrep nsjail

# Pre-install common Python libraries into system site-packages
RUN pip3 install \
    pandas numpy scipy scikit-learn matplotlib seaborn \
    requests httpx beautifulsoup4 lxml \
    pytest black ruff mypy \
    pydantic fastapi sqlalchemy

# Custom workspace CLI tools
COPY deploy/workspace-cli/ /opt/boring/bin/
```

nsjail mounts `/usr/lib/python3/` read-only into every command. Agent can `import pandas` immediately.

**Layer 2 — Agent runtime installs** (per-workspace, read-write, persistent):

```
Agent: exec("pip install transformers")
→ nsjail mounts /workspaces/abc/.pip-local at site-packages (read-write)
→ pip writes to .pip-local on host disk
→ nsjail exits, process gone, package stays

Next command or next session:
Agent: exec("python3 -c 'import transformers; print(transformers.__version__)'")
→ same mount → finds transformers → works
```

Per-workspace `.pip-local/` overrides system packages (earlier in Python path). Each workspace has independent package state.

### Child App CLI (Bring Your Own Binary)

Each child app **ships its own CLI binary** (Rust, Go, Python — whatever the app prefers). The framework doesn't scaffold or wrap it. The binary IS the source of truth for commands — no need to duplicate them in config.

**Config is minimal** — just the binary name:

```toml
# boring-macro/boring.app.toml
[cli]
name = "bm"       # the binary name — that's all the framework needs
```

The binary owns its own commands, help text, and argument parsing. The agent discovers commands by running `bm help` (or `bm --help`). No TOML command declarations needed — the binary is the source of truth.

**Existing pattern** (boring-macro already does this):
- Rust binary (`bm`) compiled from `src/main.rs` with clap subcommands
- `src/cli/sql.rs`, `src/cli/transform.rs`, etc.
- Each command returns structured JSON
- `bm help` shows all available commands

**How the framework integrates it**:

1. Child app builds its own CLI binary (Rust/Go/Python — app's choice)
2. `boring.app.toml` declares `[cli].name` — the binary name
3. Binary installed in Docker image on PATH
4. nsjail mounts it so the agent can call it
5. Agent discovers commands via `exec("bm help")` — no config indirection
6. `bui run <args>` outside sandbox delegates to `{cli.name} <args>` (developer entry point)

```
Agent: exec("bm help")           → child app's own help (clap/cobra/argparse)
Agent: exec("bm sql 'SELECT 1'") → child app handles, returns JSON
Agent: exec("bm ingest")         → child app handles
```

**Framework provides standard tools separately** (pre-installed in Docker image):
- `rg` (ripgrep), `python3`, `git`, `curl`, `jq`, `tree` — standard Unix tools

The child app owns its CLI entirely. The framework just needs `[cli].name` to know what binary to put on PATH and what `bui run` delegates to.

### Module Map

| Module | Status | Changes Needed |
|---|---|---|
| `files` | Working | Per-request workspace root from context |
| `git` | Working | Per-request workspace root from context |
| `controlplane` | Working | Add `ResolveWorkspaceRoot(workspaceID)` |
| `github` | Working | None |
| `uistate` | Working | None |
| `pty` | Working | Keep for direct terminal access |
| `plugins` | Working | None |
| `agents` | **New** | Agent interface + registry. PI backend (sidecar proxy), Claude Code backend (stream module refactored), custom agent support |
| `sandbox` | **New** | HTTP endpoint for agent tool calls (`POST /api/v1/sandbox/exec`) |
| `stream` | Refactor | Becomes `claude-code` agent backend behind Agent interface |

### API Contract

Same regardless of hosting environment:

```
# Public routes
GET  /api/capabilities

# Auth
POST /auth/login
GET  /auth/callback
POST /auth/token-exchange

# Control plane
GET  /api/v1/me
GET  /api/v1/workspaces
POST /api/v1/workspaces

# Workspace-scoped routes (all under /w/{workspaceID})
GET  /w/{id}/api/v1/files/list
GET  /w/{id}/api/v1/files/read
POST /w/{id}/api/v1/files/write
POST /w/{id}/api/v1/files/delete
GET  /w/{id}/api/v1/git/status
GET  /w/{id}/api/v1/git/diff
POST /w/{id}/api/v1/git/commit
POST /w/{id}/api/v1/agent/pi/sessions
GET  /w/{id}/api/v1/agent/pi/sessions/{sid}/history
WS   /w/{id}/ws/agent/pi/sessions/{sid}/stream
POST /w/{id}/api/v1/agent/pi/sessions/{sid}/stop
POST /w/{id}/api/v1/sandbox/exec    (internal — PI tools only)
GET  /w/{id}/api/v1/ui/state/latest
PUT  /w/{id}/api/v1/ui/state
```

In CLI single-workspace mode, the `/w/{id}` prefix is optional.

### What Does NOT Change Across Environments

- The Go binary
- The API contract
- The frontend build
- The workspace filesystem model (`WORKSPACE_ROOT/{workspace_id}`)
- The module system
- The capability negotiation protocol

### What Changes Per Environment

| Aspect | CLI | VM (Docker) | Managed (Fly.io) | K8s |
|---|---|---|---|---|
| `WORKSPACE_ROOT` | `~/project` | `/data/workspaces` | `/workspaces` | PVC mount |
| `SANDBOX_BACKEND` | `exec` | `nsjail` | `nsjail` or `exec` | `nsjail` |
| Database | JSON fallback | Postgres | Neon | Postgres |
| Auth | None / local | JWKS | JWKS (Neon) | JWKS |
| LLM access | Direct API | Direct API | Direct API | Regional endpoint |
| Path safety | EvalSymlinks | openat2 | EvalSymlinks | openat2 |

---

## Part 2: Backend Abstractions

Three abstractions are required. Three are explicitly NOT required.

### Abstraction 1: Workspace Resolver

**The problem**: `workspaceRoot()` appears 7 times across the codebase, always resolving a single root at startup. The `/w/{workspaceID}/*` boundary handler sets `X-Workspace-ID` but no module reads it.

**The solution**:

```go
// internal/workspace/resolver.go

type Resolver interface {
    Resolve(ctx context.Context, workspaceID string) (string, error)
}

// CLI mode: always returns the same path
type SingleResolver struct { Root string }

// Hosted mode: maps workspace ID to a subdirectory
type MultiResolver struct { BaseRoot string }
```

**Integration**: Middleware resolves workspace root from `X-Workspace-ID` header, injects into request context. Modules read root from context with fallback to `s.root`.

**Workspace provisioning**: Start with `mkdir /workspaces/{workspace_id}` (empty directory). Add template/clone features later.

### Abstraction 2: Sandbox Interface (nsjail-Primary)

Per-command namespace isolation with a persistent host filesystem. Each `exec` call wraps the command in nsjail. The workspace directory is bind-mounted read-write — files and packages persist because they're on the host disk, not inside the sandbox.

```go
// internal/sandbox/sandbox.go

type Sandbox interface {
    // Exec runs a command in the workspace sandbox.
    Exec(ctx context.Context, req ExecRequest) (*ExecResult, error)
    // Available returns true if this sandbox backend is usable on this host.
    Available() bool
    // Name returns the backend name for logging/capabilities.
    Name() string
}

type ExecRequest struct {
    WorkspaceRoot string            // absolute path on host, e.g. /workspaces/abc
    Command       string            // full shell command, e.g. "grep -r TODO src/ | wc -l"
    Args          []string          // optional: explicit argv (overrides Command)
    Env           []string          // extra env vars (KEY=VALUE)
    Stdin         io.Reader
    TimeoutSec    int               // kill after N seconds (0 = default 60)
    WorkingDir    string            // relative to workspace root (default: ".")
}

type ExecResult struct {
    ExitCode    int
    Stdout      string
    Stderr      string
    DurationMs  int64
    Truncated   bool
    KilledByOOM bool
}
```

**Backend selection** (config-driven via `SANDBOX_BACKEND` env var):

| Backend | When to Use | Isolation Level | Shell Power |
|---|---|---|---|
| `nsjail` | **Production default**. Any Linux host with namespace support. | PID/mount/net namespace + seccomp + rlimits | Full bash inside namespace |
| `exec` | CLI mode, dev, tests, managed runtimes without namespace support | Command allowlist + rlimits | Allowlisted commands only |
| `auto` | Default | Tries nsjail > exec | Best available |

**nsjail per-command model**:

```
Agent: exec("pip install transformers && python3 -c 'import transformers'")

Go backend:
  1. Resolves workspace root: /workspaces/abc
  2. Builds nsjail invocation:
     nsjail --mode once \
       --chroot / \
       --bindmount /workspaces/abc:/workspace \
       --bindmount /workspaces/abc/.pip-local:/usr/local/lib/python3/dist-packages \
       --bindmount_ro /usr/lib/python3:/usr/lib/python3 \
       --bindmount_ro /usr/bin:/usr/bin \
       --bindmount_ro /opt/boring/bin:/opt/boring/bin \
       --cwd /workspace \
       --time_limit 60 \
       --rlimit_as 2048 \
       --rlimit_nproc 64 \
       --disable_clone_newnet \
       -- bash -c "pip install transformers && python3 -c 'import transformers'"
  3. Captures stdout/stderr/exit code
  4. Returns ExecResult
```

**nsjail mount configuration**:

| Mount | Source (host) | Target (inside nsjail) | Mode | Purpose |
|---|---|---|---|---|
| Workspace files | `/workspaces/{id}/` | `/workspace` | read-write | User files, git repo |
| Workspace pip packages | `/workspaces/{id}/.pip-local/` | `/usr/local/lib/python3/dist-packages` | read-write | Per-workspace Python deps (persistent) |
| System Python | `/usr/lib/python3/` | `/usr/lib/python3/` | read-only | Pre-installed packages from Docker image |
| System binaries | `/usr/bin/`, `/usr/lib/`, `/lib/` | same | read-only | python3, git, grep, etc. |
| Custom CLI tools | `/opt/boring/bin/` | `/opt/boring/bin/` | read-only | Workspace-aware `boring` commands |
| Temp | tmpfs | `/tmp` | read-write | Ephemeral scratch space |

**What persists between commands** (on host disk): workspace files, `.pip-local/` packages, `.git/` history, any file the agent creates under `/workspace`.
**What is ephemeral** (gone after each command): processes, PID namespace, mount namespace, network namespace, `/tmp`.

**Fallback for hosts without namespace support** (gVisor-based managed runtimes, macOS dev):
The `exec` backend runs commands via `os/exec` with a command allowlist + rlimits. **This is dev/trusted-only — no real isolation.** The agent interface (same `Exec` call) doesn't change — only the isolation strength.

### Abstraction 3: Agent Registry + Shared Tool Endpoints

**Agent registry** — Go backend manages agent harnesses via config:

```go
// internal/agents/registry.go

type Registry struct {
    agents map[string]Agent   // "pi", "claude-code", "custom"
    tools  *ToolEndpoints     // shared workspace tools
}
```

**Shared workspace tool endpoints** — defined once, called by all agent harnesses:

| Tool | Backend Endpoint | Used By |
|---|---|---|
| `read_file(path)` | `GET /w/{id}/api/v1/files/read?path=...` | All agents |
| `write_file(path, content)` | `POST /w/{id}/api/v1/files/write` | All agents |
| `list_dir(path)` | `GET /w/{id}/api/v1/files/list?path=...` | All agents |
| `exec(command)` | `POST /w/{id}/api/v1/sandbox/exec` | All agents |
| `git_status()` | `GET /w/{id}/api/v1/git/status` | All agents |
| `git_diff(path)` | `GET /w/{id}/api/v1/git/diff?path=...` | All agents |
| `git_commit(msg)` | `POST /w/{id}/api/v1/git/commit` | All agents |

All tools go through the Go backend's HTTP API — path validation, workspace boundary enforcement, nsjail isolation, and audit logging happen in one code path regardless of which agent harness calls them.

**PI agent harness** (`src/pi_service/server.mjs`): Currently `tools: []`. Wire the shared tool endpoints above. Node.js sidecar handles LLM loop, streaming, session management.

**Claude Code SDK harness** (existing `internal/modules/stream/`): Refactor to use the Agent interface. claude CLI subprocess already works; just needs to call shared tool endpoints for workspace ops instead of having unrestricted host access.

### Abstractions NOT Required

1. **Go LLM provider interface** — Each agent harness handles its own LLM integration. Go backend only provides tools, not LLM calls.
2. **Storage interface** — The filesystem contract is `os.*` calls. No abstraction beyond that.
3. **Database interface** — Standard `*pgx.Pool` with connection string. Already supports Postgres and local JSON.

---

## Part 3: Agent Interface Design

### The Virtual Shell

The agent sees a shell-like workspace, not the host machine. Three tools:

**Tool 1: `exec`** — Run a command in the workspace.
- With nsjail (production): full bash shell — pipes, redirects, globs, subshells, python, git, anything in the Docker image or workspace `.pip-local/`. Namespace boundary provides isolation.
- With exec fallback (dev/CLI): allowlisted commands only (ls, cat, grep, find, sed, python3, git, etc.).

**Tool 2: `read_file`** — Read file contents with optional offset/limit. Cheaper than `cat | head | tail` for large files. Goes through Go backend path validation for audit.

**Tool 3: `write_file`** — Write content to a file. Validates path, creates directories. Logged separately for audit and frontend cache invalidation.

### Two-Layer Execution Model

**Layer 1 — Execution semantics** (sandbox): Runs commands, enforces workspace boundary, applies resource limits, captures stdout/stderr/exit code.

**Layer 2 — Presentation to agent** (presenter): Transforms raw output into agent-optimized text.

| Output size | Behavior |
|---|---|
| < 200 lines | Return as-is with metadata footer |
| 200-10,000 lines | Truncate at 200 lines, suggest `grep/head/tail` to narrow |
| > 10,000 lines | Truncate at 200 lines, flag as too large |
| Binary content | Replace with `[binary output, N bytes]` |
| Timeout | Return partial output + `[killed: exceeded Ns timeout]` |

Metadata footer on every response:
```
---
exit_code: 0
duration: 45ms
working_dir: src/
```

### Command Allowlist (for `exec` fallback backend only)

Only applies when nsjail is unavailable (CLI mode, dev, managed runtimes without namespace support).

**Allowed**:
```
cat, cp, diff, echo, env, false, file, find, grep, head, ls, mkdir, mv,
python3, rm, sed, sort, tail, tree, true, wc, which, xxd,
git (all subcommands)
```

**Excluded**:
```
curl, wget (network), apt/yum (packages), vim/nano (interactive),
ssh/scp (remote), kill/pkill (process management), dd (raw device)
```

In nsjail mode, there is no allowlist — the agent has full shell access inside the namespace. `pip3 install`, `curl`, and any other command work naturally because the namespace boundary is the isolation, not command filtering. Network access controlled via nsjail config (enabled for pip, restrictable per-policy).

### Discovery and Error Feedback

In nsjail mode, the agent uses standard shell discovery (`--help`, `which`, `man`).

In exec fallback mode:
```
Agent: exec("help")
-> "Available commands: cat, cp, diff, ..."

Agent: exec("vim main.go")
-> "error: 'vim' is not available. To read: use read_file or 'cat main.go'.
   To edit: use write_file. exit_code: 127"
```

---

## Part 4: Path Safety

This is a security-critical area identified across all research inputs.

### Defense in Depth

1. **Kernel-backed (strongest)**: Use Go's `openat2` syscall with `RESOLVE_BENEATH` flag (Linux 5.6+). This makes the kernel enforce "resolve beneath this directory fd", rejecting absolute symlinks, `..` traversal, and any path that escapes the workspace root. The Go standard library discussions explicitly endorse this as the correct mechanism.

2. **Userspace fallback**: `filepath.EvalSymlinks` + `strings.HasPrefix(resolved, baseRoot)`. This is what the current codebase does. It has known TOCTOU race conditions but is adequate for environments where `openat2` is unavailable.

3. **Sandbox reinforcement**: In nsjail mode, the workspace is the only writable mount. The agent's exec commands cannot see sibling workspaces, host paths outside the bind-mounts, or other processes. Even if a `openat2` check were bypassed in the Go backend's file API, the namespace boundary prevents exec from reaching outside the workspace.

### Implementation

```go
// internal/workspace/pathfs.go

// SafeOpen opens a file relative to the workspace root using the
// strongest available mechanism.
func SafeOpen(rootFD int, relpath string, flags int) (*os.File, error) {
    if openat2Available() {
        return openat2(rootFD, relpath, flags, RESOLVE_BENEATH)
    }
    return evalSymlinksOpen(rootFD, relpath, flags)
}
```

Files/git modules and the sandbox exec endpoint must all use this abstraction. Client-provided paths are never trusted as absolute.

---

## Part 5: Hosting Strategy

### Recommended First Deployment: Self-Hosted VM with Docker

**Target**: Single OVH or Hetzner VPS running Docker Compose.

```
Server (Ubuntu 24.04)
+-- Docker Compose
|   +-- boring-ui (Go binary + Node.js PI service + nsjail)
|   |   +-- WORKSPACE_ROOT=/data/workspaces (block volume)
|   |   +-- SANDBOX_BACKEND=nsjail
|   |   +-- DATABASE_URL=postgres://neon/...
|   +-- Caddy (TLS termination, reverse proxy)
+-- nsjail (installed in container image)
+-- /data/workspaces/ (ext4 on attached block volume)
```

**Why VM first**:
- Full Linux kernel = nsjail namespace isolation works
- Zero overhead: no VM per workspace, no daemon, no boot time
- Block volume for persistent workspace storage
- Workspace files + pip packages persist on host disk
- Caddy auto-TLS = zero cert management
- Neon for database = no local Postgres to maintain
- Cost: ~EUR 10-30/month for a capable VPS
- Direct sovereignty path (EU providers, any region)

**Provider recommendation**:
- **Hetzner Cloud** if optimizing for fastest/cheapest MVP
- **OVH** if EU sovereignty positioning matters now

### Deployment Path Comparison

| Path | Time to Deploy | Isolation | Sovereignty | Cost (10 ws) | Cost (100 ws) |
|---|---|---|---|---|---|
| **A: VM + Docker** (recommended) | 1-2 days | Full (nsjail namespaces) | Full control | EUR 15-30/mo | EUR 50-150/mo |
| **B: Fly.io microVMs** | Hours | Full (nsjail inside Firecracker) | US vendor | $30-50/mo | $200-500/mo |
| **C: Cloud Run gen2** | Hours | Full (microVM, namespaces supported) | GCP regions | $20-40/mo | $100-300/mo |
| **D: Modal/Cloud Run gen1** | Hours | Partial (exec only, gVisor blocks namespaces) | US vendor | $30-50/mo | $200-500/mo |
| **E: Kubernetes** | Days-weeks | Full (nsjail in pods, if PSP allows) | Depends on provider | EUR 50-100/mo | EUR 100-300/mo |

**Key requirement**: nsjail needs Linux namespace support (available on any standard Linux kernel). gVisor-based environments (Modal, Cloud Run gen1) block namespace creation and fall back to the `exec` allowlist backend.

### Sovereign Migration Path

```
Phase 1 (now):     VM on OVH/Hetzner (EU)  + Neon (managed Postgres)
Phase 2 (growth):  OVH Managed K8s         + Neon (managed Postgres)
Phase 3 (scale):   OVH/Scaleway K8s        + Self-hosted Postgres
Phase 4 (comply):  SecNumCloud K8s          + SecNumCloud Postgres
```

What changes between phases: `WORKSPACE_ROOT` mount source, `DATABASE_URL`, `JWKS_URL`, `SANDBOX_BACKEND`, LLM endpoint URL.

What stays identical: the Go binary, the API contract, the frontend, the workspace model.

### LLM Endpoint Strategy

Already solved. `pi-ai` supports custom base URLs for all 12+ providers.

| Phase | Provider | Endpoint Config |
|---|---|---|
| Now | Anthropic (US) | `ANTHROPIC_BASE_URL=https://api.anthropic.com` |
| EU compliance | Anthropic (EU, when available) | `ANTHROPIC_BASE_URL=https://eu.api.anthropic.com` |
| Sovereign | Mistral, self-hosted | `OPENAI_BASE_URL=https://llm.internal.example.com/v1` |
| Air-gapped | vLLM, Ollama | `OPENAI_BASE_URL=http://llm-gateway.local:8080` |

Provider gateway (LiteLLM or similar) is an option for the controlled hosting phase when multiple model providers need unified access.

---

## Part 6: Child App Compatibility and Pluggable Agents

### The Problem

boring-ui is a **consumable framework** (see `docs/exec-plan/BUI-FRAMEWORK.md`). Child apps like boring-macro extend it via `boring.app.toml` — they register custom backend routers, frontend panels, CLI commands, and deploy config. The architecture plan must preserve this extensibility.

Additionally, the current plan hardcodes PI agent as the only agent surface. But the framework should support pluggable agent systems — PI agent, Claude Code SDK, or custom agents provided by child apps.

### Child App Extensibility Checklist

| BUI Framework Feature | Current Plan Status | What Must Be Preserved |
|---|---|---|
| `[backend].routers` — child app registers custom routes | **BROKEN** — Python `app_config_loader.py` deleted in Phase 6 | Go backend needs TOML-driven router registration |
| `[frontend.panels]` — child app registers custom panels | **AT RISK** — Phase 5 simplifies frontend | PaneRegistry + TOML panel loading must survive |
| `[cli]` — child app CLI binary | **SIMPLIFIED** — `[cli].name` is the binary name, `bui run` delegates to it | Binary is source of truth for commands. No `[cli.commands]` duplication needed. |
| `boring.app.toml` config contract | **IGNORED** — plan uses env vars only | Go backend must read `boring.app.toml` for child app config |
| `bui deploy` | **REPLACED** — plan uses Docker Compose directly | Add `platform = "docker"` to `bui deploy` |
| `bui dev` | **UNAFFECTED** — still works | Ensure Go backend mode works with `bui dev` |

### Go-Side Child App Router Registration

The Python backend used `app_config_loader.py` to dynamically import routers from TOML paths. The Go backend needs an equivalent:

```toml
# Child app boring.app.toml
[backend]
type = "go"
routers = [
    "boring_macro/routers/macro",      # Go package path
    "boring_macro/routers/transform",   # mounted at /api/x/<name>
]
```

**Implementation**: The Go backend reads `boring.app.toml` at startup, uses Go's plugin system or a registration pattern where child app routers are compiled into the binary. For the MVP, child app Go routers are compiled as part of the child app binary (not dynamically loaded):

```go
// Child app main.go
func main() {
    app := boring.NewApp()           // reads boring.app.toml
    app.RegisterRouter("/api/x/macro", macroRouter)
    app.RegisterRouter("/api/x/transform", transformRouter)
    app.Run()                        // starts Go backend with framework + child routes
}
```

This is the same pattern as the existing Go child app example (`examples/child-app-go/`), extended to support workspace-scoped routes.

### Pluggable Agent Architecture

The plan currently hardcodes PI agent as the only agent. This should be generalized to support multiple agent backends:

```toml
# boring.app.toml
[agents]
default = "pi"

[agents.pi]
enabled = true
port = 8789
# PI agent sidecar — 12+ LLM providers, tool execution loop

[agents.claude-code]
enabled = false
binary = "claude"
# Claude Code SDK — Anthropic's agent, uses claude CLI

[agents.custom]
enabled = false
entry = "boring_macro.agents.custom"
# Child app provides its own agent implementation
```

**Agent interface in Go**:

```go
// internal/agents/agent.go

type Agent interface {
    // Name returns the agent identifier (pi, claude-code, custom).
    Name() string
    // Start launches the agent process/sidecar.
    Start(ctx context.Context) error
    // Stop shuts down the agent.
    Stop(ctx context.Context) error
    // Healthy returns whether the agent is ready to serve.
    Healthy() bool
    // Routes returns the HTTP routes this agent needs proxied.
    Routes() []Route
}
```

**Key insight: tools are shared, only the harness differs.**

The workspace tools (read_file, write_file, exec, git_status, etc.) are defined once in the Go backend. Every agent harness calls the same tool endpoints. The difference is only in the LLM-facing layer — how the model is called, how the tool loop works, how streaming happens.

```
                        ┌──────────────────────┐
                        │   Agent Harness       │
                        │   (swappable)         │
                        │                       │
                        │  ┌─────────────────┐  │
                        │  │ PI agent        │  │  ← LLM loop, streaming, session mgmt
                        │  │ Claude Code SDK │  │  ← different LLM loop, same tools
                        │  │ Custom agent    │  │  ← child app provides harness
                        │  └────────┬────────┘  │
                        └───────────┼───────────┘
                                    │ calls same tool endpoints
                        ┌───────────┼───────────┐
                        │   Shared Tools        │
                        │   (Go backend HTTP)   │
                        │                       │
                        │  POST /sandbox/exec   │  ← nsjail-isolated shell
                        │  GET  /files/read     │  ← workspace filesystem
                        │  POST /files/write    │
                        │  GET  /git/status     │
                        │  POST /git/commit     │
                        └───────────────────────┘
```

**Supported agent harnesses**:

| Harness | How It Works | LLM Providers | Tools |
|---|---|---|---|
| **PI agent** (default) | Node.js sidecar, pi-agent-core + pi-ai | 12+ (Anthropic, OpenAI, Google, Mistral, etc.) | Shared workspace tools via Go backend HTTP API |
| **Claude Code SDK** | claude CLI subprocess, stream-json I/O | Anthropic only | Same shared workspace tools |
| **Custom** | Child app provides harness binary/service | App-defined | Same shared workspace tools + app-defined extras |

All harnesses call the same Go backend endpoints for workspace operations. The sandbox, presentation layer, and path safety apply uniformly regardless of which harness is active.

**Why this matters**:
- Tools are defined once, tested once, secured once
- New agent harness = new LLM integration only, zero tool reimplementation
- PI agent is the default — best multi-provider support
- Claude Code SDK is a natural fit for Anthropic-only deployments (existing stream module refactored)
- Child apps can bring their own harness for domain-specific use cases
- Capabilities endpoint reports which agents are available: `agents: ["pi", "claude-code"]`
- Frontend shows agent selector when multiple are enabled

**Migration**: The existing `stream` module (claude CLI bridge) becomes the `claude-code` agent harness. PI module becomes the `pi` agent harness. Both behind the `Agent` interface, both calling the same shared tool endpoints.

### `bui deploy` Docker Platform Support

Add `platform = "docker"` to complement existing `platform = "modal"`:

```toml
[deploy]
platform = "docker"                    # "modal" | "docker"

[deploy.docker]
registry = "ghcr.io/hachej"
compose_file = "deploy/docker-compose.prod.yml"
host = "boring-ui.example.com"
ssh_key_vault = "secret/agent/hetzner-ssh"
```

`bui deploy` with docker platform: builds image → pushes to registry → SSH to host → pulls + restarts via Docker Compose. Same hermetic build principle.

---

## Part 7: Frontend Simplifications

### Two Agent Modes (Frontend + Backend)

Child apps choose their agent mode via `boring.app.toml`:

```toml
[agents]
mode = "frontend"     # PI runs in browser, user's API key, LightningFS
mode = "backend"      # PI runs server-side, nsjail sandbox, backend API keys
mode = "both"         # user picks at runtime (default for boring-ui itself)
```

| Aspect | Frontend Mode (existing) | Backend Mode (new) |
|---|---|---|
| PI agent runs in | Browser (pi-agent-core) | Server (Node.js sidecar) |
| API keys | User provides (providerKeys.js) | Backend config (env vars) |
| Filesystem | LightningFS (browser-local) | Host disk via Go backend API |
| Python exec | Pyodide (WASM, browser) | nsjail (real Python, sandbox) |
| Git | isomorphic-git (browser) | Go git module (subprocess) |
| Isolation | Browser sandbox (natural) | nsjail namespace isolation |
| Works offline | Yes | No (needs backend) |
| Tools | defaultTools.js (client-side) | Shared tool endpoints (server-side) |

Both modes use the same PI chat UI. The difference is the tool backend and where the LLM call happens.

### What Must Be Removed

| Component | Reason |
|---|---|
| Companion adapter + panel | Legacy Claude CLI bridge — replaced by claude-code agent harness |
| CheerpX data provider | Experimental, not part of either standard mode |
| `DATA_BACKEND_OVERRIDE` URL param | Cleanup — mode selection via boring.app.toml instead |

### What Must Be Added

- **Backend PI chat panel**: WebSocket client to `/w/{id}/ws/agent/pi/sessions/{sid}/stream` for backend mode. Reuses existing chat UI components.
- **Agent mode selector**: UI shows mode switch when `mode = "both"`. Auto-selects when `mode = "frontend"` or `mode = "backend"`.
- **`/__bui/config` integration**: Frontend reads agent mode from config at boot.

### What Stays (Frontend Mode)

These are required for frontend (browser) mode and must NOT be removed:

- `@mariozechner/pi-agent-core` — PI agent logic (client-side)
- `@mariozechner/pi-web-ui` — PI UI components
- `@isomorphic-git/lightning-fs` — Browser filesystem
- `isomorphic-git` — Git in browser
- Pyodide provider — Python in browser
- `defaultTools.js` — Client-side tools
- `providerKeys.js` — User API key management
- PI native adapter (`nativeAdapter.jsx`) — Browser PI harness

### What Stays (Both Modes)

- DockView layout system
- Capability gating (`CapabilityGate`, `useCapabilities()`)
- FileTree, EditorPanel, GitChangesView
- React Query data layer
- Auth flow (session cookie, login/callback)
- UI state persistence
- Route definitions
- HTTP data provider (used by backend mode)

### Filesystem Event Consistency

When the PI agent modifies files, the frontend must update. Three options considered:

| Approach | Complexity | Recommendation |
|---|---|---|
| Poll `/api/v1/files/list` | Low | No — wasteful |
| Backend pushes WebSocket events on file change | Medium | Later |
| **Agent tool results include changed paths, frontend invalidates React Query cache** | **Low** | **First** |

The `write_file` tool result includes the written path. The PI stream sends tool results to the frontend. The frontend invalidates React Query cache for affected paths. This is the simplest correct approach.

---

## Part 7: Migration Phases

### Phase 1: Workspace Root Refactor

**Goal**: All modules resolve workspace root per-request via context.

**Changes**:
1. Create `internal/workspace/` package — `Resolver` interface, `SingleResolver`, `MultiResolver`, context helpers
2. Add workspace root middleware to `internal/app/`
3. Update all module handlers to read root from context with fallback to `s.root`
4. Remove 7 duplicate `workspaceRoot()` functions
5. Add path safety abstraction (`openat2` where available, `EvalSymlinks` fallback)

**Tests**: All existing module tests must pass. Add multi-workspace resolution tests and concurrent request tests.

**Risk**: Low. Mechanical refactor, no behavior change in single-workspace mode.

**Effort**: 2-3 days.

### Phase 2: Sandbox Interface — nsjail Integration (parallel with Phase 1)

**Goal**: Per-command namespace isolation with persistent workspace filesystem behind a stable `Sandbox` interface.

**Changes**:
1. Create `internal/sandbox/` package — `Sandbox` interface with `Exec`, `Available`, `Name`
2. Implement `NsjailBackend` — builds nsjail invocation with workspace bind-mounts
3. Implement `ExecBackend` — fallback for CLI mode / environments without namespace support
4. Add sandbox config to `internal/config/` — `SANDBOX_BACKEND` env var, nsjail-specific settings
5. Add nsjail to Go Docker image (`deploy/go/Dockerfile`)
6. Add `POST /api/v1/sandbox/exec` endpoint (internal, authenticated by workspace-scoped token)
7. Add Python packages + custom CLI tools to Docker image
8. Create workspace `.pip-local/` directory on workspace provisioning

**nsjail config**:
- Workspace bind-mounted read-write at `/workspace`
- `.pip-local/` mounted at Python site-packages (read-write, persistent)
- `/usr`, `/lib`, `/bin` mounted read-only (system tools from Docker image)
- `/opt/boring/bin/` mounted read-only (custom CLI tools)
- tmpfs for `/tmp`
- PID/mount/net namespace isolation
- Network: enabled by default (for pip install), restrictable per-policy
- rlimits: CPU, memory, processes, file size

**Tests**: Unit tests with mock sandbox. Integration tests with nsjail on Linux. Exec fallback tests on all platforms. Isolation test: verify process inside nsjail cannot access sibling workspaces or host paths.

**Risk**: Low. nsjail is mature (Google-production proven, years old, active maintenance). The main work is getting the mount configuration right for the pip persistence model.

**Effort**: 3-5 days.

### Phase 3: Presentation Layer

**Goal**: Transform raw sandbox output into agent-optimized text.

**Changes**:
1. Create `internal/agent/` package — output formatting, truncation, binary detection, metadata enrichment, error hints, discovery responses
2. Command allowlist for exec backend
3. Wire into sandbox: `presenter.Format(sandboxResult) -> agentText`

**Risk**: Low. Pure formatting logic, no external dependencies.

**Effort**: 2-3 days.

### Phase 4: PI Module (Sidecar Integration)

**Goal**: Backend PI agent with workspace-scoped sessions, tool execution via sandbox, streaming via WebSocket.

**In Go backend** (`internal/modules/pi/`):
1. `module.go` — Module registration, route setup
2. `proxy.go` — Reverse proxy to PI service (`localhost:8789`)
3. `sidecar.go` — PI service process lifecycle (start, health check, restart with backoff)
4. Update capabilities endpoint — add `pi` feature flag

**In PI service** (`src/pi_service/server.mjs`):
1. Add workspace-scoped tools — `read_file`, `write_file`, `list_dir`, `exec`, `git_status`, `git_diff`, `git_commit`
2. Tools call Go backend HTTP API (`localhost:8000`) for all workspace operations
3. Accept workspace context headers per session (workspace ID, internal auth token)
4. System prompt with workspace context and tool documentation

**Sidecar reliability**:
- Go monitors PI service health (`/health` check every 5s)
- Auto-restart with exponential backoff if health check fails
- Report `pi: false` in capabilities if PI service is down
- `--max-old-space-size` limit to prevent OOM
- Hard limits: max sessions, max turns per session, max tool calls per turn
- Persist conversation state to database for crash recovery

**Risk**: Medium. The PI agent loop and LLM integration already work. The new work is wiring tools and managing sidecar lifecycle.

**Effort**: 3-5 days.

### Phase 5: Frontend Simplification

**Goal**: Frontend talks only to Go backend PI. Remove browser-local and legacy paths.

**Changes**:
1. Add new PI chat panel with WebSocket client
2. Remove PI native adapter, companion adapter, browser-local data providers
3. Remove `@isomorphic-git`, `@isomorphic-git/lightning-fs`, `@mariozechner/pi-agent-core` (frontend), `@mariozechner/pi-web-ui` dependencies
4. Simplify mode detection (remove `DATA_BACKEND_OVERRIDE`, `pi_mode` distinction)
5. Update pane registry (remove companion, add pi-chat)
6. Wire filesystem event consistency (tool results -> React Query invalidation)

**Risk**: Medium. Removes "works without a backend" demo mode. This is an intentional product decision.

**Effort**: 3-5 days.

### Phase 6: Legacy Removal

**Goal**: Remove Python backend and legacy deployment paths.

**Changes**:
1. Delete `src/back/` (Python backend)
2. Delete Python deployment configs (Modal Python app, sprite deployment)
3. Delete `pyproject.toml`, Python test infrastructure
4. Update CI to remove Python backend jobs
5. Clean up `vendor/boring-sandbox/` if no longer needed

**Risk**: Low, if Phases 1-5 complete.

**Effort**: 1-2 days.

### Timeline

```
Week 1:      Phase 1 (workspace root) + Phase 2 (nsjail sandbox + pip persistence)
Week 2:      Phase 3 (presentation) + Phase 4 start (PI module + sidecar)
Week 3:      Phase 4 continued (PI tools, streaming, integration testing)
Week 4:      Phase 5 (frontend) + Phase 6 (legacy removal)
```

Phases 1+2 run in parallel and complete in one week (nsjail is mature, no VM complexity). Phase 4 (PI sidecar) is the critical path. Total: ~4 weeks of focused work.

### Go/No-Go Gates

| Gate | When | Criteria | Fallback |
|---|---|---|---|
| **nsjail isolation** | End of Week 1 | Process inside nsjail cannot read host `/etc/passwd`, sibling workspaces, or host PID list | Debug mount config. Exec fallback for dev. |
| **Pip persistence** | End of Week 1 | `pip install X` in command 1 → `import X` works in command 2 | Use pre-installed packages only |
| **Custom CLI** | End of Week 2 | `boring help` works inside nsjail, `/opt/boring/bin/` mounted correctly | Ship without custom CLI, add later |
| **Observability** | Before Phase 4 | Structured logs with request IDs across Go + Node | Block PI integration until tracing works |

---

## Part 8: Risks and Mitigations

### High Risk

| Risk | Impact | Mitigation |
|---|---|---|
| **PI sidecar crashes** | PI feature unavailable, conversation context lost | Health check + auto-restart, persist conversation to DB, graceful degradation (`pi: false` in capabilities) |
| **nsjail config complexity** | Wrong mount config = commands fail silently or packages don't persist | Test each mount in CI. Add `--sandbox-test` CLI flag. Start permissive, harden iteratively. |
| **Namespace support** | gVisor-based managed runtimes block namespace creation | Auto-detection: `nsjail > exec`. Document namespace requirement for production. |
| **Disk growth** | Per-workspace `.pip-local/` and workspace files accumulate | Disk quotas per workspace directory. Periodic cleanup of unused workspaces. |
| **Workspace root refactor regression** | Cross-workspace data leakage (security) | Backward-compatible fallback, concurrent request integration tests, path validation code review |
| **Path traversal / symlink escape** | Agent reads outside workspace (security) | `openat2 + RESOLVE_BENEATH` for files API, nsjail mount boundary for exec |

### Medium Risk

| Risk | Impact | Mitigation |
|---|---|---|
| **Node.js runtime in container** | +60MB image, additional CVE surface | Pin Node LTS, npm audit in CI, non-root user |
| **WebSocket session management at scale** | Lost context on restart, sticky sessions needed | Persist to DB, support session resume, workspace-affinity routing |
| **Frontend bundle size during migration** | Temporary growth before cleanup | Phase 5 explicitly removes old code, track bundle size in CI |
| **Agent context window bloat** | Truncated outputs hide info from agent | Backend pagination helpers, virtual `less`/`head`/`tail` suggestions |
| **Concurrency: agent edits while user has file open** | User sees stale content | Tool results include changed paths, frontend invalidates cache, later: WebSocket file-change events |
| **Concurrent execs on same workspace** | PI + user terminal both writing files, git corruption | Serialize git operations per workspace. File writes are atomic (rename). Document concurrent access model. |
| **Observability gap** | No correlated logs/metrics across Go→Node→nsjail | Add structured logging with request IDs. Prometheus metrics: sandbox exec count, exec latency, workspace disk usage. Tracing via OpenTelemetry. |
| **Exec fallback security** | `python3` in allowlist negates all other restrictions | Explicitly document exec fallback as "dev/trusted-only, no real isolation". |
| **Network egress from nsjail** | Agent could exfiltrate data via network | nsjail supports `--disable_clone_newnet` to block network. Enable network selectively for pip install. Default: network disabled for exec, enabled for pip. |

### Open Questions

| Question | Recommendation | Decision Needed By |
|---|---|---|
| Should `pip3 install` be allowed? | In nsjail mode: yes, writes to workspace `.pip-local/` dir (persists, isolated per workspace). In exec fallback: only `--target ./lib`. | Phase 2 |
| What isolation is required for sovereign/compliance? | Architecture supports swap. Specific requirements TBD. | Phase 3 (sovereign) |
| Keep browser PI mode as fallback? | Deprecate, don't rush removal. Remove when backend PI is proven. | Phase 5 |
| Session persistence: DB or filesystem? | DB for hosted mode, filesystem (`.boring/pi/sessions/`) for CLI mode. Reuse controlplane pattern. | Phase 4 |
| Long-running command handling? | Hard timeout (60s default, configurable). Agent retries with narrower scope. Streaming output deferred. | Phase 2 |

---

## Part 9: Sandbox Evaluation Summary

### BoxLite PoC (evaluated and rejected)

BoxLite v0.7.5 was tested on OVH VM: 7s cold boot, 21ms warm commands, 500MB RAM per workspace. Provides hardware-grade isolation (own kernel per workspace) and native statefulness, but the weight is disproportionate to the actual need.

**Why rejected**: The product needs "run python in a sandbox with persistent files" — not a full VM per workspace. nsjail with a stateful host filesystem delivers the same product outcomes at zero overhead.

### nsjail (chosen)

nsjail is mature (Google-production proven), has zero overhead per command (~1ms setup), and the workspace filesystem persists naturally on the host disk. Per-workspace Python packages persist via `.pip-local/` bind-mount.

| Metric | nsjail | BoxLite |
|---|---|---|
| Per-command overhead | ~1ms | ~21ms |
| Cold boot | None | ~7s |
| RAM per workspace | 0 (no persistent process) | ~500MB |
| Isolation | Namespace (strong) | VM kernel (strongest) |
| File persistence | Host disk (native) | VM bind-mount |
| Pip persistence | `.pip-local/` mount | VM filesystem |
| Maturity | Years, Google production | 3 months, v0.7.x |

BoxLite remains a documented future option behind the `Sandbox` interface if VM-grade isolation becomes a requirement.

---

## Part 10: Tradeoffs and Rejected Alternatives

### Decision Log

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Backend language | Go | Keep Python (FastAPI) | Go has feature parity, single static binary, better process management, already default in config |
| Service topology | Single binary | Microservices | Problem statement requires "one public backend service". Splitting adds latency and complexity without benefit. |
| PI strategy | Node.js sidecar | Rewrite in Go / Claude CLI bridge | Sidecar reuses months of proven work. Go rewrite = months for zero benefit. CLI bridge = Anthropic-only, opaque, fragile. |
| First hosting | VM (OVH/Hetzner) | Managed runtime (Modal/Fly) | VM gives full Linux kernel = nsjail works. gVisor runtimes block namespaces. |
| Sandbox production | nsjail (per-command namespace) | BoxLite micro-VMs / bubblewrap / gVisor / Docker-in-Docker | nsjail: mature (Google production), zero overhead, full bash inside namespace, stateful filesystem via host bind-mounts. BoxLite evaluated and rejected as too heavy (500MB/workspace, 7s boot) for the actual need. |
| Sandbox fallback | Command allowlist + rlimits | Unrestricted shell everywhere | Allowlist for environments without namespace support (CLI, dev, gVisor runtimes). |
| Path safety | openat2 + RESOLVE_BENEATH | EvalSymlinks only | Kernel-backed, no TOCTOU races. EvalSymlinks as fallback where openat2 unavailable. |
| Browser-local mode | Deprecate | Remove immediately | Removing blocks demos/offline use. Deprecate now, remove after backend PI proven. |
| Workspace sessions | Workspace-scoped | Global (cross-workspace) | Problem statement requires isolation per workspace. Cross-workspace access defeats the model. |

### Alternatives Considered and Rejected

- **Daytona / Gitpod**: Heavy, slow provisioning, high cost per workspace. Overkill for file editing + agent commands.
- **WebAssembly sandbox**: Immature filesystem APIs, can't run git/python/grep.
- **Separate sandbox microservice**: Adds network hop per command, defeats self-contained backend goal.
- **Large typed tool catalog instead of CLI**: LLMs perform better with shell-style composition. CLI is more discoverable (`--help`).
- **Landlock only**: Good defense-in-depth layer but not a complete sandbox. Use alongside nsjail, not instead.
- **BoxLite micro-VMs** (previous plan iteration): Evaluated via PoC — 7s cold boot, 500MB RAM per workspace, own kernel. Provides strongest isolation and native statefulness, but disproportionately heavy for the actual need (run python + shell commands in a sandbox with persistent files). nsjail with host filesystem bind-mounts delivers the same product outcomes at zero overhead. BoxLite remains a documented future option behind the `Sandbox` interface.

---

## Part 11: Current State Assessment

### What Exists (70% of target)

| Component | Status | Gap |
|---|---|---|
| Go module system | Ready | None |
| Files module | Working | Per-request root (small) |
| Git module | Working | Per-request root (small) |
| PTY module | Working | No sandbox (assessment needed) |
| Control plane | Working | Add root resolver method (small) |
| Auth (JWKS + JWT) | Ready | None |
| Config | Working | Add sandbox + LLM config (small) |
| Router / middleware | Working | Add root injection middleware (medium) |
| Capabilities | Working | Add PI feature flag (trivial) |
| PI service (Node.js) | Exists, tools empty | Add workspace-scoped tools (medium) |
| Go Dockerfile | Working | Add nsjail + Python + custom CLI (small) |
| CI pipeline | Working | Update for Go-only (small) |

### What's Missing (30%)

| Component | Location (target) | Effort |
|---|---|---|
| `internal/workspace/` | Workspace resolver + context + path safety | Medium |
| `internal/sandbox/` | Sandbox interface + nsjail + exec backends | Medium |
| `internal/agent/` | Presentation layer | Medium |
| `internal/modules/pi/` | PI proxy + sidecar management | Medium-Large |
| PI service tools | `src/pi_service/server.mjs` | Medium |
| VM deployment | Docker Compose + Caddy + nsjail | Medium |
| Custom CLI tools | `/opt/boring/bin/` workspace-aware commands | Small |

### What Must Be Removed

| Component | Phase |
|---|---|
| Python backend (`src/back/`) | Phase 6 |
| Modal Python deployment | Phase 6 |
| Sprite deployment | Phase 6 |
| Frontend browser-local providers | Phase 5 |
| Frontend companion adapter | Phase 5 |
| Stream module (Claude CLI bridge) | Phase 4 |

---

## Appendix A: Research Source Attribution

This plan synthesizes research from four independent sources:

| Source | Docs | Unique Contributions |
|---|---|---|
| **Claude Code / Codex** (codebase access) | 00-summary through 09-current-state | Specific code-level gap analysis, PI sidecar architecture with code examples, 7 duplicate function identification, exact module status |
| **Independent analysis** (codebase access, Python-focused) | 10-fastapi-reality-check | bubblewrap-first sandbox recommendation, Hetzner vs OVH provider ranking, openat2 deep dive, Python-specific migration path |
| **ChatGPT** (no codebase access) | chatgpt-synthesis | UID/GID per-workspace isolation, Landlock/seccomp defense-in-depth, Cloud Run gen2 as managed option, most thorough gVisor limitation analysis, openat2 + RESOLVE_BENEATH |
| **Gemini** (no codebase access) | gemini-synthesis | WorkspaceFS as os.DirFS abstraction, concurrency/state-sync risk, LiteLLM as provider gateway, agent context window bloat risk, WebSocket filesystem event notifications |

### Consensus (all four agree)

- Single backend service, not microservices
- Workspace-scoped per-request resolution
- Pluggable sandbox with config-driven selection
- VM/full-Linux for production (not gVisor serverless)
- Managed Postgres (Neon) for DB
- Command allowlist as portable baseline
- Files/git as canonical product API
- Frontend simplification: remove browser-local, companion, multi-agent
- Two-layer execution (semantics vs presentation)
- Swappable LLM endpoints for sovereignty

### Resolved Disagreements

| Topic | Disagreement | Resolution | Rationale |
|---|---|---|---|
| Go vs Python | Doc 10 recommends FastAPI | **Go** | Codebase has already shifted. Go is default in config, has CI, Dockerfile, 30+ recent commits. |
| PI strategy | Gemini/ChatGPT suggest embedding in backend | **Node.js sidecar** | pi-agent-core + pi-ai already provide 12+ providers, agent loop, streaming. Sidecar reuses this. |
| First hosting | ChatGPT/Gemini recommend Fly.io | **VM first, Fly.io as alternative** | VM gives full kernel control + sovereignty. Fly.io is documented as valid managed alternative. |
| Sandbox tool | Doc 10 recommends bubblewrap, BoxLite evaluated later | **nsjail primary** | nsjail: mature, zero overhead, full namespace isolation, stateful FS via host bind-mounts. BoxLite rejected as too heavy. |
| Path safety | Docs 00-09 use EvalSymlinks | **openat2 primary, EvalSymlinks fallback** | openat2 is kernel-backed, no TOCTOU races. Critical security improvement. |
