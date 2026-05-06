# Hot-Reloadable Agent Plugins

**Last updated:** 2026-05-06  
**Status:** Planning complete — ready for implementation

---

## Goal

Let an agent write a plugin to `.boring/plugins/<name>/` and have it load live into a running workspace without a page refresh — contributing panels, commands, left tabs, surface resolvers, and server-side agent tools.

---

## Plugin Tiers

The workspace has two plugin tiers that coexist and share the same registry infrastructure.

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `package.json` (`"boring"` field) + factory |
| Loaded | At app startup via `bootstrap()` | At runtime via explicit reload + SSE |
| Migration required | No — stays declarative | N/A — new system |

**Outside plugins** (`filesystemPlugin`, `macroPlugin`, etc.) keep their current declarative `WorkspaceFrontPlugin` shape. `bootstrap()` registers them directly into registries at startup — unchanged. No migration.

**Inside plugins** are agent-authored. They use the factory-based `BoringExtensionAPI` and are loaded hot via the watcher. `PluginCoordinator` is **deleted** and replaced by `registerAgentPlugin` — this replacement is scoped to inside plugins only. `bootstrap()` is not affected.

### Inside plugin authoring paths

**Path A — Derive from an outside plugin.** The agent extends an existing outside plugin by adding panels, commands, or tools on top of it. The base plugin opts in via `extensionContract: { allowedContributions: [...] }`. The `"boring"` field uses `"derivesFrom": "<pluginId>"`. Purely additive — the base plugin's contributions remain active while the derived plugin is loaded.

**Path B — Build from scratch.** Self-contained plugin with its own front and server code.

---

## Pi Plugin Compatibility

Boring-ui plugins ARE pi extensions. The factory is a valid pi `ExtensionFactory` — the same file loads in pi's loader unchanged. Boring-ui extends the API object with optional UI-registration methods that pi simply doesn't provide.

### boring-pi-extension.ts — boring-ui as a pi extension

Boring-ui ships a first-class pi extension: `packages/agent/src/server/boring-pi-extension.ts`. Pi loads it via `extensionFactories[]` in `DefaultResourceLoader` (inline factory, closed over Fastify-side objects). It can also be loaded as a physical file by any standalone pi user who adds it to their `.pi/settings.json`.

```ts
// boring-pi-extension.ts — two usage modes, same file

// Mode A: inline factory (boring-ui server) — closes over Fastify objects, no HTTP
export function createBoringPiExtension(opts: {
  scanAndReload: () => Promise<void>   // direct call into Fastify-side logic
}): ExtensionFactory {
  return (api) => {
    api.registerTool(defineTool({ name: "exec_ui", ... }))
    api.registerTool(defineTool({ name: "open_panel", ... }))

    api.registerCommand("boring.reload", {
      description: "Reload boring-ui agent plugins from .boring/plugins/",
      handler: async () => { await opts.scanAndReload() },  // direct, no fetch
    })

    api.on("session_start", async (event) => {
      if (event.reason !== "reload") return
      await opts.scanAndReload()                            // direct, no fetch
    })
  }
}

// Mode B: file-based default export (standalone pi users) — communicates via HTTP
export default function boringUiExtension(api: ExtensionAPI): void {
  const reload = () => fetch("http://localhost:3000/api/agent-plugins/reload", { method: "POST" })

  api.registerTool(defineTool({ name: "exec_ui", ... }))
  api.registerTool(defineTool({ name: "open_panel", ... }))

  api.registerCommand("boring.reload", {
    description: "Reload boring-ui agent plugins from .boring/plugins/",
    handler: async () => { await reload() },
  })

  api.on("session_start", async (event) => {
    if (event.reason !== "reload") return
    await reload()
  })
}
```

**Two reload granularities:**
- `/reload` — pi's full reload: re-jiti all pi extensions + triggers boring-ui plugin scan via `session_start` hook
- `/boring.reload` — boring-ui only: scans `.boring/plugins/` without re-running pi's full reload cycle

**Inline vs file-based wiring:**
- `extensionFactories: [createBoringPiExtension({ scanAndReload })]` — used by boring-ui server; `scanAndReload` closes over `serverPluginRegistry` + `FsEventBroadcaster` directly, zero HTTP overhead
- Default export loaded from `.pi/settings.json` — used by standalone pi users; `PORT` env var or config points to the boring-ui server

**No file watcher.** The commit signal is `/reload` — same as pi. The agent writes plugin files, then types `/reload` (or `/boring.reload`). No `package.json` write triggers anything automatically.

### Discovery and loading

Pi uses `@mariozechner/jiti` to load extensions — TypeScript and TSX are handled natively without a compilation step. Pi reads `package.json["pi"]["extensions"]` to find entry points; those paths are passed directly to jiti regardless of file extension. The directory scanner (for extensionless index files) only picks up `.ts` / `.js`, but explicitly declared paths in `extensions[]` bypass that filter — so `"./front.tsx"` works.

```json
{ "pi": { "extensions": ["./front.tsx"] } }
```

Boring-ui mirrors this exactly for `.boring/plugins/<name>/`. Both fields point to the same factory file; both runtimes use jiti:

```json
{ "boring": { "entry": "./front.tsx", ... } }
```

A plugin with only `"pi"` (no `"boring"` field) also loads in boring-ui — `registerTool` and `registerCommand` work; no UI contributions are registered. This is the minimal pi-compatible plugin that runs identically in both runtimes.

**Note:** boring-ui's existing `pluginLoader.ts` (the custom wrapper in `packages/agent/`) uses native `import()` and restricts to `.js/.mjs`. This is wrong — it needs to be replaced with jiti to match pi's real loader behaviour (see TODO C).

### `BoringExtensionAPI`

All methods use the flat `register*` naming style — consistent with pi's `registerTool` / `registerCommand`.

```ts
interface BoringExtensionAPI {
  // ── Pi methods — boring-ui implements fully ──────────────────────────

  // Pi slash command (/name [args]). NOT a UI command palette entry.
  registerCommand(name: string, options: {
    description?: string
    handler: (args: string, ctx: unknown) => Promise<void>
  }): void

  registerShortcut(key: string, options: {
    description?: string
    handler: (ctx: unknown) => Promise<void> | void
  }): void

  // "load" and "unload" events are wired; all other events are no-ops.
  on(event: string, handler: (...args: unknown[]) => void): void

  // ── Pi methods — boring-ui stubs (no-op + console.warn in dev) ─────────
  // registerTool: no-op in the capturing API; logs a warning diagnostic
  // visible in the plugin status panel. Plugin tools must go in plugin.server.ts,
  // not front.tsx — calling registerTool in front.tsx silently drops the tool.
  registerTool(tool: ToolDefinition): void
  // All remaining pi API surface (exec, sendMessage, sendUserMessage,
  // events, getActiveTools, setActiveTools, setModel, appendEntry,
  // registerFlag, registerProvider, etc.) — no-op stubs

  // ── Boring-ui extras — flat optional methods, absent in pi ───────────
  // Use optional chaining so the factory is safe when pi loads it.
  registerPanel?(reg: BoringPluginPanelRegistration): void
  registerPanelCommand?(reg: BoringPluginCommandRegistration): void  // UI palette → opens panel
  registerLeftTab?(reg: BoringPluginLeftTabRegistration): void
  registerSurfaceResolver?(reg: BoringPluginSurfaceResolverRegistration): void
}
```

**Two command concepts — genuinely distinct:**
- `registerCommand("name", { handler })` — pi slash command (`/name`); boring-ui registers it as a slash command handler. No panel association.
- `registerPanelCommand?.({ id, title, panelId })` — boring-ui command palette entry that opens a panel. Not a pi concept.

### `ToolDefinition` — pi's exact TypeBox shape

Plugin authors use pi's `defineTool()` helper. The execute signature is pi's verbatim signature:

```ts
// From @mariozechner/pi-coding-agent — re-exported by @boring/workspace/plugin
interface ToolDefinition<TParams extends TSchema = TSchema> {
  name: string
  label: string
  description: string
  promptSnippet?: string
  promptGuidelines?: string[]
  parameters: TParams
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
    ctx: ExtensionContext,
  ): Promise<{ content: Array<TextContent | ImageContent>; details?: unknown }>
}
```

### Factory pattern

```ts
// front.tsx — valid pi ExtensionFactory, loads unchanged in pi or boring-ui
import { defineTool, Type }         from "@mariozechner/pi-coding-agent"
import type { BoringExtensionAPI }  from "@boring/workspace/plugin"

export default function factory(api: BoringExtensionAPI): void | Promise<void> {

  // ── Pi-compatible (works in pi and boring-ui) ─────────────────────────

  api.registerTool(defineTool({
    name: "search_csv",
    label: "Search CSV",
    description: "Full-text search over a CSV file",
    parameters: Type.Object({ q: Type.String() }),
    execute: async (_id, { q }) => ({
      content: [{ type: "text", text: `results for ${q}` }],
    }),
  }))

  api.registerCommand("csv.open", {
    description: "Open the CSV viewer",
    handler: async (_args, _ctx) => { /* slash command action */ },
  })

  // ── Boring-ui extras (optional chaining — safe when pi loads the factory) ─

  api.registerPanel?.({ id: "csv-viewer-panel", label: "CSV Viewer", component: CsvPane })
  api.registerPanelCommand?.({ id: "open-csv", title: "Open CSV Viewer", panelId: "csv-viewer-panel" })
  api.registerLeftTab?.({ id: "csv-tab", title: "CSV", panelId: "csv-viewer-panel" })
  api.registerSurfaceResolver?.({ kind: "csv.open", resolve: () => ({ panelId: "csv-viewer-panel" }) })
}
```

### `plugin.server.ts` — boring-ui only (pi has no server concept)

**All agent tools must go here, not in `front.tsx`.** The server loads `plugin.server.ts` via jiti (Node.js). `front.tsx` is browser-only and is never evaluated server-side — any React imports, `document`, or CSS modules in `front.tsx` would crash jiti.

```ts
// plugin.server.ts — loaded by jiti into the Fastify process
import { defineTool, Type } from "@mariozechner/pi-coding-agent"
import type { BoringServerPluginAPI } from "@boring/workspace/plugin"

export default function serverFactory(api: BoringServerPluginAPI): void | Promise<void> {
  api.registerTool(defineTool({
    name: "parse_csv",
    label: "Parse CSV",
    description: "Parse and return rows from a CSV file",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, { path }) => ({ content: [{ type: "text", text: "..." }] }),
  }))
  api.registerDisposer(() => { /* cleanup sockets/timers on unload */ })
}
```

---

## Package Structure

Every inside plugin is an npm package. `package.json` is the **single manifest** — there is no `boring.plugin.json`. The commit signal is `/reload` (or `/boring.reload`), not a file write.

### File layout

```
.boring/plugins/
  csv-viewer/
    package.json          ← single source of truth: discovery + metadata
    front.tsx             ← pi-compatible factory (default export)
    plugin.server.ts      ← optional: server tools
```

### `package.json` shape

```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "entry":           "./front.tsx",
    "server":          "./plugin.server.ts",
    "label":           "CSV Viewer",
    "derivesFrom":     "macro",
    "panels":          [{ "id": "csv-viewer-panel", "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv", "title": "Open CSV Viewer", "panelId": "csv-viewer-panel" }],
    "leftTabs":        [{ "id": "csv-tab",  "title": "CSV", "panelId": "csv-viewer-panel" }],
    "surfaceResolvers":[{ "id": "csv-open", "surfaceKind": "csv.open", "panelId": "csv-viewer-panel" }],
    },
  "pi": { "extensions": ["./front.tsx"] },
  "dependencies": { "papaparse": "^5.0.0" }
}
```

- `"boring"` — boring-ui discovery + all contribution metadata.
- `"pi"` — pi discovery (array, pi's native format). Omit if the plugin is boring-ui only.
- Plugin `id` = directory name (e.g. `csv-viewer`). `version` = top-level `"version"`.
- `"boring.entry"` is a single string — boring-ui always loads exactly one front entry. Pi supports multiple extensions per package; boring-ui does not.

### `"boring"` field schema (`BoringPackageField`)

```ts
interface BoringPackageField {
  entry: string               // single front factory entry point e.g. "./front.tsx"
  server?: string             // path to plugin.server.ts (boring-ui only)
  label?: string
  description?: string
  derivesFrom?: string        // Path A — hard failure if referenced plugin not registered

  // Contribution declarations — authoritative in both V1 and V2:
  panels?:           Array<{ id: string; title?: string }>
  commands?:         Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?:         Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
}
```

### Manifest-authority model

`boring.panels[]`, `boring.commands[]`, `boring.leftTabs[]`, and `boring.surfaceResolvers[]` are the **authoritative declaration** of what a plugin contributes — in both V1 and V2. The factory is the **implementation**: it provides component references and slash-command handlers that the manifest ids reference.

Validation at load time:
- **V1 only:** every `boring.panels[i].id` must have a matching `registerPanel?.({ id })` call in the factory → `MANIFEST_IMPL_MISMATCH` error. This check runs post-factory inside `registerAgentPlugin` (mode="direct") and is skipped entirely in V2.
- **V2 only:** manifest arrays are the sole source of truth — the factory never runs in the browser. No `MANIFEST_IMPL_MISMATCH` check applies.
- `MANIFEST_IMPL_MISMATCH` is therefore a runtime diagnostic, not a manifest parsing error — it belongs in `registerAgentPlugin`, not in `manifest.ts` or `readBoringPackage`.

### Validation rules

- `command.panelId`, `leftTab.panelId`, `surfaceResolver.panelId` must reference an `id` in `panels[]`
- No duplicate `id` within each array
- `entry` and `server` must pass `isSafePluginRelativePath` (no `..` escapes)
- `entry` must exist on disk at load time — missing file → `MISSING_ENTRY_FILE` error with message: _"front.tsx declared in entry but not found. Write front.tsx before package.json."_
- `server`, if declared, must also exist on disk before loading
- `derivesFrom` must pass `isValidBoringPluginId`; absence of the referenced plugin is a hard load failure
- Plugin id (directory name) must not collide with any registered outside plugin id

### Agent workflow

`/reload` (or `/boring.reload`) is the commit signal. The agent writes all files first, then triggers reload explicitly — same philosophy as pi.

```
1. write front.tsx             (no reload)
2. write plugin.server.ts      (no reload)
3. write package.json          (no reload — plain metadata now)
4. if new npm deps needed:
     exec `pnpm install` in .boring/plugins/<name>/  (installs to plugin-local node_modules)
     OR: pnpm add <pkg> at workspace root (simpler — always Vite-resolvable)
5. /boring.reload              ← reload fires here (boring-ui plugins only)
   OR /reload                  ← also reloads all pi extensions
```

**Why explicit reload is better than file watching:**
- No partial-write race conditions — all files are fully on disk before reload fires
- No per-plugin promise locks or 80 ms retry hacks
- No chokidar/fs.watch infrastructure
- Reload always fires between agent turns — never mid-message

**V1 dependency resolution:** Vite resolves bare imports from the workspace `node_modules`. For plugin-local dependencies, the workspace `vite.config.ts` must include `.boring/plugins` in `server.fs.allow`. The simplest approach for V1 is to install plugin deps at the workspace root — they're always resolvable without Vite config changes. Plugin-local `node_modules` require an additional `resolve.modules` config entry.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Manifest file | `package.json` only | Mirrors pi's `"pi": { "extensions": [...] }` pattern exactly. One file, no `boring.plugin.json`. |
| Reload trigger | `/reload` or `/boring.reload` | Same as pi — explicit user/agent gesture. No file watcher, no race conditions, no partial-write guards. `package.json` is plain metadata. |
| Boring-ui as pi extension | `boring-pi-extension.ts` | Boring-ui's coordinator ships as a real pi extension loaded via `extensionFactories[]`. Hooks into pi's `session_start { reason: "reload" }` event. Also distributable as a standalone file for pi users. |
| Plugin API naming | Flat `register*` throughout | Consistent with pi's `registerTool` / `registerCommand`. No namespace objects. |
| Boring-ui extras | Optional methods | `registerPanel?`, `registerLeftTab?`, etc. are absent in pi — optional chaining makes the same factory safe in both runtimes. |
| `registerTool` shape | Pi's verbatim `ToolDefinition` (TypeBox) | TypeBox parameters, full execute signature. Plugin authors use pi's `defineTool()` helper. Identical surface across both runtimes. |
| No build step | jiti handles `.tsx` natively | Pi's real loader uses `@mariozechner/jiti`; boring-ui also uses jiti for server plugins. No esbuild pre-compilation needed in V1. |
| Fix `pluginLoader.ts` | Replace native `import()` with jiti | Boring-ui's custom wrapper incorrectly restricts to `.js/.mjs`. Rewrite to use `createJiti` matching pi's real loader. |
| Server plugins | Boring-ui only | Pi has no server plugin concept. `plugin.server.ts` is loaded by jiti into the Fastify process. |
| Outside plugins | Stay declarative | `filesystemPlugin`, `macroPlugin`, etc. keep `WorkspaceFrontPlugin` shape. `bootstrap()` loads them. No forced migration. |
| PluginCoordinator | Full replacement | `PluginCoordinator` deleted. `registerAgentPlugin` replaces it for inside plugins only. `bootstrap()` and outside plugin registration unchanged — no migration required. |
| SSE for plugin events | Multiplex on `/api/v1/fs/events` | `boring.plugin.load`, `boring.plugin.unload`, `boring.plugin.error` are new event types on the existing stream. Browser SSE handler already connected — add filter. |
| Rollback on failure | Restore old state | Stage → validate → commit/rollback on both server and browser. Old plugin stays live on any failure. |
| Registries | Zustand stores | SSE updates go through `setState` — no Map mutation during React render cycle. |
| iframe handshake | Iframe sends `ready` first | Eliminates lost-init race. Host responds with `init`; iframe then renders. |
| Revision scope | Monotonic per pluginId | Every SSE event and reconnect response carries revision. Browser discards events where `revision ≤ lastSeen[pluginId]`. |

---

## Atomicity Model

Both server and browser use a **stage → validate → commit / rollback** pattern. Old state is never discarded until new state is proven good.

### Server

`boring.entry` (`front.tsx`) is **never loaded by the server**. It is browser-only and may import React, `document`, CSS modules — any of which crash jiti in Node.js. Only `boring.server` (`plugin.server.ts`) runs server-side. All agent tools contributed by a plugin must live in `plugin.server.ts`.

```
1. Read + validate package.json["boring"]  →  fail: write .error, SSE error, return (no state change)
2. (boring.server only) jiti.import(boring.server) — capture registerTool into temp registry
   (if boring.server absent — no server-side loading)
3. Stage fails (jiti throws)  →  write .error, SSE error, return (old tools untouched)
4. Commit: atomically swap temp registry → live registry; run old disposers first
5. activePlugins[pluginId] = { id: pluginId, boring, version, revision }  (updated BEFORE SSE dispatch)
6. Delete .boring/plugins/<id>/.error if present
7. SSE boring.plugin.load { id: pluginId, boring, version, revision }
```

**Plugin tools in running sessions:** The harness currently receives a static `customTools` array at session creation. Plugin tools registered after startup must be visible to running sessions. `createPiCodingAgentHarness` is updated to accept `getExtraTools: () => ToolDefinition[]` (a live getter) instead of a frozen array. Each new `AgentSession` calls the getter at creation time, picking up any plugin tools registered since startup.

Unload: run disposers, remove from live registry and activePlugins, SSE `boring.plugin.unload { pluginId, revision }`.

### Browser

```
SSE boring.plugin.load { id, boring, version, revision } received:
1. revision ≤ lastSeen[id]  →  discard stale
2. Snapshot current Zustand state for pluginId (for rollback)
3. Build staged registrations:
     V1 (direct): await import(url?v=revision) → run factory(capturingAPI) → captured registrations
     V2 (iframe):  read boring.panels[], boring.commands[], boring.leftTabs[], boring.surfaceResolvers[]
4. Validate staged: if derivesFrom, check captured types against extensionContract
5. Any step 3–4 failure  →  restore snapshot, show toast, return (old registrations stay)
6. Commit: usePanelStore.setState(...), useCommandStore.setState(...), etc.
   Resolver stack: pop all entries tagged pluginId, push new entries tagged (pluginId, revision)
7. lastSeen[pluginId] = revision
```

Unload: if `revision ≤ lastSeen[pluginId]` discard; else pop resolver stack, remove from all Zustand stores, call `slashCommandRegistry.unregisterByPluginId(pluginId)`, set `lastSeen[pluginId] = revision`.

### Reconnect

Server updates `activePlugins` **before** dispatching SSE, so `GET /api/agent-plugins` always reflects state ≥ what SSE has announced.

```
plugins = await fetch('/api/agent-plugins')   // → [{ id, boring, version, revision }]
for each { id, boring, version, revision }:
  if revision > lastSeen[id]:
    registerAgentPlugin(id, boring, version, revision, mode)
```

---

## V1 — Local Mode

### What V1 means

The agent, workspace server, and Vite dev server all run locally. `plugin.server.ts` loads into the Fastify process via jiti. `front.tsx` is imported by the browser directly from Vite — no iframe, no esbuild, no sandbox. The component runs in the host React tree.

V1 requires:
```ts
// vite.config.ts
server: { fs: { allow: [workspaceRoot] } }
```

V1 is **dev mode only**. Use V2 for any deployed environment.

### Load flow

```
Agent writes files, then types /boring.reload (or /reload)
  │
  ▼ POST /api/agent-plugins/reload  (from boring-pi-extension.ts)
  │  OR session_start { reason: "reload" } hook fires (on full /reload)
  │
  ├─ (server — scan .boring/plugins/ → stage → commit per plugin)
  │   Read + validate package.json["boring"]           → fail: .error file + SSE error
  │   revision[pluginId]++
  │   jiti.import(boring.server) if present            → capture server tools (front.tsx never loaded server-side)
  │   Stage fail (jiti throws)                         → .error + SSE error (old tools live)
  │   Commit: swap temp → live registry; run old disposers
  │   getExtraTools() getter updated (new session picks up plugin tools automatically)
  │   activePlugins[pluginId] = { boring, revision }
  │   Delete .error if present
  │   SSE boring.plugin.load { boring, revision }
  │
  └─ (browser — stage → commit)
      revision ≤ lastSeen[pluginId]                    → discard stale
      Snapshot Zustand state for pluginId
      import(`/.boring/plugins/${id}/${boring.entry}?v=${revision}`)  ← Vite transforms
      Run factory(capturingBoringExtensionAPI)          → captured registrations
      derivesFrom? check captured types vs extensionContract
      Any failure                                       → restore snapshot, toast, return
      Commit: setState on panel/command/tab/resolver stores
              pop old resolver stack entries for pluginId, push new (pluginId, revision)
      lastSeen[pluginId] = revision
      AgentPluginPane reads component from usePanelStore(panelId).component;
        panel key={`${panelId}:${revision}`} forces React remount on hot-reload
```

Unload: agent deletes plugin directory → `/boring.reload` → server sees plugin missing → runs disposers → SSE `boring.plugin.unload` → browser pops resolver stack, removes from stores → open panels show "Plugin not loaded" placeholder.

### Contribution surface (V1)

Inside plugins run in the same process — full surface available.

| Contribution | V1 support |
|---|---|
| `panel` | ✅ React component in host tree |
| `panelCommand` | ✅ |
| `leftTab` | ✅ |
| `surfaceResolver` | ✅ |
| `agentTool` | ✅ server only (`plugin.server.ts`) |
| `binding` | ❌ not in API surface; deferred |
| `provider` | ⚠️ possible but not recommended |
| `slotFill` | ✅ |

### Security (V1)

Plugin runs in the same Node.js process. This is intentional — local mode means the developer trusts their own agent.

---

## V2 — Hosted / Sandbox Mode

### What V2 means

The agent runs in a sandboxed environment (bwrap, Vercel). `front.tsx` is compiled to a JS bundle served to a sandboxed iframe. `plugin.server.ts` loads via jiti into the host Fastify process (not sandboxed — the sandbox is for the agent, not the server plugin). The SSE path is **identical to V1** — only how the browser handles the panel render differs.

V2 works in any environment (no Vite dev server required).

### File layout (same as V1)

```
.boring/plugins/
  csv-viewer/
    package.json          ← same single manifest
    front.tsx             ← compiled by esbuild on demand, served to iframe
    plugin.server.ts      ← loaded by jiti into Fastify process
```

### Load flow

```
Agent writes files, then types /boring.reload (or /reload)
  │
  ▼ POST /api/agent-plugins/reload
  │
  ├─ (server — identical to V1)
  │   Validate → stage → commit; SSE boring.plugin.load { boring, revision }
  │   Invalidate esbuild cache for pluginId
  │
  └─ (browser — mode="iframe")
      revision ≤ lastSeen[pluginId]  → discard stale
      Snapshot Zustand state
      Register from manifest arrays directly (no dynamic import):
        boring.panels[]          → usePanelStore (component = AgentPluginPane mode="iframe")
        boring.commands[]        → useCommandStore (action = openPanel(panelId))
        boring.leftTabs[]        → useTabStore
        boring.surfaceResolvers[]→ resolver LIFO stack
      derivesFrom? check manifest contribution types vs extensionContract
      Any failure                → restore snapshot, toast, return
      Commit stores + resolver stack
      lastSeen[pluginId] = revision
      Open AgentPluginPanes receive new revision → reloadKey increments → iframe src changes
```

### `registerAgentPlugin` — V1 vs V2 branch

```
mode="direct" (V1):
  unregisterByPluginId(pluginId) + slashCommandRegistry.unregisterByPluginId(pluginId)
  await import(`/.boring/plugins/${id}/${boring.entry}?v=${revision}`)
  await factory(createCapturingBoringExtensionAPI()) → captured registrations
  Validate: every boring.panels[i].id has a matching registerPanel?() call → MANIFEST_IMPL_MISMATCH
  Path A: check manifest contribution types vs extensionContract
  Commit: build panel entries from manifest metadata + factory component refs;
          register panelCommands, leftTabs, surfaceResolvers from manifest;
          register slash commands from captured registerCommand() calls

mode="iframe" (V2):
  unregisterByPluginId(pluginId)
  Path A: check boring.panels[], boring.commands[], etc. vs extensionContract
  Register from manifest arrays; component = AgentPluginPane mode="iframe"
  (no factory runs in browser — manifest is sole source of truth)
```

Mode determined at app startup from `window.__BORING_PLUGIN_MODE__` or build-time env var.

### esbuild compilation (V2)

Compile on demand; cache keyed by `(pluginId, front.tsx mtime)`. Watcher invalidates cache on reload.

```ts
await esbuild.build({
  entryPoints:   [frontPath],
  bundle:        true,
  format:        "iife",
  jsx:           "automatic",
  jsxImportSource: "react",
  platform:      "browser",
  nodePaths:     [join(workspaceRoot, ".boring/plugins/node_modules")],
  alias: {
    "@boring/workspace/bridge-client":
      join(workspaceRoot, ".boring/plugins/.boring-vendor/bridge-client.js"),
  },
  write:         false,
  define:        { "process.env.NODE_ENV": '"production"' },
  logLevel:      "silent",
})
```

On esbuild error: write `.boring/plugins/<id>/.error` + SSE `boring.plugin.error`. Serve last good cached output; 500 if none.

### `AgentPluginPane` — iframe mode

```tsx
const url = `/api/agent-plugins/${pluginId}/front.js?v=${reloadKey}`
<iframe
  ref={iframeRef}
  src={url}
  sandbox="allow-scripts"          // NOT allow-same-origin — origin stays null
  style={{ border: "none", width: "100%", height: "100%" }}
/>
```

- `reloadKey` increments when SSE `boring.plugin.load` fires with a newer revision for this pluginId
- Bridge message validation: `event.source === iframeRef.current?.contentWindow` — never check `event.origin` (always `"null"` for sandboxed iframes)
- Error boundary wraps the iframe; on unload, renders "Plugin not loaded" placeholder

### postMessage bridge

**Handshake (ack-based — eliminates lost-init race):**
```
iframe evaluates bundle  →  sends boring.bridge.ready
host receives ready      →  responds with boring.bridge.init { theme, derivedFrom? }
iframe receives init     →  renders; sends boring.bridge.rendered
```

**Host → iframe:**
```ts
{ type: "boring.bridge.init", theme: Record<string, string>, derivedFrom?: string }
```

**Iframe → host:**
```ts
{ type: "boring.bridge.ready" }
{ type: "boring.bridge.rendered" }
{ type: "boring.bridge.openPanel",         panelId: string }
{ type: "boring.bridge.showNotification",  message: string, level: "info"|"warn"|"error" }
```

Hot-reload: SSE fires → `reloadKey` increments → iframe `src` changes → new load → handshake repeats. No explicit reload message needed.

### `bridge-client` vendor file

Written at provision time to `.boring/plugins/.boring-vendor/bridge-client.js`. Aliased by esbuild so agent imports `@boring/workspace/bridge-client` from inside front.tsx:

```ts
export function openPanel(panelId: string): void {
  window.parent.postMessage({ type: "boring.bridge.openPanel", panelId }, "*")
}
export function showNotification(message: string, level = "info"): void {
  window.parent.postMessage({ type: "boring.bridge.showNotification", message, level }, "*")
}
export function onInit(cb: (data: { theme: Record<string, string>; derivedFrom?: string }) => void): void {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "boring.bridge.init") cb(e.data)
  }, { once: true })
}
```

### `BoringServerPluginAPI`

```ts
interface BoringServerPluginAPI {
  registerTool(tool: ToolDefinition): void
  registerDisposer(fn: () => void | Promise<void>): void
  log(level: "info" | "warn" | "error", message: string): void
}
```

No `ServerPluginLoader` interface — jiti is the only loader and is used directly in `jitiPluginLoader.ts`. The worker-thread swap point is Out of Scope.

### Dependencies in the iframe

Provisioning seeds a shared `node_modules` for all plugins at `.boring/plugins/package.json`. **This file is distinct from any per-plugin `package.json` and must never be confused with one.**

```
.boring/plugins/
  package.json          ← ROOT manifest (seeded by provisioning, NOT a plugin)
  node_modules/         ← shared react, react-dom for all iframe plugins
  csv-viewer/
    package.json        ← per-plugin manifest (boring field, pi field)
    front.tsx
    plugin.server.ts
```

```json
// .boring/plugins/package.json — provisioned root, agent should not edit this
{
  "name": "boring-agent-plugins-root",
  "private": true,
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" }
}
```

**Guard:** `readBoringPackage(dir)` is only called for directories one level under `.boring/plugins/` (i.e. `.boring/plugins/<name>/package.json`). The root `.boring/plugins/package.json` is never passed to `readBoringPackage` — the scanner skips the root level. The system prompt and docs explicitly tell the agent: _"Your plugin's package.json lives at `.boring/plugins/<name>/package.json`. Do not edit `.boring/plugins/package.json` (the shared root)."_

### Contribution surface (V2)

| Contribution | V2 support | Notes |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `panelCommand` | ✅ | manifest → host registers wrapper |
| `leftTab` | ✅ | manifest → host registers wrapper |
| `surfaceResolver` | ✅ | LIFO stack, same as V1 |
| `agentTool` | ✅ | `plugin.server.ts` via jiti |
| `binding` | ❌ | requires host React tree |
| `provider` | ❌ | wraps entire app tree |
| `slotFill` | ❌ | deferred |

---

## Shared Architecture — V1 and V2

V1 and V2 share all infrastructure except the panel render strategy.

| Layer | V1 | V2 |
|---|---|---|
| `boring-pi-extension.ts` reload hook | ✅ | ✅ |
| Server: jiti loads `plugin.server.ts` | ✅ | ✅ |
| SSE `boring.plugin.load` dispatch | ✅ | ✅ |
| Browser SSE handler | ✅ | ✅ |
| `registerAgentPlugin` function | ✅ | ✅ (different branch) |
| `GET /api/agent-plugins` reconnect | ✅ | ✅ |
| Path A validation | ✅ | ✅ |
| Panel render | direct Vite import | esbuild → iframe |
| postMessage bridge | ❌ | ✅ |
| Provisioned node_modules | ❌ | ✅ |

All SSE, browser registration, and Path A wiring built for V1 is reused unchanged in V2. V2 adds only: esbuild route, iframe render mode in `AgentPluginPane`, postMessage bridge, and provisioning.

---

## Path A — Derivation

### Contract

A derived plugin is **purely additive** — it adds contributions on top of the base plugin. It never removes, replaces, or silences the base plugin's existing panels, commands, tabs, or tools. The base plugin continues running independently and is unaware of the derived plugin.

The only exception is **surface resolvers** — they use a LIFO stack per `surfaceKind`. A derived plugin registering a resolver for `"csv.open"` shadows the base's resolver while loaded. On unload, the base resolver becomes active again.

### `extensionContract.allowedContributions`

The base outside plugin declares which contribution types a derived plugin may add:

```ts
extensionContract: { allowedContributions: ["panel", "panelCommand", "agentTool"] }
// → derived plugin cannot add leftTabs or surfaceResolvers; load fails with CROSS_REFERENCE
```

The check is:
- **V1**: post-factory on captured registrations (what the factory actually called)
- **V2**: pre-registration on `boring.panels[]`, `boring.commands[]`, etc. (manifest is authoritative)

### Surface resolver LIFO stack

Outside plugins register their surface resolvers at `bootstrap()` time — they form the **base layer** of the stack, ordered by bootstrap registration order (first-registered = deepest). Inside plugins always push on top. If two outside plugins register the same `surfaceKind`, the later-bootstrapped plugin's resolver is active (it sits above the earlier one). This ordering is fixed at startup and cannot change without a page reload.

```
bootstrap():
  outside-a registers surfaceKind="csv.open"                   stack: [outside-a]
  outside-b registers surfaceKind="csv.open"                   stack: [outside-a, outside-b]
active resolver → outside-b  (later bootstrap = top)

inside plugin loads:
  derived-a registers surfaceKind="csv.open"                   stack: [outside-a, outside-b, derived-a]
  derived-b registers surfaceKind="csv.open"                   stack: [outside-a, outside-b, derived-a, derived-b]
active resolver → derived-b (top)

derived-b unloads                                              stack: [outside-a, outside-b, derived-a]
active resolver → derived-a

derived-a unloads                                              stack: [outside-a, outside-b]
active resolver → outside-b  (base layer restored)
```

### Panel and command ID namespacing

Derived plugin IDs must not collide with base plugin IDs — the base plugin's contributions are already in the registry. Load fails with `DUPLICATE_ID` on collision.

Convention: prefix with derived plugin id — `"csv-viewer-enhanced-panel"` not `"csv-viewer-panel"`.

### State access by mode

**V1** — derived `front.tsx` runs in the host React tree. It can import React context, Zustand stores, or event buses exported by the base plugin package. Intentional — V1 trusts the local developer.

**V2** — derived `front.tsx` runs in a sandboxed iframe. No direct access to base plugin state. `boring.bridge.init` sends `{ derivedFrom: "macro" }` so the iframe knows which base it extends.

### Outside plugin registry

Outside plugins declare their extension contracts at workspace init:

```ts
// Both browser-side and server-side registries:
pluginRegistry.register({
  id: "macro",
  extensionContract: { allowedContributions: ["panel", "panelCommand", "agentTool"] }
})
```

`derivesFrom` referencing an unregistered plugin → hard load failure (`.error` file + SSE error). Never a silent skip.

---

## Error Surfacing

When a plugin load fails (validation error, jiti throw, import failure):
- Server writes `.boring/plugins/<id>/.error` — agent reads it with normal `read` tool
- Server sends SSE `boring.plugin.error { pluginId, revision, message }` — workspace UI shows a toast

On next successful load, `.error` is deleted automatically.

---

## Existing Plugins — No Migration Required

All current first-party plugins (`filesystemPlugin`, `explorerPlugin`, `dataCatalogPlugin`, `macroPlugin`, `playgroundDataCatalogPlugin`) use the declarative `WorkspaceFrontPlugin` shape and stay that way. `bootstrap()` continues loading them as-is. The factory pattern is for inside (agent-authored) plugins only.

The one file that changes is `authoring.ts` — the capturing API expands to the new flat `BoringExtensionAPI` surface. Outside plugins are not affected — `bootstrap()` registers them directly into registries as before.

### What DOES change: `authoring.ts`

The coordinator already calls factories today via `createCapturingAPI()`. The capturing API needs to expand from the old namespaced shape to the new flat `BoringExtensionAPI` interface. This unblocks inside plugins but does not require outside plugins to change.

| Current `BoringPluginAPI` | New `BoringExtensionAPI` | Delta |
|---|---|---|
| `panels.register(reg)` | `registerPanel?(reg)` | rename + flatten |
| `commands.register(reg)` | `registerPanelCommand?(reg)` | rename + flatten |
| `surfaceResolvers.register(reg)` | `registerSurfaceResolver?(reg)` | rename + flatten |
| `providers.register(reg)` | `registerProvider?(reg)` | rename + flatten |
| `slotFills.register(reg)` | `registerSlotFill?(reg)` | rename + flatten |
| ❌ missing | `registerTool(tool)` | add — no-op stub (pi handles it; boring-ui tools go in plugin.server.ts) |
| ❌ missing | `registerLeftTab?(reg)` | add |
| ❌ missing | `registerCommand(name, opts)` | add — pi slash command |
| ❌ missing | `on(event, handler)` | add |
| ❌ missing | pi stub methods | add no-ops |

---

## Doc Embedding

The agent needs documentation about the plugin API accessible from inside the workspace.

**Layer 1 — File-based docs** (all modes): provisioning seeds `.boring/docs/` with `plugins.md`, `panels.md`, `bridge.md`. Agent reads them via normal `read` tool.

**Layer 2 — Inline system prompt** (Vercel serverless fallback): `boringSystemPrompt.ts` embeds the same docs as static strings. `BORING_DOCS_PATH` env var overrides for local dev.

No codegen. Both layers serve the same content.

---

## Implementation TODO

Implement V1 first. V2 adds only three pieces on top: esbuild route, iframe render mode, postMessage bridge.

---

### A — `manifest.ts`: parse `package.json["boring"]`

- [ ] Remove `BoringPluginManifest`, `BoringPluginRuntime`, `BoringPluginPermissions` (old shapes)
- [ ] Introduce `BoringPackageField` type — `entry: string`, `server?`, `label?`, `description?`, `derivesFrom?`, `panels[]`, `commands[]`, `leftTabs[]`, `surfaceResolvers[]`
- [ ] `readBoringPackage(dir)` — reads `package.json`, extracts `version` from top-level, id from directory name, contributions from `boring` field
- [ ] Validation:
  - `entry` required, passes `isSafePluginRelativePath`
  - `entry` and `server` (if declared) exist on disk — `MISSING_ENTRY_FILE` with actionable message
  - `derivesFrom` passes `isValidBoringPluginId`; cross-references valid; no duplicate ids within arrays
  - `AllowedContribution` is a strict union: `"panel" | "panelCommand" | "leftTab" | "surfaceResolver" | "agentTool"` — validated at registry time
- [ ] Error codes in `manifest.ts` (parse-time): `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | MISSING_ENTRY_FILE | UNKNOWN_FIELD | CROSS_REFERENCE | DUPLICATE_ID`
- [ ] `MANIFEST_IMPL_MISMATCH` lives in `registerAgentPlugin` (mode="direct" only) — not in manifest.ts. It fires post-factory when a manifest-declared panel id has no matching `registerPanel?()` call.
- [ ] Export `BoringPackageField` from `plugin.ts` and `@boring/workspace/plugin` subpath
- [ ] Rewrite `manifest.test.ts`

### B — Doc seeding + system prompt

- [ ] Create `packages/workspace/docs/plugins.md` — file layout, `package.json` schema, V1/V2 authoring, hot-reload flow, Path A
- [ ] Create `packages/workspace/docs/panels.md` — panel registration, `AgentPluginPane`, contribution surface by mode
- [ ] Create `packages/workspace/docs/bridge.md` — postMessage bridge API, `@boring/workspace/bridge-client` usage
- [ ] `boringSystemPrompt.ts` — embed all three docs as static strings; `BORING_DOCS_PATH` overrides path for dev

### C — Fix `pluginLoader.ts` + `boring-pi-extension.ts` + SSE dispatch

**Fix boring-ui's pi-extension loader** (`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`):
- [ ] Replace `const defaultImport: ImportFn = (url) => import(url)` with `createJiti(import.meta.url, { moduleCache: false })`
- [ ] Widen `VALID_EXTENSIONS` from `{".js", ".mjs"}` to `{".ts", ".tsx", ".js", ".mjs"}`
- [ ] Keep `extractTools` / `validateTool` / `PluginLoadResult` shapes unchanged — callers unaffected

**`boring-pi-extension.ts`** (`packages/agent/src/server/boring-pi-extension.ts`):

This is boring-ui's first-class pi extension. It is wired via `extensionFactories[]` in `DefaultResourceLoader` (inline factory closed over Fastify objects) and is also usable as a standalone file by pi users. No file watcher — reload is triggered explicitly by the agent.

- [ ] `createBoringPiExtension(opts: { pluginsDir, registry: ServerPluginRegistry, emit: PluginEventEmitter }): ExtensionFactory`
- [ ] `api.registerTool(...)` — register `exec_ui`, `open_panel`, and other boring-ui agent tools (moved here from harness static `customTools`)
- [ ] `api.registerCommand("boring.reload", { handler: () => scanAndReloadBoringPlugins(opts) })` — reloads boring-ui plugins only, faster than a full `/reload`
- [ ] `api.on("session_start", async (event) => { if (event.reason === "reload") await scanAndReloadBoringPlugins(opts) })` — hooks into pi's full `/reload` cycle
- [ ] `scanAndReloadBoringPlugins(opts)`: scan `.boring/plugins/` for `package.json` files → for each: `readBoringPackage` → validate → jiti stage → commit → emit SSE; detect removed plugins → disposers → `emit.pluginUnload`; delete `.error` on success
- [ ] Wire into `createHarness.ts`: add `extensionFactories: [createBoringPiExtension({ pluginsDir, registry, emit })]` to `DefaultResourceLoader` options
- [ ] `POST /api/agent-plugins/reload` route — for standalone pi users (file-based extension) and for `/boring.reload` when boring-ui runs as a separate server: calls `scanAndReloadBoringPlugins` directly; 200 on success, 500 with error body on failure

**SSE multiplexing** (`packages/agent/src/server/http/fsEvents.ts`):
- [ ] Define `BoringPluginEvent` discriminated union:
  ```ts
  type BoringPluginEvent =
    | { type: "boring.plugin.load";   id: string; boring: BoringPackageField; version: string; revision: number }
    | { type: "boring.plugin.unload"; id: string; revision: number }
    | { type: "boring.plugin.error";  id: string; revision: number; message: string }
  ```
- [ ] Add `emitPlugin(event: BoringPluginEvent): void` to `FsEventBroadcaster` — writes SSE with `event: event.type` alongside existing `event: "change"` entries
- [ ] Browser clients filter by event type; no new SSE endpoint needed

### D — Server plugin loading: jiti + registry + API routes

All files in `packages/workspace/src/server/plugins/` unless noted. API routes in `packages/agent/src/server/http/routes/`.

- [ ] `serverPluginRegistry.ts` — `Map<pluginId, { extensionContract?, activeRevision }>`. Registers outside plugin ids at startup (collision guard). Exposes `activePlugins(): ActivePlugin[]` for the reconnect endpoint.
- [ ] `jitiPluginLoader.ts` — uses `createJiti(import.meta.url, { moduleCache: false })` directly (no interface). Stage: jiti imports entry into a temp `BoringServerPluginAPI` instance. Commit: atomically swap temp → live, run old disposers first. Unload: run disposers, clear from live map.
- [ ] `boringServerPluginAPI.ts` — `BoringServerPluginAPI` implementation: `registerTool(ToolDefinition)`, `registerDisposer(fn)`, `log(level, msg)`.
- [ ] `agentPluginRoutes.ts` (in agent routes):
  - `GET /api/agent-plugins` → `Array<{ boring: BoringPackageField, version, revision }>` from `serverPluginRegistry.activePlugins()`; browser calls this on connect/reconnect
  - `GET /api/agent-plugins/:id/error` → returns `.boring/plugins/<id>/.error` content; 404 if none
- [ ] `pluginRegistry.register({ id })` called for each outside plugin id at startup (before SSE replay)
- [ ] Running-session tool injection: front-side tools (in `boring-pi-extension.ts`) visible immediately after `/reload` in the current session. Server-side tools (in `plugin.server.ts`) visible in new sessions only — plugin status panel surfaces this distinction.

### E — `authoring.ts`: `BoringPluginAPI` → `BoringExtensionAPI`

**TypeBox migration for existing tools is deferred** — `parameters: tool.parameters as any` in `tool-adapter.ts` stays. New plugin tools written in `boring-pi-extension.ts` use TypeBox natively via pi's `defineTool()`. Migrating all existing tools to `Type.Object(...)` is a separate follow-up.

**`authoring.ts` rewrite:**
- [ ] Replace namespaced `BoringPluginAPI` with flat `BoringExtensionAPI`
- [ ] Pi methods boring-ui implements: `registerTool(ToolDefinition)`, `registerCommand(name, opts)`, `registerShortcut(key, opts)`, `on(event, handler)`
- [ ] `registerTool` — **no-op stub** in `BoringExtensionAPI`. When pi loads `front.tsx` pi handles the tool natively. Boring-ui ignores it from the front — all boring-ui tools go in `plugin.server.ts`. Re-export `ToolDefinition` from `@boring/workspace/plugin` so plugin authors can import it. **Diagnostic:** the capturing API records a `warning` diagnostic when `registerTool` is called, included in the SSE `boring.plugin.load` payload and shown in the plugin status panel — the agent sees it via `GET /api/agent-plugins/:id/error` or status panel, not via browser console.
- [ ] `registerCommand` — pi slash command (`/name [args]`); boring-ui registers it as a front-side slash command handler (not available in `BoringServerPluginAPI`)
- [ ] `on("load"/"unload", handler)` wired; all other events no-op with dev-mode warning
- [ ] Pi stub methods (no-op + `console.warn` in dev): `exec`, `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getActiveTools`, `setActiveTools`, `setModel`, `events`, `registerFlag`, `registerProvider`, etc.
- [ ] Boring-ui optional flat methods: `registerPanel?`, `registerPanelCommand?`, `registerLeftTab?`, `registerSurfaceResolver?`, `registerProvider?`, `registerSlotFill?`
- [ ] `export type BoringExtensionFactory = (api: BoringExtensionAPI) => void | Promise<void>`
- [ ] Update `createCapturingAPI()` — implement `BoringExtensionAPI`; `registerTool` is a no-op (not captured); `flush()` returns `{ panels, panelCommands, leftTabs, surfaceResolvers, slashCommands }`
- [ ] Keep `BoringPluginAPI` as deprecated alias
- [ ] Export `BoringExtensionAPI`, `BoringExtensionFactory`, `ToolDefinition` (re-export) from `@boring/workspace/plugin`

### F — Browser: `registerAgentPlugin` + SSE handler + `AgentPluginPane` V1

`PluginCoordinator` (`src/shared/plugins/coordinator.ts`) and its tests are **deleted**. The new system handles inside plugins only — `bootstrap()` and outside plugin registration are unchanged.

- [ ] Delete `src/shared/plugins/coordinator.ts`. `CapturedRegistrations` type moves into `authoring.ts`. Update `src/shared/plugins/index.ts` exports.
- [ ] Delete `src/shared/plugins/__tests__/coordinator.test.ts` and `hotReload.test.ts` — replaced by integration tests on `registerAgentPlugin`
- [ ] `src/front/plugins/agentPluginRegistry.ts` — `Map<pluginId, extensionContract>` for outside plugins (populated at bootstrap); `Map<pluginId, number>` for `lastSeen` revisions
- [ ] `src/front/plugins/registerAgentPlugin.ts` — stage → commit for inside plugins:
  - Check `revision ≤ lastSeen[pluginId]` → discard stale
  - Snapshot current store state for pluginId (rollback target)
  - V1: `await import(url?v=revision)` → `factory(createCapturingBoringExtensionAPI())` → captured registrations
  - V2: read `boring.panels[]`, `boring.commands[]`, etc. from manifest (no dynamic import)
  - Path A: check captured/manifest contribution types vs `extensionContract`
  - On failure: restore snapshot, dispatch toast
  - On success: commit to Zustand stores; update resolver LIFO stack; set `lastSeen[pluginId] = revision`
- [ ] Registries: update existing panel/command/surface-resolver Zustand stores to support `unregisterByPluginId(pluginId)` and LIFO stack tagging `(pluginId, revision)` for surface resolvers
- [ ] Slash command unregistration: call `slashCommandRegistry.unregisterByPluginId(pluginId)` on both reload and unload — must run before the new factory registers updated slash commands, and on unload to fully clean up
- [ ] `src/front/plugins/AgentPluginPane.tsx`:
  - `mode="direct"` (V1): reads component from `usePanelStore(panelId).component` (set by `registerAgentPlugin` after factory runs); wraps in `React.Suspense`; `key={panelId + ":" + revision}` forces remount on hot-reload. The factory's default export is a factory function, NOT a React component — never `React.lazy(() => import(url))` directly.
  - `mode="iframe"` (V2 stub): renders placeholder `<div>V2 iframe — wired in TODO G</div>`
  - When panel absent from store: renders "Plugin not loaded" placeholder
- [ ] Introduce `useWorkspaceEventStream` — a workspace-level shared `EventSource` to `/api/v1/fs/events` that fans out to type-specific subscribers. Both file-event and plugin-event listeners attach here. Replaces per-component `EventSource` creation in `useFileEventStream`. Eliminates duplicate connections.
- [ ] SSE handler: subscribe via `useWorkspaceEventStream` — filter for `boring.plugin.*` event types → `registerAgentPlugin` / unregister / toast. Stale events discarded via `revision ≤ lastSeen[pluginId]` — no additional dedup needed.
- [ ] `await factory(capturingAPI)` before calling `flush()` — async factories that register after an internal `await` are correctly captured
- [ ] On connect/reconnect: `GET /api/agent-plugins` → for each entry where `revision > lastSeen[pluginId]`, call `registerAgentPlugin`

### G — V2: esbuild route + iframe render (skeleton this PR, wire fully later)

This PR ships the skeleton: the route exists and the iframe renders, but the postMessage bridge (TODO H) and provisioning (TODO I) are follow-up work.

- [ ] `GET /api/agent-plugins/:pluginId/front.js` (`packages/agent/src/server/http/routes/agentPluginFront.ts`):
  - Validate pluginId with `isValidBoringPluginId`; resolve and verify path stays within `workspaceRoot/.boring/plugins/` (no symlink escapes)
  - Compile `boring.entry` via esbuild on demand; cache keyed by `(pluginId, mtime)` of the entry file; invalidate cache on watcher reload event
  - esbuild config: `format: "iife"`, `jsx: "automatic"`, `jsxImportSource: "react"`, `platform: "browser"`, `write: false`
  - `Cache-Control: no-store`; CSP: `default-src 'none'; script-src 'self'`
  - On esbuild error: write `.boring/plugins/<id>/.error`, serve last cached bundle or 500
- [ ] Wire `AgentPluginPane mode="iframe"` — replaces the V1 stub with real `<iframe sandbox="allow-scripts" src={url} />`; bridge messages not yet handled (TODO H)

### H — V2: postMessage bridge

- [ ] `src/front/plugins/agentPluginBridge.ts` — validate `event.source === iframeRef.contentWindow`; dispatch `openPanel`, `showNotification` to host
- [ ] `src/front/plugins/agentPluginBridgeClient.ts` — shipped as `.boring-vendor/bridge-client.js`; `openPanel`, `showNotification`, `onInit` exports
- [ ] Handshake: wait for `boring.bridge.ready` from iframe before sending `boring.bridge.init { theme, derivedFrom? }`
- [ ] Theme tokens extracted from CSS custom properties at send time

### I — V2: provisioning

- [ ] Provisioning seeds `.boring/plugins/package.json` with `{ react, react-dom }` and runs `npm install`
- [ ] Provisioning writes `.boring/plugins/.boring-vendor/bridge-client.js` from bridge-client source
- [ ] Provisioning seeds `.boring/docs/` with `plugins.md`, `panels.md`, `bridge.md`

### J — Plugin templates + docs + status panel

- [ ] `packages/workspace/templates/plugin/` — V1 example: `package.json` + `front.tsx` (Path B from scratch)
- [ ] Add Path A example: `package.json` with `derivesFrom`, `front.tsx` using `registerPanel?` + `registerSurfaceResolver?`
- [ ] Add `plugin.server.ts` example with `registerTool` + `registerDisposer`
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/` location
- [ ] Docs: `plugins.md` includes agent-facing walkthrough and worked examples
- [ ] **Plugin Status Panel** — a first-party outside plugin registered via `bootstrap()` at startup:
  - Panel id: `"boring-agent-plugins"`, title: "Agent Plugins"
  - Renders a list of all currently active inside plugins: name, version, load time, status (loaded / error)
  - Shows last error message inline when `.error` present; poll or subscribe via SSE `boring.plugin.*` events for live updates
  - `GET /api/agent-plugins/:id/error` — returns the `.error` file content as plain text; 404 if none; used by the status panel for error display
  - Left tab registration optional (low priority); command palette entry "Show Agent Plugins" opens it

---

## Out of Scope

- Outside plugin migration to factory pattern — `bootstrap()` stays; no forcing function
- `binding` / `provider` / `slotFill` in V2 — require host React tree; incompatible with iframe sandbox
- `host.query()` bridge for V2 derived plugins — deferred until Path A + full bridge land
- Vite HMR for outside plugins — separate concern
- Worker-thread `ServerPluginLoader` — deferred; jiti sufficient today
- postMessage bridge wiring (TODO H) and provisioning (TODO I) — follow-up PRs after G skeleton ships
- `registerShortcut` implementation — accepted by `BoringExtensionAPI` but no-op in V1 (no keybinding registry yet)
- File-watching as an alternative reload trigger — deliberately excluded; explicit `/reload` is simpler and race-free
- Catalog handlers (`registerCatalogHandler` / `catalogs?` field) — complexity not yet justified; add when a real use case emerges
- `ServerPluginLoader` interface — jiti is the only loader; abstraction adds indirection without benefit today
- Full TypeBox migration for existing tools — new plugin tools use TypeBox natively via `defineTool()`; legacy `parameters: tool.parameters as any` stays until a real migration PR
- `eventId` UUID dedup — `revision ≤ lastSeen[pluginId]` is the sole dedup mechanism; LRU overhead is unnecessary
