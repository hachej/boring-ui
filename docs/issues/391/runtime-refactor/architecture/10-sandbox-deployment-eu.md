# 10 — Sandbox deployment (EU-sovereign): tiers, FUSE, providers

Status: v2 architecture doc. Grounds the sandbox/mount work (`TODO-X1`, `TODO-P2`, `TODO-P5`) and invariant 15 (00) in a verified July-2026 provider scan. This file answers "where and how do we actually run untrusted exec with a host-mounted S3 filesystem, in the EU, without putting credentials in the sandbox." It is the deployment counterpart to the package/contract work in [`02-boring-bash-environment.md`](02-boring-bash-environment.md) and [`09-environments-attachable.md`](09-environments-attachable.md), and it is canonical-with issue #307 (gVisor + per-workspace netns/nftables).

## Verdict (GO / NO-GO)

**NO-GO** for an exact *managed* EU offering of "microVM + host-side rclone/FUSE bind mount + no guest credentials." As of July 2026 no vendor proves all of: microVM-grade isolation, host-side FUSE mount bound into the sandbox, no cloud credentials inside the sandbox, and a contractually EU-resident control plane + data plane + logs + support access.

**GO** for **self-hosting on EU infrastructure**. The closest managed products (Daytona, Northflank BYOC, Scaleway serverless-containers/gVisor) either expose vendor-managed volumes/FUSE, write S3 credentials *into* the sandbox, do not publish a sovereign EU control-plane guarantee, or do not expose host mounts. Self-host is the viable path; managed vendors may be adopted later only against contractual EU-residency proof (Decision 10).

## FUSE × isolation matrix (condensed)

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

| Tier | Runtime | Where | Mount path | Use for |
| --- | --- | --- | --- | --- |
| **dev / trusted** | `bwrap` userns | anywhere with userns | host mount → `--bind` | dev, CI, invite-only, trusted single-tenant. **Not** hostile multi-tenant. |
| **hardened default** | **gVisor `runsc --platform=systrap`** + per-workspace **netns/nftables** | plain EU VMs (Hetzner Cloud / Scaleway / OVH / IONOS / STACKIT) | host rclone mount on the worker → bind (gofer) | the recommended production path for public untrusted workloads. **Canonical with #307.** |
| **VM-grade** | **Kata Containers or Cloud Hypervisor + virtiofsd** | EU **bare metal** (needs `/dev/kvm`) | host rclone mount → **virtiofs** into guest | strongest isolation for the most hostile tenants / regulated workloads. |

Tier rules:

- **dev tier** is `bwrap` only, trusted/dev/invite-only. It does not satisfy public hostile multi-tenant isolation (shared network namespace, shared kernel/uid/process, no seccomp — the #307 finding).
- **hardened default is `runsc` systrap on plain EU VMs**, because systrap needs no KVM (so no nested-virt dependency), matches #307's chosen path, and preserves the X1 host-credential rule (file ops stay host-side, only exec moves into gVisor). Egress: per-container netns + nftables (block RFC1918, CGNAT, link-local, metadata, ULA, app/DB networks; allow public DNS/package registries; add proxy/allowlist later).
- **VM-grade uses Kata / Cloud Hypervisor with virtiofsd on EU bare metal.** **NEVER vanilla Firecracker for live host mounts** — Firecracker lacks generic virtiofs, so it cannot serve the host rclone mount into the guest; using it would force rclone (and its credentials) into the guest, violating X1. Firecracker is acceptable *only* with block images / snapshot / sync, never host rclone bind.

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

- Reserve **25–35% RAM/CPU** for the host, dockerd/containerd, runsc/Kata, the rclone VFS cache, image pulls, and monitoring.
- Cap concurrency by `min(cpu_active_exec, memory_limit, pids, fd/mount count, rclone cache disk, outbound bandwidth)`.
- Start gVisor nodes at **8 vCPU / 32 GB** → roughly **8–16 active-exec** sandboxes or **20–40 mostly-idle** sandboxes; prove the real number with `npm i`, `uv pip install`, `rg`, and build/test workloads (this is the same benchmark X1 owes — see Open risks + `TODO-X1`).
- Bare-metal 64–128 GB boxes pack more, but **FUSE/object-store metadata becomes the limiter before CPU**.

## Kernel / host prerequisites

- Common: **Linux 6.x**, cgroup v2, user namespaces, `fuse3` + `/dev/fuse`, `/etc/fuse.conf: user_allow_other` (if cross-UID), nftables, overlayfs, and the **rclone VFS cache on local NVMe** (never on the FUSE mount).
- VM-grade tier adds: `/dev/kvm`, `virtiofsd`, a guest kernel with virtiofs, Cloud Hypervisor or Kata, and explicit shared-memory (`/dev/shm`) sizing.

## The 12 Decisions To Lock (verbatim from verified research)

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
