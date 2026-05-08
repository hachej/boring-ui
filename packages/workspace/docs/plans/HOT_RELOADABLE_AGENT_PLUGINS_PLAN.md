# Boring Plugins — Agent Extension System

**Last updated:** 2026-05-07  
**Status:** Active — two-phase rewrite

---

## System overview

```
                        BORING-UI PLUGIN SYSTEM
                        ═══════════════════════

  pluginDirs[]  —  one shared list for all plugin roots
  ┌──────────────────────────────────────────────────────────────────────┐
  │  first-party (monorepo)               inside (.pi/extensions/)       │
  │  · boring-macro                       · csv-viewer  (agent-created)  │
  │  · filesystemPlugin                   · my-custom-plugin             │
  │  · dataCatalogPlugin                  pi auto-discovers natively     │
  │                                                                      │
  │  Each plugin root:  agent/   front/   server/   sdk/   shared/      │
  └──────────┬────────────────────────────┬─────────────────────────────┘
             │                            │
    agent/index.ts                 front/index.tsx  ← BoringFrontFactory
    agent/skills/*.md              server/index.ts
    agent/prompts/*.md                    │
             │                            │
             │              ┌─────────────┴──────────────────────────────┐
  additionalExtensionPaths  │   Mode A — Bootstrap  (first-party, sync)  │
             │              │   boringFrontFactoryToPlugin(id, factory)   │
             │              │   → WorkspaceFrontPlugin → stores (no flash)│
             │              └────────────────────────────────────────────┘
             │
             ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │                         Pi runtime                                 │
  │  ┌────────────────────────────────┐  ┌──────────────────────────┐ │
  │  │   plugin agent/index.ts × N    │  │   boring-pi-extension    │ │
  │  │   · registerTool(TypeBox)      │  │   · exec_ui, open_panel  │ │
  │  │   · resources_discover         │  │   · /boring.reload cmd   │ │
  │  │     → skills + prompts         │  │   on session_start:      │ │
  │  └────────────────────────────────┘  │     loadBoringAssets()   │ │
  │                                      │     emit SSE ────────────┼─┼──┐
  │                                      └──────────────────────────┘ │  │
  └────────────────────────────────────────────────────────────────────┘  │
                                                                           │ SSE boring.plugin.*
                                                                           │ Mode B — all plugins
                                                                           ▼
                                                            ┌──────────────────────────┐
                                                            │         Browser          │
                                                            │  registerAgentPlugin()   │
                                                            │  import front/index.tsx  │
                                                            │  factory(capturingApi)   │
                                                            │  → panels/resolvers/tabs │
                                                            └──────────────────────────┘

  LOADING FLOWS
  ────────────────────────────────────────────────────────────────────────
  Cold start
    1. bootstrap()   Mode A: boringFrontFactoryToPlugin() → stores (sync)
    2. Pi starts     loads agent/index.ts × N → tools + skills + prompts
    3. session_start Mode B: loadBoringAssets() → SSE → browser commits
       revision 1 > lastSeen 0; same front/index.tsx re-imports (no flash)

  /boring.reload  (full — agent + front + server)
    preflight → ctx.reload() → pi restarts → session_start
    → loadBoringAssets() → SSE → browser re-imports front?v=N
    tools + skills + panels ALL refreshed atomically

  POST /api/boring.reload  (front + server only — no pi restart)
    preflight → loadBoringAssets() → SSE → browser re-imports
    panels refreshed; agent tools NOT re-registered

  OWNERSHIP SPLIT
    Pi     → tools (TypeBox) · skills (agent/skills/) · prompts (agent/prompts/)
    Boring → panels · left tabs · resolvers · server routes · SSE ↔ browser flow
```

---

## Goal

Make boring plugins that own their runtime dependencies **native pi extensions** for agent behaviour (tools, skills, prompts), while boring-ui adds a thin orchestration layer on top for UI assets (panels, resolvers) and server assets (routes, SDKs) that pi doesn't know about.

Runtime dependency rule: path-loaded hot-reloadable plugins may import code/packages/files, read env/config, and call stable boundaries such as HTTP routes or workspace bridge commands. They must not depend on host-created in-memory JS objects or another plugin's live singleton instance. Plugins that need those injected runtime objects remain statically composed until their dependency is moved behind a stable boundary.

Two phases:

1. **Phase 1 — First-party plugin migration.** App/domain plugins whose dependencies are importable or reachable through stable boundaries become real pi `ExtensionFactory` files with TypeBox tools, native skills, and prompt templates. SDK/CLI tooling moves to a dedicated `sdk/` folder at plugin root. The existing adapter layer (`AgentTool`, `adaptToolsForPi`, `agentTools`) remains only for static/injected host tools until those tools move behind stable boundaries. `systemPrompt` moves from `defineServerPlugin` to the `"boring"` manifest field for hot-reloadable plugins and is injected by `boring-pi-extension` via pi's `before_agent_start` event.

2. **Phase 2 — Additional assets loading mechanism.** `boring-pi-extension.ts` (boring-ui's own pi extension) scans `pluginDirs[]` for the `"boring"` field and emits SSE to the browser on every `session_start`. A second HTTP entry point enables boring-only reload without pi. First-party plugins get hot-reload for free via the same path.

---

## Universal plugin layout

Every plugin — first-party and inside — uses the same file structure. Only the layers that are needed are populated.

```
<plugin-root>/
  package.json          ← "pi": { "extensions": ["./agent/index.ts"] }
                           "boring": { "front": "./front/index.tsx", label, panels[], ... }
  agent/
    index.ts            ← pi ExtensionFactory: tools + resources_discover
    skills/             ← .md files; pi picks up via resources_discover
      macro-deck.md           → /skill:macro-deck (reference material injected into turn)
      macro-transform.md      → /skill:macro-transform
    prompts/            ← .md files; pi picks up via resources_discover
      draft-deck.md           → /draft-deck <topic> (pre-written message shortcut)
      analyze-series.md       → /analyze-series <id>
  front/
    index.tsx           ← BoringFrontFactory (panels, left tabs, surface resolvers)
  server/
    index.ts            ← Fastify routes only (no tools)
    template/           ← workspace init assets (provisioned at workspace creation)
  sdk/
    pyproject.toml      ← language SDK / CLI (e.g. boring_macro Python pkg + bm CLI)
    boring_macro/
  shared/
    types.ts
    constants.ts
```

### Skills vs Prompts

| | Skill (`/skill:name`) | Prompt (`/name args`) |
|---|---|---|
| Invocation | `/skill:macro-deck` | `/draft-deck labor market` |
| Pi behaviour | `<skill>` XML block injected alongside user message | Template body with `$1`/`$@` substituted; **replaces** user message |
| Purpose | Reference material: API docs, workflow rules, syntax | Message shortcut: pre-written prompt for common requests |

Skills and prompts are **not declared in `package.json`**. They are returned by each plugin's own `resources_discover` handler inside `agent/index.ts`. Pi wires them directly.

### `package.json` fields

```json
{
  "name": "boring-plugin-macro",
  "boring": {
    "front":    "./front/index.tsx",
    "label":    "Macro",
    "panels":   [{ "id": "chart-canvas", "title": "Chart" }, { "id": "deck", "title": "Deck" }],
    "surfaceResolvers": [{ "id": "macro-open", "surfaceKind": "macro.open", "panelId": "chart-canvas" }]
  },
  "pi": {
    "extensions": ["./agent/index.ts"]
  }
}
```

- `"pi"` — pi natively loads `agent/index.ts`. Standalone pi users use this without boring-ui.
- `"boring"` — boring-ui reads this for `front/index.tsx` loading and UI metadata.
- `agent` and `server` paths are **not in `"boring"`**. `server/index.ts` is discovered by convention (existence check).

### `BoringPackageField` type

```ts
interface BoringPackageField {
  front?:            string   // "./front/index.tsx" — browser UI factory
  label?:            string
  panels?:           Array<{ id: string; title?: string }>
  commands?:         Array<{ id: string; title: string; panelId?: string }>
  leftTabs?:         Array<{ id: string; title: string; panelId: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  systemPrompt?:     string   // optional extra context injected before every agent turn
  derivesFrom?:      string   // Path A — see PLUGIN_DERIVATION_PATH_A_PLAN.md
}
```

---

## `BoringFrontFactory` — the universal front shape

`front/index.tsx` exports the **same default** for all plugins, all modes:

```tsx
// macro/front/index.tsx
const macroFront: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "chart-canvas", component: ChartCanvasPane, label: "Chart" })
  api.registerPanel({ id: "deck",         component: DeckPane,        label: "Deck" })
  api.registerLeftTab({ id: "macro-tab",  title: "Macro", panelId: "chart-canvas", icon: TrendingUp })
  api.registerSurfaceResolver({ kind: "macro.open", resolve: macroSurfaceResolver })
}
export default macroFront
```

```ts
// BoringFrontAPI — browser-only; no pi methods
interface BoringFrontAPI {
  registerPanel(reg: { id: string; component: React.ComponentType<PaneProps>; label?: string }): void
  registerPanelCommand(reg: { id: string; title: string; panelId: string }): void
  registerLeftTab(reg: { id: string; title: string; panelId: string; icon?: React.ReactNode }): void
  registerSurfaceResolver(reg: { kind: string; resolve: (ctx: unknown) => { panelId: string } | null }): void
}
export type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>
```

### Mode A — Bootstrap adapter (`boringFrontFactoryToPlugin`)

Used at app startup for first-party plugins. Runs the factory synchronously with a capturing API and produces a `WorkspaceFrontPlugin` for the standard bootstrap path.

```ts
function boringFrontFactoryToPlugin(id: string, factory: BoringFrontFactory): WorkspaceFrontPlugin {
  const api = createCapturingBoringFrontAPI()
  factory(api)  // must be sync — bootstrap runs before React mounts
  const { panels, panelCommands, leftTabs, surfaceResolvers } = api.flush()

  return defineFrontPlugin({
    id,
    outputs: [
      ...panels.map(p => ({
        type: "panel",
        panel: { id: p.id, component: p.component, title: p.label, placement: "center", source: "plugin" }
      })),
      ...leftTabs.map(t => ({ type: "left-tab", id: t.id, title: t.title, panelId: t.panelId, icon: t.icon })),
      ...panelCommands.map(c => ({ type: "panel-command", id: c.id, title: c.title, panelId: c.panelId })),
      ...surfaceResolvers.map(r => ({ type: "surface-resolver", resolver: { kind: r.kind, resolve: r.resolve } })),
    ],
  })
}
```

```ts
// bootstrap.ts
import macroFront from "macro/front/index.tsx"
import { filesystemPlugin } from "filesystemPlugin/front/index.ts"  // named export

bootstrap([
  boringFrontFactoryToPlugin("macro", macroFront),
  boringFrontFactoryToPlugin("dataCatalog", dataCatalogFront),
  filesystemPlugin,  // named export — providers/bindings need full WorkspaceFrontPlugin
])
```

### Mode B — SSE dynamic import

Used at hot-reload for all plugins (first-party and inside). Browser imports the same `front/index.tsx` default.

```ts
const { default: factory } = await import(`${pluginFrontUrl}?v=${revision}`)
const api = createCapturingBoringFrontAPI()
await factory(api)
commitToStores(id, api.flush(), revision)
```

### `createCapturingBoringFrontAPI()`

Shared by both modes. Implements `BoringFrontAPI` by accumulating registrations into arrays; `flush()` returns them.

```ts
function createCapturingBoringFrontAPI(): BoringFrontAPI & { flush(): CapturedRegistrations } {
  const panels: PanelReg[] = []
  const panelCommands: PanelCommandReg[] = []
  const leftTabs: LeftTabReg[] = []
  const surfaceResolvers: SurfaceResolverReg[] = []
  return {
    registerPanel: (r) => panels.push(r),
    registerPanelCommand: (r) => panelCommands.push(r),
    registerLeftTab: (r) => leftTabs.push(r),
    registerSurfaceResolver: (r) => surfaceResolvers.push(r),
    flush: () => ({ panels, panelCommands, leftTabs, surfaceResolvers }),
  }
}
```

### Capability matrix

| Feature | `BoringFrontFactory` (all plugins, hot-reloadable) | `WorkspaceFrontPlugin` (bootstrap only) |
|---|---|---|
| Panels | ✅ | ✅ |
| Left tabs | ✅ | ✅ |
| Panel commands | ✅ | ✅ |
| Surface resolvers | ✅ | ✅ |
| Providers / bindings | ❌ | ✅ |
| Catalog registration | ❌ | ✅ |
| Hot-reload | ✅ | ❌ |

### Filesystem dual-export pattern

`filesystemPlugin` needs providers, bindings, and catalogs — not expressible via `BoringFrontFactory`. It exports both shapes:

```ts
// filesystemPlugin/front/index.ts

// Default export: BoringFrontFactory — panels + resolvers (hot-reloadable)
const filesystemFront: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "code-editor",     component: CodeEditorPane })
  api.registerPanel({ id: "markdown-editor", component: MarkdownEditorPane })
  api.registerSurfaceResolver({ kind: "file.open", resolve: filesystemSurfaceResolver })
  api.registerLeftTab({ id: "files", title: "Files", panelId: "code-editor", icon: FolderTree })
}
export default filesystemFront

// Named export: full WorkspaceFrontPlugin — bootstrap only (providers/bindings/catalogs)
export const filesystemPlugin = defineFrontPlugin({
  id: FILESYSTEM_PLUGIN_ID,
  outputs: filesystemOutputs,  // includes providers, bindings, catalogs
  bindings: [FilesystemCatalogBinding, FilesystemFilePanelBinding, FilesystemAgentFileBridge],
})
```

Bootstrap uses the named export. SSE hot-reload re-imports the default export (panels + resolvers subset only). Providers and bindings stay from cold start — they don't change during a session.

---

## Unified plugin directory list (`pluginDirs[]`)

All plugins — first-party and inside — are registered in **one shared list of plugin directories**. Both pi and `boring-pi-extension` consume this same list.

```ts
// workspace startup — single source of truth
const pluginDirs: string[] = [
  // First-party (monorepo source dirs)
  resolve(pkgs, "workspace/src/plugins/filesystemPlugin"),
  resolve(pkgs, "workspace/src/plugins/dataCatalogPlugin"),
  resolve(apps, "boring-macro-v2/src/plugins/macro"),
  // Inside plugins discovered at runtime
  ...glob(".pi/extensions/*/"),
]
```

**Pi** gets agent paths as `additionalExtensionPaths`:

```ts
additionalExtensionPaths: pluginDirs
  .map(d => join(d, "agent/index.ts"))
  .filter(existsSync)
```

**`boring-pi-extension`** gets the full list to scan for the `"boring"` field and emit SSE for all plugins that have a `front/index.tsx` — both first-party and inside. On every `/boring.reload` or `/reload`, first-party plugins hot-reload with zero extra infrastructure.

---

## Inside plugin location — `.pi/extensions/`

Agent-created (inside) plugins live in `.pi/extensions/`. Pi auto-discovers and loads everything under `.pi/extensions/` at startup and on `/reload`. `boring-pi-extension` scans the same directory for the `"boring"` field.

```
.pi/
  extensions/
    csv-viewer/              ← inside plugin (agent-created)
      package.json           "pi" + "boring" fields
      agent/
        index.ts             ← pi loads natively: tools + resources_discover
        skills/
          csv-usage.md       → /skill:csv-usage
        prompts/
          analyze-csv.md     → /analyze-csv <file>
      front/
        index.tsx            ← boring loads via SSE (Mode B): BoringFrontFactory
      server/
        index.ts             ← boring jiti-loads at reload: Fastify routes
  skills/                    ← user-level skills (pi standard; unchanged)
  prompts/                   ← user-level prompts (pi standard; unchanged)
```

**Why this works:**
- Pi loads `agent/index.ts` as a first-class extension — no jiti-wrapping by boring-ui
- Skills and prompts register through each plugin's own `resources_discover` — no aggregation needed
- `/reload` rescans `.pi/extensions/` natively — `boring-pi-extension` just observes `session_start`
- Standalone pi users get the full agent layer without boring-ui installed

---

## Loading lifecycle

### Cold start (app startup)

```
1. Bootstrap runs first — synchronous, before pi starts
   boringFrontFactoryToPlugin("macro", macroFront) → WorkspaceFrontPlugin → stores
   boringFrontFactoryToPlugin("dataCatalog", ...) → stores
   filesystemPlugin (named export, providers/bindings) → stores
   lastSeen["macro"] = 0, lastSeen["filesystem"] = 0, lastSeen["dataCatalog"] = 0

2. Pi starts — loads all agent/index.ts from pluginDirs via additionalExtensionPaths
                + inside plugin agent/index.ts from .pi/extensions/ natively
   → tools, skills, prompts registered natively

3. boring-pi-extension session_start fires
   → loadBoringAssets(pluginDirs) → emits SSE boring.plugin.load for each plugin
   → browser: revision 1 > lastSeen 0 → import front/index.tsx → commit to stores
   lastSeen["macro"] = 1, lastSeen["filesystem"] = 1, lastSeen["dataCatalog"] = 1
```

Stores are seeded twice: synchronously at bootstrap (no flash), then via SSE (establishes hot-reload baseline). The SSE re-import is visually a no-op since the same components load.

### Hot-reload (`/boring.reload`)

```
/boring.reload
  → preflightBoringPlugins(pluginDirs)   validate manifests (no pi touch)
  → ctx.reload()                         pi tears down + restarts extension runtime
  → session_start { reason: "reload" }
       pi: rescans additionalExtensionPaths + .pi/extensions/ natively
           each agent/index.ts factory(api) called fresh
           each factory's resources_discover → skills + prompts re-registered
       boring-pi-extension session_start handler:
           loadBoringAssets(pluginDirs)
               → revision++ per plugin
               → emit SSE boring.plugin.load
  → browser: revision N > lastSeen → import front/index.tsx?v=N → hot-reload panels
```

Works identically for first-party and inside plugins.

### Reload without pi (`POST /api/boring.reload`)

Same as hot-reload but skips `ctx.reload()`. Rescans front/server assets only. Agent tools are **not** re-registered. Use when only `front/index.tsx` or `server/index.ts` changed.

| | `/boring.reload` (pi command) | `POST /api/boring.reload` (HTTP) |
|---|---|---|
| Manifest preflight | ✅ | ✅ |
| `loadBoringAssets` → SSE | ✅ | ✅ |
| `ctx.reload()` (tools/skills re-registration) | ✅ | ❌ |

---

## Rendering modes — V1 (local) vs V2 (remote)

The SSE infrastructure, `loadBoringAssets`, and the manifest format are **identical** in both modes. The only variable is **whether the browser can directly import `front/index.tsx`**. Trust is not the variable — agent code is trusted in both modes. The iframe in V2 is a delivery mechanism, not a sandbox.

### V1 — Local hot-reload (implemented first)

Applies when boring-ui and the plugin files are reachable by the browser (local dev, self-hosted). Vite serves `front/index.tsx` directly.

```
boring.plugin.load SSE arrives
  → browser: await import(`/plugin-path/front/index.tsx?v=${revision}`)
             Vite resolves + transpiles on demand
             factory(createCapturingBoringFrontAPI())
             flush() → panels (React components), resolvers, tabs
             commit to stores
```

**Characteristics:**
- Full React components live in the store — `ChartCanvasPane`, `DeckPane`, etc.
- Vite handles transpilation; no build step
- `AgentPluginPane mode="direct"`: renders `usePanelStore(panelId).component` in host tree
- `key={pluginId}:{revision}` on the pane → React remount on every reload
- Stack traces point directly to source files

**Server side (same for both modes):**
- `loadBoringAssets` jiti-loads `server/index.ts` from local filesystem
- Pi loads `agent/index.ts` from local filesystem via `additionalExtensionPaths`

---

### V2 — Remote front (paved, not implemented in this phase)

Applies when the plugin files live on a remote server the browser cannot import from directly (Vercel, cloud). The iframe is **not a security boundary** — it is the only practical way to execute remote-origin JS in a browser without a full-page navigation. Agent code is trusted; the iframe is just the loader.

```
boring.plugin.load SSE arrives
  → browser: fetch GET /api/agent-plugins/:id/front.js?v=${revision}
             server: esbuild bundles front/index.tsx → IIFE
             browser: <iframe src="frame.html?v=N">
             postMessage bridge: ready → init { theme, pluginId } → rendered
```

**Characteristics:**
- `front/index.tsx` is bundled server-side (esbuild IIFE) because the browser has no path to import it
- `AgentPluginPane mode="iframe"`: renders `<iframe src={frameHtmlUrl} />`
- `frame.html` shell wraps `front.js` (iframe src cannot be a bare JS file)
- postMessage bridge (`@boring/workspace/bridge-client`) replaces direct store access
- Panel metadata (id, title) comes from SSE payload `boring.panels[]` — no dynamic import
- `GET /api/agent-plugins/:id/front.js` — esbuild IIFE bundle; cached by `(id, mtime)`

**What is the same as V1:**
- `loadBoringAssets` / SSE events / `BoringPackageField` — identical
- `POST /api/boring.reload` — identical
- `agent/index.ts` pi loading — identical (pi runs on same server in both modes)
- `server/index.ts` jiti loading — identical
- Revision-gated browser update and error handling — identical

### Pi's pluggable FS operations

Pi ships with explicit FS operation interfaces on every tool — designed exactly for remote filesystem delegation (JSDoc says "Override these to delegate file reading to remote systems, for example SSH"):

```ts
// All tools accept an optional operations override
createReadTool(cwd, {
  operations: {
    readFile:  (path) => remoteFs.read(path),
    access:    (path) => remoteFs.access(path),
  }
})
createWriteTool(cwd, { operations: { writeFile, mkdir } })
createLsTool(cwd,   { operations: { exists, stat, readdir } })
createEditTool(cwd, { operations: { readFile, writeFile } })
createGrepTool(cwd, { operations: { ... } })
createFindTool(cwd, { operations: { ... } })
```

In **V2 remote sandbox mode**, boring-ui creates pi's tools with remote-aware operations that proxy reads/writes to the remote workspace FS API. The agent then transparently reads and writes files on the remote sandbox.

**Extension loading is pull-based, not watch-based.** Pi has no file watcher on `.pi/extensions/`. `ResourceLoader.reload()` is what triggers a rescan — and it is only called when `/reload` or `ctx.reload()` is invoked explicitly:

```
ctx.reload()  (or user types /reload)
  → resourceLoader.reload()
      → packageManager.resolve()         re-scans .pi/extensions/ via existsSync/readdir
      → resolveExtensionSources(         re-resolves additionalExtensionPaths
          additionalExtensionPaths)
      → loadExtensions(allPaths)         jiti.import() each path fresh
  → new ExtensionRunner(extensions)
  → emit session_start { reason: "reload" }
```

Nothing triggers this automatically. Pi rescans on demand, every time reload is called.

This is correct because **pi always co-locates with boring-ui**. `.pi/extensions/` is always a local OS path from pi's perspective, and `jiti.import()` needs a local path to load `agent/index.ts`. The "remote" is only ever the user's browser — pi and boring-ui live on the same host in both local dev and remote sandbox.

```
Local dev                            Remote sandbox (V2)
──────────────────────────────       ──────────────────────────────────
Agent tools: local OS fs             Agent tools: remoteOps (HTTP proxy)
Extension loading: jiti local        Extension loading: jiti local ✅
.pi/extensions/: ~/workspace/.pi     .pi/extensions/: /srv/boring/.pi
    (pi process on same machine)         (pi process on same machine)
```

`boring-pi-extension` is unaware of the mode — it calls `ctx.reload()` to trigger the rescan, then observes `session_start`. No changes needed.

### V2 path — remote agent loading (future, not designed yet)

Phase 1 constraint: **pi always co-locates with boring-ui**. `jiti.import()` always has local paths. The "remote" is only ever the browser.

When the topology changes (pi on user's machine, boring-ui on a remote server), `jiti.import()` can no longer reach inside plugin `agent/index.ts` files. The escape hatch follows the same pattern already used for `front/index.tsx` and `server/index.ts`: **boring-pi-extension fetches the source via `remoteFs.readFile()` and loads it itself**, bypassing pi's jiti loader. `ctx.reload()` still drives the reload; `session_start` calls `loadRemoteAgentPlugins()` alongside `loadBoringAssets()`. Reload contract is identical — only the loader differs.

The open design questions (esbuild bundling vs transform for import resolution, `createSubApi` surface coverage, tool identity across modes) are deferred until this topology is a real target.

**V1 constraints that V2 must not break:**
- Server never jiti-loads `front/index.tsx` — `boring.panels[]` in the manifest is authoritative for metadata. V1 ignores manifest arrays (reads components directly); V2 depends on them. Keep both in sync.
- `BoringFrontFactory` must not import `WorkspaceFrontPlugin`-only APIs — in V2 it runs in a separate esbuild bundle without host imports.
- `boring.plugin.load` SSE payload must always include the full `boring` field — V2 browser reads panel titles/ids from it, not from a dynamic import.

### Mode comparison

| | V1 — local | V2 — remote |
|---|---|---|
| `front/index.tsx` loaded by | Browser (Vite dynamic import) | Server (esbuild → `front.js` bundle) |
| Panel components | React in host tree | JS in iframe (iframe = remote code loader, not sandbox) |
| `AgentPluginPane` | `mode="direct"` (component from store) | `mode="iframe"` (`<iframe>` with bridge) |
| postMessage bridge | ❌ not needed | ✅ required |
| `server/index.ts` | jiti local | jiti local (same) |
| `agent/index.ts` | pi local | pi local (same) |
| SSE / `loadBoringAssets` | ✅ | ✅ (identical) |
| `POST /api/boring.reload` | ✅ | ✅ (identical) |
| Panel metadata source | `flush()` from factory | SSE `boring.panels[]` |

---

## Phase 2 infrastructure

### `agent/index.ts` shape (target for all plugins)

```ts
import { defineTool, Type } from "@mariozechner/pi-coding-agent"
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))

const macroExtension: ExtensionFactory = (api: ExtensionAPI) => {
  // Skills + prompts: pi picks them up natively
  api.on("resources_discover", () => ({
    skillPaths:  [join(__dir, "skills")],
    promptPaths: [join(__dir, "prompts")],
  }))

  // Tools: TypeBox schema, native pi execute signature
  api.registerTool(defineTool({
    name: "execute_sql",
    label: "SQL",
    description: "Run read-only SQL on ClickHouse (87k+ FRED series)",
    parameters: Type.Object({
      query: Type.String({ description: "SELECT / WITH / EXPLAIN only" }),
    }),
    async execute(_id, { query }, signal) {
      return { content: [{ type: "text", text: await runQuery(query, signal) }] }
    },
  }))
}

export default macroExtension
```

### Prompt template format

```md
---
description: Draft a briefing deck on a macro topic
argument-hint: <topic>
---

Draft a briefing deck under `deck/$1.md` covering $ARGUMENTS.
Use relevant FRED series. Apply the macro-deck skill for format and widget syntax.
```

Invoked as `/draft-deck labor market` → pi substitutes args and sends expanded text as the user message.

### `boring-pi-extension.ts`

Boring-ui's own pi extension — the only one boring ships. Wired into pi startup once.

```ts
export function createBoringPiExtension(opts: {
  pluginDirs: string[]
  emit: (e: BoringPluginEvent) => void
}): ExtensionFactory {
  return async (api: ExtensionAPI) => {
    // UI bridge tools for agent use
    api.registerTool(defineTool({ name: "exec_ui",    ... }))
    api.registerTool(defineTool({ name: "open_panel", ... }))

    // Load front + server assets after every pi session start (cold start + reload)
    api.on("session_start", async () => {
      await loadBoringAssets(opts)
    })

    // Inject each plugin's systemPrompt (if declared) before every agent turn
    api.on("before_agent_start", async (event) => {
      const snippets = [...loaded.values()]
        .map(p => p.boring.systemPrompt?.trim())
        .filter(Boolean)
      if (snippets.length === 0) return
      return { systemPrompt: event.systemPrompt + "\n\n" + snippets.join("\n\n") }
    })

    // /boring.reload: re-glob inside plugins, preflight, pi reload → session_start fires
    api.registerCommand("boring.reload", {
      description: "Reload boring-ui plugins",
      handler: async (_args, ctx) => {
        opts.pluginDirs = resolvePluginDirs()  // re-glob .pi/extensions/*/ for new plugins
        const preflight = preflightBoringPlugins(opts.pluginDirs)
        if (preflight.errors.length) {
          for (const e of preflight.errors) opts.emit({ type: "boring.plugin.error", ...e })
          return
        }
        await ctx.reload()
        // session_start fires → loadBoringAssets runs with updated pluginDirs
      },
    })
    // No initial load here — session_start fires on cold start too
  }
}
```

No `resources_discover` in `boring-pi-extension.ts` — each inside plugin's `agent/index.ts` handles its own skills/prompts.

### `loadBoringAssets` — the shared reload function

Called from `session_start` (cold start + every reload) and `POST /api/boring.reload`. Scans all plugin dirs, loads server routes, emits SSE. **Never touches `agent/index.ts`** — pi owns that.

#### Server route hot-reload — `BoringServerAPI` capturing pattern

`server/index.ts` receives a `BoringServerAPI` — a capturing abstraction, never a real Fastify instance. Routes are collected and swapped into a **generation dispatch map**. One permanent Fastify route (`/api/boring-plugins/*`) dispatches to the current generation's handlers. Fastify never sees duplicate registrations.

```ts
// BoringServerFactory — server equivalent of BoringFrontFactory
type BoringServerFactory = (api: BoringServerAPI) => void | Promise<void>

interface BoringServerAPI {
  get(path: string, handler: RouteHandler): void
  post(path: string, handler: RouteHandler): void
  // ... other methods
}

// Generation dispatch — registered once at Fastify startup
const serverHandlers = new Map<string, Map<string, RouteHandler>>()  // pluginId → path → handler

app.all('/api/boring-plugins/:pluginId/*', (req, reply) => {
  const handlers = serverHandlers.get(req.params.pluginId)
  const handler = handlers?.get(`${req.method} ${req.params['*']}`)
  return handler ? handler(req, reply) : reply.status(404).send()
})

// In loadBoringAssets — swap handlers atomically per plugin
if (plugin.serverPath && existsSync(plugin.serverPath)) {
  const mod = await jiti({ moduleCache: false }).import(plugin.serverPath)
  const capturing = createCapturingBoringServerAPI()
  await (mod.default as BoringServerFactory)(capturing)
  serverHandlers.set(plugin.id, capturing.flush())  // atomic swap
}
```

This mirrors the `BoringFrontAPI` capturing pattern exactly. Server routes for a plugin are replaced atomically on every reload — no collision, no restart.

```ts
async function loadBoringAssets(opts: { pluginDirs: string[]; emit: (e: BoringPluginEvent) => void }): Promise<void> {
  const plugins = readBoringPlugins(opts.pluginDirs)  // re-reads from disk

  for (const id of findRemoved(plugins, loaded)) {
    loaded.delete(id)
    serverHandlers.delete(id)  // drop old routes
    opts.emit({ type: "boring.plugin.unload", id, revision: ++revisions[id] })
  }

  for (const plugin of plugins) {
    try {
      if (plugin.serverPath && existsSync(plugin.serverPath)) {
        const mod = await jiti({ moduleCache: false }).import(plugin.serverPath)
        const capturing = createCapturingBoringServerAPI()
        await (mod.default as BoringServerFactory)(capturing)
        serverHandlers.set(plugin.id, capturing.flush())
      }

      revisions[plugin.id] = (revisions[plugin.id] ?? 0) + 1
      loaded.set(plugin.id, plugin)

      opts.emit({
        type: "boring.plugin.load",
        id: plugin.id,
        version: plugin.version,
        revision: revisions[plugin.id],
        boring: plugin.boring,
      })
    } catch (err) {
      opts.emit({ type: "boring.plugin.error", id: plugin.id, message: String(err) })
    }
  }
}
```

### HTTP second entry point

```ts
app.post("/api/boring.reload", async (_req, reply) => {
  const preflight = preflightBoringPlugins(opts.pluginDirs)
  if (preflight.errors.length) return reply.status(422).send({ errors: preflight.errors })
  await loadBoringAssets(opts)
  reply.send({ ok: true })
})
```

### SSE event types

```ts
type BoringPluginEvent =
  | { type: "boring.plugin.load";   id: string; boring: BoringPackageField; version: string; revision: number }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error";  id: string; revision: number; message: string }
```

Multiplexed on the existing `/api/v1/fs/events` SSE stream.

### Browser — `registerAgentPlugin`

On `boring.plugin.load` SSE event:

```
1. revision ≤ lastSeen[id]               → discard (stale)
2. Snapshot current Zustand state for id  (rollback target on failure)

── V1 (local): ─────────────────────────────────────────────────────────
3. const { default: factory } =
     await import(`/plugin-root/${id}/front/index.tsx?v=${revision}`)
   const api = createCapturingBoringFrontAPI()
   await factory(api)
   const { panels, panelCommands, leftTabs, surfaceResolvers } = api.flush()
4. Commit React components + metadata to stores
   LIFO resolver stack update

── V2 (sandbox): ───────────────────────────────────────────────────────
3. Read boring.panels[], boring.commands[], boring.leftTabs[],
   boring.surfaceResolvers[] from SSE payload (no dynamic import)
4. Commit metadata (no React components) to stores
   Create iframe slot entry; bridge handshake happens when pane mounts

─────────────────────────────────────────────────────────────────────────
5. lastSeen[id] = revision
On failure: restore snapshot; toast error
```

On `boring.plugin.unload`: call `unregisterByPluginId(id)` on all stores.

---

## Atomicity model

**Tools / skills / prompts:** `ctx.reload()` restarts the pi extension runtime from scratch. All prior registrations are gone before new factories run. No stale tools.

**Front assets:** `revision` counter increments on every `loadBoringAssets` call. Browser discards events with `revision ≤ lastSeen[id]`. Snapshot-restore on failure.

**Server routes:** jiti with `moduleCache: false` ensures fresh import on every `loadBoringAssets`. Previous Fastify plugin scope is removed before re-registration.

---

## Error surfacing

- `.pi/extensions/<id>/.error` — written on any failure; cleared on next successful load
- SSE `boring.plugin.error` → workspace toast
- `GET /api/agent-plugins/:id/error` → `.error` file content; 404 if none
- `GET /api/agent-plugins` → `[{ id, boring, version, revision }]` — browser uses on reconnect

---

## Phase 1 — First-party plugin migration

### What changes

| Layer | Current | Target |
|---|---|---|
| Agent tools | `AgentTool[]` in `server/index.ts` via `adaptToolsForPi()` | `api.registerTool(defineTool({...}))` in `agent/index.ts` with TypeBox |
| Skills | Provisioned to workspace at init from `workspace-template/.agents/skills/` | `agent/skills/*.md`; pi-native via `resources_discover` |
| Prompts | None | `agent/prompts/*.md`; pi-native via `resources_discover` |
| SDK / CLI | `agent/sdk/` (nested inside agent folder) | `sdk/` at plugin root |
| Server | Routes + `agentTools` + `systemPrompt` | Routes only |
| System prompt injection | `systemPrompt` in `defineServerPlugin` (server-side) | Moved to `"boring".systemPrompt` in `package.json`; injected by `boring-pi-extension` via `before_agent_start`. Skills preferred but `systemPrompt` remains a valid option. |

### P1-A: `boring-macro` — `agent/index.ts`

- [x] Create `apps/boring-macro-v2/src/plugins/macro/agent/index.ts` as `ExtensionFactory`
- [x] Rewrite `execute_sql`, `macro_search`, `get_series_data`, `persist_derived_series` as `ToolDefinition` with TypeBox schemas
- [x] Add `api.on("resources_discover", ...)` returning `skillPaths` + `promptPaths`
- [x] Delete `agent/tools/macroTools.ts`

### P1-B: `boring-macro` — skills + prompts

- [x] Move `workspace-template/.agents/skills/macro-deck/SKILL.md` → `agent/skills/macro-deck.md`
- [x] Move `workspace-template/.agents/skills/macro-transform/SKILL.md` → `agent/skills/macro-transform.md`
- [x] Create `agent/prompts/draft-deck.md` → `/draft-deck <topic>`
- [x] Create `agent/prompts/analyze-series.md` → `/analyze-series <id>`
- [x] Create `agent/prompts/plot-series.md` → `/plot-series <id>`

### P1-C: `boring-macro` — SDK + template relocation

- [x] Move `agent/sdk/` → `sdk/` (plugin root)
- [x] Move `agent/workspace-template/` (deck/, transforms/) → `server/template/`
- [x] Update `macroProvisioning` URL references in `server/index.ts`

### P1-D: `boring-macro` — server cleanup

- [x] Remove `agentTools: tools` from `defineServerPlugin` call
- [x] Remove `systemPrompt` string from `makeMacroServerPlugin`; if still needed, move it to `"boring".systemPrompt` in `package.json`
- [x] Remove `createDataCatalogSkillPrompt()` import and usage
- [x] Delete `readMacroAppPrompt()` (reads `.pi/APPEND_SYSTEM.md`) — obsolete

### P1-E: `boring-macro` — `front/index.tsx` to `BoringFrontFactory`

- [x] Rewrite `front/index.tsx` default export as `BoringFrontFactory` (panels, left tabs, resolvers only)
- [ ] Update `bootstrap.ts` to wrap with `boringFrontFactoryToPlugin("macro", macroFront)` — deferred; app still statically composes named `macroPlugin` while dynamic reload consumes the default factory

### P1-F/P1-G: `filesystemPlugin` — keep as core workspace infrastructure

Decision update: do **not** migrate `filesystemPlugin` to a pi extension or hot-reloadable `BoringFrontFactory` in this phase. It owns core workspace infrastructure — file tree, editor panes, file-event invalidation, data providers, open-path behavior, and bridge bindings — not agent-authored app/plugin behavior.

- [x] Keep `packages/workspace/src/plugins/filesystemPlugin/**` statically composed by workspace bootstrap
- [x] Keep filesystem agent tools in `@boring/agent`/pi harness, not in `filesystemPlugin`
- [x] Exclude `filesystemPlugin` from generated/plugin hot-reload scope
- [ ] Revisit only if external shells need a separately consumable filesystem front factory

### P1-H: `dataCatalogPlugin` — pi-native injected factory, partial hot reload

Decision update: migrate `dataCatalogPlugin` to a native pi tool, but accept **partial** hot reload while it depends on an injected `ExplorerAdapter`. The server plugin contributes an in-process `extensionFactory` that closes over the adapter. Pi reload re-runs the factory and re-registers the native tool/prompt, but source changes to the closed-over factory/adapter require the host app/dev server to refresh that closure. A future HTTP catalog boundary can make this path-loaded and fully hot-reloadable.

- [x] Rewrite data catalog agent execution as a pi-native tool definition
- [x] Add `extensionFactories` to workspace server plugin bootstrap
- [x] Wire `createDataCatalogServerPlugin()` to contribute `createDataCatalogPiExtension({ adapter })`
- [ ] Revisit after catalog search is exposed through a stable boundary, preferably an HTTP route such as `/api/catalog/search`
- [ ] Then rewrite the data catalog agent layer as a path-loaded pi `ToolDefinition` that calls the stable boundary

### P1-I: Delete adapter layer

- [ ] Delete `packages/agent/src/shared/tool.ts` (`AgentTool` type) and all imports
- [ ] Delete `adaptToolsForPi()` and all call sites
- [ ] Remove `customTools` / `extraTools` params from `createAgentApp.ts`
- [ ] Remove `agentTools` and `systemPrompt` fields from `WorkspaceServerPlugin` / `defineServerPlugin`
- [ ] Wire first-party `agent/index.ts` files into `additionalExtensionPaths[]` in pi startup

---

## Phase 2 — Additional assets loading mechanism

### P2-A: `boring-pi-extension.ts`

- [ ] `preflightBoringPlugins(pluginDirs)` — validate all manifests without touching pi runtime
- [ ] `readBoringPlugins(pluginDirs)` — scan each dir's `package.json` for `"boring"` field; discover `server/index.ts` by convention (exists check)
- [ ] `loadBoringAssets({ pluginDirs, emit })` — detect removed plugins; jiti-load `server/index.ts`; emit SSE
- [ ] `createBoringPiExtension({ pluginDirs, emit })`:
  - `exec_ui`, `open_panel` tools
  - `session_start` handler → `loadBoringAssets`
  - `boring.reload` command → preflight → `ctx.reload()`
  - Initial `loadBoringAssets` on factory run
- [ ] Wire `createBoringPiExtension` into pi startup alongside first-party extension paths; pass same `pluginDirs` to pi's `additionalExtensionPaths`
- [ ] Error file path: `.pi/extensions/<id>/.error`
- [ ] **Remote mode — agent tools:** in V2, create pi's coding tools with `operations` implementations that proxy to the remote workspace FS API (`createReadTool(cwd, { operations: remoteOps })`, etc.). Extension watcher/loader stays local — no change needed there.

### P2-B: HTTP second entry point

- [ ] `POST /api/boring.reload` — preflight → `loadBoringAssets` → `{ ok: true }`
- [ ] Returns `{ errors: [...] }` with 422 on preflight failure
- [ ] No `ctx.reload()` — front/server changes only

### P2-C: SSE multiplexing

- [ ] `emitPlugin(event: BoringPluginEvent)` on `FsEventBroadcaster`
- [ ] Browser filters `boring.plugin.*` events on existing `/api/v1/fs/events` stream

### P2-D: API routes

- [ ] `GET /api/agent-plugins` → `[{ id, boring, version, revision }]` from `loaded` map
- [ ] `GET /api/agent-plugins/:id/error` → `.pi/extensions/<id>/.error` content; 404 if none

### P2-E: `BoringFrontAPI` + `createCapturingBoringFrontAPI` + `boringFrontFactoryToPlugin`

- [ ] Define `BoringFrontAPI` interface and `BoringFrontFactory` type
- [ ] `createCapturingBoringFrontAPI()` — capturing implementation with `flush()`
- [ ] `boringFrontFactoryToPlugin(id, factory)` — Mode A adapter; factory must be synchronous
- [ ] Export all from `@boring/workspace/plugin` subpath

### P2-F: `registerAgentPlugin` browser  _(V1 + V2 shared shell, V1 import path)_

- [ ] Stale check: `revision ≤ lastSeen[id]` → discard
- [ ] Snapshot current store state (rollback target on failure)
- [ ] **V1:** `await import(pluginFrontUrl?v=revision)` → `factory(capturingApi)` → `flush()` → commit React components + metadata
- [ ] **V2 (future):** read `boring.panels[]` etc. from SSE payload; commit metadata only; iframe slot created
- [ ] Commit: panel/command/tab stores + LIFO resolver stack update
- [ ] `unregisterByPluginId(id)` on stores for unload event

### P2-G: `AgentPluginPane`  _(V1 direct render; V2 iframe shell prepared)_

- [ ] **V1 — `mode="direct"`:** render `usePanelStore(panelId).component`; `key={pluginId}:{revision}` → React remount on each reload
- [ ] **V2 — `mode="iframe"` (future):** render `<iframe sandbox="allow-scripts" src={frameHtmlUrl} />`; no React component in store
- [ ] Mode is determined at registration time from SSE payload (V1 if `front/index.tsx` importable locally, V2 otherwise)

### P2-H: V2 esbuild + iframe bundle  _(future — not in this phase)_

- [ ] `GET /api/agent-plugins/:id/front.js` — esbuild IIFE bundle on demand; cache by `(id, mtime)`
- [ ] `frame.html` shell wraps `front.js` (iframe `src` must be HTML, not bare JS)
- [ ] Alias `@boring/workspace/bridge-client` → `.boring-vendor/bridge-client.js` in esbuild config
- [ ] Bridge handshake: `boring.bridge.ready` → `boring.bridge.init { theme, pluginId, panelId }` → `boring.bridge.rendered`

---

## Code to delete

### Adapter layer (Phase 1)

| File / symbol | Replacement |
|---|---|
| `packages/agent/src/shared/tool.ts` (`AgentTool` type) | Pi's `ToolDefinition` |
| `adaptToolsForPi()` | Tools are native `ToolDefinition` — no adapter needed |
| `customTools` / `extraTools` params in `createAgentApp.ts` | Tools flow through native pi `additionalExtensionPaths[]` / plugin `agent/index.ts` files |
| `agentTools` field in `WorkspaceServerPlugin` / `defineServerPlugin` | Tools live in `agent/index.ts` |
| `systemPrompt` field in `defineServerPlugin` / `WorkspaceServerPlugin` | Moved to `"boring".systemPrompt` in `package.json`; injected via `before_agent_start` in `boring-pi-extension` |
| `createDataCatalogSkillPrompt()` | `agent/skills/data-catalog.md` |
| `agent/tools/macroTools.ts` | Logic moves into `agent/index.ts` as `ToolDefinition` |
| `buildFilesystemAgentTools()` in `createAgentApp.ts` | Moves to `filesystemPlugin/agent/index.ts` |

### Skills provisioning (Phase 1)

| File / symbol | Replacement |
|---|---|
| `workspace-template/.agents/skills/macro-deck/SKILL.md` | `agent/skills/macro-deck.md` |
| `workspace-template/.agents/skills/macro-transform/SKILL.md` | `agent/skills/macro-transform.md` |
| Skill provisioning logic in `macroProvisioning` | No longer needed — skills live with the plugin |
| `.pi/APPEND_SYSTEM.md` pattern | Skills replace system prompt appending |

---

## Code to add

| File / symbol | Purpose |
|---|---|
| `BoringFrontAPI` interface + `BoringFrontFactory` type | Universal browser-side front shape |
| `createCapturingBoringFrontAPI()` | Shared by Mode A (sync) and Mode B (async) |
| `boringFrontFactoryToPlugin(id, factory)` | Mode A adapter: `BoringFrontFactory` → `WorkspaceFrontPlugin` |
| `boring-pi-extension.ts` | Boring-ui's pi extension: `exec_ui`/`open_panel`, SSE emit, `/boring.reload` |
| `loadBoringAssets(opts)` | Shared scan + SSE emit function |
| `POST /api/boring.reload` | HTTP entry for front/server-only reload |
| `GET /api/agent-plugins` | Browser reconnect snapshot |
| `GET /api/agent-plugins/:id/error` | Error diagnostics |
| `registerAgentPlugin` (browser) | SSE handler: revision-gated dynamic import + store commit |
| `AgentPluginPane` | Panel component for plugin-registered panels (V1 direct / V2 iframe) |

---

## Out of scope

- **V2 esbuild bundle + iframe rendering** (P2-H) — architecture is specified and V1 must not break it, but implementation is deferred. P2-F and P2-G include the V2 mode detection stubs so the switch is a drop-in later.
- Path A (plugin derivation) — separate plan: `PLUGIN_DERIVATION_PATH_A_PLAN.md`
- Doc embedding in system prompt — separate plan: `AGENT_DOC_EMBEDDING_PLAN.md`
- `registerShortcut`, `registerFlag` in `BoringFrontFactory` — deferred
- Provider / binding registration in V2 iframe — incompatible with sandbox model
- `host.query()` bridge for V2 derived plugins — deferred until full bridge lands
- Vite HMR for first-party plugin fronts — separate concern
- `serverEpoch` + `contentHash` on SSE events for cross-restart revision robustness — deferred
