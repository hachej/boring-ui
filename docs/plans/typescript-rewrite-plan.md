# boring-ui TypeScript Rewrite Plan

## Overview

Rewrite the boring-ui backend from Python/FastAPI to TypeScript/Fastify+tRPC.
Collapse 3 deployment modes into 1 server with a plug-and-play architecture:
pick a workspace backend, pick an agent runtime. Two config fields, that's it.

## Architecture

### Two Config Fields

```toml
[workspace]
backend = "bwrap"         # "lightningfs" | "justbash" | "bwrap"

[agent]
runtime = "ai-sdk"        # "pi" | "ai-sdk"
```

One deployment. One server. Everything else derives from these two fields.

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

### Agent Runtimes (2 options, pluggable)

| Runtime | LLM runs | API key | Frontend component |
|---------|----------|---------|-------------------|
| `pi` | In browser (PI agent) | User provides in browser | `PiNativeAdapter` (existing) |
| `ai-sdk` | On server (AI SDK streamText) | Server env var | `AiChat` (new, useChat hook) |

### The Full Matrix (6 valid combinations)

| `backend` | `runtime` | What happens | Best for |
|-----------|-----------|-------------|----------|
| `lightningfs` | `pi` | Everything in browser. Zero server exec. | Offline dev, demos |
| `lightningfs` | `ai-sdk` | Files in browser, LLM on server. | Managed demo |
| `justbash` | `pi` | JustBash WASM in browser. User's API key. | Quick sandboxed previews |
| `justbash` | `ai-sdk` | JustBash WASM in browser, LLM on server. | Lightweight managed preview |
| `bwrap` | `pi` | Real sandbox on server. User's API key. | Self-serve production |
| `bwrap` | `ai-sdk` | Real sandbox + LLM on server. Full managed. | Production, headless agents |

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

### Agent Panel: Pluggable

```tsx
function AgentPanel({ workspaceId }) {
  const config = useRuntimeConfig()
  if (config.agent.runtime === 'ai-sdk') {
    return <AiChat workspaceId={workspaceId} />
  }
  return <PiNativeAdapter workspaceId={workspaceId} />
}
```

### Agent Tools: 2 Tools Only

The LLM gets two tools. Bash covers everything — files, git, system ops.
UI endpoints (files, git) are separate tRPC routes for the React panels.

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

### Stack

```
Backend:   Fastify + tRPC + Drizzle + jose
           + bwrap (system package, already in Dockerfile)
           + AI SDK (when runtime = "ai-sdk")
Frontend:  React + Vite + TailwindCSS + shadcn + DockView
           + LightningFS + isomorphic-git + Pyodide (when backend = "lightningfs")
           + JustBash (when backend = "justbash")
           + PI (@mariozechner/pi-*) (when runtime = "pi")
           + useChat (@ai-sdk/react) (when runtime = "ai-sdk")
Database:  Neon PostgreSQL (same as today)
Auth:      Neon Auth (same as today) + jose for JWT
```

### What Gets Deleted

```
DELETED (Python backend):
  src/back/                          # entire Python backend
  src/pi_service/                    # Node.js sidecar (PI backend mode no longer needs separate process)
  src/companion_service/             # orphan
  src/test/                          # orphan (tests/ is the real test dir)
  pyproject.toml, uv.lock           # Python packaging
  deploy/fly/fly.backend-agent.toml  # no backend mode
  deploy/fly/fly.workspaces.toml     # no workspace machines
  deploy/fly/fly.control-plane.toml  # no control plane split

DELETED (legacy surfaces):
  src/front/panels/TerminalPanel.jsx          # Claude terminal pane
  src/front/panels/ShellTerminalPanel.jsx     # shell pane
  src/front/components/Terminal.jsx           # terminal component
  src/front/components/chat/ClaudeStreamChat.jsx  # Claude streaming chat (replaced by AiChat)
  src/front/providers/pi/backendAdapter.jsx   # PI backend adapter (server-side PI via sidecar)
```

### What Stays (frontend, mostly unchanged)

```
KEPT:
  src/front/App.jsx                    # split into hooks
  src/front/panels/FileTreePanel.jsx   # same, switches from httpProvider to tRPC
  src/front/panels/EditorPanel.jsx     # same
  src/front/panels/ReviewPanel.jsx     # same (if approval stays)
  src/front/panels/AgentPanel.jsx      # pluggable: renders PI or AiChat based on config
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

ADDED (AI SDK — server agent runtime):
  src/front/components/chat/AiChat.tsx        # useChat() wrapper (used when runtime = "ai-sdk")
  src/server/agent/chat.ts                    # streamText endpoint
  src/server/agent/tools.ts                   # server-side tool definitions
```

### Pluggable Subsystems

Two config fields, two pluggable axes:

```
[workspace]
backend = "lightningfs" | "justbash" | "bwrap"   # workspace backend (3 options)

[agent]
runtime = "pi" | "ai-sdk"                        # agent runtime (2 options)
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

Pluggable at the panel level — one component renders, the other is tree-shaken out:

```tsx
function AgentPanel({ workspaceId }) {
  const { runtime } = useRuntimeConfig().agent
  if (runtime === 'ai-sdk') return <AiChat workspaceId={workspaceId} />
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

### Phase 1: Scaffold + Core Infrastructure (days 1-2)

```
1. Initialize TypeScript project
   - package.json with Fastify, tRPC, Drizzle, AI SDK, JustBash, jose, simple-git, zod
   - tsconfig.json
   - Drizzle config pointing at existing Neon DB

2. Set up Fastify app with tRPC
   - src/server/app.ts — Fastify factory with tRPC plugin
   - src/server/trpc.ts — context, publicProcedure, protectedProcedure, workspaceProcedure
   - src/server/config.ts — read boring.app.toml + env vars

3. Auth middleware
   - src/server/auth/session.ts — JWT create/parse with jose (port auth_session.py)
   - src/server/auth/middleware.ts — cookie validation hook

4. Workspace context
   - src/server/workspace/context.ts — resolve workspace dir from ID
   - src/server/workspace/paths.ts — path traversal prevention (port paths.py)

5. Database
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

### Phase 2: Files + Git + Exec (days 3-5)

```
1. Files router (7 routes)
   - Port file operations from FileService (service.py) to fs/promises
   - Same path validation, same response shapes
   - Test: smoke_filesystem.py should pass against new server

2. Git router (16 routes)
   - Port from subprocess_git.py to simple-git library
   - Same response shapes
   - Test: smoke_git_sync.py should pass

3. Exec router (2 routes — JustBash + Monty)
   - NEW: JustBash workspace runner pool
   - NEW: Monty workspace runner pool
   - Per-workspace instances with ReadWriteFs scoped to workspace dir
   - Test: exec_bash tool calls from smoke tests

4. Static file serving
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

### Phase 7: Cutover + Cleanup (days 17-18)

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

4. Update boring.app.toml
   - New [workspace] isolation field
   - New [agent] runtime field (pi | ai-sdk)
   - Remove legacy agents.mode, agents.pi
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

### New Tests
```
tests/unit/exec.test.ts         — JustBash isolation (can't escape workspace dir)
tests/unit/monty.test.ts        — Monty isolation (can't access host filesystem)
tests/unit/auth.test.ts         — JWT session round-trip, cookie parsing, JWKS verification
tests/unit/workspace.test.ts    — path traversal prevention, workspace dir creation
tests/unit/trpc.test.ts         — tRPC router integration tests (with test DB)
tests/unit/config.test.ts       — startup validation (missing env vars fail fast)
tests/unit/capabilities.test.ts — contract shape (no legacy names, logical sections)
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
runtime = "ai-sdk"      # "pi" | "ai-sdk"
model = "claude-sonnet-4-5-20250929"  # only used when runtime = "ai-sdk"

[auth]
provider = "neon"
session_cookie = "boring_session"
session_ttl = 86400

[deploy]
platform = "fly"
```

### Config Combinations

| Use case | `backend` | `runtime` | Description |
|----------|-----------|-----------|-------------|
| **Offline dev** | `lightningfs` | `pi` | Everything in browser. IndexedDB + isomorphic-git. User brings API key. |
| **Quick preview** | `justbash` | `pi` | JustBash WASM in browser. Instant, lightweight, no persistence. |
| **Managed preview** | `justbash` | `ai-sdk` | JustBash in browser, LLM on server. Platform provides API key. |
| **Self-serve production** | `bwrap` | `pi` | Real sandbox on server. User brings API key. Cheapest hosted. |
| **Full managed production** | `bwrap` | `ai-sdk` | Real sandbox + LLM on server. Most capable. Headless agents possible. |
| **Headless / webhooks** | `bwrap` | `ai-sdk` | Required for Telegram/Slack bots, scheduled tasks, headless API. |

---

## Key Dependencies

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@trpc/server": "^11.x",
    "@trpc/client": "^11.x",
    "@trpc/react-query": "^11.x",
    "drizzle-orm": "^0.38.x",
    "postgres": "^3.x",
    "justbash": "^0.x",
    "jose": "^5.x",
    "simple-git": "^3.x",
    "zod": "^3.x",

    "ai": "^4.x",
    "@ai-sdk/anthropic": "^1.x",
    "@ai-sdk/openai": "^1.x",
    "@ai-sdk/react": "^1.x",

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
  }
}
```

PI packages are kept for `runtime = "pi"`. AI SDK packages are added for `runtime = "ai-sdk"`.
Both are always installed — the runtime config determines which path is active.
Tree-shaking in the Vite build ensures only the active runtime's code ships to the browser.
```
