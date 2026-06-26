# 04 — Source provenance, reload coordinator, and health

## Goal

Prevent runtime plugin work from becoming reload/source/lifecycle spaghetti.

## Ownership table

| Component | Owns | Must not own |
| --- | --- | --- |
| `BoringPluginAssetManager` | scan, manifest validation, signatures, revisions, SSE scan events | executable route tables, install policy, health aggregation |
| Pi package source collector | Pi package source settings, scope, provenance, source ordering | route dispatch, Fastify handlers, boring-only registry files |
| Runtime backend registry | executable handler tables, atomic swap, dispose, backend health | manifest scanning, npm/git install |
| Reload coordinator | sequencing reload work and merging diagnostics | individual scan/import/dispatch internals |
| Health aggregator | front/Pi/backend/self-test summary | source install or route dispatch |
| CLI commands | install/list/remove/update UX | reload internals |

## First-class package source metadata

Do not pass bare path strings when trust/scope matters. The source of truth is Pi package source settings/roots; boring annotates resolved package roots with source metadata while scanning `package.json#boring`.

No `.pi/boring-plugin-sources.json` or duplicate boring-owned registry.

Use resolved source metadata like:

```ts
type BoringPluginSource = {
  root: string
  kind: "workspace-extension" | "global-extension" | "default-package" | "additional-dir" | "npm-package" | "git-package" | "local-path"
  scope: "workspace" | "global" | "app"
  workspaceId?: string
}
```

Runtime backend permission is derived from source kind/scope in one place, not stored as a drift-prone boolean on every record.

Rename planning concept:

```txt
collectBoringPluginDirs -> collectBoringPluginPackageSources
```

Scanner/load results must preserve source metadata:

```ts
type LoadedBoringPlugin = {
  id: string
  revision: number
  rootDir: string
  runtimeServerPath?: string
  source: BoringPluginSource
}
```

Runtime backend registry must receive a source-aware load decision from the collector/loader; it must not infer trust from paths.

## Source activation rules

MVP:

```txt
workspace/global external package sources can activate `boring.server`
app/default-package sources cannot, unless explicit later opt-in
```

Workspace-local source must match current workspace id in workspaces mode.

## Reload coordinator

Before adding backend reload, extract existing reload sequence unchanged.

New file:

```txt
packages/workspace/src/app/server/workspacePluginReload.ts
```

Two-step PR:

```txt
PR C0: extract current reload flow into workspacePluginReload.ts with no behavior change
PR C1: add runtimeBackendRegistry.reloadFromLoadedPlugins(...) to coordinator
```

Coordinator sequence:

```txt
assetManager.load()
  ↓
runtimeBackendRegistry.reloadFromLoadedPlugins(loaded)
  ↓
rebuildServerPlugins() diagnostic-only for boring.server
  ↓
runRuntimeProvisioning()
  ↓
opts.beforeReload()
  ↓
merge diagnostics/restart_warnings/backend health
```

Both reload entrypoints use same coordinator closure:

- chat/agent reload: `/api/v1/agent/reload` via `createAgentApp.beforeReload`;
- developer reload endpoint: `/api/boring.reload`.

Do not duplicate sequencing in both places.

## Caller hook behavior

`opts.beforeReload` runs after Boring-owned scan/backend/provisioning work.

It must be wrapped so a caller hook failure becomes diagnostics unless the caller explicitly wants to abort. Do not let one caller hook failure mask plugin diagnostics.

## Health namespaces

Avoid path conflict.

Plugin gateway owns:

```txt
/api/v1/plugins/:pluginId/*
```

Host management/health owns:

```txt
/api/v1/agent-plugins
/api/v1/agent-plugins/:pluginId/health
```

Do not put host health under `/api/v1/plugins/:pluginId/health`; that path belongs to plugin gateway.

## Health aggregation

Health should summarize, not own underlying state:

```ts
type PluginHealth = {
  pluginId: string
  scope: "workspace" | "global" | "app"
  sourceKind: string
  revision: number
  front?: { status: "ok" | "error" | "disabled"; message?: string }
  pi?: { status: "ok" | "error" | "disabled"; message?: string }
  backend?: { status: "ok" | "error" | "disabled"; message?: string }
  selfTest?: { lastRunAt?: string; ok?: boolean; message?: string }
}
```

## Self-test integration

PR #159 gives UI self-test.

Extend later:

- if plugin manifest declares backend health path, call gateway path;
- include backend status in `test-plugin` JSON/text output;
- store last self-test result in health aggregator.

Backend health declaration example:

```jsonc
{
  "boring": {
    "runtimeServer": "server/index.ts",
    "health": { "path": "/health" }
  }
}
```

This is plugin-owned `/health` under gateway, not host metadata path.

## Tests

Required:

- Pi package source metadata preserved through scan/load result;
- package with `package.json#boring` but no `package.json#pi` loads in boring and no-ops in Pi;
- runtime backend refuses default-package source;
- workspace-local source refuses wrong workspace;
- both reload endpoints use same coordinator behavior;
- coordinator handles scan error + backend error + caller hook diagnostic together;
- host health path does not conflict with gateway path;
- self-test can report backend health separately from front health.
