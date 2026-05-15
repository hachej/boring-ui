---
name: boring-plugin-build
description: Build a new plugin for the Boring workspace. Covers the full plugin API surface — output types (panel/left-tab/command/catalog/surface-resolver/binding/provider), defineFrontPlugin / defineServerPlugin / composePlugins / definePanel, the workspace bridge + event bus, catalog adapters, surface resolvers, server-side agent tools and Fastify routes, the bootstrap lifecycle. Use when scaffolding a new plugin under `plugins/`, when extending an existing plugin with new output types, or when integrating a plugin's UI with the workspace shell.
---

# /boring-plugin-build — author a new workspace plugin

> A plugin contributes one or more **outputs** (panels, commands, catalogs, surface resolvers, bindings, providers, server tools, server routes) to the workspace shell. The shell composes plugins via `bootstrap()` at mount time.

## When to use this skill

- Scaffolding a new plugin under `plugins/`
- Adding a new output type to an existing plugin
- Wiring a plugin's UI to the workspace shell (events, bridge, UI commands)
- Adding agent tools or Fastify routes from a plugin's server side

## When NOT to use this skill

- Customizing a child *app* (theme, branding, deployment) — use `boring-app-setup`
- Editing workspace internals — plugins extend workspace; modifying workspace itself is a different concern

---

## 0. Decision tree: which outputs do you need?

| You want to… | Use output type |
|---|---|
| Open a tab/panel programmatically (chart, viewer, form) | `panel` |
| Add a persistent left-sidebar tab | `left-tab` |
| Add a command to the command palette / agent | `command` |
| Expose searchable data with rows + facets | `catalog` |
| Map an agent-emitted `openSurface` target → panel | `surface-resolver` |
| Wrap children with React context (theme, auth, store) | `provider` |
| Mount a render-less component (subscriptions, side effects) | `binding` |
| Contribute an agent tool to the backend | server plugin, `agentTools[]` |
| Contribute an HTTP route to the backend | server plugin, `routes` |

A plugin can ship any combination. They're composed into one `outputs: PluginOutput[]` array.

---

## 1. Scaffolding

The canonical shape lives at `plugins/_template/`. To create a new plugin:

```sh
cp -R plugins/_template plugins/<your-name>
cd plugins/<your-name>
# rename: `sample` → `<your-name>` in src/, package.json:name,
#         tsup entry paths (already nested), vitest aliases if you need
#         extra workspace subpaths beyond /server and /events
pnpm install
pnpm typecheck && pnpm test
```

The plugin is automatically picked up by `pnpm-workspace.yaml`'s `plugins/*` glob. Folder name and `package.json:name` should both be kebab-case: `plugins/my-feature/`, name `@hachej/boring-my-feature`. No `Plugin` suffix on the folder.

### Shape (must match the template)

```
plugins/<name>/
  package.json       private: true, workspace:* deps, nested exports map
  tsconfig.json      paths aliases into packages/workspace/src for fast iteration
  tsup.config.ts     entries: front/index, server/index, shared/index
  vitest.config.ts   jsdom + @vitejs/plugin-react + globals: true
                     setupFiles: ./src/test-setup.ts
  src/
    front/
      index.tsx      createXxxPlugin() — entry, re-exports
      panels.tsx     (if you contribute panels)
      catalogs.ts    (if you contribute catalogs)
      surfaceResolver.ts  (if you map agent surfaces)
      bindings.tsx   (if you mount render-less components)
      __tests__/xxxPlugin.test.tsx
    server/
      index.ts       createXxxServerPlugin() — agent tools, system prompt, routes
    shared/
      constants.ts   ids, surface kinds
      types.ts       param/option types
      index.ts       re-export
```

### Layer rules (enforced by `pnpm lint:invariants`)

- `front/` MUST NOT import from `server/` (and vice versa).
- `shared/` MUST NOT import from either side.
- Files at the plugin root (next to `package.json`) are not allowed — keep code under `src/<layer>/`.

---

## 2. The plugin entry — `defineFrontPlugin`

```ts
// src/front/index.tsx
import { defineFrontPlugin } from "@hachej/boring-workspace"
import { MY_PLUGIN_ID } from "../shared/constants"
import { myPanel } from "./panels"
import { mySurfaceResolver } from "./surfaceResolver"

export const myPlugin = defineFrontPlugin({
  id: MY_PLUGIN_ID,
  label: "My Feature",
  systemPrompt: "## My Feature\nUse the `open-thing` command to ...",  // injected into agent context
  outputs: [
    { type: "panel", panel: myPanel },
    { type: "surface-resolver", resolver: mySurfaceResolver },
  ],
})
```

### `WorkspaceFrontPlugin` spec

| field | type | notes |
|---|---|---|
| `id` | `string` | unique across all plugins; bootstrap throws on duplicates |
| `label` | `string?` | display name |
| `systemPrompt` | `string?` | concatenated with other plugins' prompts (double newline separated), injected into agent context |
| `outputs` | `PluginOutput[]` | the contribution surface — see §3 |
| `panels` / `commands` / `catalogs` / `bindings` | `*[]?` | sugar arrays; bootstrap routes each to its registry. Prefer `outputs`. |
| `agentTools` | `AgentTool[]?` | **deprecated** — contribute via `defineServerPlugin` instead |

`defineFrontPlugin` validates and shallow-freezes the spec; throws `PluginError("validation", …)` on bad shape.

---

## 3. Plugin outputs — the contribution surface

The `outputs` array is a union: `PluginOutput[]`. Every output has a `type:` discriminator.

### 3.1 `panel` — open a tab programmatically

```ts
import { definePanel, type PaneProps } from "@hachej/boring-workspace"

interface MyParams { id: string; viewMode?: "chart" | "table" }

function MyPanel({ params, api, containerApi }: PaneProps<MyParams>) {
  // params       — data forwarded to the panel
  // api          — DockviewPanelApi: setTitle, close, onDidParametersChange, …
  // containerApi — DockviewApi: addPanel, fromJSON, … (rarely needed)
  return <div>{params.id}</div>
}

export const myPanel = definePanel<MyParams>({
  id: "my-panel",                    // component id; agents reference this via openPanel.component
  title: "My Panel",
  placement: "center",               // "center" | "right" | "bottom" | "left-tab"
  component: MyPanel,                // see auto-lazy detection below
  source: "app",                     // "app" | "builtin"
  // chromeless: true,               // skip PanelChrome wrapper
  // requiresCapabilities: [...],    // hide if missing
  // essential: true,                // hide close button
})

// in plugin entry:
outputs: [{ type: "panel", panel: myPanel }]
```

**Auto-lazy detection** (`PanelRegistry.ts:23-29`): a function with `length === 0` AND whose `toString()` matches `\bimport\s*\(` is treated as a lazy factory. Otherwise it's eager.

```ts
component: () => import("./MyPanel").then(m => ({ default: m.MyPanel }))  // ← LAZY (auto)
component: MyPanel                                                         // ← EAGER (auto)
component: () => <Foo />                                                   // ← EAGER (no import())
```

**Gotcha**: a zero-arg renderer like `() => <Foo />` is NOT detected as lazy. Set `lazy: true` if you really need it.

**`PaneProps<T>`** mirrors `IDockviewPanelProps<T>` so the registered component renders unwrapped. The shell wraps lazy panels in `React.lazy + Suspense + PluginErrorBoundary` automatically.

### 3.2 `left-tab` — persistent left-sidebar tab

```ts
outputs: [{
  type: "left-tab",
  id: "my-feature",
  title: "Features",
  icon: SomeLucideIcon,
  component: MyFeaturePane,         // receives PaneProps<LeftTabParams>
  chromeless: true,                  // typical for sidebar tabs
}]
```

Same shape as a panel minus `placement` — the bootstrap routes it through `PanelRegistry.register` with `placement: "left-tab"` enforced.

### 3.3 `command` — command palette entry

```ts
outputs: [{
  type: "command",
  command: {
    id: "my-plugin.refresh",
    title: "Refresh data",
    keywords: ["reload", "sync"],
    run: async (ctx) => { /* … */ },
  },
}]
```

Registered in `CommandRegistry`. Surfaces in the command palette and is callable by agents.

### 3.4 `catalog` — searchable data with rows + facets

```ts
import type { CatalogConfig, CatalogAdapter } from "@hachej/boring-workspace"

const adapter: CatalogAdapter = {
  async search({ query, filters, limit, offset, signal }) {
    const items = await fetchRows({ query, filters, limit, offset }, { signal })
    return { items, total: items.length, hasMore: false }
  },
  async fetchFacets({ filters }) {
    return { region: [{ value: "us", count: 12 }, { value: "eu", count: 7 }] }
  },
}

const catalog: CatalogConfig = {
  id: "my-catalog",
  label: "My Things",
  adapter,
  onSelect(row) { /* open a panel, post a ui command, etc. */ },
}

outputs: [{ type: "catalog", catalog }]
```

#### Catalog types (from `shared/plugins/types.ts`)

| type | shape |
|---|---|
| `CatalogRow` | `{ id, title, subtitle?, group?, leading?: CatalogBadge, trailing?: CatalogBadge[], meta? }` |
| `CatalogBadge` | `{ code: string, tooltip? }` |
| `CatalogSearchArgs` | `{ query, filters, group?, limit, offset, signal? }` |
| `CatalogSearchResult` | `{ items: CatalogRow[], total, hasMore }` |
| `CatalogFacetConfig` | `{ key, label, order?, formatValue? }` |
| `CatalogFacetValue` | `{ value, count }` |
| `CatalogAdapter` | `{ search(args), fetchFacets?(args) }` |
| `CatalogConfig` | `{ id, label, adapter, onSelect(row), pluginId? }` |

**Related but distinct**: `plugins/data-explorer` exports `ExplorerItem` / `ExplorerDataSource` with structurally identical shapes. Those types belong to the data-explorer UI component's contract, not the plugin mechanism's contract. data-catalog bridges them via structural typing — see `plugins/data-catalog/` for the pattern. Don't try to dedupe; they're parallel by design.

### 3.5 `surface-resolver` — map agent surfaces → panels

When the agent emits a `SurfaceOpenRequest` (typically via the `openSurface` UI command), the workspace asks every registered resolver. The first one to return a non-`undefined` resolution wins (by score, then `source: "app"` over `"builtin"`).

```ts
import type { SurfaceResolverConfig } from "@hachej/boring-workspace"
import { MY_OPEN_KIND } from "../shared/constants"

export const myResolver: SurfaceResolverConfig = {
  id: "my-feature",
  source: "app",
  resolve(req) {
    if (req.kind !== MY_OPEN_KIND) return undefined
    return {
      id: `my:${req.target}`,           // panel instance id (re-use to re-activate existing tab)
      component: "my-panel",             // a PanelConfig.id registered by this plugin
      title: req.target,
      params: { id: req.target, ...req.meta },
      score: 0,                          // higher wins
    }
  },
}

outputs: [{ type: "surface-resolver", resolver: myResolver }]
```

**`SurfaceOpenRequest`** = `{ kind: string; target: string; meta?: Record<string, unknown> }`. The convention is to namespace `kind` with the plugin id: `"my-plugin.open-row"`.

**Gotchas**:
- A throwing resolver is logged and skipped (`SurfaceResolverRegistry.ts:55-63`) — won't crash the shell.
- The shell deduplicates panel tabs by `id` — re-using the same instance id re-activates instead of opening a new tab.

### 3.6 `provider` — wrap shell children with React context

```ts
import type { PluginProvider, PluginProviderProps } from "@hachej/boring-workspace"

const MyProvider: PluginProvider = ({ apiBaseUrl, authHeaders, children }) => (
  <MyContext.Provider value={{ apiBaseUrl, authHeaders }}>{children}</MyContext.Provider>
)

outputs: [{ type: "provider", id: "my-feature-context", component: MyProvider }]
```

`PluginProviderProps` injected by the shell: `{ apiBaseUrl, authHeaders?, onAuthError?, apiTimeout?, children }`.

### 3.7 `binding` — render-less component for side effects

```ts
function MyBinding() {
  useEffect(() => {
    return events.on(workspaceEvents.uiCommand, (cmd, meta) => { /* … */ })
  }, [])
  return null
}

outputs: [{ type: "binding", id: "my-event-tap", component: MyBinding }]
```

Receives no props (unlike `provider`). Use when you need a subscription/effect mounted somewhere in the tree.

---

## 4. Bridge, events, and UI commands

### 4.1 Typed event bus

```ts
import { events, workspaceEvents } from "@hachej/boring-workspace/events"

// Subscribe
const off = events.on(workspaceEvents.uiCommand, (cmd, meta) => { /* … */ })

// Emit (from a binding, hook, or plugin code)
events.emit(workspaceEvents.panelUpdate, { id: "my-panel", state: "ready" })

// In a React component
useEvent(workspaceEvents.uiCommand, (cmd, meta) => { /* … */ })
```

Event names live in `workspaceEvents` constants. Every event payload carries `meta: { ts, cause: "user" | "agent" | "remote", toolCallId? }`.

Built-in keys you can subscribe to:
- `workspaceEvents.uiCommand` — every UI command dispatched
- `workspaceEvents.editorSaveStart` / `editorSaveEnd`
- `workspaceEvents.panelUpdate` / `panelClose`
- `workspaceEvents.agentData` — agent-emitted data frames
- `"filesystem:file.changed" | "filesystem:file.created" | "filesystem:file.moved" | "filesystem:file.deleted"` — fs events

### 4.2 `postUiCommand` — request shell actions

```ts
import { postUiCommand } from "@hachej/boring-workspace"

postUiCommand({
  kind: "openSurface",
  params: { kind: "my-plugin.open-row", target: "orders_daily", meta: { catalogId: "my-catalog" } },
})
```

Known kinds (`bridge/uiCommandDispatcher.ts:27-36`):

| kind | params |
|---|---|
| `openFile` | `{ path: string }` |
| `openPanel` | `{ id: string; component: string; title?; params? }` |
| `openSurface` | `{ kind: string; target: string; meta? }` |
| `closePanel` | `{ id: string }` |
| `navigateToLine` | `{ file: string; line: number }` |
| `expandToFile` | `{ path: string }` |
| `showNotification` | `{ msg: string; level?: "info" \| "warn" \| "error" }` |
| `closeWorkbenchLeftPane` | `{}` |

Unknown kinds are silently ignored. The shell also exposes these as agent tools (see `packages/workspace/src/server/ui-control/tools/uiTools.ts`).

### 4.3 `WorkspaceBridge` — imperative shell access

In a panel component or binding, read the bridge via `useWorkspaceBridge()`:

```ts
const bridge = useWorkspaceBridge()
await bridge.openFile({ path: "/notes/today.md" })
bridge.subscribe("file:saved", ({ path }) => { /* … */ })
```

| method | returns |
|---|---|
| `getOpenPanels()` | `PanelState[]` |
| `getActiveFile()` | `FileState \| null` |
| `getDirtyFiles()` | `FileState[]` |
| `getVisibleFiles()` | `FileState[]` |
| `openFile / openPanel / closePanel / closeWorkbenchLeftPane / showNotification / navigateToLine / expandToFile / markDirty / markClean` | `Promise<CommandResult>` |
| `subscribe<K>(event, h)` | unsubscribe fn |
| `select<T>(selector, h)` | unsubscribe fn |

Bridge events you can subscribe to: `panel:opened|closed|activated`, `file:opened|saved|dirty`, `sidebar:toggled`, `tree:expand`, `notification:shown`, `pane:error`.

---

## 5. Server side — `defineServerPlugin`

Located in `src/server/index.ts`. Imported via `@hachej/boring-workspace/server` (NOT the front entry).

```ts
import type { AgentTool, ToolResult } from "@hachej/boring-workspace"
import { defineServerPlugin } from "@hachej/boring-workspace/server"
import { MY_PLUGIN_ID } from "../shared/constants"

export function createMyServerPlugin() {
  return defineServerPlugin({
    id: MY_PLUGIN_ID,
    label: "My Feature",
    systemPrompt: "## My Feature\nYou can call `open-thing` …",
    agentTools: [createOpenThingTool()] satisfies AgentTool[],
    routes: async (app) => {
      app.register(myRoutes, { prefix: "/api/v1/my-feature" })
    },
    piPackages: [],
    preservedUiStateKeys: ["my-feature.pinned"],
  })
}
```

### `WorkspaceServerPlugin` fields

| field | type |
|---|---|
| `id` | `string` (matched against front plugin id) |
| `label` | `string?` |
| `systemPrompt` | `string?` (concatenated with other server plugins) |
| `agentTools` | `AgentTool[]?` |
| `routes` | `FastifyPluginAsync?` |
| `piPackages` | `WorkspacePiPackageSource[]?` |
| `provisioning` | `RuntimeProvisioningContribution?` |
| `preservedUiStateKeys` | `string[]?` (UI state keys that survive workspace reload) |

### Agent tools

```ts
const openThingTool: AgentTool = {
  name: "open-thing",
  description: "Open a thing in the workspace.",
  promptSnippet: "Use this when the user asks to view or open a thing by id.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Thing id" },
    },
    required: ["id"],
  },
  async execute({ id }, ctx) {
    // ctx: { abortSignal, toolCallId, onUpdate?, sessionId? }
    return {
      content: [{ type: "text", text: `Opened thing ${id}` }],
      details: { id },  // structured payload available to UI
    } satisfies ToolResult
  },
}
```

**`ToolResult`** = `{ content: [{type:"text", text}]; isError?: boolean; details?: unknown }`.

### Fastify routes

```ts
// src/server/myRoutes.ts
import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"

const submitSchema = z.object({ id: z.string().min(1) })

export const myRoutes: FastifyPluginAsync = async (app) => {
  app.post("/submit", {
    schema: { body: submitSchema },
    handler: async (req, reply) => { /* … */ },
  })
}
```

The host (`@hachej/boring-agent` app server) wires each plugin's routes onto its Fastify instance via the prefix you supply.

See real example: `plugins/ask-user/src/server/` (Fastify routes + agent tool + state publisher).

---

## 6. Composing sub-plugins

When a plugin grows large, split it into composable sub-plugins:

```ts
import { composePlugins } from "@hachej/boring-workspace"

export const myPlugin = composePlugins({
  id: "my-feature",
  label: "My Feature",
  plugins: [panelsPlugin, catalogPlugin, surfacePlugin],
  // optionally: adoptOutputs: false to keep child pluginId attribution
})
```

Each child is a normal `WorkspaceFrontPlugin`. `composePlugins` flattens their `panels/commands/catalogs/agentTools/outputs` into the parent's `outputs[]`.

---

## 7. Bootstrap lifecycle

The shell calls `bootstrap()` once during `WorkspaceProvider` mount.

**Order of operations:**
1. Compose `defaults` (filesystem plugin, etc., minus `excludeDefaults`) with user-supplied `plugins`.
2. Dedupe by `id` — throws `PluginError("duplicate-id", …)` on collision.
3. For each plugin, register in this order: `panels[]` → `commands[]` → `catalogs[]` → `agentTools[]` (deprecated path) → walk `outputs[]` and dispatch to the right registry.
4. Concatenate all non-empty `systemPrompt` strings with `\n\n` separator.

**Returns** `{ registered: string[], systemPromptAppend: string }`. The shell injects `systemPromptAppend` into the agent context.

**Error model**:
- Bootstrap itself does NOT catch per-plugin errors — a malformed output throws synchronously.
- Render-time isolation: each panel is wrapped in `PluginErrorBoundary`; a crashing panel doesn't take down the shell.
- Resolver errors are caught at `resolve()` call time.

`PluginError` kinds: `"validation"` | `"duplicate-id"` | `"mount"` | `"contribution"`.

---

## 8. Registering with the shell

### Front side

For a macro-style app (auto-bootstraps with sensible defaults):

```tsx
import { WorkspaceAgentFront } from "@hachej/boring-core/app/front"
import { myPlugin } from "@hachej/boring-my-feature"

<WorkspaceAgentFront plugins={[myPlugin]} {...shellOptions} />
```

For a custom shell:

```tsx
import { WorkspaceProvider } from "@hachej/boring-workspace"
<WorkspaceProvider plugins={[myPlugin]} {...providerProps}>
  <DockviewShell />
</WorkspaceProvider>
```

### Server side

`createWorkspaceAgentServer` accepts a single `plugins:` array with four
entry shapes — pick whichever fits the host's needs:

```ts
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"
import dataCatalogServerPlugin from "@hachej/boring-data-catalog/server"

await createWorkspaceAgentServer({
  workspaceRoot,
  plugins: [
    // 1. Pre-built WorkspaceServerPlugin object
    createMyPlugin(),

    // 2. Factory function — receives { workspaceRoot, bridge } at install time.
    //    Use when the plugin needs the workspace bridge or root.
    ({ bridge, workspaceRoot }) => createAskUserServerPlugin({ workspaceRoot, bridge }),

    // 3. { spec: { module }, options? } — workspace dep imported by the host.
    //    The factory receives `(options, ctx)` and returns a WorkspaceServerPlugin.
    { spec: { module: () => import("@hachej/boring-data-catalog/server") },
      options: { adapter: myAdapter } },

    // 4. { spec: { dir }, options?, hotReload? } — directory-source plugin.
    //    Manifest-first: reads `package.json#boring.server` then falls back
    //    to `dist/server/index.js` or `src/server/index.ts` (Pi parity:
    //    @mariozechner/pi-coding-agent core/package-manager.js
    //    resolveExtensionEntries). hotReload: true uses jiti so /reload
    //    re-imports the module fresh.
    { spec: { dir: "plugins/my-local-plugin" }, hotReload: true },
  ],
})
```

### Hot reload (`/reload`) coverage matrix

When the chat /reload command fires, what swaps depends on which output
type the plugin contributes. Pi parity: rebuild over diff
(`@mariozechner/pi-coding-agent core/agent-session.js:1896 reload`).

| Output | On `/reload` | Notes |
|---|---|---|
| Panel, command, surface-resolver, left-tab, binding | ✅ swap | Atomic `replaceByPluginId` on the front registry; subscribers see one transition. |
| Catalog | ✅ swap | Same. |
| Provider (React context) | ❌ requires page reload | React doesn't support re-rooting providers around a live tree; shell shows a `boring.plugin.needs-page-reload` toast. |
| `pi.systemPrompt` (manifest field) | ✅ next agent turn | Pi re-fires `before_agent_start` which re-aggregates via `systemPromptDynamic`. |
| `pi.extensions` / `pi.skills` / `pi.packages` | ✅ next reload | Pi's jiti re-imports them; `getDynamicResources` provides them. |
| `defineServerPlugin({ agentTools })` (statically registered) | ❌ requires session restart | Captured in the harness `tools[]` at session creation. To get hot reload, move the tool to a Pi extension factory under `pi.extensions` and bridge-proxy to long-lived workspace state. |
| `defineServerPlugin({ routes })` (free-form Fastify path) | ❌ requires server restart | Fastify routes are bound once. To get hot reload, namespace the plugin's routes under `/api/boring-plugins/<id>/*`. |

The shell never lies: changes that can't apply hot fire a precise event
(`needs-page-reload`, `needs-session-restart`, `needs-server-restart`)
the user can act on. Everything else swaps silently.

---

## 9. Testing

Each plugin owns a `src/test-setup.ts` (copied from `plugins/_template/src/test-setup.ts`). It covers:
- `@testing-library/jest-dom` matchers (manually extended — do NOT use `import "@testing-library/jest-dom/vitest"` shorthand)
- `ResizeObserver` polyfill
- `Range.getClientRects` stub (tiptap compatibility)
- `afterEach(cleanup)` for testing-library

Each plugin's `vitest.config.ts` points at its own `./src/test-setup.ts` (so plugins stay self-contained). The template uses `@vitejs/plugin-react` for JSX and `globals: true` for `describe`/`it`.

Common patterns:
- Front plugin tests: instantiate the plugin and assert `outputs[].type`, render panels with `PaneProps` mocks, verify event subscriptions.
- Server plugin tests: build a Fastify app via `defineServerPlugin().routes`, post requests, assert behavior. See `plugins/ask-user/src/server/__tests__/`.
- Plugin output tests: pass a stub `PanelRegistry` to `bootstrap()` and assert what got registered.

```ts
import { bootstrap, defineFrontPlugin, PanelRegistry, CommandRegistry, CatalogRegistry, SurfaceResolverRegistry } from "@hachej/boring-workspace"

const panels = new PanelRegistry()
const commands = new CommandRegistry()
const catalogs = new CatalogRegistry()
const surfaceResolvers = new SurfaceResolverRegistry()
const chatPanel = definePanel({ id: "chat", title: "Chat", placement: "right", component: () => null })

bootstrap({
  plugins: [myPlugin],
  panels, commands, catalogs, surfaceResolvers, chatPanel,
  excludeDefaults: true,
})

expect(panels.get("my-panel")).toBeDefined()
```

---

## 10. Invariants (enforced by `pnpm lint:invariants`)

The script at `packages/workspace/scripts/check-plugin-invariants.mjs` lints these rules across `plugins/_template/src` and any plugin source paths matching `plugins/<name>/src/<layer>/...`:

- Plugin source files MUST live under `front/`, `server/`, or `shared/` — no files at the plugin's `src/` root.
- `front/` files MUST NOT import from `../server/`.
- `server/` files MUST NOT import from `../front/`.
- `shared/` files MUST NOT import from either `../front/` or `../server/`.
- File naming: catalog files MUST be `catalogs.ts` (not `catalog.ts`); target constants belong in `constants.ts` (not `surfaceTargets.ts`); client entrypoints MUST be `index.ts(x)`; server entrypoint MUST be `server/index.ts`.
- Legacy file-routing metadata (`filePatterns`, `fileFallback`, `FileHandlerOutput`, `PanelRegistry.resolve(...)`) is forbidden.
- Workspace shared plugin contracts (`packages/workspace/src/shared/plugins/`) MUST NOT import `@hachej/boring-agent` or reach into `front/`/`server/` layers.
- Workspace core front (`front/chrome/`, `front/events/`, `front/hooks/`) MUST NOT import plugin-domain modules.

Run `pnpm lint:invariants` before pushing. The same rules run in CI.

---

## 11. Common pitfalls

1. **Forgetting to register a plugin** — `WorkspaceAgentFront plugins={[myPlugin]}` is the only attachment point. The plugin is inert until passed there.
2. **Re-using a panel id on a different plugin** — bootstrap throws on duplicate ids across the whole graph.
3. **Importing `@testing-library/jest-dom/vitest`** — silently broken under monorepo vitest dedup. Use the manual `expect.extend` pattern from `plugins/_template/src/test-setup.ts`.
4. **Setting `lazy: true` manually when it's not needed** — auto-detection handles it for dynamic-import factories. Manual `lazy: true` is a fallback for unusual cases.
5. **Surface resolvers returning a non-existent `component:`** — the openSurface command silently fails; check `uiState.openTabs` after dispatch.
6. **Cross-plugin imports** — plugins MUST NOT import from each other directly. Use the workspace event bus or a shared package.
7. **Missing server plugin id** — `bootstrapServer` validates plugin ids; an id mismatch between front and server is allowed (they're separate registries) but confusing — keep them in sync.
8. **`postUiCommand` from server code** — `postUiCommand` is front-only. From the server side, use agent tool `ToolResult.details` or push UI commands via the agent's stream and let a front-side binding pick them up.

---

## 12. Reference plugins to study

- `plugins/_template/` — the canonical shape. Start here.
- `plugins/ask-user/` — full-stack example: surface resolver + provider + commands + agent tool + Fastify routes + state publisher.
- `plugins/data-explorer/` — pure UI primitive (no server side). Demonstrates a `testing/` entry for sharing fixtures.
- `plugins/data-catalog/` — depends on data-explorer + workspace. Demonstrates catalog wiring + surface resolver for catalog rows.
- `packages/workspace/src/plugins/filesystemPlugin/` — built-in plugin shipping inside workspace itself; useful for understanding how plugins evolve into core.

---

## 13. API surface reference

Every export from `@hachej/boring-workspace` (front) and `@hachej/boring-workspace/server` is plugin-author-facing. Anything not exported is internal — don't deep-import.

**Front (`@hachej/boring-workspace`)**:
- Builders: `defineFrontPlugin`, `composePlugins`, `bootstrap`, `definePanel`
- Errors: `PluginError`
- Runtime: `WorkspaceProvider`, `DockviewShell`, `useWorkspaceBridge`, `useWorkspaceContext`, `PanelChrome`
- Events: `events`, `useEvent`, `workspaceEvents`, `postUiCommand`, `UI_COMMAND_EVENT`
- Registries: `PanelRegistry`, `CommandRegistry`, `CatalogRegistry`, `SurfaceResolverRegistry`
- Hooks: `useCommands`, `useActivePanels`, `useCatalogs`, `useCommandRegistry`, `useCatalogRegistry`, `useSurfaceResolverRegistry`
- Toast: `toast`, `Toaster`, `dismissToast`
- Constants: `WORKSPACE_OPEN_PATH_SURFACE_KIND`

**Server (`@hachej/boring-workspace/server`)**:
- Builders: `defineServerPlugin`, `composeServerPlugins`, `bootstrapServer`, `validateServerPlugin`
- Errors: `ServerPluginError`

**Events (`@hachej/boring-workspace/events`)**:
- `workspaceEvents` constants
- `WorkspaceEventMap` (type)

When in doubt, read `packages/workspace/src/index.ts` directly — every export is deliberate, and the file is annotated with what's public.
