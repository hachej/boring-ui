# Boring Plugins — Hot Reload

**Last updated:** 2026-05-07  
**Status:** Rewrite in progress — build on pi

---

## Core concept

**A boring inside plugin mirrors the same 4-layer structure as first-party plugins** (`front/`, `agent/`, `server/`, `shared/`), just under `.boring/plugins/<name>/` instead of `src/plugins/<name>/`.

Each layer has a single runtime context — no dual-runtime constraints:

- **`agent/index.ts`** — pure pi `ExtensionFactory`; loaded by jiti in Node.js only. `api.registerTool()` and `api.registerCommand()` go to pi's native registry. No browser code, no React, no UI extras.
- **`front/index.tsx`** — boring-ui UI factory; loaded by Vite (V1) or esbuild (V2) in the **browser only**. Registers panels, commands, left tabs, surface resolvers. No jiti, no Node.js.
- **`server/index.ts`** — optional Node.js-only hooks (streams, native modules). Called with restricted api.
- **`shared/`** — optional platform-neutral types shared between layers.

**UI metadata flows via the manifest, not via jiti-loading `front/`.** The server reads `package.json["boring"].panels[]` etc. to build the SSE payload — it never runs `front/index.tsx`. This eliminates CSS-module and browser-global constraints on `front/` entirely.

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
  front/
    index.tsx           ← BoringFrontFactory: panels, commands, left tabs, resolvers (browser only)
  agent/
    index.ts            ← pi ExtensionFactory: tools, slash commands (Node.js only)   OPTIONAL
  server/
    index.ts            ← Node.js-only hooks: streams, native modules, child_process   OPTIONAL
  shared/
    types.ts            ← platform-neutral types shared across layers                  OPTIONAL
```

Mirrors the structure of first-party plugins (`filesystemPlugin/front/`, `dataCatalogPlugin/agent/`, etc.).

**No cross-layer constraints:** `front/` is pure browser code — CSS modules, browser globals, heavy React deps all fine. `agent/` is pure Node.js — native modules, streams all fine. The layers never load each other.

---

## `package.json` shape

```json
{
  "name": "boring-plugin-csv-viewer",
  "version": "1.0.0",
  "boring": {
    "front":           "./front/index.tsx",
    "agent":           "./agent/index.ts",
    "server":          "./server/index.ts",
    "label":           "CSV Viewer",
    "derivesFrom":     "macro",
    "panels":          [{ "id": "csv-panel",  "title": "CSV Viewer" }],
    "commands":        [{ "id": "open-csv",   "title": "Open CSV Viewer", "panelId": "csv-panel" }],
    "leftTabs":        [{ "id": "csv-tab",    "title": "CSV",             "panelId": "csv-panel" }],
    "surfaceResolvers":[{ "id": "csv-open",   "surfaceKind": "csv.open",  "panelId": "csv-panel" }]
  },
  "pi": { "extensions": ["./agent/index.ts"] }
}
```

- `"boring"` — boring-ui manifest (discovery + UI metadata + commit signal trigger source)
- `"pi"` — points at `agent/index.ts`; standalone pi users load it as a standard pi extension
- Plugin `id` = directory name. `version` = top-level `"version"`.
- `"boring.panels[]"` etc. are **authoritative declarations** — server reads them for SSE; never loads `front/` in Node.js.
- `"boring.agent"` and `"boring.server"` are optional. A UI-only plugin omits `agent`; a tools-only plugin omits `front`.

### `BoringPackageField` type

```ts
interface BoringPackageField {
  front?: string              // browser UI factory entry e.g. "./front/index.tsx"
  agent?: string              // pi ExtensionFactory entry e.g. "./agent/index.ts"
  server?: string             // Node.js-only hooks entry e.g. "./server/index.ts"
  label?: string
  description?: string
  derivesFrom?: string        // Path A — hard failure if base plugin not registered

  panels?:           Array<{ id: string; title?: string }>
  commands?:         Array<{ id: string; title: string; panelId?: string; description?: string }>
  leftTabs?:         Array<{ id: string; title: string; panelId: string; icon?: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
}
```

At least one of `front` or `agent` must be present.

### Validation rules

- At least one of `front` or `agent` required → `MISSING_REQUIRED_FIELD` if both absent
- `front` (if declared) must exist on disk → `MISSING_ENTRY_FILE`
- `agent` (if declared) must exist on disk → `MISSING_ENTRY_FILE`
- `server` (if declared) must also exist on disk
- All paths pass `isSafePluginRelativePath` (no `..` escapes)
- `command.panelId`, `leftTab.panelId`, `surfaceResolver.panelId` must reference a declared `panels[]` id
- No duplicate ids within each array
- `derivesFrom` must pass `isValidBoringPluginId`; missing base plugin = hard load failure
- Plugin id (directory name) must not collide with any registered outside plugin id
- Error codes (parse-time): `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | MISSING_ENTRY_FILE | CROSS_REFERENCE | DUPLICATE_ID`
- `MANIFEST_IMPL_MISMATCH` lives in `registerAgentPlugin` (V1 only, post-factory) — not in manifest parsing

---

## APIs per layer

### `agent/index.ts` — standard pi `ExtensionAPI`

`agent/index.ts` is a first-class pi extension. It receives pi's standard `ExtensionAPI` — no boring-ui extras, no adapters. Standalone pi users load it with zero modifications.

```ts
import { defineTool, Type } from "@mariozechner/pi-coding-agent"
import type { ExtensionAPI }  from "@mariozechner/pi-coding-agent"

export default function csvAgent(api: ExtensionAPI): void {
  api.registerTool(defineTool({
    name: "search_csv",
    description: "Full-text search over a CSV file",
    parameters: Type.Object({ q: Type.String() }),
    execute: async (_id, { q }) => ({ content: [{ type: "text", text: `results: ${q}` }] }),
  }))
  api.registerCommand("csv.open", {
    description: "Open CSV viewer",
    handler: async (_args, ctx) => { /* optionally call exec_ui */ },
  })
}
```

### `front/index.tsx` — `BoringFrontAPI` (browser only)

`front/index.tsx` receives `BoringFrontAPI` — boring-ui UI registration methods only. No pi methods, no Node.js concerns. Full browser environment: CSS modules, browser globals, heavy React deps all fine.

```ts
interface BoringFrontAPI {
  registerPanel(reg: { id: string; component: React.ComponentType<PaneProps>; label?: string }): void
  registerPanelCommand(reg: { id: string; title: string; panelId: string; description?: string }): void
  registerLeftTab(reg: { id: string; title: string; panelId: string; icon?: React.ReactNode }): void
  registerSurfaceResolver(reg: { kind: string; resolve: (ctx: unknown) => { panelId: string } | null }): void
}

export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>
```

**One capturing context: browser only.** `registerAgentPlugin` (V1) calls `front/index.tsx` in the browser and captures component refs. The server never loads `front/` — it reads UI metadata directly from the manifest.

---

## Factory examples

```ts
// agent/index.ts — pure pi ExtensionFactory; works unchanged in standalone pi
import { defineTool, Type } from "@mariozechner/pi-coding-agent"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

export default function csvAgent(api: ExtensionAPI): void {
  api.registerTool(defineTool({
    name: "search_csv",
    label: "Search CSV",
    description: "Full-text search over a CSV file",
    parameters: Type.Object({ q: Type.String() }),
    execute: async (_id, { q }) => ({ content: [{ type: "text", text: `results: ${q}` }] }),
  }))
  api.registerCommand("csv.open", {
    description: "Open CSV viewer",
    handler: async (_args, ctx) => { /* optionally call exec_ui */ },
  })
}
```

```tsx
// front/index.tsx — boring-ui UI factory; browser only; no pi concerns
import type { BoringFrontFactory } from "@boring/workspace/plugin"
import { CsvPane } from "./CsvPane"       // CSS modules fine here
import styles from "./CsvPane.module.css" // fine — browser only

const csvFront: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "csv-panel", component: CsvPane, label: "CSV Viewer" })
  api.registerPanelCommand({ id: "open-csv", title: "Open CSV Viewer", panelId: "csv-panel" })
  api.registerLeftTab({ id: "csv-tab", title: "CSV", panelId: "csv-panel" })
  api.registerSurfaceResolver({ kind: "csv.open", resolve: () => ({ panelId: "csv-panel" }) })
}
export default csvFront
```

---

## boring-pi-extension.ts — the plugin runner

Boring-ui's own pi extension, wired via `extensionFactories[]` in `DefaultResourceLoader`. On load/reload it:
1. Scans `.boring/plugins/*/package.json` for valid `"boring"` entries
2. For each plugin: jiti-loads `agent/index.ts` (if declared), calls factory with **real pi api** — tools and commands go to pi natively
3. Reads UI metadata directly from manifest (`boring.panels[]`, `boring.commands[]`, etc.) — **never loads `front/` in Node.js**
4. Emits SSE `boring.plugin.load` with manifest metadata per plugin
5. If `server/index.ts` declared: jiti-loads it, calls factory with a restricted server api

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
      handler: async (_args, ctx) => {
        // Preflight all manifests before touching pi runtime
        const preflight = preflightBoringPlugins(opts.pluginsDir)
        if (preflight.errors.length) {
          for (const e of preflight.errors) opts.emit({ type: "boring.plugin.error", ...e })
          return
        }
        await ctx.reload()  // pi reloads all extensions; session_start fires with reason: "reload"
      },
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
      // Load agent/index.ts with real pi api — tools/commands go to pi natively
      if (plugin.agentPath) {
        const agentFactory = jiti({ moduleCache: false }).import(plugin.agentPath)
        await agentFactory.default(api)
      }

      // Optional: load server/index.ts with restricted server api
      if (plugin.serverPath) {
        const serverFactory = jiti({ moduleCache: false }).import(plugin.serverPath)
        await serverFactory.default(createServerApi(api))
      }

      // UI metadata comes from manifest — no front/ load needed server-side
      revisions[plugin.id] = (revisions[plugin.id] ?? 0) + 1
      loaded.set(plugin.id, plugin)
      clearErrorFile(plugin.id)

      opts.emit({
        type: "boring.plugin.load",
        id: plugin.id, version: plugin.version, revision: revisions[plugin.id],
        boring: plugin.boring,   // manifest arrays are the authoritative source
      })
    } catch (err) {
      writeErrorFile(plugin.id, String(err))
      opts.emit({ type: "boring.plugin.error", id: plugin.id, revision: revisions[plugin.id] ?? 0, message: String(err) })
    }
  }
}
```

**`/boring.reload` flow:** preflight validates all manifests → on success calls `ctx.reload()` → pi restarts extension runtime → `session_start { reason: "reload" }` fires → `loadBoringPlugins` runs fresh with clean pi api. No stale tool registrations possible — pi's own reload boundary handles atomicity.

**Standalone pi users:** `"pi": { "extensions": ["./agent/index.ts"] }` loads the plugin directly. No boring-ui infrastructure needed.

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
1. write front/index.tsx        (no reload — browser UI factory)
2. write package.json           (no reload — plain metadata)
3. if agent tools needed:
     write agent/index.ts       (no reload — pure pi ExtensionFactory)
4. if Node.js-only hooks needed:
     write server/index.ts      (no reload)
5. if new npm deps needed:
     pnpm --dir .boring/plugins add <pkg>   (never mutate app root package.json)
6. /boring.reload               ← preflight + ctx.reload() → pi restarts extensions + SSE to browser
   OR /reload                   ← native pi reload; Boring plugin runtime observes session_start
```

**Why explicit reload:**
- No partial-write races — all files on disk before reload fires
- No chokidar/inotify infrastructure
- Reload fires between agent turns, never mid-message

---

## Atomicity model

### Server (boring-pi-extension.ts)

**`/boring.reload` command handler (pre-reload):**
```
1. preflightBoringPlugins(pluginsDir)        → validate all manifests
   Any manifest error                        → .error file + SSE error; ctx.reload() NOT called
2. ctx.reload()                              → pi restarts extension runtime (clean slate)
3. session_start { reason: "reload" } fires → loadBoringPlugins runs
```

**`loadBoringPlugins` (post-reload, per plugin):**
```
1. readBoringPackage(dir)                   → fail: .error file + SSE error (nothing else changes)
2. jiti.import(agent/index.ts) → factory(api)   (if declared; real pi api)
   jiti.import(server/index.ts) → factory(serverApi)  (if declared)
   Any throw                                → .error file + SSE error
3. UI metadata read directly from manifest  (no jiti-load of front/)
4. revision[id]++
5. loaded.set(id, plugin)
6. delete .error if present
7. SSE boring.plugin.load { id, boring, version, revision }
```

Pi atomicity: `ctx.reload()` restarts the extension runtime from scratch. Agent tools from a failed previous load are gone. No stale registrations.

### Browser

```
SSE boring.plugin.load { id, boring, version, revision } received:
1. revision ≤ lastSeen[id]                  → discard stale
2. Snapshot current Zustand state for id    (rollback target)
3. V1: await import(`/.boring/plugins/${id}/${boring.front}?v=${revision}`)
        → factory(createCapturingBoringFrontAPI())
        → captured: { panels (with components), commands, leftTabs, surfaceResolvers }
   V2: read boring.panels[], boring.commands[], etc. from SSE payload (no dynamic import)
4. Path A: if boring.derivesFrom, check captured contribution types vs extensionContract
5. V1: MANIFEST_IMPL_MISMATCH check — every boring.panels[i].id must have a matching registerPanel() call
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
Agent → /boring.reload
  │
  ├─ (Node.js — boring-pi-extension.ts)
  │   preflightBoringPlugins()                → fail: SSE errors, stop
  │   ctx.reload()                            → pi restarts extension runtime
  │   session_start { reason: "reload" }
  │   jiti.import(agent/index.ts) → factory(api)   ← tools/commands to pi native
  │   jiti.import(server/index.ts) → factory(serverApi)  ← if declared
  │   UI metadata read from manifest (no front/ load)
  │   revision[id]++; loaded.set(id)
  │   SSE boring.plugin.load { id, boring, version, revision }
  │
  └─ (Browser)
      revision ≤ lastSeen[id]                    → discard
      Snapshot Zustand state
      import(`/.boring/plugins/${id}/${boring.front}?v=${revision}`)
      factory(capturingBoringFrontAPI)            → captured panels+components, commands, ...
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
| `agentTool` | ✅ via `api.registerTool()` → pi native (agent/index.ts and server/index.ts) |
| `binding` | ❌ not in API surface; deferred |
| `provider` | ⚠️ possible but not recommended |
| `slotFill` | ✅ |

---

## V2 — Hosted / Sandbox Mode

The agent runs sandboxed. `front/index.tsx` is compiled to an IIFE bundle served to a sandboxed iframe. `agent/index.ts` and `server/index.ts` load via jiti in the host Fastify process (same as V1 — server side is identical).

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
  entryPoints: [plugin.frontPath],  // front/index.tsx — full browser code, CSS modules fine
  bundle: true, format: "iife",
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
- [ ] `BoringPackageField` type — `front?`, `agent?`, `server?` (at least one of front/agent required)
- [ ] `readBoringPackage(dir)` — reads `package.json`, extracts `id` (dir name), `version`, `boring` field
- [ ] Validation: at least one of front/agent required; each declared path exists on disk; panelId cross-refs; no duplicate ids; derivesFrom valid id
- [ ] Error codes: `INVALID_ID | INVALID_VERSION | INVALID_PATH | MISSING_REQUIRED_FIELD | MISSING_ENTRY_FILE | CROSS_REFERENCE | DUPLICATE_ID`
- [ ] `MANIFEST_IMPL_MISMATCH` is a runtime check in `registerAgentPlugin` V1 only — not here
- [ ] Export `BoringPackageField` from `@boring/workspace/plugin` subpath
- [ ] Rewrite `manifest.test.ts`

---

### B — `boring-pi-extension.ts` + SSE types

**`packages/agent/src/server/boring-pi-extension.ts`:**

- [ ] `BoringPluginEvent` discriminated union (as above)
- [ ] `preflightBoringPlugins(pluginsDir)` — validate all manifests without touching pi runtime; returns `{ errors }` per plugin
- [ ] `readBoringPluginsDir(pluginsDir)` — scans `<pluginsDir>/*/package.json`, calls `readBoringPackage`, collects valid entries
- [ ] `loadBoringPlugins(api, { pluginsDir, emit, revisions, loaded })`:
  - Detect removed plugins (in `loaded` but not in scan) → unload → SSE unload
  - For each plugin: jiti (moduleCache: false) loads `agent/index.ts` (if declared) → `factory(api)` — tools/commands to pi
  - If `server` declared: jiti loads `server/index.ts` → `factory(serverApi)`
  - UI metadata read from `plugin.boring` manifest (no front/ load server-side)
  - Write `.error` on any throw; SSE error
  - On success: clear `.error`, update `loaded`, `revision++`, SSE load with manifest
- [ ] `createBoringPiExtension({ pluginsDir, emit }): ExtensionFactory`:
  - registers `exec_ui`, `open_panel` tools
  - registers `boring.reload` command (preflight → `ctx.reload()` on success)
  - hooks `session_start { reason: "reload" }` → `loadBoringPlugins`
  - calls `loadBoringPlugins` on init
- [ ] Wire into `createHarness.ts`: `extensionFactories: [createBoringPiExtension({ pluginsDir, emit })]`

**Fix `pluginLoader.ts`** (`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`):
- [ ] Replace `import(url)` with `createJiti(import.meta.url, { moduleCache: false })`
- [ ] Widen `VALID_EXTENSIONS` to `{".ts", ".tsx", ".js", ".mjs"}` (for `agent/index.ts` and `server/index.ts`)

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

### D — `authoring.ts`: `BoringFrontAPI`

**`packages/workspace/src/shared/plugins/authoring.ts`:**

- [ ] Replace namespaced `BoringPluginAPI` with flat `BoringFrontAPI` (browser-only; no pi methods)
- [ ] `createCapturingBoringFrontAPI()` — browser-side capturing: captures full registrations including React components; `flush()` returns `{ panels, panelCommands, leftTabs, surfaceResolvers }`
- [ ] No server-side capturing API needed — server reads UI metadata from manifest
- [ ] Boring-ui extras: `registerPanel`, `registerPanelCommand`, `registerLeftTab`, `registerSurfaceResolver` (all required, not optional — capturing API always provides them)
- [ ] `export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>`
- [ ] Keep `BoringPluginAPI` as deprecated alias; keep `BoringExtensionAPI` as alias pointing at `BoringFrontAPI`
- [ ] Export `BoringFrontAPI`, `BoringFrontFactory` from `@boring/workspace/plugin`
- [ ] Refactor `PluginCoordinator` into `AgentPluginTransactionCoordinator` — preserve per-id locks, atomic apply, unload, and rollback. `CapturedRegistrations` type moves into `authoring.ts`. Update exports.
- [ ] Adapt (not delete) `coordinator.test.ts`, `hotReload.test.ts` to new flat API

---

### E — Browser: `registerAgentPlugin` + stores

**`packages/workspace/src/front/plugins/`:**

- [ ] `agentPluginRegistry.ts` — `lastSeen: Map<id, revision>`; outside plugin `extensionContracts` populated at bootstrap
- [ ] `registerAgentPlugin(id, boring, version, revision, mode)` — stage/commit/rollback:
  - Stale check: `revision ≤ lastSeen[id]` → discard
  - Snapshot current store state (rollback target)
  - V1: `await import(url?v=revision)` → `factory(createCapturingBoringFrontAPI())` → captured registrations with React components
  - V2: read from `boring.panels[]`, `boring.commands[]`, etc. (no dynamic import)
  - MANIFEST_IMPL_MISMATCH (V1 only): every `boring.panels[i].id` must have a matching `registerPanel()` call
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

- [ ] `packages/workspace/docs/plugins.md` — file layout (`front/`, `agent/`, `server/`, `shared/`), package.json schema, authoring guide, hot-reload flow, Path A
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
- [ ] `packages/workspace/templates/plugin/` — example `front/index.tsx` + `agent/index.ts` + `package.json`
- [ ] `server/index.ts` example with Node.js-specific hooks
- [ ] Update `check-plugin-invariants.mjs` to allow `.boring/plugins/`

---

## Existing Plugins — No Migration Required

All current first-party plugins (`filesystemPlugin`, `explorerPlugin`, `dataCatalogPlugin`, `macroPlugin`, `playgroundDataCatalogPlugin`) keep their declarative `WorkspaceFrontPlugin` shape. `bootstrap()` is unchanged. No migration.

`authoring.ts` is the one file that changes — the capturing API expands to the new flat `BoringExtensionAPI` surface.

### What DOES change: `authoring.ts`

| Current `BoringPluginAPI` | New `BoringFrontAPI` | Delta |
|---|---|---|
| `panels.register(reg)` | `registerPanel(reg)` | rename + flatten |
| `commands.register(reg)` | `registerPanelCommand(reg)` | rename + flatten |
| `surfaceResolvers.register(reg)` | `registerSurfaceResolver(reg)` | rename + flatten |
| `providers.register(reg)` | `registerProvider(reg)` | rename + flatten |
| `slotFills.register(reg)` | `registerSlotFill(reg)` | rename + flatten |
| ❌ missing | `registerLeftTab(reg)` | add |
| `registerTool`, `registerCommand`, `on`, pi stubs | ❌ removed from front API | agent/ uses standard pi `ExtensionAPI` directly |

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
