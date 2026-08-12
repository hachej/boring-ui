# Issue #1081 — sovereign sandbox service

Issue folder for the public multi-tenant sandbox service. PR #1220 is one
docs-only owner gate; do not merge without explicit owner approval.

The previous single-tenant gVisor v1 model and the intermediate self-host-first
plan are superseded. V1 bridges on a qualified hardware-microVM provider while
building the owned Kata + Firecracker + SeaweedFS target:

> **Share the host, never the boundary.**

## Read in this order

1. [Technology decision record](tech-choice.md) — why Blaxel is the bridge,
   Firecracker is the owned tenant boundary, Kata is its runtime wrapper,
   SeaweedFS is the product data plane, and the provider/security invariants.
2. [LEAN V1 execution plan](plan-sbx14.md) — Gate 0, Blaxel adoption,
   SeaweedFS + Kata/Firecracker build, exact-cohort qualification, measured
   crossover, configuration-only cutover, and rollback.
3. Grounding references:
   [sandbox engine security](references/sandbox-engine-security-eval.md),
   [managed provider comparison](references/managed-sandbox-providers-comparison.md),
   and [cost model](references/sandbox-cost-model.md).

The earlier [architecture](../../direction/sandbox-service-architecture.md),
[API spec](api-spec.md), and [v2 hardening plan](plan-v2-hardening.md) remain
useful historical baselines but are superseded wherever they conflict with the
final decision record and execution plan. In particular, their generic-S3,
polling, direct-Kata-first, and E2B-as-v2-path details are not current.

## Decision summary

- Seneca is public and multi-tenant; untrusted customer agent code is the v1
  workload.
- One sandbox equals one KVM microVM; many microVMs share one host.
- The short-term bridge is Blaxel; E2B is the hardware-isolated alternate.
  Modal, Daytona, and Beam are trusted-pilot-only.
- The owned v1 target is Kata launching pinned Firecracker microVMs on shared EU
  bare-metal KVM. Firecracker is the boundary; Kata is the adopted OCI/runtime
  wrapper.
- Self-hosted SeaweedFS exposes the same tenant-scoped plain files through S3
  and POSIX FUSE. Durable `/workspace` is user-browsable and versioned; local
  `/scratch` handles POSIX-heavy work.
- Transient files use zip copy-in/extract. A guest inotify daemon feeds the
  required live watch stream, event-driven sync, and artifact-to-inbox routing;
  external changes arrive through S3 notifications.
- The provider adapter supplies one sandbox per user session, tagging,
  idempotent create, a session pool, 60-second idle suspension, fast resume,
  heavy-image prewarming, network-off with SeaweedFS-only egress, metering, and
  optional-runtime graceful degradation.
- gVisor is optional inner defense-in-depth, not a tenant boundary.
- microsandbox/libkrun is rejected for v1 because of its mode-0 seccomp,
  unmeasured fuzz/CVE posture, and pre-1.0 maturity.
- Per-second billing makes Blaxel about $4–41/month at pilot/growth. Instrument
  active sandbox-hours and egress from day one and cut owned compute over by
  configuration near the roughly 3,000 active-hour/month crossover.
- v2 owns the fleet and adds block/memory snapshot-fork, warm pools, and
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
this PR; Gate 0 turns that acceptance into durable capability and qualification
evidence before untrusted traffic.
