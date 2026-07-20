# A1 Workspace ↔ Agent handoff

> [`PLAN.md`](PLAN.md) is canonical. Decision 26 and the 2026-07-20 owner grill
> supersede the authored-catalog, Core behavior-composer, singular-agent-policy,
> and separate-dev-app instructions in older branches and Beads.

## Product exit

```text
declarative agent source
+ host-owned trusted plugin IDs
+ static workspace type policy (default + allowed agents)
→ Core-authorized workspace context
→ one Workspace-owned WorkspaceRuntime
→ lazy Map<agentTypeId, AgentBinding>
→ default-only human ingress
```

## Locked package ownership

- **Core:** auth, membership, Workspace persistence, `workspaceTypeId`.
- **Workspace:** policy, plugin views, shared runtime, provisioning union, typed
  singleton map, default/session agent resolution.
- **Agent:** load and execute one requested type against the supplied runtime.
- **Host:** domain/type policy, global agent definitions, installed trusted
  plugins.
- **Pi follow-up:** optional Boring package/extension adapter; not part of this
  implementation stack.

## Preconditions

- [x] PR #846 is approved and merged.
- [x] R0 consumer/export and actor-sensitive callback audit is recorded in
  [`R0-AUDIT.md`](R0-AUDIT.md).
- [x] Replacement Beads exist under `wt-391-forward-step1a-current-xn9`; old
  `wt-391-forward-c0u`/stale `wt-391-forward-o0b` work is historical only.
- [ ] One writer owns each overlapping Agent/Workspace/Core/CLI lane.

## Non-negotiable invariants

- [ ] One WorkspaceRuntime and Sandbox per `workspaceId`; workspace-static
  descriptor drift fails instead of creating another scope.
- [ ] One actor-neutral AgentBinding per `(workspaceId, agentTypeId)`.
- [ ] Default and non-default bindings load lazily and deduplicate concurrent
  creation.
- [ ] All allowed agent types share exact Workspace/Sandbox object identity.
- [ ] Agent behavior differs by source and assigned plugin subset, not by
  security boundary.
- [ ] Core never resolves or composes an agent.
- [ ] Authored JSON/Markdown never selects executable behavior.
- [ ] Host policy validates completely at startup; runtime/harness creation stays
  lazy.
- [ ] Workspace provisioning uses the union for every allowed agent once.
- [ ] Public APIs expose no arbitrary agent-type selector.
- [ ] Workspace owns an actor-multiplexing session router before AgentBinding
  selection; existing per-user directories stay in place.
- [ ] New sessions persist trusted type; execution requires stored allowed type;
  legacy execution uses the current default; malformed/disallowed metadata never
  falls back, but ownership-authorized history/delete needs no AgentBinding and
  deletion removes scoped plugin/session state.
- [ ] Standard Boring tools remain available to every type.
- [ ] Tool collisions stay deterministic/non-fatal with diagnostics.
- [ ] Existing full-app hosts normalize to `default → primary` through the same
  orchestrator—no adapter class or old/new runtime branch.
- [ ] Compatibility reload keeps current asset/runtime-backend rescan inside the
  generation transaction; explicit policy membership/route registration stays
  static.
- [ ] `agent dev` launches `createWorkspaceAgentServer()`; no dedicated dev app.
- [ ] Every request/background operation gets a short-lived issuer and distinct
  single-use operation/target token; router→binding nests use separate tokens;
  no raw Workspace/invocation/RunContext is retained or replayed.
- [ ] Runtime creation failure is shared/hard with staged adapter rollback;
  provisioning failure is shared degraded readiness preserving non-runtime chat.
- [ ] Initial provisioning/reload uses private deep-frozen snapshots and one
  commit pointer; failed/retired bindings idempotently unenroll under the writer
  and discard staged tokens before typed-map removal.
- [ ] Accepted work stores stable subject IDs and reauthorizes at queued/retry/
  auto-follow-up start; active work is non-evictable, while passive streams are
  bounded/revocable with cursor reconnect so cache capacity cannot deadlock.
- [ ] Stateful plugins capture no Workspace/actor/session at boot; per-operation
  handles and explicit composite keys isolate ask-user/default plugin state.
- [ ] Account deletion preflights managed/protected policy, then global-user and
  Workspace-epoch fences deny every normal issuer/admission; app-owned jobs and
  all live runtime replicas ack doomed/actor retirement, transcript/plugin
  cleanup, and cross-app/offline retry before final user/provider destruction.
- [ ] Existing standalone Agent/harness/store package exports are not removed by
  the Workspace façade. Only the catalog/materializer/validate fields explicitly
  listed in the owner-approved R4 correction may change in that follow-up.
- [ ] Existing Pi/subagent limits remain authoritative; no second recursion
  policy.

## Slice order

1. **R0:** authority cutover, publication/consumer audit, callback inventory,
   replacement Beads.
2. **R1:** split WorkspaceRuntime/embeddable host; migrate standalone, Core,
   and CLI workspaces mode; temporarily retain only the private current actor
   cache—no adapter class/export or second runtime path.
3. **R2a:** privately handled sessions and actor-neutral primary façade.
4. **R2b:** migrate Core/full-app MCP/Agent MCP/automation/trusted-plugin ingress
   from raw Workspace/dispatcher APIs to fresh revalidatable invocations.
5. **R3:** static multi-agent policy, plugin filtering, provisioning generation,
   typed singleton map, capabilities contract, and two-agent proof.
6. **R4 (complete):** owner-approved corrective PR removes the unused authored
   catalog/tool-selector surface, migrates repository callers atomically, and
   simplifies validate; proof is in [`R4-PROOF.md`](R4-PROOF.md).
7. **R5:** regular-server `agent dev`, package/docs conformance.
8. **R6:** linked #391 Seneca/product proof only after the independent Core
   domain/auth/create/frontend/rollback track; R5 completes the #805 foundation.

## Required proof

The canonical fixture must show:

- two differently configured agent types;
- exactly one WorkspaceRuntime/Sandbox/provisioning call;
- exact shared Workspace/Sandbox identity;
- one strict-equal singleton per type under concurrent lookup;
- prompt/tool/skill/Pi separation;
- agent-local failure/retry and shared failure behavior;
- generation-safe loaded-binding refresh, requesting-session-only reload,
  dependent-effect concurrency barrier, and exact-once disposal;
- two users sharing one binding with correct per-run auth;
- default/typed/legacy/malformed/disallowed session behavior across an
  exhaustive invocation-strategy manifest, stable private session-state keys,
  opaque actor/type handles, command-driven mutations, plugin state restart,
  and preserved old user namespaces;
- no public agent selector;
- omitted-policy full-app compatibility.

## Superseded work

- #814's authored catalog is corrective input, not accepted product direction.
- #816 and #817 must not merge.
- #821 is feature-branch evidence only.
- Seneca #16 must be replaced from current Seneca `main`.
- Do not force-rewrite or erase reviewed history.

## Follow-up issues, not hidden scope

- Boring as a Pi package/extension for arbitrary Pi agents.
- Workspace-native `pi-subagents` executor/backend.
- Human selector/switch/fork UX.
- Workspace-type route gating.
- Fatal collision hardening.
