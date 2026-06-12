# Retro-compat cleanup TODO

Goal: remove useless backward-compat / legacy authoring paths while the repo is still greenfield. Prefer hard errors over silent no-ops. Do not delete files unless explicitly approved; first stop exporting/using, then remove when allowed.

## P0 — Plugin front API leftovers

- [x] Remove public legacy front output type exports.
  - Files:
    - `packages/workspace/src/shared/plugins/types.ts`
    - `packages/workspace/src/shared/plugins/index.ts`
    - `packages/workspace/src/index.ts`
  - Action: stop exporting `PluginOutput`, `LeftTabOutput`, `PanelOutput`, `CommandOutput`, `CatalogOutput`, `BindingOutput`, `ProviderOutput`, `SurfaceResolverOutput` from public/root barrels.
  - Verify: `rg "PluginOutput|PanelOutput|LeftTabOutput|CommandOutput|ProviderOutput|BindingOutput|SurfaceResolverOutput" packages/workspace/src packages/workspace/docs README.md plugins`.

- [x] Internalize or retire `defineFrontPlugin` / `WorkspaceFrontPlugin`.
  - File: `packages/workspace/src/shared/plugins/defineFrontPlugin.ts`
  - Action: replace with a throwing/internal migration stub or remove once deletion is approved.
  - Verify: no runtime/test imports except explicit public-privacy tests.

- [x] Reject legacy manifest UI arrays instead of silently stripping them.
  - Files:
    - `packages/workspace/src/shared/plugins/manifest.ts`
    - `packages/workspace/src/shared/plugins/__tests__/manifest.test.ts`
  - Action: `boring.panels`, `boring.commands`, `boring.leftTabs`, `boring.surfaceResolvers`, `boring.outputs` should return `INVALID_FIELD`.
  - Verify: `pnpm --filter @hachej/boring-workspace test src/shared/plugins/__tests__/manifest.test.ts`.

## P1 — Plugin runtime/API aliases

- [x] Decide whether dynamic runtime front modules must be branded `BoringFrontFactoryWithId`.
  - File: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx`
  - Current: runtime loader accepts bare `BoringFrontFactory`; manifest supplies plugin id.
  - Action options:
    - Keep if this is intentional runtime contract.
    - Or require `definePlugin({ id, ... })` default export and validate `pluginId` matches manifest id.
  - Verify: `pnpm --filter @hachej/boring-workspace test src/front/agentPlugins/__tests__/registerAgentPlugin.test.tsx`.

- [x] Remove unversioned agent-plugin route aliases.
  - File: `packages/workspace/src/server/agentPlugins/routes.ts`
  - Current aliases: `/api/agent-plugins`, `/api/agent-plugins/:id/error`.
  - Canonical routes: `/api/v1/agent-plugins`, `/api/v1/agent-plugins/:id/error`.
  - Verify/update: `packages/workspace/src/server/__tests__/agentPlugins.test.ts`.

- [x] Require explicit `package.json#boring.server`; remove server convention fallback.
  - File: `packages/workspace/src/app/server/pluginEntryResolver.ts`
  - Current fallback: `dist/server/index.js`, `src/server/index.ts`.
  - Action: no `boring.server` means no server plugin. Declared-but-missing still errors.
  - Verify: `pnpm --filter @hachej/boring-workspace test src/app/server/__tests__/rebuildServerPlugins.test.ts src/app/server/__tests__/createWorkspaceAgentServer.test.ts`.

## P1 — Agent compatibility shims

- [x] Remove `details.uiKind` tool UI compatibility shape.
  - Files:
    - `packages/agent/src/shared/tool-ui.ts`
    - `packages/agent/src/shared/__tests__/tool-ui.test.ts`
  - Canonical shape: `output.details.ui = { rendererId, displayGroup, icon, details }`.
  - Verify: `pnpm --filter @hachej/boring-agent test src/shared/__tests__/tool-ui.test.ts src/front/__tests__/toolRenderers.test.tsx`.

- [x] Remove deprecated `vmSize` isolated-code field, or replace with provider-neutral `resources` in the tool schema.
  - Files:
    - `packages/agent/src/shared/sandbox.ts`
    - `packages/agent/src/server/tools/harness/index.ts`
    - related sandbox/harness tests
  - Action: delete `vmSize` from public input and tool schema after confirming no current callers.
  - Verify: `pnpm --filter @hachej/boring-agent typecheck && pnpm --filter @hachej/boring-agent test`.

## P2 — Local dev storage migrations

- [x] Drop command-palette recent-entry string migration.
  - Files:
    - `packages/workspace/src/front/components/recent/migrate.ts`
    - `packages/workspace/src/front/components/recent/recentStore.ts`
    - `packages/workspace/src/front/components/recent/__tests__/migrate.test.ts`
  - Current: migrates old `string[]` / `cmd:<id>` entries.
  - Action: keep only typed `RecentEntry` entries; discard invalid old storage.
  - Verify: `pnpm --filter @hachej/boring-workspace test src/front/components/recent`.

- [x] Drop localStorage session `{ items, activeId }` fallback.
  - File: `packages/workspace/src/front/testing/createLocalStorageSessions.ts`
  - Current: reads old `items` as `sessions`.
  - Action: only accept `{ sessions, activeId }`.
  - Verify app/front session tests.

## P2 — Plugin package helper cleanup

- [x] Remove data-explorer `createSourcesAdapter` legacy helper if no external contract needs it.
  - Files:
    - `plugins/data-explorer/src/front/adapters.ts`
    - `plugins/data-explorer/src/front/index.ts`
    - `plugins/data-explorer/src/front/__tests__/adapters.test.ts`
  - Current comment: supports legacy `sources` API.
  - Action: remove export/tests or move to test fixtures only.
  - Verify: `pnpm --filter @hachej/boring-data-explorer typecheck && pnpm --filter @hachej/boring-data-explorer test`.

## P3 — Core runtime store cleanup

- [x] Remove core runtime legacy mirror/fallback.
  - Files:
    - `packages/core/src/server/runtime/WorkspaceRuntimeSandboxHandleStore.ts`
    - `packages/core/src/server/runtime/__tests__/WorkspaceRuntimeSandboxHandleStore.test.ts`
  - Current: mirrors/falls back between generic runtime resources and legacy runtime columns.
  - Result: sandbox handle store now uses runtime resource rows only; legacy runtime-column mirror/fallback was removed.

## Cross-cutting acceptance checks

- [x] Targeted `rg` checks for removed API names; remaining hits are negative public-API tests, tombstone docs/plans, or unrelated browser/API wording.
- [ ] `pnpm typecheck` — attempted with 600s timeout; still times out due repeated package builds. Scoped package/app typechecks for touched areas passed, including `full-app` and `workspace-playground`.
- [x] `pnpm test`
- [x] `pnpm lint:invariants`
- [ ] `pnpm lint` — attempted with 600s timeout; same repeated-build timeout pattern as root typecheck.
