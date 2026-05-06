# Hot-Reloadable Agent Plugins Plan

Last updated: 2026-05-06
Status: **Phase 1 complete** — coordinator + manifest + authoring types + `@boring/workspace/plugin` subpath

## Goal

Let an agent write plugins to `.boring/plugins/<name>/` and have them load live into a running workspace without page refresh. The agent can contribute panels, commands, surface resolvers, context providers, and slot fills.

```
.boring/
  plugins/
    csv-viewer/
      boring.plugin.json     ← manifest (validated by manifest.ts)
      plugin.ts              ← factory (BoringPluginFactory)
    sql-runner/
      boring.plugin.json
      plugin.ts
```

## Architecture

```
boring.plugin.json
       │
       ▼
validateBoringPluginManifest()   ← manifest.ts
       │
       ▼
BoringPluginFactory              ← authoring.ts (BoringPluginAPI)
       │
       ▼
createCapturingAPI().flush()     ← authoring.ts
       │
       ▼
PluginCoordinator.load()         ← coordinator.ts
       │
       ├─ panels   → CoordinatorPanelRegistry.register()
       ├─ commands → CoordinatorCommandRegistry.registerCommand()
       └─ resolvers→ CoordinatorSurfaceResolverRegistry.register()
```

### Key invariants

- All new files are **browser-safe**: no `node:*` imports, no `fs`, no `path`.
- Registries are duck-typed interfaces — coordinator never imports concrete registry classes.
- Rollback: if any registry call throws during `load`, `unregisterByPluginId` is called before returning the error result.
- Atomic swap: reloading a plugin unloads the old version before applying the new one, so there is no window where both versions are active.
- Concurrent load safety: `PluginCoordinator` chains loads for the same plugin id via a per-id promise lock.

## The `BoringPluginAPI` Authoring Surface

Plugin factories receive a single `BoringPluginAPI` object with namespaced `register` methods:

```ts
// plugin.ts (authored by agent)
import type { BoringPluginFactory } from '@boring/workspace/plugin'

export const factory: BoringPluginFactory = (api) => {
  api.panels.register({
    id: 'csv-panel',
    label: 'CSV Viewer',
    component: () => import('./CsvPanel').then(m => ({ default: m.CsvPanel })),
  })

  api.commands.register({
    id: 'open-csv',
    label: 'Open CSV',
    handler: () => { /* ... */ },
  })

  api.surfaceResolvers.register({
    kind: 'file',
    resolve: (req) =>
      String(req.payload).endsWith('.csv')
        ? { component: 'csv-panel', params: { path: req.payload } }
        : null,
  })
}
```

Duplicate panel or command ids within a single factory call throw immediately so the agent gets a clear error.

## `@boring/workspace/plugin` Subpath

Exported from `packages/workspace/src/plugin.ts` and declared in `package.json` as `"./plugin"`. Consumer import:

```ts
import {
  PluginCoordinator,
  validateBoringPluginManifest,
  type BoringPluginAPI,
  type BoringPluginFactory,
} from '@boring/workspace/plugin'
```

Does **not** export `defineFrontPlugin`, `composePlugins`, or any internal workspace/front types.

## Phases

### Phase 1 (this PR) — coordinator + manifest + authoring + subpath

**Deliverables:**
- `src/shared/plugins/manifest.ts` — validate `boring.plugin.json`, export helper predicates
- `src/shared/plugins/authoring.ts` — `BoringPluginAPI`, `createCapturingAPI`, registration types
- `src/shared/plugins/coordinator.ts` — `PluginCoordinator` class (load, unload, reload, list, getRecord)
- `src/plugin.ts` — `@boring/workspace/plugin` subpath entry point
- `tsup.config.ts` — `plugin` build entry
- `package.json` — `"./plugin"` exports map
- `tsconfig.tsup.json` — includes `src/plugin.ts`
- Tests: `manifest.test.ts`, `hotReload.test.ts` (covers coordinator + capturing API)

### Phase 2 — file watcher + auto-discovery

- Watch `.boring/plugins/*/boring.plugin.json` for changes via a Vite plugin or a native `fs.watch` loop
- On change: re-read manifest, transpile/import `entry` via dynamic `import()` with cache-busting query param
- Wire into `PluginCoordinator.load()` — the coordinator handles atomic swap automatically
- Surface load errors as workspace notifications

### Phase 3 — server tool registration

- Extend `CoordinatorRegistries` with an optional `agentTools` registry
- Allow plugin factories to call `api.agentTools.register(tool)` for server-side agent tools
- Bridge to the Fastify plugin system so tools are available to the running agent session
