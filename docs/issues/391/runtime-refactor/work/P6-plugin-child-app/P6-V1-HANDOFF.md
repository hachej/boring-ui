# P6 v1 definition/resolution — Handoff checklist

This is the P8 closeout authority. The package `HANDOFF.md` also tracks post-v1
plugin, reload, hosted-mode, and child-app work and is not a v1 prerequisite.

## Prerequisites

- [ ] P1 merged before P6-D.
- [ ] E1, P5a, and P3 BBP3-020 merged before P6-R. P3 supplies the activated-
      plugin snapshot; P6-R does not own another plugin loader.

## V1 beads

- [ ] BBP6-009 — behavior-only `AgentDefinition`, separate
      `AgentDeployment` with opaque attachment refs, canonical digest, and zero
      E1/boring-bash dependency.
- [ ] BBP6-003 — immutable verified bundle registry keyed by
      `(definitionId, version)`; value contains only definition, digest, and
      immutable referenced assets.
- [ ] BBP6-011 — host resolves definition + deployment + active authority to an
      immutable `ResolvedAgent`, stages its generation by resolved digest
      without publishing it, and pins the host-published digest on a new session.

## Review gates

- [ ] Bundle registry treats same tuple/digest as idempotent and rejects a
      conflicting digest with a stable code.
- [ ] Bundle registry verifies asset containment/content digests/references and
      resolves after the source checkout is unavailable; it has no agentId,
      runtime handle, readiness, catalog, lifecycle, or child-app fields.
- [ ] P6-R registry reads the host's active complete-generation pointer rather
      than owning a second mutable current map; the generation store is keyed by that
      digest and contains reproducible redacted inputs but no live handles or
      raw secrets.
- [ ] `resolvedSnapshotDigest` and its retained generation include the P3
      `ActivatedWorkspacePluginSnapshot` digest plus immutable host-app/plugin
      artifact references. Restart and rollback reproduce that snapshot;
      missing, mismatched, or drifted plugin content fails closed.
- [ ] The retained source-labeled `ResolvedStaticPromptPlan` covers base,
      instructions, capability/plugin fragments, v1 skill index, and static
      host append; its digest is resolved identity. Only per-turn dynamic host
      context is excluded and it cannot grant authority.
- [ ] Requirements validate active authority; they never grant or narrow it.
- [ ] P6-R resolves deployment attachment refs through E1; P6-D neither imports
      E1 nor defines a duplicate attachment contract.
- [ ] P6-R owns one injected workspace-scoped `DeploymentAttachmentCatalog`
      containing validated E1 entries only; no lifecycle/global/raw prepared
      handle. A1 and D1 consume it.
- [ ] Catalog derives/verifies the attachment-set digest and full lifetime key,
      returning an opaque ref-bound facts/contributions unit; callers cannot mix
      a ref with another lifetime.
- [ ] A process restart with an unchanged active pointer reconstructs the exact
      generation and permits a completed session follow-up. Missing generations
      fail closed; current grants can narrow but never widen the pinned ceiling.
- [ ] V1 runs one boot-time host/plugin generation per dedicated site. A changed
      pointer uses BBP6-011's transition/retirement contract and D1's host
      orchestration: prepare the replacement, stop admission, bounded-drain,
      commit pointer + `switch_pending`, switch ingress, then idempotently
      terminalize prior-generation sessions as `SESSION_GENERATION_RETIRED` and
      release their refs before reopening admission. Pre-CAS failure preserves
      old sessions; post-CAS recovery completes forward. History stays readable,
      and no multi-generation router or mutable boot-route reload is introduced.
- [ ] Crash after staging and before D1 completion/pointer CAS leaves the prior
      generation live; staged/incomplete generations are unroutable.
- [ ] Generation retention roots include staging/in-flight leases, active host
      pointers, sessions, and D1 rollback completions. Publication atomically
      transfers refs; terminal fenced abandonment releases; GC waits for all.
- [ ] Staging durably pins the complete immutable host-app/plugin artifact set
      under the resolved digest. Generation roots retain both record and
      content; generation GC releases the artifact pin only after deletion.
      A durable mutation journal reconciles both pin-before-generation and
      generation-deleted-before-pin-release crashes; concurrent artifact GC is
      proven. The journal has one row and deterministic owner per digest;
      concurrent stage joins, stage waits through `deleting`, `live`+zero-roots
      -> `deleting` is atomic with root acquisition, and no orphan pin survives.
- [ ] Session admission atomically leases the current generation before reading
      it, transfers lease to session pin after persistence, reconciles crashes,
      and defeats concurrent pointer swap/prune/GC. Every process presents its
      immutable non-request boot digest; old listeners reject stale after a
      pointer switch before any boot route handles the request.
- [ ] Schema v1 rejects `pluginRefs`/`plugins` with
      `AGENT_DEFINITION_UNSUPPORTED_FIELD`.
- [ ] `instructionsRef` is the only agent-authored prompt reference. Plugin and
      capability fragments activate only with their complete resolved
      server contribution; disabled or pre-registration-failed v1 plugin
      activation leaves zero prompt residue and consumes P3 BBP3-020 rather
      than a second loader. Browser-front failure follows previous-good-UI
      diagnostics and cannot roll back boot-time routes.
- [ ] A1 local dev and D1 dedicated deployment consume the same definition
      digest.
- [ ] P6 schemas may represent future ids, but A1/D1 v1 route binding accepts
      only deployment `agentId:'default'`; P7 owns non-default routing.

## Exit

- [ ] `pr1-definition-deployment-schema` completed BBP6-009.
- [ ] `pr2-definition-registry` completed BBP6-003.
- [ ] `pr3-resolved-agent` completed BBP6-011.
- [ ] Post-v1 plugin/child-app beads remain tracked but are not awaited.
