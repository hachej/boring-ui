# Hot-Reloadable Agent Plugins

**Last updated:** 2026-05-06  
**Status:** Planning complete — ready for implementation

---

## Goal

Let an agent write a plugin to `.boring/plugins/<name>/` and have it load live into a running workspace without a page refresh — contributing panels, commands, left tabs, surface resolvers, catalog search, and server-side agent tools.

---

## Plugin Tiers

The workspace has two plugin tiers that coexist and share the same registry infrastructure.

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `package.json` (`"boring"` field) + factory |
| Loaded | At app startup via `bootstrap()` | At runtime via file watcher + SSE |
| Migration required | No — stays declarative | N/A — new system |

**Outside plugins** (`filesystemPlugin`, `macroPlugin`, etc.) keep their current declarative `WorkspaceFrontPlugin` shape. `bootstrap()` registers them directly into registries at startup — unchanged. No migration.

**Inside plugins** are agent-authored. They use the factory-based `BoringExtensionAPI` and are loaded hot via the watcher. `PluginCoordinator` is **deleted** and replaced by `registerAgentPlugin` — this replacement is scoped to inside plugins only. `bootstrap()` is not affected.

### Inside plugin authoring paths

**Path A — Derive from an outside plugin.** The agent extends an existing outside plugin by adding panels, commands, or tools on top of it. The base plugin opts in via `extensionContract: { allowedContributions: [...] }`. The `"boring"` field uses `"derivesFrom": "<pluginId>"`. Purely additive — the base plugin's contributions remain active while the derived plugin is loaded.

**Path B — Build from scratch.** Self-contained plugin with its own front and server code.

---

## Pi Plugin Compatibility

Boring-ui plugins ARE pi extensions. The factory is a valid pi `ExtensionFactory` — the same file loads in pi's loader unchanged. Boring-ui extends the API object with optional UI-registration methods that pi simply doesn't provide.

### Discovery and loading

Pi uses `@mariozechner/jiti` to load extensions — TypeScript and TSX are handled natively without a compilation step. Pi reads `package.json["pi"]["extensions"]` to find entry points; those paths are passed directly to jiti regardless of file extension. The directory scanner (for extensionless index files) only picks up `.ts` / `.js`, but explicitly declared paths in `extensions[]` bypass that filter — so `"./front.tsx"` works.

```json
{ "pi": { "extensions": ["./front.tsx"] } }
```

Boring-ui mirrors this exactly for `.boring/plugins/<name>/`. Both fields point to the same factory file; both runtimes use jiti:

```json
{ "boring": { "extensions": ["./front.tsx"], ... } }
```

A plugin with only `"pi"` (no `"boring"` field) also loads in boring-ui — `registerTool` and `registerCommand` work; no UI contributions are registered. This is the minimal pi-compatible plugin that runs identically in both runtimes.

**Note:** boring-ui's existing `pluginLoader.ts` (the custom wrapper in `packages/agent/`) uses native `import()` and restricts to `.js/.mjs`. This is wrong — it needs to be replaced with jiti to match pi's real loader behaviour (see TODO C).

### `BoringExtensionAPI`

All methods use the flat `register*` naming style — consistent with pi's `registerTool` / `registerCommand`.

```ts
interface BoringExtensionAPI {
  // ── Pi methods — boring-ui implements fully ──────────────────────────

  // Pi's verbatim ToolDefinition shape (TypeBox parameters).
  // Routes to the workspace agent tool registry.
  registerTool(tool: ToolDefinition): void

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

  // ── Pi methods — boring-ui stubs (no-op + dev warning) ───────────────
  exec(...args: unknown[]): Promise<unknown>
  sendMessage(...args: unknown[]): void
  sendUserMessage(...args: unknown[]): void
  events: { on(): void; off(): void; emit(): void }
  getActiveTools(): string[]
  setActiveTools(tools: string[]): void
  // remaining pi-specific methods (setModel, appendEntry, etc.) also stubbed

  // ── Boring-ui extras — flat optional methods, absent in pi ───────────
  // Use optional chaining so the factory is safe when pi loads it.
  registerPanel?(reg: BoringPluginPanelRegistration): void
  registerPanelCommand?(reg: BoringPluginCommandRegistration): void  // UI palette → opens panel
  registerLeftTab?(reg: BoringPluginLeftTabRegistration): void
  registerSurfaceResolver?(reg: BoringPluginSurfaceResolverRegistration): void
  registerCatalog?(reg: BoringPluginCatalogRegistration): void
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
  api.registerCatalogHandler(async (q) => [...])
  api.registerDisposer(() => { /* cleanup sockets/timers on unload */ })
}
```

---

## Package Structure

Every inside plugin is an npm package. `package.json` is the **single manifest and commit signal** — there is no `boring.plugin.json`.

### File layout

```
.boring/plugins/
  csv-viewer/
    package.json          ← single source of truth: discovery + metadata + commit signal
    front.tsx             ← pi-compatible factory (default export)
    plugin.server.ts      ← optional: server tools + catalog handlers
```

### `package.json` shape

```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "extensions":      ["./front.tsx"],
    "server":          "./plugin.server.ts",
    "label":           "CSV Viewer",
    "derivesFrom":     "macro",
    "panels":          [{ "id": "csv-viewer-panel", "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv", "title": "Open CSV Viewer", "panelId": "csv-viewer-panel" }],
    "leftTabs":        [{ "id": "csv-tab",  "title": "CSV", "panelId": "csv-viewer-panel" }],
    "surfaceResolvers":[{ "id": "csv-open", "surfaceKind": "csv.open", "panelId": "csv-viewer-panel" }],
    "catalogs":        [{ "id": "csv-catalog" }]
  },
  "pi": { "extensions": ["./front.tsx"] },
  "dependencies": { "papaparse": "^5.0.0" }
}
```

- `"boring"` — boring-ui discovery + all contribution metadata.
- `"pi"` — pi discovery (same entry point array). Omit if the plugin is boring-ui only.
- Plugin `id` = directory name (e.g. `csv-viewer`). `version` = top-level `"version"`.

### `"boring"` field schema (`BoringPackageField`)

```ts
interface BoringPackageField {
  extensions: string[]        // entry points — must have ≥ 1; boring-ui uses [0]
  server?: string             // path to plugin.server.ts (boring-ui only)
  label?: string
  description?: string
  derivesFrom?: string        // Path A — hard failure if referenced plugin not registered

  // Contribution declarations (optional in V1, authoritative in V2):
  panels?:           Array<{ id: string; title?: string }>
  commands?:         Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?:         Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  catalogs?:         Array<{ id: string; title?: string }>
}
```

### Validation rules

- `command.panelId`, `leftTab.panelId`, `surfaceResolver.panelId` must reference an `id` in `panels[]`
- No duplicate `id` within each array
- `extensions[]` entries and `server` must pass `isSafePluginRelativePath` (no `..` escapes)
- `derivesFrom` must pass `isValidBoringPluginId`; absence of the referenced plugin is a hard load failure
- Plugin id (directory name) must not collide with any registered outside plugin id

### Agent workflow

`package.json` is the commit signal. The agent writes code files first, then writes `package.json` last to trigger reload — even if just bumping the version.

```
1. write front.tsx           (no reload)
2. write plugin.server.ts    (no reload)
3. write package.json        ← reload fires here
```

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Manifest file | `package.json` only | Mirrors pi's `"pi": { "extensions": [...] }` pattern exactly. One file, no `boring.plugin.json`. |
| Reload trigger | `package.json` write | Commit signal pattern — all code files are on disk before reload fires. Mirrors pi's explicit `/reload` philosophy. |
| Plugin API naming | Flat `register*` throughout | Consistent with pi's `registerTool` / `registerCommand`. No namespace objects. |
| Boring-ui extras | Optional methods | `registerPanel?`, `registerLeftTab?`, etc. are absent in pi — optional chaining makes the same factory safe in both runtimes. |
| `registerTool` shape | Pi's verbatim `ToolDefinition` (TypeBox) | TypeBox parameters, full execute signature. Plugin authors use pi's `defineTool()` helper. Identical surface across both runtimes. |
| TypeBox — full migration | `AgentTool.parameters` becomes `TSchema` | Drops `as any` in `tool-adapter.ts`. All existing tools (filesystem, harness, dataCatalog) updated. Clean end-to-end TypeBox pipeline. |
| No build step | jiti handles `.tsx` natively | Pi's real loader uses `@mariozechner/jiti`; boring-ui also uses jiti for server plugins. No esbuild pre-compilation needed in V1. |
| Fix `pluginLoader.ts` | Replace native `import()` with jiti | Boring-ui's custom wrapper incorrectly restricts to `.js/.mjs`. Rewrite to use `createJiti` matching pi's real loader. |
| Server plugins | Boring-ui only | Pi has no server plugin concept. `plugin.server.ts` is loaded by jiti into the Fastify process. |
| Outside plugins | Stay declarative | `filesystemPlugin`, `macroPlugin`, etc. keep `WorkspaceFrontPlugin` shape. `bootstrap()` loads them. No forced migration. |
| PluginCoordinator | Full replacement | `PluginCoordinator` deleted. New `BoringExtensionAPI`-based system handles both outside (bootstrap) and inside (agent) plugins. Bootstrap migrates to factory API. |
| SSE for plugin events | Multiplex on `/api/v1/fs/events` | `boring.plugin.load`, `boring.plugin.unload`, `boring.plugin.error` are new event types on the existing stream. Browser SSE handler already connected — add filter. |
| Rollback on failure | Restore old state | Stage → validate → commit/rollback on both server and browser. Old plugin stays live on any failure. |
| Registries | Zustand stores | SSE updates go through `setState` — no Map mutation during React render cycle. |
| iframe handshake | Iframe sends `ready` first | Eliminates lost-init race. Host responds with `init`; iframe then renders. |
| Revision scope | Monotonic per pluginId | Every SSE event and reconnect response carries revision. Browser discards events where `revision ≤ lastSeen[pluginId]`. |

---

## Atomicity Model

Both server and browser use a **stage → validate → commit / rollback** pattern. Old state is never discarded until new state is proven good.

### Server

`boring.extensions[0]` (`front.tsx`) is **never loaded by the server**. It is browser-only and may import React, `document`, CSS modules — any of which crash jiti in Node.js. Only `boring.server` (`plugin.server.ts`) runs server-side. All agent tools contributed by a plugin must live in `plugin.server.ts`.

```
1. Read + validate package.json["boring"]  →  fail: write .error, SSE error, return (no state change)
2. (boring.server only) jiti.import(boring.server) — capture registerTool + registerCatalogHandler into temp registry
   (if boring.server absent — no server-side loading)
3. Stage fails (jiti throws)  →  write .error, SSE error, return (old tools untouched)
4. Commit: atomically swap temp registry → live registry; run old disposers first
5. activePlugins[pluginId] = { boring, version, revision }  (updated BEFORE SSE dispatch)
6. Delete .boring/plugins/<id>/.error if present
7. SSE boring.plugin.load { boring, version, revision }
```

**Plugin tools in running sessions:** The harness currently receives a static `customTools` array at session creation. Plugin tools registered after startup must be visible to running sessions. `createPiCodingAgentHarness` is updated to accept `getExtraTools: () => ToolDefinition[]` (a live getter) instead of a frozen array. Each new `AgentSession` calls the getter at creation time, picking up any plugin tools registered since startup.

Unload: run disposers, remove from live registry and activePlugins, SSE `boring.plugin.unload { pluginId, revision }`.

### Browser

```
SSE boring.plugin.load { boring, version, revision } received:
1. revision ≤ lastSeen[pluginId]  →  discard stale
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

Unload: if `revision ≤ lastSeen[pluginId]` discard; else pop resolver stack, remove from all Zustand stores, set `lastSeen[pluginId] = revision`.

### Reconnect

Server updates `activePlugins` **before** dispatching SSE, so `GET /api/agent-plugins` always reflects state ≥ what SSE has announced.

```
plugins = await fetch('/api/agent-plugins')   // → [{ boring, version, revision }]
for each { boring, version, revision }:
  if revision > lastSeen[boring.id]:
    registerAgentPlugin(boring, version, revision, mode)
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
Agent writes .boring/plugins/csv-viewer/package.json
  │
  ▼ workspace.watch() fires
  │
  ├─ (server — stage → commit)
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
      import(`/.boring/plugins/${id}/${boring.extensions[0]}?v=${revision}`)  ← Vite transforms
      Run factory(capturingBoringExtensionAPI)          → captured registrations
      derivesFrom? check captured types vs extensionContract
      Any failure                                       → restore snapshot, toast, return
      Commit: setState on panel/command/tab/resolver stores
              pop old resolver stack entries for pluginId, push new (pluginId, revision)
      lastSeen[pluginId] = revision
      AgentPluginPane mode="direct": factory module ref IS the component;
        panel key includes revision to force remount on hot-reload
```

Unload: `package.json` deleted → server runs disposers → SSE `boring.plugin.unload` → browser pops resolver stack, removes from stores → open panels show "Plugin not loaded" placeholder.

### Contribution surface (V1)

Inside plugins run in the same process — full surface available.

| Contribution | V1 support |
|---|---|
| `panel` | ✅ React component in host tree |
| `panelCommand` | ✅ |
| `leftTab` | ✅ |
| `surfaceResolver` | ✅ |
| `catalog` | ✅ |
| `agentTool` | ✅ front + server |
| `binding` | ✅ runtime React component |
| `provider` | ⚠️ possible but not recommended |
| `slotFill` | ✅ |

### Security (V1)

Plugin runs in the same Node.js process. This is intentional — local mode means the developer trusts their own agent.

---

## V2 — Hosted / Sandbox Mode

### What V2 means

The agent runs in a sandboxed environment (bwrap, Vercel). `front.tsx` is compiled to a JS bundle served to a sandboxed iframe. `plugin.server.ts` loads via an injected `ServerPluginLoader` into the host Fastify process (not sandboxed — the sandbox is for the agent, not the server plugin). The SSE path is **identical to V1** — only how the browser handles the panel render differs.

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
Agent writes .boring/plugins/csv-viewer/package.json
  │
  ▼ workspace.watch() fires
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
  unregisterByPluginId(pluginId)
  await import(`/.boring/plugins/${id}/${entry}?v=${revision}`)
  factory(createCapturingBoringExtensionAPI()) → captured registrations
  Path A: check captured types vs extensionContract
  Commit captured registrations to stores

mode="iframe" (V2):
  unregisterByPluginId(pluginId)
  Path A: check boring.panels[], boring.commands[], etc. vs extensionContract
  Register from manifest arrays; component = AgentPluginPane mode="iframe"
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

### `ServerPluginLoader` interface

The interface exists to allow swapping jiti (default) for a worker-thread loader in future multi-tenant scenarios. Today only `createJitiLoader()` is implemented.

```ts
interface ServerPluginLoader {
  load(pluginId: string, serverPath: string, api: BoringServerPluginAPI): Promise<void>
  unload(pluginId: string): Promise<void>
}

interface BoringServerPluginAPI {
  registerTool(tool: ToolDefinition): void           // same shape as front-side
  registerCatalogHandler(handler: CatalogSearchHandler): void
  registerDisposer(fn: () => void | Promise<void>): void
  log(level: "info" | "warn" | "error", message: string): void
}
```

### Dependencies in the iframe

Provisioning seeds a shared `node_modules` for all plugins:
```json
// .boring/plugins/package.json (seeded by provisioning — distinct from per-plugin package.json)
{
  "name": "boring-agent-plugins-root",
  "private": true,
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" }
}
```

### Contribution surface (V2)

| Contribution | V2 support | Notes |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `panelCommand` | ✅ | manifest → host registers wrapper |
| `leftTab` | ✅ | manifest → host registers wrapper |
| `surfaceResolver` | ✅ | LIFO stack, same as V1 |
| `catalog` | ✅ | server-side via `/api/agent-plugins/:id/catalog/search?q=` |
| `agentTool` | ✅ | `plugin.server.ts` via jiti |
| `binding` | ❌ | requires host React tree |
| `provider` | ❌ | wraps entire app tree |
| `slotFill` | ❌ | deferred |

---

## Shared Architecture — V1 and V2

V1 and V2 share all infrastructure except the panel render strategy.

| Layer | V1 | V2 |
|---|---|---|
| `package.json` watcher | ✅ | ✅ |
| Server: jiti loads `plugin.server.ts` | ✅ | ✅ via `ServerPluginLoader` |
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

```
base loads:     surfaceKind="csv.open" → csv-base-panel       stack: [base]
derived-a loads: surfaceKind="csv.open" → csv-viewer-panel    stack: [base, derived-a]
derived-b loads: surfaceKind="csv.open" → csv-detail-panel    stack: [base, derived-a, derived-b]
active resolver → derived-b (top)

derived-b unloads                                              stack: [base, derived-a]
active resolver → derived-a

derived-a unloads                                              stack: [base]
active resolver → base
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

## Existing Plugins — Migration Gap

All current first-party plugins use the declarative `WorkspaceFrontPlugin` shape. None use the factory pattern. **Outside plugins do not need to migrate** — `bootstrap()` continues loading them as-is. The factory pattern is for inside (agent-authored) plugins only.

The `BoringPluginAPI` in `authoring.ts` must expand to the new flat `BoringExtensionAPI` surface. The `PluginCoordinator` (browser-side stage/commit for inside plugins) is deleted and replaced by `registerAgentPlugin`. Outside plugins are not affected — `bootstrap()` registers them directly into registries as before.

### `filesystemPlugin` — Small effort

**File:** `packages/workspace/src/plugins/filesystemPlugin/front/index.ts`  
**Current shape:** `defineFrontPlugin({ outputs: [...], bindings: [...] })`

What changes if migrated to factory:
- `outputs` loop → `registerPanel?()`, `registerLeftTab?()`, `registerSurfaceResolver?()`
- **Bindings** (`FilesystemCatalogBinding`, `FilesystemFilePanelBinding`, `FilesystemAgentFileBridge`) are runtime React components, not declarative registrations. They stay as-is — register via `registerSlotFill?` or keep as a `bindings` field on the outside plugin.

**Decision: stays declarative.** Outside plugin. No migration needed.

### `explorerPlugin` — Trivial if migrated

**File:** `packages/workspace/src/plugins/explorerPlugin/front/index.tsx`  
**Current shape:** `createExplorerOutputs()` helper → `defineFrontPlugin({ outputs })`

Logic is already modular; migration is mechanical. If it ever moves to factory: `createExplorerPlugin()` becomes `(api: BoringExtensionAPI) => void`, replacing the outputs loop with individual `register*?()` calls.

**Decision: stays declarative.** Outside plugin. No migration needed.

### `dataCatalogPlugin` — Medium (three tiers)

**Files:**
- Front: `packages/workspace/src/plugins/dataCatalogPlugin/front/index.tsx`
- Server: `packages/workspace/src/plugins/dataCatalogPlugin/server/index.ts`
- Agent: `packages/workspace/src/plugins/dataCatalogPlugin/agent/index.ts`

Front uses `createDataCatalogOutputs()` helper + `appendDataCatalogOutputs()` for composition. Server uses `defineServerPlugin({ agentTools, systemPrompt })`.

The `appendDataCatalogOutputs()` helper (used by `playgroundDataCatalogPlugin` and macro) is the main composition primitive. Under a factory model, this becomes `composeFactories()`.

**Decision: stays declarative.** Outside plugin. `appendDataCatalogOutputs()` and `defineServerPlugin` remain.

### `macroPlugin` — Medium (composite)

**File:** `apps/boring-macro-v2/src/plugins/macro/front/index.tsx`  
**Current shape:** `composePlugins({ plugins: [macroPanels, macroSurfaces, macroSeriesCatalog] })`

Three sub-plugins composed via `composePlugins()`. If ever migrated, needs `composeFactories()` or inline all registrations into a single factory.

**Decision: stays declarative.** Outside plugin. `composePlugins()` remains.

### `playgroundDataCatalogPlugin` — Trivial dependency

**File:** `apps/workspace-playground/src/plugins/playgroundDataCatalog/front/index.tsx`  
Thin wrapper over `appendDataCatalogOutputs()`. Stays declarative, follows dataCatalogPlugin.

### What DOES change: `authoring.ts`

The coordinator already calls factories today via `createCapturingAPI()`. The capturing API needs to expand from the old namespaced shape to the new flat `BoringExtensionAPI` interface. This unblocks inside plugins but does not require outside plugins to change.

| Current `BoringPluginAPI` | New `BoringExtensionAPI` | Delta |
|---|---|---|
| `panels.register(reg)` | `registerPanel?(reg)` | rename + flatten |
| `commands.register(reg)` | `registerPanelCommand?(reg)` | rename + flatten |
| `surfaceResolvers.register(reg)` | `registerSurfaceResolver?(reg)` | rename + flatten |
| `providers.register(reg)` | `registerProvider?(reg)` | rename + flatten |
| `slotFills.register(reg)` | `registerSlotFill?(reg)` | rename + flatten |
| ❌ missing | `registerTool(tool)` | add — pi's ToolDefinition |
| ❌ missing | `registerLeftTab?(reg)` | add |
| ❌ missing | `registerCatalog?(reg)` | add |
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
- [ ] Introduce `BoringPackageField` type — `extensions: string[]`, `server?`, `label?`, `description?`, `derivesFrom?`, `panels[]`, `commands[]`, `leftTabs[]`, `surfaceResolvers[]`, `catalogs[]`
- [ ] `readBoringPackage(dir)` — reads `package.json`, extracts `version` from top-level, id from directory name, contributions from `boring` field
- [ ] Validation: `extensions[]` ≥ 1 entry, all paths pass `isSafePluginRelativePath`, `derivesFrom` passes `isValidBoringPluginId`, cross-references valid, no duplicate ids within arrays
- [ ] Error codes: `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | UNKNOWN_FIELD | CROSS_REFERENCE | DUPLICATE_ID`
- [ ] Export `BoringPackageField` from `plugin.ts` and `@boring/workspace/plugin` subpath
- [ ] Rewrite `manifest.test.ts`

### B — Doc seeding + system prompt

- [ ] Create `packages/workspace/docs/plugins.md` — file layout, `package.json` schema, V1/V2 authoring, hot-reload flow, Path A
- [ ] Create `packages/workspace/docs/panels.md` — panel registration, `AgentPluginPane`, contribution surface by mode
- [ ] Create `packages/workspace/docs/bridge.md` — postMessage bridge API, `@boring/workspace/bridge-client` usage
- [ ] `boringSystemPrompt.ts` — embed all three docs as static strings; `BORING_DOCS_PATH` overrides path for dev

### C — Fix `pluginLoader.ts` + Plugin watcher + SSE dispatch

**Fix boring-ui's pi-extension loader** (`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`):
- [ ] Replace `const defaultImport: ImportFn = (url) => import(url)` with `createJiti(import.meta.url, { moduleCache: false })`
- [ ] Widen `VALID_EXTENSIONS` from `{".js", ".mjs"}` to `{".ts", ".tsx", ".js", ".mjs"}`
- [ ] Keep `extractTools` / `validateTool` / `PluginLoadResult` shapes unchanged — callers unaffected

**Plugin watcher** (`packages/workspace/src/server/plugins/agentPluginWatcher.ts`):

The watcher subscribes to the existing workspace `WorkspaceWatcher` (already provided by `createNodeWorkspace` in `packages/agent`). To emit SSE plugin events it receives a `PluginEventEmitter` — a thin interface satisfied by the existing `FsEventBroadcaster` with a new `emitPlugin` method. The agent wires both together.

- [ ] `createAgentPluginWatcher(watcher: WorkspaceWatcher, emit: PluginEventEmitter, loader: ServerPluginLoader): Disposable`
- [ ] Filter events: only `.boring/plugins/*/package.json` writes trigger reload; all other paths ignored
- [ ] Extract `pluginId` from the directory name segment between `plugins/` and `/package.json`
- [ ] Per-pluginId promise lock — serialize concurrent reloads (no debounce; `package.json` write IS the commit signal)
- [ ] On `write`: `readBoringPackage(dir)` → validate → jiti stage → commit → `emit.pluginLoad({ boring, version, revision, eventId: randomUUID() })`; on any failure write `.boring/plugins/<id>/.error` + `emit.pluginError`. If `JSON.parse` fails, retry once after 80 ms before classifying as error (guards against partial writes on slow filesystems).
- [ ] On `unlink`: run disposers, remove from registry → `emit.pluginUnload({ pluginId, revision })`
- [ ] On success: delete `.boring/plugins/<id>/.error` if present

**SSE multiplexing** (`packages/agent/src/server/http/fsEvents.ts`):
- [ ] Add `emitPlugin(event: BoringPluginEvent): void` to `FsEventBroadcaster` — writes SSE with `event: "boring.plugin.load" | "boring.plugin.unload" | "boring.plugin.error"` alongside existing `event: "change"` entries
- [ ] Browser clients filter by event type; no new SSE endpoint needed

### D — Server plugin loading: jiti + registry + API routes

All files in `packages/workspace/src/server/plugins/` unless noted. API routes in `packages/agent/src/server/http/routes/`.

- [ ] `serverPluginRegistry.ts` — `Map<pluginId, { extensionContract?, activeRevision }>`. Registers outside plugin ids at startup (collision guard). Exposes `activePlugins(): ActivePlugin[]` for the reconnect endpoint.
- [ ] `jitiPluginLoader.ts` — implements `ServerPluginLoader` interface. Uses `createJiti(import.meta.url, { moduleCache: false })`. Stage: jiti imports entry into a temp `BoringServerPluginAPI` instance. Commit: atomically swap temp → live, run old disposers first. Unload: run disposers, clear from live map.
- [ ] `boringServerPluginAPI.ts` — `BoringServerPluginAPI` implementation: `registerTool(ToolDefinition)`, `registerCatalogHandler(fn)`, `registerDisposer(fn)`, `log(level, msg)`.
- [ ] `agentPluginRoutes.ts` (in agent routes) — two endpoints:
  - `GET /api/agent-plugins` → `Array<{ boring: BoringPackageField, version, revision }>` from `serverPluginRegistry.activePlugins()`; browser calls this on connect/reconnect
  - `GET /api/agent-plugins/:id/catalog/search?q=` → delegates to registered `CatalogSearchHandler`; 404 if none registered; in-flight requests finish before handler removal on reload
- [ ] Wire `createAgentPluginWatcher` into `createAgentApp` — passes workspace watcher + broadcaster + jiti loader
- [ ] `pluginRegistry.register({ id })` called for each outside plugin id at startup (before SSE replay)
- [ ] Update `createPiCodingAgentHarness` to accept `getExtraTools: () => ToolDefinition[]` (live getter); each `AgentSession` calls it at creation — plugin tools registered after startup are visible to new sessions without restart
- [ ] Catalog handler snapshot pattern: `agentPluginRoutes.ts` captures handler reference at request entry (`const handler = registry.getCatalogHandler(id)`) so in-flight searches complete against the captured reference even if the plugin reloads mid-request

### E — TypeBox migration + `authoring.ts`: `BoringPluginAPI` → `BoringExtensionAPI`

**TypeBox full migration** (prerequisite for `registerTool`):
- [ ] Change `AgentTool.parameters` from `JSONSchema = Record<string, unknown>` to `TSchema` (import from `@sinclair/typebox`)
- [ ] Update `validateTool` to accept TypeBox schemas
- [ ] Drop `parameters: tool.parameters as any` in `tool-adapter.ts` — now type-safe end-to-end
- [ ] Update all existing tools (filesystem, harness, dataCatalog, etc.) to use `Type.Object(...)` parameters
- [ ] Update `AgentTool.execute` params type from `Record<string, unknown>` to `Static<TParams>`

**`authoring.ts` rewrite:**
- [ ] Replace namespaced `BoringPluginAPI` with flat `BoringExtensionAPI`
- [ ] Pi methods boring-ui implements: `registerTool(ToolDefinition)`, `registerCommand(name, opts)`, `registerShortcut(key, opts)`, `on(event, handler)`
- [ ] `registerTool` — import `ToolDefinition` from `@mariozechner/pi-coding-agent`; re-export from `@boring/workspace/plugin`; plugin authors use `defineTool()` helper
- [ ] `registerCommand` — pi slash command (`/name [args]`); boring-ui registers it as a front-side slash command handler (not available in `BoringServerPluginAPI`)
- [ ] `on("load"/"unload", handler)` wired; all other events no-op with dev-mode warning
- [ ] Pi stub methods (no-op + `console.warn` in dev): `exec`, `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getActiveTools`, `setActiveTools`, `setModel`, `events`, `registerFlag`, `registerProvider`, etc.
- [ ] Boring-ui optional flat methods: `registerPanel?`, `registerPanelCommand?`, `registerLeftTab?`, `registerSurfaceResolver?`, `registerCatalog?`, `registerProvider?`, `registerSlotFill?`
- [ ] `export type BoringExtensionFactory = (api: BoringExtensionAPI) => void | Promise<void>`
- [ ] Update `createCapturingAPI()` — implement `BoringExtensionAPI`; capture `registerTool` into `tools: ToolDefinition[]`; `flush()` returns `{ panels, panelCommands, leftTabs, surfaceResolvers, catalogs, tools, ... }`
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
- [ ] `src/front/plugins/AgentPluginPane.tsx`:
  - `mode="direct"` (V1): `React.lazy(() => import(url?v=revision))` where the module's default export IS the panel component; key includes revision to force remount on reload
  - `mode="iframe"` (V2 stub): renders placeholder `<div>V2 iframe — wired in TODO G</div>`
  - When plugin absent from store: renders "Plugin not loaded" placeholder
- [ ] Introduce `useWorkspaceEventStream` — a workspace-level shared `EventSource` to `/api/v1/fs/events` that fans out to type-specific subscribers. Both file-event and plugin-event listeners attach here. Replaces per-component `EventSource` creation in `useFileEventStream`. Eliminates duplicate connections.
- [ ] SSE handler: subscribe via `useWorkspaceEventStream` — filter for `boring.plugin.*` event types → `registerAgentPlugin` / unregister / toast. Each `boring.plugin.load` event carries an `eventId: string` (UUID); check against a per-pluginId LRU before processing to deduplicate replay-then-live races.
- [ ] `await factory(capturingAPI)` before calling `flush()` — async factories that register after an internal `await` are correctly captured
- [ ] On connect/reconnect: `GET /api/agent-plugins` → for each entry where `revision > lastSeen[pluginId]`, call `registerAgentPlugin`

### G — V2: esbuild route + iframe render (skeleton this PR, wire fully later)

This PR ships the skeleton: the route exists and the iframe renders, but the postMessage bridge (TODO H) and provisioning (TODO I) are follow-up work.

- [ ] `GET /api/agent-plugins/:pluginId/front.js` (`packages/agent/src/server/http/routes/agentPluginFront.ts`):
  - Validate pluginId with `isValidBoringPluginId`; resolve and verify path stays within `workspaceRoot/.boring/plugins/` (no symlink escapes)
  - Compile `boring.extensions[0]` via esbuild on demand; cache keyed by `(pluginId, mtime)` of the entry file; invalidate cache on watcher reload event
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

### J — Plugin templates + docs

- [ ] `packages/workspace/templates/plugin/` — V1 example: `package.json` + `front.tsx` (Path B from scratch)
- [ ] Add Path A example: `package.json` with `derivesFrom`, `front.tsx` using `registerPanel?` + `registerSurfaceResolver?`
- [ ] Add `plugin.server.ts` example with `registerTool` + `registerCatalogHandler`
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/` location
- [ ] Docs: `plugins.md` includes agent-facing walkthrough and worked examples

---

## Out of Scope

- Outside plugin migration to factory pattern — `bootstrap()` stays; no forcing function
- `binding` / `provider` / `slotFill` in V2 — require host React tree; incompatible with iframe sandbox
- `host.query()` bridge for V2 derived plugins — deferred until Path A + full bridge land
- Vite HMR for outside plugins — separate concern
- Worker-thread `ServerPluginLoader` — deferred; jiti sufficient today
- postMessage bridge wiring (TODO H) and provisioning (TODO I) — follow-up PRs after G skeleton ships
- `registerShortcut` implementation — accepted by `BoringExtensionAPI` but no-op in V1 (no keybinding registry yet)
