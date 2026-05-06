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

Surface resolvers use **last-registered-wins**: a derived plugin registering `kind: "series"` shadows the base plugin's resolver while loaded. On unload, the base resolver becomes active again automatically.

**Path B — Build from scratch**

Self-contained plugin with its own front + server code. No dependency on any existing plugin.

---

## V1 — Local Mode (full node process access)

### What v1 means

The agent runs locally. The workspace server runs locally. The plugin has full access to the Node.js process — `front.tsx` loads directly into the host React tree, `plugin.server.ts` loads into the Fastify process. No iframe, no sandbox, no esbuild compilation.

### File layout

```
.boring/plugins/
  csv-viewer/
    boring.plugin.json    ← manifest
    front.tsx             ← React component, loaded directly via jiti into host process
    plugin.server.ts      ← server tools + catalog handlers, loaded via jiti
```

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
| `provider` | ⚠️ possible but not recommended — only filesystem uses it |
| `slot-fill` | ✅ |

### Load flow (v1)

```
Agent writes .boring/plugins/csv-viewer/ files
  │
  ▼
workspace.watch() fires on boring.plugin.json (write/unlink)
  │
  ▼ (server — same process)
Read + validate boring.plugin.json
Extract pluginId from path segment — must match manifest.id
jiti.import(front.tsx, { moduleCache: false })     → React component factory
jiti.import(plugin.server.ts, { moduleCache: false }) → server plugin factory
Register contributions into all registries (panel, command, tab, resolver, catalog, tools)
  │
  ▼ (browser — same React tree)
Component renders directly — no iframe, no SSE dispatch needed for hot-reload
Panel swaps live via registry update → React reconciles
```

Hot-reload: watcher fires → jiti re-imports fresh module → registries update → React re-renders.  
Unload: `boring.plugin.json` deleted → jiti module discarded, all registry entries removed via `unregisterByPluginId`.

### What existing Phase 1 code handles v1

The `PluginCoordinator` from Phase 1 is the v1 hot-reload engine. It was designed for exactly this: load a plugin factory, register contributions, swap on reload with rollback on failure. **v1 reuses it directly.**

### Security (v1)

Plugin runs in the same Node.js process. This is intentional — local mode means the developer trusts their own agent. No sandbox needed. Same model as pi loading its own extensions.

---

## V2 — Hosted / Sandbox Mode (no direct node process access)

### What v2 means

The agent runs in a sandboxed environment (bwrap, Vercel). Plugin code cannot run in the host process. `front.tsx` is compiled to a JS bundle served to an iframe. `plugin.server.ts` loads via an injected `ServerPluginLoader` (the core decides isolation strategy). Contributions are restricted to what an iframe can express.

### File layout (same as v1)

```
.boring/plugins/
  csv-viewer/
    boring.plugin.json    ← manifest
    front.tsx             ← iframe UI (React, compiled by esbuild on demand)
    plugin.server.ts      ← tools + catalog handlers (loaded by injected ServerPluginLoader)
```

### Contribution surface (v2)

| Output type | Supported | Notes |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `command` | ✅ | manifest → host registers wrapper opening the panel |
| `left-tab` | ✅ | manifest → host registers wrapper tab |
| `surface-resolver` | ✅ | last-registered-wins, same as v1 |
| `catalog` | ✅ | server route → jiti-loaded handler |
| `agent-tool` | ✅ | `plugin.server.ts` via injected ServerPluginLoader |
| `binding` | ❌ | requires host React tree |
| `provider` | ❌ | wraps entire app tree, filesystem-only pattern |
| `slot-fill` | ❌ | deferred |

### Load flow (v2)

```
Agent writes .boring/plugins/csv-viewer/ files
  │
  ▼
workspace.watch() fires on boring.plugin.json
  │
  ▼ (server)
Read + validate manifest — enforce directory name == manifest.id
Debounce 50ms per pluginId, serialize concurrent reloads per pluginId
If derivesFrom: validate against server-side extension contract registry
If already loaded: unload old (remove tools, catalog handlers)
Load plugin.server.ts via injected ServerPluginLoader
Register tools into Fastify tool registry
Register catalog handler at /api/agent-plugins/:id/catalog/search
  │
  ▼ (SSE → browser)
dispatchCommand "boring.plugin.load" { manifest }
  │
  ▼ (browser)
registerAgentPlugin(manifest, registries, pluginRegistry):
  If derivesFrom: look up in pluginRegistry → validate extensionContract
  unregisterByPluginId(pluginId)          ← no-op on first load
  Register wrapper panel "agent-plugin-frame" with { pluginId }
  Register commands, left-tabs, surface-resolvers, catalog adapters
  Send boring.bridge.reload to any open iframe for this pluginId
  │
  ▼ (user opens panel)
<AgentPluginPane pluginId="csv-viewer" />
  → <iframe src="/api/agent-plugins/csv-viewer/front.js?v=timestamp" sandbox="allow-scripts" />
  → esbuild compiles front.tsx on demand, nodePaths from provisioned node_modules
  → iframe ↔ host via postMessage bridge
```

Unload: `boring.plugin.json` deleted → unload server plugin → SSE `boring.plugin.unload` → browser unregisters.

On browser connect/reconnect: fetch `GET /api/agent-plugins` → re-register all active manifests.

### Security boundary — core injects, workspace executes (v2)

The workspace exposes `ServerPluginLoader` interface. The core (app entry point) injects the implementation:

```ts
interface ServerPluginLoader {
  load(pluginId: string, path: string, api: BoringServerPluginAPI): Promise<void>
  unload(pluginId: string): Promise<void>
}
// Core injects: createJitiLoader() for local/bwrap (outer sandbox provides isolation)
// Future: createWorkerLoader() for stricter multi-tenant isolation
```

### Dependencies in the iframe (v2)

The workspace package's `node_modules` are bundled into the Vercel artifact — not available as files on disk. esbuild needs real files. Provisioning seeds dependencies into the workspace sandbox filesystem:

- **React + react-dom**: `nodeInstall` provisioning contribution seeds `.boring/plugins/package.json` and runs `npm install` → `.boring/plugins/node_modules/`
- **bridge-client**: provisioning writes pre-built `.boring/plugins/.boring-vendor/bridge-client.js` from workspace package source

esbuild config:
```ts
{ nodePaths: ['.boring/plugins/node_modules'], alias: { '@boring/workspace/bridge-client': '.boring/plugins/.boring-vendor/bridge-client.js' } }
```

### postMessage bridge (v2 minimal)

Host → iframe: `{ type: "boring.bridge.init", theme: {...}, derivedFrom?: string }`
Iframe → host: `{ type: "boring.bridge.openPanel", panelId: string }`
Iframe → host: `{ type: "boring.bridge.showNotification", message: string, level: "info"|"error" }`
Host → iframe: `{ type: "boring.bridge.reload" }` (on hot-reload)

Host validates `event.source === iframeRef.current.contentWindow` — NOT `event.origin` (sandboxed iframes have `null` origin).

---

## Path A — Outside Plugin Registry (both modes)

Outside plugins need a runtime registry keyed by plugin ID so the browser (v1) or server (v2) can resolve `derivesFrom` and check `extensionContract`:

```ts
export interface PluginExtensionContract {
  allowedContributions: ReadonlyArray<"panel" | "command" | "left-tab" | "surface-resolver" | "agent-tool">
}
// Registered at workspace init alongside panel/command registration:
pluginRegistry.register({ id: "macro", extensionContract: { allowedContributions: ["panel", "command", "agent-tool"] } })
```

Server-side: a parallel registry for `agent-tool` validation before `plugin.server.ts` loads.

---

## Doc Embedding — Two-Layer Approach

**Layer 1** — Docs seeded into workspace at provision time (`.boring/docs/`) so the agent reads them via normal file tools in all modes.

**Layer 2** — Static strings in `boringSystemPrompt.ts` for the Vercel serverless case. No codegen. `BORING_DOCS_PATH` env var overrides for local dev.

---

## What Existing Phase 1 Code Is Still Used

| File | Role |
|---|---|
| `manifest.ts` | Needs full redesign (new contribution fields) |
| `coordinator.ts` + `PluginCoordinator` | **v1 hot-reload engine** — reused directly |
| `authoring.ts` + `BoringPluginAPI` | v1 plugin factory API |
| `@boring/workspace/plugin` subpath | Still the public authoring surface |

---

## Implementation TODO

### V1 first — then V2

Implement v1 completely before touching v2. v1 is simpler (no iframe, no esbuild, no bridge), validates the manifest + watcher + coordinator loop end-to-end, and ships real value.

---

### A — Manifest redesign `manifest.ts` (both)
- [ ] Add `front?`, `server?`, `panels[]`, `leftTabs[]`, `commands[]`, `surfaceResolvers[]`, `catalogs[]`, `derivesFrom?` fields to `BoringPluginManifest`
- [ ] Remove `runtime`, `permissions`, `entry`
- [ ] Cross-reference validation: `command.panelId` and `leftTab.panelId` must reference a declared panel; no duplicate ids within arrays
- [ ] Validate `front` and `server` are safe relative paths
- [ ] Validate `derivesFrom` is a valid plugin id string
- [ ] Update `KNOWN_FIELDS` + all validation branches
- [ ] Rewrite `manifest.test.ts`

### B — Doc seeding + system prompt (both)
- [ ] Add `packages/workspace/templates/workspace-base/.boring/docs/` with `plugins.md`, `panels.md`, `bridge.md`
- [ ] Static strings in `boringSystemPrompt.ts` — no codegen. `BORING_DOCS_PATH` overrides for dev.
- [ ] Rewrite `docs/plugins.md`: v1 vs v2 authoring paths, file layout, available imports, hot-reload

### C — Plugin watcher (both)
- [ ] `src/server/plugins/agentPluginWatcher.ts` — subscribe to `workspace.watch()` (chokidar local, sandbox emitter Vercel)
- [ ] Filter: `event.path.startsWith('.boring/plugins/') && event.path.endsWith('boring.plugin.json')`
- [ ] Enforce: directory name segment must match `manifest.id`
- [ ] Debounce 50ms per pluginId; serialize concurrent reloads per pluginId
- [ ] On `write`: route to v1 or v2 load path depending on mode
- [ ] On `unlink`: extract pluginId from path → unload

### D — V1 load path (local)
- [ ] Reuse `PluginCoordinator` from Phase 1 — wire it to the watcher
- [ ] jiti loads `front.tsx` default export (React component factory) + `plugin.server.ts`
- [ ] Register contributions into panel/command/tab/resolver/catalog/tool registries
- [ ] On reload: coordinator handles unload-then-reload with rollback on failure
- [ ] Outside plugin registry: `pluginRegistry.register({ id, extensionContract? })` called at workspace init for each outside plugin

### E — V2 server plugin loader interface + jiti implementation (sandbox)
- [ ] `src/server/plugins/serverPluginLoader.ts` — `ServerPluginLoader` interface + `BoringServerPluginAPI`
- [ ] `src/server/plugins/jitiPluginLoader.ts` — `createJitiLoader()` copying pi's `loadExtensionModule` pattern
- [ ] `createWorkspaceServer` accepts `pluginLoader?: ServerPluginLoader`; defaults to `createJitiLoader()`
- [ ] Server-side extension contract registry: validate `derivesFrom` + `agent-tool` contributions before loading

### F — V2 browser registration + generic iframe panel (sandbox)
- [ ] `src/front/plugins/pluginRegistry.ts` — runtime Map of outside plugin id → extensionContract
- [ ] `src/front/plugins/agentPluginRegistry.ts` — `registerAgentPlugin` / `unregisterAgentPlugin`
- [ ] `src/front/plugins/AgentPluginPane.tsx` — iframe, timestamp cache-bust, exposes `reload()` via module-level Map
- [ ] Register `agent-plugin-frame` in `coreRegistrations.ts`
- [ ] On browser connect: `GET /api/agent-plugins` → register all active manifests

### G — V2 plugin file serving routes (sandbox)
- [ ] `GET /api/agent-plugins` — returns all active manifests (reconnect state sync)
- [ ] `GET /api/agent-plugins/:pluginId/front.js` — esbuild on demand, `bundle:true jsx:'automatic' format:'iife'`, `nodePaths` + `alias` for bridge-client, `Cache-Control: no-store`
- [ ] `GET /api/agent-plugins/:pluginId/catalog/search?q=` — delegates to jiti-loaded handler
- [ ] Register routes in `src/server/index.ts`; add `esbuild` to `package.json`

### H — V2 postMessage bridge (sandbox)
- [ ] `src/front/plugins/agentPluginBridge.ts` — validate `event.source`, handle `openPanel` / `showNotification` / `reload`
- [ ] `src/front/plugins/agentPluginBridgeClient.ts` — `sendToHost(type, payload)`
- [ ] Theme tokens + `derivedFrom` in `boring.bridge.init`

### I — V2 provisioning: React + bridge-client (sandbox)
- [ ] Add `nodeInstall` field to `RuntimeProvisioningContribution` in `packages/agent/src/server/workspace/provisionRuntime.ts`
- [ ] Workspace base template seeds `.boring/plugins/package.json` with `{ react, react-dom }`
- [ ] Provisioning runs `npm install` in `.boring/plugins/` → `.boring/plugins/node_modules/`
- [ ] Provisioning writes pre-built `.boring/plugins/.boring-vendor/bridge-client.js`

### J — Plugin template + docs (both)
- [ ] Update `packages/workspace/templates/plugin/` with v1 example (direct React component)
- [ ] Add v2 example (iframe-compatible, no host hooks)
- [ ] Add `boring.plugin.json` example for both Path A and Path B
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/` location

---

## Out of Scope

- `binding` / `provider` / `slot-fill` in v2 — incompatible with iframe sandbox
- iframe `host.query()` for live data from base plugin — v2 bridge extension
- Path A context queries — after plugin registry and bridge are established
- Vite HMR for outside plugins — separate concern
