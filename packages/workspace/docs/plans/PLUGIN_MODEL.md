# Workspace plugin model

**Status:** v7.0 — separation of concerns: file tools are harness substrate, filesystemPlugin is UI-only. Drops dual-registration. Substrate bundle accepts custom non-pi additions.

> **Factory note:** Default plugin wiring may be exposed as a factory when it
> needs runtime substrate, e.g. `makeFilesystemPlugin(deps)` can construct a
> `Plugin` after the host has a `RuntimeBundle`. The `Plugin` contract does
> not change: `agentTools` remains a plain `AgentTool[]`; the array is just
> constructed at plugin instantiation instead of at static module import time.
**Owners:** workspace
**Last updated:** 2026-04-28

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
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`
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
// packages/workspace/src/plugin/defaults/filesystemPlugin.ts
import { definePlugin, type Plugin } from "../definePlugin"
import { filesystemAgentTools } from "@boring/agent/shared"
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
  agentTools: filesystemAgentTools,
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
              ▼                              ▼
     STANDALONE PATH                WORKSPACE PATH
     ────────────────               ──────────────
     createAgentApp({})             createAgentApp({
       └─ standardCatalog              └─ disableDefaultFileTools:
            └─ ...includes                   true   ← skips bundle
               filesystemAgentTools     })
            (default ON; flip flag    └─ +filesystemPlugin.agentTools
            with disableDefaultFile-     (plugin path is canonical
            Tools to opt out)             for workspace hosts)

     standalone CLI agent           workspace host
     = real coding agent            = plugin model in charge;
                                      excludeDefaults:
                                      ['filesystem'] truly
                                      removes file tools
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
| `@boring/agent`: file ops (`find`, `grep`, `read`, `write`, `edit`) | **Stays in `@boring/agent`** as `src/server/tools/filesystem/index.ts` (extracted into a shared bundle) | Imported by both `createAgentApp` (default-on, opt-out via `disableDefaultFileTools`) AND `filesystemPlugin.agentTools` (workspace path) |
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

Six sequenced commits.

```
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
│  3a. filesystemPlugin (sole default)                             │
│      Constructed from runtime deps via                           │
│      `makeFilesystemPlugin(deps)`. Contributes: agentTools (via  │
│      createFilesystemAgentTools(deps)); Files catalog; FileTree  │
│      (placement: 'left-tab'); CodeEditor + MarkdownEditor (with  │
│      filePatterns).                                              │
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
| **Build-time enforcement of client/server split** | Documented invariant; not a custom lint rule. | If accidental cross-imports become common. |
| **Plugin versioning / compat** | `Plugin.version` field cut. No compat negotiation. | Phase 2 npm distribution. |
| **Layout migrations** | Renaming a panel id breaks cached dockview layouts. Same problem as today; not made worse by plugin model. | When layouts become stable enough to merit migration tooling. |
| **System-prompt augmentation from registered plugins** | LLM doesn't currently see "these plugins are loaded; here's what they do." | Phase 2 discovery endpoint + prompt injection. |
| **Permission / capability gating** | Inline plugins run with full host privileges. | Phase 3 sandbox / capability flags. |
| **Per-plugin telemetry** | No per-plugin error counter / call latency telemetry. | When debug volume justifies it. |
| **`<PluginInspector />`** | DEV-only debug overlay punted. `console.log(registries)` covers Phase 1. | When devs ask. |
| **Plugin discovery via `/api/v1/plugins`** | Phase 1 hosts know what they imported. | Phase 2 npm + agent-authored. |

None of these block the boring-macro acceptance test.

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
- Two default plugins: `filesystemPlugin`, `dataCatalogPlugin`.
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
