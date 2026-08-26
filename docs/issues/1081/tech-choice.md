# Sovereign Sandbox Service — final technology decision record

Status: FINAL OWNER DECISION. Date: 2026-08-12.
Scope: issue #1081 and PR #1220.

This record supersedes the single-tenant gVisor design and the intermediate
"self-host first, generic S3 sync-hybrid" design. The sovereign architecture is
[sandbox-sovereign-design.md](sandbox-sovereign-design.md), the implementation
plan is [sandbox-sovereign-build.md](sandbox-sovereign-build.md), and the controlling evidence is the
[sandbox engine security evaluation](references/sandbox-engine-security-eval.md),
[managed provider comparison](references/managed-sandbox-providers-comparison.md),
and [sandbox cost model](references/sandbox-cost-model.md).

The managed comparison recorded Blaxel's hardware boundary as an open vendor
question. The owner has since confirmed that Blaxel's isolation is an acceptable
hardware microVM class. That final confirmation controls this record; the
Blaxel API-capability fit still requires the Gate 0 spike.

## Product and security thesis

Build a sovereign sandbox and file product on EU-operated infrastructure:

> **Share the host, never the boundary.**

Many sandboxes share a host for density. Every public tenant sandbox receives
its own guest kernel and hardware-KVM microVM boundary. The tenant's durable
files remain plain, browsable, and portable through both POSIX and S3
interfaces. V1 deliberately has no object version history. Compute can move
between qualified providers without moving or reformatting the user's data.

## Decision 1 — tenant boundary: a hardware microVM per sandbox

### Evidence

[AI Code Sandboxes: A Comparative Security Study, Part 1,
arXiv:2606.08433](https://arxiv.org/abs/2606.08433) contains useful engine
measurements, but explicitly scopes its conclusions to a single-tenant operator
and excludes multi-tenant SaaS. Its favorable gVisor result therefore cannot
authorize a shared-host-kernel boundary for Seneca's untrusted public tenants.

Firecracker gives each sandbox its own guest kernel behind KVM. In the study it
had the strongest measured microVM seccomp posture, while also showing two 2026
escape-class advisories and no observable upstream fuzzer. Hardware isolation is
the correct boundary class, not a claim of invulnerability.

### Decision

Every escape-critical sandbox runs in a hardware microVM. On the owned v1
target, that means one Firecracker microVM per sandbox on densely shared EU
bare-metal KVM hosts. It does not mean one standing VM per tenant or workspace.

Shared-kernel runc containers and gVisor-only products cannot carry untrusted
public traffic. gVisor may run inside the microVM as optional defense-in-depth,
specifically to add a continuously fuzzed syscall layer where Firecracker lacks
an observable upstream fuzzing program.

`microsandbox`/libkrun is rejected for escape-critical v1 despite its KVM
boundary: the study found mode-0 seccomp, 11/14 reachable primitives, no useful
public fuzz/CVE signal, and pre-1.0 maturity.

## Decision 2 — owned v1 compute: Kata launches Firecracker

Firecracker is a VMM and jailer, not an OCI sandbox product. Building image
assembly, guest boot, exec/fs transport, networking, lifecycle, recovery, and a
fleet directly on its API would pull v2 forward.

Kata Containers already provides the containerd/OCI runtime wrapper that
launches the selected Firecracker VMM from admitted images. Kata is adopted,
not rebuilt, and is not a competing isolation engine.

### Decision

The owned v1 target is **containerd -> Kata Containers -> Firecracker** on EU
bare-metal KVM, behind `SandboxProviderV1`.

- Firecracker is the hardware isolation boundary.
- Kata is the adopted runtime wrapper.
- CI owns exact Firecracker/jailer/Kata/containerd/kernel/rootfs/guest-daemon
  pins; it never inherits a frozen wrapper or provider default.
- A bespoke raw-Firecracker fleet is not v1 work.

## Decision 3 — interim compute bridge: Blaxel primary, E2B alternate

Blaxel is the production path that exists today while the sovereign cohort is
built and qualified. It is an interim compatibility path behind the provider
contract, not the product strategy. Managed per-second hardware microVMs
preserve the required boundary during that transition.

### Decision

**Blaxel is the primary short-term bridge.** The owner has confirmed its
hardware microVM isolation as acceptable. It has sub-25 ms resume, no base fee,
and included/free egress, making it the cheapest qualified hardware-isolated
bridge at pilot/growth. A Gate 0 spike verifies that its API can satisfy the
full `SandboxProviderV1` capability contract without leaking vendor concepts
into consumers.

Blaxel regular Volume is acceptable as temporary bridge persistence even
though it is a durable opaque block volume and not user-browsable. That is an
explicit bridge exception, not the product data architecture. Blaxel Agent
Drive would provide S3+POSIX semantics but is private preview, so it is deferred.
Bridge sandboxes can instead mount our SeaweedFS/S3 namespace when that storage
layer is ready.

Blaxel Volume is phase-0 persistence only. Before a workspace enters the
durable product tier or can move providers, required files are copied to
SeaweedFS and verified by file count and content digest.
After that activation, no provider-specific volume is authoritative.

**E2B managed is the alternate bridge.** Its vendor-confirmed Firecracker
microVM boundary and external S3 mounts satisfy the important isolation and
storage-integration preconditions; its approximately $150/month base fee makes
it the more expensive fallback.

Modal and Beam (gVisor/shared-kernel class) and Daytona (shared-kernel class)
are trusted-pilot-only. They are never valid escape-critical fallbacks.

## Decision 4 — durable storage product: SeaweedFS

The storage requirement is stronger than persistence. Users must be able to
inspect, sync, audit, and export their own files without entering a sandbox or
decoding a proprietary filesystem image.

### Decision

Self-hosted [SeaweedFS](https://github.com/seaweedfs/seaweedfs) is the v1 durable
data substrate: EU-sovereign, Apache-2.0, and capable of exposing an S3 API and
a POSIX FUSE mount over the same plain files.

- `/workspace` is the durable, tenant-scoped SeaweedFS mount.
- `/scratch` is fast local disk for SQLite, git, `node_modules`, virtualenvs,
  package installs, builds, and high-churn POSIX-heavy work.
- Tenant buckets/prefixes, event/access logging, backups, and tested restore
  provide v1 durability and audit controls.
- A guest receives only a short-lived credential scoped by tenant prefix and
  required actions. The agent can read it, so expiry and least privilege are
  security invariants.
- Plain CSV, Parquet, JSON, source, and artifacts are visible through ordinary
  S3 commands and a Dropbox-like product surface. Open formats preserve
  bring-your-own-data and take-your-data-out.

**Owner ruling (2026-08-12):** v1 uses plain durable S3 with dual POSIX access
and no S3 versioning. Versioning may return only for a compliance or
undo-agent-changes requirement. A destructive overwrite has no object-history
recovery in v1; backup/restore is a service-durability control, not per-write
undo.

SeaweedFS is the self-hosted equivalent of Blaxel Agent Drive. The same
SeaweedFS data plane remains when compute runs on Blaxel, E2B, the owned
Kata/Firecracker v1 host, or the v2 fleet.

### Rejected storage designs

- **Naive s3fs as primary:** POSIX-incomplete; rename becomes copy/delete and
  random-write, append, and locking behavior is unsafe for active tooling.
- **Block volume, block image, JuiceFS, or Turso AgentFS as the durable product:**
  POSIX-capable, but user files are opaque or chunked inside a container rather
  than directly browsable through S3.
- **MinIO:** an S3-first store with weak native POSIX over the same plain files;
  it does not satisfy the paired S3+FUSE product contract.

## Decision 5 — copy-in and live file events

Transient inputs cross the provider boundary as one bounded zip bundle followed
by one extraction operation: two calls rather than one API request per file.
They are never host bind mounts and are securely discarded at teardown.

A guest daemon watches `/workspace` with inotify for guest-originated durable
changes and only admitted artifact/output paths under `/scratch`; `/scratch` is
not blanket-synchronized. Artifact publication copies the selected output into
`/workspace`. The daemon streams changes through a required
`file-events / watch stream` capability on `SandboxProviderV1`. This drives:

- a live workspace file tree with no polling correctness path;
- event-driven synchronization/publication to the durable namespace;
- artifact-to-inbox routing as human-intention items.

Changes made outside the guest arrive through SeaweedFS/S3 event notifications,
which may duplicate or reorder source events. The provider deduplicates by
source event identity, assigns a monotonic workspace cursor after
ingestion, and exposes an at-least-once reconnectable stream. A gap triggers an
authoritative filesystem/object reconciliation before delivery resumes;
this is event-driven recovery, not a periodic polling path.

## Decision 6 — provider behavior is part of the contract

`SandboxProviderV1` is the stable consumer seam. Compute selection is
configuration; vendor SDK types, VMM specs, and storage mechanics do not escape
the adapter. Its v1 capability matrix includes:

- idempotent create with one sandbox per user session;
- tenant plus `externalId`/session tagging;
- bounded exec and filesystem operations;
- zip copy-in and artifact copy-out;
- live file-events/watch stream;
- authorization-keyed session pool;
- idle auto-suspend after about 60 seconds and fast resume;
- idempotent destroy and orphan recovery;
- usage meters for active sandbox-seconds and egress;
- stable health, isolation-class, and qualification facts.

These patterns are provider-independent lessons from getnao/BoxLite and Blaxel
operating guidance. Boring adopts BoxLite's pool/TTL/copy-in/optional-runtime
patterns, not its libkrun engine.

Network is off by default. The v1 allowlist contains only the selected
SeaweedFS storage endpoint. If the configured runtime is missing or unhealthy,
the host application may start but sandbox admission fails closed. There is no
silent fallback to local, direct, runsc, gVisor, or a weaker managed provider.

## Decision 7 — qualification and host security invariants

Every managed or owned cohort must satisfy the contract and its declared
hardware isolation class. The owned cohort additionally proves the exact Kata
configuration launches the pinned Firecracker binary.

Gate 0 and exact-cohort qualification remain launch requirements. Their only
concrete evidence checklist is in the
[sovereign build plan](sandbox-sovereign-build.md#gate-0--feasibility-and-evidence);
this record owns the decision to fail closed, not a second copy of the proof
steps.

No sandbox host carries a control-plane signing root, reusable customer/model
credential, transcript/session store, shared plaintext workspace tree, or any
other-tenant data. Unavoidable local scratch/backing is per-microVM encrypted or
ephemeral, inaccessible to sibling guests, and securely discarded.

Spectre/MDS-class side channels remain a separate workstream. Current microcode,
core scheduling/sibling isolation, host cohort selection, measurement, and
residual-risk policy can block admission, but are not misrepresented as
Firecracker protections.

## Decision 8 — operating economics and capacity signal

The [cost model](references/sandbox-cost-model.md) uses 1 vCPU/2 GiB sandboxes,
about three active minutes per task, and a 60-second idle stop/suspend policy.
Per-second billing avoids roughly 20x per-hour rounding waste.

- Blaxel is about $4/month at pilot (50 active hours) and $41/month at growth
  (500 active hours), with free egress.
- A Hetzner AX102 reference host is about $278/month flat with unlimited egress.
- The raw Blaxel-to-one-host compute crossover is about 3,357 active sandbox
  hours/month; approximately 3,000 hours/month is the planning trigger.
- Egress can move the real crossover earlier; ops labor, HA, and poor packing can
  move it later.

Instrument active sandbox-seconds and egress bytes from day one, tagged by
tenant, session, image, and provider. These measurements inform capacity and
operating decisions; they do not define the architecture or replace the
sovereign M0 exit criterion. Meeting M0 starts the build plan's controlled
new-session cutover, with Blaxel retained only as the qualified rollback through
the agreed soak.

## Decision 9 — v1 to v2

V2 is the owned-fleet stage of the same architecture. It adds block and memory
snapshot-fork, warm pools, bin packing/draining, and snapshot-locality-aware
scheduling. Cloud Hypervisor is the likely owned-fleet VMM because of its
device and fuzz-harness posture, subject to its own qualification and
CVE-response gate.

There is no storage/data-product, provider-contract, or isolation-class
migration: `SandboxProviderV1`, the guest capability shape, hardware-microVM
requirement, SeaweedFS namespace, and plain S3/POSIX files remain. Moving from
Firecracker to likely Cloud Hypervisor is a real VMM engine swap behind that
seam; the owner's "no engine change" means the product/storage/contract engine
does not change. This follows OpenAI's [From fork() to Fleet](https://www.youtube.com/watch?v=OqM67QG_Ikk)
progression without pulling snapshot machinery into v1.

## Decisions at a glance

| Question | Final choice |
| --- | --- |
| Tenant boundary | One hardware microVM per sandbox; share host, never boundary |
| Owned v1 compute | Kata Containers launching CI-pinned Firecracker on EU bare metal |
| Short-term bridge | Blaxel primary; E2B alternate; weaker providers trusted-pilot-only |
| Durable storage | Self-hosted SeaweedFS: same plain files through S3 and POSIX FUSE |
| Working paths | Durable `/workspace`; fast local `/scratch`; zip copy-in for transient inputs |
| File events | Guest inotify + required live watch stream + S3 notifications; no polling |
| Runtime behavior | Session pool, 60s suspend, fast resume, tags, idempotency, graceful degrade |
| Guardrails | Fail closed, S3-only egress, 11 probes, quotas, scoped credentials, rollback, Gate 0 |
| Cutover | Sovereign M0 is the bridge exit criterion; active-hours and egress inform capacity |
| V2 | Owned snapshot-fork fleet, warm pools, locality scheduling, likely Cloud Hypervisor; SeaweedFS unchanged |

## Sources

- [Local sandbox engine security evaluation](references/sandbox-engine-security-eval.md).
- [Local managed provider comparison](references/managed-sandbox-providers-comparison.md).
- [Local sandbox cost model](references/sandbox-cost-model.md).
- [Andronchik and Lokhmakov, arXiv:2606.08433](https://arxiv.org/abs/2606.08433).
- [Kata Containers virtualization matrix](https://kata-containers.github.io/kata-containers/design/virtualization/).
- [Kata Containers with Firecracker](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).
- [SeaweedFS](https://github.com/seaweedfs/seaweedfs).
- [getnao/nao BoxLite adapter reference](https://github.com/getnao/nao/blob/018d1f155fc52e5c24853bd9934c469758487b6f/apps/backend/src/agents/tools/execute-sandboxed-code.ts).
- [OpenAI, From fork() to Fleet](https://www.youtube.com/watch?v=OqM67QG_Ikk).
