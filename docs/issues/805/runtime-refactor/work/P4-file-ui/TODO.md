> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# TODO-P4 — Move filesystem front plugin to `@hachej/boring-bash/plugin`

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- `docs/issues/805/plan.md` — Phase 4 deliverables/exit (move front plugin; preserve panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session changes; factor tree data into a plain internal tree function — the pluggable `FileTreeDataProvider` boundary is **deferred to #295** (BBP4-012); the document-authority override seam is **deferred out of this epic** (BBP4-013)).
- `docs/issues/391/runtime-refactor/architecture/02-boring-bash-environment.md` — "File tree and document authority" (`FileTreeDataProvider` for #295; document-authority override for #367/#226 — **the override is deferred out of this epic**, see BBP4-013); "UI plugin ownership" (workspace bridge stays workspace-owned).
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — issues supported by extension points: #295 file-tree replacement, #367/#226 document collaboration.

### Depends on

- **Phase 3** ([`../P3-routes-tools/TODO.md`](../P3-routes-tools/TODO.md)): file routes + `write`/`edit` tools already in `boring-bash/server` + `boring-bash/agent`. (The document-authority seam that would hook the moved `write`/`edit` tools is **deferred out of this epic** — BBP4-013; P4 leaves those tools as raw file ops.)

### Front plugin inventory in `packages/workspace` (Phase 4 move targets)

Root: `packages/workspace/src/plugins/filesystemPlugin/`
- `front/index.ts` — `filesystemFront: BoringFrontSetup` + `definePlugin({ id: FILESYSTEM_PLUGIN_ID, … })`; registers provider, bindings, workspace source (`FILES_LEFT_TAB_ID`), panels, surface resolver, catalog. Imports `definePlugin`/`BoringFrontSetup` from `../../../shared/plugins/frontFactory`, `postUiCommand` from `../../../front/bridge`, `useCatalogRegistry` from `../../../front/registry`.
- `front/surfaceResolver.ts` — `filesystemSurfaceResolver` (`kind: WORKSPACE_OPEN_PATH_SURFACE_KIND`, id `FILESYSTEM_SURFACE_RESOLVER_ID = "filesystem-path"`); glob→panel matching.
- `front/filePanelBinding.tsx`, `front/agentFileBridge.tsx` (`emitFilesystemAgentFileChange`, `useAutoOpenAgentFiles`, `onFilesystemChanged`), `front/useFilePane.ts`, `front/FilePaneShell.tsx`, `front/ConflictBanner.tsx`, `front/catalogs.ts`, `front/events.ts`, `front/search.ts`.
- Panes: `front/file-tree/*` (`FileTreeView.tsx` `FileTreePane`+`preloadFileTreeComponent`, `FileTree.tsx`, `treeModel.ts`, `clipboard.ts`, `dndManager.ts`), `front/code-editor/*` (CodeMirror), `front/markdown-editor/*` (**TipTap** — `MarkdownEditor.tsx`, `ResizableImage.tsx`), `front/media-viewer/*`, `front/html-viewer/*`, `front/empty-file-panel/*`.
- Data layer: `front/data/*` (`DataProvider.tsx`, `fetchClient.ts`, `hooks.ts`, `fileRecords.ts`, `useFileEventStream.ts`, `useFileEventInvalidation.ts`, `useFileUpload.ts`, `treePreloadCache.ts`, `types.ts`, `index.ts`, `filesystemErrorRedaction.ts`).
- Shared: `shared/constants.ts` (`FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, `FILES_CATALOG_ID`, `FILESYSTEM_SURFACE_RESOLVER_ID`, panel ids: `CODE_EDITOR_PANEL_ID`, `CSV_VIEWER_PANEL_ID`, `MARKDOWN_EDITOR_PANEL_ID`, `IMAGE_VIEWER_PANEL_ID`, `PDF_VIEWER_PANEL_ID`, `HTML_VIEWER_PANEL_ID`, `EMPTY_FILE_PANEL_ID`), `shared/events.ts`.

UI `(filesystem, path)` addressing (workspace-owned shared, ships from #416):
- `packages/workspace/src/shared/types/filesystem.ts` — type `FilesystemId`; **runtime VALUES** `USER_FILESYSTEM_ID` (constant), `normalizeUiFilesystem()` (function), `uiFileResourceKey()` (function); `(filesystem, path)` parse/serialize (`filesystem:path`). **Company file-tree root + capability-based readonly panes** are built on these. Preserve. The moved plugin imports these types/values from the public workspace SDK surface (`@hachej/boring-workspace/shared`, or a narrower public plugin SDK export if P4 adds one). There is no `BashPluginHost` adapter.

Static workspace registrations/imports to remove (grep-verified):
- `packages/workspace/src/index.ts` (L61 exports `filesystemPlugin`), `packages/workspace/src/app/front/workspaceBuiltinPlugins.ts` (L17), `packages/workspace/src/front/provider/WorkspaceProvider.tsx` (L529-531 default-plugins list).

### Tool renderer + composer provider inventory (Phase 4 move targets)

- Bash/file tool renderers currently live in `packages/agent/src/front/toolRenderers.tsx` and `packages/agent/src/front/bareToolRenderers/`. Both maps register `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`; `toolRenderers.tsx` also owns the shadcn-styled shell/file cards, readiness blocks, `PathLabel`, and file diff/write/search display, while `bareToolRenderers/renderers.tsx` owns the neutral renderer model/fallback plus bare bash/read/write/edit/find/grep/ls renderers.
- The existing workspace front-plugin API already has the delivery field: `packages/workspace/src/plugin.ts` exports `definePlugin`; `packages/workspace/src/shared/plugins/frontFactory.ts` defines `BoringFrontToolRendererRegistration`, `BoringFrontAPI.registerToolRenderer(...)`, `DefinePluginConfig.toolRenderers`, and captures `toolRenderers`. Use this existing field; do not invent a parallel renderer registry.
- File composer provider code currently lives in `packages/agent/src/front/useComposerPickers.ts` (file mention token tracking), `packages/agent/src/front/primitives/mention-picker.tsx` (`/api/v1/files/search`), `packages/agent/src/front/chatSubmit.ts` (`@files: ...` model note and attachment enrichment), and `packages/agent/src/front/chat/components/PiChatComposerSurface.tsx` (upload via `uploadFile()` to `/api/v1/files/upload`). Repo-local prior-art citation: `docs/plans/archive/pi-native-chat-ui-rewrite-plan.md` cites [#26](https://github.com/hachej/boring-ui/issues/26) as "Move `@file` mentions from agent into workspace composer provider".

### Document-authority current state (investigated — context; the seam is DEFERRED)

- There is **no** server-side document coordinator / Yjs today. `write`/`edit` are raw file ops (now in `boring-bash/agent` after Phase 3).
- Front editors: `markdown-editor/*` uses **TipTap** (front-only, in-browser); `code-editor/*` uses CodeMirror. Stale-write/conflict handling exists on the front via `ConflictBanner.tsx` + `useFilePane.ts` + the `data/` layer; `agentFileBridge.tsx` emits/consumes file-change events so open panes react to agent writes.
- The document-authority override (#367/#226) would be a **greenfield server seam**, but it has **zero real consumers in this epic** (no live document system exists). Per the no-speculative-abstraction rule it is **deferred out of #391** and arrives with its first real authority implementation (see BBP4-013). P4 leaves `write`/`edit` as raw file ops and adds no seam. Do not build TipTap↔Yjs collaboration or a null/default authority here.

## Goal / exit criteria

Filesystem front plugin lives in `@hachej/boring-bash/plugin` and is loaded through the normal workspace plugin pipeline; panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session-change integration + Company file-tree root + capability-based readonly panes preserved; tree data factored into a plain internal function (the pluggable `FileTreeDataProvider` boundary is deferred to #295); the document-authority write/edit override is **deferred out of this epic** (BBP4-013). Cycle safety comes from dynamic plugin loading: `boring-bash/plugin` may import the public workspace plugin SDK, while `packages/workspace/src` must have no static import from `@hachej/boring-bash`. Exit per [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md) Phase 4:

- `exec_ui openFile` still opens files (same panel ids, same resolver).
- Bash/file tool renderers (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`) are registered by `boring-bash/plugin` through `definePlugin({ toolRenderers })`; pure-mode front ships no filesystem/bash renderer registrations.
- File mentions, file-related slash commands, workspace/file upload, and `@files` enrichment are environment-fact-gated composer providers shipped by `boring-bash/plugin`; pure-mode front ships no `/api/v1/files/search` dependency, workspace/file upload affordance, `@files` note path, or filesystem vocabulary. Provider-neutral direct input-asset affordances may exist only when host/provider policy allows provider-direct intake.
- file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295).
- (document-authority override deferred out of this epic — `write`/`edit` stay raw file ops; the seam arrives with #367/#226.)

## Non-negotiables

- Preserve panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and the `workspace.open.path` resolve output (`id: file:<path>`, component, params) verbatim.
- Preserve file panel binding, `agentFileBridge` exports, session-change integration, catalog, and existing user workflows.
- Preserve Company file-tree root + capability-based readonly panes landed via #416.
- **Cycle safety:** `boring-bash/plugin` may import public workspace plugin SDK values/types directly (`definePlugin`, plugin front types, bridge helpers such as `postUiCommand`, registry hooks, surface types, and the UI filesystem helpers including `normalizeUiFilesystem`, `USER_FILESYSTEM_ID`, and `uiFileResourceKey`). This is safe because workspace-family hosts load `boring-bash` dynamically through manifest/entry resolution; there is no static workspace→bash import. The guard is inverted from the old plan: `packages/workspace/src` must have **no static import** from `@hachej/boring-bash`.
- Workspace bridge stays workspace-owned; the plugin consumes bridge commands through the public workspace plugin SDK.
- Tool renderers move as part of the bash capability bundle: `boring-bash/plugin` registers the `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls` renderers through the existing `DefinePluginConfig.toolRenderers` field in `packages/workspace/src/shared/plugins/frontFactory.ts`. `packages/agent/src/front` may keep generic renderer plumbing (`ToolPart`, resolver, fallback, UI-owned `exec_ui`/`get_ui_state` renderers as applicable), but it must not default-register bash/file renderer ids in pure mode.
- Composer providers move as part of the environment capability residue: file mention provider, file-related slash commands, `@files` note generation, and upload affordances are registered only from resolved environment facts. File mentions/search need a readable filesystem fact; upload/input-asset affordances need a writable accepting environment sink or a provider-direct intake path allowed by host policy. Agent front keeps provider-neutral composer/picker primitives only.
- Missing boring-bash capability → clear UI diagnostic, not a broken panel.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do not build TipTap/Yjs real-time collaboration; and do not add the document-authority seam either — it is deferred out of this epic (BBP4-013).
- Do not change server routes again (Phase 3 owns them); do not re-shape #416 contracts.
- Do not import deep/private workspace files from `boring-bash/plugin`, and do not introduce any static `packages/workspace/src` import from `@hachej/boring-bash`. Public workspace plugin SDK imports from `boring-bash/plugin` are allowed and required by this plan.

## Beads

### BBP4-010 — Establish `/plugin` subpath using the workspace plugin SDK directly [size S]

- **Files touch/create:** replace stub `packages/boring-bash/src/plugin/index.ts` (`export {}`); `packages/boring-bash/package.json` (add `"./plugin"` export, front-safe — no `node:*`/`Buffer`); `packages/boring-bash/tsup.config.ts` (add entry, browser/react externals); `packages/boring-bash/scripts/check-invariants.mjs` (`requiredExports` += `"./plugin"`; extend the shared/front-safe scan to cover `src/plugin/**`).
- **Notes:** Delete the `BashPluginHost` idea entirely. `boring-bash/plugin` imports the public workspace plugin SDK directly: `definePlugin`/front types from `@hachej/boring-workspace/plugin`, bridge/registry/surface helpers from the public SDK surfaces, and `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` from `@hachej/boring-workspace/shared` unless P4 first exposes a narrower public plugin SDK export. Add the package dependency/peer metadata needed for this public SDK import. React remains a peer dep — add to `packages/boring-bash/package.json` `peerDependencies` (mirror workspace's react peer setup).
- **Tests:** export-map test imports `/plugin`; invariants (incl. front-safe scan on `src/plugin/**`) green.
- **Acceptance:** `/plugin` subpath resolves front-safe; no `BashPluginHost` adapter exists; `boring-bash/plugin` imports only public workspace SDK surfaces, not deep private workspace paths.

### BBP4-011 — Move filesystem front plugin files [size L]

- **Files move:** entire `packages/workspace/src/plugins/filesystemPlugin/front/*` and `shared/*` → `packages/boring-bash/src/plugin/filesystem/{front,shared}/*` (keep sub-structure: `file-tree/`, `code-editor/`, `markdown-editor/`, `media-viewer/`, `html-viewer/`, `empty-file-panel/`, `data/`, and their `__tests__/`).
- **Files touch:** repoint the moved files away from old relative workspace-internal paths and onto the public workspace SDK: `front/index.ts` imports `definePlugin`/front types from `@hachej/boring-workspace/plugin`; bridge/registry/surface imports use public workspace SDK exports; filesystem helper imports use `@hachej/boring-workspace/shared` (or the narrower public plugin SDK export added in BBP4-010). `packages/workspace/src/shared/types/filesystem.ts` **stays workspace-owned** (binding decision — no discretion). Do NOT relocate `filesystem.ts` to `boring-bash/plugin/shared`. Do NOT add a static workspace registration import from `@hachej/boring-bash/plugin`; front registration happens through the normal plugin pipeline / manifest front entry. Verify with `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` — it must return **no matches**.
- **Notes:** Preserve every panel id, `FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, catalog registration, and the `filesystemSurfaceResolver` output. Preserve Company file-tree root + capability-based readonly panes (in `file-tree/FileTreeView.tsx`, `FilePaneShell.tsx`, `useFilePane.ts`, `code-editor/CodeEditorPane.tsx`).
- **Tests:** move the plugin's `__tests__` (`filesystemPlugin.test.ts`, `filePanelBinding.test.tsx`, `agentFileBridge.test.tsx`, `useFilePane.test.tsx`, `search.test.ts`, `FileTree*.test.tsx`, editor tests) into boring-bash and pass; static-import guard passes.
- **Acceptance:** file UI runs from boring-bash with unchanged panel ids/resolver; `boring-bash/plugin` imports the workspace plugin SDK directly; `packages/workspace/src` has no static import from `@hachej/boring-bash`.

### BBP4-012 — Extract a plain internal tree function/type (provider boundary deferred to #295) [size S]

- **Descope (binding):** do **not** ship a `FileTreeDataProvider` interface — no delta-streaming provider abstraction with a single implementation. The "abstraction needs two real consumers" rule (`INDEX.md`) is not met: #295 (Pierre Trees swap) is the only would-be second consumer and it is **not scheduled yet**. Ship the current tree behind a plain internal function + type, not a pluggable boundary.
- **Files create/touch:** in `packages/boring-bash/src/plugin/filesystem/front/file-tree/`, factor the current tree fetch into a plain internal function/type (e.g. `loadFileTree(root, options)` returning the existing tree shape) over the current `data/` hooks + `useFileEventStream`; point `FileTreeView.tsx` / `FileTree.tsx` / `treeModel.ts` at it. No `subscribe(): AsyncIterable<FileTreeDelta>` interface, no registry, no second impl.
- **Notes:** Keep behavior identical — respects the existing adapter path validation, source-of-truth metadata, hidden/denied-file handling, symlink policy, and current pagination. The **pluggable `FileTreeDataProvider` boundary is deferred until #295 is actually scheduled** (add it then, with Pierre Trees as the second real consumer).
- **NO-INOTIFY contract (X1 Decision 7; `10-sandbox-deployment-eu.md`):** the file-tree/editor refresh path **must not rely on inotify** when the backing environment is a FUSE / virtiofs / gVisor-bind mount (inotify is unreliable on all three) — refresh via **polling or a host event bridge** when the mount's capability facts report `noInotify`/`pollRequired` (`@hachej/boring-sandbox` BBX1-004). `useFileEventStream` must degrade to polling on those mounts, not silently miss changes.
- **Tests:** the plain function returns the current tree shape; hidden/denied files absent from the agent-visible tree; existing tree tests stay green.
- **Acceptance:** the tree data path is a single internal function (no provider interface); behavior unchanged; the provider boundary is explicitly noted as deferred to #295.

### BBP4-013 — Document-authority write/edit override hook (#367/#226) — DEFERRED (out of this epic)

- **Descope (binding):** the document-authority write/edit override hook has **zero real consumers** in this epic — there is no live document system (TipTap↔Yjs/etc.) today. Per the "abstraction needs two real consumers" rule (`INDEX.md`), it is **not built here** — not even a nullable hook, since a single-consumer-that-does-not-yet-exist is speculative. The seam **arrives with its first real authority implementation (#367/#226 live-document collaboration)**, out of #391 scope; it is filed as a tracked follow-up at P8 (`TODO-P8` BBP8-004). Until then, `write`/`edit` remain the raw file ops moved in Phase 3, unchanged. P4 adds no `DocumentAuthority` interface, no `documentAuthority?` field, no default null authority, and no registry.
- **Acceptance:** P4 ships **no** document-authority seam; `write`/`edit` are raw file ops (Phase-3 behavior); the seam is filed as a post-epic follow-up (#367/#226) at P8.

### BBP4-014 — Remove static workspace registration + static-import guard [size S]

- **Files touch:** delete the old workspace filesystem plugin export and static default registration — **no back-compat re-export** (no-compat policy, `INDEX.md`). Concretely: `packages/workspace/src/index.ts` stops exporting `filesystemPlugin`; `app/front/workspaceBuiltinPlugins.ts` and `front/provider/WorkspaceProvider.tsx` stop importing/registering the filesystem plugin statically. Workspace-family hosts receive the front plugin via the boring-bash package's manifest-declared `boring.front` entry and the existing plugin asset/entry resolver. Re-run `rg -n "filesystemPlugin|plugins/filesystemPlugin" packages apps plugins` to catch old static importers and migrate/delete them in the same PR. Extend `packages/boring-bash/scripts/check-invariants.mjs` and/or `scripts/audit-imports.ts` + `packages/workspace/scripts/check-plugin-invariants.mjs` to assert `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` returns no matches.
- **Notes:** Missing boring-bash capability must yield a clear UI diagnostic panel, not a crash. Migration surfaces as a build error if an importer was missed — never a silent shim. The cycle-safety rationale is dynamic loading: workspace discovers/imports plugin entries at runtime from package manifests instead of carrying a static workspace→bash edge.
- **Tests:** `exec_ui openFile` opens the moved panel (playground); `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants` green; static-import guard green.
- **Acceptance:** workspace consumes the moved plugin through the plugin pipeline; guardrails prevent a future static workspace→bash import.

### BBP4-015 — Move bash/file tool renderers into `boring-bash/plugin` [size M]

- **Files move/split:** move the bash/file renderer implementations and tests for renderer ids `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls` out of `packages/agent/src/front/toolRenderers.tsx` and `packages/agent/src/front/bareToolRenderers/` into `packages/boring-bash/src/plugin/tool-renderers/` (exact subfolder free to choose). Preserve `DiffView` if the moved bare `edit` renderer still needs it. Leave only provider-neutral renderer model/fallback plumbing in `packages/agent/src/front` (e.g. `ToolPart`, `toToolPart`, `resolveToolRendererForPart`, generic fallback, and UI-owned `exec_ui`/`get_ui_state` renderers if those remain workspace/agent UI bridge capabilities rather than bash).
- **Files touch:** `packages/boring-bash/src/plugin/index.ts` registers the moved renderers with `definePlugin({ toolRenderers: [...] })`. Use the existing workspace plugin field: `packages/workspace/src/plugin.ts` exports `definePlugin`; `packages/workspace/src/shared/plugins/frontFactory.ts` defines `BoringFrontToolRendererRegistration`, `BoringFrontAPI.registerToolRenderer`, and `DefinePluginConfig.toolRenderers`. `packages/agent/src/front/toolRenderers.tsx` must no longer default-register `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`.
- **Notes:** Keep visual behavior and renderer ids unchanged when bash is attached. The capability-residue invariant is the acceptance driver: a pure-mode front cannot show bash/read/write/edit/find/grep/ls-specific cards because that vocabulary belongs to the bash capability. Generic fallback rendering is fine.
- **Tests:** move/update `packages/agent/src/front/__tests__/toolRenderers*.test.tsx` and `packages/agent/src/front/bareToolRenderers/__tests__/*` coverage so bash-enabled plugin registration renders the same cards; add a pure-mode/front-base test that the default renderer map lacks `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`; keep plugin capture test proving `toolRenderers` are registered through `definePlugin`.
- **Acceptance:** attached bash plugin renders all seven bash/file tool ids identically to today; detached/pure front has no filesystem/bash renderer registrations.

### BBP4-016 — Move file composer providers to the bash plugin (#26) [size M]

- **Files touch/move:** introduce a small provider-neutral composer contribution seam in the public workspace/agent front boundary (name free to implementation; e.g. `registerComposerProvider` / `composerProviders` analogous to `toolRenderers`) and move the file provider out of `packages/agent/src/front/useComposerPickers.ts`, `packages/agent/src/front/primitives/mention-picker.tsx`, `packages/agent/src/front/chatSubmit.ts`, and `packages/agent/src/front/chat/components/PiChatComposerSurface.tsx` into `packages/boring-bash/src/plugin/composer/`. The moved provider owns file search (`/api/v1/files/search`), file mention token selection, `@files: ...` model-note generation, file-related slash commands, and upload/input-asset affordances (`/api/v1/files/upload` only when a writable environment sink exists) for hosts whose resolved environment facts allow them.
- **Notes:** This implements the repo-local #26 direction cited in `docs/plans/archive/pi-native-chat-ui-rewrite-plan.md`: move `@file` mentions from agent into a workspace composer provider because environment facts, not the agent core, own file context. Keep the agent front provider-neutral: it may render a generic mention/slash picker supplied by providers, but it must not know that `@` means files, must not call `/api/v1/files/search`, and must not synthesize `@files:` in pure mode. The provider is gated by resolved environment facts and the input-asset intake strategy: readable filesystem facts enable search/mentions; a writable `acceptsInputAssets` sink enables workspace-backed upload; provider-direct intake may enable direct assets without `/api/v1/files/upload`. Missing facts mean no provider, not a disabled file UI.
- **Tests:** existing mention-picker/useComposerPickers/chatSubmit tests move or are rewritten under boring-bash; add a pure-mode ChatPanel/composer test that no file mention provider appears, no file upload button is enabled, no `/api/v1/files/search` request is made, and submitting a draft does not append `@files:`; add a bash-enabled test that file mentions/search/uploads preserve current behavior and filesystem identity.
- **Acceptance:** file mentions, file slash commands, workspace/file upload affordances, and `@files:` enrichment exist only when `boring-bash/plugin` is attached and resolved environment facts allow them; pure-mode front has zero filesystem vocabulary in the composer. Provider-neutral direct input-asset affordances may appear when host/provider policy permits provider-direct intake and must not call `/api/v1/files/upload` or synthesize `@files:`.

### BBP4-017 — Files-pane mount discovery affordance (#550 gap 5) [size S] — **Amendment (2026-07-06)**

- **Files touch/create:** the moved file-tree pane (`packages/boring-bash/src/plugin/filesystem/front/file-tree/*` post-BBP4-011) + its tests.
- **Notes:** No affordance in the Files pane advertises that a company-context mount exists or is filtered — users find it by exploring. Add a **capability-gated file-tree affordance**: a labeled mount node (and/or an empty-state hint) for governed mounts, driven by `/governance/me`. Capability-gated means: no governance capability → no affordance, no `/governance/me` request, zero governance vocabulary in pure mode (the capability-residue invariant). Discovery only — the affordance never becomes a second visibility decision path; what the user can see still resolves solely through `getFilesystemBindings` (UI/agent parity, 475 watch-list).
- **Tests:** with a governed company-context mount, the tree shows the labeled mount node / filtered empty-state hint sourced from `/governance/me`; without governance, no affordance and no `/governance/me` request; visible paths remain identical to the binding-resolved set.
- **Acceptance:** users can discover that a governed mount exists/is filtered from the Files pane; pure mode is unchanged; no second visibility path.

## Verification — exact commands verified against package.json scripts

```bash
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run check:invariants

pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants

pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test

pnpm --filter workspace-playground run test:e2e

pnpm lint:invariants     # root: agent + boring-bash + workspace-plugin
pnpm audit:imports
pnpm typecheck

# Manual proof (workspace playground): file tree renders; open code/markdown/media/html/pdf panes;
# exec_ui openFile focuses the right panel; agent write updates an open pane via agentFileBridge.
# Rebuild dist before driving the playground (see run-workspace-playground recipe).
```

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../../../391/runtime-refactor/PR-PLAN.md) P4 rows exactly:

- `pr1-plugin-subpath-sdk` → BBP4-010.
- `pr2-move-front-plugin` → BBP4-011 + BBP4-012, split as pr2a/pr2b/pr2c if move churn crosses the pre-declared threshold.
- `BBP4-013` has **no PR** in this epic; its only closeout proof is that no document-authority seam was added and the follow-up is filed by P8 BBP8-004.
- `pr3-move-tool-renderers` → BBP4-015.
- `pr4-composer-providers` → BBP4-016.
- `pr5-remove-static-registration` → BBP4-014.
- `pr6-mount-discovery` → BBP4-017 (Amendment 2026-07-06; new small PR — it is post-move front behavior, so it cannot fold into the pure-move PRs).

## Review gates

- Phase 3 present (write/edit tools + routes in boring-bash), else STOP+report.
- Panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and `workspace.open.path` resolve output unchanged.
- `boring-bash/plugin` imports the public workspace plugin SDK directly; workspace↔boring-bash cycle safety is enforced by the opposite static edge check. Gate: `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` returns no matches. Workspace bridge stays workspace-owned; the `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` helper values are imported from the public workspace SDK, not passed through an adapter.
- `definePlugin({ toolRenderers })` carries the bash/file renderers; pure-mode front default renderers do not include `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`.
- File mention/slash composer providers are gated by resolved environment facts and input-asset intake; pure-mode front has no `/api/v1/files/search` dependency, workspace upload affordance, `@files:` note, or file slash command.
- Company file-tree root + capability-based readonly panes preserved.
- Tree data is a single internal function (no provider interface — deferred to #295), current tree shape unchanged; the document-authority write/edit override is **deferred out of this epic** (BBP4-013) — `write`/`edit` stay raw file ops, no hook/interface/null-authority added.
- `pnpm lint:invariants` + `pnpm audit:imports` + workspace plugin-invariants green.
