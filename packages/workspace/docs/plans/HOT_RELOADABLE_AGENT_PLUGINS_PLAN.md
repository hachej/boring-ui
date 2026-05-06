# Boring Plugins — Hot Reload

**Last updated:** 2026-05-06  
**Status:** Rewrite in progress — build on pi

---

## Core concept

**A boring plugin is a pi extension.** `front.tsx` is a valid pi `ExtensionFactory`. It is loaded by `boring-pi-extension.ts` with the **real pi api** extended with optional boring-ui UI methods. This means:

- `api.registerTool()` → pi's native tool registry (no adapter)
- `api.registerCommand()` → pi's native slash commands
- `api.registerPanel?()`, `api.registerLeftTab?()`, etc. → captured for SSE to browser

The same `front.tsx` factory runs in **two contexts**:
- **Node.js (pi/jiti):** tools and commands registered in pi's session; UI metadata captured for SSE
- **Browser (Vite/V1 or esbuild/V2):** UI contributions registered with React components

---

## Plugin tiers

| | Outside plugin | Inside plugin |
|---|---|---|
| Authored by | App developer | Agent at runtime |
| Defined via | `defineFrontPlugin` / `composePlugins` | `package.json` (`"boring"` + `"pi"` fields) + factory |
| Loaded | At app startup via `bootstrap()` | Via explicit reload (`/boring.reload` or `/reload`) + SSE |
| Migration required | No — stays declarative | N/A — new system |

**Outside plugins** keep their current shape. `bootstrap()` is unchanged.

**Inside plugins** are self-contained pi extensions that also register workspace UI. `PluginCoordinator` is deleted and replaced by `registerAgentPlugin` (inside plugins only).

---

## File layout

```
.boring/plugins/<name>/
  package.json          ← manifest: "boring" metadata + "pi" extension declaration
  front.tsx             ← pi ExtensionFactory + boring-ui UI extras (runs in Node.js AND browser)
  plugin.server.ts      ← OPTIONAL: Node.js-only tools (streams, native modules, child_process)
```

**`front.tsx` constraint:** Must not import CSS modules or use browser globals at module scope. React JSX works (jiti uses esbuild). Inline styles or CSS-in-JS only. Jiti loads this in Node.js — if it imports `./styles.module.css`, it crashes.

**`plugin.server.ts`:** Only for code that cannot run in a browser. Called by `boring-pi-extension.ts` with a restricted api (pi methods only — no `registerPanel?` etc.). Most plugins do not need this file.

---

## `package.json` shape

```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "entry":           "./front.tsx",
    "server":          "./plugin.server.ts",
    "label":           "CSV Viewer",
    "derivesFrom":     "macro",
    "panels":          [{ "id": "csv-panel",  "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv",   "title": "Open CSV Viewer", "panelId": "csv-panel" }],
    "leftTabs":        [{ "id": "csv-tab",    "title": "CSV",             "panelId": "csv-panel" }],
    "surfaceResolvers":[{ "id": "csv-open",   "surfaceKind": "csv.open",  "panelId": "csv-panel" }]
  },
  "pi": { "extensions": ["./front.tsx"] }
}
```

- `"boring"` — boring-ui manifest (discovery + UI metadata + commit signal trigger source)
- `"pi"` — pi discovery (same file; so standalone pi users can also load the plugin)
- Plugin `id` = directory name. `version` = top-level `"version"`.
- `"boring.panels[]"` etc. are **authoritative declarations** — used in V2 (manifest-only) and for validation in V1.

### `BoringPackageField` type

```ts
interface BoringPackageField {
  entry: string               // front factory entry e.g. "./front.tsx"
  server?: string             // optional Node.js-only entry
  label?: string
  description?: string
  derivesFrom?: string        // Path A — hard failure if base plugin not registered

  panels?:           Array<{ id: string; title?: string }>
  commands?:         Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?:         Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
}
```

### Validation rules

- `entry` required; passes `isSafePluginRelativePath` (no `..` escapes)
- `entry` must exist on disk → `MISSING_ENTRY_FILE` error
- `server` (if declared) must also exist on disk
- `command.panelId`, `leftTab.panelId`, `surfaceResolver.panelId` must reference a declared `panels[]` id
- No duplicate ids within each array
- `derivesFrom` must pass `isValidBoringPluginId`; missing base plugin = hard load failure
- Plugin id (directory name) must not collide with any registered outside plugin id
- Error codes (parse-time): `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | MISSING_ENTRY_FILE | CROSS_REFERENCE | DUPLICATE_ID`
- `MANIFEST_IMPL_MISMATCH` lives in `registerAgentPlugin` (V1 only, post-factory) — not in manifest parsing

---

## `BoringExtensionAPI`

Pi's `ExtensionAPI` extended with optional boring-ui UI methods. Optional chaining makes the factory safe when pi loads it without boring-ui extras.

```ts
interface BoringExtensionAPI extends ExtensionAPI {
  // ── Pi methods boring-ui implements fully ──────────────────────────────
  // registerTool, registerCommand, registerShortcut, on — real, go to pi native

  // ── Pi methods — no-op stubs (+ console.warn in dev) ──────────────────
  // registerTool(tool): no-op in capturing API; logs warning — tools registered
  // here in front.tsx ARE captured by pi, but boring-ui capturing ignores them
  // (use plugin.server.ts for boring-ui-specific server tools if needed)
  // All other pi surface (exec, sendMessage, appendEntry, setModel, etc.) — stubs

  // ── Boring-ui UI extras — absent in pi; optional chaining is safe ──────
  registerPanel?(reg: {
    id: string
    component: React.ComponentType<any>   // used browser-side only; ignored in Node.js
    label?: string
  }): void
  registerPanelCommand?(reg: { id: string; title: string; panelId: string; description?: string }): void
  registerLeftTab?(reg: { id: string; title: string; panelId: string; icon?: string }): void
  registerSurfaceResolver?(reg: { kind: string; resolve: (ctx: unknown) => { panelId: string } | null }): void
}
```

**Two capturing contexts:**
- **Node.js (boring-pi-extension.ts):** captures IDs and metadata only; `component` arg silently ignored (no component refs needed server-side)
- **Browser (registerAgentPlugin V1):** captures full registrations including React components for rendering

---

## Factory example

```ts
// front.tsx — valid pi ExtensionFactory; runs unchanged in pi or boring-ui
import { defineTool, Type }        from "@mariozechner/pi-coding-agent"
import type { BoringExtensionAPI } from "@boring/workspace/plugin"
import { CsvPane }                 from "./CsvPane"   // inline styles — no .css imports

export default function csvPlugin(api: BoringExtensionAPI): void {

  // Agent tool — goes to pi natively via the real api
  api.registerTool(defineTool({
    name: "search_csv",
    label: "Search CSV",
    description: "Full-text search over a CSV file",
    parameters: Type.Object({ q: Type.String() }),
    execute: async (_id, { q }) => ({ content: [{ type: "text", text: `results: ${q}` }] }),
  }))

  // Pi slash command — pi handles this natively
  api.registerCommand("csv.open", {
    description: "Open CSV viewer",
    handler: async () => { /* optionally call exec_ui via boring bridge */ },
  })

  // Boring-ui UI extras — optional chaining; ignored when pi loads this alone
  api.registerPanel?.({ id: "csv-panel", component: CsvPane, label: "CSV Viewer" })
  api.registerPanelCommand?.({ id: "open-csv", title: "Open CSV Viewer", panelId: "csv-panel" })
  api.registerLeftTab?.({ id: "csv-tab", title: "CSV", panelId: "csv-panel" })
  api.registerSurfaceResolver?.({ kind: "csv.open", resolve: () => ({ panelId: "csv-panel" }) })
}
```

---

## boring-pi-extension.ts — the plugin runner

Boring-ui's own pi extension, wired via `extensionFactories[]` in `DefaultResourceLoader`. On load/reload it:
1. Scans `.boring/plugins/*/package.json` for valid `"boring"` entries
2. For each plugin: jiti-loads `front.tsx`, calls factory with **real pi api + boring-ui extras**
3. Pi captures `registerTool` / `registerCommand` calls natively
4. Boring-ui capturing API captures UI registrations (IDs only — components ignored server-side)
5. Emits SSE `boring.plugin.load` per plugin
6. If `plugin.server.ts` declared: jiti-loads it, calls factory with **plain pi api** (no UI methods)

```ts
// boring-pi-extension.ts
export function createBoringPiExtension(opts: {
  pluginsDir: string
  emit: (event: BoringPluginEvent) => void
}): ExtensionFactory {
  return async (api) => {
    // boring-ui's own tools (exec_ui, open_panel)
    api.registerTool(defineTool({ name: "exec_ui", ... }))
    api.registerTool(defineTool({ name: "open_panel", ... }))

    const scan = () => loadBoringPlugins(api, opts)

    api.registerCommand("boring.reload", {
      description: "Reload boring-ui plugins from .boring/plugins/",
      handler: scan,
    })
    api.on("session_start", async (event) => {
      if (event.reason === "reload") await scan()
    })

    await scan()
  }
}

async function loadBoringPlugins(api: ExtensionAPI, opts: Opts): Promise<void> {
  const plugins = readBoringPluginsDir(opts.pluginsDir)   // validates package.json["boring"]
  const removed = findRemovedPlugins(plugins, loaded)
  for (const id of removed) {
    unloadPlugin(id)
    opts.emit({ type: "boring.plugin.unload", id, revision: ++revisions[id] })
  }

  for (const plugin of plugins) {
    try {
      // Load front.tsx — tools go to pi native; UI metadata captured by boringApi
      const boringApi = createBoringCapturingAPI(api)      // real pi api + boring-ui extras
      const frontFactory = jiti({ moduleCache: false }).import(plugin.frontPath)
      await frontFactory.default(boringApi)
      const uiRegistrations = boringApi.flush()            // { panels, commands, leftTabs, surfaceResolvers }

      // Optional: load plugin.server.ts with plain pi api (no UI methods)
      if (plugin.serverPath) {
        const serverFactory = jiti({ moduleCache: false }).import(plugin.serverPath)
        await serverFactory.default(api)                   // api.registerTool() → pi native
      }

      revisions[plugin.id] = (revisions[plugin.id] ?? 0) + 1
      loaded.set(plugin.id, plugin)
      clearErrorFile(plugin.id)

      opts.emit({
        type: "boring.plugin.load",
        id: plugin.id, version: plugin.version, revision: revisions[plugin.id],
        boring: { ...plugin.boring, ...uiRegistrations },
      })
    } catch (err) {
      writeErrorFile(plugin.id, String(err))
      opts.emit({ type: "boring.plugin.error", id: plugin.id, revision: revisions[plugin.id] ?? 0, message: String(err) })
    }
  }
}
```

**File-based mode** (standalone pi users): default export calling `fetch("$BORING_SERVER_URL/api/agent-plugins/reload", { method: "POST" })`.

---

## SSE event types

```ts
type BoringPluginEvent =
  | { type: "boring.plugin.load";   id: string; boring: BoringPackageField; version: string; revision: number }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error";  id: string; revision: number; message: string }
```

Multiplexed on the existing `/api/v1/fs/events` stream alongside `event: "change"` file events. Browser filters by event type.

---

## Agent workflow

```
1. write front.tsx              (no reload)
2. write package.json           (no reload — plain metadata)
3. if plugin.server.ts needed:
     write plugin.server.ts     (no reload)
4. if new npm deps needed:
     pnpm add <pkg>             (at workspace root; always Vite-resolvable)
5. /boring.reload               ← commit signal (boring-ui plugins only)
   OR /reload                   ← also reloads all pi extensions
```

**Why explicit reload:**
- No partial-write races — all files on disk before reload fires
- No chokidar/inotify infrastructure
- Reload fires between agent turns, never mid-message

---

## Atomicity model

### Server (boring-pi-extension.ts)

```
For each .boring/plugins/<name>/:
1. readBoringPackage(dir)                   → fail: .error file + SSE error (nothing else changes)
2. jiti.import(front.tsx) → factory(boringApi)
   jiti.import(plugin.server.ts) → factory(api)  (if declared)
   Any throw                                → .error file + SSE error (old pi tools still registered from prev session)
3. boringApi.flush() → UI registrations
4. revision[id]++
5. loaded.set(id, plugin)
6. delete .error if present
7. SSE boring.plugin.load { id, boring, version, revision }
```

Note: pi tools registered via `api.registerTool()` during the factory call go directly into the pi session's tool registry. There is no server-side rollback of pi tools — if the factory partially succeeds before throwing, those tool calls have already registered. Mitigation: keep factories idempotent and throw early on validation errors.

### Browser

```
SSE boring.plugin.load { id, boring, version, revision } received:
1. revision ≤ lastSeen[id]                  → discard stale
2. Snapshot current Zustand state for id    (rollback target)
3. V1: await import(`/.boring/plugins/${id}/${boring.entry}?v=${revision}`)
        → factory(createCapturingBoringExtensionAPI())
        → captured: { panels (with components), commands, leftTabs, surfaceResolvers }
   V2: read boring.panels[], boring.commands[], etc. from SSE payload (no dynamic import)
4. Path A: if boring.derivesFrom, check captured contribution types vs extensionContract
5. V1: MANIFEST_IMPL_MISMATCH check — every boring.panels[i].id must have a matching registerPanel?() call
6. Any failure                              → restore snapshot, toast, return
7. Commit: usePanelStore.setState, useCommandStore.setState, useTabStore.setState
           LIFO resolver stack: pop old entries for id, push new (id, revision)
8. lastSeen[id] = revision
```

Unload: pop resolver stack, remove from all Zustand stores, `lastSeen[id] = revision`. Slash commands are pi's concern — pi's extension runner handles cleanup on reload.

### Reconnect

Server updates `loaded` **before** dispatching SSE.

```
plugins = await fetch('/api/agent-plugins')   // → [{ id, boring, version, revision }]
for each { id, boring, version, revision }:
  if revision > lastSeen[id]:
    registerAgentPlugin(id, boring, version, revision, mode)
```

---

## V1 — Local Mode

`front.tsx` → Vite dev server imports it directly in browser. React component runs in host tree. No iframe, no esbuild.

Requires `vite.config.ts`: `server: { fs: { allow: [workspaceRoot] } }`

### Load flow

```
Agent → /boring.reload (or /reload)
  │
  ├─ (Node.js — boring-pi-extension.ts)
  │   readBoringPackage → validate
  │   jiti.import(front.tsx) → factory(boringApi)   ← tools to pi, UI metadata captured
  │   jiti.import(plugin.server.ts) → factory(api)  ← if declared; tools to pi
  │   revision[id]++; loaded.set(id)
  │   SSE boring.plugin.load { id, boring, version, revision }
  │
  └─ (Browser)
      revision ≤ lastSeen[id]                    → discard
      Snapshot Zustand state
      import(`/.boring/plugins/${id}/${boring.entry}?v=${revision}`)
      factory(capturingBoringExtensionAPI)        → captured panels+components, commands, ...
      MANIFEST_IMPL_MISMATCH check + Path A check
      Commit stores + resolver stack
      lastSeen[id] = revision
      AgentPluginPane key={id}:{revision} → React remounts on hot-reload
```

### Contribution surface (V1)

| Contribution | V1 |
|---|---|
| `panel` | ✅ React component in host tree |
| `panelCommand` | ✅ |
| `leftTab` | ✅ |
| `surfaceResolver` | ✅ |
| `agentTool` | ✅ via `api.registerTool()` → pi native (both front.tsx and plugin.server.ts) |
| `binding` | ❌ not in API surface; deferred |
| `provider` | ⚠️ possible but not recommended |
| `slotFill` | ✅ |

---

## V2 — Hosted / Sandbox Mode

The agent runs sandboxed. `front.tsx` is compiled to an IIFE bundle served to a sandboxed iframe. `plugin.server.ts` loads via jiti in the host Fastify process.

**Server side: identical to V1.** boring-pi-extension.ts scan + SSE.

**Browser side:** registers from manifest arrays only (no dynamic import). Component = `AgentPluginPane mode="iframe"`.

### `AgentPluginPane` iframe

```tsx
const url = `/api/agent-plugins/${id}/front.js?v=${revision}`
<iframe ref={iframeRef} src={url} sandbox="allow-scripts"
  style={{ border: "none", width: "100%", height: "100%" }} />
```

### postMessage bridge

```
iframe → boring.bridge.ready
host  → boring.bridge.init { theme, derivedFrom? }
iframe → boring.bridge.rendered
```

Bridge client (`@boring/workspace/bridge-client`, aliased by esbuild):
```ts
export function openPanel(panelId: string): void
export function showNotification(message: string, level?: string): void
export function onInit(cb: (data: { theme: Record<string, string>; derivedFrom?: string }) => void): void
```

### esbuild config

```ts
await esbuild.build({
  entryPoints: [frontPath], bundle: true, format: "iife",
  jsx: "automatic", jsxImportSource: "react", platform: "browser",
  nodePaths: [join(workspaceRoot, ".boring/plugins/node_modules")],
  alias: { "@boring/workspace/bridge-client": join(workspaceRoot, ".boring/plugins/.boring-vendor/bridge-client.js") },
  write: false, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
})
```

Cache keyed by `(id, front.tsx mtime)`. On esbuild error: `.error` file + SSE error. Serve last cached bundle or 500.

### Provisioning

Seeds at workspace init:
- `.boring/plugins/package.json` → `{ react, react-dom }` + `npm install`
- `.boring/plugins/.boring-vendor/bridge-client.js` from bridge-client source
- `.boring/docs/` with `plugins.md`, `panels.md`, `bridge.md`

**Root package guard:** `.boring/plugins/package.json` is the shared dependency root, NOT a plugin. Scanner only reads directories one level under `.boring/plugins/` — the root is never passed to `readBoringPackage`.

---

## Path A — Derivation

### Contract

Derived plugin is **purely additive** — adds contributions on top of base. Base plugin stays active and is unaware of the derived plugin.

Surface resolvers: LIFO stack per `surfaceKind`. Derived plugin shadows base while loaded; base becomes active again on unload.

### `extensionContract`

```ts
extensionContract: { allowedContributions: ["panel", "panelCommand", "leftTab", "surfaceResolver"] }
```

Agent tools (`registerTool`, `registerCommand`) are always allowed for derived plugins — they go through pi's extension mechanism and are not gateable at the boring-ui manifest level.

### Validation

- **V1:** post-factory, on captured registrations
- **V2:** pre-registration, on manifest arrays

### Surface resolver LIFO

```
bootstrap():  outside-a → [outside-a]   outside-b → [outside-a, outside-b]
active → outside-b

plugin load:  derived-a → [..., derived-a]   derived-b → [..., derived-b]
active → derived-b

derived-b unloads → [..., derived-a]   active → derived-a
derived-a unloads → [outside-a, outside-b]   active → outside-b
```

---

## Doc embedding

**Layer 1 — file-based** (all modes): `.boring/docs/plugins.md`, `panels.md`, `bridge.md` seeded by provisioning. Agent reads via normal `read` tool.

**Layer 2 — inline system prompt** (Vercel fallback): `boringSystemPrompt.ts` embeds same docs as static strings. `BORING_DOCS_PATH` env var overrides for local dev.

---

## Error surfacing

- `.boring/plugins/<id>/.error` — written on any failure; agent reads with `read` tool
- SSE `boring.plugin.error` → workspace toast
- `GET /api/agent-plugins/:id/error` → `.error` content as plain text; 404 if none

Cleared automatically on next successful load.

---

## Implementation TODOs

Implement V1 first (TODOs A–F). V2 adds three pieces: esbuild route, iframe render, provisioning.

---

### A — `manifest.ts`: `readBoringPackage`

- [ ] Remove old `BoringPluginManifest`, `BoringPluginRuntime`, `BoringPluginPermissions`
- [ ] `BoringPackageField` type (as above)
- [ ] `readBoringPackage(dir)` — reads `package.json`, extracts `id` (dir name), `version`, `boring` field
- [ ] Validation: entry required + exists on disk; server (if declared) exists; panelId cross-refs; no duplicate ids; derivesFrom valid id
- [ ] Error codes: `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | MISSING_ENTRY_FILE | CROSS_REFERENCE | DUPLICATE_ID`
- [ ] `MANIFEST_IMPL_MISMATCH` is a runtime check in `registerAgentPlugin` V1 only — not here
- [ ] Export `BoringPackageField` from `@boring/workspace/plugin` subpath
- [ ] Rewrite `manifest.test.ts`

---

### B — `boring-pi-extension.ts` + SSE types

**`packages/agent/src/server/boring-pi-extension.ts`:**

- [ ] `BoringPluginEvent` discriminated union (as above)
- [ ] `createBoringCapturingAPI(piApi: ExtensionAPI): BoringCapturingAPI` — wraps real pi api, adds boring-ui capturing methods; `flush()` returns `{ panels (IDs only), panelCommands, leftTabs, surfaceResolvers }`; `registerTool` is a no-op in capturing (pi already has it via the real api)
- [ ] `readBoringPluginsDir(pluginsDir)` — scans `<pluginsDir>/*/package.json`, calls `readBoringPackage`, collects valid entries
- [ ] `loadBoringPlugins(api, { pluginsDir, emit, revisions, loaded })`:
  - Detect removed plugins (in `loaded` but not in scan) → unload → SSE unload
  - For each plugin: jiti (moduleCache: false) loads `front.tsx` → `factory(boringCapturingApi)` → flush UI registrations
  - If `server` declared: jiti loads `plugin.server.ts` → `factory(api)` (plain pi api)
  - Write `.error` on any throw; SSE error
  - On success: clear `.error`, update `loaded`, `revision++`, SSE load
- [ ] `createBoringPiExtension({ pluginsDir, emit }): ExtensionFactory`:
  - registers `exec_ui`, `open_panel` tools
  - registers `boring.reload` command
  - hooks `session_start { reason: "reload" }`
  - calls `loadBoringPlugins` on init and on each reload trigger
- [ ] Wire into `createHarness.ts`: `extensionFactories: [createBoringPiExtension({ pluginsDir, emit })]`
- [ ] `POST /api/agent-plugins/reload` route — for standalone pi users; calls `loadBoringPlugins` directly

**Fix `pluginLoader.ts`** (`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`):
- [ ] Replace `import(url)` with `createJiti(import.meta.url, { moduleCache: false })`
- [ ] Widen `VALID_EXTENSIONS` to `{".ts", ".tsx", ".js", ".mjs"}`

**SSE multiplexing** (`packages/agent/src/server/http/fsEvents.ts`):
- [ ] Add `emitPlugin(event: BoringPluginEvent): void` to `FsEventBroadcaster`
- [ ] Browser clients filter by `event.type`; no new endpoint needed

---

### C — API routes

**`packages/agent/src/server/http/routes/agentPlugins.ts`:**

- [ ] `GET /api/agent-plugins` → `[{ id, boring, version, revision }]` from `loaded` map; used by browser on connect/reconnect
- [ ] `GET /api/agent-plugins/:id/error` → `.error` file content; 404 if none
- [ ] Register outside plugin ids at startup (collision guard for inside plugin id validation)

---

### D — `authoring.ts`: `BoringExtensionAPI`

**`packages/workspace/src/shared/plugins/authoring.ts`:**

- [ ] Replace namespaced `BoringPluginAPI` with flat `BoringExtensionAPI` (extends pi's `ExtensionAPI`)
- [ ] `createBoringCapturingAPI(piApi)` — server-side version: captures IDs only, ignores component refs
- [ ] `createCapturingBoringExtensionAPI()` — browser-side version: captures full registrations including React components
- [ ] `flush()` returns `{ panels, panelCommands, leftTabs, surfaceResolvers }`
- [ ] `registerTool` — no-op in the capturing APIs (pi handles tools via the real api)
- [ ] `registerCommand` — no-op in the capturing APIs (pi handles natively)
- [ ] Pi stub methods: no-op + `console.warn` in dev
- [ ] Boring-ui extras: `registerPanel?`, `registerPanelCommand?`, `registerLeftTab?`, `registerSurfaceResolver?`
- [ ] `export type BoringExtensionFactory = (api: BoringExtensionAPI) => void | Promise<void>`
- [ ] Keep `BoringPluginAPI` as deprecated alias
- [ ] Export `BoringExtensionAPI`, `BoringExtensionFactory` from `@boring/workspace/plugin`
- [ ] Delete `PluginCoordinator` (`coordinator.ts`). `CapturedRegistrations` type moves into `authoring.ts`. Update exports.
- [ ] Delete `coordinator.test.ts`, `hotReload.test.ts`

---

### E — Browser: `registerAgentPlugin` + stores

**`packages/workspace/src/front/plugins/`:**

- [ ] `agentPluginRegistry.ts` — `lastSeen: Map<id, revision>`; outside plugin `extensionContracts` populated at bootstrap
- [ ] `registerAgentPlugin(id, boring, version, revision, mode)` — stage/commit/rollback:
  - Stale check: `revision ≤ lastSeen[id]` → discard
  - Snapshot current store state (rollback target)
  - V1: `await import(url?v=revision)` → `factory(createCapturingBoringExtensionAPI())` → captured registrations with React components
  - V2: read from `boring.panels[]`, `boring.commands[]`, etc. (no dynamic import)
  - MANIFEST_IMPL_MISMATCH (V1 only): every `boring.panels[i].id` must have a matching `registerPanel?()` call
  - Path A: check contribution types vs `extensionContract.allowedContributions`
  - Failure: restore snapshot, toast
  - Success: commit to Zustand stores; LIFO resolver stack update; `lastSeen[id] = revision`
- [ ] Zustand stores: add `unregisterByPluginId(id)` to panel/command/tab/resolver stores
- [ ] Resolver LIFO stack: pop entries tagged `id`, push new entries tagged `(id, revision)`
- [ ] Slash commands: `registerCommand` calls in factory are no-ops in capturing API — pi handles them natively

---

### F — `AgentPluginPane` + SSE handler

**`packages/workspace/src/front/plugins/`:**

- [ ] `AgentPluginPane.tsx`:
  - `mode="direct"` (V1): `usePanelStore(panelId).component`; `React.Suspense`; `key={panelId}:{revision}` → remount on reload
  - `mode="iframe"` (V2 stub): `<div>V2 — TODO G</div>`
  - Missing panel: "Plugin not loaded" placeholder
- [ ] `useWorkspaceEventStream` — workspace-level shared `EventSource` to `/api/v1/fs/events`; fans out by event type; replaces per-component EventSource in `useFileEventStream`
- [ ] SSE handler: filter `boring.plugin.*` → `registerAgentPlugin` / unregister / toast; stale events discarded via `revision ≤ lastSeen[id]`
- [ ] Reconnect: `GET /api/agent-plugins` on connect → for each `revision > lastSeen[id]`, call `registerAgentPlugin`

---

### G — Doc seeding + system prompt

- [ ] `packages/workspace/docs/plugins.md` — file layout, package.json schema, authoring guide, hot-reload flow, Path A
- [ ] `packages/workspace/docs/panels.md` — panel registration, `AgentPluginPane`, V1 vs V2
- [ ] `packages/workspace/docs/bridge.md` — postMessage bridge API
- [ ] `boringSystemPrompt.ts` — embed all three; `BORING_DOCS_PATH` env var for local dev

---

### H — V2: esbuild route + iframe render (skeleton)

- [ ] `GET /api/agent-plugins/:id/front.js` — validate id; esbuild on demand; cache by `(id, mtime)`; `Cache-Control: no-store`; CSP `default-src 'none'; script-src 'self'`; on error: write `.error`, serve last cache or 500
- [ ] Wire `AgentPluginPane mode="iframe"` — real `<iframe sandbox="allow-scripts" src={url} />`; bridge messages TODO I

### I — V2: postMessage bridge + provisioning

- [ ] `agentPluginBridge.ts` — validate `event.source === iframeRef.contentWindow`; dispatch `openPanel`, `showNotification`
- [ ] Handshake: wait for `boring.bridge.ready` → send `boring.bridge.init { theme, derivedFrom? }`
- [ ] `bridge-client.ts` — shipped as `.boring-vendor/bridge-client.js`
- [ ] Provisioning: seed `.boring/plugins/package.json`, bridge-client, docs

### J — Plugin status panel + templates

- [ ] Plugin status panel: first-party outside plugin; panel id `"boring-agent-plugins"`; lists active inside plugins, versions, load times, errors; subscribes via SSE `boring.plugin.*`
- [ ] `packages/workspace/templates/plugin/` — example `front.tsx` + `package.json`
- [ ] `plugin.server.ts` example with `api.registerTool()` for Node.js-specific tools
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/`

---

## Existing Plugins — No Migration Required

All current first-party plugins (`filesystemPlugin`, `explorerPlugin`, `dataCatalogPlugin`, `macroPlugin`, `playgroundDataCatalogPlugin`) keep their declarative `WorkspaceFrontPlugin` shape. `bootstrap()` is unchanged. No migration.

`authoring.ts` is the one file that changes — the capturing API expands to the new flat `BoringExtensionAPI` surface.

### What DOES change: `authoring.ts`

| Current `BoringPluginAPI` | New `BoringExtensionAPI` | Delta |
|---|---|---|
| `panels.register(reg)` | `registerPanel?(reg)` | rename + flatten |
| `commands.register(reg)` | `registerPanelCommand?(reg)` | rename + flatten |
| `surfaceResolvers.register(reg)` | `registerSurfaceResolver?(reg)` | rename + flatten |
| `providers.register(reg)` | `registerProvider?(reg)` | rename + flatten |
| `slotFills.register(reg)` | `registerSlotFill?(reg)` | rename + flatten |
| ❌ missing | `registerTool(tool)` | add — no-op in capturing (pi handles via real api) |
| ❌ missing | `registerLeftTab?(reg)` | add |
| ❌ missing | `registerCommand(name, opts)` | add — no-op in capturing (pi handles) |
| ❌ missing | `on(event, handler)` | add |
| ❌ missing | pi stub methods | add no-ops |

### Agent-tool split — current state and desired direction

**Current state:** First-party plugin agent tools (`buildFilesystemAgentTools()`, harness tools, etc.) are static `AgentTool[]` arrays in `createAgentApp.ts`, passed to pi via `adaptToolsForPi()`.

**`AgentTool` vs `ToolDefinition` — two differences:**
- execute signature: `execute(params, { abortSignal, toolCallId, onUpdate })` vs pi's `execute(toolCallId, params, signal, onUpdate, ctx)`
- parameters: `JSONSchema` (plain object) vs pi's `TSchema` (TypeBox)

**Desired direction:** All first-party plugin tools should migrate to `agent/extension.ts` pi extensions:

```
filesystemPlugin/
  front/index.ts        ← UI: WorkspaceFrontPlugin (unchanged)
  agent/extension.ts    ← NEW: ExtensionFactory — api.registerTool(defineTool({...}))
```

**This is one unified follow-up PR — not two separate items:**

| Step | What changes |
|---|---|
| Rewrite first-party tools as `ToolDefinition` | TypeBox parameters + pi execute signature |
| Move to `agent/extension.ts` per plugin | `ExtensionFactory` wired via `extensionFactories[]` |
| Refactor `catalogRoutes` | works with `ToolDefinition[]` instead of `AgentTool[]` |
| Delete `AgentTool` type | fully replaced by `ToolDefinition` |
| Delete `adaptToolsForPi()` | no longer needed |
| Delete `customTools` from `createAgentApp` | tools flow through `extensionFactories[]` only |

This follow-up also closes the TypeBox migration (`parameters: tool.parameters as any`). They are the same work.

**This PR:** `AgentTool`, `adaptToolsForPi()`, and `customTools` stay untouched.

---

## Out of Scope

- Outside plugin **front** migration to factory pattern — `bootstrap()` stays
- **Unified tool migration follow-up** — first-party tools → `ToolDefinition` + `agent/extension.ts`; deletes `AgentTool` + `adaptToolsForPi()`. Also the TypeBox migration. One PR.
- `binding` / `provider` / `slotFill` in V2 — require host React tree; incompatible with iframe sandbox
- `host.query()` bridge for V2 derived plugins — deferred until Path A + full bridge land
- Vite HMR for outside plugins — separate concern
- postMessage bridge wiring (TODO I) and provisioning — follow-up after H skeleton ships
- `registerShortcut` implementation — accepted by `BoringExtensionAPI` but no-op in V1
- Catalog handlers — complexity not yet justified
- `eventId` UUID dedup — `revision ≤ lastSeen[id]` is sufficient
