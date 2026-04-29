# Workspace plugin model

**Status:** v7.6 — round-5 review patches: Step 0 sequencing (move workspace into v7.5 layout BEFORE Phase 1, not after); split plugin entrypoints (index.ts client + server.ts per plugin); strict type-only imports for cross-folder Plugin refs; cleanup pack (uiBridge dedup, EmptyFilePanel relocation, A/B parallelism tightened, TL;DR scrub, tsconfig excludes, pi-tools-migration catch-up). **Meta-rule: when files move, they go DIRECTLY to final v7.6 destinations — no intermediate placements.**

> **Factory pattern:** Plugins may be exposed as factories when they need
> runtime config (e.g. macro's `makeMacroServerPlugin()`). v7.0 dropped the
> filesystemPlugin factory because the plugin no longer carries `agentTools`
> — it's UI-only (panels + catalog) and constructible at module load.
> Domain plugins with runtime deps (DB clients, etc.) still use the factory
> shape; the `Plugin` contract is unchanged.

**Owners:** workspace
**Last updated:** 2026-04-29

## TL;DR

A `Plugin` is a tagged bag of contributions for the workspace's
existing per-type registries (panels, commands, catalogs, agentTools).
Hosts compose plugins; the workspace fans them into their respective
registries and that's it. No lifecycle hooks, no dep graph, no
ordering field, no route plumbing on the contract — those are either
unused in Phase 1 or solved by simpler primitives (factories, npm
sub-path exports, `app.register(...)`).

The model unifies five fragmented host-wiring APIs into one. The
boring-macro-v2 migration is the acceptance test — ~260 LOC of glue
+ inlined UI bridge collapse to ~30 LOC of plugin definition.

## Scope of this plan

**Phase 1 (this PR's scope):**

- The `Plugin` contract + `definePlugin` factory
- Subscribe-aware registries (Catalog new; retrofit Command + Panel)
- One default plugin: `filesystemPlugin` (UI-only — panels + catalog; no agentTools per v7.0+)
- `<WorkspaceProvider plugins={…}>` and
  `createWorkspaceAgentApp({ plugins })` entry points
- File ops shared bundle in `@boring/agent`; filesystemPlugin
  references the same bundle (single source of truth, standalone
  agent stays a real coding agent)
- UI bridge moves from `@boring/agent` to `@boring/workspace`
- Path-aware (not basename-only) file-pattern panel resolver
- `WorkbenchLeftPane` becomes registry-driven so `excludeDefaults`
  actually removes default tabs (Files / Data)
- `SurfaceShell` fallback chain replaced with `EmptyFilePanel` so
  ghost tabs don't appear when registry resolution misses
- `<CommandPalette />` consumes catalogs via the registry
- Polymorphic Recent (entries tagged with their source catalog)
- `<ChatCenteredShell />` migrated off legacy `data` / `extraPanels`
  props (KEEPS `chatSuggestions` prop — it's app config, not a
  registry contribution; see §"Why no chatSuggestions on the
  contract")
- boring-macro-v2 migrated to a single inline plugin

**Phase 2 (sketched, separate PR):** npm-installable plugins via
package.json sub-path exports (`./client`, `./server`); pi loader
extension to read the wider `Plugin` shape; `/api/v1/plugins`
discovery endpoint for system-prompt augmentation; generic
`search_catalog(id, q)` agent tool; workbench data-tab catalog
selector.

**Phase 3 (longer-term):** agent-authored plugins; hot-reload;
sandboxing; capability flags; if/when needed: `dependsOn`,
`onMount`, etc., re-introduced as the dep graph stops being
trivial.

## Problem

Boring-macro-v2 — the realest "child app" we have — contributes
five distinct kinds of things and wires them through five different
APIs:

| Contribution | Macro's instance | Today's wiring |
|---|---|---|
| Panels | `chart-canvas`, `deck` | `<WorkspaceProvider panels={…}>` |
| Catalogs | Macro series catalog (87k FRED series) | `<ChatCenteredShell data={DataPaneConfig}>` |
| Agent tools | `execute_sql`, `macro_search`, `get_series_data`, `persist_derived_series` | `createAgentApp({ extraTools })` |
| Server routes | `registerMacroRoutes` (takes `{ clickhouse, deckRoot }`) | `app.register(registerMacroRoutes, { … })` |
| Commands | (none today) | (would be) `useCommandRegistry().registerCommand` |

Plus chat suggestions (a 6th but UX-bounded thing) and ~150 LOC of
`@boring/workspace`'s UI bridge code inlined into
`apps/boring-macro-v2/src/server/uiBridge.ts` (still present at 9.3
KB on disk — confirmed). The workspace package's server export now
builds; the inlined copy is dead weight that this plan deletes.

The pi-coding-agent already has a plugin loader
(`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`)
that handles **agent tools only** — flat `default: AgentTool[]` /
`tools: AgentTool[]` exports from `.pi/extensions/`,
`~/.pi/agent/extensions/`, and `node_modules/pi-plugin-*`. The
discovery infrastructure exists; the plugin shape is too narrow.

## Goal

1. **One Plugin contract.** Every contribution type that goes into
   an aggregating registry fits into one declarative object.
2. **Workspace orchestrates.** Bootstrap, file-pattern resolution,
   `excludeDefaults` opt-out all live in `@boring/workspace`.
3. **Composable.** File-pattern-driven panel resolution lets domain
   plugins bind their panes to their domain paths;
   late-wins-on-id lets hosts override anything at the abstraction
   level above.
4. **Honest boundaries.** Substrate is core (HTTP plumbing,
   registries, bridge); capabilities are plugins (file ops, data
   catalogs, macro). Defaults auto-mount; opt-outs are explicit and
   really take effect, including UI tabs.
5. **Forward-compatible.** Phase 1's inline path doesn't paint the
   model into a corner — Phase 2's npm + pi-loader extensions slot
   in additively.

## Decisions log (locked unless explicitly revisited)

The key architectural choices, summarized for fresh-eyes reviewers.
Each links to the changelog entry that locked it.

| Decision | Rationale | Locked at |
|---|---|---|
| **Pure-data Plugin contract (no lifecycle)** | All Phase 1 plugins are React-component-based or factory-injected. `onMount`/cleanup adds API surface that no Phase 1 plugin uses. | v6 |
| **No `dependsOn` for plugin deps** | Phase 1 has 1 declared dep total (macro → filesystem). Topo sort + dep graph not worth the contract surface; array order suffices. | v6 |
| **Routes off the Plugin contract** | Routes are HTTP infrastructure, not registry contributions. Mixing blurs identity AND lies about lifecycle (Fastify routes are non-unregisterable). | v6 |
| **`chatSuggestions` stays as a `<ChatCenteredShell>` prop** | UX cap (~6 cards) forces hosts to curate. Registry aggregation adds nothing useful. | v6.3 |
| **Filesystem tools are harness substrate, not plugin contributions** | "Should agent have file tools?" (harness) vs "Should UI have file tree?" (workspace) are distinct concerns at different layers. | v7.0 |
| **Reserved tool names** (`read`/`write`/`edit`/`find`/`grep`/`ls`/`bash`/`executeIsolatedCode`) | Harness owns these names. Plugins use domain prefixes (`macro_*`). Dev-warn on collision; no hard reject (some override IS intended). | v7.1 |
| **Single-pass mount; array order > topo sort** | Defaults prepended → register first; user plugins follow; late-wins-on-id handles overrides. | v6 |
| **Path-aware micromatch resolver with `(segments × 10) + non-wildcard chars` specificity** | Domain patterns (`deck/**/*.md`) must beat generic (`**/*.md`). Concrete formula → testable. | v6 |
| **Polymorphic Recent (catalogs + commands)** | VS Code/Raycast/Linear all show recent commands. Catalog-only would be a regression. | v6.3 |
| **`disableDefaultFileTools` (harness) vs `excludeDefaults` (workspace)** | Two switches at two layers. Conflating them was over-engineering. | v7.0 |
| **Per-plugin React error boundaries** | A plugin's panel can't crash the workspace shell. Failure isolation per pluginId. | v7.2 |
| **`Plugin.systemPrompt?: string` for LLM context augmentation** | Plugins frame their own domain to the LLM. macro tells the model "FRED database, use macro_*." Reduces host-author burden. | v7.2 |
| **`<PluginInspector />` ships in Phase 1 (DEV-only)** | Plugin authors debug "why didn't my command appear?" visually instead of via React DevTools. ~50 LOC, zero production cost. | v7.2 (un-cut from v6) |

If a reviewer wants to re-litigate a locked decision, they should
(1) read the linked changelog entry first, then (2) propose a
revision against the rationale documented there. Don't relitigate
from first principles — we've been there.

## Non-goals

- A plugin marketplace, signing, trust model, or capability sandbox.
- Hot-reload of plugins at runtime (Phase 1 — server boot loads,
  client boot loads; restart to add/remove). **Server-side caveat:**
  Fastify routes are boot-time-only and cannot be unregistered;
  this is one of the reasons routes are NOT on the Plugin contract
  in Phase 1.
- Cross-plugin dependency declarations. Plugins coordinate
  implicitly through shared registries (panel id namespace, catalog
  registry); they don't declare "I require plugin X." If/when a
  real dep graph appears, add `dependsOn` then.
- Plugin lifecycle hooks (`onMount` / `onUnmount`). All Phase 1
  plugins are pure declarative bags; if/when a plugin needs
  imperative setup, add the hook then.
- Numeric mount ordering (`Plugin.order`). Array order does the work
  — defaults register first, host plugins after, late-wins-on-id
  for collisions.
- Replacing the agent's runtime tools (`bash`,
  `execute_isolated_code`). Those are harness-level, not
  workspace-level. Stay in `@boring/agent`.
- Per-contribution dependency declarations.
- Cross-environment dynamic discovery in Phase 1 (the discovery
  endpoint is Phase 2).
- Inline plugin sandboxing (full host privileges; spec is a
  structuring tool, not a security boundary).
- Routes as a Plugin contract field. Plugin distributors ship
  routes via npm sub-path exports; hosts wire routes via
  `app.register(routePlugin, opts)`. See §"Distribution".
- Chat suggestions as a Plugin contribution. UX caps at ~6 cards →
  hosts curate, registry aggregation is useless. Stays as a
  `<ChatCenteredShell>` prop.

## Design

### The Plugin contract — six fields, all data

```ts
// @boring/workspace/shared/plugin.ts
import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "@boring/workspace"

export interface Plugin {
  /** Stable id. Convention: package or app name. Used for
   *  late-wins-on-id, debug provenance. */
  id: string

  /** Human-readable label (defaults to id). */
  label?: string

  /** Optional context prepended to the agent's system prompt at boot.
   *  Use to tell the LLM what your plugin's domain is and when its
   *  agent tools apply. Concatenated across all registered plugins
   *  (in registration order) and joined with newlines. Plain Markdown.
   *  ~200-500 chars per plugin recommended; longer eats context window.
   *  v7.2 addition. */
  systemPrompt?: string

  // Aggregating registries — every field fans into ONE registry that
  // genuinely benefits from cross-plugin merging.
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]

  // Server-only contribution.
  agentTools?: AgentTool[]
}
```

That's the entire contract. No lifecycle. No deps. No ordering. No
routes. No chat suggestions. No mount context. Just data.

### Concrete contribution types

```ts
// PanelConfig — already a discriminated union in
// packages/workspace/src/registry/types.ts. v6 PRESERVES the
// existing shape; the plugin model only ADDS fields:
//   - 'left-tab' | 'right-tab' to placement (registry-driven tabs)
//   - pluginId?: string (auto-set provenance)
// Existing fields kept verbatim: SyncPanelConfig vs LazyPanelConfig
// discriminated by `lazy: true | false`, requiresCapabilities,
// essential, chromeless, source: 'builtin' | 'app',
// definePanel<T>() factory.

interface PanelConfigBase {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  placement?: "left" | "center" | "right" | "bottom" | "left-tab" | "right-tab"
  filePatterns?: string[]                  // path-aware micromatch (Step 2d)
  requiresCapabilities?: string[]
  essential?: boolean
  source?: "builtin" | "app"
  chromeless?: boolean
  pluginId?: string                        // auto-set by registry
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

// CommandConfig — already exists; only adds pluginId.
type CommandConfig = {
  id: string
  title: string
  shortcut?: string
  when?: () => boolean
  run: () => void
  pluginId?: string
}

// CatalogConfig — new.
type CatalogConfig = {
  id: string
  label: string
  adapter: ExplorerAdapter                 // existing DataExplorer type
  onSelect: (row: ExplorerRow) => void
  pluginId?: string                        // auto-set by registry
}
// NOTE: v5/v6 had a `recentKind?: string` field intended for Recent
// fallback when the source catalog is unregistered. The spec
// settled on "drop orphan entries" — so recentKind would be set
// but never read. Cut from v6.1. Future Phase 2 "filter Recent by
// kind" UX can add it back as a non-breaking optional field.

// AgentTool — already exists in @boring/agent/shared
```

`pluginId` is set automatically when contributions are fanned into
registries; plugin code never assigns it. Late-wins-on-id collisions
log a dev-mode warning identifying both contributors.

### PanelConfig roles — three uses, one type (v7.3)

The `PanelConfig` type unifies three conceptually-distinct
contributions disambiguated by `placement`. v7.x keeps them in one
type for impl simplicity; **Phase 2 may go to a discriminated union**
(see Phase 2 sketch). Plugin authors should treat the three roles
as semantically separate even though they share a TypeScript type.

#### 1. Sidebar tab — `placement: 'left-tab' | 'right-tab'`

Persistent tab in `WorkbenchLeftPane` (and, reserved, the
not-yet-built `WorkbenchRightPane`). Always-on; user clicks to
activate; the tab content renders inside the sidebar pane.

**Required fields:** `id`, `title`, `component`, `placement`.
**Should NOT set:** `filePatterns` (sidebar tabs aren't file-routed —
they're navigation surfaces).
**Examples:**
- `filesystemPlugin`'s `files` tab (FileTreePanel)
- macroPlugin's `macro-series` tab (DataExplorer with macroAdapter)

#### 2. Workbench pane — `placement: 'center'`

Ephemeral content opened via `surface.openFile(path)` (file-pattern
resolver picks the panel) or `surface.openPanel({component, params})`
(host-author picks explicitly). Lives as a tab in the dockview
center area. Closes when user closes the tab.

**Required fields:** `id`, `title`, `component`, `placement: 'center'`.
**Often set:** `filePatterns: string[]` to drive auto-routing on
`openFile()`. Without filePatterns, the panel can ONLY be opened
explicitly via `openPanel({component: '<id>'})`.
**Examples:**
- `filesystemPlugin`'s `code-editor` (`filePatterns: ["**/*.ts", ...]`)
- `filesystemPlugin`'s `markdown-editor` (`filePatterns: ["**/*.md"]`)
- macroPlugin's `chart-canvas` (no filePatterns — opened explicitly
  by macroSeriesPanel's `onActivate`)
- macroPlugin's `deck` (`filePatterns: ["deck/**/*.md"]` — beats the
  generic markdown editor for deck files via specificity scoring)

#### 3. Bottom dock — `placement: 'bottom'`

Fixed-position panel below the workbench center area. Persistent
across tab changes. Suitable for terminals, consoles, log viewers.

**Required fields:** `id`, `title`, `component`, `placement: 'bottom'`.
**Should NOT set:** `filePatterns`.
**Examples (none ship in Phase 1):** a future `terminalPlugin`
might contribute a bottom dock.

#### Reserved / future placements

- `'right-tab'` — symmetric to `'left-tab'` but no Phase 1 component
  consumes it (no `WorkbenchRightPane` exists). Keep the union member
  for plugin authors who anticipate the right pane shipping.
- `'left'` / `'right'` (without `-tab` suffix) — legacy placements
  for non-tabbed left/right docks. Existing in current `PanelConfig`
  union; Phase 1 plugins don't use them.

#### Future contribution type — `Plugin.pages?: PageConfig[]`

A "page" is a **full-viewport** view that replaces the chat-centered
shell entirely. Conceptually similar to VS Code's `viewsContainers`
(activity-bar entries). Use cases: a "Settings" page, a "Reports"
dashboard, a multi-step "Onboarding" flow.

```ts
interface PageConfig {
  id: string                          // 'settings', 'reports'
  title: string
  icon: ComponentType<{ className?: string }>
  route?: string                      // '/settings' — optional URL routing
  component: ComponentType            // mounts at viewport level
}
```

**Out of scope for Phase 1** — no boring-* host has a real page need.
Phase 2/3 if/when the first plugin author proposes it.

#### Why one type today, possibly split later

The three roles share enough structure (id, title, component,
placement, source provenance) that splitting up-front would just
add fields without enforcing meaningful invariants — `filePatterns`
is the only role-specific field, and runtime validation
(`PanelRegistry.resolve` only consults `filePatterns` for `'center'`
panels) handles it correctly even when authors set it on the wrong
placement.

The split becomes worth it when:
- A second role-specific field appears (e.g., sidebar tabs gain
  `tabOrder`, bottom docks gain `defaultHeight`)
- Plugin authors hit type-confusion bugs in practice

Phase 2's discriminated-union refactor (`SidebarTabPanel | WorkbenchPane
| BottomDock`) is a 2-3 hour change once we decide to do it.
TypeScript narrowing makes the consumer-side ergonomic
(`registry.resolve()` filters by kind first; sidebar-tab consumers
filter by kind too).

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

**Stateful plugins (or plugins with server deps)** — wrap in a
factory function. The factory captures runtime config and returns a
Plugin:

```ts
export const makeMacroPlugin = (): Plugin =>
  definePlugin({
    id: "boring-macro",
    label: "Macro",
    panels: [chartCanvasPanel, deckPanel],
    catalogs: [seriesCatalog],
    agentTools: macroAgentTools,
  })
```

For plugins whose **server-side dependencies** (DB clients,
filesystem roots, etc.) need to be constructed at boot, the deps
DON'T enter the Plugin shape — they go to the route handlers the
host wires separately. See §"Where do routes go?" below.

### What `definePlugin` validates

Validation runs synchronously at the `definePlugin({...})` call.
Throwing means the plugin module fails to import — the host's build
or dev server reports the error with a clear stack trace.

Checks:

1. `id` is a non-empty string. (Convention: kebab-case package or
   app name; not enforced.)
2. Within `panels`: each `id` is unique within this plugin; each
   `placement` is one of the allowed values; if `lazy: true` the
   `component` is a function returning a Promise; if `lazy:
   false`/absent the `component` is a `ComponentType`.
3. Within `commands`: each `id` is unique within this plugin; `run`
   is a function.
4. Within `catalogs`: each `id` is unique within this plugin;
   `adapter.search` is a function; `onSelect` is a function.
5. Within `agentTools`: delegates to `validateAgentTool` (which
   re-exports `validateTool` from `@boring/agent/shared`). Each
   tool has non-empty `name`, `description`, `parameters` object,
   and `execute` function.

Cross-plugin id collisions (same panel id from two different
plugins) are NOT errors — they're handled by late-wins-on-id at
registration time, with a dev-mode warning.

```
PluginValidationError: plugin "boring-macro": catalogs[0].adapter.search
must be a function (got: undefined)
```

### Reserved tool names (v7.1)

The harness substrate registers a fixed set of tool names: **`bash`,
`executeIsolatedCode`, `read`, `write`, `edit`, `find`, `grep`,
`ls`** (plus any custom non-pi additions made in
`buildFilesystemAgentTools`). Plugin-contributed `agentTools` MUST
NOT use these names.

**Convention:** plugin-contributed tool names should use a
domain prefix (e.g., `macro_search`, `macro_execute_sql`,
`docs_lookup`) so they're unambiguously plugin-scoped, never
shadowing harness tools.

**Why an explicit rule:** today `definePlugin` accepts any name
without checking against harness names; the existing `mergeTools`
path can let plugin tools override harness tools by `name`
collision (`packages/agent/src/server/catalog/mergeTools.ts:30`).
That override behavior is intentional for the LEGACY pi loader's
late-wins-on-name semantics, but it's an anti-pattern for the
v7.1 plugin model where harness ownership is supposed to be
clean.

**Phase 1 enforcement:** dev-mode `console.warn` from `definePlugin`
when a plugin's `agentTools[].name` matches the substrate set.
**No hard rejection** — there are real cases (a plugin shipping a
specialized `read` for encrypted files) where override IS
intended; the warn gives an audit trail without breaking those.
The plugin's intent should be explicit in the plugin's docs/README.

### Plugin id collision policy — plugin-level vs contribution-level

Two distinct collision types with different semantics:

| Collision | Example | Policy | Why |
|---|---|---|---|
| Two plugins share `Plugin.id` | Two npm packages both register `id: "boring-macro"` | **Throw at registration** (`PluginError { kind: 'duplicate-id' }`) | Same plugin id = same identity. Two things claiming the same identity is an authoring bug, not a composition pattern. Hosts should rename or remove one. |
| Two plugins contribute same panel/command/catalog id | macro and superCoder both contribute `id: "code-editor"` | **Late-wins, dev-warn** | Composition pattern: a host plugin overrides a default. Working as intended; warn so the override is traceable. |

The plugin-level collision throws because there's no useful
"override the whole plugin" semantic — if you want to replace a
plugin, exclude it via `excludeDefaults` and register a different
one with a different id.

### Build/bundle invariants

A plugin module split across `plugin.client.ts` and
`plugin.server.ts` MUST avoid cross-import. Server modules import
`node:*`, Fastify types, DB clients; bundling them into the client
breaks the build (or worse, ships secrets to browsers).

Three enforcement strategies (any one suffices):

1. **`"use server"` / `"use client"` directives** at the top of
   each file (RSC-style). Bundlers honor them. This is the
   recommended approach.
2. **Per-environment package.json `exports`**: in npm-distributed
   plugins (Phase 2), expose `./client` and `./server` sub-paths
   that point at non-overlapping bundles.
3. **Vite/tsup conditional imports**: `import.meta.env.SSR` guards
   server-only requires.

Inline plugins (Phase 1) typically use strategy 1 plus a barrel
`plugin/index.ts` that re-exports only client-safe symbols by
default; server entry imports `plugin/server.ts` directly when it
needs the server half.

The plan does NOT add static enforcement (e.g., a custom ESLint
rule). Reviewers + CI build catches the leak. This can change if
mistakes prove common.

### Plugin testability

Plugins are pure data. Testing them at three levels:

**Unit — assert contract shape:**

```ts
import { describe, it, expect } from "vitest"
import { makeMacroPlugin } from "../plugin"

describe("makeMacroPlugin", () => {
  it("registers expected contributions", () => {
    const p = makeMacroPlugin()
    expect(p.id).toBe("boring-macro")
    expect(p.panels?.map((x) => x.id)).toContain("deck")
    expect(p.catalogs?.map((x) => x.id)).toContain("macro-series")
    expect(p.agentTools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["execute_sql", "macro_search"]),
    )
  })
})
```

No registries, no provider, no Fastify — just inspect the returned
object. `definePlugin` validation already ran at module load.

**Integration — render through `<WorkspaceProvider>`:**

```ts
import { renderHook } from "@testing-library/react"
import { WorkspaceProvider, useCatalogs } from "@boring/workspace"

const wrapper = ({ children }) => (
  <WorkspaceProvider plugins={[makeMacroPlugin()]}>{children}</WorkspaceProvider>
)
const { result } = renderHook(() => useCatalogs(), { wrapper })
expect(result.current.find((c) => c.id === "macro-series")).toBeDefined()
```

Tests the bootstrap fan-in + registry subscriptions in one shot.

**Server — boot a Fastify app with the plugin:**

```ts
import { createWorkspaceAgentApp } from "@boring/workspace/server"

const app = await createWorkspaceAgentApp({
  plugins: [makeMacroPlugin()],
  workspaceRoot: tmpDir,
})
const res = await app.inject({ url: "/api/v1/catalog/agent-tools" })
expect(res.json()).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: "execute_sql" }),
]))
await app.close()
```

Use Fastify's `inject()` for in-process testing; no port binding.

### Convenience: `makeStaticDataPlugin(opts)`

Dropping `data: DataPaneConfig` from `<ChatCenteredShell>` removed
the one-liner ergonomics for hosts that just want a simple data
tab with their adapter (gemini P2). Restore them via a convenience
factory exported from `@boring/workspace`:

```ts
// packages/workspace/src/plugin/factories/makeStaticDataPlugin.ts
import { definePlugin, type Plugin } from "../definePlugin"
import { DataExplorer } from "../../components/DataExplorer"
import type { ExplorerAdapter, ExplorerRow } from "../../components/DataExplorer/types"

export interface StaticDataPluginOpts {
  /** Plugin id; defaults to "static-data". Must be unique if a host
   *  uses more than one. */
  id?: string
  label?: string
  adapter: ExplorerAdapter
  /** Optional onActivate — fires when a row is double-clicked /
   *  primary-activated. If omitted, only the catalog onSelect runs
   *  (cmd palette pick). */
  onActivate?: (row: ExplorerRow) => void
}

export function makeStaticDataPlugin(opts: StaticDataPluginOpts): Plugin {
  const id = opts.id ?? "static-data"
  return definePlugin({
    id,
    label: opts.label ?? "Data",
    panels: [{
      id: `${id}-tab`,
      title: opts.label ?? "Data",
      placement: "left-tab",
      component: () => <DataExplorer adapter={opts.adapter} onActivate={opts.onActivate} />,
      source: "app",
    }],
    catalogs: [{
      id,
      label: opts.label ?? "Data",
      adapter: opts.adapter,
      onSelect: opts.onActivate ?? (() => {}),
    }],
  })
}
```

Host with simple needs (single adapter, no custom panel):

```tsx
import { makeStaticDataPlugin } from "@boring/workspace"
import { myAdapter } from "./adapter"

<WorkspaceProvider plugins={[makeStaticDataPlugin({ adapter: myAdapter })]}>
  <ChatCenteredShell />
</WorkspaceProvider>
```

Macro doesn't use this factory — it has custom row-activation
behavior (open chart-canvas panel) that needs `surfaceRef` access,
so its `macroSeriesPanel` is hand-authored. The factory serves the
~80% case where the host just wants "a data tab with this
adapter."

### Concrete filesystemPlugin source

```ts
// packages/workspace/src/plugin/defaults/filesystemPlugin.ts (v7.1 — UI-only)
import { definePlugin, type Plugin } from "../definePlugin"
import { FileTreePanel, CodeEditorPanel, MarkdownEditorPanel } from "../../panels"
import { filesCatalog } from "./filesystemCatalog"

export const filesystemPlugin: Plugin = definePlugin({
  id: "filesystem",
  label: "Filesystem",

  panels: [
    {
      id: "files",
      title: "Files",
      component: FileTreePanel,
      placement: "left-tab",
      source: "builtin",
    },
    {
      id: "code-editor",
      title: "Code",
      component: CodeEditorPanel,
      placement: "center",
      filePatterns: [
        "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
        "**/*.py", "**/*.rs", "**/*.go", "**/*.json", "**/*.yml", "**/*.yaml",
      ],
      source: "builtin",
    },
    {
      id: "markdown-editor",
      title: "Markdown",
      component: MarkdownEditorPanel,
      placement: "center",
      filePatterns: ["**/*.md", "**/*.mdx"],
      source: "builtin",
    },
  ],

  catalogs: [filesCatalog],
  // No agentTools field — file tools are HARNESS substrate (live in
  // @boring/agent via pi-tools-migration's bundle factories). See
  // §"Tools belong with the harness, not the plugin".
})
```

The panel ids (`code-editor`, `markdown-editor`) are the override
seams: a host plugin can register the same id with a
`SuperCoderPanel` and late-wins-on-id replaces. `source: "builtin"`
means user/app-source plugins win the file-pattern resolver
tie-breaker.

`filesCatalog` (in `filesystemCatalog.ts`) wires
`/api/v1/files/search` to the catalog adapter — the same backend
the LLM's `find` tool uses, so the cmd palette and the LLM
share one search engine.

### Where do routes go?

Not on the Plugin contract. Routes are HTTP infrastructure; plugins
are registry contributions. Mixing them blurs identity AND lies
about lifecycle (Fastify routes can't be unregistered, but a
contract field would imply they could).

**Three categories of routes** in the running app:

| Source | Who registers | Where |
|---|---|---|
| Substrate (`/api/v1/ui/*`, `/api/v1/files`, `/tree`, `/files/search`) | `createWorkspaceAgentApp` itself, always | Inside the workspace package; hosts don't see this. |
| Agent core (`/api/v1/chat`, `/sessions`, `/models`) | `createAgentApp` itself, always | Inside the agent package; hosts don't see this. |
| Plugin-specific (e.g. `/api/v1/macro/*`) | The host, via Fastify's standard `app.register(...)` | The host's server entry. One line per plugin that has routes. |

**Macro's host server entry**:

```ts
// apps/boring-macro-v2/src/server/index.ts
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { makeMacroPlugin } from "../plugin"
import { registerMacroRoutes } from "../server/macroRoutes"

const clickhouse = await createClickHouseClient(env)

const app = await createWorkspaceAgentApp({
  plugins: [makeMacroPlugin()],         // ← UI/catalog/tool contributions
})
await app.register(registerMacroRoutes, { clickhouse, deckRoot })  // ← routes (one line)
await app.listen({ port })
```

In Phase 1, **only macro** has plugin-specific routes (filesystem's
routes are substrate; dataCatalog has none; chat-shell has none).
So this single extra line per plugin-with-routes is the entire
"routes story." No new abstraction needed.

### Why no chatSuggestions on the contract

The other contribution types pass an honest aggregation test: *N
plugins each contribute items, all merged by a registry, all useful
to the user.* Chat suggestions fail that test:

- Empty-state UX caps at ~4–6 cards.
- N plugins × 4–6 each = 12–24, way more than the cap.
- Truncation forces the host to **curate** which suggestions appear
  → if the host curates, the registry adds nothing.

So suggestions stay where they belong: a single `ChatSuggestion[]`
prop on `<ChatCenteredShell>`, host writes it directly. macro's
plugin module re-exports the suggestions array as a regular const;
the host imports + passes alongside the plugin:

```tsx
// apps/boring-macro-v2/src/web/App.tsx
import { makeMacroPlugin, macroChatSuggestions } from "../plugin"

<WorkspaceProvider plugins={[makeMacroPlugin()]}>
  <ChatCenteredShell chatSuggestions={macroChatSuggestions} />
</WorkspaceProvider>
```

`ChatSuggestion` lives in `@boring/agent/front-shadcn` as today; no
type changes. The plan does NOT delete `chatSuggestions` from
`<ChatCenteredShell>`'s props (reverses an earlier draft).

### Default plugins — ONE, finalized (UI-only)

| Plugin | Contributes | Why a plugin (not core) |
|---|---|---|
| **`filesystemPlugin`** | UI-only: a Files catalog (cmd palette); FileTree panel registration as `placement: 'left-tab'`; CodeEditor + MarkdownEditor panel registrations (with `filePatterns`). **No `agentTools` field** — file tools are harness substrate (see §"Tools belong with the harness, not the plugin"). | Hosts that want a chat-only UI (no file tree, no code editor opening on file click) can opt out. When excluded: file UI disappears; LLM file tools STAY (controlled separately by `disableDefaultFileTools` on `createAgentApp`). |

**v6 had a `dataCatalogPlugin` second default; v6.2 cuts it.**
Reason (codex round-3 P1): with `recentKind` cut and no other
filter, a generic "Data" tab couldn't unambiguously pick *which*
catalog to display when multiple plugins contribute catalogs (e.g.,
filesystem's Files catalog + macro's Series catalog). Rather than
re-add a `defaultForDataTab` flag or invent precedence, **plugins
that want a workbench data tab register their own `placement:
'left-tab'` panel** that internally renders DataExplorer with their
adapter. macro's plugin gets a "Macro Series" tab; filesystem
already has the Files tab; no generic placeholder.

If a host wants a vanilla "pick any catalog" data tab, they can
register one — it's not a hard substrate concern.

**Note on filesystem ROUTES:** `/api/v1/files`, `/tree`,
`/files/search` are **substrate**, not part of `filesystemPlugin`.
`createWorkspaceAgentApp` always registers them so the workspace
UI's HTTP plumbing works; `excludeDefaults: ['filesystem']` removes
the filesystem **capability** (tools + tabs + editors) but leaves
the HTTP plumbing available for any host or other plugin.

The single default plugin auto-mounts. Hosts opt out via:

```tsx
<WorkspaceProvider
  plugins={[macroPlugin]}
  excludeDefaults={["filesystem"]}    // or [] (only filesystem is a default)
>
```

`excludeDefaults` is the single switch — no `includeDefaults`
allowlist.

#### Tools belong with the harness, not the plugin (v7.0)

Earlier drafts (v5–v6.3) had `filesystemPlugin` carry `agentTools`
via a factory + a "dual registration path" that suppressed
duplication between standalone agent and workspace hosts. v7.0
drops this entire arrangement. **File ops tools are harness
substrate, not plugin contributions.** Two separate concerns,
two separate switches:

| Concern | Real opt-out switch | Layer |
|---|---|---|
| Should the agent have file tools? | `disableDefaultFileTools: true` on `createAgentApp` | Harness config |
| Should the UI have a file tree / Files tab? | `excludeDefaults: ['filesystem']` on `<WorkspaceProvider>` | Workspace config |

These should NOT be the same switch — they live at different
layers. Conflating them was over-engineering.

#### Where file tools actually live (v7.0)

Per `packages/agent/docs/plans/pi-tools-migration.md` (which ships
before this plan), `@boring/agent` exposes:

- `buildHarnessAgentTools(bundle): AgentTool[]` — `[bash, executeIsolatedCode]`
- `buildFilesystemAgentTools(bundle): AgentTool[]` — `[read, write, edit, find, grep, ls]` plus any custom non-pi additions

`createAgentApp` registers both bundles by default. Opt out of
file ops with `disableDefaultFileTools: true`. Standalone CLI agent
keeps file tools because it's a coding agent — that's the harness's
job, not a plugin's.

`createWorkspaceAgentApp` does **not** pass
`disableDefaultFileTools` — it just wraps `createAgentApp`
unchanged + runs the plugin bootstrap on top. No dual-registration.

#### Custom (non-pi) filesystem tools

`buildFilesystemAgentTools(bundle)` is NOT restricted to pi's
factories. It can return pi tools + project-specific filesystem
tools that don't exist in pi's catalog. Examples that might land
here later:

- `watch_files(glob)` — long-poll for file changes (pi has no equivalent)
- `stat(path)` — file metadata (size, mtime, perms)
- `git_status` / `git_diff` — git-aware filesystem ops
- `multi_edit(edits[])` — atomic batch edits across many files

These would be **substrate** alongside pi's defaults — same
registration path, same lifecycle. They live in
`@boring/agent/server/tools/filesystem/` (not in
`filesystemPlugin`). Author wraps them as `AgentTool`; bundle
factory composes them into the array.

The principle from pi-tools-migration's Principle 3 still applies:
add custom tools only when pi cannot be made to work. But "can't
be made to work" includes "pi doesn't ship this capability at all."

**filesystemPlugin (v7.0) — UI-only, plain const, no factory:**

```ts
// packages/workspace/src/plugin/defaults/filesystemPlugin.ts
import { definePlugin } from "../definePlugin"
import { FileTreePanel, CodeEditorPanel, MarkdownEditorPanel } from "../../panels"
import { filesCatalog } from "./filesystemCatalog"

export const filesystemPlugin = definePlugin({
  id: "filesystem",
  label: "Filesystem",
  panels: [
    { id: "files", title: "Files", component: FileTreePanel, placement: "left-tab", source: "builtin" },
    { id: "code-editor", title: "Code", component: CodeEditorPanel, placement: "center", filePatterns: [...], source: "builtin" },
    { id: "markdown-editor", title: "Markdown", component: MarkdownEditorPanel, placement: "center", filePatterns: ["**/*.md", "**/*.mdx"], source: "builtin" },
  ],
  catalogs: [filesCatalog],
  // No agentTools — file tools live with the harness in @boring/agent.
})
```

No `(deps)` argument. No runtime bundle dependency. Plain
module-scope const that imports cleanly. WorkspaceProvider /
createWorkspaceAgentApp prepend it as a default unless
`excludeDefaults: ['filesystem']` says otherwise.

No "ONE source of truth, TWO registration paths" puzzle. Just:
**harness owns tools; plugins own UI.**

### Core — substrate, not plugins

Always present. Not pluggable. Replacing core by accident shouldn't
be possible.

- Per-type registries (Catalog new; Command + Panel retrofitted
  subscribable)
- EventBus (already shipped in `packages/workspace/src/events/`)
- UiBridge (in-memory message queue;
  `@boring/workspace/src/bridge/`)
- React component primitives: `CodeEditor`, `MarkdownEditor`,
  `FileTree`, `DataExplorer`, `EmptyPane`, `EmptyFilePanel` (the
  components themselves are core exports; their **panel
  registrations** with `filePatterns` belong to the relevant
  default plugin)
- Default agent tools that expose the substrate: `get_ui_state`,
  `exec_ui` (registered directly by `createWorkspaceAgentApp`)
- Default routes: `/api/v1/ui/*`, `/api/v1/files`, `/tree`,
  `/files/search` (registered directly)
- Default commands: `toggleSidebar`, `toggleAgentPanel`, `closeTab`
- Chat shell + palette + workbench themselves
- ChatPanel mount point

**Substrate is core, capabilities are plugins.**

### Plugin composability — file-pattern resolution + late-wins

**File-pattern panel resolution.** The current resolver
(`PanelRegistry.ts:91`, `SurfaceShell.tsx:98`) matches **basename
only** via a hand-rolled `*suffix`/exact matcher. It also has a
working source-priority tie-breaker (`app` beats `builtin`) which
we PRESERVE. Phase 1 step 2 upgrades the matcher itself to
**path-aware micromatch** so patterns like `deck/**/*.md` actually
work. When `openFile(path)` runs:

1. Filter panels whose `filePatterns` include the full `path` under
   path-aware micromatch (`{ matchBase: false, dot: true }`).
2. Sort by **specificity** —
   `score = (segment_count * 10) + non_wildcard_chars`. Higher wins.
3. Tie-break A: `source: 'app'` beats `source: 'builtin'` (current
   behavior, preserved).
4. Tie-break B: registration order, late wins.
5. Hosts can bypass pattern matching at the call site:
   `surface.openPanel({ component: "<id>", … })`.

**Late-wins-on-id.** If two contributions share the same `id`, the
later registration wins. Combined with the convention that defaults
mount before host plugins, this means:

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
```

Late-wins logs a dev-mode `console.warn` so the override is
traceable.

### Plugin patterns: cross-plugin communication (v7.2)

The plan deliberately omits `dependsOn` (see §Non-goals) — but
plugins still need to coordinate. Three canonical patterns, each
with a worked example:

**1. Shared registry — read another plugin's catalog.** No dep
edge needed; null-check + graceful degradation.

```ts
// Inside Plugin B's panel component
const catalogs = useCatalogs()
const filesCatalog = catalogs.find(c => c.id === "files")
if (filesCatalog) {
  const result = await filesCatalog.adapter.search({
    query: "foo", filters: {}, limit: 50, offset: 0, signal,
  })
  // …use result.items
}
// If filesystemPlugin isn't loaded → filesCatalog is undefined → skip.
```

**2. Event bus — emit + subscribe.** Decoupled; transitions only.

```ts
// Plugin A: in a panel component
const onClick = () =>
  events.emit("plugin-a:thing-happened", { ts: Date.now(), userId })

// Plugin B: in another panel component
useEvent("plugin-a:thing-happened", (payload) => { /* react */ })
```

New event keys go in `WorkspaceEventMap` (events declared on
demand — see §Event bus integration).

**3. Late-wins override — replace another plugin's panel.**

```ts
// Plugin B (registered after Plugin A) overrides A's "code-editor"
definePlugin({
  id: "super-coder",
  panels: [{
    id: "code-editor",      // SAME id as filesystem's default
    component: SuperCoderPanel,
    placement: "center",
    filePatterns: ["**/*.ts"],
    source: "app",
  }],
})
```

Late-wins-on-id replaces filesystem's `CodeEditorPanel` for any
`*.ts` file. Dev-mode `console.warn` flags the override; no hard
error.

**When to use which:**

| Pattern | When |
|---|---|
| Shared registry | Plugin B needs Plugin A's data (catalog, panel, command) at runtime. |
| Event bus | Plugin B reacts to something Plugin A does. No return value, no dependency. |
| Late-wins override | Plugin B replaces a default's panel/command/catalog by id. Composition pattern. |

**Anti-patterns — don't do these:**

- Direct module import between plugins (couples them; defeats the registry).
- Module-scope `events.on(...)` (fires globally; leaks subscriptions).
- Polling for another plugin's state (use the event bus instead).

### Workspace orchestration — bootstrap

```
bootstrap(plugins, opts):
  finalSet = [...defaultPlugins.filter(d => !excludeDefaults.includes(d.id)),
              ...opts.plugins]

  for each plugin in finalSet (array order):
    fan plugin.panels   → PanelRegistry        (pluginId provenance)
    fan plugin.commands → CommandRegistry      (pluginId provenance)
    fan plugin.catalogs → CatalogRegistry      (pluginId provenance)
    (server) fan plugin.agentTools → AgentToolRegistry
```

That's it. Single pass. No async. No lifecycle. No ordering
contract beyond "array order." Defaults are prepended so they
register first; host plugins register after; late-wins-on-id gives
hosts a clean override mechanism without explicit precedence rules.

The retrofit applies to existing `CommandRegistry` and
`PanelRegistry` — they get `subscribe()` semantics so late
`registerCommand` calls reach an open palette.

### Per-plugin error boundaries (v7.2)

A plugin's panel that throws during render must NOT crash the
workspace shell. Every plugin contribution that renders React
(panels; catalog adapter row renderers; `<ChatEmptyState>` cards
sourced from chatSuggestions) is wrapped in
`<PluginErrorBoundary pluginId={id}>`. On error:

1. Boundary renders an `<ErrorChip>` showing the plugin id +
   short error message in place of the contribution.
2. A `PluginError { kind: 'contribution', pluginId, error }` is
   pushed onto `WorkspaceContext.errors` (consumed by
   `<PluginInspector />`).
3. Other plugins continue rendering unaffected.

Implementation sites:

- `<PanelHost panelId>` — wraps the resolved panel component.
- `<CatalogResults>` — wraps each row renderer (so a bad row
  doesn't kill the palette).
- The chat shell's empty-state card list — wraps each
  `<ChatSuggestion>` card.

No contract change for plugin authors. The boundary is a
host-side wrapper; plugins just opt in implicitly by having their
contribution mounted.

**Server-side parallel:** per-catalog-search try/catch already
covered in §Error model. The CommandPalette's debounced search
loop catches per-catalog `search()` rejections and surfaces them
as inline error chips per catalog group; one bad adapter doesn't
fail the entire palette query.

### Search semantics — debouncing + cancellation (v7.2)

The CommandPalette runs catalog searches on every keystroke.
Without coordination this would (a) race (older search resolves
after newer; UI shows stale results) and (b) waste work (5
catalogs × 10 keystrokes = 50 in-flight HTTP fetches).

`@boring/workspace/plugin` exports `useDebouncedCatalogSearch`:

```ts
function useDebouncedCatalogSearch(
  query: string,
  opts?: { debounceMs?: number },
): {
  results: Map<string, ExplorerRow[]>     // catalogId → rows
  loading: boolean
  errors: Map<string, Error>              // catalogId → error (per-catalog)
}
```

Behavior:
- Debounces 150ms by default (override via `debounceMs`).
- On every new query: aborts in-flight searches via
  `AbortController.abort()`, fires fresh ones across all registered
  catalogs in parallel.
- Per-catalog errors (one adapter throws) isolated — surface in
  `errors` map; other catalogs still return results.

**Adapter contract:** `ExplorerAdapter.search(args: SearchArgs)`
already accepts `args.signal?: AbortSignal` (verified live at
`packages/workspace/src/components/DataExplorer/types.ts:46-55`).
Adapters that honor the signal get cancellation; adapters that
ignore it are still safe (last-write-wins via the debounce).

**Plugin authors:** if your catalog hits an HTTP backend, pass
`args.signal` to `fetch(url, { signal })`. If your catalog runs
synchronous filtering, you can ignore the signal — debouncing
handles the wasted-work case.

### Polymorphic Recent

The Command Palette today has a Recent section with a known bug
(`CommandPalette.tsx:34`-`60`, `:157`, `:230-232`): it stores items
uniformly as path strings and renders all entries through
`FilePathLabel`. When a command is the most-recent action it
renders as a (broken) file path.

The plugin model fixes this by tagging each Recent entry with the
catalog it came from. RecentStore entries:

```ts
type RecentEntry =
  | {
      type: "catalog"
      catalogId: string             // ↔ CatalogConfig.id
      rowId: string                 // ↔ ExplorerRow.id within that catalog
      /** Snapshot of the row at time of selection. Guards against
       *  catalog data changing under our feet (file renamed, series
       *  re-tagged, …). Cheap (~200 bytes); essential because
       *  adapters don't have a `getById(rowId)` method.
       *  IMPORTANT: ExplorerRow participating in Recent MUST be
       *  100% JSON-serializable — see §"Recent serialization
       *  invariant" (gemini P1). */
      rowSnapshot: ExplorerRow
      selectedAt: number            // unix ms
    }
  | {
      type: "command"
      commandId: string             // ↔ CommandConfig.id
      /** Snapshot of the command's title at time of selection,
       *  in case the command is later unregistered. */
      titleSnapshot: string
      selectedAt: number
    }
```

Render flow:

1. For each entry, look up the source by id (catalog by
   `catalogId`, command by `commandId`). If absent (plugin
   uninstalled, command unregistered), drop the entry — don't
   render orphans. Show `titleSnapshot` text only if the user
   needs to see what they recently used (we drop on click since
   we can't run a missing command).
2. For `type: "catalog"`: render via the catalog's adapter row
   renderer; on click → `catalog.onSelect(rowSnapshot)`.
3. For `type: "command"`: render the title with a small "command"
   chip; on click → `command.run()`.

**Recent covers BOTH catalog rows AND commands** (gemini P1
correction — earlier drafts said "catalog-only," but every mature
palette UX — VS Code, Raycast, Linear — keeps recent commands.
Re-running frequent actions like "Toggle Theme" / "Format JSON"
is the primary use case for many users).

Existing localStorage entries (`boring-ui-v2:command-palette:recent`)
are read once on first load. Strings prefixed `cmd:` (today's
broken command path) become `{type: "command", commandId: ...}`;
plain path strings become `{type: "catalog", catalogId: "files",
rowId: path, rowSnapshot: {...minimal row…}}`. Unrecognizable
entries dropped.

#### Recent serialization invariant (gemini P1)

`rowSnapshot: ExplorerRow` is round-tripped through
`JSON.stringify`/`JSON.parse` in localStorage. ExplorerRow values
that contain `Date`, `Map`, `Set`, functions, React nodes, or
class instances will be silently corrupted on save and crash on
restore.

**Invariant:** any `ExplorerRow` shape that can appear in a
catalog's selected items MUST be JSON-serializable. Adapters that
naturally hold non-serializable values (e.g., a Date object for
"last modified") should serialize at row construction time
(ISO string) and re-hydrate in the renderer.

**No `deserializeRecent` hook in Phase 1.** If a real adapter has
a need that the JSON-serializable invariant can't express, the
hook can be added as a non-breaking optional field on
`CatalogConfig`. Phase 1 doesn't need it; documenting the
constraint is sufficient.

### Registry-driven workbench tabs

Today `WorkbenchLeftPane` hardcodes Files / Data tabs
(`WorkbenchLeftPane.tsx:97`, `:174`, `:181`) — which means
`excludeDefaults: ['filesystem']` would suppress the filesystem
agent tools and catalogs but leave a dead Files tab in the UI.

Phase 1 step 5c retrofits `WorkbenchLeftPane` to query
`PanelRegistry` for `placement: 'left-tab'`, sorted by
registration order. `filesystemPlugin` contributes the Files tab;
`dataCatalogPlugin` contributes the Data tab.
`excludeDefaults: ['filesystem']` truly removes the tab.

(`'right-tab'` is reserved in the contract but no Phase 1 component
consumes it; `WorkbenchRightPane` doesn't exist yet.)

### Closing the SurfaceShell hardcoded-fallback hole

`SurfaceShell.fallbackComponentForPath`
(`SurfaceShell.tsx:81-91`) maps extensions to literal panel ids
(`code-editor`, `markdown-editor`, `csv-viewer`) regardless of
whether they're registered. `resolvePanelForPath`
(`SurfaceShell.tsx:99-108`) checks `registry.has(fallback)` then
returns the fallback id anyway as a "last-ditch."

Step 5c also fixes the resolver chain: registry resolve →
registered fallback (only if `has()`) → `EmptyFilePanel` (a core
panel) showing "No editor for `<path>` — install or enable a
plugin that handles `<ext>`." Zero ghost tabs when defaults are
excluded.

### Event bus integration

The bus is **already implemented** at
`packages/workspace/src/events/{bus,index,types,useEvent}.ts`. This
section reflects the actual API.

```ts
// Module singleton — import directly anywhere
import { events, useEvent } from "@boring/workspace/events"
import type { WorkspaceEventMap } from "@boring/workspace/events"

events.on("file:moved", ({ from, to }) => { /* … */ })  // returns unsubscribe
events.emit("file:moved", { ...userMeta(), from, to })

// React hook
useEvent("file:moved", ({ from, to }) => { /* … */ })
```

**Events are declared on demand** — `WorkspaceEventMap` (in
`events/types.ts`) intentionally pre-declares no future events.
Phase 1 does NOT add plugin lifecycle events because Phase 1
plugins have no lifecycle. If/when something emits and consumes,
the key gets added to the map.

**Plugin authors** subscribe via `useEvent` inside panel components
(natural React lifecycle, automatic cleanup) or via `events.on(...)`
inside route handlers. They do NOT receive an injected bus through
a plugin context — there's no plugin context to inject into.

**Package-exports gap:** the workspace package's `exports` map
(`packages/workspace/package.json:9-30`) currently exposes `.`,
`./testing`, `./ui-shadcn`, `./shared`, `./server`, `./globals.css`
— but NOT `./events`. Step 4a adds:

```json
"./events": {
  "types": "./dist/events.d.ts",
  "import": "./dist/events.js"
}
```

Plus the corresponding `tsup` entry. Events are also re-exported
from the package barrel for convenience.

### Phase 1 debug overlay: `<PluginInspector />` (v7.2)

DEV-only React component mounted by `<WorkspaceProvider>` when
`import.meta.env.DEV` (zero production bundle impact). Toggle via
`Cmd+Shift+P P` (or "Show Plugin Inspector" command).

Displays:
- Registered plugins: id, label, source (default / inline / npm),
  contribution counts (N panels, N commands, N catalogs, N agentTools)
- Per-plugin systemPrompt preview (first 200 chars; expandable)
- Errors keyed to plugin id (from `WorkspaceContext.errors`)
- Late-wins-on-id replacements: when plugin B overrode plugin A's
  contribution, both pluginIds shown
- Reserved-name collisions (if a plugin's agentTools name collides
  with harness substrate)

Implementation: ~50 LOC reading from registries via the existing
`useCatalogs`/`useCommands`/`useActivePanels` hooks plus a new
`usePlugins()` returning the list of registered plugins.

Why ship in Phase 1 (re-introduced from v6 cut): plugin authors
testing locally hit "why didn't my command appear?" repeatedly.
Inspector turns 5-minute spelunking into a 2-second visual check.

### Inline plugin layout (Phase 1)

```
apps/<some-app>/
├── package.json
├── src/
│   ├── plugin/
│   │   ├── index.ts            ← env-aware barrel + makeXyzPlugin factory
│   │   ├── plugin.shared.ts    ← id, label, fixed config
│   │   ├── plugin.client.ts    ← panels, catalogs, commands
│   │   └── plugin.server.ts    ← agentTools (route handlers live in src/server/)
│   ├── server/index.ts         ← createWorkspaceAgentApp({ plugins }) + app.register(routes)
│   └── web/App.tsx             ← <WorkspaceProvider plugins={[…]}>
```

For multi-plugin apps: `src/plugins/<id>/...` mirrors per plugin;
`src/plugins/index.ts` exports an array.

### Entry points

```ts
// CLIENT
import { WorkspaceProvider } from "@boring/workspace"
import { ChatCenteredShell } from "@boring/workspace"
import { makeMacroPlugin, macroChatSuggestions } from "../plugin"

<WorkspaceProvider plugins={[makeMacroPlugin()]}>
  <ChatCenteredShell chatSuggestions={macroChatSuggestions} />
</WorkspaceProvider>

// SERVER
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { makeMacroPlugin } from "../plugin"
import { registerMacroRoutes } from "../server/macroRoutes"

const clickhouse = await createClickHouseClient(env)
const app = await createWorkspaceAgentApp({
  plugins: [makeMacroPlugin()],
  // excludeDefaults: ["dataCatalog"]   // optional
})
await app.register(registerMacroRoutes, { clickhouse, deckRoot })
await app.listen({ port })
```

Both entry points auto-mount default plugins (filesystem +
dataCatalog) unless excluded.

## Distribution — Phase 2 sketch

**Inline plugins** (Phase 1) live in the host's source tree. No
distribution model needed — direct imports.

**npm-distributed plugins** (Phase 2) follow the standard
sub-path-exports pattern. Same Plugin shape, just delivered via
package boundaries:

```json
// pi-plugin-macro/package.json
{
  "exports": {
    "./client": { "types": "./dist/client.d.ts", "import": "./dist/client.js" },
    "./server": { "types": "./dist/server.d.ts", "import": "./dist/server.js" }
  }
}
```

```ts
// pi-plugin-macro/dist/client.js — UI half
export const macroClientPlugin = definePlugin({
  id: "boring-macro",
  panels: [chartCanvasPanel, deckPanel],
  catalogs: [seriesCatalog],
})
```

```ts
// pi-plugin-macro/dist/server.js — server half
export const macroServerPlugin = definePlugin({
  id: "boring-macro",                    // same id, different bag
  agentTools: macroAgentTools,
})
export const registerMacroRoutes = async (app, opts) => { /* … */ }

// optional convenience helper for hosts that want one-liner install:
export const installMacroServer = async (app, opts) => {
  await app.register(registerMacroRoutes, opts)
  return macroServerPlugin
}
```

```ts
// host server entry
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { macroServerPlugin, registerMacroRoutes } from "pi-plugin-macro/server"

const clickhouse = await createClickHouseClient(env)
const app = await createWorkspaceAgentApp({ plugins: [macroServerPlugin] })
await app.register(registerMacroRoutes, { clickhouse, deckRoot })
```

Two imports + two calls per server-side plugin. Same shape mature
ecosystems already use (Express middleware, Fastify plugins, Vite
plugins).

**The same plugin id** (`"boring-macro"`) on client and server ties
them together for provenance — but client and server processes don't
share state, so a "single fat plugin object spanning both" was
always an illusion.

## Relationship to pi-mono ecosystem

The pi-coding-agent's existing plugin loader
(`packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`)
gives us discovery infrastructure for free. Verified what it
actually does (2026-04-28):

- 4 discovery channels: `~/.pi/agent/extensions/`,
  `<cwd>/.pi/extensions/`, `node_modules/pi-plugin-*`, and
  `.pi/extensions.json`.
- Plugin module shape: `{ default: AgentTool[] | tools: AgentTool[] }`
  — **tools only**, flat list.
- Conflict resolution: late-wins-on-name with a warning.
- npm namespace convention: `pi-plugin-*`.
- Ecosystem index at
  `~/.pi/agent/extension-index.json` lists ~50+ extensions
  (`antigravity-image-gen`, `auto-commit-on-exit`, `bookmark`,
  `claude-rules`, …) — every one is a single-file `.ts` exporting
  tools.

**What pi explicitly DOESN'T have:** `dependsOn`, version ranges,
load ordering, multi-contribution types, lifecycle hooks. Pi
plugins are flat tool exporters. Cross-plugin coordination is not a
pi concern.

**What we adopt from pi:**

- Discovery channels verbatim (Phase 2's pi loader extension uses
  the same paths).
- `pi-plugin-*` npm convention.
- Late-wins conflict resolution.
- `.pi/extensions.json` settings file format.
- Tool-only legacy plugins keep working — Phase 2's
  `extractTools` → `extractPlugin` is additive: a module exporting
  the new `Plugin` shape gets read as a Plugin; a module exporting
  the old `tools: AgentTool[]` keeps being read as tools-only.

**What we add on top:**

- Multi-contribution shape (`Plugin` with panels/catalogs/commands/
  agentTools).
- Workspace-side aggregation (registries, file-pattern resolution,
  excludeDefaults).
- npm sub-path exports (`./client`, `./server`) for full-plugin
  distribution.

Pi gives us **distribution infrastructure**; we add **coordination
model**.

## Architecture diagram — post-Phase 1

### Package dependency graph

```
                      ┌─────────────────────────────────────┐
                      │  apps/                              │
                      │  ├── boring-macro-v2                │
                      │  ├── full-app                       │
                      │  └── <new host>                     │
                      └─────────────────┬───────────────────┘
                                        │ imports
                                        ▼
   ┌────────────────────────────────────────────────────────────┐
   │                @boring/workspace                            │
   │   • Plugin contract (definePlugin, factories)               │
   │   • Registries (Panel / Command / Catalog)                  │
   │   • Default plugins (filesystemPlugin, dataCatalogPlugin)   │
   │   • UI bridge core (moved from @boring/agent)               │
   │   • Substrate routes /api/v1/{ui,files,tree,files/search}   │
   │   • Event bus + WorkspaceEventMap                           │
   │   • WorkbenchLeftPane / SurfaceShell / CommandPalette       │
   │   • createWorkspaceAgentApp (wraps createAgentApp)          │
   └─────────────────┬───────────────────────────────────────────┘
                     │ imports (one direction; never the reverse)
                     ▼
   ┌────────────────────────────────────────────────────────────┐
   │                @boring/agent                                │
   │   • pi-coding-agent harness                                 │
   │   • AgentTool type                                          │
   │   • validateTool       ← extracted to /shared (NEW location)│
   │   • Pi loader (legacy tools-only; Phase 2 extends)          │
   │   • filesystemAgentTools bundle  ← shared with workspace    │
   │   • bash, execute_isolated_code (harness-only)              │
   │   • Chat / session / model HTTP routes                      │
   │   • createAgentApp (disableDefaultFileTools? new flag)      │
   └────────────────────────────────────────────────────────────┘

   Invariants:
   • @boring/agent has NO dep on @boring/workspace (acyclic).
   • @boring/workspace imports from @boring/agent (one way).
   • @boring/agent/shared is browser-safe (no node:* imports);
     this is what workspace's client bundle pulls in.
```

### Tool registration flow (file ops as worked example)

```
                filesystemAgentTools  (shared bundle, in @boring/agent)
                   ┌────────────────────┐
                   │ read, write, edit, │
                   │ find,              │
                   │ grep               │
                   └─────────┬──────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼
     SINGLE PATH (v7.1 — both standalone + workspace use it)
     ─────────────────────────────────────────────────────────
     createAgentApp({})
       └─ standardCatalog
            └─ buildHarnessAgentTools(bundle)         (bash, executeIsolatedCode)
            └─ buildFilesystemAgentTools(bundle)      (read/write/edit/find/grep/ls)
                                                      + any custom non-pi additions
            (default ON; opt out with disableDefaultFileTools: true
             for sandboxed/no-fs agents)

     createWorkspaceAgentApp wraps createAgentApp PLAINLY (no
     disableDefaultFileTools dance) + bootstraps filesystemPlugin
     (UI-only) on top.

     standalone CLI agent           workspace host
     = real coding agent            = same harness tools +
                                      plugin model adds UI;
                                      excludeDefaults:
                                      ['filesystem'] removes
                                      Files left-tab + auto-
                                      routing — TOOLS STAY
                                      (use disableDefaultFileTools
                                      for that)
```

### File tree — what changes in Phase 1

```
packages/agent/
├── src/
│   ├── shared/
│   │   ├── tool.ts                                  [EXISTS]
│   │   └── validateTool.ts                          [NEW — extracted from
│   │                                                 pluginLoader.ts; node-clean
│   │                                                 so workspace client can import]
│   ├── server/
│   │   ├── createAgentApp.ts                        [EXISTS — adds
│   │   │                                             disableDefaultFileTools? flag]
│   │   ├── catalog/
│   │   │   ├── standardCatalog.ts                   [EXISTS — drops file ops,
│   │   │   │                                         conditionally re-adds them
│   │   │   │                                         from the shared bundle]
│   │   │   └── tools/                               [EXISTS — read/write/edit/
│   │   │       │                                     find/grep
│   │   │       │                                     individual implementations
│   │   │       │                                     stay here]
│   │   │       └── (read|write|edit|findFiles|grepFiles)Tool.ts
│   │   ├── tools/
│   │   │   └── filesystem/                          [NEW]
│   │   │       └── index.ts                         [NEW — exports
│   │   │                                             filesystemAgentTools[]
│   │   │                                             that re-bundles the
│   │   │                                             individual tools above]
│   │   ├── harness/pi-coding-agent/
│   │   │   └── pluginLoader.ts                      [EXISTS — imports
│   │   │                                             validateTool from
│   │   │                                             ../../../shared/validateTool
│   │   │                                             instead of defining it here]
│   │   └── http/routes/
│   │       ├── file.ts          ──────moves to───►  [packages/workspace/src/server/
│   │       ├── tree.ts          ──────moves to───►   routes/files.ts]
│   │       ├── search.ts        ──────moves to───►   [routes/files.ts]
│   │       └── ui.ts            ──────moves to───►   [routes/ui.ts]
│   └── ...
└── package.json

packages/workspace/
├── src/
│   ├── shared/
│   │   ├── plugin.ts                                [NEW — Plugin contract,
│   │   │                                             6 fields, pure data]
│   │   └── ui-bridge.ts                             [MOVED from @boring/agent]
│   ├── events/                                      [EXISTS — bus already shipped]
│   ├── plugin/                                      [NEW — the plugin system]
│   │   ├── definePlugin.ts                          (factory + validation)
│   │   ├── validators.ts                            (validateAgentTool re-exports
│   │   │                                             @boring/agent/shared)
│   │   ├── bootstrap.ts                             (the single-pass mount loop)
│   │   ├── CatalogRegistry.ts                       (subscribable)
│   │   └── defaults/
│   │       ├── filesystemPlugin.ts                  (imports filesystemAgentTools
│   │       │                                         from @boring/agent)
│   │       └── dataCatalogPlugin.ts
│   ├── registry/
│   │   ├── PanelRegistry.ts                         [EXISTS — retrofitted:
│   │   │                                             subscribable, path-aware
│   │   │                                             micromatch resolver,
│   │   │                                             specificity scoring]
│   │   ├── CommandRegistry.ts                       [EXISTS — retrofitted
│   │   │                                             subscribable]
│   │   └── types.ts                                 [EXISTS — adds
│   │                                                 'left-tab'/'right-tab'
│   │                                                 placement, pluginId]
│   ├── components/
│   │   ├── CommandPalette.tsx                       [EXISTS — refactored to
│   │   │                                             consume useCatalogs();
│   │   │                                             polymorphic Recent;
│   │   │                                             drops fileSearchFn/
│   │   │                                             onOpenFile props]
│   │   └── chat/
│   │       ├── ChatCenteredShell.tsx                [EXISTS — drops `data` +
│   │       │                                         `extraPanels` (KEEPS
│   │       │                                         `chatSuggestions` prop);
│   │       │                                         migrates imperative
│   │       │                                         useEffect command reg]
│   │       ├── WorkbenchLeftPane.tsx                [EXISTS — registry-driven
│   │       │                                         tabs from PanelRegistry
│   │       │                                         (placement: 'left-tab')]
│   │       ├── SurfaceShell.tsx                     [EXISTS — fallback chain
│   │       │                                         fixed, EmptyFilePanel
│   │       │                                         used when registry +
│   │       │                                         registered fallback both
│   │       │                                         miss]
│   │       └── EmptyFilePanel.tsx                   [NEW — "No editor for X"
│   │                                                 panel; replaces ghost-tab
│   │                                                 fallback]
│   ├── bridge/
│   │   └── createInMemoryBridge.ts                  [MOVED from @boring/agent]
│   └── server/
│       ├── createWorkspaceAgentApp.ts               [EXISTS — wraps createAgentApp
│       │                                             with disableDefaultFileTools:
│       │                                             true; runs bootstrap();
│       │                                             registers substrate routes]
│       ├── uiTools.ts                               [MOVED from @boring/agent —
│       │                                             get_ui_state, exec_ui]
│       └── routes/
│           ├── ui.ts                                [MOVED from @boring/agent]
│           └── files.ts                             [MOVED — file/tree/search
│                                                     consolidated]
└── package.json                                     [EXISTS — adds:
                                                     "./events": { ... }
                                                     export]

apps/boring-macro-v2/
├── src/
│   ├── plugin/                                      [NEW — Step 6]
│   │   ├── index.ts                                 (makeMacroPlugin factory +
│   │   │                                             macroChatSuggestions const)
│   │   ├── plugin.shared.ts
│   │   ├── plugin.client.ts                         (panels, catalog)
│   │   └── plugin.server.ts                         (agentTools)
│   ├── web/App.tsx                                  [EXISTS — shrinks to ~6 LOC]
│   └── server/
│       ├── index.ts                                 [EXISTS — uses
│       │                                             createWorkspaceAgentApp +
│       │                                             one app.register() for
│       │                                             routes; ~10 LOC]
│       ├── macroRoutes.ts                           [EXISTS — registered via
│       │                                             app.register() in
│       │                                             server/index.ts]
│       ├── macroTools.ts                            [EXISTS — referenced as
│       │                                             plugin.agentTools]
│       └── uiBridge.ts                              [DELETED — 150 LOC; the
│                                                     workspace's UI bridge core
│                                                     replaces it]
```

Markers: **[NEW]** **[MOVED]** **[EXISTS]** (modified) **[DELETED]**.

## Reorganization (file moves)

| From | To | Lands as |
|---|---|---|
| `@boring/agent`: file ops (`find`, `grep`, `read`, `write`, `edit`, `ls`) | **Stays in `@boring/agent`** as `src/server/tools/filesystem/index.ts` (per pi-tools-migration's `buildFilesystemAgentTools(bundle)` factory; pi tools + custom non-pi additions allowed) | Always-on via `createAgentApp`'s `standardCatalog`; opt out with `disableDefaultFileTools: true`. **Not** imported by `filesystemPlugin` — that plugin is UI-only in v7.0+. |
| `@boring/agent`: `validateTool` (in pluginLoader.ts) | `@boring/agent/shared/validateTool.ts` (extracted; node-clean) | Imported by pluginLoader; re-exported by `@boring/workspace`'s `validateAgentTool` |
| `@boring/agent`: UI bridge tools (`get_ui_state`, `exec_ui`) | `@boring/workspace/server/uiTools.ts` | Core (registered directly by `createWorkspaceAgentApp`) |
| `@boring/agent`: file/tree/search HTTP routes | `@boring/workspace/server/routes/files.ts` | Substrate (registered directly) |
| `@boring/agent`: UI HTTP routes | `@boring/workspace/server/routes/ui.ts` | Substrate (registered directly) |
| `@boring/agent`: `src/shared/ui-bridge.ts` (`UiState`, `UiCommand` types) | `@boring/workspace/src/shared/ui-bridge.ts` | Core types |
| `@boring/agent`: `src/server/ui-bridge/createInMemoryBridge.ts` | `@boring/workspace/src/bridge/createInMemoryBridge.ts` | Core |

`@boring/agent` keeps:

- `pi-coding-agent` harness (LLM loop, sessions, models)
- `AgentTool` type (shared contract)
- `validateTool` (now in `/shared`, re-used by workspace)
- Pi loader (legacy tools-only; Phase 2 extends)
- File ops shared bundle (`filesystemAgentTools`)
- `bash`, `execute_isolated_code` tools (harness-only)
- Chat / session / model HTTP routes
- `createAgentApp` (UI-less; standalone CLI; auto-includes file ops)

## Exact path: now → Phase 1 done

Six sequenced commits, plus a v7.6-mandated **Step 0** at the front
to put files into their FINAL v7.6 destinations before Phase 1
builds anything else. (Both reviewers in r5 flagged the alternative
— building Phase 1 into the OLD flat layout then ripping up later —
as wasted work; gemini called it P0.)

**Meta-rule (v7.6):** when files move, they go DIRECTLY to their
final v7.6 destinations. No "move to old path then move again
later." Step 0 is the ONE place the existing workspace files
restructure; subsequent phases assume the v7.6 layout exists.

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 0 — Workspace package reorg into v7.6 layout (NEW; gemini  │
│  P0 + codex P1)                                                  │
│  ─────────────────────────────────────────────────────────────── │
│  Mechanical git mv of existing workspace src/ files into the     │
│  v7.6 four-folder layout. NO behavior change. NO new files. One  │
│  PR.                                                             │
│                                                                  │
│  Moves (existing → v7.6 destination):                            │
│    src/components/{ui, DataExplorer, CommandPalette, SessionList,│
│       PluginErrorBoundary?}              → src/front/components/ │
│    src/registry/                          → src/front/registry/  │
│    src/dock/                              → src/front/dock/      │
│    src/events/                            → src/front/events/    │
│    src/hooks/                             → src/front/hooks/     │
│    src/layouts/                           → src/front/layout/    │
│    src/panes/{ArtifactSurfacePane.tsx,   →  to be moved into     │
│       EmptyPane.tsx}                          chrome/ in Phase A │
│    src/panes/{code-editor, markdown-editor, file-tree}/          │
│                                           → to be moved INTO     │
│                                              filesystemPlugin in │
│                                              Step 3 (NOT to      │
│                                              front/panes/)       │
│    src/panes/data-catalog/                → audit + delete OR    │
│                                              move to front/      │
│                                              components/         │
│    src/plugin/{types, definePlugin,       → src/shared/plugin/   │
│       bootstrap}.ts                          (the SHARED parts)  │
│    src/plugin/{CatalogRegistry,           → src/front/plugin/    │
│       use*.ts, index.ts}                                         │
│    src/store/, src/testing/, src/types/   → audit; fold into     │
│                                              shared/ if minimal  │
│    src/server/                            (already in src/server;│
│                                              stays; minor file   │
│                                              renames if needed)  │
│    src/shared/                            (already in src/shared;│
│                                              gains plugin/ subdir│
│                                              from above)         │
│                                                                  │
│  tsconfig changes:                                               │
│    - tsconfig.front.json adds excludes for                       │
│      src/plugins/**/server/**, src/plugin/server/** (codex P1)   │
│    - tsconfig.shared.json (if exists) doesn't include DOM lib    │
│                                                                  │
│  Deliverable: src/ has front/, server/, shared/, plugins/ at top │
│  level. ALL existing tests pass unchanged (vi.mock paths follow  │
│  moved files). No new functionality.                             │
│  ETA: 1-2 days.                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1 — REORG (no plugin model yet, pure refactor)             │
│  ─────────────────────────────────────────────────────────────── │
│  1a. UI bridge ownership refactor                                │
│      Move ui-bridge types/tools/routes from @boring/agent →      │
│      @boring/workspace. boring-macro deletes its 150-LOC inline  │
│      copy.                                                       │
│                                                                  │
│  1b. File ops bundle extraction                                  │
│      Extract find/grep/read/write/edit into                      │
│      @boring/agent/server/tools/filesystem (a shared bundle).    │
│      standardCatalog imports the bundle by default; expose       │
│      `disableDefaultFileTools` on createAgentApp. Move file/     │
│      tree/search HTTP routes to @boring/workspace/server.        │
│      standardCatalog tools (bash, execute_isolated_code) stay.   │
│                                                                  │
│  ETA: 1–2 days.                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 2 — PLUGIN PRIMITIVES                                      │
│  ─────────────────────────────────────────────────────────────── │
│  2a. validateTool extraction                                     │
│      Extract from pluginLoader.ts (node-leaky module) into       │
│      @boring/agent/shared/validateTool.ts (no node imports).     │
│      pluginLoader imports the extracted version.                 │
│                                                                  │
│  2b. Plugin type + definePlugin + validators                     │
│      packages/workspace/src/plugin/{types,definePlugin,          │
│      validators,bootstrap}.ts. validateAgentTool re-exports      │
│      from @boring/agent/shared. Single-pass bootstrap.           │
│                                                                  │
│  2c. CatalogRegistry (new) + subscribe retrofit for existing     │
│      CommandRegistry + PanelRegistry.                            │
│                                                                  │
│  2d. Path-aware file-pattern resolver upgrade                    │
│      Replace basename-only matcher (PanelRegistry.ts:91 +        │
│      SurfaceShell.tsx:98) with path-aware micromatch             │
│      ({ matchBase: false, dot: true }) + specificity-scoring     │
│      (segments × 10 + non-wildcard chars). Preserve the          │
│      app-beats-builtin source tie-breaker.                       │
│                                                                  │
│  ETA: 1.5–2 days.                                                │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 3 — DEFAULT PLUGINS                                        │
│  ─────────────────────────────────────────────────────────────── │
│  3a. filesystemPlugin (sole default; v7.1 UI-only)               │
│      Plain module-scope const (NO factory, NO agentTools field). │
│      Contributes: Files catalog; FileTree (placement:            │
│      'left-tab'); CodeEditor + MarkdownEditor (with              │
│      filePatterns). File ops tools are HARNESS substrate         │
│      registered by createAgentApp via pi-tools-migration's       │
│      buildFilesystemAgentTools(bundle) — NOT the plugin's job.   │
│                                                                  │
│      (v6 had dataCatalogPlugin as a second default; v6.2 cuts    │
│      it — plugins that want a workbench data tab contribute      │
│      their own left-tab panel.)                                  │
│                                                                  │
│  ETA: 0.5 day.                                                   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 4 — ENTRY POINTS                                           │
│  ─────────────────────────────────────────────────────────────── │
│  4a. <WorkspaceProvider plugins={…}>                             │
│      Adds plugins prop + excludeDefaults prop. Auto-registers    │
│      defaults; runs bootstrap(). Adds package.json "./events"    │
│      export so plugins can `import { events } from               │
│      "@boring/workspace/events"`.                                │
│                                                                  │
│  4b. createWorkspaceAgentApp({ plugins })                        │
│      Plain wrap of createAgentApp (NO disableDefaultFileTools    │
│      passed — v7.0 simplification: harness owns tools always).   │
│      Runs bootstrap() for server-side fan-in. Registers          │
│      substrate routes (/api/v1/ui/*, /files, /tree, /files/      │
│      search) directly.                                           │
│                                                                  │
│  ETA: 1 day.                                                     │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 5 — CONSUMER REFACTORS                                     │
│  ─────────────────────────────────────────────────────────────── │
│  5a. <CommandPalette /> consumes useCatalogs() + polymorphic     │
│      Recent. Drop dead fileSearchFn / onOpenFile props.          │
│      Migrate existing localStorage Recent entries.               │
│                                                                  │
│  5b. <ChatCenteredShell /> migration (REVISED — gemini P0)       │
│      - ALL ChatCenteredShell-internal commands STAY as           │
│        imperative useEffect+registerCommand calls (toggleDrawer/ │
│        toggleSurface/newChat AND per-session quick-switch).      │
│        Reason (gemini): toggleDrawer/toggleSurface close over    │
│        local useState — a module-scope "internal chat-shell      │
│        plugin" can't reach component instance state, and         │
│        bridging via events would just shift the same closure     │
│        problem to the event handler. Keeping these imperative    │
│        is honest: the plugin model is for module-stable          │
│        contributions; component-instance commands belong inside  │
│        the component.                                            │
│      - Registry's subscribe retrofit (Step 2c) ensures these     │
│        late registrations propagate to an open palette — that    │
│        was the original justification for the retrofit.          │
│      - Drop `data: DataPaneConfig` prop. Hosts that want a       │
│        workbench data tab register their own left-tab panel      │
│        (see macro's macroSeriesPanel example), or use the        │
│        `makeStaticDataPlugin(opts)` convenience factory          │
│        (see §"Convenience: makeStaticDataPlugin").               │
│      - Drop `extraPanels` prop. Panels come from PanelRegistry;  │
│        new optional `allowedPanels?: string[]` for gating.       │
│      - KEEP `chatSuggestions: ChatSuggestion[]` prop.            │
│                                                                  │
│  5c. WorkbenchLeftPane registry-driven + SurfaceShell fallback   │
│      fix                                                         │
│      - Read 'left-tab' panels from PanelRegistry. defaults       │
│        contribute their respective tabs. excludeDefaults:        │
│        ['filesystem'] truly removes the tab.                     │
│      - Replace SurfaceShell.tsx:81-108 hardcoded fallback with:  │
│        registry resolve → registered fallback (only if has()) →  │
│        EmptyFilePanel.                                           │
│      - 'right-tab' placement reserved; no Phase 1 consumer.      │
│                                                                  │
│  ETA: 1.5 days.                                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 6 — ACCEPTANCE: BORING-MACRO MIGRATION                     │
│  ─────────────────────────────────────────────────────────────── │
│  See §"Concrete before/after". Net: ~260 LOC → ~30 LOC.          │
│  ETA: 0.5–1 day.                                                 │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 7 — TESTS + RELEASE NOTES                                  │
│  ─────────────────────────────────────────────────────────────── │
│  Tests per §Test plan. Release notes documenting the THREE       │
│  breaking changes (CommandPaletteProps,                          │
│  ChatCenteredShellProps.{data,extraPanels,withCommandPalette},   │
│  WorkbenchLeftPane internal tab API). ETA: 1–2 days.             │
└──────────────────────────────────────────────────────────────────┘

TOTAL: ~6–8 days of focused work.
```

## Concrete before/after — boring-macro migration

Acceptance test for the model.

### BEFORE (today)

```ts
// apps/boring-macro-v2/src/web/App.tsx — ~80 LOC
const dataPaneConfig: DataPaneConfig = { /* …seriesAdapter, filesAdapter… */ }
const macroPanels: PanelConfig[] = [chartCanvasPanel, deckPanel]
const macroChatSuggestions = [/* …8 suggestions… */]

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

// apps/boring-macro-v2/src/server/index.ts — ~30 LOC
const clickhouse = await createClickHouseClient(env)
const app = await createAgentApp({
  workspaceRoot,
  extraTools: [...macroAgentTools, ...uiTools],
})
await app.register(uiRoutes)
await app.register(registerMacroRoutes, { clickhouse, deckRoot })
await app.listen({ port })

// apps/boring-macro-v2/src/server/uiBridge.ts — ~150 LOC
// Full inlined copy of @boring/workspace/server's UI bridge.
```

### AFTER (Phase 1 done)

**Two plugin objects, same id, split by environment** (this honors
the build invariant — never cross-import `node:*` symbols into
client code; codex round-3 P2 caught the v6 example violating its
own rule):

```ts
// apps/boring-macro-v2/src/plugin/index.ts — CLIENT entry, ~18 LOC
"use client"
import { definePlugin, type Plugin } from "@boring/workspace"
import type { ChatSuggestion } from "@boring/agent/front-shadcn"
import { chartCanvasPanel, deckPanel, macroSeriesPanel } from "./panels"
import { seriesCatalog } from "./catalogs"

export const macroChatSuggestions: ChatSuggestion[] = [
  { label: "Find a series", prompt: "Help me find a macro series." },
  // …
]

export const makeMacroClientPlugin = (): Plugin =>
  definePlugin({
    id: "boring-macro",
    label: "Macro",
    panels: [chartCanvasPanel, deckPanel, macroSeriesPanel],
    catalogs: [seriesCatalog],
  })
```

```ts
// apps/boring-macro-v2/src/plugin/server.ts — SERVER entry, ~10 LOC
"use server"
import { definePlugin, type Plugin } from "@boring/workspace"
import { macroAgentTools } from "../server/macroTools"

export const makeMacroServerPlugin = (): Plugin =>
  definePlugin({
    id: "boring-macro",          // same id as client; bootstrap dedupes
    label: "Macro",
    agentTools: macroAgentTools,
  })
```

`macroSeriesPanel` is the workbench-data-tab equivalent of the v5
`data: DataPaneConfig`: a panel with `placement: 'left-tab'` whose
component is `DataExplorer` configured with macro's adapter and
`onActivate` that calls `surface.openPanel({ component:
"chart-canvas", … })`. This replaces the v5 dataPaneConfig wiring
without needing a default `dataCatalogPlugin`. The catalog
(`seriesCatalog`) stays separate — it's what powers the cmd palette
search; the panel is what shows the workbench browser.

```tsx
// apps/boring-macro-v2/src/web/App.tsx — ~7 LOC
import { WorkspaceProvider, ChatCenteredShell } from "@boring/workspace"
import { makeMacroClientPlugin, macroChatSuggestions } from "../plugin"

export const App = () => (
  <WorkspaceProvider plugins={[makeMacroClientPlugin()]}>
    <ChatCenteredShell chatSuggestions={macroChatSuggestions} />
  </WorkspaceProvider>
)
```

```ts
// apps/boring-macro-v2/src/server/index.ts — ~11 LOC
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import { makeMacroServerPlugin } from "../plugin/server"
import { registerMacroRoutes } from "./macroRoutes"

const clickhouse = await createClickHouseClient(env)
const app = await createWorkspaceAgentApp({
  workspaceRoot,
  plugins: [makeMacroServerPlugin()],
})
await app.register(registerMacroRoutes, { clickhouse, deckRoot })
await app.listen({ port })

// DELETED: apps/boring-macro-v2/src/server/uiBridge.ts (~150 LOC)
```

### LOC accounting

| File | Before | After | Δ |
|---|--:|--:|--:|
| `src/web/App.tsx` | 80 | 6 | -74 |
| `src/server/index.ts` | 30 | 11 | -19 |
| `src/server/uiBridge.ts` | 150 | 0 | -150 |
| `src/plugin/index.ts` (client) | 0 | 18 | +18 |
| `src/plugin/server.ts` | 0 | 10 | +10 |
| **Total** | **260** | **46** | **-214 (-82%)** |

## Known gaps — deferred to Phase 2+

Things v6.1 deliberately does NOT solve, listed explicitly so
reviewers don't think they were missed.

| Gap | Why deferred | When to revisit |
|---|---|---|
| **Hot-reload / unregister cleanup** | Fastify routes can't unregister; React subscriptions clean themselves; catalog adapters with their own state would leak. No Phase 1 plugin uses this. | Phase 3 hot-reload story. |
| **Plugin-vs-substrate tool name collision** | A plugin shipping a tool called `read` replaces substrate's. Late-wins logged. Could confuse the LLM if names diverge mid-session. | When agent-authored plugins (Phase 3) make accidental collision likely. |
| **Catalog adapter memory** | If an adapter holds a long-running subscription (e.g., websocket to a remote search service), there's no place to clean up because there's no `onUnmount`. | When a real adapter needs it. Adding a teardown hook on `CatalogConfig` is non-breaking. |
| **Non-React stateful adapters need lifecycle** | Gemini P1: an adapter that wants to subscribe to `events.on('file:moved', …)` to invalidate its cache has nowhere to do it. Module-scope `events.on(...)` fires globally for all hosts. Lazy on-first-call leaks (no unsubscribe). | First plugin that needs it. Re-introduce `Plugin.onMount(ctx) → cleanup` (we cut it in v6 because Phase 1 plugins are all React-component-based or factory-injected; that assumption breaks for stateful adapters). |
| **`registerAgentRoutes` lacks `disableDefaultFileTools`** | Codex round-4 P1: `createAgentApp` accepts `disableDefaultFileTools` (verified `createAgentApp.ts:47`) but `registerAgentRoutes` (the embedded-Fastify path used by `apps/full-app/src/server/main.ts:383`) does NOT — it always includes filesystem tools (`registerAgentRoutes.ts:94`). The "harness opt-out" promise only holds for the standalone `createAgentApp` path. | Add `disableDefaultFileTools` option to `registerAgentRoutes` plumbed through to its internal tool-catalog construction. **Out of scope for Phase 1** macro acceptance (macro uses `createWorkspaceAgentApp` which uses `createAgentApp`, not `registerAgentRoutes`). Add a follow-up bead under the j9p7 epic OR Phase 2 if a `registerAgentRoutes`-using host needs the opt-out. |
| **Build-time enforcement of client/server split** | Documented invariant; not a custom lint rule. | If accidental cross-imports become common. |
| **Plugin versioning / compat** | `Plugin.version` field cut. No compat negotiation. | Phase 2 npm distribution. |
| **Layout migrations** | Renaming a panel id breaks cached dockview layouts. Same problem as today; not made worse by plugin model. | When layouts become stable enough to merit migration tooling. |
| **System-prompt augmentation from registered plugins** | LLM doesn't currently see "these plugins are loaded; here's what they do." | Phase 2 discovery endpoint + prompt injection. |
| **Permission / capability gating** | Inline plugins run with full host privileges. | Phase 3 sandbox / capability flags. |
| **Per-plugin telemetry** | No per-plugin error counter / call latency telemetry. | When debug volume justifies it. |
| ~~`<PluginInspector />`~~ | **PROMOTED to Phase 1 in v7.2** — see §"Phase 1 debug overlay". | (no longer deferred) |
| **Plugin discovery via `/api/v1/plugins`** | Phase 1 hosts know what they imported. | Phase 2 npm + agent-authored. |

None of these block the boring-macro acceptance test.

## Phase 1.5: Consumer migration — decompose shells, declarative layouts, delete ChatCenteredShell

(v7.4 merger: was tracked separately as `DECLARATIVE_LAYOUT_MIGRATION.md` + epic `boring-ui-v2-zrby`. Folded in here as Phase 1.5 because it's the natural consumer-side migration of the plugin model machinery.)

### Why this phase exists

`@boring/workspace` ships TWO parallel layout systems today:

1. **Imperative shell** — `ChatCenteredShell` (29KB) + `SurfaceShell` (23KB) + `ChatTopBar` + `SessionBrowser` + `WorkbenchLeftPane` + `ChatStagePlaceholder`, all under `src/components/chat/`. Hardcodes the chat panel from `@boring/agent`, top-bar slots, session drawer, artifact dockview. Apps pass props in; they cannot restructure.

2. **Declarative layouts** — `ChatLayout` + `IdeLayout` + `ResponsiveDockviewShell` in `src/layouts/`. Compose panels by id (e.g. `<ChatLayout nav="session-list" center="chat" surface="artifact-surface" />`). Plugins register panels into the registry; the layout config resolves ids → components via dockview.

Today every consuming app (`apps/workspace-playground`, `apps/full-app`, `apps/boring-macro-v2`) uses **only the imperative shell**. The declarative layouts have **zero app consumers** — tested and exported but never reached.

The plugin model machinery (Phase 1 Steps 1-5) finally makes declarative composition viable: panels register via the contract; layouts resolve ids → components. **Phase 1.5 retires the imperative shell and migrates all three apps to the declarative pattern**, closing the loop the earlier sketches opened.

### Three-tier API after migration

All three tiers share the SAME core panel registrations (chat, session-list, workbench-left, artifact-surface). Only the shape composition differs.

#### Tier 1 — declarative pre-shaped layouts (~80% of apps)

```tsx
import { WorkspaceProvider, ChatLayout, TopBar } from "@boring/workspace"
import { macroPlugin } from "./macro-plugin"

<WorkspaceProvider plugins={[macroPlugin]}>
  <TopBar appTitle="Macro" right={<UserMenu />} />
  <ChatLayout
    nav="session-list"
    center="chat"
    sidebar="charts"
    surface="artifact-surface"
  />
</WorkspaceProvider>
```

Apps swap panels by changing `nav` / `center` / `sidebar` / `surface` ids. Plugins register the implementations.

#### Tier 2 — custom LayoutConfig with stock chrome

```tsx
import { WorkspaceProvider, ResponsiveDockviewShell, TopBar, type LayoutConfig } from "@boring/workspace"

const myLayout: LayoutConfig = {
  version: "2.0",
  groups: [
    { id: "rail",     position: "left",   panel: "session-list", locked: true, hideHeader: true },
    { id: "tree",     position: "left",   panel: "filetree",     collapsible: true },
    { id: "center",   position: "center", panel: "chat" },
    { id: "split-a",  position: "right",  panel: "code-editor" },
    { id: "split-b",  position: "right",  panel: "live-preview" },
  ],
}

<WorkspaceProvider plugins={[livePreviewPlugin]}>
  <TopBar appTitle="…" />
  <ResponsiveDockviewShell layout={myLayout} />
</WorkspaceProvider>
```

For apps that need non-stock layout shapes (split center, multiple right surfaces, custom group constraints) but still want responsive sidebar collapse + dockview integration + same `<TopBar>` chrome.

#### Tier 3 — full custom (rare)

```tsx
import {
  WorkspaceProvider,
  DockviewShell,
  useViewportBreakpoint,
  useResponsiveSidebarCollapse,
  useTopBarSlot,
} from "@boring/workspace"

function MyShell() {
  // App fully composes chrome + dockview structure
}
```

Raw primitives. For apps with bespoke chrome (non-rectangular layout, multiple dockview instances, embedded workspace inside a non-workspace shell).

### Substrate vs plugin (architectural commitment)

The migration is a chance to clarify what's substrate vs. plugin:

| Tier | What it is | Examples |
|---|---|---|
| **Substrate** | Constitutive workspace panels. Without them `@boring/workspace` is an empty dockview. Apps cannot opt out — these ARE what the package is. | `chat`, `session-list`, `workbench-left`, `artifact-surface` |
| **Default plugins** | Optional capabilities apps can disable via `excludeDefaults: ['filesystem']`. | `filesystemPlugin` (file tree + code editor + markdown editor + filesCatalog) |
| **App plugins** | Host-specific contributions registered via `<WorkspaceProvider plugins={[...]}>`. | `macroPlugin` (charts + slides + series), future `analyticsPlugin`, etc. |

**There is no `chatExperiencePlugin`.** Chat is core, not a plugin. The earlier sketch of a "chat experience plugin" bundling the chat-flavored panels was wrong — it conflates substrate with extension.

`WorkspaceProvider` registers core panels at mount, before running the plugin bootstrap:

```ts
function WorkspaceProvider({ plugins, excludeDefaults, children }) {
  const panelRegistry = new PanelRegistry()
  panelRegistry.registerAll(coreWorkspacePanels)   // ← substrate, always
  bootstrap({
    plugins,
    defaults: filteredDefaults,                     // filesystemPlugin unless excluded
    registries,
  })
  // …
}
```

### File-tree end state (v7.5 — final framing)

Three architectural commitments locked in v7.5:

1. **Top-level split: `front/` + `server/` + `shared/` + `plugins/`.**
   Mirrors `@boring/agent`'s convention. `front/` = client-side
   workspace code; `server/` = backend; `shared/` = cross-process
   types (used by both halves). `plugins/` is a sibling concern
   holding **actual plugin instances only** (no machinery —
   machinery lives in `front/plugin/` + `server/plugin/` + `shared/plugin/`).

2. **Plugins own both halves of their contributions.** A plugin in
   `plugins/<id>/` contains internal `front/` + `server/` directories
   for its own client-side panels/sidebar/catalogs and server-side
   tools/routes. Apps follow the same shape via `apps/<host>/src/plugin/{front,server}/`.

3. **Singular vs plural naming convention.**
   - `plugin/` (singular) = plugin model **machinery** (definePlugin,
     bootstrap, hooks, registries) — lives in `front/plugin/`,
     `server/plugin/`, `shared/plugin/`.
   - `plugins/` (plural) = a directory of plugin **instances** —
     lives at the workspace root for defaults; apps with multiple
     plugins use `apps/<host>/src/plugins/`.

```
packages/workspace/src/

# ─── FRONT (workspace own client + plugin model client machinery) ──

front/
├── chrome/                              shell parts (NOT plugin contributions)
│   ├── chat/                            NEW (Phase A — substrate chat panel wrapper)
│   │   ├── ChatPanel.tsx                thin wrapper around @boring/agent's ChatPanel
│   │   │                                + workspace integrations
│   │   └── definition.ts                definePanel({ id: "chat", … })
│   ├── session-list/                    NEW (Phase A — was components/chat/SessionBrowser)
│   ├── workbench-left/                  NEW (Phase A — tab-strip chrome that HOSTS
│   │                                    sidebar tabs contributed by plugins)
│   ├── artifact-surface/                NEW (Phase A — dockview wrapper that HOSTS
│   │                                    workbench panes contributed by plugins)
│   ├── chat-stage-placeholder/          NEW (Phase A)
│   └── EmptyPane.tsx                    MOVED (was loose panes/EmptyPane.tsx)
│
├── components/                          cross-cutting UI primitives (NOT panels)
│   ├── DataExplorer/                    generic data subsystem; used by plugins
│   ├── ui/                              shadcn primitives
│   ├── CommandPalette.tsx               substrate palette overlay
│   ├── SessionList.tsx                  data-list helper used by chrome/session-list/
│   └── PluginErrorBoundary.tsx          NEW (j9p7.22) — wraps plugin contributions
│
├── registry/                            base registries (subscribe-aware singletons)
│   ├── PanelRegistry.ts                 retrofitted (j9p7.6 done)
│   ├── CommandRegistry.ts               retrofitted (j9p7.6 done)
│   ├── RegistryProvider.tsx             React context anchor
│   ├── coreRegistrations.ts             NEW (Phase B — coreWorkspacePanels[])
│   ├── types.ts                         PanelConfig, CommandConfig, PaneProps
│   └── getFileIcon.ts
│
├── dock/                                DockviewShell + LayoutConfig types
├── events/                              bus singleton (client side)
├── bridge/                              UI bridge client + uiCommandStream/Dispatcher
├── hooks/                               viewport, sidebar, etc.
│
├── layout/                              composition layer (Tier 1/2/3)
│   ├── ChatLayout.tsx
│   ├── IdeLayout.tsx
│   ├── ResponsiveDockviewShell.tsx
│   ├── TopBar.tsx                       NEW (Phase C — was components/chat/ChatTopBar)
│   └── index.ts
│
├── chrome/empty-file-panel/             NEW (j9p7.12 — fallback for unmatched
│                                        files; relocated from panes/ in v7.6
│                                        per gemini P2 — kills the lone-resident
│                                        panes/ folder at workspace root)
│
├── plugin/                              ← plugin model FRONT machinery (singular)
│   ├── CatalogRegistry.ts               (DONE — file at packages/workspace/src/plugin/
│   │                                     today; moves under front/plugin/ in restructure)
│   ├── PluginErrorBoundary.tsx          NEW (j9p7.22)
│   ├── PluginInspector.tsx              NEW (j9p7.23, DEV-only)
│   ├── usePlugins.ts                    NEW
│   ├── useCatalogs.ts                   (DONE)
│   ├── useCommands.ts                   (DONE)
│   ├── useActivePanels.ts               (DONE)
│   └── index.ts
│
└── WorkspaceProvider.tsx

# ─── SERVER (workspace own backend + plugin model server machinery) ─

server/
├── createWorkspaceAgentApp.ts
├── http/                                substrate routes (uiRoutes, fileRoutes)
├── ui-bridge/                           createInMemoryBridge
└── plugin/                              ← plugin model SERVER machinery (singular)
    └── …                                (server-side registries — currently minimal;
                                          AgentToolRegistry interface, etc.)

# ─── SHARED (types + functions both halves need) ───────────────────

shared/
├── ui-bridge.ts                         UiState, UiCommand types
├── events/                              WorkspaceEventMap types
└── plugin/                              ← plugin model SHARED (singular)
    ├── types.ts                         Plugin, CatalogConfig (DONE — needs v7.2
    │                                    systemPrompt addition per j9p7.4)
    ├── definePlugin.ts                  factory + validation (DONE; both halves use)
    ├── bootstrap.ts                     single-pass mount (DONE — needs v7.2
    │                                    systemPromptAppend output per j9p7.7)
    └── index.ts

# ─── PLUGINS (actual plugin instances; plural) ─────────────────────

plugins/                                 ← directory of plugin instances
└── filesystemPlugin/                    ← one folder per plugin
    ├── index.ts                         exports CLIENT + SERVER Plugins (same id)
    ├── front/                           client-side contributions
    │   ├── panes/
    │   │   ├── CodeEditorPane.tsx       MOVED (was src/panes/code-editor/)
    │   │   └── MarkdownEditorPane.tsx   MOVED (was src/panes/markdown-editor/)
    │   ├── sidebar/
    │   │   └── FileTreePane.tsx         MOVED (was src/panes/file-tree/)
    │   └── catalogs/
    │       └── filesCatalog.ts
    └── server/                          server-side contributions
        └── …                            (filesystemPlugin v7 has NONE — UI-only;
                                          future plugins add agentTools, route handlers)

# ─── BARREL ────────────────────────────────────────────────────────

index.ts                                 package public API (re-exports from front/,
                                         layout/, plugin model bits, plugins barrel)
```

**Apps follow the same shape — singular `plugin/` for the host's one plugin:**

```
apps/boring-macro-v2/src/

plugin/                                  ← THIS app's plugin (singular: one per host)
├── index.ts                             exports CLIENT + SERVER Plugins (same id)
├── front/                               client-side contributions
│   ├── panes/
│   │   ├── ChartCanvasPane.tsx
│   │   └── DeckPane.tsx
│   ├── sidebar/MacroSeriesPane.tsx
│   └── catalogs/seriesCatalog.ts
└── server/                              server-side contributions
    ├── tools/                           agent tool implementations
    │   ├── execute_sql.ts
    │   ├── macro_search.ts
    │   ├── get_series_data.ts
    │   └── persist_derived_series.ts
    └── routes/macroRoutes.ts            Fastify route plugin

web/App.tsx                              app front entry (mounts WorkspaceProvider)
server/index.ts                          app backend entry (Fastify boot)
```

**If an app grows multi-plugin** (rare): rename `plugin/` → `plugins/<id>/` mirroring workspace's convention. Phase 1 macro doesn't need this.

**Apps follow the same pattern** — every plugin (default or app-contributed) owns its components inside its own directory:

```
apps/boring-macro-v2/src/plugin/     ← macroPlugin lives here
├── index.ts                         the Plugin definition (client half)
├── server.ts                        server-half Plugin (agentTools)
├── panes/                           ← workbench-center contributions
│   ├── ChartCanvasPane.tsx
│   └── DeckPane.tsx
├── sidebar/                         ← sidebar-tab contributions
│   └── MacroSeriesPane.tsx
├── catalogs/
│   └── seriesCatalog.ts
└── server/                          (paired with src/server/)
    └── tools/                       agent tool implementations
        ├── execute_sql.ts
        ├── macro_search.ts
        └── …
```

**What disappears:**

- `src/components/chat/` (whole folder; Phase A + C + G)
- Top-level `src/panes/{code-editor, markdown-editor, file-tree}/` — moved INTO
  `src/plugin/defaults/filesystemPlugin/` (panes/sidebar split per role) by j9p7.9
- `src/panes/data-catalog/` — orphaned (dataCatalogPlugin was cut in v6.2);
  audit during j9p7.30: delete if no consumer, otherwise re-home as a primitive
  in `components/` for plugin authors who want a generic data-tab implementation
- `src/panes/EmptyPane.tsx` (loose) — moved to `chrome/EmptyPane.tsx`
- `src/panes/ArtifactSurfacePane.tsx` (loose) — moved to `chrome/artifact-surface/`
  alongside SurfaceShell (Phase A)

**What stays exported (Tier 1 / Tier 2 / Tier 3 surface):**

```ts
// Tier 1
export { ChatLayout, IdeLayout, buildChatLayout, buildIdeLayout } from "./layouts"
export type { ChatLayoutProps, IdeLayoutProps } from "./layouts"
export { TopBar } from "./layouts/TopBar"

// Tier 2
export { ResponsiveDockviewShell } from "./layouts/ResponsiveDockviewShell"

// Tier 3 (raw primitives)
export { DockviewShell } from "./dock"
export type { LayoutConfig, GroupConfig } from "./dock"
export { useViewportBreakpoint, useResponsiveSidebarCollapse } from "./hooks"
export { useTopBarSlot } from "./components/TopBarSlot"

// WorkspaceProvider + plugin model
export { WorkspaceProvider } from "./WorkspaceProvider"
export { definePlugin, definePanel, PluginError, … } from "./plugin"
export { CatalogRegistry, useCommands, useActivePanels, useCatalogs, usePlugins, … } from "./plugin"
```

The default `filesystemPlugin` is exported via `plugin/defaults/`; hosts that want
to disable it pass `excludeDefaults: ['filesystem']`. The plugin's INTERNAL
components (CodeEditorPane etc.) are NOT exported — they're encapsulated.

### Why this taxonomy (vs status quo)

**`panes/` was conflating three distinct categories.** Today
`packages/workspace/src/panes/` mixes:

- Workbench center panes (`code-editor`, `markdown-editor`)
- Sidebar tab content (`file-tree`, `data-catalog`)
- Shell containers (`ArtifactSurfacePane.tsx`, `EmptyPane.tsx`)

Each of these has different runtime semantics (centered tab vs persistent sidebar vs chrome wrapper) and different ownership (filesystem-plugin vs filesystem-plugin vs substrate). Mixing them blurred the architecture and made plugin authors uncertain where their contributions belong.

**Plugin authors need a clear template.** The `panes/`-flat-at-workspace-root pattern told plugin authors "drop your panel here" — but that pattern is only correct for workspace substrate. Plugins should bundle their components, not scatter them. v7.5 makes the right path the obvious path: **everything a plugin contributes lives inside the plugin's directory**, mirroring what Phase 2's npm distribution will require anyway (a distributed plugin SHIPS its components).

**Apps and defaults follow the SAME pattern.** A `pi-plugin-foo` npm package's `dist/client/` will look identical to `apps/boring-macro-v2/src/plugin/` and `packages/workspace/src/plugin/defaults/filesystemPlugin/`. Same shape; different distribution channel.

**What disappears:**

- `src/components/chat/` (whole folder)
- `ChatCenteredShell.tsx` + `ChatShellContext` (`context.ts`)
- The old `presets.test.tsx` (superseded by migrated apps' e2e + new layout tests)
- `src/index.ts` exports for `ChatCenteredShell`, `useChatShell`, `useChatSurface`, `ChatStagePlaceholder` (imperative-shell internals)

**What stays exported (Tier 1 / Tier 2 / Tier 3 surface):**

```ts
// Tier 1
export { ChatLayout, IdeLayout, buildChatLayout, buildIdeLayout } from "./layouts"
export type { ChatLayoutProps, IdeLayoutProps } from "./layouts"
export { TopBar } from "./layouts/TopBar"

// Tier 2
export { ResponsiveDockviewShell } from "./layouts/ResponsiveDockviewShell"

// Tier 3 (raw primitives)
export { DockviewShell } from "./dock"
export type { LayoutConfig, GroupConfig } from "./dock"
export { useViewportBreakpoint, useResponsiveSidebarCollapse } from "./hooks"
export { useTopBarSlot } from "./components/TopBarSlot"

// WorkspaceProvider + plugin model (unchanged)
export { WorkspaceProvider } from "./WorkspaceProvider"
export { definePlugin, definePanel, PluginError, … } from "./plugin"
export { CatalogRegistry, useCommands, useActivePanels, useCatalogs, … } from "./plugin"
```

### Phase 1.5 breakdown — 7 phase beads (A through G)

A and B can run in parallel. C depends on A. D, E, F can run in parallel after A+B+C. G depends on D+E+F.

```
┌──────────────────────────────────────────────────────────────────┐
│  Phase A — Decompose chat shells into front/chrome/ + front/     │
│  bridge/ (v7.6 paths, ONE-GO move)                               │
│  ─────────────────────────────────────────────────────────────── │
│  - git mv components/chat/{SessionBrowser, ChatStagePlaceholder, │
│           SurfaceShell, WorkbenchLeftPane}.tsx → front/chrome/   │
│           {session-list, chat-stage-placeholder, artifact-       │
│            surface, workbench-left}/                             │
│  - Each chrome folder gains a definition.ts exporting a          │
│    PanelConfig (used by Phase B's coreWorkspacePanels)           │
│  - Create front/chrome/chat/ChatPanel.tsx (thin wrapper around   │
│    @boring/agent's ChatPanel + workspace integrations) +         │
│    definition.ts                                                 │
│  - git mv components/chat/{uiCommandStream,                      │
│    uiCommandDispatcher}.ts → front/bridge/                       │
│  - Update internal imports                                       │
│  - DON'T touch ChatCenteredShell.tsx or ChatTopBar.tsx yet —     │
│    they stay until Phase G/C respectively.                       │
│  Bead: j9p7.24                                                   │
│                                                                  │
│  Note: Step 0 already ran the workspace reorg into v7.6 layout, │
│  so source paths use front/ prefix. ArtifactSurfacePane.tsx and  │
│  EmptyPane.tsx (loose under panes/ before Step 0) ALSO move to  │
│  front/chrome/{artifact-surface, EmptyPane.tsx} in this Phase.   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase B — Wire core panel registrations in WorkspaceProvider    │
│  ─────────────────────────────────────────────────────────────── │
│  Parallelism note (codex P2): can START in parallel with Phase A │
│  but cannot CLOSE before Phase A's definition.ts files exist.    │
│                                                                  │
│  - Create front/registry/coreRegistrations.ts exporting          │
│    coreWorkspacePanels: PanelConfig[] aggregating the 4 core     │
│    chrome panel defs (chat, session-list, workbench-left,        │
│    artifact-surface). Imports each pane's definition.ts.         │
│  - front/WorkspaceProvider.tsx imports and registers them at     │
│    mount, BEFORE bootstrap() runs                                │
│  - Test: render WorkspaceProvider with no plugins; assert the    │
│    panel registry has the 4 core ids                             │
│  Bead: j9p7.25 (depends on j9p7.24 closing for the actual        │
│  definition.ts files to import)                                  │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase C — Lift TopBar chrome + expose ResponsiveDockviewShell   │
│  ─────────────────────────────────────────────────────────────── │
│  - git mv components/chat/ChatTopBar.tsx                         │
│         → front/layout/TopBar.tsx                                │
│  - Rename type ChatTopBarProps → TopBarProps                     │
│  - Update barrel                                                 │
│  - Export ResponsiveDockviewShell from package barrel with jsdoc │
│    explaining Tier 2                                             │
│  - Add §"Three-tier API" to packages/workspace/README.md         │
│  Bead: j9p7.26                                                   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase D — Migrate workspace-playground to ChatLayout (canary)   │
│  ─────────────────────────────────────────────────────────────── │
│  - Rewrite apps/workspace-playground/src/App.tsx to use          │
│    <WorkspaceProvider> + <TopBar> + <ChatLayout>                 │
│  - Confirm e2e tests (apps/workspace-playground/e2e/*.spec.ts)   │
│    still pass                                                    │
│  - Document any gotchas for the next two app migrations          │
│  Bead: j9p7.27                                                   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase E — Migrate boring-macro-v2: ChatLayout + extract         │
│            macroPlugin (v7.6 paths, ONE-GO move)                 │
│  ─────────────────────────────────────────────────────────────── │
│  - Create apps/boring-macro-v2/src/plugin/{index.ts, server.ts,  │
│    front/, server/} per v7.6 layout. SPLIT entrypoints (codex    │
│    P1): index.ts exports macroClientPlugin (panels, sidebar,     │
│    catalogs); server.ts exports macroServerPlugin (agentTools,   │
│    routes adapter).                                              │
│  - front/: panes/ (chart-canvas, deck), sidebar/ (macro-series),│
│    catalogs/ (seriesCatalog)                                     │
│  - server/: tools/ (execute_sql, macro_search, get_series_data,  │
│    persist_derived_series), routes/ (macroRoutes)                │
│  - Rewrite apps/boring-macro-v2/src/web/App.tsx:                  │
│    <WorkspaceProvider plugins={[macroClientPlugin]}>             │
│      <ChatLayout nav="session-list" center="chat" sidebar=       │
│      "macro-series" surface="artifact-surface" />                │
│    </WorkspaceProvider>                                          │
│  - Rewrite apps/boring-macro-v2/src/server/index.ts to use        │
│    createWorkspaceAgentApp({ plugins: [macroServerPlugin()] })   │
│    + app.register(registerMacroRoutes, opts)                     │
│  - macro's uiBridge.ts is ALREADY deleted in Step 1a (NOT here   │
│    — gemini P2 catch).                                           │
│  - Confirm boring-macro e2e tests pass                           │
│  Beads: j9p7.18 (plugin module), j9p7.19 (app refactor),         │
│         j9p7.20 (e2e gate). Reframed under Phase E.              │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase F — Migrate full-app to ChatLayout (or IdeLayout)         │
│  ─────────────────────────────────────────────────────────────── │
│  - Rewrite apps/full-app/src/front/main.tsx to use the           │
│    appropriate declarative layout                                │
│  - Confirm e2e tests pass                                        │
│  Bead: j9p7.28                                                   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase G — Delete ChatCenteredShell + ChatShellContext +         │
│            finalize                                              │
│  ─────────────────────────────────────────────────────────────── │
│  Once D + E + F merged:                                          │
│  - Delete components/chat/ChatCenteredShell.tsx                  │
│  - Delete components/chat/context.ts                             │
│  - Drop related exports from src/index.ts                        │
│  - Remove now-empty components/chat/ folder                      │
│  - Update WORKSPACE_V2_PLAN.md and any other docs                │
│  Bead: j9p7.29                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Phase 1.5 risks

- **Pixel drift on canary migration.** Tier 1's `<ChatLayout>` may render at slightly different pixel offsets than `<ChatCenteredShell>` (different padding stack, different transition timing on the sidebar). Plan: regenerate visual snapshots when migrating workspace-playground; eyeball the diff for genuine regressions vs cosmetic shifts.
- **Plugin id collisions.** boring-macro's existing panels might collide with workspace's core panel ids. Audit during Phase E; rename macro panels to be namespaced (`macro:charts`, `macro:slides`).
- **boring-macro custom shell logic.** boring-macro's current App.tsx has more glue than the playground (custom session handling, custom topbar variants). Phase E may surface that some glue should live in `macroPlugin` (commands), and some should stay app-level (host wiring + auth). Will need careful split.
- **`uiCommandStream` / `uiCommandDispatcher` re-homing.** They're called from inside `ChatCenteredShell` today. After Phase A's move + WorkspaceProvider's mount-time wiring, they should be invoked from a `useEffect` inside `WorkspaceProvider` (or a dedicated hook). Confirm the lifecycle: the stream must start before the chat panel mounts.

### Phase 1.5 ship criteria

- All 7 phase beads (j9p7.24-29 + j9p7.18-20) closed
- Three apps run on declarative layouts in production
- `ChatCenteredShell` and `ChatShellContext` deleted from the tree
- Public API exposes Tier 1 / Tier 2 / Tier 3 entries with jsdoc
- README section in `packages/workspace/` describing the three-tier model with one snippet per tier

### Phase 1.5 supersedes / replaces

The earlier Phase 1 Step 5b ("ChatCenteredShell drops `data` + `extraPanels` props") and Step 5c ("WorkbenchLeftPane registry-driven") are **subsumed by Phase 1.5**:

- Step 5b's "drop legacy props" becomes "delete the whole shell" (Phase G).
- Step 5c's "registry-driven WorkbenchLeftPane" becomes "WorkbenchLeftPane is just one of the core panels registered by WorkspaceProvider; tab strip is gone" (Phase A + B).

Beads j9p7.16 (Step 5b) and j9p7.17 (Step 5c) close as **scope-shifted to Phase 1.5** — see Phase A/B beads for the new location.

## Phase 2/3 (sketched, deferred)

**Phase 2 — distributable plugins:**
- npm sub-path exports pattern (see §Distribution).
- Extend pi loader: `extractTools` → `extractPlugin`. Files in
  `.pi/extensions/` and `node_modules/pi-plugin-*` can export the
  full `Plugin` shape. Legacy tools-only plugins keep working.
- `GET /api/v1/plugins` discovery endpoint for system-prompt
  augmentation.
- Workbench data tab gains catalog selector — picks any registered
  catalog.
- Generic `search_catalog(id, query)` agent tool, auto-generated
  from registered catalogs.

**Phase 3 — agent-authored + dynamic:**
- `create_plugin` / `update_plugin` agent tools writing to
  `.pi/extensions/.agent-authored/`.
- Plugin hot-reload (requires Fastify-routes workaround).
- If/when needed (the dep graph stops being trivial): re-introduce
  `dependsOn`, `onMount`, lifecycle.
- Per-plugin sandboxing / capability flags.

## Test plan

- **Unit**
  - `definePlugin` validation: well-formed plugin passes;
    malformed contributions throw with field-level errors.
  - Bootstrap: defaults register before host plugins;
    excludeDefaults skips them; plugin contributions appear in
    per-type registries with correct pluginId; late-wins-on-id
    replaces and warns in dev.
  - File-pattern resolution: path-aware micromatch
    (`deck/**/*.md` matches `deck/labor/labor.md`); specificity
    ordering (deck/**/*.md beats **/*.md); same-specificity →
    app-beats-builtin → late-wins; explicit `surface.openPanel`
    bypasses.
  - `disableDefaultFileTools: true` removes file ops from
    standardCatalog; default keeps them.
  - RecentEntry: catalog-tagged entries render via the right
    catalog adapter; entries pointing at uninstalled catalogs are
    dropped; localStorage migration from string entries.
  - `validateTool` from `@boring/agent/shared/validateTool` works
    in a non-Node environment (no `node:*` imports leak).

- **Integration**
  - `<WorkspaceProvider plugins={[testPlugin]}>` →
    catalog/command/panel all reachable via their hooks.
  - `createWorkspaceAgentApp({ plugins: [testPlugin] })` exposes
    `agentTools` in agent catalog endpoint; substrate routes
    register.
  - Cmd palette renders catalogs from registered plugins;
    error-isolated per group.
  - `excludeDefaults: ['filesystem']` — Files tab not rendered,
    file ops not in tool catalog, file routes still served
    (substrate).
  - `excludeDefaults: ['dataCatalog']` removes the Data tab.
  - SurfaceShell fallback: opening a `.foo` file with no matching
    panel renders `EmptyFilePanel` (not a ghost tab).
  - allowedPanels gating: when set, only listed panel ids appear
    in the surface.

- **E2E**
  - **boring-macro-v2 existing e2e suite is the Step 6 acceptance
    gate** — all 10 specs (composer-border, deck, catalog-to-chart,
    catalog, split-no-clip, layout-persistence, chat-suggestions,
    chart-tabs, topbar, agent) MUST pass post-migration. The specs
    are behavior-level; only `App.tsx` and `server/index.ts`
    reference the deleted props.
  - Open `deck/labor/labor.md` → DeckPane (not generic
    MarkdownEditor) — confirms path-aware resolver.
  - Recent: open file from palette → close + reopen palette →
    file appears in Recent rendered as file path; run a command,
    Recent stays files-only.

## Acceptance

- `Plugin` contract (six fields) + `definePlugin` exported from
  `@boring/workspace`.
- `CatalogRegistry` new; `CommandRegistry` + `PanelRegistry`
  retrofitted subscribable.
- `<WorkspaceProvider plugins={[…]}>` and
  `createWorkspaceAgentApp({ plugins: [...] })` are the only
  registration APIs hosts use.
- One default plugin: `filesystemPlugin` (UI-only — panels + catalog; no agentTools per v7.0+).
  Both auto-mount; both individually opt-out-able; opt-out actually
  removes UI surface (registry-driven workbench tabs +
  EmptyFilePanel fallback).
- File-ops shared bundle in `@boring/agent` so standalone
  `createAgentApp` stays a real coding agent.
- `validateTool` extracted to `@boring/agent/shared` so the client
  bundle stays node-clean.
- Path-aware file-pattern resolver — `deck/**/*.md` works.
- `<CommandPalette />` renders catalogs from plugins; old
  `fileSearchFn`/`onOpenFile` props removed; Recent is polymorphic
  (catalog-tagged entries) and the type-mix bug is fixed.
- `<ChatCenteredShell />` registers its commands declaratively via
  an internal plugin; legacy `data` + `extraPanels` props deleted;
  `chatSuggestions` prop kept.
- `boring-macro-v2` migrated per §"Concrete before/after": ~260
  LOC → ~36 LOC. Same user-visible behavior. macro routes
  registered with `{ clickhouse, deckRoot }` opts via host's
  `app.register(...)` — one line in server/index.ts.
- Three breaking changes (`CommandPaletteProps`,
  `ChatCenteredShellProps.{data,extraPanels,withCommandPalette}`,
  `WorkbenchLeftPane` internal tab API) documented.
- `package.json` exports `./events`.
- All Phase 1 tests + macro e2e suite green.

## Open questions

1. **Plugin client/server file split — env guard or package.json
   exports?** Both work. Inline plugins use env guard; npm-published
   plugins (Phase 2) use package.json `exports`. Documented both.
2. **Discovery endpoint authentication?** Same as other agent routes
   (session cookie). Phase 2 concern.
3. **Hot-reload of Fastify routes (Phase 3 only).** Today
   `app.register(plugin)` is irreversible; this is one of the
   reasons routes aren't on the Plugin contract.

## Reference

- Existing pi plugin loader:
  `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`
- Existing `WorkspaceProvider`:
  `packages/workspace/src/WorkspaceProvider.tsx`
- Existing `<CommandPalette />`:
  `packages/workspace/src/components/CommandPalette.tsx`
  (Recent bug at lines 34, 59-60, 157, 230-232)
- Existing tool implementations (verified names: `read`, `write`,
  `edit`, `find`, `grep`):
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
- ChatSuggestion + ChatEmptyState (kept as-is):
  `packages/agent/src/front-shadcn/ChatEmptyState.tsx`
- Boring-macro-v2 host (the migration target — `src/web/`, not
  `src/front/`; uiBridge.ts confirmed at 9.3 KB):
  `/home/ubuntu/projects/boring-macro-v2/src/{server/index.ts,
  web/App.tsx, server/macroTools.ts, server/uiBridge.ts,
  server/macroRoutes.ts}`
- Sibling plans:
  - `UNIFIED_EVENT_BUS.md` — bus model (already implemented)
  - `UI_BRIDGE_OWNERSHIP_REFACTOR.md` — step 1a of this plan
- Superseded plans: `COMMAND_PALETTE_REGISTRY.md` (older); v2-v5.2
  of this file (in git history).

## Changelog v7.5 → v7.6 (round-5 review patches)

Codex r5 (4 P1 + 3 P2) + gemini r2 (1 P0 + 2 P1 + 3 P2) returned with sharp findings. **Convergence**: both flagged the sequencing tension (gemini P0 / codex P1 #4) and the per-plugin halves entrypoint shape (codex P1 #3 / gemini P1 empty-server). User decided all four design questions; this changelog captures the integration.

### P0 — Sequencing fixed (gemini)

The plan had Phase 1.5 Phase A doing BOTH the workspace reorg AND the chat-shell decomposition. That meant Phase 1 would build into the OLD flat layout, then Phase A would rip up and re-arrange. **Fix:** new **Step 0** before Phase 1 runs the mechanical workspace-reorg into v7.6 layout (front/+server/+shared/+plugins/) one-go. Phase A then ONLY decomposes the chat shell. **Meta-rule added:** when files move, they go directly to final v7.6 destinations — no intermediate placements.

### P1 — Plugin entrypoints split (codex)

v7.5's spec said "plugin index.ts exports CLIENT + server Plugins (same id)." Codex flagged: this contradicts the build invariant that client barrels never re-export server-only code. **Fix:** every plugin has TWO entrypoints — `index.ts` (client side) and `server.ts` (server side). Hosts import each from the appropriate environment. Same id ties them; different files ship them. macro example updated. filesystemPlugin (UI-only) has only `index.ts` (no server.ts needed; gemini P1 — "create only halves you need").

### P1 — Strict type-only imports for shared/plugin

Codex flagged: `shared/plugin/types.ts` referencing `ExplorerAdapter` from `components/DataExplorer/types` would leak DOM lib into the shared bundle. **Fix:** all cross-folder type references in `shared/plugin/` use `import type` (TypeScript erases at compile time). Plus `tsconfig.shared.json` (if it exists) excludes DOM lib. Plus `tsconfig.front.json` adds excludes for `src/plugins/**/server/**` to prevent server code being typechecked as front (codex P1 #1).

### P1 — Phase 1.5 step text path-updated

Codex flagged that Phase A still said `panes/<id>/`, Phase C said `layouts/TopBar.tsx`, Phase E said `src/macroPlugin.ts` — all pre-v7.5. **Fix:** Phase A → `front/chrome/<id>/`; Phase C → `front/layout/TopBar.tsx`; Phase E → `apps/.../src/plugin/{front,server}/` directly. Bead descriptions to be updated post-commit.

### P2 cleanup pack (applied)

1. **uiBridge dedup** — drop deletion from Phase E; keep in Step 1a only (gemini P2)
2. **EmptyFilePanel relocation** — `panes/EmptyFilePanel/` → `front/chrome/empty-file-panel/` to kill the lone-resident `panes/` folder (gemini P2)
3. **TL;DR scrub** — "two default plugins" wording in scope text → "one default plugin: filesystemPlugin" (codex P2)
4. **A/B parallelism tightened** — "B can start in parallel but cannot close before A's definition.ts files exist" (codex P2)
5. **pi-tools-migration catch-up** — note that `standardCatalog.ts` no longer exists; `createAgentApp.ts:91` already uses `buildHarnessAgentTools` + `buildFilesystemAgentTools` directly
6. **tsconfig excludes** — already noted under P1 type imports

### Verdict from both reviewers

- **Gemini r2:** "implementable as-is, provided the Step 0 sequencing tweak."
- **Codex r5:** "implementable after above cleanup, not quite as-is."

After v7.6 patches: both verdicts converge on **implementable as-is**. No reversals from earlier rounds. The architecture stands.

### Beads needing path updates

- **NEW j9p7.31** — Step 0 workspace reorg (mechanical)
- **j9p7.9** (filesystemPlugin) — paths under `plugins/filesystemPlugin/{index.ts (no server.ts since UI-only), front/}`
- **j9p7.18** (macro plugin module) — paths under `apps/boring-macro-v2/src/plugin/{index.ts, server.ts, front/, server/}`
- **j9p7.24** (Phase A) — paths under `front/chrome/<id>/` and `front/bridge/`
- **j9p7.25** (Phase B) — `front/registry/coreRegistrations.ts`
- **j9p7.26** (Phase C) — `front/layout/TopBar.tsx`

## Changelog v7.4 → v7.5 (final structural framing)

User iterated through four refinements (2026-04-29) to lock the
post-migration directory layout. Each round narrowed scope:

1. **"`panes/` should be workbench panes only"** — panes/ was conflating
   workbench-center (code-editor, markdown-editor) with sidebar tabs
   (file-tree, data-catalog) and chrome (ArtifactSurfacePane,
   EmptyPane). Strict role split.
2. **"Plan structure to fit the plugin system; panes will belong to a plugin"** —
   plugin-contributed components live INSIDE the contributing
   plugin's directory, not at the workspace root. CodeEditor /
   MarkdownEditor / FileTree all migrate into `plugins/filesystemPlugin/`.
3. **"core/ + layout/ + plugins/ as high-level framing"** — initial
   three-folder taxonomy.
4. **"Should we distinguish front and back?"** — yes; matches
   `@boring/agent`'s `front/ + server/ + shared/` convention.
5. **"plugins/ should contain actual plugins only"** — plugin model
   machinery moves out of `plugins/` into `front/plugin/`,
   `server/plugin/`, `shared/plugin/`. Singular `plugin/` for
   machinery; plural `plugins/` for instances.

### Final structure (locked)

```
src/
├── front/                       workspace front + plugin front machinery
│   ├── chrome/                       shell parts (chat, sessions, surface, …)
│   ├── components/                   UI primitives
│   ├── registry/                     base registries
│   ├── dock/, events/, bridge/, hooks/, layout/
│   ├── panes/EmptyFilePanel/         workbench-center fallback (substrate)
│   ├── plugin/                       ← plugin model FRONT machinery
│   │   ├── CatalogRegistry.ts
│   │   ├── PluginErrorBoundary.tsx
│   │   ├── PluginInspector.tsx
│   │   └── hooks (usePlugins, useCatalogs, useCommands, useActivePanels)
│   └── WorkspaceProvider.tsx
│
├── server/                      workspace server + plugin server machinery
│   ├── createWorkspaceAgentApp.ts, http/, ui-bridge/
│   └── plugin/                       ← plugin model SERVER machinery
│
├── shared/                      types both halves need
│   ├── ui-bridge.ts, events/
│   └── plugin/                       ← plugin model SHARED
│       ├── types.ts                  Plugin, CatalogConfig
│       ├── definePlugin.ts
│       └── bootstrap.ts
│
└── plugins/                     ← ACTUAL plugin instances (plural)
    └── filesystemPlugin/
        ├── index.ts                  client + server Plugins (same id)
        ├── front/{panes, sidebar, catalogs}
        └── server/                   (currently empty for filesystemPlugin)
```

### Naming convention (locked)

| Folder | Meaning |
|---|---|
| `front/` (root) | Workspace's own client-side code |
| `server/` (root) | Workspace's own backend code |
| `shared/` (root) | Workspace's own cross-process types |
| `plugins/` (root, plural) | Directory of plugin instances |
| `plugin/` (in front/, server/, shared/) | Plugin model machinery (singular) |
| `<plugin>/front/` (per-plugin) | The plugin's client-side contributions |
| `<plugin>/server/` (per-plugin) | The plugin's server-side contributions |

Apps mirror: each app contributes ONE plugin, lives in `apps/<host>/src/plugin/{front,server}/`. Multi-plugin apps would rename to `plugins/<id>/`.

### Why this is the right framing

1. **Matches `@boring/agent` convention** — `front/ + server/ + shared/` parity across packages.
2. **Bundle boundary explicit** — tsup config can target `front/index.ts` and `server/index.ts` cleanly. Phase 2 npm sub-path exports (`./client`/`./server`) line up directly.
3. **Plugin = self-contained unit** — a plugin owns BOTH its front and server halves in ONE directory. Distributed npm plugins ship the same shape.
4. **No category mixing at any level** — workspace own code is in `front/server/shared`; plugins are in `plugins/`; plugin machinery is in singular `plugin/` sub-folders. Zero ambiguity for new contributors.
5. **Plays well with build invariants** — codex round-2 caught a P0 where server-only modules were about to leak into client code. With the explicit split, the lint rule "front/ must not import from server/" is one path-prefix check.

### Bead impact

Mostly path-string updates; no semantic changes:

- **j9p7.9** (filesystemPlugin) — paths update from
  `packages/workspace/src/plugin/defaults/filesystemPlugin.ts` to
  `packages/workspace/src/plugins/filesystemPlugin/{index.ts,front/...,server/...}`
- **j9p7.24** (Phase A — decompose chat shells) — paths update from
  `panes/<id>/` to `front/chrome/<id>/` for all chrome moves
- **j9p7.18** (macro plugin module) — paths update from
  `apps/boring-macro-v2/src/plugin/{index,server}.ts` to
  `apps/boring-macro-v2/src/plugin/{index.ts,front/,server/}`

A new bead **j9p7.30** could capture the workspace front/server reorg
itself if it's substantive enough to warrant separate tracking. For
now, fold into Phase A (j9p7.24) since they're both restructuring
the same directory.

## Changelog v7.3 → v7.4 (merger of declarative-layout-migration plan)

User decision (2026-04-29): **merge into one mega-plan + one epic**. The earlier `DECLARATIVE_LAYOUT_MIGRATION.md` (epic boring-ui-v2-zrby, empty) is now Phase 1.5 of this plan. Single acceptance gate.

### What changed

1. **New §"Phase 1.5: Consumer migration — decompose shells, declarative layouts, delete ChatCenteredShell"** added between §"Concrete before/after" and §"Phase 2/3."
   - Documents three-tier API (Tier 1 declarative pre-shaped layouts; Tier 2 custom LayoutConfig with stock chrome; Tier 3 raw primitives)
   - Substrate vs default-plugin vs app-plugin clarification (chat is core, not a plugin)
   - File-tree end state (panes/ as canonical home; components/chat/ disappears)
   - 7 phase beads breakdown (Phase A → G) with parallelism map
   - Risks + ship criteria

2. **j9p7.16 (Step 5b) and j9p7.17 (Step 5c) marked obsolete** — scope-shifted to Phase 1.5. Closing them with reason "subsumed by Phase 1.5 Phase A/B." Replacement beads created for each Phase.

3. **j9p7.18 / .19 / .20** (macro plugin module / app refactor / e2e gate) **reframed under Phase E**, not Step 6. Same work, different grouping.

4. **6 new beads created** for Phase 1.5 phases that don't have direct j9p7 equivalents:
   - j9p7.24 (Phase A — decompose shells)
   - j9p7.25 (Phase B — wire core panel registrations)
   - j9p7.26 (Phase C — lift TopBar chrome)
   - j9p7.27 (Phase D — migrate workspace-playground canary)
   - j9p7.28 (Phase F — migrate full-app)
   - j9p7.29 (Phase G — delete ChatCenteredShell + finalize)

5. **`DECLARATIVE_LAYOUT_MIGRATION.md` marked superseded** with a banner pointing to this plan. Content preserved in git history; the file remains as a tombstone redirect.

6. **Epic boring-ui-v2-zrby closed** as merged into j9p7. Its 0 children become moot.

### Why merge (vs keep two plans)

The two plans had ~37 + 24 = 61 cross-references between them (`ChatCenteredShell`, `macroPlugin`, `delete uiBridge`). Macro migration was duplicated: j9p7 had it as Step 6; zrby had it as Phase E. The risk of doing j9p7's "ChatCenteredShell drops props" THEN having zrby delete the shell entirely is real wasted work — the user named it as the deciding concern.

Merging gives:
- One coherent narrative: "build plugin model machinery → migrate consumers to declarative composition"
- One acceptance gate (boring-macro e2e suite passes after Phase E)
- One epic to track end-to-end progress
- ~270 lines of doc (Phase 1.5 section) vs ~270 lines duplicated across two files

### Net spec impact

- PLUGIN_MODEL.md grows by ~280 lines (Phase 1.5 + this changelog entry)
- DECLARATIVE_LAYOUT_MIGRATION.md gains a SUPERSEDED banner; content preserved in history
- j9p7 epic gains 6 new beads, closes 2 obsolete beads
- zrby epic closes
- Acceptance contract updated: j9p7 closes when Phase 1.5 ship criteria met (declarative apps + ChatCenteredShell deleted + Tier 1/2/3 public API)

## Changelog v7.2 → v7.3 (PanelConfig roles clarified)

User question (2026-04-29): "should we distinguish between pane and
component that belong to the left sidebar... + we could imagine full
workbench pages as well?"

Honest answer: yes, the three roles ARE conceptually distinct. v7.3
chooses to clarify them in docs without splitting the type — Phase 1
impl already works; up-front splitting adds API surface without
catching real bugs. Discriminated-union refactor is a good Phase 2
candidate, blocked until a second role-specific field appears.

### Spec additions

1. **New §"PanelConfig roles — three uses, one type"** inside
   §"Concrete contribution types". Names the three roles
   (sidebar tab / workbench pane / bottom dock); for each:
   required fields, fields-not-to-set, concrete examples from
   filesystemPlugin and macroPlugin.

2. **Reserved/future placements documented:** `'right-tab'`
   (symmetric to left-tab; no Phase 1 consumer); `'left'` /
   `'right'` (legacy non-tabbed; Phase 1 plugins don't use).

3. **`Plugin.pages?: PageConfig[]` sketched as future contribution
   type** for full-viewport views (Settings, Reports, Onboarding
   flow). Out of scope for Phase 1; conceptually similar to VS
   Code's `viewsContainers`. Documented but not in the contract.

### Decision: defer the discriminated-union split

The split becomes worth it when:
- A second role-specific field appears (e.g., sidebar tabs gain
  `tabOrder`, bottom docks gain `defaultHeight`)
- Plugin authors hit type-confusion bugs in practice

Until then: one type with `placement` runtime-disambiguating is
cheaper.

### `/registry` directory clarification (also v7.3)

User question: "will `packages/workspace/src/registry/` disappear
after Phase 1?"

Answer: no — it stays. It holds the BASE PanelRegistry +
CommandRegistry + RegistryProvider that the plugin model
(`/plugin/`) FANS INTO via `bootstrap()`. The split is logical:
`/registry` is "primitives any host could use directly without
plugins"; `/plugin` is "the unified contribution layer." Active
consumers of `/registry` outside the plugin path:
WorkspaceProvider, DockviewShell, ChatCenteredShell, layout
presets, ArtifactSurfacePane tests. Tearing down would break them
without payoff.

### Net impact

- Spec: +130 lines (new role-clarification subsection + future
  `pages` sketch + this changelog entry).
- Contract: unchanged — same 7 fields (id, label, systemPrompt,
  panels, commands, catalogs, agentTools).
- Beads: unchanged. Bead descriptions can keep using
  `placement: 'left-tab'` / `'center'` etc. as today.

## Changelog v7.1 → v7.2 (planning-workflow review pass)

After 4 codex rounds + 1 gemini round + ultrathink self-audit, ran
the GPT-Pro-style "review and propose your best revisions" pass.
User selected the wholeheartedly-recommended subset (5 of 8
proposals) plus the cross-plan alignment.

### Robustness additions (selected)

**1. Per-plugin React error boundaries.** Every plugin contribution
that renders React (panels, catalog row renderers, chat-suggestion
cards) is wrapped in `<PluginErrorBoundary pluginId>`. A buggy
plugin can no longer crash the workspace shell. Dropped errors
push into `WorkspaceContext.errors[]` for visibility via
`<PluginInspector />`. Implementation sites: PanelHost, CatalogResults,
chat-suggestion card list. ~50 LOC. New bead: j9p7.22.

**2. CatalogRegistry search debouncing + AbortSignal propagation.**
New hook: `useDebouncedCatalogSearch(query, opts?)` debounces 150ms,
aborts in-flight searches per keystroke via the AbortSignal that
ExplorerAdapter.search ALREADY accepts (verified
`packages/workspace/src/components/DataExplorer/types.ts:46-55` —
no contract change needed; just consumer-side wiring). Per-catalog
errors isolated via try/catch. Updates bead j9p7.13.

### Compelling-feature addition (selected)

**3. `Plugin.systemPrompt?: string`.** Optional field; bootstrap
concatenates across registered plugins (in registration order),
prepends to the harness's base system prompt. Lets plugin authors
own their domain framing for the LLM ("you have a FRED database;
use macro_* tools for X"). Concrete LLM-quality improvement;
reduces host-author burden. Updates beads j9p7.4 (contract +
validation), j9p7.7 (bootstrap concat), j9p7.18 (macro plugin sets).

### DX additions (selected)

**4. `<PluginInspector />` PROMOTED to Phase 1.** Was cut in v6
("console.log is enough"). Reversal justified: plugin authors hit
"why didn't my command appear?" daily; visual check beats
spelunking React DevTools. ~50 LOC, zero production cost
(import.meta.env.DEV gated). New bead: j9p7.23.

**5. New §"Decisions log".** Single-table summary of locked
architectural decisions with one-line rationale + pointer to the
changelog entry. Sits near the top so fresh-eyes reviewers don't
re-litigate from first principles. ~30 lines docs.

**6. New §"Plugin patterns: cross-plugin communication".** Three
canonical patterns — shared registry / event bus / late-wins
override — each with a worked code example + anti-patterns table.
~60 lines docs. Plugin authors get templates instead of
reinventing.

### NOT selected from the proposal set

- **`Plugin.contractVersion?: number`** (Revision 4) — defensive
  forward-compat insurance for Phase 2 distribution. User chose to
  skip; revisit when Phase 2 lands.

### Cross-plan alignment

**7. pi-tools-migration.md aligned to v7.x.** v6.3-aligned text in
4 places (lines 265, 294, 323, 886) updated to reflect v7.0+'s
harness-owns-tools framing. The two plans now read consistently.

### Net impact

- New beads: j9p7.22 (error boundaries) + j9p7.23 (PluginInspector)
- Updated beads: j9p7.4 (systemPrompt validation), j9p7.7 (bootstrap
  concat), j9p7.13 (debounced search), j9p7.18 (macro systemPrompt)
- Spec additions: ~250 lines (decisions log + patterns + 3 new
  sections + v7.2 changelog)
- Same boring-macro acceptance test; LOC accounting unchanged
- Plugin contract grows from 6 fields to 7 (added optional
  systemPrompt)

## Changelog v7.0 → v7.1 (codex round-4 cleanup)

Codex round-4 verdict: **v7.0 concept is implementable** (no P0). But
the v7.0 patch missed four spots where v6.3 text remained in active
spec sections. Plus one missing policy + one cross-package
implementation gap.

### Patches

1. **§"Concrete filesystemPlugin source"** (line ~474) — was still
   `import { filesystemAgentTools }` + `agentTools:
   filesystemAgentTools`. Fixed: import dropped, `agentTools` field
   gone, comment points to the harness-owns-tools section.
2. **Tool registration flow ASCII diagram** (line ~1180) — was
   showing v6.x dual-registration ("STANDALONE PATH" vs "WORKSPACE
   PATH" with `disableDefaultFileTools: true`). Fixed: single path,
   v7.1 narrative, `excludeDefaults` semantics narrowed.
3. **Reorganization table** (line ~1336) — said file ops bundle is
   "imported by both `createAgentApp` AND `filesystemPlugin.agentTools`."
   Fixed: only `createAgentApp` imports; "Not imported by
   filesystemPlugin" called out.
4. **Step 3 ASCII (in exact-path block)** — said `makeFilesystemPlugin
   (deps)` contributes agentTools. Fixed: plain const, UI-only,
   pi-tools-migration owns the tools.

### Additions

5. **§"Reserved tool names"** (codex round-4 P2) — explicit policy:
   `bash` / `executeIsolatedCode` / `read` / `write` / `edit` /
   `find` / `grep` / `ls` are HARNESS substrate. Plugin-contributed
   `agentTools` should use a domain prefix (`macro_search`,
   `docs_lookup`). Dev-mode warn on collision; no hard reject
   (override is sometimes intended). Existing
   `mergeTools.ts:30`'s late-wins-on-name behavior is documented as
   the legacy semantic for the pi loader path.
6. **Known-gaps register entry** — `registerAgentRoutes` lacks
   `disableDefaultFileTools` (codex round-4 P1). Live verified:
   `createAgentApp` has the flag but `registerAgentRoutes` doesn't.
   The "harness opt-out" promise only holds for the `createAgentApp`
   path. **Out of scope for Phase 1 macro acceptance** (macro uses
   `createWorkspaceAgentApp` → `createAgentApp`, not
   `registerAgentRoutes`). Tracked as a known-gap; promote to a
   bead if a `registerAgentRoutes`-using host needs the opt-out.

### Cross-plan note (NOT patched in this commit)

`packages/agent/docs/plans/pi-tools-migration.md` (the sibling plan
that ships first) still has v6.3-aligned text in three places:
- Line 265: file tools called from BOTH createAgentApp AND filesystemPlugin
- Line 294: filesystemPlugin becomes a factory with agentTools
- Lines 323, 886: `excludeDefaults: ['filesystem']` removes file tools

Live code (`createAgentApp.ts:91` + `createWorkspaceAgentApp.ts:50`)
matches v7.x, NOT pi-tools-migration's text. The sibling plan
needs an alignment pass — flagged for the user (separate plan
ownership).

### Codex round-4 verdict on macro acceptance

Macro 260→46 still holds. v7 automatic file tools don't add macro
glue; macro domain tools still fit `Plugin.agentTools`. Current
j9p7 beads are v7-aligned (verified post f2d73bc). Old uhwx
(pi-tools-migration) docs/beads are stale relative to v7 — track
separately.

## Changelog v6.3 → v7.0 (separation of concerns: harness owns tools)

User insight (2026-04-28): "fs plugin should not expose tools —
those tools belong to the harness." Sharp framing. Adopted.

### What changes

The dual-registration arrangement (filesystemPlugin + standalone
agent share the same tool factory) was conflating two concerns:
"should the agent have file tools?" (harness config) and "should
the UI show a file tree?" (plugin config). Two separate switches,
two separate layers. v7.0 untangles them.

- **`filesystemPlugin` becomes UI-only.** No `agentTools` field.
  Just panels (FileTree left-tab, CodeEditor center, MarkdownEditor
  center) + a Files catalog (cmd palette). Plain module-scope
  const — no `(deps)` factory needed.
- **Substrate file tools live with the harness.** Per
  pi-tools-migration: `buildFilesystemAgentTools(bundle)` returns
  `[read, write, edit, find, grep, ls]`; `buildHarnessAgentTools`
  returns `[bash, executeIsolatedCode]`. Both registered by
  `createAgentApp` directly. Always-on for the harness path.
- **`disableDefaultFileTools: true`** (on `createAgentApp`) is the
  only switch that removes file tools entirely. Use case:
  sandboxed deployment / no-fs agent.
- **`excludeDefaults: ['filesystem']`** removes only the UI (Files
  tab, code/markdown editor auto-routing). The LLM still has
  `read`/`write`/etc. — they're substrate, not plugin
  contributions. Honest narrower promise.
- **`createWorkspaceAgentApp` no longer passes
  `disableDefaultFileTools: true`** to the underlying
  `createAgentApp`. Plain wrap. No coordination dance.
- **`Plugin.agentTools`** survives — but only for **domain tools**
  like macro's `execute_sql`/`macro_search`/`get_series_data`.
  Those depend on app-specific runtime state (ClickHouse client)
  the host owns; they belong on the plugin contract. Substrate
  tools don't.

### Custom (non-pi) filesystem tools — supported

`buildFilesystemAgentTools(bundle)` is **not** restricted to pi
factories. It can return pi tools + project-specific filesystem
tools that pi doesn't ship (e.g., `watch_files`, `stat`,
`git_status`, `multi_edit`). These are substrate alongside pi's
defaults — same registration path, same lifecycle. They live in
`@boring/agent/server/tools/filesystem/`, NOT in
`filesystemPlugin`. Author wraps as `AgentTool`; bundle factory
composes them into the array.

This was an explicit user clarification: "we may add fs tools that
are not the default pi ones."

### What this removes from the spec

- The whole §"File ops: shared bundle, dual registration path"
  walkthrough — replaced by §"Tools belong with the harness, not
  the plugin" + §"Custom (non-pi) filesystem tools".
- The `(deps)` argument on `makeFilesystemPlugin` — plugin is now
  a plain module-scope const.
- The `disableDefaultFileTools: true` indirection from
  `createWorkspaceAgentApp` — plain wrap.
- ~50 lines of spec total.

### Acceptance test impact

boring-macro-v2 migration LOC accounting unchanged (-86%). What
changes is that macro's agentTools come ONLY from
`makeMacroServerPlugin` (which is right — they're domain tools).
File tools come from the harness automatically. No plumbing
difference for macro's host code.

### Bead impact

- **B2** (file ops bundle extraction) → reframed as "extract
  pi-factory wiring per pi-tools-migration; bundle includes pi
  tools + any custom additions." No dual-registration story.
- **B9** (filesystemPlugin) → becomes a tiny bead: plain const
  with panels + catalog, no agentTools. ~10 LOC of plugin code.
- **B11** (createWorkspaceAgentApp) → no
  `disableDefaultFileTools: true` wiring; just wraps
  `createAgentApp` and runs bootstrap.

All three bead descriptions updated to match v7.0 framing.

## Changelog v6.2 → v6.3 (gemini fresh-eyes review patches)

Gemini did a fresh-eyes review (Gemini hadn't reviewed v6.x; codex
ran rounds 2 and 3). Surfaced 1 P0 + 4 P1 + 1 P2 — all real, none
duplicating codex. Quality of the catch on the P0 was particularly
good: it noticed an actual closure-over-React-state bug in v6.2's
`ChatCenteredShell` migration that codex round-3 missed.

**P0 — Static "internal chat-shell plugin" can't access
`ChatCenteredShell` local state.** v6.2 said static commands
(`toggleSessions`/`toggleWorkbench`/`newChat`) move into a
module-scope plugin while only per-session commands stay
imperative. But `toggleDrawer` and `toggleSurface` are closures
over `useState` *inside* the React component
(`ChatCenteredShell.tsx:222-226`). A module-scope plugin can't
reach that state, and bridging via events would just shift the
closure problem to the event handler.

**Fix:** drop the "internal chat-shell plugin" idea entirely. ALL
ChatCenteredShell-internal commands stay as imperative
`useEffect`+`registerCommand` calls. The registry's subscribe
retrofit (Step 2c) propagates them to an open palette. The plugin
model is for module-stable contributions; component-instance
commands belong inside the component. Honest.

**P1.1 — Removing commands from Recent is a UX regression.** v6.2
said "Recent is catalog-only — commands don't appear in Recent."
Every mature command palette (VS Code, Raycast, Linear) shows
recent commands; users rely on them for quick re-runs of frequent
actions ("Toggle Theme," "Format JSON"). **Fix:** `RecentEntry`
becomes a discriminated union — `{type: 'catalog', ...} | {type:
'command', ...}`. Render both, drop orphans of either. Existing
localStorage `cmd:foo` entries map to the command branch on
migration; plain paths to the catalog branch.

**P1.2 — `rowSnapshot` localStorage round-trip can corrupt
non-serializable values.** `JSON.stringify` silently strips
`Date` / `Map` / functions / React nodes; restore would crash.
**Fix:** added §"Recent serialization invariant" — `ExplorerRow`
participating in Recent MUST be 100% JSON-serializable; adapters
naturally holding non-serializable values (e.g., Dates) serialize
at row construction time and re-hydrate in the renderer. No
deserialize hook in Phase 1 (add as non-breaking optional if a
real case appears).

**P1.3 — Cutting `onMount` strands non-React stateful adapters.**
A catalog adapter that wants `events.on('file:moved')` for cache
invalidation has nowhere to do it: module-scope subscription fires
globally for all hosts; lazy-on-first-call leaks.
**Fix:** documented the limitation in §"Known gaps — deferred to
Phase 2+". `onMount` is the trigger condition for re-introduction.
Phase 1 plugins are all React-component-based or factory-injected,
so the assumption holds for now; honest about when it breaks.

**P2 — Dropping `dataSources`/`data` props forces boilerplate for
simple hosts.** A host that just wants "a data tab with my
adapter" had a one-liner; v6.2's "register your own left-tab
panel" makes it ~10 lines. **Fix:** added §"Convenience:
`makeStaticDataPlugin`" — a workspace-exported factory that
constructs a Plugin wrapping a `DataExplorer` panel + catalog
from a single `{adapter, onActivate?}` opts argument. Restores
1-liner ergonomics for the common case; macro keeps its
hand-authored `macroSeriesPanel` because it needs surface access
for chart-opening.

### Verdict on the simplification cuts (gemini)

> *"Cutting `routes`, `dependsOn`, `order`, and `chatSuggestions`
> is highly defensible and correctly shifts HTTP infrastructure
> and declarative configuration out of the pure-data plugin
> envelope. The only cut that went too far is `onMount`."*

Codex (round-3): *"order/dependsOn/optionalDeps/version/routes/
chatSuggestions/onMount are mostly defensible for macro."*

Both reviewers converge on `onMount` being the riskiest cut, and
both agree it's defensible for Phase 1 specifically (no Phase 1
plugin needs it). v6.3 documents the limitation with an explicit
re-introduction trigger; if/when a stateful adapter appears,
adding `onMount` is a non-breaking optional contract field. The
cut holds for Phase 1; the sensitivity is acknowledged.

### Net impact (v6.2 → v6.3)

- ChatCenteredShell migration honest: ALL its commands stay
  imperative; no fictional "internal plugin" indirection.
- `RecentEntry` discriminated union: catalogs + commands.
- JSON-serializable invariant on `ExplorerRow` documented.
- Known-gaps register adds the non-React-adapter lifecycle item
  with `onMount` re-introduction trigger.
- New `makeStaticDataPlugin` convenience export.
- Same boring-macro acceptance test; LOC accounting unchanged.

## Changelog v6.1 → v6.2 (round-3 codex review patches)

Round-3 codex review against v6.1 surfaced 1 P0 + 1 P1 + 2 P2 — all
real, all verified against the live codebase. The cuts from v6 (no
dependsOn, no onMount, no routes, no chatSuggestions on contract)
verdict: defensible. Patches focus on Phase 1 semantics that were
underspecified.

**P0 — `filesystemAgentTools: AgentTool[]` static shape doesn't
match runtime reality.** The current `standardCatalog.ts:84`
constructs file tools from runtime deps (`workspace`, `sandbox`,
`fileSearch`); each `createXxxTool(deps)` returns an `AgentTool`.
The plan's claim that `filesystemAgentTools` is a static array
can't be wired. **Fix:** the bundle is now a factory:
`createFilesystemAgentTools(deps): AgentTool[]`. Both
`createAgentApp` (default-on) and `filesystemPlugin` call it with
their respective runtime bundles. `filesystemPlugin` itself
becomes `makeFilesystemPlugin(deps)` (factory shape, like
`makeMacroPlugin`) so it can be constructed with the runtime deps
by `createWorkspaceAgentApp` rather than evaluated at module load.

**P1 — Workbench data tab semantics ambiguous after dropping
`data` prop.** With `recentKind` cut and multiple registered
catalogs (filesystem's Files + macro's Series), nothing in the
spec said which one fills the generic Data tab. **Fix:** drop
`dataCatalogPlugin` from defaults entirely. There is no generic
Data tab; plugins that want a workbench data tab register their
own `placement: 'left-tab'` panel (e.g., macro's `macroSeriesPanel`
which internally renders DataExplorer with the macro adapter +
`onActivate` → `surface.openPanel({ component: "chart-canvas",
... })`). Cleaner, no precedence rule needed.

**P2 #1 — Macro example violated its own client/server build
invariant.** v6.1's `apps/boring-macro-v2/src/plugin/index.ts`
imported `macroAgentTools` from `../server/macroTools` — server
code in client-facing index.ts. **Fix:** macro plugin splits into
`makeMacroClientPlugin()` (panels/catalogs) in `plugin/index.ts`
+ `makeMacroServerPlugin()` (agentTools) in `plugin/server.ts`,
both `definePlugin({ id: "boring-macro", ... })` with the same id.
`<WorkspaceProvider>` gets the client one; `createWorkspaceAgentApp`
gets the server one. Same pattern as Phase 2 npm distribution
(client/server sub-path exports).

**P2 #2 — ChatCenteredShell migration didn't address dynamic
command registration.** The current code registers per-session
quick-switch commands inside a `useEffect` that depends on
`sessions` prop changing at runtime. A static plugin contribution
can't represent that. **Fix:** spec now says ONLY the static
commands (toggleSessions/toggleWorkbench/newChat) move to the
internal chat-shell plugin; per-session commands STAY as
imperative `useCommandRegistry().registerCommand` calls inside
ChatCenteredShell. Coexistence works because the registry's
subscribe retrofit (Step 2c) handles late registrations.

### Verdict on the v6 simplification cuts

Codex round-3 explicitly: *"`order/dependsOn/optionalDeps/version/
routes/chatSuggestions/onMount` are mostly defensible for macro.
The simplification breaks only where Phase 1 semantics are
underspecified (catalog selection) or where the spec's tool-bundle
shape is incompatible with current runtime dependency injection."*

Both blockers are now patched in v6.2. None of the v6 cuts get
rolled back.

### Net impact (v6.1 → v6.2)

- One default plugin removed (`dataCatalogPlugin`).
- Two factory shapes formalized (`createFilesystemAgentTools(deps)`
  and `makeFilesystemPlugin(deps)`).
- Macro example honors client/server split.
- ChatCenteredShell migration spec acknowledges static-vs-dynamic
  command lifetime.
- LOC accounting updates: 260 → 46 (-82%); slightly less reduction
  than v6.1's claimed 36 because the macro plugin is split into
  two files now.

## Changelog v6 → v6.1 (ultrathink self-audit)

Self-applied ultrathink review against v6 — the kind of pass an
external reviewer would make. Seven findings, all small:

1. **`recentKind` on CatalogConfig was dead code.** Set but never
   read after the spec normalized to "drop orphans." Cut from the
   contract; cut from `RecentEntry`. Phase 2 "filter Recent by
   kind" UX can re-add as a non-breaking optional field.

2. **`definePlugin` validation was claimed but never enumerated.**
   New §"What `definePlugin` validates" lists the five categories
   of checks (id, panels, commands, catalogs, agentTools) so plugin
   authors can predict what fails.

3. **Plugin-level id collision policy was missing.** Contribution-
   level (panel id, command id) is late-wins-with-warn; that's
   composition. But two plugins sharing `Plugin.id` is identity
   confusion, not composition — should throw. Documented in new
   §"Plugin id collision policy."

4. **Build/bundle invariants were implicit.** `plugin.client.ts`
   and `plugin.server.ts` MUST NOT cross-import or the client
   bundle leaks `node:*` imports. Added §"Build/bundle invariants"
   listing three enforcement strategies (RSC directives, npm
   sub-path exports, conditional imports) — any one suffices.

5. **No testing guidance.** Plugin authors had to figure out
   testing patterns themselves. Added §"Plugin testability" with
   three concrete patterns: unit (assert contract shape),
   integration (`<WorkspaceProvider plugins={[testPlugin]}>` +
   `renderHook`), server (`createWorkspaceAgentApp` + Fastify
   `inject()`).

6. **No concrete `filesystemPlugin` source.** The plan was abstract
   about what the canonical default plugin looks like. Added the
   actual code so the plan is self-contained; it's the most-cited
   exemplar in the spec.

7. **Known-gaps register added.** §"Known gaps — deferred to Phase
   2+" makes 11 things explicit (hot-reload, build-time
   enforcement, plugin versioning, layout migrations, …) with a
   "when to revisit" column. Reviewers who want to flag gaps can
   check whether they're already on the deferral list before
   adding scope.

### Considered but not changed

- **`Plugin.label` removal** — considered cutting (defaults to
  `id`). Kept because `label?: string` is one optional line and
  it'll be visible in any future inspector / discovery UI.
- **`agentTools` field on Plugin** — considered moving server-only
  contributions into a separate `ServerPlugin` shape. Rejected:
  same plugin id on client and server is the design intent (see
  §Distribution); separate shapes would bifurcate the contract
  for no real benefit.
- **`definePlugin` immutability via `Object.freeze`** — considered.
  Rejected as over-engineering until accidental mutation is a
  real problem.

### Net impact (v6 → v6.1)

- One field cut (`recentKind`).
- Five sections added (~100 lines): validation enumeration, id
  collision policy, build invariants, testability, concrete
  filesystemPlugin source, known-gaps register.
- Same boring-macro acceptance test.
- Same 6-field Plugin contract (now actually 5 mandatory fields +
  optional `label`).

## Changelog v5.2 → v6 (simplification pass)

After multiple review rounds we noticed v5.2 had grown defensible
fields the way good plans do — every reviewer adds one ornament.
v6 audits each field against "does Phase 1 actually need this?"
and cuts everything that doesn't earn its keep.

### Cut from the contract

| Field | Why it's safe to cut |
|---|---|
| `Plugin.order: number` | Array order does the work. Defaults prepended → register first; host plugins after; late-wins-on-id for collisions. No numeric ordering footgun for plugin authors. |
| `Plugin.dependsOn` | Phase 1 has exactly one declared dep (macro→filesystem). Add when the dep graph stops being trivial. The "fail at boot if missing" gate is replaced by either runtime degradation (dev notices in 30s) or an `if (!ctx.catalogs.find(...))` line in `onMount` — and we're cutting onMount too. |
| `Plugin.optionalDeps` | Soft deps that warn if missing → just a `console.warn` with extra contract surface. Plugins null-check the registry. |
| `Plugin.version` | Used by nothing in Phase 1. |
| `Plugin.routes: RouteRegistration[]` | Routes are HTTP infrastructure, not registry contributions. Mixing them blurs identity AND lies about lifecycle (Fastify can't unregister). Hosts wire routes via standard `app.register(...)` — one line per plugin that has routes. |
| `Plugin.chatSuggestions` | Empty-state UX caps at ~6 cards → aggregation is impossible; hosts have to curate. If hosts curate, the registry adds nothing. Stays as a `<ChatCenteredShell>` prop. |
| `Plugin.onMount` + `Cleanup` types | Zero Phase 1 plugins use it. Event subscriptions are better handled via `useEvent` in panels or `events.on()` in routes. macro's clickhouse client is constructed by the host before the plugin is built (factory pattern). |
| `RouteRegistration<TOpts>` type | Gone with `routes`. |
| `PluginMountCtx` type | Gone with `onMount`. |
| `WorkspaceSurface` interface | Gone with `PluginMountCtx`. Plugin-level imperative actions weren't needed; declarative contributions handle everything. |
| `MaybePromise` / `Cleanup` types | Gone with `onMount`. |
| `tabOrder?: number` | Registration order works. |
| `paletteIcon`, `paletteLimit`, `renderRecentRow` | Reasonable defaults. Add when a plugin overrides. |
| 5 error subclasses (`PluginValidationError`, `PluginRegistrationError`, `PluginMountError`, `PluginContributionError`, `id collision`) | One `PluginError { kind: '...' }`. |
| `<PluginInspector />` | `console.log(registries)` works fine for Phase 1. |
| Pre-declared lifecycle events on the bus (`plugin:registered` etc.) | "Events declared on demand" policy. No emitter or consumer in Phase 1; don't declare. |

### Sections compressed

- **Order semantics** — entire ~40-line section gone.
- **Boot sequence** — collapses from a numbered async two-pass
  protocol with topo sort to a 6-line single-pass loop.
- **Plugin composability — dependencies + file-pattern resolution**
  → renamed §"File-pattern resolution + late-wins" (the
  dependency half disappears).
- **Security stance** — collapsed to a one-line non-goal.
- **Dev tools** — collapsed to a one-line note about dev-mode
  warnings.
- **Factory pattern** — was a section; now a paragraph.

### Sections added

- **Why no chatSuggestions on the contract** — explicit
  aggregation-honest test.
- **Where do routes go?** — substrate vs agent core vs plugin-specific.
- **Distribution — Phase 2 sketch** — npm sub-path exports pattern;
  same shape as Express/Fastify/Vite.
- **Relationship to pi-mono ecosystem** — what we adopt verbatim,
  what we add on top.

### Net impact

- Spec line count: ~50% smaller than v5.2.
- Implementation surface: ~40% smaller (no lifecycle, no
  RouteRegistration, no WorkspaceSurface, simpler bootstrap).
- Same boring-macro acceptance test.
- Same `excludeDefaults` honesty.
- Same path-aware resolver.
- Same polymorphic Recent.
- Same file-ops shared bundle.
- Same validateTool extraction (P0 fix preserved).
- Same events subpath export (P1 fix preserved).
- Same SurfaceShell EmptyFilePanel fallback (P1 fix preserved).

### What we add back when (not if)

| Field | Add when |
|---|---|
| `dependsOn` | Phase 2: npm plugins from different authors → real dep graph emerges. |
| `onMount` | First plugin that needs imperative setup not solved by panel-level `useEvent` or factory closure. |
| `Plugin.version` + semver in deps | Phase 2 npm distribution. |
| Ordering field | If/when registration order proves insufficient (no current evidence). |
| `Plugin.routes` | If a Phase 3 hot-reload story makes route-as-plugin-data viable. |
| `chatSuggestions` field | If an empty-state-aggregation use case appears that the host can't solve by curating. |
| `<PluginInspector />` | When devs ask for it. |
