# 10 — Sandbox deployment (EU-sovereign): tiers, FUSE, providers

Status: v2 architecture doc. Grounds the sandbox/mount work (`TODO-X1`, `TODO-P2`, `TODO-P5`) and invariant 15 (00) in a verified July-2026 provider scan. This file answers "where and how do we actually run untrusted exec with a host-mounted S3 filesystem, in the EU, without putting credentials in the sandbox." It is the deployment counterpart to the package/contract work in [`02-boring-bash-environment.md`](02-boring-bash-environment.md) and [`09-environments-attachable.md`](09-environments-attachable.md), and it is canonical-with issue #307 (gVisor + per-workspace netns/nftables).

## Binding topology supersession (2026-07-11)

Decision 23 and [`INDEX.md`](../INDEX.md) supersede dedicated/runsc-first text
below wherever it conflicts. D1 first applies one finite boot/deploy-time
collection of N exact-host -> authorized-workspace -> deployed-`default`
bindings to one EU Docker image/compose host. The same artifact on a dedicated
VM is variant 2. D1 has no wildcard routing, hot tenant CRUD, tenant list API,
or fleet/control-plane lifecycle; those remain D2/S3.

P2 provider extraction and X1 mounts merge last and do not gate P6-R or D1.
D1 uses an existing approved host runtime composition with an explicit trust
profile: isolated profiles prove sibling filesystem/process denial;
trusted-direct is limited to local development or a single-workspace dedicated
composition and is never valid for the shared N-workspace host. The detailed
provider matrix remains research for P2/X1. Historical
single-site schemas, mandatory runsc gates, and D1/D2 topology labels below are
non-dispatchable.

## Verdict (GO / NO-GO)

**NO-GO** for an exact *managed* EU offering of "microVM + host-side rclone/FUSE bind mount + no guest credentials." As of July 2026 no vendor proves all of: microVM-grade isolation, host-side FUSE mount bound into the sandbox, no cloud credentials inside the sandbox, and a contractually EU-resident control plane + data plane + logs + support access.

This NO-GO applies to the optional post-v1 X1 mount offering, not D1. D1's
durable local/provider workspace volume on a self-hosted EU runsc worker is GO.

**GO** for **self-hosting on EU infrastructure**. The closest managed products (Daytona, Northflank BYOC, Scaleway serverless-containers/gVisor) either expose vendor-managed volumes/FUSE, write S3 credentials *into* the sandbox, do not publish a sovereign EU control-plane guarantee, or do not expose host mounts. Self-host is the viable path; managed vendors may be adopted later only against contractual EU-residency proof (Decision 10).

## Tenant provisioning command/API

**Amendment (2026-07-08):** this deployment architecture requires a dedicated
work package, [D1-tenant-provisioning](../work/D1-tenant-provisioning/), size
**L/XL**. Its exit criterion is one command/API call that creates the tenant and
workspace, runtime config, DB/storage/session roots, secrets, and an exact-host
existing-surface endpoint plus landing/sign-in/workspace/default-agent binding,
and emits the deployment manifest for the chosen EU host. Without D1, T0/T1
factory claims must be described as manual provisioning, not same-day repeatable
platform delivery.

**V1 ruling (2026-07-09):** D1 dedicated/sovereign delivery is the only v1
topology and is a v1 exit gate. It consumes `AgentDeployment` and the compiled
definition digest and uses an existing HTTP/workspace surface behind one exact
dedicated hostname; it does not depend on M2. The hostname serves a bounded
landing page, then existing auth/membership resolves the provisioned workspace,
which selects the deployment as agent `default`. Local/provider volumes and
explicit artifact synchronization are sufficient for v1. X1 host-rclone/FUSE
is optional post-v1 infrastructure.

The v1 dedicated-site input is deliberately small and host-owned:

```ts
interface DedicatedSiteSpec {
  appId: string
  hostname: string
  workspaceOwnerRef: string
  landing: {
    title: string
    summary: string
    ctaLabel?: string
  }
}
```

The validator accepts one exact operator-approved hostname and bounded escaped
landing text. Principal refs resolve only in the trusted host. This spec is
included in D1 desired-state digesting and rollback, but is not part of
`AgentDefinition` or `AgentDeployment` and grants no runtime/workspace
authority. The provisioned workspace plus D1's active complete site record
remain the authority for the selected `default` agent. This is D1 apply state,
not a P6 resolved registry or generation pointer.

D1's complete redacted deployment snapshot pins the definition/deployment
identities, runtime desired inputs, immutable host-app artifact, and exact
workspace-composition manifest/digest consumed by stateless P6-R. Rollback
rematerializes those exact inputs and reproduces the resolved digest. P6 owns no
snapshot store, active pointer, generation lease, or garbage collector.

After apply, the active complete site record exposes a server-only
`DedicatedWorkspaceScope { appId, workspaceId, agentId: 'default' }`. Dedicated
app composition intersects every workspace-bearing route and front selection
with this scope: list returns only the bound member workspace; create/switch/
ordinary delete are disabled; foreign ids fail before lookup even when the
principal belongs to another workspace. The D1 workspace is marked managed and
only the fenced D1 lifecycle may remove it. This optional scope must not change
generic multi-workspace hosts when absent. The same optional scope reaches the
existing post-signup hook: dedicated mode skips personal default-workspace
creation and grants no membership unless the invite names the exact bound
workspace. A scoped foreign or invalid invite fails without default creation;
generic invite behavior remains unchanged. The same managed-workspace guard
blocks every existing-owner account deletion or owner-role removal outside the
fenced D1 lifecycle, while non-owner account deletion remains available. The
current committed role is evaluated under the same workspace-store mutation
transaction or serializable account-deletion transaction; a route pre-read is
never ownership authority. Invite, embedded/browser, Boring MCP, signed
WorkspaceBridge, and managed-agent MCP selectors each intersect this same scope
at their existing choke point before application effects. There is no caller-
controlled agent/deployment selector: the authorized workspace keeps selecting
`default`. This is workspace provisioning/lifecycle scope, not a second auth
policy.

D1 endpoint publication is ordered after the isolation surface. The staged host
emits a non-caller-forgeable `DedicatedSiteCapability` attestation only when the
fixed-workspace enforcement and landing/sign-in/default-agent surface are both
installed at named contract versions. The attestation binds target key, fencing
token, staged desired-state digest, exact app/hostname/workspace/agent binding,
host-app artifact digest and workspace-composition manifest digest. Root-owned
inspection independently attests the actual running artifact and the unoverridden
full-app Docker web command (`apps/full-app/dist/server/main.js`); generic core
launchers are not D1 entrypoints, and app env/self-report is insufficient. The
root-owned approved-release record binds core and ingress images/commands, the
Caddyfile digest, redacted host-security-config digest, and c1-c5 inventory/
execution-policy revisions. Before Compose mutation D1 validates desired ==
approved intended image/command and the strict exact environment key schema.
Each key is fixed or a redacted nonsecret value in the digest; unknown or secret-
bearing env keys reject. Secret refs remain approved state and raw values stay
only in the read-only tmpfs file-provider mount. The schema pins
`NODE_ENV=production`, forbids the five loader keys, and covers D1 owner/mode/
roots/proxy, auth URL, CORS, CSP, cookie security, effective external/plugin-
authoring flags, Boring MCP enablement, and managed-agent MCP target. First boot
requires core/ingress absent or stopped. It creates/inspects an exact DB-only
migration container with file-mounted DB secret, exact Node migration process,
`User=10001:10001`, and no web entrypoint/root/privilege before running it; deterministic
host/revision identity plus durable redacted completion resumes every crash
boundary and cleans only the exact verified id. It then creates
core stopped, validates image/command, read-only root, exact mounts, nonsecret env
plus canary absence from Docker metadata, and host-
security policy, binds its id, and starts only that verified id. Direct non-Caddy
application traffic remains scope-rejected. This all precedes preload/pointer/
ingress or lazy first-effect admission; mismatch stops/
quarantines core while ingress stays
stopped. Running hosts keep the stable core and validate observed state before
N+1 candidate effects.
Initial ingress is created but not started, then inspected against the landed
D1-003a image/command/Caddyfile contract with read-only root and its sole read-
only config mount. The verified capability binds that stopped container id;
only atomic pointer publication may start that exact id and expose port 80.
The exact approved artifact, command, and host-security config freeze the
complete potential c1-c5 workspace-selector-bearing production route set because
that full-app entrypoint hard-pins `externalPlugins: false`
(rendering `BORING_PLUGIN_AUTHORING` inert), and external/raw/runtime plugin
gateways and hot reload are unavailable. Conditional static MCP families remain
inside the c3/c5 inventory. An artifact/command/startup-env/execution-policy or
workspace-selector-bearing
change requires renewed inventory, a new root-approved release, and a maintenance
restart. Composition identity remains per
binding and sibling composition digests may differ. The attestation is never a
caller-supplied record: an in-process staged host returns an opaque handle from
an unexported mint; a remote staged host returns a nonce-, issuer-, audience-,
expiry-, and contract-version-bound response directly over P5a's pinned-TLS
authenticated worker channel. Publication and pointer CAS validate provenance
and every field against the current staged D1 apply; an old apply/fence, caller,
or another target cannot forge/replay it.

For first apply, the route/certificate may be prepared but external exact-host
activation happens only after the completion is appended and
the active complete site-record CAS selects the safe scoped deployment. A reserved
D1 host with no matching complete record is an explicit inactive state that
rejects before generic routing. On reapply the prior complete pointer remains
the scope authority until the replacement CAS. Without a matching attestation,
apply may stage artifacts but must not advance the pointer or publish DNS/TLS.
Production acceptance is not satisfied by `direct`, bwrap, Vercel, a fake
provider, or unverified remote-worker claims: P2 must deliver the hardened
gVisor `runsc --platform=systrap` provider, P5a must authenticate its worker
contract/hardening facts, and the final P8 proof must execute on a preconfigured
EU runsc host. The fake provider remains only for deterministic fault semantics.

## Tenant topologies

**Amendment (2026-07-08):** name the two factory tiers explicitly:
**D1 = dedicated/sovereign**, and **D2 = shared subdomain**. They are deployment
topologies over the same runtime stack and definition/deployment contracts, not
separate agent-definition systems. P6-D owns immutable definition lookup only
and P6-R remains stateless. P7 owns the first registry of P6-R outputs. D2 alone
owns `SharedTenantAgentDeclaration`, consumes the P7 registry, and is not a D1
input. Phase 6 owns no resolved registry or shared-tenant declaration.

| Topology | Shape | Work package | Use for |
| --- | --- | --- | --- |
| Self-host / owner-operated | one deployment operated directly for the owner or client | base architecture 10 + P5; X1 optional | client-owned ops, dev/trusted, regulated handoff |
| Dedicated / sovereign tenant | one deployment and exact hostname per company/site, with bounded landing/auth handoff, tenant/workspace/runtime config, default-agent binding, and deployment manifest | [D1-tenant-provisioning](../work/D1-tenant-provisioning/) | managed sovereign clients, strong isolation, dedicated agent sites, bespoke deployment review |
| Shared Subdomain tier | one shared EU deployment serves N subdomain tenants; wildcard DNS/TLS terminates at the shared host, and a fail-closed Host router maps `company.senecapp.ai` -> `workspaceId` | [D2-shared-tenant-mesh](../work/D2-shared-tenant-mesh/) | instant outreach/demo tenants with near-zero marginal deployment cost |

The D1 exact hostname may use an operator-preconfigured DNS/TLS adapter, but its
application instance accepts only that bound host and routes to only its own
workspace. It is not a wildcard multi-tenant application router.

The D2 shared topology is post-v1. It requires wildcard DNS, wildcard TLS, and a
`Host:`-header tenant router seated beside the existing workspace-id adapter.
Unknown hosts fail closed and never map to a default tenant. D2 must prove
cross-tenant isolation in one process across sessions, files, pending inputs,
search, artifacts, governance, and brokered secrets.

Do not start D2 until D1 has repeated enough to establish the deployment
contract and a trusted adapter-created `TenantContext { tenantId, workspaceId,
principal }` exists. Caller-supplied or optional `SessionCtx` is not a shared
tenancy authorization boundary.

## Post-v1 X1 FUSE x isolation matrix (condensed)

This section evaluates the optional X1 storage tier. It is not a D1 v1 host
prerequisite. D1 uses a durable local/provider workspace volume and explicit
backup/artifact synchronization.

Question for each runtime: can the host `rclone`-mount an S3 prefix and then expose that already-mounted path *inside* the sandbox, without the sandbox ever seeing `/dev/fuse`/`fusermount3`/credentials?

| Runtime | Host mount → into sandbox | Path | Notes |
| --- | --- | --- | --- |
| `bwrap` userns | **Yes** — `--bind`/`--ro-bind` the host mountpoint | bind | Works anywhere with userns; shared kernel → weak for hostile multi-tenant. Needs `fuse3`, UID alignment or `user_allow_other`, mount health checks. |
| plain Docker/containerd | **Yes** — bind mount | bind | Shared kernel is not enough isolation on its own; never run rclone *inside* the container. |
| **gVisor `runsc` systrap** | **Yes** — bind mount mediated by gofer/directfs | bind | **No KVM needed**, runs on normal VMs. inotify on host-changed bind mounts is a known gap. **This is the hardened default.** |
| gVisor `runsc` KVM | Yes — same mount model | bind | Needs `/dev/kvm`; best on bare metal. systrap is usually better inside nested VMs. |
| Firecracker (vanilla) | **No generic host bind; no virtiofs** | — | Host FS sharing/virtiofs is tracked upstream but **not shipped**. Bad fit for X1 host mounts; rclone-in-guest would put creds in the guest (violates X1). Use only with block images/snapshot/sync, never host rclone bind. |
| **Kata Containers** | **Yes — via virtiofs** (not raw bind) | virtiofs | QEMU/Cloud Hypervisor runtimes; needs KVM. Stronger isolation than gVisor. Watch `/dev/shm` sizing + virtiofsd attack surface. |
| **Cloud Hypervisor** | **Yes — via virtiofsd** (`--fs`, guest `mount -t virtiofs`) | virtiofs | Better X1 microVM target than Firecracker; `cache=never` recommended for density. Needs guest virtiofs kernel support. |
| Generic QEMU/libvirt VM | **Yes — via virtiofs** | virtiofs | Operationally heavier, straightforward on bare metal. |

Shared gotchas: rclone mount is FUSE, so X1 inherits object-store semantics, VFS-cache choices, mount-daemon failure modes, UID/GID issues, and weak file notification. **Treat inotify as unreliable across FUSE/virtiofs/gVisor** — use polling or a host event bridge (Decision 7). Keep `node_modules`, package caches, and build dirs *off* the rclone FUSE mount; use local ephemeral NVMe and sync artifacts (Decision 8).

## The three tiers

| Tier | Runtime | Where | V1 workspace storage / optional X1 path | Use for |
| --- | --- | --- | --- | --- |
| **dev / trusted** | `bwrap` userns | anywhere with userns | v1 local/provider volume -> bind; X1 may later bind a host rclone mount | dev, CI, invite-only, trusted single-tenant. **Not** hostile multi-tenant. |
| **hardened default** | **gVisor `runsc --platform=systrap`** + per-workspace **netns/nftables** | plain EU VMs (Hetzner Cloud / Scaleway / OVH / IONOS / STACKIT) | v1 durable local/provider volume -> gofer bind; X1 may later substitute host rclone/FUSE | the recommended production path for public untrusted workloads. **Canonical with #307.** |
| **VM-grade** | **Kata Containers or Cloud Hypervisor + virtiofsd** | EU **bare metal** (needs `/dev/kvm`) | post-v1 X1 host rclone mount -> **virtiofs** into guest | strongest isolation for the most hostile tenants / regulated workloads. |

Tier rules:

- **dev tier** is `bwrap` only, trusted/dev/invite-only. It does not satisfy public hostile multi-tenant isolation (shared network namespace, shared kernel/uid/process, no seccomp — the #307 finding).
- **hardened default is `runsc` systrap on plain EU VMs**, because systrap needs no KVM (so no nested-virt dependency) and matches #307's chosen path. D1 binds its durable local/provider workspace volume; the same host-side boundary remains compatible with X1 later. Egress: per-container netns + nftables (block RFC1918, CGNAT, link-local, metadata, ULA, app/DB networks; allow public DNS/package registries; add proxy/allowlist later).
- **VM-grade uses Kata / Cloud Hypervisor with virtiofsd on EU bare metal.** **NEVER vanilla Firecracker for live host mounts** — Firecracker lacks generic virtiofs, so it cannot serve the host rclone mount into the guest; using it would force rclone (and its credentials) into the guest, violating X1. Firecracker is acceptable *only* with block images / snapshot / sync, never host rclone bind.

## Runtime images (OCI runtime spec)

Accept an optional provisioned-runtime image reference on provider config:

```ts
type ProviderRuntimeSpec = {
  image?: { ref: string; digest: `sha256:${string}` }
}
```

The `ref` is human/operator-readable (`registry.example/boring/runtime-node:2026-07`); the `digest` is the execution identity and is required for any non-dev run. Runtime images are not a new package boundary: `@hachej/boring-bash` still chooses the mode, `@hachej/boring-sandbox` still owns provider adapters/capability facts, and P5 still owns provisioning/fingerprint orchestration.

BBP6-009 adds the deployment surface: `AgentDeployment.runtimeProfileRef?`.
It is a host-resolved reference to an operator-supplied runtime-profile catalog,
not an inline image spec or Dockerfile. The resolved profile image fills this
provider-config `{ image: { ref, digest } }` slot; if no ref is declared, the
host may use the validated provider-default image. A declared no-image profile
does not fall back at image level. Unknown/malformed refs and provider-default
images fail closed at the host seam, and any selected image is checked against
the resolved provider's `runtimeImage` capability before the agent is ready.

Tier fit:

- **gVisor `runsc`** and **Kata/Cloud Hypervisor** run OCI images through containerd/Docker-compatible plumbing, so `{ image: { ref, digest } }` is the natural runtime spec for hardened/VM-grade tiers.
- **`bwrap` has no image concept.** It may either report runtime images unsupported or use a documented host-side unpack path: pull by digest with an OCI tool (`podman`, `skopeo`/`umoci`, or equivalent), unpack layers into a rootfs directory, then assemble bwrap with chroot-style binds. Caveats: image entrypoint/CMD/container env are not container-runtime semantics; whiteouts, UID/GID, setuid bits, device nodes, and package caches need explicit handling; it does not improve bwrap isolation. If the host cannot prove this path, capability `runtimeImage` is `unknown`/unsupported and policy fails closed.
- **`vercel-sandbox` remains a PROXY provider.** It may accept an image only if its API exposes image/template/snapshot support with digest identity; otherwise image-backed runtime asks are unsupported and fail closed. It is still optional under invariant 15.
- **`remote-worker` reports image support in its handshake.** The worker may implement OCI-native execution (runsc/Kata) or a bwrap-style unpack path, but the client consumes only reported facts and the resolved digest; missing/unknown support fails closed.

Relationship to P5 provisioning: an image digest is a provisioning fingerprint component. Image-based provisioning is build-time baking; `BashRequirement` install scripts are runtime/bootstrap overlays on top of the selected base image. The composed key is at least `image.digest + provider contract version + normalized requirement ids/content + seed/source graph + revalidation key`. This is the same template/bootstrap split adopted from eve: reusable template first, per-session/onSession reconciliation second.

X1 interplay is orthogonal: S3/FUSE mounts bind into whatever rootfs the provider starts (OCI-native, unpacked bwrap rootfs, provider template, or remote worker root). Mount policy, no-secret rules, mount-type facts, and the one model-visible namespace still decide what appears at `/workspace`.

EU/security rules:

- Default registries are EU/self-hostable: a self-hosted OCI registry in the tenant, or EU-region Scaleway/OVH registry only if control plane, data plane, logs, and support access satisfy Decision 10. US-hosted registries are optional, never defaults.
- The image build pipeline is operator/host-owned. Predefined `boring-runtime-*` images (base/node-python/git-gh-rg and later vertical-agent toolchains) are named artifacts with pinned digests.
- Dockerfile build from user input is a follow-up gated on demand, not part of this epic's implementation scope. Builds run host-side on dedicated isolated builders with no tenant/brokered secrets, restricted egress, provenance capture, and digest output; they never run inside the target sandbox session.
- No secrets may be baked into images (invariant 14). Image labels, build logs, SBOM/provenance, fingerprints, and runtime env carry only non-secret metadata.

## Named providers and prices (July 2026 scan)

Managed sandbox scan (all fail the exact X1 shape today):

| Candidate | Isolation | EU residency | Mount story | Verdict |
| --- | --- | --- | --- | --- |
| Koyeb | Firecracker microVMs | `fra`, `par` | block-storage volumes preview; no host rclone bind | No for X1 (app platform, not sandbox API). |
| Scaleway Serverless Containers | gVisor (sandbox v2) | Paris, Amsterdam, Warsaw | stateless; no block attach | No managed microVM/FUSE; good IaaS/bare-metal source. |
| E2B | Firecracker microVMs | not proven EU-sovereign | volumes exist, but S3 guide writes creds in-sandbox (`s3fs`) | No for locked X1; self-host heavy. Pro ~$150/mo + usage. |
| Daytona | dedicated-kernel sandboxes | built-in `eu` (`DAYTONA_TARGET=eu`), BYOC | volumes FUSE-backed over S3 | **Closest**, but not proven sovereign / not our host-rclone-bind pattern. |
| Modal | secure containers | region select; EU sovereignty unproven | volume mounts; no arbitrary host bind | No for exact X1; not microVM. |
| Northflank | Kata or gVisor microVM-backed | managed + BYOC | no public proof of host rclone bind; BYOC may allow self-operated mounts | Possible BYOC; not turnkey X1. |
| Blaxel | individual microVMs | US + Europe | volume storage; no host-bind proof | No until vendor proves mount + control-plane residency. |
| IONOS / STACKIT / OTC | EU IaaS/K8s | strong EU positioning | you operate mounts | Self-host only. |

Self-host reference hardware (EU, verify final SKU price at order):

- **Hetzner** dedicated (DE/FI): AX42-class 64 GB / 2×512 GB NVMe, line from **€59/mo**. Hetzner Cloud has **no nested virtualization** (fine for systrap; rules out Kata/CH on their cloud VMs — use bare metal for VM-grade).
- **OVHcloud Advance** (EPYC, 32–256 GB, NVMe, 1–5 Gbps): ~**$115–$160/mo** legacy, **$134+** for 2026 configs. OVH Public Cloud exposes `vmx` but **live migration can panic nested KVM guests** — do not rely on it for production microVMs.
- **Scaleway Elastic Metal**: EM-B230E-NVMe 8c/16t 64 GB 2×1.02 TB NVMe **€119.99/mo**; EM-B230E-128G **€149.99/mo**; EM-I120E **€134.99/mo**; larger Iridium tiers up to 64c/128t.
- **AWS EC2** offers nested KVM (C8i/M8i/R8i) **but** may violate the no-US-hosted-hard-dependency policy (invariant 15) — optional only, never default.

## Capacity model

- D1 reserves **25–35% RAM/CPU** for the host, dockerd/containerd, runsc,
  image pulls, local workspace/cache IO, and monitoring.
- D1 caps concurrency by
  `min(cpu_active_exec, memory_limit, pids, fd count, local disk, outbound bandwidth)`.
- Start gVisor nodes at **8 vCPU / 32 GB** -> roughly **8–16 active-exec**
  sandboxes or **20–40 mostly-idle** sandboxes; prove the real number with
  `npm i`, `uv pip install`, `rg`, and build/test workloads.
- X1 separately re-benchmarks capacity with mount count, rclone VFS cache disk,
  and object-store metadata because those may become the limiter before CPU.

## Kernel / host prerequisites

- D1 v1 common: **Linux 6.x**, cgroup v2, user namespaces, nftables,
  overlayfs, a durable local/provider workspace volume, and local NVMe for
  package/build caches. No `fuse3`, `/dev/fuse`, rclone, or object-store
  credential is required.
- X1 post-v1 adds: `fuse3` + `/dev/fuse`,
  `/etc/fuse.conf: user_allow_other` when cross-UID, and the rclone VFS cache on
  local NVMe (never on the FUSE mount).
- VM-grade X1 adds: `/dev/kvm`, `virtiofsd`, a guest kernel with virtiofs,
  Cloud Hypervisor or Kata, and explicit shared-memory (`/dev/shm`) sizing.

## The 12 post-v1 X1 decisions to lock

1. X1 storage uses **host-side rclone/FUSE only**; sandbox never receives S3/R2/AWS credentials.
2. Mount one workspace prefix per sandbox; never bind bucket root; IAM/policy is prefix-limited and least-privilege.
3. `bwrap` remains dev/trusted/invite-only; public hostile workloads require gVisor or VM-grade isolation.
4. Default hardened self-host tier is `runsc --platform=systrap` on EU VMs plus per-workspace netns and nftables.
5. VM-grade X1 tier is Kata/Cloud Hypervisor plus virtiofs on EU bare metal, not vanilla Firecracker.
6. Runtime capabilities must declare mount type: `host-bind`, `virtiofs`, `remote-fs`, `no-inotify`, `poll-required`, `rw/ro`, `cache-policy`.
7. File tree/editor refresh must not depend on inotify for FUSE/virtiofs/gVisor mounts; use polling or host event bridge.
8. Dependency/build caches stay on local ephemeral NVMe; rclone FUSE stores durable source/artifacts, not hot package-manager trees by default.
9. Egress policy is part of the sandbox contract: block private/internal/metadata, allow public package registries initially, add proxy controls later.
10. EU sovereignty means no managed sandbox vendor is a hard dependency unless its control plane, data plane, logs, and support access are contractually EU-resident.
11. Add stable errors for mount unavailable, mount stale, cache writeback failed, path outside prefix, egress denied, and runtime unsupported mount mode.
12. Smoke tests must prove: no creds in sandbox, path escape rejected, mount survives restart/reconnect, package install works, internal egress blocked, cross-workspace denied.

## Open risks

- **rclone/FUSE over S3 may be too slow for agent edit/build loops** without local cache and selective sync — **benchmark required** before committing (the X1 exit criterion must carry real numbers; owned by `TODO-X1`).
- S3/object-store rename, locking, directory-cache, and writeback semantics can surprise POSIX-heavy tools.
- gVisor bind mounts and virtiofs have file-notification gaps; UI refresh must be polling / event-bridge based (Decision 7).
- virtiofs over an underlying rclone FUSE mount is a **double filesystem mediation path** — benchmark before committing to the VM-grade tier.
- virtiofsd is an added host attack surface for untrusted guests.
- Bare metal improves KVM access but adds patching, stock/provisioning, replacement, and noisy-neighbor responsibility.
- Open public egress still permits abuse and own-workspace exfiltration; #307 accepts own-workspace exfil, but product policy must name the prompt-injection risk.
- Managed vendors may be useful later, but exact EU residency, control-plane location, support access, and mount semantics need contractual proof before adoption (Decision 10).

## Issue reconciliation

- **#307 is canonical** for the hardened default tier: bwrap alone is insufficient for public untrusted multi-tenancy; the chosen path is gVisor systrap + per-workspace netns/nftables. X1 fits it — file ops stay host-side, only exec moves to gVisor; new work is mount health, cache policy, the no-inotify contract, and the FUSE performance proof.
- **#416**: governed/company context (`company_context`) must **never** be raw-mounted into user sandboxes; X1 is scoped to the `user` filesystem only, and policy-filtered views stay projection-based (see `TODO-X1`, `09`).
- **#16** (Bedrock AgentCore) is adapter-compatible but AWS-managed FS/S3/EFS is not the locked host-rclone/no-guest-creds X1 path.
- **#223** folded into #307; provider research lives there.
