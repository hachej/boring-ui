# Issue #1081 — grounding references

Version-controlled research evidence backing the sandbox-service architecture
(`docs/direction/sandbox-service-architecture.md`, PR #1220) and the SBX1.4
execution plan (`plan-sbx14.md`, PR #1220). Every API/architecture/isolation
decision in those documents cites one of the files below.

Provenance: artifacts were produced during the 2026-08-11 #1081 grounding and
security passes and checked in as durable evidence. Primary-source quotes and
code citations are transcribed verbatim; anything unverifiable is flagged
`[UNVERIFIED]` inside each file. Earlier single-tenant/runsc reports remain as
historical research, but the multi-tenant security evaluation supersedes their
v1 recommendation.

| File | What it grounds |
| --- | --- |
| [`sandbox-engine-security-eval.md`](sandbox-engine-security-eval.md) | **Controlling isolation evidence.** Re-weights arXiv:2606.08433 for Seneca's public multi-tenant, escape-critical threat model; requires a KVM microVM per sandbox; evaluates Firecracker, gVisor, Cloud Hypervisor, libkrun, Kata, and E2B. |
| [`isolation-choices-primary-sources.md`](isolation-choices-primary-sources.md) | Historical Modal / Fly.io / Cloudflare / Vercel quotes on isolation technology. Its earlier gVisor-v1 recommendation is superseded by the multi-tenant evaluation above. |
| [`gvisor-platform-security.md`](gvisor-platform-security.md) | Historical systrap-vs-KVM analysis inside gVisor. Still useful for an optional gVisor-inside-microVM experiment; it no longer selects the outer v1 boundary. |
| [`build-vs-adopt-survey.md`](build-vs-adopt-survey.md) | Remote container-daemon / build-vs-adopt survey (E2B, Daytona, faasd license traps, the Docker-AuthZ CVE finding). Grounds the "own the auth edge" security decision and the TAKE/ADAPT/OWN/RE-HOST split. |
| [`managed-k8s-ch-eval.md`](managed-k8s-ch-eval.md) | Historical managed-Kubernetes vs self-controlled-node evaluation. The self-controlled KVM-host conclusion survives; its gVisor premise does not. |
| [`sbx14-scoping.md`](sbx14-scoping.md) | Historical runsc slice scoping. Retained for shipped-code context; its runsc/openat2 engine gate is superseded by the Firecracker/E2B Gate 0. |
| [`control-plane-api-spec.md`](control-plane-api-spec.md) | Historical E2B public-surface and code-coverage research. Its single-tenant auth/lifecycle recommendations are superseded by [`../api-spec.md`](../api-spec.md); verified E2B SDK/API facts remain reference material. |
| [`e2b-internals-architecture.md`](e2b-internals-architecture.md) | Historical E2B `infra` repository study. Component mechanics remain useful, but its extraction/v1 recommendation is superseded. Current v1 topology follows E2B's official API + client-proxy + Redis + Postgres/object storage + Nomad/Consul path documented in the controlling plan. |
