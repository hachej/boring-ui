# P6 v1 definition/resolution — Handoff checklist

> **Proposed workspace-first correction (2026-07-10).** P6-D independently owns
> both minimal schemas/digests plus definition lookup. P6-R is a small stateless
> resolver over the existing authorized workspace composition after the P1 and
> narrow P5a branch joins. D1 supplies site/workspace binding; P6-R does not
> create deployments or persistent resolution state.

This is the P8 closeout authority. The package `HANDOFF.md` also tracks post-v1
plugin, reload, hosted-mode, and child-app work and is not a v1 prerequisite.

## Prerequisites

- [ ] Proposed decision 21 is the reviewed schema authority for P6-D. P1 is not
      a P6-D prerequisite.
- [ ] P6-R waits for P6-D, the P1 workspace/Fastify boundary, and only the
      narrow P5a runtime/readiness facts consumed by D1.

## V1 beads

- [ ] BBP6-009 — minimal behavior-only `AgentDefinition`, minimal host-owned
      `AgentDeployment`, canonical digests, immutable referenced definition
      assets, and zero P1/E1/P3/boring-bash dependency.
- [ ] BBP6-003 — immutable verified bundle registry keyed by
      `(definitionId, version)`; value contains only definition, digest, and
      immutable referenced assets.
- [ ] BBP6-011 — statelessly resolve the verified definition/deployment through
      the existing authorized workspace composition manifest/digest and
      D1-required runtime facts. It creates no deployment or durable registry.

## Review gates

- [ ] Bundle registry treats same tuple/digest as idempotent and rejects a
      conflicting digest with a stable code.
- [ ] Bundle registry verifies asset containment/content digests/references and
      resolves after the source checkout is unavailable; it has no agentId,
      runtime handle, readiness, catalog, lifecycle, or child-app fields.
- [ ] P6-R is a pure/stateless function of verified P6-D values, host-owned
      deployment input, the existing authorized workspace composition
      manifest/digest, and narrow runtime/readiness facts. Same inputs produce
      the same result. P6-R does not load/select contributions or own rollback.
- [ ] Workspace composition remains the sole v1 authority for plugins, prompts,
      skills, tools, routes, UI, readiness, and runtime. P6 adds no loader,
      plugin snapshot, scoped registrar, attachment catalog, or policy engine.
- [ ] `AgentDeployment` owns only deployment identity, `agentId`, and the pinned
      definition reference in v1. Runtime/environment/model/sandbox/governance,
      hostname, landing, pricing, exposure, and tenant policy remain host/D1 or
      workspace inputs.
- [ ] Requirements validate the already-active workspace authority; they never
      grant or widen it.
- [ ] Schema v1 rejects `pluginRefs`/`plugins` with
      `AGENT_DEFINITION_UNSUPPORTED_FIELD`.
- [ ] `instructionsRef` is the only agent-authored prompt reference. Existing
      workspace contribution activation remains unchanged; P6 does not create
      a second prompt or plugin registry.
- [ ] A1 local dev and D1 dedicated deployment consume the same definition
      digest.
- [ ] D1, not P6, pins the immutable host artifact and workspace-composition
      manifest/digest in its complete redacted apply/rollback snapshot.
- [ ] P6 schemas may represent future ids, but A1/D1 v1 route binding accepts
      only deployment `agentId:'default'`; P7 owns non-default routing.

## Exit

- [ ] `pr1-definition-deployment-schema` completed BBP6-009.
- [ ] `pr2-definition-registry` completed BBP6-003.
- [ ] The recut stateless P6-R slice completed BBP6-011.
- [ ] Post-v1 plugin/child-app beads remain tracked but are not awaited.
