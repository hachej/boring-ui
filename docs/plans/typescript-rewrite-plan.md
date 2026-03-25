# boring-ui TypeScript Rewrite Plan

## Overview

Rewrite the boring-ui backend from Python/FastAPI to TypeScript/Fastify+tRPC.
Collapse 3 deployment modes into 1 server with a plug-and-play architecture:
pick a workspace backend, pick an agent runtime. Two config fields, that's it.

## Why TypeScript (Not "Keep Python and Bolt On Node")

The agent runtime ecosystem is TypeScript-native. Keeping Python means fighting this at every integration point:

- **Vercel AI SDK** (`streamText`, `useChat`, tool calling protocol) — TypeScript only. No Python port.
  Using it from Python means a Node.js sidecar just for `/api/chat`, reverse-engineering the
  UIMessageStream wire format, or maintaining a fragile proxy layer.
- **JustBash** — TypeScript library. Runs in-process in Node.js. From Python it's a subprocess or FFI bridge.
- **PI agent** (`pi-agent-core`, `pi-ai`) — TypeScript. The current pi_service sidecar exists solely
  because the Python backend can't run PI natively. A Node.js backend absorbs it — no sidecar needed.
- **Future agent frameworks** (LangGraph.js, CrewAI.js, Mastra, AutoGen.js) — all ship TypeScript SDKs
  first. Every new agent integration in a Python backend means another sidecar or bridge.

With Python, every agent runtime needs its own sidecar process. With TypeScript, they all run
in-process. One language, one process, zero agent-framework integration friction.

The bwrap sandbox (production exec) is a subprocess call — language-agnostic. The workspace backend
interface, the auth system, the file/git/workspace APIs — all straightforward to port. The agent
runtime integration is the part that **requires** TypeScript to do cleanly.

## Architecture

### Two Canonical Config Fields

```toml
[workspace]
backend = "bwrap"         # "lightningfs" | "justbash" | "bwrap"

[agent]
runtime = "pi"            # "pi" (default, foundation scope)
                          # "ai-sdk" planned as future extension (not foundation scope)
placement = "browser"     # "browser" | "server"
```

One deployment. One server. Everything else derives from these two fields.

> **AI SDK is a future extension, not foundation scope.**
> The `runtime = "ai-sdk"` option is architecturally planned (the interface supports it)
> but not implemented in the initial migration. PI is the only agent runtime at launch.
> AI SDK can be added later without architectural changes — the pluggable runtime
> interface is designed for it, but shipping it is a separate track after the
> backend migration stabilizes.

### Resolver Layer

Instead of scattered `if (config.backend === ...)` checks, two resolver functions
create the right implementations. Panels and tools never see raw config strings:

```typescript
// src/server/workspace/resolver.ts
function resolveWorkspaceBackend(config: AppConfig, workspaceId: string): WorkspaceBackend {
  switch (config.workspace.backend) {
    case 'bwrap':       return new BwrapBackend(workspaceId)
    case 'lightningfs': throw new Error('lightningfs runs in browser, not server')
    case 'justbash':    throw new Error('justbash runs in browser, not server')
  }
}

// src/front/workspace/resolver.ts
function resolveWorkspaceBackend(config: RuntimeConfig, workspaceId: string): WorkspaceBackend {
  switch (config.workspace.backend) {
    case 'bwrap':       return createTrpcBackend(trpcClient, workspaceId)
    case 'lightningfs': return createLightningBackend(workspaceId)
    case 'justbash':    return createJustBashBrowserBackend()
  }
}

// src/front/agent/resolver.ts
function resolveAgentRuntime(config: RuntimeConfig): AgentRuntime {
  switch (config.agent.runtime) {
    case 'pi':     return createPiRuntime(config)
    case 'ai-sdk': return createAiSdkRuntime(config)  // future
  }
}
```

Panels consume resolved interfaces, not raw config strings:

```tsx
const backend = resolveWorkspaceBackend(config, workspaceId)
const agent = resolveAgentRuntime(config)
return (
  <WorkspaceProvider backend={backend}>
    <AgentProvider runtime={agent}>
      {children}
    </AgentProvider>
  </WorkspaceProvider>
)
```

### Abstract Capability Gating

Panes gate on abstract capabilities, not implementation-specific flags:

```typescript
// Old (implementation-coupled):
requiresFeatures: ['pi']
requiresRouters: ['chat_claude_code']

// New (abstract):
requiresCapabilities: ['agent.chat']         // any agent runtime that supports chat
requiresCapabilities: ['workspace.files']    // any backend that supports file ops
requiresCapabilities: ['workspace.exec']     // any backend that supports bash/python
```

The capabilities endpoint reports what the active backend+runtime support:

```json
{
  "capabilities": {
    "workspace.files": true,
    "workspace.exec": true,
    "workspace.git": true,
    "workspace.python": true,
    "agent.chat": true,
    "agent.tools": true
  }
}
```

Each `WorkspaceBackend` implementation declares its capabilities:

```typescript
class BwrapBackend implements WorkspaceBackend {
  capabilities = ['workspace.files', 'workspace.exec', 'workspace.git', 'workspace.python']
}
class JustBashBrowserBackend implements WorkspaceBackend {
  capabilities = ['workspace.files', 'workspace.exec']  // no real git, limited python
}
```

### Workspace Backends (3 options, pluggable)

All three implement the same `WorkspaceBackend` interface. The frontend and agent
don't know which is active — they call the same methods.

```
┌─────────────────────┬──────────────────────┬────────────────────┐
│  lightningfs        │  justbash            │  bwrap             │
│                     │                      │                    │
│  Files: LightningFS │  Files: InMemoryFs   │  Files: real fs    │
│  (IndexedDB)        │  (RAM)               │  (disk, scoped)   │
│                     │                      │                    │
│  Git: isomorphic-git│  Git: builtin (basic)│  Git: real git     │
│  (pure JS, browser) │  (status,add,commit) │  (full: push/pull/ │
│                     │                      │   rebase/cherry-   │
│                     │                      │   pick/everything) │
│                     │                      │                    │
│  Exec: Pyodide      │  Exec: JustBash      │  Exec: real bash   │
│  (WASM CPython)     │  (TS builtins:       │  + real npm/pip/   │
│                     │   grep,sed,awk,jq)   │    python3/node    │
│                     │                      │                    │
│  Runs: browser      │  Runs: browser       │  Runs: server      │
│  Persistence:       │  Persistence:        │  Persistence:      │
│  IndexedDB          │  RAM (lost on reload)│  disk              │
│                     │                      │                    │
│  Best for:          │  Best for:           │  Best for:         │
│  offline dev,       │  instant preview,    │  production,       │
│  git-compatible     │  sandboxed demos,    │  full toolchain,   │
│  browser workspace  │  lightweight eval    │  real isolation    │
└─────────────────────┴──────────────────────┴────────────────────┘
```

Capability comparison:

```
                  lightningfs    justbash       bwrap
  git push        ◐ (http only)  ✗              ✓ (SSH + HTTPS)
  npm install     ✗              ✗              ✓
  pip install     ✗              ✗              ✓
  grep/sed/awk    ✗              ✓              ✓
  python3         ◐ (Pyodide)    ◐ (WASM)       ✓ (real CPython)
  persistence     ✓ (IndexedDB)  ✗ (RAM)        ✓ (disk)
  offline         ✓              ✓              ✗
  server needed   ✗ (auth only)  ✗ (auth only)  ✓
```

### Agent Runtime

PI is the only agent runtime at launch. The interface is pluggable — a second runtime
(AI SDK) can be added later without architectural changes.

| Runtime | LLM runs | API key | Placement | Frontend component |
|---------|----------|---------|-----------|-------------------|
| `pi` | Browser or server | User provides | `browser` (default) or `server` | `PiNativeAdapter` (existing) |
| `ai-sdk` | Server | Server env var | `server` only | `AiChat` (future, useChat hook) |

### Foundation Profile (what ships first)

| `backend` | `runtime` | `placement` | What happens | Target |
|-----------|-----------|-------------|-------------|--------|
| **`bwrap`** | **`pi`** | **`browser`** | **PI in browser + bwrap sandbox on server. Canonical hosted profile.** | **Production** |
| `bwrap` | `pi` | `server` | PI on server (absorbs pi_service sidecar). Bwrap exec. | Production (server-side agent) |
| `lightningfs` | `pi` | `browser` | Everything in browser. Zero server exec. | Dev-only |
| `justbash` | `pi` | `browser` | JustBash WASM in browser. Lightweight. | Experimental |

Only the **bold** row is the canonical reference profile for testing, smoke, eval, and docs.
Other combinations are compatibility paths — they should work, but they don't drive decisions.

### WorkspaceBackend Interface

Single interface, three implementations:

```typescript
interface WorkspaceBackend {
  // Filesystem
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>
  listDir(path: string): Promise<Entry[]>
  searchFiles(query: string, path?: string): Promise<Match[]>
  renameFile(oldPath: string, newPath: string): Promise<void>

  // Exec (agent tools)
  bash(command: string, opts?: { cwd?: string }): Promise<ExecResult>
  python(code: string): Promise<ExecResult>

  // Git
  gitStatus(): Promise<GitStatus>
  gitDiff(path: string): Promise<string>
  gitAdd(paths: string[]): Promise<void>
  gitCommit(message: string): Promise<CommitResult>
  gitPush(opts?: { remote?: string }): Promise<void>
  gitPull(opts?: { remote?: string }): Promise<void>
  gitLog(opts?: { limit?: number }): Promise<Commit[]>
  gitBranch(name: string): Promise<void>
  gitCheckout(name: string): Promise<void>
  gitBranches(): Promise<BranchList>
}
```

Implementations:
- `BwrapBackend` — port of existing `exec/service.py` (bwrap sandbox, already proven)
- `LightningBackend` — wraps existing LightningFS + isomorphic-git + Pyodide (kept as-is)
- `JustBashBrowserBackend` — JustBash WASM with InMemoryFs (new, lightweight)

### How It Wires Up

```
backend = "lightningfs" or "justbash":

  Browser calls backend directly — no server round-trip for workspace ops.
  Server only needed for auth (Neon) and LLM proxy (AI SDK mode).

  FileTreePanel → backend.listDir()    → IndexedDB or RAM (in-browser)
  EditorPanel   → backend.readFile()   → IndexedDB or RAM (in-browser)
  Agent tool    → backend.bash()       → Pyodide/JustBash WASM (in-browser)


backend = "bwrap":

  Browser calls server via tRPC. Server delegates to bwrap sandbox.

  FileTreePanel → trpc.files.list()    → server → fs.readdir (workspace dir)
  EditorPanel   → trpc.files.read()    → server → fs.readFile (workspace dir)
  Agent tool    → trpc.exec.bash()     → server → bwrap subprocess
```

Frontend panels use a `WorkspaceProvider` context. They never know which backend is active:

```tsx
function FileTreePanel() {
  const backend = useWorkspaceBackend()       // from context
  const { data } = useQuery(['files', path],
    () => backend.listDir(path)               // same call regardless of backend
  )
}
```

### Agent Panel

PI only at launch. The panel interface is pluggable for future runtimes:

```tsx
function AgentPanel({ workspaceId }) {
  // PI is the only runtime in foundation scope.
  // Future: check config.agent.runtime and render AiChat for "ai-sdk".
  return <PiNativeAdapter workspaceId={workspaceId} />
}
```

### Agent Tools: 2 Tools Only

The LLM gets two tools. Bash covers everything — files, git, system ops.
UI endpoints (files, git) are separate HTTP/JSON routes for the React panels.

```
Agent tools (what the LLM calls):
  exec_bash({ command, cwd? })  → { stdout, stderr, exitCode }
  exec_python({ code })         → { output, error? }

UI endpoints (what React panels call, tRPC):
  files.list / files.read / files.write / files.delete / files.rename / files.search
  git.status / git.diff / git.add / git.commit / git.push / git.pull / git.log
```

Tool schemas live in `src/shared/toolSchemas.ts` — shared by both PI and AI SDK runtimes.
Same interface, different executors depending on which backend is active.

### Stack (Foundation Scope)

```
Backend:   Fastify + tRPC + Drizzle + jose + simple-git + Zod
           + bwrap (system package, already in Dockerfile)
Frontend:  React + Vite + TailwindCSS + shadcn + DockView + @trpc/react-query
           + LightningFS + isomorphic-git + Pyodide (when backend = "lightningfs")
           + JustBash (when backend = "justbash")
           + PI (@mariozechner/pi-*) — only agent runtime
Database:  Neon PostgreSQL (same as today)
Auth:      Neon Auth (same as today) + jose for JWT
CLI:       bui (adapted for Node.js backend, not replaced)
Testing:   Vitest (TDD, red/green cycle)

Future (not foundation scope):
           + AI SDK (@ai-sdk/anthropic, @ai-sdk/react) — second agent runtime
```

#### Why tRPC IS the product contract

tRPC is not just an internal optimization — it's the framework's extension mechanism:

- **Child apps define tRPC routers** that boring-ui merges at startup.
  They get `workspaceProcedure` (auth + workspace context) for free.
- **Child app panels get full type safety** — `trpc.analytics.query.useMutation()`
  with autocomplete, input validation, and typed responses.
- **tRPC is still HTTP/JSON.** Every route is a real HTTP endpoint. Smoke tests
  use raw `httpx`/`fetch` and keep working. `curl` works. The typed client
  is a convenience layer, not a lock-in.
- **The current Python pattern is worse.** Child apps add routers via string
  paths (`"myapp.routers.foo:router"`) with zero type safety. tRPC is strictly
  better for framework composability.

#### Child App Extension Pattern (tRPC)

```toml
# Child app boring.app.toml
[backend]
routers = ["src/server/routers/analytics:analyticsRouter"]

[frontend.panels]
analytics = { title = "Analytics", placement = "center" }
```

```typescript
// Child app router — imports framework procedures, gets full type safety
import { router, workspaceProcedure } from 'boring-ui/trpc'

export const analyticsRouter = router({
  query: workspaceProcedure
    .input(z.object({ sql: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.backend.bash(`sqlite3 data.db "${input.sql}"`)
    }),
})
```

```tsx
// Child app panel — typed client, autocomplete, zero manual interface matching
import { trpc } from 'boring-ui/trpc-client'

export default function AnalyticsPanel() {
  const { data } = trpc.analytics.dashboards.useQuery()  // fully typed
}
```

### What Gets Deleted

```
DELETED (Python backend):
  src/back/                          # entire Python backend
  src/pi_service/                    # Node.js sidecar (PI runs in-process in Node backend)
  src/companion_service/             # orphan
  src/test/                          # orphan (tests/ is the real test dir)
  pyproject.toml, uv.lock           # Python packaging
  deploy/fly/fly.backend-agent.toml  # single deploy config replaces 3 variants
  deploy/fly/fly.workspaces.toml     # no workspace machines
  deploy/fly/fly.control-plane.toml  # no control plane split

DELETED (legacy surfaces):
  src/front/panels/TerminalPanel.jsx          # Claude terminal pane
  src/front/panels/ShellTerminalPanel.jsx     # shell pane
  src/front/components/Terminal.jsx           # terminal component
  src/front/components/chat/ClaudeStreamChat.jsx  # Claude streaming chat
  src/front/providers/pi/backendAdapter.jsx   # PI backend adapter (PI runs in-process now)
```

### What Stays (frontend, mostly unchanged)

```
KEPT:
  src/front/App.jsx                    # split into hooks
  src/front/panels/FileTreePanel.jsx   # same, typed fetch replaces httpProvider
  src/front/panels/EditorPanel.jsx     # same
  src/front/panels/ReviewPanel.jsx     # same (if approval stays)
  src/front/panels/AgentPanel.jsx      # PI only (pluggable interface for future runtimes)
  src/front/panels/DataCatalogPanel.jsx # same
  src/front/components/GitChangesView.jsx  # same
  src/front/components/GitDiff.jsx     # same
  src/front/components/GitHubConnect.jsx   # same
  src/front/components/ui/*            # shadcn components (unchanged)
  src/front/registry/panes.jsx         # remove terminal/shell, keep rest
  src/front/hooks/*                    # keep + extract from App.jsx
  src/front/layout/*                   # DockView layout (unchanged)
  src/front/styles/*                   # unchanged
  src/front/config/*                   # unchanged

KEPT (PI — browser agent runtime):
  src/front/providers/pi/nativeAdapter.jsx    # PI browser agent (used when runtime = "pi")
  src/front/providers/pi/piAi.browser.js      # PI browser LLM client
  src/front/providers/pi/providerKeys.js      # client API key management (PI only)
  src/front/providers/pi/runtime.js           # PI runtime
  src/front/providers/pi/defaultTools.js      # PI tool definitions
  src/front/providers/pi/sessionBus.js        # PI session bus
  src/front/providers/pi/toolCallXmlTransform.js  # PI tool call XML

ADDED (foundation scope):
  src/server/agent/tools.ts                   # shared tool schemas (Zod)
  src/server/agent/registry.ts                # tool registry (standard + child app tools)

FUTURE (not foundation scope):
  src/front/components/chat/AiChat.tsx        # useChat() wrapper (when AI SDK runtime is added)
  src/server/agent/chat.ts                    # streamText endpoint (when AI SDK runtime is added)
```

### Pluggable Subsystems

Two pluggable axes:

```
[workspace]
backend = "lightningfs" | "justbash" | "bwrap"   # workspace backend (3 options)

[agent]
runtime = "pi"                                   # foundation: PI only
         # "ai-sdk" reserved for future          # future: AI SDK extension
```

#### Axis 1: Workspace Backend

All three backends implement `WorkspaceBackend`. One interface, three adapters:

```typescript
// Shared interface — panels and agent tools call this, never know which backend is active
interface WorkspaceBackend { /* readFile, writeFile, listDir, bash, python, git*, ... */ }

// Three implementations:
class BwrapBackend implements WorkspaceBackend
  // Port of existing exec/service.py — real bash/git/npm/python3 in bwrap sandbox
  // Server-only. Workspace dir mounted read-write at /workspace.

class LightningBackend implements WorkspaceBackend
  // Wraps existing LightningFS + isomorphic-git + Pyodide (kept as-is)
  // Browser-only. Files in IndexedDB. Proven, works offline.

class JustBashBrowserBackend implements WorkspaceBackend
  // JustBash WASM with InMemoryFs — 100+ builtin commands (grep, sed, awk, jq)
  // Browser-only. No real git/npm. Lightweight, instant startup.
```

#### Axis 2: Agent Runtime

PI is the only runtime in foundation scope. The interface is pluggable for future runtimes:

```tsx
function AgentPanel({ workspaceId }) {
  // Foundation: PI only. Interface supports future runtimes via config.agent.runtime.
  return <PiNativeAdapter workspaceId={workspaceId} />
}
```

#### Wiring

The frontend reads `/__bui/config` at boot and creates the right backend:

```tsx
// Browser backends (lightningfs, justbash): direct JS calls, no server round-trip
// Server backend (bwrap): tRPC calls → server → bwrap subprocess

const backend = config.workspace.backend === 'bwrap'
  ? createTrpcBackend(trpcClient, workspaceId)   // all ops go to server
  : config.workspace.backend === 'lightningfs'
    ? createLightningBackend(workspaceId)          // existing browser stack
    : createJustBashBrowserBackend()               // JustBash WASM

return <WorkspaceProvider backend={backend}>...</WorkspaceProvider>
```

Panels never know which backend is active. They call `backend.listDir()`,
`backend.readFile()`, `backend.bash()` — same API regardless.

A fourth backend (Docker, Firecracker, remote VM) slots in by implementing
the same `WorkspaceBackend` interface. Zero changes to panels or agent tools.

### Auth System Cleanup

The rewrite is the opportunity to clean up the auth system properly.

**What the Python auth_router_neon.py (80KB) does today:**
- HTML form rendering (login, signup, reset-password pages) — embedded Python string templates
- Neon Auth proxy (sign-up, sign-in, password reset, email verification)
- Session cookie management (create, parse, validate)
- OAuth callback handling (Neon + pending-login token completion)
- Token exchange (Neon JWT → boring_session cookie)
- Redirect URL validation and allowlisting
- Dev login bypass
- Auto-workspace creation on first login

**What the TypeScript rewrite should do:**
- Split into focused files (~2KB each instead of 80KB monolith):
  - `src/server/auth/session.ts` — JWT create/parse/validate (jose)
  - `src/server/auth/neonClient.ts` — Neon Auth API calls (sign-up, sign-in, token, etc.)
  - `src/server/auth/middleware.ts` — Fastify cookie validation hook
  - `src/server/auth/callback.ts` — OAuth callback + pending-login completion
  - `src/server/auth/pages.ts` — HTML form rendering (proper templates, not string literals)
  - `src/server/auth/validation.ts` — redirect URL allowlisting, startup config checks
  - `src/server/routers/auth.ts` — tRPC routes wiring it all together

- **Fail closed**: missing NEON_AUTH_BASE_URL or NEON_AUTH_JWKS_URL → crash on startup
- **No silent fallback**: invalid config doesn't silently fall back to local mode
- **Startup validation**: all required env vars checked before first request
- **HTML out of Python strings**: auth pages use proper template files

### Unified Tool Interface

The LLM tool interface must be **identical** regardless of workspace backend or agent runtime.
Same tool names, same parameters, same response shapes. Only WHERE execution happens differs.

**Single source of truth**: `src/shared/toolSchemas.ts`

```
src/shared/toolSchemas.ts           ← Zod schemas for ALL agent tools
  │
  ├── src/server/agent/tools.ts     ← AI SDK mode: bind schemas to server executors
  │     exec_bash → bwrapBackend.bash()
  │     exec_python → bwrapBackend.python()
  │     open_file → push UI command via SSE/tRPC
  │     list_tabs → read UI state
  │
  └── src/front/providers/pi/tools.ts ← PI mode: bind schemas to browser executors
        exec_bash → backend.bash() (LightningFS/JustBash/HTTP→bwrap)
        exec_python → backend.python()
        open_file → window bridge (existing PI_OPEN_FILE_BRIDGE)
        list_tabs → window bridge (existing PI_LIST_TABS_BRIDGE)
```

**Three layers of tools:**

#### 1. Workspace tools — exec in the sandbox (2 tools)

| Tool | Parameters | Returns | Execution |
|------|-----------|---------|-----------|
| `exec_bash` | `{ command, cwd? }` | `{ stdout, stderr, exitCode }` | WorkspaceBackend.bash() |
| `exec_python` | `{ code }` | `{ output, error? }` | WorkspaceBackend.python() |

The LLM uses bash for everything: `cat`, `ls`, `grep`, `git status`, `npm install`, etc.

#### 2. UI bridge tools — control the IDE (standard, always present)

These let the agent interact with the IDE panels. They work the same in PI and AI SDK mode.

| Tool | Parameters | Returns | How it works today |
|------|-----------|---------|-------------------|
| `open_file` | `{ path }` | `{ opened: true }` | PI: `window[PI_OPEN_FILE_BRIDGE](path)`. AI SDK: tRPC mutation → UI command queue. |
| `list_tabs` | `{}` | `{ tabs: string[], activeFile? }` | PI: `window[PI_LIST_TABS_BRIDGE]()`. AI SDK: tRPC query → read UI state. |
| `open_panel` | `{ panelId }` | `{ opened: true }` | PI: `window[PI_OPEN_PANEL_BRIDGE](id)`. AI SDK: tRPC mutation → UI command queue. |

Reference: existing `src/front/providers/pi/uiBridge.js` defines the window bridges.
These are ported to shared tool schemas so AI SDK mode can use them too (via the existing
`/api/v1/ui/commands` endpoint — the backend queues a command, the frontend polls and executes).

#### 3. Child app tools — extensible by child apps

Child apps (boring-macro, bdocs, etc.) can register additional agent tools via `boring.app.toml`:

```toml
# child app's boring.app.toml
[agent.tools]
query_database = "src/tools/queryDatabase.ts"    # custom tool module
analyze_data = "src/tools/analyzeData.ts"        # custom tool module
```

Each tool module exports a Zod schema + execute function:

```typescript
// src/tools/queryDatabase.ts (child app)
import { z } from 'zod'

export const schema = z.object({
  query: z.string().describe('SQL query to execute'),
  database: z.string().optional(),
})

export const description = 'Query a connected database and return results.'

export async function execute({ query, database }, ctx: WorkspaceContext) {
  // child app's custom logic — has access to workspace context
  return { rows: [...], columns: [...] }
}
```

The tool registry loads these at startup and merges them with the standard tools:

```typescript
// src/server/agent/registry.ts
const standardTools = [execBash, execPython, openFile, listTabs, openPanel]
const childAppTools = loadChildAppTools(config)  // from boring.app.toml [agent.tools]
const allTools = [...standardTools, ...childAppTools]
```

For PI mode, child app tools are loaded as browser-side tool definitions
(the child app ships a browser-compatible version of the execute function).

#### UI endpoints (separate from agent tools)

Frontend panels call structured tRPC endpoints — NOT agent tools:

| Endpoint | Used by |
|----------|---------|
| `files.list / read / write / delete / rename / search` | FileTreePanel, EditorPanel |
| `git.status / diff / add / commit / push / pull / log` | GitChangesView, GitDiff |
| `ui.state / commands / panes / focus` | App shell (layout persistence) |

UI endpoints are powered by the same `WorkspaceBackend` interface.
The LLM never calls these — it uses `exec_bash("cat file.txt")` instead.

### bui CLI Cleanup

The `bui/` directory contains a Go CLI tool for dev orchestration, framework pinning, and child app management.
It needs to be updated or replaced as part of the rewrite.

**Current bui CLI responsibilities:**
- `bui dev` — run dev server (currently starts Python uvicorn + Vite)
- `bui build` — production build
- `bui deploy` — deploy to Fly with Vault secret injection
- `bui scaffold` — create new child app
- `bui neon` — Neon DB setup

**Options:**
1. **Keep Go CLI, update commands** — change `bui dev` to start Node.js instead of Python
2. **Replace with Node.js scripts** — `package.json` scripts replace the Go binary
3. **Replace with TypeScript CLI** — a small `src/cli/` using Commander or similar

**Recommended: Option 2 (package.json scripts)**. The Go CLI adds a build step and a second language.
Most of what bui does can be npm scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"tsx watch src/server/index.ts\" \"vite\"",
    "build": "vite build && tsc -p tsconfig.server.json",
    "deploy": "bash deploy/fly/deploy.sh",
    "db:migrate": "drizzle-kit migrate",
    "db:generate": "drizzle-kit generate",
    "test": "vitest run",
    "test:smoke": "python3 tests/smoke/run_all.py",
    "lint": "eslint src/ && tsc --noEmit"
  }
}
```

The `bui deploy` command (Vault secret injection + fly deploy) stays as a bash script.
The `bui scaffold` command for child apps gets ported to a small Node script or kept as Go if it's stable.

---

## Project Structure

```
src/
├── server/                              # NEW: TypeScript backend
│   ├── index.ts                         # Entry point: start Fastify
│   ├── app.ts                           # Fastify app factory
│   ├── trpc.ts                          # tRPC init, context, procedures
│   │
│   ├── routers/                         # tRPC routers
│   │   ├── _app.ts                      # Root router (merges all)
│   │   ├── auth.ts                      # Neon auth: sign-up, sign-in, callback, logout, session, token-exchange
│   │   ├── files.ts                     # list, read, write, delete, rename, move, search
│   │   ├── git.ts                       # status, diff, add, commit, push, pull, clone, branches, remotes
│   │   ├── exec.ts                      # bash (JustBash), python (Monty)
│   │   ├── agent.ts                     # AI SDK chat endpoint (raw Fastify route, not tRPC)
│   │   ├── workspaces.ts               # CRUD, settings, runtime, boundary routing
│   │   ├── users.ts                     # me, settings
│   │   ├── collaboration.ts             # members, invites
│   │   ├── uiState.ts                   # state snapshots, commands, panes
│   │   ├── capabilities.ts              # feature discovery
│   │   ├── approval.ts                  # approval workflow (if kept)
│   │   ├── github.ts                    # GitHub App OAuth, git credentials
│   │   └── health.ts                    # health, healthz, metrics
│   │
│   ├── exec/                            # Execution engines
│   │   ├── justbash.ts                  # JustBash workspace runner pool
│   │   └── monty.ts                     # Monty workspace runner pool
│   │
│   ├── agent/                           # AI SDK agent
│   │   ├── chat.ts                      # streamText handler
│   │   ├── tools.ts                     # Tool definitions (server-side)
│   │   └── browserTools.ts              # Tool schemas (client-side, no execute)
│   │
│   ├── auth/                            # Auth utilities
│   │   ├── session.ts                   # JWT session create/parse (jose)
│   │   ├── neonAuth.ts                  # Neon Auth API client
│   │   └── middleware.ts                # Fastify auth hooks
│   │
│   ├── db/                              # Database
│   │   ├── client.ts                    # Drizzle + postgres.js connection
│   │   ├── schema.ts                    # Drizzle schema (all tables)
│   │   └── migrate.ts                   # Migration runner
│   │
│   ├── workspace/                       # Workspace resolution
│   │   ├── context.ts                   # Per-request workspace resolution
│   │   ├── paths.ts                     # Path traversal prevention
│   │   └── boundary.ts                  # /w/{id}/* proxy logic
│   │
│   └── config.ts                        # App config (env vars, boring.app.toml)
│
├── front/                               # Frontend (React — mostly kept)
│   ├── App.jsx → App.tsx                # Split into hooks
│   ├── components/
│   │   ├── chat/
│   │   │   └── AiChat.tsx               # NEW: useChat() wrapper (replaces ClaudeStreamChat)
│   │   ├── ui/                          # shadcn (unchanged)
│   │   ├── GitChangesView.jsx           # kept
│   │   ├── GitDiff.jsx                  # kept
│   │   ├── GitHubConnect.jsx            # kept
│   │   └── ...
│   ├── hooks/
│   │   ├── useWorkspaceAuth.ts          # NEW: extracted from App.jsx
│   │   ├── useWorkspaceRouter.ts        # NEW: extracted from App.jsx
│   │   ├── useDockLayout.ts             # NEW: extracted from App.jsx
│   │   ├── usePanelActions.ts           # NEW: extracted from App.jsx
│   │   ├── useApprovalPolling.ts        # NEW: extracted from App.jsx
│   │   ├── useFrontendStatePersist.ts   # NEW: extracted from App.jsx
│   │   ├── useDataProviderScope.ts      # NEW: extracted from App.jsx
│   │   └── ...existing hooks...
│   ├── utils/
│   │   └── trpc.ts                      # NEW: tRPC client setup
│   ├── providers/
│   │   ├── data/
│   │   │   ├── trpcProvider.ts          # NEW: tRPC-based data provider (replaces httpProvider)
│   │   │   ├── lightningProvider.js     # KEPT: browser isolation mode
│   │   │   └── ...
│   │   └── pi/                          # DELETED (replaced by AI SDK)
│   ├── panels/                          # kept minus terminal/shell
│   ├── registry/panes.tsx              # updated: remove terminal/shell
│   └── ...
│
├── shared/                              # Shared types
│   └── types.ts                         # Common types between server + client
│
├── drizzle/                             # DB migrations
│   ├── 0000_init.sql                    # Initial schema
│   └── meta/
│
├── package.json                         # Single package
├── tsconfig.json                        # TypeScript config
├── boring.app.toml                      # App config
└── vite.config.ts                       # Frontend build (kept)
```

---

## Database Schema (Drizzle)

Reference: current Neon tables + deploy/sql/*.sql

```typescript
// src/server/db/schema.ts
import { pgTable, uuid, text, timestamp, jsonb, boolean, primaryKey } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: text('app_id').notNull().default('boring-ui'),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  userId: uuid('user_id').references(() => users.id),
  role: text('role').notNull().default('editor'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ pk: primaryKey(t.workspaceId, t.userId) }))

export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  key: text('key').notNull(),
  value: text('value'),  // encrypted via pgp_sym_encrypt
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ pk: primaryKey(t.workspaceId, t.key) }))

export const workspaceRuntimes = pgTable('workspace_runtimes', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id),
  state: text('state').notNull().default('pending'),
  metadata: jsonb('metadata').default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  email: text('email').notNull(),
  role: text('role').notNull().default('editor'),
  invitedBy: uuid('invited_by').references(() => users.id),
  acceptedBy: uuid('accepted_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').notNull(),
  appId: text('app_id').notNull().default('boring-ui'),
  settings: jsonb('settings').notNull().default({}),
  email: text('email').notNull().default(''),
  displayName: text('display_name').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({ pk: primaryKey(t.userId, t.appId) }))
```

---

## Route Map: Python → TypeScript

### Files (7 routes)
Python ref: `src/back/boring_ui/api/modules/files/router.py`

```typescript
// src/server/routers/files.ts
export const filesRouter = router({
  list:   workspaceProcedure.input(z.object({ path: z.string().default('.') })).query(/* ... */),
  read:   workspaceProcedure.input(z.object({ path: z.string() })).query(/* ... */),
  write:  workspaceProcedure.input(z.object({ path: z.string(), content: z.string() })).mutation(/* ... */),
  delete: workspaceProcedure.input(z.object({ path: z.string() })).mutation(/* ... */),
  rename: workspaceProcedure.input(z.object({ oldPath: z.string(), newPath: z.string() })).mutation(/* ... */),
  move:   workspaceProcedure.input(z.object({ srcPath: z.string(), destDir: z.string() })).mutation(/* ... */),
  search: workspaceProcedure.input(z.object({ q: z.string(), path: z.string().default('.') })).query(/* ... */),
})
```

### Git (16 routes)
Python ref: `src/back/boring_ui/api/modules/git/router.py` + `service.py`

```typescript
// src/server/routers/git.ts — uses simple-git
export const gitRouter = router({
  status:   workspaceProcedure.query(/* ... */),
  diff:     workspaceProcedure.input(z.object({ path: z.string() })).query(/* ... */),
  show:     workspaceProcedure.input(z.object({ path: z.string() })).query(/* ... */),
  init:     workspaceProcedure.mutation(/* ... */),
  add:      workspaceProcedure.input(z.object({ paths: z.array(z.string()) })).mutation(/* ... */),
  commit:   workspaceProcedure.input(z.object({ message: z.string() })).mutation(/* ... */),
  push:     workspaceProcedure.input(z.object({ remote: z.string().optional() })).mutation(/* ... */),
  pull:     workspaceProcedure.input(z.object({ remote: z.string().optional() })).mutation(/* ... */),
  clone:    workspaceProcedure.input(z.object({ url: z.string() })).mutation(/* ... */),
  branches: workspaceProcedure.query(/* ... */),
  branch:   workspaceProcedure.input(z.object({ name: z.string() })).mutation(/* ... */),
  checkout: workspaceProcedure.input(z.object({ name: z.string() })).mutation(/* ... */),
  merge:    workspaceProcedure.input(z.object({ source: z.string() })).mutation(/* ... */),
  remotes:  workspaceProcedure.query(/* ... */),
  addRemote: workspaceProcedure.input(z.object({ name: z.string(), url: z.string() })).mutation(/* ... */),
  currentBranch: workspaceProcedure.query(/* ... */),
})
```

### Exec (2 routes — NEW: JustBash + Monty)
Python ref: `src/back/boring_ui/api/modules/exec/router.py` (subprocess.run → JustBash)

```typescript
// src/server/routers/exec.ts
export const execRouter = router({
  bash:   workspaceProcedure.input(z.object({ command: z.string(), cwd: z.string().optional() })).mutation(/* JustBash */),
  python: workspaceProcedure.input(z.object({ code: z.string() })).mutation(/* Monty */),
})
```

### Agent Chat (1 route — NEW: AI SDK)
No Python ref (new endpoint).

```typescript
// src/server/agent/chat.ts — raw Fastify route (not tRPC, needs streaming)
// POST /api/v1/agent/chat → streamText + tools (server isolation)
//                         → streamText + tool schemas only (browser isolation)
```

### Auth (12+ routes)
Python ref: `src/back/boring_ui/api/modules/control_plane/auth_router_neon.py` (80KB → target ~2KB per route)

```typescript
// src/server/routers/auth.ts — split the 80KB monster into focused handlers
export const authRouter = router({
  signUp:              publicProcedure.input(signUpSchema).mutation(/* ... */),
  signIn:              publicProcedure.input(signInSchema).mutation(/* ... */),
  tokenExchange:       publicProcedure.input(z.object({ accessToken: z.string() })).mutation(/* ... */),
  session:             protectedProcedure.query(/* ... */),
  logout:              protectedProcedure.mutation(/* ... */),
  resendVerification:  publicProcedure.input(z.object({ email: z.string() })).mutation(/* ... */),
  requestPasswordReset: publicProcedure.input(z.object({ email: z.string() })).mutation(/* ... */),
  resetPassword:       publicProcedure.input(resetPasswordSchema).mutation(/* ... */),
})
// Plus raw routes for /auth/callback (HTML), /auth/login (HTML), /auth/social/:provider (redirect)
```

### Users (3 routes)
Python ref: `src/back/boring_ui/api/modules/control_plane/me_router_neon.py`

```typescript
// src/server/routers/users.ts
export const usersRouter = router({
  me:          protectedProcedure.query(/* ... */),
  getSettings: protectedProcedure.query(/* ... */),
  putSettings: protectedProcedure.input(z.record(z.unknown())).mutation(/* ... */),
})
```

### Workspaces (6+ routes)
Python ref: `src/back/boring_ui/api/modules/control_plane/workspace_router_hosted.py`

```typescript
// src/server/routers/workspaces.ts
export const workspacesRouter = router({
  list:    protectedProcedure.query(/* ... */),
  create:  protectedProcedure.input(z.object({ name: z.string() })).mutation(/* ... */),
  get:     memberProcedure.query(/* ... */),
  update:  memberProcedure.input(z.object({ name: z.string().optional() })).mutation(/* ... */),
  delete:  memberProcedure.mutation(/* ... */),
  runtime: memberProcedure.query(/* ... */),
  retryRuntime: memberProcedure.mutation(/* ... */),
  getSettings: memberProcedure.query(/* ... */),
  putSettings: memberProcedure.input(z.record(z.unknown())).mutation(/* ... */),
})
```

### Collaboration (5 routes)
Python ref: `src/back/boring_ui/api/modules/control_plane/collaboration_router_hosted.py`

### UI State (10 routes)
Python ref: `src/back/boring_ui/api/modules/ui_state/router.py`

### GitHub Auth (10 routes)
Python ref: `src/back/boring_ui/api/modules/github_auth/router.py`

### Capabilities + Health (5 routes)
Python ref: `src/back/boring_ui/api/capabilities.py` + `app.py` health/config endpoints

---

## Implementation Phases

### Phase 1: Scaffold + Config + Resolvers (days 1-2)

```
1. Initialize TypeScript project
   - package.json with Fastify, tRPC, Drizzle, jose, simple-git, zod
   - tsconfig.json
   - Drizzle config pointing at existing Neon DB

2. Config loader + normalization
   - src/server/config.ts — read boring.app.toml + env vars
   - Normalize legacy fields (agents.mode, frontend.data.backend) to canonical fields
   - Emit canonical payload for /__bui/config
   - TEST FIRST: config normalization tests (legacy → canonical mapping)

3. Resolver layer
   - src/server/workspace/resolver.ts — resolveWorkspaceBackend()
   - src/front/workspace/resolver.ts — resolveWorkspaceBackend() (browser side)
   - src/front/agent/resolver.ts — resolveAgentRuntime()
   - TEST FIRST: resolver tests (config → correct implementation class)

4. Set up Fastify app with tRPC
   - src/server/app.ts — Fastify factory with tRPC plugin
   - src/server/trpc.ts — context, publicProcedure, protectedProcedure, workspaceProcedure

5. Auth middleware
   - src/server/auth/session.ts — JWT create/parse with jose (port auth_session.py)
   - src/server/auth/middleware.ts — cookie validation hook

6. Workspace context
   - src/server/workspace/context.ts — resolve workspace dir from ID
   - src/server/workspace/paths.ts — path traversal prevention (port paths.py)

7. Database
   - src/server/db/schema.ts — Drizzle schema matching existing tables
   - src/server/db/client.ts — postgres.js connection to Neon

6. Health endpoint
   - GET /health → { ok: true }
   - Deploy to Fly alongside Python (dual-stack, proxy splits traffic)
```

Python reference files:
- `src/back/boring_ui/api/config.py` → `src/server/config.ts`
- `src/back/boring_ui/api/modules/control_plane/auth_session.py` → `src/server/auth/session.ts`
- `src/back/boring_ui/api/workspace/paths.py` → `src/server/workspace/paths.ts`
- `src/back/boring_ui/api/workspace/context.py` → `src/server/workspace/context.ts`

### Phase 2: BwrapBackend — Wrap Existing (days 3-5)

Implement the canonical hosted profile first: `backend = "bwrap"`.
This wraps the existing proven Python behavior in TypeScript.
Do NOT add justbash yet — wrap what exists, prove parity, then add new backends.

```
1. BwrapBackend implementation
   - Port bwrap sandbox from exec/service.py (exact same flags, bootstrap, env)
   - This is the WorkspaceBackend implementation for production
   - TEST FIRST: bwrap isolation tests (can't escape workspace dir)

2. Files router (7 routes)
   - Port file operations from FileService (service.py) to fs/promises
   - Delegates to BwrapBackend for path-scoped file ops
   - Same path validation, same response shapes
   - PARITY GATE: smoke_filesystem.py passes against new server

3. Git router (16 routes)
   - Port from subprocess_git.py to simple-git library
   - Same response shapes
   - PARITY GATE: smoke_git_sync.py passes

4. Exec router (2 routes)
   - bash → BwrapBackend.bash() (bwrap subprocess)
   - python → BwrapBackend.python() (python3 in bwrap)
   - Same timeout handling, output truncation, bootstrap sequence

5. Static file serving
   - Serve Vite build output (dist/) from Fastify
   - SPA fallback for client-side routing
```

Python reference files:
- `src/back/boring_ui/api/modules/files/service.py` → `src/server/routers/files.ts`
- `src/back/boring_ui/api/modules/git/service.py` → `src/server/routers/git.ts`
- `src/back/boring_ui/api/modules/exec/router.py` → `src/server/routers/exec.ts`
- `src/back/boring_ui/api/storage.py` → inline in files.ts (LocalStorage is trivial in Node)
- `src/back/boring_ui/api/subprocess_git.py` → replaced by simple-git
- `src/back/boring_ui/runtime.py` → static serving in app.ts

### Phase 3: Auth + Users + Workspaces (days 6-9)

```
1. Neon Auth integration (12+ routes)
   - Port sign-up, sign-in, callback, logout, session, token-exchange
   - Port HTML form rendering for /auth/login, /auth/signup
   - Port JWKS verification (token_verify.py → jose)
   - Test: smoke_neon_auth.py should pass

2. Users router (3 routes)
   - Port me, settings from me_router_neon.py
   - Already uses Neon DB (user_settings table)
   - Test: smoke_settings.py should pass

3. Workspaces router (6+ routes)
   - Port workspace CRUD from workspace_router_hosted.py
   - Port boundary routing from workspace_boundary_router_hosted.py
   - Test: smoke_workspace_lifecycle.py should pass

4. Collaboration router (5 routes)
   - Port members, invites from collaboration_router_hosted.py
```

Python reference files:
- `src/back/boring_ui/api/modules/control_plane/auth_router_neon.py` → `src/server/routers/auth.ts` (80KB → ~15KB total)
- `src/back/boring_ui/api/modules/control_plane/token_verify.py` → jose JWKS verification
- `src/back/boring_ui/api/modules/control_plane/me_router_neon.py` → `src/server/routers/users.ts`
- `src/back/boring_ui/api/modules/control_plane/workspace_router_hosted.py` → `src/server/routers/workspaces.ts`
- `src/back/boring_ui/api/modules/control_plane/workspace_boundary_router_hosted.py` → `src/server/workspace/boundary.ts`
- `src/back/boring_ui/api/modules/control_plane/collaboration_router_hosted.py` → `src/server/routers/collaboration.ts`
- `src/back/boring_ui/api/modules/control_plane/membership.py` → inline in workspaces.ts
- `src/back/boring_ui/api/modules/control_plane/common.py` → inline in trpc.ts

### Phase 4: Agent Chat + Capabilities (days 10-11)

```
1. AI SDK agent endpoint
   - POST /api/v1/agent/chat → streamText with tools
   - Server isolation: tools execute via JustBash/Monty/fs/simple-git
   - Browser isolation: tool schemas only, execution bounced to client
   - Test: manual chat interaction

2. Capabilities endpoint
   - Port from capabilities.py
   - New contract: agent, workspace, features, auth sections
   - Remove legacy capability names (pty, chat_claude_code, stream)

3. Runtime config endpoint (/__bui/config)
   - Port from runtime_config.py

4. UI State router (10 routes)
   - Port from ui_state router
   - Test: smoke_ui_state.py should pass

5. Approval router (5 routes, if kept)
   - Port from approval.py

6. GitHub Auth router (10 routes)
   - Port from github_auth/router.py + service.py
```

Python reference files:
- `src/back/boring_ui/api/capabilities.py` → `src/server/routers/capabilities.ts`
- `src/back/boring_ui/runtime_config.py` → inline in capabilities.ts
- `src/back/boring_ui/api/modules/ui_state/router.py` → `src/server/routers/uiState.ts`
- `src/back/boring_ui/api/approval.py` → `src/server/routers/approval.ts`
- `src/back/boring_ui/api/modules/github_auth/router.py` → `src/server/routers/github.ts`
- `src/back/boring_ui/api/modules/github_auth/service.py` → inline in github.ts

### Phase 5: Legacy Surface Cleanup (days 12-13)

Delete PTY, Claude streaming, terminal/shell surfaces. This phase is a pure deletion —
no new code, just removing files and references.

```
BACKEND — delete these Python modules (not ported to TypeScript):
  src/back/boring_ui/api/modules/pty/           # PTY WebSocket + session lifecycle
  src/back/boring_ui/api/modules/stream/        # Claude streaming WebSocket
  src/back/boring_ui/api/modules/agent_normal/  # Agent normal session management
  src/back/boring_ui/api/stream_bridge.py       # 60KB Claude streaming implementation
  src/back/boring_ui/api/git_routes.py          # dead stub (206 bytes)
  src/back/boring_ui/api/agents/pi_harness.py   # server-side PI (replaced by AI SDK)
  src/pi_service/                               # Node.js PI sidecar process
  src/companion_service/                        # orphan legacy service
  src/test/                                     # confusing alongside tests/

FRONTEND — delete these components:
  src/front/panels/TerminalPanel.jsx            # Claude terminal pane (14KB)
  src/front/panels/ShellTerminalPanel.jsx       # shell pane (9KB)
  src/front/components/Terminal.jsx             # xterm.js terminal component
  src/front/components/chat/ClaudeStreamChat.jsx # Claude streaming chat (replaced by AiChat)
  src/front/providers/pi/backendAdapter.jsx     # PI backend adapter (15KB, used pi_service sidecar)

FRONTEND — update these files:
  src/front/registry/panes.jsx                  # remove "terminal" and "shell" entries
  src/front/App.jsx                             # remove terminal/shell toggle callbacks,
                                                # remove Claude stream WebSocket setup,
                                                # remove PTY session management
  src/front/utils/routes.js                     # remove /ws/pty, /ws/agent/normal/stream routes
  src/front/hooks/index.js                      # remove any PTY/Claude-related hook exports

TESTS — delete or update:
  tests/unit/ — remove tests asserting PTY/Claude/stream behavior
  tests/integration/ — remove tests asserting PTY/Claude route tables
  tests/smoke/smoke_capabilities.py — remove assertions for "pty", "chat_claude_code", "stream",
                                      "terminal", "shell" — add negative assertions proving they're gone

DOCS — update:
  AGENTS.md — remove PTY/Claude/stream references
  deploy/README.md — already updated for 3 modes; will be updated again for single mode
  docs/runbooks/MODES_AND_PROFILES.md — simplify to isolation + runtime matrix
```

### Phase 6: Frontend Migration (days 14-16)

```
1. tRPC client setup
   - src/front/utils/trpc.ts — createTRPCReact, httpBatchLink
   - Replace httpProvider.js calls with tRPC hooks
   - Keep httpProvider.js as fallback for PI mode (PI tools call httpProvider directly)

2. AiChat component (AI SDK runtime)
   - src/front/components/chat/AiChat.tsx — useChat() wrapper
   - Handle both isolation modes (onToolCall for browser isolation)
   - Only rendered when config.agent.runtime === "ai-sdk"

3. AgentPanel pluggable
   - src/front/panels/AgentPanel.jsx — reads runtime config
   - Renders PI nativeAdapter when runtime = "pi"
   - Renders AiChat when runtime = "ai-sdk"

4. App.jsx split (7 hooks)
   - useWorkspaceAuth, useWorkspaceRouter, useDockLayout
   - usePanelActions, useApprovalPolling, useFrontendStatePersist
   - useDataProviderScope

5. Pane registry update
   - terminal and shell already deleted in Phase 5
   - Update agent pane capability requirements to new contract
   - Update capability gating from router-name-based to logical feature-based
```

### Phase 7: Cutover (days 17-18)

```
1. Run full smoke suite against TypeScript server
   - All 7 suites must pass (health, capabilities, neon-auth,
     workspace-lifecycle, filesystem, settings, ui-state, git-sync)

2. Deploy TypeScript server as primary
   - Single Dockerfile: Node.js + Vite build
   - Single fly.toml (no more 3 variants)

3. Delete Python backend
   - rm -rf src/back/ (already not ported — TypeScript replacements in src/server/)
   - rm pyproject.toml uv.lock
   - Update AGENTS.md, deploy/README.md
```

### Phase 8: Add New Backends + Final Polish (days 19-20)

```
1. Add JustBash browser backend (if desired)
   - Implement JustBashBrowserBackend behind WorkspaceBackend interface
   - Add justbash npm dependency
   - Test: config resolver returns JustBashBrowserBackend when backend = "justbash"
   - This is an ADD, not a migration — existing backends unaffected

3. Update docs and examples
   - boring.app.toml examples use canonical fields only
   - deploy/README.md describes the two-field config model
   - AGENTS.md updated for new architecture
   - Child app extension docs show tRPC router pattern
```

---

## Foundation Principles (from improvement-roadmap.md)

These principles carry over from the improvement roadmap and apply to the rewrite:

1. **Stable contracts beat more features.** The rewrite must preserve the existing HTTP API contract (same routes, same response shapes) so smoke tests pass without changes.

2. **Auth must fail closed on misconfiguration.** Port the auth hardening goals:
   - Fail fast on missing Neon auth config in hosted mode
   - Startup validation for required env vars (DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL)
   - Callback URL validation and redirect allowlisting

3. **The public contract must be product-shaped, not transport-shaped.** The capabilities endpoint should expose logical sections (`agent`, `workspace`, `features`, `auth`) instead of legacy router names (`pty`, `chat_claude_code`, `stream`).

4. **No parallel local/hosted code trees.** The Python codebase has `me_router.py` + `me_router_neon.py`, `workspace_router.py` + `workspace_router_hosted.py`, etc. The TypeScript rewrite should have ONE router per domain that adapts to the configured provider. No `*_neon.ts` / `*_local.ts` duplication.

5. **Each test layer answers a different question:**
   - Unit tests: is the implementation correct in isolation? (JustBash sandbox, auth JWT, path traversal)
   - Smoke tests: does the deployed critical path work end-to-end? (auth, workspace, files, git)
   - Eval tests: does the framework satisfy the platform contract? (capabilities shape, child-app composability)

6. **Auth is the highest-priority correctness surface.** The auth router is the first thing to port and the first thing to smoke test. Every other router depends on auth working correctly.

7. **Approval is experimental until classified otherwise.** Port approval.py but mark it experimental. Don't lean on it in the shell until the semantics are durable (currently in-memory store, lost on restart).

---

## Testing Strategy

### During Migration (dual-stack)
Both servers run. Fly proxy routes traffic. Smoke tests validate both.

### Smoke Tests (kept, updated)
```
tests/smoke/run_all.py          — same runner, same suites
tests/smoke/smoke_health.py     — same
tests/smoke/smoke_capabilities.py — updated for new contract shape
tests/smoke/smoke_neon_auth.py  — same (auth contract unchanged)
tests/smoke/smoke_workspace_lifecycle.py — same
tests/smoke/smoke_filesystem.py — same
tests/smoke/smoke_settings.py   — same
tests/smoke/smoke_ui_state.py   — same
tests/smoke/smoke_git_sync.py   — same
```

The smoke tests hit HTTP endpoints. They don't care if the backend is Python or TypeScript. Same routes, same response shapes → same tests.

### New Tests (ordered by implementation phase)

Phase 1 tests — build FIRST, before any route implementation:
```
tests/unit/config.test.ts       — config normalization (legacy → canonical field mapping)
                                  startup validation (missing env vars fail fast)
                                  boring.app.toml parsing
tests/unit/resolver.test.ts     — workspace backend resolution (config → correct class)
                                  agent runtime resolution (config → correct class)
                                  invalid combinations rejected
tests/unit/auth.test.ts         — JWT session round-trip, cookie parsing, JWKS verification
```

Phase 2 tests — one per route family, written BEFORE implementation (TDD):
```
tests/unit/bwrap.test.ts        — bwrap sandbox isolation (can't escape workspace dir)
tests/unit/files.test.ts        — file operations via BwrapBackend
tests/unit/git.test.ts          — git operations via simple-git
tests/unit/exec.test.ts         — exec via bwrap (timeout, output truncation, bootstrap)
tests/unit/workspace.test.ts    — path traversal prevention, workspace dir creation
```

Phase 3+ tests:
```
tests/unit/trpc.test.ts         — tRPC router integration tests (with test DB)
tests/unit/capabilities.test.ts — contract shape (abstract capabilities, no legacy names)
```

Integration combos (tested after each backend/runtime is wired):
```
tests/integration/bwrap-pi.test.ts        — canonical profile: bwrap backend + PI runtime
tests/integration/lightningfs-pi.test.ts  — browser profile: lightningfs + PI
tests/integration/justbash-pi.test.ts     — experimental: justbash + PI (added in Phase 8)
```

### Negative Tests (from improvement-roadmap.md)
The test suite must prove removed surfaces stay removed:
```
- /ws/pty returns 404 (PTY deleted)
- /ws/agent/normal/stream returns 404 (Claude stream deleted)
- /api/capabilities does NOT contain "pty", "chat_claude_code", "stream"
- pane registry does NOT contain "terminal" or "shell"
```

---

## Dockerfile (single)

```dockerfile
FROM node:20-slim
WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git jq ripgrep tree curl && rm -rf /var/lib/apt/lists/*

# Install deps
COPY package.json package-lock.json ./
RUN npm ci

# Build frontend
COPY src/front ./src/front
COPY index.html vite.config.ts tailwind.config.js ./
COPY boring.app.toml ./
RUN npx vite build

# Build backend
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY tsconfig.json ./
RUN npx tsc -p tsconfig.server.json

EXPOSE 8000
CMD ["node", "dist/server/index.js"]
```

---

## Config (boring.app.toml)

```toml
[app]
name = "boring-ui"
id = "boring-ui"

[workspace]
backend = "bwrap"       # "lightningfs" | "justbash" | "bwrap"

[agent]
runtime = "pi"          # "pi" (foundation scope)
placement = "browser"   # "browser" | "server"

[auth]
provider = "neon"
session_cookie = "boring_session"
session_ttl = 86400

[deploy]
platform = "fly"
```

### Foundation Profile

| Use case | `backend` | `placement` | Description |
|----------|-----------|-------------|-------------|
| **Canonical production** | **`bwrap`** | **`browser`** | **PI in browser + bwrap sandbox on server. Reference profile.** |
| Server-side agent | `bwrap` | `server` | PI runs in-process on server. No sidecar. |
| Offline dev | `lightningfs` | `browser` | Everything in browser. IndexedDB. Dev-only. |
| Quick preview | `justbash` | `browser` | JustBash WASM in browser. Experimental. |

---

## Clean Codebase Goals

The migration is an opportunity to start fresh with a clean, well-structured codebase:

- **No dead code.** Every file has a purpose. No orphan modules, no compatibility shims.
- **No parallel implementations.** One router per domain (no `*_neon.py` + `*_local.py` duplication).
- **No god files.** auth_router_neon.py (80KB) becomes ~10 focused files. App.jsx (4,452 lines) becomes 7 hooks + thin shell.
- **Clear module boundaries.** auth/, users/, workspaces/, files/, git/, exec/ — each owns one domain.
- **Consistent patterns.** Every route: Zod input → tRPC procedure (auth + workspace context) → handler → typed response.
- **Typed end-to-end.** tRPC gives full type safety from server to client. Child apps get autocomplete.
- **TDD from day one.** Every route is written test-first using the existing smoke tests as the spec.

### TDD Methodology

The existing smoke tests define the contract. The migration follows red/green/refactor:

```
For each route family (files, git, auth, workspaces, ...):

  1. RED:   Port the smoke test assertions as Vitest unit tests against the new TS server.
            Tests call the Fastify app directly (no network, using inject()).
            Run → all fail (route doesn't exist yet).

  2. GREEN: Implement the tRPC router. Use the Python code as reference for behavior.
            Run → tests pass. Smoke tests also pass against the running server.

  3. REFACTOR: Clean up. No Python-isms. Consistent patterns. Type everything.
               Run → still green.
```

The smoke tests (`tests/smoke/`) are the **parity gate**. A route family is not done until
the existing Python smoke tests pass against the TypeScript server with zero changes to the
test code. The smoke tests use raw HTTP — they don't know or care about tRPC.

### Rock-Solid Subsystems

These subsystems must be the most reliable parts of the framework. Each gets extra
attention during migration:

#### Auth (Neon Auth integration)

The current `auth_router_neon.py` (80KB) is the highest-risk port. Split into focused units:

```
src/server/auth/
  session.ts        — JWT create/parse/validate (jose). Port of auth_session.py.
  neonClient.ts     — Neon Auth API calls (sign-up, sign-in, get-session, send-verification).
  callback.ts       — OAuth callback + pending-login token completion.
  tokenExchange.ts  — Neon JWT → boring_session cookie exchange.
  validation.ts     — redirect URL allowlisting, startup config checks.
  pages.ts          — HTML form rendering (proper templates, not string literals).
  middleware.ts     — Fastify cookie validation hook.
```

Requirements:
- Fail closed on missing config (NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL, session secret)
- Startup validation: crash if required env vars are absent (no silent fallback to local mode)
- Session cookie format unchanged (HS256 JWT, `boring_session` cookie name) so existing
  sessions survive the migration
- Redirect allowlisting: only paths on the same origin, no open redirect
- TDD: port every assertion from `smoke_neon_auth.py` as unit tests FIRST

#### Workspace Management

```
src/server/workspaces/
  router.ts         — CRUD: create, list, get, update, delete
  boundary.ts       — /w/{workspace_id}/* routing (replaces workspace_boundary_router_hosted.py)
  members.ts        — membership checks, role enforcement
  settings.ts       — per-workspace encrypted settings (pgp_sym_encrypt)
  runtime.ts        — workspace runtime state (pending/provisioning/ready/error)
  context.ts        — per-request workspace resolution (workspace_id → dir path)
  paths.ts          — path traversal prevention (port of workspace/paths.py)
```

Requirements:
- Workspace isolation: each workspace has its own directory, enforced by path validation
- Membership: every workspace-scoped operation checks user is a member (owner/editor/viewer)
- Settings encryption: workspace settings stay encrypted in DB (BORING_SETTINGS_KEY)
- Boundary routing: /w/{id}/api/v1/files/* → files router with workspace context injected
- No fly-replay: removed (no dedicated workspace machines)
- TDD: port every assertion from `smoke_workspace_lifecycle.py` as unit tests FIRST

#### User Settings

```
src/server/users/
  router.ts         — GET /me, GET /me/settings, PUT /me/settings
  service.ts        — user profile touch, settings merge
```

Requirements:
- Settings stored in Neon DB `user_settings` table (already migrated from local JSON)
- display_name stored both in DB column AND in settings JSONB (for backward compat)
- JSONDecodeError handling on corrupt JSONB
- TDD: port every assertion from `smoke_settings.py` as unit tests FIRST

#### GitHub App Integration

```
src/server/github/
  router.ts         — OAuth authorize, callback, connect, disconnect, status, repos
  service.ts        — GitHub App JWT signing, installation token exchange
  credentials.ts    — Git credential provisioning for push/pull
  proxy.ts          — Git proxy for clone/fetch through GitHub App
```

Requirements:
- GitHub App JWT signing (RS256 with private key)
- Installation token exchange (app token → installation access token)
- Git credential injection for push/pull (token-based HTTPS auth)
- OAuth popup flow (authorize → callback → postMessage to opener)
- Per-workspace GitHub connection (installation_id + repo stored in workspace_settings)
- TDD: port GitHub status/connect/disconnect smoke coverage

---

## Key Dependencies (Foundation)

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@trpc/server": "^11.x",
    "@trpc/client": "^11.x",
    "@trpc/react-query": "^11.x",
    "drizzle-orm": "^0.38.x",
    "postgres": "^3.x",
    "jose": "^5.x",
    "simple-git": "^3.x",
    "zod": "^3.x",

    "@mariozechner/pi-agent-core": "existing",
    "@mariozechner/pi-ai": "existing",
    "@mariozechner/pi-web-ui": "existing",

    "react": "^19.x",
    "dockview-react": "^4.x",
    "@tanstack/react-query": "^5.x",
    "tailwind-merge": "^3.x",
    "class-variance-authority": "^0.7.x",
    "clsx": "^2.x",
    "lucide-react": "^0.x"
  },
  "devDependencies": {
    "vitest": "^3.x",
    "typescript": "^5.x"
  }
}
```

AI SDK packages (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`) are added in a future track
when the second agent runtime is implemented. Not part of foundation dependencies.

---

## Python Implementation Reference

These are precise pointers into the existing Python codebase. The TypeScript
implementation must match this behavior exactly — the smoke tests enforce it.

### Auth Session (`auth_session.py`)

```
JWT: HS256 with boring_session secret
Fields: { sub: user_id, email: lowered, iat, exp, app_id? }
Cookie: boring_session (or boring_session_{app_id} if app_id present)
Cookie flags: httponly=true, samesite=lax, secure=config, path=/
Clock leeway: 30 seconds
Parsing: raises SessionExpired | SessionInvalid
```

Key files:
- `src/back/boring_ui/api/modules/control_plane/auth_session.py` — create/parse JWT
- Cookie name from `app_cookie_name()` — validates app_id with `^[A-Za-z0-9_-]+$`

### Exec/bwrap Sandbox (`exec/service.py`)

```
Bwrap mounts:
  --tmpfs /                          # clean root
  --proc /proc --dev /dev --tmpfs /tmp
  --ro-bind /usr /bin /lib /lib64 /sbin /etc   # system binaries (read-only)
  --bind {workspace_root} /workspace            # workspace dir (read-write)
  --chdir /workspace/{relative_cwd}
  -- sh -c {command}

Bootstrap (per workspace, once):
  1. git init + config user.email/name (inside sandbox)
  2. python3 -m venv /workspace/.venv (inside sandbox)

Environment:
  HOME=/workspace
  PATH={venv}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  VIRTUAL_ENV={home}/.venv
  PYTHONUSERBASE={home}/.local

Timeout: 60s → kill process → 5s grace → return exit_code=-1
Max output: 512KB truncated
Fallback: plain subprocess.run when bwrap not installed (local dev)
```

Key file: `src/back/boring_ui/api/modules/exec/service.py`
- `_build_sandbox_argv()` line 82 — exact bwrap flag construction
- `_ensure_workspace_bootstrapped()` line 44 — bootstrap sequence
- `execute_command()` line 132 — main entry point with timeout handling

### Token Exchange (`auth_router_neon.py`)

```
POST /auth/token-exchange
  Input: { access_token } or { session_token }
  Steps:
    1. Get JWT from Neon Auth: GET {neon_base}/token
    2. Verify JWT via JWKS (EdDSA):
       - JWKS URL: config.neon_auth_jwks_url or {neon_base}/.well-known/jwks.json
       - Audience: urlparse(neon_base) → scheme://netloc
    3. Extract user_id (sub) and email
    4. Sync user to DB: INSERT INTO users (id, email) ON CONFLICT DO UPDATE
    5. Create boring_session cookie (HS256, app_id from config)
    6. Set cookie on response
    7. Eager workspace provision: create default workspace if none exists
  Output: { ok, redirect_uri, workspace_id? } + Set-Cookie header
```

Key functions in `auth_router_neon.py`:
- `_validate_neon_jwt()` ~line 1724 — JWKS verification
- `_issue_session_response()` ~line 257 — cookie creation
- `_eager_workspace_provision()` ~line 322 — default workspace creation

### Workspace Creation (`workspace_router_hosted.py`)

```
create_workspace_for_user(pool, app_id, user_id, name, is_default=False)
  Transaction:
    1. INSERT INTO users (id, email) ON CONFLICT DO NOTHING  — FK sync
    2. INSERT INTO workspaces (name, app_id, created_by) RETURNING id
       If is_default: ON CONFLICT (created_by, app_id) WHERE is_default DO NOTHING
    3. INSERT INTO workspace_members (workspace_id, user_id, 'owner') ON CONFLICT DO NOTHING
    4. INSERT INTO workspace_runtimes (workspace_id, 'pending') ON CONFLICT DO NOTHING
  Returns: (workspace_id: str, created: bool)

Post-creation:
  ensure_workspace_root_dir(config.workspace_root, workspace_id)
    → mkdir {workspace_root}/{workspace_id}
```

Key file: `src/back/boring_ui/api/modules/control_plane/workspace_router_hosted.py`
- `create_workspace_for_user()` ~line 120

### Workspace Boundary Routing (`workspace_boundary_router_hosted.py`)

```
/w/{workspace_id}/{path} → internal ASGI forward to /{path}
  Auth: require workspace membership (DB lookup)
  Injected headers: x-workspace-id={workspace_id}
  Allowed paths: /api/v1/files, /api/v1/git, /api/v1/ui, /api/v1/me, etc.
  Blocked: reserved subpaths (setup, runtime, settings — handled specially)
  Browser: text/html Accept → serve SPA index.html
  Static assets: /assets/*, /fonts/* served without auth
```

Key file: `src/back/boring_ui/api/modules/control_plane/workspace_boundary_router_hosted.py`
- `_WORKSPACE_PASSTHROUGH_ROOTS` line 24 — allowed path prefixes
- `_forward_http_request()` line 159 — ASGI transport forwarding
- In TypeScript: replace with tRPC context + middleware (no internal HTTP proxy needed)

### GitHub App (`github_auth/service.py`)

```
GitHubAppService:
  JWT signing: RS256 with private key
    payload: { iat: now-60, exp: now+600, iss: app_id }
    Backdate 60s for clock skew

  Installation token: POST /app/installations/{id}/access_tokens
    Header: Authorization: Bearer {app_jwt}
    Cache: thread-locked, refresh 5 min before expiry
    Response: { token, expires_at (ISO-8601) }

  Git credentials: { username: "x-access-token", password: {installation_token} }
```

Key file: `src/back/boring_ui/api/modules/github_auth/service.py`
- `_make_jwt()` line 50 — RS256 JWT construction
- `get_installation_token()` line 155 — cached token retrieval
- `get_git_credentials()` line 192 — credential format

### Capabilities (`capabilities.py`)

```
GET /api/capabilities
  Response: {
    version, features: {}, agents: [], agent_mode, agent_default,
    routers: [{ name, prefix, description, tags, enabled }],
    auth: { provider, neonAuthUrl, callbackUrl, emailProvider, verificationEmailEnabled },
    workspace_runtime: { placement, agent_mode }  // if backend mode
  }
```

Key file: `src/back/boring_ui/api/capabilities.py`
- `create_default_registry()` line 103 — registers all routers
- `build_capabilities_response()` ~line 215 — assembles full payload
- In TypeScript: simplify to logical sections (agent, workspace, features, auth)

### Config Loading (`config.py` + `app_config_loader.py`)

```
Env var precedence:
  Session secret: BORING_UI_SESSION_SECRET → BORING_SESSION_SECRET → auto-generate
  Agents mode: BUI_AGENTS_MODE → AGENTS_MODE → boring.app.toml [agents].mode → "frontend"
  Workspace root: BORING_UI_WORKSPACE_ROOT → BUI_WORKSPACE_ROOT → boring.app.toml parent dir

__post_init__ auto-detection:
  1. Generate session secret if missing
  2. Normalize passthrough roots
  3. Validate GitHub slug and public origin
  4. Disable control_plane if agents_mode=="backend" && no DATABASE_URL
  5. Auto-enable neon provider if NEON_AUTH_BASE_URL is set
  6. Normalize agent configs
```

Key files:
- `src/back/boring_ui/api/config.py` — APIConfig dataclass, all fields and __post_init__
- `src/back/boring_ui/app_config_loader.py` — boring.app.toml parsing + workspace_root resolution
