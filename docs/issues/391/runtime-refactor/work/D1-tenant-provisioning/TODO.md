# TODO-D1 - Tenant provisioning command/API

**HISTORICAL — this TODO describes the superseded dedicated-site model
(`currentCompleteGeneration`, per-site DNS/TLS cutover). The binding
execution contract is [D1-R0-SPEC.md §8](./D1-R0-SPEC.md). Do not implement
from this file.**

## Active multi-agent Docker v1 work order (2026-07-11)

**Dispatch state: D1-R0 and D1-001 through D1-004a1 are landed.** D1-004a2 is
active; dispatch the remaining exact implementation beads in
[`D1-R0-SPEC.md`](./D1-R0-SPEC.md) in order. Never dispatch the historical
section below.

### D1-R0 — Host collection tracer and micro-plan (spec, S)

- [x] Accept [`D1-R0-SPEC.md`](./D1-R0-SPEC.md) via #649.
- [x] Confirm the stable one-process N-binding composition preserves in-flight
      work by allowing only additive/landing-only online revisions and rejecting
      active binding replacement/removal.
- [x] Confirm agents are not per-container and no P2/runsc or P5a gate remains.
- [x] Confirm D1-001 through D1-006 name exact files, stable errors, proof,
      rollback behavior, <=400-line PR budgets, and current-code owners.

### Active implementation order after D1-R0 acceptance

1. **LANDED — D1-001: plan and canonical composition identity (#652).** Strict host plan,
   trustworthy final inventories, redacted canonical digest, requirement
   refusal, independent P6-R inputs. No mutation or routing.
2. **LANDED — D1-002: revision store and OS-local CLI (#653, #654, #660,
   #662, #665).** Lock/CAS, immutable candidate
   and COMPLETE records, atomic pointer, exact destructive confirmation,
   rollback-as-new-revision. No app management API.
3. **LANDED — D1-003: stable-process Compose, runtime inputs, and Docker
   boundary proof (#667, #672, #675–#680).** Ingress, one full-collection
   core process, external `databaseRef`, per-binding env plus external tmpfs
   secret mounts, durable roots, maintenance-only service-specific `--no-deps`,
   and no force-recreate.
4. **LANDED — D1-004a1: explicit proxy and edge policy (#684).** Secure generic
   default, exact D1 proxy peer/hop count, deterministic edge network, and the
   pre-effect overlap guard are complete.
5. **ACTIVE — D1-004a2, then a3a/a3b/a4, b/c/d: mounted reader, host surface,
   authority fences, and admission.** A read-only repo-owned ingress artifact,
   exact Docker-proven Caddy digest, and real echo proof must canonicalize
   forwarding before the trusted host scope accepts `X-Forwarded-Host`.
   Present RFC Forwarded fails with stable `D1_HOST_SCOPE_VIOLATION`; no D1
   scope consumes forwarded authority before that proof. Trusted exact-host
   landing grants nothing;
   member-only bound workspace and all selectors fail closed; the database
   admission row commits before first agent effect and survives cleanup.
6. **D1-005 — N-binding boot/additive publication.** N independent P6-R calls,
   root-owned pending-pointer/signal preload, all-ready ack, atomic active
   pointer, stable-process continuity, and fail-closed active replacement/removal.
7. **D1-006 — runbook and EU proof.** Reproduce the landed edge-network overlap
   guard and exact owned-network reuse on the EU host. Then prove three
   agents/workspaces/hostnames, timing, idempotence, N+1 continuity, rollback
   reproduction, isolation and secret canary. Dedicated VM is configuration
   render only.

### Prerequisites — stop if false

- The landed A1 compiler produces the compiled bundle. A1 local dev is not a
  D1 prerequisite; it is recut after this tracer's composition producer lands
  and gates the P8 developer journey.
- P6-D definition/deployment schemas/digests and the verified A1 compiled bundle
  exist; BBP6-003 lookup is not a prerequisite.
- P1 lifecycle/readiness and stateless P6-R exist.
- The Docker host uses the existing approved workspace/runtime composition;
  P2 provider extraction and runsc validation are not prerequisites.
- The shared N-workspace host resolves an immutable production-approved
  `runtimeProfileRef` and verifies its content/attestation digest proving sibling
  filesystem and process denial. The plan cannot self-assert this fact.
  Trusted-direct is only a local
  development or single-workspace dedicated composition; it cannot satisfy
  this shared-host prerequisite regardless of operator trust.
- P5a is optional until D1-R0 demonstrates a missing host-readiness or secret-
  reference seam; D1 owns apply, digest, and rollback.

### Required D1 outcomes locked by D1-R0

1. Define one redacted Docker-host plan/apply input containing a collection of
   site bindings. Each binding carries bundle/deployment refs, exact hostname,
   bounded landing copy, owner principal ref, workspace/runtime roots, and
   secret refs.
2. Create or bind each managed workspace using existing auth/membership;
   enforce cross-workspace denial while allowing the host to serve N bindings.
   Fence existing workspace list/create/switch/delete and default auto-create
   behavior on the bound hostname; fail non-members before any auto-provision.
3. Materialize and verify every bundle without checkout access; authorize each
   workspace composition through the current host seam, produce its canonical
   redacted identity/digest as specified by D1-R0, and bind its deployed
   agent as that workspace's `default`.
   Validate every declared capability/tool/skill/MCP requirement against the
   final activation before emitting the composition digest. Missing inventory
   or an unsatisfied ref fails `AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED`;
   requirements never activate contributions.
4. Add only P5a host readiness and secret brokerage required before a site
   binding is published. Do not add a provider registry or runsc gate.
5. Apply idempotently and persist one complete redacted host snapshot/digest
   over the full site-binding collection. Never persist secret values.
   Rollback rematerializes the prior collection and reproduces every P6-R
   digest. Do not create a P6 generation store.
6. Prove at least three agents/workspaces/hostnames in one deployment, including
   sibling filesystem/process denial, cross-binding selector denial,
   setup-to-first-run timing, changed collection values, complete rollback,
   and secret canary. Document dedicated VM as a second composition of the
   same artifact, not another implementation.

M1/M2, AR1, D2, P3 scoped registrars/plugin snapshots, E1 attachment catalogs,
multi-generation session retirement, and P2/X1 provider/mount migration are not
dispatchable from this work order.

## Historical dedicated-site D1 work order — non-dispatchable for v1

The historical beads below require a fresh recut before dispatch. Any bead that
assumes one host-owned workspace, `agentId === 'default'` as the only host agent,
or mandatory P2/runsc is superseded by the active work order above.

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
roots, secret references, materialized immutable agent bundle, exact-host
landing/auth/workspace binding, existing-surface endpoint, and deployment
manifest for the chosen EU host.

## Non-negotiables

- No raw secrets in logs, manifests, comments, or generated docs.
- No US-hosted service as default or hard dependency.
- Production D1 uses the P2 runsc/systrap provider through a P5a-authenticated
  preconfigured EU worker. Direct, bwrap, Vercel, fake, or unverified workers
  cannot satisfy the v1 deployment proof.
- D1 v1 accepts only `AgentDeployment.agentId === 'default'`, matching the T1/T2
  single-agent route. A non-default deployment fails
  `AGENT_ROUTE_UNSUPPORTED`; P7 is the post-v1 owner of registry-backed ids.
- The D1 site binding is factory/host input, never reusable agent behavior. V1
  accepts only a lower-case exact hostname under an operator-approved parent
  domain; no wildcard tenant router, arbitrary origin, path, port, userinfo, or
  caller-supplied forwarding header. Unknown/mismatched hosts fail closed.
- The landing document accepts bounded escaped text fields only (`title`,
  `summary`, optional `ctaLabel`). No arbitrary HTML/JS, external redirect,
  secret, workspace id, internal agent id, tool inventory, or runtime detail is
  rendered into the public page.
- Landing access grants no workspace authority. The CTA enters the existing
  same-origin existing-member sign-in with a fixed local return path. Existing
  invite links remain the separate onboarding path and reuse current auth
  behavior; D1 adds no signup lifecycle or auth-policy abstraction. After
  authentication, the server resolves the one D1-provisioned workspace from
  trusted site state, checks existing membership, and rejects non-members
  without revealing workspace/agent details. A browser-provided workspace id
  or agent id can only match the binding; it cannot select another target.
- The provisioned workspace resolves the D1 deployment's active complete
  generation as `default`. Landing configuration is not another agent registry
  or routing authority.
- The dedicated app installs one server-derived `DedicatedWorkspaceScope` from
  the active complete site binding. Every workspace selector intersects this
  scope before lookup: workspace list/detail/update, members/invites, settings,
  runtime, agent, sessions, files/UI, `registerFullAppBoringMcpRoutes`, runtime
  plugin RPC (`/api/v1/plugins/:pluginId/*`), plugin-front runtime/assets,
  `paneRenderStatusRoutes`, and WorkspaceBridge HTTP/token/runtime paths. Any
  request header/path/query/body/token claim carrying a workspace id must pass
  the same scope. List returns only the bound workspace when the principal is a
  member; create/switch to another workspace fails with a stable code. The
  D1-created workspace is marked managed, so ordinary workspace deletion is
  denied and lifecycle remains D1-owned. The front renders fixed-workspace mode
  and hides create/switch/delete controls, but server enforcement is the
  security boundary. Thread the same optional scope into the existing
  post-signup workspace-provisioning hook: when dedicated scope is active and
  no invite was accepted, create no personal default workspace and grant no
  membership. Existing invite acceptance and generic-mode signup behavior stay
  unchanged. Apply the managed-workspace guard inside account deletion and
  ownership mutation too: `deleteUserCompletely` and member-role/remove paths
  cannot delete, transfer, demote, or orphan the D1 workspace outside the
  fenced D1 lifecycle. V1 blocks deletion of the bound creator/last managed
  owner with a stable code before any account/workspace mutation; ordinary
  member account deletion may remove only that member's own data/membership.
- The D1 durable apply store enforces global uniqueness for normalized exact
  hostname and `appId`. First apply atomically reserves both to the
  `TenantAgentTargetKey` before any DNS/TLS/provider mutation. A different
  target conflicts before side effects; the same target may resume/retry its
  incomplete generation. This reservation is provisioning identity, not a D2
  live multi-tenant Host router.
- DNS/TLS publication and `currentCompleteGeneration` advancement require a
  host-produced `DedicatedSiteCapability` readiness record proving both
  BBD1-005 fixed-workspace enforcement and BBD1-006 landing/sign-in/default-
  agent wiring are installed at named contract versions. It is an attestation
  bound to `TenantAgentTargetKey`, the current fencing token, staged
  `desiredStateDigest`, exact `{ appId, hostname, workspaceId, agentId:
  'default' }`, `hostAppArtifactDigest`, and activated-plugin snapshot digest;
  it is not a plan/caller claim. For in-process hosts, only an unexported host
  mint can return the opaque capability handle. For remote hosts, the D1
  verifier issues a fresh challenge and consumes the response directly through
  P5a's pinned-TLS authenticated worker channel; the response binds nonce,
  worker issuer, D1 control-plane audience, expiry, and contract version. No
  public plan/API field accepts a serialized capability. Publication and
  pointer CAS validate provenance and every field against the current staged
  generation. Missing, forged, stale, cross-target, or cross-generation replay
  fails before endpoint publication or pointer CAS.
- Host mode is trusted composition, never inferred solely from caller `Host`.
  `GenericHostMode` preserves the existing generic app only on its separately
  configured listener/router. `DedicatedHostMode { hostname, targetKey }`
  accepts exactly that normalized host from the direct socket or configured
  trusted-proxy chain; every other host returns a generic
  `D1_HOST_MISMATCH`/404 before auth or routing and can never fall through to the
  multi-workspace app. Within the generic listener, a reserved hostname with no
  matching `currentCompleteGeneration` returns `D1_SITE_NOT_ACTIVE`; a reserved+
  complete hostname returns the generic public form of
  `D1_DEDICATED_ROUTE_REQUIRED` and is never served by the generic app. The
  trusted edge routes it to its dedicated composition, which derives
  `DedicatedWorkspaceScope` from bound config + pointer rather than caller
  fields. On first apply prepare route/certificate state but CAS the complete
  pointer before external DNS/TLS activation. On reapply the prior complete
  pointer remains authoritative until replacement CAS.
- D1 pins the immutable host-app artifact plus P3 BBP3-020
  `ActivatedWorkspacePluginSnapshot`. Mutable directory-only plugin sources are
  not production inputs. Reapply/restart/rollback must materialize the same host
  artifact and plugin snapshot; enablement/order/code/manifest/prompt/
  contribution drift creates a different desired state.
- Session roots follow `BORING_AGENT_SESSION_ROOT` / durable host-volume rules;
  they are not inside container home/root by default.
- The generic landing/auth/workspace mechanism is in scope. Bespoke page code,
  generated marketing copy, pricing, analytics funnels, and campaign tooling
  remain `boring-ui-factory` scope.
- Provisioning is idempotent: re-running reports existing resources or applies a
  safe delta, never silently creates a second tenant.
- Apply is journaled and fenced. One durable `TenantAgentTargetKey { tenantId,
  agentId }` owns exactly one route binding, append-only generation sequence,
  monotonic fence, and atomically updated `currentCompleteGeneration` pointer.
  Before journaling, resolve the host profile to immutable
  `ResolvedHostIdentity { workerId, endpointOrigin, serverIdentityFingerprint,
  region, providerAccountId }` and canonical `hostIdentityDigest` (no private
  credential). The first apply CAS-binds its `deploymentId`, informational
  `hostProfileId`, `hostIdentityDigest`, site `appId`, exact `hostname`, and
  opaque workspace-owner ref. Later v1 applies must keep the deployment id,
  immutable host digest, app id, hostname, and owner ref while varying
  deployment version/desired state through the same chain. A second deployment
  id, site identity, hostname, owner binding, or host relocation for the same routed
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
  definition and deployment digests plus opaque attachment refs; immutable
  host-app artifact digest, activated-plugin snapshot digest, and canonical
  static-host-prompt input digest (including `systemPromptAppend`); host profile,
  immutable host-identity digest, and
  isolation tier; workspace/storage/session roots and retention policy; secret
  reference names and requested grant ids; opaque workspace-owner principal
  ref; exact hostname, app/site identity, landing content digest,
  authentication origin/callback config, dedicated-site capability contract
  versions, endpoint and network policy; selected image digest; and desired
  service commands. These are plan
  inputs known before side effects. It excludes raw principal/email values,
  raw secrets, readiness/status observations, provider resource ids, and
  `resolvedSnapshotDigest`.
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
  surface endpoint policy. It also carries a host-owned `DedicatedSiteSpec`
  containing stable `appId`, exact `hostname`, opaque `workspaceOwnerRef`, and
  bounded plain-text `landing { title, summary, ctaLabel? }`. The owner ref
  resolves only in the trusted
  host and raw principal/email identity is absent from plan/manifest output. It
  contains no executable page content, pricing, or external CTA URL.
  It also carries the immutable `hostAppArtifactDigest` and the P3 BBP3-020
  `ActivatedWorkspacePluginSnapshot` digest whose source artifacts are
  available to the target. Mutable directory-only plugin sources reject before
  apply. It carries the canonical static-host-prompt input digest, including
  static `systemPromptAppend`; per-turn `systemPromptDynamic` output is not a
  plan input.
  Public-demo/MCP exposure remains M2. Compute
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
- In the same durable pre-side-effect transaction, reserve normalized hostname
  and `appId` under unique constraints to this target. Reapply/recovery by the
  same target is idempotent. A different target receives
  `D1_SITE_BINDING_CONFLICT`; it cannot race to the DNS/TLS adapter.
- Add stable site errors at the host boundary: invalid/unapproved site config,
  unknown host, membership denied, and caller selector conflict must be
  distinguishable by code. Public responses for unknown host and membership
  denial remain generic and reveal no valid workspace/agent id.
- The active selector and provider fence use the same `TenantAgentTargetKey`.
  `ResolvedAgentRegistry` for the tenant/default route reads only this selector;
  there cannot be two current pointers for one `(tenantId, agentId)`.
- **Tests:** dry-run emits deterministic plan including definition/deployment and
  desired-state digests and explicitly no predicted resolved digest; changing
  host/tier/root/secret-ref/hostname/app/landing/auth-origin/endpoint/network/
  owner-ref/host-app/plugin-snapshot/static-host-prompt/image/command changes
  `desiredStateDigest`; unknown
  definition/host/secret/owner ref or invalid asset digest fails
  closed; no apply side effects in dry-run.
  Invalid/unapproved hostname and unsafe landing text reject before side
  effects. A second deployment id or changed resolved host identity for an
  already bound route rejects before journal/provider mutation, including
  retargeting the same profile id to a new endpoint, worker, account, region,
  TLS/server-identity pin, app id, hostname, or owner ref. Landing
  copy may change through the same generation/CAS/rollback chain.
  Concurrent plans from different targets claiming the same hostname or app id
  produce one reservation winner and one stable conflict with zero provider
  effects from the loser.
- **Acceptance:** operators can review a complete plan before apply.

### BBD1-002 - Tenant/workspace + DB/storage/session roots (M)

- **Files touch/create:** provisioning adapters for tenant/workspace records and
  root allocation.
- **Notes:** Session history root is a host durable volume sibling to workspace
  roots by default (`/data/pi-sessions` beside `/data/workspaces` when applicable).
  Resolve `workspaceOwnerRef` in the trusted host and create the existing owner
  membership atomically with the single workspace. Mark it with a D1 managed
  owner (`managedBy` or the canonical generalized managed-workspace field) so
  ordinary workspace deletion is denied; only the fenced D1 lifecycle may
  remove it. Later members enter through existing workspace invites; no landing
  request can add membership.
- **Apply rule:** tenant/root creation uses provider idempotency keys derived
  from apply target + stable logical resource key + desired-state digest + step,
  while the separate monotonic fence rejects stale generations. Persist the provider resource id
  before advancing. A provider that cannot idempotently create-or-find the same
  resource is unsupported for D1.
- **Tests:** creates tenant + one owner-bound workspace once; rerun is
  idempotent; unknown owner ref fails before workspace creation; owner identity
  is redacted from plan/manifest/log output; managed workspace deletion through
  the normal API fails with a stable code; roots are outside container home/
  root; cross-tenant roots cannot collide.
- **Acceptance:** tenant/workspace and root layout are repeatable and inspectable.

### BBD1-003 - Secrets and runtime config materialization (M)

- **Files touch/create:** secret-ref resolver, runtime config writer, redacted
  manifest projection.
- **Notes:** Consume P5 brokering. Store secret refs/handles, never raw secret
  values. Runtime config records provider facts and selected image/tier; the
  image is derived from `AgentDeployment.runtimeProfileRef` when
  present, else the validated provider-default image, while tier stays the
  host/EU deployment choice. Configure the existing auth service with the exact
  site origin/callback allowlist from trusted D1 state; forwarded host values
  are honored only from configured trusted proxies. Do not add a second signup
  policy; member sign-in and existing invite links keep current behavior.
- **Tests:** raw secret canary absent from logs/manifests; missing secret ref
  fails closed; runtime config includes the selected runtime image plus EU
  host/tier facts.
- **Acceptance:** deployed runtime can start without leaking secrets.

### BBD1-004a - Bundle materialization, inactive-host guard, endpoint preparation, and manifest (M/L)

- **Files touch/create:** bundle uploader/materializer, exact-host HTTP/workspace
  endpoint plus DNS/TLS-route adapter, the earliest global trusted-host ingress
  guard, and deployment manifest generator for the chosen EU host.
- **Notes:** V1 uses existing host authentication/routing. `exposureId`, public
  demo policy, and MCP bearer modes remain M2. The
  uploader writes only normalized bundle paths, verifies each asset digest and
  the canonical definition digest on the target, then atomically selects the
  verified bundle. Materialize/verify the pinned host-app artifact and activated
  plugin snapshot before readiness; the loaded records must reproduce the P3
  snapshot digest or fail closed. A preconfigured operator DNS/TLS adapter may
  prepare the exact-host route/certificate but keeps first-apply external
  activation off. Before any route/certificate preparation, install a global
  ingress guard keyed by trusted composition mode. Generic mode rejects a
  reserved host: incomplete is `D1_SITE_NOT_ACTIVE`, complete requires the
  dedicated route and never falls through. Dedicated mode accepts only its
  configured exact host from the direct socket/trusted-proxy chain and rejects
  every non-bound or missing host before generic auth or route dispatch;
  arbitrary direct-origin `Host` values never select generic behavior.
  BBD1-005 extends this same hook with fixed-workspace scope rather than
  installing a second guard. Stage P6-R
  and persist the incomplete generation, but do not
  append completion, CAS the pointer, or activate the external route in this
  bead. Define the `DedicatedSiteCapability` verifier consumer interface with no
  fake/default producer; missing capability remains the normal dormant state
  until BBD1-005/006 land.
- **Tests:** a target with no source checkout materializes and verifies the
  bundle/host/plugin/static-prompt inputs; route/certificate preparation stays
  externally unpublished; reserved/no-pointer probes on generic ingress fail
  inactive and reserved/complete probes never reach generic handlers, while
  non-bound/missing-host probes on the dedicated origin fail
  host-mismatch across representative route families before any handler; P6-R
  staging remains unroutable; tampered/missing
  assets and unavailable immutable plugin artifacts reject; prepublication
  manifest contains no raw secrets. No test injects fake site readiness.
- **Acceptance:** deployment artifacts and an exact-host route are prepared and
  reviewable, but the dedicated site cannot become externally live.

### BBD1-005 - Enforce the one managed workspace across server and front (M/L)

- **Files touch/create:** dedicated full-app/core composition, the central
  workspace-scope resolver used by workspace/runtime/agent/session/file routes,
  `registerFullAppBoringMcpRoutes`, runtime plugin gateway and plugin-front
  routes, P3's scoped workspace-route registrar plus raw-route rejection, pane-
  render status/UI routes, WorkspaceBridge HTTP/token/runtime paths, managed-
  workspace deletion guard, the existing post-signup workspace-
  provisioning hook, account-deletion (`deleteUserCompletely`) and member-role/
  removal paths, and fixed-workspace front/plugin consumers.
- **Notes:** Extend BBD1-004a's earliest exact-host ingress guard centrally
  against trusted host mode, the D1 reservation, and active pointer; do not add
  another host hook. Generic multi-workspace behavior exists only in explicit
  `GenericHostMode`; a dedicated process rejects every non-bound host. A
  reserved exact host without a matching complete generation fails
  `D1_SITE_NOT_ACTIVE` before auth, route, store, registry, or token behavior. A
  reserved+complete dedicated composition derives `DedicatedWorkspaceScope {
  appId, workspaceId, agentId:'default' }`. Thread this discriminated result
  through the existing core/workspace adapters; do not add route-local host
  parsing or another workspace registry. Every request workspace selector must
  equal the bound id before membership lookup. `GET /api/v1/workspaces` returns
  at most the bound workspace and never calls default-workspace auto-creation in
  this mode. `POST /api/v1/workspaces` and ordinary deletion of the managed
  workspace fail with stable codes. Detail/update/members/invites/settings/
  runtime/agent/session/files/UI routes all reject a foreign id even when the
  principal belongs to that other workspace. MCP, runtime-plugin, plugin-front,
  pane-status, and WorkspaceBridge selectors/claims pass through the same
  resolver before registry/store lookup or token minting. The front consumes
  fixed-workspace mode and removes create/switch/delete controls; plugin/front
  clients never synthesize another workspace id. Server checks remain binding.
  Install the host/scope hook before plugin registration, but do not claim it can
  infer every plugin's semantic selector. Dedicated mode mounts only P3
  BBP3-020 `scopedRoutes` contributions through the host-owned
  `ScopedWorkspaceRouteRegistrar`, which supplies the bound `Workspace`, scoped
  repositories, and `agentId:'default'` without exposing a global workspace/
  session/project registry. Indirect ids such as `sessionId` or `projectId`
  resolve only inside those scoped repositories. A legacy/arbitrary
  `WorkspaceServerPlugin.routes` contribution makes D1 readiness fail
  `D1_PLUGIN_ROUTE_SCOPE_UNVERIFIED`; it is never mounted. Generic mode keeps
  compatibility. An import invariant prevents scoped route modules from
  importing global registries/resolvers, and the activated-plugin snapshot binds
  raw-vs-scoped route mode plus contract version.
  Pass the optional scope to the existing post-signup hook. A non-invite signup
  in dedicated mode creates no personal workspace and receives no access; a
  valid invite keeps the existing acceptance path. Do not introduce a D1 auth
  policy or change generic signup behavior. Before account deletion or member
  ownership mutation, detect the managed D1 workspace. Block any operation that
  would delete/transfer/orphan it with `D1_MANAGED_WORKSPACE_OWNER_REQUIRED`
  before user/workspace mutation. Only an explicit fenced D1 lifecycle action
  may later transfer ownership or decommission; neither is an ordinary v1 user
  route.
- **Tests:** member list returns exactly the bound workspace; non-member list is
  empty or the stable generic denial without ids; default auto-create and POST
  create do not create a workspace; direct detail/update/delete and every
  runtime/agent/file/session selector reject a second workspace; managed delete
  rejects; non-invite dedicated signup creates no workspace/membership; invite
  acceptance joins only the bound workspace; invite/member operations work only
  for the bound workspace. Bound creator/last-owner account deletion and owner
  demotion/removal fail atomically; a non-owner member account deletion removes
  no workspace and generic-mode account deletion remains unchanged. Full-app
  MCP, runtime-plugin RPC, plugin-front asset/
  runtime, pane-status, and WorkspaceBridge foreign-selector/token cases all
  reject before lookup/minting. A tasks-style
  raw `WorkspaceServerPlugin.routes` fixture is rejected at D1 boot. A scoped
  fixture receives the bound workspace and attempts explicit foreign ids plus
  indirect foreign `sessionId`/`projectId`; every case rejects through the
  scoped repositories before its effect counter increments. Bound requests
  receive the trusted workspace. The front cannot switch/create/delete and its
  plugin/UI clients use only the fixed id. Disabling the optional D1 scope
  preserves existing generic signup and multi-workspace behavior only on the
  separately configured generic listener. For a reserved host, fault-inject no pointer and
  exercise landing/auth plus every named route family directly at the origin;
  all fail inactive before generic handling.
- **Acceptance:** the dedicated site cannot escape its one D1-managed workspace
  through UI or direct API calls.

### BBD1-006 - Dedicated landing -> sign-in -> default agent (M)

- **Files touch/create:** minimal landing route/view in the existing full-app
  surface, same-origin sign-in handoff, trusted site-to-workspace resolver, and
  workspace agent-default binding.
- **Notes:** `GET /` on the exact configured host serves only the bounded
  `DedicatedSiteSpec.landing` projection. The CTA uses a fixed local sign-in
  path and fixed local post-auth destination. Existing invite links remain the
  separate new-user path and keep current auth behavior. Dedicated-mode sign-in
  UI does not advertise generic self-signup; a manually reached non-invite
  signup still receives no workspace through BBD1-005. After auth, consume
  BBD1-005's trusted D1 workspace scope, require membership, then enter the
  normal workspace UI in fixed-workspace mode. The workspace agent adapter
  resolves only the deployment bound as `agentId:'default'`; public request
  fields and headers cannot select a different workspace, deployment, or agent.
- **Tests:** exact host gets its landing and unknown/malformed host fails closed;
  markup escapes all text; unsafe/excess landing data rejects; CTA has no open
  redirect; unauthenticated access reaches sign-in but not workspace data;
  member enters the bound workspace; existing invite onboarding remains
  unchanged; non-member receives the stable generic denial; a forged workspace/
  agent header cannot escape the binding; the first chat turn records the
  deployed definition/deployment/resolved digests and routes to `default`.
- **Acceptance:** the user-visible v1 path is real: dedicated URL -> landing ->
  sign-in -> authorized workspace -> deployed agent as default.
- **Activation:** register the host-produced `DedicatedSiteCapability` readiness
  record only after this journey and BBD1-005's fixed-workspace enforcement are
  both installed. Bind it to the current target/fence, staged desired state,
  exact site/workspace/default-agent binding, and host-app/plugin snapshot.
  The host owns an unexported in-process opaque mint and a remote P5a worker
  handler that answers only a fresh pinned-TLS authenticated D1 challenge. The
  remote response binds nonce, issuer, audience, expiry, and contract version.
  BBD1-004b calls this verifier directly; neither config nor request input can
  synthesize, inject, or replay the capability across a target/generation.

### BBD1-004b - Authenticated completion and exact-host publication (M, after BBD1-005 + BBD1-006)

- **Files touch/create:** D1 final apply orchestration, the capability verifier
  consumer from BBD1-004a, completion/pointer integration, exact-host route
  activation, and final publication observation/manifest status.
- **Notes:** This bead consumes the real BBD1-005/006 scope/site implementation
  and mint; it never installs a fake readiness producer. Obtain
  `DedicatedSiteCapability` from the unexported in-process mint or directly over
  P5a's fresh-nonce pinned-TLS worker channel. It must prove the exact target/
  fence/staged desired-state/site/host-app/plugin identity. Missing, forged,
  stale, or replayed capability fails `D1_SITE_SURFACE_UNAVAILABLE` before
  pointer CAS or route activation. Reverify the BBD1-004a staged P6-R generation
  against current roots, attachments, secrets/status, provider facts, and P5
  readiness. Append the immutable completion record with its resolved digest,
  then CAS `currentCompleteGeneration { agentId, generationId,
  resolvedSnapshotDigest, completionDigest }`. The completion records trusted
  site binding `{ appId, hostname, workspaceId, agentId:'default',
  routeIdentity }`; public landing data omits internal ids. Revalidate the
  pointer/fence, then activate the prepared exact-host route and append the
  final publication observation. First-apply crash after CAS/before activation
  leaves a complete internal generation but no reachable hostname; resume may
  publish it. Direct origin requests for a reserved host before CAS return
  `D1_SITE_NOT_ACTIVE`.
- No-op detection compares the complete current `desiredStateDigest`, not only
  `resolvedSnapshotDigest`. Even when desired state matches, re-run P6-R against
  current authenticated provider/environment/readiness/grant facts and require
  exact reproduction of the current resolved digest before returning the
  completed generation as a no-op. Reproduction failure fails closed; a newly
  valid but different resolved digest creates a new completion and takes the
  changed-generation transition despite unchanged desired input. A different
  desired digest that resolves to the same runtime digest still appends
  completion, CASes the new desired generation, and applies landing/auth/
  endpoint/network deltas, but it does not restart the app or retire sessions.
- A different resolved digest uses BBP6-011's v1 generation-transition contract.
  Prepare and readiness-check the replacement app process on an internal,
  unrouted slot first. Under the non-stealable target executor, set the exact-
  host transition gate (`D1_SITE_TRANSITIONING`), stop HTTP and in-process
  admission through P6's single admission check, and bounded-drain in-flight
  turns. Append completion, then atomically CAS the pointer and
  persist `HostGenerationTransition { priorDigest, nextDigest, state:
  'switch_pending' }` in the D1 store; prior sessions and refs remain intact.
  A pre-commit failure/stale CAS lifts the gate and keeps the old process and
  sessions live. After commit, recovery only completes forward while the gate
  stays closed: switch internal ingress to the verified replacement, recheck
  pointer/fence/digest, idempotently retire prior-generation sessions/release
  refs, permanently disable/unbind and stop the old listener, and prove a direct
  request to it fails stale/unreachable. Only then persist `switch_complete` and
  reopen admission on the replacement; final process disposal is idempotent.
  A crash cannot expose a new pointer through old boot routes or retire sessions
  while the old pointer remains authoritative. V1 accepts bounded deployment
  downtime instead of a multi-generation session router. The final manifest
  records definition/deployment/
  resolved/desired/static-prompt digests, generation/completion, host/plugin
  artifacts, exact route identity, roots, network/image/tier, and commands.
- **Tests:** real mint and verifier complete the positive path; no fake producer
  exists. Capability missing/forged/stale/replayed performs no pointer or route
  activation. Crash after staging, completion append, pointer CAS, and before/
  after first publication resumes safely. Changed-generation tests prove the
  replacement is ready before gating, old sessions terminalize durably, a
  follow-up fails `SESSION_GENERATION_RETIRED`, only one process admits, and
  crash at every transition boundary resumes without pointer/process mismatch;
  stale/pre-CAS failure preserves old sessions, post-CAS failure completes
  forward, same-desired no-op requires fresh resolved-digest reproduction, and
  desired-only/same-resolved changes publish without process/session churn.
  Same-desired but changed authenticated resolved facts cannot false-no-op.
  Direct requests to the old listener reject on boot-digest mismatch after
  pointer switch and before old routes run. Unknown/mismatched host rejects;
  unsupported host/tier/image and artifact/static-prompt mismatch reject before
  publication. The final manifest contains no raw secret.
- **Acceptance:** only the real BBD1-005/006 surfaces can authorize pointer CAS
  and exact-host publication; the final manifest binds all immutable identity.

### BBD1-007 - Apply smoke + rollback notes (M)

- **Files touch/create:** CLI script
  `smoke:agent-factory-v1` (invoked as
  `pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <host-profile>`),
  fake-provider fault harness, and rollback/runbook docs. P8 BBP8-006 consumes
  this exact smoke; do not create a second harness there.
- **Notes:** Smoke records elapsed time and validates tenant reachability,
  exact-host landing/TLS reachability, authenticated member handoff, bound
  workspace/default-agent behavior, workspace/runtime config, all three
  identity digests, host-app/activated-plugin snapshot identity, idempotent
  reapply, same-generation real-process restart plus session follow-up, changed-
  generation session retirement, and rollback to the previous complete
  desired-state snapshot. Rollback is an
  explicit CAS from the current generation id/completion digest and appends a new
  generation copied from the immutable previous completed snapshot; it never
  mutates or reselects the old journal in place. It must reproduce the prior
  desired-state and resolved-snapshot digests or fail closed, then records its
  own actual observed state and a **new** completion digest. Resource versions
  are not copied and completion-digest equality with the old generation is not
  required.
- **Plugin drift proof:** change trusted plugin enablement, order, prompt/tool
  contribution, manifest/source digest, or host-app artifact digest; apply must
  create a different desired generation. Rollback materializes the prior
  immutable host artifact/plugin snapshot and reproduces its resolved digest.
- **Session/process proof:** restart the exact-host app without changing its
  pointer and continue one completed session on the same resolved identity.
  Identical reapply leaves that process/session untouched only after fresh P6-R
  reproduction; authenticated resolved-fact drift transitions or fails closed.
  The changed apply and subsequent rollback each admit from only one process,
  durably retire the replaced generation's sessions, preserve readable history,
  reject follow-up with `SESSION_GENERATION_RETIRED`, disable the old listener,
  and require a fresh active-generation session. Direct old-origin admission
  rejects on immutable boot-digest mismatch before old routes.
- **Static prompt drift proof:** change static host `systemPromptAppend`; apply
  must change desired state and resolved `staticPromptDigest`. Rollback restores
  the prior source-labeled static prompt plan. Per-turn `systemPromptDynamic`
  output is recomputed and remains outside static identity.
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
  runsc host, including same-generation restart and both changed-generation
  retirement transitions, and record the authenticated hardening facts. The
  fake is not a substitute for this proof.
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
- `pr4-endpoint-preparation` -> BBD1-004a.
- `pr5-dedicated-workspace-scope` -> BBD1-005.
- `pr6-dedicated-site-journey` -> BBD1-006.
- `pr7-publication-integration` -> BBD1-004b.
- `pr8-apply-smoke-runbook` -> BBD1-007.

## Review gates

- One command/API path covers tenant, workspace, runtime config, roots, secret
  refs, exact-host landing/auth/workspace/default-agent binding, existing-
  surface endpoint, and deployment manifest.
- Dedicated mode scopes every server and front workspace selector to the one
  managed workspace; generic mode remains unchanged only on its trusted
  listener, a dedicated process rejects every non-bound host, and reserved-host/
  no-pointer ingress fails inactive.
- No raw secrets in outputs.
- EU host/tier selection follows architecture 10.
- Idempotency and dry-run behavior tested.
- Complete `desiredStateDigest`, append-only generation journal/fencing,
  per-step crash recovery, atomic complete-pointer update, concurrent
  convergence, conflict rejection, and new-generation full-snapshot rollback
  are tested.
- Provider-side target fencing prevents stale external side effects, not merely
  stale current-pointer publication.
- Exact-host landing -> auth -> authorized workspace -> deployed default agent
  is proven. Bespoke LP/GTM/pricing/campaign content is not built here.
