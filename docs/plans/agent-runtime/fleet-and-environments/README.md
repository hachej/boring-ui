# Fleet and environments

This area covers the product plan for the application agent fleet: how a
Workspace bundles a static set of agents, persists its default agent, and
exposes a shared, governed execution environment (filesystem + sandbox — the
`boring-bash`/`boring-sandbox` packages) that those agents run in.
("Workspace" here is the platform's durable governed world — the container
for seats, threads, files and grants.)

## Files

- `plan.md` — the #391 technical roadmap, product gates, corrections, and
  release detail.
- `proof.md` — supporting proof notes for the plan.

## Status — read this before quoting `plan.md`

`plan.md` is the **Decision 28 product roadmap content, frozen as written in
July 2026**. Reality has moved under parts of it. What still governs, and
what doesn't (2026-08-26 area review):

- **Sequencing authority: DIRECTION, only.** `plan.md` ceded sequencing to
  `docs/direction/DIRECTION.md` on 2026-07-31. That cession covers
  *everything* temporal — including the F-graph dependency edges `plan.md`
  and `proof.md` still describe as preserved, and the #805 fleet-plan DAG
  they elevate. Those are **reference material**, not authority.
- **Shipped substrate the text predates.** The AgentGateway shipped in
  v0.1.91 and is Decision 29: agents are consumed *exclusively* through the
  Agent-owned gateway (single `createAgentHost()` funnel). Where `plan.md`
  routes Workspace directly at `AgentApplication`, assigns it session
  persistence, or names a `@hachej/boring-agent/application` export that does
  not exist — **D29 and `packages/agent/docs/AGENT_GATEWAY_V0.md` govern**.
  Workspace default-agent persistence also shipped (core migration 0024).
  The frontmatter's `state: ready-for-agent` is stale; treat the file as
  roadmap content, not a dispatchable plan.
- **Known code-vs-decision gap (open defect, not a doc error).** `plan.md`
  requires a missing fleet member to stop execution without reinterpreting
  the Workspace (D28's no-fallback invariant). Current code instead falls
  back to the boot/first/legacy agent for an unknown persisted default
  (`packages/core/src/server/defaultAgentType.ts`). This is the silent
  default-agent fallback gap tracked with the #1311 line of work — the
  roadmap is right and the code is behind, not the reverse.
- **Superseded by the premises program** (`docs/plans/multiagent-shell/premises.md`):
  multi-agent conformance (the plan's F7) now sits behind [durable-streams]
  (Level D default-on, D29 addendum 2026-08-26) and [seat-storage]
  (audit-grade `seatId` attribution) — the plan's F3b→F7 edge and its
  `agentTypeId`-only attribution model predate both. Likewise the plan's
  mandate for an initial in-process agent-to-agent semantic adapter is
  superseded: collaboration mechanics are deferred post-[durable-streams]
  with D22's native binding as the ratified default (see
  `../alignment/CONTRADICTIONS.md` §1).
- **One stop-condition to read narrowly.** The plan halts if "AgentHost …
  reappears"; D29 explicitly permits `createAgentHost()` as the shipped
  composition helper. The prohibition means the rejected
  controller/registry/publication machinery, not that function.
