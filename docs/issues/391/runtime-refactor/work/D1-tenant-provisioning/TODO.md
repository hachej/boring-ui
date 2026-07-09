# TODO-D1 - Tenant provisioning command/API

## Binding v1 correction (2026-07-09)

- Inputs are A1 `CompiledAgentBundle` plus separate `AgentDeployment`.
- Depends on A1, P5a, and P6-R; M2 is not a prerequisite.
- Use an existing HTTP/workspace endpoint for v1. Public-demo/bearer MCP
  exposure is a later M2 binding.
- Plan/journal start with definition, deployment, and desired-state identity;
  completion/manifest/status/rollback add the post-materialization resolved and
  observed completion identity.
- Exit includes the timed <=15-minute scaffold/validate/local/apply/reapply/
  rollback proof with preconfigured host infrastructure.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: [`PLAN.md`](./PLAN.md)
- Ordering: [`../../INDEX.md`](../../INDEX.md) Phase D1.
- Deployment architecture: [`../../architecture/10-sandbox-deployment-eu.md`](../../architecture/10-sandbox-deployment-eu.md)
- Provisioning/secrets: [`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../P6-plugin-child-app/TODO.md) BBP6-009
- Agent authoring: [`../A1-agent-authoring/TODO.md`](../A1-agent-authoring/TODO.md)

## Prerequisites - stop if false

- P5 provisioning/secrets seams exist.
- P6-D/P6-R definition, deployment, digest, and resolver exist.
- A1 compiler/validator/local-dev path exists.
- The chosen EU host profile is one of the architecture 10 supported tiers or is explicitly owner-approved.

## Goal / exit criteria

One command/API creates the tenant/workspace, runtime config, DB/storage/session
roots, secret references, materialized immutable agent bundle,
existing-surface endpoint binding, and deployment manifest for the chosen EU
host.

## Non-negotiables

- No raw secrets in logs, manifests, comments, or generated docs.
- No US-hosted service as default or hard dependency.
- Production D1 uses the P2 runsc/systrap provider through a P5a-authenticated
  preconfigured EU worker. Direct, bwrap, Vercel, fake, or unverified workers
  cannot satisfy the v1 deployment proof.
- D1 v1 accepts only `AgentDeployment.agentId === 'default'`, matching the T1/T2
  single-agent route. A non-default deployment fails
  `AGENT_ROUTE_UNSUPPORTED`; P7 is the post-v1 owner of registry-backed ids.
- Session roots follow `BORING_AGENT_SESSION_ROOT` / durable host-volume rules;
  they are not inside container home/root by default.
- LP/GTM/pricing/CTA generation is out of scope and belongs to
  `boring-ui-factory`.
- Provisioning is idempotent: re-running reports existing resources or applies a
  safe delta, never silently creates a second tenant.
- Apply is journaled and fenced. One durable `TenantAgentTargetKey { tenantId,
  agentId }` owns exactly one route binding, append-only generation sequence,
  monotonic fence, and atomically updated `currentCompleteGeneration` pointer.
  Before journaling, resolve the host profile to immutable
  `ResolvedHostIdentity { workerId, endpointOrigin, serverIdentityFingerprint,
  region, providerAccountId }` and canonical `hostIdentityDigest` (no private
  credential). The first apply CAS-binds its `deploymentId`, informational
  `hostProfileId`, and `hostIdentityDigest`; later v1 applies must keep the
  deployment id and immutable host digest while varying deployment version/
  desired state through the same chain. A second deployment id or host relocation for the same routed
  agent fails `D1_ROUTE_BINDING_CONFLICT` before side effects. Same desired state returns the current
  completed generation or joins/resumes the matching incomplete generation; a
  different desired state requires explicit compare-and-swap from the expected
  current generation id and `completionDigest`. Incomplete generations are retained and
  never overwrite the prior complete pointer. Concurrent or stale writers fail
  with stable codes.
- Pointer CAS is not the provider fence. Every external mutation carries a
  monotonic target-side `fenceToken` and stable logical resource key independent
  of generation. The provider must atomically reject a token older than the
  target's highest accepted fence before mutation. Where the external API has no
  native conditional update, all mutations flow through one target-side executor
  that holds a non-stealable exclusive lock, drains/cancels the prior generation,
  then advances the fence; it never steals a time-expired lease while old work
  can still run. A provider that cannot prevent post-takeover stale side effects
  is unsupported for D1.
- `desiredStateDigest` covers the complete canonical redacted desired snapshot:
  definition and deployment digests plus opaque attachment refs; host profile,
  immutable host-identity digest, and
  isolation tier; workspace/storage/session roots and retention policy; secret
  reference names and requested grant ids; endpoint and network policy; selected
  image digest; and desired service commands. These are plan inputs known before
  side effects. It excludes raw values, readiness/status observations, provider
  resource ids, and `resolvedSnapshotDigest`.
- After materialization/readiness, final P6-R resolution produces
  `resolvedSnapshotDigest`. Append exactly one immutable
  `DeploymentApplyCompletion` containing that digest, redacted observed
  resource versions/status, and `completionDigest = H(desiredStateDigest,
  resolvedSnapshotDigest, observedState)`. Only then may CAS advance
  `currentCompleteGeneration`. No generation header is rewritten.
- P6-R staging durably acquires an in-flight generation lease. Completion CAS
  atomically transfers it to active-pointer and rollback references before
  release. A failed/incomplete apply keeps the staging lease until it is fenced,
  durably terminal/abandoned, and unable to resume; then reconciliation releases
  it. Rollback pruning releases only its rollback reference. GC cannot race a
  staged or actively routed generation.

## Beads

### BBD1-001 - Provisioning plan schema + CLI/API entry (M)

- **Files touch/create:** command/API entry point, plan schema, dry-run output,
  stable error codes.
- **Notes:** Plan input carries the verified `CompiledAgentBundle`, versioned
  `AgentDeployment`, and references tenant id/name, workspace seed, EU host
  profile, runtime tier, `runtimeProfileRef`-derived
  selected image, storage/session root policy, secrets refs, and existing-
  surface endpoint policy. Public-demo/MCP exposure remains M2. Compute
  definition and deployment digests before apply. Resolve the complete redacted
  desired-state snapshot and compute `desiredStateDigest` before side effects.
  Append a durable immutable `DeploymentApplyGeneration` under
  `TenantAgentTargetKey` with bound deployment/host identity, generation id, full desired
  snapshot, expected prior complete generation id/digest, fencing token/lease,
  and an append-only ordered step journal
  `pending|applying|applied|compensated|failed`. Each step records its desired
  and observed digest plus provider resource id. The only mutable selector is
  the atomic `currentCompleteGeneration` pointer, advanced after every required
  step is durably complete, final P6-R resolution and the immutable completion
  record have succeeded, and CAS still matches the expected prior completion.
  Define the provider mutation contract
  `{ targetKey, logicalResourceKey, generationId, fenceToken,
  expectedResourceVersion? }`. Create/find keys use the stable logical resource
  key, not `generationId`; updates/deletes use native conditional versions or the
  serialized target executor. `DEPLOYMENT_FENCE_STALE` is returned before any
  side effect from an older token.
- The active selector and provider fence use the same `TenantAgentTargetKey`.
  `ResolvedAgentRegistry` for the tenant/default route reads only this selector;
  there cannot be two current pointers for one `(tenantId, agentId)`.
- **Tests:** dry-run emits deterministic plan including definition/deployment and
  desired-state digests and explicitly no predicted resolved digest; changing host/tier/root/secret-ref/
  endpoint/network/image/command changes `desiredStateDigest`; unknown
  definition/host/secret ref or invalid asset digest fails closed; no apply
  side effects in dry-run. A second deployment id or changed resolved host
  identity for an already bound route rejects before journal/provider mutation,
  including retargeting the same profile id to a new endpoint, worker, account,
  region, or TLS/server-identity pin.
- **Acceptance:** operators can review a complete plan before apply.

### BBD1-002 - Tenant/workspace + DB/storage/session roots (M)

- **Files touch/create:** provisioning adapters for tenant/workspace records and
  root allocation.
- **Notes:** Session history root is a host durable volume sibling to workspace
  roots by default (`/data/pi-sessions` beside `/data/workspaces` when applicable).
- **Apply rule:** tenant/root creation uses provider idempotency keys derived
  from apply target + stable logical resource key + desired-state digest + step,
  while the separate monotonic fence rejects stale generations. Persist the provider resource id
  before advancing. A provider that cannot idempotently create-or-find the same
  resource is unsupported for D1.
- **Tests:** creates tenant + workspace once; rerun is idempotent; roots are
  outside container home/root; cross-tenant roots cannot collide.
- **Acceptance:** tenant/workspace and root layout are repeatable and inspectable.

### BBD1-003 - Secrets and runtime config materialization (M)

- **Files touch/create:** secret-ref resolver, runtime config writer, redacted
  manifest projection.
- **Notes:** Consume P5 brokering. Store secret refs/handles, never raw secret
  values. Runtime config records provider facts and selected image/tier; the
  image is derived from `AgentDeployment.runtimeProfileRef` when
  present, else the validated provider-default image, while tier stays the
  host/EU deployment choice.
- **Tests:** raw secret canary absent from logs/manifests; missing secret ref
  fails closed; runtime config includes the selected runtime image plus EU
  host/tier facts.
- **Acceptance:** deployed runtime can start without leaking secrets.

### BBD1-004 - Bundle materialization, endpoint binding, and manifest (L)

- **Files touch/create:** bundle uploader/materializer, HTTP/workspace endpoint
  binding, and deployment manifest generator for the chosen EU host.
- **Notes:** V1 uses existing host authentication/routing. `exposureId`, public
  demo policy, and MCP bearer modes remain M2. The
  uploader writes only normalized bundle paths, verifies each asset digest and
  the canonical definition digest on the target, then atomically selects the
  verified bundle. After roots, attachment entries, secrets/status, provider
  facts, and P5 readiness exist, call P6-R `stageResolvedAgent` against those
  actual inputs. Staging persists the immutable generation but publishes
  nothing. Append the immutable completion record with its resolved digest, then
  CAS `currentCompleteGeneration { agentId, generationId,
  resolvedSnapshotDigest, completionDigest }`. `ResolvedAgentRegistry` reads
  only that complete pointer. A crash/failure anywhere before CAS leaves the
  prior deployment routed and the new generation staged/incomplete. The
  deployment manifest captures definition/deployment/
  resolved-snapshot and desired-state digests, generation id, the redacted
  resolved snapshot, completion digest/observed versions, image digest, host
  tier, storage roots, network policy, and service commands.
- **Tests:** a target with no source checkout materializes the bundle and starts
  the authenticated existing-surface endpoint; tampered/missing assets reject;
  manifest contains no raw secrets; unsupported image/host/tier combinations
  reject; crash after P6-R staging and after completion append but before pointer
  CAS keeps the previous resolved agent live.
- **Acceptance:** operator receives a deployable, reviewable manifest tied to
  the verified bundle digest.

### BBD1-005 - Apply smoke + rollback notes (M)

- **Files touch/create:** CLI script
  `smoke:agent-factory-v1` (invoked as
  `pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <host-profile>`),
  fake-provider fault harness, and rollback/runbook docs. P8 BBP8-006 consumes
  this exact smoke; do not create a second harness there.
- **Notes:** Smoke records elapsed time and validates tenant reachability,
  workspace/runtime config, all three identity digests, idempotent reapply,
  and rollback to the previous complete desired-state snapshot. Rollback is an
  explicit CAS from the current generation id/completion digest and appends a new
  generation copied from the immutable previous completed snapshot; it never
  mutates or reselects the old journal in place. It must reproduce the prior
  desired-state and resolved-snapshot digests or fail closed, then records its
  own actual observed state and a **new** completion digest. Resource versions
  are not copied and completion-digest equality with the old generation is not
  required.
- **Tests:** fake provider fault-injects before and after every ordered resource
  step, including remote-create-before-local-journal persistence. Restart
  resumes or explicitly compensates from durable observed state with no
  duplicate resource. Two concurrent identical applies converge on one
  generation; conflicting/stale CAS rejects. Faulted generations remain
  inspectable and never move `currentCompleteGeneration`; rollback appends a
  new completed generation with its own completion digest and preserves both
  prior journals. Rollback docs
  link every created resource category.
- **Takeover fault:** pause an old executor immediately before every provider
  mutation, advance to a newer generation/fence, then resume the old executor.
  It must receive `DEPLOYMENT_FENCE_STALE` and produce no create/update/delete.
  Also pause an already in-flight mutation and prove takeover waits for it to
  quiesce before the fence advances.
- **Real-target proof:** after deterministic fault semantics pass on the fake,
  run the complete apply/reapply/rollback path against the preconfigured EU
  runsc host and record the authenticated hardening facts. The fake is not a
  substitute for this proof.
- **Acceptance:** one-command provisioning has proof, not only generated files.

## Verification

Commands depend on the implementation package; re-verify in the PR. Minimum:

```bash
pnpm typecheck
pnpm test
pnpm audit:imports
```

Run affected package build/typecheck/test plus any provisioning smoke added by
the PR.

## PR-PLAN reconciliation

- `pr1-plan-command-api` -> BBD1-001.
- `pr2-tenant-roots` -> BBD1-002.
- `pr3-secrets-runtime-config` -> BBD1-003.
- `pr4-endpoint-manifest` -> BBD1-004.
- `pr5-apply-smoke-runbook` -> BBD1-005.

## Review gates

- One command/API path covers tenant, workspace, runtime config, roots, secret
  refs, existing-surface endpoint binding, and deployment manifest.
- No raw secrets in outputs.
- EU host/tier selection follows architecture 10.
- Idempotency and dry-run behavior tested.
- Complete `desiredStateDigest`, append-only generation journal/fencing,
  per-step crash recovery, atomic complete-pointer update, concurrent
  convergence, conflict rejection, and new-generation full-snapshot rollback
  are tested.
- Provider-side target fencing prevents stale external side effects, not merely
  stale current-pointer publication.
- Factory-owned LP/GTM/pricing/CTA content is not built here.
