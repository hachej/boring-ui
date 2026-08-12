# Issue #1081 — sovereign sandbox service

Issue folder for the public multi-tenant sandbox service. PR #1220 is one
docs-only owner gate; do not merge without explicit owner approval.

The previous single-tenant gVisor v1 model is superseded. Corrected v1 uses one
Firecracker microVM per sandbox on shared EU bare metal:

> **Share the host, never the boundary.**

## Read in this order

1. [Architecture and vision](../../direction/sandbox-service-architecture.md) —
   the public multi-tenant threat model, four layers, and v1-to-v2 shape.
2. [Technology decision record](tech-choice.md) — why Firecracker is the engine
   and tenant boundary, why Kata is the v1 containerd runtime wrapper, the S3
   data-substrate decision, rejected alternatives, and operator invariants.
3. [LEAN V1 execution plan](plan-sbx14.md) — Kata + Firecracker Gate 0,
   SandboxProviderV1 adapter, S3 sync-hybrid storage, immutable cohort pin,
   one-host qualification, Seneca flip, launch criteria, and rollback.
4. [v2 owned-fleet/hardening plan](plan-v2-hardening.md) — likely Cloud
   Hypervisor fleet, block/memory snapshot-fork, warm pools,
   snapshot-locality-aware scheduling, automated admission, and optional
   gVisor-inside-microVM.
5. [API contract](api-spec.md) — backend-neutral remote-worker verbs and
   SandboxProviderV1 mapping.
6. [Grounding references](references/README.md) — primary-source research and
   the multi-tenant security evaluation.

## Decision summary

- Seneca is public and multi-tenant; untrusted customer agent code is the v1
  workload.
- One sandbox equals one KVM microVM; many microVMs share one host.
- v1 adopts Kata + Firecracker on bare-metal KVM, estimated at about 1–2 weeks
  to a qualified single box. Firecracker is the engine/hardware boundary; Kata
  is only the adopted OCI/containerd runtime wrapper that launches it.
- A per-tenant S3 bucket/prefix is the durable, user-accessible system of record
  with object version history. Each microVM uses a fast local POSIX disk and a
  lazy-in/flush-out sync bridge; transient inputs use copy-in, never a host
  mount.
- The provider adapter supplies authorization-keyed session reuse with idle TTL,
  network-off by default with S3-only egress, and optional-runtime graceful
  degradation behind SandboxProviderV1.
- E2B self-hosted moves to v2, when Boring may adopt its snapshot-fork engine or
  build an owned equivalent. `firecracker-containerd` is the lower-level v1
  alternative if Kata cannot qualify.
- gVisor is optional inner defense-in-depth, not a tenant boundary.
- microsandbox/libkrun is rejected for v1 because of its mode-0 seccomp,
  unmeasured fuzz/CVE posture, and pre-1.0 maturity.
- v2 owns the fleet and moves block/memory snapshot-fork, warm pools, and
  snapshot-locality scheduling behind the existing SandboxProviderV1 seam.

## Grounding rule

Every isolation or vehicle claim must cite a primary source or a checked-in
research artifact. The controlling local evidence is
[references/sandbox-engine-security-eval.md](references/sandbox-engine-security-eval.md);
the controlling external sources include
[arXiv:2606.08433](https://arxiv.org/abs/2606.08433) and OpenAI's
[From fork() to Fleet](https://www.youtube.com/watch?v=OqM67QG_Ikk) talk.
