# P5-provisioning-secrets — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] P2 `@hachej/boring-sandbox/providers` + `providers/matrix.ts` `ProviderCapabilities` present (or STOP+report) — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)

## Beads
- [ ] BBP5-001 — `BashRequirement` shape + import-free normalizer in boring-bash
- [ ] BBP5-002 — Re-point provisioning callers through the normalizer
- [ ] BBP5-003 — Per-requirement readiness + `optional_failed` derived state
- [ ] BBP5-004 — Health-check gating
- [ ] BBP5-005 — SDK-archive provisioning
- [ ] BBP5-006 — Managed service requirements
- [ ] BBP5-007 — Secret status/grant model + credential brokering rule
- [ ] BBP5-008 — Remote-worker capability handshake (reported | unknown, fail-closed)
- [ ] BBP5-009 — Two-phase bootstrap/onSession + fingerprint key composition
- [ ] BBP5-010 — Remote-worker no-leak conformance mount (the deferred remote-worker env mount)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm --filter @hachej/boring-agent run smoke:capability-readiness`
- [ ] `pnpm --filter @hachej/boring-core run test`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-ui-cli run test`
- [ ] `pnpm --filter full-app run typecheck`
- [ ] `pnpm --filter full-app run smoke:remote-worker`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## Review gates
- [ ] P3 + P2 `/providers/matrix.ts` precondition confirmed (or STOP+report). (P5 dispatches off P3 in parallel with P4/E1 — it does NOT depend on P4.)
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports; engine still agent-owned, normalizer boring-bash-owned.
- [ ] Provisioning behavior unchanged for no-requirement workspaces; existing provisioning/readiness/Vercel-snapshot tests pass.
- [ ] Optional-failure isolation, health gating, service lifecycle, SDK-archive leak-safety all covered by tests.
- [ ] Brokering negative test present and green: no sandbox-side read of a brokered secret; no brokered secret is ever placed on a sandbox env (there is no injection path — the `direct` provider is a host process, not a sandbox).
- [ ] Remote-worker handshake reports typed `reported|unknown` facts and fails closed on `unknown`.
- [ ] Two-phase fingerprint composition includes all listed keys and no raw secret.
- [ ] EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- [ ] Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.

## Exit criteria
- [ ] Requirements merge by id; same id / conflicting spec rejects with a stable error code.
- [ ] Optional requirement failure does not block unrelated tools/contributions; surfaces as derived `optional_failed` over `CapabilityState='failed'` + `optional=true` (no new enum value).
- [ ] Capability-vs-provider validation rejects impossible fs/exec/service/secret asks against the `ProviderCapabilities` (P2 matrix).
- [ ] Existing readiness state compatible: `chat`/`workspace`/`runtimeDependencies` intact; tags `runtime-dependencies`, `runtime:<id>`, `workspace-fs`, `sandbox-exec` still gate tools; existing `readyStatus` tests pass.
- [ ] Health check gates dependent tools/panels until it passes.
- [ ] Secret status is diagnosable (`missing`/`granted`/`denied`/`expired`) with no raw value exposure anywhere.
- [ ] Managed service starts, health-checks, exposes ports only under grant, and tears down deterministically.
- [ ] Remote-worker handshake reports its capability matrix; consumers fail closed on `unknown`/unverifiable hardening.
- [ ] Two-phase bootstrap/onSession: same fingerprint skips; changed requirement/source/contract re-provisions; onSession reruns without rebuilding a stable template; existing Vercel snapshot/fingerprint tests pass.
- [ ] v2 brokering: no test can read a brokered secret from inside the sandbox (BBP5-007).
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
