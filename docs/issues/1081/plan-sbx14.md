---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-12
revision: r5-final-bridge-to-owned-fleet
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — SBX1.4 sovereign sandbox plan (LEAN V1)

## v1 in a nutshell

V1 ships on a swappable `SandboxProviderV1`: bridge immediately on Blaxel's
hardware-isolated microVM service while building the end state—Kata Containers
launching pinned Firecracker microVMs on shared EU bare-metal KVM, with
self-hosted SeaweedFS exposing the same plain tenant files through both POSIX
FUSE and S3. Every sandbox has its own hardware boundary; `/workspace` is
durable and user-browsable, `/scratch` is fast local POSIX storage, and a guest
daemon streams live file events without polling. Per-second billing, 60-second
idle suspension, and pre-warmed pools keep the bridge cheap; active
sandbox-hours and egress are metered from day one so compute can cut over by
configuration near 3,000 active sandbox-hours/month while SeaweedFS, the guest
contract, and the product data model stay unchanged.

This is the final execution plan for PR #1220. It supersedes both the old
single-tenant gVisor plan and the intermediate "self-host first, generic S3
sync-hybrid" plan. The rationale and final provider capability contract are in
[tech-choice.md](tech-choice.md). [api-spec.md](api-spec.md) is the earlier
remote-worker baseline; its polling/Kata-only details are superseded here and
must be reconciled before implementation. The evidence is in:

- [sandbox engine security evaluation](references/sandbox-engine-security-eval.md);
- [managed provider comparison](references/managed-sandbox-providers-comparison.md);
- [sandbox cost model](references/sandbox-cost-model.md).

The comparison was captured before the owner's direct Blaxel confirmation. The
controlling decision for this plan is that Blaxel's isolation is confirmed as a
hardware microVM class suitable for the bridge; the API-fit spike below still
has to qualify its exact capabilities.

## Decided architecture

```text
Seneca public edge / trusted control plane
        |
        | SandboxProviderV1: create, exec, fs, watch, suspend/resume, destroy
        v
  compute selected by configuration
        |
        +-- bridge: Blaxel microVMs (primary) or E2B Firecracker (alternate)
        |
        +-- target: containerd -> Kata Containers -> Firecracker microVM
                                      on shared EU bare-metal KVM
        |
        +-- sandbox A: guest kernel A, /workspace A, /scratch A
        +-- sandbox B: guest kernel B, /workspace B, /scratch B
                            |
                            +--> self-hosted EU SeaweedFS
                                 one plain-file namespace
                                 +-- POSIX FUSE mount
                                 +-- S3 API + version history/events
```

The governing isolation rule is:

> **Share the host, never the boundary.**

Many tenant microVMs share each box for density. Each sandbox has a separate
guest kernel and hardware-KVM boundary. A standing VM per tenant is neither the
security model nor the cost model.

The primary isolation evidence is [arXiv:2606.08433](https://arxiv.org/abs/2606.08433).
Its measurements are useful, but its threat model is single-tenant-scoped and
explicitly excludes multi-tenant SaaS. It therefore cannot justify a shared
host-kernel tenant boundary for this public service.

## V1 product invariants

### Isolation and operator ownership

1. The owned target launches one Firecracker microVM per sandbox through Kata
   Containers. Firecracker is the hardware/KVM boundary; Kata is the adopted
   OCI/containerd runtime wrapper. We adopt Kata rather than build a raw
   Firecracker lifecycle product.
2. gVisor may later run inside a Firecracker guest as defense-in-depth. It is
   never the tenant boundary. This is motivated by Firecracker's lack of an
   observable upstream fuzzer and gVisor's continuous fuzzing, not by a claim
   that either layer is invulnerable.
3. `microsandbox`/libkrun is rejected for escape-critical v1: weak measured
   seccomp, no useful public fuzz/CVE signal, and pre-1.0 maturity.
4. The operator owns the Firecracker, jailer, kernel, rootfs, guest-daemon,
   Kata, and containerd pins in CI. A managed or wrapper default is never
   inherited silently.
5. Spectre/MDS-class leakage is a separate security workstream covering current
   microcode, core scheduling/sibling isolation, cohort selection, measurement,
   and documented residual risk.

### Storage is a product pillar

Self-hosted, Apache-2.0 SeaweedFS is the durable EU-sovereign data substrate.
It exposes both an S3 API and a POSIX FUSE mount over the same plain files:

- durable `/workspace` is the tenant-scoped SeaweedFS mount;
- fast local `/scratch` is for SQLite, `npm`/`node_modules`, virtualenvs, git,
  builds, and other POSIX-heavy or high-churn work;
- tenant bucket/prefix isolation, S3 versioning, event logging, and optional
  retention policy provide history and audit;
- short-lived credentials are scoped to the tenant prefix and required actions;
- users can read and sync their own CSV, Parquet, JSON, source, and artifacts
  through ordinary S3 tools or a Dropbox-like product surface;
- open formats and direct access preserve bring-your-own-data and
  take-your-data-out.

This is the self-hosted equivalent of Blaxel Agent Drive: one user-readable
plain-file namespace, not a block image hidden behind the sandbox provider.

Rejected storage shapes:

- **naive s3fs as the primary working filesystem:** incomplete POSIX behavior;
  rename is copy/delete and random writes, append, and locking are unsafe;
- **block volumes, JuiceFS, Turso AgentFS, or a block image as the durable
  product:** POSIX-capable, but user files are opaque or chunked inside a
  container and are not directly browsable through S3;
- **MinIO:** S3-first with weak native POSIX over the same plain files, so it
  does not satisfy the two-interface product requirement.

Blaxel's regular Volume is an explicit bridge-only exception: it is durable but
opaque and not directly user-accessible. It may carry early bridge sessions
while the provider spike lands. Blaxel Agent Drive is private preview and is
deferred. As soon as the storage pillar is enabled, bridge sandboxes mount our
SeaweedFS endpoint; that same SeaweedFS namespace remains in place when compute
moves to E2B or the owned Kata/Firecracker fleet.

The transition is explicit: Blaxel Volume is phase-0 persistence only. Before a
workspace enters the durable product tier or its compute can cut over, copy its
required files into SeaweedFS and verify file count, content digests, and
version visibility. After SeaweedFS activation, no provider-specific volume is
authoritative; it is disposable cache/bridge state only.

### Copy-in and live file events

Transient prompt context, selected project files, uploads, and query results do
not arrive as N per-file API calls or a host bind mount. The provider creates
one bounded zip bundle, copies it into the guest, then extracts it: two calls,
independent of file count. Inputs are placed in an unsynced transient area and
securely discarded at teardown.

The guest daemon uses inotify on `/workspace` for guest-originated durable-file
changes and on explicitly admitted artifact/output paths under `/scratch`.
`/scratch` is never blanket-synchronized. Publishing a scratch artifact copies
it into the tenant's `/workspace`, then emits the durable-file and inbox events.
The daemon:

1. streams ordered file-change events over the provider watch stream so the
   workspace file tree is live;
2. triggers event-driven publication/synchronization from local work to the
   durable SeaweedFS namespace;
3. routes completed artifacts to the workspace inbox as human-intention items.

External S3-side changes enter through SeaweedFS/S3 event notifications. Source
events may be duplicated or out of order. The provider deduplicates by source
event/version identity, assigns a monotonic workspace cursor after ingestion,
and emits an at-least-once normalized stream. Clients reconnect from their last
cursor. A detected cursor/source gap triggers an authoritative filesystem and
object-version reconciliation before live delivery resumes. That event-driven
gap recovery is not periodic polling; polling is not an accepted correctness
path.

### SandboxProviderV1 capability contract

Provider-specific compute and persistence mechanics stay behind
`SandboxProviderV1`. V1 requires these semantic capabilities:

| Capability | Required behavior |
| --- | --- |
| create | Idempotent by request/session identity; one sandbox per user session; record tenant and `externalId` tags |
| exec | Bounded command, output, time, CPU, memory, PID, and disk behavior |
| files | Bounded read/write/list/stat plus zip copy-in and artifact copy-out |
| file-events / watch stream | Live inotify plus external S3 notifications; at-least-once events normalized behind a monotonic cursor, dedupe and gap reconciliation; no polling fallback |
| suspend/resume | Idle auto-suspend after about 60 seconds and fast resume without crossing the authorization/session key |
| destroy | Idempotent teardown, credential revocation/expiry, local scratch discard, and orphan recovery |
| health/qualification | Stable unavailable/unqualified states; exact provider/isolation/cohort facts |
| usage | Active sandbox-seconds, resume/suspend counts, storage, and egress bytes tagged by tenant/session/provider |

The contract also carries an isolation class. Untrusted public traffic is
admitted only to a hardware-microVM class. A provider swap is configuration,
not a change to Seneca's app-facing runtime contract.

### Provider-agnostic runtime patterns

The provider layer adopts the useful patterns validated by getnao/BoxLite and
Blaxel's operating guidance, without adopting BoxLite's libkrun boundary:

- authorization-keyed session pool with one sandbox per user session;
- roughly 60-second idle auto-suspend and fast resume;
- pre-warmed pools for large/heavy images;
- tenant plus `externalId`/session tagging for lifecycle, audit, and cost;
- idempotent create/retry behavior;
- network off by default, with an explicit egress allowlist containing only the
  selected SeaweedFS storage endpoint in v1;
- optional-runtime graceful degradation: the host application may start when a
  provider is unavailable, but sandbox admission fails closed and never falls
  through to local, direct, runsc, gVisor, or another weaker provider.

## Execution shape

```text
Gate 0
  |-- adopt bridge: Blaxel API-fit spike -> bridge production cohort
  `-- build target: SeaweedFS + Kata/Firecracker single host
                              |
                         qualify exact cohort
                              |
             meter active-hours + egress; shadow/canary
                              |
                  cut over near crossover; keep rollback
```

The bridge removes launch pressure; it does not replace the owned v1 target.
The owned path stays active in parallel.

## Gate 0 — prove the seams before committing

Gate 0 is a short evidence phase, not an engine bake-off.

### Bridge gate

Run a Blaxel spike against the actual `SandboxProviderV1` capability matrix.
Hardware microVM-class isolation is owner-confirmed; the spike verifies API
fit: idempotent create, tenant/`externalId` tags, bounded exec/fs, zip copy-in,
live watch integration, suspend/resume latency, 60-second idle policy, volume
lifecycle, network-off/S3-only allowlisting, stable errors, usage/egress meters,
and teardown/orphan behavior. Record gaps rather than leaking Blaxel concepts
through the provider interface.

If Blaxel fails a required capability, qualify E2B as the alternate bridge.
E2B's vendor-confirmed Firecracker boundary and external S3 mounts pass the
isolation/storage-shape preconditions; its roughly $150/month base price is an
accepted fallback cost.

### Owned-target gate

On one disposable EU bare-metal KVM host, prove that the exact Kata
RuntimeClass/configuration launches the CI-pinned Firecracker VMM—not QEMU or
Cloud Hypervisor—and that two concurrent tenant identities receive distinct
microVMs and guest kernels. Qualify SeaweedFS's same-file S3+FUSE semantics,
versioning, prefix credentials, notifications, backup/recovery, and EU data
perimeter. Prove local `/scratch` behavior for SQLite, git, package installs, and
builds, plus zip copy-in and guest-daemon inotify.

Gate 0 retains all 11 hostile qualification assertions and proves default-deny
egress, storage-endpoint-only access, no metadata/private-network reachability,
no host paths or `/dev/kvm` in guests, quota/host reserve, cleanup under partial
failure, scoped-credential expiry, cross-prefix denial, file-event continuity,
and fail-closed startup. Record exact pins, microcode, commands, and redacted
evidence.

Gate 0 failure does not authorize a shared-kernel fallback. It either blocks
the owned cohort, sends wrapper-specific findings back to the Kata integration,
or keeps traffic on an already qualified hardware-isolated bridge.

## Build/adopt — bridge now, owned target in parallel

### Adopt the short-term bridge

1. Implement the Blaxel adapter behind `SandboxProviderV1`; do not expose its
   SDK types to consumers.
2. Use Blaxel regular Volume for bridge-only durability initially. Treat its
   opacity as a known temporary product gap, not the end-state storage model.
3. Mount the owned SeaweedFS/S3 namespace in the bridge sandbox when the storage
   pillar is enabled. Do not wait for private-preview Agent Drive.
4. Enable session pooling, 60-second idle suspension, heavy-image pre-warming,
   tenant/session tags, idempotent create, S3-only egress, graceful degradation,
   and active-hour/egress instrumentation from the first production cohort.
5. Keep E2B adapter qualification available as the alternate. Modal, Daytona,
   and Beam remain trusted-pilot-only because their shared-kernel or gVisor
   boundaries do not meet escape-critical admission.

### Build the owned v1 target

1. Deploy self-hosted SeaweedFS in the admitted EU perimeter with S3 gateway,
   FUSE mounts, versioning, event notifications, tenant-prefix policy, backup,
   and user access/export paths.
2. Provision an EU bare-metal KVM host with containerd, Kata, pinned
   Firecracker/jailer, pinned guest kernel/rootfs, guest daemon, per-microVM
   networking, encrypted or ephemeral local scratch, and secure discard.
3. Implement the Kata/Firecracker provider adapter and guest daemon for exec,
   files, zip copy-in, watch stream, storage notifications, sync/publication,
   artifact-to-inbox routing, suspend/resume, destroy, and usage meters.
4. Admit only server-selected images/resource/network profiles. Callers cannot
   select RuntimeClass, VMM, kernel, arbitrary image, device, host path, nested
   KVM, credential scope, or qualification override.
5. Keep the management/control plane off the sandbox host. The host contains no
   signing root, reusable customer/model credential, transcript/session store,
   shared plaintext workspace tree, or other-tenant data. Unavoidable local
   backing is per-microVM encrypted or ephemeral, inaccessible to sibling
   guests, and securely discarded.

## Qualify — exact cohort, not a brand name

Qualification runs on the exact bridge or owned cohort and must pass before
untrusted traffic:

- distinct hardware microVM and guest-kernel identity per sandbox;
- current owned pins and a CI signal for upstream Firecracker updates/advisories;
- all 11 hostile probes through a provider-neutral driver;
- fail-closed startup and no weak-provider fallback;
- default-deny egress with only the SeaweedFS endpoint allowlisted;
- tenant-prefix credential expiry and cross-tenant negatives;
- no control-plane secrets, other-tenant data, host path, runtime socket, or
  guest `/dev/kvm` exposure;
- CPU, memory, PID, output, scratch, storage, lease, concurrency, and host-reserve
  quotas;
- idempotent create, retry, suspend/resume, expiry, destroy, orphan cleanup, and
  rollback behavior;
- SeaweedFS S3/FUSE same-file visibility, version history, event notifications,
  backup/restore, and take-your-data-out;
- live inotify-to-watch-stream behavior, monotonic cursors, dedupe, reconnect
  continuity, event-gap reconciliation, external S3 change delivery,
  event-driven publication, and artifact-to-inbox routing;
- zip bundle copy-in/extract and secure transient-input discard;
- concurrent tenant/session pool isolation and pre-warmed-image isolation;
- active sandbox-seconds and egress measurements reconciled to provider bills or
  host/network counters.

The security evidence is attached to the exact admitted revisions and expires
when a load-bearing pin or policy changes.

## Cutover and rollback

Start production on Blaxel, the cheapest qualified hardware-isolated bridge,
after its cohort qualifies. At the pilot and
growth assumptions in the [cost model](references/sandbox-cost-model.md), Blaxel
is effectively free at about $4–41/month, with free egress, while one Hetzner AX102 is roughly
$278/month flat. Per-second billing plus a 60-second idle policy avoids the
roughly 20x waste of per-hour rounding.

From day one, meter active sandbox-hours and egress bytes by tenant, session,
image, and provider. Begin owned-host canaries before sustained usage reaches
the economic trigger. The raw compute crossover is about 3,357 active
sandbox-hours/month; use **approximately 3,000 active sandbox-hours/month** as
the planning trigger, then adjust for measured egress, utilization, HA, and ops
labor. Self-hosting can win earlier on egress because the reference AX102 has
unlimited included egress.

Cutover is a configuration change behind `SandboxProviderV1`:

1. qualify the owned cohort and SeaweedFS against the same contract;
2. shadow non-mutating probes and run two-tenant canaries;
3. stop new bridge admission, allow or checkpoint live sessions, and route new
   sessions to the owned cohort;
4. prove fresh create/exec/files/watch/suspend/resume/destroy and user-visible
   SeaweedFS continuity;
5. retain the qualified Blaxel cohort as rollback until the owned soak passes.

Rollback stops new owned admission, drains or checkpoints live sessions, and
returns new sessions to the last qualified hardware-microVM bridge. It never
falls back to a shared-kernel provider. No live sandbox changes provider.

## V1 to v2 — fleet progression, no storage/data-product re-platform

V2 keeps the `SandboxProviderV1` contract, hardware-microVM boundary, guest
shape, SeaweedFS namespace, user-visible S3/POSIX files, and security invariants.
It adds an owned multi-host fleet with block and memory snapshot-fork, warm
pools, bin packing/draining, and snapshot-locality-aware scheduling. Cloud
Hypervisor is the likely VMM implementation for that owned fleet because of its
device/fuzzing posture, qualified behind Kata/provider seams. That is a real
Firecracker-to-Cloud-Hypervisor VMM engine swap behind the provider boundary.

The owner's "no engine change" invariant means no product contract, storage
engine/data model, or isolation-class change. The VMM implementation may change
behind the seam, but the hardware isolation class, provider semantics, guest
API, and SeaweedFS data plane do not. It follows the
OpenAI [From fork() to Fleet](https://www.youtube.com/watch?v=OqM67QG_Ikk)
progression without making snapshot machinery a v1 launch dependency.

## Explicit non-goals

- One standing VM per tenant or workspace.
- gVisor, Modal, Daytona, Beam, runc, or plain containers as the tenant boundary.
- Waiting for Blaxel Agent Drive private preview.
- Naive s3fs execution or opaque/chunked durable storage as the product model.
- A raw Firecracker lifecycle/orchestrator built from scratch in v1.
- Multi-host placement, snapshot-fork, memory restore, locality scheduling, or
  automatic fleet admission in v1.
- Public exposure of the root-equivalent worker/VMM API.
- Treating Spectre/MDS mitigations as properties of Firecracker.

## Review and owner gate

Every implementation slice receives independent standards and security/spec
review on its exact head SHA. PR #1220 is a docs-only owner gate and must not be
merged by this plan. Owner approval authorizes Gate 0, the qualified managed
bridge, and the owned Kata+Firecracker+SeaweedFS v1 path; production traffic
still requires the qualification and rollback criteria above.
