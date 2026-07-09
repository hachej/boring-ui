# D1-tenant-provisioning - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling D1 done. Invent nothing.

## Prerequisites

- [ ] P5 provisioning/secrets seams merged.
- [ ] P6-D/P6-R definition/deployment resolver merged.
- [ ] A1 compiler/validator/local-dev path and self-contained bundle merged.
- [ ] Chosen EU host profile is supported by architecture 10 or owner-approved.
- [ ] P2 hardened runsc provider and P5a authenticated worker handshake are
      merged; a direct/bwrap/fake/unverified worker is not a production proof.
- [ ] EU host profile pins the worker HTTPS server identity; an internal caller
      token without server-authenticated TLS is not accepted as worker proof.
- [ ] V1 deployment is bound to `agentId:'default'`; non-default fails with the
      stable route-unsupported code until P7 lands.

## Beads

- [ ] BBD1-001 - Provisioning plan schema + CLI/API entry.
- [ ] BBD1-002 - Tenant/workspace + DB/storage/session roots.
- [ ] BBD1-003 - Secrets and runtime config materialization.
- [ ] BBD1-004 - Bundle materialization + endpoint config + deployment manifest.
- [ ] BBD1-005 - Apply smoke + rollback notes.

## Verification commands

- [ ] Affected package build/typecheck/test commands.
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm audit:imports`
- [ ] Provisioning smoke added by this package.

## PR-PLAN reconciliation

- [ ] `pr1-plan-command-api` completed BBD1-001.
- [ ] `pr2-tenant-roots` completed BBD1-002.
- [ ] `pr3-secrets-runtime-config` completed BBD1-003.
- [ ] `pr4-endpoint-manifest` completed BBD1-004.
- [ ] `pr5-apply-smoke-runbook` completed BBD1-005.

## Review gates

- [ ] One command/API creates every required provisioning artifact.
- [ ] Dry-run and idempotent rerun are tested.
- [ ] `desiredStateDigest` covers all redacted desired inputs: three identity
      definition/deployment identity, attachment refs, host/tier, root policy,
      secret refs/requested grants, endpoint/network, image, and commands; no
      raw secret and no predicted resolved/readiness observation.
- [ ] After materialization D1 appends one immutable completion from staged P6-R with
      resolved-snapshot digest, redacted observed state, and completion digest;
      only then does CAS advance the current-complete pointer.
- [ ] P6-R stages but never publishes. Registry routing reads the D1 complete
      pointer; crash after staging/completion append but before CAS keeps the
      prior generation live.
- [ ] Durable apply store is append-only by immutable generation, with desired/
      observed step digests, provider ids, fencing/CAS, and one atomic
      `currentCompleteGeneration` pointer.
- [ ] Exactly one route binding/publication/fence chain exists per tenant+agent.
      Deployment id plus resolved worker/endpoint/server-pin/region/account
      identity digest bind on first apply; replacement/relocation rejects before
      side effects even if the profile id is unchanged.
- [ ] Every provider create/update/delete accepts the monotonic target fence and
      stable logical resource key; native conditional mutation or the serialized
      target executor rejects stale tokens before side effects.
- [ ] Fault injection at every step boundary resumes/compensates without
      duplicate resources; conflicting concurrent apply rejects.
- [ ] Lease-expiry/takeover fault resumes the old worker before every mutation;
      it gets `DEPLOYMENT_FENCE_STALE` with zero effects, and takeover waits for
      already in-flight work to quiesce.
- [ ] No raw secrets in generated outputs, logs, or docs.
- [ ] Session roots are durable host-volume roots, not container home/root.
- [ ] Deployment manifest follows architecture 10 EU host constraints.
- [ ] Target materializes and verifies the bundle without source-checkout access.
- [ ] Manifest/status/session identity carries definition, deployment, and
      resolved-snapshot digests plus desired-state/generation identity; rollback
      appends a new generation from the complete immutable prior snapshot.
- [ ] Rollback reproduces prior desired/resolved digests but records current
      observed versions and a new completion digest; it never copies stale
      completion observations.
- [ ] Incomplete generations remain inspectable and never replace the last
      complete pointer; same-state reapply converges on the existing generation.
- [ ] P6 staging lease transfers atomically to active/rollback refs at completion;
      active, staged, session, and rollback generations cannot be GC'd. Fenced
      terminal abandonment and history pruning release only their own refs.

## Exit criteria

- [ ] A tenant/workspace can be provisioned from one invocation.
- [ ] Runtime config, roots, secret refs, existing-surface endpoint binding, and deployment manifest exist.
- [ ] Timed golden path is <=15 minutes with preconfigured infrastructure;
      reapply is idempotent and rollback selects the prior complete deployment
      snapshot and verifies its resolved digest.
- [ ] Smoke proof confirms the provisioned shape is usable.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
