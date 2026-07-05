# P4-file-ui — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] Phase 3 present (write/edit tools + routes in boring-bash) — **STOP and report** if absent

## Beads
- [ ] BBP4-010 — Establish `/plugin` subpath using the workspace plugin SDK directly
- [ ] BBP4-011 — Move filesystem front plugin files
- [ ] BBP4-012 — Extract a plain internal tree function/type (provider boundary deferred to #295)
- [ ] BBP4-013 — Document-authority write/edit override hook (#367/#226) — DEFERRED (out of this epic)
- [ ] BBP4-014 — Remove static workspace registration + static-import guard
- [ ] BBP4-015 — Move bash/file tool renderers into `boring-bash/plugin`
- [ ] BBP4-016 — Move file composer providers to the bash plugin (#26)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter workspace-playground run test:e2e`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`
- [ ] Manual proof (workspace playground): file tree renders; open code/markdown/media/html/pdf panes; `exec_ui openFile` focuses the right panel; agent write updates an open pane via agentFileBridge. Rebuild dist before driving the playground.

## PR-PLAN reconciliation
- [ ] `pr1-plugin-subpath-sdk` completed BBP4-010
- [ ] `pr2-move-front-plugin` completed BBP4-011 + BBP4-012, including any pr2a/pr2b/pr2c split required by move churn
- [ ] BBP4-013 verified as deferred: no `DocumentAuthority`/override hook/null authority shipped; P8 follow-up recorded
- [ ] `pr3-move-tool-renderers` completed BBP4-015
- [ ] `pr4-composer-providers` completed BBP4-016
- [ ] `pr5-remove-static-registration` completed BBP4-014

## Review gates
- [ ] Phase 3 present (write/edit tools + routes in boring-bash), else STOP+report.
- [ ] Panel ids, `FILESYSTEM_SURFACE_RESOLVER_ID`, and `workspace.open.path` resolve output unchanged.
- [ ] `boring-bash/plugin` imports the public workspace plugin SDK directly; workspace↔boring-bash cycle safety is enforced by the opposite static edge check. Gate: `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` returns no matches. Workspace bridge stays workspace-owned; the `normalizeUiFilesystem`/`USER_FILESYSTEM_ID`/`uiFileResourceKey` helper values are imported from the public workspace SDK, not passed through an adapter.
- [ ] Bash/file tool renderers (`bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`) register through `definePlugin({ toolRenderers })`; pure-mode front has none of those renderer ids by default.
- [ ] File mention/slash composer providers are capability-gated by attached bash/filesystem; pure-mode front has no `/api/v1/files/search`, `@files:` note generation, upload affordance, or file slash command.
- [ ] Company file-tree root + capability-based readonly panes preserved.
- [ ] Tree data is a single internal function (no provider interface — deferred to #295), current tree shape unchanged; the document-authority write/edit override is **deferred out of this epic** (BBP4-013) — `write`/`edit` stay raw file ops, no hook/interface/null-authority added.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` + workspace plugin-invariants green.

## Exit criteria
- [ ] `exec_ui openFile` still opens files (same panel ids, same resolver).
- [ ] bash/file tool calls render through the boring-bash plugin when attached; pure-mode front falls back generically with no fs/bash-specific renderer registrations.
- [ ] file mentions, file slash commands, and uploads exist only with the bash plugin attached.
- [ ] file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295).
- [ ] document-authority override deferred out of this epic — `write`/`edit` stay raw file ops; the seam arrives with #367/#226.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
