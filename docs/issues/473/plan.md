---
github: https://github.com/hachej/boring-ui/issues/473
issue: 473
state: active
phase: review
track: owner
flag: not-needed
updated: 2026-07-01
---

# gh-473 composable workspace left-pane controls

## Decision

Extract a narrow public `useWorkspaceLeftPaneActions()` hook so host apps can render workspace source/page category buttons inside their own explorer/sidebar without mounting the full `WorkbenchLeftPane` chrome. Keep `WorkbenchLeftPane` as the default composed implementation.

## Flag

`not-needed` — additive public API, no runtime behavior change intended.

## Acceptance

- `WorkbenchLeftPane` composes the extracted action model and preserves current behavior.
- Host components can render left-pane actions without rendering the default pane rail.
- The public hook exposes stable action descriptors only: id, title, icon, kind, active state, select handler, optional reload handler.
- The public hook does not expose `useWorkspaceStore`, raw registries, search state, `chromeActionsElement`, source config, panel config, or other private layout state.
- Tests cover default pane behavior plus custom host explorer composition.
- Docs show the public import path and warn against deep imports.

## Proof

- `pnpm --filter @hachej/boring-workspace exec vitest run src/front/chrome/workbench-left/__tests__/WorkbenchLeftPane.test.tsx`
- `pnpm --filter @hachej/boring-workspace run typecheck`
- `git diff --check`

## Thermo Review

Plan thermo loop completed in the intake thread. Required corrections were folded in before implementation:

- narrow hook-first public API;
- no private store/layout exposure;
- host integration proven without default rail;
- avoid component sprawl and scattered provider/layout conditionals.
