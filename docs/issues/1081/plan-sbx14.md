---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-12
revision: r4-kata-firecracker-s3-v1
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
trusted management gateway + SandboxProviderV1
        |
        | admitted OCI lifecycle/fs/exec operations only
        v
shared bare-metal KVM host + containerd/Kata runtime wrapper
        |
        +-- sandbox A -> Firecracker microVM A -> guest kernel A -> local POSIX disk A
        +-- sandbox B -> Firecracker microVM B -> guest kernel B -> local POSIX disk B
        +-- sandbox C -> Firecracker microVM C -> guest kernel C -> local POSIX disk C
                 |                  |                  |
                 +-- scoped sync ---+------------------+--> tenant S3 buckets/prefixes
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
5. The sandbox host carries no control-plane secrets, reusable customer/API
   secrets, shared plaintext workspace tree, or durable other-tenant plaintext
   in host services/files. Each local working disk has per-microVM encrypted or
   ephemeral backing and secure discard. A guest receives only short-lived,
   prefix/action-scoped credentials for its own tenant bucket/prefix; those
   credentials are readable by the agent and therefore must expire quickly.
6. Egress is denied by default. The only v1 allowlisted destination is the
   tenant's admitted S3 endpoint, and resource ceilings apply before untrusted
   code starts.

This is not VM-per-tenant. It is microVM-per-sandbox on shared metal.

## v1 technology choice: Firecracker engine, Kata runtime wrapper

Raw Firecracker is a VMM, not a sandbox product. Building lifecycle
orchestration, image/rootfs assembly, guest exec/fs transport, networking,
cleanup, and recovery directly on its API is a weeks-to-months fleet project.
That work belongs in v2.

v1 adopts an off-the-shelf OCI launch path behind SandboxProviderV1:

- **Firecracker is the engine and security boundary.** It supplies the
  hardware-KVM microVM and guest-kernel isolation.
- **Kata Containers is the runtime wrapper.** It is the containerd integration
  used to launch Firecracker microVMs from admitted OCI images. Kata is not an
  alternative isolation engine and is adopted, not rebuilt.

`firecracker-containerd` is the lower-level alternative if Kata's wrapper
cannot meet qualification. Raw Firecracker orchestration and a bespoke fleet
remain out of v1.

### Storage product: S3 system of record + local POSIX working disk

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

The v1 persistence tier is a **per-tenant S3 bucket (or strictly scoped prefix)
as the durable system of record**. Objects remain plain user files such as CSV,
Parquet, JSON, source, and artifacts. The user can use ordinary S3 commands,
APIs, and sync tools against their own data: a Dropbox/data-lake substrate out
of the box, with bring-your-own-data and take-your-data-out rather than a
provider-only volume format.

S3 object versioning is enabled. It gives the user visible point-in-time file
history. Each checkpoint also publishes an immutable manifest of object keys and
version IDs, then conditionally advances one current-generation pointer; this
turns those file versions into an atomic workspace snapshot rather than a mixed
set of independently current objects. Access/event logging supplies the audit
trail. Regulated deployments add retention/Object Lock where immutable history
is required. This is especially useful in fiduciary, tax, insurance, and other
regulated workflows. The admitted object store must keep data inside the
selected EU perimeter: OVHcloud or Scaleway Object Storage, Cloudflare R2 in the
EU, or self-hosted MinIO/Ceph on Seneca's bare metal are valid deployment
choices.

Inside each microVM, git, SQLite, builds, and tools run on a fast local ext4/xfs
block disk with correct POSIX semantics. The sync bridge runs **inside the
guest**. rclone is the initial synchronization candidate; Mountpoint for Amazon
S3 may be qualified only as transfer/write-back plumbing and is never mounted at
`/workspace`. The bridge lazily hydrates the manifest at start and flushes
changes on provider-fs write, explicit checkpoint, and session end.

One active writer lease exists per tenant/workspace across the session pool.
Checkpoint compares the baseline object version IDs and conditionally advances
the generation pointer. A second sandbox writer or direct user S3 edit during
the lease causes a stable conflict/fence and inbound refresh; it never silently
last-writer-wins, resurrects a delete, or publishes a partial mix. Provider `/fs`
write success means its generation is committed to S3. Writes made inside an
`exec` become durable only at the documented sync/checkpoint boundary. A failed
flush retains/fences the encrypted local disk for recovery and never destroys
the sandbox while claiming success. Gate 0 declares the exec-write crash/expiry
RPO and proves write/checkpoint -> destroy -> recreate -> read.

Do not execute tools directly on a naive s3fs-style mount: object stores do not
provide complete POSIX rename, random-write, append, or locking semantics
(rename commonly degrades to copy plus delete). Also reject:

- opaque block volume plus volume snapshot as the durable product model, because
  the user cannot inspect or sync their own files and the product loses the
  Dropbox/data-lake benefit;
- POSIX-over-S3 filesystems such as JuiceFS, because chunked internal objects
  make user files unreadable through ordinary S3 commands and APIs.

### File transfer principle: copy in, never host-mount

Transient per-session inputs—prompt context, selected project files, uploaded
images, and SQL-result CSVs—are copied into the guest's local working disk over
the bounded provider channel. They are never supplied by bind-mounting a host
directory with virtio-fs, 9p, or a similar mechanism. They live under the
separate unsynced `/inputs` tree, never under the S3-backed `/workspace`, and are
securely discarded at teardown.

A host mount is a live cross-boundary channel. It expands the VMM/device surface,
creates path-traversal and symlink-race opportunities, and increases the blast
radius from one copied object set to a continuously reachable host tree. Copy-in
removes that channel and keeps Firecracker viable because Firecracker has no
virtio-fs. This is the structural form of the existing no-host-paths guardrail.
Host inotify is not part of the design; events come from guest-local observation
or bounded polling.

### Vehicle evaluation and pick

| Vehicle | VMM | Filesystem fit | Ops fit | Honest v1 estimate | Decision |
| --- | --- | --- | --- | --- | --- |
| Kata Containers | Firecracker | Local POSIX block disk + S3 sync-hybrid; no live host directory | Bare-metal-first, OCI/containerd-native runtime wrapper | about 1–2 weeks for a qualified single box | **Pick for v1** |
| Kata Containers | Cloud Hypervisor | virtio-fs preserves the current host-dir binding | Strong bare-metal/OCI fit | about 1–2 weeks | Rejected for v1: wrong VMM and pulls the riskier v2 VMM forward |
| firecracker-containerd | Firecracker | Local POSIX block disk + S3 sync-hybrid | Lower-level containerd integration; more lifecycle wiring than Kata | qualification-dependent | Lower-level fallback if Kata blocks |
| E2B self-hosted infra | Firecracker | Snapshot-backed persistence and guest API | Full API + client-proxy + Redis + Postgres/object storage + Nomad/Consul | v2 evaluation | Deferred: persistence machinery does not earn its v1 ops weight |

**Recommendation: Kata + Firecracker on bare-metal KVM.** Kata wraps the chosen
Firecracker engine in the mature OCI/containerd launch path v1 needs; it does
not replace or weaken the microVM boundary. SandboxProviderV1 hides the wrapper
and preserves the app-facing contract. The honest estimate is **about 1–2
weeks** to a qualified single box, excluding host procurement and owner wait.

E2B self-hosted moves to v2. With S3 as the durable data substrate, v1 does not
need E2B's persistence/snapshot engine, so its Nomad, Consul, Redis, Postgres,
object-storage metadata, proxy, and ingress stack do not earn their operational
weight. v2 may adopt E2B's snapshot-fork engine then, or build an owned
equivalent, after measured demand justifies the fleet control plane.

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
- **E2B self-hosted for v1:** deferred, not rejected as a future snapshot-fork
  source. The S3 substrate removes the v1 need for its persistence engine, while
  Nomad/Consul/Redis/Postgres and its proxy/ingress topology add material
  operations before Boring needs a fleet.

## Operator invariants

These controls are part of the system definition:

1. **Own Firecracker version currency.** Pin the exact VMM/jailer/kernel/OCI-image
   cohort, monitor upstream advisories, and make CI detect/build every bump. v1
   qualification remains a manually triggered exact-box run whose evidence is
   reviewed before admission; unattended multi-host admission is v2. Do
   not inherit a vehicle's frozen default. The evaluation found E2B's default
   Firecracker pin had remained unchanged for 399 days.
2. **Treat 2026 as the end of the “no Firecracker escapes” story.** Track and
   patch CVE-2026-5747 and CVE-2026-1386; both are escape-class primitives in
   the paper's 24-month window.
3. **Keep the sandbox node sterile.** No control-plane signing keys, reusable
   customer/API keys, model/provider credentials, transcript store, or other
   tenant's plaintext is placed in a sandbox, jailer chroot, or shared host
   workspace directory. The sandbox host runs only containerd/Kata,
   Firecracker/jailer, encrypted/ephemeral block backing, and qualification
   services; the S3 sync bridge runs inside each guest. A guest may read its own
   S3 credential, so that credential must be short-lived and restricted by
   prefix and action to only that tenant namespace.
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

The sequence stays small. It adopts Kata's OCI/containerd runtime wrapper around
Firecracker; it does not build product snapshot/fork APIs, a VMM scheduler, or a
fleet control plane. A small per-process session pool with idle TTL is runtime
reuse, not the v2 snapshot-fork warm-pool product.

## Gate 0 — qualify Kata + Firecracker before implementation

Gate 0 is now a Kata + Firecracker qualification spike on **one disposable
bare-metal KVM sandbox host**, not a search for a gVisor release that implements
openat2.

**Estimate:** 1–2 elapsed days inside the 1–2 week single-box total.

On a disposable bare-metal KVM host:

1. Install the exact proposed containerd, Kata runtime wrapper, Firecracker,
   jailer, guest kernel, OCI rootfs/image, local ext4/xfs working disk, S3 sync
   bridge, and guest-agent revisions. Prove that Kata launches Firecracker—not
   QEMU or Cloud Hypervisor—for the admitted RuntimeClass/configuration.
2. Create two sandboxes concurrently and prove each is a distinct Firecracker
   process/microVM with a distinct guest kernel and no shared mount namespace.
3. Prove create, bounded exec, local POSIX behavior for git/SQLite/rename/append,
   transient copy-in, artifact copy-out, renew, destroy, orphan cleanup,
   CPU/memory/PID/output/block quotas, and host reserve. Prove lazy S3 hydrate,
   provider-fs durable acknowledgement, exec-write checkpoint boundaries,
   atomic manifest publication, flush-on-write/checkpoint/session-end,
   object-version visibility, POSIX metadata round-trip policy, and acknowledged
   write -> destroy -> recreate -> read at the declared crash RPO. Prove a failed
   flush fences/retains the disk without false success.
4. Preserve the existing **11 logical security assertions**, but build a new
   Firecracker/Kata driver and provider-neutral evidence/cohort schema. Reinterpret
   runsc-specific mechanics (Docker PIDs/cgroups/networks, host binds, and the
   gVisor uname sentinel) as equivalent microVM boundary/identity/quota controls;
   do not pretend the literal runsc harness is transport-neutral.
5. Prove network-off by default: the guest reaches only the admitted S3
   endpoint, not metadata, private networks, arbitrary DNS/Internet targets, or
   sibling services. Prove its short-lived credential expires, cannot cross the
   assigned tenant bucket/prefix, and cannot mutate bucket versioning, policy,
   lifecycle, retention/Object Lock, or delete historical object versions.
6. Prove no host path, /dev/kvm, control-plane secret, sibling block device, or
   other-sandbox data is visible from either guest. Verify transient inputs use
   copy-in and no virtio-fs/9p/bind mount exists.
7. Restart the management gateway, containerd/Kata, S3 sync bridge, and sandbox
   node in fault combinations; prove routing recovery, stale sandbox cleanup,
   idempotent flush/recovery, and fail-closed admission under partial failure.
8. Prove the provider's session pool reuses only the same authorized sandbox,
   resets its idle TTL on use, destroys it after TTL, and never crosses tenant or
   workspace identity. Prove optional-runtime graceful degradation: if Kata or
   its provider module is unavailable, startup/health reports the provider
   unavailable without falling through to direct, local, runsc, or another
   weaker runtime.
9. Prove one active writer lease per workspace: same-workspace concurrent
   sandboxes and direct S3 mutation during a session produce a stable conflict,
   refresh/fence safely, and never publish a mixed generation. Prove `/inputs`
   is excluded from sync and securely discarded.
10. Record exact upstream revisions, artifact digests, kernel/microcode, commands,
   and redacted output.

### What happened to the old openat2 Gate 0?

The old gate was primarily a gVisor compatibility test: runsc returned ENOSYS for
the helper's openat2 call. That engine-selection gate is superseded.

Path confinement still matters. The guest data path must prove guest-kernel
openat2 with RESOLVE_BENEATH/RESOLVE_NO_MAGICLINKS or equivalent beneath-root
semantics and retain traversal and symlink-swap race tests. There is no realpath
fallback. In short: openat2 is no longer a reason to choose an outer isolation
engine, but its security property remains required at the guest filesystem and
copy-in boundaries.

Gate 0 is green only when Kata demonstrably launches the pinned Firecracker
engine on the intended bare-metal host, all 11 probes pass, and S3 sync-hybrid
persistence plus copy-in are demonstrated end to end. A failed Kata gate may
evaluate the lower-level firecracker-containerd path; it does not authorize
gVisor, Cloud Hypervisor, or a raw-Firecracker fleet build.

## S1-lite — management gateway + Kata/Firecracker provider adapter

**Estimate:** 4–7 implementation days inside the 1–2 week single-box envelope.

Deliver:

- Build the HTTP/SSE management gateway that does **not** exist today, using the
  seven V1 remote-worker routes and strict schemas in api-spec.md.
- Add the Kata/containerd adapter: launch one admitted OCI image through Kata's
  Firecracker backend, then exec, bounded fs/events, renew, and destroy. Keep
  Firecracker as the explicitly verified engine/boundary.
- Keep `firecracker-containerd` documented as the lower-level replacement for
  the wrapper if Kata fails Gate 0; do not mix both launch paths in one cohort.
- Put capability verification, durable binding+nonce state, and per-tenant/global
  admission budgets on the trusted management plane. The same transaction
  consumes a nonce and validates/updates its binding; the in-memory store remains
  a test double. No signing root or customer credential reaches the sandbox node.
- Keep deterministic sandbox identity, request bounds, authorization-before-
  effect, connection/session caps, startup drain/sweep, stable redacted errors,
  and SIGTERM drain.
- Back each tenant/workspace with its scoped S3 bucket/prefix, versioning, and a
  local ext4/xfs working disk. Implement lazy-in plus provider-fs write,
  checkpoint, and session-end flush using an in-guest rclone-based bridge and
  immutable key+version manifests with a conditional generation pointer. Issue
  short-lived, prefix/action-scoped object credentials only after authorization;
  deny bucket-policy/lifecycle/versioning/retention changes and historical
  version deletion. Never derive or accept a host path, naive s3fs mount, opaque
  volume snapshot, or JuiceFS-style chunk store.
- Copy transient context, SQL-result CSVs, and uploads into the guest; never
  bind-mount a host directory and never sync the separate `/inputs` tree.
- Add an authorization-keyed session pool with idle TTL so repeated calls can
  reuse a warm sandbox. Reuse must never cross tenant/workspace identity, hard
  lease remains authoritative, and expiry flushes then destroys the sandbox.
  Enforce one active writer lease per tenant/workspace; external S3 drift or a
  second writer returns a stable conflict and fences/refreshes rather than
  overwriting.
- Start with network disabled and allowlist only the selected S3 endpoint.
- Treat the runtime as optional: the host app/control plane may start without
  Kata, but sandbox admission and remote-worker create fail closed with a stable
  unavailable health/error state and never silently degrade to a weaker
  provider.
- Replace the host chokidar watcher with guest fs events when supported or a
  bounded polling bridge. UI correctness must not depend on host inotify.
- Reject arbitrary OCI images, RuntimeClass/VM specs, privileged devices, network policy
  overrides, metadata, or shell command construction from request input.
- Keep Tailscale/private worker ingress if Seneca remains the only control-plane
  caller. Seneca being public does not require exposing the root-equivalent
  worker API publicly; customers authenticate to Seneca, not to the VMM host.

Proof:

- Real remote-worker conformance through the Kata/Firecracker adapter: create,
  fs, exec, events/polling, renew, delete, retry, hard expiry, transport loss,
  startup failure, and graceful shutdown.
- Negative proof that replay/cross-tenant auth, host-shaped paths,
  template/image overrides, and resource overrides cause no
  containerd/Kata/Firecracker effect.

Rollback: leave BORING_AGENT_MODE on the current provider until S5. Stopping the
adapter admits no new sandboxes and destroys its test microVMs.

### Provider-behavior reference spike

The [getnao/nao BoxLite adapter at the reviewed
revision](https://github.com/getnao/nao/blob/018d1f155fc52e5c24853bd9934c469758487b6f/apps/backend/src/agents/tools/execute-sandboxed-code.ts)
validates three useful adapter patterns: an in-process sandbox map reused by ID,
an idle TTL reset on each call, and graceful tool disablement when the optional
runtime import is unavailable. It also uses explicit `copyIn` for project files,
images, and SQL-result CSVs. Boring adopts those provider behaviors behind
SandboxProviderV1, not BoxLite's libkrun engine. The spike enables guest network
access; Boring deliberately tightens that behavior to network-off by default
with only the tenant's S3 endpoint allowlisted.

## S3a — immutable cohort and Firecracker pin

**Estimate:** 2–3 implementation days.

At startup, load one admitted cohort containing exact digests/versions for:

- containerd and Kata runtime wrapper/configuration;
- Firecracker and jailer;
- guest kernel and OCI rootfs/image;
- guest agent and S3 sync bridge;
- network/S3 allowlist policy and quota profile;
- the 11-probe evidence produced on that exact host cohort.

Create requests select none of these. The adapter constructs the admitted
image/spec server-side. Mismatch or stale evidence returns the stable
unqualified error before containerd, Kata, or Firecracker is called.

CI owns version detection and the reproducible cohort build: an upstream
Firecracker update or security advisory opens/fails a pin-update change. v1 then
runs the exact-box qualification manually from that CI-built candidate and
requires evidence review before admission. A vendor default is never silently
inherited.

Rollback reinstalls the last known-good cohort as a unit after drain; it never
falls back to tags, an older unqualified VMM, or a shared-kernel runtime.

## S4-lite — one shared-metal Kata + Firecracker host, manually admitted

**Estimate:** 2–4 implementation/ops days inside the 1–2 week adoption envelope.

Provision one EU bare-metal KVM sandbox host for dense per-sandbox microVMs, the
small trusted management gateway, and the admitted EU-sovereign S3-compatible
object-store endpoint identified by Gate 0. The idempotent apply/check runbook
must prove:

- virtualization extensions, /dev/kvm ownership for the trusted VMM service, IOMMU
  and nested-virtualization policy, current microcode, and the separate
  side-channel posture recorded for the cohort;
- exact containerd, Kata, Firecracker, jailer, kernel, OCI image, guest-agent,
  and sync-bridge pins;
- host firewall, private control-plane ingress, default-deny sandbox egress,
  S3-endpoint-only allowlist, and per-sandbox network identity;
- per-microVM CPU, memory, PID/process, output, disk/block, lease, and concurrent
  sandbox limits plus a host emergency reserve;
- jailer/chroot and service-account boundaries, no guest /dev/kvm, no host-dir
  workspace mount, no durable other-tenant plaintext in host files/services,
  per-microVM encrypted ephemeral block backing with secure discard, and only
  expiring prefix/action-scoped S3 credentials in a guest;
- startup cleanup, orphan cleanup, disk reclamation, and refusal under partial
  gateway/containerd/Kata/S3 failure;
- the provider-neutral Firecracker driver preserving all 11 hostile security
  assertions against the exact box/image, plus atomic S3-manifest workspace
  destroy/recreate, writer-conflict, and interrupted-flush recovery;
- authorization-keyed pool reuse, idle-TTL expiry, optional-runtime
  graceful-degrade, and copy-in-only transient inputs.

The provider's eligible set contains exactly one admitted sandbox host. There
is no Boring-owned or multi-host scheduler.

Admission is manual for v1: one operator reviews the redacted transcript and
digests and installs the admitted cohort. There is no custom scheduler,
snapshot-fork warm pool, product snapshot/fork API, or unattended fleet
admission in this slice. The small session pool is bounded same-sandbox reuse
with idle TTL, not a fleet snapshot product.

Rollback drains and stops admission, restores the previous admitted cohort, and
keeps the host/block artifacts intact for diagnosis. Host deprovisioning is a
separate owner action.

## S5 — Seneca production flip and rollback

**Estimate:** 1–3 days plus observation.

- Add/use BORING_AGENT_MODE=remote-worker through the existing
  SandboxProviderV1 provider path.
- Preserve the legacy BORING_WORKER_BASE_URL precedence fail-closed fix: V1 mode
  plus V0 configuration must refuse startup.
- Load one admitted worker endpoint/cohort. The provider has one admitted
  candidate; there is no Boring-owned or multi-host scheduler.
- Before traffic, verify health reports the exact Kata/Firecracker/kernel/image
  cohort admitted in S4.
- Canary at least two distinct customer/workspace identities concurrently and
  prove separate microVM processes, guest kernels, block devices, network
  identities, quotas, and teardown.
- Prove serial fs/exec behavior, guest uname, S3-only egress, credential expiry,
  local POSIX behavior, sync/checkpoint durability, object-version visibility,
  lease renewal, pool reuse/idle eviction, delete, orphan cleanup, and absence of
  cross-workspace reads.
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
  Firecracker/Kata qualification driver on the real box;
- no host paths, runtime sockets, arbitrary specs, or qualification overrides on
  the wire;
- CPU, memory, PID, output, disk, lease, concurrency, and host-reserve quotas;
- strict schemas/body bounds, authorization before effect, stable redacted errors,
  idempotent create, startup sweep, and bounded shutdown;
- drain-before-flip rollback with an admitted hardware-microVM provider kept
  available;
- independent review of every security slice.

Project quota on a shared host workspace is superseded by per-tenant S3 limits
plus a bounded per-microVM local working disk because v1 no longer mounts a host
workspace directory. The quota property remains; the mechanism changes.

## v1 launch criteria

There is no later “public-opening” exception that permits shared gVisor. Seneca
is already public and multi-tenant, so these are launch blockers for customer
agent code:

1. Gate 0 passes on the intended Kata + Firecracker bare-metal cohort.
2. Every admitted sandbox is a distinct microVM and cross-tenant negatives pass.
3. The 11 logical hostile assertions, egress deny, quota/host-reserve, cleanup,
   S3 sync-hybrid recovery, atomic manifest/version visibility, writer-conflict,
   scoped-credential, unsynced-input/copy-in-only, pool/idle-TTL,
   optional-runtime, and no-host-path checks are green on the exact cohort.
4. The Firecracker/jailer/kernel/OCI-image pin is CI-owned and the two 2026 escape
   advisories are patched in the admitted version.
5. No control-plane secret, reusable customer/model credential, transcript
   store, shared plaintext host workspace tree, or durable other-tenant
   plaintext is present in a guest or sandbox-host service. Local working-block
   backing is per-microVM encrypted/ephemeral and securely discarded. A guest
   sees only its expiring, prefix/action-scoped S3 credential.
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
with an owned or adopted snapshot-aware fleet control plane while keeping the
external provider contract, guest-agent shape, hardware isolation class, and S3
data-substrate semantics.

v2 has two explicit paths. Adopting E2B's snapshot-fork engine keeps
Firecracker. Building Boring's owned fleet likely uses Cloud Hypervisor because
its device model and fuzz-harness posture fit a fleet we own. Either path needs
its own security qualification and escape-CVE response, keeps one KVM microVM
per sandbox, and uses block/memory snapshots only to accelerate ephemeral
working-state fork/restore. Tenant-readable S3 remains the durable system of
record.

The following are explicitly v2 and live in
[plan-v2-hardening.md](plan-v2-hardening.md):

- adopt E2B's snapshot-fork engine or build Boring's owned equivalent;
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
- E2B self-hosted control-plane operations in v1.
- Kata + Cloud Hypervisor as an accidental v1 virtio-fs detour.
- Product snapshot/fork APIs, owned memory restore, warm pools,
  snapshot-locality scheduling, or
  multi-host placement.
- Public exposure of the worker/VMM API.
- Host directory mounts into a Firecracker guest.
- Naive s3fs-style execution, opaque volume-snapshot persistence, or
  POSIX-over-S3 chunk stores such as JuiceFS.
- Control-plane databases, long-lived customer secrets, transcripts, or
  cross-tenant shared files on the sandbox host.
- gVisor-inside-Firecracker as a launch blocker; it is optional hardening.
- microsandbox/libkrun for escape-critical production.
- Billing, metering, console, or a general E2B-compatibility layer.

## Review and owner gate

Every implementation slice receives independent standards and security/spec
review on the exact head SHA. Findings are fixed and proof rerun before owner
approval. No slice or this plan authorizes merging PR #1220.

Owner approval of this corrected plan authorizes the Kata + Firecracker Gate 0
adoption spike and, only if it passes, S1-lite, S3a, S4-lite, and S5. It does
not authorize E2B v2 adoption, a raw Firecracker fleet build, or production
traffic before the v1 launch criteria are met.
