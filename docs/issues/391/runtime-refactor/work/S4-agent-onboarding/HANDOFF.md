> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# S4-agent-onboarding - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling S4 done. Invent nothing.

## Prerequisites

- [ ] S3 Fleet/inspection page merged.
- [ ] P6-D definition/deployment validation and P6-R resolution merged.
- [ ] M2 demo endpoint status available.
- [ ] D1 provisioning status available.

## Beads

- [ ] BBS4-001 - Readiness data model and status client.
- [ ] BBS4-002 - Onboarding status panel on Fleet drill-down.
- [ ] BBS4-003 - Demo/provisioning status integration.
- [ ] BBS4-004 - Onboarding integration test.

## Verification commands

- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## PR-PLAN reconciliation

- [ ] `pr1-status-model-client` completed BBS4-001.
- [ ] `pr2-onboarding-panel` completed BBS4-002 + BBS4-003.
- [ ] `pr3-onboarding-integration` completed BBS4-004.

## Review gates

- [ ] Read-only status only; no agent authoring/configuration controls.
- [ ] Definition, demo URL, provisioning, and missing policy ref statuses render.
- [ ] Missing refs fail closed.
- [ ] No secrets, raw policy docs, model keys, deployment internals, or private roots render.
- [ ] Existing S3 Fleet/session/approval surfaces are reused.

## Exit criteria

- [ ] Operator can see why each declared agent is or is not demo/provisioning ready.
- [ ] S3 remains observe/inspect/approve only.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
