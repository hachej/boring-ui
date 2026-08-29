---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-13
revision: r6-sovereign-first
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — sovereign sandbox design

## What we are building

The product is an operator-controlled sandbox fleet in an approved EU region.
It runs untrusted customer agent code in one hardware-isolated micro-VM per
sandbox and keeps each workspace's durable files in self-hosted SeaweedFS.
SeaweedFS exposes the same plain tenant files through both a POSIX mount at
`/workspace` and an S3 API. Ephemeral `/scratch` remains the local tier for
SQLite and other fsync-heavy work; Gate 0 benchmarks decide how much general
build work also uses it.

The application sees this system through the existing `SandboxProviderV1`
contract. Kata Containers is the adopted OCI/containerd runtime wrapper;
Firecracker is the pinned KVM virtual-machine monitor and outer tenant
boundary. The target is not a managed-provider abstraction that may one day
become sovereign. The sovereign fleet is the architecture being built.

```text
Seneca public edge and trusted control plane
        |
        | SandboxProviderV1
        | create, exec, files, watch, suspend/resume, destroy, usage
        v
private management gateway and admitted provider configuration
        |
        v
operator-controlled EU bare-metal KVM host
        |
        +-- containerd -> Kata -> pinned Firecracker micro-VM A
        |                         guest kernel/network/devices A
        |                         /workspace A + /scratch A
        |
        `-- containerd -> Kata -> pinned Firecracker micro-VM B
                                  guest kernel/network/devices B
                                  /workspace B + /scratch B
                                         |
                                         v
                              self-hosted EU SeaweedFS
                              one tenant-scoped plain-file namespace
                              +-- POSIX/FUSE at /workspace
                              `-- S3 API + file events
```

The governing rule is:

> **Share the host, never the boundary.**

Many short-lived micro-VMs share a host for density. A standing VM per tenant
or workspace is neither the security model nor the cost model; the active
sandbox is the unit of isolation.

This document owns architecture, guarantees, limits, and cutover policy. The
ordered implementation and proof work lives in the
[sovereign build plan](sandbox-sovereign-build.md). Fleet-scale work lives in
the [scale plan](sandbox-sovereign-scale.md). The rationale and evidence remain
in [tech-choice.md](tech-choice.md) and [references/](references/).

## Tenant boundary and guarantees

Each admitted sandbox receives its own:

- Firecracker micro-VM and guest kernel;
- network identity and egress policy;
- guest-visible devices and per-VM local backing;
- tenant/workspace-scoped credentials;
- durable provider handle and authorization binding;
- `/workspace` namespace and ephemeral `/scratch`;
- CPU, memory, PID, output, disk, lease, concurrency, and storage limits.

Tenant A must not share Tenant B's guest kernel, network namespace, devices,
credentials, handles, or file namespace. The guest never receives `/dev/kvm`,
a containerd or VMM socket, a host workspace path, or a sibling's block device.
There is no host workspace bind-mount. Transient inputs enter through a bounded
zip copy-in/extract operation, so Firecracker does not need a live host-directory
channel.

Firecracker's KVM boundary is the isolation guarantee; Kata is the adopted
wrapper that launches it from server-selected images. Qualification proves the
exact Kata configuration launches the exact pinned Firecracker binary, rather
than trusting a runtime label or brand. The operator owns the admitted
Firecracker, jailer, Kata, containerd, host/guest kernel, rootfs, guest-daemon,
image, SeaweedFS, and policy pins. A wrapper or provider default is never
inherited silently.

The control plane remains outside the sandbox host. Capability-signing roots,
reusable customer/model credentials, tenant authorization, durable nonce and
binding authority, transcripts, and session history stay on trusted management
infrastructure. The node receives only the material needed to launch an
operation; a guest receives only renewable, expiring credentials for the
authorized tenant/workspace storage prefix.

Networking is denied by default. The v1 guest allowlist contains only the
selected SeaweedFS endpoint. Callers cannot select or override the runtime,
VMM, kernel, image, device, host path, network policy, credential scope, or
qualification result. If the admitted provider is unavailable or mismatched,
sandbox admission fails closed; it never falls through to local execution,
runsc, runc, gVisor, or another weaker boundary.

These controls make a guest-kernel compromise face a distinct KVM/VMM
boundary. They do not make Firecracker or KVM invulnerable. VMM/KVM escapes,
control-plane compromise, intentionally allowed egress, and Spectre/MDS-class
side channels remain explicit risks. Microcode, SMT/core scheduling, cohort
selection, measurement, and residual-risk policy are a separate security
workstream and may block admission.

## Sovereignty claim

The sovereign target runs compute and durable workspace storage on
operator-controlled infrastructure in an approved EU region. M0's reference
compute is a dedicated Hetzner AX102 bare-metal host; the admitted region and
exact hardware/software cohort are recorded in its qualification evidence.
SeaweedFS is self-hosted inside the same approved perimeter rather than being a
managed sandbox provider's opaque volume product.

Key and credential authority is split deliberately:

- trusted operator-controlled management infrastructure holds capability
  signing roots, reusable customer/model credentials, tenant authorization,
  and storage-credential issuance authority;
- the sandbox host holds no signing root or reusable customer credential;
- each guest receives only short-lived, action- and prefix-scoped storage
  credentials for its own workspace.

The current documents do not establish a specific at-rest encryption key
custody scheme, so the customer claim must not imply one until that decision is
made.

Once the exact cohort is qualified, a customer can be told that their admitted
sandbox runs on operator-controlled EU bare metal, receives a distinct
hardware micro-VM and guest kernel, and stores durable workspace files in the
operator's EU SeaweedFS perimeter. They can also be told that their files are
plain and directly accessible through the supported S3 and POSIX surfaces.

They cannot yet be told that the owned service is multi-host or failure-domain
redundant, that destructive agent overwrites have object-version recovery, that
KVM eliminates side channels or escape risk, or that a particular country/data
center or at-rest key-custody model applies unless those facts are separately
selected and proven.

## Storage and workspace semantics

Self-hosted Apache-2.0 SeaweedFS is the durable data substrate. A tenant's
`/workspace` is one tenant-scoped plain-file namespace visible through both:

- an admitted SeaweedFS FUSE/POSIX mount inside the micro-VM at `/workspace`;
- an S3 API for direct access, export, and product file-browsing surfaces.

This preserves bring-your-own-data and take-your-data-out without hiding user
files inside an opaque block image or chunk store. Short-lived credentials are
scoped to the tenant/workspace prefix and required actions. S3-side events and
guest inotify events feed the same provider watch stream.

SeaweedFS `weed mount` is a genuine cached POSIX client, not an s3fs-style
object shim: it has filer metadata and file-chunk caches, accepts
arbitrary-offset writes, and implements `fcntl`/`flock` advisory locks. No
current primary-source benchmark establishes `git clone`, `git status`, pnpm,
`node_modules`, or representative JavaScript build performance on the proposed
topology, so the general build-performance case for `/scratch` is unmeasured.

The evidence for a local tier is narrower and material. SeaweedFS's first-party
database benchmark measured SQLite one-row transactions at 1,987 tx/s on local
NVMe versus 171 tx/s on FUSE (11.6x slower), SQLite bulk load at about 2x
slower, and fsync latency at 0.13 ms locally versus 1.18 ms on FUSE (9x
slower). SeaweedFS's own guidance recommends unmounted local storage for
temporary writes. Cross-mount distributed locking is opt-in, so multi-mount
SQLite is not safe by default, and database-grade power-loss behavior is not
established. See the
[storage mount performance evaluation](references/storage-mount-performance-eval.md).

The v1 split is therefore chosen for predictable database-grade write latency
and SeaweedFS's temporary-write guidance, not because SeaweedFS is proven
unable to run git, package installs, or builds. An explicit scratch-plus-durable
mount is one sound industry pattern, not a necessity; persistent block volumes,
snapshot/restored local copy-on-write roots, and proprietary SSD caches in front
of object storage are also used. Gate 0 applies the owner-set benchmark
threshold before deciding whether general work runs directly on `/workspace`
or also uses `/scratch`.

`/scratch` is a separate ephemeral per-VM local device. Its backing may also be
encrypted, but it is always quota-bound and never durable. It is never
blanket-synchronized. A selected scratch artifact becomes durable only when
explicitly published into `/workspace`.

Publication is a control-plane-enforced v1 requirement, not agent discipline.
Normal teardown must not silently destroy `/scratch` while unpublished files
exist under admitted output paths: the control plane and guest daemon must
either keep teardown from destroying them until publication is acknowledged or
surface unpublished-output state before destruction. This is required because
v1 has no version history and teardown would otherwise destroy the sole copy
irrecoverably. The exact enforcement mechanism and state transition are open
questions; blanket synchronization remains out of scope.

Transient prompt context, selected project files, uploads, and query results
arrive in a bounded archive and are extracted to an unsynchronized transient
area. No host directory is mounted. The copy path rejects traversal, device,
link, and archive-expansion attacks and securely discards transient inputs at
teardown.

### No versioning in v1

**Owner ruling (2026-08-12):** v1 is plain durable S3 with dual POSIX access
and **no S3 versioning**. Versioning may return only if a compliance requirement
or an explicit undo-agent-changes requirement demands it. Gate 0 and M0 do not
require version-history evidence.

The tradeoff is deliberate and visible: if an agent destructively overwrites a
file and no independent backup captures the earlier bytes, that overwrite is
unrecoverable in v1. Backup and tested restore remain required for service
durability, but they are not represented as per-write user undo or object
history.

Naive s3fs remains rejected as the primary working filesystem because its
rename, random-write, append, and locking semantics are insufficient. Opaque
block volumes, JuiceFS/Turso-style containers, and MinIO do not meet the same
plain-file dual S3+POSIX product requirement. SeaweedFS's exact supported
cross-interface operations are proven and documented; unsupported behavior
must fail stably rather than corrupt data silently.

## File events and provider contract

The guest daemon watches `/workspace` and explicitly admitted artifact paths
under `/scratch` with inotify. External changes enter through SeaweedFS/S3 event
notifications. Source events may be duplicated or arrive out of order, so the
provider deduplicates by source identity, assigns a monotonic workspace cursor,
and emits an at-least-once normalized stream. Reconnect resumes from the last
cursor; a detected gap triggers authoritative filesystem/object reconciliation
before live delivery continues. Periodic polling is not an accepted
correctness path.

`SandboxProviderV1` keeps compute and persistence mechanics out of the
application. Its required semantics are:

| Capability | Required behavior |
| --- | --- |
| create | Idempotent by request/session identity; one sandbox per authorized session; tenant and external/session tags |
| exec | Bounded command, cancellation, output, time, CPU, memory, PID, and disk behavior |
| files | Bounded read/write/list/stat plus archive copy-in, explicit artifact publication, and unpublished-output state |
| watch | Live guest inotify plus external S3 events, at-least-once delivery, monotonic cursor, dedupe, and gap reconciliation |
| suspend/resume | Roughly 60-second idle policy and authorized resume without crossing a session key |
| destroy | Idempotent teardown, credential expiry/revocation, control-plane-enforced protection against silent unpublished-output loss, scratch discard, and orphan recovery |
| health/qualification | Stable unavailable/unqualified states and exact isolation/cohort facts |
| usage | Active sandbox-seconds, lifecycle counts, storage, and egress tagged by tenant/session/provider in the protected ledger |

A provider swap is a server configuration change, not an application-contract
or customer-data-model change.

## Qualification and Gate 0

Gate 0 exists to prove the load-bearing seams before implementation proceeds.
Its single checklist and concrete evidence requirements live only in
[Gate 0 of the sovereign build plan](sandbox-sovereign-build.md#gate-0--feasibility-and-evidence).

Gate 0 exits only when the Blaxel bridge fits the required provider contract,
the intended EU host can run the pinned Firecracker cohort through Kata,
SeaweedFS demonstrates the required same-file S3+POSIX and event behavior
without versioning, and all load-bearing observations are reproducible or
explicitly block the owned path. The two-tenant boundary proof follows in the
runtime qualification phases before M0. Gate 0 failure never authorizes a
shared-kernel fallback; EU workloads remain on the last qualified
hardware-microVM bridge while the sovereign path is corrected.

Qualification then binds the 11 existing hostile probes and the provider,
egress, quota, credential, lifecycle, file-event, backup/restore, and fail-closed
checks to the exact code SHA and immutable cohort digest. Security evidence
expires when a load-bearing pin or policy changes.

## M0: the honest first milestone

M0 is one qualified box, not an owned cloud. It proves one exact immutable
cohort on the reference host: Kata launches pinned Firecracker; two tenants get
separate boundaries; SeaweedFS supplies durable `/workspace`; `/scratch` is
ephemeral; `SandboxProviderV1` and the hostile qualification suite pass; and
new work can roll back to the qualified bridge without moving the SeaweedFS
namespace.

M0 is suitable for qualification and trusted canaries. It is not represented
as HA public-production readiness. Multi-host lifecycle, placement and drain,
warm pools, block/memory snapshot-fork, snapshot-locality scheduling, and
automated cohort qualification are owned by the
[sovereign scale plan](sandbox-sovereign-scale.md). Storage replication,
restore objectives, monitoring/on-call ownership, and side-channel admission
gates must also be satisfied before the build plan's broader public-admission
milestone.

Owning the fleet creates a permanent operational obligation. The operator must
provision and replace hardware; own capacity, host reserve, networking,
patching, cohort admission, VMM/kernel/rootfs supply chain, microcode and
side-channel policy, SeaweedFS health and backup/restore, credential issuance,
monitoring, incident response, orphan reconciliation, and safe drain/rollback.
That burden does not end when M0 boots successfully.

## Interim production path: Blaxel bridge

Blaxel is the interim production compute path already exposed through
`SandboxProviderV1`. It serves EU workloads on an owner-accepted hardware
micro-VM isolation class while the sovereign cohort is built and qualified.
E2B remains the hardware-isolated alternate if a required Blaxel capability
cannot be supported; shared-kernel or gVisor-only providers are not eligible
for untrusted public traffic.

Provider-specific persistence is bridge state, not the product data model.
Blaxel's regular Volume may carry existing bridge sessions, but it is opaque
and temporary. Workspaces entering the durable product tier are copied into
SeaweedFS and verified by file count and content digest; after activation,
SeaweedFS is authoritative and remains in place when compute moves.

The bridge's exit criterion is the sovereign
[M0 definition of done](sandbox-sovereign-build.md#m0-definition-of-done--single-box-qualified)
being green. Meeting it starts the build plan's controlled new-session cutover;
the bridge remains the qualified rollback path through the agreed soak. The
detailed bridge capability evidence is owned by
[Gate 0](sandbox-sovereign-build.md#gate-0--feasibility-and-evidence); measured
economics remain an operating input in the
[cost model](references/sandbox-cost-model.md), not the architecture strategy.

## Cutover and rollback policy

Cutover changes only server-selected provider admission behind
`SandboxProviderV1`. It occurs only after the sovereign cohort and shared
SeaweedFS namespace pass M0, non-mutating shadow checks, two-tenant canaries,
and the agreed soak/operability gates. A live sandbox never changes provider.

Rollback stops new sovereign admission and sends new sessions to the last
qualified hardware-microVM bridge while existing sovereign sessions drain or
expire. It does not change the SeaweedFS namespace and never selects a weaker
isolation class. The executable sequence, stop conditions, evidence, and
operator runbook live only in
[Phases 5 and 6 of the build plan](sandbox-sovereign-build.md#phase-5--exact-cohort-qualification-and-rollback-proof).

## Scale boundary

The scale stage preserves `SandboxProviderV1`, the hardware-microVM isolation
class, the guest capability shape, and the SeaweedFS plain-file data plane. It
adds multi-host lifecycle, placement, drain/fencing, warm pools, block/memory
snapshot-fork, locality-aware scheduling, and automated qualification.

Cloud Hypervisor is a likely scale-stage VMM candidate but is not pre-approved.
Selecting it would be a real VMM change behind the provider boundary and would
require its own security, compatibility, migration, and rollback gate. The
product contract, storage namespace, and isolation class must not change with
it. These triggered decisions and their evidence belong only in the
[scale plan](sandbox-sovereign-scale.md).

## Open questions

- Current SeaweedFS git, pnpm, `node_modules`, and JavaScript build performance
  in the proposed production topology is **unknown**.
- SeaweedFS power-loss durability for transaction commits under the intended
  replication and filer database configuration is **unknown**.
- SQLite safety across multiple SeaweedFS mounts, even with DLM, has no
  published SQLite-specific certification or benchmark and is **unknown**.
- The performance and correctness effect of enabling SeaweedFS kernel writeback
  caching for this workload is **unknown** and carries an explicit crash-loss
  warning.
- Fly's support policy for a customer-installed object FUSE mount is
  **[unverified]**.
- Archil's SQLite locking, crash, and power-loss behavior is **[unverified]**.
- Atomic publication visibility between SeaweedFS POSIX rename and concurrent
  S3 readers under the intended gateway configuration is **[unverified]**.
- The v1 control plane and guest daemon must enforce publication safety, but
  whether teardown blocks on unpublished admitted outputs or first surfaces an
  unpublished-output state is an open mechanism choice.

## Non-goals and rejected boundaries

- Building a raw Firecracker lifecycle/fleet orchestrator for M0 instead of
  adopting Kata.
- Treating gVisor, runsc, runc, plain containers, or another shared-host-kernel
  system as the public tenant boundary. gVisor may later be evaluated inside a
  micro-VM as defense-in-depth.
- Using `microsandbox`/libkrun for escape-critical v1; the recorded seccomp,
  fuzz/CVE signal, and maturity do not meet this plan's bar.
- One standing VM per tenant/workspace.
- Waiting for Blaxel Agent Drive private preview before building SeaweedFS.
- Public exposure of the root-equivalent worker, runtime, or VMM API.
- A caller-selected image, RuntimeClass, VMM, VM spec, device, host path,
  network policy, credential scope, or qualification override.
- Periodic filesystem polling as a correctness mechanism.
- Blanket durability or synchronization of `/scratch`.
- Claiming M0 provides multi-host HA, snapshot-fork, warm pools, automated
  admission, per-write undo, or complete side-channel protection.

## Review and owner gate

PR #1220 is a docs-only owner gate and must not be merged by this plan. Owner
approval authorizes Gate 0 and implementation of the qualified bridge and
sovereign Kata/Firecracker/SeaweedFS path; it does not itself authorize
production traffic. Every implementation slice receives independent
security/spec review on its exact head SHA and must satisfy the build plan's
qualification and rollback criteria.

## Grounding

- [Technology decision record](tech-choice.md)
- [Control-plane API contract](api-spec.md)
- [Sandbox engine security evaluation](references/sandbox-engine-security-eval.md)
- [Isolation primary sources](references/isolation-choices-primary-sources.md)
- [Managed-provider comparison](references/managed-sandbox-providers-comparison.md)
- [Build-versus-adopt survey](references/build-vs-adopt-survey.md)
- [Sandbox cost model](references/sandbox-cost-model.md)
- [Storage mount performance evaluation](references/storage-mount-performance-eval.md)
- [Kata Containers virtualization matrix](https://kata-containers.github.io/kata-containers/design/virtualization/)
- [Kata Containers with Firecracker](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md)
- [SeaweedFS](https://github.com/seaweedfs/seaweedfs)
