> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P4-file-ui — Plan

Status: post-v1; not a #391 v1 exit gate. Capability-gate the existing
workspace-owned presentation first. Reconsider relocation only for a second
host that needs the complete editor/tree bundle.

> Phase: Phase 4 — Move filesystem front plugin (bash track) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture
- [00-global-isa.md](../../../../391/runtime-refactor/architecture/00-global-isa.md) — issues supported by extension points: #295 file-tree replacement, #367/#226 document collaboration.
- [02-boring-bash-environment.md](../../../../391/runtime-refactor/architecture/02-boring-bash-environment.md) — "File tree and document authority" (`FileTreeDataProvider` for #295; document-authority override for #367/#226, deferred out of this epic); "UI plugin ownership" (workspace bridge stays workspace-owned).

## Design context
Phase 4 moves the filesystem front plugin from `packages/workspace` into `@hachej/boring-bash/plugin`, loaded through the normal workspace plugin pipeline. `boring-bash/plugin` imports the public workspace plugin SDK directly (`@hachej/boring-workspace/plugin`, public bridge/registry/surface exports, and the filesystem helpers from `@hachej/boring-workspace/shared` or a narrower public plugin SDK export). Cycle safety comes from dynamic plugin loading: workspace-family hosts discover/import the plugin from manifest entries at runtime, so `packages/workspace/src` must have no static import from `@hachej/boring-bash`. Panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, the `workspace.open.path` resolver, file panel binding, agent file bridge/session-change integration, the bash/file tool renderers, file mention/slash composer providers, and the #416 Company file-tree root + capability-based readonly panes are all preserved verbatim. Tree data is factored into a **plain internal function** — the pluggable `FileTreeDataProvider` boundary is deferred to #295 (BBP4-012), and the document-authority write/edit override is deferred out of the epic (BBP4-013); `write`/`edit` stay raw file ops.

**Amendment (2026-07-08):** composer/upload gating reads resolved environment
facts and input-asset intake policy, not a scalar bash/filesystem capability.
Readable filesystem facts enable file mentions/search. A writable environment
with `acceptsInputAssets` enables workspace-backed upload. Provider-direct
asset support may enable direct assets without `/api/v1/files/upload`. Missing
facts mean the provider is absent.

## Verified current repo reality (pre-P4)
- `packages/boring-bash/src/plugin/index.ts` is currently a stub `export {};`; `packages/boring-bash/package.json` currently has no `./plugin` export; `packages/boring-bash/tsup.config.ts` currently has no plugin entry.
- The filesystem front plugin currently lives under `packages/workspace/src/plugins/filesystemPlugin/`, with `front/*` and `shared/*` subtrees. `packages/workspace/src/plugins/filesystemPlugin/shared/constants.ts` defines `FILES_LEFT_TAB_ID`, `FILES_CATALOG_ID`, `FILESYSTEM_SURFACE_RESOLVER_ID`, and the code/markdown/image/pdf/html/empty panel ids.
- `packages/workspace/src/shared/types/filesystem.ts` is workspace-owned and exports the runtime helper values `USER_FILESYSTEM_ID`, `normalizeUiFilesystem()`, and `uiFileResourceKey()`, plus the structural `FilesystemId` type. P4 imports these through the public workspace SDK surface from `boring-bash/plugin`; it does not move the file.
- Bash/file tool renderers currently live in `packages/agent/src/front/toolRenderers.tsx` and `packages/agent/src/front/bareToolRenderers/`. The file/bash renderer ids verified in both maps are `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`.
- The public front plugin API already supports renderer contributions: `packages/workspace/src/plugin.ts` exports `definePlugin`; `packages/workspace/src/shared/plugins/frontFactory.ts` defines `BoringFrontToolRendererRegistration`, `BoringFrontAPI.registerToolRenderer(...)`, `DefinePluginConfig.toolRenderers`, and capture storage for `toolRenderers`.
- File composer code currently lives in `packages/agent/src/front/useComposerPickers.ts`, `packages/agent/src/front/primitives/mention-picker.tsx`, `packages/agent/src/front/chatSubmit.ts`, and `packages/agent/src/front/chat/components/PiChatComposerSurface.tsx`. It searches `/api/v1/files/search`, tracks `mentionedFiles`, emits the model-facing `@files: ...` note, and uploads attachments through `/api/v1/files/upload`.
- Repo-local issue citation: `docs/plans/archive/pi-native-chat-ui-rewrite-plan.md` lists [#26](https://github.com/hachej/boring-ui/issues/26) as "Move `@file` mentions from agent into workspace composer provider"; P4 implements that direction as a capability-gated composer-provider contribution from the bash plugin.
- Current static workspace registration/export sites are `packages/workspace/src/index.ts:61-66`, `packages/workspace/src/app/front/workspaceBuiltinPlugins.ts:1` and `:17`, and `packages/workspace/src/front/provider/WorkspaceProvider.tsx:34` and `:529-531`; P4 removes those static imports/exports instead of repointing them to `@hachej/boring-bash`.
- `apps/workspace-playground/package.json` has `test:e2e`, `test`, `build`, `typecheck`, and `dev` scripts. Use `test:e2e` for checkable playground proof; use `dev` only for manual inspection.

## Deliverables
- move filesystem front plugin to `boring-bash/plugin`, importing the public workspace plugin SDK directly;
- preserve panel ids and `workspace.open.path` resolver;
- preserve file panel binding and agent file bridge/session changes **[Company file-tree root + capability-based readonly panes landed via #416 — carry over intact]**;
- move bash/file tool renderers (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`) with the bash plugin through existing `definePlugin({ toolRenderers })`; pure-mode front keeps generic fallback renderer plumbing only and ships no filesystem/bash renderer registrations;
- move file mention provider + file-related slash commands into environment-fact-gated composer providers shipped by `boring-bash/plugin`; agent front keeps generic picker/composer primitives and no `/api/v1/files/search`, `@files`, workspace upload, or filesystem vocabulary in pure mode;
- factor tree data into a plain internal tree function (the pluggable `FileTreeDataProvider` boundary is **deferred to #295**, per `../P4-file-ui/TODO.md`);
- the **document-authority override seam is deferred out of this epic** (zero real consumers — no live document system exists; it arrives with #367/#226), per `../P4-file-ui/TODO.md` BBP4-013.
- add the static edge gate: `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` returns no matches.

## Exit criteria
- `exec_ui openFile` still opens files;
- bash/file tool calls render through the boring-bash plugin when attached, and fall back generically when detached;
- pure-mode front exposes no file mention provider, file slash command, workspace upload affordance, or bash/file renderer registration;
- file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295).
- (Document-authority override deferred out of this epic — `write`/`edit` stay raw file ops.)
