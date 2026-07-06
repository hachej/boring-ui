# S2-embed-contract — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] S1-slack-channel merged — [../S1-slack-channel/HANDOFF.md](../S1-slack-channel/HANDOFF.md) (surface-adapter conformance suite + two-handles pattern)
- [ ] Also requires P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md) (the `createAgent()` façade; block on P1 rather than reaching into the harness if a façade method is missing)
- [ ] Import `runSurfaceAdapterConformance` from the neutral home `@hachej/boring-agent/testing` (authored by S1 BBS1-006) — NOT from the Slack package
- [ ] STOP+report if `@hachej/boring-agent/core` or `@hachej/boring-agent/testing` is absent; current prep worktree has neither subpath before P1/S1 land
- [ ] Use `apps/spreadsheet-embed-playground`; current repo has no pi-excel plugin and no `examples/` tree

## Beads
- [ ] BBS2-001 — Embedding client contract doc
- [ ] BBS2-002 — Reference embed under `apps/spreadsheet-embed-playground`
- [ ] BBS2-003 — Surface-adapter conformance for the embed
- [ ] BBS2-004 — No-boring-bash dependency guard

## Verification commands
- [ ] `pnpm install`
- [ ] `pnpm --filter spreadsheet-embed-playground run typecheck`
- [ ] `pnpm --filter spreadsheet-embed-playground run test`
- [ ] `pnpm audit:imports`
- [ ] `pnpm run build:packages`
- [ ] `pnpm run test`

## Review gates
- [ ] Embed `package.json` deps: `@hachej/boring-agent` only (+ dev/test tooling); no `@hachej/boring-bash`, no provider packages.
- [ ] Domain tools supplied via `tools`; `runtime: 'none'`; side-effecting tool marked `needsApproval`.
- [ ] Approvals use `resolveInput` on the shared stream — no embed-local approval channel.
- [ ] Conformance suite is imported from the neutral `@hachej/boring-agent/testing` subpath authored by S1 BBS1-006, not re-implemented and not imported from the Slack package.
- [ ] Embedding doc lives in `packages/agent/docs/` and names only published-contract symbols.
- [ ] Trust boundary explicit: `createAgent()` + model credentials + the agent loop run **host-side (trusted Node)**, never in the browser add-in; the task-pane UI consumes the `ChatTransport` contract only.

## Exit criteria
- [ ] The embed has **no `boring-bash` dependency**.
- [ ] Tool outputs project into the sheet (domain tools are the host's spreadsheet read/write-range tools).
- [ ] The surface-adapter conformance suite (from S1) passes for the embed.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
