> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# P2-sandbox-providers — Handoff checklist

## Binding priority-4 handoff (2026-07-11)

- [ ] M2/E2, T1, and T2 are complete before this recut merges.
- [ ] D1 behavior and public contracts are unchanged; P2 was not added as a
      D1/P8 prerequisite.
- [ ] Provider extraction starts from #628 and proves honest EU isolation,
      lifecycle, network, limit, image, cleanup, and authenticated facts.
- [ ] Unknown facts fail closed, with no direct fallback and no X1 mount mixed
      into the provider PR.
- [ ] The isolated Sol branch was reconciled to current main only at its merge
      gate; preparation was never recorded as landed state.

## Historical narrow-v1 handoff — non-dispatchable

### Prerequisites

- [ ] The P1 workspace/Fastify boundary is available to D1 composition.
- [ ] The sandbox package scaffold and #557 publish-pipeline parity are on main.

### Active proof

- [ ] The D1-consumed hardened EU runsc/systrap provider is available behind an
      injected workspace runtime boundary.
- [ ] Reported runsc, network, resource-limit, image, persistence, and cleanup
      facts are honest and fail closed when missing or unknown.
- [ ] Production D1 cannot silently select direct, bwrap, Vercel, fake, or an
      unverified worker.
- [ ] A1 local dev prefers bwrap when available; direct requires explicit
      trusted-local policy and is never a fallback.
- [ ] Only importers changed by the narrow runsc slice migrate; no pure-only
      binary, `resolveMode` cutover, or full provider relocation lands in v1.
- [ ] #416 contracts remain unchanged and package import invariants hold.

### Exit

- [ ] A real D1 target proves runsc isolation, egress denial, limits, cleanup,
      and secret-canary absence.
- [ ] #548 is recut to this boundary; #558 and #564 remain deferred/closed.

## Historical full provider/mode handoff — non-dispatchable for v1

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
- [ ] BBP2-009 — Publish-pipeline parity for `@hachej/boring-sandbox` (Amendment 2026-07-06; executes before BBP2-005)
- [ ] BBP2-005 — Land runtime-mode resolution (`resolveMode()` + mode adapters) in `@hachej/boring-bash`
- [ ] BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision
- [ ] BBP2-007 — Migrate importers + delete origin exports (no compat shims)
- [ ] BBP2-008 — Extend invariant scripts for the three-package boundary
- [ ] BBP2-010 — Hardened gVisor runsc provider for production v1

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
- [ ] Every moved provider carries its tests and lives in boring-sandbox; the intentional selection change is explicit trusted-local `direct` and fail-closed deployed fallback.
- [ ] Provider-bound workspace/path helpers moved with providers: `createNodeWorkspace`, `getNodeWorkspaceHostRoot`, `createVercelSandboxWorkspace`, `createRemoteWorkerWorkspace`, and containment helpers are no longer agent-server value dependencies for moved providers.
- [ ] Mode-private helpers moved/injected with `boring-bash/modes`: `createServerFileSearch`, template copy, provisioning artifact helpers, and env/error/telemetry helpers leave no `@hachej/boring-agent` value import in `packages/boring-bash/src/modes/**`.
- [ ] Remote-worker worker server remains app-owned, imports protocol/provider contracts from `@hachej/boring-sandbox`, has no agent-core dep, and still exposes only the P2 health behavior (`{ ok: true }`); no capability handshake is added in P2.
- [ ] Every importer of the moved value symbols migrated in the same PR and the origin exports deleted; no old-path re-export (value or type), no host shim, no cycle.
- [ ] Mode-id vs provider-id distinction preserved (`local`→`bwrap`); `resolveMode` (boring-bash) resolves to boring-sandbox provider values.
- [ ] Publish-pipeline parity (BBP2-009): `@hachej/boring-sandbox` in all five publish lists, ordered before `packages/boring-bash`, on the current version cohort — landed before BBP2-005's bash→sandbox value edge.
- [ ] Real preconfigured EU worker evidence proves runsc systrap lifecycle,
      digest-pinned OCI input, per-workspace netns/nftables denial, cgroup/pid/
      CPU/memory limits, secret-canary absence, and exact cleanup. Mocks alone
      are insufficient.

## Exit criteria
- [ ] `@hachej/boring-sandbox` package exists, builds, and resolves `boring-sandbox/shared` + `boring-sandbox/providers` subpaths.
- [ ] No agent→bash **or** agent→sandbox value import (invariant scan green); the only cross-package value edge is `boring-bash → boring-sandbox`; the only sandbox→agent edge is type-only.
- [ ] Current apps still compile after same-PR importer migration (no old-path re-export, no host shim).
- [ ] Landed #416 contracts unchanged; governance consumers keep working.
- [ ] No deployed/core/tenant composer silently falls back to direct execution; CLI/dev can opt in explicitly.
- [ ] Remote-worker relocation and mode/composer cutover are separate reviewable PRs.
- [ ] P2 adds no new agent-owned provisioning contract/export; the existing
      engine location is explicitly transitional until P5 BBP5-002 moves and
      deletes it.
- [ ] Hardened runsc is the sole v1 production provider; selection through a
      remote worker also requires P5a's authenticated hardening handshake.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
