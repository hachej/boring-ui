# P2-sandbox-providers — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] Phase 1 dependency injection (`createAgent()` / injected runtime + tools) is complete before providers move — **STOP and report** if the injection seam is not threaded through `createAgentApp`/`registerAgentRoutes` (do not shim)
- [ ] Preflight reality verified: `packages/boring-sandbox/` is absent before BBP2-000; `packages/boring-bash/package.json` exports only `.`, `./shared`, `./server` before BBP2-005; `pnpm-workspace.yaml` already covers `packages/*`.
- [ ] Current moved-symbol import graph re-grepped: `resolveMode` importers, `createNodeWorkspace` importers, remote-worker protocol/provider imports, and app/composer imports match or supersede TODO's migration set.

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
- [ ] `pnpm --filter @hachej/boring-ui-cli run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-core run typecheck`
- [ ] `pnpm --filter full-app run typecheck`
- [ ] `pnpm --filter workspace-playground run typecheck`
- [ ] `pnpm --filter full-app run smoke:remote-worker`

## Review gates
- [ ] Phase 1 injection precondition confirmed (or STOP+report).
- [ ] `@hachej/boring-sandbox` scaffolded (BBP2-000), builds, and its types-only-agent / no-bash-edge invariant is enforced.
- [ ] Capability types and fixed/reported capability facts live in `boring-sandbox/shared` (`providerMatrix`); providers do not own a separate capability-facts authority.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash **and** zero agent→sandbox value imports; the only cross-package value edge is `boring-bash → boring-sandbox`; sandbox→agent is type-only.
- [ ] #416 shared contracts / server projection ops / conformance+leak tests unchanged and passing.
- [ ] Every moved provider carries its tests and lives in `packages/boring-sandbox/src/providers`; direct/local/vercel-sandbox behavior unchanged; `resolveMode` lands in `boring-bash/modes` with byte-identical behavior.
- [ ] Provider-bound workspace/path helpers moved with providers: `createNodeWorkspace`, `getNodeWorkspaceHostRoot`, `createVercelSandboxWorkspace`, `createRemoteWorkerWorkspace`, and containment helpers are no longer agent-server value dependencies for moved providers.
- [ ] Mode-private helpers moved/injected with `boring-bash/modes`: `createServerFileSearch`, template copy, provisioning artifact helpers, and env/error/telemetry helpers leave no `@hachej/boring-agent` value import in `packages/boring-bash/src/modes/**`.
- [ ] Remote-worker worker server remains app-owned, imports protocol/provider contracts from `@hachej/boring-sandbox`, has no agent-core dep, and still exposes only the P2 health behavior (`{ ok: true }`); no capability handshake is added in P2.
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
