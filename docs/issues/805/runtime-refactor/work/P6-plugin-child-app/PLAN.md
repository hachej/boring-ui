> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P6-plugin-child-app — Plan

> **Proposed workspace-first v1 amendment (2026-07-10).** The wider plugin/
> child-app plan below is post-v1. P6-D owns the minimal behavior-only
> `AgentDefinition` and host-owned `AgentDeployment` schemas, their canonical
> digests and immutable referenced definition assets. #623 landed those
> identities and #624 landed the A1 compiler; BBP6-003 lookup is not a P6-R
> prerequisite because the resolver accepts one verified bundle directly. P6-D
> has no P1 dependency. P6-R is a small, stateless resolution step over the
> host-authorized workspace composition attestation. It does not add an environment registry,
> per-agent plugin selection, an immutable generation store, a new workspace
> bundle schema, deployment creation, or multi-generation routing. The workspace remains the v1
> plugin/prompt/skill/tool/runtime composition authority. P6-R depends on P6-D
> and the P1 lifecycle/readiness boundary only. Its composition digest input is
> a host attestation, not something P6-R can currently reproduce; D1-R0 owns
> specifying the missing canonical producer. D1/P5a consume its output and
> P2 provider extraction is not on this path.

> Phase: Phase 6 — Plugin and child-app integration (split into P6a / P6b) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture
- [04-plugin-child-app-runtime.md](../../../../391/runtime-refactor/architecture/04-plugin-child-app-runtime.md) — child-app target, "consume, do not define" the shared child-app platform, plugin manifest requirements, hosted fail-closed, `RuntimePluginContext`, shared per-workspace runtime, hot reload.
- [05-multi-agent-sessions-hooks.md](../../../../391/runtime-refactor/architecture/05-multi-agent-sessions-hooks.md) — the workspace agent registry / `agents: [...]` declaration P6a seeds and Phase 7 consumes.

## Superseded 2026-07-09 scope (historical, non-dispatchable)

The former serialized P6-D/P6-R graph and persistent resolved-generation design
are removed from v1. Retain only the proposed P6-D and stateless P6-R contract
above. Wider plugin, child-app, environment, and durable-resolution work must be
re-specified post-v1 from a named consumer.

## Design context

V1 uses P6 only to establish canonical definition/deployment data and host
resolution. Plugin and child-app generality are retained below as post-v1 work;
they cannot delay A1 or D1.

Definitions contain behavior and requirements only. Environment attachments,
runtime/model/sandbox/governance policy, exposure, tenant roots, hostname, seed
sources, and pricing do not belong to `AgentDefinition`. V1 also rejects
`pluginRefs`; the post-v1 composition bead introduces that field with its
resolver under an additive schema version.

`AgentDeployment` is an identity pin only: deployment id/version, `agentId`,
and pinned definition id/version/digest. D1 desired state and the authorized
workspace host own runtime, environment, model, sandbox, governance, exposure,
hostname, and tenant inputs. P6-R consumes their already-authorized composition
statelessly; it does not resolve an E1 attachment catalog.

## Deliverables

### P6-D/P6-R — v1
P6-D delivers minimal definition/deployment identity schemas, canonical
digests, and immutable referenced definition assets. A1 supplies one compiled
bundle directly; BBP6-003 lookup remains deferred until a host demonstrates it
needs a reusable lookup owner. P6-R
resolves one verified bundle/deployment against one host-authorized workspace
composition attestation and its explicit `default` binding. It
returns immutable identities, loaded instructions, and one deterministic
digest. A host gets N bindings through N independent pure calls; P6-R owns no
batch API, router, current pointer, operational readiness, or registry. A1 and
D1 are the concrete consumers. D1/P5a evaluate operational readiness
separately, and D1 alone pins the immutable host artifact and composition
manifests in its complete redacted apply/rollback snapshot.

### Plugin core expansion — post-v1
Import-free manifest validation, skill filters, plugin runtime context, hosted
mode, shared runtime/reload, and per-agent composition. Agent-scoped
tools/skills/MCP may resolve after P6-R; workspace UI/routes require P7 routing.

### Phase 6b — child-app / Macro scoping (follow-up outside the epic exit)
Consume the resolved child-app context and narrow Macro requirements only after
#376 exports the owner-approved type. No local fallback shape. This work is
post-v1 and never gates P8.

### Deferred design notes

**Amendment (2026-07-06, #550 gap 10) — plugin-owned migrations trigger:** `PostgresModelBudgetStore` and migrations 0015/0016 live in core because core owns drizzle. That stays the model for now. **Trigger to revisit:** if internal plugins multiply and need their own tables, design plugin-owned migration infra then — P6 does not build it, and no P6 bead may add a second migration owner in the meantime.

## Exit criteria

### V1
Separate minimal versioned schemas and deterministic definition/deployment
digests; verified bundle input; deterministic stateless binding of one
host-attested composition identity; A1 local development and D1 consume the same
bundle; no behavior field has a second source of truth.

### Phase 6b (when unblocked)
Child-app/workspace-kind requirement narrowing; Macro requirements do not leak into a generic workspace.
