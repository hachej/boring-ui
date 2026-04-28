# Workspace plugin model

**Status:** v5.2 — round-2 codex review patches (validateTool node-leak P0, client surface API vs server bridge P1, SurfaceShell hardcoded fallback P1, missing events subpath P1, stale text P2s)
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
boring-macro-v2 migration is the acceptance test — ~260 LOC of glue
+ inlined UI bridge collapse to ~40 LOC of plugin definition (~85%
reduction; see §"Concrete before/after").

## Scope of this plan

**Phase 1 (this PR's scope):**

- The `Plugin` contract + `definePlugin` factory + factory pattern for stateful plugins
- Subscribe-aware registries (Plugin / Catalog / ChatSuggestion;
  retrofit Command + Panel)
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`
- `<WorkspaceProvider plugins={…}>` and
  `createWorkspaceAgentApp({ plugins })` entry points
- Inline plugin path only (host's source tree, explicit imports)
- File ops shared bundle in `@boring/agent`; filesystemPlugin
  references the same bundle (no duplication, standalone agent stays
  a real coding agent)
- UI bridge moves from `@boring/agent` to `@boring/workspace`
- Path-aware (not basename-only) file-pattern panel resolver
- `WorkbenchLeftPane` becomes registry-driven so `excludeDefaults`
  actually removes default tabs (Files / Data)
- `<CommandPalette />` consumes catalogs via the registry
- Polymorphic Recent (entries tagged with their source catalog)
- `<ChatCenteredShell />` migrated off imperative `useEffect`
  registrations AND off the legacy `data` / `extraPanels` props
- `<PluginInspector />` debug overlay (DEV-only)
- boring-macro-v2 migrated to a single inline plugin

**Phase 2 (sketched, separate PR):** npm-installable plugins, pi
loader extension to read the wider `Plugin` shape, `/api/v1/plugins`
discovery endpoint, generic `search_catalog(id, q)` agent tool,
workbench data-tab catalog selector.

**Phase 3 (longer-term):** agent-authored plugins (`create_plugin` /
`update_plugin` agent tools), hot-reload, sandboxing, capability
flags.

## Problem

Boring-macro-v2 — the realest "child app" we have — contributes six
distinct kinds of things and wires them through five different APIs:

| Contribution | Macro's instance | Today's wiring |
|---|---|---|
| Panels | `chart-canvas`, `deck` | `<WorkspaceProvider panels={…}>` |
| Catalogs | Macro series catalog (87k FRED series) | `<ChatCenteredShell data={DataPaneConfig}>` |
| Agent tools | `execute_sql`, `macro_search`, `get_series_data`, `persist_derived_series` | `createAgentApp({ extraTools })` |
| Server routes | `registerMacroRoutes` (takes `{ clickhouse, deckRoot }`) | `app.register(registerMacroRoutes, { … })` |
| Chat suggestions | "Find a series", "Plot Real GDP", … | `<ChatCenteredShell chatSuggestions={…}>` |
| Commands | (none today) | (would be) `useCommandRegistry().registerCommand` |

Plus ~150 LOC of `@boring/workspace`'s UI bridge code inlined into
`apps/boring-macro-v2/src/server/uiBridge.ts` (still present at 9.3 KB
on disk — confirmed). The workspace package's server export now
builds; the inlined copy is dead weight that this plan deletes
during Step 6.

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
   plugins. Defaults auto-mount; opt-outs are explicit and **really
   take effect** — including UI tabs, not just commands/catalogs.
5. **Forward-compatible.** Phase 1's inline path doesn't paint the
   model into a corner — Phase 2's npm + pi-loader extensions slot
   in additively.

## Non-goals

- A plugin marketplace, signing, trust model, or capability
  sandbox.
- Hot-reload of plugins at runtime (Phase 1 — server boot loads,
  client boot loads; restart to add/remove). **Server-side caveat:**
  Fastify routes are boot-time-only and cannot be unregistered;
  `unregister()` removes registry entries (so palettes/catalogs
  update) but Fastify routes stay live until app close. Documented
  not solved.
- Cross-plugin dependency resolution beyond `dependsOn` /
  `optionalDeps` flat lists with late-wins-on-id collisions; no
  semver ranges in Phase 1 (string id match only).
- Replacing the agent's runtime tools (`bash`,
  `execute_isolated_code`). Those are harness-level, not
  workspace-level. Stay in `@boring/agent`. (No `read_directory`
  tool exists — directory listing is covered by `find_files` and
  the workspace's `/api/v1/tree` route.)
- Per-contribution dependency declarations
  (`PanelConfig.requiresPlugin`). Plugin-level dependencies cover
  Phase 1; per-contribution if surgical cases appear later.
- Cross-environment dynamic discovery in Phase 1 (the discovery
  endpoint is Phase 2).
- Inline plugin sandboxing or capability gating. Inline plugins run
  with full host privileges (see §Security stance).

## Design

### The Plugin contract

```ts
// @boring/workspace/shared/plugin.ts
import type { ComponentType, ReactNode } from "react"
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
} from "fastify"
import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "@boring/workspace"

export type MaybePromise<T> = T | Promise<T>
export type Cleanup = () => MaybePromise<void>

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

  /** Mount priority. Lower = earlier. Default 100. Defaults are 0.
   *  See §"Order semantics — registration vs conflict resolution". */
  order?: number

  // ── Client-side contributions ──────────────────────────────────
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  chatSuggestions?: ChatSuggestion[]

  // ── Server-side contributions ──────────────────────────────────
  agentTools?: AgentTool[]
  routes?: RouteRegistration[]

  /** Optional setup hook. Async-capable; cleanup may be async too.
   *  Runs after declarative contributions are registered. */
  onMount?: (ctx: PluginMountCtx) => MaybePromise<void | Cleanup>
}

/** Routes carry their own opts so plugins like macro
 *  (`registerMacroRoutes(app, { clickhouse, deckRoot })`) work
 *  without an escape hatch. */
export interface RouteRegistration<TOpts = unknown> {
  plugin: FastifyPluginAsync<TOpts> | FastifyPluginCallback<TOpts>
  opts?: TOpts
  prefix?: string
}

export interface PluginMountCtx {
  /** Module-singleton bus (same instance as
   *  `import { events } from "@boring/workspace/events"`). Injected
   *  for testability and discoverability — plugins MAY also import it
   *  directly. Type is `EventBus<WorkspaceEventMap>`. */
  bus: EventBus<WorkspaceEventMap>

  /** CLIENT action surface — how plugins open files/panels and
   *  drive the workbench. Exposed by WorkspaceProvider; the actual
   *  shape is supplied by the active <SurfaceShell>'s ref. Step 4a
   *  promotes this from internal context to the plugin contract.
   *  Server-side mount: `surface` is undefined. */
  surface?: WorkspaceSurface
  catalogs: CatalogRegistry
  commands: CommandRegistry
  panels: PanelRegistry
  chatSuggestions: ChatSuggestionRegistry
  /** SERVER-only — the agent UI command queue (UiBridge in
   *  `packages/workspace/src/shared/ui-bridge.ts`). Undefined on
   *  client. NOT for plugin client code; client uses `surface`. */
  bridge?: UiBridge
  agentTools?: AgentToolRegistry
  app?: FastifyInstance
}

/** Stable client action surface contributed by the active SurfaceShell.
 *  Codifies the existing imperative methods (openFile, openPanel,
 *  closeTab, …) so plugins don't have to reach for refs. */
export interface WorkspaceSurface {
  openFile(path: string, opts?: { panelId?: string }): void
  openPanel(spec: { component: string; params?: unknown; title?: string }): void
  closeTab(panelId: string): void
  // …grow this conservatively; one new method per real plugin need
}
```

### Concrete contribution types

```ts
// PanelConfig — already a discriminated union in
// packages/workspace/src/registry/types.ts. v5.1 PRESERVES the
// existing shape; the plugin model only ADDS fields:
//   - 'left-tab' | 'right-tab' to placement (for registry-driven tabs)
//   - tabOrder?: number (tab strip ordering)
//   - pluginId?: string (auto-set provenance)
// Existing fields kept verbatim: SyncPanelConfig vs LazyPanelConfig
// discriminated by `lazy: true | false`, requiresCapabilities,
// essential, chromeless, source: 'builtin' | 'app', definePanel<T> factory.

interface PanelConfigBase {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  placement?: "left" | "center" | "right" | "bottom" | "left-tab" | "right-tab"
  filePatterns?: string[]                  // Step 2d: path-aware micromatch
  requiresCapabilities?: string[]
  essential?: boolean
  source?: "builtin" | "app"
  chromeless?: boolean
  /** Tab ordering within left-tab/right-tab. Default 100. NEW. */
  tabOrder?: number
  /** Set automatically by registry; do not set manually. NEW. */
  pluginId?: string
}
interface SyncPanelConfig<T = unknown> extends PanelConfigBase {
  component: ComponentType<PaneProps<T>>
  lazy?: false
}
interface LazyPanelConfig<T = unknown> extends PanelConfigBase {
  component: () => Promise<{ default: ComponentType<PaneProps<T>> }>
  lazy: true
}
type PanelConfig<T = unknown> = SyncPanelConfig<T> | LazyPanelConfig<T>
// `definePanel<T>(config)` — existing identity-helper factory stays the
// canonical authoring API; plugin model wraps it (no replacement).

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
  /** Stable string used to tag Recent entries — see §Polymorphic Recent.
   *  Multiple catalogs MAY share the same recentKind on purpose
   *  (e.g., two filesystem-flavored catalogs both rendering Recent
   *  entries as file paths). When two catalogs share recentKind:
   *  Recent entries store both `catalogId` AND `recentKind`, so the
   *  exact source catalog wins on render; if the source catalog is
   *  unregistered, fall back to ANY currently-registered catalog with
   *  the same recentKind for rendering (graceful degradation). */
  recentKind: string
  adapter: ExplorerAdapter                 // existing DataExplorer type
  onSelect: (row: ExplorerRow) => void
  /** Optional: render a row in the Recent section. Defaults to the
   *  catalog's adapter row renderer. */
  renderRecentRow?: (row: ExplorerRow) => ReactNode
  paletteIcon?: ReactNode                  // distinct from ExplorerRow.leading Badge
  paletteLimit?: number                    // default 5
  order?: number                           // default 100
  pluginId?: string
}

// ChatSuggestion — already exists in @boring/agent/ui-shadcn.
// Preserve current shape — `prompt` is OPTIONAL (some suggestions
// only set focus / open a panel without sending a prompt).
type ChatSuggestion = {
  label: string
  hint?: string
  icon?: ComponentType<{ className?: string }>
  prompt?: string
  /** Custom action — runs instead of (or alongside) prompt submission. */
  onSelect?: () => void
}

// AgentTool — already exists in @boring/agent/shared
```

`pluginId` is set automatically by `PluginRegistry` on register;
plugin code never assigns it. Late-wins-on-id collisions log a
dev-mode warning identifying both contributors.

### `definePlugin(spec)` and the factory pattern

Two distribution shapes for inline plugins:

**Stateless plugins** — `definePlugin({ ... })` directly:

```ts
import { definePlugin } from "@boring/workspace"

export const formattingPlugin = definePlugin({
  id: "formatting",
  label: "Formatting",
  commands: [{ id: "format.json", title: "Format JSON", run: () => /*…*/ }],
})
```

**Stateful plugins** — wrap `definePlugin` in a factory function so
the host can pass runtime deps (DB clients, config paths, secrets):

```ts
import { definePlugin } from "@boring/workspace"
import type { ClickHouseClient } from "@clickhouse/client"

interface MacroDeps {
  clickhouse?: ClickHouseClient   // server-only
  deckRoot?: string               // server-only
}

export const makeMacroPlugin = (deps: MacroDeps = {}) =>
  definePlugin({
    id: "boring-macro",
    label: "Macro",
    dependsOn: ["filesystem"],
    panels: [chartCanvasPanel, deckPanel],
    catalogs: [seriesCatalog],
    chatSuggestions: macroChatSuggestions,
    agentTools: macroAgentTools,
    routes: deps.clickhouse && deps.deckRoot
      ? [{ plugin: registerMacroRoutes, opts: { clickhouse: deps.clickhouse, deckRoot: deps.deckRoot } }]
      : undefined,
    onMount: ({ bus, surface }) => {
      // Use the live bus API: events.on() returns an unsubscribe.
      const off = bus.on("file:moved", ({ from, to }) => {
        // example: re-open the moved file in its new location
        surface?.openFile(to)
      })
      return () => off()
    },
  })

// Server entry
const clickhouse = await createClickHouseClient(env)
const macroPlugin = makeMacroPlugin({ clickhouse, deckRoot: env.MACRO_DECK_ROOT })
await createWorkspaceAgentApp({ plugins: [macroPlugin] })

// Client entry
import { makeMacroPlugin } from "../plugin"
const macroPlugin = makeMacroPlugin()  // no server deps; client gets the UI half
```

The factory is **the canonical pattern** for stateful plugins. We
deliberately don't ship a `definePluginFactory` helper — a regular
function returning `Plugin` is clearer, type-checked, and
familiar (it's just a constructor).

Validation runs at `definePlugin` call time, not at mount time.
Errors include plugin id + contribution kind + bad field:

```
PluginValidationError: plugin "boring-macro": catalogs[0].adapter.search
must be a function (got: undefined)
```

Per-type validators (`validatePanel`, `validateCommand`,
`validateCatalog`, `validateChatSuggestion`, `validateAgentTool`) live
in `@boring/workspace/src/plugin/validators.ts`. `validateAgentTool`
re-exports `validateTool` from `@boring/agent/shared`. **Important
node-leak avoidance** (codex P0, 2026-04-28): the current
`validateTool` lives inside
`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`,
which imports `node:fs/promises`, `node:path`, `node:os`,
`node:url` at module scope. Step 2a EXTRACTS `validateTool` into
`packages/agent/src/shared/validateTool.ts` (no node imports —
pure shape check on `AgentTool`); pluginLoader.ts then imports the
extracted version, and `@boring/workspace`'s `validateAgentTool`
re-exports from `@boring/agent/shared`. Without this extraction,
client-side `definePlugin` would pull node-only modules into a
browser bundle and the build would break. The extraction is a
one-file refactor and must land as part of Step 2a, not Step 2b.

### Error model

| Failure | When | Response |
|---|---|---|
| `PluginValidationError` | At `definePlugin` call (typo, missing field) | Throw immediately. Host build/dev fails to start. |
| `PluginRegistrationError: missing dep` | At `register` if `dependsOn` lists an unknown plugin | Throw at registration. Provider mount fails with a useful error. |
| `PluginRegistrationError: id collision` | At `register` with same id as already-registered | Late wins on id (replace). Dev-mode `console.warn` lists what was replaced. |
| `PluginMountError` | If `onMount` throws / rejects | Catch, log, emit `plugin:error` on the bus. Plugin's contributions stay registered; cleanup not stored. Other plugins unaffected. |
| `PluginContributionError` | If a single contribution fails at runtime (e.g. catalog adapter throws on `.search`) | Per-contribution try/catch isolates. Other plugins unaffected. UI shows inline error chip. |

A misbehaving plugin can never crash the workspace, but it can
produce degraded UX. The provider exposes an `errors: PluginError[]`
field for debug surfaces (see §Dev tools).

### Default plugins — TWO, finalized

| Plugin | Contributes | Why a plugin (not core) |
|---|---|---|
| **`filesystemPlugin`** | Agent tools (`find_files`, `grep_files`, `read`, `write`, `edit` — actual current names per `readTool.ts`/`writeTool.ts`/`editTool.ts`); routes (`/api/v1/files`, `/tree`, `/files/search`); a Files catalog; FileTree panel registration as `placement: 'left-tab'`; CodeEditor + MarkdownEditor panel registrations (with `filePatterns`) | Domain capability hosts can omit (UI-only apps, sandboxed deployments). When excluded: file routes 404, Files left-tab disappears, code/markdown editors stop auto-routing. |
| **`dataCatalogPlugin`** | DataExplorer panel registration as `placement: 'left-tab'` (workbench data tab); Phase 2: `search_catalog(id, q)` generic agent tool | Apps without catalog browsing don't need the data tab. Real opt-out. |

Both auto-mount. Hosts opt out via:

```tsx
<WorkspaceProvider
  plugins={[macroPlugin]}
  excludeDefaults={["filesystem"]}    // or ["dataCatalog"], or []
>
```

`excludeDefaults` is the single switch — no `includeDefaults`
allowlist (would force every host to opt in to defaults explicitly,
defeats the point; both fields → confusing precedence).

#### File ops: shared bundle, dual registration path

A subtle but important arrangement (per Q1 = "make filesystem
plugin default to agent"):

- **The tool implementations** (`find_files`, `grep_files`, `read`,
  `write`, `edit`) live as a bundle in `@boring/agent`:
  `packages/agent/src/server/tools/filesystem/index.ts` exports
  `filesystemAgentTools: AgentTool[]`.
- **Standalone `createAgentApp`** registers the bundle by default
  (the standalone agent CLI stays a real coding agent — a coding
  agent without file ops isn't a coding agent). Opt out via
  `createAgentApp({ disableDefaultFileTools: true })`.
- **`filesystemPlugin`** (in `@boring/workspace`) imports the same
  bundle and wraps it as `agentTools: filesystemAgentTools`.
- **`createWorkspaceAgentApp`** passes
  `disableDefaultFileTools: true` to the underlying `createAgentApp`,
  so file tools come through the plugin path only — no double
  registration. This makes `filesystemPlugin` the canonical
  registration site for workspace hosts; `excludeDefaults:
  ['filesystem']` truly removes file tools (there is no fallback in
  `createAgentApp`'s standardCatalog because workspace already
  disabled it).
- **Routes** (`/api/v1/files`, `/tree`, `/files/search`) live only on
  the workspace side — the standalone agent CLI doesn't expose them
  (LLM uses tools, not HTTP). Routes belong to `filesystemPlugin`,
  not the shared bundle.

Net effect: ONE source of truth for tool implementations, TWO
registration pathways for two different hosts (standalone agent vs
workspace). The user-facing rule "filesystem is a plugin you can
turn off" holds for workspace hosts.

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

**File-pattern panel resolution.** The current resolver
(`PanelRegistry.ts:91`, `SurfaceShell.tsx:98`) matches **basename
only** via a hand-rolled `*suffix`/exact matcher. It also has a
working source-priority tie-breaker (`app` beats `builtin` on equal
specificity) which we PRESERVE. Phase 1 step 2 upgrades the matcher
itself to **path-aware micromatch** so patterns like `deck/**/*.md`
actually work. When `openFile(path)` runs:

1. Filter panels whose `filePatterns` include the full `path` under
   path-aware micromatch (`{ matchBase: false, dot: true }`).
2. Sort by **specificity** — concrete formula:
   `score = (segment_count * 10) + non_wildcard_chars`. Higher wins.
3. Tie-break A: `source: 'app'` beats `source: 'builtin'` (current
   behavior, preserved).
4. Tie-break B: registration order, late wins.
5. Hosts can bypass pattern matching at the call site:
   `surface.openPanel({ component: "<id>", … })`.

Three composition shapes this enables (canonical examples):

```
1. ADD a domain pane for a domain path
   filesystem: { id: "markdown-editor", patterns: ["**/*.md"] }
   macro:      { id: "deck",            patterns: ["deck/**/*.md"] }
   notes.md             → MarkdownEditor (default)
   deck/labor/labor.md  → DeckPane         (specificity wins)

2. REPLACE a default pane (late-wins-on-id)
   filesystem:  { id: "code-editor", component: CodeEditor,    patterns: ["**/*.ts"] }
   superCoder:  { id: "code-editor", component: SuperCoder,    patterns: ["**/*.ts"] }
   any *.ts → SuperCoder (same id ⇒ replaces)

3. ADD a SECOND pane available for the same file
   filesystem:    { id: "code-editor", patterns: ["**/*.json"] }
   schemaViewer:  { id: "schema-view", patterns: ["**/*.json"] }
   user picks via panel-switcher; opening code chooses one explicitly
```

Each plugin owns its file-type ↔ pane binding. Hosts compose plugins
to compose extensions.

### Order semantics — registration vs conflict resolution

Two distinct concepts that are easy to confuse:

| Concept | What it controls | Mechanism |
|---|---|---|
| **Registration order** | When a plugin's contributions enter the registry; `dependsOn` resolution sequence; file-pattern tiebreaker | `Plugin.order: number` (default 100; defaults are 0; lower = earlier) |
| **Conflict resolution** | What happens when two contributions share the same `id` | `late-wins-on-id` — independent of `order`; the LAST register call wins |

Practical implications:

- **Override a default panel:** register a panel with the same `id`
  as the default (e.g., `"code-editor"`). Your `Plugin.order` only
  needs to be ≥ the default's order — it doesn't need to be lower.
  Late-wins ensures your version replaces.
- **Force a plugin to mount before another:** lower its `order`.
  Default plugins are at `order: 0` so they're available for
  `dependsOn` resolution.
- **File-pattern tiebreaker:** within identical specificity, the
  LATER-registered wins. Combined with `Plugin.order`, hosts can
  deterministically choose between two patterns of equal specificity.

Late-wins logs a dev-mode `console.warn` so the override is
traceable.

`Plugin.order` numeric conventions (advisory, not enforced):

```
0       — default plugins (filesystem, dataCatalog)
1-49    — foundational host plugins (data sources, auth, telemetry)
50-99   — domain plugins
100     — default for unspecified
150+    — overlays / decorators that must apply last
```

### Workspace orchestration — registries + lifecycle

`PluginRegistry` is the umbrella. Per-contribution registries
(`CatalogRegistry`, `CommandRegistry`, `PanelRegistry`,
`ChatSuggestionRegistry`) are the consumers. All registries use
`useSyncExternalStore` so React subscribers track register/unregister
cycles.

#### Boot sequence — explicit contract

```
PluginRegistry.bootstrap(plugins, opts):

  1. Compute final plugin set:
     - default plugins minus excludeDefaults (filesystem, dataCatalog)
     - PLUS user plugins from opts.plugins
     - Stable-sort by Plugin.order ascending (defaults first naturally
       at order=0; user plugins at order=100 follow)

  2. For each plugin in sorted order:
     a. Check dependsOn — every named dep MUST be present in the
        FINAL set (already-registered or upcoming). If missing
        → throw PluginRegistrationError at this plugin.
     b. Warn on optionalDeps missing.
     c. Fan declarative contributions into per-type registries —
        set pluginId provenance on each. The fan-in normalizes the
        existing API inconsistency: `PanelRegistry.register(id, cfg)`
        is id-first; `CommandRegistry.registerCommand(cfg)` is
        config-carries-id. PluginRegistry calls each registry with
        the shape it expects; plugin authors only deal with the
        unified `Plugin` shape.
     d. (server) Fan agentTools → AgentToolRegistry.
     e. (server) Register routes via
        await app.register(reg.plugin, { ...reg.opts, prefix: reg.prefix })
        for each RouteRegistration. Supports async Fastify plugins.
     f. Await plugin.onMount(ctx) if present; store cleanup.
     g. Emit `plugin:registered` on the bus.

  3. Emit `bootstrap:complete` on the bus once all plugins mounted.

PluginRegistry.unregister(id):
  1. Await stored cleanup (async-capable).
  2. Remove fanned-in items by sourcePluginId from per-type registries.
  3. Emit `plugin:unregistered`. Notify subscribers.
  4. NOTE: Fastify routes registered in step 2e are NOT removed
     (Fastify route registration is boot-only). Documented; only
     matters at hot-reload time, which is Phase 3.
```

`dependsOn` checks the FINAL set, not "already-registered." Plugins
can declare deps on plugins that come later in `opts.plugins`
because ordering is determined by `Plugin.order`, not array
position. But the dep's *contributions* aren't visible to the
dependent plugin's `onMount` unless the dep's order is lower —
a soft constraint hosts can verify with the inspector.

The retrofit applies to existing `CommandRegistry` and
`PanelRegistry` — they get `subscribe()` semantics so late
`registerCommand` calls reach an open palette.

### Polymorphic Recent

The Command Palette today has a Recent section with a known bug
(`CommandPalette.tsx:34`-`60`, `:157`, `:230-232`): it stores items
uniformly as path strings and renders all entries through
`FilePathLabel`. When a command becomes the most-recent action it
renders as a (broken) file path.

The plugin model fixes this by tagging each Recent entry with the
catalog it came from. RecentStore entries:

```ts
interface RecentEntry {
  catalogId: string         // ↔ CatalogConfig.id
  recentKind: string        // ↔ CatalogConfig.recentKind (denormalized for safety)
  rowId: string             // ↔ ExplorerRow.id (within that catalog)
  /** Snapshot of the row at time of selection. Guards against
   *  catalog data changing under our feet (file renamed, series
   *  re-tagged, …). */
  rowSnapshot: ExplorerRow
  selectedAt: number        // unix ms
}
```

Render flow when CommandPalette renders Recent:

1. For each entry, look up catalog by `catalogId` in
   `CatalogRegistry`. If absent (plugin uninstalled) → drop the
   entry from Recent (don't render orphans).
2. Render the row using either `catalog.renderRecentRow(row)` or,
   absent that, the catalog's default adapter row renderer.
3. On click → `catalog.onSelect(rowSnapshot)`.

Recent is **catalog-only** in Phase 1 — commands don't appear in
Recent. (Recent commands would be a different UX axis; can be added
later as a separate "RecentCommands" section if it proves useful.
The current "cmd:foo" entries get migrated/dropped during step 5a.)

Storage migration: existing `boring-ui-v2:command-palette:recent`
localStorage entries are read once on first load, attempted to map
to file catalog entries (all current entries are file paths
de-facto), and re-saved as the new `RecentEntry[]` shape. Entries
that can't be reconstructed are dropped.

### Registry-driven workbench tabs

Today `WorkbenchLeftPane` hardcodes its Files / Data tab list
(`WorkbenchLeftPane.tsx:97`, `:174`, `:181`) — which means
`excludeDefaults: ['filesystem']` would suppress the filesystem
agent tools and catalogs but leave a dead Files tab in the UI. That
contradicts the "real opt-out" promise.

Phase 1 step 5c retrofits `WorkbenchLeftPane` to query
`PanelRegistry` for placements `'left-tab'`, sorting by `tabOrder`
then registration order. `filesystemPlugin` contributes the Files
tab; `dataCatalogPlugin` contributes the Data tab.
`excludeDefaults: ['filesystem']` truly removes the tab.
(`WorkbenchRightPane` does not exist today; `'right-tab'` placement
is reserved in the contract for symmetry but no Phase 1 component
consumes it — flagged for the first plugin that needs a right-side
registry-driven tab.)

A registered tab panel renders its own component when active —
WorkbenchLeftPane is now just the chrome (tab strip + active panel
host), not the content owner.

#### Closing the SurfaceShell hardcoded-fallback hole

`SurfaceShell.fallbackComponentForPath`
(`SurfaceShell.tsx:81-91`) maps extensions to literal panel ids
(`code-editor`, `markdown-editor`, `csv-viewer`) regardless of
whether they're registered. `resolvePanelForPath`
(`SurfaceShell.tsx:99-108`) checks `registry.has(fallback)` then
returns the fallback id anyway as a "last-ditch." That's why
`excludeDefaults: ['filesystem']` would currently leak blank tabs.

Step 5c also fixes the resolver: when both registry resolution AND
the fallback id miss, `openFile` opens an `EmptyFilePanel`
(registered as a core panel — kicks in only when nothing else
matches) showing "No editor for `<path>` — install or enable a
plugin that handles `<ext>`." This makes the `excludeDefaults`
contract honest: zero ghost tabs, clear actionable message.

### Security stance — Phase 1 trust model

Inline plugins live in the host's source tree and run with full host
privileges. No sandbox, no capability gating, no manifest review.
This is intentional for Phase 1: every plugin in scope is authored
by the host's owners. The plugin model is a **structuring tool**,
not a security boundary.

Phase 2 (npm-installable plugins): same trust model — installing a
package is consenting to its code. Mitigations are the standard
npm ecosystem ones (lockfile pinning, code review of the dep
graph, namespace conventions like `pi-plugin-*`).

Phase 3 (agent-authored plugins): the agent generates plugin code
into `.pi/extensions/.agent-authored/`. Files are reviewable +
diffable. A future capability flag (`Plugin.capabilities: ["fs",
"net", "exec", ...]`) plus a confirmation prompt on first-mount is
the path to a real trust boundary. **Out of scope for Phase 1.**

For Phase 1: the spec explicitly does NOT ship sandbox machinery,
CSP overrides, or capability flags. Inline plugin authors have the
same privileges as the host.

### Dev tools

Built into Phase 1:

- `WorkspaceContext.errors: PluginError[]` — exposes
  `PluginValidationError` / `PluginRegistrationError` /
  `PluginMountError` / `PluginContributionError` for debug overlays.
- Dev-mode (`import.meta.env.DEV` / `process.env.NODE_ENV !==
  "production"`) `console.warn` on:
  - `optionalDeps` missing
  - late-wins-on-id replacement (logs both contributors' pluginId)
  - ChatSuggestion / Catalog adapter throwing during render
  - File-pattern resolver returning multiple equal-specificity
    matches (advise the host to disambiguate)
- `<PluginInspector />` — DEV-only React component (mounted by
  `WorkspaceProvider` when `import.meta.env.DEV`). Shows:
  - Registered plugins (id, version, order, source, deps)
  - Per-plugin contributions count
  - Errors keyed to plugin id
  - Toggle: hidden until devtools shortcut (`Cmd+Shift+P P`)

Future (Phase 2): registration timeline, catalog hit/miss telemetry,
route-registration logs, system-prompt augmentation preview.

### Inline plugin layout (Phase 1)

```
apps/<some-app>/
├── package.json
├── src/
│   ├── plugin/
│   │   ├── index.ts            ← env-aware barrel + makeXyzPlugin factory
│   │   ├── plugin.shared.ts    ← id, dependsOn, types, fixed config
│   │   ├── plugin.client.ts    ← panels, catalogs, commands, suggestions
│   │   └── plugin.server.ts    ← agentTools, routes
│   ├── server/index.ts         ← createWorkspaceAgentApp({ plugins: [makeAppPlugin(deps)] })
│   └── web/App.tsx             ← <WorkspaceProvider plugins={[makeAppPlugin()]}>
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
import { makeMacroPlugin } from "./plugin"

<WorkspaceProvider plugins={[makeMacroPlugin()]}>
  <App />
</WorkspaceProvider>

// SERVER
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { makeMacroPlugin } from "./plugin"

const app = await createWorkspaceAgentApp({
  workspaceRoot,
  plugins: [makeMacroPlugin({ clickhouse, deckRoot })],
  // excludeDefaults: ["dataCatalog"]   // optional
})
await app.listen({ port })
```

Both entry points auto-mount default plugins (filesystem +
dataCatalog) unless excluded. Both call into the same `PluginRegistry`
underneath; client and server tracks are independent (coupled by
plugin id, not by shared state).

### Event bus integration

Plugins are about **registration**; the bus is about
**communication**. The bus is **already implemented** at
`packages/workspace/src/events/{bus,index,types,useEvent}.ts` —
this section reflects the actual API, not the original
`UNIFIED_EVENT_BUS.md` sketch.

Actual bus surface (verified 2026-04-28):

```ts
// Module singleton — import directly anywhere
import { events, useEvent } from "@boring/workspace/events"
import type { WorkspaceEventMap } from "@boring/workspace/events"

events.on("file:moved", ({ from, to }) => { /* … */ })  // returns unsubscribe
events.emit("file:moved", { ...userMeta(), from, to })

// React hook
useEvent("file:moved", ({ from, to }) => { /* … */ })
```

**Package-exports gap (codex P1, 2026-04-28):** the workspace
package's `exports` map (`packages/workspace/package.json:9-30`)
exposes `.`, `./testing`, `./ui-shadcn`, `./shared`, `./server`,
`./globals.css` — but NOT `./events`. Step 4a adds the entry:

```json
"./events": {
  "types": "./dist/events.d.ts",
  "import": "./dist/events.js"
}
```

Plus the corresponding `tsup` entry. `events` are also re-exported
from the package barrel for convenience (so
`import { events } from "@boring/workspace"` works), but the
`./events` subpath is the recommended import for tree-shaking.

Plugin–bus contact points:

1. **`PluginMountCtx.bus`** is the same module singleton, injected
   for testability. `onMount(({ bus }) => bus.on("file:moved", …))`
   is functionally identical to importing `events` directly.
2. **Lifecycle events follow the bus's "events declared on demand"
   policy** — `WorkspaceEventMap` intentionally pre-declares
   nothing for the future (per the comment in
   `events/types.ts`). Phase 1 ADDS these keys to the map only
   when emitter + consumer ship together:
   - `plugin:registered: { id: string; pluginId: string }`
   - `plugin:unregistered: { id: string }`
   - `plugin:error: { pluginId: string; error: PluginError }`
   - `bootstrap:complete: { pluginIds: string[] }`
   Per-contribution events (`catalog:registered`, etc.) are NOT
   added in Phase 1; we only add them when the first concrete
   consumer needs them. Phase 2's discovery endpoint adds
   `plugins:discovered`.
3. **Bus invariants honored** by plugin lifecycle events: synchronous
   emit, transitions only (no replay-on-subscribe), one bad listener
   doesn't break the chain.

Bus is client-only. Server-side plugin contributions communicate via
Fastify hooks or HTTP routes — not a workspace-wide primitive.

## Reorganization (file moves)

Things move to draw an honest boundary. Each move is a self-contained
refactor; the plugin model rides on top.

| From | To | Lands as |
|---|---|---|
| `@boring/agent`: `src/server/catalog/standardCatalog.ts` — file ops (`find_files`, `grep_files`, `read`, `write`, `edit`) | **Stays in `@boring/agent`** as `src/server/tools/filesystem/index.ts` (extracted into a shared bundle) | Imported by both `createAgentApp` (default-on, opt-out via `disableDefaultFileTools`) AND `filesystemPlugin.agentTools` (workspace path) |
| `@boring/agent`: `src/server/catalog/standardCatalog.ts` — UI bridge tools (`get_ui_state`, `exec_ui`) | `@boring/workspace/server/uiTools.ts` | Core (registered directly by `createWorkspaceAgentApp`) |
| `@boring/agent`: `src/server/http/routes/{file,tree,search}.ts` | `@boring/workspace/server/routes/files.ts` | `filesystemPlugin.routes` |
| `@boring/agent`: `src/server/http/routes/ui.ts` | `@boring/workspace/server/routes/ui.ts` | Core (registered directly) |
| `@boring/agent`: `src/shared/ui-bridge.ts` (`UiState`, `UiCommand` types) | `@boring/workspace/src/shared/ui-bridge.ts` | Core types |
| `@boring/agent`: `src/server/ui-bridge/createInMemoryBridge.ts` | `@boring/workspace/src/bridge/createInMemoryBridge.ts` | Core |

`@boring/agent` keeps:

- `pi-coding-agent` harness (LLM loop, sessions, models)
- `AgentTool` type (shared contract)
- `validateTool` (re-used by workspace's `validateAgentTool`)
- Pi loader (legacy tools-only behavior; Phase 2 extends it)
- File ops shared bundle (`filesystemAgentTools`)
- `bash`, `execute_isolated_code` tools (truly harness-level — these
  are the only agent-only tools after step 1b)
- Chat / session / model HTTP routes
- `createAgentApp` (UI-less; standalone CLI; auto-includes file ops
  via the shared bundle unless `disableDefaultFileTools`)

Boundary after the moves: `@boring/agent` = "harness + harness
tools"; `@boring/workspace` = "workspace surface + plugin model +
file/UI routes."

## Exact path: now → Phase 1 done

Six sequenced commits. Each is independently reviewable. (Step 0 of
v4 — "tsup-build the workspace server export" — is dropped because
that work has already landed; `package.json:27` exports `./server`
and `createWorkspaceAgentApp.ts:42` exists.)

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1 — REORG (no plugin model yet, pure refactor)             │
│  ─────────────────────────────────────────────────────────────── │
│  1a. UI bridge ownership refactor (per existing plan doc)        │
│      Move ui-bridge types/tools/routes from @boring/agent →      │
│      @boring/workspace. boring-macro deletes its 150-LOC inline  │
│      copy (uiBridge.ts confirmed at 9.3 KB).                     │
│      Independently valuable; lands as one PR.                    │
│                                                                  │
│  1b. File ops bundle extraction                                  │
│      Extract find_files / grep_files / read / write / edit into  │
│      @boring/agent/server/tools/filesystem (a shared bundle).    │
│      standardCatalog imports the bundle by default; expose       │
│      `disableDefaultFileTools` on createAgentApp. Move file/     │
│      tree/search HTTP routes to @boring/workspace/server. The    │
│      standardCatalog tools (bash, execute_isolated_code) stay    │
│      where they are. (No read_directory tool exists.)            │
│                                                                  │
│  Deliverable: @boring/agent's surface is "harness + harness      │
│  tools (incl. file ops bundle)"; @boring/workspace owns the      │
│  workspace-flavored bits but no Plugin shape yet.                │
│  ETA: 1–2 days.                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 2 — PLUGIN PRIMITIVES                                      │
│  ─────────────────────────────────────────────────────────────── │
│  2a. Plugin type + definePlugin + validators                     │
│      - Extract validateTool from                                 │
│        agent/.../pluginLoader.ts (node-leaky module) into        │
│        @boring/agent/shared/validateTool.ts (no node imports).   │
│        pluginLoader imports the extracted version.               │
│      - packages/workspace/src/plugin/{types,definePlugin,        │
│        validators}.ts. validateAgentTool re-exports from         │
│        @boring/agent/shared. Client bundle stays node-clean.     │
│                                                                  │
│  2b. PluginRegistry + CatalogRegistry +                          │
│      ChatSuggestionRegistry (subscribe-aware) +                  │
│      explicit bootstrap() with the boot sequence above           │
│      packages/workspace/src/plugin/{Plugin,Catalog,              │
│      ChatSuggestion}Registry.ts                                  │
│                                                                  │
│  2c. Subscribe retrofit for existing CommandRegistry +           │
│      PanelRegistry                                               │
│                                                                  │
│  2d. Path-aware file-pattern resolver upgrade                    │
│      Replace basename-only matcher in PanelRegistry.ts:91 +      │
│      SurfaceShell.tsx:98 with path-aware micromatch (matchBase   │
│      false, dot true). Add specificity-scoring function          │
│      (segments × 10 + non-wildcard chars). Unit test against     │
│      the canonical compositional examples.                       │
│                                                                  │
│  Deliverable: types compile; registries pass unit tests;         │
│  resolver matches deck/**/*.md correctly; no consumer wired      │
│  yet. ETA: 1.5–2 days.                                           │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 3 — DEFAULT PLUGINS                                        │
│  ─────────────────────────────────────────────────────────────── │
│  3a. filesystemPlugin                                            │
│      packages/workspace/src/plugin/defaults/filesystemPlugin.ts  │
│      contributes:                                                │
│        - agentTools: filesystemAgentTools (imported from         │
│          @boring/agent — single source of truth)                 │
│        - routes: file/tree/search (moved in step 1b)             │
│        - catalogs: Files catalog (with renderRecentRow)          │
│        - panels: FileTree (placement: 'left-tab',                │
│          tabOrder: 0), CodeEditor + MarkdownEditor (with         │
│          filePatterns)                                           │
│        - order: 0                                                │
│                                                                  │
│  3b. dataCatalogPlugin                                           │
│      packages/workspace/src/plugin/defaults/dataCatalogPlugin.ts │
│      contributes: DataExplorer panel registration                │
│      (placement: 'left-tab', tabOrder: 1); order: 0              │
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
│      defaults (running through bootstrap()); fans contributions  │
│      into registries. Mounts <CommandPalette /> as before, now   │
│      consuming useCatalogs() instead of the old onOpenFile prop. │
│      Promotes WorkspaceSurface (openFile/openPanel/closeTab)     │
│      from internal context to the plugin contract — exposed in   │
│      PluginMountCtx.surface. Adds package.json "./events" export │
│      so plugins can import { events } from                       │
│      "@boring/workspace/events". Mounts <PluginInspector /> when │
│      import.meta.env.DEV.                                        │
│                                                                  │
│  4b. createWorkspaceAgentApp({ plugins })                        │
│      Wraps createAgentApp with disableDefaultFileTools: true.    │
│      Auto-registers defaults (server-side contributions). Fans   │
│      agentTools into createAgentApp's extraTools; awaits         │
│      app.register(reg.plugin, reg.opts) per RouteRegistration.   │
│                                                                  │
│  Deliverable: a host can pass plugins and watch them register.   │
│  ETA: 1 day.                                                     │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 5 — CONSUMER REFACTORS                                     │
│  ─────────────────────────────────────────────────────────────── │
│  5a. <CommandPalette /> consumes useCatalogs() + polymorphic     │
│      Recent                                                      │
│      Drop dead fileSearchFn / onOpenFile props. Drop             │
│      type-mismatched Recent path; replace with                   │
│      RecentEntry { catalogId, recentKind, rowId, rowSnapshot }.  │
│      Files becomes the first catalog (provided by                │
│      filesystemPlugin). Migrate existing localStorage entries    │
│      (best-effort: file-path strings → file-catalog Recent).     │
│                                                                  │
│  5b. <ChatCenteredShell /> FULL migration                        │
│      - Drop imperative useEffect command registration. Internal  │
│        "chat-shell" plugin (defined inline in workspace) takes   │
│        over toggleDrawer / toggleSurface / newChat.              │
│      - Drop `data: DataPaneConfig` prop                          │
│        (ChatCenteredShell.tsx:45 / :637). Workbench data tab     │
│        reads CatalogRegistry; first catalog with                 │
│        recentKind = 'data' (or all of them, as multiple tabs)    │
│        is shown. Hosts that previously passed `data` declare     │
│        their CatalogConfig in their plugin instead.              │
│      - Drop `extraPanels` prop (ChatCenteredShell.tsx:116,       │
│        SurfaceShell.tsx:466). Panels come from PanelRegistry.    │
│        Add `allowedPanels?: string[]` for hosts that want to     │
│        gate which registered panels appear in this shell         │
│        (default: all).                                           │
│                                                                  │
│  5c. WorkbenchLeftPane registry-driven + SurfaceShell fallback   │
│      fix                                                         │
│      - Read 'left-tab' panels from PanelRegistry, sorted by      │
│        tabOrder then registration order. filesystemPlugin and    │
│        dataCatalogPlugin contribute their respective tabs.       │
│        excludeDefaults: ['filesystem'] truly removes the tab.    │
│      - Replace the hardcoded fallback chain in                   │
│        SurfaceShell.tsx:81-108 with: registry resolve →          │
│        registered fallback (only if has()) → EmptyFilePanel      │
│        with explicit "No editor for <path>" message. No more     │
│        ghost tabs when defaults are excluded.                    │
│      - 'right-tab' placement reserved in the contract; no        │
│        Phase 1 component consumes it (no WorkbenchRightPane      │
│        exists today).                                            │
│                                                                  │
│  Deliverable: cmd palette + chat shell + workbench tabs          │
│  entirely on the new registry. THREE breaking changes            │
│  (CommandPaletteProps, ChatCenteredShellProps.{data,extraPanels, │
│  withCommandPalette}, WorkbenchLeftPane internal API) shipped;   │
│  release notes drafted. ETA: 2 days.                             │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 6 — ACCEPTANCE: BORING-MACRO MIGRATION                     │
│  ─────────────────────────────────────────────────────────────── │
│  See §"Concrete before/after" for the actual code diff.          │
│  Net: ~260 LOC → ~40 LOC (-85%).                                 │
│  ETA: 0.5–1 day.                                                 │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 7 — TESTS + RELEASE NOTES                                  │
│  ─────────────────────────────────────────────────────────────── │
│  Tests per §Test plan. Release notes documenting the THREE       │
│  breaking changes. ETA: 1–2 days.                                │
└──────────────────────────────────────────────────────────────────┘

TOTAL: ~7–10 days of focused work, sequenced after the event bus
       implementation lands.
```

## Concrete before/after — boring-macro migration

The acceptance test for the model. If this transformation isn't a
clean reduction, the design is wrong.

### BEFORE (today; v4 of macro app)

```ts
// apps/boring-macro-v2/src/web/App.tsx — ~80 LOC
import { WorkspaceProvider } from "@boring/workspace"
import { ChatCenteredShell } from "@boring/workspace"
import { chartCanvasPanel, deckPanel } from "./panels"
import { macroChatSuggestions } from "./suggestions"

const dataPaneConfig: DataPaneConfig = {
  defaultExplorer: "macro-series",
  explorers: [
    { id: "macro-series", label: "Series", adapter: seriesAdapter, onSelect: handleSeriesSelect },
    { id: "files",        label: "Files",  adapter: filesAdapter,  onSelect: handleFileSelect   },
  ],
}
const macroPanels: PanelConfig[] = [chartCanvasPanel, deckPanel]

export function App() {
  return (
    <WorkspaceProvider panels={macroPanels}>
      <ChatCenteredShell
        data={dataPaneConfig}
        chatSuggestions={macroChatSuggestions}
        extraPanels={macroPanels}
      />
    </WorkspaceProvider>
  )
}
```

```ts
// apps/boring-macro-v2/src/server/index.ts — ~30 LOC
import { createAgentApp } from "@boring/agent/server"
import { uiRoutes, uiTools } from "./uiBridge"   // INLINED COPY
import { macroAgentTools } from "./macroTools"
import { registerMacroRoutes } from "./macroRoutes"

const clickhouse = await createClickHouseClient(env)
const app = await createAgentApp({
  workspaceRoot,
  extraTools: [...macroAgentTools, ...uiTools],
})
await app.register(uiRoutes)
await app.register(registerMacroRoutes, { clickhouse, deckRoot: env.MACRO_DECK_ROOT })
await app.listen({ port })
```

```ts
// apps/boring-macro-v2/src/server/uiBridge.ts — ~150 LOC
// Full inlined copy of @boring/workspace/server's UI bridge:
// createInMemoryBridge, get_ui_state tool, exec_ui tool,
// uiRoutes (/api/v1/ui/state, /api/v1/ui/exec, /api/v1/ui/wait).
// Maintained in parallel with the canonical version → drift hazard.
```

### AFTER (Phase 1 done)

```ts
// apps/boring-macro-v2/src/plugin/index.ts — ~25 LOC
import { definePlugin, type Plugin } from "@boring/workspace"
import { chartCanvasPanel, deckPanel } from "./panels"
import { seriesCatalog } from "./catalogs"
import { macroChatSuggestions } from "./suggestions"
import { macroAgentTools } from "../server/macroTools"
import { registerMacroRoutes } from "../server/macroRoutes"
import type { ClickHouseClient } from "@clickhouse/client"

interface MacroDeps {
  clickhouse?: ClickHouseClient   // server-only
  deckRoot?: string               // server-only
}

export const makeMacroPlugin = (deps: MacroDeps = {}): Plugin =>
  definePlugin({
    id: "boring-macro",
    label: "Macro",
    version: "0.1.0",
    dependsOn: ["filesystem"],
    panels: [chartCanvasPanel, deckPanel],
    catalogs: [seriesCatalog],
    chatSuggestions: macroChatSuggestions,
    agentTools: macroAgentTools,
    routes: deps.clickhouse && deps.deckRoot
      ? [{ plugin: registerMacroRoutes, opts: { clickhouse: deps.clickhouse, deckRoot: deps.deckRoot } }]
      : undefined,
  })
```

```ts
// apps/boring-macro-v2/src/web/App.tsx — ~5 LOC
import { WorkspaceProvider, ChatCenteredShell } from "@boring/workspace"
import { makeMacroPlugin } from "../plugin"

const macroPlugin = makeMacroPlugin()  // client side: no server deps

export const App = () => (
  <WorkspaceProvider plugins={[macroPlugin]}>
    <ChatCenteredShell />
  </WorkspaceProvider>
)
```

```ts
// apps/boring-macro-v2/src/server/index.ts — ~10 LOC
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { makeMacroPlugin } from "../plugin"
import { createClickHouseClient } from "../infra/clickhouse"

const clickhouse = await createClickHouseClient(env)
const app = await createWorkspaceAgentApp({
  workspaceRoot,
  plugins: [makeMacroPlugin({ clickhouse, deckRoot: env.MACRO_DECK_ROOT })],
})
await app.listen({ port })
```

```
DELETED: apps/boring-macro-v2/src/server/uiBridge.ts (~150 LOC)
         (replaced by @boring/workspace/server's UI bridge core)
```

### LOC accounting

| File | Before | After | Δ |
|---|--:|--:|--:|
| `src/web/App.tsx` | 80 | 5 | -75 |
| `src/server/index.ts` | 30 | 10 | -20 |
| `src/server/uiBridge.ts` | 150 | 0 | -150 |
| `src/plugin/index.ts` | 0 | 25 | +25 |
| **Total** | **260** | **40** | **-220 (-85%)** |

The LOC reduction is the headline; the bigger win is that all six
contribution types now flow through ONE declarative shape, instead
of being threaded through five different APIs in three different
files. New macro-style apps no longer pay the inlining tax.

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
- Plugin hot-reload for development (requires a Fastify-routes
  workaround or app-level swap-on-reload pattern; the registry side
  is already async-cleanup-ready).
- Per-contribution dependency declarations
  (`PanelConfig.requiresPlugin`).
- `Plugin.capabilities: ["fs", "net", "exec", ...]` + first-mount
  consent prompt — the path to a real trust boundary.

## Test plan

- **Unit**
  - `definePlugin` validation: well-formed plugin passes; malformed
    contributions throw with field-level errors.
  - Registry lifecycle: bootstrap orders by `Plugin.order`, then by
    array position; subscribe fires; cleanup runs (await for async);
    `dependsOn` rejects missing deps; late-wins-on-id replaces and
    warns.
  - Subscribable retrofit: late `register` after consumer subscribed
    triggers re-render.
  - File-pattern resolution: path-aware micromatch (deck/**/*.md
    matches deck/labor/labor.md); specificity ordering correct
    (deck/**/*.md beats **/*.md by formula); same-specificity →
    late-wins; explicit `surface.openPanel` bypasses.
  - RouteRegistration shape accepts both sync FastifyPluginCallback
    and async FastifyPluginAsync; opts passed through; prefix
    applied.
  - `disableDefaultFileTools: true` removes file ops from
    standardCatalog; `false` (default) keeps them.
  - RecentEntry: catalog-tagged entries render via the right
    catalog adapter; entries pointing at uninstalled catalogs are
    dropped; localStorage migration from string entries.

- **Integration**
  - `<WorkspaceProvider plugins={[testPlugin]}>` →
    catalog/command/panel/chatSuggestion all reachable via
    their hooks.
  - `createWorkspaceAgentApp({ plugins: [testPlugin] })` exposes
    `agentTools` in agent catalog endpoint; registers routes with
    correct opts.
  - Cmd palette renders catalogs from registered plugins;
    error-isolated per group.
  - `excludeDefaults: ['filesystem']` actually excludes — Files tab
    not rendered, file ops not in tool catalog, file routes 404.
  - `excludeDefaults: ['dataCatalog']` removes the Data tab.
  - `dependsOn` errors at boot when an excluded default is required.
  - Macro routes registered with `{ clickhouse, deckRoot }` opts
    work end-to-end (a fake clickhouse client, real route
    registration).
  - allowedPanels gating: when set, only listed panel ids appear
    in the surface.
  - Boot sequence: a low-`order` plugin's contributions are
    visible in a higher-`order` plugin's `onMount`.
  - PluginInspector: lists registered plugins under DEV; not
    rendered under PROD.

- **E2E**
  - **boring-macro-v2 existing e2e suite is the Step 6 acceptance
    gate** — all 10 specs (composer-border, deck, catalog-to-chart,
    catalog, split-no-clip, layout-persistence, chat-suggestions,
    chart-tabs, topbar, agent) MUST pass post-migration. The specs
    are behavior-level (they don't reference `extraPanels`/`data`
    props by name — verified 2026-04-28: only `App.tsx` and
    `server/index.ts` mention the deleted props), so a clean
    migration should not require spec edits.
  - Open `deck/labor/labor.md` → DeckPane (not generic
    MarkdownEditor) — confirms path-aware resolver.
  - Recent: open file from palette → close + reopen palette →
    file appears in Recent rendered as file path; run a command,
    Recent stays files-only (no command pollution).

## Acceptance

- `Plugin` contract + `definePlugin` exported from
  `@boring/workspace`.
- `PluginRegistry`, `CatalogRegistry`, `ChatSuggestionRegistry`
  subscribable with explicit `bootstrap()` honoring `Plugin.order`;
  existing `CommandRegistry` + `PanelRegistry` retrofitted.
- Factory pattern documented as canonical for stateful plugins.
- `<WorkspaceProvider plugins={[…]}>` and
  `createWorkspaceAgentApp({ plugins: [...] })` are the only
  registration APIs hosts use.
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`. Both
  auto-mount; both individually opt-out-able; opt-out actually
  removes UI surface (registry-driven workbench tabs).
- File-ops shared bundle in `@boring/agent` so standalone
  `createAgentApp` stays a real coding agent without duplicating
  tool implementations.
- Path-aware file-pattern resolver — `deck/**/*.md` works.
- `<CommandPalette />` renders catalogs from plugins; old
  `fileSearchFn`/`onOpenFile` props removed; Recent is polymorphic
  (catalog-tagged entries) and the type-mix bug is fixed.
- `<ChatCenteredShell />` registers its commands declaratively via
  an internal plugin; imperative useEffect block deleted; legacy
  `data` + `extraPanels` props deleted.
- `<PluginInspector />` ships under DEV.
- `boring-macro-v2` migrated per §Concrete before/after: ~260 LOC
  → ~40 LOC. Same user-visible behavior, including macro routes
  registered with `{ clickhouse, deckRoot }` opts.
- Three breaking changes (`CommandPaletteProps`,
  `ChatCenteredShellProps.{data,extraPanels,withCommandPalette}`,
  `WorkbenchLeftPane` internal tab API) documented.
- Phase 1 test plan all green.

## Open questions

1. **Plugin client/server file split — env guard or package.json
   exports?** Both work. Inline plugins use env guard; npm-published
   plugins (Phase 2) use package.json `exports`. Documented both.
2. **Async `onMount` cleanup — actually needed?** Phase 1 supports
   it (the type allows `Promise<Cleanup>` and `Cleanup` may itself
   be async). If no plugin uses async cleanup we can lock it down
   later, but supporting it now is free given the route lifecycle
   already requires async registration.
3. **Discovery endpoint authentication?** Same as other agent routes
   (session cookie). Phase 2 concern; flagged.
4. **What does `createWorkspaceAgentApp` do when running in a
   monorepo with multiple workspaces and pi loader sees plugins
   from a sibling app?** Phase 1: pi loader's existing behavior
   unchanged (only reads tools-only legacy shape). Phase 2:
   address when extending the loader.
5. **Hot-reload of Fastify routes (Phase 3 only).** Today
   `app.register(plugin)` is irreversible. Either we accept
   restart-on-add-plugin or we model the agent app as restartable
   inside a parent process. Not Phase 1's problem.

## Reference

- Existing pi plugin loader:
  `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`
- Existing `WorkspaceProvider`:
  `packages/workspace/src/WorkspaceProvider.tsx`
- Existing `<CommandPalette />`:
  `packages/workspace/src/components/CommandPalette.tsx`
  (Recent bug at lines 34, 59-60, 157, 230-232)
- Existing tool implementations (verified names: `read`, `write`,
  `edit`, `find_files`, `grep_files`):
  `packages/agent/src/server/catalog/tools/{readTool,writeTool,editTool,findFilesTool,grepFilesTool}.ts`
- Workspace tool renderers (keyed to current names):
  `packages/agent/src/ui-shadcn/workspaceToolRenderers.tsx:30`
- Hardcoded workbench tabs (target of step 5c):
  `packages/workspace/src/components/chat/WorkbenchLeftPane.tsx:97,174,181`
- ChatCenteredShell legacy props (target of step 5b):
  `packages/workspace/src/components/chat/ChatCenteredShell.tsx:45,116,637`
  + `packages/workspace/src/components/chat/SurfaceShell.tsx:466`
- File-pattern resolver to upgrade in step 2d:
  `packages/workspace/src/registry/PanelRegistry.ts:91` +
  `packages/workspace/src/components/chat/SurfaceShell.tsx:98`
- ExplorerAdapter (catalog adapter contract):
  `packages/workspace/src/components/DataExplorer/types.ts`
- Boring-macro-v2 host (the migration target — `src/web/`, not
  `src/front/`; uiBridge.ts confirmed at 9.3 KB):
  `/home/ubuntu/projects/boring-macro-v2/src/{server/index.ts,
  web/App.tsx, server/macroTools.ts, server/uiBridge.ts,
  server/macroRoutes.ts}`
- Sibling plans:
  - `UNIFIED_EVENT_BUS.md` — bus model; required by Phase 1
  - `UI_BRIDGE_OWNERSHIP_REFACTOR.md` — step 1a of this plan
- Superseded plan: `COMMAND_PALETTE_REGISTRY.md`

## Changelog v5.1 → v5.2 (round-2 codex review patches)

Round-2 codex review against v5.1 surfaced one P0, three P1s, three
P2s. All real (verified against the live codebase). All patched.

**P0** — `validateTool` lives in
`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`,
which imports `node:fs/promises` / `node:path` / `node:os` /
`node:url` at module scope. Any client-side import of the validator
(via `definePlugin`) would pull node-only modules into a browser
bundle. **Fix:** Step 2a now extracts `validateTool` into
`@boring/agent/shared/validateTool.ts` (pure shape check, no node);
pluginLoader imports the extracted version; workspace's
`validateAgentTool` re-exports from `@boring/agent/shared`.

**P1.1** — `PluginMountCtx.bridge: UiBridge` was wrong: `UiBridge`
is the **server-side** agent UI command queue. Plugins running in
the browser need a different action surface. **Fix:** added
`WorkspaceSurface` interface to the contract
(`openFile`/`openPanel`/`closeTab`); `PluginMountCtx.surface?:
WorkspaceSurface` (client-only); `bridge?: UiBridge` (server-only,
explicitly NOT for plugin client code). Step 4a promotes the
existing internal surface API to the plugin contract.

**P1.2** — `excludeDefaults: ['filesystem']` promise leaks ghost
tabs because `SurfaceShell.tsx:81-108` falls back to
literal `code-editor`/`markdown-editor`/`csv-viewer` ids regardless
of registration. **Fix:** Step 5c fixes the resolver chain:
registry → registered fallback (with `has()` guard) →
`EmptyFilePanel` with an actionable "No editor for <path>" message.
Honest contract.

**P1.3** — `@boring/workspace/events` subpath isn't in the package's
`exports` map (`packages/workspace/package.json:9-30`). **Fix:** Step
4a adds `./events` to exports + corresponding tsup entry; events
also re-exported from the barrel; subpath import recommended for
tree-shaking.

**P2.1** — Stale `read_directory` mention in Step 1b text. Removed.
**P2.2** — Stale `bus.subscribe("workspace:open-file", …)` in
factory example. Replaced with live API: `bus.on("file:moved", …)`
plus `surface.openFile(...)` action.
**P2.3** — Plan referenced `WorkbenchRightPane`; no such component
exists. `'right-tab'` placement reserved in the contract but
acknowledged as "no Phase 1 consumer" until the first plugin needs
it.

## Changelog v5 → v5.1 (codebase-reality-check sweep)

Six findings from a sweep against the live codebase before starting
implementation. None are blockers; all are surgical clarifications
that prevent mid-Step-1a head-scratching.

1. **Event bus actual API drifts from spec.** `events.on(name, fn)`
   not `bus.subscribe()`; `EventBus<WorkspaceEventMap>` not
   `WorkspaceEvents`; module singleton + `useEvent` React hook;
   policy is "events declared on demand" — `WorkspaceEventMap`
   intentionally pre-declares no future events. §"Event bus
   integration" rewritten against the real surface; lifecycle event
   keys are now declared per-Phase-1 only when emitter+consumer
   ship. `PluginMountCtx.bus` typed as
   `EventBus<WorkspaceEventMap>`.
2. **PanelConfig is already a discriminated union** (better than v5's
   loose `ComponentType | (() => Promise)`). Restated the existing
   `SyncPanelConfig | LazyPanelConfig` shape verbatim and confirmed
   plugin model only ADDS three fields (`'left-tab' | 'right-tab'`
   placement, `tabOrder`, `pluginId`). Existing `definePanel<T>`
   factory stays canonical authoring API.
3. **`source` enum is `'builtin' | 'app'`**, not the
   `'app' | 'agent' | 'user'` v5 invented. Plan now uses the real
   values. Source-priority tie-breaker (app beats builtin)
   preserved in resolver upgrade.
4. **Registry API inconsistency documented.**
   `PanelRegistry.register(id, config)` vs
   `CommandRegistry.registerCommand(config)`. Plugin fan-in path
   normalizes; plugin authors don't see it.
5. **`read_directory` doesn't exist** in the agent. Removed from
   Non-goals + "@boring/agent keeps" lists. Directory listing is
   covered by `find_files` + `/api/v1/tree`.
6. **boring-macro tests are e2e-only and behavior-based.** No source
   references to deleted props outside the two files Step 6
   modifies. Test plan promotes the existing 10-spec suite to be
   the Step 6 acceptance gate.

Plus one design clarification:

7. **CatalogConfig.recentKind collisions** — the spec is now
   explicit: same recentKind across catalogs is intentional sharing;
   Recent entries store both catalogId (exact source) AND recentKind
   (graceful fallback when source is unregistered).

## Changelog vs v4

The categorization the planning-workflow methodology asks for. Each
finding is labeled with its source — `(codex-Pn)`,
`(gemini-validated)`, or `(ultrathink)` — and the verdict.

### Wholeheartedly agree (integrated)

1. **(codex-P0) `Plugin.routes` shape can't carry options/async.**
   Macro's `registerMacroRoutes(app, { clickhouse, deckRoot })`
   doesn't fit `FastifyPluginCallback[]`. Replaced with
   `RouteRegistration[]` carrying `{ plugin, opts?, prefix? }`. This
   unblocks the migration; otherwise Step 6 is non-implementable.
2. **(codex-P0) Step 6 deletes ChatCenteredShell.data + extraPanels
   without refactoring the shell.** Per Q2 = "Full migration":
   Step 5b now explicitly drops both props and migrates `data` →
   CatalogRegistry, `extraPanels` → `allowedPanels` gating over
   PanelRegistry. Codex's source pointers
   (`ChatCenteredShell.tsx:45,116,637`, `SurfaceShell.tsx:466`) are
   preserved in §Reference.
3. **(codex-P0) `excludeDefaults` can't actually opt out — tabs
   hardcoded.** Per Q3: new Step 5c makes WorkbenchLeftPane /
   WorkbenchRightPane registry-driven. PanelConfig.placement gains
   `'left-tab' | 'right-tab'`; `tabOrder` controls ordering. The
   "real opt-out" promise becomes honest.
4. **(codex-P0) Moving file ops breaks standalone createAgentApp.**
   Per Q1 = "make filesystem plugin default to agent": file ops
   live as a shared bundle in `@boring/agent` (single source of
   truth); standalone `createAgentApp` registers them by default;
   `filesystemPlugin` references the same bundle; `createWorkspace
   AgentApp` passes `disableDefaultFileTools: true` to avoid double
   registration. Standalone CLI stays a real coding agent.
5. **(codex-P1) File-pattern resolver is basename-only.**
   `deck/**/*.md` example wouldn't actually work today. Step 2d
   upgrades the resolver to path-aware micromatch + a concrete
   specificity formula (segments × 10 + non-wildcard chars). Made
   an explicit Phase 1 prerequisite.
6. **(codex-P1) Type drift not flagged.** v4's PanelConfig dropped
   `'bottom'` placement and lazy components; ChatSuggestion made
   `prompt` required. Restored both. Spec now matches existing
   types so the retrofit doesn't silently break consumers.
7. **(codex-P1) Tool naming wrong throughout.** v4 said
   `read_file`/`write_file`/`edit_file`. Corrected to
   `read`/`write`/`edit` everywhere (with verified-source pointers
   in §Reference).
8. **(codex-P2 / gemini-validated) Step 0 stale.** Workspace server
   export already builds. Dropped the step; ETA reduced by 0.5–1
   day.
9. **(codex-P2) `includeDefaults` vs `excludeDefaults`
   inconsistency.** Removed `includeDefaults` everywhere;
   `excludeDefaults` is the sole knob.
10. **(ultrathink) Async onMount + async cleanup.** `onMount`
    returns `MaybePromise<void | Cleanup>`; `Cleanup` itself can be
    async. Aligns with Fastify async plugins.
11. **(ultrathink) Fastify route lifecycle is irreversible.**
    Documented as a known limitation under Non-goals; `unregister()`
    notes call it out; Phase 3 open question added.
12. **(gemini-validated) "boring-macro path is `src/web` not
    `src/front`."** Fixed §Reference. (Other gemini path claims —
    "uiBridge.ts already deleted" — were wrong on reality-check;
    file is still present at 9.3 KB; left v4's deletion in Step 6
    intact.)
13. **(ultrathink) Polymorphic Recent — design hole.** Added a
    full §Polymorphic Recent section with `RecentEntry` shape,
    render flow, orphan handling, and localStorage migration.
    Closes the long-standing CommandPalette Recent type-mix bug
    (`CommandPalette.tsx:34,59-60,157,230-232`) explicitly.
14. **(ultrathink) Factory pattern for stateful plugins —
    operational hole.** Added §"definePlugin and the factory
    pattern" describing `makeMacroPlugin(deps)` as the canonical
    shape for runtime-configurable plugins; rejected adding a
    `definePluginFactory` helper (a regular function is clearer).
15. **(ultrathink) Order vs late-wins precedence —
    underspecified.** Added §"Order semantics" section with a
    precedence table, override-default-panel walkthrough, and
    `Plugin.order` numeric conventions.
16. **(ultrathink) Boot sequence — operational hole.** Added an
    explicit `bootstrap()` pseudo-flow inside §"Workspace
    orchestration": sort by order, validate dependsOn against
    final set, fan declarative contributions, await async route
    registration, await onMount, emit `bootstrap:complete`.
17. **(ultrathink) Security stance — missing operational concern.**
    Added §"Security stance — Phase 1 trust model": inline
    plugins run with full host privileges, no sandbox, no
    capability gating; documented Phase 2/3 evolution path
    (`Plugin.capabilities` + first-mount consent).
18. **(ultrathink) Dev tools — missing operational concern.**
    Added §"Dev tools": `WorkspaceContext.errors`, dev-mode
    warnings (optionalDeps missing, late-wins replacement,
    multi-match ambiguity), and a DEV-only `<PluginInspector />`
    component.
19. **(ultrathink) Concrete before/after for boring-macro —
    structural improvement.** Added a code-level
    §"Concrete before/after — boring-macro migration" section
    showing actual file diffs and a LOC accounting table (260 →
    40, −85%). Step 6 now references this section instead of
    re-describing the migration in prose.
20. **(ultrathink) tabOrder field on PanelConfig.** Without an
    explicit ordering field, registry-driven tabs would be
    registration-order-dependent, which is fragile. Added
    `tabOrder?: number` (default 100) to PanelConfig.
21. **(ultrathink) ChatSuggestion.onSelect.** v4 dropped support
    for suggestions that take an action without sending a prompt
    (current `ChatEmptyState.tsx:28` allows this). Restored the
    optional `onSelect?: () => void` field alongside `prompt?`.
22. **(ultrathink) RecentEntry.rowSnapshot.** Storing only
    `{ catalogId, rowId }` would mean Recent breaks if the catalog
    data changes (file renamed, series re-tagged). Snapshot guards
    against drift.

### Somewhat agree (integrated with adjustment)

23. **(codex-P2) Move `validateAgentTool` from agent → workspace.**
    Rejected the literal move (creates reverse dep with
    pi-coding-agent loader); instead workspace's
    `validateAgentTool` re-exports `@boring/agent`'s existing
    `validateTool`. Same goal, no boundary violation.
24. **(ultrathink) Specificity scoring formula.** v4 hand-waved
    "longer/more-anchored wins." v5 specifies the concrete formula
    `(segments × 10) + non_wildcard_chars` so the canonical
    examples are unambiguously testable.
25. **(codex-P1) Server-side route lifecycle underspecified.**
    Codex flagged async semantics; the boot sequence now awaits
    each route registration and the route handling section
    explicitly says Fastify routes are non-unregisterable. Solved
    on the registration side; the unregistration limitation is
    explicit but unresolved (Phase 3 open question).

### Disagree (left out / pushed back)

26. **(codex-P2) Drop the `RouteRegistration` object form in favor
    of a single `setupServer(ctx)` lifecycle hook.** Considered;
    chose declarative routes for the common case + `onMount(ctx)`
    with `ctx.app` as the imperative escape hatch. Two ways to do
    one thing is a price worth paying so simple plugins stay
    declarative.
27. **(gemini) Add a `manifest()` method to Plugin for runtime
    introspection.** Not needed in Phase 1 — the registries
    already expose contributions; `<PluginInspector />` covers the
    debug case. Phase 2 discovery endpoint covers the
    system-prompt augmentation case.
28. **(gemini) Make `dependsOn` accept semver ranges.** Phase 1
    ships inline plugins; semver is a Phase 2 concern when npm
    distribution lands.
29. **(gemini) `Plugin.routes` should be a single fastify plugin
    function.** Same problem as the original FastifyPluginCallback
    constraint — can't carry per-route opts cleanly. Kept the
    `RouteRegistration[]` array.
