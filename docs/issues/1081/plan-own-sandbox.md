---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-12
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — owned sovereign sandbox build plan

This is the implementation checklist for the owned v1 sandbox target. The
architecture, trade-offs, and provider strategy are already decided in
[plan-sbx14.md](plan-sbx14.md) and [tech-choice.md](tech-choice.md); do not use
this document to reopen them. The target is containerd -> Kata Containers ->
Firecracker on EU bare-metal KVM, with SeaweedFS-backed `/workspace`, local
`/scratch`, and the guest daemon exposed through `SandboxProviderV1`.

The managed Blaxel bridge and the owned target are parallel providers. The
owned provider must not leak Kata, Firecracker, SeaweedFS, host paths, or
credentials through the app-facing runtime contract, and it must never become
an automatic fallback from or to a weaker isolation class.

Effort below is hands-on engineering time for one experienced engineer. It
excludes hardware delivery, security-owner review, and production soak time.
The phases total roughly **33–51 engineer-days** before those external waits;
Phases 2 and 3 can overlap.

## Milestones

- **M0 — single-box qualified:** one exact AX102 cohort boots pinned Firecracker
  through Kata, mounts tenant-scoped SeaweedFS at `/workspace`, supplies local
  `/scratch`, passes the provider contract and every qualification/security
  gate below with two concurrent tenant identities, and has a tested rollback
  to Blaxel for new sessions. M0 is qualification-ready, not HA production.
- **M1 — multi-tenant service:** trusted canaries and then admitted public
  tenants use the owned provider with durable management-plane handles,
  per-tenant credentials and quotas, replicated/backed-up storage, on-call
  telemetry, fail-closed admission, and Blaxel retained as the qualified
  rollback provider.
- **M2 — fleet:** multiple owned compute hosts add placement, draining, warm
  pools, failure-domain-aware scheduling, and later snapshot/fork work without
  changing `SandboxProviderV1`, the hardware-microVM isolation class, the guest
  capability shape, or the SeaweedFS data plane. See
  [plan-v2-hardening.md](plan-v2-hardening.md).

## Dependency ordering

```text
Gate 0 feasibility
        |
        v
Phase 1 provision
     /          \
    v            v
Phase 2 runtime  Phase 3 storage
     \          /
      v        v
 Phase 4 guest daemon + provider
              |
              v
     Phase 5 qualification  ---> M0
              |
              v
        Phase 6 cutover      ---> M1
              |
              v
       multi-host fleet      ---> M2
```

The critical path is Gate 0 -> Phase 1 -> Phases 2 and 3 -> Phase 4 -> Phase 5
-> Phase 6. Runtime and storage work may proceed in parallel after the host
baseline is pinned. Phase 4 may use fakes before both are ready, but its real
integration acceptance is blocked by Phases 2 and 3. No untrusted admission is
allowed before Phase 5 passes on the exact cohort.

## Gate 0 — feasibility and evidence

**Effort:** 2–4 engineer-days total; partly consumed by the live spike.

The active feasibility lane is branch `spike/own-sandbox` in worktree
`.worktrees/ownsbx-spike`. It is the evidence source for the checklist items
marked **[SPIKE]**. At the time this plan was written the branch existed but had
not yet committed its results, so those items remain pending rather than being
claimed as passed. Land redacted commands, exact versions/digests, and results
from that branch before closing the gate.

### Tasks

- [ ] **[SPIKE] KVM:** on the target EU dev box, record CPU virtualization
  flags, loaded `kvm`/`kvm_amd` modules, ownership/mode of `/dev/kvm`, and a
  successful non-root KVM open from the service identity.
- [ ] **[SPIKE] Firecracker:** boot the CI-selected Firecracker/jailer, guest
  kernel, and rootfs; prove host and guest kernel identities differ; record the
  VMM binary digest, boot command/config digest, console-ready timestamp, and
  clean teardown.
- [ ] **[SPIKE] SeaweedFS dual access:** start master, volume, filer, and S3
  gateway; write a file through the FUSE/POSIX view and read the same bytes and
  size through S3, then write a second version through S3 and observe it through
  POSIX.
- [ ] **[SPIKE] SeaweedFS durability features:** prove bucket versioning,
  version enumeration/recovery, a scoped cross-prefix denial, and an event
  notification for the S3-side write.
- [ ] Record whether the intended Kata release supports the selected
  Firecracker backend and host kernel without a downstream patch. A required
  patch is a named go/no-go decision, not an implicit local modification.
- [ ] Capture the minimum reproducible cohort manifest: host firmware and
  microcode, OS/kernel, containerd, Kata, Firecracker/jailer, guest
  kernel/rootfs, guest daemon placeholder, SeaweedFS components, OCI image, and
  network/storage policy digests.
- [ ] Publish a short Gate 0 report under `docs/issues/1081/evidence/` that links
  the spike commit and labels every observation `passed`, `failed`, or
  `unproven`.

### Acceptance

- [ ] `/dev/kvm` is usable by the intended service identity without exposing it
  inside a guest.
- [ ] The pinned Firecracker binary boots the pinned guest and exits without an
  orphan VMM, jailer, tap device, namespace, or disk.
- [ ] SeaweedFS demonstrates same-file S3+POSIX visibility, version recovery,
  scoped denial, and notifications; no result is inferred from documentation
  alone.
- [ ] The exact cohort manifest and redacted evidence are reproducible by a
  second operator.
- [ ] Any failed or unproven load-bearing item blocks the owned path. It does
  not authorize a runsc, runc, local, direct, or other shared-kernel fallback.

## Phase 1 — provision the single-box cohort

**Effort:** 2–3 engineer-days, plus provider lead time.

The current dev/spike box already has an OS, kernel, and containerd. Treat
those as inputs to verify and pin, not as evidence that the production host is
qualified. A newly ordered production host is provisioned from the resulting
reviewed baseline.

### Host choice

Use a Hetzner **AX102** in an admitted EU region as the M0 reference host:
AMD Ryzen 9 7950X3D (16 cores/32 threads), 128 GB DDR5 ECC, 2×1.92 TB NVMe,
and a 1 Gbit unmetered uplink. This is the finalized
[cost-model](references/sandbox-cost-model.md) baseline: after reserving about
16 GB for the host, RAM permits roughly 50 concurrent 1-vCPU / 2 GiB micro-VMs
with CPU burst headroom, while included egress protects the managed-to-owned
crossover calculation.

If that SKU or admitted region is unavailable, use OVH **ADVANCE-2** (EPYC
4344P, 8 cores/16 threads, 64 GB RAM, unmetered bandwidth) only after rerunning
capacity and crossover assumptions; its lower RAM ceiling makes it a fallback,
not an equivalent cohort.

### Tasks

- [ ] Provision the AX102 in the approved EU region with hardware
  virtualization enabled and current vendor firmware/microcode.
- [ ] Pin a minimal Ubuntu 24.04 LTS host image and the exact supported kernel
  proven by Gate 0. Disable unattended replacement of cohort-defining packages;
  security updates advance through a new qualified cohort.
- [ ] Verify the already-present containerd installation, cgroup v2, time sync,
  IOMMU/KVM state, filesystem mounts, and service identity. Record exact
  versions and configuration digests.
- [ ] Reserve host capacity before guest admission: at least 16 GB RAM, CPU for
  containerd/Kata/SeaweedFS/monitoring, PID and disk headroom, and an emergency
  drain margin. Make admission depend on reserve, not only guest-requested
  limits.
- [ ] Separate OS/runtime state, SeaweedFS M0 data, and per-VM scratch/backing
  directories across explicit filesystems/quotas. Guest-visible storage is
  attached as per-VM block/FUSE data, never as a host bind path.
- [ ] Restrict SSH and management ingress to the operator/control network;
  disable public runtime sockets and firewall containerd, Kata, Firecracker,
  SeaweedFS master/filer/admin, and node-management endpoints.
- [ ] Create the sandbox-node service identity with only the permissions needed
  for containerd/Kata, networking, and per-VM storage. Do not place a signing
  root, reusable customer/model credential, transcript/session store, or
  shared plaintext tenant workspace on the host.
- [ ] Automate the host baseline as reviewed configuration, then prove a fresh
  reprovision produces the same cohort digest.

### Acceptance

- [ ] Host inventory matches the approved SKU, region, firmware, kernel, and
  containerd manifest.
- [ ] Admission refuses work when host reserve, disk reserve, KVM readiness, or
  a required service is below policy.
- [ ] A port/socket and filesystem audit finds no public runtime control API,
  no control-plane secret, no shared tenant workspace path, and no unexpected
  privileged service.
- [ ] Reprovisioning is documented and repeatable; configuration drift produces
  an unqualified/fail-closed state.

## Phase 2 — Kata + Firecracker isolation runtime

**Effort:** 4–6 engineer-days.

### Tasks

- [ ] Install CI-pinned Kata Containers artifacts and the CI-pinned
  Firecracker/jailer. Verify signatures/checksums before placement on the host.
- [ ] Register one explicit containerd runtime handler / RuntimeClass,
  `kata-fc`, whose server-owned configuration selects Firecracker and the pinned
  guest kernel/rootfs. Do not accept a caller-selected handler, hypervisor,
  image tag, kernel, device, or VM spec.
- [ ] Build and admit the workload OCI image by digest. Launch it through
  `kata-fc` and collect process evidence showing the VMM is the pinned
  Firecracker binary—not QEMU, Cloud Hypervisor, runc, or runsc.
- [ ] Prove two simultaneous sandbox requests create two VMM processes, two
  guest kernel identities, distinct network namespaces/tap devices, distinct
  block devices, and no shared writable rootfs.
- [ ] Apply fixed server-side CPU, memory, PID, lease, output, local-disk, and
  concurrency profiles. Couple guest limits with host cgroup and admission
  ceilings so an uncooperative guest cannot consume host reserve.
- [ ] Create per-microVM networking with egress denied by default. Allow only
  the selected tenant SeaweedFS endpoint and required port set; explicitly deny
  host management addresses, metadata/link-local ranges, private networks, the
  containerd socket, and sibling guest networks.
- [ ] Use a non-network host-to-guest control channel supported by the admitted
  Kata/Firecracker stack (prefer vsock) for the guest daemon. Do not expose a
  guest-daemon management port to tenant egress or the public network.
- [ ] Measure cached-image cold boot and subsequent warm boot with at least 30
  samples each. Record p50/p95/max from create request to guest-daemon ready,
  plus teardown time and failure rate. Keep Blaxel as the serving path until
  the measured latency is accepted for canary traffic.
- [ ] Exercise forced termination at each create step and reconcile leaked
  containers, VMMs, jailers, namespaces, taps, cgroups, disks, credentials, and
  handles.

### Acceptance

- [ ] OCI image -> `kata-fc` -> pinned Firecracker -> guest-daemon-ready succeeds
  reproducibly, with exact binary/configuration/image digests in evidence.
- [ ] Two concurrent tenants have separate hardware micro-VM and guest-kernel
  identities; neither guest sees `/dev/kvm`, host paths, host sockets, sibling
  devices, or sibling networking.
- [ ] No egress succeeds before policy installation; afterward only the
  selected SeaweedFS endpoint succeeds.
- [ ] Cold/warm boot and teardown distributions are attached to the cohort;
  measurements are invalidated when a load-bearing pin changes.
- [ ] Partial creation and forced-kill tests converge to zero orphans within the
  documented cleanup bound.

## Phase 3 — SeaweedFS `/workspace` and local `/scratch`

**Effort:** 5–8 engineer-days.

### Tasks

- [ ] Deploy pinned SeaweedFS master, volume, filer, and S3 gateway components
  in the EU perimeter with separate data/config paths, health checks, audit
  logs, and non-public administration endpoints.
- [ ] Define one tenant bucket and a non-guessable workspace prefix beneath it.
  The management plane, not the sandbox node, owns bucket creation, policy, and
  credential issuance.
- [ ] Issue renewable short-lived S3/Filer credentials bound to tenant,
  workspace prefix, required actions, sandbox lease, and the admitted endpoint.
  Deny bucket/IAM/versioning/retention mutation, historical-version deletion,
  listing outside the prefix, and all cross-tenant access.
- [ ] Enable and verify S3 versioning, object/access events, retention where
  selected, backup, restore, and take-your-data-out for tenant buckets.
- [ ] Mount the tenant's SeaweedFS namespace inside the guest at `/workspace`
  through the admitted FUSE path. Any guest `/dev/fuse` access remains inside
  the micro-VM boundary; no host workspace directory is bind-mounted.
- [ ] Define and test the supported cross-interface semantics for create,
  read/write, stat, recursive mkdir, rename, unlink, version lookup, and
  concurrent-writer conflict. Unsupported POSIX behavior must return a stable
  error rather than silently corrupt data.
- [ ] Attach an encrypted or ephemeral per-VM local block device at `/scratch`
  for git, SQLite, package installs, virtualenvs, `node_modules`, and builds.
  Enforce byte/inode quotas and destroy the per-VM key/backing at teardown.
- [ ] Implement bounded zip copy-in to `/scratch/inputs/<requestId>`: cap archive
  bytes, expanded bytes, entry count, path depth, and compression ratio; reject
  absolute paths, `..`, duplicate/conflicting names, device files, and symlink/
  hardlink escapes; extract without a host bind mount.
- [ ] Implement explicit artifact publication from admitted `/scratch` output
  paths into `/workspace`. Never blanket-sync `/scratch`.
- [ ] Reconcile guest inotify events with SeaweedFS/S3 notifications: dedupe by
  source identity/version, assign a monotonic workspace cursor, and trigger an
  authoritative tree/version reconciliation on a detected gap.

### Acceptance

- [ ] POSIX write -> S3 read and S3 write -> POSIX read return identical bytes;
  rename/stat/mkdir/delete behavior matches the documented supported set.
- [ ] Write -> destroy -> recreate -> read preserves `/workspace`, its object
  versions, and tenant ownership; `/scratch` and copied transient inputs do not
  survive.
- [ ] Credential expiry and every cross-bucket/prefix/action negative are
  denied and audited. A tenant cannot list, read, overwrite, infer, or delete a
  sibling's keys or versions.
- [ ] Zip copy-in handles a large multi-file fixture in one upload/extract
  operation and rejects the traversal/link/zip-bomb corpus without writing
  outside `/scratch/inputs/<requestId>`.
- [ ] Backup restore recovers a tenant workspace and visible version history on
  a clean filer/volume target.

## Phase 4 — guest daemon and `SandboxProviderV1` provider

**Effort:** 12–18 engineer-days.

### Guest daemon tasks

- [ ] Define a small, versioned, bounded host/guest protocol for health, exec,
  cancellation, filesystem operations, watch/reconnect, zip copy-in/extract,
  artifact publication, and shutdown. Bind it only to the Phase 2 control
  channel.
- [ ] Run the daemon under a minimal guest supervisor. Perform privileged boot
  setup once, then execute tenant commands and filesystem operations as the
  admitted non-root workload UID/GID.
- [ ] Implement exec with cwd confinement to `/workspace` or admitted
  `/scratch` paths, environment bounds, timeout, `AbortSignal` cancellation,
  process-group kill, heartbeat, stdout/stderr chunking, total output ceiling,
  truncation, exit code, and duration.
- [ ] Implement bounded text/binary read/write, list, stat, unlink, rename, and
  recursive mkdir. Resolve paths beneath the selected guest root and reject
  traversal and symlink races in the guest adapter.
- [ ] Implement a single shared inotify source for `/workspace` plus only
  explicitly admitted artifact/output paths under `/scratch`. Normalize create,
  write, unlink, rename, and mkdir into workspace-relative events.
- [ ] Persist/replay the last bounded event window, accept reconnect from the
  last cursor, deduplicate source events, and emit `resync-required` before live
  delivery after overflow, restart, or cursor/source gap. Periodic polling is
  not a correctness path.
- [ ] Implement bounded zip receive/extract and explicit scratch-artifact
  publication using the storage rules from Phase 3.

### Provider and mode tasks

- [ ] Add `packages/boring-sandbox/src/providers/firecracker-kata/` with
  `createFirecrackerKataWorkspace.ts`, the paired Sandbox implementation, the
  provider factory, guest client, lifecycle/handle logic, stable errors, and
  focused tests. Export the provider subpath from the package and build config.
- [ ] Add `packages/agent/src/server/runtime/modes/firecracker-kata.ts` using the
  existing provider-mode adapter so Workspace and Sandbox always share one
  runtime handle and `/workspace` runtime context.
- [ ] Register `firecracker-kata` in `SandboxProviderId`, `RuntimeModeId`,
  `ExtractedSandboxProviderIdV1`, `PROVIDER_CAPABILITIES`, `MODE_TO_PROVIDER`,
  `resolveMode`, exports, and matrix/mode tests. Declare `microvm` isolation,
  durable filesystem, real exec, watch, and runtime-image facts only after the
  cohort reports them; set the paired mode's workspace filesystem capability
  to `strong`. Do not disturb runsc or the planned Blaxel provider.
- [ ] Keep production app selection consistent with
  [plan-sbx14.md](plan-sbx14.md): `BORING_AGENT_MODE=remote-worker` remains the
  public control-plane path when the micro-VM host is remote. The
  `firecracker-kata` mode/provider is the worker/node implementation and a
  direct injected test/operator mode; it is never auto-detected.
- [ ] Map guest events onto `Workspace.watch()` and `resync-required` control
  events so the existing workspace file tree stays live. Multiple subscribers
  share one underlying guest stream.
- [ ] Implement durable handle semantics in the trusted management-plane store:
  atomically bind tenant/workspace/session to sandbox id, cohort digest, lease
  epoch, state, and credential expiry; keep logical creation time stable;
  serialize concurrent creates; and return the same live binding after a
  dropped-response retry or process restart.
- [ ] Treat process-local client objects as a cache only. On cache miss, resolve
  the durable handle, check cohort/lease/tenant health, then resume, recreate,
  fence, or return a stable unavailable result. Never reuse across an
  authorization key.
- [ ] Implement roughly 60-second idle suspend/stop, transparent resume, hard
  lease expiry, idempotent destroy, credential revocation/expiry, scratch
  discard, and orphan reconciliation behind `SandboxProviderV1` without adding
  provider-specific consumer methods.
- [ ] Emit usage facts for active sandbox-seconds, create/resume/suspend/destroy,
  boot latency, output truncation, storage bytes, event lag/gaps, and egress
  bytes, tagged by provider/cohort and joined to tenant/session in the protected
  usage ledger.
- [ ] Add contract/conformance tests at the `SandboxProviderV1`, `Workspace`, and
  `Sandbox` seams. Use a fake guest transport for deterministic unit tests and
  the real Kata/Firecracker/SeaweedFS cohort for integration tests.

### Acceptance

- [ ] A provider-neutral test performs create, bounded/cancelled exec, every
  required fs operation, zip copy-in, live watch/reconnect, idle suspend/resume,
  destroy, and recreate without importing provider SDK or VMM types.
- [ ] Exec cancellation kills the guest process group; timeout and output limits
  return stable bounded results and do not leave a background process.
- [ ] Exec-originated and external S3-originated changes update the live file
  tree without polling. Duplicates do not duplicate state, and an induced gap
  forces reconciliation before incremental delivery resumes.
- [ ] A process restart reconnects to the same authorized durable handle; a
  retry cannot create a second VM; stale/cohort-mismatched handles fail closed;
  no handle crosses tenant/workspace/session identity.
- [ ] All new shared identifiers/capabilities, provider exports, mode resolution,
  and package boundaries pass typecheck, invariant, and conformance tests.

## Phase 5 — exact-cohort qualification and rollback proof

**Effort:** 5–7 engineer-days.

### Tasks

- [ ] Generalize the existing provider-neutral qualification driver and evidence
  bundle for the Firecracker/Kata cohort. Bind evidence to all host/runtime/
  guest/storage/network/policy artifacts and reject `unproven` outcomes.
- [ ] Run the 11 hostile probes with valid positive controls before and after:
  sibling filesystem traversal, `/proc` PID enumeration, cross-sandbox signal,
  cross-sandbox ptrace, mount access, device access, process escape,
  cross-workspace network, secret access, resource ceilings, and teardown.
- [ ] Prove egress default-deny before policy, SeaweedFS-only positive access
  after policy, and denial of metadata/link-local, host management, private
  network, public internet, DNS rebinding targets, and sibling guest addresses.
- [ ] Prove fail-closed startup for missing KVM, wrong Firecracker/Kata/kernel/
  rootfs/image/policy digest, unavailable SeaweedFS, expired credential issuer,
  and failed qualification. The app may start degraded; sandbox admission must
  not fall through to runsc, local, direct, runc, or another provider.
- [ ] Prove no-host-path copy-in: inspect the admitted OCI/Kata spec and guest
  mounts, exercise malicious zip and workspace path corpora, and verify the
  guest cannot observe a host workspace, containerd socket, VMM socket, host
  device, or `/dev/kvm`.
- [ ] Exhaust CPU, memory, PID, output, scratch bytes/inodes, SeaweedFS quota,
  lease duration, per-tenant concurrency, global concurrency, and host reserve;
  verify bounded stable errors and continued service for a second tenant.
- [ ] Issue credentials to tenants A and B; prove expiry, action denial,
  cross-prefix/bucket denial, version-delete denial, and that logs/errors/events
  reveal neither secret nor sibling object identity.
- [ ] Inject failures at create, mount, credential issue/renew, exec, event
  stream, durable write, suspend, resume, destroy, and host reboot; prove
  idempotency, fencing, orphan cleanup, durable recovery, and honest errors.
- [ ] Exercise rollback: stop new owned admission, drain or hard-expire existing
  owned sessions, route new sessions to the last qualified Blaxel cohort, and
  verify the same SeaweedFS `/workspace` contents. Never move a live sandbox or
  fall back to a weaker provider.
- [ ] Redact the evidence bundle and have an independent security/spec reviewer
  verify the exact head SHA and cohort digest.

### Acceptance

- [ ] All 11 probes and positive controls pass on two simultaneous tenant
  identities; no probe is `unproven`.
- [ ] Egress, fail-closed startup, no-host-path/copy-in, quotas, credential
  isolation, failure injection, durable recovery, and rollback all pass on the
  exact admitted cohort.
- [ ] Evidence contains no host paths, host PIDs, tenant identifiers, object
  names, or secrets, and the verifier rejects a changed pin, policy, script, or
  evidence digest.
- [ ] The security/spec review is clean or every residual risk has an explicit
  owner decision. Only then is **M0 complete**.

## Phase 6 — canary and cutover behind `SandboxProviderV1`

**Effort:** 3–5 engineer-days, plus at least one production soak window.

### Tasks

- [ ] Deploy `firecracker-kata` beside the qualified Blaxel bridge in the
  provider registry. Provider choice is server configuration and cohort
  admission, never a caller field.
- [ ] Shadow non-mutating health/create-contract probes, then route trusted
  internal sessions to the owned cohort. Verify new sessions only; do not move
  a live sandbox between providers.
- [ ] Progress trusted traffic in explicit steps (operator-only -> small canary
  -> broader trusted cohort) with an abort threshold for create/exec/fs/watch
  errors, boot/resume latency, orphan rate, storage/event lag, quota pressure,
  or unexpected egress.
- [ ] Keep Blaxel admission warm and qualified. At every step, rehearse the
  Phase 5 rollback and verify SeaweedFS continuity before increasing traffic.
- [ ] Record active sandbox-seconds/hours and egress bytes from both providers,
  plus compute-host utilization and SeaweedFS cost. Reconcile the protected
  usage ledger against Blaxel billing and host/network counters.
- [ ] Dashboard the managed-to-self-host crossover using the
  [cost model](references/sandbox-cost-model.md) and its approximately **3,000
  active sandbox-hours/month** planning trigger. Treat that as a decision input,
  not an automatic switch: include measured egress, packing, HA hardware, and
  operator labor.
- [ ] After the M0 soak is clean, enable admitted multi-tenant cohorts only when
  the M1 storage/backup, monitoring, on-call, credential, and side-channel gates
  below are owned. Retain configuration-only rollback through the agreed soak.
- [ ] Publish the cutover/rollback runbook, current cohort digest, dashboards,
  alerts, ownership rota, and stop conditions before increasing public traffic.

### Acceptance

- [ ] Trusted traffic completes the full provider contract on the owned cohort
  with no cross-tenant, durability, event-stream, egress, quota, or orphan
  regression during the agreed soak.
- [ ] Active-hours and egress are queryable by time range/provider/cohort and
  attributable in the protected ledger by tenant/session/image without leaking
  those identities into public metrics.
- [ ] One configuration change stops new owned admission and routes new sessions
  to qualified Blaxel while existing sessions drain safely and `/workspace`
  remains unchanged.
- [ ] Public multi-tenant admission begins only after M1 requirements are met;
  M0 alone is not represented as HA production readiness.

## Security invariants and operability

These are continuous gates, not a final hardening pass.

### Version and supply-chain ownership

- [ ] Pin Firecracker, jailer, Kata, containerd, host/guest kernels, rootfs,
  guest daemon, OCI image, SeaweedFS, and policy/configuration by immutable
  version and digest in one cohort manifest.
- [ ] Build/sign the owned guest daemon and image reproducibly; verify artifacts
  before admission and include the qualification scripts in the evidence digest.
- [ ] Add CI jobs that detect new Firecracker/Kata/SeaweedFS releases and
  security advisories, but never auto-promote them. A pin change creates a new
  cohort, reruns Phase 5, and rolls out by canary.
- [ ] Fail admission when the installed/runtime-observed digest differs from the
  admitted manifest, even if the component reports a compatible version.

### Secret and data boundary

- [ ] Keep capability-signing roots, reusable customer/model credentials,
  tenant authorization, durable nonce/binding authority, transcripts, and
  session history on the trusted control plane—not the sandbox node.
- [ ] Give the node only the operation-scoped material required to launch the
  sandbox; give the guest only renewable, expiring tenant-prefix storage
  credentials. Redact all errors, evidence, logs, metrics, and crash dumps.
- [ ] Disable or encrypt host/guest crash dumps and swap according to the
  incident policy; securely discard per-VM scratch/backing and expired
  credential material.

### Spectre/MDS workstream

- [ ] Track Spectre/MDS-class leakage separately: current microcode, SMT/core
  scheduling or sibling isolation, tenant cohorting, measurement, host
  selection, and documented residual risk.
- [ ] Record the side-channel posture in the cohort manifest, but do not label it
  a Firecracker feature. The security owner may block M1 admission even when M0
  functional/isolation qualification passes.

### Monitoring, recovery, and HA

- [ ] Alert on KVM/runtime readiness, available host reserve, micro-VM lifecycle
  errors/orphans, boot/resume latency, quota kills, credential failures,
  SeaweedFS master/volume/filer/S3 health, disk/inode pressure, replication and
  backup lag, event cursor gaps/reconciliation, egress anomalies, and usage-ledger
  reconciliation.
- [ ] Run synthetic create/exec/fs/watch/destroy probes through
  `SandboxProviderV1`; a green process/port check is insufficient.
- [ ] Document that M0 is one compute and storage failure domain. It is allowed
  for qualification and trusted canaries only; Blaxel is the compute rollback.
- [ ] Before M1 durable public admission, place SeaweedFS master/filer metadata
  and volume replicas/backups across approved independent failure domains, test
  restore and loss of one component, and define RPO/RTO/on-call ownership.
- [ ] M2 adds at least two owned compute hosts, failure-domain-aware placement,
  drain/replacement, capacity spillback to Blaxel, and fleet-wide orphan
  reconciliation. It must preserve the M0 qualification and storage contracts.

## M0 definition of done — single-box qualified

M0 is done only when every item below is true on one exact, immutable AX102
cohort:

- [ ] Gate 0 has committed, reproducible KVM, Firecracker boot, and SeaweedFS
  dual-access/versioning/notification evidence.
- [ ] Containerd launches the admitted OCI image through Kata's `kata-fc`
  handler and the observed VMM is the pinned Firecracker binary.
- [ ] Two concurrent tenant identities receive distinct micro-VMs, guest
  kernels, networking, devices, credentials, handles, `/workspace` namespaces,
  and ephemeral `/scratch`.
- [ ] `SandboxProviderV1` passes create, bounded/cancelled exec, fs operations,
  zip copy-in, live inotify/S3 file events with gap recovery, idle
  suspend/resume, durable-handle restart/retry, idempotent destroy, and durable
  write/destroy/recreate/read.
- [ ] All 11 hostile probes, egress allowlist negatives, fail-closed startup,
  no-host-path/copy-in checks, quotas/host reserve, credential isolation,
  partial-failure cleanup, and rollback pass with no `unproven` result.
- [ ] Exact pins, boot/teardown latency, active sandbox-seconds, egress, storage,
  event health, and orphan counts are observable; alerts and operator runbooks
  exist.
- [ ] Evidence is bound to the exact code SHA and cohort digest, redacted, and
  independently security/spec reviewed.
- [ ] Rollback routes new work to qualified Blaxel without changing the
  SeaweedFS namespace, moving a live sandbox, or selecting a weaker provider.
- [ ] The remaining limitations are stated plainly: single-box compute/storage
  HA and public multi-tenant admission are M1, while multi-host scheduling and
  snapshot/fork are M2.

## Proof commands for the implementation PRs

Each implementation slice records exact commands and artifacts for its own
head SHA. At minimum, the final M0 proof runs:

```sh
pnpm --filter @hachej/boring-sandbox lint
pnpm --filter @hachej/boring-sandbox test
pnpm --filter @hachej/boring-agent typecheck
pnpm lint:invariants
git diff --check
```

The host-bound integration, storage, and qualification commands are added by
Gate 0/Phases 2–5 and must emit a redacted evidence bundle keyed to the exact
cohort digest. Unit tests or mocked transports alone cannot complete M0.

## Out of scope

- Reconsidering the decisions in `plan-sbx14.md` or `tech-choice.md`.
- A raw Firecracker lifecycle/fleet orchestrator in place of Kata.
- gVisor, runsc, runc, or plain containers as the public tenant boundary.
- Provider-selected or caller-selected images, VMMs, RuntimeClasses, network
  policies, devices, host paths, credentials, or qualification overrides.
- Periodic filesystem polling as a correctness mechanism.
- Blanket synchronization or durability of `/scratch`.
- M2 snapshot/fork, memory restore, bin packing, locality scheduling, or a
  Firecracker-to-Cloud-Hypervisor fleet migration.
