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
ingress. The API gateway, durable binding/nonce state, E2B API, client-proxy,
required Redis routing catalog, Postgres, object storage, Nomad/Consul servers,
and private wildcard DNS/TLS ingress run on trusted management infrastructure.

The bare-metal sandbox node runs only the minimum E2B node/orchestrator,
Nomad/Consul client, Firecracker/jailer, and guest data plane. It receives no
control-plane signing root, reusable customer/API key, model credential,
transcript store, or direct public request.

Current source already provides:

- strict V1 request/response schemas;
- the remote-worker protocol client and SandboxProviderV1 adapter;
- binding-registry and in-memory nonce primitives;
- an in-process Docker/runsc runtime.

Current source does **not** provide the HTTP/SSE gateway/daemon, durable
multi-tenant binding+nonce store, E2B API adapter, Firecracker cohort schema, or
provider-neutral qualification driver. S1 builds those pieces; docs must not call
the server routes already implemented.

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

Every guarded route applies this order before an E2B effect:

1. body-size and content-type bound;
2. strict schema validation;
3. management-plane capability verification;
4. durable nonce consumption and tenant/workspace binding authorization;
5. per-tenant/global concurrency and spend/lease checks;
6. server-side admitted-template/policy construction;
7. E2B public API/SDK call;
8. bounded, redacted response.

No route accepts a host path, E2B API key, template override, VM spec, device,
runtime socket, network-policy override, image tag, qualification override, or
caller-selected isolation downgrade.

## Exact E2B adapter boundary

The v1 gateway targets E2B's **public API/SDK** for create, commands, files,
renew/timeout, and kill. It does not call orchestrator gRPC or envd directly.
E2B's API remains responsible for lifecycle routing to orchestrator and opaque
template restoration. E2B SDK fs/exec traffic uses the private client-proxy
wildcard DNS/TLS endpoint; client-proxy resolves the sandbox-to-node route from
Redis and forwards through the owning orchestrator proxy to envd. Neither path
is public to customers.

The gateway holds its E2B service credential only on trusted management
infrastructure. The sandbox node never receives that credential. E2B sandbox
identifiers and template/build identifiers are stored in the management-plane
binding record and are never treated as authorization on their own.

The adapter constructs one admitted E2B template/build and resource/network
profile server-side. A caller chooses only the authorized workspace/session
identity and supported operation inputs.

## Lifecycle contract

### Create

POST /internal/v1/sandboxes maps an authorized
(workspaceId, clientLeaseId) to one deterministic opaque sandboxId and one E2B
Firecracker microVM.

The management gateway:

- loads or creates the durable workspace-volume/snapshot binding;
- selects the exact admitted E2B template/build cohort;
- applies fixed CPU, memory, PID/process, output, disk/block, lease, network, and
  concurrency limits;
- creates exactly one microVM under retry;
- records the E2B sandbox identity and tenant/workspace binding durably;
- returns runtimeCwd=/workspace.

A dropped response and retried create must return the same binding and cannot
leave two live microVMs.

### Renew

Renew changes only the bounded lease. It cannot alter image/template, resources,
network policy, workspace volume, or isolation tier.

### Delete

Delete is idempotent. Normal delete first commits/synchronizes the durable
workspace state, then destroys the microVM and reclaims its ephemeral overlay.
If durable commit cannot be proven, delete reports a stable failure and the
reconciler retains/fences the state for recovery rather than claiming success.

Hard-expiry cleanup follows the same durable-state rule. Crash recovery restores
the last acknowledged durable workspace generation and reports any explicit RPO;
v1 may not silently discard acknowledged fs writes.

## Workspace contract

Paths remain workspace-relative and resolve beneath /workspace. Path validation
belongs to the E2B/fs adapter.

The current runsc implementation uses a daemon-owned host bind, but that is not a
SandboxProviderV1 requirement: the remote provider already ignores the caller's
host workspaceRoot and exposes remote /workspace.

Corrected v1 uses a tenant-bound durable provider volume or E2B-managed workspace
snapshot as the authoritative workspace. The active Firecracker guest attaches
or restores only that workspace. Its rootfs/template snapshot is not the
workspace authority.

Required semantics:

- an acknowledged fs write is committed to the tenant's durable workspace
  generation before success, or the response explicitly reports failure;
- write -> destroy -> recreate -> read returns the written bytes;
- a crash between data write and generation publication recovers either the old
  complete generation or the new complete generation, never a partial mix;
- a sandbox cannot attach, restore, enumerate, or infer a sibling workspace;
- initial import and final artifact export use bounded management-plane transfer;
- events come from the guest agent or bounded polling; host inotify is not part
  of correctness;
- no host directory is mounted into Firecracker.

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
fields reaches E2B. Background handles, PTY, stdin streaming, and public port
exposure remain absent from v1.

Secret-bearing credentialRefs remain fail-closed in the initial v1. Model and
provider credentials stay in Seneca's control plane. Adding sandbox credentials
requires a separately reviewed short-lived delivery path that does not place
reusable secrets on the sandbox node.

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
- The node receives only the admitted E2B operation and narrowly scoped internal
  node credentials required by E2B; never the customer capability-signing root.

The implementation may reuse the existing binding and nonce interfaces, but the
in-memory nonce store is only a test double in public multi-tenant production.

## Health and cohort neutrality

The current health literal docker-runsc-systrap is obsolete. Internal v1 health
reports:

- isolationTier = hardware-microvm;
- admitted vehicle/VMM/jailer/kernel/rootfs/guest-agent/policy/evidence digests;
- capacity/readiness without tenant counts or identifiers.

The public app need not expose VMM brands. SandboxProviderV1 callers rely on the
hardware tier and admitted cohort, not a Firecracker-specific public verb.

## E2B-shaped subset

| E2B concept | V1 mapping | Status |
| --- | --- | --- |
| Sandbox.create | POST /sandboxes | supported through admitted template only |
| Sandbox.kill | DELETE /sandboxes/{id} | supported |
| setTimeout/TTL | POST /renew | supported |
| commands.run | POST /exec | supported, buffered output |
| files read/write/list/stat/mkdir/rename/remove | POST /fs | supported |
| files.watchDir | GET /fs/events | guest events or bounded polling |
| list/connect/getInfo/metadata | none | deferred |
| streaming stdout/stderr, PTY, stdin, background handles | none | deferred |
| getHost(port) | none | deliberately absent |
| pause/checkpoint/fork | no public V1 verb | E2B may use opaque template restore internally; product feature is v2 |
| E2B API key | management gateway service credential | never exposed to customer or node |

v1 may inherit E2B's internal UFFD/NBD template restore because that is part of
the adopted vehicle. v1 does not expose snapshots, own snapshot formats, fork
tenant state, maintain warm pools, or schedule by snapshot locality. Those
owned-fleet capabilities remain in plan-v2-hardening.md.

## SandboxProviderV1 mapping

SandboxProviderV1 remains the consumer seam:

- create -> management gateway create;
- returned Sandbox.exec -> gateway exec;
- returned Workspace methods -> gateway fs;
- Workspace.watch -> gateway events/polling;
- dispose -> gateway delete;
- provider invalidation/close -> stop admission and drain managed bindings.

v1 implements the gateway plus E2B adapter. v2 may replace E2B/Firecracker with
an owned Cloud Hypervisor fleet without changing these consumer methods.

## Stable errors and proof

Every failure has a stable, redacted code. Tests must prove no E2B effect for:

- malformed/expired/replayed/mismatched capability;
- cross-tenant workspace/sandbox combination;
- exhausted tenant or global budget;
- host-shaped path or traversal/symlink race;
- template/image/spec/device/network override;
- unqualified cohort;
- durable workspace commit failure;
- partial management-plane or node failure.

The end-to-end proof drives the real HTTP/SSE gateway against the E2B public API
adapter and covers two concurrent tenant identities, durable
write/destroy/recreate/read, retry idempotency, hard expiry, orphan cleanup,
egress deny, quota isolation, and rollback.
