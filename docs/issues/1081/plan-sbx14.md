---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-11
revision: r3-hardware-boundary-v1
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — SBX1.4 public multi-tenant sandbox plan (LEAN V1)

> This is the execution plan for PR #1220. It supersedes the single-tenant
> gVisor plan. The API contract remains in [api-spec.md](api-spec.md), the
> technology rationale is in [tech-choice.md](tech-choice.md), and deferred
> fleet work is in [plan-v2-hardening.md](plan-v2-hardening.md).

## Correction and outcome

The prior plan assumed Seneca was a Tailscale-private, single-tenant service and
treated gVisor on a shared host kernel as the tenant boundary. That threat model
was wrong. Seneca is public and multi-tenant; it runs untrusted customer agent
code, and a sandbox escape must not become a cross-tenant or whole-platform
compromise.

The corrected v1 ships one sandbox as one Firecracker microVM on a shared
bare-metal KVM host. Many short-lived microVMs pack densely on that host. We do
not provision one standing VM per workspace or tenant.

The governing model is:

> **Share the host, never the boundary.**

A sandbox gets its own guest kernel and hardware KVM boundary. The host is shared
for density; the security boundary is not. Seneca continues to use the existing
remote-worker wire contract through SandboxProviderV1, so the control plane can
change without changing the app-facing runtime contract.

The primary security evidence is [Andronchik and Lokhmakov,
arXiv:2606.08433](https://arxiv.org/abs/2606.08433). Its engine measurements are
useful, but its stated threat model is single-tenant and explicitly excludes
multi-tenant SaaS. Its top-line gVisor result therefore cannot authorize gVisor
as Seneca's tenant boundary. The OpenAI talk [From fork() to Fleet: Designing an
Agent Sandbox Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk) is the
production-shape reference: hardware-isolated per-sandbox microVMs packed on
shared hosts, with persistence and fleet scheduling layered above the runtime.

## Non-negotiable isolation model

```text
Seneca public edge / trusted control plane
        |
        | private ingress + request-bound authorization
        v
trusted management gateway + E2B control-plane services
        |
        | admitted lifecycle/fs/exec operations only
        v
shared bare-metal KVM host
        |
        +-- sandbox A -> Firecracker microVM A -> guest kernel A -> workspace A
        +-- sandbox B -> Firecracker microVM B -> guest kernel B -> workspace B
        +-- sandbox C -> Firecracker microVM C -> guest kernel C -> workspace C
```

The following are invariants, not future hardening:

1. One admitted sandbox maps to one Firecracker microVM. Containers, gVisor, and
   process isolation may exist inside that VM, but none is the tenant boundary.
2. No standing VM is assigned per tenant or workspace. MicroVMs are created for
   active sandboxes, expired or destroyed at lease end, and densely co-resident
   on the same metal.
3. A guest-kernel compromise remains inside that microVM unless it also exploits
   KVM/VMM or a host-side device/service boundary.
4. The host exposes no raw Docker/containerd socket, host path, /dev/kvm,
   qualification override, or arbitrary VM specification through the wire API.
5. E2B API/client-proxy, required Redis, Postgres, object storage, and
   Nomad/Consul servers run on trusted management infrastructure, not inside the
   sandbox host's guest/VMM trust domain. The sandbox node carries no reusable
   customer/API secrets. Each jailer chroot can reach only its sandbox's
   block/image objects; no shared host workspace tree or sibling tenant block
   is projected into it.
6. Egress is denied by default and resource ceilings apply before untrusted code
   starts.

This is not VM-per-tenant. It is microVM-per-sandbox on shared metal.

## v1 technology choice: adopt Firecracker, do not build a VMM fleet

Raw Firecracker is a VMM, not a sandbox product. Building lifecycle
orchestration, image/rootfs assembly, guest exec/fs transport, networking,
cleanup, and recovery directly on its API is a weeks-to-months fleet project.
That work belongs in v2.

v1 adopts an off-the-shelf Firecracker vehicle behind SandboxProviderV1.

### Filesystem constraint from the existing design

The current runsc backend derives a daemon-owned host directory, bind-mounts it
at /workspace, and watches that directory. That is a property of the runsc
implementation, not of SandboxProviderV1 or the remote binding contract: the
remote provider already ignores the caller's host workspaceRoot and exposes a
provider-owned /workspace. The optional future FUSE design would add a host-mount
requirement, but it is not a v1 prerequisite.

Firecracker supports virtio-block, virtio-net, and vsock, but not virtio-fs or
generic host-directory sharing. Kata documents the same limitation: its
Firecracker backend requires block-backed storage and has no filesystem sharing,
whereas its Cloud Hypervisor backend supports virtio-fs. See the [Kata
virtualization matrix](https://kata-containers.github.io/kata-containers/design/virtualization/)
and [Kata + Firecracker guide](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).

The v1 decision is to implement the already-provider-opaque contract with a
tenant-bound durable provider volume (or E2B-managed workspace snapshot) as the
authoritative workspace. The active Firecracker guest attaches/restores only
that workspace and serves fs/exec through E2B's guest agent. An acknowledged
write is durably committed before success; destroy/recreate must preserve it.
Initial import and final artifact export use the bounded management gateway.
There is no host-dir mount or host watcher; event delivery uses guest events or
bounded polling.

That decision is deliberate: it preserves Firecracker as the v1 hardware
boundary and removes host-path projection from the design.

### Vehicle evaluation and pick

| Vehicle | VMM | Filesystem fit | Ops fit | Honest v1 estimate | Decision |
| --- | --- | --- | --- | --- | --- |
| Kata Containers | Firecracker | Block/OCI only; no live host directory | Bare-metal-first, OCI/containerd-native, RuntimeClass switch | about 1–2 weeks for a single box if copy-in/out is accepted | Runner-up |
| Kata Containers | Cloud Hypervisor | virtio-fs preserves the current host-dir binding | Strong bare-metal/OCI fit | about 1–2 weeks | Rejected for v1: wrong VMM and pulls the riskier v2 VMM forward |
| E2B self-hosted infra | Firecracker | Public fs/exec API over a block-backed microVM; no host mount required | Full API + client-proxy + Redis + Postgres/object storage + Nomad/Consul; private wildcard DNS/TLS ingress; GCP/AWS-first and bare-metal support must be proven | about 2–4 elapsed weeks including Gate 0, conditional on the assumptions below | **Pick for v1** |

**Recommendation: E2B self-hosted infra + Firecracker.** It is the only evaluated
vehicle that simultaneously keeps the required Firecracker boundary and supplies
the create/exec/fs/destroy control plane needed to replace the host bind with a
guest filesystem. The management gateway maps the existing remote-worker verbs
to E2B's **public API/SDK**; it does not call orchestrator gRPC or envd directly,
and it hides E2B-specific identifiers behind SandboxProviderV1.

The cost is real: one sandbox host **plus separate trusted management
infrastructure** running the E2B API, client-proxy, required Redis routing
catalog, Postgres, object storage, Nomad/Consul servers, and private wildcard
DNS/TLS ingress. The bare-metal node path
is upstream-planned rather than supported like E2B's GCP path. The 2–4 week
estimate is conditional on Gate 0 proving that topology; failure invalidates the
estimate and triggers the Kata + Firecracker fallback review—not Kata + Cloud
Hypervisor or gVisor. The estimate includes a 2–3 day Gate 0 and assumes cohort
build plus production-management-plane provisioning overlap S1 after that gate;
the sequential work is about 14–24 person-days. Host procurement and owner wait
time are excluded.

## Evaluated but not selected

- **gVisor:** disqualified as the tenant boundary because its Sentry still
  mediates onto a shared host kernel. Its correct role is optional
  defense-in-depth inside Firecracker. This pairing is attractive because the
  security evaluation found no upstream Firecracker fuzzer while gVisor has
  continuous syzkaller coverage. It is a post-v1 hardening experiment, not a
  launch dependency.
- **microsandbox/libkrun:** preserves a KVM boundary, but rejected for v1. The
  security evaluation found mode-0 seccomp on every measured VMM thread,
  11/14 reachable escape primitives, no documented upstream fuzzer, no useful
  CVE history to interpret, and pre-1.0/beta maturity. That is the weakest
  residual-bug posture of the KVM candidates for an escape-critical service.
- **Cloud Hypervisor:** not the v1 adopt target. It has a better in-tree fuzz
  harness than Firecracker and is the likely v2 build VMM, but carries higher
  adoption risk today, including its first published escape-class advisory in
  2026. It remains the strategic v2 choice, not a shortcut around v1 filesystem
  work.
- **Plain containers/runc:** rejected because a host-kernel escape crosses the
  tenant boundary by construction.

## Operator invariants

These controls are part of the system definition:

1. **Own Firecracker version currency.** Pin the exact VMM/jailer/kernel/template
   cohort, monitor upstream advisories, and make CI detect/build every bump. v1
   qualification remains a manually triggered exact-box run whose evidence is
   reviewed before admission; unattended multi-host admission is v2. Do
   not inherit a vehicle's frozen default. The evaluation found E2B's default
   Firecracker pin had remained unchanged for 399 days.
2. **Treat 2026 as the end of the “no Firecracker escapes” story.** Track and
   patch CVE-2026-5747 and CVE-2026-1386; both are escape-class primitives in
   the paper's 24-month window.
3. **Keep the sandbox node sterile.** No control-plane signing keys, customer API keys,
   model/provider credentials, transcript store, or other tenant's plaintext
   workspace is placed in a sandbox, jailer chroot, or shared host workspace
   directory. E2B API/Nomad/Consul server state stays on the trusted management
   plane; the sandbox node runs only the minimum node/VMM services. The
   worker receives short-lived, least-privilege material only where a sandbox
   operation requires it.
4. **Side channels are separate work.** KVM does not solve Spectre/MDS-class
   leakage. Core scheduling/sibling isolation, current CPU microcode, host
   selection, and measurement form a separate security workstream. They may
   block a hardware cohort, but are not misrepresented as Firecracker features.
5. **No nested KVM in guests.** /dev/kvm and device passthrough are absent from
   the guest image and qualification explicitly probes this.
6. **Fail closed on drift.** A missing/mismatched VMM, jailer, kernel, rootfs,
   guest-agent, policy, or qualification fact prevents admission.

## Lean v1 slice sequence

```text
Gate 0 -> S1-lite ---------------------> S4 admit -> S5
            +-> S3a + S4 provisioning -+
vehicle       gateway/pins/box prep       qualify     Seneca flip
```

The sequence stays small. It adopts a sandbox control plane; it does not build
product snapshot/fork APIs, warm pools, or a VMM scheduler. E2B may use opaque
UFFD/NBD template restore internally; v1 neither owns nor exposes that machinery.

## Gate 0 — falsify the vehicle before implementation

Gate 0 is now a Firecracker/E2B qualification spike for **one sandbox host plus
its separate trusted management plane**, not a search for a gVisor release that
implements openat2.

**Estimate:** 2–3 elapsed days, included in the conditional 2–4 week total.

On a disposable bare-metal KVM host:

1. Install the exact proposed E2B API, client-proxy, required Redis routing
   catalog, Postgres, object storage, Nomad/Consul servers, private wildcard
   DNS/TLS ingress, node/orchestrator, Firecracker/jailer, guest kernel,
   rootfs/template, and guest-agent revisions. Prove which services and secrets
   live on management infrastructure versus the sandbox node.
2. Create two sandboxes concurrently and prove each is a distinct Firecracker
   process/microVM with a distinct guest kernel and no shared mount namespace.
3. Prove create, bounded exec, read/write, artifact copy-out, renew, destroy,
   orphan cleanup, egress denial, CPU/memory/PID/output/block quotas, and host
   reserve. Prove acknowledged write -> destroy -> recreate -> read, atomic
   workspace-generation recovery after interrupted commit, and the declared
   crash/expiry RPO.
4. Preserve the existing **11 logical security assertions**, but build a new
   Firecracker/E2B driver and provider-neutral evidence/cohort schema. Reinterpret
   runsc-specific mechanics (Docker PIDs/cgroups/networks, host binds, and the
   gVisor uname sentinel) as equivalent microVM boundary/identity/quota controls;
   do not pretend the literal runsc harness is transport-neutral.
5. Prove no host path, /dev/kvm, control-plane secret, sibling block device, or
   other-sandbox data is visible from either guest.
6. Restart E2B API/client-proxy/Redis/Postgres/object storage/Nomad/Consul and
   the sandbox node in fault combinations; prove routing recovery, durable
   binding/nonce recovery, stale sandbox cleanup, workspace recovery, and
   fail-closed admission under partial control-plane failure.
7. Record exact upstream revisions, artifact digests, kernel/microcode, commands,
   and redacted output.

### What happened to the old openat2 Gate 0?

The old gate was primarily a gVisor compatibility test: runsc returned ENOSYS for
the helper's openat2 call. That engine-selection gate is superseded.

Path confinement still matters. If the existing workspace helper remains in the
guest data path, Gate 0 must prove guest-kernel openat2 with
RESOLVE_BENEATH/RESOLVE_NO_MAGICLINKS and retain the symlink-swap race tests. If
E2B's guest fs agent replaces that helper, the adapter must prove equivalent
beneath-root semantics and the same traversal/race negatives. There is no
realpath fallback. In short: openat2 is no longer a reason to choose an outer
isolation engine, but its security property remains required at the guest
filesystem boundary.

Gate 0 is green only when the vehicle works on the intended bare-metal topology,
all 11 probes pass, and the filesystem decision is demonstrated end to end. A
failed bare-metal E2B gate activates the Kata + Firecracker fallback review; it
does not authorize gVisor or raw-Firecracker fleet work.

## S1-lite — management gateway + E2B public-API adapter

**Estimate:** 5–8 implementation days inside the conditional 2–4 week E2B
adoption envelope.

Deliver:

- Build the HTTP/SSE management gateway that does **not** exist today, using the
  seven V1 remote-worker routes and strict schemas in api-spec.md.
- Add the E2B **public API/SDK** adapter: create one Firecracker sandbox, exec,
  bounded fs/events, renew, and destroy. Do not call orchestrator/envd directly.
- Route E2B SDK fs/exec traffic through a private client-proxy wildcard
  DNS/TLS endpoint backed by Redis's sandbox-to-node catalog. Do not expose
  that endpoint to customers.
- Put capability verification, durable binding+nonce state, and per-tenant/global
  admission budgets on the trusted management plane. The same transaction
  consumes a nonce and validates/updates its binding; the in-memory store remains
  a test double. No signing root or customer credential reaches the sandbox node.
- Keep deterministic sandbox identity, request bounds, authorization-before-
  effect, connection/session caps, startup drain/sweep, stable redacted errors,
  and SIGTERM drain.
- Bind each workspace to a durable provider volume/E2B workspace snapshot and
  prove acknowledged-write durability, atomic generation publication,
  destroy/recreate persistence, crash recovery, and bounded import/export. Never
  derive or accept a host path.
- Replace the host chokidar watcher with guest fs events when supported or a
  bounded polling bridge. UI correctness must not depend on host inotify.
- Reject arbitrary E2B templates, VM specs, privileged devices, network policy
  overrides, metadata, or shell command construction from request input.
- Keep Tailscale/private worker ingress if Seneca remains the only control-plane
  caller. Seneca being public does not require exposing the root-equivalent
  worker API publicly; customers authenticate to Seneca, not to the VMM host.

Proof:

- Real remote-worker conformance through the E2B adapter: create, fs, exec,
  events/polling, renew, delete, retry, hard expiry, transport loss, startup
  failure, and graceful shutdown.
- Negative proof that replay/cross-tenant auth, host-shaped paths,
  template/image overrides, and resource overrides cause no
  E2B/Nomad/Firecracker effect.

Rollback: leave BORING_AGENT_MODE on the current provider until S5. Stopping the
adapter admits no new sandboxes and destroys its test microVMs.

## S3a — immutable cohort and Firecracker pin

**Estimate:** 2–3 implementation days.

At startup, load one admitted cohort containing exact digests/versions for:

- E2B infra/control-plane revision;
- Firecracker and jailer;
- guest kernel and rootfs/template;
- guest agent/envd;
- network policy and quota profile;
- the 11-probe evidence produced on that exact host cohort.

Create requests select none of these. The adapter constructs the admitted
template/spec server-side. Mismatch or stale evidence returns the stable
unqualified error before Nomad or Firecracker is called.

CI owns version detection and the reproducible cohort build: an upstream
Firecracker update or security advisory opens/fails a pin-update change. v1 then
runs the exact-box qualification manually from that CI-built candidate and
requires evidence review before admission. A vendor default is never silently
inherited.

Rollback reinstalls the last known-good cohort as a unit after drain; it never
falls back to tags, an older unqualified VMM, or a shared-kernel runtime.

## S4-lite — one shared-metal Firecracker host, manually admitted

**Estimate:** 4–7 implementation/ops days inside the 2–4 week adoption envelope.

Provision one EU bare-metal KVM sandbox host for dense per-sandbox microVMs and
the **separate trusted management infrastructure** for the E2B API,
client-proxy, required Redis routing catalog, Postgres, object storage,
Nomad/Consul servers, and private wildcard DNS/TLS ingress identified by Gate 0.
ClickHouse/dashboard/billing remain excluded. The
idempotent apply/check runbook must prove:

- virtualization extensions, /dev/kvm ownership for the trusted VMM service, IOMMU
  and nested-virtualization policy, current microcode, and the separate
  side-channel posture recorded for the cohort;
- exact E2B, Nomad, Consul, Firecracker, jailer, kernel, template, and guest-agent
  pins;
- host firewall, private control-plane ingress, default-deny sandbox egress, and
  per-sandbox network identity;
- per-microVM CPU, memory, PID/process, output, disk/block, lease, and concurrent
  sandbox limits plus a host emergency reserve;
- jailer/chroot and service-account boundaries, no guest /dev/kvm, no host-dir
  workspace mount, and no control-plane/customer secrets on the sandbox host;
- startup cleanup, orphan cleanup, disk reclamation, and refusal under partial
  client-proxy/Redis/Nomad/Consul/E2B failure;
- the provider-neutral Firecracker driver preserving all 11 hostile security
  assertions against the exact box/template, plus durable workspace
  destroy/recreate and interrupted-commit recovery.

E2B still performs placement, but its eligible set contains exactly one
admitted sandbox host. There is no Boring-owned or multi-host scheduler.

Admission is manual for v1: one operator reviews the redacted transcript and
digests and installs the admitted cohort. There is no custom scheduler, warm
pool, product snapshot/fork API, or unattended fleet admission in this slice.
Opaque E2B template snapshot restore is an adopted implementation detail.

Rollback drains and stops admission, restores the previous admitted cohort, and
keeps the host/block artifacts intact for diagnosis. Host deprovisioning is a
separate owner action.

## S5 — Seneca production flip and rollback

**Estimate:** 1–3 days plus observation.

- Add/use BORING_AGENT_MODE=remote-worker through the existing
  SandboxProviderV1 provider path.
- Preserve the legacy BORING_WORKER_BASE_URL precedence fail-closed fix: V1 mode
  plus V0 configuration must refuse startup.
- Load one admitted worker endpoint/cohort. E2B placement has one admitted
  candidate; there is no Boring-owned or multi-host scheduler.
- Before traffic, verify health reports the exact E2B/Firecracker/kernel/template
  cohort admitted in S4.
- Canary at least two distinct customer/workspace identities concurrently and
  prove separate microVM processes, guest kernels, block devices, network
  identities, quotas, and teardown.
- Prove serial fs/exec behavior, guest uname, egress denial, lease renewal,
  delete, orphan cleanup, and absence of cross-workspace reads.
- Keep transcripts/session history on Seneca's durable host volume, never in the
  sandbox guest.
- Roll back by stopping new admission, draining/destroying all canary microVMs,
  copying out required artifacts through the bounded API, restoring the captured
  **already-admitted hardware-microVM provider** configuration (currently
  vercel-sandbox/Firecracker), and proving it with a fresh canary. Never roll
  public customer traffic back to runsc, direct, or local mode. No live session
  crosses the provider flip.

## Guardrails retained and repointed

The isolation engine changed; the guardrails did not:

- fail-closed startup and cohort drift checks;
- exact immutable image/kernel/VMM pins;
- egress deny and all 11 logical hostile assertions through the
  Firecracker/E2B qualification driver on the real box;
- no host paths, runtime sockets, arbitrary specs, or qualification overrides on
  the wire;
- CPU, memory, PID, output, disk, lease, concurrency, and host-reserve quotas;
- strict schemas/body bounds, authorization before effect, stable redacted errors,
  idempotent create, startup sweep, and bounded shutdown;
- drain-before-flip rollback with an admitted hardware-microVM provider kept
  available;
- independent review of every security slice.

Project quota on a shared host workspace is superseded by a bounded durable
tenant workspace plus a bounded per-microVM overlay because v1 no longer mounts
a host workspace directory. The quota property remains; the mechanism changes.

## v1 launch criteria

There is no later “public-opening” exception that permits shared gVisor. Seneca
is already public and multi-tenant, so these are launch blockers for customer
agent code:

1. Gate 0 passes on the intended Firecracker/E2B bare-metal cohort.
2. Every admitted sandbox is a distinct microVM and cross-tenant negatives pass.
3. The 11 logical hostile assertions, egress deny, quota/host-reserve, cleanup,
   durable workspace recovery, and no-host-path checks are green on the exact
   cohort.
4. The Firecracker/jailer/kernel/template pin is CI-owned and the two 2026 escape
   advisories are patched in the admitted version.
5. No control-plane secret, customer/model credential, transcript store, or
   other tenant workspace is present in a guest or shared host workspace tree.
6. Seneca's public edge authenticates tenant/workspace identity; S1's management
   gateway durably binds it, consumes replay nonces atomically, enforces
   per-tenant/global budgets, and keeps signing roots off the sandbox node.
   Two-tenant isolation tests pass through the real wire path.
7. Rollback is rehearsed without leaving a live microVM or losing required
   copied-out artifacts.

A sustained soak is an operational graduation criterion, not permission to
weaken items 1–7.

## v1 to v2: same boundary, new control plane

v1 already establishes the hardware-microVM-per-sandbox architecture behind
SandboxProviderV1. v2 therefore does not migrate from a shared-kernel boundary
to a hardware boundary. It replaces the adopted single-sandbox-host backend
with an owned fleet control plane while keeping the external provider contract,
guest-agent shape, hardware isolation class, and durable workspace API
semantics.

If v2 selects Cloud Hypervisor, the VMM binary changes, but the security model
does not: it remains one KVM microVM per sandbox on shared metal. Cloud
Hypervisor is the likely build choice because its device model, virtio-fs option,
and fuzz-harness posture fit a fleet we own; that choice requires its own
security qualification and escape-CVE response.

The following are explicitly v2 and live in
[plan-v2-hardening.md](plan-v2-hardening.md):

- block-level incremental snapshot/fork;
- memory snapshot/restore;
- warm pools;
- snapshot-locality-aware scheduling;
- multi-host placement, bin packing, draining, and eviction;
- unattended cohort admission and requalification;
- optional gVisor-inside-microVM defense-in-depth.

This converges on the model described in OpenAI's [From fork() to Fleet
talk](https://www.youtube.com/watch?v=OqM67QG_Ikk): dense hardware-isolated
sandboxes on shared hosts, Rust VMMs including Cloud Hypervisor, block-level
incremental persistence, and snapshot-locality-aware fleet orchestration. Those
optimizations are not required to ship the safe v1.

## Explicit non-goals

- One standing VM per tenant/workspace.
- gVisor, runc, or containers as the tenant boundary.
- Raw Firecracker orchestration or a bespoke VMM fleet.
- Kata + Cloud Hypervisor as an accidental v1 virtio-fs detour.
- Product snapshot/fork APIs, owned memory restore, warm pools,
  snapshot-locality scheduling, or
  multi-host placement.
- Public exposure of the worker/VMM API.
- Host directory mounts into a Firecracker guest.
- Control-plane databases, long-lived customer secrets, transcripts, or
  cross-tenant shared files on the sandbox host.
- gVisor-inside-Firecracker as a launch blocker; it is optional hardening.
- microsandbox/libkrun for escape-critical production.
- Billing, metering, console, or a general E2B-compatibility layer beyond the
  existing V1 verbs.

## Review and owner gate

Every implementation slice receives independent standards and security/spec
review on the exact head SHA. Findings are fixed and proof rerun before owner
approval. No slice or this plan authorizes merging PR #1220.

Owner approval of this corrected plan authorizes the Gate 0 adoption spike and,
only if it passes, S1-lite, S3a, S4-lite, and S5. It does not authorize a raw
Firecracker fleet build or production traffic before the v1 launch criteria are
met.
