> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# P6 v1 definition/resolution — Handoff checklist

> **Workspace-first correction (updated 2026-07-11).** P6-D owns minimal
> schemas/digests; A1 supplies the compiled bundle directly and BBP6-003 lookup
> is not a P6-R prerequisite. P6-R is a small stateless
> resolver over one host-authorized workspace composition attestation after the P1
> lifecycle/readiness boundary. D1 supplies site/workspace binding and consumes
> P5a host facts separately; P6-R does not
> create deployments or persistent resolution state.

This is the P8 closeout authority. The package `HANDOFF.md` also tracks post-v1
plugin, reload, hosted-mode, and child-app work and is not a v1 prerequisite.

## Prerequisites

- [ ] Accepted decision 21 is the reviewed schema authority for P6-D. P1 is not
      a P6-D prerequisite.
- [ ] P6-R waits for P6-D and the P1 lifecycle/readiness boundary only. P5a and
      P2 are not resolver prerequisites.

## V1 beads

- [ ] BBP6-009 — minimal behavior-only `AgentDefinition`, minimal host-owned
      `AgentDeployment`, canonical digests, immutable referenced definition
      assets, and zero P1/E1/P3/boring-bash dependency.
- [ ] BBP6-003 lookup is explicitly deferred unless a host demonstrates a
      second lookup consumer; P6-R accepts the verified compiled bundle.
- [ ] BBP6-011 — statelessly bind the verified definition/deployment to one
      host-attested workspace composition identity/digest and its
      explicit `default` binding. It creates no deployment, runtime/readiness
      fact model, or durable registry.

## Review gates

- [ ] P6-R re-verifies bundle asset containment/content digests/references and
      requires no source checkout or persistent definition registry.
- [ ] Cross-object failures reuse only the existing definition/deployment
      validation classes and codes with the fixed fields named by BBP6-011;
      no generic resolution error taxonomy was added.
- [ ] The module-local authorized-binding schema runtime-validates both opaque
      ids and the SHA-256 composition digest by composing exported existing
      shared validators; malformed host input fails with
      the fixed binding field before a resolved value exists.
- [ ] The shared validator export retains the existing 256-character,
      well-formed-Unicode, control-character, trim, and lowercase SHA-256 rules
      with focused shared tests; the resolver does not duplicate them.
- [ ] P6-R is a pure/stateless function of one verified bundle/deployment, one
      authorized host-attested workspace composition identity/digest, and that workspace's
      explicit `default` binding. Same inputs produce the same immutable
      identities/instructions/digest. N bindings use N independent calls; P6-R
      owns no batch API, router, registry, operational readiness, or rollback.
- [ ] P6-R does not claim to verify or reproduce composition. D1-R0 names the
      current composer inputs and the smallest canonical redacted digest
      producer before D1 implementation claims reproducible rollback.
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
- [ ] A1 local dev and every D1 workspace/default binding consume the same definition
      digest.
- [ ] D1, not P6, pins the immutable host artifact and workspace-composition
      manifest/digest in its complete redacted apply/rollback snapshot.
- [ ] P6 schemas may represent future ids, but A1/D1 v1 route binding accepts
      only deployment `agentId:'default'`; P7 owns non-default routing.

## Exit

- [ ] `pr1-definition-deployment-schema` completed BBP6-009.
- [ ] BBP6-003 lookup is deferred with no false landed claim.
- [ ] The recut stateless P6-R slice completed BBP6-011.
- [ ] Post-v1 plugin/child-app beads remain tracked but are not awaited.
