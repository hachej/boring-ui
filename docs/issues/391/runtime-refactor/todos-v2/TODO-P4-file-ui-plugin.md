# TODO-BBP4 — Phase 4: move filesystem front plugin to `@hachej/boring-bash/plugin`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 4 deliverables/exit (move front plugin; preserve panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session changes; add `FileTreeDataProvider`; add document-authority override seam).
- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — "File tree and document authority" (`FileTreeDataProvider` for #295; document-authority override for #367/#226); "UI plugin ownership" (workspace bridge stays workspace-owned).
- `docs/issues/391/runtime-refactor/00-global-isa.md` — issues supported by extension points: #295 file-tree replacement, #367/#226 document collaboration.
- `docs/issues/391/runtime-refactor/todos/TODO-03-routes-tools-ui.md` — v1 beads BBA-034..036 (superseded here).

### Depends on

- **Phase 3** (`TODO-P3-routes-tools-move.md`): file routes + `write`/`edit` tools already in `boring-bash/server` + `boring-bash/agent`. The document-authority seam (BBP4-013) hooks the moved `write`/`edit` tools.

### Front plugin inventory in `packages/workspace` (Phase 4 move targets)

Root: `packages/workspace/src/plugins/filesystemPlugin/`
- `front/index.ts` — `filesystemFront: BoringFrontSetup` + `definePlugin({ id: FILESYSTEM_PLUGIN_ID, … })`; registers provider, bindings, workspace source (`FILES_LEFT_TAB_ID`), panels, surface resolver, catalog. Imports `definePlugin`/`BoringFrontSetup` from `../../../shared/plugins/frontFactory`, `postUiCommand` from `../../../front/bridge`, `useCatalogRegistry` from `../../../front/registry`.
- `front/surfaceResolver.ts` — `filesystemSurfaceResolver` (`kind: WORKSPACE_OPEN_PATH_SURFACE_KIND`, id `FILESYSTEM_SURFACE_RESOLVER_ID = "filesystem-path"`); glob→panel matching.
- `front/filePanelBinding.tsx`, `front/agentFileBridge.tsx` (`emitFilesystemAgentFileChange`, `useAutoOpenAgentFiles`, `onFilesystemChanged`), `front/useFilePane.ts`, `front/FilePaneShell.tsx`, `front/ConflictBanner.tsx`, `front/catalogs.ts`, `front/events.ts`, `front/search.ts`.
- Panes: `front/file-tree/*` (`FileTreeView.tsx` `FileTreePane`+`preloadFileTreeComponent`, `FileTree.tsx`, `treeModel.ts`, `clipboard.ts`, `dndManager.ts`), `front/code-editor/*` (CodeMirror), `front/markdown-editor/*` (**TipTap** — `MarkdownEditor.tsx`, `ResizableImage.tsx`), `front/media-viewer/*`, `front/html-viewer/*`, `front/empty-file-panel/*`.
- Data layer: `front/data/*` (`DataProvider.tsx`, `fetchClient.ts`, `hooks.ts`, `fileRecords.ts`, `useFileEventStream.ts`, `useFileEventInvalidation.ts`, `useFileUpload.ts`, `treePreloadCache.ts`, `types.ts`, `index.ts`, `filesystemErrorRedaction.ts`).
- Shared: `shared/constants.ts` (`FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, `FILES_CATALOG_ID`, `FILESYSTEM_SURFACE_RESOLVER_ID`, panel ids: `CODE_EDITOR_PANEL_ID`, `CSV_VIEWER_PANEL_ID`, `MARKDOWN_EDITOR_PANEL_ID`, `IMAGE_VIEWER_PANEL_ID`, `PDF_VIEWER_PANEL_ID`, `HTML_VIEWER_PANEL_ID`, `EMPTY_FILE_PANEL_ID`), `shared/events.ts`.

UI `(filesystem, path)` addressing (workspace-owned shared, ships from #416):
- `packages/workspace/src/shared/types/filesystem.ts` — `FilesystemId`, `USER_FILESYSTEM_ID`, `normalizeUiFilesystem()`, `(filesystem, path)` parse/serialize (`filesystem:path`). **Company file-tree root + capability-based readonly panes** are built on this. Preserve.

Registration/consumers to repoint (grep-verified):
- `packages/workspace/src/index.ts` (L61 exports `filesystemPlugin`), `packages/workspace/src/app/front/workspaceBuiltinPlugins.ts` (L17), `packages/workspace/src/front/provider/WorkspaceProvider.tsx` (L529-531 default-plugins list).

### Document-authority current state (investigated — ground for BBP4-013)

- There is **no** server-side document coordinator / Yjs today. `write`/`edit` are raw file ops (now in `boring-bash/agent` after Phase 3).
- Front editors: `markdown-editor/*` uses **TipTap** (front-only, in-browser); `code-editor/*` uses CodeMirror. Stale-write/conflict handling exists on the front via `ConflictBanner.tsx` + `useFilePane.ts` + the `data/` layer; `agentFileBridge.tsx` emits/consumes file-change events so open panes react to agent writes.
- Therefore the document-authority override (#367/#226) is a **greenfield server seam**: an interface a live document system can register to intercept `write`/`edit`, validate stale version/hash, and fall back to raw file edit when no authority is active. Do not build TipTap↔Yjs collaboration here — only the seam + a null/default authority.

## Goal / exit criteria

Filesystem front plugin lives in `@hachej/boring-bash/plugin`, registered by workspace with no package cycle; panel ids + `workspace.open.path` resolver + file panel binding + agent file bridge/session-change integration + Company file-tree root + capability-based readonly panes preserved; `FileTreeDataProvider` boundary added; document-authority write/edit override seam added. Exit (06 Phase 4):

- `exec_ui openFile` still opens files (same panel ids, same resolver).
- file tree can consume a provider boundary (default = current tree).
- an active document coordinator can intercept writes; raw edits work when none is active.

## Non-negotiables

- Preserve panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and the `workspace.open.path` resolve output (`id: file:<path>`, component, params) verbatim.
- Preserve file panel binding, `agentFileBridge` exports, session-change integration, catalog, and existing user workflows.
- Preserve Company file-tree root + capability-based readonly panes landed via #416.
- **No cycle:** `boring-bash/plugin` must NOT value-import `@hachej/boring-workspace`. It receives a structural host adapter / neutral plugin SDK (`frontFactory`, `bridge`, `registry`, surface types). Workspace may import/register/re-export the boring-bash plugin (one-way workspace→boring-bash).
- Workspace bridge stays workspace-owned; the plugin consumes bridge commands (`postUiCommand`) through the host adapter.
- Missing boring-bash capability → clear UI diagnostic, not a broken panel.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree. Do not commit.
- Do not build TipTap/Yjs real-time collaboration; only the document-authority seam + default null authority.
- Do not change server routes again (Phase 3 owns them); do not re-shape #416 contracts.
- Do not introduce a workspace value import into boring-bash (would create a cycle).

## Beads

### BBP4-010 — Establish `/plugin` subpath + neutral host adapter [size M]

- **Files touch/create:** replace stub `packages/boring-bash/src/plugin/index.ts` (`export {}`); `packages/boring-bash/package.json` (add `"./plugin"` export, front-safe — no `node:*`/`Buffer`); `packages/boring-bash/tsup.config.ts` (add entry, browser/react externals); `packages/boring-bash/scripts/check-invariants.mjs` (`requiredExports` += `"./plugin"`; extend the shared/front-safe scan to cover `src/plugin/**`).
- **Notes:** Define a `BashPluginHost` structural adapter interface capturing what the plugin needs from the workspace: `frontFactory` (`definePlugin`/`BoringFrontSetup` shapes), `bridge` (`postUiCommand`), `registry` (`useCatalogRegistry`), and surface types (`SurfaceResolverConfig`, `WORKSPACE_OPEN_PATH_SURFACE_KIND`). Import these **type-only** from `@hachej/boring-workspace` if that stays acyclic (workspace does not value-import boring-bash/plugin); otherwise duplicate a minimal neutral SDK type. React is a peer dep — add to `packages/boring-bash/package.json` `peerDependencies` (mirror workspace's react peer setup).
- **Tests:** export-map test imports `/plugin`; invariants (incl. front-safe scan on `src/plugin/**`) green.
- **Acceptance:** `/plugin` subpath resolves front-safe; host-adapter contract exists.

### BBP4-011 — Move filesystem front plugin files [size L]

- **Files move:** entire `packages/workspace/src/plugins/filesystemPlugin/front/*` and `shared/*` → `packages/boring-bash/src/plugin/filesystem/{front,shared}/*` (keep sub-structure: `file-tree/`, `code-editor/`, `markdown-editor/`, `media-viewer/`, `html-viewer/`, `empty-file-panel/`, `data/`, and their `__tests__/`).
- **Files touch:** repoint the three workspace-internal imports in `front/index.ts` (`../../../shared/plugins/frontFactory`, `../../../front/bridge`, `../../../front/registry`) and `surfaceResolver.ts` (`../../../shared/types/surface`) to the `BashPluginHost` adapter (BBP4-010) rather than deep workspace paths. `packages/workspace/src/index.ts`, `app/front/workspaceBuiltinPlugins.ts`, `front/provider/WorkspaceProvider.tsx`: import `filesystemPlugin` from `@hachej/boring-bash/plugin` and register it (passing the host adapter). Decide `packages/workspace/src/shared/types/filesystem.ts`: keep workspace-owned and import type-only from boring-bash, OR relocate the UI `(filesystem,path)` helpers to `boring-bash/plugin/shared` — pick the acyclic option and note it (recommend: keep in workspace, re-used type-only, to avoid churn on non-plugin consumers; verify consumers with grep).
- **Notes:** Preserve every panel id, `FILESYSTEM_PLUGIN_ID`, `FILES_LEFT_TAB_ID`, catalog registration, and the `filesystemSurfaceResolver` output. Preserve Company file-tree root + capability-based readonly panes (in `file-tree/FileTreeView.tsx`, `FilePaneShell.tsx`, `useFilePane.ts`, `code-editor/CodeEditorPane.tsx`).
- **Tests:** move the plugin's `__tests__` (`filesystemPlugin.test.ts`, `filePanelBinding.test.tsx`, `agentFileBridge.test.tsx`, `useFilePane.test.tsx`, `search.test.ts`, `FileTree*.test.tsx`, editor tests) into boring-bash and pass; workspace↔boring-bash acyclicity check passes.
- **Acceptance:** file UI runs from boring-bash with unchanged panel ids/resolver and no package cycle.

### BBP4-012 — Add `FileTreeDataProvider` boundary (#295) [size M]

- **Files create:** `packages/boring-bash/src/plugin/filesystem/front/file-tree/FileTreeDataProvider.ts` (interface `listTree(root, options)`, optional `listPaths(root, options)`, optional `subscribe(root): AsyncIterable<FileTreeDelta>` — per 02); a default provider adapting the current `data/` hooks + `useFileEventStream`.
- **Files touch:** `file-tree/FileTreeView.tsx` / `FileTree.tsx` / `treeModel.ts` to read tree data through the provider instead of hardwired hooks; keep the current provider as default (no behavior change).
- **Notes:** Provider must respect adapter path validation, source-of-truth metadata, hidden/denied files, symlink policy, large-tree pagination. Enables Pierre Trees swap without route changes. May expose agent-visible vs user-visible view when they differ.
- **Tests:** default provider returns current tree shape; path-list handles large trees (pagination); delta subscription updates UI; hidden/denied files absent from agent-visible tree.
- **Acceptance:** file tree rendering is replaceable without touching file-route ownership.

### BBP4-013 — Add document-authority write/edit override seam (#367/#226) [size M]

- **Files create:** `packages/boring-bash/src/agent/documentAuthority.ts` — `DocumentAuthority` interface (`ownsFile(filesystem, path): boolean`; `applyEdit({ filesystem, path, expectedVersionOrHash, content|edits }): Promise<{ ok } | { rejected, reason }>`) + a `DocumentAuthorityRegistry` (default empty). Optional front surface hook if a pane must publish authority.
- **Files touch:** the moved `write`/`edit` tools in `packages/boring-bash/src/agent/tools/filesystem/index.ts` (from Phase 3): before raw write/edit, consult the registry — if a doc authority owns the file, route through it, validate stale version/hash, reject stale with a stable error; else fall back to raw file edit (current behavior). Surface the authority decision in tool output/audit details.
- **Notes:** Greenfield seam — do NOT implement Yjs/TipTap collaboration. Default = no authority registered → behavior identical to Phase 3. Reuse the existing front stale-write handling (`ConflictBanner.tsx`, `useFilePane.ts`) as the UI counterpart; this bead only adds the server/tool seam.
- **Tests:** with a stub authority registered, edit routes through it; stale version rejects with stable error; with none registered, raw write/edit works unchanged; coordinator failure returns a stable diagnostic and does not corrupt file state.
- **Acceptance:** agent file tools respect a live document authority when present; raw edits unaffected when absent.

### BBP4-014 — Repoint workspace registration + acyclicity guard [size S]

- **Files touch:** `packages/workspace/src/index.ts` (re-export `filesystemPlugin` from `@hachej/boring-bash/plugin` for back-compat, one-way), `app/front/workspaceBuiltinPlugins.ts`, `front/provider/WorkspaceProvider.tsx`; `packages/boring-bash/scripts/check-invariants.mjs` and/or `scripts/audit-imports.ts` + `packages/workspace/scripts/check-plugin-invariants.mjs` to assert no `boring-bash/plugin → @hachej/boring-workspace` value import and no cycle.
- **Notes:** Missing boring-bash capability must yield a clear UI diagnostic panel, not a crash.
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
- No `boring-bash/plugin → @hachej/boring-workspace` value import; workspace↔boring-bash acyclic; workspace bridge still workspace-owned.
- Company file-tree root + capability-based readonly panes preserved.
- `FileTreeDataProvider` default = current tree shape; document-authority seam defaults to raw-edit parity.
- `pnpm lint:invariants` + `pnpm audit:imports` + workspace plugin-invariants green.
