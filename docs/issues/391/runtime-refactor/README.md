# #391 runtime-refactor archive and reference pack

> **Status: historical/reference; non-dispatchable.** The active authority is
> [`../plan.md`](../plan.md) under
> [Decision 26](../../../DECISIONS.md#26-domain-routed-typed-workspaces-with-workspace-owned-agent-orchestration).
> No file below this directory may override that plan.

This directory preserves shared architecture, historical reviews/proofs,
redirect stubs, and the retired AgentHost/D1 path. PR #794 removed obsolete
AgentHost assets. Decision 26 does not cancel useful child-issue research, but
all retained work packages require a child-plan and Bead recut before dispatch.
See [`../OWNERSHIP.md`](../OWNERSHIP.md) and
[`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md).

## Current references

1. [`../plan.md`](../plan.md) — sole implementation and ordering authority.
2. [`INDEX.md`](INDEX.md) — concise Step 1A status and graph.
3. [`VISION.md`](VISION.md) — strategic horizons.
4. [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md) — UI/MCP/local delegation/external A2A/contractor modes.
5. [`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) — every prebuilt work package.

`PR-PLAN.md`, `OWNER-REVIEW.md`, `FORWARD-PLAN.md`, former TODOs, and historical
reviews preserve earlier Decision 25 or AgentHost planning. They are explicitly
non-dispatchable and may contain stale slice names.

## Current Step 1A direction

```text
persisted workspace type (complete)
-> Core domain/auth/type/create/frontend track
   + Workspace-owned shared runtime/default+allowed agent/A1 track
-> default-only human ingress over a two-agent-proven backend
-> conformance + typed-aware rollback floor
-> exact release
-> Seneca two-product production proof
```

Then, through separate approved recuts:

```text
Step 1B authenticated MCP
-> Step 2 same-workspace multi-agent + native delegation
-> Step 3 durable events/external A2A/runtime expansion
-> later contracted agents/marketplace/mounts
```

## Classification

- 8 retired AgentHost/D1/D2 work orders.
- 29 historical snapshots/evidence/redirects from the original audit.
- 74 redirect stubs to canonical child documents.
- 74 canonical child work-package documents with a Decision 26 recut gate.
- Shared architecture retained for package, workspace, security, session, test,
  and EU-self-hostable principles where it does not conflict with Decision 26.
