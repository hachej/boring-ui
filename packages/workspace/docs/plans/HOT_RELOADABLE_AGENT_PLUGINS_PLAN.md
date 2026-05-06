# Hot-Reloadable Agent Plugins Plan

Last updated: 2026-05-06
Status: **Phase 1 complete** — coordinator + manifest skeleton + authoring types + `@boring/workspace/plugin` subpath

---

## Goal

Let an agent write a plugin to `.boring/plugins/<name>/` and have it load live into a running workspace without a page refresh — contributing panels, commands, left tabs, surface resolvers, catalog search, and server-side agent tools.

---

## Two Plugin Tiers — One Interface

The existing `WorkspaceFrontPlugin` / `defineFrontPlugin` surface remains untouched for **outside plugins** (first-party, loaded at app startup, full surface, compiled with the app).

**Inside plugins** are agent-authored at runtime. They are defined by `BoringPluginManifest` — the manifest IS the plugin interface. The restriction lives in the manifest schema, not in a second TypeScript type.

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `boring.plugin.json` manifest |
| Loaded | At app startup | At runtime via file watcher |
| Full plugin surface | ✅ all PluginOutput types | Depends on mode (see below) |

### Two authoring paths for inside plugins

**Path A — Derive from an existing outside plugin**

The agent extends an existing outside plugin (e.g. macro, filesystem) by adding panels, commands, or server tools on top of it. The host plugin opts in by declaring `extensionContract: { allowedContributions: [...] }`. The manifest uses `derivesFrom: "<pluginId>"`.

Surface resolvers use **last-registered-wins**: a derived plugin registering a resolver for a given `surfaceKind` shadows the base plugin's resolver while loaded. On unload, the base resolver becomes active again automatically.

**Path B — Build from scratch**

Self-contained plugin with its own front + server code. No dependency on any existing plugin.

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
    boring.plugin.json    ← manifest
    front.tsx             ← React factory, imported by browser via Vite
    plugin.server.ts      ← server tools + catalog handlers, loaded via jiti
```

### V1 constraint: dev mode only

V1 requires the Vite dev server to be running. The Vite config must include:

```ts
server: { fs: { allow: [workspaceRoot] } }
```

This lets the browser import `/.boring/plugins/<id>/front.tsx` — Vite transforms it on the fly. V1 is **not intended for production builds** — use V2 (esbuild + iframe) for any deployed environment.

### Load flow (v1)

```
Agent writes .boring/plugins/csv-viewer/ files
  │
  ▼
workspace.watch() fires on boring.plugin.json (write/unlink)
  │
  ▼ (server)
Read + validate boring.plugin.json
Extract pluginId from path segment — must match manifest.id
Bump monotonic revision[pluginId]++
jiti.import(plugin.server.ts, { moduleCache: false }) → register server tools tagged pluginId
Delete .boring/plugins/<id>/.error if present
SSE → dispatchCommand("boring.plugin.load", { manifest, revision: rev })
  │
  ▼ (browser — SSE handler)
If revision ≤ lastSeenRevision[pluginId]: discard (stale event)
lastSeenRevision[pluginId] = revision
const { default: factory } = await import(
  `/.boring/plugins/${id}/front.tsx?v=${revision}`
)  ↑ Vite transforms TSX on the fly; ?v= busts module cache
registerAgentPlugin(manifest, registries, pluginRegistry, mode="direct"):
  unregisterByPluginId(pluginId)          ← removes panels, commands, tabs, resolvers, catalog
  factory(capturingAPI) → captured registrations
  If derivesFrom: validate captured contribution types against extensionContract
    (Path A check is post-factory in v1 — manifest arrays are not used for this)
  Apply captured registrations: panel, command, tab, resolver, catalog
AgentPluginPane mode="direct":
  React.lazy(() => import(`/.boring/plugins/${id}/front.tsx?v=${revision}`))
  Renders component directly in host React tree — no iframe
```

Hot-reload: watcher fires → revision bumped → jiti re-imports fresh module → SSE with new revision → browser discards if stale, otherwise re-imports via Vite with new `?v=` param → registries update → React reconciles.

Unload: `boring.plugin.json` deleted → jiti module discarded, server tools removed by pluginId → SSE `boring.plugin.unload` → browser `unregisterByPluginId` → any open panel shows "plugin not loaded" placeholder.

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
    boring.plugin.json
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

**Host → iframe:**
```ts
{ type: "boring.bridge.init",
  theme: Record<string, string>,    // CSS custom property values
  derivedFrom?: string }            // base plugin id if Path A

{ type: "boring.bridge.reload" }    // iframe should expect src to change
```

**Iframe → host:**
```ts
{ type: "boring.bridge.openPanel",
  panelId: string }                 // host calls openPanel(panelId)

{ type: "boring.bridge.showNotification",
  message: string,
  level: "info" | "warn" | "error" }

{ type: "boring.bridge.ready" }     // iframe finished rendering, host can hide loader
```

All messages validated: `event.source === iframeRef.current.contentWindow`. Unknown message types are silently ignored.

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

### Shape

```ts
interface BoringPluginManifest {
  manifestVersion?: 1        // always 1 for now; future versions gate new fields
  id: string                 // kebab-case, 2–64 chars; globally unique (cannot collide with outside plugins)
  version: string            // semver
  label?: string
  description?: string
  front?: string             // safe relative path to front.tsx (default: "front.tsx")
  server?: string            // safe relative path to plugin.server.ts
  derivesFrom?: string       // valid plugin id — triggers Path A validation; fails if base not registered

  // Contribution declarations (optional in v1, authoritative in v2)
  panels?: Array<{ id: string; title?: string }>
  commands?: Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?: Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  catalogs?: Array<{ id: string; title?: string }>
}
```

### Why contribution arrays exist

- **V1**: optional metadata. Factory is authoritative for registration. Arrays enable upfront cross-reference validation and Path A checking is performed **post-factory** on captured registrations (not on manifest arrays — so the factory cannot bypass the extensionContract check by omitting a panel from the manifest).
- **V2**: authoritative. Browser registers panels/commands/tabs/resolvers from the manifest directly — the factory runs inside the iframe and has no access to host registries.

### Validation rules

- `command.panelId` and `leftTab.panelId` and `surfaceResolver.panelId` must reference an `id` in `panels[]`
- No duplicate `id` within each array
- `front` and `server` must pass `isSafePluginRelativePath`
- `derivesFrom` must pass `isValidBoringPluginId`; if present, the referenced outside plugin must be registered — absence is a hard load failure (not silent)
- Plugin `id` must not collide with any registered outside plugin id
- Directory name segment must match `manifest.id` (enforced at load time, not in schema)

### Error codes (all exported from `manifest.ts`, re-exported from `@boring/workspace/plugin`)

```
INVALID_ID | INVALID_VERSION | INVALID_PATH | INVALID_GLOB |
MISSING_REQUIRED_FIELD | UNKNOWN_FIELD | CROSS_REFERENCE | DUPLICATE_ID
```

(`INVALID_ENTRY_PATH` → renamed `INVALID_PATH`. `runtime` + `permissions` + `entry` fields removed.)

---

## Path A — Outside Plugin Registry (both modes)

Outside plugins need a runtime registry keyed by plugin ID so the browser can resolve `derivesFrom` and check `extensionContract`. Server-side registry for `agent-tool` validation before `plugin.server.ts` loads.

```ts
export interface PluginExtensionContract {
  allowedContributions: ReadonlyArray<
    "panel" | "command" | "left-tab" | "surface-resolver" | "agent-tool"
  >
}
// Registered at workspace init:
pluginRegistry.register({ id: "macro", extensionContract: { allowedContributions: ["panel", "command", "agent-tool"] } })
```

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

### A — Manifest redesign `manifest.ts` (both)
- [ ] Replace `BoringPluginRuntime`, `BoringPluginPermissions` with new contribution declaration types
- [ ] Add `front?`, `server?`, `derivesFrom?`, `panels[]`, `commands[]`, `leftTabs[]`, `surfaceResolvers[]`, `catalogs[]`
- [ ] Remove `runtime`, `permissions`, `entry`
- [ ] Add `CROSS_REFERENCE` and `DUPLICATE_ID` error codes; rename `INVALID_ENTRY_PATH` → `INVALID_PATH`
- [ ] Cross-reference validation: `*.panelId` must reference a `panels[].id`; no duplicate ids within arrays
- [ ] Validate `front` and `server` with `isSafePluginRelativePath`; validate `derivesFrom` with `isValidBoringPluginId`
- [ ] Update `KNOWN_FIELDS` + all validation branches
- [ ] Rewrite `manifest.test.ts`
- [ ] Remove `BoringPluginRuntime` / `BoringPluginPermissions` exports from `plugin.ts` and `index.ts`

### B — Doc seeding + system prompt (both)
- [ ] Add `packages/workspace/docs/` with `plugins.md`, `panels.md`, `bridge.md`
- [ ] Static strings in `boringSystemPrompt.ts` — no codegen. `BORING_DOCS_PATH` overrides for dev.
- [ ] `plugins.md`: file layout, manifest schema, v1 vs v2 authoring paths, hot-reload, Path A

### C — Plugin watcher + SSE dispatch (both)
- [ ] `src/server/plugins/agentPluginWatcher.ts` — subscribe to `workspace.watch()`
- [ ] Filter: `event.path.startsWith('.boring/plugins/') && event.path.endsWith('boring.plugin.json')`
- [ ] Enforce: directory name segment must match `manifest.id`
- [ ] Debounce 50ms per pluginId; serialize concurrent reloads per pluginId
- [ ] On `write`: validate manifest → load server plugin → dispatch SSE `boring.plugin.load { manifest }`
- [ ] On `unlink`: extract pluginId from path → unload server plugin → dispatch SSE `boring.plugin.unload { pluginId }`
- [ ] On load failure: write `.boring/plugins/<id>/.error` + dispatch SSE `boring.plugin.error`
- [ ] On success: delete `.error` if present

### D — Server plugin loading: jiti + Path A registry + catalog route (both)
- [ ] `src/server/plugins/serverPluginRegistry.ts` — server-side Map of pluginId → extensionContract; inside plugin ids checked for collision with registered outside plugin ids
- [ ] `src/server/plugins/jitiPluginLoader.ts` — `loadServerPlugin(pluginId, serverPath, api)` via jiti `{ moduleCache: false }`; all registered tools + catalog handlers tagged by pluginId; `unloadServerPlugin(pluginId)` removes all atomically
- [ ] `createWorkspaceServer` accepts `pluginLoader?: ServerPluginLoader`; defaults to `createJitiLoader()`; core injects alternative
- [ ] `pluginRegistry.register({ id, extensionContract? })` called at workspace init for each outside plugin
- [ ] `GET /api/agent-plugins/:pluginId/catalog/search?q=` — delegates to CatalogSearchHandler registered by plugin.server.ts; route exists in both v1 and v2
- [ ] Active plugin state map: `Map<pluginId, { manifest, revision }>` — drives the reconnect endpoint

### F — `GET /api/agent-plugins` reconnect endpoint (both) — implement alongside D
- [ ] Returns `Array<{ manifest, revision }>` for all currently-loaded plugins
- [ ] Browser fetches on connect/reconnect → calls `registerAgentPlugin` for each with its revision

### E — Browser: SSE handler + `registerAgentPlugin` + `AgentPluginPane` direct mode (v1)
- [ ] `src/front/plugins/agentPluginRegistry.ts` — browser-side Map of pluginId → extensionContract; revision tracking Map: `Map<pluginId, number>`
- [ ] `src/front/plugins/registerAgentPlugin.ts` — `registerAgentPlugin(manifest, registries, pluginRegistry, mode, revision)`:
  - If `revision ≤ lastSeen[pluginId]`: return early (stale)
  - `lastSeen[pluginId] = revision`
  - `unregisterByPluginId(pluginId)` — removes panels, commands, tabs, resolvers, catalog, cleans lazy refs
  - mode="direct": `await import(url?v=revision)` → run factory → Path A check on captured registrations
  - mode="iframe": register from manifest arrays directly; Path A check on manifest contribution types
- [ ] `src/front/plugins/AgentPluginPane.tsx`:
  - mode="direct": `React.lazy(() => import(url))` in host tree
  - mode="iframe": `<iframe sandbox="allow-scripts">` (stubbed for now, wired in G)
  - On unload (plugin removed from registry): render "Plugin not loaded" placeholder instead of crashing
- [ ] Register `agent-plugin-frame` panel wrapper in `coreRegistrations.ts`
- [ ] Wire SSE handler: `boring.plugin.load` → `registerAgentPlugin`; `boring.plugin.unload` → `unregisterByPluginId`; `boring.plugin.error` → show toast
- [ ] On browser connect: fetch `GET /api/agent-plugins` → `registerAgentPlugin` for each

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
