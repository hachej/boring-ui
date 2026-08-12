# Sovereign Sandbox Service — corrected technology decision record

Status: DECISION RECORD. Date: 2026-08-12.
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

## Decision 2 — v1 vehicle: Kata runtime wrapper + Firecracker engine

### Question

Which adopted runtime path launches the required Firecracker microVMs in v1
without pulling a fleet control plane forward?

### Evidence

Firecracker supplies the VMM/jailer and the hardware-KVM boundary. It does not
turn OCI images into a containerd-compatible sandbox lifecycle by itself. Kata
Containers already supplies that wrapper: containerd sends an admitted OCI
workload to Kata, and Kata configures and launches the Firecracker microVM. Kata
is therefore a runtime wrapper around the chosen engine, not a competing engine
or a second tenant boundary.

`firecracker-containerd` exposes a lower-level containerd-to-Firecracker path
and is the fallback if Kata cannot qualify. It requires more lifecycle and guest
integration work, so it is not the default.

E2B self-hosted supplies much more: API/client-proxy, Redis routing, Postgres,
object storage metadata, Nomad/Consul orchestration, guest services, and a
snapshot-backed persistence engine. That is attractive for the v2 fleet, but
the S3 data-substrate decision below means v1 does not need its persistence
engine.

### Decision

**v1 adopts Kata Containers + Firecracker behind SandboxProviderV1.**

Firecracker is the engine and isolation boundary: one hardware-KVM microVM per
sandbox. Kata is merely the adopted containerd runtime wrapper that launches
that engine from admitted OCI images. Do not build a bespoke VMM fleet.

Estimated adoption effort: **about 1–2 weeks** to a qualified single bare-metal
KVM box, including Gate 0, the provider adapter, S3 sync-hybrid integration,
pin/admission wiring, hostile probes, and rollback rehearsal. Host procurement
and owner wait time are excluded.

### Reasoning

Kata is the smallest mature adoption layer that supplies the OCI/containerd
launch path without displacing Firecracker. SandboxProviderV1 keeps Kata and
containerd details out of Seneca's app-facing contract. Gate 0 must prove that
the exact admitted Kata configuration launches the pinned Firecracker binary,
not QEMU or Cloud Hypervisor.

E2B self-hosted moves to v2, where Boring may adopt its snapshot-fork engine or
build an owned equivalent. In v1, Nomad/Consul/Redis/Postgres and E2B's proxy and
ingress services do not earn their operational weight because tenant durability
comes directly from S3. This is a timing decision, not a rejection of E2B's
future snapshot machinery.

## Decision 3 — v1 storage: S3 data substrate + sync-hybrid POSIX disk

### Question

What is the durable, user-facing data product, and how does untrusted code get
POSIX-correct working storage without reopening a host path into the microVM?

### Evidence

The current runsc implementation's host bind is an implementation detail. The
remote provider already ignores the caller's host `workspaceRoot` and presents
a provider-owned `/workspace`, so SandboxProviderV1 does not require a live host
mount.

Kata's [virtualization
matrix](https://kata-containers.github.io/kata-containers/design/virtualization/)
documents:

- Firecracker: virtio-block, virtio-net, vsock; **no filesystem sharing**.
- Cloud Hypervisor: virtio-fs and block-backed storage.
- Kata + Firecracker requires a block device as the VM backing store; see the
  [official integration
  guide](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).

S3-compatible object storage gives every tenant a directly accessible durable
namespace, ordinary file objects, version history, lifecycle controls, and
portable APIs. But object storage is not a POSIX filesystem: naive s3fs-style
execution breaks or distorts atomic rename, random write, append, locking, and
SQLite/git/build behavior.

### Options

| Option | Result |
| --- | --- |
| Per-tenant S3 system of record + local POSIX disk + sync-hybrid | Plain user-readable objects, S3 version history, correct guest-local POSIX behavior, no host mount; selected. |
| Opaque block volume + volume snapshots | Durable and POSIX-capable, but users cannot read/sync their files through S3; loses the product and portability win. |
| Naive s3fs-style direct execution | User-readable objects, but incomplete POSIX semantics make git/SQLite/builds unsafe or surprising. |
| POSIX-over-S3 such as JuiceFS | POSIX behavior, but chunks files into implementation objects; users cannot read their files with ordinary S3 commands. |
| Host directory via virtio-fs/9p | Live cross-boundary channel and host-path blast radius; also incompatible with Firecracker's device model. |

### Decision

**A per-tenant S3 bucket, or a strictly isolated tenant prefix, is the durable
system of record.** It stores plain CSV, Parquet, JSON, source, and artifact
objects that the user can access directly with ordinary S3 commands, APIs, and
sync clients: Dropbox/data-lake behavior out of the box, bring-your-own-data,
take-your-data-out, and no proprietary volume lock-in.

Enable object versioning so users receive visible point-in-time file history.
Each checkpoint publishes an immutable manifest of keys and version IDs and
conditionally advances one generation pointer, yielding an atomic workspace
snapshot rather than a mixed view of independently current objects. Access/event
logging supplies the audit trail; regulated deployments add retention/Object
Lock when immutable history is required. That is a product feature for
fiduciary, tax, and insurance workflows—not merely an implementation backup.
Use an EU-sovereign object-store deployment such as OVHcloud or Scaleway Object
Storage, Cloudflare R2 in the EU, or self-hosted MinIO/Ceph on Seneca bare metal.
The selected deployment must prove that data never leaves the admitted perimeter
and support the "Hosted in Europe" claim.

This design follows the object/version properties documented by [Amazon
S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html),
the EU jurisdiction guarantee documented by [Cloudflare
R2](https://developers.cloudflare.com/r2/reference/data-location/), and the
versioning/region controls documented by [OVHcloud](https://help.ovhcloud.com/csm/pt-public-cloud-storage-s3-versioning?id=kb_article_view&sysparm_article=KB0063868)
and [Scaleway](https://www.scaleway.com/en/docs/object-storage/concepts/).
Equivalent versioning, conditional publication, event logging, retention, and
region behavior must be qualified on the selected S3-compatible provider rather
than inferred from API compatibility alone.

Each microVM runs active tools on a fast local ext4/xfs block disk. The
**sync-hybrid** bridge runs inside the guest. rclone is the initial candidate;
Mountpoint for Amazon S3 may be qualified only as transfer/write-back plumbing
and is never mounted at `/workspace`. The bridge hydrates a manifest lazily at
session start and flushes on provider-fs write, explicit checkpoint, and session
end.

One active writer lease exists per tenant/workspace. Checkpoint conditionally
publishes against the baseline object version IDs. A second sandbox writer or a
direct user S3 edit during a live lease causes a stable conflict and fence/
refresh; it never silently last-writer-wins or publishes a partial generation.
Provider `/fs` success means S3 commit completed. Exec-process writes become
durable only at the documented checkpoint boundary. If flush fails, retain and
fence the encrypted local disk for recovery; never destroy it while claiming
success. Gate 0 defines the exec-write crash/expiry RPO and proves
write/checkpoint -> destroy -> recreate -> read.

Mountpoint's own [filesystem-semantics
document](https://github.com/awslabs/mountpoint-s3/blob/main/doc/SEMANTICS.md)
explicitly does not implement full POSIX semantics; that is why it cannot be the
working filesystem.

Every guest receives only short-lived credentials scoped by prefix and action to
its tenant namespace. The agent can read those credentials; expiry and scope are
therefore security invariants, not optional hardening. The policy denies
bucket-policy/lifecycle/versioning/retention changes, DeleteObjectVersion, and
cross-prefix access. An escaped sandbox can reach at most its current tenant
objects, not erase their retained history.

### Copy-in rationale: no host mount

Transient context, project inputs, uploads, and SQL-result CSVs are copied into
the microVM's separate unsynced `/inputs` tree over the bounded provider
channel. They are never placed under the S3-backed `/workspace`, are securely
discarded at teardown, and are never bind-mounted from a host directory. A
virtio-fs/9p host mount is a live
cross-boundary channel: it expands the VMM/device attack surface, adds
path-traversal and symlink-race opportunities, and exposes a continuously
reachable host tree rather than a bounded copied object set. Copy-in removes
that channel and keeps Firecracker viable because Firecracker has no virtio-fs.
It is the structural form of the existing no-host-paths guardrail.

### Consequences

- Kata + Cloud Hypervisor is not the v1 answer merely because it has virtio-fs.
- Opaque volume snapshots and JuiceFS-style chunk stores are explicitly
  rejected for v1 persistence because they remove direct user S3 access.
- Project quota on a shared host workspace is replaced by per-tenant S3 limits,
  a bounded per-microVM local disk, and CPU/memory/PID/output/lease/concurrency
  limits with a host reserve.
- The existing public SandboxProviderV1/remote-worker fs semantics remain; only
  their backend realization changes.
- Host inotify cannot be required. Use guest events or bounded polling.
- Rollback checkpoints required artifacts to the tenant bucket before
  destroying a microVM; it does not archive a host bind-mount source.
- Same-workspace concurrency and direct S3 drift are explicit conflicts; object
  versioning is history, not permission for uncontrolled last-writer-wins.

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

### E2B self-hosted

**Deferred for v1; candidate for v2 snapshot-fork adoption.** Its Firecracker
engine is compatible with the isolation decision, but v1's S3 system of record
does not need E2B's persistence engine. Nomad, Consul, Redis, Postgres,
client-proxy, and ingress operations therefore do not earn their weight on the
single-box path. v2 may adopt its snapshot-fork engine or build Boring's own.

## Decision 5 — guardrails and qualification

Changing the outer engine does not remove the existing guardrails. v1 keeps and
repoints:

- fail-closed startup on missing, stale, or mismatched cohort facts;
- immutable pins for containerd, Kata, Firecracker, jailer, guest kernel, OCI
  image, guest agent, S3 sync bridge, network policy, and quota profile;
- egress denied by default with only the admitted S3 endpoint allowlisted;
- all 11 existing logical hostile assertions, run through a Firecracker/Kata
  driver against the exact box and guest image;
- no host path, runtime socket, /dev/kvm, arbitrary VM spec, image/template
  override, or qualification override on the wire;
- short-lived, tenant-prefix/action-scoped S3 credentials, with expiry,
  cross-prefix denial, and historical-version protection proved from the guest;
- copy-in-only transient inputs, authorization-keyed session reuse with idle
  TTL, and optional-runtime graceful degradation;
- per-microVM CPU, memory, PID, output, block, lease, and concurrent-sandbox
  limits plus host reserve;
- authorization before effect, strict schemas/body bounds, stable redacted
  errors, startup cleanup, bounded drain, and idempotent create;
- drain-before-flip rollback with the previous provider available.

### Gate 0 correction

The old openat2 gate selected a gVisor release because runsc returned ENOSYS.
That outer-engine gate is superseded by Kata + Firecracker qualification.

The path-confinement property remains. The guest-local and copy-in paths prove
openat2 with RESOLVE_BENEATH/RESOLVE_NO_MAGICLINKS or equivalent beneath-root
semantics plus traversal and symlink-race negatives. No realpath fallback is
allowed.

Gate 0 additionally proves two concurrent tenant identities receive distinct
microVMs, guest kernels, workspace/overlay objects, network identities, and
data; all 11 logical hostile assertions pass through a Firecracker/Kata driver;
local POSIX behavior, atomic manifest publication, single-writer/direct-edit
conflicts, failed-flush fencing, and S3 sync-hybrid recovery work; file version
history is user-visible; `/inputs` never syncs; network policy reaches only S3;
scoped credentials expire, cannot cross tenant prefixes, and cannot delete
retained versions; pool/idle-TTL and optional-runtime behaviors work; cleanup
survives partial gateway/containerd/Kata/S3 failure; and no control-plane secret
or other tenant data is guest-visible.

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

The sandbox host contains no control-plane signing secrets, reusable customer
or model-provider credentials, transcript/session store, shared plaintext
workspace tree, or durable other-tenant plaintext in host services/files. Local
working-block backing is per-microVM encrypted or ephemeral and securely
discarded after a successful flush. The sync bridge and scoped credential live
inside that guest. Because the agent can inspect the credential, short lifetime
and prefix/action scope are mandatory.

### Side channels

Microarchitectural leakage is outside the paper's scope and outside KVM's
guarantee. CPU microcode, core scheduling/sibling isolation, host cohort
selection, and measurement are a separate workstream. They are recorded and may
fence a cohort; they are never described as Firecracker protections.

## Decision 7 — provider adapter behaviors and hosting

The stable application seam remains SandboxProviderV1 and the remote-worker V1
verbs. v1 adds a thin adapter from that contract to containerd/Kata's admitted
OCI launch path and guest operations. Seneca does not expose RuntimeClass,
arbitrary images, Firecracker machine configuration, or privileged devices.

The adapter owns three runtime behaviors:

1. **Session pool + idle TTL.** Reuse a warm sandbox across calls only for the
   same authorized tenant/workspace/session binding. Reset the idle deadline on
   use; flush and destroy on idle expiry or hard lease. This is bounded session
   reuse, not v2 snapshot-fork/warm-pool machinery.
2. **Network off by default.** The admitted policy denies all guest egress except
   the selected tenant S3 endpoint. Callers cannot widen the allowlist.
3. **Optional-runtime graceful degrade.** If the Kata provider/runtime is absent
   or unhealthy, the host app/control plane may start, but sandbox admission and
   remote-worker create fail closed with a stable unavailable state. The app
   never silently falls back to direct, local, runsc, or another weaker runtime.

The [getnao/nao BoxLite reference
spike](https://github.com/getnao/nao/blob/018d1f155fc52e5c24853bd9934c469758487b6f/apps/backend/src/agents/tools/execute-sandboxed-code.ts)
demonstrates the pool, idle-TTL reset, explicit copy-in, and optional-import
patterns. Boring adopts those provider behaviors behind SandboxProviderV1, not
BoxLite's libkrun engine. The spike enables guest networking; Boring tightens
that setting to default-off plus S3-only allowlisting.

Customers reach Seneca's public multi-tenant application. Seneca's trusted
control plane reaches the worker over private ingress with request-bound
authorization. The root-equivalent VMM/worker API is never a public customer
endpoint.

v1 runs its sandbox data plane on one EU bare-metal KVM host with containerd,
Kata, and Firecracker/jailer; each guest contains its agent and S3 sync bridge.
The trusted management plane runs the bounded gateway and capability/binding
state; the EU-sovereign object store remains the durable data tier. The sandbox
host has no signing roots, reusable customer secrets, shared plaintext
workspace tree, or durable other-tenant plaintext in host services/files. This
is shared metal, not one standing VM per customer. A second sandbox host, real
scheduler, or automatic admission is v2.

## Decision 8 — v1 to v2

Because v1 already uses a KVM microVM per sandbox behind SandboxProviderV1, v2 is
not a shared-kernel-to-hardware migration. It is a single-host runtime-wrapper
to snapshot-aware fleet transition. The app-facing contract, guest-agent shape,
isolation class, and S3 data-substrate semantics remain stable.

v2 has two explicit paths. Adopting E2B's snapshot-fork engine keeps
Firecracker. Building Boring's owned fleet likely uses Cloud Hypervisor. Either
route receives its own qualification/CVE-response gate, preserves one microVM
per sandbox, and keeps tenant-readable S3 as the durable system of record.
Block/memory snapshots accelerate ephemeral working-state fork/restore; they do
not become the opaque tenant-data product. The fleet density optimizations are
deliberately deferred:

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
| 2 | v1 build/adopt | Firecracker engine + adopted Kata containerd runtime wrapper; no bespoke VMM fleet |
| 3 | v1 storage | Tenant-readable S3 system of record + local POSIX disk + sync-hybrid; no host mount |
| 4 | Other engines/vehicles | gVisor optional inside FC; microsandbox rejected; E2B deferred to v2; Cloud Hypervisor likely v2 |
| 5 | Guardrails | Fail closed, S3-only egress, 11 probes, scoped credentials, no host paths, quota, rollback |
| 6 | Operator ownership | CI-owned Firecracker pins; sterile hosts; side channels separate |
| 7 | Seam/hosting | SandboxProviderV1; session pool/idle TTL; optional runtime; one EU sandbox host + EU object store |
| 8 | v2 | E2B snapshot-fork adoption or owned fleet + warm pools/locality; same isolation spine |

## Sources

- [Andronchik and Lokhmakov, AI Code Sandboxes: A Comparative Security Study,
  Part 1, arXiv:2606.08433](https://arxiv.org/abs/2606.08433).
- [OpenAI / Abhishek Bhardwaj, From fork() to Fleet: Designing an Agent Sandbox
  Cloud](https://www.youtube.com/watch?v=OqM67QG_Ikk); [conference
  listing](https://aie-wf.sentry.dev/talks/aiewf-201-from-fork-to-fleet-designing-an-agent-sandbox-cl).
- [E2B infrastructure architecture](https://github.com/e2b-dev/infra/blob/main/docs/ARCHITECTURE.md).
- [Kata Containers virtualization matrix](https://kata-containers.github.io/kata-containers/design/virtualization/).
- [Kata Containers with Firecracker](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-kata-containers-with-firecracker.md).
- [getnao/nao BoxLite adapter reference spike](https://github.com/getnao/nao/blob/018d1f155fc52e5c24853bd9934c469758487b6f/apps/backend/src/agents/tools/execute-sandboxed-code.ts).
- [Amazon S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html), [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), and [CloudTrail object data events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html).
- [Cloudflare R2 EU jurisdiction controls](https://developers.cloudflare.com/r2/reference/data-location/), [OVHcloud Object Storage versioning](https://help.ovhcloud.com/csm/pt-public-cloud-storage-s3-versioning?id=kb_article_view&sysparm_article=KB0063868), and [Scaleway Object Storage regions/Object Lock](https://www.scaleway.com/en/docs/object-storage/concepts/).
- [Mountpoint for Amazon S3 filesystem semantics](https://github.com/awslabs/mountpoint-s3/blob/main/doc/SEMANTICS.md).
- [Local security evaluation](references/sandbox-engine-security-eval.md).
