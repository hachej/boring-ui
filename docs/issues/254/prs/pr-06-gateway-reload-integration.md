# PR 06 — Gateway + reload integration

## Goal

Expose runtime backend handlers through the stable HTTP gateway and wire backend reload into the shared coordinator.

## Scope

This is the first PR where external-source `boring.server` runtime modules become live over HTTP through the constrained gateway.

## Proposed files

- `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts`
- `packages/workspace/src/app/server/workspacePluginReload.ts`
- app/server route registration wiring
- health route wiring
- integration tests

## Gateway

Plugin-owned space:

```txt
ALL /api/v1/plugins/:pluginId/*
```

Host management/health stays outside gateway:

```txt
GET /api/v1/agent-plugins/:pluginId/health
```

## Reload integration

Coordinator sequence becomes:

```txt
assetManager.load()
runtimeBackendRegistry.reloadFromLoadedPlugins(loaded)
rebuildServerPlugins() diagnostic-only for boring.server
runRuntimeProvisioning()
opts.beforeReload()
merge diagnostics/restart_warnings/backend health
```

## Source gating

- Workspace/global external sources may activate `boring.server` through the runtime backend gateway.
- Default-package/app sources do not activate through the gateway in MVP.
- Workspace-local source must match current workspace in workspaces mode.

## Non-goals

- No install command.
- No remote sandbox.
- No permission prompts.
- No route params.

## Tests

- Plugin backend responds after `/reload`.
- Source edit + `/reload` changes response without restart.
- Syntax error keeps previous response live.
- Removed plugin unloads gateway handlers.
- Wrong workspace gateway call rejected.
- Host health path does not conflict with plugin `/health`.
- Both reload endpoints surface same backend diagnostics.

## Acceptance

- Existing `.pi/extensions/<id>` plugin with `boring.server` can hot-reload constrained backend handlers in CLI/local mode.
