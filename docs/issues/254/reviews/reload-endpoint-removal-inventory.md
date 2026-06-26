# Reload endpoint removal inventory

Decision: PR 01 should remove the old workspace developer reload endpoint and keep one canonical reload path.

Canonical:

```txt
POST /api/v1/agent/reload
```

Remove:

```txt
POST /api/boring.reload
```

## Why remove it

Two reload endpoints now mean two subtly different reload semantics:

- `/api/v1/agent/reload` refreshes the agent/session layer, runtime provisioning, hot Pi resources, workspace `beforeReload`, plugin scan/rebuild diagnostics, and restart warnings.
- `/api/boring.reload` is an older asset-manager developer endpoint that scans plugin assets and rebuild diagnostics only.

For runtime backend hot reload, keeping both would force every future reload feature to answer: “which endpoint is real?” That is unnecessary complexity.

## Code to remove/change

### `packages/workspace/src/server/agentPlugins/routes.ts`

Remove:

- `app.post("/api/boring.reload", ...)`.
- `BoringPluginRoutesOptions.rebuildPlugins` if it only exists for that route.
- `BoringPluginRoutesOptions.enableReloadRoute` if it only toggles that route.
- `PluginReloadRebuild` if no remaining consumer needs it.

Keep:

- `GET /api/v1/agent-plugins`.
- `GET /api/v1/agent-plugins/:id/error`.
- `GET /api/v1/agent-plugins/events`.
- `collectRestartWarnings()` and `PluginRestartWarning`, but consider moving them out of `routes.ts` if `routes.ts` no longer owns reload formatting.

### `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`

Change:

- stop passing `rebuildPlugins` and `enableReloadRoute` into `boringPluginRoutes`;
- update comments that say `pluginHotReload=false` disables `/api/boring.reload`;
- keep `beforeReload` as the canonical reload integration point;
- optionally extract a focused `reloadWorkspacePlugins()` helper only if it shrinks the canonical reload path; do not add it just for abstraction symmetry.

### Tests

Replace or remove tests that directly call `/api/boring.reload`:

- `packages/workspace/src/server/__tests__/agentPlugins.test.ts`
  - remove old route response-shape tests;
  - keep `collectRestartWarnings()` pure tests;
  - move scan/rebuild/restart-warning behavior tests to `/api/v1/agent/reload` integration tests, or to a reload helper only if such helper exists.
- `packages/workspace/src/app/server/__tests__/hotReloadDiscovery.test.ts`
  - update `pluginHotReload=false` expectation; it should not assert old route absence as the primary behavior.
- `packages/workspace/src/eval/__tests__/plugin-creation.test.ts`
  - replace `/api/boring.reload` calls with `/api/v1/agent/reload`.

### CLI/test harnesses

Check harnesses that register `boringPluginRoutes` with `enableReloadRoute`:

- `packages/cli/src/__tests__/localRuntimePluginHarness.ts`

Remove `enableReloadRoute` usage and route reload tests through the canonical agent reload path.

### Docs/changelog

Update/remove references:

- `packages/workspace/docs/PLUGIN_SYSTEM.md` mention that `pluginHotReload=true` registers `/api/boring.reload`.
- `packages/workspace/CHANGELOG.md` historical note can stay if desired, but current docs must not tell users to call it.
- runtime plugin plan drafts that still mention `/api/boring.reload` should be treated as stale/non-canonical.

## What not to remove

- `rebuildServerPlugins()` — canonical reload still needs dir-source diagnostic re-imports.
- `collectRestartWarnings()` — canonical reload still surfaces restart warnings.
- `/api/v1/agent-plugins` list/error/events routes — these are plugin state/event routes, not reload endpoints.
- `pluginHotReload` option — still controls dynamic plugin scan/resource refresh behavior.

## Acceptance for PR 01

- `POST /api/v1/agent/reload` remains green and includes plugin scan/rebuild diagnostics + restart warnings.
- `POST /api/boring.reload` is not registered.
- No production code path calls `/api/boring.reload`.
- No tests rely on `/api/boring.reload` response shape.
- Docs point reload users/tools to `/api/v1/agent/reload`.
