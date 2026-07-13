# D1-tenant-provisioning — Plan

Status: priority-1/v1 multi-agent Docker delivery gate; **D1-R0 and D1-001
through D1-004a4b are landed and ancestry-verified**. D1-004b1 (workspace
authority and signup fences) is the active micro-bead; D1-004b2 through D1-006
remain ordered behind it in
[`D1-R0-SPEC.md`](./D1-R0-SPEC.md) and `TODO.md`. The active contract and R0
spec supersede the historical dedicated-site design.

## Active owner-reframed v1 plan (2026-07-11)

D1 depends on the landed A1 compiler, stateless P6-R, and only the narrow P5a Docker-host facts it
actually consumes. It consumes A1's self-contained `CompiledAgentBundle`, the
minimal separate `AgentDeployment`, and the existing authorized workspace and
runtime composition. P2 provider extraction, runsc validation, X1 mounts, P3,
E1, T1/T2, M2, plugin snapshots, attachment catalogs, and P6 generation stores
are not prerequisites.

V1 delivery is one Docker image/compose deployment hosting N compiled agent
bundles and N authorized workspace bindings. Each configured exact hostname
(for example `insurance-comparison.senecapp.ai`) serves bounded landing content
and an authenticated handoff to one configured workspace. The hostname selects
a site binding, never authorization. Existing membership/invite policy decides
who may enter that workspace, and P6-R resolves the deployed definition selected
as that workspace's `default` agent. Multiple site/workspace/default bindings
share the same host process without sharing workspace authority, roots, or
sessions. A dedicated VM running the same artifact is deployment variant 2,
not a separate architecture or the v1 default.

The v1 collection is boot-time/deploy-time configuration with idempotent
apply/redeploy and rollback. D1 adds no wildcard router, runtime tenant CRUD or
list API, hot tenant lifecycle, cross-tenant administration, billing, or fleet
control plane. Those are D2/S3 concerns. Adding or changing a binding requires
a new apply, not an in-process control-plane mutation.

Container granularity is settled by D1-R0: one ingress fronts the current one
core-app process, which hosts the entire N-binding collection and calls P6-R
once per binding; agents are not per-container. Because current request leases
cannot prove disconnected producer completion, the first slice publishes only
additive/landing-only revisions in that stable process and rejects active
binding replacement/removal or runtime-input rotation before effects. See
[`D1-R0-SPEC.md`](./D1-R0-SPEC.md) for the immutable revision, rollback, Compose,
and session-continuity contracts.

Host mutation is operator-only. V1 exposes no application HTTP management
endpoint for plan/apply/publish/rollback. A local deployment CLI running with
OS-level access to the host state/config performs those operations, records the
requested operator reference and resulting host revision in the audit log, and
uses the expected-revision/destructive-confirmation rules below. Workspace
membership, hostname possession, bearer/API credentials, and an operator-ref
string never grant host-mutation authority.

Shared-host trust is explicit. Each binding uses a currently available
production-approved runtime profile with proven workspace-root and process
isolation; there is no direct/fake fallback. A trusted-direct profile is valid
only for local development or a single-workspace dedicated composition. It is
never valid for the shared N-workspace host, even when every definition, tool,
and user belongs to one operator trust domain. If no profile proves sibling
filesystem and process denial, shared-host apply fails closed or each site uses
dedicated-VM variant 2. P2 later extracts providers and strengthens conformance
without changing this D1 policy.

### Active deliverables

- Plan/apply one Docker host with a collection of exact-host site bindings and
  bounded landing content.
- Normalize trusted proxy/Host input once. Reject duplicate hostnames,
  workspaces, deployment ids, overlapping workspace/session roots, wildcard or
  ambiguous hosts, and caller-supplied forwarding authority before effects.
  V1 uses one hostname -> one workspace -> one deployed `default` binding.
- Bind each site to one existing or managed workspace and use existing
  membership authorization; hostname possession grants nothing.
- Fence the existing workspace lifecycle surfaces on a bound hostname. After
  authentication, workspace list returns only the bound workspace when the
  principal is a member; create, switch to a foreign workspace, ordinary
  delete, and personal-default auto-provision are disabled. A non-member fails
  before list-time auto-creation or any workspace effect. The managed workspace
  can be removed only by the operator D1 lifecycle.
- Materialize each P6-D bundle/deployment and select it as that workspace's
  agent `default` through stateless P6-R.
- Before producing the canonical composition identity or publishing, validate
  `capabilityRequirements`, `toolRefs`, `skillRefs`, and `mcpServerRefs`
  against the actual final authorized workspace activation. Requirements never
  grant authority. D1-R0 names the exact inventory seams; if a field has no
  trustworthy inventory yet, non-empty declarations fail closed. Use one
  stable `AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED` error with redacted
  `definitionId`, field, and ref details; do not create a requirement registry.
- Use the existing approved workspace/runtime composition. P2 changes the
  provider implementation later and cannot introduce a second D1 resolution
  path or block the Docker host.
- Keep session roots and workspace/runtime roots separate and durable.
- Make host apply optimistic-concurrency safe. Input carries
  `expectedHostRevision`; one atomic active-collection pointer advances only
  after the entire candidate collection is materialized and ready. Stale apply
  or rollback fails with a stable conflict code. Full-snapshot rollback creates
  a new host revision from a prior immutable snapshot. If its diff removes or
  replaces bindings added since that snapshot, the caller must explicitly
  confirm the exact destructive binding ids against the current revision;
  otherwise rollback rejects. CAS prevents unnoticed stale writes, not an
  explicitly confirmed removal.
- Compute a deterministic desired-state digest over the pinned host artifact,
  storage/root inputs, and full site-binding collection. The snapshot contains
  the full collection and,
  for each site, hostname, landing config, auth/membership/owner binding,
  workspace/default-agent binding, roots/runtime desired inputs, exact
  workspace-composition identity/digest from the D1-R0-specified canonical
  redacted producer, definition/deployment identity, and
  secret reference identities only. Fresh redacted readiness/secret status is
  an observed attestation that gates publication; it is not desired digest,
  rollback identity, or P6-R input. No secret value is stored. Rollback
  rematerializes the prior host collection and reproduces all P6-R digests.
  D1-001 landed the canonical workspace-composition digest producer; D1-002
  and D1-003 now persist and materialize that identity. This is D1 apply
  history, not a P6 generation registry.
- Publish each DNS/TLS binding only after hostname, workspace scope,
  membership, default-agent, runtime-isolation, host-readiness, and secret-
  canary checks pass. A partial candidate never becomes externally reachable.
- Prove that ordinary authenticated members and hostname holders cannot invoke
  plan/apply/publish/rollback and that no host-mutation app route exists.

### Active exit

One timed proof deploys three distinct agent bundles to one Docker host,
maps them to distinct authorized workspaces/default bindings, and proves each
exact hostname -> landing -> existing-member sign-in -> bound workspace ->
deployed `default` agent. It also proves cross-hostname/workspace selector
denial, idempotent reapply, collection-level mutation followed by exact host
rollback, reproduced P6-R digests, and no raw secrets. The same artifact has a
documented dedicated-VM composition, but v1 does not require a second live host.
Concurrent stale apply/rollback, duplicate binding, proxy-host confusion, and
overlapping roots fail before publication. Isolated profiles also prove sibling
filesystem/process denial. Trusted-direct proves only the single-operator trust
restriction and never claims tenant/process isolation.

## Historical dedicated-site durability design — non-dispatchable for v1

Everything below this heading is retained as design history only. It must not
reintroduce one-deployment-per-workspace, a P2/runsc gate, or a single-workspace
host invariant into active D1 work. Dispatch uses the active section above and
the ordering in `INDEX.md`.

> Phase: Phase D1 - tenant provisioning command/API · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) - EU host tiers, self-host default, runtime image and deployment constraints.
- [P5-provisioning-secrets](../P5-provisioning-secrets/TODO.md) - provisioning, readiness, managed services, and secrets brokering.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - canonical agent definitions.
- [A1-agent-authoring](../A1-agent-authoring/TODO.md) - compiled definition and local proof.

## Design context

D1 is the missing factory/platform bridge: a repeatable command/API that turns an
approved agent definition and tenant choice into a deployed EU-hosted tenant
workspace. Architecture 10 makes self-hosted EU infrastructure the viable
default. D1 owns the generic dedicated-site delivery mechanism and a bounded
landing configuration; bespoke LP design, copy generation, GTM campaigns, and
pricing still belong to `boring-ui-factory`.

Constraint (owner ruling 2026-07-11, see
[`REVIEW-2026-07-11-unknowns.md`](../../REVIEW-2026-07-11-unknowns.md)): v1
must yield a purely-Docker deployable artifact (one image/compose) runnable in
the owner's own prod or in a dedicated tenant VM; D1/provisioning choices must
not lock out either path.

Owner priority (2026-07-11): D1 v1 scope is ONE docker deployment hosting N
agent bundles mapped to workspaces (multi-agent single-host).
Dedicated-VM/hostname-per-tenant is the second deployment variant, not the v1
default.

## Deliverables

- One command/API that plans and applies tenant provisioning.
- Creates tenant/workspace records and resolved runtime config.
- Creates DB/storage/session roots with the host-side session-history rule.
- Creates/seals required secrets without logging raw values.
- Creates an exact-host endpoint/deployment binding over the existing
  HTTP/workspace surface; MCP exposure remains optional M2 work.
- Serves a minimal deployment-configured landing page, sends its CTA through
  existing authentication, and routes the authenticated principal only to an
  authorized workspace for the dedicated app.
- Binds the provisioned workspace to the deployed definition as agent
  `default`; it does not create a second agent-selection mechanism.
- Enforces the one D1-managed workspace across every workspace-bearing server
  route and front selector. Dedicated mode disables create/switch/ordinary
  delete and rejects every non-bound hostname. Generic behavior remains only on
  its separately configured listener; a reserved D1 host without a complete
  pointer fails inactive, while a complete reserved host is served only by its
  dedicated composition and never falls through to generic routing.
- Publishes DNS/TLS and the active generation only after host readiness proves
  the fixed-workspace scope and landing/sign-in/default-agent surface are both
  installed for the current target/fence, staged desired state, exact site
  binding, and host-app/plugin snapshot. Readiness comes from an unexported
  in-process mint or P5a's authenticated nonce-bound worker response, never a
  caller record. First apply CAS selects the complete scoped generation before
  external exact-host activation; a reserved host without that pointer fails
  inactive before generic routing. Stale or replayed readiness cannot publish
  and partial D1 stacks remain unreachable.
- Runs one boot-time host/plugin generation per site in v1. No-op compares the
  complete desired-state digest and freshly reproduces the current P6-R digest;
  resolved fact drift transitions or fails closed. Desired-only changes with the
  same resolved digest still publish without process/session churn. A different
  resolved digest prepares a verified replacement, gates admission, bounded-
  drains, atomically commits pointer + `switch_pending`, switches ingress,
  retires prior sessions, and disables the old listener before reopening. Pre-
  CAS failure preserves the old generation; post-CAS recovery completes forward.
  This accepts bounded deployment downtime and avoids a multi-generation session
  router or boot-route hot reload.
- Uploads/materializes the immutable bundle, pinned host-app artifact, and
  activated-plugin snapshot; verifies their digests on the target; and records
  the rollback target. Mutable directory-only plugin sources are not production
  inputs.
- Runs the timed v1 golden path with preconfigured infrastructure.
- Emits a deployment manifest for the chosen EU host/tier from architecture 10.
- Provides dry-run/plan output and idempotent apply behavior.
- Persists append-only fenced `DeploymentApplyGeneration`s plus one atomic
  `currentCompleteGeneration` pointer, so crashes and concurrent apply/reapply
  cannot overwrite history, duplicate resources, or select a partial snapshot.
- Uses one publication/fence chain per `(tenantId, agentId)`. Deployment id and
  resolved immutable host-identity digest are bound metadata, not alternate
  keys; a mutable profile name is insufficient. V1 rejects replacement/
  relocation, including same-id profile retargeting, instead of creating
  competing live pointers.
- Computes `desiredStateDigest` over the complete redacted desired snapshot,
  including host-app, activated-plugin snapshot, and static-host-prompt input
  identity, before side effects. Final P6-R resolution happens after
  materialization; its resolved/static-prompt/observed `completionDigest` is
  appended once before the complete pointer advances.
- Enforces a monotonic fence at every provider mutation. Pointer CAS alone is
  insufficient; an old generation resumed after takeover cannot create, update,
  or delete a target resource.

## Exit criteria

- A new tenant can be provisioned from one command/API invocation against a
  chosen EU host profile.
- The exact hostname serves the configured landing page. Its CTA completes
  member sign-in and enters an authorized workspace whose default agent is the
  deployed definition. Existing invite links remain the separate onboarding
  path. A member enters that workspace and a non-member is denied without
  leaking workspace or agent details.
- Direct API calls cannot list, create, switch to, delete, or route agent/file/
  session traffic through another workspace from the dedicated host.
- Account deletion and member ownership mutation cannot delete, transfer, or
  orphan the managed workspace outside the fenced D1 lifecycle.
- Missing, forged, stale, or replayed dedicated-site capability readiness
  produces no hostname publication and no active-pointer change.
- The generated manifest is sufficient for deployment/review and contains no raw secrets.
- The deployed host starts from materialized bundle content without access to
  the source checkout and reproduces the pinned host-app/plugin snapshot.
- Crash-at-every-step recovery and concurrent apply are deterministic; an
  incomplete generation never replaces the last complete pointer. Rollback
  creates a new generation from the immutable previous complete desired-state
  snapshot and verifies the same host-app/plugin snapshot and resolved digest.
- Restarting the unchanged active process preserves a completed session's exact
  generation. Changed apply/rollback terminalize replaced-generation sessions
  with readable history, disable the old listener before reopening, and require
  a new session on the active generation. Direct old-origin requests reject on
  immutable boot-digest mismatch before old routes.
- A paused old executor resumed after takeover is rejected before each provider
  side effect; unsupported providers cannot be used by D1.
- The generic landing/auth/workspace handoff ships. Arbitrary landing code,
  generated marketing copy, pricing, analytics funnels, and campaign tooling
  remain outside platform scope.
