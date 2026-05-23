# Unified plugin system — one shape, one install, hot reload as a flag

Status: proposal, follow-up to PR #18 reload-pluggability work.
Scope: collapse today's two plugin shapes (static `defineXxxPlugin` factories
vs `package.json#boring`-driven hot plugins) into a single shape with a
single install pipeline. Hot reload becomes a per-entry opt-in flag, not a
fork of the manifest.

## Current state (May 2026)

### Plugin authoring — already unified

`packages/cli/templates/plugin/` codifies one shape, locked in by PR #40
(`refactor/plugin-template`) and the `/boring-plugin-build` skill:

```
plugins/<name>/
  package.json                    private workspace package
  src/front/index.tsx             exports createXxxPlugin(): WorkspaceFrontPlugin
  src/server/index.ts             exports createXxxServerPlugin(opts): WorkspaceServerPlugin
  src/shared/                     constants, types
```

The three real plugins are aligned to this shape:

| Plugin | Front | Server | Notes |
|---|---|---|---|
| `plugins/ask-user/` | `defineFrontPlugin` with panel + provider + surface-resolver + command | `defineServerPlugin` with `agentTools`, `routes`, `systemPrompt`, `preservedUiStateKeys` | Owns `AskUserRuntime` singleton; bridge subscriber |
| `plugins/data-catalog/` | `defineFrontPlugin` with panel + catalog + left-tab + surface-resolver | `defineServerPlugin` with `agentTools`, `systemPrompt` | Adapter passed by caller |
| `plugins/data-explorer/` | UI library only | — | Not a plugin; consumed as a normal dep |

### Plugin installation — still two paths

Despite one authoring shape, the **install** path is double-tracked:

| | Static install (today's default) | Hot install (`.pi/extensions/*`) |
|---|---|---|
| Where plugin lives | Anywhere; imported by app at build time | Plugin dir scanned at runtime |
| Workspace API | `plugins: [...]` / `pluginFactories: [...]` | `BoringPluginAssetManager` discovers from disk |
| Author-facing manifest | `defineFrontPlugin` + `defineServerPlugin` | `package.json#boring` + `#pi` |
| Re-evaluation on `/reload` | ❌ never | ✅ scan + jiti |
| Front delivery | Bundled by app's Vite | `frontUrl: /@fs/<absolute-path>` via SSE |
| Server delivery | Routes mounted at boot | Namespaced dispatcher; jiti-loaded |
| Agent tools | Captured in `tools[]` at session creation | Pi extensions via jiti |
| systemPrompt | Concatenated into `systemPromptAppend` at boot | Refreshed via `systemPromptDynamic` getter |
| Provider/binding | React tree at mount | Not expressible |

This is the smell the design notice is calling out: same author shape, two
runtimes. The hot path even has its own JSON-shaped manifest fields
(`package.json#boring.front`, `boring.server`, `pi.extensions`) that
duplicate what `defineFrontPlugin`/`defineServerPlugin` already say.

## Target

**One plugin shape. One install pipeline. Hot reload is a per-entry flag.**

```
createWorkspaceAgentServer({
  plugins: [
    askUserPlugin,                                            // module-source, static
    { spec: { module: dataCatalogPlugin }, options: { adapter } }, // module-source with options
    { spec: { dir: "plugins/my-plugin" }, hotReload: true },  // directory-source, hot
  ],
})
```

The author writes one shape. The host wires one array. Whether a plugin
hot-reloads depends only on the install entry, not the plugin's structure.

### Why this is achievable now

PR #18 + the reload-pluggability work I just landed:

- Pi consumes plugin contributions via two clean seams (`systemPromptDynamic`,
  `getDynamicResources`). No workspace-injected Pi extensions.
- Workspace owns server-route hot-swap via a dispatcher map (already works).
- Front hot-swap already works via SSE + Vite `/@fs/` URLs.

What's missing is a single install pipeline that produces
`WorkspaceFrontPlugin` + `WorkspaceServerPlugin` from *either* source, and
applies the result identically.

## Architecture

### Single install pipeline

```
PluginEntry → RESOLVE → WorkspaceFrontPlugin + WorkspaceServerPlugin
                                       │
                                       ▼
                     INSTALL into the shared registries
                     (PanelRegistry, CommandRegistry, ...,
                      bootstrapServer, Fastify dispatcher)
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                 │
       hotReload: false                                  hotReload: true
       └─ done                                  ┌── subscribe to dir watcher
                                                ├── on /reload:
                                                │     SERVER: teardown + RE-RESOLVE + rebuild
                                                │             (Pi parity: rebuild over diff)
                                                │     FRONT:  surgical swap for diff-safe outputs
                                                │             (can't rebuild a live React tree)
                                                └── emit diagnostics for what can't apply
```

Resolution rules:

| Entry type | How it resolves |
|---|---|
| `WorkspaceFrontPlugin` / `WorkspaceServerPlugin` object | Use directly. |
| `{ spec: { module: M }, options? }` | `M(options)` — call the factory the plugin's package already exports. |
| `{ spec: { dir }, options?, hotReload? }` | Read `<dir>/package.json`, locate front+server entries (convention: `dist/front/index.js` for built packages, `src/front/index.tsx` via jiti for dev), import via jiti when `hotReload`, regular import otherwise. Call factory with `options`. |

The author writes the **same** factory shape regardless. The resolver picks
the import strategy.

### Reload semantics — rebuild on server, swap on front

Two asymmetric strategies, each chosen because of what the underlying
runtime can support:

**Server: rebuild over diff (Pi parity).**
Pi's `AgentSession.reload()`
(`node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:1896`)
tears the runtime down (`session_shutdown`), re-imports extension modules
via `jiti` (`moduleCache: false`), rebuilds the runtime registry from
scratch, then fires `session_start` with `reason: "reload"`. Active tool
names and flag values are snapshotted before teardown and replayed after
rebuild. No diff, no transactional rollback.

We mirror this on our server side:

```
on /reload:
  snapshot { activeToolNames, activeSessionId, openSurfaces, ... }
  for each plugin (rebuild order = registration order):
    emit "plugin_shutdown" to give the plugin a chance to cleanup
  re-resolve all hotReload: true entries via jiti
  re-run bootstrapServer with the fresh plugin objects
  rebuild handler maps (route dispatcher, systemPromptDynamic source set)
  fire "plugin_start" with reason: "reload"
  emit diagnostics for any plugin that failed to resolve/load
  restore snapshot
```

Why rebuild instead of diff:
- Pi has lived with this design in production; diff-based reload is *not*
  what mature jiti-based reload systems use.
- No half-applied state risk — either the rebuild completes (registry now
  reflects fresh modules) or it doesn't (previous registry stays in place,
  errors surface as diagnostics).
- No "stable ID" contract to enforce on plugin authors. Same names across
  reloads = same registry entries; new names = new entries; removed names
  drop. The registry **is** the diff.
- Pi-style conflict detection runs after rebuild
  (`resource-loader.js:281` `detectExtensionConflicts`): duplicate
  tool/command/flag names from different extensions are surfaced as
  diagnostics; load-order decides precedence. Reload keeps going.

**Front: surgical swap (React parity).**
Server can rebuild because the agent runtime is stateless between turns.
Front can't — a React tree carries user state (open panel, scroll
position, form input, selection) that the user expects to survive a
hot-swap. So front reload is per-output-type:

| Output | Swap strategy | What if rebuild changes it |
|---|---|---|
| `panel` | swap component in `PanelRegistry` keyed by id | mounted panes re-render with new component; React handles |
| `command` | swap handler in `CommandRegistry` keyed by id | next invocation uses new handler |
| `catalog` | swap adapter keyed by id | open catalog views re-query |
| `left-tab` | swap component keyed by id | tab re-renders |
| `surface-resolver` | replace fn keyed by id | next resolve uses new fn |
| `binding` | swap component keyed by id | React unmount/mount |
| `provider` | structural | **cannot safely swap** — emit `boring.plugin.needs-page-reload`; UI offers a reload toast |

The front registries already index by id; this is "rebuild the map, emit a
change event so subscribers re-read." It's *not* a per-entry diff with
add/move/remove semantics — it's a wholesale Map replacement, structurally
the same as Pi's server rebuild, just preserving the React tree above it.

**Other surfaces** that don't fit either model:

| Surface | Behavior on reload |
|---|---|
| `agentTools` registered via `pi.extensions` | Pi's reload handles natively — fresh module via jiti, fresh `registerTool` calls, fresh registry. Tool body changes land in next agent turn. |
| `agentTools` registered via `WorkspaceServerPlugin.agentTools` (static) | Captured in `tools[]` at session creation; Pi has no public API to swap mid-session. Emit `boring.plugin.needs-session-restart`. Authors who want full hot coverage move tools to `pi.extensions` (Phase 7). |
| `systemPrompt` | Already covered by `systemPromptDynamic` getter (re-aggregates each `before_agent_start`). |
| `piPackages` / `extensionPaths` / `additionalSkillPaths` | Already covered by `getDynamicResources` (Pi re-reads on each `reloadSession`). |
| `routes` (namespaced under `/api/boring-plugins/<id>/*`) | Dispatcher map entry rewritten; Fastify routes untouched. Already works. |
| `routes` (free-form, registered via `pluginFactories`) | Fastify can't safely re-register. Emit `boring.plugin.needs-server-restart`. |
| `preservedUiStateKeys` | Recompute the merged set; the existing UI-state route already consults it on every PUT. |

The shell never lies: if a change can't apply, it surfaces an honest event
with what's needed (page reload, session restart, server restart). Errors
during rebuild are *diagnostics* — they don't block the reload, they show
up alongside the partially-completed result, same as Pi.

### What plugin authors learn

Nothing new. The same shape that already works for static install.
**Hot reload becomes free for plugins that contribute only diff-safe output
types.** Plugins that contribute providers or free-form routes get partial
hot reload (everything else swaps; provider changes prompt page reload).

## Per-plugin migration analysis

The unification has three migration levels, each plugin chooses how far to go:

| Level | What changes in the plugin | What you get |
|---|---|---|
| **L0 — install-call-site only** | Zero plugin-code change. Host updates `dev.ts` to use the unified `plugins:` array. | Same behaviour as today. Validates the plugin still installs through the new pipeline. |
| **L1 — declare manifest entries** | Add `package.json#boring.front`/`boring.server`. Optionally `pi.systemPrompt`. No source-code changes. | Plugin becomes installable as `{ spec: { dir }, hotReload: true }`. Front + server modules participate in directory-source hot reload. Limited by which output types are diff-safe (provider edits still require page reload; static `agentTools` still require session restart). |
| **L2 — full hot-reload coverage** | Move `agentTools` body into `agent/index.ts` Pi extension; bridge-proxy to long-lived workspace state. Move free-form routes under namespaced `/api/boring-plugins/<id>/*`. | All output types swap on `/reload`. Edits to the tool body, prompt, panel, command, resolver, etc. land in the next agent turn or the next request without restart. Cost: bridge protocol per plugin, breaking URL changes for routes. |

Each plugin can sit at a different level. L0 is the floor — every plugin
gets that automatically. L1 and L2 are opt-in per-plugin upgrades the
plugin author chooses.

### Concrete adaptation by plugin (current main)

Each subsection lists the specific files that change and the LoC ballpark.

#### `plugins/ask-user/` (`@hachej/boring-ask-user`)

Today's contributions (read from
`plugins/ask-user/src/server/askUserServerPlugin.ts` +
`plugins/ask-user/src/front/index.tsx`):

| Output | Diff-safe? |
|---|---|
| Provider (`AskUserProvider` React context) | ❌ page reload to change |
| Panel (`ASK_USER_PANEL_ID`) | ✅ swappable |
| Surface resolver | ✅ swappable |
| Command (`open` event dispatcher) | ✅ swappable |
| `agentTools: [ask_user]` (closure captures `runtime`, `sessionId`, `bridge`) | ❌ session restart |
| `routes` (free-form `/api/questions/*`) | ❌ server restart |
| `preservedUiStateKeys: [ASK_USER_UI_STATE_SLOTS.PENDING]` | ✅ recomputable |

**L1 migration** (recommended next step):

```jsonc
// plugins/ask-user/package.json — add
{
  "boring": {
    "front":  "src/front/index.tsx",
    "server": "src/server/askUserServerPlugin.ts"
  }
}
```

No source changes. Plugin installs as `{ spec: { dir }, hotReload: true }`.
Effective coverage ~60% (panel/resolver/command swap; provider/tool/routes
require restart). **Cost: ~5 lines in `package.json`.**

**L2 migration** (when full hot reload is wanted):

1. New file `plugins/ask-user/src/agent/index.ts` (~30 LoC) — Pi extension
   factory that registers `ask_user` via `pi.registerTool`. Handler
   bridge-proxies to `AskUserRuntime`.

   ```ts
   import { z } from "zod"
   export default function (pi) {
     pi.registerTool("ask_user", {
       description: "Ask the user a blocking question.",
       inputSchema: z.object({ /* same schema */ }),
       handler: async (args, ctx) => ctx.bridge.request("askUser:ask", args),
     })
   }
   ```

2. Remove `agentTools: [ask_user]` from `askUserServerPlugin.ts`. Add
   bridge subscriber: `bridge.handle("askUser:ask", (args) => runtime.ask(args))`.
3. Add `pi.extensions: ["src/agent/index.ts"]` and
   `pi.systemPrompt: "When you need a blocking decision..."` to
   `package.json`.
4. Migrate `/api/questions/*` URLs to `/api/boring-plugins/ask-user/*`.
   **Breaking change** — front client (`createQuestionsClient`) and any
   external consumer must update.
5. `AskUserRuntime`, `AskUserStore`, `AskUserStatePublisher` stay in
   `server/index.ts` — long-lived state survives reload.

**Cost: ~150 LoC across 4 files.** Effective coverage ~95% after.

#### `plugins/data-catalog/` (`@hachej/boring-data-catalog`)

Today's contributions (`plugins/data-catalog/src/server/index.ts` +
`plugins/data-catalog/src/front/index.tsx`):

| Output | Diff-safe? |
|---|---|
| Panel + catalog + left-tab + surface resolver | ✅ all swappable |
| `agentTools: [data_catalog]` (closure captures caller-supplied `adapter`) | ❌ session restart |
| `systemPrompt` | ✅ via `systemPromptDynamic` |
| No routes, no provider | n/a |

**L1 migration** (3 lines in `package.json`):

```jsonc
{
  "boring": {
    "front":  "src/front/index.tsx",
    "server": "src/server/index.ts"
  }
}
```

Effective coverage ~80%. Only the tool body needs session restart.

**L2 migration** is light because there are no routes or providers:

1. New `plugins/data-catalog/src/agent/index.ts` (~25 LoC) — registers
   `data_catalog` Pi tool that bridge-proxies to the adapter.
2. Remove `agentTools` from `defineServerPlugin` call. Server side keeps
   the adapter and registers a bridge handler.
3. Caller passes adapter via the unified install entry's `options` field:
   `{ spec: { module: dataCatalogServerPlugin }, options: { adapter } }`
   instead of `createDataCatalogServerPlugin({ adapter })`.

**Cost: ~80 LoC across 2 files.** Effective coverage 100% after.

#### `plugins/data-explorer/` (`@hachej/boring-data-explorer`)

Per its `package.json#exports` (no `./server` export), this is a UI
component library, not a plugin. **No migration needed.** It stays a
regular dep that `data-catalog` and the workspace shell consume.

#### `apps/workspace-playground/src/plugins/playgroundDataCatalog/`

Playground-internal plugin (`createPlaygroundDataServerPlugin`), wired
statically into `dev.ts`. Contributes seed data + a server tool. **L0
only** — there is no scenario for hot-reloading it because the playground
is the host. The unified install array in Phase 2 already covers it.

### Migration order recommendation

1. **`data-catalog` first.** Lighter (no routes, no provider, no URL break).
   Smallest blast radius. Validates L1 + L2 paths end-to-end.
2. **`ask-user` second.** Heavier (routes namespace migration is breaking;
   provider stays L1-bounded). Migrate L1 immediately, L2 only if the
   `/api/questions/*` URL break is acceptable.
3. **playground / future first-party plugins**: stay at L0 unless someone
   needs to hot-edit them during dev.

### What changes in the plugin-authoring skill

The `/boring-plugin-build` skill needs three additions:

1. New "**Installing your plugin in a host app**" section showing the
   unified `plugins: [...]` shape with the four entry variants
   (object / factory / `{ spec: { module } }` / `{ spec: { dir } }`).
2. New "**Hot-reload coverage matrix**" section explaining what each
   output type does on `/reload` (the L1 vs L2 table above).
3. Update the "**Server side**" section to mention the optional Pi
   extension path (`src/agent/index.ts` + `pi.extensions` manifest field)
   for tools that want full hot reload.

The template (`packages/cli/templates/plugin/`) stays as-is for L0/L1; an optional
`agent/index.ts` example can be added later when L2 migration of any
shipped plugin proves the pattern.

## Implementation phasing

Each phase is independently shippable. Stop after Phase 2 and you already
have a unified system with most of the value.

### Phase 0 — Single install entry type (no behavior change)

Replace `plugins: WorkspaceServerPlugin[]` + `pluginFactories:
WorkspaceAgentServerPluginFactory[]` with one array that accepts both
shapes. Same for front. Pure type widening; existing callers still work.

```ts
// packages/workspace/src/app/server/createWorkspaceAgentServer.ts
type PluginEntry =
  | WorkspaceServerPlugin
  | ((ctx: WorkspaceServerPluginContext) => WorkspaceServerPlugin)
  | { spec: PluginSpec; options?: unknown; hotReload?: boolean }
```

`pluginFactories` becomes a soft-deprecated alias.

**Cost:** ~50 lines. Pure refactor. Zero risk.

### Phase 1 — Resolver: `{ spec: { module } }` and `{ spec: { dir } }`

Add a resolver that turns a `PluginEntry` into a `WorkspaceServerPlugin` +
`WorkspaceFrontPlugin` pair.

```ts
interface PluginSpec {
  module?: () => Promise<unknown> | unknown   // imported package or factory
  dir?: string                                // workspace dir on disk
}
```

For `module`: call the factory with `options` if it's a function, otherwise
treat as pre-built.

For `dir`: use **manifest-first, convention-fallback** resolution, mirroring
Pi's mechanism (`@mariozechner/pi-coding-agent` → `core/package-manager.js:
resolveExtensionEntries`):

```ts
function resolvePluginEntries(dir: string, hotReload: boolean) {
  const pkg = readPackageJson(dir)
  return {
    front:  resolveOne(dir, pkg?.boring?.front,
                       ["src/front/index.tsx", "src/front/index.ts",
                        "dist/front/index.js"],
                       hotReload),
    server: resolveOne(dir, pkg?.boring?.server,
                       ["src/server/index.ts",
                        "dist/server/index.js"],
                       hotReload),
    manifest: pkg.boring,
  }
}

function resolveOne(dir, explicit, conventions, hotReload) {
  // 1. Explicit field wins (Pi parity: manifest is the contract)
  if (explicit) {
    const path = resolve(dir, explicit)
    if (existsSync(path)) return path
    throw new Error(`boring.* entry declared but missing: ${path}`)
    // Pi parity: declared-but-missing fails loudly. No silent fallback.
  }
  // 2. Conventions only when no explicit declaration
  for (const candidate of conventions) {
    const path = resolve(dir, candidate)
    if (existsSync(path)) return path
  }
  return null
}
```

Two safety properties carried over from Pi:

1. **Explicit-but-missing fails loudly.** Declaring `boring.front: "x"` and
   not shipping that file is an error, not a silent convention fallback.
2. **Conventions only kick in when no explicit declaration is present.**
   Plugin authors who follow the template get free discovery; authors who
   need a non-standard layout declare it.

For `hotReload: true`, the resolver prefers `src/*` entries via `jiti` so
edits take effect; for `hotReload: false`, it prefers `dist/*` entries via
regular `import()` so production behavior matches bundled output.

**Cost:** ~180 lines. Reuses existing `BoringPluginAssetManager` jiti import.

### Phase 2 — Migrate playground to the unified API

`apps/workspace-playground/src/server/dev.ts`:

```ts
import { askUserPlugin } from "@hachej/boring-ask-user/front"
import { dataCatalogPlugin } from "@hachej/boring-data-catalog/front"
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"
import { createDataCatalogServerPlugin } from "@hachej/boring-data-catalog/server"

await createWorkspaceAgentServer({
  workspaceRoot,
  plugins: [
    (ctx) => createAskUserServerPlugin({ workspaceRoot, bridge: ctx.bridge }),
    (ctx) => createDataCatalogServerPlugin({ adapter: myAdapter }),
    (ctx) => createPlaygroundDataServerPlugin({ workspaceRoot }),
  ],
})
```

Drops the `pluginFactories` knob. Single array. Same plugin code.

**Cost:** ~20 lines in `dev.ts`. Removes a workspace API surface.

### Phase 3 — Front-side registry rebuild + plugin lifecycle events

The front side keeps the registry maps that the React shell consumes. We
rebuild those maps wholesale on reload, then emit a change event so
subscribers re-read. The React tree above the registries stays mounted.

Add `plugin_shutdown` and `plugin_start` events on the front plugin
lifecycle (Pi parity — `extensions/runner.js:48` and `agent-session.js:1912`
fire `session_shutdown` and `session_start { reason: "reload" }`). Plugins
can opt into either by registering a handler; the rebuild gates on
`hasHandlers()` before emitting, same as Pi.

```ts
// front rebuild flow on /reload
for (const plugin of mountedPlugins) {
  if (plugin.hasHandlers("plugin_shutdown")) {
    await plugin.emit({ type: "plugin_shutdown", reason: "reload" })
  }
}
const fresh = await resolveAllFront(entries)
const conflicts = detectFrontConflicts(fresh)
for (const conflict of conflicts) {
  diagnostics.push({ path: conflict.path, error: conflict.message })
}
panelRegistry.replaceAll(collectPanels(fresh))
commandRegistry.replaceAll(collectCommands(fresh))
catalogRegistry.replaceAll(collectCatalogs(fresh))
surfaceResolverRegistry.replaceAll(collectSurfaceResolvers(fresh))
leftTabRegistry.replaceAll(collectLeftTabs(fresh))
bindingRegistry.replaceAll(collectBindings(fresh))
if (providersChanged(prev, fresh)) {
  emitEvent("boring.plugin.needs-page-reload", { diagnostics })
} else {
  for (const plugin of fresh) {
    if (plugin.hasHandlers("plugin_start")) {
      await plugin.emit({ type: "plugin_start", reason: "reload" })
    }
  }
}
```

`replaceAll` is what makes this "rebuild over diff": the registry computes
its own structural change set internally (which subscribers updated, which
panel ids vanished) and fires one change event. Subscribers re-render.
There is no per-entry add/remove API the caller has to maintain.

**Cost:** ~250 lines. Touches the registry classes + adds the front
plugin lifecycle.

### Phase 4 — Server-side rebuild

Pi's `AgentSession.reload()` is our reference. Implement
`rebuildServerPlugins()` that mirrors Pi's flow:

```ts
async function rebuildServerPlugins() {
  const snapshot = {
    activeSessionId,
    activeToolNames: harness.getActiveToolNames?.(),
    uiState: bridge.snapshotState(),       // pre-shutdown, like Pi's previousFlagValues
  }

  // 1. Teardown
  for (const plugin of currentPlugins) {
    if (plugin.hasHandlers("plugin_shutdown")) {
      await plugin.emit({ type: "plugin_shutdown", reason: "reload" })
    }
  }

  // 2. Reset registries to a clean state (Pi: resetApiProviders())
  routeDispatcher.clear()
  systemPromptSources.clear()
  preservedUiStateKeys.clear()

  // 3. Re-resolve hot entries via jiti, regular import for static ones
  const fresh = await resolveAll(entries)

  // 4. Re-run bootstrapServer with the fresh plugin list
  const bootResult = bootstrapServer({ plugins: fresh, defaults, excludeDefaults })

  // 5. Conflict detection (Pi: detectExtensionConflicts at resource-loader.js:690)
  const conflicts = detectServerConflicts(fresh)
  for (const conflict of conflicts) {
    diagnostics.push(conflict)
  }

  // 6. Wire bootResult into the runtime
  for (const route of bootResult.routeContributions) {
    routeDispatcher.set(route.id, route.routes)
  }
  systemPromptSources.replaceAll(bootResult.systemPromptAppend)
  preservedUiStateKeys.replaceAll(bootResult.preservedUiStateKeys)

  // 7. Pi-side resources via existing seam (no change required)
  //    getDynamicResources() already returns fresh piPackages/extensionPaths/skills

  // 8. Restore snapshot
  if (snapshot.activeToolNames) harness.setActiveToolNames?.(snapshot.activeToolNames)
  bridge.restoreState(snapshot.uiState)

  // 9. Fire plugin_start with reason: "reload" (Pi parity)
  for (const plugin of fresh) {
    if (plugin.hasHandlers("plugin_start")) {
      await plugin.emit({ type: "plugin_start", reason: "reload" })
    }
  }

  return { ok: diagnostics.length === 0, diagnostics, plugins: fresh.map(p => p.id) }
}
```

Diagnostics carry the failed entries' paths/ids and reasons, surfaced via
the existing reload SSE channel. Failed plugin load doesn't block the
others (Pi parity — `loaders/extensions/loader.js:288` records error and
continues).

The harness layer still consumes `systemPromptDynamic` and
`getDynamicResources` as added in PR #18 — no change there; those getters
just see fresh state after rebuild.

**Cost:** ~200 lines. Half is the lifecycle event plumbing.

### Phase 5 — Wire directory-source plugins to `/reload`

For each `{ spec: { dir }, hotReload: true }` entry, the asset manager
watches the dir, re-resolves on `/reload`, hands the new plugin object to
the diff applier.

This collapses `BoringPluginAssetManager`'s plugin-specific knowledge into a
generic "watch dir, jiti-import, hand to install pipeline" loop. No more
`BoringServerPluginManifest` JSON shape.

**Cost:** ~100 lines + cleanup of ~150 lines from `manager.ts`.

### Phase 6 — Solidify the manifest as the primary contract

Keep `package.json#boring.front`/`boring.server` as the canonical
directory-source contract (Pi parity — see Phase 1 resolver). Document the
manifest-first + convention-fallback rule in
`@hachej/boring-pi/skills/boring-plugin-authoring/SKILL.md` and the
`/boring-plugin-build` skill. Plugins that follow the template skip the
fields; plugins with non-standard layouts declare them.

Also remove the redundant `package.json#boring`-driven hot-discovery code
inside `BoringPluginAssetManager` once Phase 5 funnels everything through
the unified resolver — there is one read site for `boring.*`, not two.

**Cost:** cleanup + ~1 page of doc rewrites.

### Optional Phase 7 — Per-plugin hot-reload upgrade

For each plugin that wants 100% hot coverage:
- Move statically-registered `agentTools` to `pi.extensions` + bridge proxy.
- Move free-form routes to the `/api/boring-plugins/<id>/*` namespace.

These are *plugin-author opt-ins*, not workspace requirements.

## What this does NOT change

- The plugin template stays as-is.
- `defineFrontPlugin` and `defineServerPlugin` remain the authoring
  primitives.
- The `/boring-plugin-build` skill stays mostly accurate; only the
  installation section needs updating to describe the new entry shape.
- Existing plugin tests don't move.
- Production bundling is unaffected (module-source plugins still bundle
  through Vite/tsup the same way).

## What this DOES change in plugin authoring docs

A new section: "Installing your plugin in a host app":

```ts
// Static install (production default):
plugins: [
  (ctx) => createMyPlugin({ adapter: ctx.workspaceRoot }),
]

// Hot install (dev iteration):
plugins: [
  { spec: { dir: "plugins/my-plugin" }, hotReload: true },
]
```

That's the only change plugin authors see.

## Alignment with Pi — borrowed mechanisms (with code refs)

Every reload-related design decision in this plan is grounded in something
Pi already does and has shipped. Code refs are relative to
`node_modules/@mariozechner/pi-coding-agent/dist/`.

| Mechanism | Pi reference | Where we use it |
|---|---|---|
| **Manifest-first, convention-fallback resolution** for directory plugins | `core/package-manager.js:333` `resolveExtensionEntries` — reads `package.json#pi.extensions` first; falls back to `index.ts` → `index.js` | Phase 1 resolver for `package.json#boring.front`/`boring.server` |
| **Declared-but-missing fails loudly**, no silent fallback | `core/package-manager.js:339-347` filters `existsSync` only after explicit manifest field is set | Phase 1 `resolveOne` throws if explicit and missing |
| **Rebuild over diff** on reload | `core/agent-session.js:1896` `reload()` — emits `session_shutdown`, wipes resource loader state, re-imports, rebuilds registry from scratch | Phase 4 `rebuildServerPlugins`; Phase 3 `replaceAll` on registries |
| **Lifecycle events** `plugin_shutdown` / `plugin_start { reason: "reload" }` | `core/extensions/runner.js:48` `emitSessionShutdownEvent`; `core/agent-session.js:1912` `session_start { reason: "reload" }` | Phase 3 + 4 emit these around the rebuild; plugins can register handlers for cleanup/replay |
| **`hasHandlers` gate** before emitting events | `core/extensions/runner.js:48` `extensionRunner?.hasHandlers("session_shutdown")` | Plugin lifecycle event emission only fires when at least one plugin listens |
| **Conflict detection as diagnostics, not failures** | `core/resource-loader.js:281` calls `detectExtensionConflicts`, appends to `extensionsResult.errors[]`, keeps all extensions loaded with load-order precedence | Phase 4 `detectServerConflicts` returns conflicts as diagnostics; rebuild continues |
| **Conflict algorithm**: `Map<name, ownerPath>` walk across registries | `core/resource-loader.js:690` `detectExtensionConflicts` — tracks `toolOwners` and `flagOwners`; first owner wins | Same algorithm against our `panel`/`command`/`catalog`/`surfaceResolver`/`leftTab` id maps |
| **Continue on individual load failure** | `core/extensions/loader.js:288` `loadExtensions` — failed extension recorded as `{ path, error }` in `errors[]`, loop continues with remaining paths | Phase 4 resolver records failures into diagnostics; other plugins still rebuild |
| **Snapshot user-set state before teardown, replay after rebuild** | `core/agent-session.js:1897` `previousFlagValues = this._extensionRunner?.getFlagValues()`, replayed at `_buildRuntime({ flagValues: previousFlagValues, ... })` | Phase 4 snapshots `activeSessionId`, `activeToolNames`, `bridge.snapshotState()`; replays after rebuild |
| **`reset*` before rebuild** to clear stale state | `core/agent-session.js:1900` `resetApiProviders()` between settings reload and resource loader reload | Phase 4 explicitly clears `routeDispatcher`, `systemPromptSources`, `preservedUiStateKeys` before re-running `bootstrapServer` |
| **Per-resource diagnostic arrays**, queried by consumers separately | `core/resource-loader.js:167-173` `skillDiagnostics`, `promptDiagnostics`, `themeDiagnostics` — surface via SDK getters, not thrown | Reload response carries `{ diagnostics: [{ pluginId, source, error }, ...] }` — same shape, surfaced via SSE |
| **Source metadata for diagnostics** (where did this resource come from?) | `core/resource-loader.js:218` `metadataByPath` correlates each resource path to `{ source, scope, origin }` for diagnostic provenance | Resolver tags each plugin entry with `{ source: "module" \| "directory", path }` so diagnostics point at the offender |
| **Stable load-order precedence** when multiple sources contribute | `core/resource-loader.js` various `mergePaths` calls preserving order: cli → auto → explicit | Plugin entries register in array order; first wins on id collision (matches Pi behaviour) |
| **Path validation surfaces as diagnostic, not crash** | `core/resource-loader.js:287` `existsSync(p)` check pushes `Extension path does not exist` into errors | Phase 1 resolver: `dir` not found pushes diagnostic; doesn't throw |
| **`jiti` with `moduleCache: false`** for hot module replacement | `core/extensions/loader.js:224` `createJiti(import.meta.url, { moduleCache: false })` | Already in our `BoringPluginAssetManager`; Phase 1 resolver uses the same primitive |

What we **do not** borrow from Pi:

- **Auto-discovery from filesystem walk** of subdirs without explicit
  registration. Pi does this for skills (`SKILL.md`) and extensions in
  certain modes (`core/package-manager.js:362` `collectAutoExtensionEntries`).
  For our plugin system we keep registration explicit at the workspace
  level (the host's `plugins: [...]` array is the truth). `.pi/extensions/*`
  auto-discovery is preserved as a *thin layer* that injects
  `{ spec: { dir }, hotReload: true }` entries — same downstream code.
- **Transactional rollback on partial failure**. Pi doesn't do it; neither
  do we. Failed plugin → diagnostic; rebuild result keeps the rest.

## Risks & open questions

1. **jiti and React duplicate.** Hot install via jiti for a plugin that
   imports React must dedupe to the host shell's React, same constraint
   the existing hot-reload path already documents. No new infra; inherit
   the existing Vite alias rules. Pi sidesteps this because Pi extensions
   are server-only — front-side dedupe is *our* problem, not borrowable.

2. **Provider changes during hot install.** React doesn't support
   re-rooting providers around a live tree. `needs-page-reload` event +
   toast. Pi doesn't have a React tree to preserve, so this is a
   front-only constraint we add on top of Pi's rebuild model.

3. **Dev/prod fidelity (`jiti` vs Vite/tsup bundling)** — flagged by the
   Gemini review. Pi only faces this on the server (always `jiti`), so
   doesn't help us here. Mitigation: a CI invariant that boot-runs every
   plugin through *both* the directory resolver (`hotReload: true`) and
   the module resolver (`hotReload: false`), asserts the resulting
   `WorkspaceFrontPlugin`/`WorkspaceServerPlugin` shapes match. Catches
   drift before merge.

4. **Plugin options at install time.** The `options` field on
   `{ spec, options }` is `unknown` and depends on each plugin's factory
   shape. Type-safe via generics: `PluginEntry<TOptions>` parameterized on
   factory signature. Pi doesn't have an analogue (extensions are
   self-contained); we own this.

5. **What happens when a plugin DIR is added at runtime?** Auto-discovery
   stays as a thin layer that injects `{ spec: { dir }, hotReload: true }`
   entries before the install pipeline runs. Same downstream code as
   explicit registration. Pi parity: Pi has `collectAutoExtensionEntries`
   (`core/package-manager.js:362`) doing the same thing — auto-discovery
   sits in front of the explicit registration path, doesn't replace it.

6. **Breaking changes for external API consumers.** Free-form routes
   registered by `ask-user` (`/api/questions/*`) stay free-form unless the
   plugin author opts into namespacing. No breaking change forced by this
   plan.

7. **State the snapshot can't capture.** Pi snapshots `flagValues` and
   `activeToolNames`. We snapshot `activeSessionId`, `activeToolNames`,
   `bridge.snapshotState()`. Things we *can't* meaningfully snapshot:
   in-flight tool calls, streaming agent turns, half-completed user
   forms. Reload aborts in-flight work — same as Pi (`session_shutdown`
   triggers cleanup, agent turns crash if mid-stream). Document this; it's
   a feature, not a bug.

8. **Watcher debouncing at scale.** Flagged by xAI. Pi doesn't have a
   reload-on-watch model — Pi reloads on explicit user command. We
   already do too: `/reload` is user-triggered, not file-watcher-driven.
   The asset manager's existing signature-hash short-circuit handles
   "nothing changed" cases. If we later add a watcher mode, debounce per
   directory.

## Done criteria

Plan is "done" when:

- One install array. `pluginFactories` deleted.
- One resolver that handles both `{ spec: { module } }` and
  `{ spec: { dir } }` entries, with manifest-first + convention-fallback
  rules matching Pi.
- Server reload uses `rebuildServerPlugins` (rebuild over diff, Pi parity).
- Front reload uses registry `replaceAll` + plugin lifecycle events.
- Conflicts surface as diagnostics on reload, never block.
- The three first-party plugins (`ask-user`, `data-catalog`, an example
  in `.pi/extensions/`) all install through the same code path.
- `/reload` returns `{ ok, diagnostics, plugins: [...] }` and the shell
  routes diagnostics by source (server-side → chat surface, front-side
  → toast).
- Plugin-authoring skill teaches exactly one shape and one install
  pattern, citing the manifest-first + convention-fallback rule.
