# Workspace plugin model

**Status:** v4 — clean spec
**Owners:** workspace
**Last updated:** 2026-04-28

## TL;DR

`@boring/workspace` becomes the orchestrator of a single, expandable
contribution model. A `Plugin` is a TypeScript shape — not an
installation channel — that bundles panels, commands, catalogs,
agent tools, server routes, and chat suggestions. Hosts compose
plugins; the workspace coordinates registration, lifecycle, and
file-pattern-driven panel resolution. Phase 1 ships **inline plugins
only** (host imports + passes to provider). Phase 2 adds npm
distribution + pi loader extension. Phase 3 adds agent-authored
plugins.

The model replaces five fragmented registration APIs with one. The
boring-macro-v2 migration is the acceptance test — ~80 lines of glue
+ ~150 lines of inlined UI bridge collapse to ~40 lines of plugin
definition.

## Scope of this plan

**Phase 1 (this PR's scope):**

- The `Plugin` contract + `definePlugin` factory
- Subscribe-aware registries (Plugin / Catalog / ChatSuggestion;
  retrofit Command + Panel)
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`
- `<WorkspaceProvider plugins={…}>` and
  `createWorkspaceAgentApp({ plugins })` entry points
- Inline plugin path only (host's source tree, explicit imports)
- Move file ops + UI bridge from `@boring/agent` to `@boring/workspace`
- `<CommandPalette />` consumes catalogs via the registry
- `<ChatCenteredShell />` migrated off imperative `useEffect`
  registrations
- boring-macro-v2 migrated to a single inline plugin

**Phase 2 (sketched, separate PR):** npm-installable plugins, pi
loader extension to read the wider `Plugin` shape, `/api/v1/plugins`
discovery endpoint, generic `search_catalog(id, q)` agent tool,
workbench data-tab catalog selector.

**Phase 3 (longer-term):** agent-authored plugins (`create_plugin` /
`update_plugin` agent tools), hot-reload, sandboxing.

## Problem

Boring-macro-v2 — the realest "child app" we have — contributes six
distinct kinds of things and wires them through five different APIs:

| Contribution | Macro's instance | Today's wiring |
|---|---|---|
| Panels | `chart-canvas`, `deck` | `<WorkspaceProvider panels={…}>` |
| Catalogs | Macro series catalog (87k FRED series) | `<ChatCenteredShell data={DataPaneConfig}>` |
| Agent tools | `execute_sql`, `macro_search`, `get_series_data`, `persist_derived_series` | `createAgentApp({ extraTools })` |
| Server routes | `registerMacroRoutes` | `app.register(registerMacroRoutes)` |
| Chat suggestions | "Find a series", "Plot Real GDP", … | `<ChatCenteredShell chatSuggestions={…}>` |
| Commands | (none today) | (would be) `useCommandRegistry().registerCommand` |

Plus ~150 LOC of `@boring/workspace`'s UI bridge code inlined into
`apps/boring-macro-v2/src/server/uiBridge.ts` because the workspace
package's server export isn't built. Inline is acceptable as a
workaround; it's also evidence that the workspace/agent boundary is
mis-drawn.

The pi-coding-agent already has a plugin loader
(`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`)
that handles **agent tools only** — `default: AgentTool[]` /
`tools: AgentTool[]` exports from `.pi/extensions/`,
`~/.pi/agent/extensions/`, and `node_modules/pi-plugin-*`. The
discovery infrastructure exists; the plugin shape is too narrow.

## Goal

1. **One Plugin contract.** Every contribution type a host produces
   fits into one declarative object.
2. **Workspace orchestrates.** Registration, lifecycle, file-pattern
   resolution, dependency validation all live in `@boring/workspace`.
3. **Composable.** File-pattern-driven panel resolution lets domain
   plugins bind their panes to their domain paths;
   late-wins-on-id lets hosts override anything at the abstraction
   level above.
4. **Honest boundaries.** Substrate is core, capabilities are
   plugins. Defaults auto-mount; opt-outs are explicit.
5. **Forward-compatible.** Phase 1's inline path doesn't paint the
   model into a corner — Phase 2's npm + pi-loader extensions slot
   in additively.

## Non-goals

- A plugin marketplace, signing, trust model, or capability
  sandbox.
- Hot-reload of plugins at runtime (Phase 1 — server boot loads,
  client boot loads; restart to add/remove).
- Cross-plugin dependency resolution beyond `dependsOn` /
  `optionalDeps` flat lists with late-wins-on-id collisions.
- Replacing the agent's runtime tools (`bash`, `read_directory`).
  Those are harness-level, not workspace-level. Stay in
  `@boring/agent`.
- Per-contribution dependency declarations
  (`PanelConfig.requiresPlugin`). Plugin-level dependencies cover
  Phase 1; per-contribution if surgical cases appear later.
- Cross-environment dynamic discovery in Phase 1 (the discovery
  endpoint is Phase 2).

## Design

### The Plugin contract

```ts
// @boring/workspace/shared/plugin.ts
import type { ReactNode } from "react"
import type { FastifyPluginCallback } from "fastify"
import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "@boring/workspace"

export interface Plugin {
  /** Stable id. Convention: package or app name. Used for
   *  dependsOn refs, late-wins-on-id, debug provenance. */
  id: string

  /** Human-readable, surfaced in discovery UIs. */
  label?: string

  /** Optional version, useful for diagnostics. */
  version?: string

  /** Hard dependencies — registry refuses to register if missing. */
  dependsOn?: string[]

  /** Soft dependencies — register but warn if missing. */
  optionalDeps?: string[]

  /** Mount priority. Lower = earlier. Default 100. Defaults are 0. */
  order?: number

  // ── Client-side contributions ──────────────────────────────────
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  chatSuggestions?: ChatSuggestion[]

  // ── Server-side contributions ──────────────────────────────────
  agentTools?: AgentTool[]
  routes?: FastifyPluginCallback[]

  /** Optional setup hook. Returns optional cleanup function. */
  onMount?: (ctx: PluginMountCtx) => void | (() => void)
}

export interface PluginMountCtx {
  bus: EventBus<WorkspaceEvents>
  bridge: UiBridge
  catalogs: CatalogRegistry
  commands: CommandRegistry
  panels: PanelRegistry
  chatSuggestions: ChatSuggestionRegistry
  /** Server-only — undefined on client. */
  agentTools?: AgentToolRegistry
  app?: FastifyInstance
}
```

### Concrete contribution types

```ts
// PanelConfig — extension of the existing type, adds source-of-truth provenance
type PanelConfig = {
  id: string
  title: string
  component: ComponentType<unknown>
  placement: "left" | "center" | "right"
  source?: "app" | "agent" | "user"
  icon?: ReactNode
  filePatterns?: string[]   // micromatch — drives openFile resolution
  pluginId?: string         // set automatically by registry; do not set manually
}

// CommandConfig — already exists, add pluginId provenance
type CommandConfig = {
  id: string
  title: string
  shortcut?: string
  when?: () => boolean
  run: () => void
  pluginId?: string
}

// CatalogConfig — new
type CatalogConfig = {
  id: string
  label: string
  recentKind: string                       // routes Recent entries back
  adapter: ExplorerAdapter                 // existing DataExplorer type
  onSelect: (row: ExplorerRow) => void
  paletteIcon?: ReactNode                  // distinct from ExplorerRow.leading Badge
  paletteLimit?: number                    // default 5
  order?: number                           // default 100
  pluginId?: string
}

// ChatSuggestion — already exists in @boring/agent/ui-shadcn
type ChatSuggestion = {
  label: string
  hint?: string
  icon?: ComponentType<{ className?: string }>
  prompt: string
}

// AgentTool — already exists in @boring/agent/shared
// FastifyPluginCallback — Fastify standard
```

`pluginId` is set automatically by `PluginRegistry` on register;
plugin code never assigns it. Late-wins-on-id collisions log a
dev-mode warning identifying both contributors.

### `definePlugin(spec)`

```ts
import { definePlugin } from "@boring/workspace"

export const macroPlugin = definePlugin({
  id: "boring-macro",
  dependsOn: ["filesystem"],            // deck panel reads files
  panels: [chartCanvasPanel, deckPanel],
  catalogs: [seriesCatalog],
  agentTools: macroAgentTools,
  routes: [registerMacroRoutes],
  chatSuggestions: macroChatSuggestions,
})
```

Validation runs at definition time, not mount time. Errors include
plugin id + contribution kind + bad field:

```
PluginValidationError: plugin "boring-macro": catalogs[0].adapter.search
must be a function (got: undefined)
```

Per-type validators (`validatePanel`, `validateCommand`,
`validateCatalog`, `validateChatSuggestion`, `validateAgentTool`) live
in `@boring/workspace/src/plugin/validators.ts`. `validateAgentTool`
is the existing `validateTool` from `pluginLoader.ts:60`, moved into
the workspace package.

### Error model

| Failure | When | Response |
|---|---|---|
| `PluginValidationError` | At `definePlugin` call (typo, missing field) | Throw immediately. Host build/dev fails to start. |
| `PluginRegistrationError: missing dep` | At `register` if `dependsOn` lists an unknown plugin | Throw at registration. Provider mount fails with a useful error. |
| `PluginRegistrationError: id collision` | At `register` with same id as already-registered | Late wins on id (replace). Dev-mode `console.warn` lists what was replaced. |
| `PluginMountError` | If `onMount` throws | Catch, log, emit `plugin:error` on the bus. Plugin's contributions stay registered; cleanup not stored. Other plugins unaffected. |
| `PluginContributionError` | If a single contribution fails at runtime (e.g. catalog adapter throws on `.search`) | Per-contribution try/catch isolates. Other plugins unaffected. UI shows inline error chip. |

A misbehaving plugin can never crash the workspace, but it can
produce degraded UX. The provider exposes an `errors: PluginError[]`
field for debug surfaces.

### Default plugins — TWO, finalized

| Plugin | Contributes | Why a plugin (not core) |
|---|---|---|
| **`filesystemPlugin`** | Agent tools (`find_files`, `read_file`, `write_file`, `edit_file`); routes (`/api/v1/files`, `/tree`, `/files/search`); a Files catalog; FileTree panel registration; CodeEditor + MarkdownEditor panel registrations (with `filePatterns`) | Domain capability hosts can omit (UI-only apps, sandboxed deployments). When excluded: file routes 404, FileTree disappears, code/markdown editors stop auto-routing. |
| **`dataCatalogPlugin`** | DataExplorer panel registration (workbench data tab); Phase 2: `search_catalog(id, q)` generic agent tool | Apps without catalog browsing don't need the data tab. Real opt-out. |

Both auto-mount. Hosts opt out via:

```tsx
<WorkspaceProvider
  plugins={[macroPlugin]}
  excludeDefaults={["filesystem"]}    // or ["dataCatalog"], or []
>
```

### Core — substrate, not plugins

Always present. Not pluggable. Replacing core by accident shouldn't be possible.

- Registries (Plugin / Catalog / Command / Panel / ChatSuggestion)
- EventBus (per `UNIFIED_EVENT_BUS.md`)
- UiBridge (in-memory message queue; lives in `@boring/workspace/src/bridge/`)
- React component primitives: `CodeEditor`, `MarkdownEditor`, `FileTree`,
  `DataExplorer`, `EmptyPane` (the components themselves are core
  exports; their **panel registrations** with `filePatterns` belong to
  the relevant default plugin)
- Default agent tools that expose the substrate: `get_ui_state`,
  `exec_ui` (registered directly by `createWorkspaceAgentApp`, not
  via a plugin)
- Default routes: `/api/v1/ui/*` (uiRoutes — registered directly)
- Default commands: `toggleSidebar`, `toggleAgentPanel`, `closeTab`
  (registered directly by `WorkspaceProvider`)
- Chat shell + palette + workbench themselves
- ChatPanel mount point (chat is foundational to the boring shell)

**The general rule: substrate is core, capabilities are plugins.**

### Plugin composability — dependencies + file-pattern resolution

Two mechanisms compose to give plugins their power.

**Dependency declarations.** Plugin-level only in Phase 1.

```ts
// hard — registry refuses to load if missing
dependsOn?: string[]
// soft — registers; dev-mode warn if missing
optionalDeps?: string[]
```

Convention (rules of thumb for code review):

1. Domain plugins depend on **defaults** (`filesystem` /
   `dataCatalog`), not on other domain plugins.
2. Most hosts won't notice dependencies because defaults auto-mount.
3. Inter-domain dependencies are a refactoring smell — extract the
   shared piece into core or a shared plugin.
4. Refusing to register beats silent broken UI. `dependsOn` errors
   point at the offending plugin at boot.

**File-pattern panel resolution.** When `openFile(path)` runs:

1. Filter panels whose `filePatterns` include `path` (micromatch).
2. Sort by **specificity** — longer/more-anchored patterns win
   (`deck/*.md` > `*.md`; `**/*.deck.md` > `*.md`).
3. Within same specificity: registration order, late wins.
4. Hosts can bypass pattern matching at the call site:
   `surface.openPanel({ component: "<id>", … })`.

Three composition shapes this enables (canonical examples):

```
1. ADD a domain pane for a domain path
   filesystem: { id: "markdown-editor", patterns: ["*.md"] }
   macro:      { id: "deck",            patterns: ["deck/**/*.md"] }
   notes.md       → MarkdownEditor (default)
   deck/labor.md  → DeckPane         (specificity wins)

2. REPLACE a default pane (late-wins-on-id)
   filesystem:  { id: "code-editor", component: CodeEditor,    patterns: ["*.ts"] }
   superCoder:  { id: "code-editor", component: SuperCoder,    patterns: ["*.ts"] }
   any *.ts → SuperCoder (same id ⇒ replaces)

3. ADD a SECOND pane available for the same file
   filesystem:    { id: "code-editor", patterns: ["*.json"] }
   schemaViewer:  { id: "schema-view", patterns: ["*.json"] }
   user picks via panel-switcher; opening code chooses one explicitly
```

Each plugin owns its file-type ↔ pane binding. Hosts compose plugins
to compose extensions.

### Workspace orchestration — registries + lifecycle

`PluginRegistry` is the umbrella. Per-contribution registries
(`CatalogRegistry`, `CommandRegistry`, `PanelRegistry`,
`ChatSuggestionRegistry`) are the consumers. All registries use
`useSyncExternalStore` so React subscribers track register/unregister
cycles.

```
PluginRegistry.register(p):
  1. Validate dependsOn (throw on missing)
  2. Warn on optionalDeps missing
  3. Fan plugin.panels → PanelRegistry (set pluginId provenance)
  4. Fan plugin.commands → CommandRegistry
  5. Fan plugin.catalogs → CatalogRegistry
  6. Fan plugin.chatSuggestions → ChatSuggestionRegistry
  7. (server) Fan plugin.agentTools → AgentToolRegistry
  8. (server) Register plugin.routes via app.register(...)
  9. Call plugin.onMount(ctx) if present; store cleanup
  10. Emit plugin:registered on EventBus
  11. Notify subscribers

PluginRegistry.unregister(id):
  1. Call stored cleanup
  2. Remove fanned-in items by sourcePluginId
  3. Emit plugin:unregistered
  4. Notify
```

The retrofit applies to existing `CommandRegistry` and
`PanelRegistry` — they get `subscribe()` semantics so late
`registerCommand` calls reach an open palette.

### Inline plugin layout (Phase 1)

```
apps/<some-app>/
├── package.json
├── src/
│   ├── plugin/
│   │   ├── index.ts            ← env-aware barrel
│   │   ├── plugin.shared.ts    ← id, dependsOn, types, fixed config
│   │   ├── plugin.client.ts    ← panels, catalogs, commands, suggestions
│   │   └── plugin.server.ts    ← agentTools, routes
│   ├── server/index.ts         ← createWorkspaceAgentApp({ plugins: [appPlugin] })
│   └── web/App.tsx             ← <WorkspaceProvider plugins={[appPlugin]}>
```

`index.ts` uses environment guards or per-environment package.json
exports so Vite picks `client.ts` and Node picks `server.ts`. Same
pattern as Next.js / Remix / SvelteKit.

For multi-plugin apps: `src/plugins/<id>/...` mirrors per plugin;
`src/plugins/index.ts` exports an array.

### Entry points

```ts
// CLIENT
import { WorkspaceProvider } from "@boring/workspace"
import { macroPlugin } from "./plugin"

<WorkspaceProvider plugins={[macroPlugin]}>
  <App />
</WorkspaceProvider>

// SERVER
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { macroPlugin } from "./plugin"

const app = await createWorkspaceAgentApp({
  workspaceRoot,
  plugins: [macroPlugin],
  // includeDefaults: ["filesystem", "dataCatalog"]   // default
  // excludeDefaults: ["dataCatalog"]                  // optional opt-out
})
await app.listen({ port })
```

Both entry points auto-mount default plugins (filesystem +
dataCatalog) unless excluded. Both call into the same `PluginRegistry`
underneath; client and server tracks are independent (coupled by
plugin id, not by shared state).

### Event bus integration

Plugins are about **registration**; the bus is about
**communication**. They meet at three points (see
`UNIFIED_EVENT_BUS.md` for bus details):

1. **`PluginMountCtx.bus`** lets `onMount` subscribe + emit.
2. **Lifecycle events on the bus** —
   `plugin:registered`/`plugin:unregistered`/`plugin:error` plus
   per-contribution-type events (`catalog:registered`, etc.).
3. **Discovery endpoint emits one-shot `plugins:discovered`** event
   when fetched (Phase 2).

Bus is client-only. Server-side plugin contributions communicate via
Fastify hooks or HTTP routes — not a workspace-wide primitive.

## Reorganization (file moves)

Things move from `@boring/agent` to `@boring/workspace` to draw an
honest boundary. Each move is a self-contained refactor; the plugin
model rides on top.

| From `@boring/agent` | To `@boring/workspace` | Lands as |
|---|---|---|
| `src/server/catalog/standardCatalog.ts` — file ops (`find_files`, `read_file`, `write_file`, `edit_file`) | `@boring/workspace/server/...` | `filesystemPlugin.agentTools` |
| `src/server/catalog/standardCatalog.ts` — UI bridge tools (`get_ui_state`, `exec_ui`) | `@boring/workspace/server/uiTools.ts` | Core (registered directly by `createWorkspaceAgentApp`) |
| `src/server/http/routes/{file,tree,search}.ts` | `@boring/workspace/server/routes/files.ts` | `filesystemPlugin.routes` |
| `src/server/http/routes/ui.ts` | `@boring/workspace/server/routes/ui.ts` | Core (registered directly) |
| `src/shared/ui-bridge.ts` (`UiState`, `UiCommand` types) | `@boring/workspace/src/shared/ui-bridge.ts` | Core types |
| `src/server/ui-bridge/createInMemoryBridge.ts` | `@boring/workspace/src/bridge/createInMemoryBridge.ts` | Core |

`@boring/agent` keeps:

- `pi-coding-agent` harness (LLM loop, sessions, models)
- `AgentTool` type (shared contract)
- Pi loader (legacy tools-only behavior; Phase 2 extends it)
- `bash`, `read_directory` tools (truly harness-level)
- Chat / session / model HTTP routes
- `createAgentApp` (no UI surface — UI-less hosts use this directly)

Boundary after the moves: `@boring/agent` = "harness";
`@boring/workspace` = "workspace surface + plugin model."

## Exact path: now → Phase 1 done

Five sequenced commits. Each is independently reviewable; only step 0
is a hard blocker.

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 0 — BLOCKER                                                │
│  fix(workspace): tsup-build the @boring/workspace/server export  │
│  ─────────────────────────────────────────────────────────────── │
│  Resolve zod peer + vite-plugin-dts crash. Workspace's /server   │
│  becomes import-able; boring-macro's inline uiBridge.ts becomes  │
│  redundant immediately. ETA: 0.5–1 day.                          │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1 — REORG (no plugin model yet, pure refactor)             │
│  ─────────────────────────────────────────────────────────────── │
│  1a. UI bridge ownership refactor (per existing plan doc)        │
│      Move ui-bridge types/tools/routes from @boring/agent →      │
│      @boring/workspace. boring-macro deletes its 150-LOC inline  │
│      copy. Independently valuable; lands as one PR.              │
│                                                                  │
│  1b. File ops migration                                          │
│      Move find_files/read_file/write_file/edit_file from         │
│      standardCatalog → @boring/workspace/server. Move file/tree/ │
│      search routes similarly. Hosts that wanted them via         │
│      createAgentApp now get them via createWorkspaceAgentApp     │
│      (added in step 4). standardCatalog keeps bash, read_dir.    │
│                                                                  │
│  Deliverable: @boring/agent's surface is "harness only";         │
│  @boring/workspace owns workspace-flavored code, but neither     │
│  bundles into Plugins yet — they're standalone modules.          │
│  ETA: 1–2 days.                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 2 — PLUGIN PRIMITIVES                                      │
│  ─────────────────────────────────────────────────────────────── │
│  2a. Plugin type + definePlugin + validators                     │
│      packages/workspace/src/plugin/{types,definePlugin,          │
│      validators}.ts                                              │
│                                                                  │
│  2b. PluginRegistry + CatalogRegistry +                          │
│      ChatSuggestionRegistry (subscribe-aware)                    │
│      packages/workspace/src/plugin/{Plugin,Catalog,              │
│      ChatSuggestion}Registry.ts                                  │
│                                                                  │
│  2c. Subscribe retrofit for existing CommandRegistry +           │
│      PanelRegistry                                               │
│                                                                  │
│  Deliverable: types compile; registries pass unit tests;         │
│  no consumer wired yet. ETA: 1–1.5 days.                         │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 3 — DEFAULT PLUGINS                                        │
│  ─────────────────────────────────────────────────────────────── │
│  3a. filesystemPlugin (wraps step-1b code)                       │
│      packages/workspace/src/plugin/defaults/filesystemPlugin.ts  │
│      contributes: file ops + routes + Files catalog +            │
│      FileTree/CodeEditor/MarkdownEditor panel registrations      │
│                                                                  │
│  3b. dataCatalogPlugin                                           │
│      packages/workspace/src/plugin/defaults/dataCatalogPlugin.ts │
│      contributes: DataExplorer panel registration                │
│                                                                  │
│  Deliverable: definePlugin({...}) calls work; plugins import     │
│  cleanly. ETA: 0.5 day.                                          │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 4 — ENTRY POINTS                                           │
│  ─────────────────────────────────────────────────────────────── │
│  4a. <WorkspaceProvider plugins={…}>                             │
│      Adds plugins prop + excludeDefaults prop. Auto-registers    │
│      defaults; fans contributions into registries. Mounts        │
│      <CommandPalette /> as before.                               │
│                                                                  │
│  4b. createWorkspaceAgentApp({ plugins })                        │
│      Wraps createAgentApp. Auto-registers defaults (server-side  │
│      contributions). Fans agentTools into createAgentApp's       │
│      extraTools; registers routes via app.register.              │
│                                                                  │
│  Deliverable: a host can pass plugins and watch them register.   │
│  ETA: 1 day.                                                     │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 5 — CONSUMER REFACTORS                                     │
│  ─────────────────────────────────────────────────────────────── │
│  5a. <CommandPalette /> consumes useCatalogs()                   │
│      Drop dead fileSearchFn / onOpenFile props. Drop             │
│      type-mismatched Recent path. Files becomes the first        │
│      catalog (provided by filesystemPlugin).                     │
│                                                                  │
│  5b. ChatCenteredShell migration                                 │
│      Drop imperative useEffect command registration. Internal    │
│      "chat-shell" plugin defined inline registers toggleDrawer   │
│      / toggleSurface / newChat as commands. Sessions become a    │
│      SessionsCatalog when shell receives sessions +              │
│      onSwitchSession.                                            │
│                                                                  │
│  Deliverable: cmd palette + chat shell entirely on the new      │
│  registry. Two breaking changes (CommandPaletteProps export,    │
│  withCommandPalette shell prop) shipped; release notes drafted. │
│  ETA: 1 day.                                                     │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 6 — ACCEPTANCE: BORING-MACRO MIGRATION                     │
│  ─────────────────────────────────────────────────────────────── │
│  apps/boring-macro-v2/src/plugin/                                │
│  ├── plugin.shared.ts                                            │
│  ├── plugin.client.ts (panels, catalog, suggestions)             │
│  ├── plugin.server.ts (agentTools, routes)                       │
│  └── index.ts                                                    │
│                                                                  │
│  apps/boring-macro-v2/src/server/index.ts uses                   │
│    createWorkspaceAgentApp({ plugins: [macroPlugin] })           │
│  apps/boring-macro-v2/src/web/App.tsx uses                       │
│    <WorkspaceProvider plugins={[macroPlugin]}>                   │
│  Delete src/server/uiBridge.ts (now in core).                    │
│  Delete the inline DataPaneConfig / panel / chatSuggestions      │
│  config from App.tsx (now in macroPlugin).                       │
│                                                                  │
│  Deliverable: ~80 + ~150 LOC of glue and inlined bridge → ~40    │
│  LOC of plugin file. boring-macro behaves exactly the same.      │
│  Acceptance test for the model: if this migration isn't a clean  │
│  reduction, the design is wrong. ETA: 0.5–1 day.                 │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 7 — TESTS + RELEASE NOTES                                  │
│  ─────────────────────────────────────────────────────────────── │
│  Tests per §Test plan. Release notes documenting the two         │
│  breaking changes. ETA: 1–2 days.                                │
└──────────────────────────────────────────────────────────────────┘

TOTAL: ~6–9 days of focused work, sequenced after the event bus
       implementation lands.
```

## Phase 2/3 (sketched, deferred)

**Phase 2 — distributable plugins:**
- Extend pi loader: `extractTools` → `extractPlugin`. Files in
  `.pi/extensions/` and `node_modules/pi-plugin-*` can export the
  full `Plugin` shape. Legacy plugins keep working unchanged.
- `GET /api/v1/plugins` discovery endpoint. Server-authoritative
  manifest exposing the registered plugin set + their contributions.
  System-prompt augmentation derives from this.
- Workbench data tab gains catalog selector — picks any registered
  catalog instead of taking a per-shell `DataPaneConfig`.
- Generic `search_catalog(id, query)` agent tool, auto-generated
  from registered catalogs (server-side; bridge-routed for
  client-only).
- npm authoring guide + reference plugin (`pi-plugin-example`).

**Phase 3 — agent-authored + dynamic:**
- `create_plugin` / `update_plugin` / `remove_plugin` /
  `list_plugins` agent tools. Generated files in
  `.pi/extensions/.agent-authored/`. Restart-required initially.
- Plugin hot-reload for development.
- Per-contribution dependency declarations
  (`PanelConfig.requiresPlugin`).
- Per-plugin sandboxing / capability flags.

## Test plan

- **Unit**
  - `definePlugin` validation: well-formed plugin passes; malformed
    contributions throw with field-level errors.
  - Registry lifecycle: register/unregister/list ordering;
    subscribe fires; cleanup runs; `dependsOn` rejects missing
    deps; late-wins-on-id replaces.
  - Subscribable retrofit: late `register` after consumer subscribed
    triggers re-render.
  - File-pattern resolution: specificity ordering correct;
    same-specificity → late-wins; explicit `surface.openPanel`
    bypasses.

- **Integration**
  - `<WorkspaceProvider plugins={[testPlugin]}>` →
    catalog/command/panel/chatSuggestion all reachable via
    their hooks.
  - `createWorkspaceAgentApp({ plugins: [testPlugin] })` exposes
    `agentTools` in agent catalog endpoint; registers routes.
  - Cmd palette renders catalogs from registered plugins;
    error-isolated per group.
  - `excludeDefaults` actually excludes; `dependsOn` errors at
    boot when an excluded default is required.

- **E2E**
  - boring-macro-v2 migrated: open the deployed app, search a
    series, click → chart panel opens. Same surface area as
    today.

## Acceptance

- `Plugin` contract + `definePlugin` exported from
  `@boring/workspace`.
- `PluginRegistry`, `CatalogRegistry`, `ChatSuggestionRegistry`
  subscribable; existing `CommandRegistry` + `PanelRegistry`
  retrofitted.
- `<WorkspaceProvider plugins={[…]}>` and
  `createWorkspaceAgentApp({ plugins: [...] })` are the only
  registration APIs hosts use.
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`. Both
  auto-mount; both individually opt-out-able.
- `<CommandPalette />` renders catalogs from plugins; old
  `fileSearchFn`/`onOpenFile` props removed; Recent type-mix bug
  fixed.
- `<ChatCenteredShell />` registers its commands declaratively via
  an internal plugin; imperative useEffect block deleted.
- `boring-macro-v2` migrated: ~40-line plugin file replaces ~80
  lines of glue + ~150 lines of inlined UI bridge. Same
  user-visible behavior.
- Two breaking changes (`CommandPaletteProps`,
  `ChatCenteredShellProps.withCommandPalette`) documented.
- Phase 1 test plan all green.

## Open questions

1. **Plugin client/server file split — env guard or package.json
   exports?** Both work. Inline plugins use env guard; npm-published
   plugins (Phase 2) use package.json `exports`. Documented both.
2. **`onMount` cleanup return: sync or async?** Phase 1 = sync only
   (`void | (() => void)`). Async deferred unless a real plugin
   needs it.
3. **Discovery endpoint authentication?** Same as other agent routes
   (session cookie). Phase 2 concern; flagged.
4. **`includeDefaults`/`excludeDefaults` — both, or one or the
   other?** Recommend `excludeDefaults` (denylist) only. Allowlist
   would force every host to opt in to defaults explicitly —
   defeats the point. Both fields → confusing precedence.
5. **What does `createWorkspaceAgentApp` do when running in a
   monorepo with multiple workspaces and pi loader sees plugins
   from a sibling app?** Phase 1: pi loader's existing behavior
   unchanged (only reads tools-only legacy shape). Phase 2:
   address when extending the loader.

## Reference

- Existing pi plugin loader:
  `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`
- Existing `WorkspaceProvider`:
  `packages/workspace/src/WorkspaceProvider.tsx`
- Existing `<CommandPalette />`:
  `packages/workspace/src/components/CommandPalette.tsx`
- ExplorerAdapter (catalog adapter contract):
  `packages/workspace/src/components/DataExplorer/types.ts`
- Boring-macro-v2 host (the migration target):
  `/home/ubuntu/projects/boring-macro-v2/src/{server/index.ts,
  web/App.tsx, server/macroTools.ts, server/uiBridge.ts}`
- Sibling plans:
  - `UNIFIED_EVENT_BUS.md` — bus model; required by Phase 1
  - `UI_BRIDGE_OWNERSHIP_REFACTOR.md` — step 1a of this plan
- Superseded plan: `COMMAND_PALETTE_REGISTRY.md`
