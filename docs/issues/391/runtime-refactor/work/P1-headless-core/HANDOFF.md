# P1-headless-core — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P0-adr merged — [../P0-adr/HANDOFF.md](../P0-adr/HANDOFF.md); BBP0-001..005 are merged and #391 points to the v2 pack.
- [ ] P1 pre-flight review is **thermo double-GREEN**: two clean blocker-only reviews recorded on this plan pack before executor dispatch.
- [ ] Work starts from a branch/worktree, not remote `main`; do not commit unless explicitly asked.

## Beads / PR rows
- [ ] `pr1-config-inventory` — BBP1-001 — create `_p1-config-surface.md`; grep reproducers resolve; zero `UNKNOWN` / `TBD`.
- [ ] `pr5-pi-harness-audit` — BBP1-005 — create `_p1-pi-harness-audit.md`; land sealed-cwd/resource/prompt/session-identity seals; tests prove no host cwd/prompt leak.
- [ ] `pr2-createagent-facade` — BBP1-002 — add `@hachej/boring-agent/core`, `createAgent()`, `shared/events.ts`, `AgentSendInput`, optional `SessionCtx.workspaceId`, nine-member API, live-tail `send`, typed T1 stubs, real `interrupt`/`stop`. Split as PR-PLAN `pr2a`/`pr2b` only if the LOC cap is hit.
- [ ] `pr3-adapters-thin` — BBP1-003 — make `createAgentApp()` and `registerAgentRoutes()` thin adapters with zero route/behavior drift for existing modes.
- [ ] `pr4-pure-runtime-none` — BBP1-004 — add `runtime: 'none'`, `sessionStorageRoot`, pure route/tool exclusion, no synthesized `workspaceId`.
- [ ] `pr6-invariants-smoke` — BBP1-006 — source no-Fastify guard, built `/core` graph walk, existing agent→boring-bash invariant proof, pure fake-harness smoke.
- [ ] Merge order matches [PR-PLAN.md](../../PR-PLAN.md): `pr1 → pr5 → pr2(→a,b if split) → pr3 → pr4 → pr6`.

## Verification commands
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation` (after `build`)
- [ ] `pnpm --filter @hachej/boring-agent run test:e2e`
- [ ] `pnpm lint:invariants` (optional, heavier root aggregate)
- [ ] Bead-specific: `pnpm --filter @hachej/boring-agent run test -- createAgent.pure.test.ts`
- [ ] Bead-specific: `pnpm --filter @hachej/boring-agent run test -- createAgent.pure.test.ts runtimeCwd.test.ts`
- [ ] Manual: start the cli hub + workspace playground against the refactored build; confirm chat + file tree + sessions behave identically

## Review gates
- [ ] Thermo architecture review is clean (per `README.md` "Review rule"): no `boring-agent → boring-bash` cycle, no duplicated provisioning/readiness system, no fs/bash split brain, no hidden cwd/fs leak in pure mode.
- [ ] BBP1-005's pi-harness audit findings are reviewed and the "sealed pi, not second harness" decision confirmed **before** the pure-mode exit criteria are claimed (BBP1-004 depends on BBP1-005's seals).
- [ ] Behavior-parity gate: reviewer confirms the existing agent unit + e2e suites pass unchanged, and no existing route was added/removed for `direct`/`local`/`vercel-sandbox` modes.
- [ ] PR description includes route-list artifact for existing direct/local/vercel modes and shows no route added/removed.
- [ ] PR description includes negative-proof artifact: temporary agent value import from `@hachej/boring-bash` fails `boring-bash check:invariants`; temporary `fastify` import reachable from `/core` fails both `lint:invariants` and `check:isolation` after build. Temporary mutations are not committed.
- [ ] Track T1 does not start until BBP1-002..006 are merged (T1 depends on the stub seams landing here).

## Exit criteria
- [ ] `createAgent()` exported from `@hachej/boring-agent/core` returning the nine members; `start` (accepted-receipt write), `stream` (P1 live-tail with T1-shaped offset signature), `send` (convenience), `interrupt`/`stop` real, `resolveInput`/historical-`stream` typed stubs.
- [ ] `createAgentApp()`/`registerAgentRoutes()` are adapters over `createAgent()`; all current HTTP consumers behave identically (cli hub, workspace, core, agent-playground e2e).
- [ ] Typed config object only: no `process.env` / `process.cwd()` / `.pi/*` / `workspaces.yaml` reads inside `createAgent()`.
- [ ] A pure agent starts via `createAgent({ runtime: 'none' })` in a plain Node/vitest process with no Fastify, no workspace/sandbox/cwd/file routes/bash tools, no plugin discovery, and app-owned tools only.
- [ ] `sessionStorageRoot` is separated from workspace roots.
- [ ] `SessionCtx.workspaceId` is optional; pure/headless sessions round-trip with `workspaceId` undefined and no synthesized `"default"` / `"workspace"` / cwd-derived tenant id.
- [ ] pi-coding-agent cwd/resource assumptions audited; findings doc + follow-up seals produced.
- [ ] Invariant tests: no agent value import from boring-bash; no Fastify in the façade module graph; smoke test `createAgent({ runtime: 'none' })` runs a turn with a fake harness in plain Node.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
