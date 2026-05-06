# Hot-Reloadable Agent Plugins Plan

Last updated: 2026-05-06
Status: **Phase 1 complete** — coordinator + manifest skeleton + authoring types + `@boring/workspace/plugin` subpath

---

## Goal

Let an agent write a plugin to `.boring/plugins/<name>/` and have it load live into a running workspace without a page refresh — contributing panels (iframe), commands, left tabs, surface resolvers, catalog search, and server-side agent tools.

---

## Two Plugin Tiers — One Interface

No parallel type system. The existing `WorkspaceFrontPlugin` / `defineFrontPlugin` surface remains untouched for first-party (outside) plugins. Agent-authored (inside) plugins are defined entirely by `BoringPluginManifest` — the manifest IS the restricted plugin interface. The restriction lives in the manifest schema, not in a second TypeScript type.

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `boring.plugin.json` manifest |
| UI | Direct React in host process | iframe (sandboxed) |
| Server code | `defineServerPlugin` | `plugin.server.ts` via jiti |
| Loaded | At app startup | At runtime via `exec_ui` trigger |
| Full plugin surface | ✅ all PluginOutput types | Restricted (see below) |

### Two authoring paths for inside plugins

**Path A — Derive from an existing outside plugin**

The agent extends an existing outside plugin (e.g. macro, filesystem) by adding panels, commands, or server tools on top of it. The host plugin declares what it allows via a `PluginExtensionContract` — a typed allowlist on the outside plugin definition. The manifest uses `derivesFrom: "<pluginId>"`. At load time the browser validates the base plugin has a contract and that all contributions are in `allowedContributions`. The iframe is told which plugin it derives from via `boring.bridge.init { derivedFrom }`.

Key design points:
- `extensionContract` is opt-in on outside plugins. A plugin that does not declare one cannot be derived.
- `allowedContributions` is an explicit allowlist: `["panel", "command", "left-tab", "surface-resolver", "agent-tool"]`. Contributions outside the list are rejected at load time.
- Derived contributions are registered under the derived plugin's namespace, not the base plugin's.
- Context data queries (iframe asks host for base plugin state) are v2. For v1 the iframe only knows `derivedFrom`.

```ts
// Outside plugin definition (host side)
export interface PluginExtensionContract {
  allowedContributions: ReadonlyArray<
    "panel" | "command" | "left-tab" | "surface-resolver" | "agent-tool"
  >
}

// Added to WorkspaceFrontPlugin / defineFrontPlugin options:
extensionContract?: PluginExtensionContract
```

```json
// Agent manifest: .boring/plugins/macro-csv-exporter/boring.plugin.json
{
  "id": "macro-csv-exporter",
  "version": "1.0.0",
  "derivesFrom": "macro",
  "front": "front.tsx",
  "panels": [{ "id": "csv-export-panel", "label": "Export to CSV" }],
  "commands": [{ "id": "export-csv", "label": "Export Macro to CSV", "panelId": "csv-export-panel" }]
}
```

Load flow for derived plugin: manifest `derivesFrom` → browser looks up base plugin in registry → checks `extensionContract` exists → validates all contributions are in `allowedContributions` → registers contributions normally → iframe gets `boring.bridge.init { derivedFrom: "macro" }`.

**Path B — Build from scratch**

The agent writes a self-contained plugin with its own `front.tsx` + `plugin.server.ts`. No dependency on any existing plugin. The manifest declares all contributions. Useful for net-new tools (CSV viewer, SQL runner, custom dashboard).

---

## Inside Plugin: File Layout

```
.boring/plugins/
  csv-viewer/
    boring.plugin.json    ← manifest (single source of truth for contributions)
    front.tsx             ← iframe UI (React, compiled by esbuild on demand)
    plugin.server.ts      ← tools + catalog search handler (loaded by jiti)
```

---

## Inside Plugin: Contribution Surface

| Output type | Supported | Mechanism |
|---|---|---|
| `panel` | ✅ | iframe served from `/api/agent-plugins/:id/front.js` |
| `left-tab` | ✅ | manifest → host registers wrapper tab opening the panel |
| `command` | ✅ | manifest → host registers command palette entry |
| `surface-resolver` | ✅ | manifest → host registers resolver pointing to the panel |
| `catalog` | ✅ | manifest + server route — host registers thin adapter calling `/api/agent-plugins/:id/catalog/search` |
| `agent-tool` | ✅ | `plugin.server.ts` loaded via jiti, tools registered into Fastify tool registry |
| `binding` | ❌ | headless hook runner requires host React tree — incompatible with sandbox |
| `provider` | ❌ | wraps entire app React tree — only filesystem plugin uses this for HTTP client setup; not a general pattern |
| `slot-fill` | ❌ deferred | no production usage yet |

---

## Manifest: The Inside Plugin Contract

`BoringPluginManifest` declares all contributions directly. No factory, no code execution on the host side.

Path B (scratch) — all fields:
```json
{
  "id": "csv-viewer",
  "version": "1.0.0",
  "label": "CSV Viewer",
  "front": "front.tsx",
  "server": "plugin.server.ts",
  "panels": [
    { "id": "csv-panel", "label": "CSV Viewer" }
  ],
  "leftTabs": [
    { "id": "csv-tab", "title": "CSV", "panelId": "csv-panel", "icon": "table" }
  ],
  "commands": [
    { "id": "open-csv", "label": "Open CSV Viewer", "panelId": "csv-panel" }
  ],
  "surfaceResolvers": [
    { "kind": "file.csv", "panelId": "csv-panel" }
  ],
  "catalogs": [
    { "id": "csv-rows", "label": "CSV Rows" }
  ]
}
```

Path A (derive) — adds `derivesFrom`, omits fields not in contract:
```json
{
  "id": "macro-csv-exporter",
  "version": "1.0.0",
  "label": "CSV Exporter",
  "derivesFrom": "macro",
  "front": "front.tsx",
  "server": "plugin.server.ts",
  "panels": [{ "id": "csv-export-panel", "label": "Export to CSV" }],
  "commands": [{ "id": "export-csv", "label": "Export Macro to CSV", "panelId": "csv-export-panel" }]
}
```

Permissions are implicit from declarations. No `runtime` field — implicit from `front` / `server` presence.

---

## Load Flow

```
Pi writes .boring/plugins/csv-viewer/ files
  │
  ▼
Pi calls exec_ui { kind: "boring.plugin.load", params: { pluginId: "csv-viewer" } }
  │
  ▼ (server)
Read + validate boring.plugin.json via workspace.readFile()   ← Vercel-safe
Load plugin.server.ts via jiti (moduleCache: false)           ← Pi's pattern
Register agent tools into Fastify tool registry
Register catalog search handler at /api/agent-plugins/:id/catalog/search
  │
  ▼ (SSE → browser)
dispatchCommand "boring.plugin.load" { manifest }
  │
  ▼ (browser)
Register wrapper panel "agent-plugin-frame" with params { pluginId }
Register wrapper commands from manifest.commands[]
Register wrapper surface resolvers from manifest.surfaceResolvers[]
Register catalog adapters from manifest.catalogs[]
Register left tabs from manifest.leftTabs[]
  │
  ▼ (user opens panel)
<AgentPluginPane pluginId="csv-viewer" />
  → <iframe src="/api/agent-plugins/csv-viewer/front.js?v=timestamp" sandbox="allow-scripts" />
  → esbuild compiles front.tsx on demand via workspace.readFile() (Vercel-safe)
  → iframe ↔ host via postMessage bridge
```

Unload: `exec_ui { kind: "boring.plugin.unload", params: { pluginId } }` → jiti module discarded, all registry entries removed via `unregisterByPluginId`.

---

## Doc Embedding — Two-Layer Approach

**Layer 1 — Pi reads docs from its workspace (all runtime modes)**

Boring-ui docs (`plugins.md`, `panels.md`, `bridge.md`) are seeded into every workspace during provision at `.boring/docs/`. Pi reads them via normal file tools. Works in local, bwrap, and Vercel sandbox modes because the provision step seeds them into whatever filesystem pi operates on.

**Layer 2 — Build-time embed for `buildBoringSystemPrompt()` (Vercel serverless)**

The Fastify server runs in Vercel as a serverless function with no filesystem access to docs. A pre-build codegen step reads the `.md` files and emits `src/server/embeddedDocs.ts` with string constants. `buildBoringSystemPrompt()` uses these embedded strings. `BORING_DOCS_PATH` env var overrides for local dev.

---

## jiti Loader — Copy Pi's Pattern

```ts
import { createJiti } from "@mariozechner/jiti"

async function loadServerPlugin(resolvedPath: string) {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: {
      "@boring/workspace/plugin": resolveWorkspacePluginEntry(),
    },
  })
  const mod = await jiti.import(resolvedPath, { default: true })
  return typeof mod === "function" ? mod : null
}
```

`moduleCache: false` means calling `loadServerPlugin` again on the same path always gets the fresh module — no manual cache busting needed. This is exactly how pi reloads extensions.

---

## Generic Iframe Panel

One panel registered at workspace startup in `coreRegistrations.ts`:

```ts
{ id: "agent-plugin-frame", title: "", placement: "center", component: AgentPluginPane }
```

`AgentPluginPane` receives `pluginId` from panel params and renders:

```tsx
<iframe
  src={`/api/agent-plugins/${pluginId}/front.js?v=${timestamp}`}
  sandbox="allow-scripts"
/>
```

No dynamic panel registration at runtime. Commands/left-tabs from the manifest open `agent-plugin-frame` with `{ pluginId }` as params.

---

## postMessage Bridge (Minimal v1)

Host → iframe: `{ type: "boring.bridge.init", theme: {...} }`  
Iframe → host: `{ type: "boring.bridge.openPanel", panelId: string }`  
Iframe → host: `{ type: "boring.bridge.showNotification", message: string, level: "info"|"error" }`  

Host validates origin before dispatching. v2 adds `host.query()` for data access.

---

## What Existing Phase 1 Code Is Still Used

| File | Still relevant? | Role |
|---|---|---|
| `manifest.ts` | ✅ yes, needs expansion | Add declarative contribution fields |
| `authoring.ts` + `BoringPluginAPI` | ✅ yes | Tier 1 outside plugins / trusted hot-reload (future) |
| `coordinator.ts` + `PluginCoordinator` | ✅ yes | Tier 1 outside plugins / trusted hot-reload (future) |
| `@boring/workspace/plugin` subpath | ✅ yes | Still the public authoring surface export |

---

## Implementation TODO

### A — Manifest redesign `manifest.ts`
- [ ] Add `front?`, `server?`, `panels[]`, `leftTabs[]`, `commands[]`, `surfaceResolvers[]`, `catalogs[]` fields to `BoringPluginManifest`
- [ ] Remove `runtime`, `permissions`, `entry` (replaced by `front`/`server` presence)
- [ ] Update `validateBoringPluginManifest` — validate each array entry's required fields + path safety on `front`/`server`
- [ ] Update `KNOWN_FIELDS` + all validation branches
- [ ] Rewrite `manifest.test.ts` to cover new shape

### B — Doc seeding + system prompt embedding
- [ ] Add `packages/workspace/templates/workspace-base/.boring/docs/` with `plugins.md`, `panels.md`, `bridge.md`
- [ ] Pre-build codegen `scripts/embed-docs.mjs` → emits `src/server/embeddedDocs.ts`; run before tsup in `package.json` build script
- [ ] Update `boringSystemPrompt.ts`: use embedded strings as primary, `BORING_DOCS_PATH` as dev override
- [ ] Add `src/server/embeddedDocs.ts` to `.gitignore`, add empty stub for cold checkouts
- [ ] Rewrite `docs/plugins.md` to describe `.boring/plugins/` agent authoring path, two paths (derive vs scratch), exec_ui trigger

### C — Plugin file serving routes
- [ ] `src/server/plugins/agentPluginRoutes.ts`:
  - `GET /api/agent-plugins/:pluginId/manifest` — `workspace.readFile()` + validate, return JSON
  - `GET /api/agent-plugins/:pluginId/front.js` — `workspace.readFile()` front.tsx, esbuild-bundle with custom resolver plugin using `workspace.readFile()` for all relative imports, `Cache-Control: no-store`
  - `GET /api/agent-plugins/:pluginId/catalog/search?q=` — delegates to registered catalog handler from jiti-loaded server plugin
- [ ] Register routes in `src/server/index.ts`
- [ ] Add `esbuild` as server dependency to `packages/workspace/package.json`

### D — jiti server loader
- [ ] `src/server/plugins/jitiPluginLoader.ts` — copy pi's `loadExtensionModule` pattern, alias `@boring/workspace/plugin`
- [ ] `BoringServerPluginAPI` interface: `tools.register(tool)`, `catalogs.register({ id, search })`
- [ ] On load: call factory with server API, collect tools + catalog handlers
- [ ] Register tools into Fastify agent tool registry
- [ ] Register catalog search handlers (called by the catalog route in C)
- [ ] On unload: remove tools + catalog handlers, jiti discards module via `moduleCache: false`

### E — exec_ui trigger
- [ ] Add `"boring.plugin.load"` and `"boring.plugin.unload"` to `CommandKind` in `src/front/bridge/client.ts`
- [ ] Server-side exec_ui handler: validate manifest → jiti load → SSE manifest payload to browser
- [ ] Browser `dispatchCommand` cases: call `registerAgentPlugin(manifest)` / `unregisterAgentPlugin(pluginId)`

### F — Browser registration + generic iframe panel
- [ ] `src/front/plugins/agentPluginRegistry.ts`:
  - `registerAgentPlugin(manifest, registries)` — registers wrapper panel, commands, left-tabs, surface resolvers, catalog adapters from manifest
  - `unregisterAgentPlugin(pluginId, registries)` — calls `unregisterByPluginId` on all registries
- [ ] `src/front/plugins/AgentPluginPane.tsx` — iframe component, timestamp cache-bust on mount
- [ ] Register `agent-plugin-frame` in `coreRegistrations.ts`
- [ ] Wire `registerAgentPlugin` into `WorkspaceProvider` bridge dispatch

### G — postMessage bridge (minimal)
- [ ] `src/front/plugins/agentPluginBridge.ts` — host-side listener: `boring.bridge.openPanel`, `boring.bridge.showNotification`
- [ ] `src/front/plugins/agentPluginBridgeClient.ts` (bundled into iframe via esbuild) — `sendToHost(type, payload)`
- [ ] Theme tokens passed in `boring.bridge.init` message on iframe load

### H — Plugin template + invariant scanner
- [ ] Update `packages/workspace/templates/plugin/` to show both paths (derive + scratch)
- [ ] Add `boring.plugin.json` example to template
- [ ] Update `check-plugin-invariants.mjs` to recognise `.boring/plugins/` as valid plugin location (not subject to layer rules)

### I — Path A: Extension contract + derivation

**Types** (`packages/workspace/src/shared/plugins/types.ts` or new `extension.ts`):
- [ ] Add `PluginExtensionContract` interface: `{ allowedContributions: ReadonlyArray<InsidePluginContributionKind> }`
- [ ] Add `InsidePluginContributionKind` type: `"panel" | "command" | "left-tab" | "surface-resolver" | "agent-tool"`
- [ ] Add `extensionContract?: PluginExtensionContract` to the `WorkspaceFrontPlugin` definition shape (or `defineFrontPlugin` options)

**Manifest** (`manifest.ts`):
- [ ] Add `derivesFrom?: string` field to `BoringPluginManifest`
- [ ] Add `"derivesFrom"` to `KNOWN_FIELDS`
- [ ] Validate: if present, must be a valid plugin id string (reuse `isValidBoringPluginId`)
- [ ] Add test cases: valid `derivesFrom`, invalid value, works alongside contributions

**Browser load path** (`agentPluginRegistry.ts`):
- [ ] When `manifest.derivesFrom` is set: look up base plugin in the `PanelRegistry` / plugin registry by id
- [ ] If base plugin has no `extensionContract`: throw `PluginDerivationError("plugin '${id}' does not expose an extensionContract")`
- [ ] For each contribution in manifest: check its kind is in `extensionContract.allowedContributions`, throw if not
- [ ] Pass `derivedFrom: manifest.derivesFrom` through to `AgentPluginPane` / `boring.bridge.init`

**Bridge** (`agentPluginBridge.ts`):
- [ ] `boring.bridge.init` payload type: add `derivedFrom?: string`
- [ ] Host sends `derivedFrom` in init message when plugin has `manifest.derivesFrom`

**Outside plugins** (`apps/boring-macro-v2` and other apps):
- [ ] Add `extensionContract` to macro plugin definition (example: `allowedContributions: ["panel", "command", "agent-tool"]`)
- [ ] Document in `docs/plugins.md` which plugins expose an extension contract

---

## Out of Scope (v1)

- `binding` — headless React hook runner, requires host process
- `provider` — app-tree context wrapper, only filesystem uses it for HTTP client setup
- `slot-fill` — no production usage yet
- iframe `host.query()` bridge for data access — v2
- Path A context queries (iframe requests live data from base plugin) — v2
- Vite HMR for outside plugins (jiti Tier 1 reload) — separate concern
