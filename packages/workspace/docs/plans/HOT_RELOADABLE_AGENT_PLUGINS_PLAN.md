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
jiti.import(plugin.server.ts, { moduleCache: false }) → register server tools
SSE → dispatchCommand("boring.plugin.load", { manifest })
  │
  ▼ (browser — SSE handler)
const { default: factory } = await import(`/.boring/plugins/${id}/front.tsx`)
  ↑ Vite transforms TSX on the fly, component runs in host React tree
registerAgentPlugin(manifest, registries):
  unregisterByPluginId(pluginId)          ← no-op on first load
  factory(capturingAPI) → captured registrations
  If derivesFrom: check pluginRegistry → validate extensionContract
  Apply registrations: panel, command, tab, resolver, catalog
AgentPluginPane mode="direct":
  React.lazy(() => import(`/.boring/plugins/${id}/front.tsx`))
  Renders component directly in host React tree — no iframe
```

Hot-reload: watcher fires → jiti re-imports fresh module → SSE → browser re-imports via Vite (cache-busted with timestamp param) → registries update → React reconciles.

Unload: `boring.plugin.json` deleted → jiti module discarded, server tools removed → SSE `boring.plugin.unload` → browser calls `unregisterByPluginId`.

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

The agent runs in a sandboxed environment (bwrap, Vercel). Plugin code cannot run in the host process. `front.tsx` is compiled to a JS bundle served to an iframe. `plugin.server.ts` loads via an injected `ServerPluginLoader`. The SSE notification and `registerAgentPlugin` call are **identical to v1** — only `AgentPluginPane` switches to iframe mode.

### File layout (same as v1)

```
.boring/plugins/
  csv-viewer/
    boring.plugin.json
    front.tsx             ← compiled by esbuild on demand, served to iframe
    plugin.server.ts      ← loaded by injected ServerPluginLoader
```

### Load flow (v2) — delta from v1

```
... same watcher, same SSE dispatch, same registerAgentPlugin call ...
  │
  ▼ (AgentPluginPane mode="iframe")
<iframe src="/api/agent-plugins/csv-viewer/front.js?v=timestamp"
        sandbox="allow-scripts" />
esbuild compiles front.tsx on demand (nodePaths from provisioned node_modules)
iframe ↔ host via postMessage bridge
```

### Contribution surface (v2)

| Output type | Supported | Notes |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `command` | ✅ | manifest → host registers wrapper |
| `left-tab` | ✅ | manifest → host registers wrapper |
| `surface-resolver` | ✅ | last-registered-wins, same as v1 |
| `catalog` | ✅ | server route → jiti-loaded handler |
| `agent-tool` | ✅ | `plugin.server.ts` via injected ServerPluginLoader |
| `binding` | ❌ | requires host React tree |
| `provider` | ❌ | wraps entire app tree |
| `slot-fill` | ❌ | deferred |

### Security boundary — core injects, workspace executes (v2)

The workspace exposes `ServerPluginLoader` interface. The core (app entry point) injects the implementation:

```ts
interface ServerPluginLoader {
  load(pluginId: string, path: string, api: BoringServerPluginAPI): Promise<void>
  unload(pluginId: string): Promise<void>
}
// Core injects: createJitiLoader() for local/bwrap
// Future: createWorkerLoader() for stricter multi-tenant isolation
```

### postMessage bridge (v2)

Host → iframe: `{ type: "boring.bridge.init", theme: {...}, derivedFrom?: string }`
Iframe → host: `{ type: "boring.bridge.openPanel", panelId: string }`
Iframe → host: `{ type: "boring.bridge.showNotification", message: string, level: "info"|"error" }`
Host → iframe: `{ type: "boring.bridge.reload" }` (on hot-reload)

Host validates `event.source === iframeRef.current.contentWindow` — NOT `event.origin` (sandboxed iframes have `null` origin).

### Dependencies in the iframe (v2)

- **React + react-dom**: `nodeInstall` provisioning contribution seeds `.boring/plugins/package.json` and runs `npm install`
- **bridge-client**: provisioning writes pre-built `.boring/plugins/.boring-vendor/bridge-client.js`

```ts
// esbuild config
{ nodePaths: ['.boring/plugins/node_modules'],
  alias: { '@boring/workspace/bridge-client': '.boring/plugins/.boring-vendor/bridge-client.js' } }
```

---

## Manifest Schema

### Shape

```ts
interface BoringPluginManifest {
  id: string           // kebab-case, 2–64 chars
  version: string      // semver
  label?: string
  description?: string
  front?: string       // safe relative path to front.tsx (default: "front.tsx")
  server?: string      // safe relative path to plugin.server.ts
  derivesFrom?: string // valid plugin id — triggers Path A validation

  // Contribution declarations (optional in v1, authoritative in v2)
  panels?: Array<{ id: string; title?: string }>
  commands?: Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?: Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  catalogs?: Array<{ id: string; title?: string }>
}
```

### Why contribution arrays exist

- **V1**: optional metadata. Factory is authoritative for registration. Arrays enable upfront cross-reference validation (`command.panelId` must reference a declared panel) and Path A checking before the factory loads.
- **V2**: authoritative. Browser registers panels/commands/tabs/resolvers from the manifest directly — the factory runs inside the iframe and has no access to host registries.

### Validation rules

- `command.panelId` and `leftTab.panelId` and `surfaceResolver.panelId` must reference an `id` in `panels[]`
- No duplicate `id` within each array
- `front` and `server` must pass `isSafePluginRelativePath`
- `derivesFrom` must pass `isValidBoringPluginId`
- Directory name segment must match `manifest.id` (enforced at load time, not in schema)

### Error codes

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

### D — Server plugin loading: jiti + Path A registry (both)
- [ ] `src/server/plugins/serverPluginRegistry.ts` — server-side Map of pluginId → extensionContract (for `agent-tool` validation)
- [ ] `src/server/plugins/jitiPluginLoader.ts` — `loadServerPlugin(pluginId, serverPath)` via jiti `{ moduleCache: false }`, registers tools into Fastify tool registry and catalog handlers
- [ ] `createWorkspaceServer` accepts `pluginLoader?: ServerPluginLoader`; defaults to jiti in v1; core injects alternative in v2
- [ ] `pluginRegistry.register({ id, extensionContract? })` called at workspace init for each outside plugin

### E — Browser: SSE handler + `registerAgentPlugin` + `AgentPluginPane` direct mode (v1)
- [ ] `src/front/plugins/agentPluginRegistry.ts` — browser-side Map of pluginId → extensionContract (for Path A checks)
- [ ] `src/front/plugins/registerAgentPlugin.ts` — `registerAgentPlugin(manifest, registries, pluginRegistry)`:
  - If `derivesFrom`: lookup in pluginRegistry → validate extensionContract
  - `unregisterByPluginId(pluginId)` (no-op on first load)
  - `const { default: factory } = await import(url)` — url includes `?v=<timestamp>` for cache-bust
  - Run factory with capturing API → apply captured registrations
- [ ] `src/front/plugins/AgentPluginPane.tsx` — `mode="direct"`: `React.lazy(() => import(url))` renders component in host tree; `mode="iframe"`: renders `<iframe>` (stubbed for now, wired in V2)
- [ ] Register `agent-plugin-frame` panel wrapper in `coreRegistrations.ts`
- [ ] Wire SSE handler in workspace front entry: `boring.plugin.load` → `registerAgentPlugin`; `boring.plugin.unload` → `unregisterByPluginId`
- [ ] On browser connect: `GET /api/agent-plugins` → re-register all active manifests

### F — `GET /api/agent-plugins` reconnect endpoint (both)
- [ ] Returns all currently-loaded manifests as JSON
- [ ] Browser fetches this on connect/reconnect and calls `registerAgentPlugin` for each

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
