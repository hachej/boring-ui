# P2-sandbox-providers — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] Phase 1 dependency injection (`createAgent()` / injected runtime + tools) is complete before providers move — **STOP and report** if the injection seam is not threaded through `createAgentApp`/`registerAgentRoutes` (do not shim)

## Beads
- [ ] BBP2-000 — Scaffold the `@hachej/boring-sandbox` package
- [ ] BBP2-001 — Provider capability contract in `boring-sandbox/shared`
- [ ] BBP2-002 — Provider capability matrix values + mode→provider mapping docs
- [ ] BBP2-003 — Move `direct` + `bwrap` sandbox providers
- [ ] BBP2-004 — Move `vercel-sandbox` provider
- [ ] BBP2-005 — Land runtime-mode resolution (`resolveMode()` + mode adapters) in `@hachej/boring-bash`
- [ ] BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision
- [ ] BBP2-007 — Migrate importers + delete origin exports (no compat shims)
- [ ] BBP2-008 — Extend invariant scripts for the three-package boundary

## Verification commands
- [ ] `pnpm --filter @hachej/boring-sandbox run build`
- [ ] `pnpm --filter @hachej/boring-sandbox run typecheck`
- [ ] `pnpm --filter @hachej/boring-sandbox run check:invariants`
- [ ] `pnpm --filter @hachej/boring-sandbox run test`
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## Review gates
- [ ] Phase 1 injection precondition confirmed (or STOP+report).
- [ ] `@hachej/boring-sandbox` scaffolded (BBP2-000), builds, and its types-only-agent / no-bash-edge invariant is enforced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash **and** zero agent→sandbox value imports; the only cross-package value edge is `boring-bash → boring-sandbox`; sandbox→agent is type-only.
- [ ] #416 shared contracts / server projection ops / conformance+leak tests unchanged and passing.
- [ ] Every moved provider carries its tests and lives in `packages/boring-sandbox/src/providers`; direct/local/vercel-sandbox behavior unchanged; `resolveMode` lands in `boring-bash/modes` with byte-identical behavior.
- [ ] Every importer of the moved value symbols migrated in the same PR and the origin exports deleted; no old-path re-export (value or type), no host shim, no cycle.
- [ ] Mode-id vs provider-id distinction preserved (`local`→`bwrap`); `resolveMode` (boring-bash) resolves to boring-sandbox provider values.

## Exit criteria
- [ ] `@hachej/boring-sandbox` package exists, builds, and resolves `boring-sandbox/shared` + `boring-sandbox/providers` subpaths.
- [ ] No agent→bash **or** agent→sandbox value import (invariant scan green); the only cross-package value edge is `boring-bash → boring-sandbox`; the only sandbox→agent edge is type-only.
- [ ] Current apps still compile after same-PR importer migration (no old-path re-export, no host shim).
- [ ] Landed #416 contracts unchanged; governance consumers keep working.
- [ ] `direct`/`local`/`vercel-sandbox` behavior + existing tests preserved; `resolveMode` behavior byte-identical after moving to boring-bash.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
