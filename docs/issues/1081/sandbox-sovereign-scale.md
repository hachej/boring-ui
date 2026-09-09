---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: deferred-triggered
updated: 2026-08-13
revision: r5-sovereign-scale
track: owner
---

# gh-1081 — sovereign sandbox scale plan

> Companion to the [sovereign design](sandbox-sovereign-design.md). M0 already
> uses one hardware microVM per sandbox through an adopted Firecracker vehicle.
> The scale stage owns and scales
> that architecture; it does not introduce the tenant boundary for the first
> time.

## Boundary carried forward from v1

The invariant remains:

> **Share the host, never the boundary.**

Many sandboxes share bare-metal hosts. Each sandbox has its own KVM microVM and
guest kernel. v2 never regresses to gVisor, runc, namespaces, or process
isolation as the outer tenant boundary, and it never turns into one standing VM
per workspace/tenant.

SandboxProviderV1 remains the application seam. M0 uses Kata as the containerd
runtime wrapper around the Firecracker engine on one admitted host. The scale
target is the sovereign multi-host fleet, likely using Cloud Hypervisor after
qualification. The earlier E2B adoption option remains useful reference
material and a hardware-isolated alternate, but is not the sovereign target.
The public wire contract, guest-agent shape, hardware isolation class, and
tenant-readable S3 data substrate remain stable.

If v2 chooses Cloud Hypervisor, the VMM binary changes from Firecracker, but the
security architecture does not: one hardware-isolated microVM per sandbox on
shared metal. That VMM change has its own qualification and rollback gate.

## Why this work is v2

Raw VMM fleet engineering is a weeks-to-months program: snapshot formats,
memory restore, block overlays, host lifecycle, placement, locality, draining,
admission, and recovery all interact. None is required to establish a correct
hardware boundary on one host. M0 therefore adopts Kata rather than building a
raw VMM control plane; the scale stage builds fleet machinery only after real
load supplies capacity and latency targets.

Block/memory snapshots in the sovereign fleet accelerate ephemeral working-state
fork/restore. They do not replace the per-tenant S3 bucket/prefix as durable
system of record or reintroduce opaque volume snapshots as the user data product.

The production reference is OpenAI's [From fork() to Fleet: Designing an Agent
Sandbox Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk) ([conference
listing](https://aie-wf.sentry.dev/talks/aiewf-201-from-fork-to-fleet-designing-an-agent-sandbox-cl)):
start from a hardware-isolated runtime, use Rust VMMs including Cloud Hypervisor,
add block-level incremental persistence, and schedule a fleet with snapshot
locality. The local security baseline remains
[arXiv:2606.08433](https://arxiv.org/abs/2606.08433), re-weighted for Seneca's
multi-tenant threat model.

## v2.1 — VMM and fleet control-plane spike

**Trigger:** sovereign M0 and its production soak are green; a second host or measured
start/density target justifies owned orchestration.

Evaluate Firecracker and Cloud Hypervisor on the exact intended hardware:

- guest-to-host attack surface and per-thread seccomp;
- current escape CVEs and patch cadence;
- fuzz harnesses and whether they execute continuously;
- boot/restore latency and idle memory;
- block overlay and memory snapshot formats;
- vsock guest-agent behavior;
- virtio-fs only if a new requirement justifies host sharing;
- host service/jailer boundaries and no guest /dev/kvm;
- upgrade, drain, rollback, and snapshot compatibility.

**Likely decision:** Cloud Hypervisor for the owned v2 fleet. It has the device
model and in-tree fuzz workspace we want when building orchestration, but it is
not pre-approved. Its first escape-class advisory, the measured leader-thread
seccomp gap, and any product-specific nested-KVM exposure must be resolved in the
candidate configuration.

Output is a go/no-go ADR with an exact version, threat analysis, measured
benchmarks, and rollback plan. No production VMM switch happens in the spike.

## v2.2 — block and memory snapshot-fork

**Trigger:** cold-create latency or repeated environment setup materially limits
capacity or user experience.

Build immutable golden guest images, then fork sandbox state with copy-on-write
storage:

1. Boot and qualify a golden kernel/rootfs/guest-agent cohort.
2. Capture a versioned base block snapshot.
3. Create a per-sandbox copy-on-write block overlay.
4. Optionally capture/restore guest memory after the image is quiesced.
5. Bind every snapshot to the exact VMM, kernel, guest agent, policy, and base
   block digest.
6. Reject restore across incompatible cohort versions.
7. Destroy overlays and memory state on lease expiry unless an explicit
   persistence policy retains them.

Security requirements:

- no snapshot may contain control-plane or other-tenant secrets;
- snapshot IDs are opaque and tenant-bound;
- copy-on-write backing paths are never guest-selectable;
- a sandbox cannot attach a sibling tenant's base or overlay;
- snapshot parsing/restore runs inside the same admitted VMM/service boundary;
- rollback can disable restore and cold-boot the last known-good cohort.

This is block-level snapshot-fork, not host-directory cloning.

## v2.3 — warm pools

**Trigger:** snapshot restore alone does not meet measured p95 create latency.

Maintain a bounded pool of already-booted, unassigned microVMs per admitted
cohort. Warm instances contain only public/base image state—never prior tenant
workspace data, credentials, memory, or network identity.

Allocation must atomically assign fresh:

- sandbox and tenant identity;
- copy-on-write block overlay;
- network namespace/address and egress policy;
- quota/lease;
- guest-agent session secret.

Sanitization failure destroys the microVM. No warm instance returns to the pool
after tenant code executes.

## v2.4 — snapshot-locality-aware scheduling

**Trigger:** box #2 or remote snapshot fetch becomes a meaningful latency/cost
driver.

Introduce the real placement interface behind SandboxProviderV1. Candidate hosts
are filtered by hard security/admission requirements first, then ranked by:

1. compatible admitted cohort;
2. local base block snapshot and memory image;
3. available CPU, memory, disk IOPS, network, and sandbox slots;
4. tenant anti-affinity and failure-domain policy;
5. drain/maintenance state.

Snapshot locality is an optimization, never authorization. A host without the
right security cohort is ineligible even if it has the snapshot. Scheduling must
not leak snapshot presence or another tenant's activity to callers.

The v1 constant one-host config is removed only when this interface lands.

## v2.5 — multi-host lifecycle

**Trigger:** box #2.

Add:

- host registration with attested/admitted cohort facts;
- placement, bin packing, anti-affinity, drain, eviction, and retry;
- idempotent create across control-plane failover;
- orphan and leaked-block reconciliation;
- bounded retry that cannot create duplicate live sandboxes;
- explicit host fencing on drift or critical VMM/kernel advisories;
- disaster recovery that never restores a tenant onto an incompatible cohort.

Nomad/E2B remains reference material, not an inherited security authority.
Upstream tracking and maintenance cost are explicit outputs of the v1 adoption
retro before fleet code is written.

## v2.6 — automated qualification and version ownership

**Trigger:** more than one host, unattended admission, or a VMM/kernel security
update.

Promote the manual v1 admission into protected CI:

- build the immutable VMM/jailer/kernel/rootfs/guest-agent/policy cohort;
- run all 11 logical hostile assertions through the owned-fleet driver on
  candidate hardware;
- run two-tenant isolation and no-host-path/no-secret negatives;
- verify egress deny, quota/host reserve, cleanup, and partial-failure behavior;
- record microcode and the separate side-channel cohort posture;
- sign/admit the exact evidence and fence stale hosts;
- rehearse rollback to the last known-good cohort.

The operator owns Firecracker/Cloud Hypervisor version bumps. Vendor defaults
are inputs, never policy. CI must catch a stale inherited pin; the 399-day E2B
default freeze documented in the security evaluation is the failure mode.

## v2.7 — optional gVisor inside the microVM

**Trigger:** the outer microVM fleet is stable and measurement shows the
compatibility/performance cost is acceptable.

Evaluate gVisor inside each microVM as defense-in-depth. The motivation is
Firecracker's lack of an observable upstream fuzzer and gVisor's continuous
public syzkaller coverage. KVM remains the tenant boundary; disabling the inner
layer cannot silently downgrade isolation.

Qualification must cover workload compatibility, I/O overhead, nested failure
modes, patch ownership, and the same 11 probes. This is optional hardening, not a
substitute for VMM CVE response.

## Separate side-channel workstream

Spectre/MDS-class cross-tenant leakage is not solved by the VMM and was out of
scope for arXiv:2606.08433. Track separately:

- supported CPU cohorts and current microcode;
- core scheduling or SMT sibling isolation;
- host kernel mitigations and measurable performance cost;
- placement constraints for higher-risk tenants;
- regression measurement and incident response.

This work may fence hardware from the fleet. It is not folded into a claim that
“KVM solved side channels.”

## Stable control-plane baseline

Authentication, durable replay defense, tenant/workspace binding, per-tenant
fairness, secret placement, and the two-tenant wire-path guarantees already
belong to the [design](sandbox-sovereign-design.md#tenant-boundary-and-guarantees)
and [API contract](api-spec.md#authentication-replay-and-tenant-fairness).
Scale work may replace their implementations but cannot defer or weaken their
properties.

## Migration and rollback

1. Add the owned fleet as a new backend behind SandboxProviderV1.
2. Qualify it independently while v1 Kata/Firecracker remains active.
3. Route owner canaries, then a bounded tenant cohort; never move a live
   sandbox across backends.
4. Copy workspace artifacts through the existing bounded API or restore a
   cohort-compatible snapshot; do not mount v1 host paths.
5. On failure, stop new v2 admission, drain/destroy v2 microVMs, and route new
   sessions to the admitted v1 backend.
6. Retire v1 only after capacity, isolation, cleanup, patch, and rollback
   evidence are green for the owner-approved soak.

## v2 exit criteria

- The owned fleet preserves one microVM per sandbox and passes the exact
  cross-tenant/11-probe qualification on every admitted cohort.
- Snapshot-fork cannot attach or reveal another tenant's block or memory state.
- Warm pools contain no tenant state before assignment and never recycle a
  tenant-used VM.
- Placement enforces cohort admission before locality/cost.
- Critical VMM/kernel advisories automatically fence affected hosts.
- Rollback to the adopted v1 provider is rehearsed and leaves no live orphan or
  unowned block state.
- Side-channel posture is documented per hardware cohort without being
  misrepresented as a KVM guarantee.
