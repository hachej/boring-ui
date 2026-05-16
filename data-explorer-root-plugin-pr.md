# DataExplorer root plugin extraction

Worktree: `/tmp/boring-data-explorer-plugin-worktree`
Branch: `extract/data-explorer-plugin`
Commit: `b45a943573705a7a09a5844c373603b12f2c5c52`
PR: https://github.com/hachej/boring-ui/pull/30

## Implemented

- Added root plugin package `plugins/data-explorer` as `@hachej/boring-data-explorer`.
- Added `plugins/*` to `pnpm-workspace.yaml`.
- Moved `DataExplorer`, `useExplorerState`, adapters, Storybook/mock adapters, tests, and explorer contracts out of `@hachej/boring-workspace`.
- Exposed new package subpaths:
  - `@hachej/boring-data-explorer`
  - `@hachej/boring-data-explorer/front`
  - `@hachej/boring-data-explorer/shared`
  - `@hachej/boring-data-explorer/testing`
- Removed workspace ownership/public exports for `DataExplorer`, `useExplorerState`, `createSourcesAdapter`, and explorer contracts.
- Updated workspace, workspace playground, stories, tests, and changelog to use the new package dependency.
- Left DataCatalog root plugin extraction as a follow-up PR, per scope.

## Validation

Passed:

- `pnpm --filter @hachej/boring-data-explorer run build`
- `pnpm --filter @hachej/boring-data-explorer run typecheck`
- `pnpm --filter @hachej/boring-data-explorer run test` — 31 tests passed
- `pnpm --filter @hachej/boring-workspace run typecheck`
- `pnpm --filter @hachej/boring-workspace exec vitest run src/plugins/explorerPlugin/__tests__/explorerPlugin.test.tsx src/plugins/dataCatalogPlugin/front/__tests__/dataCatalogPlugin.test.tsx src/__tests__/plugin-integration.test.tsx src/__tests__/public-api.test.ts` — 62 tests passed
- `pnpm lint:workspace-plugin-invariants`
- `pnpm check:generated-artifacts`
- `git diff --check`

Also passed during implementation:

- `pnpm --filter workspace-playground run typecheck`
- `pnpm --filter @hachej/boring-workspace run build`

## Review

Reviewer: Claude CLI

Round 1 verdict: `revise`
- Blocker: Storybook imported mock adapters from `/front`, but mocks were not exported there.
- Concern: removed workspace testing mock adapter exports needed a migration path.

Fix applied:
- Added `@hachej/boring-data-explorer/testing` subpath for mock adapters.
- Updated story imports to use `/front` for `DataExplorer` and `/testing` for mocks.
- Updated changelog to mention testing helper relocation.

Round 2 verdict: `ship`

## Notes / risks

- This is an intentional breaking public API change for workspace consumers. Migration path is:
  - `DataExplorer` from `@hachej/boring-data-explorer/front`
  - explorer contracts from `@hachej/boring-data-explorer/shared`
  - mock adapters from `@hachej/boring-data-explorer/testing`
- PR body references and fixes GitHub issue #29.
