# Sandbox Service — sovereign architecture direction

Updated 2026-08-13. The target architecture is the sovereign sandbox described
in [the design](../issues/1081/sandbox-sovereign-design.md). The
[build plan](../issues/1081/sandbox-sovereign-build.md) owns implementation and
proof; the [scale plan](../issues/1081/sandbox-sovereign-scale.md) owns work
beyond the first qualified box.

Precedence: owner > DIRECTION.md > this file > issue plan folders.

## Direction

Seneca is building its own sandbox fleet on operator-controlled infrastructure
in an approved EU region. It runs untrusted customer agent code in one
hardware-isolated micro-VM per sandbox and stores durable workspace files in
self-hosted SeaweedFS. The system stays behind the existing
`SandboxProviderV1` application seam.

> **Share the host, never the boundary.**

Many active sandboxes share a bare-metal KVM host for density. Each sandbox has
its own Firecracker micro-VM, guest kernel, networking, devices, credentials,
provider handle, file namespace, and resource limits. Kata Containers is the
adopted OCI/containerd wrapper that launches the pinned Firecracker VMM; it is
not the isolation boundary. A standing VM per tenant/workspace is not the
model.

The guest never receives `/dev/kvm`, a runtime socket, a host workspace path,
another tenant's device or credential, or control-plane signing authority.
Transient files use bounded archive copy-in, not a host bind-mount. Network is
denied by default except for the admitted SeaweedFS endpoint, and provider
admission fails closed on missing or mismatched cohort facts.

## Data plane

Self-hosted SeaweedFS holds one tenant-scoped plain-file namespace exposed in
two ways:

- durable POSIX/FUSE at `/workspace` inside the micro-VM;
- S3 for direct customer access, export, and external file changes.

`/scratch` is a separate quota-bound ephemeral per-VM device for
git, SQLite, packages, builds, and other high-churn work. Its backing may also
be encrypted, but it is always discarded at teardown and becomes durable only
through explicit publication to `/workspace`.

Guest inotify and SeaweedFS/S3 notifications feed the provider's live watch
stream with deduplication, a monotonic cursor, and event-gap reconciliation.
Polling is not a correctness path.

V1 has **no S3 versioning** by owner ruling on 2026-08-12. Versioning returns
only if a compliance or undo-agent-changes requirement demands it. A
destructive overwrite has no object-history recovery in v1; backup/restore is
required for service durability but is not per-write undo.

## Sovereignty and honest limits

The qualified claim is concrete: compute runs on operator-controlled EU bare
metal, durable workspace bytes run in the operator's EU SeaweedFS perimeter,
control-plane signing and reusable customer/model credentials stay off the
sandbox host, and each guest receives only a short-lived credential for its
own storage prefix.

The exact country/data center, legal hardware ownership language, durable-data
encryption/KMS custody, and full contractual residency perimeter are not yet
selected in these documents and must not be implied. KVM also does not
eliminate VMM escapes, control-plane compromise, intentionally allowed egress,
or Spectre/MDS-class side channels.

M0 is one exact qualified box, suitable for qualification and trusted canaries;
it is not multi-host or HA public-production readiness. Multi-host lifecycle,
placement and drain, warm pools, block/memory snapshot-fork,
snapshot-locality-aware scheduling, and automated qualification are scale
work. Owning the service permanently includes hardware capacity and
replacement, patch and supply-chain ownership, storage backup/restore,
credential operations, monitoring, incident response, and safe drain/rollback.

## Interim production path

Blaxel is the current interim production compute path through
`SandboxProviderV1`. Its owner-accepted hardware-microVM class serves EU
workloads only while the sovereign cohort is built and qualified. E2B remains
the hardware-isolated alternate if Blaxel misses a required provider
capability; weaker isolation classes do not receive untrusted public traffic.

Blaxel Volume is temporary, opaque bridge state. SeaweedFS is the product data
plane: files are copied into it and verified by file count and content digest
before a workspace changes compute provider.

The bridge's exit criterion is the sovereign
[M0 definition of done](../issues/1081/sandbox-sovereign-build.md#m0-definition-of-done--single-box-qualified)
being green. Meeting it starts the build plan's controlled new-session cutover;
the bridge remains the qualified rollback provider through the agreed soak. A
live sandbox never changes provider, rollback never chooses a weaker boundary,
and provider changes never reformat or move the SeaweedFS namespace.

## Stable seams and scale

`SandboxProviderV1` continues to own create, bounded exec and files, live watch,
suspend/resume, idempotent destroy, qualification facts, and usage metering.
The trusted control plane owns authentication, authorization, durable replay
defense, tenant fairness, admitted provider configuration, and scoped storage
credential issuance.

The scale stage preserves this provider contract, the hardware-microVM
isolation class, the guest capability shape, and the SeaweedFS plain-file data
model. Cloud Hypervisor is only a likely scale-stage VMM candidate; it requires
its own qualification and rollback gate and is not pre-approved.

Grounding and decision rationale live in the
[technology record](../issues/1081/tech-choice.md),
[API contract](../issues/1081/api-spec.md), and
[background research](../issues/1081/references/).
