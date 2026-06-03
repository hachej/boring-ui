# PR 01 — Foundation: source metadata, remove old reload route, jiti helper

## Goal

Prepare the codebase for CLI/local runtime backends with the smallest safe foundation PR.

No backend execution yet.

## Scope

This PR combines the setup work that is too small/noisy as separate PRs:

1. Keep one plugin-facing manifest field: `boring.server`.
2. Preserve minimal plugin source metadata through discovery/load.
3. Add minimal source classification: internal plugins are fixed/boot-time; external plugins are hot-reloaded through the gateway.
4. Remove the obsolete `/api/boring.reload` endpoint so there is one reload path.
5. Extract the existing jiti fresh-import helper.

## Why this PR exists

Runtime backend reload needs three foundations before it is safe:

```txt
explicit source trust -> one reload endpoint -> canonical fresh import
```

Without this, the implementation risks path-based trust inference, duplicated reload semantics, and another ad-hoc jiti loader.

## Tasks

### 1. Manifest/source metadata

- Do not add `boring.runtimeServer`.
- Keep one plugin-facing manifest field: `boring.server`.
- A plugin declares that it has a server entry; internal/external source classification decides how that server entry is activated.
- Internal/app sources can activate `boring.server` as the existing boot-time `WorkspaceServerPlugin` path.
- External CLI/local sources can activate `boring.server` as the hot gateway runtime backend contract.
- Preserve minimal source metadata in loaded plugin records.
- Do **not** store `runtimeBackendAllowed` on source records. That boolean is too easy to set incorrectly at callsites.

Source shape for this PR:

```ts
type BoringPluginSource = {
  rootDir: string // absolute normalized host path
  kind: "internal" | "external"
  workspaceId?: string
}
```

Meaning:

- `"internal"` — app/default/static plugin source. `boring.server` is activated at boot through the existing `WorkspaceServerPlugin` path.
- `"external"` — workspace/global CLI plugin source. `boring.server` is hot-reloaded behind `/api/v1/plugins/:pluginId/*`.

Initial source assignment:

- `defaultPluginPackages` / app-composed plugin entries => `internal`.
- workspace `.pi/extensions` and global `~/.pi/agent/extensions` => `external`.

Ignore advanced host escape hatches for MVP. If a host uses extra scan dirs, they should not automatically become external hot-server sources unless the host deliberately installs/registers them as external later.

This is not a new plugin API. Plugin authors still use `boring.server`. The host only records whether the source is internal or external so activation logic is not inferred from paths at random callsites.

Loaded plugin records should carry:

```ts
type LoadedBoringPlugin = {
  id: string
  revision: number
  rootDir: string
  serverPath?: string
  source: BoringPluginSource
}
```

`npm` / `git` / `local-path` install details are PR 03 metadata. They are not needed in the server foundation.

### 2. Remove obsolete reload endpoint

Make `/api/v1/agent/reload` the only reload endpoint.

Do **not** introduce a reload helper/module in PR 01 unless it clearly shrinks `createWorkspaceAgentServer.ts`. With one endpoint, a helper is not required just to remove the old route.

Keep the canonical `/api/v1/agent/reload` support sequence behavior unchanged in place:

```txt
assetManager.load()
rebuildServerPlugins() diagnostic-only
runRuntimeProvisioning()
opts.beforeReload()
merge diagnostics/restart_warnings
```

Why two endpoints exist today:

- `/api/v1/agent/reload` belongs to the agent/session layer. It refreshes Pi/session resources and runs workspace `beforeReload` hooks. This is what chat, plugin self-test, and workspace-mode tooling already use.
- `/api/boring.reload` is a workspace/plugin developer endpoint from earlier plugin asset-manager work. It scans plugin assets and reports restart warnings without doing the full agent/session reload.

Do not grow two reload systems. PR 01 should remove `/api/boring.reload` and route all reload tooling through `/api/v1/agent/reload`.

There is no developer reload compatibility route after PR 01.

### Remove old reload endpoint plumbing

Remove from code:

- `POST /api/boring.reload` registration in `packages/workspace/src/server/agentPlugins/routes.ts`.
- `BoringPluginRoutesOptions.rebuildPlugins` if only used for `/api/boring.reload`.
- `BoringPluginRoutesOptions.enableReloadRoute` if only used to toggle `/api/boring.reload`.
- `PluginReloadRebuild` type if it only supports the old route.
- `app.register(boringPluginRoutes, { rebuildPlugins, enableReloadRoute })` arguments in `createWorkspaceAgentServer.ts`.
- Comments/docs claiming `pluginHotReload=false` omits `/api/boring.reload`.

Keep/move:

- `collectRestartWarnings()` and `PluginRestartWarning`, because canonical `/api/v1/agent/reload` still uses restart warnings.
- `rebuildServerPlugins()`, because canonical reload still needs dir-source diagnostic re-imports.
- `/api/v1/agent-plugins`, `/api/v1/agent-plugins/:id/error`, and `/api/v1/agent-plugins/events`.

Update tests/callers:

- Replace tests that inject `POST /api/boring.reload` with canonical `POST /api/v1/agent/reload` when they are testing reload behavior.
- Delete route-level tests whose only purpose was `/api/boring.reload` response shape.
- Update `hotReloadDiscovery` expectations: `pluginHotReload=false` disables hot reload behavior, not an obsolete route.
- Update eval/plugin-creation tests to call `/api/v1/agent/reload`.
- Update docs and changelog references that tell users to call `/api/boring.reload`.

### 3. Shared jiti helper

Create:

```txt
packages/workspace/src/server/pluginImports/importServerModule.ts
```

Extract existing behavior from `pluginEntryResolver.ts`:

- `hotReload: true` uses `createJiti(..., { moduleCache: false })`.
- fallback warning behavior remains unchanged.
- existing `boring.server` diagnostics use the helper.

## Non-goals

- No runtime backend API.
- No route capture.
- No HTTP gateway.
- No install command.
- No behavior change to canonical `/api/v1/agent/reload` flow.
- Remove obsolete `/api/boring.reload` flow.
- No reload helper abstraction unless it deletes more code than it adds.

## Tests

- Manifest keeps accepting safe `boring.server` paths.
- Unsafe `boring.server` path is rejected.
- Source metadata survives scan/load without changing existing list/event response shapes.
- Internal sources are boot-time/fixed.
- External sources are hot-reloaded through the gateway.
- `POST /api/boring.reload` returns 404/not registered after PR 01.
- Existing canonical reload behavior and diagnostics remain unchanged.
- `hotReload: true` jiti import sees source edits.
- Native import/fallback warning behavior is unchanged.

## Acceptance

- Internal vs external source classification is explicit, not path-inferred and not stored as a drift-prone backend-allowed boolean.
- There is only one reload endpoint; no new reload abstraction is introduced unless it materially reduces code.
- There is one canonical jiti server module import helper.
- No runtime backend handlers execute yet.
