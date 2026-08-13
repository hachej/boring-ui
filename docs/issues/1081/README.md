# Issue #1081 — sovereign sandbox service

Reading guide (in order):

1. [Direction](../../direction/sandbox-service-architecture.md) — the short sovereign-first summary.
2. [Design](sandbox-sovereign-design.md) — the architecture, guarantees, limits, and bridge policy.
3. [Build](sandbox-sovereign-build.md) — Gate 0, implementation phases, executable cutover, and M0 proof.

Then use [scale](sandbox-sovereign-scale.md) for post-M0 fleet work; [references/](references/) is background research and can be skipped.

Issue folder for the public multi-tenant sandbox service. PR #1220 is one
docs-only owner gate; do not merge without explicit owner approval.

The previous single-tenant gVisor v1 model and the intermediate self-host-first
plan are superseded. The product is the sovereign Kata + Firecracker +
SeaweedFS sandbox fleet:

> **Share the host, never the boundary.**

## Decision summary

- Seneca is public and multi-tenant; untrusted customer agent code is the v1
  workload.
- One sandbox equals one KVM microVM; many microVMs share one host.
- Blaxel is only the interim production path through `SandboxProviderV1` until
  sovereign M0 qualifies; E2B is the hardware-isolated alternate. Modal,
  Daytona, and Beam are trusted-pilot-only.
- The owned v1 target is Kata launching pinned Firecracker microVMs on shared EU
  bare-metal KVM. Firecracker is the boundary; Kata is the adopted OCI/runtime
  wrapper.
- Self-hosted SeaweedFS exposes the same tenant-scoped plain files through S3
  and POSIX FUSE. Durable `/workspace` is user-browsable; local `/scratch`
  handles POSIX-heavy work. V1 has no S3 versioning, so destructive overwrites
  have no object-history recovery.
- Transient files use zip copy-in/extract. A guest inotify daemon feeds the
  required live watch stream, event-driven publication, and artifact-to-inbox routing;
  external changes arrive through S3 notifications.
- The provider adapter supplies one sandbox per user session, tagging,
  idempotent create, a session pool, 60-second idle suspension, fast resume,
  network-off with SeaweedFS-only egress, metering, and optional-runtime
  graceful degradation. Warm pools are scale work, not M0.
- gVisor is optional inner defense-in-depth, not a tenant boundary.
- microsandbox/libkrun is rejected for v1 because of its mode-0 seccomp,
  unmeasured fuzz/CVE posture, and pre-1.0 maturity.
- Meter active sandbox-hours and egress from day one for capacity and operating
  decisions; economics do not replace the sovereign M0 qualification gate.
- The scale stage adds block/memory snapshot-fork, warm pools, and
  snapshot-locality scheduling, likely with Cloud Hypervisor. SeaweedFS and the
  provider/data contract remain unchanged.

## Grounding rule

Every isolation or vehicle claim must cite a primary source or a checked-in
research artifact. The controlling local evidence is
[references/sandbox-engine-security-eval.md](references/sandbox-engine-security-eval.md),
[references/managed-sandbox-providers-comparison.md](references/managed-sandbox-providers-comparison.md),
and [references/sandbox-cost-model.md](references/sandbox-cost-model.md); the
controlling external sources include
[arXiv:2606.08433](https://arxiv.org/abs/2606.08433) and OpenAI's
[From fork() to Fleet](https://www.youtube.com/watch?v=OqM67QG_Ikk) talk.
Blaxel's hardware-microVM acceptance is the owner's final decision recorded in
this PR; the build plan owns the bridge and sovereign Gate 0 evidence.
