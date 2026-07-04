# P3-routes-tools — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] Phase 1 (`createAgent()` with injected `tools`/runtime — no `features` param) + Phase 2 (providers moved) confirmed present — **STOP and report** the Phase-1 gap if the injected `tools`/runtime seam is not threaded through `createAgentApp`/`registerAgentRoutes` (do not hardwire)

## Beads
- [ ] BBP3-010 — Add `/agent` subpath + `createBashAgentFeature()` skeleton
- [ ] BBP3-011 — Move filesystem tools to `boring-bash/agent`
- [ ] BBP3-012 — Move bash + `execute_isolated_code` tools
- [ ] BBP3-013 — Move upload/artifact tool + decide ownership
- [ ] BBP3-014 — Move file/tree/search/fs-events/git routes to `boring-bash/server`
- [ ] BBP3-015 — Wire `createBashAgentFeature()` into `createAgent()` composition
- [ ] BBP3-016 — Route + tool source-of-truth regression tests
- [ ] BBP3-017 — Extend invariants for the routes/tools boundary

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`
- [ ] Manual behavior proof (workspace playground): open file tree + editor, run read/write/edit/find/grep/ls/bash. See run-workspace-playground recipe; rebuild dist first.

## Review gates
- [ ] Phase 1 (`createAgent()` with injected `tools`/runtime — no `features` param) + Phase 2 (providers moved) confirmed present, else STOP+report.
- [ ] Behavior-freeze verified: tool names/schemas/prompt snippets/readiness tags/error codes unchanged; renderer snapshots unchanged.
- [ ] `disableDefaultFileTools` parity test passes; pure mode has zero file routes/tools.
- [ ] `(filesystem, path)` param + spoof guard + readonly `rejectMutation` preserved verbatim; company_context no-leak conformance green.
- [ ] Single source-of-truth regression tests pass; no second storage-root resolver introduced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports.

## Exit criteria
- [ ] workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled.
- [ ] pure mode (`createAgent({ runtime: 'none' })`) registers none of these routes/tools.
- [ ] company_context no-leak conformance still green.
- [ ] `(filesystem, path)` addressing + readonly enforcement identical to #416.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
