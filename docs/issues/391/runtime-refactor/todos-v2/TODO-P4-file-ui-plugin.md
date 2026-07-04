# TODO-P4 — Move filesystem front plugin to `@hachej/boring-bash/plugin`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 4 deliverables/exit (move front plugin; preserve panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session changes; factor tree data into a plain internal tree function — the pluggable `FileTreeDataProvider` boundary is **deferred to #295** (BBP4-012); the document-authority override seam is **deferred out of this epic** (BBP4-013)).
- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — "File tree and document authority" (`FileTreeDataProvider` for #295; document-authority override for #367/#226 — **the override is deferred out of this epic**, see BBP4-013); "UI plugin ownership" (workspace bridge stays workspace-owned).
- `docs/issues/391/runtime-refactor/00-global-isa.md` — issues supported by extension points: #295 file-tree replacement, #367/#226 document collaboration.

### Depends on

- **Phase 3** (`TODO-P3-routes-tools-move.md`): file routes + `write`/`edit` tools already in `boring-bash/server` + `boring-bash/agent`. (The document-authority seam that would hook the moved `write`/`edit` tools is **deferred out of this epic** — BBP4-013; P4 leaves those tools as raw file ops.)

### Front plugin inventory in `packages/workspace` (Phase 4 move targets)

Root: `packages/workspace/src/plugins/filesystemPlugin/`
- `front/index.ts` — `filesystemFront: BoringFrontSetup` + `definePlugin({ id: FILESYSTEM_PLUGIN_ID, … })`; registers provider, bindings, workspace source (`FILES_LEFT_TAB_ID`), panels, surface resolver, catalog. Imports `definePlugin`/`BoringFrontSetup` from `../../../shared/plugins/frontFactory`, `postUiCommand` from `../../../front/bridge`, `useCatalogRegistry` from `../../../front/registry`.
- `front/surfaceResolver.ts` — `filesystemSurfaceResolver` (`kind: WORKSPACE_OPEN_PATH_SURFACE_KIND`, id `FILESYSTEM_SURFACE_RESOLVER_ID = "filesystem-path"`); glob→panel matching.
- `front/filePanelBinding.tsx`, `front/agentFileBridge.tsx` (`emitFilesystemAgentFileChange`, `useAutoOpenAgentFiles`, `onFilesystemChanged`), `front/useFilePane.ts`, `front/FilePaneShell.tsx`, `front/ConflictBanner.tsx`, `front/catalogs.ts`, `front/events.ts`, `front/search.ts`.
- Panes: `front/file-tree/*` (`FileTreeView.tsx` `FileTreePane`+`preloadFileTreeComponent`, `FileTree.tsx`, `treeModel.ts`, `clipboard.ts`, `dndManager.ts`), `front/code-editor/*` (CodeMirror), `front/markdown-editor/*` (**TipTap** — `MarkdownEditor.tsx`, `ResizableImage.tsx`), `front/media-viewer/*`, `front/html-viewer/*`, `front/empty-file-panel/*`.
- Data layer: `front/data/*` (`DataProvider.tsx`, `fetchClient.ts`, `hooks.ts`, `fileRecords.ts`, `useFileEventStream.ts`, `useFileEventInvalidation.ts`, `useFileUpload.ts`, `treePreloadCache.ts`, `types.ts`, `index.ts`, `filesystemErrorRedaction.ts`).
- Shared: `shared/constants.ts` (`FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, `FILES_CATALOG_ID`, `FILESYSTEM_SURFACE_RESOLVER_ID`, panel ids: `CODE_EDITOR_PANEL_ID`, `CSV_VIEWER_PANEL_ID`, `MARKDOWN_EDITOR_PANEL_ID`, `IMAGE_VIEWER_PANEL_ID`, `PDF_VIEWER_PANEL_ID`, `HTML_VIEWER_PANEL_ID`, `EMPTY_FILE_PANEL_ID`), `shared/events.ts`.

UI `(filesystem, path)` addressing (workspace-owned shared, ships from #416):
- `packages/workspace/src/shared/types/filesystem.ts` — type `FilesystemId`; **runtime VALUES** `USER_FILESYSTEM_ID` (constant), `normalizeUiFilesystem()` (function), `uiFileResourceKey()` (function); `(filesystem, path)` parse/serialize (`filesystem:path`). **Company file-tree root + capability-based readonly panes** are built on these. Preserve. The three VALUES are passed to the plugin through the `BashPluginHost` adapter (they are not type-only importable). The pure types are **NOT imported from workspace at all** (not even type-only — that still forms a package edge → cycle); the plugin declares them as **local structural types** (see BBP4-011).

Registration/consumers to repoint (grep-verified):
- `packages/workspace/src/index.ts` (L61 exports `filesystemPlugin`), `packages/workspace/src/app/front/workspaceBuiltinPlugins.ts` (L17), `packages/workspace/src/front/provider/WorkspaceProvider.tsx` (L529-531 default-plugins list).

### Document-authority current state (investigated — context; the seam is DEFERRED)

- There is **no** server-side document coordinator / Yjs today. `write`/`edit` are raw file ops (now in `boring-bash/agent` after Phase 3).
- Front editors: `markdown-editor/*` uses **TipTap** (front-only, in-browser); `code-editor/*` uses CodeMirror. Stale-write/conflict handling exists on the front via `ConflictBanner.tsx` + `useFilePane.ts` + the `data/` layer; `agentFileBridge.tsx` emits/consumes file-change events so open panes react to agent writes.
- The document-authority override (#367/#226) would be a **greenfield server seam**, but it has **zero real consumers in this epic** (no live document system exists). Per the no-speculative-abstraction rule it is **deferred out of #391** and arrives with its first real authority implementation (see BBP4-013). P4 leaves `write`/`edit` as raw file ops and adds no seam. Do not build TipTap↔Yjs collaboration or a null/default authority here.

## Goal / exit criteria

Filesystem front plugin lives in `@hachej/boring-bash/plugin`, registered by workspace with no package cycle; panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session-change integration + Company file-tree root + capability-based readonly panes preserved; tree data factored into a plain internal function (the pluggable `FileTreeDataProvider` boundary is deferred to #295); the document-authority write/edit override is **deferred out of this epic** (BBP4-013). Exit (06 Phase 4):

- `exec_ui openFile` still opens files (same panel ids, same resolver).
- file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295).
- (document-authority override deferred out of this epic — `write`/`edit` stay raw file ops; the seam arrives with #367/#226.)

## Non-negotiables

- Preserve panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and the `workspace.open.path` resolve output (`id: file:<path>`, component, params) verbatim.
- Preserve file panel binding, `agentFileBridge` exports, session-change integration, catalog, and existing user workflows.
- Preserve Company file-tree root + capability-based readonly panes landed via #416.
- **No cycle — no imports at all:** `boring-bash/plugin` must import **NOTHING** from `@hachej/boring-workspace` — not values and **not even `import type`**. A type-only import still creates a package **dependency edge** (TypeScript project reference + resolution), which closes the `workspace → boring-bash/plugin → workspace` cycle. So pure type shapes the plugin needs (`FilesystemId`, `frontFactory`/`bridge`/`registry`/surface types) become **local structural types** — either duplicated verbatim in `boring-bash/plugin` (duplicating a small stable shape is fine and preferred here — note *why*: breaking the edge is worth the copy) or hoisted into `boring-bash/shared`. Runtime helper **values** continue to arrive via the `BashPluginHost` adapter (they were never importable anyway). Workspace may import/register/re-export the boring-bash plugin (one-way workspace→boring-bash).
- Workspace bridge stays workspace-owned; the plugin consumes bridge commands (`postUiCommand`) through the host adapter.
- Missing boring-bash capability → clear UI diagnostic, not a broken panel.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per todos-v2/README.
- Do not build TipTap/Yjs real-time collaboration; and do not add the document-authority seam either — it is deferred out of this epic (BBP4-013).
- Do not change server routes again (Phase 3 owns them); do not re-shape #416 contracts.
- Do not introduce a workspace value import into boring-bash (would create a cycle).

## Beads

### BBP4-010 — Establish `/plugin` subpath + neutral host adapter [size M]

- **Files touch/create:** replace stub `packages/boring-bash/src/plugin/index.ts` (`export {}`); `packages/boring-bash/package.json` (add `"./plugin"` export, front-safe — no `node:*`/`Buffer`); `packages/boring-bash/tsup.config.ts` (add entry, browser/react externals); `packages/boring-bash/scripts/check-invariants.mjs` (`requiredExports` += `"./plugin"`; extend the shared/front-safe scan to cover `src/plugin/**`).
- **Notes:** Define a `BashPluginHost` structural adapter interface capturing what the plugin needs from the workspace: `frontFactory` (`definePlugin`/`BoringFrontSetup` shapes), `bridge` (`postUiCommand`), `registry` (`useCatalogRegistry`), surface types (`SurfaceResolverConfig`, `WORKSPACE_OPEN_PATH_SURFACE_KIND`), **and the UI `(filesystem, path)` helper VALUES the plugin calls at runtime — `normalizeUiFilesystem`, `USER_FILESYSTEM_ID`, `uiFileResourceKey`**. The structural *type* shapes (`frontFactory`/`bridge`/`registry`/surface types) are **NOT imported from `@hachej/boring-workspace` at all — not even `import type`** (a type-only import still creates a package edge → cycle). They become **local structural types** in `boring-bash/plugin` (duplicated shapes — fine for small stable contracts) or in `boring-bash/shared`. The runtime helper VALUES `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` (a function, a constant, a function) are **passed through the `BashPluginHost` adapter at plugin registration** (the workspace, which owns `shared/types/filesystem.ts`, supplies them as adapter fields), keeping `boring-bash/plugin`→workspace with **zero** import edges. React is a peer dep — add to `packages/boring-bash/package.json` `peerDependencies` (mirror workspace's react peer setup).
- **Tests:** export-map test imports `/plugin`; invariants (incl. front-safe scan on `src/plugin/**`) green.
- **Acceptance:** `/plugin` subpath resolves front-safe; host-adapter contract exists.

### BBP4-011 — Move filesystem front plugin files [size L]

- **Files move:** entire `packages/workspace/src/plugins/filesystemPlugin/front/*` and `shared/*` → `packages/boring-bash/src/plugin/filesystem/{front,shared}/*` (keep sub-structure: `file-tree/`, `code-editor/`, `markdown-editor/`, `media-viewer/`, `html-viewer/`, `empty-file-panel/`, `data/`, and their `__tests__/`).
- **Files touch:** repoint the three workspace-internal imports in `front/index.ts` (`../../../shared/plugins/frontFactory`, `../../../front/bridge`, `../../../front/registry`) and `surfaceResolver.ts` (`../../../shared/types/surface`) to the `BashPluginHost` adapter (BBP4-010) rather than deep workspace paths. `packages/workspace/src/index.ts`, `app/front/workspaceBuiltinPlugins.ts`, `front/provider/WorkspaceProvider.tsx`: import `filesystemPlugin` from `@hachej/boring-bash/plugin` and register it (passing the host adapter). `packages/workspace/src/shared/types/filesystem.ts` **stays workspace-owned** (binding decision — no discretion). Split the plugin's consumption of it by kind, but with **zero import edges into workspace**: the pure **types** (`FilesystemId`, etc.) are **NOT imported from workspace even type-only** (a type-only import still forms a package edge → cycle) — they become **local structural types** (duplicated verbatim in `boring-bash/plugin`, or hoisted to `boring-bash/shared`); the **helper VALUES `normalizeUiFilesystem`, `USER_FILESYSTEM_ID`, `uiFileResourceKey`** are functions/constants the plugin calls at runtime, so the plugin receives them as **VALUES passed through the `BashPluginHost` adapter (BBP4-010) at registration**, never via any import into workspace. Do NOT relocate `filesystem.ts` to `boring-bash/plugin/shared` (it stays workspace-owned; the plugin just re-declares the shape it needs). Verify with `grep -rn "@hachej/boring-workspace\|shared/types/filesystem" packages/boring-bash/src/plugin` — it must return **no matches** (no import of any kind from workspace); the plugin declares types locally and takes the three helper **values** through the adapter.
- **Notes:** Preserve every panel id, `FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, catalog registration, and the `filesystemSurfaceResolver` output. Preserve Company file-tree root + capability-based readonly panes (in `file-tree/FileTreeView.tsx`, `FilePaneShell.tsx`, `useFilePane.ts`, `code-editor/CodeEditorPane.tsx`).
- **Tests:** move the plugin's `__tests__` (`filesystemPlugin.test.ts`, `filePanelBinding.test.tsx`, `agentFileBridge.test.tsx`, `useFilePane.test.tsx`, `search.test.ts`, `FileTree*.test.tsx`, editor tests) into boring-bash and pass; workspace↔boring-bash acyclicity check passes.
- **Acceptance:** file UI runs from boring-bash with unchanged panel ids/resolver and no package cycle; `boring-bash/plugin` imports **NOTHING** from `@hachej/boring-workspace` (not even `import type`) — pure types are local structural declarations and the runtime helpers `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` reach the plugin as **values via the `BashPluginHost` adapter**; `grep -rn "@hachej/boring-workspace" packages/boring-bash/src/plugin` returns no matches.

### BBP4-012 — Extract a plain internal tree function/type (provider boundary deferred to #295) [size S]

- **Descope (binding):** do **not** ship a `FileTreeDataProvider` interface — no delta-streaming provider abstraction with a single implementation. The "abstraction needs two real consumers" rule (`todos-v2/README.md`) is not met: #295 (Pierre Trees swap) is the only would-be second consumer and it is **not scheduled yet**. Ship the current tree behind a plain internal function + type, not a pluggable boundary.
- **Files create/touch:** in `packages/boring-bash/src/plugin/filesystem/front/file-tree/`, factor the current tree fetch into a plain internal function/type (e.g. `loadFileTree(root, options)` returning the existing tree shape) over the current `data/` hooks + `useFileEventStream`; point `FileTreeView.tsx` / `FileTree.tsx` / `treeModel.ts` at it. No `subscribe(): AsyncIterable<FileTreeDelta>` interface, no registry, no second impl.
- **Notes:** Keep behavior identical — respects the existing adapter path validation, source-of-truth metadata, hidden/denied-file handling, symlink policy, and current pagination. The **pluggable `FileTreeDataProvider` boundary is deferred until #295 is actually scheduled** (add it then, with Pierre Trees as the second real consumer).
- **NO-INOTIFY contract (X1 Decision 7; `10-sandbox-deployment-eu.md`):** the file-tree/editor refresh path **must not rely on inotify** when the backing environment is a FUSE / virtiofs / gVisor-bind mount (inotify is unreliable on all three) — refresh via **polling or a host event bridge** when the mount's capability facts report `noInotify`/`pollRequired` (`@hachej/boring-sandbox` BBX1-004). `useFileEventStream` must degrade to polling on those mounts, not silently miss changes.
- **Tests:** the plain function returns the current tree shape; hidden/denied files absent from the agent-visible tree; existing tree tests stay green.
- **Acceptance:** the tree data path is a single internal function (no provider interface); behavior unchanged; the provider boundary is explicitly noted as deferred to #295.

### BBP4-013 — Document-authority write/edit override hook (#367/#226) — DEFERRED (out of this epic)

- **Descope (binding):** the document-authority write/edit override hook has **zero real consumers** in this epic — there is no live document system (TipTap↔Yjs/etc.) today. Per the "abstraction needs two real consumers" rule (`todos-v2/README.md`), it is **not built here** — not even a nullable hook, since a single-consumer-that-does-not-yet-exist is speculative. The seam **arrives with its first real authority implementation (#367/#226 live-document collaboration)**, out of #391 scope; it is filed as a tracked follow-up at P8 (`TODO-P8` BBP8-004). Until then, `write`/`edit` remain the raw file ops moved in Phase 3, unchanged. P4 adds no `DocumentAuthority` interface, no `documentAuthority?` field, no default null authority, and no registry.
- **Acceptance:** P4 ships **no** document-authority seam; `write`/`edit` are raw file ops (Phase-3 behavior); the seam is filed as a post-epic follow-up (#367/#226) at P8.

### BBP4-014 — Repoint workspace registration + acyclicity guard [size S]

- **Files touch:** migrate the grep-listed importers to `@hachej/boring-bash/plugin` **in the same PR** and delete the old workspace export — **no back-compat re-export** (no-compat policy, `todos-v2/README.md`). Concretely: `packages/workspace/src/index.ts` (delete the `filesystemPlugin` export, do NOT re-export it from boring-bash), `app/front/workspaceBuiltinPlugins.ts` and `front/provider/WorkspaceProvider.tsx` (import `filesystemPlugin` from `@hachej/boring-bash/plugin` directly and register it with the host adapter). Re-run `grep -rn "filesystemPlugin" packages apps plugins` to catch any other importer and migrate it in the same PR. Extend `packages/boring-bash/scripts/check-invariants.mjs` and/or `scripts/audit-imports.ts` + `packages/workspace/scripts/check-plugin-invariants.mjs` to assert no `boring-bash/plugin → @hachej/boring-workspace` value import and no cycle.
- **Notes:** Missing boring-bash capability must yield a clear UI diagnostic panel, not a crash. Migration surfaces as a build error if an importer was missed — never a silent shim.
- **Tests:** `exec_ui openFile` opens the moved panel (playground); `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants` green; acyclicity assertion green.
- **Acceptance:** workspace consumes the moved plugin cleanly; guardrails prevent a future cycle.

## Verification — exact commands verified against package.json scripts

```bash
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run check:invariants

pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants

pnpm lint:invariants     # root: agent + boring-bash + workspace-plugin
pnpm audit:imports
pnpm typecheck

# Manual proof (workspace playground): file tree renders; open code/markdown/media/html/pdf panes;
# exec_ui openFile focuses the right panel; agent write updates an open pane via agentFileBridge.
# Rebuild dist before driving the playground (see run-workspace-playground recipe).
```

## Review gates

- Phase 3 present (write/edit tools + routes in boring-bash), else STOP+report.
- Panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and `workspace.open.path` resolve output unchanged.
- **Zero `boring-bash/plugin → @hachej/boring-workspace` imports of any kind** (no value import AND no `import type` — a type-only import still forms a package edge → cycle); pure types are local structural declarations; workspace↔boring-bash acyclic; workspace bridge still workspace-owned. The `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` helper **values** are supplied through the `BashPluginHost` adapter. Gate: `grep -rn "@hachej/boring-workspace" packages/boring-bash/src/plugin` returns no matches.
- Company file-tree root + capability-based readonly panes preserved.
- Tree data is a single internal function (no provider interface — deferred to #295), current tree shape unchanged; the document-authority write/edit override is **deferred out of this epic** (BBP4-013) — `write`/`edit` stay raw file ops, no hook/interface/null-authority added.
- `pnpm lint:invariants` + `pnpm audit:imports` + workspace plugin-invariants green.
