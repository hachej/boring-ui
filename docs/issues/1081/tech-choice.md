# Sovereign Sandbox Service — corrected technology decision record

Status: DECISION RECORD. Date: 2026-08-11.
Scope: issue #1081 and PR #1220.

This record supersedes the earlier single-tenant decision that selected gVisor
for v1. Seneca is public and multi-tenant, hosts all customers' agents, and runs
untrusted code. Cross-tenant or platform escape is unacceptable.

The detailed evidence pass is
[references/sandbox-engine-security-eval.md](references/sandbox-engine-security-eval.md).
The execution plan is [plan-sbx14.md](plan-sbx14.md), the stable wire contract is
[api-spec.md](api-spec.md), and deferred fleet work is
[plan-v2-hardening.md](plan-v2-hardening.md).

## Product and security thesis

Build a sovereign sandbox service on EU-owned infrastructure under one rule:

> **Share the host, never the boundary.**

Many sandboxes share a bare-metal KVM host for density. Every sandbox receives
its own hardware-isolated microVM and guest kernel. This is not one standing VM
per tenant or workspace.

## Decision 1 — tenant boundary: Firecracker microVM per sandbox

### Question

Can gVisor on a shared host kernel remain the tenant boundary for a public
multi-tenant service?

### Evidence

[AI Code Sandboxes: A Comparative Security Study, Part 1,
arXiv:2606.08433](https://arxiv.org/abs/2606.08433) evaluates gVisor,
Firecracker/E2B, Cloud Hypervisor/arrakis, libkrun/microsandbox, and runc/Daytona.
Its engine measurements are valuable, but the paper explicitly scopes itself to
a single-tenant operator and excludes multi-tenant SaaS, orchestrator attacks,
and microarchitectural side channels.

Within that limited scope, gVisor has the best measured aggregate posture:
continuous public syzkaller coverage, mode-2 seccomp, and 5/14 reachable host
escape primitives. That result does not answer Seneca's boundary question.
gVisor's Sentry remains a software mediator on the host kernel. A Sentry escape
or reachable host-kernel exploit lands on the shared host and exposes
co-resident tenants.

Firecracker gives each sandbox a guest kernel behind KVM. The same paper measured
Firecracker with mode-2 seccomp on every VMM thread, a 55-syscall allowlist, and
7/14 reachable primitives—the strongest microVM result in the set. It also
recorded two Firecracker escape-class advisories in 2026 and no upstream fuzzer,
so “hardware boundary” is not “invulnerable.”

The production topology is consistent with OpenAI's [From fork() to Fleet:
Designing an Agent Sandbox Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk):
dense hardware-isolated agent sandboxes on shared hosts, with persistence and
fleet orchestration layered above the runtime.

### Decision

**v1 tenant boundary = one Firecracker microVM per sandbox on shared bare-metal
KVM hosts.**

No standing VM is assigned per customer. Multiple tenants' short-lived microVMs
may share a host; they never share a guest kernel or software-only tenant
boundary.

### Consequences

- gVisor, runc, namespaces, and process isolation cannot be the outer tenant
  boundary.
- /dev/kvm belongs only to the trusted VMM service and is never exposed to a
  guest.
- Firecracker CVE response, version currency, jailer hardening, and host
  qualification are launch requirements.
- Spectre/MDS-class side channels remain a separate workstream; KVM does not
  solve them.

## Decision 2 — v1 strategy: adopt Firecracker, do not build a fleet

### Question

Should v1 orchestrate raw Firecracker itself, or adopt an existing sandbox
vehicle?

### Evidence

Firecracker supplies a VMM API and jailer. It does not supply the complete
product surface Seneca needs: lifecycle placement, guest image/rootfs assembly,
guest exec/fs transport, network policy, quota wiring, recovery, draining,
version admission, and control-plane operations. Building those pieces directly
is a weeks-to-months effort and duplicates mature open-source work.

Two credible adoption vehicles remain:

1. **Kata Containers** — mature OCI/containerd integration, RuntimeClass
   switching, packaged Firecracker and Cloud Hypervisor backends, and a
   bare-metal-first operations model.
2. **E2B self-hosted infra** — a complete Firecracker sandbox control plane,
   guest agent, SDK/API, template pipeline, Nomad jobs, and Consul-backed
   orchestration. Its [architecture
   document](https://github.com/e2b-dev/infra/blob/main/docs/ARCHITECTURE.md)
   describes the control plane, Firecracker data plane, in-VM agent, and
   snapshot-backed storage. The operational cost is Nomad + Consul and a
   GCP/AWS-first deployment posture; E2B describes bare-metal Linux as planned,
   so it must be qualified rather than assumed.

### Decision

**v1 adopts E2B self-hosted infra + Firecracker behind SandboxProviderV1.**
Do not build a bespoke VMM fleet.

Estimated adoption effort: **about 2–4 elapsed weeks** for the
single-sandbox-host path, including a 2–3 day Gate 0, the provider adapter,
filesystem-semantic change, pin/admission wiring, bare-metal proof, and rollback
rehearsal. This assumes cohort build and production-management-plane
provisioning overlap S1 after Gate 0; the sequential work is about 14–24
person-days. Host procurement and owner wait time are excluded.

Kata + Firecracker is the fallback. Its honest estimate is **about 1–2 weeks**
for one box only if the product accepts block/OCI storage plus bounded
copy-in/out and does not require a live host-directory mount.

### Reasoning

E2B is the smallest choice that satisfies both non-negotiables at once:
Firecracker is the outer boundary, and an off-the-shelf guest fs/exec control
plane replaces the current host bind. SandboxProviderV1 keeps E2B-specific
lifecycle and identifiers out of Seneca.

The adapter targets E2B's supported public API/SDK surface, not its internal
orchestrator or envd protocols. The estimate is conditional on Gate 0 proving
that surface can provide the durability, recovery, and bare-metal behavior
below without forking E2B.

Nomad and Consul are operationally heavier than Kata. That cost is preferable to
quietly changing the v1 VMM to Cloud Hypervisor or building raw Firecracker
orchestration. Gate 0 must prove E2B's exact bare-metal path before the plan is
funded beyond the spike.

## Decision 3 — workspace filesystem: guest block + API, no host mount

### Question

The current runsc implementation derives a daemon-owned host directory,
bind-mounts it to /workspace, and watches the host path. Firecracker has no
virtio-fs. Is that implementation detail a provider requirement?

### Evidence

The current source is explicit:
packages/boring-sandbox/src/providers/runsc/runtime/dockerArgv.ts constructs a
host bind mount to /workspace. The remote provider deliberately ignores the
caller's host workspaceRoot and presents remote /workspace. The future FUSE
binding plan also says vanilla Firecracker cannot expose a host mount because it
lacks virtio-fs.

Kata's [virtualization
matrix](https://kata-containers.github.io/kata-containers/design/virtualization/)
documents:

- Firecracker: virtio-block, virtio-net, vsock; **no filesystem sharing**.
- Cloud Hypervisor: virtio-fs and block-backed storage.
- Kata + Firecracker requires a block device as the VM backing store; see the
  [official integration
  guide](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).

### Options

| Option | Result |
| --- | --- |
| Kata + Cloud Hypervisor + virtio-fs | Preserves the current host-dir binding and is likely a 1–2 week single-box integration, but violates the v1 Firecracker decision and adopts the riskier v2 VMM early. |
| Kata + Firecracker + block/copy | Keeps Firecracker, but requires the workspace semantic change and supplies less sandbox control-plane functionality. |
| E2B + Firecracker + guest fs/envd API | Keeps Firecracker and supplies the guest fs/exec API needed to make the semantic change behind SandboxProviderV1. |

### Decision

**The remote workspace becomes a tenant-bound durable provider volume or
E2B-managed workspace snapshot, served through the adopted guest agent.** The
active guest attaches or restores only that workspace. Initial content is
copied in over a bounded API; acknowledged writes commit to the durable
workspace before success, and mutations, events/polling, and final artifact
copy-out use the same remote contract. No host directory is mounted into the
Firecracker guest, and no host watcher is part of the security model.

The rootfs/template snapshot is not the workspace authority. Gate 0 must prove
write -> destroy -> recreate -> read and atomic recovery to the last
acknowledged workspace generation after an interrupted commit. Any non-zero RPO
must be explicit and approved before launch.

### Consequences

- Kata + Cloud Hypervisor is not the v1 answer merely because it has virtio-fs.
- Project quota on a shared host workspace is replaced by a bounded durable
  tenant workspace plus a per-microVM ephemeral overlay and
  CPU/memory/PID/output/lease/concurrency limits with a host reserve.
- The existing public SandboxProviderV1/remote-worker fs semantics remain; only
  their backend realization changes.
- Host inotify cannot be required. Use guest events or bounded polling.
- Rollback copies required artifacts out through the API before destroying a
  microVM; it does not archive a host bind-mount source.

## Decision 4 — gVisor and alternative engines

### gVisor

**Demoted to optional inner defense-in-depth.** gVisor-inside-Firecracker can
reduce the guest syscall surface while KVM remains the tenant boundary. It is
specifically worth evaluating because Firecracker has no observable upstream
fuzzing program and gVisor has continuous public syzkaller coverage. This layer
is deferred and cannot block the first correct v1.

### microsandbox/libkrun

**Evaluated and rejected for v1.** libkrun retains a real KVM boundary, but the
security study measured mode-0 seccomp across all 16 observed VMM threads and
11/14 reachable primitives. It has no documented upstream fuzzer and no useful
CVE history from which to infer residual-bug depth; the paper calls this the
riskiest residual-bug posture in the set. Pre-1.0/beta maturity makes that
uncertainty unacceptable for Seneca's escape-critical boundary.

### Cloud Hypervisor

**Likely v2 BUILD VMM, not the v1 ADOPT vehicle.** Its device model includes
virtio-fs and it carries an in-tree fuzz workspace, making it attractive when we
own the fleet. Adoption risk is higher now: the paper records a leader thread
without seccomp in the measured product, 12/14 reachable primitives in that
configuration, and Cloud Hypervisor's first escape-class advisory in 2026.
Product-specific arrakis mistakes such as guest-visible nested KVM and a
471-day-frozen pin must not be copied.

### Plain containers/runc

**Rejected as a tenant boundary.** They share the host kernel by definition; a
host-kernel escape crosses tenants.

## Decision 5 — guardrails and qualification

Changing the outer engine does not remove the existing guardrails. v1 keeps and
repoints:

- fail-closed startup on missing, stale, or mismatched cohort facts;
- immutable pins for E2B, Firecracker, jailer, guest kernel, rootfs/template,
  guest agent, network policy, and quota profile;
- egress denied by default;
- all 11 existing logical hostile assertions, run through a Firecracker/E2B
  driver against the exact box and guest template;
- no host path, runtime socket, /dev/kvm, arbitrary VM spec, image/template
  override, or qualification override on the wire;
- per-microVM CPU, memory, PID, output, block, lease, and concurrent-sandbox
  limits plus host reserve;
- authorization before effect, strict schemas/body bounds, stable redacted
  errors, startup cleanup, bounded drain, and idempotent create;
- drain-before-flip rollback with the previous provider available.

### Gate 0 correction

The old openat2 gate selected a gVisor release because runsc returned ENOSYS.
That outer-engine gate is superseded by Firecracker/E2B qualification.

The path-confinement property remains. If the existing workspace helper remains
inside the guest, qualification proves openat2 with
RESOLVE_BENEATH/RESOLVE_NO_MAGICLINKS plus traversal and symlink-race negatives.
If E2B's fs agent replaces it, the adapter must prove equivalent beneath-root
semantics and the same negatives. No realpath fallback is allowed.

Gate 0 additionally proves two concurrent tenant identities receive distinct
microVMs, guest kernels, workspace/overlay objects, network identities, and
data; all 11 logical hostile assertions pass through a Firecracker/E2B driver;
durable workspace recovery works; cleanup works across partial
E2B/Nomad/Consul failure; and no control-plane secret or other tenant data is
guest-visible.

## Decision 6 — operator ownership

### Version currency

The operator owns Firecracker updates in CI. Never accept the adopted vehicle's
default pin without checking it. The security study found the E2B default pin
399 days stale. CI detects upstream updates and reproducibly builds the
candidate cohort. v1 then runs exact-box qualification and admission manually;
v2 may automate that hardware loop. Each VMM/jailer bump requires review.

Firecracker's first two published escape-class findings in the paper's window
are explicitly tracked:

- CVE-2026-5747 — virtio-pci out-of-bounds write.
- CVE-2026-1386 — jailer symlink host-write primitive.

### Host data and secrets

E2B API/client-proxy, required Redis, Postgres, object storage, and Nomad/Consul
servers live on trusted management infrastructure rather than in the sandbox
node's guest/VMM trust domain. The node contains no reusable customer/API
secrets, model-provider credentials, or transcript/session store. There is no
shared host workspace directory containing multiple tenants' plaintext. Each
jailer chroot can reach only its sandbox's block/image objects and bounded
transfer channel.

### Side channels

Microarchitectural leakage is outside the paper's scope and outside KVM's
guarantee. CPU microcode, core scheduling/sibling isolation, host cohort
selection, and measurement are a separate workstream. They are recorded and may
fence a cohort; they are never described as Firecracker protections.

## Decision 7 — control-plane seam and hosting

The stable application seam remains SandboxProviderV1 and the remote-worker V1
verbs. v1 adds a thin adapter from that contract to E2B's supported public
API/SDK; E2B owns its internal orchestrator/envd routing. Seneca does not expose
E2B's general template or VM-spec API.

Customers reach Seneca's public multi-tenant application. Seneca's trusted
control plane reaches the worker over private ingress with request-bound
authorization. The root-equivalent VMM/worker API is never a public customer
endpoint.

v1 runs its sandbox data plane on one EU bare-metal KVM host. E2B placement has
one admitted candidate; there is no Boring-owned or multi-host scheduler.
Trusted management infrastructure separately runs the E2B API, client-proxy,
required Redis routing catalog, Postgres, object storage, Nomad/Consul servers,
and private wildcard DNS/TLS ingress needed by the qualified deployment. The
sandbox node keeps only the minimum
node/client/VMM components and no signing roots, reusable customer secrets, or
other-tenant plaintext. This is shared metal, not one standing VM per customer.
A second sandbox host, real scheduler, or automatic admission is v2.

## Decision 8 — v1 to v2

Because v1 already uses a KVM microVM per sandbox behind SandboxProviderV1, v2 is
not a shared-kernel-to-hardware migration. It is an adopted-control-plane to
owned-fleet transition. The app-facing contract, guest-agent shape, isolation
class, and durable workspace API semantics remain stable.

v2 likely uses Cloud Hypervisor. If so, the VMM binary changes, but the boundary
architecture does not: one hardware microVM per sandbox on shared metal. The VMM
change receives its own qualification and CVE-response gate.

E2B may internally use opaque UFFD/NBD template restore in v1; that is an
adopted implementation detail, not a Seneca snapshot product or an owned fleet
primitive. The owned density optimizations are deliberately deferred:

- block-level incremental snapshot/fork;
- memory snapshot/restore;
- warm pools;
- snapshot-locality-aware scheduling;
- multi-host bin packing, draining, and eviction;
- unattended cohort admission and requalification;
- optional gVisor inside the microVM.

This follows the design progression in OpenAI's [From fork() to Fleet
talk](https://www.youtube.com/watch?v=OqM67QG_Ikk): establish the secure runtime,
then use Rust VMMs including Cloud Hypervisor, block-level incremental
persistence, and snapshot-locality-aware fleet orchestration. See
[plan-v2-hardening.md](plan-v2-hardening.md).

## Decisions at a glance

| # | Question | Corrected choice |
| --- | --- | --- |
| 1 | Tenant boundary | Firecracker microVM per sandbox; shared host, never shared boundary |
| 2 | v1 build/adopt | ADOPT E2B self-hosted + Firecracker; no bespoke VMM fleet |
| 3 | Workspace filesystem | Durable tenant volume/snapshot through fs API; no host directory mount |
| 4 | Other engines | gVisor optional inside FC; libkrun rejected; Cloud Hypervisor likely v2 |
| 5 | Guardrails | Fail closed, egress deny, 11 probes, no host paths, quota, rollback |
| 6 | Operator ownership | CI-owned VMM pins; sterile hosts; side channels separate |
| 7 | Seam/hosting | SandboxProviderV1; one EU sandbox host plus separate trusted management plane |
| 8 | v2 | Owned fleet + snapshot/fork/locality; same isolation architecture |

## Sources

- [Andronchik and Lokhmakov, AI Code Sandboxes: A Comparative Security Study,
  Part 1, arXiv:2606.08433](https://arxiv.org/abs/2606.08433).
- [OpenAI / Abhishek Bhardwaj, From fork() to Fleet: Designing an Agent Sandbox
  Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk); [conference
  listing](https://aie-wf.sentry.dev/talks/aiewf-201-from-fork-to-fleet-designing-an-agent-sandbox-cl).
- [E2B infrastructure architecture](https://github.com/e2b-dev/infra/blob/main/docs/ARCHITECTURE.md).
- [Kata Containers virtualization matrix](https://kata-containers.github.io/kata-containers/design/virtualization/).
- [Kata Containers with Firecracker](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).
- [Local security evaluation](references/sandbox-engine-security-eval.md).
