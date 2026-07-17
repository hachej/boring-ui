# #391 current status and ordering

> [`../plan.md`](../plan.md) is the single active plan and dispatch authority.
> This file is its concise status index. The previous D1/AgentHost ordering is
> historical and must not be dispatched.

## Current state

- PR [#794](https://github.com/hachej/boring-ui/pull/794) merged and physically
  removed obsolete full-app AgentHost/controller/deployment assets.
- Full-app remains a standalone authenticated, persistent, single-primary app.
- Existing workspace authorization, runtime composition, agent definitions,
  compiler/resolver APIs, session roots, plugins, MCP, and named filesystem
  bindings remain available.
- Issue #391 is in planning review until the canonical reset merges.

## Binding build order

| Order | Slice | Status | Exit |
| --- | --- | --- | --- |
| P0 | canonical decision/plan/tracker reset | active planning slice | one non-conflicting authority and acyclic tracker |
| S1 | static declaration + server behavior binding | blocked by P0 | immutable contract, safe/default-off catalog DTO, route ownership table |
| S2 | agent request/session/provenance identity | blocked by S1 | distinct identity with byte-compatible primary sessions and bounded mismatch lookup |
| S3 | shared runtime children + Agent-owned route registrar | blocked by S2 | one existing workspace runtime owner, shared routes mounted once, one disposal |
| S4 | Core authorization/routing/selection | blocked by S3 | membership before exact selection; Agent-owned routes only + primary alias |
| S5 | package conformance + full-app freeze | blocked by S4 | two-agent fixture and unchanged full-app behavior |
| R1 | exact package cohort release | blocked by S5 | validated registry artifacts and released-cohort full-app smoke |
| N1 | Seneca integration/product proof | blocked by R1 | two agents, shared W runtime, isolated W2, distinct identity |

```text
#794 -> P0 -> S1 -> S2 -> S3 -> S4 -> S5 -> R1 -> N1
```

Only the first unfinished node can be marked `ready-for-agent`.

## Hard boundaries

- No AgentHost/controller/revision/CAS/mutable registry restoration.
- Core authenticates and verifies workspace membership before agent selection.
- One existing workspace-keyed Workspace + Sandbox lifecycle; logical agents are children and cannot dispose it.
- Same-workspace agents share a runtime trust domain; tool lists are not
  isolation.
- Agent-owned routes use `/api/v1/agents/:agentId/...`; existing unscoped routes
  alias primary.
- Primary retains legacy session visibility; non-primary sessions are
  collision-safe and agent-scoped.
- Catalog exposure defaults off; full-app supplies one primary, no catalog route, and no selector.
- Existing `AgentDeployment` data is provenance only, never runtime resolution authority.
- Seneca consumer qualification runs on S5 tarballs before the exact cohort is published.

## Deferred

Custom JSON sandbox tools and native agent-to-agent/A2A may be planned after N1.
Transport, marketplace, generic environment, provider extraction, mounts,
per-agent isolation, dynamic registration, and control-plane work remain parked
until a named consumer and separate approved plan exist.

## Pack and child-issue policy

The retained files are audited into three classes: 8 retired AgentHost/D1/D2 work orders, 29 historical snapshots/evidence/redirects, and 84 retained shared-architecture/roadmap/work-package files. Retained work follows its own GitHub issue and Bead status; it is outside this static critical path, not canceled.

Ownership is mapped in [`../OWNERSHIP.md`](../OWNERSHIP.md): #805 runtime/environments, #806 MCP/artifacts, #807 durable transport, #808 sandbox/mounts, and #809 marketplace/identity/contracting. Canonical work-package files have moved through this completed path-only redistribution; use the child indexes at `docs/issues/805/plan.md` through `docs/issues/809/plan.md`. Only conflicting AgentHost/D1 ordering loses to Decision 25.
