# P4-file-ui — Plan

> Phase: Phase 4 — Move filesystem front plugin (bash track) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — issues supported by extension points: #295 file-tree replacement, #367/#226 document collaboration.
- [02-boring-bash-environment.md](../../architecture/02-boring-bash-environment.md) — "File tree and document authority" (`FileTreeDataProvider` for #295; document-authority override for #367/#226, deferred out of this epic); "UI plugin ownership" (workspace bridge stays workspace-owned).

## Design context
Phase 4 moves the filesystem front plugin from `packages/workspace` into `@hachej/boring-bash/plugin`, registered by workspace with **no package cycle**. The hard rule: `boring-bash/plugin` imports **NOTHING** from `@hachej/boring-workspace` — not even `import type` (a type-only import still forms a package edge → cycle). Pure type shapes become local structural types; the runtime helper VALUES (`normalizeUiFilesystem`, `USER_FILESYSTEM_ID`, `uiFileResourceKey`) arrive through the `BashPluginHost` adapter at registration. Panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, the `workspace.open.path` resolver, file panel binding, agent file bridge/session-change integration, and the #416 Company file-tree root + capability-based readonly panes are all preserved verbatim. Tree data is factored into a **plain internal function** — the pluggable `FileTreeDataProvider` boundary is deferred to #295 (BBP4-012), and the document-authority write/edit override is deferred out of the epic (BBP4-013); `write`/`edit` stay raw file ops.

## Deliverables
- move filesystem front plugin to `boring-bash/plugin`;
- preserve panel ids and `workspace.open.path` resolver;
- preserve file panel binding and agent file bridge/session changes **[Company file-tree root + capability-based readonly panes landed via #416 — carry over intact]**;
- factor tree data into a plain internal tree function (the pluggable `FileTreeDataProvider` boundary is **deferred to #295**, per `../P4-file-ui/TODO.md`);
- the **document-authority override seam is deferred out of this epic** (zero real consumers — no live document system exists; it arrives with #367/#226), per `../P4-file-ui/TODO.md` BBP4-013.

## Exit criteria
- `exec_ui openFile` still opens files;
- file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295).
- (Document-authority override deferred out of this epic — `write`/`edit` stay raw file ops.)
