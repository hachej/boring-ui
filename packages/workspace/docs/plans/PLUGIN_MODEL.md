# Workspace plugin model

**Status:** review v2 — strengthened (concrete contribution types, error model, discovery contract, rejected alternatives, npm authoring guide)
**Owners:** workspace
**Last updated:** 2026-04-28

> Supersedes `COMMAND_PALETTE_REGISTRY.md` v3 — the palette becomes one
> consumer of this model, not a top-level concern.

## What this plan is

A single, expandable contract — `Plugin` — that lets a child app (or any
package) contribute panels, commands, catalogs, agent tools, server
routes, and chat suggestions in one place. `@boring/workspace`
orchestrates registration, lifecycle, and discovery; the existing
pi-coding-agent plugin loader extends naturally to the wider shape.

This isn't speculation. Boring-macro-v2 already contributes all six
contribution types — they're just registered through four different
APIs today. The plan consolidates them.

## Problem

A real "child app" (e.g.
[`/home/ubuntu/projects/boring-macro-v2`](../../../../boring-macro-v2/))
contributes:

| Contribution | Macro's instance | Wired today via |
|---|---|---|
| Panels | `chart-canvas`, `deck` | `<WorkspaceProvider panels={…}>` |
| Catalogs | Macro series catalog (87k FRED series) | `<ChatCenteredShell data={DataPaneConfig}>` |
| Agent tools | `execute_sql`, `macro_search`, `get_series_data`, `persist_derived_series` | `createAgentApp({ extraTools })` |
| Server routes | `registerMacroRoutes` (REST) | `app.register(registerMacroRoutes)` |
| Chat suggestions | "Find a series", "Plot Real GDP", … | `<ChatCenteredShell chatSuggestions={…}>` |
| Commands | (none today, but trivial to want) | (would be) `useCommandRegistry().registerCommand` |

Six contribution types. **Five different registration APIs.** Plus
~150 LOC of `@boring/workspace`'s UI bridge code that boring-macro
inlined into `src/server/uiBridge.ts` because the workspace package's
server-side bundle isn't built. The host code today is fragmented; the
boundary between "workspace's responsibility" and "host's
responsibility" is blurry.

There IS already an extensibility primitive that almost fits — the
pi-coding-agent's plugin loader
(`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`) —
but it only loads `AgentTool[]`. Other contribution types live
elsewhere. Hosts that need both write registration code in two places.

## Goal

One `Plugin` shape. Six contribution slots. One registration API per
environment (`<WorkspaceProvider plugins={…}>` on the client,
`createWorkspaceAgentApp({ plugins: [...] })` on the server). The
existing pi loader extends to handle the wider shape. `@boring/workspace`
ships its own plugin (UI bridge tools + default panels + default
commands + uiRoutes) so hosts stop inlining glue. Boring-macro becomes
the first migration.

## Non-goals

- Replacing the pi loader's discovery infra. We extend its parser
  (`extractTools` → `extractPlugin`); we don't change the discovery
  sources (`~/.pi/agent/extensions/`, `./.pi/extensions/`,
  `pi-plugin-*` npm, `.pi/extensions.json`).
- Sandboxing or capability isolation between plugins. All plugins run
  in the same process / origin as the host. (Future work — out of
  scope.)
- A plugin marketplace, signing, or trust model. Plugins are loaded
  from filesystem / npm; trust the source.
- Replacing the agent's standard catalog of runtime tools (read_file,
  write_file, find_files, bash, …). Those stay in
  `@boring/agent/server/catalog`. Plugins ADD on top — they don't
  redefine the runtime base.
- Cross-plugin dependency resolution beyond a flat dependsOn list with
  late-wins-on-id collision rules.
- Hot-reload of plugins at runtime. Server boot loads, client boot
  loads. Restart to add or remove a plugin. (HMR for client-side
  contributions Just Works through Vite's normal mechanism.)

## Design

### The Plugin contract

Lives in `@boring/workspace/shared` (so both client and server can
import the type).

```ts
export interface Plugin {
  /** Stable id — used for late-wins-on-id collision + dependency refs.
   *  Convention: package or app name ("@boring/workspace",
   *  "boring-macro", "acme-billing"). */
  id: string

  /** Optional human-readable label for discovery UIs. */
  label?: string

  /** Optional version, useful for plugin marketplaces / debugging. */
  version?: string

  /** Plugins this one depends on. The provider refuses to register
   *  if any are missing. Late-wins-on-id rules still apply WITHIN
   *  a registered plugin set. */
  dependsOn?: string[]

  /** Soft dependencies — registers but warns if missing. */
  optionalDeps?: string[]

  /** Mount priority. Lower = earlier; same id = late wins. Default 100.
   *  workspacePlugin is order:0 so its contributions are overridable. */
  order?: number

  // ── Client-side contributions ──────────────────────────────────────
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  chatSuggestions?: ChatSuggestion[]

  // ── Server-side contributions ──────────────────────────────────────
  agentTools?: AgentTool[]
  routes?: FastifyPluginCallback[]

  // ── Lifecycle hooks (optional) ─────────────────────────────────────
  /** Called once on register, after all contributions are placed in
   *  registries. Use for setup that requires the registry to exist
   *  (e.g. registering hot-keys against the command registry). */
  onMount?: (ctx: PluginMountCtx) => void | (() => void)
}
```

`onMount` returns an optional cleanup function that runs on unregister
(useful for dynamic plugins; static plugins typically return nothing).

`PluginMountCtx` exposes the registries the plugin can interact with
beyond its declared contributions:

```ts
type PluginMountCtx = {
  catalogs: CatalogRegistry
  commands: CommandRegistry
  panels:   PanelRegistry
  chatSuggestions: ChatSuggestionRegistry
  // Server-only — undefined on client:
  agentTools?: AgentToolRegistry
  app?: FastifyInstance
}
```

### `definePlugin(spec)` factory

Validates the shape at definition time, fills in defaults, and brands
the result so type errors are clear:

```ts
import { definePlugin } from "@boring/workspace"

export const macroPlugin = definePlugin({
  id: "boring-macro",
  panels:        [chartCanvasPanel, deckPanel],
  catalogs:      [macroSeriesCatalog],
  agentTools:    macroAgentTools,
  routes:        [registerMacroRoutes],
  chatSuggestions: macroChatSuggestions,
})
```

Validation runs `validatePanel`, `validateCommand`, etc. — equivalents
to the existing `validateTool` in `pluginLoader.ts:60`. Failures throw
at `definePlugin` time, not at mount time, so consumers fail fast.

### Workspace orchestration — registries + lifecycle

`@boring/workspace` exports a `PluginRegistry` and four
contribution-type registries. The plugin registry is the only one host
code interacts with directly; the others are derived.

```
PluginRegistry          (id → Plugin)
  ├── on register(p):
  │     - check dependsOn; abort if missing
  │     - warn on optionalDeps missing
  │     - fan plugin.panels into PanelRegistry
  │     - fan plugin.commands into CommandRegistry
  │     - fan plugin.catalogs into CatalogRegistry
  │     - fan plugin.chatSuggestions into ChatSuggestionRegistry
  │     - on server: fan plugin.agentTools, plugin.routes
  │     - call plugin.onMount(ctx) if present, store cleanup
  │     - emit subscriber notifications
  └── on unregister(id):
        - call stored cleanup
        - remove fanned-in items by sourcePlugin id
        - emit
```

All registries use `useSyncExternalStore` so React re-renders track
register/unregister cycles. (This also retrofits the existing
`CommandRegistry`, which today has no subscribe API — fixes a latent
bug where late `registerCommand` calls don't reach an open palette.)

Late-wins-on-id collision rule: when two plugins contribute a panel
with the same id (e.g. host overrides workspacePlugin's `code-editor`),
the later registration wins. Dev-mode console.warn flags it; production
silent. Same rule per contribution type.

### `<WorkspaceProvider plugins={…}>` — client mount

```tsx
import { WorkspaceProvider, workspacePlugin } from "@boring/workspace"
import { macroPlugin } from "./plugin"

<WorkspaceProvider plugins={[macroPlugin]}>
  <App />
</WorkspaceProvider>
```

Provider auto-includes `workspacePlugin` first (order:0); host plugins
register after. Hosts that need to disable parts of workspacePlugin
override by id (e.g. register a Panel with id `code-editor` to replace
the default). Escape hatch: `includeWorkspacePlugin={false}` —
discouraged, rarely needed.

### `createWorkspaceAgentApp({ plugins })` — server mount

Replaces today's `createAgentApp` for hosts that want the workspace
surface (which is most of them). Inside:

```ts
export async function createWorkspaceAgentApp(opts: {
  plugins: Plugin[]
  pluginDirs?: string[]   // beyond ~/.pi/agent/extensions + ./.pi/extensions
  // ...passes through createAgentApp opts
}): Promise<FastifyInstance> {
  // 1. Discover plugins from pi loader
  const fromLoader = await loadPlugins({ cwd: workspaceRoot, extraDirs: opts.pluginDirs })
  // 2. Combine with explicitly-passed plugins, workspacePlugin first
  const plugins = [workspacePlugin, ...opts.plugins, ...fromLoader]
  // 3. Validate dependsOn/optionalDeps; sort by order
  // 4. Register: extraTools = flatMap(p => p.agentTools), routes via app.register
  const app = await createAgentApp({
    extraTools: plugins.flatMap(p => p.agentTools ?? []),
    // ...
  })
  for (const p of plugins) {
    for (const route of p.routes ?? []) await app.register(route)
  }
  // 5. Expose discovery endpoint
  await app.register(pluginsDiscoveryRoute, { plugins })
  return app
}
```

Existing pi-style plugin files (exporting `default: Tool[]` or
`tools: Tool[]`) are auto-wrapped into a Plugin: `{ id: <derived from
filename>, agentTools: extractedTools }`. **Backward-compatible: every
pi plugin in the wild today keeps working.**

### Pi loader integration

The existing `extractTools(mod)` becomes `extractPlugin(mod)`:

```ts
// packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts
export function extractPlugin(mod: Record<string, unknown>): Plugin | null {
  // 1. New shape: default: Plugin (validated)
  if (mod.default && isPluginShape(mod.default)) {
    return validatePlugin(mod.default)
  }
  // 2. Legacy shape: default: Tool | Tool[] OR tools: Tool[]
  const legacyTools = extractTools(mod)
  if (legacyTools.length > 0) {
    return {
      id: `pi-legacy:${derivedFromFilename}`,
      agentTools: legacyTools,
    }
  }
  return null
}
```

Discovery sources stay identical. The result type expands.

### Layout convention for host apps

```
apps/<some-app>/
├── package.json
├── src/
│   ├── plugin/
│   │   ├── index.ts           ← env-aware barrel; re-exports from .client/.server
│   │   ├── plugin.shared.ts   ← id, version, dependsOn, types, fixed config
│   │   ├── plugin.client.ts   ← panels, catalogs, commands, chatSuggestions
│   │   └── plugin.server.ts   ← agentTools, routes
│   ├── server/index.ts        ← createWorkspaceAgentApp({ plugins: [appPlugin] })
│   └── web/App.tsx            ← <WorkspaceProvider plugins={[appPlugin]}>
└── .pi/                        ← optional: drop external pi-style plugins
    ├── extensions/
    └── extensions.json
```

The split keeps server-only deps (e.g. ClickHouse client, Postgres
driver) out of the Vite bundle. `index.ts` uses environment guards:

```ts
// src/plugin/index.ts
import { sharedConfig } from "./plugin.shared"
import { clientPart } from "./plugin.client"
// SERVER-only (esbuild/Vite resolve.conditions or process.env guard):
import { serverPart } from "./plugin.server"

export const plugin = definePlugin({ ...sharedConfig, ...clientPart, ...serverPart })
```

Or via package.json `exports` if the plugin is published as its own
package (npm-distributed plugins use this shape, e.g.
`pi-plugin-acme-billing`):

```json
{
  "exports": {
    "./client": "./client.js",
    "./server": "./server.js"
  }
}
```

For multi-plugin apps, `src/plugins/<id>/...` mirrors the same shape
per plugin; `src/plugins/index.ts` exports an array.

### Cross-environment coordination

A plugin's client and server fields are independent. Three paths the
plan supports:

1. **Full-stack plugin** (most common) — declares both halves; lives
   in the host's source tree. Imports from `./plugin/index.ts`.
2. **Server-only plugin** — only `agentTools` / `routes`. Loaded via
   pi loader from `.pi/extensions` or npm. Client never sees it
   directly; learns about it from the discovery endpoint.
3. **Client-only plugin** — only `panels` / `catalogs` / `commands`.
   Bundled into the client; server never sees it.

The discovery endpoint `GET /api/v1/plugins` (Phase 2 — sketch) returns
a server-authoritative manifest:

```json
{
  "plugins": [
    {
      "id": "boring-macro",
      "version": "0.1.0",
      "contributions": {
        "agentTools": ["execute_sql", "macro_search", ...],
        "routes": ["/api/v1/macro/series", ...],
        "catalogs": ["macro-series"]
      }
    }
  ]
}
```

Client uses this to: (a) know what catalogs the server has registered
even if the client didn't bundle them (so it can route a row select
through the bridge for a server-only catalog); (b) augment the LLM
system prompt with the union of contributions. Phase 1 ships without
the discovery endpoint; phase 2 adds it once a real cross-env case
appears.

### Default plugins (built-in)

`@boring/workspace` ships a SET of default plugins, not a single
monolith. Each is small, focused, and individually overridable.
`createWorkspaceAgentApp` and `<WorkspaceProvider>` auto-include them;
hosts can suppress any subset via id-based override or the
`includeDefaults?: string[]` array (allowlist) / `excludeDefaults?:
string[]` (denylist).

| Default plugin | Contributes | Why default |
|---|---|---|
| `workspacePlugin` | Default panels (codeEditor, markdownEditor, fileTree, dataCatalog, chatPanel, empty), default commands (toggleSidebar, toggleAgentPanel, closeTab) | Every workspace shell needs them; baseline UI |
| `filesystemPlugin` | Agent tools (`find_files`, `read_file`, `write_file`, `edit_file`, `read_directory`); HTTP routes (`fileRoutes`, `treeRoutes`, `searchRoutes`); a Files catalog (search rows) | File access is universal; today's `standardCatalog` already ships these — wrapping them as a plugin makes them overridable + extensible |
| `uiBridgePlugin` | UI bridge agent tools (`get_ui_state`, `exec_ui`); `uiRoutes` (`/api/v1/ui/*`) | Lets the LLM dispatch into the host's UI; today inlined by every host that uses `@boring/workspace`'s server |

(Future defaults likely: `searchPlugin` if there's a meaningful
cross-catalog search story; `terminalPlugin` if `bash`/`exec` migrates
out of the agent's runtime.)

This split contradicts the earlier non-goal that said "file system
tools stay in `@boring/agent`'s `standardCatalog`." Updated stance:
**runtime-level tools that are package-agnostic** (the LLM loop, model
selection, session storage) stay in `@boring/agent`. **Workspace-level
contributions** — including file ops, file tree, UI bridge — move into
`@boring/workspace`'s default plugin set. The boundary is now: agent
package = "the harness"; workspace package = "the workspace's
default capability bundle."

Migration: `standardCatalog`'s `find_files`/`read_file`/`write_file`/
`edit_file`/`read_directory` move into `filesystemPlugin`. Agent's
`createAgentApp` no longer auto-includes them; hosts that want them
get them via `createWorkspaceAgentApp` (which includes
`filesystemPlugin` by default). Hosts that want a UI-less agent stay
on `createAgentApp` directly and ship without file tools — already
the design intent of commit `4968e7d`.

### npm-installable plugins

Plugins published to npm follow the `pi-plugin-*` naming convention
already used by the pi loader. The package's `package.json` declares
the plugin's distribution channel:

```json
{
  "name": "pi-plugin-acme-billing",
  "version": "0.3.0",
  "type": "module",
  "exports": {
    ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./client": "./dist/client.js",
    "./server": "./dist/server.js"
  },
  "peerDependencies": {
    "@boring/workspace": ">=0.1.0"
  },
  "boring": {
    "plugin": {
      "id":      "acme-billing",
      "client":  "./dist/client.js",   // bundled into host Vite build
      "server":  "./dist/server.js",   // imported by createWorkspaceAgentApp
      "panels":  ["acme-invoice", "acme-subscription"],
      "needs":   ["@boring/workspace"]
    }
  }
}
```

The `boring.plugin` manifest entry (extension to package.json — pure
metadata, ignored by tools that don't read it) lets the loader and
build tools know what's in the package without parsing JS at install
time.

Discovery + loading:

1. **Server side** — `createWorkspaceAgentApp` walks
   `node_modules/pi-plugin-*` (existing pi loader behavior), reads
   each package's `boring.plugin.server`, dynamically imports it,
   passes through `extractPlugin`. Result: the plugin's
   `agentTools` + `routes` register automatically.
2. **Client side** — host's bundler resolves
   `pi-plugin-*/client.js` from `node_modules`. Host adds the
   plugin to `<WorkspaceProvider plugins={[…]}>` explicitly:

   ```ts
   import billingPlugin from "pi-plugin-acme-billing/client"
   <WorkspaceProvider plugins={[billingPlugin]}>
   ```

   The client side stays explicit (not auto-imported) because Vite/
   webpack don't have a stable equivalent of "scan node_modules for
   plugins" — explicit imports also help tree-shaking. A tiny
   helper, `loadNpmPlugins()` (sync, returns the list of plugins
   from package.json metadata), can do the resolution at host
   build time as a convenience.

3. **Manifest-discovered (via `.pi/extensions.json`)** — already
   supported by the pi loader; the manifest can reference npm,
   git, or local paths. Plugin shape is the new wider one;
   resolution is unchanged.

Version compatibility: plugins declare a peer-dep range on
`@boring/workspace`. Loader emits a console.warn (dev) /
`/api/v1/plugins` manifest error (production) when the installed
version doesn't satisfy the range. Doesn't refuse to load — letting
plugins fail loudly is better than silent absence.

### Agent-generated plugins

The pi loader already supports user-installed extensions in
`./.pi/extensions/`. The wider Plugin shape extends this naturally
to plugins the LLM itself authors:

```
LLM uses tool: create_plugin({
  id: "my-data-shaper",
  agentTools: [{ name: "shape_csv", parameters: {...}, ... }],
  routes: [...],
  panels: [...],
})
  ↓
Server writes ./.pi/extensions/my-data-shaper.js
(plain JS, validates against Plugin shape at write time)
  ↓
On next createWorkspaceAgentApp boot, pi loader picks it up.
The LLM has self-extended.
```

Required pieces:

- A new `create_plugin` agent tool in `workspacePlugin` (or a
  sibling `pluginAuthorPlugin`) that takes a Plugin shape, validates,
  serializes, writes to `.pi/extensions/<id>.{mjs,js}`. The tool
  refuses to overwrite an existing plugin file unless `replace:
  true` is passed (avoids accidental clobbering).
- An `update_plugin` tool that edits an existing one in-place
  (atomic write to a temp file then rename — no partial writes).
- A `remove_plugin` tool that deletes the file. (Or marks it
  disabled in `.pi/extensions.json` — soft-disable.)
- A `list_plugins` tool that returns the registered set + their
  source ("user", "npm", "git", "agent"). Lets the LLM know what's
  already installed before authoring.
- **Restart semantics** — Phase 1: tool writes the file but the
  plugin only takes effect after the user restarts the server.
  Status returned: "wrote: needs server restart to take effect."
  Phase 3 (hot-reload) makes this seamless; Phase 1 keeps it
  explicit.

Safety:

- Plugins generated by the agent live in
  `.pi/extensions/.agent-authored/` (a sub-dir) for visibility —
  user can audit/diff/git-ignore as needed.
- The `create_plugin` tool requires confirmation by default
  (existing pi tool-approval pattern); deployments that trust the
  LLM (autonomous agents) can opt-in to skip via env var
  `PI_AGENT_AUTHOR_AUTO_APPROVE=true`.
- Generated plugins go through the same `validatePlugin` as all
  other plugins; bad shapes throw at write time, not at boot.

This unlocks "the agent extends its own capabilities" — the user
asks for a domain-specific tool, the LLM authors a plugin, future
sessions have it. Same model pi has today for tools, now for the
full Plugin surface.

### `workspacePlugin` — what the package contributes

```ts
// @boring/workspace
export const workspacePlugin = definePlugin({
  id: "@boring/workspace",
  order: 0,                                  // first; everything overrides
  panels: [
    codeEditorPanel, markdownEditorPanel,
    fileTreePanel, dataCatalogPanel,
    chatPanel, emptyPanel,
  ],
  commands: [
    /* the 3 currently registered imperatively in WorkspaceProvider:
       toggleSidebar, toggleAgentPanel, closeTab */
  ],
  agentTools: [
    /* UI bridge tools currently inlined by boring-macro:
       get_ui_state, exec_ui */
  ],
  routes: [uiRoutes /* /api/v1/ui/* */],
  // No catalogs — domain-specific.
  // No chatSuggestions — domain-specific.
})
```

Hosts that import `@boring/workspace` get this plugin auto-registered.
Boring-macro stops needing `src/server/uiBridge.ts` (the 150-LOC inline
copy) — `createWorkspaceAgentApp` registers `uiRoutes` and the UI tools
via workspacePlugin.

### A "plugin" is a shape, not a delivery mechanism

Important framing: **`Plugin` is a TypeScript shape, not an
installation channel.** Anything that produces a `Plugin` object is a
plugin, regardless of where it lives or how it gets loaded. Three
delivery shapes the model supports, in order from simplest to most
elaborate:

1. **Inline plugin** — defined in the host's own source tree,
   imported normally, passed explicitly to
   `<WorkspaceProvider plugins={[…]}>` /
   `createWorkspaceAgentApp({ plugins: [...] })`. **This is the
   default and most common shape.** Most host apps will define
   exactly one inline plugin alongside their `App.tsx`.

   ```ts
   // apps/boring-macro-v2/src/plugin/index.ts
   export const macroPlugin = definePlugin({ id: "boring-macro", … })

   // apps/boring-macro-v2/src/web/App.tsx
   <WorkspaceProvider plugins={[macroPlugin]}>
   ```

   No npm publication, no pi loader, no discovery. Just a
   well-organized way to bundle the host's contributions into one
   declarative object instead of scattering them across four
   registration APIs.

2. **NPM-installable plugin** — same shape, published as
   `pi-plugin-acme-billing`, installed via `npm install`,
   imported explicitly by the host (or auto-discovered server-side
   by pi loader). Useful when third parties want to ship reusable
   contributions; useful when an internal team wants to share a
   plugin across multiple apps in a monorepo.

3. **Pi-extension plugin** — a `.js` file dropped in
   `.pi/extensions/` (or `~/.pi/agent/extensions/` for global, or
   `node_modules/pi-plugin-*`). Picked up by the pi loader at
   server boot. Useful for: agent-authored plugins (the LLM writes
   one), end-user customizations (drop-in tools/panels without
   touching app source), or shipping a tools-only extension that
   doesn't need an npm package.

**Use the simplest shape that fits.** Boring-macro's migration is
an inline plugin — the host owns the code, no reason to npm-publish
or use pi loader. Pi-extensions earn their keep when the plugin's
provenance is "external to the host source tree." Don't conflate
"plugin" with "pluggable": a plugin can be a host's own static
declaration, just structured to fit the contract.

The plan's npm + pi-loader sections detail those paths because they're
where real coordination work lives. The inline path doesn't need a
section — it's just `definePlugin({...}); <WorkspaceProvider
plugins={[plugin]}>`.

### Concrete contribution types

Each contribution slot has a precise shape. Source of truth is in
`@boring/workspace/shared`; every plugin imports from there.

```ts
// PanelConfig — already exists in workspace today
import type { PanelConfig } from "@boring/workspace"
type PanelConfig = {
  id: string
  title: string
  component: ComponentType<unknown>
  placement: "left" | "center" | "right"
  source?: "app" | "agent" | "user"
  icon?: ReactNode
  filePatterns?: string[]
}

// CommandConfig — already exists, adds `pluginId` provenance
type CommandConfig = {
  id: string
  title: string
  shortcut?: string
  when?: () => boolean
  run: () => void
  /** Set automatically by PluginRegistry on register; do NOT set in plugin code. */
  pluginId?: string
}

// CatalogConfig — new (was being designed in COMMAND_PALETTE_REGISTRY.md v3)
type CatalogConfig = {
  id: string
  label: string
  recentKind: string                       // routes Recent entries back
  adapter: ExplorerAdapter                 // already exists in DataExplorer
  onSelect: (row: ExplorerRow) => void
  paletteIcon?: ReactNode
  paletteLimit?: number                    // default 5
  order?: number                           // default 100
  pluginId?: string                        // set automatically
}

// ChatSuggestion — already exists in @boring/agent/ui-shadcn
type ChatSuggestion = {
  label: string
  hint?: string
  icon?: ComponentType<{ className?: string }>
  prompt: string
}

// AgentTool — already exists in @boring/agent/shared
type AgentTool = {
  name: string
  description: string
  parameters: JSONSchema
  execute: (params: Record<string, unknown>, ctx: ToolExecContext)
    => Promise<ToolResult> | ToolResult
}

// FastifyPluginCallback — Fastify's standard plugin shape
import type { FastifyPluginCallback } from "fastify"
```

Provenance (`pluginId`) is set by `PluginRegistry` when fanning out
contributions; plugin code never sets it. This lets dev tools / debug
panes / late-wins-on-id resolution show "the catalog with id `files`
was contributed by plugin `@boring/workspace` and overridden by
plugin `boring-macro`."

### Validation contract

Every contribution type has a `validate*(value): value | never`
function colocated with its type:

```ts
// packages/workspace/src/plugin/validators.ts
export function validatePanel(p: unknown): PanelConfig {
  if (!isObject(p)) throw new ValidationError("panel must be an object")
  if (typeof (p as any).id !== "string") throw new ValidationError("panel.id required")
  if (typeof (p as any).component !== "function")
    throw new ValidationError(`panel ${(p as any).id}: .component must be a React component`)
  // ... etc
  return p as PanelConfig
}

export function validateCatalog(c: unknown): CatalogConfig { /* … */ }
export function validateCommand(c: unknown): CommandConfig { /* … */ }
export function validateChatSuggestion(s: unknown): ChatSuggestion { /* … */ }
export function validateAgentTool(t: unknown): AgentTool { /* — alias for the
  existing validateTool in pluginLoader.ts:60, moved into this file */ }
```

`definePlugin(spec)` runs each validator on every contribution before
the plugin is considered well-formed. Errors include the plugin id +
contribution kind + which field was bad:

```
PluginValidationError: plugin "boring-macro": catalogs[0].adapter.search
must be a function (got: undefined)
```

Failures throw at `definePlugin`-call time, not at mount time. Hosts
fail fast; a typo can't crash the runtime.

### Error model

Five distinct failure modes, each handled differently:

| Failure | When | Response |
|---|---|---|
| `PluginValidationError` | At `definePlugin` (typo, missing field) | Throw immediately. Host build/dev fails to start. |
| `PluginRegistrationError: missing dep` | At `register` if `dependsOn` lists an unknown plugin | Throw at registration. Provider mount fails with a useful error. |
| `PluginRegistrationError: id collision` | At `register` if a plugin with same id already registered | Late wins on id (replace); dev-mode `console.warn` lists what was replaced; production silent. |
| `PluginMountError` | If `onMount` throws | Catch, log via `request.log.error` (server) or `console.error` (client), emit `plugin:error` on the bus, the plugin's contributions stay registered (other plugins not affected), but its onMount cleanup is NOT stored (nothing to clean up). |
| `PluginContributionError` | If a single contribution at runtime fails (e.g. a catalog adapter throws on `.search`) | Per-contribution try/catch isolates the failure to its own group/panel. Other plugins keep working. The `<CatalogGroup>` renders an inline error chip (per cmd-palette plan v3 §"Per-group error isolation"). |

A misbehaving plugin can never crash the entire workspace, but it CAN
produce bad UX (an empty group, a missing tool, a noop command). The
provider exposes an `errors: PluginError[]` field on its context so
debug panes / health pages can surface them.

### `/api/v1/plugins` discovery contract

Phase 2 endpoint, but the shape is fixed now so client + server can
implement against it independently.

```
GET /api/v1/plugins
Authorization: <session cookie> (same as other agent routes)

200 OK:
{
  "schemaVersion": "1",
  "plugins": [
    {
      "id": "@boring/workspace",
      "label": "Workspace",
      "version": "0.1.0",
      "source": "default",                       // default | local | npm | git | agent
      "contributions": {
        "panels": ["code-editor", "markdown-editor", "file-tree", "data-catalog", "chat", "empty"],
        "commands": ["workspace.toggleSidebar", "workspace.toggleAgentPanel", "workspace.closeTab"],
        "agentTools": ["get_ui_state", "exec_ui"],
        "routes": ["/api/v1/ui"]
      }
    },
    {
      "id": "filesystem",
      "label": "Filesystem",
      "version": "0.1.0",
      "source": "default",
      "contributions": {
        "agentTools": ["find_files", "read_file", "write_file", "edit_file", "read_directory"],
        "routes": ["/api/v1/files", "/api/v1/tree", "/api/v1/files/search"],
        "catalogs": [{ "id": "files", "label": "Files", "recentKind": "file" }]
      }
    },
    {
      "id": "boring-macro",
      "version": "0.3.1",
      "source": "local",
      "contributions": { /* … */ },
      "errors": []
    },
    {
      "id": "broken-plugin",
      "version": "0.1.0",
      "source": "npm",
      "contributions": {},
      "errors": [
        { "phase": "mount", "message": "ClickHouse connection refused" }
      ]
    }
  ]
}

400 / 500: { error: { code, message } }
```

`schemaVersion` is bumped when the response shape evolves; clients
that don't recognize the version log a warning and degrade
gracefully (use the union of catalog IDs they understand).

`errors[]` lets clients show which plugins failed at boot without
fetching server logs. Used by a future "Plugins" admin pane.

The endpoint is read-only (GET). A plugin's data — what its
catalogs return, what its routes do — flows through plugin-specific
endpoints, not this manifest. Discovery is metadata only.

### Cross-environment coordination — pinned

Two independent registrations that converge at runtime:

1. **Server-side registration** is authoritative for what's
   *loaded*. `createWorkspaceAgentApp` walks defaults +
   `opts.plugins` + pi loader output; the discovery endpoint
   reflects that set.
2. **Client-side registration** is authoritative for what's
   *rendered*. `<WorkspaceProvider plugins={...}>` registers
   plugins for the React tree.

For a plugin to work fully (UI + agent tools), both halves must
register. The two registrations are coupled by **id**, not by
shared state. The client doesn't introspect the server's
registry on mount — it just registers what it knows about; if the
server didn't load the matching server-side plugin, the
client-side contributions still render (catalog rows show, etc.)
but server-side actions (route calls, agent tool calls) fail with
404. Hosts get the matched-pair situation right by importing the
same plugin module on both sides (the layout convention's
`./plugin/index.ts` does this).

For diagnostics, the discovery endpoint's manifest lets the
client know which plugins the server is missing or has failed —
client-side dev mode logs a warning per missing/failed pair.
Production: silent. (No "auto-disable client-side contributions
when server's missing the plugin" — that's a class of
hard-to-debug behaviors users want to AVOID.)

### Backwards compatibility

| Breaking change | What | Migration |
|---|---|---|
| `CommandPaletteProps` removed | The `fileSearchFn`/`onOpenFile` props on `<CommandPalette />` were already dead (provider mounts the palette with no props). | Hosts that imported the type: remove the import. The component is now prop-less. |
| `ChatCenteredShellProps.withCommandPalette` removed | No-op runtime today; the actual palette mount is on `WorkspaceProvider`. | Hosts that disabled the palette via this prop: pass `excludeDefaults={["@boring/workspace"]}` (or use the registry's late-wins-on-id with a stub plugin) on `<WorkspaceProvider>` instead. |
| `<ChatCenteredShell data={DataPaneConfig}>` removed | Replaced by registering a catalog. | Hosts that used `data`: convert to `<WorkspaceProvider plugins={[{ id, catalogs: [yourCatalog] }]}>`. Boring-macro migration is the reference example. |
| `createAgentApp({ extraTools })` for workspace surfaces | Replaced by `createWorkspaceAgentApp({ plugins })`. | Hosts that wanted UI bridge tools: switch the import + wrap their tools in a Plugin. Standalone agents (no UI) keep using `createAgentApp` directly. |

Deprecation policy: one minor-version window where the old shape
emits a console.warn, then removed. Codemod (jscodeshift) provided
for the `data?: DataPaneConfig` → catalog migration in a separate
follow-up.

### Plugin authoring guide (for npm publishers)

A minimal published plugin's structure:

```
pi-plugin-acme-billing/
├── package.json                    # see "boring.plugin" manifest above
├── README.md                       # what it does, install instructions
├── src/
│   ├── shared.ts                   # PLUGIN_ID, types, fixed config
│   ├── client.ts                   # exports a Plugin (client-side fields only)
│   ├── server.ts                   # exports a Plugin (server-side fields only)
│   └── index.ts                    # full plugin (used by hosts that bundle both)
├── tsconfig.json
└── tsup.config.ts                  # builds dist/{client,server,index}.js
```

The `index.ts` re-exports from both halves for simple consumers; sophisticated
hosts import `./client` and `./server` separately to get bundling control:

```ts
// pi-plugin-acme-billing/src/index.ts
import { definePlugin } from "@boring/workspace"
import { clientPart } from "./client"
import { serverPart } from "./server"

export default definePlugin({
  ...sharedConfig,
  ...clientPart,
  ...serverPart,
})
```

Authoring checklist:

- [ ] `package.json` `boring.plugin` manifest set (id, client/server entry,
      contribution summary, peer-dep range)
- [ ] `peerDependencies: { "@boring/workspace": ">=X.Y.Z" }`
- [ ] `definePlugin` called at module top (validation runs at import time)
- [ ] Server-only deps are NOT imported from `client.ts` (keep Vite bundle
      small)
- [ ] Tests against `definePlugin`'s validators + a stub registry
- [ ] CHANGELOG documenting any breaking shape changes

### Rejected alternatives

Documenting choices that ended up not in the plan, and why, so future
readers don't relitigate.

| Considered | Why rejected |
|---|---|
| Separate "extension"/"contribution"/"capability" terminology | "Plugin" is the term the existing pi loader uses; introducing a sibling concept would fragment vocabulary. The wider Plugin shape is a strict superset of pi's existing shape — same word, broader contents. |
| Multiple contribution-type registries with NO umbrella `Plugin` (just register catalogs/commands/etc directly) | Loses the bundling benefit. Boring-macro's six contribution types would need six registration sites. The umbrella IS the value. |
| Per-contribution-type override flags (`overridePanels: false`, etc.) | Late-wins-on-id covers this. Adding flags would create two override mechanisms and constant questions about which wins. |
| Plugin sandboxing (separate React roots, isolated contexts) | Too heavy for v1; plugins live in the same tree as the host today via existing prop-drilled patterns. Sandboxing introduces a hard performance + DX cost. Revisit if a real "untrusted plugin" use case shows up. |
| Synchronous, in-process plugin discovery on the client (scan `node_modules` from the browser) | Browsers don't have filesystem access. Client always has explicit imports for npm plugins; server is the discovery side. |
| Hot-reload of plugins at runtime (Phase 1) | Phase 3. The pi loader runs once at boot today; making it reactive requires file watchers + re-validation + listener cleanup. Not worth blocking Phase 1. |
| `agentTools` and `routes` always required for a plugin | Allows pure UI plugins (e.g. a custom theme) and pure tool plugins (e.g. legacy pi tool extensions). All contribution types stay optional. |
| Runtime-typed event payloads for plugin lifecycle events (no compile-time typing) | The bus's typed event map (`UNIFIED_EVENT_BUS.md`) extends naturally to include plugin events; runtime-typed alone would lose the type safety the rest of the bus offers. |
| `definePlugin` returning a class instead of a plain object | Plain object plays nicer with serialization, manifest generation, and the `boring.plugin` package.json metadata convention. Class adds no value. |

### Event bus integration

Plugins are about **registration** (what the system knows exists);
the event bus (see
[`UNIFIED_EVENT_BUS.md`](./UNIFIED_EVENT_BUS.md)) is about
**communication** (what changed, when, and why). They're complementary
contracts that meet at three points.

#### 1. Plugins get bus access via `PluginMountCtx`

`PluginMountCtx` (passed to `onMount`) exposes the workspace's
EventBus alongside the registries:

```ts
type PluginMountCtx = {
  bus: EventBus<WorkspaceEvents>   // ← new — typed against the canonical event map
  catalogs: CatalogRegistry
  commands: CommandRegistry
  panels:   PanelRegistry
  chatSuggestions: ChatSuggestionRegistry
  agentTools?: AgentToolRegistry
  app?: FastifyInstance
}
```

A plugin's `onMount` can subscribe to and emit events:

```ts
definePlugin({
  id: "boring-macro",
  onMount(ctx) {
    // React to file changes elsewhere in the system:
    const off = ctx.bus.on("file:changed", (e) => {
      if (e.path.endsWith(".csv")) refreshSeriesCache(e.path)
    })
    // Emit a domain event when this plugin's data updates:
    macroAdapter.onSeriesPersisted = (id) =>
      ctx.bus.emit("macro:series:persisted", { id, source: "agent" })
    return off  // cleanup on unregister
  },
})
```

This makes the bus the canonical channel for cross-plugin
communication. Plugins don't import each other; they emit/subscribe on
named events. Late-mounted plugins query state via the registries
(plugins don't replay bus events on subscribe — same invariant the
bus doc fixes for `WorkspaceEvents`).

#### 2. Registry events flow on the bus

Plugin lifecycle is itself a stream of events. Adding to the canonical
event map:

```ts
"plugin:registered":   { id: string }
"plugin:unregistered": { id: string }
"plugin:error":        { id: string; phase: "validate" | "mount" | "unmount"; error: Error }
"catalog:registered":   { id: string; pluginId: string }
"catalog:unregistered": { id: string; pluginId: string }
"command:registered":   { id: string; pluginId: string }
"command:unregistered": { id: string; pluginId: string }
"panel:registered":     { id: string; pluginId: string }
"panel:unregistered":   { id: string; pluginId: string }
```

Use cases:
- A debug pane that lists currently-registered plugins (subscribes to
  `plugin:registered` / `plugin:unregistered`).
- Telemetry on plugin load failures (`plugin:error`).
- An "agent learned a new tool" toast (subscribe to
  `plugin:registered` from the chat shell — fires when the LLM
  authors and registers a new plugin via Phase 3 hot-reload).

These additions to `WorkspaceEvents` follow the bus's existing
invariants: edge-triggered transitions, sync emit, no replay,
discriminated `cause` union (`'host' | 'plugin' | 'agent'`).

#### 3. Bus is client-only; cross-environment events flow through existing rails

The bus today (per `UNIFIED_EVENT_BUS.md`) is scoped to the client.
The plugin model doesn't change that. Plugin contributions that need
to communicate across the client/server boundary use the existing
infrastructure:

- **Server → client:** the agent's SSE channel
  (`/api/v1/agent/chat/.../stream`) for tool-call events; the UI
  bridge's command stream (`/api/v1/ui/commands`) for explicit
  dispatches. Both already exist; both fire bus events on the client
  when received.
- **Client → server:** standard HTTP routes contributed by the plugin
  (e.g. `registerMacroRoutes`).
- **Server-side plugins** that want a "bus-like" interface can use
  Fastify's own event hooks (`onRequest`, `onResponse`, etc.) or
  expose their own EventEmitter — but this is per-plugin, not a
  workspace-wide primitive. (If a real cross-plugin server-side bus
  becomes valuable, that's a separate plan.)

#### 4. Discovery endpoint emits a `plugins:discovered` event

When `<WorkspaceProvider>` fetches the
`/api/v1/plugins` discovery manifest (Phase 2), it emits a one-shot
`plugins:discovered` event with the server's plugin list. UI surfaces
that depend on the union (e.g. "show Sessions tab if SessionsCatalog
is registered server-side") subscribe to this; until it fires, they
render conservatively.

This lets the client's plugin set + the server's plugin set stay
synced without tight coupling.

### Phase 1 (this PR) — what actually ships

Bounded scope that delivers a reviewable PR with a working migration.

1. **Define the Plugin contract** + `definePlugin` + per-contribution
   validators. Lives in `@boring/workspace/shared`.
2. **Implement registries** (`PluginRegistry`, `CatalogRegistry`),
   subscribable via `useSyncExternalStore`. Retrofit `CommandRegistry`
   + `PanelRegistry` for subscribe.
3. **Implement workspacePlugin** with the existing UI bridge + default
   commands + default panels + uiRoutes.
4. **`<WorkspaceProvider plugins={…}>`** — auto-mounts workspacePlugin,
   registers host plugins, fan to the right registries.
5. **`createWorkspaceAgentApp({ plugins })`** — server-side mount,
   includes workspacePlugin, calls existing pi loader, fans agentTools
   into createAgentApp's extraTools, registers routes.
6. **Extend pi loader: `extractTools` → `extractPlugin`**. Legacy
   `tools: AgentTool[]` plugin files keep working unchanged.
7. **`<CommandPalette />` consumes `useCatalogs()`** — kills the
   broken `fileSearchFn`/`onOpenFile` props + the type-mismatched
   Recent path. Files becomes the first catalog (provided by host).
8. **Migrate ChatCenteredShell** off its imperative `useEffect`
   command registration. Toggles + new-chat become commands inside a
   private internal "chat-shell" plugin. The session-as-commands loop
   becomes a SessionsCatalog when the shell receives `sessions` +
   `onSwitchSession`.
9. **Migrate boring-macro-v2** to the layout convention:
   - `apps/boring-macro-v2/src/plugin/{shared,client,server,index}.ts`
   - `apps/boring-macro-v2/src/server/index.ts` calls
     `createWorkspaceAgentApp({ plugins: [macroPlugin] })`; deletes
     `src/server/uiBridge.ts`.
   - `apps/boring-macro-v2/src/web/App.tsx` calls
     `<WorkspaceProvider plugins={[macroPlugin]}>`; removes
     `<DataProvider>` if redundant, removes inline panels/data/
     suggestions config.
   - This is THE proof-of-concept for the model — if it can't migrate
     boring-macro to a single ~40-line plugin file, the design is
     wrong.
10. **Tests** (see test plan below).

Two breaking changes called out in the release notes:

- `CommandPaletteProps` export removed (the `fileSearchFn`/`onOpenFile`
  props were already effectively dead — provider mounts the palette
  with no props).
- `ChatCenteredShellProps.withCommandPalette` removed; flag now lives
  on `WorkspaceProvider` (`includeWorkspacePlugin={false}`).

### Phase 2 (sketched, separate PR)

- `GET /api/v1/plugins` discovery endpoint + system-prompt augmentation
  from registered catalog metadata.
- Workbench data tab gains catalog selector — picks any registered
  catalog instead of taking a per-shell `DataPaneConfig`.
- Agent gets generic `search_catalog(id, query)` tool generated from
  registered catalogs (server-side and bridge-routed for client-only).
- npm `pi-plugin-*` discovery extends to read the wider Plugin shape
  (already partially supported by extractPlugin in Phase 1; Phase 2
  validates the cross-env story).

### Phase 3 (longer-term)

- A reference plugin published as an npm package
  (`pi-plugin-billing-example` or similar) demonstrating the
  npm-distribution path.
- Per-plugin sandboxing / capability flags (e.g. `agentExposed:
  false`, `requiresConfirmation: true` per contribution).
- Plugin hot-reload for development.

## Test plan

Phase 1 ships with:

- **Unit: `definePlugin` validation** — well-formed plugin passes;
  malformed catalog/panel/command throws with a clear error pointing
  to the bad field.
- **Unit: `PluginRegistry` lifecycle** — register/unregister fans
  contributions correctly; cleanup runs on unregister; `dependsOn`
  rejects missing deps; late-wins-on-id replaces.
- **Unit: subscribable registries** — late `register` after a
  consumer subscribes triggers a re-render via
  `useSyncExternalStore`. Same retrofit applied to `CommandRegistry`
  + `PanelRegistry`.
- **Unit: pi loader `extractPlugin`** — legacy `tools: Tool[]` shape
  still works; new `default: Plugin` shape works; mixed/invalid
  shapes return `null` with logged errors.
- **Unit: typed Recent migration** — old localStorage `string[]`
  shape → typed `RecentEntry[]`; `"cmd:foo"` legacy entries dropped.
- **Integration: `<WorkspaceProvider plugins={[testPlugin]}>` →
  catalog/command/panel/chatSuggestion all reachable via their
  hooks** (`useCatalogs`, `useCommands`, `usePanels`,
  `useChatSuggestions`).
- **Integration: `createWorkspaceAgentApp({ plugins: [testPlugin] })`
  exposes test plugin's agentTools** in the catalog endpoint and
  registers routes correctly.
- **Integration: cmd palette renders catalogs from registered
  plugins** — top-N rows debounced, AbortSignal-aware,
  error-isolated per group.
- **E2E: boring-macro-v2 migrated** — open the playground (or
  full-app), search a series, verify the catalog renders + clicking
  opens the chart. Same surface area as today, achieved through the
  new model.
- **Regression: existing pi plugins keep working** — drop a sample
  `default: [tool1]` plugin file in `.pi/extensions/`,
  `createWorkspaceAgentApp` registers the tool, agent finds it via
  `/api/v1/agent/catalog`.

## Open questions

1. **Plugin client/server file split — env guard, package.json
   exports, or both?**
   The plan documents both; needs a final pick. Recommend env-guard
   (`process.env.SSR` or a build-tool conditional) for in-app
   plugins; package.json `exports` for npm-distributed plugins.

2. **What's the type of `onMount`'s cleanup return?**
   Option (a) `void | (() => void)` (sync). Option (b) `void |
   Promise<void> | (() => void | Promise<void>)`. (a) is simpler;
   (b) handles plugins that need async teardown but adds complexity.
   Recommend (a) for Phase 1; revisit if a plugin needs async
   cleanup.

3. **Does workspacePlugin's `agentTools` (UI bridge) belong here, or
   stay in @boring/agent's standardCatalog?**
   Today `get_ui_state`/`exec_ui` live in
   `packages/agent/src/server/catalog/standardCatalog.ts:92` (gated
   on a `uiBridge?` parameter). Migrating them into workspacePlugin
   reduces the agent package's surface area but adds a workspace
   dependency where boring-cli might want UI-less agents. Recommend:
   move them into workspacePlugin; standalone `createAgentApp` (no
   workspace) ships zero UI surface — already the goal of commit
   `4968e7d` from the recent UI bridge ownership refactor.

4. **`@boring/workspace/server`'s build situation.**
   Boring-macro currently inlines 150 LOC because the workspace
   package's `/server` export "isn't built (vite-plugin-dts crash +
   no tsup config)" (their comment). Phase 1 NEEDS a buildable
   workspace/server entry to ship workspacePlugin. Either fix the
   tsup config or accept temporary inlining in workspacePlugin
   itself. Recommend: fix the tsup config now; can't ship Phase 1
   without it.

5. **Do plugins get a sandboxed dependency injection, or share the
   parent's React tree directly?**
   Plugins live in the same React tree as the host. They can call
   any context (DataProvider, etc.) the host provides. This is
   simpler than sandboxing but means a misbehaving plugin can crash
   the whole tree. Phase 1: shared tree. Acceptable for v1.

6. **Should `createWorkspaceAgentApp` accept `plugins?` or require
   it?**
   Required. `[]` is valid (workspacePlugin still auto-mounts).
   Forces hosts to make a deliberate choice; prevents footguns.

7. **Discovery endpoint authentication?**
   The same auth as other agent routes. `/api/v1/plugins` requires
   a valid session cookie, like `/api/v1/agent/catalog` already
   does. Phase 2 concern, but worth flagging.

## Acceptance

- `Plugin` contract + `definePlugin` exported from
  `@boring/workspace`.
- `PluginRegistry` + `CatalogRegistry` subscribable; existing
  `CommandRegistry` + `PanelRegistry` retrofitted.
- `<WorkspaceProvider plugins={[…]}>` and
  `createWorkspaceAgentApp({ plugins: [...] })` are the only
  registration APIs hosts use.
- Pi loader extended to handle the wider Plugin shape; legacy pi
  plugins keep working.
- `workspacePlugin` ships with the package; UI bridge tools + uiRoutes
  + default panels + default commands move into it.
- `<CommandPalette />` renders catalogs from registered plugins; old
  `fileSearchFn`/`onOpenFile` props deleted; Recent type-mix bug
  fixed.
- Boring-macro-v2 migrated: ~40-line `macroPlugin.ts` replaces
  ~80 lines of glue + ~150 LOC of inlined UI bridge. Same
  user-visible behavior.
- Two breaking changes documented in release notes.
- Tests in §Test plan all pass.

## Reference

- Existing pi plugin loader:
  `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`
- Existing workspace `WorkspaceProvider`:
  `packages/workspace/src/WorkspaceProvider.tsx`
- Existing `<CommandPalette />`:
  `packages/workspace/src/components/CommandPalette.tsx`
- ExplorerAdapter shape (already used by DataExplorer):
  `packages/workspace/src/components/DataExplorer/types.ts`
- Boring-macro-v2 host:
  `/home/ubuntu/projects/boring-macro-v2/src/{server/index.ts,
  web/App.tsx, server/macroTools.ts, server/uiBridge.ts}`
- Superseded plan:
  `packages/workspace/docs/plans/COMMAND_PALETTE_REGISTRY.md`
