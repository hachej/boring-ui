# #391 current status and ordering

> [`../plan.md`](../plan.md) is the dispatch authority. Decision 26 supersedes
> AgentHost/controller/deployment-publication content-addressed storage,
> singular Step 1A agent policy, Core-owned behavior
> composition, authored catalogs, and same-workspace-first product sequencing.

## Current state

- PR #794 removed obsolete AgentHost assets.
- PR #844 persisted compatible `workspaceTypeId`.
- PR #846 is the active authority/A1/Workspace-agent recut.
- Full-app remains authenticated on the current combined single-primary runtime;
  the approved target will normalize it to `default → primary` through the new
  orchestrator.
- PR #846 locks the target backend policy as default + allowed agent types while
  initial human ingress exposes only the default; implementation has not landed.
- Old #391 and `wt-391-forward-c0u` implementation graphs are non-dispatchable
  until replacement Beads follow the approved plan.

## Step 1A tracks

### Core product track

```text
persisted workspace type (complete)
→ exact domain + two-domain auth
→ route-wide membership/type enforcement
→ explicit idempotent typed create/provision
→ empty/one/several Workspace UX
```

### Workspace/Agent/A1 track (#805)

```text
R0 authority/audit
→ R1 shared WorkspaceRuntime + one compatibility AgentBinding
→ R2a/R2b actor-neutral session façade + request/background consumer migration
→ R3 default/allowed policy + two-agent shared-runtime proof
→ R4 declarative source/catalog correction
→ R5 regular agent dev + package conformance
```

### Product closeout

```text
both tracks
→ exact package cohort
→ Seneca two-product integration
→ production/restart/rollback proof
```

The tracks may proceed independently only when package/worktree ownership does
not overlap. Product enablement waits for both.

## Hard boundaries

- Domain routes; membership authorizes.
- Core persists/authorizes but does not compose agents.
- Workspace owns one WorkspaceRuntime/Sandbox and lazy typed singletons.
- Agent executes one requested type against that runtime.
- Authored data selects no executable behavior.
- Explicit multi-agent graph validates at startup; runtime/harnesses stay lazy.
- Human ingress starts new sessions with the default and accepts no arbitrary
  type selector.
- Agents in one Workspace share runtime authority; separate Workspace is the
  isolation boundary.
- Full-app uses the same orchestrator as `default → primary`.
- No AgentHost/controller/deployment-publication content store/registry/second
  composer.

## Next horizons

```text
Step 1A Seneca proof
→ Step 1B authenticated MCP (#806)
→ Step 2 Workspace-native collaboration + compatible pi-subagents backend
→ Step 3 durable events/external A2A/runtime extraction
→ later contracted agents/marketplace/mounts
```

The desired Boring Pi package/extension seam is a separate follow-up. It cannot
own Core auth, Workspace policy, server routes, or the shared runtime lifecycle.

See [`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) for every work package
and [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md) for mode
semantics.
