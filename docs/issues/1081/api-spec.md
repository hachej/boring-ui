# SBX1 control-plane API — corrected v1 contract

This document owns the wire contract between Seneca's trusted control plane and
the sandbox management gateway. It is an E2B-shaped subset behind
SandboxProviderV1; it is not a public E2B-compatible customer API.

The architecture is
[../../direction/sandbox-service-architecture.md](../../direction/sandbox-service-architecture.md),
the execution plan is [plan-sbx14.md](plan-sbx14.md), and the raw E2B comparison
is [references/control-plane-api-spec.md](references/control-plane-api-spec.md).

## Boundary and current status

Customers authenticate to Seneca's existing public multi-tenant edge. Seneca
authorizes a tenant/workspace and calls this API over private management-plane
ingress. The API gateway, durable binding/nonce state, and scoped S3 credential
issuer run on trusted management infrastructure.

The bare-metal sandbox node runs only containerd, the Kata runtime wrapper,
Firecracker/jailer, and the guest data plane. It receives no
control-plane signing root, reusable customer/API key, model credential,
transcript store, or direct public request.

Current source already provides:

- strict V1 request/response schemas;
- the remote-worker protocol client and SandboxProviderV1 adapter;
- binding-registry and in-memory nonce primitives;
- an in-process Docker/runsc runtime.

Current source does **not** provide the HTTP/SSE gateway/daemon, durable
multi-tenant binding+nonce store, Kata/Firecracker adapter, S3 sync-hybrid
storage path, Firecracker cohort schema, or provider-neutral qualification
driver. S1 builds those pieces; docs must not call the server routes already
implemented.

## Endpoint set

v1 keeps the existing internal prefix. Customers do not call it directly.

| Method and path | Operation | Result |
| --- | --- | --- |
| GET /internal/v1/health | health | Admitted hardware-microVM tier and exact cohort digests; no customer or node secret |
| POST /internal/v1/sandboxes | create | sandboxId, runtimeCwd=/workspace, lease expiry, authenticated binding receipt |
| POST /internal/v1/sandboxes/{id}/exec | exec | bounded command result, exit code, buffered stdout/stderr |
| POST /internal/v1/sandboxes/{id}/fs | fs | bounded workspace-relative filesystem operation |
| GET /internal/v1/sandboxes/{id}/fs/events | events | bounded SSE guest event stream or polling projection |
| POST /internal/v1/sandboxes/{id}/renew | renew | updated lease expiry |
| DELETE /internal/v1/sandboxes/{id} | delete | idempotent disposal result |

Every guarded route applies this order before a sandbox-provider effect:

1. body-size and content-type bound;
2. strict schema validation;
3. management-plane capability verification;
4. durable nonce consumption and tenant/workspace binding authorization;
5. per-tenant/global concurrency and spend/lease checks;
6. server-side admitted OCI-image/RuntimeClass/policy construction;
7. Kata/containerd provider call;
8. bounded, redacted response.

No route accepts a host path, provider credential, image/RuntimeClass override,
VM spec, device, runtime socket, network-policy override, image tag,
qualification override, or caller-selected isolation downgrade.

## Exact Kata/Firecracker adapter boundary

The v1 gateway targets one admitted containerd/Kata configuration for create,
commands, files, renew/timeout, and kill. Kata is only the OCI runtime wrapper;
qualification proves it launches the pinned Firecracker engine, which remains
the hardware-KVM boundary. `firecracker-containerd` is a separately qualified
lower-level fallback, never mixed into the same cohort.

The adapter constructs one admitted OCI image, Firecracker-backed Kata
RuntimeClass/configuration, resource profile, S3 endpoint allowlist, and quota
profile server-side. A caller chooses only the authorized workspace/session
identity and supported operation inputs. Runtime and Firecracker identifiers in
the management binding are never authorization on their own.

## Lifecycle contract

### Create

POST /internal/v1/sandboxes maps an authorized
(workspaceId, clientLeaseId) to one deterministic opaque sandboxId and one
Firecracker microVM launched through Kata.

The management gateway:

- acquires the single active writer lease for the tenant/workspace;
- loads the current immutable S3 manifest and object version IDs;
- selects the exact admitted Kata/Firecracker OCI-image cohort;
- applies fixed CPU, memory, PID/process, output, disk/block, lease, network, and
  concurrency limits;
- creates exactly one microVM under retry;
- records the runtime sandbox identity and tenant/workspace binding durably;
- returns runtimeCwd=/workspace.

A dropped response and retried create must return the same binding and cannot
leave two live microVMs.

SandboxProviderV1 may reuse that same authorized sandbox across calls through a
session pool. Reuse is keyed by tenant/workspace/session binding, resets the idle
TTL, never crosses identities, and remains subordinate to the hard lease and
single-writer lease. Idle expiry checkpoints, then destroys. If checkpoint
fails, it fences/retains the local disk for recovery.

Guest network starts disabled. The admitted policy allowlists only the tenant's
S3 endpoint and callers cannot widen it. If Kata is absent or unhealthy, the
host app/control plane may start, but sandbox admission/create fails closed with
a stable unavailable result and never falls back to a weaker provider.

### Renew

Renew changes only the bounded lease. It cannot alter the image/RuntimeClass,
resources, network policy, S3 namespace, writer lease, or isolation tier.

### Delete

Delete is idempotent. Normal delete first publishes an immutable S3 checkpoint
manifest and conditionally advances the workspace generation, then destroys the
microVM and securely discards its encrypted/ephemeral local disk. If durable
commit cannot be proven, delete reports a stable failure and the reconciler
retains/fences the disk and writer lease for recovery rather than claiming
success.

Hard-expiry cleanup follows the same durable-state rule. Crash recovery restores
the last committed manifest and reports the documented RPO for exec-process
writes; v1 may not silently discard an acknowledged provider `/fs` write.

## Workspace contract

Paths remain workspace-relative and resolve beneath `/workspace`. Path
validation belongs to the guest fs/copy adapter.

The current runsc implementation uses a daemon-owned host bind, but that is not a
SandboxProviderV1 requirement: the remote provider already ignores the caller's
host workspaceRoot and exposes remote /workspace.

Corrected v1 uses a per-tenant S3 bucket/prefix as the durable system of record.
Plain user files and immutable key+version checkpoint manifests remain directly
accessible through ordinary S3 commands/APIs. The active Firecracker guest runs
on a local ext4/xfs disk and an in-guest sync bridge lazily hydrates the selected
manifest and flushes provider-fs writes, explicit checkpoints, and session end.

Required semantics:

- an acknowledged provider `/fs` write is committed to a new S3 manifest/
  generation before success, or the response explicitly reports failure;
- writes made by an exec process become durable at the documented checkpoint
  boundary and are subject to the declared crash/expiry RPO;
- write -> destroy -> recreate -> read returns the written bytes;
- publication conditionally advances one generation pointer over immutable
  object-version manifests; a crash recovers either the old complete generation
  or the new complete generation, never a partial mix;
- one active writer lease exists per tenant/workspace. A second writer or direct
  S3 edit against the baseline causes a stable conflict/fence and refresh, never
  silent last-writer-wins;
- a sandbox cannot attach, restore, enumerate, or infer a sibling workspace;
- transient context/uploads/SQL-result CSVs use bounded copy-in to the unsynced
  `/inputs` tree and are securely discarded; final artifacts live in or are
  explicitly copied to the S3-backed `/workspace`;
- events come from the guest agent or bounded polling; host inotify is not part
  of correctness;
- no host directory is mounted into Firecracker;
- a failed flush fences/retains the local disk and never destroys while
  reporting success.

Firecracker's lack of virtio-fs therefore requires no public-contract change.
It changes the current runsc backend implementation and requires explicit
durable sync/persistence proof.

## Exec contract

Exec keeps the existing bounded shape:

- one command string;
- optional cwd beneath /workspace;
- timeout no greater than the protocol ceiling;
- output byte ceiling;
- buffered stdout/stderr, encoding metadata, exit code, duration, and truncation;
- cancellation/lease expiry propagated to the guest command.

No raw container/VM spec or shell argv assembled from untrusted structural
fields reaches containerd/Kata. Background handles, PTY, stdin streaming, and public port
exposure remain absent from v1.

Secret-bearing credentialRefs remain fail-closed in the initial v1. Model and
provider credentials stay in Seneca's control plane. The v1 S3 sync path is the
narrow exception: it receives an expiring tenant-prefix/action-scoped
credential that denies bucket policy/lifecycle/versioning/retention mutation,
historical-version deletion, and cross-prefix access. Adding any other sandbox
credential requires separate review.

## Authentication, replay, and tenant fairness

The old single static secret on both Seneca and the sandbox daemon is
superseded.

- Seneca authenticates public users and authorizes tenant/workspace access before
  minting a request-bound management capability.
- Capability issuance and verification occur on trusted management
  infrastructure. A signing root never reaches the bare-metal sandbox node.
- Claims bind protocol version, worker/cohort, tenantId, workspaceId, operation,
  sandboxId where applicable, exact request digest, issued/expiry times, and a
  globally unique nonce.
- The capability lifetime remains bounded to five minutes or less.
- Consumed nonce and binding state are durable and atomic on the management
  plane. The same transaction consumes the nonce and validates/updates the
  binding; a restart cannot reopen a replay window.
- Concurrent consumption of one nonce yields exactly one accepted request.
- Per-tenant active-sandbox/concurrency budgets sit below global host budgets, so
  one tenant cannot exhaust another tenant's admission.
- The public Seneca edge owns unauthenticated rate limiting, account abuse
  controls, and customer key/session rotation. The private sandbox gateway does
  not duplicate public-edge identity.
- The node receives only the admitted provider operation; the guest receives its
  expiring scoped S3 credential, never the customer capability-signing root.

The implementation may reuse the existing binding and nonce interfaces, but the
in-memory nonce store is only a test double in public multi-tenant production.

## Health and cohort neutrality

The current health literal docker-runsc-systrap is obsolete. Internal v1 health
reports:

- isolationTier = hardware-microvm;
- admitted runtime-wrapper/VMM/jailer/kernel/OCI-image/guest-agent/sync/policy/
  evidence digests;
- capacity/readiness without tenant counts or identifiers.

The public app need not expose VMM brands. SandboxProviderV1 callers rely on the
hardware tier and admitted cohort, not a Firecracker-specific public verb.

## E2B-shaped subset

| E2B concept | V1 mapping | Status |
| --- | --- | --- |
| Sandbox.create | POST /sandboxes | supported through admitted OCI image/runtime only |
| Sandbox.kill | DELETE /sandboxes/{id} | supported |
| setTimeout/TTL | POST /renew | supported |
| commands.run | POST /exec | supported, buffered output |
| files read/write/list/stat/mkdir/rename/remove | POST /fs | supported |
| files.watchDir | GET /fs/events | guest events or bounded polling |
| list/connect/getInfo/metadata | none | deferred |
| streaming stdout/stderr, PTY, stdin, background handles | none | deferred |
| getHost(port) | none | deliberately absent |
| pause/checkpoint/fork | no public V1 verb | block/memory fork remains v2; internal S3 manifests are storage commits, not this feature |
| E2B API key | none in v1 | E2B self-hosted is deferred to v2 |

v1 does not expose block/memory snapshots, own VMM snapshot formats, fork tenant
working state, maintain a snapshot warm pool, or schedule by snapshot locality.
Those fleet capabilities remain in plan-v2-hardening.md. Tenant-readable S3
remains the durable record in either v2 path.

## SandboxProviderV1 mapping

SandboxProviderV1 remains the consumer seam:

- create -> management gateway create;
- returned Sandbox.exec -> gateway exec;
- returned Workspace methods -> gateway fs;
- Workspace.watch -> gateway events/polling;
- dispose -> gateway delete;
- provider invalidation/close -> stop admission and drain managed bindings.

v1 implements the gateway plus Kata/Firecracker adapter. v2 may adopt E2B's
Firecracker snapshot engine or replace the single-host backend with an owned,
likely Cloud Hypervisor fleet without changing these consumer methods.

## Stable errors and proof

Every failure has a stable, redacted code. Tests must prove no provider effect for:

- malformed/expired/replayed/mismatched capability;
- cross-tenant workspace/sandbox combination;
- exhausted tenant or global budget;
- host-shaped path or traversal/symlink race;
- image/RuntimeClass/spec/device/network override;
- unqualified cohort;
- S3 manifest commit or writer-conflict failure;
- partial management-plane or node failure.

The end-to-end proof drives the real HTTP/SSE gateway against the
Kata/Firecracker adapter and covers two concurrent tenant identities, durable
write/destroy/recreate/read, same-workspace writer conflict, direct S3 drift,
unsynced `/inputs`, retry idempotency, hard expiry, orphan cleanup, S3-only
egress, scoped-credential expiry/action denial, quota isolation, and rollback.
