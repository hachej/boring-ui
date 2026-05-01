# @boring/agent — Package Spec

**Status:** draft — interview-driven, architecture locked 2026-04-22
**Path:** `boring-ui-v2/packages/agent/`

> **Note (2026-Q2):** The pi-tools migration
> (`docs/plans/pi-tools-migration.md`, epic `boring-ui-v2-uhwx`)
> supersedes the original hand-rolled catalog design. Decisions #4 and #6
> below are updated in place: standard tools now come from pi factories plus
> Operations adapters, and dedicated `find`/`grep`/`ls` tools are part of the
> baseline surface.

## Execution Tracker (2026-04-24)

Use this section as the handoff ledger for ongoing plan execution.

### Pass 2 — Full milestone verification + fixes (2026-04-24)

- Methodology: Three parallel verification agents compared every M0-M3b milestone item against actual source files, reading implementations line-by-line. M4/M5 checked manually.
- **Result: M0-M3b fully complete. M4 partially complete. M5 partially complete.**
- All milestone checkboxes updated in the roadmap section below.
- Fixes applied in this pass:
  1. **`src/shared/index.ts` barrel export populated** — was empty (just a comment). Now re-exports all 12 shared interface modules (harness, workspace, sandbox, tool, catalog, session, message, ui-bridge, file-search, sandbox-handle-store, config-schema, error-codes).
  2. **`src/shared/harness.ts` stale stubs replaced** — had local `type UIMessageChunk = unknown` and empty `interface SessionStore {}`. Now properly imports from `./message` and `./session`.
  3. **Test mocks updated** — `chat.test.ts` and `sessionChanges.test.ts` mock harnesses updated to satisfy the now-concrete `SessionStore` type and cast chunks to `UIMessageChunk`.
- Verification: `tsc --noEmit` clean, 782/782 tests pass.
- Remaining work (M4/M5):
  - M4: Plugin name-collision precedence documentation, community extension smoke tests, vercel-sandbox plugin doc
  - M5: `registerTool()` runtime API, API docs, migration guide

### Pass 1 — qnxc bugfix (2026-04-24)

- `DONE` `boring-ui-v2-qnxc` (P1 bug): refresh/history hydration regression fixed and closed.
  - Commit: `764eda6` (`fix(agent): hydrate refresh history via messages route (boring-ui-v2-qnxc)`).
  - Cross-review: Claude verdict `ship`.
  - Contract now enforced:
    - `GET /api/v1/agent/chat/:sessionId/stream` resumes only active streams; returns `204` when none are active.
    - `GET /api/v1/agent/chat/:sessionId/messages` hydrates full persisted `UIMessage[]` (user + assistant).
    - `useAgentChat` hydrates from `/messages` on mount/session switch (cache fallback retained).
- Verification run: `pnpm --dir packages/agent test` + `pnpm --dir packages/agent lint`.

---

## Goal

Host a Pi coding agent in a web app **and ship as a CLI**.

- **Ships as CLI (primary product shape).** `npx @boring/agent` in any directory → local backend + browser chat, zero setup, zero deploy. Same product surface as Claude Code, self-hostable, backed by pi-coding-agent.
- **Embeddable as a library.** The sibling `@boring/workspace` package composes `<ChatPanel />` into a full-layout repo. Custom apps import the primitives and build their own UX.
- **Location-agnostic workspace.** Files can live on the backend machine OR inside a remote Firecracker VM. Swapping is an adapter change — frontend, agent tools, harness, UI unchanged.

v1 ships **three execution modes** behind identical interfaces:

1. **Direct** — `NodeWorkspace` + `DirectSandbox`. Files on the backend machine; bash via `child_process.exec` with `cwd` pinned. **No isolation** — trust-the-user mode. For local dev on macOS (no bwrap), small self-host, or "just run it on my cwd" workflows. Zero Linux dependency.
2. **Local** — `NodeWorkspace` + `BwrapSandbox`. Files on the backend machine, bash inside bwrap. PaaS-deployable (Fly, Render, Railway, any Docker host with bubblewrap). Safer default for untrusted commands.
3. **Remote** — `VercelSandboxWorkspace` + `VercelSandboxExec`. Files and bash inside a Vercel Firecracker microVM. Backend is a thin orchestrator. Multi-tenant-safe, PaaS-backend-agnostic.

Each mode exposes **identical** HTTP endpoints, the **same** agent tool shapes, and the **same** chat UI. One config knob picks the mode per app.

## Non-goals (v1)

- **Multi-workspace management — owned by the future `@boring/cloud` package.** Agent runs **one workspace per instance**; `workspaceId` is a configured constant or env var. No workspace CRUD, no workspace switcher UI, no per-user provisioning in the agent package.
- Multi-user auth, billing, team features.
- Full session list sidebar UI — agent ships a lightweight toolbar (current-session + switch) and the headless `useSessions()` hook. Rich session UX (persistent sidebar, folder organization, search) is a workspace-package concern.
- FS panes, file tree, editor — those live in `@boring/workspace`. (The agent package *exposes* the HTTP endpoints that power them.) Git UI is **dropped from workspace v1**; when it returns in v1.x, agent will add `/api/v1/git/*` thin-wrapper routes.
- Cloud/edge deployment tooling.
- Browser-agent implementation — interface stays runtime-agnostic but no browser harness yet.
- Non-Anthropic model providers.
- MCP tool integration.
- Third sandbox options (Boxlite, @vercel/sandbox-only-for-isolated-code, Cloudflare Sandbox) — designed as seams, not shipped.

---

## Central model — two layers

The package has **two layers**. Treat the boundary as load-bearing.

### Layer 1 — Core runtime (4 abstractions, interfaces locked in v1)

**Harness · Catalog · Workspace · Sandbox.** These define *how* the agent executes tools. Interfaces are stable; adapter implementations swap per mode (direct / local / vercel-sandbox). Changing a Layer-1 interface is a breaking change.

### Layer 2 — Integration services (3 replaceable plumbing pieces)

**SessionStore · UiBridge · WorkspaceProvisioning.** Plumbing that connects the runtime to a host app. Each is an interface in `shared/` with a default impl; consumers inject alternatives via `createAgentApp({ sessionStore, uiBridge, ... })`. Evolving a service impl (or adding a new one) doesn't touch Layer 1.

*(Pi plugins are a separate concern — user-installable catalog extensions that add tools at load time. They live alongside Layer 1 tools, not as their own layer. See the Plugin compat section.)*

---

The four Layer-1 abstractions are independent (Harness + Catalog swap freely; Workspace + Sandbox swap as a paired `RuntimeModeAdapter`); they connect only in the direction shown. (Environment provisioning — files and library tiers — is Layer-2 plumbing, not part of the runtime diagram.)

```
  ┌──────────────┐
  │   Harness    │  agent loop: LLM round-trip, tool-call protocol,
  │              │  stream emission (UIMessage parts for useChat)
  └──────┬───────┘
         │ consumes AgentTool[] only
         ▼
  ┌──────────────┐
  │   Catalog    │  named, typed tool set visible to the LLM:
  │   (Tools)    │  bash, read, write, edit, find, grep, ls
  └──────┬───────┘
         │ each tool binds to EITHER Workspace or Sandbox
         ▼
  ┌──────────────┐     ┌──────────────┐
  │  Workspace   │     │   Sandbox    │
  │              │     │              │
  │  path-bound  │     │ shell exec   │
  │  fs ops      │     │ only         │
  │              │     │              │
  │  read/write/ │     │  exec(cmd)   │
  │  readdir/    │     │              │
  │  stat        │     │              │
  └──────────────┘     └──────────────┘
   read/write/edit        bash
   call into here         calls into here
```

Two implementation layers sit side by side under the catalog because they have different security profiles:

- **Workspace** = fs ops scoped to a project root. For local adapter: direct Node `fs` + strict path enforcement (follow nao's pattern: `validatePath` + `assertRealPathWithinWorkspace`). For remote adapter: API call to the sandbox's fs primitive with the same path checks. No VM overhead for local reads because caller is always our own code — user input never reaches a shell via these paths.
- **Sandbox** = shell exec only. Real isolation matters here; bound to bwrap or Vercel Firecracker VM.

**Key invariants:**
- **Harness is sandbox-agnostic AND workspace-agnostic.** It sees `AgentTool[]` only.
- **Sandbox is workspace-agnostic** from the catalog's perspective. Swap sandbox → fs tools unchanged.
- **Workspace is sandbox-agnostic** from the catalog's perspective. Swap workspace → bash tool unchanged.
- **Pairing rule:** when workspace is remote (e.g. `VercelSandboxWorkspace`), the sandbox MUST target the **same underlying VM instance** — otherwise the agent's `bash` would see a different fs than the workspace tools. Enforced at adapter construction (`createVercelSandboxExec(sandbox)` takes the same `sandbox` handle the workspace uses). Local pairings (`NodeWorkspace` + `BwrapSandbox`) naturally share the host fs via bind-mount.
- **Swappability**: Harness and Catalog swap independently. Workspace and Sandbox swap as a **validated pair via `RuntimeModeAdapter`** — they must share a filesystem substrate (agent writes via Workspace and reads via Sandbox.exec; mismatched pair ⇒ split-brain). Pair members stay interface-decoupled; construction is joint.

### In one snippet — local mode

```ts
const workspace = createNodeWorkspace({ root: resolveWorkspacePath(cfg.root, sessionWorkspaceId) })
const sandbox   = createBwrapSandbox({ workspace })
const bundle    = { workspace, sandbox }
const tools     = [...buildHarnessAgentTools(bundle), ...buildFilesystemAgentTools(bundle)]
const harness   = createPiCodingAgentHarness({ tools })
```

### In one snippet — remote mode (Vercel)

```ts
const vmHandle  = await resolveSandboxHandle(sessionWorkspaceId)    // Sandbox.get() or Sandbox.create()
const workspace = createVercelSandboxWorkspace(vmHandle)
const sandbox   = createVercelSandboxExec(vmHandle)                 // same handle — pairing rule
const bundle    = { workspace, sandbox }
const tools     = [...buildHarnessAgentTools(bundle), ...buildFilesystemAgentTools(bundle)]
const harness   = createPiCodingAgentHarness({ tools })
```

Identical `tools` + `harness` construction. Only the workspace/sandbox pair differs.

---

## Unified workspace access — one interface, two consumers

**This is the architectural keystone.** Both the HTTP routes that power the frontend (FileTree, Editor, GitChanges) and the agent tools (read/write/edit) consume the *same* `Workspace` interface. Neither has its own fs logic.

```
                ┌────────────────────────┐
                │  Workspace interface   │
                │  readFile, writeFile,  │
                │  readdir, stat, unlink │
                └───────────┬────────────┘
                            │
             ┌──────────────┼──────────────┐
             │                             │
             ▼                             ▼
        HTTP routes                  Agent tools
        (frontend UI)                (LLM-facing)
        /api/v1/files GET            readTool
        /api/v1/files POST           writeTool
        /api/v1/tree GET             editTool
        /api/v1/stat GET
             │                             │
             │ thin wrappers:              │ thin wrappers:
             │ auth + call workspace.X     │ schema + call workspace.X
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │   Workspace adapter         │
              │  (swappable, async)         │
              ├─────────────────────────────┤
              │  NodeWorkspace (local)      │
              │  VercelSandboxWorkspace     │
              └─────────────────────────────┘
```

### Why this matters

- **No split-brain:** the user cannot see a file the agent can't, or vice-versa. One fs, two interfaces onto it.
- **Location-agnostic migration:** switching `NodeWorkspace → VercelSandboxWorkspace` changes what the FileTree reads AND what the agent reads — simultaneously, from one config change.
- **One place to validate paths, check permissions, enforce boundaries** — the adapter. Routes and tools never reimplement.

### Example: identical handlers, different consumers

```ts
// HTTP route (used by FileTree / Editor in the frontend)
app.get('/api/v1/tree', async (req, reply) => {
  const workspace = await resolveWorkspace(req.query.workspaceId, req.auth)
  return workspace.readdir(req.query.path ?? '')
})

// Agent tool (used by LLM)
export const readTool = (workspace: Workspace): AgentTool => ({
  name: 'read',
  description: 'Read a file from the workspace',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
  async execute({ path }) {
    return { content: [{ type: 'text', text: await workspace.readFile(path) }] }
  },
})
```

Both call `workspace.X()`. No fs-specific logic in either. **The adapter is where the location-choice lives.**

### HTTP API reference (canonical)

This table is the **single source of truth** for agent ↔ frontend HTTP contracts. Every route is a thin wrapper over a typed service call — no fs-specific logic in handlers. Other sections (Session management, UI bridge, Package layout) reference this table instead of restating routes.

| Route | Method | Handler body | Service call |
|---|---|---|---|
| **Files & tree** | | | |
| `/api/v1/tree` | GET | auth + validate | `workspace.readdir(path)` |
| `/api/v1/files` | GET | auth + validate | `workspace.readFile(path)` |
| `/api/v1/files` | POST | auth + validate + body | `workspace.writeFile(path, body)` |
| `/api/v1/files` | DELETE | auth + validate | `workspace.unlink(path)` (file or empty dir) |
| `/api/v1/files/search` | GET | auth + `?q=<glob>&limit=<n>` | `fileSearch.search(glob, limit)` — default impl uses `sandbox.exec('find . -name …')`; browser adapter does fs-walk |
| `/api/v1/files/move` | POST | auth + body `{from, to}` | `workspace.rename(from, to)` — handles drag-and-drop move AND in-place rename (same op; UI just differs). |
| `/api/v1/dirs` | POST | auth + body `{path, recursive?}` | `workspace.mkdir(path, {recursive})` — create new folder. |
| `/api/v1/stat` | GET | auth + validate | `workspace.stat(path)` |
| **Agent chat & sessions** | | | |
| `/api/v1/agent/chat` | POST | auth + body `{sessionId, message, …}` | resolves workspace + sandbox pair via `RuntimeModeAdapter`, runs harness with the catalog. Returns UIMessage stream. |
| `/api/v1/agent/chat/:sessionId/:turnId` | GET (SSE) | auth + `?cursor=<n>` | stream resume (transport-owned). Replays from ring buffer if in-flight, from `SessionStore` if turn completed. |
| `/api/v1/agent/sessions` | GET | auth | `SessionStore.list()` → `SessionSummary[]` (within configured workspace) |
| `/api/v1/agent/sessions` | POST | auth | `SessionStore.create()` → `SessionSummary` |
| `/api/v1/agent/sessions/:id` | GET | auth | `SessionStore.load(id)` → `SessionDetail` |
| `/api/v1/agent/sessions/:id` | DELETE | auth | `SessionStore.delete(id)` → 204 |
| `/api/v1/agent/sessions/:id/changes` | GET | auth | `{files: [{path, op, size}]}` since session start |
| **UI bridge** | | | |
| `/api/v1/ui/state` | GET/PUT | auth | read / write UI state blob (workspace-defined shape). Workspace PUTs with `causedBy` field. |
| `/api/v1/ui/state/latest` | GET | auth | cached state snapshot for short-poll fallback (same shape as GET /state, separate endpoint for polling clients) |
| `/api/v1/ui/commands` | POST | auth | agent posts command for UI. `{kind: 'openFile', params: {...}}` — camelCase `kind` field. Returns `{seq, status: 'ok'\|'error'}`. |
| `/api/v1/ui/commands/next` | GET (SSE or poll) | auth | Default: SSE; streams `event: command` with `{v:1, kind, params, seq}`. With `?poll=true`: returns a batch of pending commands as JSON `{commands: [...]}` — short-poll fallback (~2s cadence) for environments where SSE is unavailable. |
| **Explicitly not in v1** | | | |
| ~~`/api/v1/git/*`~~ | — | Dead code in v1 (no consumer) — see note below. Agent runs git internally via `bash`. | — |
| ~~`/api/v1/workspaces`~~ | — | Workspace CRUD / multi-workspace provisioning owned by `@boring/cloud`. Agent v1 is single-workspace-per-instance. | — |
| ~~Rename session~~ | — | Deferred to workspace package. Delete ships in v1. | — |

**Git routes deferred from v1.** The workspace plan explicitly drops all git UI ("Git UI in workspace: Dropped entirely. Agent owns all git UI."). Agent v1 also doesn't ship git UI components (no status bar, no diff pane — chat + session toolbar only). **With no consumer in v1, the routes would be dead code.** Agent runs git internally via the `bash` tool (`sandbox.exec('git status')`) when needed. When git UI lands (agent v1.x adding a status/diff pane, or workspace reviving git badges), add the routes as ~200 LOC of thin `sandbox.exec` wrappers with output parsing. Git in remote mode (credentials via token-in-URL, latency, VM persistence) is documented here so we're ready when we need it; not implemented in v1.

Every route's file-system behavior is determined entirely by the adapter chosen at `resolveWorkspace(workspaceId)`. Flip the adapter → all routes flip together. Zero duplicated fs logic.

### Invariants to preserve

1. **No `node:fs` / `node:child_process` imports in routes, catalog, or tools.** These Node APIs are allowed only inside adapter implementations (`server/workspace/**`, `server/harness/**`, `server/sandbox/**`, `server/runtime/**`). Grep-enforceable.
2. **Routes and tools both receive `Workspace` as a parameter** (not a path, not a root dir). Resolution to a specific adapter is the job of `resolveWorkspace(workspaceId)` — centralized.
3. **Per-request, agent tools and HTTP routes share the same adapter instance.** Ensures a read concurrent with a write sees each other's effects without cache-coherence games.
4. **Path validation is the adapter's responsibility.** Consumers pass user-supplied paths; the adapter rejects `../` / absolute / symlink-escape attacks internally.

This is what makes **"user workspace"** and **"agent workspace"** literally the same workspace — not by convention, but by construction.

---

## The four abstractions, spelled out

### 1. Harness (`src/shared/harness.ts`)

```ts
export interface AgentHarness {
  readonly id: string                                  // 'pi-coding-agent' | 'pi-agent-core' | 'tool-loop'
  readonly placement: 'server' | 'browser'

  /** Send a user message. Yields AI SDK UIMessage stream chunks. */
  sendMessage(
    input: SendMessageInput,
    ctx: RunContext,
  ): AsyncIterable<UIMessageChunk>

  /** Session lifecycle; may delegate to an underlying runtime (e.g. pi's JSONL). */
  sessions: SessionStore
}

/* Resume is NOT a harness concern — see "Stream resumption" section.
   The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware. */

export interface SendMessageInput {
  sessionId: string
  message: string                    // user's prompt
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  model?: { provider: string; id: string }
}

export interface RunContext {
  abortSignal: AbortSignal
  workdir: string
  userId?: string
}
```

### 2. Catalog & Tools (`src/shared/tool.ts`, `src/shared/catalog.ts`)

```ts
export interface AgentTool {
  name: string
  description: string
  parameters: JSONSchema
  execute(
    params: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<ToolResult>
}

export interface ToolExecContext {
  abortSignal: AbortSignal
  toolCallId: string
  onUpdate?: (partial: string) => void
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  details?: unknown
}

export interface CatalogDeps {
  workspace: Workspace
  sandbox: Sandbox
  uiBridge?: UiBridge          // optional; when present, catalog includes get_ui_state + exec_ui tools
  fileSearch?: FileSearch      // optional; used by routes but not exposed as an agent tool
}

/** A catalog binds to workspace, sandbox, and optional integration services. */
export type ToolCatalog = (deps: CatalogDeps) => AgentTool[]
```

Shipped runtime tool bundle (pi factories + Operations adapters + capability-gated custom tools):

```ts
const tools: AgentTool[] = [
  ...buildHarnessAgentTools(bundle),      // bash, plus execute_isolated_code when supported
  ...buildFilesystemAgentTools(bundle),   // read, write, edit, find, grep, ls
]
```

- **7 standard pi tools always:** `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`.
- **Operations adapters own backend behavior:** local/direct use `boundFs` and local bash ops; Vercel mode swaps in Vercel-backed Operations.
- **Custom AgentTools stay exceptional:** `execute_isolated_code` is capability-gated; `vercelGrepTool` exists only because pi's grep Operations seam cannot redirect its `rg` spawn into the remote VM while keeping pi's name, description, and schema.
- **2 UI bridge tools when `uiBridge` is wired** (default in v1):
  - `get_ui_state()` → returns current UI state blob
  - `exec_ui({ kind, params })` → generic dispatcher; kinds enumerated in tool description (`openFile`, `openPanel`, `showNotification`, extensible)

**Why `exec_ui` instead of one tool per command:** one UI dispatcher keeps host integration extensible without adding a new tool for every UI action (new kind values = schema enum addition), and it matches how the underlying bridge `POST /api/v1/ui/commands` already works. The kind enum is published on the tool's `parameters` so the LLM knows valid commands.

### 3. Workspace (`src/shared/workspace.ts`)

Path-scoped fs ops. Interface is platform-agnostic so a future browser impl (OPFS / IndexedDB) can satisfy it.

```ts
export interface Workspace {
  readonly root: string                           // absolute path or opaque URI (browser)
  readFile(relPath: string): Promise<string>
  writeFile(relPath: string, data: string): Promise<void>
  unlink(relPath: string): Promise<void>          // removes a file OR an empty directory
  readdir(relPath: string): Promise<Entry[]>
  stat(relPath: string): Promise<Stat>
  mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void>
  rename(fromRelPath: string, toRelPath: string): Promise<void>   // handles drag-to-move and in-place rename
  /** Throws if any relPath escapes the workspace root. */
}

// Separate interface — search can use exec (find) OR fs-walk, depending on environment.
// Uncouples "what the Workspace guarantees" (path-bound fs primitives) from "how we find files".
export interface FileSearch {
  search(glob: string, limit?: number): Promise<string[]>
}

export interface Entry { name: string; isDir: boolean }
export interface Stat  { isDir: boolean; size: number; mtime: Date }
```

Server impl (`createNodeWorkspace`) uses existing boring-ui helpers — port `validatePath`, `assertRealPathWithinWorkspace`, `ensureWritableWorkspacePath` from `packages/workspace/src/server/workspace/paths.ts` straight into `src/server/workspace/paths.ts` in this package.

Workspace creation accepts an optional `templatePath` — if set, contents are copied into the workspace root synchronously on first creation (see [Environment provisioning](#environment-provisioning)). No abstraction layer in v1; upgrade path documented.

### 4. Sandbox (`src/shared/sandbox.ts`)

Narrow interface for shell exec + optional richer capabilities advertised via `capabilities`.

```ts
export interface Sandbox {
  readonly id: string                     // 'bwrap' | 'boxlite' | '@vercel/sandbox' | 'just-bash' | …
  readonly placement: 'server' | 'browser'
  readonly capabilities: readonly SandboxCapability[]

  init(ctx: { workspace: Workspace; sessionId: string }): Promise<void>

  // Always available (capability 'exec'):
  exec(
    cmd: string,
    opts?: ExecOptions,
  ): Promise<ExecResult>

  // Optional — present iff capabilities includes 'isolated-code':
  executeIsolatedCode?(input: IsolatedCodeInput): Promise<IsolatedCodeOutput>

  dispose?(): Promise<void>
}

export type SandboxCapability = 'exec' | 'isolated-code'

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number           // hard timeout; kills the child process
  maxOutputBytes?: number      // per-stream cap; output beyond this is truncated
  onHeartbeat?: (elapsedMs: number) => void   // called every 2s during active exec
}

export interface ExecResult {
  stdout: Uint8Array           // raw bytes; server adapter decodes
  stderr: Uint8Array
  exitCode: number
  durationMs: number
  truncated: boolean           // true if maxOutputBytes was hit
  stdoutEncoding?: 'utf-8' | 'binary'   // best-effort classification for UI rendering
  stderrEncoding?: 'utf-8' | 'binary'
}
// Decode helpers live in server adapters, not the shared contract.

export interface IsolatedCodeInput {
  code: string
  language: 'python' | 'shell'
  image?: string             // e.g. 'python:3.12-slim' — sandbox-defined set
  packages?: string[]        // installed before run (pip/npm/etc, sandbox decides)
  sandboxId?: string         // reuse a prior pooled VM (TTL-based)
  vmSize?: 'xxs' | 'xs' | 's' | 'm' | 'l'
}

export interface IsolatedCodeOutput {
  sandboxId: string          // for reuse
  stdout: string
  stderr: string
  exitCode: number
}
```

Sandbox takes a `Workspace` in `init()` so exec `cwd` defaults to the workspace root. Capabilities are declared statically so the catalog can conditionally include `execute_isolated_code` only when the sandbox supports it — **no runtime "not supported" errors, no dead tools in the agent's view.**

---

## Options we ship & code we own

| Abstraction | v1 ships | Reserved for future | Code we author |
|---|---|---|---|
| **Harness** | `PiCodingAgentHarness` (server) | `PiAgentCoreHarness` (browser), `ToolLoopAgentHarness` | Interface + 1 adapter (pi events → UIMessage stream) |
| **Catalog** | Pi factory bundle: `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls` | App-registered extras via pi extensions; custom AgentTools only when pi has no equivalent or cannot accommodate the backend | Operations adapters + harness/filesystem bundle factories + renderers + fallback |
| **Workspace** | **2 adapters: `NodeWorkspace` (local host fs) + `VercelSandboxWorkspace` (remote VM)** — single workspace per instance. `NodeWorkspace` is shared by `direct` and `local` modes. | `OpfsWorkspace`/`LightningFsWorkspace` (browser), `CloudflareSandboxWorkspace` | Interface + 2 adapters + path helpers |
| **Sandbox** | **3 adapters: `DirectSandbox` (no isolation) + `BwrapSandbox` (Linux process isolation) + `VercelSandboxExec` (Firecracker VM)** — all declare `capabilities: ['exec']` | `VercelIsolatedCode` / `BoxliteSandbox` (add `'isolated-code'` capability), `JustBashSandbox` (browser) | Interface + capabilities + 3 adapters |
| **Mode** | `direct` / `local` / `vercel-sandbox` — each a self-contained `RuntimeModeAdapter` under `src/server/runtime/modes/`. `resolveMode(mode)` produces a `RuntimeBundle` ({ workspace, sandbox, fileSearch }). Pairing invariant enforced by construction. | Multi-workspace provisioning owned by future `@boring/cloud` | `[runtime].mode` config + factory |

### External dependencies (not ours)

| Dep | For | Owned by |
|---|---|---|
| `@mariozechner/pi-coding-agent` | Harness runtime + plugin loading | Mario Zechner |
| `ai`, `@ai-sdk/react` | UIMessage stream + `useChat` | Vercel |
| `@vercel/sandbox` | Remote-mode workspace + exec (Firecracker VM) | Vercel |
| `ai-elements` (copied) | Chat UI primitives | Vercel (we own copies) |
| `fastify`, `@fastify/cors` | Standalone server | — |
| System `bwrap` binary | Local-mode process sandbox (Linux) | — |
| `just-bash` (future) | Portable in-memory bash interpreter for browser-agent mode | Vercel Labs |

### Code we author (LOC ballpark)

| Piece | LOC |
|---|---|
| **CLI entrypoint** (`bin/boring-agent` — flag parser, API-key prompt, port picker, browser-open, server boot) | ~200 |
| `AgentHarness`, `Workspace`, `Sandbox`, `AgentTool`, `ToolCatalog` interfaces | ~150 |
| Pi → UIMessage stream adapter | ~150 |
| Operations adapters (bash + 6 file ops, mode-specific) + bundle factories | ~250 |
| Custom tools (`vercelGrepTool`, `executeIsolatedCodeTool`) | ~250 |
| Tool rendering — ai-elements `Tool` + `Terminal` + `CodeBlock` by default (no DiffView in v1) | ~60 |
| `NodeWorkspace` + ported path helpers | ~200 |
| `DirectSandbox` adapter | ~40 |
| `BwrapSandbox` adapter | ~120 |
| `VercelSandboxWorkspace` adapter | ~80 |
| `VercelSandboxExec` adapter | ~80 |
| `resolveSandboxHandle()` — Vercel lifecycle (create/get/resume) + in-process cache | ~100 |
| `SandboxHandleStore` interface + `FileHandleStore` default impl (~/.config/boring-agent/sandboxes.json) | ~60 |
| Fastify routes (`/api/v1/files` GET/POST/DELETE, `/files/move`, `/dirs`, `/tree`, `/stat`, `/files/search`, `/agent/chat`, `/agent/sessions` list+create+detail+delete, `/ui/*` bridge) | ~330 |
| `UiBridge` interface + in-memory impl + SSE fan-out | ~150 |
| UI agent tools (`get_ui_state`, `exec_ui` dispatcher) | ~60 |
| `<ChatPanel />`, `<SessionToolbar />`, `useAgentChat`, `useSessions` (list/create/switch/delete) | ~240 |
| `<ModelPicker />` + `<ThinkingToggle />` inside `<Composer />` | ~80 |
| ai-elements pieces copied into `primitives/` (Message, Composer, Tool, Terminal, CodeBlock, Reasoning) | ~400 (we own after shadcn install) |
| `theme.css` + defaults | ~100 |
| Standalone app (`packages/agent/app/` — thin dev affordance) | ~100 |
| Config / env / mode auto-detection | ~100 |
| `PiSessionStore` (read-over pi JSONL; list/create/switch/delete) | ~120 |
| Stream resumption (cursor tracking + replay route) | ~60 |
| Slash commands (parser + 5 built-ins + registry) | ~80 |
| Heartbeat events for long tool calls | ~20 |
| `/api/v1/agent/sessions/:id/changes` + tracker | ~80 |
| Snapshot retention (keep-last-2 policy) | ~15 |
| CLI SSH detection + auto-gitignore + logout flags | ~30 |
| **Total** | **≈ 3,370 LOC** |

---

## Package layout

```
packages/agent/
├── package.json
├── tsconfig.json
├── README.md
├── bin/                              ← CLI entrypoint shipped via package.json "bin"
│   └── boring-agent.ts               (flag parser, API-key flow, port picker, browser-open, boot)
├── app/                              ← frontend + server factory (shared CLI + dev)
│   ├── index.html
│   ├── vite.config.ts
│   ├── server.ts                     (Fastify entry; serves built SPA in CLI mode, proxies Vite in dev)
│   └── src/main.tsx                  (mounts <ChatPanel />)
├── docs/plans/
│   └── agent-package-spec.md         (this file)
└── src/
    ├── shared/
    │   ├── harness.ts                (AgentHarness interface)
    │   ├── workspace.ts              (Workspace interface — platform-agnostic)
    │   ├── sandbox.ts                (Sandbox interface — exec only)
    │   ├── tool.ts                   (AgentTool interface)
    │   ├── catalog.ts                (ToolCatalog type + deps only)
    │   ├── session.ts                (SessionStore interface + types)
    │   ├── sandbox-handle-store.ts   (SandboxHandleStore interface — file default, swappable for DB)
    │   ├── ui-bridge.ts              (UiBridge interface: state KV + command queue)
    │   ├── message.ts                (UIMessage extension type)
    │   └── index.ts
    ├── server/
    │   ├── index.ts
    │   ├── harness/
    │   │   └── pi-coding-agent/
    │   │       ├── createHarness.ts       (wraps createAgentSession)
    │   │       ├── stream-adapter.ts      (pi event → UIMessageChunk)
    │   │       └── sessions.ts            (PiSessionStore over pi JSONL)
    │   ├── runtime/
    │   │   ├── mode.ts                    (RuntimeModeAdapter contract)
    │   │   ├── resolveMode.ts             (mode → RuntimeBundle)
    │   │   └── modes/
    │   │       ├── direct.ts              (NodeWorkspace + DirectSandbox + HostFindSearch)
    │   │       ├── local.ts               (NodeWorkspace + BwrapSandbox + HostFindSearch)
    │   │       └── vercel-sandbox.ts      (VercelSandboxWorkspace + VercelSandboxExec + VmFindSearch)
    │   ├── workspace/
    │   │   ├── paths.ts                   (path-boundary helpers, ported from boring-ui)
    │   │   ├── provision.ts               (copyTemplate — minimal v1 seeding)
    │   │   ├── node/
    │   │   │   └── createNodeWorkspace.ts
    │   │   └── vercel-sandbox/
    │   │       ├── createVercelSandboxWorkspace.ts
    │   │       └── sandboxHandles.ts      (resolveSandboxHandle cache, consumes SandboxHandleStore)
    │   ├── file-search/
    │   │   ├── hostFindSearch.ts          (default impl via sandbox.exec('find …'))
    │   │   └── (future: browserFsWalkSearch.ts for browser-agent mode)
    │   ├── sandbox/
    │   │   ├── direct/                    (no isolation — child_process.exec)
    │   │   │   └── createDirectSandbox.ts
    │   │   ├── bwrap/                     (pairs with NodeWorkspace, Linux only)
    │   │   │   ├── createBwrapSandbox.ts
    │   │   │   └── exec.ts                (bwrap command helper)
    │   │   └── vercel-sandbox/            (pairs with VercelSandboxWorkspace)
    │   │       └── createVercelSandboxExec.ts
    │   ├── catalog/
    │   │   ├── mergeTools.ts              (host/custom tool merge + name collision guard)
    │   │   └── tools/_shared.ts           (shared helpers retained for migration/test coverage)
    │   ├── tools/
    │   │   ├── harness/index.ts           (buildHarnessAgentTools: pi bash + isolated-code)
    │   │   ├── filesystem/index.ts        (buildFilesystemAgentTools: pi read/write/edit/find/grep/ls)
    │   │   ├── operations/
    │   │   │   ├── bound.ts               (path-bounded local/direct fs Operations)
    │   │   │   └── vercel.ts              (Vercel Sandbox-backed fs/bash Operations)
    │   │   └── vercelGrepTool.ts          (custom AgentTool preserving pi grep schema)
    │   ├── ui-bridge/
    │   │   ├── createInMemoryBridge.ts    (in-memory UiBridge impl)
    │   │   └── sseCommandStream.ts        (SSE fan-out helper)
    │   ├── http/
    │   │   └── routes/
    │   │       ├── file.ts                (GET/POST/DELETE /api/v1/files, /api/v1/stat, POST /api/v1/files/move, POST /api/v1/dirs)
    │   │       ├── tree.ts                (GET /api/v1/tree — lazy recursive listing)
    │   │       ├── search.ts              (GET /api/v1/files/search — filename glob)
    │   │       ├── chat.ts                (POST /api/v1/agent/chat)
    │   │       ├── sessions.ts            (GET/POST /api/v1/agent/sessions — within the single configured workspace)
    │   │       ├── sessionChanges.ts      (GET /api/v1/agent/sessions/:id/changes)
    │   │       ├── catalog.ts             (registered tool metadata)
    │   │       ├── fsEvents.ts
    │   │       ├── health.ts
    │   │       ├── models.ts
    │   │       ├── readyStatus.ts
    │   │       └── systemPrompt.ts
    │   │       /* NOTE: no /api/v1/git/* in v1 — no UI consumer yet; agent runs git via bash */
    │   │       /* NOTE: no /api/v1/workspaces — multi-workspace is cloud-package territory */
    │   └── config/
    │       ├── env.ts
    │       ├── loadEnv.ts
    │       └── workspaceRoot.ts
    └── front/
        ├── index.ts
        ├── ChatPanel.tsx                  (default chat — ready to mount; full-height, includes session toolbar + composer)
        ├── SessionToolbar.tsx             (lightweight current-session + new-chat + dropdown — adapted from old PiSessionToolbar)
        ├── primitives/                    (all reusable UI pieces; shadcn-style, we own the source)
        │   ├── Message.tsx                    (adapted from ai-elements)
        │   ├── MessageGroup.tsx
        │   ├── Composer.tsx                   (adapted from ai-elements PromptInput + inline model/thinking controls)
        │   ├── ModelPicker.tsx                (small inline dropdown for model selection, used inside Composer)
        │   ├── ThinkingToggle.tsx             (off/low/med/high toggle, used inside Composer)
        │   ├── Tool.tsx                       (adapted from ai-elements Tool — generic tool-call renderer)
        │   ├── Terminal.tsx                   (adapted from ai-elements Terminal — bash output)
        │   ├── CodeBlock.tsx                  (adapted from ai-elements)
        │   └── Reasoning.tsx                  (adapted from ai-elements)
        ├── hooks/
        │   ├── useAgentChat.ts            (wraps @ai-sdk/react useChat; accepts { model, thinkingLevel } options)
        │   └── useSessions.ts             (list + create + switch + delete for current workspace; rename deferred)
        └── theme.css
        /* NOTE: rename dialog, full SessionList, useRegisterTool hook all deferred to workspace package / later */
```

---

## Key decisions (locked)

| # | Area | Choice | Rationale |
|---|---|---|---|
| 1 | Standalone shape | **CLI — ships as `bin` entry (`npx @boring/agent`)**. Local backend + browser, zero setup, default `direct` mode, workspace = cwd. | Primary product deliverable, same shape as Claude Code. Directly runnable by end users. |
| 2 | Chat UI | Vercel `ai-elements` + `@ai-sdk/react useChat` | Prebuilt, shadcn-style (we own the copies), restylable via CSS vars. |
| 3 | Wire protocol | AI SDK UIMessage stream end-to-end | One format on the wire; harness adapts on the server. |
| 4 | v1 harness | `@mariozechner/pi-coding-agent` | Pi's factory tools + `XxxOperations` adapters per mode. Our backends plug in via Operations; pi owns tool definitions, schemas, and prompt snippets. See `pi-tools-migration.md` (epic uhwx). |
| 5 | Harness interface | Generic, `placement: server \| browser` | Browser-agent future is a sibling harness, not a migration. |
| 6 | Catalog | Standard tools via pi factories: `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`. Custom tools: `execute_isolated_code` (capability-gated) and `vercelGrepTool` (Vercel-only grep execution while preserving pi schema). | Principle 1 keeps pi names/schemas/prompt snippets intact; Principle 2 routes backend behavior through Operations or spawn hooks; Principle 3 keeps custom AgentTools exceptional. |
| 7a | Workspace (local) | `NodeWorkspace` (Node fs + path-boundary enforcement) | Port `validatePath` / `assertRealPathWithinWorkspace` from existing boring-ui. |
| 7b | Workspace (remote) | `VercelSandboxWorkspace` — delegates fs ops to `sandbox.fs.*` / `sandbox.writeFiles` | Runs backend on any PaaS; files live in Firecracker VM; multi-tenant-safe. |
| 7c | Sandbox (local) | `BwrapSandbox` (`capabilities: ['exec']`) pairs with `NodeWorkspace` | Matches current boring-ui. Bash runs in bwrap, sees host workspace dir. |
| 7d | Sandbox (remote) | `VercelSandboxExec` (`capabilities: ['exec']`) pairs with `VercelSandboxWorkspace` | Bash runs in the SAME VM where files live. Coherent view, zero sync. |
| 7e | Pairing invariant | Workspace + Sandbox MUST target the same underlying execution context | Enforced at adapter construction. `local` mode uses shared host fs; `vercel-sandbox` mode shares a single `Sandbox` handle between both adapters. No mixed pairings. |
| 7f | Mode selection | `[runtime].mode = "direct" | "local" | "vercel-sandbox"` in boring.app.toml (or env override) | One knob picks the adapter pair. Everything else config-independent. |
| 8 | Plugins | Pi plugins coexist via pi's extension system in `direct`/`local` only; remote mode skips extension auto-load | Plugin tools run in the backend Node process, so we keep plugin loading out of `vercel-sandbox` mode. |
| 9 | Sessions | `SessionStore` interface + `PiSessionStore` (JSONL) in v1 | Pi owns writes via its loop; platform-agnostic read+lifecycle interface swaps to SQLite / IndexedDB later. |
| 10 | API key | `ANTHROPIC_API_KEY` env var only. `VERCEL_OIDC_TOKEN` required in `vercel-sandbox` mode. | 12-factor; Vercel auth matches @vercel/sandbox conventions. |
| 11 | Workspace scope | **Single workspace per agent instance.** `workspaceId` is a configured constant (env var or `boring.app.toml`). Local mode: `${workspaceRoot}/${workspaceId}`. Remote mode: a dedicated Vercel Sandbox. No runtime workspace CRUD, no switcher UI — that belongs to `@boring/cloud`. | Matches boring-macro's current pattern (one tenant = one Fly machine = one workspace). Simpler agent surface; complexity deferred to cloud. |
| 11b | Session surface | **Lightweight `<SessionToolbar />` (current session + dropdown + new-chat button) + headless `useSessions()` hook.** list + create + switch + **delete** in v1. Rename deferred. | Adapt from old `PiSessionToolbar.jsx`. Delete added to align with workspace plan's SessionList contract (~20 LOC). |
| 11c | Standalone app | **First-class CLI product.** `packages/agent/bin/boring-agent` (~200 LOC) launches a local Fastify backend + serves the built frontend + opens browser. Ships via `bin` in package.json. | `npx @boring/agent` is the primary consumer-facing entrypoint. Same product shape as Claude Code. Same codebase also boots via `pnpm --filter @boring/agent dev` for package development. |
| 11d | Model + thinking level UI | **Inline in the `<Composer />`** (chat input box) — small ModelPicker dropdown + ThinkingToggle. NOT in the session toolbar. | Model and thinking are message-level concerns, so they live with the compose flow. |
| 11e | Dev-friendly `direct` mode | Third mode alongside local + vercel-sandbox: `NodeWorkspace` + `DirectSandbox` (no isolation, `child_process.exec` with `cwd`). For macOS dev, quick tests, self-host without bwrap. | **Documented warning**: `direct` has no sandbox — agent can do anything the backend process can. Not for untrusted agents. |
| 11f | Settings | **env vars only** (`ANTHROPIC_API_KEY`, `BORING_AGENT_MODE`, etc.). No `/api/settings` route, no runtime prefs file. | Vault / consumer wires production secrets. Workspace package can add a settings UI on top of its own storage if needed. |
| 11g | AI SDK harness | **NOT shipped in v1.** pi-coding-agent only. ai-sdk harness is a design seam (`AgentHarness` interface accommodates it) but not implemented. | boring-macro's current ai-sdk usage will require migration to pi-coding-agent when it adopts v2 — deferred; v1 scope does not include parallel ai-sdk support. |
| 12 | Backend stack | Fastify + Node ESM | Matches existing boring-ui; pi-coding-agent is Node-native. |
| 13 | Styling contract | CSS custom properties (`--boring-chat-*`) + render-prop escape hatches | Same JSX, workspace sets vars at root scope. |
| 14 | UI export pattern | **Default component + reusable primitives** for every user-facing piece | Standalone mounts the defaults; workspace composes primitives into layout-native UIs. Same pattern for chat, sessions, future widgets. |
| 15 | Export surface | **Defaults:** `ChatPanel`, `SessionToolbar`. **Primitives:** `Message`, `MessageGroup`, `Composer`, `ModelPicker`, `ThinkingToggle`, `Tool`, `Terminal`, `CodeBlock`, `Reasoning`, `NewChatButton`. **Hooks:** `useAgentChat`, `useSessions` (list + create + switch + delete; rename deferred). **Plus** `theme.css`. | Single canonical name `ChatPanel` for the chat component; workspace plan aligned. Rename dialog, full SessionList, `useRegisterTool` hook, DiffView all deferred to workspace package / later. |
| 16 | Import convention | **Top-level barrel `@boring/agent` re-exports frontend + shared types** (browser-safe; no Node deps leak). **`@boring/agent/server` required for Node-only** (Fastify routes, harness impl). **`@boring/agent/shared` available** for type-only imports. | Workspace + apps import from `@boring/agent` for normal use; server wiring uses `@boring/agent/server`. Matches workspace plan's `import X from '@boring/agent'` examples. Enforced via `package.json` `exports` conditions. |

---

## Stream adapter (pi event → UIMessage)

The adapter in `src/server/harness/pi-coding-agent/stream-adapter.ts` converts pi's internal event stream into AI SDK UIMessage chunks consumed by `useChat`:

| pi event | AI SDK UIMessage part |
|---|---|
| `text.delta` | `text-delta` |
| `thinking.delta` | `reasoning-delta` |
| `tool.call` (start) | `tool-input-start` |
| `tool.call` (args streaming) | `tool-input-delta` |
| `tool.call` (complete) | `tool-input-available` |
| `tool.result` | `tool-output-available` |
| *heartbeat (synthetic, every 2s during tool exec)* | `data-status` (AI SDK custom data part: `{ toolCallId, elapsedMs }`) |
| `error` | `error` |
| `done` | `finish` + usage |

Heartbeats carry `{ toolCallId, elapsedMs }`. The `<Tool />` renderer surfaces elapsed time so the user sees "bash · 14s running" instead of an opaque freeze during long commands (npm install, tests, etc.). Emitted from a 2-second timer in the adapter while a tool is active; cleared on `tool.result`.

Route implementation (nao pattern):

```ts
app.post('/api/v1/agent/chat', async (req, reply) => {
  const stream = createUIMessageStream<UIMessage>({
    execute({ writer }) {
      writeFromPi(harness.sendMessage(req.body, ctx), writer)
    },
  })
  reply.headers({ 'X-Accel-Buffering': 'no' })
  return reply.send(toUIMessageStreamResponse({ stream }))
})
```

---

## Session management (Layer 2 integration service)

Sessions are an **integration service** layered on top of Layer-1 runtime. Not a core runtime abstraction; evolves independently. They're read-only from the frontend's perspective — **the harness does the writing as a side effect of its loop; the `SessionStore` handles lifecycle and reads.**

### Interface (`src/shared/session.ts`)

```ts
export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  lastModified: string
  messageCount: number
}

export interface SessionDetail extends SessionSummary {
  messages: UIMessage[]        // AI SDK canonical shape — same as on the wire
}

export interface SessionStore {
  list(ctx?: SessionCtx): Promise<SessionSummary[]>
  create(ctx?: SessionCtx): Promise<SessionSummary>
  load(id: string, ctx?: SessionCtx): Promise<SessionDetail>
  delete(id: string, ctx?: SessionCtx): Promise<void>
}

export interface SessionCtx {
  userId?: string              // unused in v1; workspace layer adds later
}
```

**Deliberately no `append()`.** The harness writes messages as they stream; appends don't go through `SessionStore`. This keeps the interface platform-agnostic (no "write a pi event" leak) and avoids concurrency footguns.

### v1 implementation — `PiSessionStore`

`src/server/harness/pi-coding-agent/sessions.ts` wraps pi's `SessionManager`:

- **Writes** happen inside pi's loop → JSONL files under `${workdir}/.pi/sessions/<id>.jsonl`. We do nothing.
- **Reads** (`list` / `load`) stream the JSONL, convert pi `SessionEntry` events → AI SDK `UIMessage` parts on the fly. This is a one-way transform using the same mapping as the live stream adapter.
- **Lifecycle** (`create` / `delete`) uses pi's SessionManager API where available; `delete` also removes the corresponding JSONL file on disk.

Canonical persisted shape the API returns is always `UIMessage[]`. Pi's JSONL is an implementation detail behind the interface.

### Stream resumption (v1, transport-owned)

Resume is **owned by the HTTP/stream layer, not the harness**. The server wraps the harness's event stream in a per-turn ring buffer keyed on `(sessionId, turnId)` with monotonic chunk indices. A disconnected client reconnects via `GET /api/v1/agent/chat/:sessionId/:turnId?cursor=<n>` and resumes from chunk `n+1`. If the turn already completed, the endpoint replays from `PiSessionStore` and closes. `useChat` wired with `experimental_resume: true`. ~60 LOC in routes + stream adapter. Harness adapters stay reconnect-unaware — any future harness gets resume for free. Critical UX — users will refresh mid-response and expect continuity.

### What v1 defers

- **Multi-user scoping** — `SessionCtx.userId` is in the signature but ignored. Workspace will pass it later.
- **LLM-generated titles** — v1 defaults to `"New chat {timestamp}"`. Background title generation lands in M3.
- **Rename session flow** — deferred to the workspace package (delete ships in v1; only rename is deferred).

### Future `SessionStore` implementations (each is one adapter)

| Implementation | When | Notes |
|---|---|---|
| `SqliteSessionStore` | Self-hosters wanting queryable history | Drizzle + local SQLite file; may replace pi's SessionManager entirely |
| `IndexedDBSessionStore` | Browser-agent mode | Pairs with pi-agent-core or ToolLoopAgent harness |
| `RemoteSessionStore` | Cloud-backed workspace deployments | Thin HTTP client against a central session service |
| `InMemorySessionStore` | Tests, ephemeral demos | Trivial; already implied by pi's inMemory manager |

### HTTP surface

Routes are defined in the canonical [HTTP API reference](#http-api-reference-canonical) — rows `/api/v1/agent/sessions*` and `/api/v1/agent/chat*`. All delegate to the configured `SessionStore`. `POST /api/v1/agent/chat` takes a `sessionId` in the body; the server resolves the workspace + session, constructs a `Workspace` + `Sandbox` via `RuntimeModeAdapter`, and invokes the harness. Harness appends messages into that session as it runs (via pi's loop).

**Invariants:** `workspaceId` is resolved from process config in v1 — never client-supplied. Workspace CRUD (list/create/delete) belongs to `@boring/cloud`, not agent v1. Session rename is deferred to the workspace package; delete ships in v1.

## UI bridge — workspace ↔ agent state + commands

The bridge carries two orthogonal flows between workspace (frontend) and agent (backend). **Distinct from the chat stream**, which is for agent message display only.

### The three flows

| Direction | What | Mechanism |
|---|---|---|
| Agent → UI display | Agent message content (text, tool calls, reasoning) | AI SDK UIMessage stream via `useChat` (existing) |
| UI → Agent state | "What does the user currently see?" | `PUT /api/v1/ui/state` → agent reads via `get_ui_state` tool |
| Agent → UI commands | "Open file X, open panel Y, show notification" | `POST /api/v1/ui/commands` → workspace subscribes via SSE on `/api/v1/ui/commands/next` |

### Interface (`src/shared/ui-bridge.ts`)

```ts
export interface UiBridge {
  getState(): Promise<UiState | null>
  setState(state: UiState): Promise<void>
  postCommand(cmd: UiCommand): Promise<CommandResult>
  subscribeCommands(handler: (cmd: UiCommand & { seq: number }) => void): () => void
}

export type UiState = Record<string, unknown>   // workspace-defined shape

export type UiCommand =
  | { kind: 'openFile'; params: { path: string; mode?: 'view' | 'edit' | 'diff' } }
  | { kind: 'openPanel'; params: { id: string; component: string; params?: Record<string, unknown> } }
  | { kind: 'closePanel'; params: { id: string } }
  | { kind: 'showNotification'; params: { msg: string; level?: 'info' | 'warn' | 'error' } }
  | { kind: 'navigateToLine'; params: { file: string; line: number } }
  | { kind: 'expandToFile'; params: { path: string } }
  | { kind: string; params: Record<string, unknown> }    // extensible

export interface CommandResult {
  seq: number                                   // monotonic sequence for this workspace
  status: 'ok' | 'error'                       // simple: validated+queued or rejected
  error?: { code: string; message: string }
}
```

**CommandResult matches the workspace plan's bridge contract.** Agent's `exec_ui` tool awaits the result — it can see whether the agent server accepted the command. The POST returns `{seq, status: 'ok'}` on success or `{seq, status: 'error', error: {code, message}}` on validation failure. No ack loop — the agent treats `ok` as "command will be delivered via SSE." Workspace execution is fire-and-forget from the agent's perspective; workspace publishes resulting state via `PUT /api/v1/ui/state`.

### v1 implementation

- In-memory state store keyed by `workspaceId` (single entry in v1).
- Command queue per workspaceId; **delivered via SSE** on `GET /api/v1/ui/commands/next` (same transport we use for chat stream resumption — consistent, ~20 LOC). Commands dropped from queue after delivery.
- No persistence across backend restarts (matches accepted-risk posture for v1).
- No WebSocket — SSE covers the push case with less lifecycle complexity, works through any HTTP proxy/CDN, and auto-reconnects in the browser.

### Agent tools enabled by the bridge

Just two tools — kept minimal on purpose:

| Tool | Does | Bridge call |
|---|---|---|
| `get_ui_state` | Returns current UI state as JSON | `bridge.getState()` |
| `exec_ui({ kind, params })` | Generic dispatcher for UI commands | `bridge.postCommand({ kind, params })` |

The `exec_ui` tool has the command kinds enumerated in its `parameters.properties.kind.enum`:
```
['openFile', 'openPanel', 'closePanel', 'showNotification', 'navigateToLine', 'expandToFile']
```
Extending = adding a new enum value + a switch case in workspace's dispatcher. No new agent-side code.

Total agent-visible tools in v1: **6** (`bash, read, write, edit, get_ui_state, exec_ui`) plus the conditional `execute_isolated_code` if a VM sandbox is wired.

### Workspace side

- On layout changes (Zustand subscription) → debounced PUT to `/api/v1/ui/state`
- On mount → subscribe to `/api/v1/ui/commands/next` via SSE
- On command received → dispatch via Zustand store (opens file in editor, mounts panel, shows toast)

### Command transport — single dispatch channel

`UiBridge` is the **single command transport**. One queue, one ordering model, one ack model.

Chat-stream `data-ui-command` parts are **display-only derivatives** of bridge-dispatched commands — never their own dispatch source. Dispatch flows only through `UiBridge.postCommand` → SSE → workspace Zustand store.

Concretely, the `exec_ui` handler: (1) calls `bridge.postCommand(cmd)` and awaits `{ seq, status }`; (2) emits a `data-ui-command` part into the chat stream carrying that same `seq`. The frontend:
- On `data-ui-command` part: render a compact message card only (no dispatch). The `seq` ties the card to the already-delivered command.
- On SSE command: dispatch via Zustand (actually opens file, etc.).

Result: one queue to reason about, in-turn visual context preserved.

---

## Environment provisioning

One mental model, two axes: **what gets provisioned** (files vs. libraries) × **when** (pre-baked once vs. on-demand per sandbox). Neither layer does the other's job — `copyTemplate` never runs `pip install`; library tiers never seed project files.

### Files — `copyTemplate` (workspace-owned)

Fresh workspaces can optionally seed file contents from a template directory. **Deliberately minimal for v1 — no abstraction, no composition, no installers.** Matches the old boring-ui's "mkdir and done" default; adds *just* a template-copy escape hatch.

```ts
// src/server/workspace/provision.ts
export async function copyTemplate(
  templatePath: string | undefined,
  workspaceRoot: string,
): Promise<void> {
  if (!templatePath) return
  // recursive copy from templatePath into workspaceRoot
  // errors abort workspace creation
}
```

Called **synchronously** during workspace creation, after `mkdir(workspaceRoot)`. For expected template sizes (skill files, README, a config or two) copy is milliseconds — workspace POST stays fast. No async state machine, no background tasks.

Resolution order (first wins):
1. `createAgentApp({ templatePath })` — primary API for embedders.
2. `BORING_AGENT_TEMPLATE_PATH` env — fallback for standalone use.
3. Unset → no seeding.

Idempotent: a marker file `${root}/.boring-agent/provisioned` is written after success; subsequent `copyTemplate` calls no-op. To re-seed: delete the workspace and recreate.

### Libraries — two-tier, per-mode (sandbox-owned)

Each mode supports pre-installed Python/system packages via a symmetric two-tier design. Tier 1 is pre-baked and fast. Tier 2 is agent-driven and ephemeral.

**Local mode (bwrap):**

| Tier | Where | How |
|---|---|---|
| 1 — shared, pre-installed | `/opt/venv` on the host container, bwrap bind-mounts read-only | Dockerfile builds it: `python3 -m venv /opt/venv && /opt/venv/bin/pip install …`. OR sandbox builds it on first boot from `[sandbox].python_packages` config, cached at `/var/cache/boring-agent/venvs/<hash>`. |
| 2 — per-workspace overlay | `${workspace}/.venv` with `--system-site-packages` | Created lazily on first agent `pip install`. Inherits Tier 1. Persists across sessions. |

**Remote mode (Vercel Sandbox):**

| Tier | Where | How |
|---|---|---|
| 1 — snapshot-based base | Vercel's snapshot storage, referenced by `snapshotId` | **One-time bake:** create seed sandbox → `pip install` → `sandbox.snapshot()` → store `snapshotId`. Every `Sandbox.create({ source: { type: 'snapshot', snapshotId } })` boots in ms with deps ready. |
| 2 — in-sandbox overlay | The sandbox's own fs (at `/vercel/sandbox`) | Agent runs `pip install <extra>` via bash. Persists for the sandbox's lifetime (TTL + hibernation = hours to days). Lost on full VM expiry. |

Vercel Sandbox ships `python3.13` as a first-class runtime. Agent calls `python3 script.py` via the `bash` tool; `VercelSandboxExec.exec(cmd)` delegates to `sandbox.runCommand('sh', ['-c', cmd])` running inside the VM. Same tool, different sandbox — agent prompt doesn't change.

### Config shape (one schema, mode-interpreted)

```toml
[runtime]
mode = "vercel-sandbox"        # or "local"

[workspace]
template_path = "./templates/default"   # optional; copied into workspace on create

[sandbox]
python_packages = ["pandas", "numpy", "scipy"]
system_packages = ["ripgrep", "jq"]     # local: apt-get; remote: dnf during bake

# Remote-mode-specific:
[sandbox.vercel]
runtime = "python3.13"                  # one of: node24, node22, python3.13
snapshot_id = "snap_abc123..."          # if set, use directly; overrides python_packages
```

If `snapshot_id` is set, skip the bake. Otherwise, v1 bootstrap creates the seed sandbox + installs + snapshots on first backend startup and caches the resulting snapshotId — done once per unique `python_packages` hash.

### v1 scope

- **M1 (files):** `copyTemplate` helper. ~30 LOC. Workspace-create synchronous.
- **M2 (remote libs):** snapshot-bake flow in `src/server/sandbox/vercel-sandbox/bake.ts`: takes `python_packages` + `system_packages` from config, creates seed sandbox, installs, snapshots, caches snapshotId. ~150 LOC. One-time per config hash.
- **M3 (local libs):** shared-venv + overlay flow for bwrap. `python_packages` → `uv pip install` into `/var/cache/boring-agent/venvs/<hash>`, bwrap binds it. ~80 LOC.

If neither `template_path`, `python_packages`, nor `snapshot_id` is configured, workspace starts empty; agent installs on demand via the `bash` tool (matches current boring-macro).

### Upgrade paths (explicitly deferred, not in v1)

When needs grow beyond this, the escape hatches are:

| Need | Layer / path | Trigger |
|---|---|---|
| Python `requirements.txt` install (project-specific) | Future `execute_isolated_code` tool (sandbox capability), or async `WorkspaceProvisioner` | First user with real Python workload |
| Git-clone seeding | `WorkspaceProvisioner` interface (`GitCloneProvisioner`) | When we port GitHub-connect flow |
| Skill library from remote source | `WorkspaceProvisioner` | When skills become shareable |
| Multi-step composed provisioning | `WorkspaceProvisioner` (`composedProvisioner`) | When we have >1 provisioner |
| Content-hash re-provisioning | `WorkspaceProvisioner` | Template-change UX need |
| Per-call ephemeral pooled VM deps (nao model) | `Sandbox` adapter declaring `'isolated-code'` capability | Multi-tenant data-analysis workloads |

Until then: one function (`copyTemplate`), one env var, a few config keys.

## Plugin compat

`PiCodingAgentHarness` passes only our `tools: [...]` to `createAgentSession`; pi's built-ins are skipped. Extensions loaded via pi's discovery (`~/.pi/agent/extensions/`, `.pi/extensions/`, npm, git) register their own tools through `pi.registerTool()`. Those end up in the catalog alongside ours.

Plugin tools' `execute()` bodies run in the Node host process (they use `node:fs`, `pi.exec()`, etc.) — **they bypass our Sandbox by design.** That's accepted: plugins are author-written code the user chose to install. Our sandbox knob only governs our default tools.

Open research (resolves in M4): precedence when a plugin registers a same-named tool as our default. We'll test and document, then either let last-in-wins or namespace ours (`fs.bash` vs `bash`).

---

## UI export pattern — "default + primitives"

Every user-facing feature follows the same shape:

1. **Default component** — a ready-to-mount implementation. `<ChatPanel />`, `<SessionToolbar />`. Standalone app uses these directly. Workspace *can* too.
2. **Primitives** — the smaller pieces the default is built from. Exported for consumers who want to compose their own UI. Examples: `<Message />`, `<MessageGroup />`, `<Composer />`, `<ModelPicker />`, `<ThinkingToggle />`, `<Tool />`, `<Terminal />`, `<CodeBlock />`, `<NewChatButton />`.
3. **Headless hook** — purely state + mutations, no JSX. `useAgentChat`, `useSessions`. For consumers who want zero imposed UI.

Consumers pick their level:

```tsx
// Level 1 — defaults (standalone app, quick embeds)
<ChatPanel />

// Level 2 — primitives (workspace composes its own chat shell)
const { sessions, activeSession, create, switch: switchTo, delete: remove } = useSessions()
<DockPanel title="Chats">
  <NewChatButton onClick={create} />
  {sessions.map(s => <button key={s.id} onClick={() => switchTo(s.id)}>{s.title}</button>)}
</DockPanel>
<ChatPanel />

// Level 3 — headless (custom everything)
const { messages, sendMessage, stop } = useAgentChat({ sessionId })
return <MyBespokeChat messages={messages} onSend={sendMessage} />
```

Feature widgets we add later (artifact viewer, diff pane, tool-result drawer) follow the same three-level contract. Rename dialog, full session-sidebar primitives (SessionRow, RenameDialog), and `useRegisterTool` hook are workspace-package territory — not shipped in agent v1.

This is the contract for *all* UI the package ships. When we add new features (artifact viewer, diff pane, tool-result drawer), they each come in these three flavors.

## Slash commands

Composer recognizes `/command [args]` as non-LLM input. Built-ins in v1:

| Command | Effect |
|---|---|
| `/clear` | Clear visible message list (doesn't delete the session) |
| `/reset` | Create a new session (same workspace) and switch to it |
| `/model <id>` | Switch active model for this session |
| `/help` | Show available commands |
| `/cost` | Show tokens used + estimated cost for this session |

Pi extensions that register commands via `pi.registerCommand()` appear in `/help` alongside built-ins. Handler lives in `useAgentChat.handleSlashCommand(text)` and runs locally without hitting the LLM. Workspace consumers can call `useAgentChat.registerCommand({ name, handler, description })` to add their own. ~80 LOC total.

## Styling contract

`theme.css` declares defaults for every token:

```css
:root {
  --boring-chat-bg: #0b0b0e;
  --boring-chat-fg: #eaeaea;
  --boring-chat-accent: #7c5cff;
  --boring-chat-radius: 12px;
  --boring-chat-font-body: system-ui, sans-serif;
  --boring-chat-font-mono: ui-monospace, monospace;
  /* … */
}
```

ai-elements-adapted primitives are authored with Tailwind classes that reference the vars via Tailwind's arbitrary-value syntax. Workspace sets the same vars at its root → chat recolors without JSX changes.

**Worked example — the var/Tailwind bridge:**

```tsx
// src/front/primitives/Message.tsx — authored pattern
<div className="rounded-[var(--boring-chat-radius)] bg-[var(--boring-chat-bg)] text-[var(--boring-chat-fg)]">
```

Tailwind's `bg-[var(--…)]` / `text-[var(--…)]` syntax reads the CSS var at render time. Setting the var anywhere in the cascade above the primitive re-colors it without class overrides. **Contract:** primitives always use `bg-[var(...)]`, never `bg-slate-900`. No Tailwind theme-plugin is shipped. (Future lint rule: no hard-coded color classes in `primitives/`.)

Escape hatches on `<ChatPanel />`:
- `toolRenderers={{ my_tool: MyRenderer }}` — override per-tool UI
- `renderMessage`, `renderComposer` — replace blocks entirely

---

## Config / env

| Var | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | LLM auth |
| `BORING_AGENT_MODE` | no | `direct` (macOS/non-Linux) or `local` (Linux) | `direct` / `local` / `vercel-sandbox`. Overrides `[runtime].mode` in boring.app.toml. Auto-detects: direct on macOS, local on Linux with bwrap installed. |
| `BORING_AGENT_WORKSPACE_ID` | yes | — | The single workspace this instance serves. Constant for the lifetime of the process. |
| `BORING_AGENT_WORKSPACE_ROOT` | local mode | `/tmp/boring-agent/workspaces` | Base dir; the workspace lives at `${root}/${workspaceId}/`. |
| `VERCEL_OIDC_TOKEN` | vercel-sandbox mode | — | Vercel auth (from `vercel env pull`). Or use `VERCEL_ACCESS_TOKEN` fallback. |
| `VERCEL_TEAM_ID` | vercel-sandbox mode | — | Team/project scope for sandbox creation. |
| `BORING_AGENT_TEMPLATE_PATH` | no | — | If set, copied into fresh workspaces (local mode) or packaged as tarball for `Sandbox.create({ source: { type: 'tarball' } })` (remote mode). |
| `BORING_AGENT_PORT` | no | `8787` | Standalone Fastify port |
| `BORING_AGENT_MODEL` | no | pi's default | Claude model override |
| `BORING_AGENT_SANDBOX_TIMEOUT_MS` | no | `2700000` (45 min) | Vercel Sandbox max timeout. |
| `BORING_AGENT_SNAPSHOT_KEEP` | no | `2` | How many recent Vercel snapshots to retain per workspace. |

---

## CLI product shape

The agent package ships as a CLI via `bin` in `package.json`. This is the primary end-user product.

### Usage

```bash
# Zero-config: chat against cwd, direct mode
npx @boring/agent

# Point at a specific folder
npx @boring/agent /path/to/my-project

# With options
npx @boring/agent --port 9000 --model claude-sonnet-4-5 --mode local

# First run prompts for ANTHROPIC_API_KEY; persisted to ~/.config/boring-agent/env
```

### What the CLI does on startup

1. **Resolve config** — flags > env > config file > defaults.
2. **Auth check** — read `ANTHROPIC_API_KEY` from env; if missing, prompt once and persist to `~/.config/boring-agent/env`.
3. **Gitignore hygiene** — if workspace has `.git/` and `.gitignore` doesn't list `.boring-agent/` and `.pi/`, append them with a comment. One-time silent write; skippable via `--no-gitignore`.
4. **Mode auto-detect** — Linux+bwrap → `local`, else → `direct`. `vercel-sandbox` is opt-in via flag or env.
5. **Workspace** — default root = cwd; workspaceId = stable hash of absolute path (so re-running in the same folder resumes sessions).
6. **Pick a free port** — start Fastify on it (default `8787`, increment if taken).
7. **Serve frontend** — pre-built SPA served from the same Fastify instance (no separate Vite dev server in CLI mode).
8. **Open browser — conditionally.** Skip if `SSH_TTY`, `SSH_CONNECTION`, `CI`, or `--no-open` is set; also skip on Linux when `$DISPLAY` is empty. When skipped, print the URL prominently AND an SSH port-forward hint (`ssh -L <port>:localhost:<port> <host>`) for remote hosts.
9. **Print endpoint + ctrl-c handler** — graceful shutdown (see below).

### Graceful shutdown (SIGINT / SIGTERM)

On Ctrl-C: stop pi stream (abort signal), snapshot the Vercel sandbox if in remote mode (save state), close Fastify, exit 0. 5-second max; falls through to hard exit if hangs.

### CLI flags

| Flag | Default | Purpose |
|---|---|---|
| `--port <n>` | `8787` (auto-increment if busy) | HTTP port |
| `--mode <m>` | auto | `direct` / `local` / `vercel-sandbox` |
| `--model <id>` | pi default | Claude model override |
| `--no-open` | opens by default | Skip browser-open |
| `--no-gitignore` | append by default | Skip gitignore hygiene |
| `--workspace <path>` | cwd | Alternate way to set workspace folder |
| `--config <file>` | `~/.config/boring-agent/config.toml` | Config file override |
| `--logout` | — | Remove persisted API key at `~/.config/boring-agent/env` and exit |
| `--reset-key` | — | Delete persisted key and re-prompt |

### Same code, two modes

- **CLI invocation** (`bin/boring-agent`): spawns production Fastify server with pre-built frontend assets bundled in the package.
- **Package dev** (`pnpm --filter @boring/agent dev`): spawns Fastify + Vite dev server, hot-reload for frontend. Same entry, different flag (`--dev`).

### Product positioning

| Package | Ships as | User |
|---|---|---|
| `@boring/agent` | **CLI** (primary) + library | End users (`npx`), library consumers |
| `@boring/workspace` | Library | App builders composing layouts |
| `@boring/cloud` | SaaS / deploy tooling | Teams wanting multi-tenant or hosted |

The agent package alone is a legitimate standalone product — you can ship to users with "install Node, run `npx @boring/agent`, done."

---

## Runtime modes — local vs vercel-sandbox (both shipped in v1)

### `RuntimeModeAdapter` — one contract per mode

Each mode is a single module exporting a `RuntimeModeAdapter`. The adapter produces the full runtime bundle (workspace, sandbox, fileSearch, optional uiBridge pass-through) for that mode. Pairing invariant is enforced by construction — you can't build a mismatched pair because each adapter owns all pieces.

```ts
// src/shared/runtime.ts
export interface RuntimeModeAdapter {
  readonly id: 'direct' | 'local' | 'vercel-sandbox'
  create(ctx: ModeContext): Promise<RuntimeBundle>
}

export interface ModeContext {
  workspaceId: string
  workspaceRoot?: string                       // local/direct modes
  sandboxHandleStore?: SandboxHandleStore      // vercel-sandbox mode
  // ... mode-specific config from boring.app.toml
}

export interface RuntimeBundle {
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
  uiBridge?: UiBridge            // pass-through; set by createAgentApp, same for all modes
}
```

Package layout: `src/server/runtime/` holds `mode.ts` (contract) + `resolveMode.ts` (mode → bundle) + `modes/{direct,local,vercel-sandbox}.ts` (the three adapters). Each `modes/*.ts` file is self-contained — you understand what `direct` mode is by reading `modes/direct.ts`, not by cross-referencing 3 other directories.

`resolveMode(mode)` replaces the earlier `resolveWorkspaceAndSandbox(mode)` factory.

---


### Direct mode (`mode: "direct"`)

- `NodeWorkspace` (host Node fs, path-boundary enforced)
- `DirectSandbox` (`child_process.exec` with `cwd = workspace.root`, no isolation)
- Files on the backend machine; bash runs as the backend process user
- **No Linux/bwrap dependency** — works on macOS, Windows (WSL2), any Node host
- **Windows native (non-WSL) is NOT supported in v1.** Path semantics, `cmd.exe` quoting, and bash absence make it a separate engineering effort. WSL2 is supported via the Linux path.

**Trust posture: the agent operator and the file owner are the same person.** Same model as running Claude Code on your laptop — no sandbox because you trust yourself + your prompts.

**When to use direct mode** (both dev AND production):
- Local dev on any OS (primary use)
- Single-user self-host on your own server
- Personal-use deployments (one tenant per host)
- Internal tools where the operator and user are the same team

**When NOT to use direct mode — use `local` or `vercel-sandbox` instead**:
- Multi-tenant SaaS (users share backend processes)
- Untrusted-input pipelines (agent ingests random URLs / user uploads)
- Public-facing with untrusted users
- Anywhere a prompt injection could lead to "arbitrary shell on the host" being a real concern

**Think of the three modes as a trust spectrum**, not a dev-vs-prod split:

```
 Less isolation                                   More isolation
  ◄─────────────────────────────────────────────────────────►

  direct              local (bwrap)              vercel-sandbox
  (no sandbox)        (process isolation,        (VM isolation,
                       same kernel)               dedicated kernel)

  "me on my           "my backend,                "any user,
   own stuff"          one tenant per process"    any prompt"
```

### Local mode (`mode: "local"`)

- `NodeWorkspace` (host Node fs, path-boundary enforced via `validatePath`)
- `BwrapSandbox` (wraps bash in bubblewrap, binds the workspace dir)
- Files live on the backend machine at `${workspaceRoot}/${workspaceId}/`
- Deployable on any Linux host with `bubblewrap` installed (Fly, Render, Railway, Docker)
- Zero external dependencies beyond pi-coding-agent + bwrap binary
- **Security posture: process isolation within single tenant.** Workspace-level isolation via bwrap namespaces; multi-tenant safety relies on per-tenant host boundaries (e.g., Fly machine per tenant).

### Remote mode (`mode: "vercel-sandbox"`)

- `VercelSandboxWorkspace` (fs ops delegate to `sandbox.fs.readFile/writeFile/readdir/stat` + `sandbox.writeFiles`)
- `VercelSandboxExec` (exec delegates to `sandbox.runCommand`)
- Files live inside a Vercel Firecracker microVM at `/vercel/sandbox/`
- **Pairing invariant**: both adapters share the same `Sandbox` handle per workspace
- Requires Vercel account + `VERCEL_OIDC_TOKEN`
- Backend can run on any PaaS including ones without Linux namespaces

### Vercel Sandbox — cold start + pricing (reference)

From Vercel docs, concrete numbers to inform design/operational decisions:

**Cold start times:**

| Creation method | Typical latency |
|---|---|
| `Sandbox.create()` empty | ~200–500 ms |
| `Sandbox.create({ source: 'snapshot' })` | ~100–300 ms — fastest |
| `Sandbox.create({ source: 'tarball' })` | 1–5 s (+ download) |
| `Sandbox.create({ source: 'git' })` | 2–10 s (+ clone) |
| Hibernation resume | ~200–500 ms (transparent on first op) |

Implication: **pre-baked snapshot is the production pattern.** First-ever workspace creation may take 1–5 s (one-time bake); every subsequent create is sub-second.

**Pricing (Pro/Enterprise list rates):**

| Metric | Rate |
|---|---|
| Active CPU | $0.128 / hour (CPU-active time only — I/O waits don't count) |
| Provisioned Memory | $0.0212 / GB-hour (1-min minimum billing per lifecycle) |
| Sandbox Creation | $0.60 / 1M (~$0 at realistic scale) |
| Data Transfer | $0.15 / GB |
| Snapshot Storage | $0.08 / GB-month |

**Hobby free allotment:** 5 hrs active CPU, 420 GB-hrs memory, 5k creations, 20 GB transfer, 15 GB storage lifetime. **10 concurrent sandboxes** (cap!), 45-min max runtime.

**Pro:** $20/month credit, 2000 concurrent, 5-hr max runtime.

**Realistic per-session cost** (30-min agent session, 2 vCPU, 4 GB, ~30% CPU active): **~$0.10**. Snapshot for a baked image (2–5 GB): $0.16–0.40/month.

**Region:** `iad1` only (US East). EU/APAC users will see +100–200 ms latency per fs op.

---

### Sandbox handle lifecycle (remote mode only)

In v1 agent, there is **one workspaceId per instance** (from env/config). Lifecycle is trivial:

```
Backend starts
    │
    ▼
First request arrives
    │
    ▼
resolveSandboxHandle(workspaceId)
    │
    ├── HandleStore has vercel_sandbox_id + sandbox running?  → Sandbox.get({ id }) → cache → return
    ├── HandleStore has vercel_snapshot_id but sandbox expired? → Sandbox.create({ source: { type: 'snapshot' } }) → update store → return
    └── No sandbox yet (first boot)? → Sandbox.create({ source: { tarball from template | empty } }) → store id → return

Inactivity → Vercel hibernates sandbox → transparent resume on next op (~200–500 ms)

TTL expiry (45 min Hobby / 5 h Pro) → Vercel deletes VM
    │
    ▼
Next access triggers recreate-from-snapshot
    (we take periodic snapshots as a safety net)
```

Handle cached in-process keyed by `workspaceId` (single entry in v1). Backend restart rebuilds cache lazily from `SandboxHandleStore`.

**Swappable store — same pattern as `SessionStore`:**

```ts
// Default (agent v1) — no DB dependency:
const app = createAgentApp({})  // uses FileHandleStore at ~/.config/boring-agent/sandboxes.json

// Future — @boring/core ships reusable DB impls:
import { createPostgresHandleStore } from '@boring/core/stores'
const app = createAgentApp({
  sandboxHandleStore: createPostgresHandleStore(pgPool),
})
```

Agent internals call `store.get/set/delete` — the adapter is the swap point. Adding a new backend = 30–50 LOC implementing `SandboxHandleStore`. Agent code unchanged. Apps choose what they install; file default has zero deps.

**Circuit breaker on Vercel API:** exponential backoff (100 ms → 1.6 s, max 5 retries) when `Sandbox.create` / `Sandbox.get` / `sandbox.runCommand` throws a 5xx or network error. Subsequent calls within the breaker-open window fail fast with a clear error surfaced to the chat (`"Workspace backend temporarily unavailable"`). Prevents retry storms + frontend hangs when Vercel hiccups. ~30 LOC, wraps the Vercel SDK client.

**Snapshot retention:** each `sandbox.snapshot()` deletes all prior snapshots for the same `workspaceId` except the most recent previous one (keep-last-2 policy). Bounds storage at 2× snapshot-size per workspace. Configurable via `BORING_AGENT_SNAPSHOT_KEEP` (default 2). Without this, snapshot storage grows linearly with uptime and adds silent month-over-month cost.

**When multi-workspace arrives** (via `@boring/cloud`), the cloud package owns `Sandbox.create()` / `Sandbox.stop()` / snapshot lifecycle. The agent package just receives a `workspaceId` with its sandboxId already provisioned.

### What's shared across modes

- All 7 standard pi tools (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`) — bound to the right adapter pair through Operations/spawn hooks
- All HTTP endpoints (`/api/v1/files`, `/api/v1/tree`, `/api/v1/stat`, `/api/v1/agent/chat`, ...)
- Chat UI, session handling, theme, primitives — totally mode-unaware
- Plugin ecosystem (pi-coding-agent's extension system)
- Template copy (copyTemplate works in both modes; remote mode packages into a tarball for `Sandbox.create()`)

### Future modes (design seams only — not shipped in v1)

- **Browser-agent:** `PiAgentCoreHarness` or `ToolLoopAgentHarness` + `JustBashSandbox` (in-browser Bash interpreter) + `OpfsWorkspace` (browser OPFS fs). All three exist as interface-compatible placeholders; no implementation.
- **Cloudflare Sandbox:** `CloudflareSandboxWorkspace` + `CloudflareSandboxExec` — parallel to Vercel mode, Cloudflare infra.
- **Self-hosted VM isolation:** `BoxliteSandbox` for bare-metal KVM deployments.

**Hard rule enforced throughout v1:** `AgentHarness`, `Workspace`, `Sandbox`, `AgentTool`, and all of `src/shared/*` must not leak Node-only APIs (`fs`, `child_process`, `process`, etc.) into their public shapes. Use `Uint8Array` (not `Buffer`) for binary data in shared contracts. Server-only code stays in `src/server/**`.

---

## Shipping roadmap

Each milestone leaves the tree green and the standalone app usable.

### M0 — Skeleton & contracts (≈ 1–2 days)

Pure scaffolding, no behavior.

- [x] `packages/agent/` with `package.json`, `tsconfig.json` (done)
- [x] `src/shared/{harness,sandbox,tool,catalog,session,message}.ts` — **interfaces only**, no implementations
- [x] Barrel `src/shared/index.ts` — re-exports all 12 shared modules
- [x] Stub passing tests for each interface (type-level only) — 8 `.test-d.ts` files
- [x] `app/` directory scaffolded (empty Vite + Fastify)

**Gate:** types compile; empty app boots with placeholder HTML.

### M1 — Local mode MVP (≈ 1 week)  ← **ship first**

Smallest end-to-end thing where you type a message in the standalone app, agent runs `bash` once against a local workspace, response streams back. **No remote adapters yet.**

- [x] `createNodeWorkspace()` with ported path helpers (validatePath, realpath checks).
- [x] `createDirectSandbox()` — `child_process.spawn` wrapper with `cwd = workspace.root`. ~175 LOC with process management.
- [x] `createBwrapSandbox()` — `exec` wraps `bwrap --bind ${workspace.root} /workspace --chdir /workspace bash -c …`.
- [x] `resolveMode(mode)` factory: auto-detect Linux+bwrap → `local`, else → `direct`. `vercel-sandbox` opt-in. Each mode module in `src/server/runtime/modes/*.ts` is self-contained.
- [x] Catalog: pi factory tools `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls` via `buildHarnessAgentTools()` and `buildFilesystemAgentTools()`, plus host/UI tools where provided.
- [x] `createPiCodingAgentHarness()` — wraps `createAgentSession({ tools })`, in-memory session manager.
- [x] Pi → UIMessage stream adapter (text-delta, tool-input-*, tool-output-available, finish).
- [x] Fastify routes (versioned, `/api/v1/*`):
  - Files: `GET/POST/DELETE /api/v1/files`, `GET /api/v1/tree`, `GET /api/v1/stat`, `GET /api/v1/files/search` — thin wrappers over `workspace.X()`
  - Agent: `POST /api/v1/agent/chat`, `GET /api/v1/agent/sessions`, `POST /api/v1/agent/sessions`, `GET/DELETE /api/v1/agent/sessions/:id`
  - No `/api/v1/workspaces` in v1 — workspaceId comes from config
  - No `/api/v1/git/*` in v1 — no UI consumer; agent uses bash for git
- [x] `<ChatPanel />` — `useChat`-based message list + composer with ai-elements primitives.
- [x] `<Composer />` includes `<ModelPicker />` (dropdown: sonnet / haiku / opus) and `<ThinkingToggle />` (off/low/med/high). Values passed into `useAgentChat` options on each send.
- [x] Standalone app wires frontend to backend. `pnpm dev` boots chat (Vite dev server + Fastify).
- [x] **CLI `bin/boring-agent`**: flag parser, API-key prompt + persistence, port picker (auto-increment on conflict), **SSH/headless-aware browser-open**, **auto-gitignore hygiene**, graceful shutdown (SIGINT/SIGTERM → abort stream, close server). `--logout` / `--reset-key` / `--no-open` / `--no-gitignore` flags.
- [x] Build pipeline: `pnpm build` produces `dist/frontend/` (Vite static build) + `dist/bin/boring-agent.js` (bundled CLI). `package.json` `bin` entry points at the compiled CLI.
- [x] `ANTHROPIC_API_KEY` + `BORING_AGENT_WORKSPACE_ROOT` env parsing + CLI flag override.

**Gate:** user can say "list files in /tmp" and get a streamed reply with a `bash` tool call card + result. File tree route returns correct listings. No polish, no sessions persistence, no styling.

### M2 — Remote mode (Vercel Sandbox) + unified access proof (≈ 1 week)

Prove the core architectural claim: swapping adapters flips from local to remote with zero changes elsewhere.

- [x] `createVercelSandboxWorkspace(sandbox)` — adapter against `sandbox.fs.*` + caching layer. ~173 LOC.
- [x] `createVercelSandboxExec(sandbox)` — adapter wrapping `sandbox.runCommand` + heartbeat/abort. ~122 LOC.
- [x] `SandboxHandleStore` interface (`shared/sandbox-handle-store.ts`) + `FileHandleStore` default impl at `~/.config/boring-agent/sandboxes.json`. Atomic writes.
- [x] `resolveSandboxHandle(workspaceId)` — create-or-get-or-resume-from-snapshot + in-process cache. ~333 LOC.
- [x] `resolveMode('vercel-sandbox')` returns a `RuntimeBundle` whose workspace + sandbox are bound to the same Vercel sandbox handle.
- [x] Config: `BORING_AGENT_MODE`, `VERCEL_OIDC_TOKEN`, `VERCEL_TEAM_ID`.
- [x] Periodic snapshot for safety (`PeriodicSnapshotScheduler` with configurable interval, default 10min).
- [x] Circuit breaker around the Vercel SDK client (exponential backoff, fast-fail when open). Full state machine (closed/open/half-open).
- [x] Snapshot retention policy (keep-last-2 per workspace) — `applySnapshotRetention()` configurable via `BORING_AGENT_SNAPSHOT_KEEP`.
- [x] Standalone app reads `BORING_AGENT_MODE` — same code path serves both modes.

**Gate:** `BORING_AGENT_MODE=vercel-sandbox pnpm dev` — same chat UI, same tools, files now living in a Firecracker VM. No other code changes. Switching modes mid-development is an env-var flip.

### M3a — Core UX contracts: sessions + resume + bridge (≈ 4 days)

Load-bearing contracts that must be reliable before polish. If these aren't solid, no amount of chat UX polish helps.

- [x] `PiSessionStore` implementing `SessionStore` over pi's JSONL. CRUD via HTTP routes.
- [x] **Stream resumption:** `StreamBufferStore` tracks active turns; `GET /api/v1/agent/chat/:sessionId/stream?cursor=<n>` replays from cursor. X-Turn-Id header returned.
- [x] Abort handling (`AbortController` in chat route → pi `abortSignal` → sandbox exec cancellation).
- [x] SSE channel: backend emits `data-file-changed` events → frontend `useFileChangeStream` invalidates React Query cache.
- [x] **UI bridge** (`UiBridge` interface + in-memory impl):
  - `GET/PUT /api/v1/ui/state` — opaque state KV keyed by workspaceId
  - `POST /api/v1/ui/commands` — agent posts UI command with seq numbering
  - `GET /api/v1/ui/commands/next` (SSE) — workspace subscribes to command stream (poll=true variant also supported)
  - Agent tools `get_ui_state` + `exec_ui` wired as host-provided tools when `uiBridge` is provided
- [x] `copyTemplate()` — sync template copy on workspace create. `createAgentApp({ templatePath })` + `BORING_AGENT_TEMPLATE_PATH` env fallback. Idempotency via `.boring-agent/provisioned` marker.

**Gate:** session CRUD + resume + UI bridge are reliable in both modes. Reliability bar > polish bar for this milestone.

### M3b — Chat UX polish & operator ergonomics (≈ 3 days)

UX polish on top of the M3a contracts. Pure frontend + minor backend additions.

- [x] Tool rendering — `Tool`, `Terminal`, `CodeBlock` primitives + `DiffView` for edit tool. `toolRenderers` prop exposed on `<ChatPanel />`.
- [x] ai-elements primitives in `src/front/primitives/`: Message, Composer, Tool, Terminal, CodeBlock, Reasoning.
- [x] `<SessionToolbar />` — current session title + dropdown of recent (MAX_VISIBLE=10) + new chat button + per-session delete with confirmation.
- [x] `theme.css` + CSS vars scoped to `[data-boring-chat]`. Default dark theme.
- [x] Background title generation via `createSessionTitleScheduler`.
- [x] **Slash commands** infrastructure + 5 built-ins (`/clear`, `/reset`, `/model`, `/help`, `/cost`). Registry + parser + builtins.
- [x] **Heartbeat events** during long tool execution: `onHeartbeat` callback in `ExecOptions`; rendered in Tool component.
- [x] **`/api/v1/agent/sessions/:id/changes`** endpoint: `InMemorySessionChangesTracker` tracks file ops; returns `{files: [{path, op, size, timestamp}]}`.

**Gate:** standalone app feels like a real chat in both modes; FileTree and Editor visibly update when the agent writes files.

### M4 — Plugin compat (≈ 2–3 days)

Pi plugin ecosystem compatibility. Local mode only (plugins are Node-native; irrelevant for remote VM).

- [x] Wire pi's extension discovery through `createAgentSession` options. Plugin loader at `pluginLoader.ts`.
- [x] Surface plugin-registered tools in the catalog via `mergeTools.ts`.
- [ ] Resolve name-collision precedence; document. *(deferred — last-registered-wins accepted risk)*
- [ ] Smoke-test 2–3 community pi extensions.
- [ ] Document that in `vercel-sandbox` mode, plugins are not auto-loaded.

**Gate:** dropping a file in `~/.pi/agent/extensions/hello.ts` surfaces a working tool in the chat (local mode).

### M5 — Workspace extension hooks + docs (≈ 2 days)

The public API that `@boring/workspace` will consume when we build it.

- [ ] `registerTool()` runtime API (alongside pi extensions). *(deferred)*
- [x] `<ChatPanel toolRenderers={...}>` override prop. Implemented via `ToolRendererOverrides`.
- [x] Per-panel CSS var scoping — `[data-boring-chat]` attribute scoping, all vars `--boring-chat-*`.
- [ ] API docs under `docs/`. *(deferred)*
- [ ] Migration guide: "your boring-macro, now with mode switch." *(deferred)*

**Gate:** a two-file example `examples/with-custom-tool/` demonstrates adding a tool + renderer + restyle from outside the package. `boring-macro` can boot in both modes by flipping one env var.

### M6+ — Optional expansions (on demand)

- `CloudflareSandboxWorkspace` + `CloudflareSandboxExec` (parallel to Vercel, Cloudflare infra)
- `execute_isolated_code` tool (5th tool, nao-style — appears when a sandbox declares `'isolated-code'` capability)
- Two-tier Python venv for local bwrap mode (shared `[sandbox].python_packages` + per-workspace overlay)
- Browser-agent harness (`PiAgentCoreHarness` or `ToolLoopAgentHarness`) + `JustBashSandbox` + `OpfsWorkspace`

---

## Risks & accepted exposures

**v1 philosophy: ship fast, accept known risk.** We are deliberately NOT engineering defensive mitigations for the risks below. Each is a known exposure; if it bites, we react then. This section exists so the trade-offs are explicit, not accidental.

### Risks accepted with minimal / no mitigation in v1

| Risk | Accepted exposure | If it bites |
|---|---|---|
| **Pi SDK API instability** (v0.68.x, no semver) | Pin version in `package.json`. No contract test, no abstraction hedge, no fallback to pi-agent-core. | Pi ships a breaking change → v1 breaks on upgrade. Fix: revert pin, manual patch, or reluctantly implement `PiAgentCoreHarness` adapter at that point. |
| **Pi event-shape drift** (undocumented internal events our stream adapter consumes) | Same as above — ride pi's stream shapes. No snapshot tests. | Silent stream-adapter breakage on pi upgrade → debug reactively. |
| **Pi abort → bash child propagation** | Write the `sleep 60 → abort → dead in 2s` e2e test in M1. No process-group kill wrapper, no SIGKILL escalation. | Test passes → accept. If test fails → add process-group kill then. If it passes now but regresses later → user complaint triggers fix. |
| **Vercel Sandbox cost** | No POC, no budget alerts, no hard caps, no aggressive auto-stop. Snapshot retention bounded (keep-last-2 policy). | Surprise bill → add snapshot+stop-on-idle and budget alert reactively. Exposure bounded by active workspaces × 45-min default TTL × 2 snapshots each. |
| **Abandoned Vercel sandbox leaks** | No release-on-session-close hook. Vercel's own TTL eventually deletes. | Each abandoned session costs ~45 min × active-CPU-ms. Proportional to user count — small at first. Add release hook if bill hurts. |
| **Multi-tab concurrent sessions on same workspace** | Allow N tabs; trust pi + fs to interleave. No lock, no read-only signal, no optimistic concurrency. | Codex flagged as "data-loss territory." We accept: silent last-write-wins on concurrent writes. Documented caveat: "one tab recommended." If users hit it, upgrade to `expectedMtime` 409-conflict (~30 LOC). |
| **Plugin tool name collisions** | Last-registered wins. No reservation of built-in names. | Pi plugin registering a `bash` tool shadows ours. Documented: "plugin authors accept responsibility for naming." Codex recommended reservation + namespacing; deferred. |

### Risks addressed by design (already mitigated)

| Risk | Why it matters | Design-time mitigation |
|---|---|---|
| **Plugin × sandbox mismatch** (plugins bypass Sandbox in remote mode) | Plugin tools run in the backend Node process; in remote mode, that's NOT the Vercel VM. | Enforced: **plugin loading is local-mode-only.** Remote mode skips `pi.loadExtensions`. Documented rule + 3-line check at harness construction. |
| **Vercel Sandbox fs latency on tight loops** | 50 readFile calls = 50 round-trips (2–5s). Bad UX. | Document: agent prefers bash `grep`/`find` for multi-file ops. No code change needed; pattern enforced by system prompt + tool availability. |
| **Tailwind v4 consumer compatibility** | ai-elements requires Tailwind v4. | Documented consumer requirement. No vanilla-CSS variant in v1. |
| **SSE long-lived connections on serverless** | Would break if backend moved to Vercel Functions. | Documented: backend assumes persistent-process host (Fly/Render/Railway). Not a concern today. |
| **Backend process crash loses sandbox handle cache** | In-memory cache dies on restart. | Accepted tradeoff: lazy rebuild from DB is fast (~100 ms first-request penalty). No persistent cache needed in v1. |

### Risks requiring real mitigation in v1

These we **do** need to engineer, because they're load-bearing for core functionality:

| Risk | Mitigation |
|---|---|
| **Vercel cold start UX** (2–10 s on first `Sandbox.create({ source: 'git' })`) | M2 ships async workspace provisioning with polling state (`pending → ready`). Pre-baked template snapshot for fast subsequent creates. Required for M2 to feel usable. |
| **Vercel OIDC token expiry** | M2: support both `VERCEL_OIDC_TOKEN` (dev) and `VERCEL_ACCESS_TOKEN` (long-running prod). Startup validation that at least one is present. |
| **pi SessionEntry → UIMessage mapping** | M3: write mapping table as code comments tying pi event kinds to UIMessage parts. Conformance test covers all event kinds the adapter emits. Required for session-resume to work. |

### Why this posture

v1 is **prove the architecture works end-to-end**, not **productionize**. Each accepted exposure above is tracked; when the first user pain hits, the mitigation path is pre-identified. Engineering upfront defensive code for risks that may never fire is the wrong trade-off at this stage.

**Re-evaluate this posture at v1.5** — when we have real users and real workloads, some of the "accepted" risks will upgrade to "needs mitigation now."

---

## Test strategy (v1)

- **CI:** lint + typecheck (`tsc --noEmit`) on every PR. Lint rule in `primitives/`: no hard-coded color classes (`bg-slate-*`, etc.) — must use `bg-[var(--boring-chat-*)]`.
- **Unit tests:** stream-adapter fixture-based (pi event → UIMessage mapping). `ExecOptions` timeout + maxOutputBytes + buffer handling. Path validator (`validatePath`, `assertRealPathWithinWorkspace`). Slash-command parser.
- **One e2e smoke test per mode:** spawn CLI, send a message, assert streamed response contains expected bash output. Direct + local run in CI on every PR. `vercel-sandbox` skipped on PRs (costs money) and runs on release tags only.
- **No UI snapshot tests in v1.** Accepted drift; easy to add when the UI stabilizes.

---

## Open research items (true unknowns only)

*Items previously in this list that have been resolved: TypeBox vs JSON Schema → JSON Schema; SSE vs polling → SSE; ai-elements adoption → copy into `primitives/`.*


1. **Pi built-in opt-out** — confirm `createAgentSession({ tools: [our...] })` fully replaces defaults. Docs imply yes; verify by test in M1.
2. **Plugin name collision** — precedence when our `bash` and a plugin's `bash` coexist. Research + document in M4.
3. **Pi abort propagation** — does pi's `abortSignal` reach child bash processes inside bwrap and Vercel Sandbox? Test in M1 (local) + M2 (remote).
5. **Tailwind v4 conflict risk** — when workspace also uses Tailwind, do our classes and theirs compose cleanly? Test in M5.
6. **Pi SessionEntry → UIMessage mapping** — finalize conversion for all pi event types in M3; write a conformance test.
8. **Vercel Sandbox latency on tight fs loops** — measure real numbers for 100-file tree listing, 50-file grep, during M2. If painful, plan mitigations (sandbox-side grep tool, batched reads, caching).
9. **Vercel Sandbox cold-start + snapshot UX** — how long does first workspace creation take with and without snapshots? What's the right "restoring workspace..." UX? Test in M2.
10. **Template → Vercel tarball flow** — build pipeline that packages `BORING_AGENT_TEMPLATE_PATH` into a tarball, uploads to Vercel Blob, references in `Sandbox.create({ source: { type: 'tarball', url } })`. Decide at M3 whether this deserves dedicated tooling or a README.
11. **Vercel billing model** — active-CPU-ms pricing vs Fly machine hours at realistic usage. POC-quality numbers before any migration claim.
13. **Pairing invariant enforcement** — can the factory guarantee you can't construct a mismatched pair? Type-level vs runtime check.

---

## Out of scope (explicit)

### Owned by future packages

- **`@boring/cloud`:** multi-workspace provisioning, per-user/per-tenant workspace lifecycle, workspace creation UI, Fly Machine / Modal / Vercel account orchestration, billing integration, multi-tenant auth. The agent package receives a resolved `workspaceId` — it does not create, list, or switch workspaces at runtime.
- **`@boring/workspace`:** file tree component, editor, layout (DockView), layout persistence, session-list sidebar (rename dialog in particular — delete ships in agent v1). Git UI is dropped from workspace v1 entirely; if it comes back in v1.x, agent will add `/api/v1/git/*` routes. Agent exposes the HTTP endpoints that power these; workspace builds the UI on top.

### Deferred (design seams exist; no implementation in v1)

- Browser-agent harness + `JustBashSandbox` + `OpfsWorkspace`.
- Cloudflare Sandbox mode (parallel to Vercel mode).
- `execute_isolated_code` tool (lights up when a sandbox declares `'isolated-code'` capability).
- Two-tier Python venv infra (shared + overlay).
- SQLite / IndexedDB / remote `SessionStore` implementations.
- Rich session management UI (sidebar, folders, search, rename/delete flows).

### Not planned

- Multi-user auth, billing.
- Non-Anthropic providers.
- MCP tool integration.
- Deployment tooling (Docker/Modal/Fly).

---

## Coordination with `@boring/workspace`

The workspace package (spec: `/home/ubuntu/projects/boring-ui-v2/packages/workspace/docs/plans/archive/WORKSPACE_V2_PLAN.md`) is designed to be composed with this agent package. Contracts agreed across the two plans:

### Backend ownership (single source of truth)

All backend HTTP routes live in the **agent** package: `/api/v1/files/*`, `/api/v1/tree`, `/api/v1/stat`, `/api/v1/ui/*`, `/api/v1/agent/*`. Git routes (`/api/v1/git/*`) are deferred from v1 since neither agent nor workspace has git UI in v1 — no consumer, dead code. Workspace is a **pure frontend package** — no server code. UI bridge at `/api/v1/ui/*` is also agent-hosted — workspace can't host it because workspace is frontend-only.

### UI bridge (agent-hosted, workspace-consumed)

The agent package hosts `/api/v1/ui/*` bridge endpoints — this is backend and agent owns all backend.

Three flows:

| Direction | Transport | Purpose |
|---|---|---|
| Agent → UI display | AI SDK UIMessage stream (chat) | Render agent messages in `<ChatPanel />` |
| UI → Agent state | `PUT /api/v1/ui/state` | Workspace pushes layout state; agent tool `get_ui_state` reads |
| Agent → UI commands | `POST /api/v1/ui/commands` + SSE `GET /api/v1/ui/commands/next` | Agent calls `exec_ui({ kind, params })`; workspace dispatches |

Agent sees 2 bridge tools: `get_ui_state` and `exec_ui({ kind, params })`. Workspace defines UI state shape + command kinds (`openFile`, `openPanel`, `showNotification`, extensible). Agent doesn't know about DockView panels; workspace doesn't know about sandbox details. Clean ownership split.

### Component exports — app-shell composition surface

**Integration pattern (updated 2026-04-24 to match new dep graph):** workspace **imports `ChatPanel` directly** from `@boring/agent` as a built-in pane. Agent stays the leaf — it has no knowledge of workspace, core, or any React layout engine. App shells can still inject an alternate `ChatPanel` via `WorkspaceProvider`'s `panels` prop to mix/match chat surfaces; the built-in is just the default. Earlier drafts said "workspace does NOT import agent" — that was v1 thinking and is superseded.

| Export | From agent | Consumed by | Purpose |
|---|---|---|---|
| `ChatPanel` | `@boring/agent` (top-level barrel) | **App shell** — passed as `panels[{id:'agent', component: ChatPanel, …}]` | The single chat component. Full-height, pane-friendly. Workspace renders it via its panel registry without knowing its internals. |
| `useSessions()` | `@boring/agent` (or `@boring/agent/front`) | **App shell or Tier-3 headless consumers** | Powers custom session UI (sidebar, picker). Workspace v1 ships no session UI beyond SessionToolbar — apps that want richer session UX wire `useSessions()` in their own components. |
| `useAgentChat()` | `@boring/agent` (top-level barrel) | **Tier-3 headless consumers** (rare) | For building custom chat shells; not used by workspace package or standard app shells. |

**Example app-shell wiring (what `examples/with-custom-tool/` demonstrates):**
```tsx
// App code — imports from BOTH packages:
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { ChatPanel } from '@boring/agent'

<WorkspaceProvider panels={[{ id: 'agent', component: ChatPanel, placement: 'right' }]}>
  <IdeLayout />
</WorkspaceProvider>
```

**Updated 2026-04-24:** the "workspace does not import agent directly" rule was superseded by the new dep chain (`agent (leaf) ← workspace ← core`). Workspace now imports `ChatPanel` directly as a built-in pane; the `panels` prop is kept as an override mechanism, not the primary wiring. Bundle-size concern is addressed by lazy-loading ChatPanel inside the workspace pane registry (dynamic import, only loaded when the agent pane is actually mounted). Agent remains the leaf — it imports nothing from workspace or core. Canonical graph: `packages/core/docs/CORE.md` §Dependency position.

### Session CRUD contract

Workspace plan expects `{ sessions, activeSessionId, switchSession, createSession, deleteSession }`. Agent v1 ships all five (delete added as +20 LOC; rename deferred — workspace plan accepts this):

```ts
const { sessions, activeSession, create, switch: switchTo, delete: remove } = useSessions()
```

### Cross-plan alignment status

As of the 2026-04-22 alignment pass, the workspace plan (`/home/ubuntu/projects/boring-ui-v2/packages/workspace/docs/plans/archive/WORKSPACE_V2_PLAN.md`) has been updated to match this spec. Specific edits applied to the workspace plan:

- Backend ownership: workspace-server-owns claims removed; server-side ownership table rewritten to show agent owns all routes; workspace is frontend-only.
- File-tree endpoints: `/api/v1/files/list` → `/api/v1/tree`; added concrete `/api/v1/files/search` route (filename glob via `find`) matching workspace's search-input need.
- UI bridge: transport expectations updated to match agent's SSE-based design (`GET /api/v1/ui/commands/next` for agent→workspace commands, `PUT /api/v1/ui/state` for workspace→agent state). No WebSocket.
- Component names: `AgentPane` → `ChatPanel` across imports and examples.
- Repo path: `v2/packages/*` → `boring-ui-v2/packages/*`.
- Dynamic-pane resolved-questions marked `DEFERRED` (workspace plan's own decision table already flagged them out-of-scope for v2).
- Data-layer decision wording clarified: workspace ships a thin `DataProvider` context (React Query + typed fetch) — not an abstraction for swappable backends. Resolves the self-contradiction in its own decisions table.

Remaining workspace-plan tasks not covered by this alignment pass (author discretion):

- Remove stale mention of workspace adding git ops via `simple-git` (superseded by agent's `sandbox.exec` approach).
- If any example code still shows workspace-hosted server endpoints, trim those too.

---

## Review decisions

Two external reviews shaped this spec. Outcomes recorded here for traceability.

### External architecture review (Codex, 2026-04-22) — 12 findings

**Adopted (4):**

| # | Finding | Integration |
|---|---|---|
| 1 | Workspace CRUD inconsistency | Removed `/api/v1/agent/workspaces` from HTTP surface; session routes trimmed. |
| 2 | Exec safety caps | `ExecOptions { timeoutMs, maxOutputBytes }`; `ExecResult` adds `durationMs`, `truncated`, Uint8Array-typed stdout/stderr. |
| 6 (partial) | Vercel API resilience | Circuit breaker wrapping the Vercel SDK client. Skipped the lease/heartbeat/reconciler machinery (cloud-package territory). |
| 11 | Export surface consistency | Decision #15 rewritten. `SessionToolbar` instead of `SessionList`; no rename/delete dialogs; no `useRegisterTool` hook. |

**Deferred/rejected (8)** — per the "ship fast, accept known risk" posture:

| # | Finding | Why deferred |
|---|---|---|
| 3 | Optimistic write concurrency | Accepted risk; silent last-write-wins on multi-tab. |
| 4 | `CanonicalSessionStore` (SQLite) | Stay on pi JSONL. Drift risk accepted. |
| 5 | Performance budgets + benchmarks | No numbers until users complain. |
| 6 (majority) | Lease/heartbeat/reconciler | Cloud-package territory. |
| 7 | Plugin name reservation + namespacing | Last-registered wins. |
| 8 | Control plane (policy/audit/telemetry) | Retrofit when operationally needed. |
| 9 | `ChangeReviewDrawer` (review-before-apply) | Workspace-package feature. |
| 10 | M0.5 invariant-tests milestone | Invariants emerge via normal review. |

### Product/UX review (internal, 2026-04-22) — 12 findings

Focused on product-shaped gaps codex didn't cover. **All 11 feasible adopts integrated** into the spec sections above:

| # | Finding | Where integrated |
|---|---|---|
| 1 | Stream resumption in v1 (not deferred) | Session management section + M3 milestone |
| 2 | Uint8Array-typed exec output (binary-safe) | `ExecResult` interface |
| 3 | Slash commands (`/clear`, `/reset`, `/model`, `/help`, `/cost`) | New "Slash commands" section + M3 milestone |
| 4 | CLI SSH/headless detection for browser-open | CLI startup sequence |
| 5 | Auto-gitignore for workspace artifacts | CLI startup sequence |
| 6 | Heartbeat events during long tool calls | Stream adapter table + M3 milestone |
| 7 | Vercel snapshot retention (keep-last-2) | Sandbox lifecycle + env vars + M2 milestone |
| 8 | CSS-var ↔ Tailwind contract worked example | Styling contract section |
| 10 | CLI `--logout` / `--reset-key` flags | CLI flags table |
| 11 | Windows-native support statement (WSL2 only) | Direct mode section |
| 12 | Test strategy statement | New "Test strategy" section |

**Considered and rejected (1):**

| # | Finding | Why rejected |
|---|---|---|
| 9 | `/api/v1/agent/sessions/:id/changes` endpoint | Still integrated — was upgraded to adopt once scope was reviewed. (Kept for UX parity with Claude Code change-summary pattern.) |

All told: **11 of 12 product-UX findings adopted**; the two reviews complement each other with no conflicts. Net LOC impact: ~300 over the pre-review baseline (now ≈ 2,800).

---

## Migration gaps from current boring-ui

Existing apps in `/home/ubuntu/projects/boring-ui/apps/*` use features that v2 agent **does not support**. When migrating an app to v2:

| Current feature | v2 agent status | Migration path |
|---|---|---|
| `workspace.backend = "direct"` | ✅ Supported via `mode: "direct"` | Set `BORING_AGENT_MODE=direct` — no bwrap required. |
| `workspace.backend = "bwrap"` | ✅ Supported via `mode: "local"` | Set `BORING_AGENT_MODE=local`. |
| `workspace.backend = "lightningfs"` | ❌ Not in v2 (browser agent deferred) | App needs server-mode or await browser-agent harness. |
| `workspace.backend = "justbash"` | ❌ Not in v2 (experimental, dropped) | Migrate to `direct` or `local`. |
| `agent.placement = "browser"` | ❌ Not in v2 (design seam only) | Apps using browser pi must move to `placement: "server"`. |
| `agent.runtime = "pi"` (pi-agent-core) | ⚠️ Migrated to pi-coding-agent | Mostly compatible — adapt any custom tool wiring to new harness API. |
| `agent.runtime = "ai-sdk"` | ❌ Not in v2 (pi-coding-agent only) | boring-macro and agent-backend need rewrites on this path; defer migration until v2 is proven or add AiSdkHarness later. |
| DockView IDE layout | ❌ Not in agent v2 (workspace package territory) | Build layouts in `@boring/workspace`. Agent ships panels, workspace arranges. |
| Chat-centered layout (NavRail, BrowseDrawer, SurfaceDockview) | ❌ Not in agent v2 | Same — workspace package. |
| Multi-workspace runtime (POST /workspaces, provisioning state machine) | ❌ Not in agent v2 | Future `@boring/cloud` package. Agent v2 takes a single workspaceId at boot. |
| GitHub Connect + git UI panels | ❌ Not in agent v2 | Git ops via bash tool (`git status`, `git commit`); UI comes from workspace package. |
| Settings management / API key UI | ❌ Not in agent v2 | env + Vault; workspace package can add settings UI on top if needed. |
| Image uploads in chat | ⚠️ Not in v1 scope | Punt to workspace package or v1.x. ai-elements has an `Attachments` component — adapt when we need this. |
| Artifact viewer (side panel) | ❌ Not in agent v2 | Workspace package. ai-elements has `Artifact` component. |
| Model selector in session toolbar | ⚠️ Moved to composer | Retain as feature, relocate UX. |
| Thinking level selector | ⚠️ Moved to composer | Same. |
| Session delete | ✅ Ships in v1 | `DELETE /api/v1/agent/sessions/:id` + `SessionStore.delete`. |
| Session rename | ❌ Not in v1 | Deferred — workspace package likely. |
| Fly machine provisioning | ❌ Not in agent v2 | `@boring/cloud`. |

**Concrete migration advice for each current app:**

| App | Current mode | v2 migration |
|---|---|---|
| **apps/ide** (bwrap + pi browser) | Move pi to server; keep bwrap. Layout stays in workspace package. | |
| **apps/chat** (direct + pi browser) | Move pi to server; use `direct` mode. Chat layout in workspace package. | |
| **apps/custom-layout** (direct + pi browser) | Same as above. | |
| **apps/minimal** (direct) | Use v2 standalone app + `mode: "direct"`. | |
| **apps/agent-backend** (bwrap + ai-sdk server) | Migrate ai-sdk → pi-coding-agent. Otherwise compatible. | |
| **apps/agent-frontend** (lightningfs + pi browser) | Blocked until browser-agent harness ships. | |
| **boring-macro** (bwrap + ai-sdk server) | Migrate ai-sdk → pi-coding-agent. Template + system prompt transfer. | |

---

## Reference files from the old boring-ui (port / adapt, don't re-research)

Everything in this section is a **concrete starting point**. When you see a task in the roadmap, it maps to one or more of these files. Port and adapt — no blind research.

All paths are relative to `/home/ubuntu/projects/boring-ui/` (the existing monorepo).

### Path helpers & workspace resolution (M1 — NodeWorkspace)

| Port to | From | Notes |
|---|---|---|
| `src/server/workspace/paths.ts` | `packages/workspace/src/server/workspace/paths.ts` (~80 LOC) | `validatePath`, `assertRealPathWithinWorkspace`, `ensureExistingWorkspacePath`, `ensureWritableWorkspacePath`. Copy verbatim; tested and battle-hardened. |
| `src/server/workspace/resolver.ts` (partial) | `packages/workspace/src/server/workspace/resolver.ts` | Take the `resolveWorkspacePath(workspaceRoot, workspaceId)` function. Drop `BACKEND_CAPABILITIES` (we use our own capabilities model). |
| `src/server/workspace/node/createNodeWorkspace.ts` | New — compose using the ported `paths.ts` helpers | `readFile/writeFile/readdir/stat` via `node:fs/promises` wrapped by `validatePath` on every call. |

### Bwrap adapter (M1 — BwrapSandbox)

| Port to | From | Notes |
|---|---|---|
| `src/server/sandbox/bwrap/exec.ts` | `packages/workspace/src/server/adapters/bwrap.ts` | `buildBwrapArgs()` function (lines ~22–58). Flag order matters (security-critical). Adapt `BWRAP_TIMEOUT_SECONDS`, `KILL_GRACE_SECONDS`, `RO_BIND_DIRS`. |
| `src/server/sandbox/bwrap/createBwrapSandbox.ts` | New — wraps `buildBwrapArgs` + `child_process.spawn` + our `Sandbox` interface | Takes `Workspace` in `init()`; `sandbox.exec(cmd)` spawns `bwrap ...args -- bash -c cmd`. |
| Existing test shape | `packages/workspace/src/server/__tests__/execJob.test.ts` | Reference pattern for testing bwrap spawns (mocking `child_process.spawn`). |

### HTTP routes (M1 — unified /api/v1/files, /api/v1/tree)

| Port to | From | Notes |
|---|---|---|
| `src/server/routes/file.ts` | `packages/workspace/src/server/http/fileRoutes.ts` (~200 LOC) | GET/POST/DELETE file, GET stat. Adapt to use our `Workspace` interface instead of raw fs. Keep auth + validation. |
| `src/server/routes/tree.ts` | `packages/workspace/src/server/http/fileRoutes.ts` (tree endpoint section) | Lazy directory listing. Adapt to `workspace.readdir()`. |
| `src/server/routes/workspaces.ts` | `src/server/services/workspaces.ts` + `src/server/http/workspaceRoutes.ts` | CRUD for workspaces. Drop multi-tenancy details; v1 is single-tenant-per-container. Keep the `provisioning_step` state shape for remote mode. |

### Pi harness & stream adapter (M1 — PiCodingAgentHarness)

| Port to | From | Notes |
|---|---|---|
| `src/server/harness/pi-coding-agent/createHarness.ts` | `packages/agent/src/server/harnesses/pi/runtime.ts` | **IMPORTANT:** old code uses `pi-agent-core`. Our plan uses `pi-coding-agent` (wraps pi-agent-core + plugins + sessions). Adapt the model registry + auth init; replace `new Agent(...)` with `createAgentSession({ tools })`. |
| `src/server/harness/pi-coding-agent/stream-adapter.ts` | `packages/agent/src/server/harnesses/pi/canonicalStream.ts` | Event-emission pattern (sendSseLegacy/sendCanonicalChunk). Rewrite to emit AI SDK `UIMessageChunk` shapes via `createUIMessageStream` instead of SSE directly. |
| `src/server/harness/pi-coding-agent/tools.ts` | `packages/agent/src/server/harnesses/pi/tools-impl.mjs` | Existing tool impls to study for bash/read/write patterns. Our factories will be similar but bound to our `Workspace` + `Sandbox` interfaces. |
| Session-context pattern | `packages/agent/src/server/harnesses/pi/sessionContext.ts` | How workspaceId + userId flow into agent. Our pattern is the same. |

### Frontend — chat UI (M3 — polish milestone)

| Port to | From | Notes |
|---|---|---|
| `src/front/ChatPanel.tsx` | `packages/agent/src/front/components/chat/AiChat.jsx` + `ChatMessage.jsx` | Reference structure only. v2 is `useChat`-based with ai-elements — will look different. Use the old file to understand the event flow. |
| `src/front/primitives/Message.tsx` | `packages/agent/src/front/components/chat/ChatMessage.jsx` | Reference for role-based rendering (user/assistant/tool). ai-elements' `Message` is the canonical base; port any boring-specific tweaks. |
| `src/front/primitives/Composer.tsx` | adapt ai-elements `PromptInput` | No direct port; ai-elements provides the base. |
| Tool renderers (optional) | `packages/agent/src/front/components/chat/{Bash,Edit,Read,Write,Grep,Glob}ToolRenderer.jsx` | **If** ai-elements' generic `Tool` + `Terminal` + `CodeBlock` aren't enough, these are ready-to-adapt. Most likely only EditToolRenderer is worth porting (diff view). |

### Frontend — data provider pattern (M1 — useChat wiring)

| Port to | From | Notes |
|---|---|---|
| `src/front/hooks/useAgentChat.ts` | `packages/agent/src/front/providers/pi/useChatTransport.js` | The old `useChatTransport` is a custom transport adapter. v2 uses AI SDK's `useChat` natively — much simpler. Use old file to understand what state the chat view needs. |
| Data provider concept | `packages/workspace/src/front/providers/data/httpProvider.js` | Pattern for typed HTTP calls against our routes. v2 uses TanStack Query directly on AI SDK-shaped endpoints. |

### Frontend — file tree (workspace package, reference only)

| Reference | File | Notes |
|---|---|---|
| Lazy-load pattern | `packages/workspace/src/front/components/FileTree.jsx` | Not ported here — lives in `@boring/workspace` in v2. But shows the HTTP-endpoint contract the agent package must serve (route shapes, query params, error codes). |

### boring.app.toml precedent

`/home/ubuntu/projects/boring-macro/boring.app.toml` is a complete example of a child app using boring-ui. Reference for:
- `[workspace]` + `[agent]` + `[backend]` + `[frontend]` section shapes
- `[deploy.secrets]` + `[deploy.env_vars]` Vault integration pattern
- Agent `system_prompt` convention

### What NOT to port

- `uiStateRoutes.ts` — agent-UI-bridge infrastructure from v1; not in scope for agent v2 (workspace package will handle layout state later).
- `workspaceBoundary.ts` — multi-app routing; out of scope for v2 agent (single-app per container).
- Existing `pi-agent-core` wiring — we migrate to `pi-coding-agent` instead (different API, different session model).
- Old `execRoutes.ts` — wrapped legacy exec; our `Sandbox` adapter replaces it.
- `lightningFs` / `justBash` / `isomorphicGit` provider — browser-fs experiments; not in v2 scope.

### Templates & example integration

- `packages/agent/package.json` (old) — for reference exports structure.
- `/home/ubuntu/projects/boring-macro/deploy/fly/Dockerfile` — shows how `bubblewrap` is installed in a PaaS deploy context. Copy the apt-get line.
