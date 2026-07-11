# P1-headless-core — Handoff checklist

> **Revised v1 handoff (2026-07-10).** The checklist below is the legacy
> pure-mode handoff and is not v1 authority. Review the recut P1 slices against
> these binding gates instead:
>
> - [ ] every product adapter supplies an authorized workspace and approved
>       runtime/environment;
> - [ ] the core boundary imports neither Fastify nor concrete providers;
> - [ ] existing workspace/core/CLI behavior and authorization are preserved;
> - [ ] tool/static-prompt merge is deterministic and duplicate names fail
>       closed;
> - [ ] agent-local lifecycle/readiness is bounded without disposing
>       host/provider-global resources;
> - [ ] session storage and workspace/runtime storage roots stay separate;
> - [ ] no public `runtime: 'none'`, workspace-less adapter, generic feature
>       registry, or second harness is introduced;
> - [ ] durable admission/idempotency is left to T1 unless a current named v1
>       consumer demonstrates the requirement.
>
> Use [PR-PLAN.md](../../PR-PLAN.md) for the binding PR dispositions. The #543
> correction and #616 (boundary-only recut of #547) are parallel current-main
> leaves; both precede #575, then #576 lands lifecycle first and readiness
> second. #547 is superseded/stopped. Retain the remaining checklist only as
> post-v1 research history.

## Historical pure-mode checklist — non-dispatchable for v1

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P0-adr merged — [../P0-adr/HANDOFF.md](../P0-adr/HANDOFF.md)
- [ ] #391 points to the v2 pack and BBP0-001..005 are merged (no P1 bead starts before this — per P0 review gate)

## Beads
- [ ] BBP1-001 — Config-surface inventory: enumerate every env/cwd/file-discovery read in agent server code
- [ ] BBP1-002 — `createAgent()` façade (Fastify-free)
- [ ] BBP1-003 — Make `createAgentApp()` + `registerAgentRoutes()` thin adapters
- [ ] BBP1-004 — `runtime: 'none'` pure path + `sessionStorageRoot` separation
- [ ] BBP1-005 — pi-coding-agent cwd/resource assumption audit → findings + seals
- [ ] BBP1-006 — Invariant + smoke tests
- [ ] BBP1-007 — Minimal `ResolvedAgentCapabilities` projection
- [ ] BBP1-008 — Admission, idempotency, attribution, catalog, and lifecycle closeout

## Verification commands
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm --filter @hachej/boring-agent run test:e2e`
- [ ] `pnpm lint:invariants` (optional, heavier root aggregate)
- [ ] Manual: start the cli hub + workspace playground against the refactored build; confirm chat + file tree + sessions behave identically

## Review gates
- [ ] Thermo architecture review is clean (per `README.md` "Review rule"): no `boring-agent → boring-bash` cycle, no duplicated provisioning/readiness system, no fs/bash split brain, no hidden cwd/fs leak in pure mode.
- [ ] BBP1-005's pi-harness audit findings are reviewed and the "sealed pi, not second harness" decision confirmed **before** the pure-mode exit criteria are claimed (BBP1-004 depends on BBP1-005's seals).
- [ ] Behavior-parity gate: reviewer confirms the existing agent unit + e2e suites pass unchanged, and no existing route was added/removed for `direct`/`local`/`vercel-sandbox` modes.
- [ ] The Fastify-graph invariant (BBP1-006) actually fails when a `fastify` import is introduced into the façade closure — reviewer verifies the negative case.
- [ ] Track T1 does not start until BBP1-002..007 are merged (T1 depends on the stub seams landing here).
- [ ] T1/T2 and multi-surface work do not proceed until BBP1-008 is merged.

## Exit criteria
- [ ] `createAgent()` exported from `@hachej/boring-agent/core` returning the nine members; `start` (accepted-receipt write), `stream` (replay+live-tail read with documented non-durable in-memory `eventIndex` counter until T1), `send` (convenience), `interrupt`/`stop` real, `resolveInput`/historical-`stream` typed stubs.
- [ ] `createAgentApp()`/`registerAgentRoutes()` are adapters over `createAgent()`; all current HTTP consumers behave identically (cli hub, workspace, core, agent-playground e2e).
- [ ] Typed config object only: no `process.env` / `process.cwd()` / `.pi/*` / `workspaces.yaml` reads inside `createAgent()`.
- [ ] A pure agent starts via `createAgent()` with no runtime/environment attachment in a plain Node script with no Fastify, no workspace/sandbox/cwd/file routes/bash tools; existing `runtime: 'none'` remains an adapter/host shim input during migration.
- [ ] `sessionStorageRoot` is separated from workspace roots.
- [ ] Minimal `ResolvedAgentCapabilities` projection exists for pure mode and coarse existing coding modes.
- [ ] `start()` is the single per-session admission gate; request retries are
      idempotent within trusted admission scope + authenticated subject and
      isolated across subjects; actor/origin survive; duplicate tools fail.
- [ ] Agent-local and host-global lifecycle ownership are separate; every cache is bounded and disposed by its owner.
- [ ] pi-coding-agent cwd/resource assumptions audited; findings doc + follow-up seals produced.
- [ ] Invariant tests: no agent value import from boring-bash; no Fastify in the façade module graph; smoke test `createAgent()` with no runtime/environment attachment runs a turn with a fake harness in plain Node.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
