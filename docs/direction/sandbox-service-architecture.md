# Sandbox Service — corrected architecture and vision

Owner correction captured 2026-08-12. This document is the architecture above
the SBX1.4 execution plan in
[docs/issues/1081/plan-sbx14.md](../issues/1081/plan-sbx14.md).

Precedence: owner > DIRECTION.md > this file > issue plan folders.

Grounding lives in
[docs/issues/1081/references/](../issues/1081/references/), especially the
[multi-tenant security
evaluation](../issues/1081/references/sandbox-engine-security-eval.md). The
technology decision record is
[tech-choice.md](../issues/1081/tech-choice.md), and the stable wire surface is
[api-spec.md](../issues/1081/api-spec.md).

## Thesis

Seneca is a public, multi-tenant service that runs untrusted customer agent code.
The sandbox platform therefore follows one rule:

> **Share the host, never the boundary.**

Many short-lived sandboxes pack onto one EU bare-metal KVM host. Every sandbox
has its own hardware microVM and guest kernel. We explicitly reject one standing
VM per workspace/tenant; the unit of isolation is the active sandbox.

## Threat model

Protect:

- one tenant from another tenant's code and data;
- the shared sandbox host from guest code;
- the control plane and whole platform from a sandbox escape;
- secrets, transcripts, and workspace artifacts from cross-tenant disclosure;
- host availability through bounded resource use and cleanup.

Assume sandbox code is malicious and may exploit the guest kernel, runtime,
filesystem, network, and workload dependencies. A guest-kernel compromise must
still face the KVM/VMM boundary.

Do not claim KVM solves:

- a compromised control plane or stolen host authority;
- VMM/KVM escape vulnerabilities;
- Spectre/MDS-class microarchitectural side channels;
- abuse once network egress is intentionally allowed.

Those risks receive explicit operator controls or separate workstreams.

## v1 — adopt a correct boundary quickly

- **Boundary:** one Firecracker microVM per sandbox.
- **Vehicle:** Kata Containers + Firecracker behind SandboxProviderV1.
  Firecracker is the engine/hardware boundary; Kata is only the adopted
  containerd runtime wrapper that launches it from OCI images.
- **Sandbox host:** one shared EU bare-metal KVM machine; many microVMs, no
  standing per-tenant VM.
- **Management plane:** the private gateway, durable authorization/binding state,
  and scoped S3 credential issuer. The sandbox host carries only containerd,
  Kata, and Firecracker/jailer; each guest contains its agent and S3 sync bridge.
- **Storage:** a per-tenant S3 bucket/prefix is the user-readable durable system
  of record. The guest runs on a local POSIX disk with lazy-in/flush-out sync;
  transient inputs use copy-in and no host directory is mounted.
- **Placement:** the provider sees one admitted sandbox host; no Boring-owned or
  multi-host scheduler.
- **Ingress:** customers authenticate to Seneca. Seneca's trusted control plane
  reaches the worker privately; the VMM/worker API is not public.
- **Admission:** one manually qualified immutable Kata/Firecracker/kernel/OCI-image
  cohort, with all 11 existing logical hostile assertions green through a
  Firecracker/Kata driver on the exact box.
- **Rollout:** BORING_AGENT_MODE=remote-worker behind the existing provider seam,
  with drain-before-flip rollback.

Raw Firecracker orchestration is not v1. It is a fleet build, not a lean adoption.

## v2 — own and scale the same model

- **Boundary:** still one KVM microVM per sandbox on shared metal.
- **Likely VMM:** Cloud Hypervisor after a dedicated security/compatibility gate.
- **Control plane:** adopt E2B's snapshot-fork engine or build an owned multi-host
  placement, draining, fencing, and recovery plane.
- **Density:** block-level snapshot-fork, memory restore, warm pools, and
  snapshot-locality-aware scheduling.
- **Admission:** protected CI owns VMM/kernel/template bumps and continuously
  qualifies candidate host cohorts.
- **Hardening:** optional gVisor inside the microVM; KVM remains the outer
  boundary.

If Cloud Hypervisor replaces Firecracker, the VMM binary changes but the
isolation architecture and application contract do not. The v1-to-v2 transition
is an adopted-control-plane to owned-fleet transition, not a late migration from
a shared host kernel to a hardware boundary.

This sequence follows OpenAI's [From fork() to Fleet: Designing an Agent Sandbox
Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk): establish the isolated
runtime, then use Rust VMMs including Cloud Hypervisor, block-level incremental
persistence, and locality-aware orchestration.

## Four layers

| Layer | v1 | v2 | Stable seam |
| --- | --- | --- | --- |
| Control-plane API | Existing strict remote-worker V1 verbs and request-bound authorization | Multi-host/fleet operations remain behind the same external verbs | api-spec.md |
| Placement | One admitted Kata/Firecracker host; no Boring-owned scheduler | E2B snapshot-fork adoption or cohort-first owned scheduler with bin packing, anti-affinity, draining, and snapshot locality | SandboxProviderV1 backend selection |
| Backend | Kata runtime wrapper + Firecracker engine | Snapshot-aware fleet, likely Cloud Hypervisor if owned | SandboxProviderV1 |
| Guest data plane | Local POSIX disk + S3 sync-hybrid; copy-in transient files | Compatible guest agent + snapshot lifecycle; S3 remains the tenant data record | remote fs/exec semantics |

The product interface stays narrow. No caller supplies a host path, runtime
socket, template, arbitrary VM spec, device, image override, network-policy
override, or qualification bypass.

## Storage and file-transfer architecture

The prior runsc backend made a host directory authoritative and bind-mounted it
at /workspace. That is an implementation detail, not a SandboxProviderV1
requirement, and it does not transfer to Firecracker: Firecracker lacks
virtio-fs and generic host-directory sharing.

The corrected remote model makes a per-tenant S3 bucket/prefix authoritative.
It stores plain files that users can inspect and sync through ordinary S3 tools,
with object versioning as visible history and audit trail. An admitted
EU-sovereign object store keeps bytes inside the declared perimeter.

The active guest runs git, SQLite, and builds on a fast local ext4/xfs disk. A
sync-hybrid bridge hydrates lazily and flushes on write, checkpoint, and session
end. One durable writer lease exists per tenant/workspace; concurrent sessions
must serialize or fail with a stable conflict rather than publish mixed or
last-writer-wins checkpoints. Transient files are copied into the guest through
the bounded API.

Qualification proves write/checkpoint -> destroy -> recreate -> read, object
version visibility, interrupted-flush recovery, and writer-lease conflict
behavior. Any non-zero RPO must be explicit and approved before launch.

Naive s3fs execution is rejected because object storage is not fully POSIX.
Opaque volume snapshots are rejected because users cannot directly access their
files. POSIX-over-S3 chunk stores such as JuiceFS are rejected because ordinary
S3 clients see chunks, not user files.

No host inotify, shared plaintext workspace tree, or host path is part of the
tenant boundary. A virtio-fs/9p mount would be a live cross-boundary channel,
expanding escape and path-traversal surface; copy-in removes that channel and
keeps Firecracker viable. E2B snapshot-fork adoption is a v2 decision.

## Engine roles

### Firecracker

Required v1 outer boundary. It has the strongest measured microVM seccomp posture
in [arXiv:2606.08433](https://arxiv.org/abs/2606.08433), but it is not treated as
invulnerable: it had its first two escape-class advisories in 2026 and has no
observable upstream fuzzing program.

### gVisor

Not a tenant boundary for Seneca. It shares the host kernel through the Sentry
mediator and the cited paper's favorable verdict is explicitly single-tenant in
scope. Its valid role is optional syscall-surface defense inside a hardware
microVM.

### microsandbox/libkrun

Rejected for escape-critical v1 despite keeping KVM. Its mode-0 seccomp,
11/14 reachable primitives, absent fuzz/CVE signal, and pre-1.0 maturity create
the weakest residual-bug posture among the evaluated KVM choices.

### Cloud Hypervisor

Likely owned-fleet v2 VMM because of its device model, virtio-fs option, and
in-tree fuzz workspace. It is not pre-approved: its escape advisory, measured
seccomp gap, and any nested-KVM/product defaults require a fresh qualification.

## Launch invariants

Before public multi-tenant customer code runs:

1. One sandbox creates one distinct Firecracker microVM and guest kernel.
2. Two-tenant negatives prove separate block devices, network identities,
   quotas, data, and teardown.
3. The exact Kata/Firecracker/jailer/kernel/OCI-image/guest-agent/sync/policy cohort is
   pinned and qualified.
4. A Firecracker/Kata driver preserves all 11 logical hostile assertions; S3-only
   egress, host reserve, scoped-credential expiry, sync recovery, single-writer
   conflicts, pool/idle-TTL behavior, and cleanup pass on the intended box.
5. Startup fails closed on any missing, stale, or mismatched cohort fact.
6. No guest sees /dev/kvm, a host path, other-tenant data, control-plane secrets,
   reusable customer/model credentials, or transcripts. A guest sees only an
   expiring credential for its own S3 bucket/prefix.
7. CPU, memory, PID, output, disk/block, lease, and concurrent-sandbox ceilings
   are enforced before code runs.
8. Rollback drains and destroys live microVMs before the provider flip and
   copies required artifacts out through the bounded API.
9. Firecracker version bumps are owned in CI; a vehicle's frozen pin is never
   inherited silently.
10. Side-channel posture is recorded per hardware cohort without being
    misrepresented as a KVM guarantee.

## Operator ownership

The adopted vehicle does not own our risk decisions.

- Track Firecracker and jailer advisories, including CVE-2026-5747 and
  CVE-2026-1386.
- Detect and reproducibly build every VMM, jailer, kernel, rootfs, guest-agent,
  microcode, network-policy, or quota-policy change in CI. v1 exact-box
  qualification and admission remain manual; v2 may automate them.
- Keep signing roots, reusable customer secrets, model credentials, durable
  authorization state, and transcript/session history on trusted management
  infrastructure, outside the sandbox node's guest/VMM trust domain.
- Store durable tenant bytes in that tenant's S3 bucket/prefix. Local block
  backing is per-microVM, encrypted or ephemeral, never a shared plaintext host
  workspace tree, and reclaimed after successful flush and teardown.
- Keep microcode/core-scheduling/SMT policy in the separate side-channel
  workstream.
- Fence a host that cannot prove its admitted cohort.

## Discipline guardrail

v1 must be fast to ship, but “lean” cannot mean “software-only tenant
boundary.”

Build only:

- the private management gateway and thin SandboxProviderV1-to-Kata/containerd
  adapter;
- durable tenant/workspace binding, atomic replay state, and per-tenant/global
  admission budgets;
- the S3 sync-hybrid adapter and provider-neutral Firecracker qualification
  driver;
- immutable cohort admission and CI-owned pin policy;
- one sandbox host plus S3 endpoint and management-gateway qualification;
- Seneca rollout and rollback.

Do not build:

- a raw Firecracker control plane;
- multi-host placement;
- snapshot-fork or memory restore;
- warm pools;
- snapshot-locality scheduling;
- E2B self-hosted control-plane operations or a general E2B-compatible public API;
- one standing VM per tenant.

Those fleet optimizations live in
[plan-v2-hardening.md](../issues/1081/plan-v2-hardening.md).

## Sovereignty

Execution runs on operator-controlled Swiss/EU bare metal. The sovereignty
claim is stronger when the hardware boundary is correct: customers share our
host capacity without sharing a kernel-level tenant boundary.

v1 proves the path on one host. v2 scales it across an owned fleet. Enterprise
deployment may place the same stack on customer-owned metal without changing
the app-facing SandboxProviderV1 contract.
