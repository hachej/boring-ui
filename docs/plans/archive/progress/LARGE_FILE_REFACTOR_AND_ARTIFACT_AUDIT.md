# Large File Refactor and Artifact Audit

Date: 2026-05-13

## Scope

Scanned the monorepo for large source files, leaky abstractions, and generated/build artifacts that should stay out of git. This is an overview/plan only; no source refactors were performed in this pass.

## Already-open GitHub issues that overlap

- #19 — Refactor `ChatPanel` pi-native follow-up/projection logic into focused hooks.
- #21 — Extract core-neutral workspace catalog routes for CLI/local reuse.
- #12 — Plan Pi harness decoupling for `@boring/agent`.
- #14 — Plan harness-scoped follow-up capabilities.
- #6 — Better file loader.
- #8 — Image upload: save as file instead of base64 inline.

## Top refactor candidates

1. `packages/agent/src/front/ChatPanel.tsx` (~1918 lines)
   - Mixes chat plumbing, Pi-native follow-up, display projection, composer/model/thinking state, attachments, slash commands, persistence repair, and message/tool rendering.
   - Split toward focused hooks/components: `usePiFollowUpQueue`, `useProjectedMessages`, `useModelSelection`, `useThinkingSettings`, `MessageList`, `ComposerBar`.

2. `packages/agent/src/front/primitives/prompt-input.tsx` (~1508 lines)
   - A primitive file exporting ~80 items while owning screenshot capture, attachment state, textarea behavior, menus, tabs, command UI, and upload handling.
   - Split into a `prompt-input/` module with context, attachments, screenshot, root, textarea, actions, select, command, and barrel exports.

3. `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts` (~1090 lines)
   - One class owns workspace CRUD, membership, invites, runtimes, UI state, and resource mapping.
   - Split mappers and focused store modules, then compose behind the existing `PostgresWorkspaceStore` API.

4. `packages/workspace/src/plugins/filesystemPlugin/front/file-tree/FileTreeView.tsx` (~868 lines)
   - Mixes tree transforms, draft/edit state, context menu behavior, clipboard, pane wrapper, loading/error rendering, and visual tree UI.
   - Split tree model, state hook, context menu, toolbar, pane wrapper, and view.

5. `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` (~743 lines)
   - Mixes Pi session lifecycle, resource loading, model resolution, event/chunk adaptation, heartbeat/status chunks, tool adaptation, and follow-up.
   - Split Pi session factory, resource loader, model resolution, chunk adapter, heartbeat, and follow-up modules.

6. `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx` (~727 lines)
   - Couples DockView mechanics, surface commands, panel resolution, rail/collapse UI, and empty state.
   - Split request normalization, shell state hook, dock view, rail, and overlay.

7. `packages/workspace/src/plugins/explorerPlugin/front/index.tsx` (~685 lines)
   - Plugin factory, types, output creation, explorer UI, filters, rows, and chips all live in the index file.
   - Split plugin factory/types from UI components.

8. `packages/workspace/src/front/provider/WorkspaceProvider.tsx` (~578 lines)
   - Theme, bridge, workspace context, shortcuts, commands, catalogs, plugin providers, open-file binding, and chat injection in one provider.
   - Split into focused providers and binding components.

9. `packages/agent/src/server/registerAgentRoutes.ts` (~573 lines)
   - Route registration also owns runtime scope, skill scope, model providers, workspace mode selection, sandbox expiration detection, and capability contribution.
   - Split route modules and runtime/capability services.

10. `packages/workspace/src/front/components/CommandPalette.tsx` (~568 lines)
    - Command mode, catalog mode, search, keyboard behavior, row rendering, and formatting are fused.
    - Split state hook, command mode, catalog mode, search, and rows.

## Leaky abstractions

- Pi protocol leaks into generic agent UI: `ChatPanel` knows Pi follow-up markers/projection and session persistence repair.
- Runtime/sandbox details leak into route registration: `registerAgentRoutes.ts` does service selection and runtime policy while mounting HTTP routes.
- Core workspace routes leak auth/Postgres/product assumptions into a shape the local CLI wants to reuse; issue #21 is the correct seam.
- `WorkspaceProvider` acts as a service locator for too many workspace subsystems.
- UI components leak IO/storage policy: file tree loading and markdown image upload should be driven by injected IO hooks/callbacks.
- Plugin `index.tsx` files leak implementation details instead of acting as stable entrypoints.

## Generated/build artifact audit

Large generated/build artifacts found locally:

- `apps/full-app/api/generated-index.ts` (~22 MB / ~490k lines)
- `apps/full-app/api/*.map` (~40 MB each)
- `packages/cli/public/assets/*.js` and related built assets
- `apps/*/dist`, `.vite`, `node_modules`, `storybook-static`
- `packages/agent/test-results`, `packages/agent/e2e/e2e-artifacts`
- `packages/*/.tsbuildinfo*`

These are not source refactor targets. They should remain ignored and untracked.

## Artifact cleanup action taken

Updated root `.gitignore` to centrally cover the known generated/build outputs:

- `**/.vite/`
- `apps/full-app/api/generated-index.*`
- `apps/full-app/api/index.ts.map`
- `apps/*/api/*.map`
- `packages/cli/public/`
- `packages/*/lib/node_modules/`
- `.tsbuildinfo.*`

Existing package-level ignores already covered many of these, but the root ignore now documents and reinforces the policy.

No files were deleted in this pass.
