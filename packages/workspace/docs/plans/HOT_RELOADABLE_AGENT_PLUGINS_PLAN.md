# Hot-Reloadable Agent Plugins Plan

Last updated: 2026-05-06
Status: **Phase 1 complete** — coordinator + manifest skeleton + authoring types + `@boring/workspace/plugin` subpath

---

## Goal

Let an agent write a plugin to `.boring/plugins/<name>/` and have it load live into a running workspace without a page refresh — contributing panels, commands, left tabs, surface resolvers, catalog search, and server-side agent tools.

---

## Two Plugin Tiers — One Interface

The existing `WorkspaceFrontPlugin` / `defineFrontPlugin` surface remains untouched for **outside plugins** (first-party, loaded at app startup, full surface, compiled with the app).

**Inside plugins** are agent-authored at runtime. Their manifest is `package.json` — the `"boring"` field carries all contribution declarations and metadata. No separate manifest file.

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `package.json` (`"boring"` field) |
| Loaded | At app startup | At runtime via file watcher |
| Full plugin surface | ✅ all PluginOutput types | Depends on mode (see below) |

### Two authoring paths for inside plugins

**Path A — Derive from an existing outside plugin**

The agent extends an existing outside plugin (e.g. macro, filesystem) by adding panels, commands, or server tools on top of it. The host plugin opts in by declaring `extensionContract: { allowedContributions: [...] }`. The manifest uses `derivesFrom: "<pluginId>"`.

Surface resolvers use **last-registered-wins**: a derived plugin registering a resolver for a given `surfaceKind` shadows the base plugin's resolver while loaded. On unload, the base resolver becomes active again automatically.

**Path B — Build from scratch**

Self-contained plugin with its own front + server code. No dependency on any existing plugin.

---

## Pi Plugin Compatibility — Living on Top of Pi's System

Boring-ui plugins ARE pi extensions. The factory is a valid pi `ExtensionFactory` — same file loads in pi's loader unchanged. Boring-ui extends the API object with optional UI-registration namespaces that pi simply doesn't provide.

### Discovery — mirroring pi exactly

Pi discovers extensions from `.pi/extensions/<name>/` using `package.json`:

```json
{ "pi": { "extensions": ["./front.tsx"] } }
```

Boring-ui mirrors this pattern for `.boring/plugins/<name>/`:

```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "extensions": ["./front.tsx"],
    "server": "./plugin.server.ts",
    "label": "CSV Viewer",
    "panels":          [{ "id": "csv-viewer-panel", "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv", "title": "Open CSV Viewer", "panelId": "csv-viewer-panel" }],
    "leftTabs":        [{ "id": "csv-tab",  "title": "CSV", "panelId": "csv-viewer-panel" }],
    "surfaceResolvers":[{ "id": "csv-open", "surfaceKind": "csv.open", "panelId": "csv-viewer-panel" }],
    "catalogs":        [{ "id": "csv-catalog" }]
  },
  "pi": { "extensions": ["./front.tsx"] }
}
```

`"boring"` = boring-ui discovery + all contribution metadata.  
`"pi"` = pi discovery (same factory, same entry point).  
Plugin `id` is derived from the directory name (`csv-viewer`). `version` comes from top-level `"version"`.  
**No `boring.plugin.json`** — `package.json` is the single source of truth.

### Factory — the authoring pattern

```ts
// front.tsx — valid pi ExtensionFactory, loads in both runtimes
import { defineTool }         from "@mariozechner/pi-coding-agent"
import type { BoringExtensionAPI } from "@boring/workspace/plugin"

export default function factory(api: BoringExtensionAPI): void | Promise<void> {

  // ── pi-compatible (works in pi and boring-ui) ──────────────────────────

  // registerTool: pi's exact ToolDefinition shape (TypeBox parameters)
  api.registerTool(defineTool({
    name: "search_csv",
    label: "Search CSV",
    description: "Full-text search over a CSV file",
    parameters: Type.Object({ q: Type.String() }),
    execute: async (_id, { q }, signal) => ({
      content: [{ type: "text", text: `results for ${q}` }],
    }),
  }))

  // registerCommand: pi's SLASH commands (/name [args]), NOT UI palette entries
  api.registerCommand("csv.open", {
    description: "Open the CSV viewer panel",
    handler: async (_args, ctx) => { /* pi context action */ },
  })

  // ── boring-ui extras (optional chaining — safe in pi context) ──────────

  api.panels?.register({ id: "csv-viewer-panel", label: "CSV Viewer", component: CsvPane })
  api.commands?.register({ id: "open-csv", title: "Open CSV Viewer", panelId: "csv-viewer-panel" })
  api.leftTabs?.register({ id: "csv-tab", title: "CSV", panelId: "csv-viewer-panel" })
  api.surfaceResolvers?.register({ kind: "csv.open", resolve: () => ({ panelId: "csv-viewer-panel" }) })
}
```

### `BoringExtensionAPI` — pi methods boring-ui implements

```ts
interface BoringExtensionAPI {
  // ── pi methods — boring-ui implements these ───────────────────────────
  registerTool(tool: ToolDefinition): void       // routes to workspace agent tool registry
  registerCommand(name: string, options: {        // registers a /slash-command
    description?: string
    handler: (args: string, ctx: unknown) => Promise<void>
  }): void
  on(event: string, handler: (...args: unknown[]) => void): void  // "load"/"unload" wired; others no-op

  // ── pi methods — boring-ui stubs (no-op + dev warning) ───────────────
  exec(...): Promise<unknown>
  sendMessage(...): void
  sendUserMessage(...): void
  events: { on(): void; off(): void; emit(): void }   // stub EventBus
  getActiveTools(): string[]
  setActiveTools(tools: string[]): void
  // ... remaining pi-specific methods stubbed

  // ── boring-ui extras (absent in pi → always use optional chaining) ───
  panels?:          { register(reg: BoringPluginPanelRegistration): void }
  commands?:        { register(reg: BoringPluginCommandRegistration): void }  // palette entry that opens a panel
  leftTabs?:        { register(reg: BoringPluginLeftTabRegistration): void }
  surfaceResolvers?:{ register(reg: BoringPluginSurfaceResolverRegistration): void }
  catalogs?:        { register(reg: BoringPluginCatalogRegistration): void }
}
```

**Two command concepts — genuinely distinct:**
- `api.registerCommand("name", { handler })` — pi slash command (`/name`); boring-ui registers it as a slash command handler. No panel.
- `api.commands?.register({ panelId })` — boring-ui command palette entry that opens a panel. Not a pi concept.

### `plugin.server.ts` — boring-ui's addition (pi has no server concept)

Pi has no server-side plugin concept. `plugin.server.ts` is purely boring-ui's extension:

```ts
// plugin.server.ts — boring-ui only; no pi equivalent
import type { BoringServerPluginAPI } from "@boring/workspace/plugin"

export default function serverFactory(api: BoringServerPluginAPI): void | Promise<void> {
  api.registerTool({ name: "parse_csv", ... })     // same ToolDefinition shape
  api.registerCatalogHandler(async (q) => [...])
  api.registerDisposer(() => { /* cleanup */ })
}
```

`BoringServerPluginAPI.registerTool` uses pi's verbatim `ToolDefinition` shape for consistency.

### Replacing `BoringPluginAPI`

`BoringPluginAPI` (the old namespaced-only interface in `authoring.ts`) is superseded by `BoringExtensionAPI`. Keep it as a deprecated alias during migration.

### V2 — why `package.json["boring"]` arrays still matter

In V2 (iframe mode) the factory runs inside the iframe and has no access to host registries. The `panels[]`, `commands[]`, `leftTabs[]`, `surfaceResolvers[]` arrays in `package.json["boring"]` are the **authoritative declaration** the host reads to register contributions without running the factory. Same data, different consumer.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Manifest file | `package.json` only | `"boring"` field carries all metadata. Mirrors pi's `"pi": { "extensions": [...] }` pattern. No separate `boring.plugin.json`. |
| Reload trigger | `package.json` write | Agent writes code files first, then writes `package.json` as commit signal. No partial-write races. Same "explicit reload" philosophy as pi's `/reload` command. |
| Rollback on failure | Restore old state | Stage new registrations, commit only on full success. Old plugin stays live on any failure. |
| Registry/React integration | Zustand stores | Plugin registries are Zustand stores. SSE updates go through `setState` — no Map mutation during React render cycle. |
| iframe handshake | Iframe sends `ready` first | Iframe signals it's ready; host responds with `init`. Eliminates lost-init race from `onLoad` timing. |
| Revision scope | Monotonic per pluginId | Every SSE event (load, unload, error) and reconnect response carries revision. Browser drops events where `revision ≤ lastSeen[pluginId]`. |
| Plugin API | `BoringExtensionAPI` wraps pi's API | Implements pi methods boring-ui supports (`registerTool`, `registerCommand`, `on`). Stubs pi-specific ones. Adds optional boring-ui UI namespaces. `registerTool` uses pi's verbatim TypeBox `ToolDefinition` shape including the full execute signature. |
| Server-side | `plugin.server.ts` is boring-ui only | Pi has no server plugin concept. Server factory uses `BoringServerPluginAPI` with same `ToolDefinition` shape for consistency. |

---

## Atomicity Model

Both server and browser use a **stage → validate → commit / rollback** pattern. Old state is never discarded until new state is proven good.

### Server (both modes)

```
1. Read + validate manifest  →  fail: write .error, SSE error, return (no state change)
2. ServerPluginLoader.stage(pluginId, serverPath, api)  →  staged tools in temp registry
3. Stage fails (jiti throws, disposers not registered)  →  write .error, SSE error, return
4. Commit: atomically swap temp registry into live registry (unload old tools, activate staged)
5. activePlugins[pluginId] = { manifest, revision }  (updated BEFORE SSE dispatch)
6. Delete .boring/plugins/<id>/.error if present
7. SSE boring.plugin.load { manifest, revision }
```

Unload: reverse step 4, remove from activePlugins, SSE `boring.plugin.unload { pluginId, revision }`.

### Browser (both modes)

```
SSE boring.plugin.load { manifest, revision } received:
1. If revision ≤ lastSeen[pluginId]: discard stale
2. Snapshot current Zustand state for pluginId (for rollback)
3. Build staged registrations:
     mode="direct": await import(url?v=revision) → run factory → capture
     mode="iframe": read manifest arrays → build registration set
4. Validate staged (Path A extensionContract check)
5. Any step 3–4 throws: restore snapshot to Zustand, show toast, return
6. Commit: usePanelStore.setState(...), useCommandStore.setState(...) etc.
   — resolver LIFO stack: push new entries tagged (pluginId, revision);
     pop all previous entries for this pluginId before pushing new ones
7. lastSeen[pluginId] = revision
```

Unload SSE `{ pluginId, revision }`: if `revision ≤ lastSeen[pluginId]` discard; else pop all resolver stack entries for pluginId, remove from all Zustand stores, lastSeen[pluginId] = revision.

### Reconnect ordering

Server always updates `activePlugins` map **before** dispatching SSE. `GET /api/agent-plugins` therefore always returns state ≥ what SSE has announced. Browser on reconnect:

```
const plugins = await fetch('/api/agent-plugins')  // returns [{ manifest, revision }]
for each { manifest, revision } in plugins:
  if revision > lastSeen[manifest.id]:
    registerAgentPlugin(manifest, revision, mode)  // only registers if newer
```

This is safe even if SSE already delivered a newer revision — the stale check in step 1 discards the reconnect registration.

---

## Unified Load Architecture — Paves the Way for V2

V1 and V2 share the same browser-side load infrastructure. The only thing that changes from V1 → V2 is **how the panel renders**:

| Layer | V1 (local) | V2 (hosted/sandbox) |
|---|---|---|
| Plugin watcher | ✅ shared | ✅ shared |
| Server: jiti loads `plugin.server.ts` | ✅ shared | ✅ shared (via injected ServerPluginLoader) |
| SSE `boring.plugin.load` dispatch | ✅ shared | ✅ shared |
| Browser SSE handler | ✅ shared | ✅ shared |
| `registerAgentPlugin(manifest, registries)` | ✅ shared | ✅ shared |
| `GET /api/agent-plugins` reconnect endpoint | ✅ shared | ✅ shared |
| Path A extensionContract validation | ✅ shared | ✅ shared |
| Panel render strategy | direct `React.lazy` import via Vite | `<iframe>` served by esbuild |
| postMessage bridge | ❌ not needed | ✅ v2 only |
| Provisioned node_modules | ❌ not needed | ✅ v2 only |

This means all SSE dispatch, browser registration, and Path A wiring written for V1 is reused unchanged in V2. V2 only adds: esbuild route, iframe render mode in `AgentPluginPane`, postMessage bridge, and provisioning.

---

## V1 — Local Mode (full node process access)

### What v1 means

The agent runs locally. The workspace server runs locally. `plugin.server.ts` loads into the Fastify process via jiti. `front.tsx` is imported by the browser directly from Vite's dev server — no iframe, no esbuild, no sandbox. The component runs in the host React tree.

### File layout

```
.boring/plugins/
  csv-viewer/
    package.json          ← single manifest: discovery + all metadata + commit signal (write this last)
    front.tsx             ← pi-compatible factory with boring-ui extras
    plugin.server.ts      ← server tools + catalog (boring-ui only; no pi equivalent)
```

**`package.json`** — the only file boring-ui and pi both need to know about:
```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "extensions": ["./front.tsx"],
    "server": "./plugin.server.ts",
    "label": "CSV Viewer",
    "panels":          [{ "id": "csv-viewer-panel", "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv", "title": "Open CSV Viewer", "panelId": "csv-viewer-panel" }],
    "leftTabs":        [{ "id": "csv-tab",  "title": "CSV", "panelId": "csv-viewer-panel" }],
    "surfaceResolvers":[{ "id": "csv-open", "surfaceKind": "csv.open", "panelId": "csv-viewer-panel" }],
    "catalogs":        [{ "id": "csv-catalog" }],
    "derivesFrom":     "macro"
  },
  "pi": { "extensions": ["./front.tsx"] },
  "dependencies": { "papaparse": "^5.0.0" }
}
```

`"boring"` = boring-ui metadata (contribution declarations + server entry).  
`"pi"` = pi discovery (same entry point array).  
No separate manifest file.

### V1 constraint: dev mode only

V1 requires the Vite dev server to be running. The Vite config must include:

```ts
server: { fs: { allow: [workspaceRoot] } }
```

This lets the browser import `/.boring/plugins/<id>/front.tsx` — Vite transforms it on the fly. V1 is **not intended for production builds** — use V2 (esbuild + iframe) for any deployed environment.

### Manifest-as-commit-signal

The watcher fires on `package.json` writes/deletes — **not** on changes to `front.tsx` or `plugin.server.ts`. The agent workflow:

```
1. Write front.tsx          (no reload)
2. Write plugin.server.ts   (no reload)
3. Write package.json       ← reload triggers here (write last, even if just bumping version)
```

This eliminates partial-write races: by the time the manifest is written, all code files are already on disk. Aligns with pi's philosophy of explicit reload signals rather than continuous file watching.

### Load flow (v1)

```
Agent writes .boring/plugins/csv-viewer/package.json
  │
  ▼
workspace.watch() fires on .boring/plugins/csv-viewer/package.json
  │
  ▼ (server — stage → commit model)
Read + validate package.json (boring field)  →  fail: write .error, SSE error, return
Extract pluginId from directory name — must match package["boring"].id if explicit, else dir name
revision[pluginId]++
Stage: jiti.import(boring.extensions[0], { moduleCache: false }) — server-side capture of registerTool calls
       jiti.import(boring.server, { moduleCache: false }) into temp tool registry
Stage fails (jiti throws)  →  write .error, SSE error, return (old tools untouched)
Commit: swap temp registry → live registry
activePlugins[pluginId] = { pkg, revision }  (before SSE)
Delete .boring/plugins/<id>/.error if present
SSE boring.plugin.load { pkg: package.json["boring"], revision }
  │
  ▼ (browser — stage → commit model)
revision ≤ lastSeen[pluginId]: discard stale
Snapshot current Zustand state for pluginId
import(`/.boring/plugins/${id}/${pkg.boring.extensions[0]}?v=${revision}`)  ← Vite transforms
Run factory(capturingBoringExtensionAPI) → captured registrations
Validate: if derivesFrom, check captured types against extensionContract
Any failure → restore snapshot, toast error, return (old registrations stay)
Commit:
  pop all resolver stack entries for pluginId (remove old revision entries)
  usePanelStore.setState / useCommandStore.setState / etc.
  push new resolver stack entries tagged (pluginId, revision)
lastSeen[pluginId] = revision
AgentPluginPane mode="direct":
  factory import IS the component — AgentPluginPane uses the already-imported
  module ref, not a second React.lazy call; panel key includes revision to force remount
```

Unload: `package.json` deleted → server commits empty state → SSE `boring.plugin.unload { pluginId, revision }` → browser pops resolver stack, removes from Zustand stores → open panels show "plugin not loaded" placeholder.

### Contribution surface (v1)

All outside plugin contribution types are available — the inside plugin runs in the same process with the same capabilities:

| Output type | Supported |
|---|---|
| `panel` | ✅ direct React component in host process |
| `command` | ✅ |
| `left-tab` | ✅ |
| `surface-resolver` | ✅ |
| `catalog` | ✅ |
| `agent-tool` | ✅ |
| `binding` | ✅ runs in host React tree |
| `provider` | ⚠️ possible but not recommended |
| `slot-fill` | ✅ |

### Security (v1)

Plugin runs in the same Node.js process. This is intentional — local mode means the developer trusts their own agent. No sandbox needed.

---

## V2 — Hosted / Sandbox Mode (no direct node process access)

### What v2 means

The agent runs in a sandboxed environment (bwrap, Vercel). Plugin code cannot run in the host process. `front.tsx` is compiled to a JS bundle served to an iframe. `plugin.server.ts` loads via an injected `ServerPluginLoader`. The SSE notification path is **identical to v1** — only how the browser handles it differs: in v2 the manifest arrays are authoritative and `AgentPluginPane` renders an iframe.

### File layout (same as v1)

```
.boring/plugins/
  csv-viewer/
    package.json          ← single manifest (same as v1)
    front.tsx             ← compiled by esbuild on demand, served to iframe
    plugin.server.ts      ← loaded by injected ServerPluginLoader
```

### Full load flow (v2)

```
Agent writes .boring/plugins/csv-viewer/ files
  │
  ▼
workspace.watch() fires on boring.plugin.json
  │
  ▼ (server)
Read + validate boring.plugin.json
Extract pluginId from path segment — must match manifest.id
If derivesFrom: check server-side pluginRegistry extensionContract for "agent-tool"
ServerPluginLoader.load(pluginId, serverPath, api) → registers tools + catalog handler
Invalidate esbuild cache for pluginId (so next front.js request recompiles)
Delete .boring/plugins/<id>/.error if present
SSE → dispatchCommand("boring.plugin.load", { manifest })
  │
  ▼ (browser — SSE handler, mode="iframe")
registerAgentPlugin(manifest, registries, pluginRegistry, mode="iframe"):
  unregisterByPluginId(pluginId)
  If derivesFrom: check browser-side pluginRegistry extensionContract
    validate manifest contribution types against allowedContributions
  For each manifest.panels[]:
    registries.panels.register(panel.id, {
      pluginId,
      component: AgentPluginPane,
      props: { pluginId, mode: "iframe" }
    })
  For each manifest.commands[]:
    registries.commands.registerCommand({
      id: cmd.id, title: cmd.title, pluginId,
      action: () => cmd.panelId && openPanel(cmd.panelId)
    })
  For each manifest.leftTabs[]:
    registries.tabs.register({ id, title, panelId, pluginId })
  For each manifest.surfaceResolvers[]:
    registries.resolvers.register(resolver.surfaceKind, { pluginId, panelId: resolver.panelId })
  // catalogs: registered server-side only; no browser registration needed
  │
  ▼ (user opens panel)
<AgentPluginPane pluginId="csv-viewer" mode="iframe" />
  → <iframe
      src="/api/agent-plugins/csv-viewer/front.js?v=<timestamp>"
      sandbox="allow-scripts"
      style="border:none; width:100%; height:100%"
    />
  → GET /api/agent-plugins/csv-viewer/front.js
      esbuild compiles front.tsx on demand (see esbuild config below)
      response: Content-Type: application/javascript, Cache-Control: no-store
  → iframe loads → sends boring.bridge.init to host
  → host validates event.source === iframe.contentWindow, responds with theme + derivedFrom
```

Hot-reload: watcher fires → ServerPluginLoader.reload → esbuild cache invalidated → SSE `boring.plugin.load` → browser: `unregisterByPluginId` + re-register from manifest → any open `AgentPluginPane` receives `boring.bridge.reload` message → iframe navigates to new `?v=<timestamp>` URL.

Unload: `boring.plugin.json` deleted → `ServerPluginLoader.unload` → SSE `boring.plugin.unload` → browser `unregisterByPluginId` → open panes show fallback "plugin unloaded" state.

On browser connect/reconnect: `GET /api/agent-plugins` → for each manifest in response, call `registerAgentPlugin(manifest, registries, pluginRegistry, mode)`.

### registerAgentPlugin — v1 vs v2 fork

```
mode="direct" (v1):
  unregisterByPluginId(pluginId)
  Path A check (same as v2)
  const { default: factory } = await import(
    `/.boring/plugins/${id}/front.tsx?v=${Date.now()}`
  )
  factory(createCapturingAPI()) → captured { panels, commands, tabs, resolvers, ... }
  apply captured registrations to registries
  // manifest panels[] used only for pre-validation, not registration

mode="iframe" (v2):
  unregisterByPluginId(pluginId)
  Path A check (same as v1)
  register from manifest.panels[], manifest.commands[], manifest.leftTabs[],
  manifest.surfaceResolvers[] directly — no dynamic import
```

Mode is determined at app startup from workspace config (injected via `window.__BORING_PLUGIN_MODE__` or build-time env var). Passed into the SSE handler when it calls `registerAgentPlugin`.

### Contribution surface (v2)

| Output type | Supported | Notes |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `command` | ✅ | manifest → host registers wrapper |
| `left-tab` | ✅ | manifest → host registers wrapper |
| `surface-resolver` | ✅ | last-registered-wins, same as v1 |
| `catalog` | ✅ | `GET /api/agent-plugins/:id/catalog/search?q=` → jiti-loaded handler |
| `agent-tool` | ✅ | `plugin.server.ts` via injected ServerPluginLoader |
| `binding` | ❌ | requires host React tree |
| `provider` | ❌ | wraps entire app tree |
| `slot-fill` | ❌ | deferred |

### Security boundary — core injects, workspace executes (v2)

Clarification: **the sandbox is for the agent process, not for plugin server code**. In both bwrap and Vercel:
- The Fastify workspace server runs in the host process — not sandboxed
- `plugin.server.ts` loads into that Fastify process via jiti (same as v1)
- The agent is sandboxed and cannot write to Fastify memory directly
- The iframe sandboxes the plugin's *front* code in the browser

The distinction from v1 is execution environment for the *front*:
- V1: front runs via Vite in host React tree (requires Vite dev server)
- V2: front runs in a sandboxed iframe (works in any environment)

The `ServerPluginLoader` interface exists not to sandbox plugin.server.ts, but to allow the core to decide HOW jiti is invoked (in-process jiti today, worker thread in future multi-tenant):

```ts
interface ServerPluginLoader {
  load(pluginId: string, serverPath: string, api: BoringServerPluginAPI): Promise<void>
  unload(pluginId: string): Promise<void>
}

interface BoringServerPluginAPI {
  registerTool(tool: AgentTool): void
  registerCatalogHandler(handler: CatalogSearchHandler): void
  log(level: "info" | "warn" | "error", message: string): void
}

type CatalogSearchHandler = (query: string) => Promise<CatalogSearchResult[]>
```

`createJitiLoader()` is the default — used for local and bwrap. `createWorkerLoader()` is future for strict multi-tenant isolation.

### esbuild compilation (v2)

Compile on demand; cache in memory keyed by `(pluginId, frontPath mtime)`. Watcher invalidates cache on reload.

```ts
const result = await esbuild.build({
  entryPoints: [frontPath],                     // .boring/plugins/<id>/front.tsx
  bundle: true,
  format: "iife",
  jsx: "automatic",
  jsxImportSource: "react",
  platform: "browser",
  nodePaths: [join(workspaceRoot, ".boring/plugins/node_modules")],
  alias: {
    "@boring/workspace/bridge-client":
      join(workspaceRoot, ".boring/plugins/.boring-vendor/bridge-client.js"),
  },
  write: false,                                 // return as in-memory buffer
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
})
// result.outputFiles[0].text → serve as application/javascript
```

On esbuild error: write `.boring/plugins/<id>/.error` with formatted diagnostics + send SSE `boring.plugin.error`. Serve last good compiled output if cached; otherwise 500.

### AgentPluginPane — iframe mode (v2)

```tsx
// mode="iframe"
const url = `/api/agent-plugins/${pluginId}/front.js?v=${reloadKey}`
<iframe
  ref={iframeRef}
  src={url}
  sandbox="allow-scripts"   // NOT allow-same-origin — keeps origin null for security
  style={{ border: "none", width: "100%", height: "100%" }}
  onLoad={() => sendBridgeInit(iframeRef.current!)}
/>
```

- `reloadKey` is local state, incremented when SSE `boring.plugin.load` fires for this pluginId with a newer revision
- `onLoad`: host sends `boring.bridge.init` with theme tokens and `derivedFrom` if applicable
- Bridge message validation: `event.source === iframeRef.current?.contentWindow` — never check `event.origin` (it is always `"null"` for sandboxed iframes)
- Error boundary wraps the iframe; on unload event the pane renders a "plugin not loaded" placeholder
- `/api/agent-plugins/:pluginId/front.js` response includes: `Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'`; plugin ID validated against `isValidBoringPluginId`; resolved path checked to be within `workspaceRoot/.boring/plugins/` (no symlink escape)

### postMessage bridge — full spec (v2)

**Handshake (ack-based, eliminates lost-init race):**
```
iframe loads → evaluates bundle → sends boring.bridge.ready
host receives ready → responds with boring.bridge.init
iframe receives init → renders with theme/derivedFrom → sends boring.bridge.rendered
```

**Host → iframe:**
```ts
{ type: "boring.bridge.init",
  theme: Record<string, string>,    // CSS custom property values
  derivedFrom?: string }            // base plugin id if Path A
```

**Iframe → host:**
```ts
{ type: "boring.bridge.ready" }     // iframe bundle evaluated, ready for init

{ type: "boring.bridge.rendered" }  // first render complete, host can hide loader

{ type: "boring.bridge.openPanel",
  panelId: string }                 // host calls openPanel(panelId)

{ type: "boring.bridge.showNotification",
  message: string,
  level: "info" | "warn" | "error" }
```

Hot-reload: SSE fires with new revision → host increments `reloadKey` on `AgentPluginPane` → iframe `src` changes to `?v=newRevision` → new iframe load → handshake repeats. No explicit `boring.bridge.reload` message needed — iframe navigation IS the reload.

All messages validated: `event.source === iframeRef.current.contentWindow`. Unknown types silently ignored.

### bridge-client vendor file (v2)

Written at provision time to `.boring/plugins/.boring-vendor/bridge-client.js`. Aliased via esbuild so agent imports `@boring/workspace/bridge-client` in front.tsx.

```ts
// @boring/workspace/bridge-client — what the agent uses in front.tsx
export function openPanel(panelId: string): void {
  window.parent.postMessage({ type: "boring.bridge.openPanel", panelId }, "*")
}
export function showNotification(message: string, level = "info"): void {
  window.parent.postMessage({ type: "boring.bridge.showNotification", message, level }, "*")
}
export function onInit(cb: (data: { theme: Record<string,string>, derivedFrom?: string }) => void): void {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "boring.bridge.init") cb(e.data)
  }, { once: true })
}
export function onReload(cb: () => void): void {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "boring.bridge.reload") cb()
  })
}
```

### Catalog route (v2)

```
GET /api/agent-plugins/:pluginId/catalog/search?q=<query>
→ delegates to the CatalogSearchHandler registered by plugin.server.ts
→ returns: { results: Array<{ id, title, description?, icon? }> }
```

### Dependencies in the iframe (v2)

- **React + react-dom**: provisioning seeds `.boring/plugins/package.json` → `npm install` → `.boring/plugins/node_modules/`
- **bridge-client**: provisioning writes `.boring/plugins/.boring-vendor/bridge-client.js` from source above

```json
// .boring/plugins/package.json (seeded by provisioning)
{
  "name": "boring-agent-plugins",
  "private": true,
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

---

## Manifest Schema

### `package.json["boring"]` — the only manifest

There is no separate manifest file. All plugin metadata lives in the `"boring"` field of `package.json`. Pi gets `"pi": { "extensions": [...] }`. Both fields point to the same factory file.

```ts
// Shape of package.json["boring"]
interface BoringPackageField {
  extensions: string[]       // entry points — mirrors pi's "pi.extensions" array; boring-ui uses [0]
  server?: string            // path to plugin.server.ts (boring-ui only; ignored by pi)
  label?: string
  description?: string
  derivesFrom?: string       // valid plugin id — Path A; hard failure if base not registered

  // Contribution declarations (optional in v1, authoritative in v2):
  panels?:          Array<{ id: string; title?: string }>
  commands?:        Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?:        Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?:Array<{ id: string; surfaceKind: string; panelId: string }>
  catalogs?:        Array<{ id: string; title?: string }>
}
```

Plugin `id` = directory name (e.g. `csv-viewer` from `.boring/plugins/csv-viewer/`).  
Plugin `version` = top-level `package.json["version"]`.

### Why contribution arrays exist

- **V1**: optional metadata. Factory is authoritative for registration. Arrays enable upfront cross-reference validation; Path A checking is performed **post-factory** on captured registrations.
- **V2**: authoritative. Browser registers panels/commands/tabs/resolvers from the manifest directly — the factory runs inside the iframe and has no access to host registries.

### Validation rules

- `command.panelId`, `leftTab.panelId`, `surfaceResolver.panelId` must reference an `id` in `panels[]`
- No duplicate `id` within each array
- `extensions[]` entries and `server` must pass `isSafePluginRelativePath`
- `derivesFrom` must pass `isValidBoringPluginId`; if present, the referenced outside plugin must be registered — absence is a hard load failure (not silent)
- Plugin id (directory name) must not collide with any registered outside plugin id
- `package.json` must have `"boring": { "extensions": [...] }` with at least one entry

### Error codes (all exported from `manifest.ts`, re-exported from `@boring/workspace/plugin`)

```
INVALID_ID | INVALID_VERSION | INVALID_PATH |
MISSING_REQUIRED_FIELD | UNKNOWN_FIELD | CROSS_REFERENCE | DUPLICATE_ID
```

---

## Path A — Derivation Behavior

### The fundamental contract: purely additive

A derived plugin **adds** new contributions on top of the base plugin. It never removes, replaces, or silences the base plugin's existing panels, commands, tabs, or tools. The base plugin continues to run independently and all its contributions remain active while the derived plugin is loaded.

The only exception is **surface resolvers** — they use last-registered-wins for a given `surfaceKind`. A derived plugin registering a resolver for `"csv.open"` shadows the base's resolver for that kind. On unload the previous resolver (base or another derived plugin) becomes active again.

### What `extensionContract.allowedContributions` gates

It is a **whitelist of contribution types** the derived plugin is permitted to add. If a type is not listed, any attempt to register that type causes the load to fail (error written + SSE fired, load rolled back).

```ts
// base plugin declares:
extensionContract: { allowedContributions: ["panel", "command", "agent-tool"] }

// derived plugin cannot register left-tabs or surface-resolvers
// attempting to do so → load fails with CROSS_REFERENCE error
```

The check happens:
- **V1**: post-factory on captured registrations (what the factory actually registered)
- **V2**: pre-registration on manifest contribution arrays (manifest is authoritative)

### What happens to base plugin contributions on derived load

| Base contribution | When derived loads | When derived unloads |
|---|---|---|
| Base panels | Still registered, still openable | Unchanged |
| Base commands | Still in command palette | Unchanged |
| Base left tabs | Still visible | Unchanged |
| Base surface resolvers | Active unless derived shadows same surfaceKind | Active again (stack pop) |
| Base agent tools | Still callable by agent | Unchanged |

The base plugin's front.tsx continues rendering. The base plugin is unaware of the derived plugin.

### Surface resolver shadowing — stack semantics

Resolvers for a given `surfaceKind` use a LIFO stack per kind (not a flat last-registered-wins):

```
base registers: surfaceKind="csv.open" → panelId="csv-base-panel"   (stack: [base])
derived-a loads: surfaceKind="csv.open" → panelId="csv-viewer-panel" (stack: [base, derived-a])
derived-b loads: surfaceKind="csv.open" → panelId="csv-detail-panel" (stack: [base, derived-a, derived-b])
active resolver: derived-b (top of stack)

derived-b unloads: (stack: [base, derived-a])
active resolver: derived-a

derived-a unloads: (stack: [base])
active resolver: base
```

The `unregisterByPluginId` call removes all resolvers tagged with that pluginId from the stack. The stack top becomes the new active resolver.

### Panel and command ID namespacing

Derived plugin contributions must use IDs that **do not collide** with base plugin contribution IDs. If the derived plugin's factory (v1) or manifest (v2) registers a panel with the same ID as a base plugin panel, the load fails with a `DUPLICATE_ID` error (the base plugin's panel is already in the registry).

Recommended convention: prefix with derived plugin id — `"csv-viewer-enhanced-panel"` not `"csv-viewer-panel"`.

### State and event access by mode

**V1 (host React tree):**
- Derived `front.tsx` runs in the same React tree as the base plugin
- Can import React context exported by the base plugin's package (if it exposes one)
- Can read/write shared Zustand stores exported by the base plugin
- Can subscribe to any event bus the base plugin exports
- This is intentional — V1 trusts the local agent

**V2 (iframe):**
- Derived plugin's `front.tsx` runs in a sandboxed iframe — no direct access to base plugin state
- `boring.bridge.init` sends `{ derivedFrom: "macro" }` so the iframe knows which base it extends
- No shared context or event subscription possible across iframe boundary in v2
- "Path A context queries" (`host.query()`) are out of scope — deferred as a v2 bridge extension

### Outside plugin registry

Outside plugins register at workspace init. The registry is maintained both browser-side and server-side:

```ts
export interface PluginExtensionContract {
  allowedContributions: ReadonlyArray<
    "panel" | "command" | "left-tab" | "surface-resolver" | "agent-tool"
  >
}
// At workspace init (both server and browser):
pluginRegistry.register({
  id: "macro",
  extensionContract: { allowedContributions: ["panel", "command", "agent-tool"] }
})
```

- **Browser registry**: `agentPluginRegistry.ts` Map — used by `registerAgentPlugin` for extensionContract check and by `unregisterByPluginId` for surface resolver stack management
- **Server registry**: `serverPluginRegistry.ts` Map — used before loading `plugin.server.ts` to gate `agent-tool` contributions
- `derivesFrom` referencing an unregistered plugin ID → hard load failure (error file + SSE), not a silent skip

---

## Error Surfacing

When plugin load fails (jiti error, bad import, validation failure):
- Server writes `.boring/plugins/<id>/.error` with the error message — agent reads it with normal file tools
- Server sends SSE `boring.plugin.error` — workspace UI shows a toast notification

On next successful load, `.error` is deleted.

---

## Doc Embedding — Two-Layer Approach

**Layer 1** — Docs seeded into workspace at provision time (`.boring/docs/`) so the agent reads them via normal file tools in all modes.

**Layer 2** — Static strings in `boringSystemPrompt.ts` for the Vercel serverless case. No codegen. `BORING_DOCS_PATH` env var overrides for local dev.

---

## Implementation TODO

### V1 first — then V2

Implement all shared infrastructure in V1. V2 only adds the three iframe-specific pieces (esbuild route, iframe render mode, postMessage bridge) and provisioning.

---

### A — Manifest: read `package.json["boring"]` instead of `boring.plugin.json` (both)
- [ ] Delete `boring.plugin.json` concept entirely — no separate manifest file
- [ ] `manifest.ts` reads and validates `package.json` (the whole file): extracts `version` from top-level, plugin id from directory name, contribution declarations from `boring` field
- [ ] `BoringPackageField` type: `extensions: string[]`, `server?`, `label?`, `description?`, `derivesFrom?`, `panels[]`, `commands[]`, `leftTabs[]`, `surfaceResolvers[]`, `catalogs[]`
- [ ] Remove `BoringPluginRuntime`, `BoringPluginPermissions`, `BoringPluginManifest` (old shape)
- [ ] Add `CROSS_REFERENCE` and `DUPLICATE_ID` error codes; drop `INVALID_GLOB` (was unused)
- [ ] Cross-reference validation: `*.panelId` must reference a `panels[].id`; no duplicate ids within arrays
- [ ] Validate `extensions[]` entries and `server` with `isSafePluginRelativePath`; validate `derivesFrom` with `isValidBoringPluginId`
- [ ] Validate `"boring": { "extensions": [...] }` has at least one entry — MISSING_REQUIRED_FIELD if absent
- [ ] Rewrite `manifest.test.ts`
- [ ] Remove old exports from `plugin.ts` and `index.ts`; export `BoringPackageField`

### B — Doc seeding + system prompt (both)
- [ ] Add `packages/workspace/docs/` with `plugins.md`, `panels.md`, `bridge.md`
- [ ] Static strings in `boringSystemPrompt.ts` — no codegen. `BORING_DOCS_PATH` overrides for dev.
- [ ] `plugins.md`: file layout, manifest schema, v1 vs v2 authoring paths, hot-reload, Path A

### C — Plugin watcher + SSE dispatch (both)
- [ ] `src/server/plugins/agentPluginWatcher.ts` — subscribe to `workspace.watch()`
- [ ] Filter: `event.path.startsWith('.boring/plugins/') && event.path.endsWith('/package.json')` — `package.json` is the commit signal; front.tsx/plugin.server.ts changes do not reload
- [ ] Extract pluginId from directory name segment (e.g. `csv-viewer` from `.boring/plugins/csv-viewer/package.json`)
- [ ] Serialize concurrent reloads per pluginId (no debounce needed — package.json write IS the signal)
- [ ] On `write`: read + validate `package.json["boring"]`; stage → commit model; on commit success dispatch SSE `boring.plugin.load { boring: pkg.boring, version: pkg.version, revision }`; on any failure write `.boring/plugins/<id>/.error` + SSE `boring.plugin.error { pluginId, revision }`
- [ ] On `unlink`: extract pluginId from path → unload server plugin → SSE `boring.plugin.unload { pluginId, revision }`
- [ ] On success: delete `.boring/plugins/<id>/.error` if present

### D — Server plugin loading: jiti + Path A registry + catalog route (both)
- [ ] `src/server/plugins/serverPluginRegistry.ts` — server-side Map of pluginId → extensionContract; inside plugin IDs checked for collision with outside plugin IDs
- [ ] `src/server/plugins/jitiPluginLoader.ts` — implements `ServerPluginLoader`; uses `createJiti(import.meta.url, { moduleCache: false })` (pi pattern); `BoringServerPluginAPI` includes `registerTool`, `registerCatalogHandler`, `registerDisposer(fn)` — disposers called before tools are removed on unload/reload; staging via temp Map, atomically swapped on commit
- [ ] `createWorkspaceServer` accepts `pluginLoader?: ServerPluginLoader`; defaults to `createJitiLoader()`
- [ ] `pluginRegistry.register({ id, extensionContract? })` called at workspace init for each outside plugin (before any inside plugin replay)
- [ ] `GET /api/agent-plugins/:pluginId/catalog/search?q=` — delegates to registered CatalogSearchHandler; in-flight requests complete before handler removal on unload
- [ ] Active plugin state map: `Map<pluginId, { manifest, revision }>` updated before SSE dispatch
- [ ] `GET /api/agent-plugins` reconnect endpoint — returns `Array<{ manifest, revision }>` for all currently-loaded plugins (implement alongside this task)

### E — `authoring.ts`: Rewrite `BoringPluginAPI` → `BoringExtensionAPI` (both)
- [ ] Replace `BoringPluginAPI` with `BoringExtensionAPI` — implements the pi methods boring-ui supports + optional boring-ui UI namespaces
- [ ] `registerTool(tool: ToolDefinition): void` — pi's verbatim TypeBox-based `ToolDefinition` shape:
  - `name`, `label`, `description`, `promptSnippet?`, `promptGuidelines?`, `parameters: TSchema`
  - `execute(toolCallId, params, signal, onUpdate, ctx) => Promise<{ content: [...], details?: unknown }>`
  - Import `ToolDefinition` from `@mariozechner/pi-coding-agent`; re-export from `@boring/workspace/plugin`
  - Plugin authors use `defineTool()` helper from pi for TypeBox schema
- [ ] `registerCommand(name: string, options: { description?: string; handler(args: string, ctx: unknown): Promise<void> }): void` — pi's slash command registration (NOT UI palette); boring-ui registers it as `/name` slash command handler
- [ ] `on(event: string, handler: (...args: unknown[]) => void): void` — `"load"` / `"unload"` wired; other events no-op with dev warning
- [ ] Stub remaining pi methods as no-ops with dev warning: `exec`, `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getActiveTools`, `setActiveTools`, `setModel`, `events`, `registerShortcut`, `registerFlag`, `registerProvider`, etc.
- [ ] Mark boring-ui UI namespaces optional: `panels?`, `leftTabs?`, `surfaceResolvers?`, `catalogs?`, `commands?` (commands here = panel-opening palette entries, distinct from pi's slash commands)
- [ ] Factory type: `export type BoringExtensionFactory = (api: BoringExtensionAPI) => void | Promise<void>`
- [ ] Update `createCapturingAPI()`: capture `registerTool` into `tools: ToolDefinition[]`; flush includes `tools`
- [ ] Keep `BoringPluginAPI` as deprecated alias
- [ ] Export `BoringExtensionAPI`, `BoringExtensionFactory`, `ToolDefinition` (re-export) from `@boring/workspace/plugin`

### F — Browser: SSE handler + `registerAgentPlugin` + `AgentPluginPane` direct mode (v1)
- [ ] Registries are **Zustand stores** (`usePanelStore`, `useCommandStore`, `useTabStore`, `useResolverStore`) — SSE updates go through `setState`, never direct Map mutation
- [ ] Resolver LIFO stack: each entry tagged `(pluginId, revision)`; on commit, pop all entries for pluginId before pushing new ones; `unregisterByPluginId` only removes entries matching that pluginId
- [ ] `src/front/plugins/agentPluginRegistry.ts` — browser-side Map of outside pluginId → extensionContract; `lastSeen: Map<pluginId, revision>`
- [ ] `src/front/plugins/registerAgentPlugin.ts` — `registerAgentPlugin(manifest, revision, mode)`:
  - `revision ≤ lastSeen[manifest.id]` → return (stale)
  - Snapshot current Zustand state for pluginId (for rollback)
  - mode="direct": `await import(url?v=revision)` → run factory → capture; Path A: check captured types vs extensionContract
  - mode="iframe": build registration set from manifest arrays; Path A: check manifest contribution types
  - Any failure → restore snapshot via `setState`, show toast, return
  - Commit: `usePanelStore.setState(...)` etc.; update resolver stack; register captured agent tools with harness
  - `lastSeen[manifest.id] = revision`
- [ ] `src/front/plugins/AgentPluginPane.tsx`:
  - mode="direct": use factory's exported component directly (no second lazy import); panel wrapper key includes revision to force remount
  - mode="iframe": `<iframe sandbox="allow-scripts">` (stubbed; wired in H)
  - When plugin missing from store: render "Plugin not loaded" placeholder
- [ ] Register `agent-plugin-frame` panel wrapper in `coreRegistrations.ts`
- [ ] SSE handler: `boring.plugin.load` → `registerAgentPlugin`; `boring.plugin.unload` → pop resolver stack + remove from stores; `boring.plugin.error` → show toast
- [ ] On browser connect: fetch `GET /api/agent-plugins` → register each if revision newer

### G — V2: esbuild route + iframe render mode (v2)
- [ ] `GET /api/agent-plugins/:pluginId/front.js` — esbuild on demand, `bundle:true jsx:'automatic' format:'iife'`, `nodePaths` + `alias` for bridge-client, `Cache-Control: no-store`
- [ ] `GET /api/agent-plugins/:pluginId/catalog/search?q=` — delegates to jiti-loaded handler
- [ ] Switch `AgentPluginPane` to `mode="iframe"` in hosted mode; send `boring.bridge.reload` to open iframe on hot-reload

### H — V2: postMessage bridge (v2)
- [ ] `src/front/plugins/agentPluginBridge.ts` — validate `event.source`, handle `openPanel` / `showNotification` / `reload`
- [ ] `src/front/plugins/agentPluginBridgeClient.ts` — `sendToHost(type, payload)`
- [ ] Theme tokens + `derivedFrom` in `boring.bridge.init`

### I — V2: provisioning React + bridge-client (v2)
- [ ] Add `nodeInstall` field to `RuntimeProvisioningContribution`
- [ ] Workspace base template seeds `.boring/plugins/package.json` with `{ react, react-dom }`
- [ ] Provisioning runs `npm install` in `.boring/plugins/`
- [ ] Provisioning writes pre-built `.boring/plugins/.boring-vendor/bridge-client.js`

### J — Plugin templates + docs (both)
- [ ] Update `packages/workspace/templates/plugin/` with v1 example (direct factory pattern)
- [ ] Add v2 example (iframe-compatible, no host hooks)
- [ ] Add `boring.plugin.json` example for both Path A and Path B
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/` location

---

## Out of Scope

- `binding` / `provider` / `slot-fill` in v2 — incompatible with iframe sandbox
- iframe `host.query()` for live data from base plugin — v2 bridge extension
- Path A context queries — after plugin registry and bridge are established
- Vite HMR for outside plugins — separate concern
