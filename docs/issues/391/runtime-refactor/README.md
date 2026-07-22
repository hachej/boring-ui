# #391 runtime-refactor archive and reference pack

> **Status: historical/reference; non-dispatchable.** The active authority is
> [`../plan.md`](../plan.md) under
> [Decision 28](../../../DECISIONS.md#28-application-agent-fleets-workspace-orchestration-and-shared-execution-environments).
> No file below this directory may override that plan. Decision 26's typed-
> Workspace topology and old R1–R6 graph are historical.

This directory preserves shared architecture, historical reviews/proofs,
redirect stubs, and the retired AgentHost/D1 path. PR #794 removed obsolete
AgentHost assets. Decision 28 does not cancel useful child-issue research, but
all retained work packages require an explicit adoption into a current plan and
Bead recut before dispatch.
See [`../OWNERSHIP.md`](../OWNERSHIP.md) and
[`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md).

## Current references

1. [`../plan.md`](../plan.md) — sole implementation and ordering authority.
2. [`INDEX.md`](INDEX.md) — concise Decision 28 status and non-normative graph mirror.
3. [`VISION.md`](VISION.md) — strategic horizons.
4. [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md) — UI/MCP/local delegation/external A2A/contractor modes.
5. [`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) — every prebuilt work package.

`PR-PLAN.md`, `OWNER-REVIEW.md`, `FORWARD-PLAN.md`, former TODOs, and historical
reviews preserve earlier Decision 25 or AgentHost planning. They are explicitly
non-dispatchable and may contain stale slice names.

## Current direction

```text
static application Agent fleet
→ Workspace-persisted default Agent
→ service-shaped in-process AgentApplication
→ governed boring-bash Environment service
→ Agent/Workspace-neutral boring-sandbox backend
→ independent Core/web and CLI consumers
→ signup-domain initialization only
→ two-Agent canonical-data/governance proof
→ exact package/Seneca rollout and rollback
```

Authenticated MCP, public Agent selection/delegation, remote adapters, durable
A2A, and contracted Agents follow separate approved recuts.

## Classification

- 8 retired AgentHost/D1/D2 work orders.
- 29 historical snapshots/evidence/redirects from the original audit.
- 74 redirect stubs to canonical child documents.
- 74 canonical child work-package documents that require Decision 28 adoption
  before dispatch.
- Shared architecture retained for package, Workspace, security, session, test,
  and EU-self-hostable principles where it does not conflict with Decision 28.
