# #391 current status and ordering

> [`../plan.md`](../plan.md) is the single active plan and dispatch authority.
> Decision 26 supersedes the older same-workspace-first ordering.

## Current state

- PR #794 removed obsolete full-app AgentHost/controller/deployment assets.
- Full-app remains standalone, authenticated, persistent, and single-primary.
- The owner selected domain-routed workspace products as the first increment.
- Planning/tracker authority is being recut before implementation; old S1–N1 Beads are non-dispatchable.

## Active Step 1A order

| Order | Slice | Exit |
| --- | --- | --- |
| 1A.0 | canonical plan and tracker reset | one reviewed authority and acyclic graph |
| 1A.1 | persist workspace type safely | additive compatible schema/store/API contract |
| 1A.2a/b | static product/domain contract, then two-domain auth proof | validated routing contract and host-isolated auth |
| 1A.3a/b | Core typed selection, then route-wide enforcement | all workspace surfaces enforce membership/type |
| 1A.4a/b | durable create admission, then idempotent provisioning | server-stamped type and retry-safe effects |
| 1A.5 | typed workspace frontend flow | empty/one/several/create/switch UX; no agent selector |
| 1A.6a/b | sole behavior lifecycle, then authored materializer/tools | authored content drives one trusted behavior after auth |
| 1A.7 | agent session identity and history compatibility | distinct attribution; exact default history preservation |
| 1A.8a/b | conformance/full-app freeze, then rollback-floor proof | two-product fixture, unchanged full-app, safe rollback |
| 1A.9 | exact package cohort qualification and release | clean Seneca qualification and registry artifacts |
| 1A.10a/b | Seneca integration, then production proof/rollback | two domains/types/agents in normal deployment |

```text
1A.0 -> 1A.1 -> 1A.2a -> 1A.2b -> 1A.3a -> 1A.3b
     -> 1A.4a -> 1A.4b -> 1A.5 -> 1A.6a -> 1A.6b -> 1A.7
     -> 1A.8a -> 1A.8b -> 1A.9 -> 1A.10a -> 1A.10b
```

Only the first unfinished node may be `ready-for-agent`.

## Hard boundaries

- Domain is routing input, never workspace authority.
- Workspace type is persisted and immutable through public v0 APIs.
- Authentication/membership/type checks cover every workspace route before side effects.
- Typed-domain login/listing never creates implicitly; creation is explicit, server-stamped, and idempotent.
- Step 1A has exactly one agent type per workspace type and no in-workspace selector.
- Full-app does not enable typed-domain routing; it retains `default`, one `primary`, current hosts/routes/history/default behavior.
- Typed mode is mutually exclusive with legacy deployment/request-scope authority.
- No AgentHost/controller/CAS/mutable registry/compiled deployment resolution.
- No Step 2 selector/delegation or Step 3 durable transport/extraction in Step 1A.

## Next horizons

```text
1A Seneca proof
-> 1B authenticated MCP (#806 recut)
-> Step 2 multiple agents + native workspace-local delegation
-> Step 3 durable events/external A2A/runtime extraction
-> later contracted agents/marketplace/mounts
```

See [`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) for every prebuilt work
package and [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md) for
workspace-local, external-ingress, and contracted-agent semantics.

## Child ownership

- #805 — runtime packages, authoring, environments, multi-agent inspection.
- #806 — MCP and artifacts.
- #807 — durable events and transport.
- #808 — sandbox providers and mounts.
- #809 — agent consumption, identity, contracting, billing, channels, marketplace.

Child plans are retained research inputs but remain deferred until their trigger
and canonical recut. Decision 26's recut gate overrides stale pre-reset Bead
readiness. Conflicting AgentHost/D1/deployment-resolution ordering is
non-dispatchable.
