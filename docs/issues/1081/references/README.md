# Issue #1081 — grounding references

Version-controlled research evidence backing the sandbox-service architecture
(`docs/direction/sandbox-service-architecture.md`, PR #1220) and the SBX1.4
execution plan (`plan-sbx14.md`, PR #1219). Every API/architecture/isolation
decision in those documents cites one of the files below.

Provenance: all artifacts produced 2026-08-11 during the #1081 grounding pass and
checked in here as durable evidence (not left in scratchpad). Primary-source
quotes and code citations are transcribed verbatim; anything unverifiable is
flagged `[UNVERIFIED]` inside each file.

| File | What it grounds |
| --- | --- |
| [`isolation-choices-primary-sources.md`](isolation-choices-primary-sources.md) | Verbatim Modal / Fly.io / Cloudflare / Vercel quotes on isolation tech (gVisor vs Firecracker/microVM). Grounds the v1 gVisor / v2 microVM isolation-tier decision and the trust-escalation table. |
| [`gvisor-platform-security.md`](gvisor-platform-security.md) | gVisor platform-security validation: systrap vs KVM is a performance choice, not a different Sentry security boundary. Grounds v1's `--platform=systrap` choice on a rented VM without `/dev/kvm`. |
| [`build-vs-adopt-survey.md`](build-vs-adopt-survey.md) | Remote container-daemon / build-vs-adopt survey (E2B, Daytona, faasd license traps, the Docker-AuthZ CVE finding). Grounds the "own the auth edge" security decision and the TAKE/ADAPT/OWN/RE-HOST split. |
| [`managed-k8s-ch-eval.md`](managed-k8s-ch-eval.md) | Managed-Kubernetes vs self-controlled Cloud Hypervisor / KVM nodes evaluation. Grounds why v1 uses self-controlled nodes (own containerd/runsc config) and why the microVM tier wants our own metal. |
| [`sbx14-scoping.md`](sbx14-scoping.md) | SBX1.4 / SBX1.5 GO/NO-GO scoping — what the v1 daemon concretely is, sizes, and the refusal-only admission-gate blocker. Grounds the v1→v2 exit criteria. |
| [`control-plane-api-spec.md`](control-plane-api-spec.md) | The E2B-modeled v1 control-plane API spec: E2B public surface (verified against JS/Python SDK + OpenAPI), our existing wire contract (`remoteWorkerProtocolV1`), the coverage map, and where we deliberately diverge (capability+nonce auth). Primary driver of the architecture doc's API-shape section (§9). |
| [`e2b-internals-architecture.md`](e2b-internals-architecture.md) | E2B `infra` (Apache-2.0) internal service topology read from the actual repo tree — control-plane/data-plane split, `envd`, `orchestrator`, liftability per service. Grounds the four-layer mapping and the v2 "harvest E2B" dispositions. |
