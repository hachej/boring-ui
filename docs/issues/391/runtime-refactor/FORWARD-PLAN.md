# Historical forward plan

> **Status: historical / non-dispatchable.** This path formerly described the
> D1/AgentHost and later singular-agent Step 1A sequences. PR #794 removed
> AgentHost. Decision 28 also supersedes Decision 26's typed-product topology,
> Core-owned behavior composition, authored tool catalogs, and combined host
> graph.

The active replacement is [`../plan.md`](../plan.md), with durable ownership in
[Decision 28](../../../DECISIONS.md#28-application-agent-fleets-workspace-orchestration-and-shared-execution-environments)
and implementation detail in
[`../../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md`](../../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md).

Do not use old D1, AgentHost deployment/publication content-addressed storage,
controller, revision, publication,
active-collection, singular behavior-binding, authored-catalog, or rollout
sections as implementation input. Git history preserves them as evidence.

Current high-level order:

```text
persist workspaceTypeId (complete)
→ approve PR #846 authority/A1 recut
→ Core domain/auth/create track
  + WorkspaceRuntime/typed AgentBinding/A1 track
→ full-app package conformance
→ Seneca two-product proof and typed-aware rollback
→ Step 1B MCP
→ Step 2 Workspace-local collaboration
→ Step 3 durable/external expansion
```

The Step 1A backend supports a static default plus allowed agent types and proves
two types share one Workspace + Sandbox. Initial human ingress still uses only
the default. See [`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) for all
later work packages.
