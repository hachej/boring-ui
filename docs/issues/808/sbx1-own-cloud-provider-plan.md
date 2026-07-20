---
github: https://github.com/hachej/boring-ui/issues/808
issue: 808
state: ready-for-human
updated: 2026-07-20
flag: not-needed
track: owner
---

# gh-808 SBX1 own-cloud sandbox provider

## Authority

This is the remaining-work plan for `wt-391-forward-6gd`, **SBX1: own-cloud
sandbox provider (remote-worker executor fleet + runsc isolation)**, under
[Decision 26](../../DECISIONS.md). It is subordinate to the canonical
[`#808` extraction plan](plan.md): SBX1 adds a provider only after that plan's
copy -> verify -> swap sequence has completed.

This plan is plan-only. It creates no Beads and changes no product code. The
`SBX1.x` Bead chain near the end is a proposal for owner creation after review.

The Today inventory was verified against `origin/main` at
`f93450902be7dfb8c26209f78f0aab49585e85c9` on 2026-07-19. PR
[#823](https://github.com/hachej/boring-ui/pull/823) has merged the extraction
**plan**, but `SandboxProviderV1` and `WorkspaceSandboxPairV1` do not yet exist
in product code on that commit. A merged planning PR is not the extraction
implementation gate.

The owner supplied fresh qualification evidence from an owned OVH VPS on
2026-07-19:

- host kernel `6.14.0-37-generic`;
- Docker `28.2.2`;
- `runsc release-20260706.0`, registered with `--platform=systrap`;
- the full Docker+runsc qualification harness passed 11/11
  isolation-configuration probes;
- all 7 positive controls were true;
- the harness ran unprivileged as a non-root Docker client;
- it emitted a `RuntimeIsolationEvidenceV2` envelope with clean redaction;
- `/dev/kvm` was present but unused.

That evidence resolves the hardware-viability question for today's commodity
VPS baseline. It does not waive the provider implementation, exact-artifact,
per-box admission, or cutover gates in this plan.

The controlling architecture is the own-cloud data-plane section of
[`../391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md):

```text
placement = remote-worker executor on owner-operated VPSes
isolation = Docker + runsc (gVisor, systrap)
control-plane provider seam = SandboxProviderV1
```

Vercel sandbox is a bridge and remains a supported provider. Firecracker is
rejected for this work package because its current operational weight is not
earned by a demonstrated need.

## Problem

The SaaS control plane currently defaults to Vercel-hosted sandbox execution.
`@hachej/boring-sandbox` has a structural runsc preflight and an adversarial
Docker+runsc qualification harness, while the repository also has an older
remote bwrap worker tracer. Those pieces do not form a production own-cloud
provider:

- the versioned executable provider seam is still only planned;
- the current remote worker is Agent-owned and injected as a custom runtime
  adapter rather than acquired through `SandboxProviderV1`;
- the current worker launches bwrap against a workspace-local host directory,
  not a session-lifetime Docker+runsc sandbox;
- the current worker protocol has no create/dispose lease, no worker
  qualification handshake, and no fleet placement contract;
- the qualification harness is an operator command, not a CI/fleet admission
  gate;
- the production full-app image still defaults to `vercel-sandbox`.

The delta must turn the proven pieces into one small data-plane path without
creating a second control plane:

```text
authorized control-plane request
-> statically configured remote-worker SandboxProviderV1
-> statically selected qualified VPS shard
-> one session-lifetime Docker+runsc container
-> Workspace + Sandbox effects through the existing pair
```

## Outcome

SBX1 is complete when the owner-operated fleet is the SaaS default and all of
the following are true:

1. The control plane acquires one `WorkspaceSandboxPairV1` from a
   `remote-worker` provider; Agent still owns the only model/session/tool loop.
2. A small internal worker daemon receives only pair lifecycle, workspace, and
   exec requests. It has service-to-service TLS/token authentication but no
   end-user auth/membership authorization, billing, agent registry, task
   scheduler, or model loop.
3. Each provider-pair/session lease owns one warm Docker container launched with
   `--runtime=runsc`; invocations reuse it until pair disposal or bounded lease
   expiry.
4. Workspace state is workspace-scoped and durable on the owning worker shard;
   container/process state is session-scoped and disposable.
5. Tenant workloads have default-deny egress, finite time/output/CPU/memory/PID
   ceilings, a read-only root, no Linux capabilities, and no Docker socket.
6. Decision 27 BYOK keys are stored encrypted per workspace and resolved by the
   host Pi adapter for each model request; they never enter Sandbox exec or pool
   across workspaces. Separately authorized non-model invocation secrets use the
   bounded worker stdin envelope. The provider never copies those values into
   the workload image, container config, command arguments, or logs and destroys
   the secret-bearing invocation's container; deliberate tenant output or
   workspace writes are outside that provider guarantee.
7. Every fleet box passes the exact Docker+runsc qualification and provider
   smoke before its static shard assignment can enter production config.
8. `vercel-sandbox` keeps its provider implementation, conformance coverage,
   explicit configuration path, and rollback role; only the SaaS default flips.

## Hard dispatch gates

No `SBX1.x` implementation Bead may become `ready-for-agent` until every gate
below is recorded with merged proof.

### Gate A — Decision 26 product triggers

Decision 26 Step 1A must have shipped accepted proof. In addition, the canonical
`#808` extraction plan requires Decision 26 Step 2 accepted proof before its
Phase 1 can start. The current owner decision does not authorize SBX1 to race
either the domain-routed product path or same-workspace multi-agent proof.

### Gate B — `#808` extraction Phase 1 through Phase 3

This is a **hard dependency**, not a preferred ordering:

1. **Phase 1 COPY is complete:** `SandboxProviderV1` and its paired lifecycle
   have landed; direct, bwrap, and Vercel implementations exist behind it while
   Agent's live path remains frozen.
2. **Phase 2 VERIFY is complete:** the static composer and dual-target parity
   suite have passed against the old Agent path and new package path.
3. **Phase 3 SWAP is complete:** current importers use the new seam, old Agent
   provider copies are gone, and the exact packed-artifact proof has passed.

The minimum code fact is not merely that the interface type landed. Agent,
Core, Workspace, CLI, and full-app must already consume the swapped provider
path, so SBX1 builds on one authority rather than extending temporary duplicate
owners.

### Gate C — dispatch re-inventory

After Gate B, `SBX1.1` must rebase on current `origin/main` and attach a concise
inventory showing:

- the final `SandboxProviderV1` and pair result spelling;
- the final static composer and runtime mode ownership;
- the surviving remote-worker tracer paths after extraction;
- the final error-code and provisioning seams;
- the current full-app/Seneca SaaS runtime configuration;
- the exact package versions and artifact cohort.

If the extraction changed any assumed seam, update this plan before product
code. Do not recreate the pre-extraction Agent-owned interface to preserve this
document's provisional path names.

### Gate D — owner activation

The owner accepts this plan and creates the proposed `SBX1.x` Beads under
`wt-391-forward-6gd`. The existing deferred parent Bead and this planning PR do
not dispatch implementation by themselves.

## Today / Delta inventory

| Area | Today on verified `origin/main` | SBX1 delta after the extraction gate |
| --- | --- | --- |
| Provider contract | `PROVIDER_CONTRACT_VERSION` exists as a capability fact, but no executable `SandboxProviderV1` or paired result exists in code. | Extend the landed V1 seam additively with the remote-worker provider; do not introduce another runtime interface. |
| Sandbox package | `@hachej/boring-sandbox` is version `0.1.89`, published, and exports `.`, `./shared`, `./providers`, and `./providers/runsc`. | Extend the existing package and release cohort; do not create a new sandbox package or repository. |
| Capability matrix | `remote-worker` already has a conservative row whose worker-dependent fields are `unknown`; mode maps to provider `remote-worker`. | Bind the production remote-worker factory to one fixed Docker+runsc profile. Keep the static matrix authoritative; an authenticated handshake verifies a box rather than mutating the matrix. |
| runsc preflight | `preflightRunsc()` checks structural files/commands and always reports `productionReady: false`; its `unproven` map explicitly does not attest security. | Retain that honest structural result. Production admission depends on adversarial isolation-configuration evidence plus provider smoke, never on flipping the structural preflight to `true` or claiming escape resistance. |
| Qualification harness | `qualify-docker-runsc-isolation.mjs` launches two non-root runsc containers, uses distinct internal Docker bridges, enforces cgroup v2 CPU/memory/PID ceilings, runs 11 isolation-configuration probes and 7 controls, verifies teardown, and emits content-addressed V2 evidence. These probes validate the configured containment mechanisms; they do not prove escape resistance. | Make the exact harness/evidence validator a required self-hosted CI job and a candidate-box admission command. Reject `unproven` outcomes for fleet admission even though the general V2 schema can represent them honestly. |
| Evidence profile | V2 fixes Docker+runsc, non-root workload `65532:65532`, systrap, no capabilities, internal bridge isolation, 0.5 CPU, 128 MiB memory, and 64 PIDs. The current qualification harness mounts each test workspace **read-only**. | Preserve V2 as valid hardware/baseline evidence. Add an explicit production V3 schema for a read-write/quota-limited `/workspace` and `--network none`, with sibling/host denial plus write/persistence/quota controls. Fresh V3 evidence is required before production admission. |
| Remote provider client | Agent owns `RemoteWorkerClient`, a `remote-worker` `RuntimeModeAdapter`, Workspace/Sandbox proxies, buffered base64 exec, HTTP timeouts, SSE file events, and stable timeout/stream errors. | Reuse the proven protocol behavior but relocate/adapt provider-owned values behind V1 after extraction. Agent retains no provider runtime value. |
| Worker daemon | `@hachej/boring-agent/server/worker` exposes a small Fastify server. It authenticates a shared token, validates UUID workspace IDs, lazily creates bwrap runtimes, exposes fs/exec/events, filters host secrets, and applies shell `ulimit`s. | Keep the small daemon shape, replace the bwrap runtime with a Docker+runsc session lease, add explicit create/renew/dispose and an evidence handshake, and move provider ownership out of Agent. |
| Worker placement | Core injects a custom remote adapter only when `BORING_WORKER_BASE_URL` is set; there is no fleet contract. | Use one server-only static fleet config and deterministic workspace-shard placement. Add no queue, scheduler service, worker self-registration, or mutable registry. |
| Worker persistence | The bwrap tracer maps one UUID workspace to `${BORING_WORKER_WORKSPACE_ROOT}/${workspaceId}` on one worker volume. | Preserve worker-local durable workspace ownership, with a static shard-to-worker mapping and an explicit drain/copy procedure when a shard moves. |
| Worker isolation | Current worker code uses bwrap; the demo config may enable shared network egress. Its hardening TODO still calls for stronger syscall/cgroup/egress controls. | Docker+runsc replaces bwrap for the production own-cloud path. Each session uses `--network none` and the exact qualification-tested hardening flags. |
| Worker CI | Main CI builds the bwrap worker image and runs `remote-worker-smoke`; it does not install/register runsc or execute the qualification harness. | Keep fast unit/mock coverage, add a dedicated qualified self-hosted runsc job, and use the same command for per-box admission. |
| SaaS default | The full-app Dockerfile sets `BORING_AGENT_MODE=vercel-sandbox`. `resolveMode()` has only direct/local/Vercel built-ins; remote-worker is custom-injected. | After canary and data readiness, make `remote-worker` a statically composed built-in and change the SaaS deployment config default. Preserve explicit `vercel-sandbox`. |
| Runtime binding lifetime | `registerAgentRoutes` keys cached runtime bindings by runtime/workspace scope and currently passes `sessionId: workspaceId` to mode creation. A Pi transcript/chat session is not the provider lifetime. | Preserve the post-extraction binding owner. Define a “sandbox session” as the V1 provider-pair/runtime-binding lease, reuse its warm container across Pi turns/sessions in that scope, and add explicit expiry retirement/reacquisition rather than changing the cache key silently. |
| Runtime env/secrets | `ExecOptions` has one ordinary `env` record. `withRuntimeEnvContributions()` merges contribution values into that record after provider creation; the current worker only filters names heuristically. Decision 27/#820 keeps model BYOK at the host Pi provider-request seam and out of Sandbox exec. | Add trusted purpose/sensitivity/reference metadata at the contribution/exec composition seam, migrate the wrapper, reject model-credential references in the remote provider, and serialize only explicitly authorized non-model values into the stdin secret channel. Never infer secrecy from a suffix or let command/model input choose refs. |
| Host data | Sessions/transcripts remain on the host app volume per `BORING_AGENT_SESSION_ROOT`; they are not worker workspace runtime state. | Keep them on the control plane. SBX1 moves only Workspace/Sandbox effects and never copies Pi session history into worker containers. |
| Qualification result | Owner's OVH box passed all 11 isolation-configuration probes on 2026-07-19; commodity VPS hardware can run the configured profile today. This is not proof of escape resistance. | Re-run the gate against every candidate box and whenever a material profile input drifts. One qualified sample never admits an untested box. |

## Decisions

1. **Expose placement, keep isolation worker-local.** The control-plane provider
   ID is `remote-worker`; Docker+runsc is its worker-side isolation engine. This
   preserves the real placement fact and avoids a misleading local `runsc` mode.
2. **Use the extracted pair as the only acquisition seam.** Remote Workspace and
   Sandbox proxies are created/disposed together. No bare exec client or
   workspace-only worker acquisition survives as a host composition path.
3. **Use immutable startup placement.** A fixed hash bucket table in server-only
   config selects one owning worker. This is sufficient for the current fleet
   and avoids an unevidenced scheduler/registry service.
4. **Fail closed on an unavailable owner.** Worker-local workspace volumes make
   health-based rerouting unsafe. Recovery restores/moves the authoritative
   volume before config changes.
5. **Separate workspace and process lifetimes.** Workspace data is durable and
   workspace-scoped; one warm runsc container is disposable and scoped to the
   provider-pair/session lease.
6. **Launch only a production-qualified fixed profile.** Today's V2 evidence
   qualifies the commodity VPS/runsc baseline, but its read-only workspace is
   not the production read-write mount. SBX1 adds an explicit V3 production
   profile and requires fresh evidence before admission. Later drift triggers
   requalification, never an automatic downgrade.
7. **Keep model and sandbox secret seams distinct.** Decision 27 model BYOK is
   resolved host-side per provider request and never enters Sandbox exec. The
   provider resolves only purpose-typed non-model invocation secrets through a
   trusted server-only callback, and the worker passes those over a transient
   stdin envelope to the in-container wrapper.
8. **Keep egress denied in v1.** The product proves the fixed image first. An
   allowlist/proxy is a separately triggered security and qualification change.
9. **Keep Vercel supported and rollback explicit.** The SaaS default changes by
   deployment config only after canary/data proof; there is no silent per-call
   fallback and no writable dual-provider period.

## H1 — Honest isolation threat model and accepted residual risk

Docker+gVisor with `runsc --platform=systrap` is the v1 primary isolation
mechanism. It materially reduces the host-kernel surface exposed to a tenant and
raises attacker cost, but it is **not a proven boundary against a determined
attacker**. SBX1 must not describe admission evidence, a green harness, or gVisor
itself as proof that cross-tenant or host escape is impossible.

The harness's 11 results are **isolation-configuration probes**, not proof of
escape resistance. They check sibling filesystem traversal, sibling secret-mount
visibility, configured cross-workspace networking, proc PID visibility,
cross-sandbox signal and ptrace behavior, mount and device access, one
host-canary process-escape attempt, cgroup ceilings, and teardown. Positive
controls show that the probes ran. Neither the current V2 suite nor the planned
V3 evolution searches for or rules out these escape/disclosure classes:

- gVisor Sentry syscall-emulation bugs;
- bugs in the approximately 70 syscalls gVisor forwards to the host;
- seccomp-trap bypass;
- host-kernel local privilege escalation through a forwarded syscall;
- Spectre or other side-channel cross-tenant reads; and
- Sentry memory disclosure.

The recommended v1 posture accepts that residual risk for the initial standard
SaaS tier while refusing any high-assurance or hostile-code-proof claim. Use
gVisor as the primary mechanism and add defence in depth: scope tenants and
credentials to one box, share no secrets across tenants or boxes, run monitored
escape-canaries outside tenant mounts, patch runsc/host CVEs quickly, and retain
the later option of a second boundary (a per-tenant microVM or dedicated box)
for a high-trust tier. Failed/stale qualification or a known-unpatched critical
escape is not accepted residual risk: remove the box from new placement and
fail closed.

The baseline canary is a root-owned, non-secret host file/process/socket set
outside every workspace and session mount, watched by host audit/integrity rules
that alert on access, mutation, or signal attempts associated with a workload
container. A protected operator test must exercise the alert path on each box;
the canary is detection, not proof of prevention. For a critical runsc/Sentry or
forwarded-host-syscall escape advisory affecting the admitted profile, fence the
box from new sessions within 15 minutes of operator classification, stop active
tenant containers within 60 minutes unless the advisory requires faster action,
and return the box only after patch, complete requalification, and provider
smoke. Availability fails closed while no safe owner is ready.

> **OWNER RATIFY:** Accept the recommended standard-tier v1 residual-risk
> posture: gVisor raises attacker cost but is not a proven determined-attacker
> boundary; ship only with the listed defence-in-depth controls and track a
> second boundary for a later high-trust tier. This keeps the current operational
> design proportionate without overstating what the qualification harness proves.

## Flag / abstraction

- **Feature flag needed?** No application feature flag. The runtime provider and
  static fleet file are deployment configuration, already the intended mode
  selection seam.
- **Dark path:** land provider/daemon/artifacts while the production deployment
  continues to set `BORING_AGENT_MODE=vercel-sandbox`.
- **Activation:** owner-approved deployment changes the explicit default to
  `remote-worker` after the candidate, canary, and data gates pass.
- **Rollback:** restore the prior exact cohort/config and reverse-copy any newer
  workspace writes before returning a workspace to Vercel.
- **Abstraction budget:** one additive provider, one versioned internal protocol,
  and one worker-local Docker runner. No generalized scheduler, plugin system,
  registry, or policy framework.

## Architecture

### One control-plane provider, one worker-local isolation engine

```text
SaaS control plane
  auth + membership + workspace/session records + agent/model/tool loop
          |
          | SandboxProviderV1.create(authorized context)
          v
remote-worker provider (server-only, static config)
  workspaceId -> fixed shard -> qualified worker URL
          |
          | authenticated HTTPS, boring.remote-worker.v1
          v
worker daemon on owned VPS
  lifecycle + fs + exec + bounded lease table only
          |
          | docker CLI argv, never a shell string
          v
runtime-binding container: docker run --runtime=runsc
  /workspace = durable workspace shard directory
  /tmp = bounded tmpfs
  network = none (loopback only)
  rootfs = read-only, uid/gid 65532, no capabilities
```

The `remote-worker` value is the provider visible to the control plane. Docker
and runsc are its worker-local placement/isolation implementation. Do not add a
control-plane `BORING_AGENT_MODE=runsc`: that would erase the fact that effects
run remotely and invite a second composition path.

The final post-extraction type audit decides whether the worker-local runsc
factory literally implements `SandboxProviderV1` or implements a smaller
server-private pair factory used by the remote-worker daemon. Either spelling
must preserve one rule: the control plane obtains exactly one V1 pair and has no
side channel to a bare Docker/runsc exec client.

### Plane ownership

| Plane | Owns | Must not own |
| --- | --- | --- |
| Control plane | Authentication, membership, workspace/product selection, static fleet config, encrypted secret source, session/transcript storage, the existing agent/model/tool loop, and provider pair acquisition. | Tenant execution, Docker/runsc lifecycle, worker-local paths, dynamic worker registration, or a second sandbox lifecycle. |
| Remote-worker provider | Static shard resolution, worker authentication, protocol/version/evidence checks, remote Workspace/Sandbox proxies, pair lease and disposal. | Membership decisions, agent selection, billing, queueing, autoscaling, or silent provider fallback. |
| Worker daemon | Authenticated health, session lease map, bounded concurrency, path validation, Docker command execution, filesystem proxy, evidence facts, and cleanup. | User login, workspace membership, agent definitions, model keys, session transcripts, marketplace state, or scheduling across boxes. |
| runsc container | Tenant shell/file/tool effects against its mounted workspace and ephemeral `/tmp`. | Docker socket, worker token/TLS keys, control-plane secrets not explicitly injected for that invocation, sibling workspaces, or host paths. |

The worker trusts only an authenticated control-plane caller. It does not repeat
workspace membership checks, because Core must authorize before provider
creation. The provider and daemon both treat all IDs, paths, commands, and env
from the request as untrusted operational input.

### H2 — Box-breach trust boundary and blast radius

V1 admission is software self-attestation. A rooted worker can forge its local
health, host facts, evidence receipt, Docker observations, and workload results;
therefore the handshake detects configuration drift on an honest box but does
not establish hardware-rooted trust.

The recommended v1 blast-radius contract is deliberately per-box. A rooted box
may compromise every resident tenant's live process/container data, durable
workspace volume, and secret values injected into that box while compromised.
It must **not** thereby gain the control-plane database or
`WORKSPACE_SETTINGS_ENCRYPTION_KEY`, other boxes' credentials, other boxes'
workspace volumes, or secrets for workspaces not placed on it. Make that true
with all of these controls:

- no fleet-wide worker token, TLS client key, tenant credential, image-pull
  credential, backup credential, or monitoring credential;
- one independently rotatable authentication key per configured worker;
- a control-plane-issued short-lived capability token on each internal request,
  audience-bound to `workerId` and bound to authorized `workspaceId`, lease or
  `sandboxId`, allowed operation, request digest, and expiry;
- a token lifetime no longer than five minutes, with immediate issuer-side
  disable/rotation and no worker-held control-plane signing, database, or
  workspace-settings decryption key;
- backup and image-pull credentials restricted to that worker's own shard and
  immutable image cohort; and
- authorization derived only from the authenticated control-plane request and
  its server-side static placement. Box-reported worker, workspace, tenant,
  evidence, or sandbox identity is observation only and never grants access or
  changes placement.

Per-box token verification material on a rooted box lets the attacker forge
requests only to the already-compromised box; it must not authenticate to the
control plane or any sibling worker. Token/TLS rotation, box removal, and lease
invalidation are operator actions that do not wait for the box to report itself
unhealthy.

Hardware/measured-boot attestation is not required for v1. It is a named
follow-up in deferred bead `SBX1.7`, not an implied property of V3 evidence.

> **OWNER RATIFY:** Accept software self-attestation for v1 only with the
> recommended per-box containment posture: no fleet-wide shared secrets,
> short-lived per-box capability tokens, shard-scoped credentials, and no
> authorization based on box-reported identity; track measured-boot attestation
> in `SBX1.7`. This limits a rooted box to its resident tenants while avoiding a
> hardware-attestation dependency before the first own-cloud release.

## Static fleet placement

SBX1 does not introduce a scheduler. The host loads one immutable, server-only
configuration at startup:

```ts
type RemoteWorkerFleetConfigV1 = Readonly<{
  protocolVersion: "boring.remote-worker.v1"
  bucketCount: 256
  workers: readonly {
    workerId: string
    baseUrl: string
    tokenFile: string // unique per-box capability-token key; never fleet-wide
    caFile: string
    tlsServerName: string
    expectedEvidenceDigest: `sha256:${string}`
    expectedQualificationBundleDigest: `sha256:${string}`
    expectedProviderCohortDigest: `sha256:${string}`
    expectedImageDigest: `sha256:${string}`
    buckets: readonly number[]
  }[]
}>
```

The exact TypeScript path is finalized after Gate C; these semantics are fixed:

1. `sha256(workspaceId) mod 256` selects one bucket.
2. Startup validation requires every bucket exactly once, unique worker IDs,
   HTTPS URLs outside loopback tests, absolute token/CA-file paths, a unique
   per-box token key, a bounded certificate server name, valid digests, and no
   unknown fields. A CA certificate may be shared because it is public trust
   material; no private key or bearer/MAC secret may be shared across boxes.
3. A bucket always resolves to the configured worker. Health does not reroute an
   existing workspace to another volume.
4. An unavailable owner returns a stable retryable
   `REMOTE_WORKER_UNAVAILABLE`; it never falls back to direct, Vercel, or another
   worker silently.
5. Adding or removing a worker is an ordinary reviewed config deployment. Any
   reassigned bucket is drained, copied, verified, and only then switched.
6. Worker daemons never self-register. There is no heartbeat database, mutable
   registry, queue, or placement reconciliation loop.

Fixed buckets keep placement deterministic while allowing deliberate horizontal
growth. They trade automatic failover for filesystem consistency. That is the
correct v1 trade while the workspace source of truth is a worker-local durable
volume.

### Shard movement

Moving a bucket is an operator workflow, not runtime behavior:

```text
stop new pair acquisition for the bucket
-> drain/dispose active session leases
-> volume-level copy to the candidate worker
-> compare normalized POSIX metadata + content manifest and quota assignment
-> run read/write/provider smoke on the destination
-> deploy the new static bucket mapping
-> retain the source snapshot for the rollback window
```

If the product later requires frequent rebalancing, no-downtime failover, or
placement decisions from live capacity, stop and create a new decision. Those
requirements would earn a scheduler/data-portability design; they are not a
reason to hide one inside SBX1.

## `SandboxProviderV1` integration

SBX1 consumes the final interface produced by the extraction. The following
semantics are required even if exact names change during that work:

- the statically composed mode/provider ID is `remote-worker`;
- `create()` receives only the already-authorized runtime identity/context;
- one call selects a worker, creates one remote lease, and returns one ready
  Workspace + Sandbox pair or fails with neither half published;
- the pair's `workspace.runtimeContext.runtimeCwd` and
  `sandbox.runtimeContext.runtimeCwd` are both `/workspace`;
- the Workspace proxy and Sandbox proxy address the same opaque `sandboxId`;
- provider-specific TLS/token/fleet configuration stays in server-only factory
  options, never in the shared create context or browser bundle;
- `dispose()` is idempotent and makes bounded retries of the idempotent remote
  destroy request; not-found is success, while an unproven remote teardown is a
  stable incomplete-cleanup error and remains covered by worker lease expiry;
- construction failure after remote create attempts destroy before surfacing the
  first actionable error;
- provider shutdown drains in-flight client requests but does not create a
  second daemon lifecycle owner;
- mode selection remains static at host startup;
- Agent receives the acquired pair through the existing composer and owns no
  remote-worker runtime value.

The static `PROVIDER_CAPABILITIES` row remains the declared contract. The worker
handshake proves the selected box matches it and returns an observed evidence
digest/image digest. The application must not mutate the shared capability
matrix from health responses.

## Minimal worker protocol

### Protocol rules

Use plain HTTPS JSON plus the existing SSE pattern for file events. Do not add
gRPC, WebSockets, a message broker, or a queue framework.

All internal endpoints except unauthenticated liveness require:

- TLS; non-loopback cleartext URLs fail provider startup;
- `x-boring-internal-token`, a control-plane-issued per-box capability with a
  five-minute-or-shorter expiry whose signature/MAC and non-body claims are
  verified before reading a bounded body; after bounded read and canonical
  decoding, its request-digest claim is verified before schema adapters or
  effects;
- `x-boring-request-id`, generated by the control plane and safe to log;
- strict JSON schemas, bounded body sizes, and unknown-field rejection;
- the expected `boring.remote-worker.v1` protocol and
  `boring-sandbox.provider.v1` provider contract versions.

The service binds a private interface and the host firewall admits only control
plane source addresses. TLS and the short-lived token remain mandatory even on
that private network. Each worker has distinct token/TLS material in
root/operator-owned files; it is never mounted into a session container and
cannot authenticate to the control plane or another worker.

### Endpoint surface

| Endpoint | Purpose | Required behavior |
| --- | --- | --- |
| `GET /health` | Process liveness only. | Returns no worker, Docker, path, evidence, or fleet detail. |
| `GET /internal/v1/health` | Authenticated readiness/handshake. | Returns protocol/provider versions, worker ID, exact evidence/bundle/provider-cohort/workload-image digests, qualification run ID/time, isolation literal `docker-runsc-systrap`, and bounded capabilities. Fails readiness if the box-specific receipt is absent, stale, or mismatched to current host facts. |
| `POST /internal/v1/sandboxes` | Create/recover one pair lease. | Accepts workspace ID, session ID, client lease ID, requested timeout/output bounds, and expected evidence/bundle/provider-cohort/image digests. Idempotent on the client lease ID plus request digest. Returns opaque sandbox ID, `/workspace`, lease expiry, and an authenticated binding receipt over canonical workspace ID, client lease ID, worker ID, sandbox ID, request digest, and expiry. The provider verifies every field before publishing the pair. |
| `POST /internal/v1/sandboxes/:sandboxId/fs` | Existing bounded Workspace operations. | Validates the sandbox lease owns the addressed workspace; retains path containment and byte limits. |
| `GET /internal/v1/sandboxes/:sandboxId/fs/events` | Workspace change SSE. | Preserves heartbeat/reconnect/resync-required behavior without exposing host paths. The stream closes at the earliest of capability expiry, lease expiry, configured stream cap, or workspace/pair invalidation; reconnect requires a fresh capability. |
| `POST /internal/v1/sandboxes/:sandboxId/exec` | One invocation in the warm session container. | Accepts invocation ID, command, cwd, non-secret env, trusted secret envelope, timeout, and output limit. Returns the existing buffered/base64 result shape with truncation facts. |
| `POST /internal/v1/sandboxes/:sandboxId/renew` | Extend an active bounded lease. | Idempotent, capped by hard lifetime, and never recreates a missing sandbox implicitly. |
| `DELETE /internal/v1/sandboxes/:sandboxId` | Dispose the pair lease. | Idempotently stops/removes the container, closes watchers, clears invocation cache/secrets, and preserves the durable workspace directory. |

The protocol does not expose list-all-workspaces, list-all-sandboxes, arbitrary
Docker operations, image pulls, host shell, bundle upload, registry mutation, or
provider installation.

### IDs and idempotency

- `workspaceId` and `sessionId` retain the canonical validated identities from
  the acquired provider context. They are never concatenated into a host path
  without adapter validation.
- `clientLeaseId` and `invocationId` are high-entropy opaque IDs generated by
  the control plane.
- Duplicate create with the same lease ID and request digest returns the same
  active sandbox. A changed digest returns a stable conflict error.
- Duplicate exec with the same invocation ID/digest returns the bounded cached
  result while the session lives only when no secret envelope was supplied. A
  completed secret-bearing invocation retains a terminal marker but no output;
  its duplicate returns `REMOTE_WORKER_SECRET_INVOCATION_NOT_REPLAYABLE`. A
  duplicate while running returns `REMOTE_WORKER_EXEC_IN_PROGRESS`; a changed
  digest is rejected.
- The provider performs no automatic retry of effectful exec after an ambiguous
  transport failure. The invocation ID lets an explicit caller retry safely.
- The idempotency table is bounded and session-local. It is neither a durable
  task journal nor a queue.

### H5 — Authorized sandbox binding invariant

`sandboxId <-> authorized workspaceId` is a named security invariant, not a
client convention. At create time the worker stores one immutable lease record
binding the opaque `sandboxId`, canonical `workspaceId`, `clientLeaseId`,
`workerId`, and capability audience. Every fs, events, exec, renew, and delete
request must load that record by `sandboxId` and compare all binding claims to
the independently authorized short-lived capability before touching Workspace,
Docker, the invocation cache, or the lease timer. A `sandboxId` alone never
authorizes an operation, and no request body or box-reported identity may
replace the stored binding.

The remote-worker provider refuses `create()` when the landed shared context has
no already-authorized `workspaceId`, even if that field remains optional for
other V1 implementations. It verifies the create response's authenticated
binding receipt against its requested workspace/lease, statically selected
worker, returned sandbox, request digest, and expiry before constructing either
proxy.

Violation returns one stable non-revealing
`REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH`, emits a security counter without
tenant payloads, and performs zero tenant or Docker effects. The provider proxy
closes over the authorized `workspaceId` plus returned `sandboxId`; it may not
accept a caller-supplied replacement workspace ID on later operations.

This invariant has a dedicated public protocol test seam in `SBX1.1`: create
workspace A and B leases, deliberately combine A's authorized capability with
B's `sandboxId` (and the reverse), and prove every endpoint rejects before its
fs/Docker/lease adapter. The suite also swaps fake-daemon create responses and
proves provider construction fails rather than publishing a mismatched pair.
It advances a fake clock through capability/lease expiry, invalidates an active
events stream, proves the stream closes, and requires a fresh capability to
reconnect. These cross-product and stream-lifetime negatives are an acceptance
gate for bead 6gd.1 because a single missed check is a cross-tenant breach.

### Stable failures

Add stable canonical error codes, mapped consistently over HTTP, for at least:

- protocol/provider version mismatch;
- worker unauthenticated/unavailable/unqualified;
- qualification or workload image drift;
- invalid workspace/session/sandbox/path/request;
- sandbox not found/expired/disposed;
- create/exec concurrency exhausted;
- invocation in progress/idempotency conflict/secret invocation not replayable;
- invocation timeout/aborted/output limit;
- outcome unknown after worker/daemon loss (terminal for the current Agent task,
  never automatically retryable on a new lease);
- Docker command failure and incomplete cleanup.

Messages must not reflect token values, secret values, host roots, Docker socket
paths, host PIDs, or raw command stderr from infrastructure failures.

## Worker-local Docker+runsc provider

### Provider-pair lease lifetime (“sandbox session”)

In this plan, **sandbox session** means the V1 provider-pair/runtime-binding
lease. It does not mean a Pi transcript/chat session. Current main caches the
runtime binding by runtime/workspace scope and passes `sessionId: workspaceId`;
SBX1 preserves the landed post-extraction binding owner unless a separate plan
changes it.

One successful remote `create()` starts one container with no network. That
container is reused for every Workspace/Sandbox invocation in the active
runtime binding, including several Pi turns/transcript sessions. This amortizes
image/container cold start without making container/process state durable.

The durable workspace directory is keyed by authorized `workspaceId`; the
container is keyed by opaque `sandboxId`. If concurrent app instances acquire
more than one lease for the same workspace, the containers intentionally share
the workspace trust domain but retain separate process/PID namespaces.

Normal disposal removes the container immediately. As crash cleanup:

- each request renews a finite idle lease;
- a per-session timer, not a reconciliation loop, destroys the sandbox after a
  30-minute idle TTL;
- a lease has a 24-hour hard lifetime and must be replaced after it expires;
- daemon startup performs one bounded sweep of its own labeled containers,
  removing leftovers before readiness;
- daemon shutdown rejects new creates, gives active Docker commands a bounded
  drain, then removes known session resources.

Before the hard lifetime, the provider schedules single-flight retirement
through the landed runtime-binding owner: stop admission, drain/abort active
operations, dispose the whole pair, then acquire a fresh pair through normal
`SandboxProviderV1.create()`. An expired/not-found response triggers that same
retirement path and a stable retryable error; `renew` and an individual exec/fs
call never recreate a missing sandbox through a side door. Effectful exec retry
still uses its invocation ID.

The exact TTLs may be lowered by operator config. Raising them is a reviewed
resource-policy change. No timer deletes the durable workspace directory.

### Qualified launch profile

The implementation uses a typed Docker command builder and an injected command
runner. It executes `/usr/bin/docker` with an argv array and `shell: false`.
Tenant values never become Docker flag names, volume sources, labels, container
names, or shell fragments.

The initial production launch starts from the owner-qualified V2 baseline but
changes three security-relevant facts: `/workspace` is read-write and
quota-limited, and networking is `none` rather than an isolated bridge.
Therefore no box may be admitted for this launch until the evolved qualification
harness has emitted and verified the explicit production V3 profile described
below:

```text
docker run -d
  --runtime=runsc
  --user 65532:65532
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --cpus 0.5
  --memory 128m
  --pids-limit 64
  --network none
  --tmpfs /tmp:rw,nosuid,nodev,size=16m
  --mount type=bind,src=<validated-workspace-root>,dst=/workspace,rw
  --label <bounded boring-owned lifecycle labels>
  <workload-image-by-sha256-digest>
  <boring trusted PID1/supervisor>
```

Also set bounded open-file/file-size limits where Docker supports them and
retain the command's independent timeout/output ceilings. The workload image
contains the minimal tool runtime plus the in-container invocation wrapper. It
is pulled during provisioning/release, pinned by digest, and never built or
pulled in response to a tenant request.

The Docker socket and host devices are not mounted. `/dev/kvm` is irrelevant and
unused. The trusted daemon's Docker-group membership is an operator-level host
privilege; tenant code never receives that membership or socket.

### Workspace ownership and path safety

The worker daemon runs as a dedicated non-login OS user. Provisioning creates a
dedicated host group with GID `65532`; the daemon user is a member. Each
workspace directory is created below one absolute configured root with setgid
group ownership and mode `2770`, so both the daemon and the container workload
GID `65532` can access it without making it world-writable.

The adapter must:

- accept only canonical workspace IDs;
- resolve and realpath-check the workspace directory below the configured root
  before Docker sees the one fixed bind source;
- execute Workspace read/write/stat/list/move/delete operations through a
  trusted helper inside the runsc container, not through the current host-side
  check-then-open Node adapter;
- have that helper hold a dirfd for `/workspace` and use dirfd-relative
  `openat2`/equivalent kernel-enforced `RESOLVE_BENEATH` +
  `RESOLVE_NO_MAGICLINKS` containment for every path component/rename endpoint;
  if the qualified runsc/kernel profile cannot provide that primitive,
  admission fails rather than falling back to realpath-then-open;
- never serialize the host root/path in protocol responses or errors;
- keep session/transcript paths entirely outside this root;
- prove sibling workspace traversal fails through both Workspace operations and
  commands inside the runsc container;
- run concurrent symlink-swap/rename race tests against every mutating and
  reading fs operation and prove no host/container-root path is opened.

If host UID/GID mapping or Docker user-namespace settings make this ownership
model invalid on a candidate box, admission fails. Do not fall back to
world-writable directories or a root tenant workload.

### Default-deny egress

Launch the v1 workload with `--network none`. Only loopback exists inside the
container; there is no Docker bridge, gateway, embedded DNS path, IPv4/IPv6
external interface, or default route. The daemon binds only its private host
interface, never a Docker bridge/listen-all address, and host firewall rules deny
sandbox-origin traffic defensively even though the container has no interface.

The production V3 isolation-configuration/provider proof must attempt and fail
all of:

- sibling-container/workspace addresses;
- Docker bridge/host-gateway and worker private-interface addresses;
- the worker daemon/control-plane port;
- cloud metadata/link-local IPv4 and IPv6 addresses;
- external IPv4/IPv6 destinations and DNS resolution/query paths;
- Docker API/socket access.

Positive controls use loopback inside each sandbox and host-side checks so a
broken probe cannot pass merely because the test service never started.

V1 has no tenant egress allowlist. A command needing npm, PyPI, GitHub, or any
other external endpoint fails closed. The workload image must contain everything
needed for the initial product proof. Adding egress requires a named consumer,
an explicit destination/protocol policy, secret-exfiltration analysis, updated
isolation-configuration probes, and fresh fleet evidence.

### H3 — Decision 27 tenant-key lifecycle and per-invocation secrets

[Decision 27](../../DECISIONS.md) and the canonical
[`#820` plan](../820/plan.md) already fix the v1 model-key boundary; SBX1 does
not reopen it. A BYOK model-provider key is stored per workspace through the
existing encrypted `workspace_settings` path protected by
`WORKSPACE_SETTINGS_ENCRYPTION_KEY`. After authentication plus workspace
membership/type authorization, the host-side Pi credential adapter resolves it
again immediately before each model-provider request. It never enters
`RuntimeBundle.getRuntimeEnv`, the common V1 create context, `Sandbox.exec`, the
worker stdin envelope, a general shell/tool process, static fleet config, or a
container. The explicit Decision 27 instance-key fallback remains host-side;
tenant BYOK records/references are never pooled or installed as a fleet key.

The v1 model loop and model call remain on the control plane, so sending BYOK to
the remote worker would violate Decision 27 and the plane-ownership table. If a
later approved design moves the actual model call into a sandbox process, only
that dedicated model-call process may receive its authorized workspace key,
injected per model execution through a bounded stdin envelope; general
`Sandbox.exec` and tool processes must retain the no-model-key negative.

SBX1 still needs an invocation-secret seam for explicitly declared **non-model**
tool/handler secrets. The seam that replaces
`withRuntimeEnvContributions()` must represent ordinary environment values and
trusted, purpose-typed per-workspace secret references as different types. A
`model-provider-credential` reference is consumed only by the host Pi adapter
and is rejected by the remote-worker provider. A
`sandbox-invocation-secret` reference may be constructed only by authorized
host composition for the same workspace/purpose and resolved just in time for
one sandbox execution. Command text, ordinary env, model output, and tenant
input cannot choose either reference kind or arbitrary names. Secret values
never enter the common V1 create context or static fleet config.

For non-model invocation secrets, the exec request separates ordinary env from
a `secretEnv` envelope. The worker:

1. validates secret names against a strict env-name grammar and reserved-name
   denylist;
2. accepts the ordinary/secret channel classification only from the trusted
   sensitivity metadata added at the runtime-env contribution seam; it never
   infers secrecy from `_TOKEN`, `_SECRET`, or other name heuristics;
3. never logs the exec body, command, env values, secret values, stdin, or
   stdout/stderr;
4. pipes one bounded JSON envelope over stdin to the trusted in-container exec
   wrapper;
5. lets the wrapper populate the child process env in memory, start the command,
   and clear its references after exit;
6. does not pass secret values through `docker run`, `docker exec --env`, Docker
   labels, image layers, files, or command-line arguments;
7. zeroes/clears best-effort in-memory buffers after completion and never caches
   the secret envelope or a secret-bearing invocation's output for replay.

Decision 27 key lifecycle is explicit:

1. **Planned rotation:** write the replacement ciphertext as a new credential
   version through #820's owner-only path, validate it without exposing
   plaintext, and atomically make it active. Because the Pi adapter resolves on
   every provider request with no plaintext cache, the next model request uses
   only the new version. A request that already captured the old version may
   finish within its model-request bound; then the old upstream key is revoked.
2. **Emergency revocation:** first atomically mark the workspace credential
   disabled/revoked through the owner-only credential path extended by
   `SBX1.1`. The stored `workspace_settings` tombstone differs from absence and
   suppresses the instance fallback. Every model request performs the
   authoritative read, so future use fails closed across the control plane
   immediately without a worker broadcast. Best-effort abort any active model
   request that already captured the old value; do not claim that abort erased
   a value already sent upstream. This database tombstone is the instant
   fleet-wide platform kill switch: every SBX1 box is data-plane-only and holds
   no model key to purge.
3. **Upstream kill:** the tenant/operator immediately revokes that exact key at
   the model provider and records the provider revocation receipt/state before a
   copied key is called dead, then installs a new encrypted version. The remote
   fleet needs no model-key purge because Decision 27 forbids it from receiving
   the key. `SandboxProviderV1.invalidate()` remains pair cache eviction and is
   not misrepresented as credential revocation.
4. **Audit without secret material:** if rotation/revocation emits a durable
   event, record only workspace ID, provider/key role, credential version,
   transition, actor/request ID, and timestamps through the landed #807 event
   contract. SBX1 adds no event bus and never records the key or a reversible
   value.

Any future non-model secret store must provide the same per-workspace active
version and disabled-tombstone semantics before that secret kind is enabled.
Worker delivery remains per execution through the bounded stdin envelope, and
an emergency disable fences new resolution before lease/container cleanup.

The container runs a trusted PID1/subreaper supervisor. Before every invocation,
the daemon/supervisor must prove the tenant process set is at its clean baseline.
After success, error, abort, and timeout, the supervisor kills and reaps every
descendant—including double-fork/background processes—and no later invocation
starts until only the trusted baseline remains. Uncertain cleanup destroys and
recreates the container. A secret-bearing invocation always uses a clean
container and, after completion, destroys/recreates that container while
preserving `/workspace`; this clears `/tmp`, process memory, and namespace state
instead of trusting best-effort reuse.

For non-model invocation secrets, the provider/wrapper proves that **it** does
not persist or log secrets and that
residual tenant processes cannot observe a later secret invocation. It cannot
promise to redact or remove a secret that the intended tenant command
deliberately prints or writes to its writable workspace; those remain existing
higher-layer output/workspace-policy concerns and must not be misrepresented as
a runsc guarantee. Per-workspace authorization is the v1 secret boundary: the
plan explicitly accepts that a tenant can exfiltrate its own key from any
tenant-controlled process to which that value is intentionally delivered,
including its own BYOK if a future sandbox process performs the model call.
Current v1 tenant tool code receives no model BYOK, and no workspace may resolve
or observe another workspace's key.

### Invocation and resource ceilings

Use fail-closed bounds at all layers:

- 30-second default invocation timeout, preserving today's worker default;
- 15-minute absolute invocation maximum;
- 4 MiB combined stdout/stderr maximum, with existing truncation facts;
- one active exec per session and a finite configured daemon-wide concurrency;
- 0.5 CPU, 128 MiB memory, and 64 PIDs per session container for the production
  V3 profile;
- read-only root, 16 MiB `/tmp`, no capabilities, no-new-privileges, and
  bounded open files/file size;
- a kernel-enforced fixed quota of 1 GiB and 100,000 inodes on each durable
  workspace, plus host emergency headroom of at least the larger of 10% of the
  workspace volume or 10 GiB that tenant quota allocation cannot consume;
- finite create, fs, exec-grace, renew, dispose, and Docker command timeouts;
- request body, command, path, env count/value, secret count/value, and SSE
  connection limits.

On invocation timeout, the in-container wrapper terminates the command's process
group, waits a short grace, then kills it. Killing only the host-side
`docker exec` client is insufficient proof. If the wrapper cannot prove the
process group is gone, the daemon destroys the whole session container and
returns a stable cleanup error.

Provision the workspace volume with ext4/XFS project quotas (or an equivalently
kernel-enforced per-directory bytes+inode mechanism). A minimal root-owned quota
helper receives only a validated workspace ID and fixed profile, assigns/checks
the project quota outside the tenant mount, and exposes no arbitrary host path or
shell. Quota metadata is provider-owned volume metadata, not a runtime registry.
Both Workspace fs operations and commands inside runsc must receive one stable
quota-exceeded failure, while sibling workspaces and host reserve remain
writable. Backup, shard copy, restore, and rollback must preserve/reapply and
verify the quota assignment before admission.

The 128 MiB/64-PID baseline is the profile qualified today, not a statement that
every future workload fits. The canary must prove the real product journey under
these ceilings. If it does not, update the evidence schema/harness for the
smallest viable fixed profile and requalify all boxes before cutover.

## Qualification as CI and fleet admission

### Preserve the distinction between structural checks and qualification evidence

`preflightRunsc()` remains `productionReady: false`. It is useful for fast
diagnosis but cannot admit a host. Admission uses the adversarial Docker+runsc
qualification harness and a strict fleet validator. Neither is proof of escape
resistance.

Today's V2 envelope remains valid evidence that the owner VPS can run the
Docker+runsc isolation-configuration baseline. SBX1 adds
`RuntimeIsolationProfileV3` and
`RuntimeIsolationEvidenceV3` as additive siblings rather than relabeling or
invalidating V2. V3 is an intentionally new production profile: it keeps the
V2 isolation-configuration objectives, changes networking to `none`, makes the
one
workspace mount read-write, adds a fixed bytes/inode quota, and adds positive
controls proving own-workspace write and persistence across session-container
recreation. The isolation-configuration probes must still demonstrate the
configured sibling workspace, host path,
secret, process, device, network, resource, quota, and teardown isolation while
that own workspace is writable.

V3 binds the qualification result to the exact thing being admitted. Its
strict profile/evidence contains at least:

- host kernel release, the independently observed in-sandbox gVisor guest
  kernel/sentinel, Docker server version, runsc release and binary digest;
- canonical Docker daemon runtime-registration/config digest, including the
  absolute runsc path and exact `--platform=systrap` arguments;
- worker/provider package cohort digest and production Docker argv/profile
  digest;
- production workload image repository digest, resolved manifest digest, and
  architecture;
- qualification-bundle digest, qualification suite/probe/helper digests, schema
  version, qualification run ID, and qualification timestamp;
- `workspaceMountPolicy: "readwrite-workspace-only"`,
  `networkPolicy: "none"`, and the exact bytes/inode workspace quota policy;
- the named isolation-configuration results, positive controls, cleanup results,
  redaction
  facts, and the overall evidence digest.

`hostKernelRelease` is collected on the host. It must not be populated from
`uname` inside runsc, whose value describes the separately recorded gVisor guest
kernel surface and is retained as proof that Docker really executed runsc. The
validator rejects drift in either value.

The fleet validator accepts only production V3 evidence where:

- schema/domain are exactly the production V3 values;
- the evidence/profile/test-suite/qualification-bundle digests verify;
- launcher is Docker+runsc, privilege is non-root Docker client, platform is
  systrap, workload is `65532:65532`, capabilities are empty, and the network
  policy/resource profile match production;
- all 11 named isolation-configuration probes have `status: "passed"`;
  `unproven` is rejected for production admission;
- all seven V2 positive-control objectives, adapted to the no-network profile,
  plus the V3 own-workspace write, persistence, bytes-quota, and inode-quota
  controls are true;
- all three redaction flags are false;
- the host kernel, Docker server/runtime registration, registered runsc binary
  and platform, workload image digest, provider config, workspace quota,
  network/mount policies, and qualification bundle match the candidate's
  configured release.

The general evidence parser may continue representing `unproven` for honest
research output. The fleet gate is deliberately stricter.

### Promote the existing qualification harness, do not replace it

Keep `packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs` as the
one adversarial qualification command. Evolve it visibly from the V2 read-only
research profile to the V3 production read-write/no-network/quota profile,
preserving every isolation-configuration probe and adding the write,
persistence, and quota controls. The implementation
slice may also give its legacy AgentHost temporary/container/env identifiers
neutral SBX1 names. These source/profile changes must change the schema/domain,
`testSuiteDigest`, `providerConfigDigest`, and qualification-bundle digest and
require fresh evidence; old V2 evidence is never passed off as the production
result.

The current npm tarball publishes only `dist`, while the qualification harness also
needs scripts, probe source, and helper binaries. SBX1 therefore publishes one
ordinary immutable release artifact,
`boring-runsc-qualification-<reviewed-git-sha>.tgz`, beside the packed package
cohort. Its manifest contains checksums for the built provider entry, V3
schema/validator, exact qualification script, probe source/static probe binary,
read-only qualification helpers, and the expected production workload image
digest. This is a release tarball, not CAS or a publication journal.

The V3 harness must use the exact production workload image by digest; it must
not build or pull a mutable `alpine` test image. If the fixed production image
lacks diagnostics needed by the isolation-configuration probes, the bundle may
mount its checksummed
static helpers read-only for qualification only. The evidence records each
helper digest and that test-only mount delta, while every production launch and
the final provider smoke run without those mounts.

Add a machine-oriented output path/validator so operators do not parse logs:

```bash
pnpm --filter @hachej/boring-sandbox run build
pnpm --filter @hachej/boring-sandbox run qualify:runsc:isolation:docker \
  > runtime-isolation-evidence.json
node packages/boring-sandbox/scripts/verify-fleet-admission-evidence.mjs \
  runtime-isolation-evidence.json
```

Stdout is evidence only; diagnostics remain redacted on stderr. Failure or
incomplete cleanup is non-zero. The validator prints only the accepted evidence
digest and safe profile facts.

### CI layers

1. **Every PR:** unprivileged unit tests for strict evidence parsing, all-passed admission,
   profile drift, Docker argv construction, lifecycle failure cleanup, secret
   non-persistence, and protocol conformance run on normal CI.
2. **Relevant provider/harness/image revisions:** the privileged qualification job
   never runs arbitrary fork or unapproved PR code on a persistent runner. A
   maintainer selects an exact reviewed SHA through a protected environment or
   trusted post-merge/manual workflow. It runs on a disposable/quarantined
   owner-operated runsc runner with no production credentials, fleet tokens,
   workspace volumes, or production-network reachability; the runner is
   destroyed/reimaged after the job. The job executes the full qualification harness
   and one real create/exec/fs/dispose provider smoke from exact built artifacts.
3. **Main/release:** the same protected disposable self-hosted job gates the release cohort whenever
   runsc provider, worker daemon, workload image, evidence schema, harness,
   Docker builder, or fleet workflow inputs change.
4. **Candidate box:** before any bucket maps to the box, the exact pinned
   qualification bundle and release cohort run the same qualification command and
   provider smoke locally. Evidence is attached to the fleet-config
   review/operations handoff, not used as a runtime registration database.

A skipped self-hosted job proves nothing. It requires an explicit waiver naming
the residual risk and cannot admit or cut over a box.

### Drift and requalification

Remove a box from new-session placement, drain it, and requalify before return
when any of these changes:

- kernel/host security policy relevant to the profile;
- Docker version or daemon runtime registration;
- runsc version, binary digest, path, or `--platform` argument;
- worker daemon or workload image digest;
- Docker launch flags, resource limits, network topology, workload UID/GID, or
  workspace mount policy;
- qualification bundle, evidence schema/parser, qualification harness,
  probe/helper,
  or test-suite digest.

There is no continuous reconciler. Startup readiness compares the configured
expected receipt/digests to freshly collected local safe facts: host kernel,
Docker server/runtime registration, runsc binary/platform, worker/package
cohort, production image, qualification bundle, Docker profile, workspace quota,
and network/mount policy. It also rejects expired evidence under the operator's
documented maximum age. The receipt is keyed by worker ID plus qualification run
ID, not copied between boxes. Operator upgrades run the full gate before the
service rejoins static config.

## Fleet provisioning runbook sketch

The implementation adds a reviewed runbook under the package/operations docs.
At minimum it gives exact commands or automation for this sequence:

1. **Prepare the VPS.** Use the owner-qualified commodity Ubuntu/VPS class,
   confirm cgroup v2 CPU/memory/PID controllers, patch the host, create the
   dedicated daemon user/group, create the workspace volume/root, and configure
   durable volume backup/snapshot retention.
2. **Install Docker.** Install the pinned supported Docker release, enable the
   service, and allow only the dedicated trusted daemon user to access Docker.
   Record that Docker-group membership is host-root-equivalent operational
   privilege.
3. **Install runsc.** Download the pinned release from the operator-approved
   source, verify its published checksum/signature per the release procedure,
   install it at an absolute path, and record its SHA-256 digest.
4. **Register systrap.** Add the `runsc` Docker runtime with an absolute binary
   path and runtime args containing exactly `--platform=systrap`; restart Docker
   and inspect `docker info` to prove the registered path/args.
5. **Install qualification prerequisites.** Install only the host tools needed
   to verify and execute the signed/checksummed qualification bundle. Do not use
   `/dev/kvm` or configure the KVM platform.
6. **Install exact artifacts.** Fetch and verify the pinned qualification
   bundle and packed sandbox/worker cohort, then pre-pull and verify the
   production workload image by digest. Do not build package code, the tenant
   image, or probe helpers on the candidate production box.
7. **Run qualification admission.** Run the bundle's full adversarial Docker
   harness against the exact production image, validate all 11
   isolation-configuration probes plus every positive/quota control,
   redaction, cleanup, and digests, and retain the redacted JSON as the
   deployment proof artifact.
8. **Run provider smoke.** Start one real session container, prove UID/GID,
   workspace read/write/persistence across container recreation, secret
   per-invocation delivery without worker/image/container leakage, default-deny
   egress, timeout/process cleanup, limits, sibling isolation, and teardown.
9. **Install the daemon.** Configure a systemd service with the private bind
   address, TLS files, token file, worker ID, workspace root, admitted evidence
   digest/run ID/time, qualification-bundle digest, workload image digest, and
   fixed resource/quota profile. Use restart limits and no shell-evaluated
   config.
10. **Lock the network.** Permit control-plane ingress only; deny public access
    to internal endpoints; verify unauthenticated/incorrect-token/TLS negatives.
11. **Install the escape-canary monitor.** Place the root-owned non-secret
    canary set outside all workspace/session mounts, install the host
    audit/integrity alert, trigger its protected operator test, and retain the
    alert receipt. Canary failure makes readiness false.
12. **Admit deliberately.** Check authenticated readiness from the control
    plane, attach evidence to the config review, then assign buckets in the
    static fleet config. Merely starting the service never joins the fleet.
13. **Prove recovery.** Restart the daemon/host, verify the one-shot orphan
    cleanup, durable workspace survival, readiness receipt, backup visibility,
    and one new-session smoke.

The runbook also covers draining, shard copy/manifest verification, token/TLS
rotation, evidence refresh, removing a worker, restoring a volume, and rolling
back the worker package/image. Its critical-CVE exercise must meet H1's
15-minute new-placement fence and 60-minute active-container stop bounds before
the first production box is admitted.

## H4 — Executor liveness, in-flight durability, and volume recovery

The control plane monitors each configured executor without turning health into
placement authority. It performs authenticated readiness probes on a bounded
interval, records last success/latency and consecutive failures as ordinary
metrics, and alerts on failed readiness, request-error rate, capacity,
qualification expiry, or missing monitored escape-canaries. Public `/health`
remains process liveness only. Health never reroutes a workspace or accepts a
box's self-reported identity for authorization.

If a box dies during an Agent turn, the control-plane Agent/model/session loop
and transcript survive, but the in-flight workspace/tool effect is classified
as outcome-unknown unless the still-live session-local worker record already
contains a terminal result. That record is explicitly not durable and cannot be
consulted after box/daemon loss. The provider returns the stable, non-auto-retry
`REMOTE_WORKER_OUTCOME_UNKNOWN`; the current Agent task ends failed and the
event stream tells the user/operator that retry may duplicate an external or
workspace effect. The same invocation ID must not be replayed on a recreated
lease. Any deliberate retry starts a new Agent request/task ID after the caller
accepts or resolves that ambiguity. A secret-bearing invocation remains
non-replayable. Loss of an idle box simply fails new pair acquisition with
`REMOTE_WORKER_UNAVAILABLE` until recovery.

Issue [#807](https://github.com/hachej/boring-ui/issues/807) is the durability
backbone for the control-plane Agent task and event stream, not a worker-exec
journal or cross-instance command bus. While the host remains live it appends
the outcome-unknown failure before fanout and transitions the Agent task to
failed. After control-plane restart, #807's recovery rules make submitted work
rejected and working work failed with `AGENT_TASK_INTERRUPTED`; they never
transparently resume or re-prompt. Pi JSONL keeps the conversation history
loadable. SBX1 does not create a second task journal in the worker, and merged
#807 T1 durability proof is a hard dependency of `SBX1.6` production cutover.

Workspace recovery is volume recovery, not container recovery. Session
containers are disposable. On executor loss, keep the shard unavailable,
restore the owning volume or its latest verified snapshot to the same/replacement
box, reapply and verify project quotas, run the metadata/content manifest and
provider smoke, then change static placement under the existing write fence.
Never start from an empty workspace, silently fail over to another box, or make
a stale copy writable. Data after the last verified snapshot may be lost; the
explicit RPO/RTO commitment and recovery drills are tracked in deferred bead
`SBX1.9` rather than guessed in v1.

## Cutover and rollback

### Rollout

1. Land the remote-worker provider/daemon/runsc path dark while the SaaS default
   stays `vercel-sandbox`.
2. Prove mock conformance and exact artifacts, then provision a qualified
   staging VPS and run the full qualification/provider gates.
3. Run the real SaaS journey on staging: workspace create/open, file/tree/search,
   shell/tool calls, secret-requiring invocation, timeout, session reuse,
   session disposal/recreation, restart, and negative egress/isolation cases.
4. Provision the first production shard and keep it absent from production
   config until its evidence and smoke are accepted.
5. Inventory existing production workspaces. If none exist, record the empty
   migration proof. Otherwise, admission/write-fence each source workspace
   before its source inventory and keep that fence continuously through archive,
   destination manifest/smoke, and the atomic provider-ownership/default flip.
   Use the bounded metadata-preserving utility described below.
6. Deploy the static fleet config and explicit provider config to a staging or
   canary deployment. There is no per-request hidden fallback.
7. Change the SaaS deployment default to
   `BORING_AGENT_MODE=remote-worker`; supply fleet/token/TLS config only through
   server-side deployment secrets/files.
8. Monitor stable provider errors, worker capacity, Docker/container cleanup,
   host resources, and workspace volume growth through ordinary service metrics
   and logs. Logs contain IDs/durations/status/counters, never payloads/secrets.
9. Keep Vercel provider code, tests, credentials, and prior workspace handles
   intact for the rollback window. Do not delete Vercel support in SBX1.

The landed public `Workspace` operations may not be sufficient to preserve
symlinks, hardlinks, modes, and other POSIX metadata. The one-off cutover utility
therefore has an explicit, narrow contract:

1. While the workspace is drained, inventory every entry and reject devices,
   FIFOs, sockets, setuid/setgid bits, absolute paths, escaping symlink targets,
   unsupported xattrs, or a source larger than configured byte/entry limits.
2. Produce a traversal-safe POSIX archive using a fixed trusted command in the
   source sandbox. Preserve regular files, directories, relative non-escaping
   symlinks, hardlink groups, executable/mode bits, and the explicitly supported
   xattr subset; normalize ownership to the workload UID/GID and timestamps to
   the documented precision.
3. Stream bounded chunks through an operator-only adapter for the two known
   providers into a fresh, quota-limited destination. Never materialize the
   whole archive in control-plane memory and never add an acquisition/runtime
   side door to `SandboxProviderV1`.
4. Unpack through a trusted destination command with no overwrite, traversal,
   device, privilege-bit, or outside-workspace behavior. For a worker
   destination, apply/verify the fixed project quota before admission; a Vercel
   rollback destination instead verifies its provider limits.
5. Compare independently generated source/destination manifests containing
   entry type, normalized relative path, mode, size, content hash, symlink
   target, hardlink-group identity, and supported-xattr hash. Only then mark the
   static owner ready and run the product smoke.

The implementation Bead must first prove which fixed archive/chunk transport
the landed Vercel and remote providers can support. If it cannot preserve the
contract above, or if unsupported entries exist, cutover stops unless the
inventory is proven empty. A count/bytes/content-only copy is not sufficient.
The same archive and manifest contract run in reverse for data rollback, with
destination-specific quota/limit verification as above.

The source write fence is part of the manifest's validity. If admission resumes,
the fence is uncertain, or the ownership flip is delayed beyond the reviewed
window, invalidate the destination proof and discard/re-copy it under a new
drain. If per-workspace fencing cannot coexist with the deployment's global
default flip, take one global write drain for inventory through flip; never
resume a copied Vercel source while its remote-worker copy waits. Reverse
rollback applies the identical rule with remote-worker as source and Vercel as
destination.

This utility is not a generic migration framework, CAS, publication journal, or
mutable runtime registry. It is an operator-only cutover program for two named
providers, has no request-time provider selection authority, and is removed
from the serving path after the rollback window.

### Rollback

Code/config rollback is an explicit flip back to
`BORING_AGENT_MODE=vercel-sandbox` and the prior exact package cohort. Data
rollback depends on writes:

- before any remote-worker write, the config flip is sufficient;
- after remote-worker writes, continuously admission/write-fence affected
  workspaces, reverse-copy/verify them to Vercel, and keep the fence until the
  atomic ownership/config flip; a broken/delayed fence invalidates the copy;
- if reverse copy cannot be proven, keep the own-cloud provider serving those
  workspaces and repair forward rather than expose stale Vercel state;
- never run both providers writable for one workspace at the same time.

Worker rollback restores the prior exact daemon/workload image, re-runs the
candidate gate if any profile input changed, and restores the prior static
bucket mapping only after its volume manifest is current.

## Test seams

- **Highest public seam:** statically create the remote-worker
  `SandboxProviderV1`, obtain one pair, perform Workspace and Sandbox operations,
  then dispose it and prove remote cleanup plus durable workspace survival.
- **Protocol seam:** one conformance suite runs against an in-memory fake daemon
  and the real Fastify daemon; it covers auth, strict schemas, IDs, timeouts,
  idempotency, error mapping, SSE resync, disposal, and the H5
  `sandboxId <-> authorized workspaceId` cross-product negatives on every
  sandbox endpoint.
- **Docker seam:** an injected command runner proves exact argv, path
  containment, no shell interpolation, cleanup ordering, limits, network flags,
  quota assignment, and provider-side secret non-persistence without requiring
  Docker in unit tests.
- **Host integration seam:** a qualified self-hosted runner executes actual
  Docker+runsc create/exec/fs/renew/dispose and the qualification harness.
- **Composition seam:** Core/Workspace/full-app prove authorization happens
  before provider create, Agent uses the returned pair, and
  `BORING_AGENT_MODE=remote-worker` is static/fail-closed.
- **Key-lifecycle seam:** Decision 27 conformance proves per-workspace encrypted
  storage, host-side per-model-request resolution, planned version rotation,
  authoritative emergency disable with no fallback, upstream revocation
  receipt/state, and cross-workspace/non-pooled negatives. The existing
  `Sandbox.exec` no-`ANTHROPIC_API_KEY` assertion remains mandatory. Separate
  purpose-typed non-model references prove stdin delivery and model-reference
  rejection.
- **Durability seam:** kill the daemon/host before acceptance, during exec, and
  after a terminal result; prove #807 records the Agent task as failed or
  interrupted without claiming a durable worker result, effectful work is not
  auto-replayed or reused on a new lease, the transcript survives, and a
  restored volume is not admitted until quota/manifest/provider-smoke proof
  passes.
- **Canary/CVE-response seam:** trigger the protected host canary monitor and
  verify the safe alert; run a critical-CVE game day that fences new placement,
  stops affected containers within the H1 bounds, patches, requalifies, and
  readmits only after provider smoke.
- **Artifact seam:** install the exact packed package cohort, qualification
  bundle, and workload image digest without workspace links or candidate-host
  builds.
- **Cutover seam:** staging/canary proves Vercel -> worker copy and, when existing
  data makes it applicable, worker -> Vercel rollback copy with the normalized
  POSIX metadata/content manifest.
- **Avoid:** private-helper snapshots when public pair/protocol/host proof covers
  behavior; mocked Docker tests as evidence of runsc isolation; a successful
  structural preflight as production qualification.

## Acceptance

SBX1 is accepted only when all statements below have current proof:

1. All hard dispatch gates were satisfied before the first product-code PR.
2. One statically composed `remote-worker` provider returns one matching,
   idempotently disposable Workspace + Sandbox pair through the landed V1 seam.
3. Agent has no remote-worker/runsc runtime value and retains the sole
   model/session/tool loop.
4. Static 256-bucket placement is total/deterministic; unavailable shards fail
   closed with no direct/Vercel/cross-worker fallback.
5. The worker daemon exposes only the bounded service-authenticated internal
   surface and contains no end-user auth/membership authorization, agent
   registry, model, queue, scheduler, or billing logic.
6. V1 self-attestation is never represented as hardware trust. Every box uses
   unique credentials and short-lived control-plane-issued capabilities; no
   worker has fleet-wide secrets, control-plane DB/decryption authority, or
   authorization derived from box-reported identity.
7. `sandboxId <-> authorized workspaceId` is enforced before every fs, events,
   exec, renew, delete, Docker, cache, or lease effect. The two-workspace
   cross-product suite, missing-authorized-workspace rejection, and authenticated
   binding-receipt/swapped-create-response negatives fail closed with zero
   tenant effects. Events streams close on capability/lease expiry or
   invalidation and require a fresh capability to reconnect.
8. One warm Docker+runsc container is reused for the provider-pair/session lease
   and is destroyed on disposal, timeout failure requiring reset, expiry,
   shutdown, and startup orphan cleanup. Hard expiry retires the whole pair and
   reacquires only through normal V1 creation; bounded delete retries tolerate a
   lost response and treat a confirmed `404` as disposed.
9. The production launch matches the admitted systrap/non-root/no-capability/
   read-only-root/read-write-workspace/no-network/resource/quota profile and
   uses the workload image by digest.
10. Workspace data survives session container disposal/recreation; sibling and
   host paths remain inaccessible; session/transcript data stays on the control
   plane.
11. Decision 27 BYOK keys remain encrypted and per-workspace/non-pooled. The host
   Pi adapter resolves them again before each model request; planned rotation
   affects the next request, emergency disable blocks reads and the instance
   fallback, and upstream revocation is required before a copied key is called
   dead. `Sandbox.exec` and its stdin envelope never receive model BYOK. The
   `withRuntimeEnvContributions()` replacement carries only purpose-typed
   non-model per-workspace references to the worker; the remote provider rejects
   model-reference and cross-workspace use. A tenant can exfiltrate its own
   intentionally delivered secret, never another workspace's.
12. Invocation time/output/process cleanup and CPU/memory/PID/open-file/file-size
    ceilings fail closed under real runsc execution. A hostile double-fork from
    invocation A is gone before secret-bearing invocation B starts.
13. Each session has default-deny external and cross-workspace egress; there is
    no v1 egress allowlist or shared-network escape.
14. Every production box has current, strict 11/11 production V3
    isolation-configuration results, all V3 write/persistence/quota controls,
    and a real provider smoke from the exact release before receiving a bucket.
    Its receipt binds the host kernel, Docker/runtime config, runsc, provider
    cohort, production image, qualification bundle,
    launch/network/mount/quota profile, box/run ID, and qualification time.
    Today's V2 result alone never admits the provider, and neither V2 nor V3 is
    described as proof of resistance to the H1 escape/disclosure classes.
15. The dedicated self-hosted CI gate runs on relevant provider/harness/image
    changes; a skip/waiver cannot be reported as runsc proof or fleet admission.
    Each admitted box has a monitored host escape-canary with a tested alert,
    and a critical-CVE game day proves the H1 fence/stop/patch/requalify bounds.
16. Executor liveness is monitored and alerted without health-based rerouting.
    Box death during a turn yields a non-auto-retry outcome-unknown task failure;
    a new lease never reuses that invocation ID. Merged #807 T1 records the
    control-plane Agent failure/interruption and preserves replayable events and
    transcript access without claiming a durable worker-exec journal. Volume
    restore remains fenced until quota/manifest/provider-smoke proof passes.
17. The provisioning/drain/requalification/restore runbook is executed once on
    a fresh VPS and once across a host restart.
18. Existing workspaces are either proven absent or copied under drain with the
    bounded metadata-preserving archive contract and matching independent
    manifests before the default flips; unsupported entries fail closed.
19. The SaaS default is `remote-worker`; explicit `vercel-sandbox` remains
    supported, tested, and usable for rollback.
20. Exact packed packages, qualification bundle, and image digests pass the
    product journey without workspace links, local source imports, or builds on
    the candidate box.
21. A fixed 1 GiB/100,000-inode workspace quota and reserved host headroom are
    enforced for both Workspace operations and sandbox commands; fill tests
    cannot starve sibling workspaces or the host, and backup/copy/restore
    reapplies and verifies quota metadata.
22. Deferred beads `SBX1.7`-`.9` exist with the H6 concerns and owners below;
    deferral is not represented as completion or as an SBX1 v1 security claim.
23. No forbidden dependency or out-of-scope system enters the implementation
    diff.

## H6 — Explicitly tracked v1 deferrals

The following are deliberately deferred from the `SBX1.1`-`.6` v1 critical
path, not forgotten or claimed solved:

| Deferred concern | Why it is not closed by v1 | Named follow-up |
| --- | --- | --- |
| Daemon-host metadata-endpoint SSRF, including `169.254.169.254` cloud-credential theft after daemon compromise. | Container `--network none` protects tenant code; it does not constrain a rooted or code-compromised daemon using the host network. | `SBX1.7` owns daemon egress/firewall/credential-source hardening together with measured-boot evaluation. |
| Per-box tenant density versus isolation economics. | Static placement and quotas bound resources but do not choose an economically/security-optimal tenants-per-box limit. | `SBX1.8` uses measured workload/density data to define standard, dedicated-box, and possible microVM tiers. |
| Fleet-wide runsc-CVE patching cost and failover. | V1 requires fast patching/removal but intentionally has no automatic cross-worker failover or spare-capacity SLO. | `SBX1.8` owns patch rings, drain capacity, emergency CVE response cost, and the trigger for a second boundary. |
| RPO and RTO. | V1 specifies safe restore mechanics but lacks enough production workload, snapshot, and volume-restore evidence to promise recovery objectives honestly. | `SBX1.9` sets measured RPO/RTO, retention, restore-drill cadence, and customer-facing failure semantics. |
| Black-box observability tied to #819. | V1 has process/readiness metrics and alerts; external journey/SLO telemetry belongs with #819's metering/observability facts. | `SBX1.9`, blocked by the relevant #819 observability seam, owns black-box probes and SLO dashboards without logging tenant payloads. |

> **OWNER RATIFY:** Accept these five concerns as explicit v1 deferrals and
> create `SBX1.7`-`.9` as deferred child beads during tracker activation. They
> do not block `SBX1.1`-`.6`, because v1 already fails closed and contains the
> immediate blast radius, but naming owners and proof paths now prevents
> metadata-host risk, density/CVE-failover economics, recovery objectives, and
> #819 observability from disappearing after cutover.

## Tracker activation transaction (plan only)

The current tracker graph is stale relative to the canonical `#808` extraction
plan. Parent `wt-391-forward-6gd` depends on umbrella
`wt-391-forward-mwy`. That umbrella still depends on `wt-391-forward-b7g`
(the unrelated old prerequisite-attestation Bead) and
`wt-391-forward-la3` (the old T2 transport chain), in addition to the recut-plan
Bead `wt-391-forward-6au`. Neither PR #823 nor completion of a planning Bead is
proof that the extraction Phase 3 swap landed.

After the actual `#808` Phase 3 implementation Bead closes with merged swap and
exact-artifact proof, the owner performs one reviewed tracker transaction:

1. retire/close or explicitly supersede `wt-391-forward-mwy` as the obsolete
   extraction umbrella;
2. remove/replace the `wt-391-forward-6gd -> wt-391-forward-mwy` blocking edge;
3. add a direct blocking dependency from `wt-391-forward-6gd` to the concrete
   Bead that closed `#808` Phase 3, with the merged PR/SHA recorded as
   provenance;
4. create the nine child Beads below with parent `wt-391-forward-6gd` and the
   exact blocking edges shown; keep `SBX1.7`-`.9` deferred so they are tracked
   without gating the v1 `SBX1.1`-`.6` chain; and
5. keep the parent deferred until Gates A-D and the transaction all have proof.

No stale umbrella may dispatch SBX1 merely by changing status. After the owner
transaction, run `br dep cycles` and `bv --robot-insights` and attach their
outputs to the activation record. This planning PR proposes those edits but,
per scope, makes zero `.beads` changes.

## Proposed `SBX1.x` Bead chain (plan only)

These are proposed child aliases under `wt-391-forward-6gd`. If `br` allocates
different concrete IDs, preserve titles, contents, parentage, and dependency
edges. Do not edit `.beads` in this planning PR.

| Proposed ID | Title | Delivers | Blocked by | Proof/exit |
| --- | --- | --- | --- | --- |
| `wt-391-forward-6gd.1` | `SBX1.1: bind static remote-worker protocol + placement to landed SandboxProviderV1` | Gate-C re-inventory; shared strict protocol schemas; static fleet config/bucket resolver; per-box short-lived capability auth including bounded SSE lifetime; V1 client/provider pair; stable errors; the named H5 `sandboxId <-> authorized workspaceId` invariant with authenticated create binding receipt; and the H3 seam replacing heuristic `withRuntimeEnvContributions()` plaintext merging with purpose-typed per-workspace references. Decision 27 model BYOK stays at the landed #820 host Pi request seam and is rejected by remote-worker/Sandbox exec; only non-model invocation-secret references may reach the worker stdin envelope. Extend #820's owner-only credential lifecycle with an explicit disabled/revoked tombstone that suppresses instance fallback, plus upstream-revocation receipt/state; clear/absence retains Decision 27 fallback semantics. | Gates A-D and tracker transaction; completed `#808` Phase 1-3 swap/artifact proof; merged `#820` 16f.2 host-side per-request credential seam. | Sandbox/Core/Agent focused build/typecheck/test/invariants; strict config, missing-workspace, per-box-token, capability-expiry, and SSE-expiry/invalidation negatives; pair lifecycle/idempotency/expiry/dispose/error tests; two-workspace x two-sandbox cross-product rejection on fs/events/exec/renew/delete before adapters; authenticated-receipt/swapped-create-response rejection; Decision 27 rotation visible at the next host model request; owner-only emergency disable creates a durable tombstone, suppresses fallback immediately, best-effort aborts the active request, and requires upstream revocation receipt/state before resolved; clear/absence still uses the explicit Decision 27 fallback; retained Sandbox-exec no-model-key proof; purpose/model/cross-workspace reference negatives; non-model stdin-envelope proof; Agent value-import invariant. **6gd.1 does not pass without every H3 and H5 gate.** |
| `wt-391-forward-6gd.2` | `SBX1.2: define the production V3 qualification contract and bundle tooling` | Additive V3 read-write/no-network/quota schema; immutable cohort-specific bundle format/builder; host/guest-kernel/Docker/runtime/runsc/profile/quota/run/time fields; preserved 11 isolation-configuration objectives plus write/persistence/quota controls; strict all-passed validator. It does not admit a production image yet. | `SBX1.1`. | Bundle checksum/manifest and reproducibility tests; strict schema/evidence/drift negatives; fixture/reference-profile harness proof clearly marked non-admitting. |
| `wt-391-forward-6gd.3` | `SBX1.3: implement the session-lifetime Docker+runsc worker runtime` | Typed Docker argv runner; dirfd/openat2 Workspace helper; fixed project quota and host reserve; workload image with trusted PID1/subreaper and invocation wrapper; warm no-network session container; purpose-typed non-model per-invocation secrets; time/resource/output bounds; dispose/expiry/orphan cleanup. | `SBX1.1`, `SBX1.2`. | Unit fault matrix plus non-admitting integration evidence for real runsc create/fs/race/quota-fill/background-process/non-model-secret/model-key-negative/timeout/egress/teardown. No fleet admission or “exact production” claim. |
| `wt-391-forward-6gd.4` | `SBX1.4: wire and freeze the minimal VPS daemon and remote pair end to end` | Small server-only worker entrypoint; authenticated handshake/evidence/image/bundle checks; lifecycle/fs/exec/renew/events endpoints; relocate/retire pre-extraction Agent-owned remote-worker values; freeze the exact daemon/provider/workload cohort for qualification. | `SBX1.3`. | Protocol conformance against real daemon; lost-delete/404/hard-expiry tests; full remote-worker smoke through V1; exact packed artifact digests; Core/Workspace/Agent/full-app gates; no old runtime-value owner. Still not fleet-admitted. |
| `wt-391-forward-6gd.5` | `SBX1.5: publish exact qualification bundle, gate fleet admission, and publish the runbook` | Build the cohort-specific immutable bundle from the frozen `.4` artifacts; protected disposable self-hosted workflow; candidate-box gate; startup receipt/freshness checks; drift policy; install/register/systrap/quota/admit/drain/restore runbook; baseline monitored host escape-canary; critical-CVE fence/stop/patch/requalify procedure. | `SBX1.4`. | First admitting V3 evidence binds the final daemon/provider/workload/bundle digests; exact provider smoke; protected CI run/artifact digest; fresh candidate provision, quota fill, restart/recovery walkthrough, protected canary alert, and critical-CVE game day meeting H1's 15/60-minute bounds. No box receives a bucket before this proof. |
| `wt-391-forward-6gd.6` | `SBX1.6: canary and flip the SaaS default to own-cloud remote-worker` | Existing-workspace inventory; bounded metadata-preserving forward/reverse cutover utility or empty proof; staging/canary; static production fleet config; default config flip; Vercel preservation and rollback playbooks. | `SBX1.5`; merged `#807` `807-T1.4` durability/recovery proof; merged `#820` 16f.3 host conformance; owner cutover approval. | Exact-artifact SaaS journey; independent POSIX manifests or empty proof; qualified-worker health; #807 task interruption/replay proof under box loss; Decision 27 host-key/Sandbox-negative proof; config proof; reverse-copy rollback rehearsal; Vercel conformance. |
| `wt-391-forward-6gd.7` | `SBX1.7 (deferred): harden box trust and daemon-host metadata access` | Evaluate measured boot/hardware attestation against the H2 threat model; block daemon/host metadata endpoints including `169.254.169.254`; minimize shard-scoped host credentials; extend the v1 compromise/removal exercise to a rooted-daemon scenario. | Deferred; may start after `SBX1.5`; does not block `.6`. | Rooted/compromised-daemon threat exercise; metadata IPv4/IPv6 negatives at the host seam; credential-scope inventory; measured-boot adopt/defer recommendation with cost and residual risk. |
| `wt-391-forward-6gd.8` | `SBX1.8 (deferred): set tenant-density tiers and fleet CVE failover economics` | Measure tenants-per-box economics and blast radius; define standard/dedicated-box/high-trust tier triggers; cost patch rings, drain/spare capacity, fleet-wide runsc-CVE response, and the microVM second-boundary option. | Deferred; production measurements after `SBX1.6`; does not block `.1`-`.6`. | Density/cost model and patch/failover options grounded in `.5`'s v1 critical-CVE game day; explicit owner decision before changing tenant density, failover posture, or adding a second boundary. |
| `wt-391-forward-6gd.9` | `SBX1.9 (deferred): set recovery objectives and #819 black-box observability` | Measure backup/restore behavior; ratify RPO/RTO and drill cadence; add tenant-payload-free black-box product probes and SLO dashboards through the relevant #819 observability seam. | Deferred; `SBX1.6` plus relevant #819 observability contract; does not block `.1`-`.6`. | Timed destructive-box recovery drill on non-production data; measured data-loss window; owner-ratified RPO/RTO; black-box alert and dashboard proof tied to #819. |

Each Bead must copy its relevant Today/Delta, exclusions, acceptance, commands,
rollback, and stop conditions so an execution agent can work without guessing.
Keep each production-code PR within the repository review budget (about 1,500
added production lines excluding tests/docs/generated artifacts). Split a Bead's
PR mechanically if needed; do not change dependency order or create a second
authority.

After owner creation, run:

```bash
br dep cycles
bv --robot-insights
```

Never run bare `bv`. This planning PR intentionally runs neither command because
it makes zero `.beads` edits.

## Dependency graph

```text
Decision 26 Step 1A accepted proof
  + Decision 26 Step 2 accepted proof
  -> #808 Phase 1 COPY
  -> #808 Phase 2 VERIFY
  -> #808 Phase 3 SWAP + exact artifact proof
  -> owner repairs stale tracker edge + creates/activates SBX1.x
  + #820 16f.2 host-side per-request credential seam
  -> SBX1.1 V1 protocol + static placement
  -> SBX1.2 V3 contract + qualification-bundle tooling
  -> SBX1.3 Docker+runsc runtime (non-admitting integration proof)
  -> SBX1.4 frozen daemon/provider/workload cohort + end-to-end pair
  -> SBX1.5 exact bundle + final V3 CI/fleet admission + runbook
  + #807 807-T1.4 durability/recovery proof
  + #820 16f.3 host credential conformance
  -> owner cutover approval
  -> SBX1.6 canary + metadata-safe data readiness + default flip

non-blocking deferred follow-ups created at activation:
  SBX1.7 box trust + daemon metadata hardening
  SBX1.8 density tiers + runsc-CVE failover economics
  SBX1.9 RPO/RTO + #819 black-box observability
```

Fresh OVH qualification clears the commodity-hardware viability unknown. It
does not skip any edge in this graph.

## Proof commands

Each implementation PR runs its focused tests. The final chain runs at least:

```bash
pnpm --filter @hachej/boring-sandbox run build
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run test
pnpm --filter @hachej/boring-sandbox run check:invariants
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run check:isolation
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-core run test
pnpm --filter full-app run build
pnpm --filter full-app run smoke:remote-worker
pnpm audit:imports
pnpm lint:invariants
pnpm typecheck
pnpm test:changed
```

On the protected disposable build/qualification runner, create and verify the
reviewed bundle before publishing the release cohort:

```bash
pnpm --filter @hachej/boring-sandbox run build
node packages/boring-sandbox/scripts/build-runsc-qualification-bundle.mjs \
  --reviewed-sha <git-sha> --image <repository@sha256:digest>
sha256sum -c boring-runsc-qualification-<git-sha>.tgz.sha256
```

Every candidate fleet box receives that artifact and the packed worker cohort,
not a repository checkout. Its runbook invokes only checksummed bundle/release
entrypoints:

```bash
sha256sum -c boring-runsc-qualification-<git-sha>.tgz.sha256
tar -xzf boring-runsc-qualification-<git-sha>.tgz \
  -C <empty-qualification-directory>
<empty-qualification-directory>/bin/qualify-docker-runsc-isolation \
  --image <repository@sha256:digest> > runtime-isolation-evidence.json
<empty-qualification-directory>/bin/verify-fleet-admission-evidence \
  runtime-isolation-evidence.json
<packed-worker-cohort>/bin/smoke-remote-worker-runsc
```

The names of future bundle-builder/entrypoint files may be finalized by the
implementing slices, but candidate-host semantics may not change: no source
checkout or local build, and the three proofs remain strict qualification admission,
real V1 provider smoke, and exact artifacts.

For this plan-only PR:

```bash
git diff --check origin/main...
git diff --name-only origin/main...
test "$(git diff --name-only origin/main... | wc -l)" -eq 1
test "$(git diff --name-only origin/main...)" = \
  "docs/issues/808/sbx1-own-cloud-provider-plan.md"
git grep -nE 'AgentHost|controller|reconciler|CAS|publication journal|mutable runtime registry|marketplace|billing|Firecracker' \
  -- docs/issues/808/sbx1-own-cloud-provider-plan.md
```

Review every grep occurrence as an explicit rejection, historical Today fact,
or trigger—not a dependency.

## Explicit non-goals and trigger conditions

| Non-goal in SBX1 | Trigger for a new plan/decision |
| --- | --- |
| AgentHost or any renamed host/controller service; controller/reconciler loop; CAS; publication/apply journal; mutable provider/runtime registry. | None implicit. A named product requirement must first show why static composition and ordinary deploy config cannot satisfy it, and Decision 25/26 must be amended explicitly. |
| Queue, job broker, scheduling framework, worker autoscaling, or live capacity placement. | Sustained measured demand cannot be served by fixed shards and immediate bounded concurrency, with explicit latency/SLO/backpressure requirements. |
| Automatic cross-worker failover or live shard migration. | A committed availability SLO and data-portability design require failover faster than host/volume restore. |
| S3/FUSE/native mounts or shared filesystem across workers. | X1's named consumer supplies access, lifecycle, credentials, isolation, and benchmark requirements in its own approved plan. |
| Public worker API or tenant credentials to the worker. | No normal trigger; the worker is an internal data-plane surface. External ingress remains UI/MCP/A2A through the control plane. |
| Egress allowlists, package-install proxy, or unrestricted Internet. | A named tool/product journey requires a specific destination/protocol and provides exfiltration, DNS, secret, logging, and requalification requirements. |
| Dynamic workload images, tenant Dockerfiles, build service, image registry UI, or runtime upload. | A validated declarative deployment consumer cannot use the fixed exact image and earns a separate supply-chain/isolation plan. |
| Firecracker/KVM. | Docker+runsc fails a required isolation/performance/customer control after measured proof, and the owner accepts the additional image/kernel/network/host operations. `/dev/kvm` availability alone is not a trigger. |
| Resource profiles beyond the initial fixed CPU/memory/PID/output/1-GiB/100,000-inode profile; generalized quota tiers, quota UI, or dynamic policy. | The real canary cannot operate within current ceilings, or measured volume growth earns a separately defined product policy; update the harness/evidence and requalify before use. |
| Multi-region fleet, automatic geographic routing, or zero-downtime host churn. | A named regional/SLO requirement and enough fleet size justify the operational system. |
| Marketplace, metering, billing, or fleet management UI. | Marketplace/billing retain the agent-cloud vision triggers (first external developer or second real paying tenant) and still require separate plans. |
| Custom tenant tool packaging/handler protocol. | A named custom-tool consumer activates the sandbox-entrypoint plan; SBX1 only provides the safe exec substrate and per-invocation secret path. |
| Moving sessions/transcripts to workers. | No SBX1 trigger; host app session history remains control-plane user data per AGENTS.md hard rule 9. |
| Removing Vercel sandbox. | A later owner decision after the own-cloud path has operated stably through the agreed rollback window and no supported consumer needs Vercel. |

## Stop conditions

Stop and amend this plan rather than improvise if:

1. implementation starts before Decision 26 Steps 1A and 2 plus the `#808`
   Phase 1-3 extraction/swap/artifact gate are complete;
2. the landed V1 seam cannot represent a remote Workspace + Sandbox lease
   without a provider-specific acquisition side door;
3. Agent would retain or regain a remote-worker/runsc runtime value;
4. the worker needs user auth, agent definitions, model/session logic, a queue,
   registry, scheduler, or cross-worker controller to complete the tracer;
5. static placement cannot preserve one authoritative workspace volume without
   hidden cross-worker fallback or writable split-brain;
6. the production Docker flags/network/UID/resource/image profile differs from
   admitted evidence;
7. any candidate box cannot pass all 11 isolation-configuration probes, every V3
   write/persistence/quota control, redaction, exact production-profile
   verification, and the real provider smoke;
8. tenant secrets must enter image layers, Docker/container configuration,
   command argv, a persistent file, logs, or cached idempotency results;
9. timeout cannot prove the command process group is gone without destroying the
   session container;
10. the initial real product cannot operate under the qualified resource or
    default-deny egress profile;
11. existing workspace data cannot be inventoried, drained, copied with the
    bounded metadata-preserving contract, and independently verified before the
    default flip;
12. rollback would expose a stale Vercel or worker workspace;
13. a CI skip or structural preflight is being used to claim runsc
    qualification or escape resistance;
14. Firecracker, S3/FUSE, marketplace/billing, AgentHost/controller/CAS/journal,
    or a mutable runtime registry enters the dependency graph;
15. implementation requires a broad runtime refactor beyond the named V1,
    daemon, runsc, acceptance, runbook, and cutover seams.

## Review record

- **2026-07-20 red-team H1-H6 revision:** added the honest isolation threat
  model, box-breach containment posture, Decision 27 key lifecycle, executor
  death/recovery contract, sandbox/workspace binding invariant, and tracked
  deferrals. Owner ratification remains required at the three explicit markers.
- **Tier-1 fresh-eyes re-review:** initial `REVISE` found Decision 27 model BYOK
  crossing the general Sandbox stdin seam, a missing #807 dependency, an
  unverifiable swapped-create gate, and v1 canary/CVE controls deferred past
  cutover. The second pass found the new no-fallback revocation tombstone had no
  explicit implementation owner. Model BYOK now remains host-side, #807 is
  scoped to Agent-task durability and gates `.6`, H5 has a binding receipt and
  bounded SSE, `.5` owns canary/CVE proof, and `.1` explicitly owns the
  tombstone plus upstream receipt state. Targeted final re-review: `PASS`.
- **Tier-2 architecture/security re-review:** initial `REVISE` confirmed those
  issues and additionally rejected retrying outcome-unknown work from a lost
  session-local journal. The current plan makes that outcome terminal and
  non-auto-retry, adds the concrete #807/#820 edges, and retains the
  Sandbox-exec no-model-key negative. Clean re-review: `PASS`.
- **Tier-1 fresh-eyes:** initial `REVISE` found candidate-box commands that
  rebuilt from a checkout despite the immutable-bundle policy. The commands are
  now split between protected bundle construction and checksum-only bundled
  entrypoints on fleet candidates. Clean re-review: `PASS`.
- **Tier-2 architecture/security:** initial `REVISE` found final V3 evidence
  ordered before the daemon/runtime cohort freeze and a missing continuous
  migration write fence. Final bundle/admission moved to `SBX1.5`; forward and
  reverse cutover now remain fenced through atomic ownership flip. Clean
  re-review: `PASS`.
- **Plan-readiness convergence:** initial `REVISE` also required both host and
  gVisor guest kernel facts and destination-specific rollback quota wording.
  Both were added. Final re-review: `PASS`, with no remaining material readiness
  issue.
