# Sandbox Service — corrected architecture and vision

Owner correction captured 2026-08-11. This document is the architecture above
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
- **Vehicle:** E2B self-hosted infra behind SandboxProviderV1.
- **Sandbox host:** one shared EU bare-metal KVM machine; many microVMs, no
  standing per-tenant VM.
- **Management plane:** separate trusted infrastructure for the E2B API,
  client-proxy, required Redis routing catalog, Postgres, object storage,
  Nomad/Consul servers, and private wildcard DNS/TLS ingress. The sandbox host
  carries only the minimum node/client/VMM components.
- **Filesystem:** a tenant-bound durable provider volume or E2B-managed
  workspace snapshot, served through the guest fs/exec agent. No host-directory
  mount.
- **Placement:** E2B placement sees one admitted sandbox host; no Boring-owned or
  multi-host scheduler.
- **Ingress:** customers authenticate to Seneca. Seneca's trusted control plane
  reaches the worker privately; the VMM/worker API is not public.
- **Admission:** one manually qualified immutable E2B/Firecracker/kernel/template
  cohort, with all 11 existing logical hostile assertions green through a
  Firecracker/E2B driver on the exact box.
- **Rollout:** BORING_AGENT_MODE=remote-worker behind the existing provider seam,
  with drain-before-flip rollback.

Raw Firecracker orchestration is not v1. It is a fleet build, not a lean adoption.

## v2 — own and scale the same model

- **Boundary:** still one KVM microVM per sandbox on shared metal.
- **Likely VMM:** Cloud Hypervisor after a dedicated security/compatibility gate.
- **Control plane:** owned multi-host placement, draining, fencing, and recovery.
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
| Placement | E2B placement with one admitted candidate; no Boring-owned scheduler | Cohort-first owned scheduler with bin packing, anti-affinity, draining, and snapshot locality | SandboxProviderV1 backend selection |
| Backend | E2B self-hosted + Firecracker | Owned fleet, likely Cloud Hypervisor | SandboxProviderV1 |
| Guest data plane | E2B envd/guest agent serving a durable tenant workspace | Owned compatible guest agent + snapshot lifecycle | remote fs/exec semantics |

The product interface stays narrow. No caller supplies a host path, runtime
socket, template, arbitrary VM spec, device, image override, network-policy
override, or qualification bypass.

## Filesystem architecture

The prior runsc backend made a host directory authoritative and bind-mounted it
at /workspace. That is an implementation detail, not a SandboxProviderV1
requirement, and it does not transfer to Firecracker: Firecracker lacks
virtio-fs and generic host-directory sharing.

The corrected remote model makes a tenant-bound durable provider volume or
E2B-managed workspace snapshot authoritative. The active guest attaches or
restores only that workspace; its template/rootfs snapshot is not the workspace
authority. SandboxProviderV1 still presents /workspace and the same
read/write/exec semantics, but the management gateway maps those operations to
the guest agent. Initial workspace content is copied in through a bounded API;
acknowledged writes commit durably before success, and changes/final artifacts
are observed or read back through guest events or bounded polling.

Qualification proves write -> destroy -> recreate -> read and atomic recovery
to the last acknowledged generation after an interrupted commit. Any non-zero
RPO must be explicit and approved before launch.

This is why v1 selects E2B + Firecracker rather than Kata + Cloud Hypervisor:
Kata/CH would preserve the host bind with virtio-fs, but would violate the v1
Firecracker decision and pull the riskier v2 VMM forward. Kata + Firecracker is
the fallback if its block/copy path proves simpler after the E2B bare-metal gate.

No host inotify, shared plaintext workspace tree, or host path is part of the
tenant boundary. E2B's internal UFFD/NBD template restore may remain opaque in
v1; Seneca does not expose or own snapshot/fork semantics until v2.

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
3. The exact E2B/Firecracker/jailer/kernel/rootfs/guest-agent/policy cohort is
   pinned and qualified.
4. A Firecracker/E2B driver preserves all 11 logical hostile assertions, and
   egress deny, host reserve, durable workspace recovery, and cleanup pass on
   the intended box.
5. Startup fails closed on any missing, stale, or mismatched cohort fact.
6. No guest sees /dev/kvm, a host path, other-tenant data, control-plane secrets,
   customer/model credentials, or transcripts.
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
- Keep E2B API/client-proxy, Redis, Postgres, object storage, Nomad/Consul
  servers, signing roots, reusable customer secrets, model credentials, and
  transcript/session history on trusted management infrastructure, outside the
  sandbox node's guest/VMM trust domain. Keep client-proxy's wildcard DNS/TLS
  endpoint private to the gateway path.
- Store tenant bytes only in that sandbox's block/image objects and bounded
  transfer channel, never a shared host workspace tree.
- Keep microcode/core-scheduling/SMT policy in the separate side-channel
  workstream.
- Fence a host that cannot prove its admitted cohort.

## Discipline guardrail

v1 must be fast to ship, but “lean” cannot mean “software-only tenant
boundary.”

Build only:

- the private management gateway and thin SandboxProviderV1-to-E2B public-API
  adapter;
- durable tenant/workspace binding, atomic replay state, and per-tenant/global
  admission budgets;
- the durable workspace adapter and provider-neutral Firecracker qualification
  driver;
- immutable cohort admission and CI-owned pin policy;
- one-sandbox-host plus separate-management-plane provisioning/qualification;
- Seneca rollout and rollback.

Do not build:

- a raw Firecracker control plane;
- multi-host placement;
- snapshot-fork or memory restore;
- warm pools;
- snapshot-locality scheduling;
- a general E2B-compatible public API;
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
