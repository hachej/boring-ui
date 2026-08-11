# Remote container-start daemon survey (SBX1.4 build-vs-adopt)

> **Historical scope:** this survey required candidates to preserve Docker +
> runsc and therefore cannot decide the corrected Firecracker adoption question.
> See `sandbox-engine-security-eval.md` and `../tech-choice.md` for the v1
> E2B-vs-Kata decision.

Date: 2026-08-11. Context: `docs/issues/1081/plan-sbx14.md` (branch `docs/sbx14-plan`),
PR #1219. The planned S1 daemon is a ~1-1.5k-LOC HTTP/SSE server that reuses an
**already-merged** V1 protocol client, binding registry, nonce store, and
`RunscSessionRuntimeV1`. Any adopted tool must beat that baseline, not just "work".

Requirements: R1 authenticated remote start/exec/stop API; R2 authorization narrower
than raw Docker (our image, our session shapes only); R3 server-side image digest
pinning; R4 replay protection / one-time grants or a clean seam for our nonce layer;
R5 drives Docker/containerd with `runsc` runtime (doesn't replace it); R6 one-VM
single-tenant operational surface; R7 permissive license + maintained.

Scoring: PASS / PARTIAL / FAIL per requirement.

---

## 1. tecnativa/docker-socket-proxy

HAProxy in front of `/var/run/docker.sock` with per-API-**section** allow/deny env
flags (`CONTAINERS=1`, `IMAGES=0`, ...). Source: repo README (github.com/Tecnativa/docker-socket-proxy).

- R1 **FAIL** — no authentication at all; access control is "who can reach the port"
  (Docker network placement). Deliberately no TLS.
- R2 **FAIL** — granularity is API section, not endpoint body. Anyone allowed
  `CONTAINERS` POST can run *any* image, any mounts, `--privileged`. That is
  root-equivalent, exactly what R2 forbids.
- R3 **FAIL** — cannot inspect request bodies; no digest enforcement possible.
- R4 **FAIL** — stateless proxy, no grant concept; no seam (HAProxy config, not code we extend).
- R5 PASS (transparent to runtime). R6 PASS (tiny). R7 PASS (Apache-2.0, maintained).
- **Verdict: reject.** It solves "don't expose the whole socket to a co-located
  container", not "authenticated narrow remote API".

## 2. Portainer CE

Full management platform (GUI + API) over Docker/Swarm/K8s. Source: repo README.

- R1 PASS — token-authed API.
- R2 **FAIL in CE** — RBAC and fine-grained restrictions are Business Edition
  features ("Portainer Business Edition ... includes ... RBAC"); CE admin API is
  effectively full Docker.
- R3 FAIL — no server-side digest admission for API-created containers.
- R4 FAIL — no one-time grants; extending Portainer internals is not a seam, it's a fork.
- R5 PASS. R6 **FAIL** — a whole product (UI, user DB, edge agents) to babysit for
  one endpoint. R7 PARTIAL — zlib license is permissive but the features we need are paywalled.
- **Verdict: reject.** Wrong shape and wrong edition economics.

## 3. containerd gRPC API + mTLS

Drive containerd directly over its API. Source: containerd docs/ops.md + upstream
knowledge: containerd listens on a Unix socket; there is **no built-in
authentication or authorization** in the gRPC API, and containerd namespaces are
explicitly not a security boundary. Remote exposure means wrapping the socket
yourself (TLS terminator or custom proxy).

- R1 PARTIAL — you must build the TLS/auth wrapper yourself; containerd contributes nothing.
- R2 **FAIL** — any client that reaches the API is fully privileged (can create
  arbitrary spec containers, mounts, privileged). No scoping exists to narrow it;
  you'd write an authorizing proxy — which *is* the S1 daemon, minus our protocol.
- R3 FAIL natively (client-side pulls decide); enforcement again lives in your proxy.
- R4 FAIL natively. R5 PASS (runsc is a containerd shim, `io.containerd.runsc.v1`).
  R6 PARTIAL — containerd itself is fine (Docker already runs on it), but the missing
  auth layer is the whole problem. R7 PASS (Apache-2.0).
- **Verdict: reject as an alternative — it's not a competitor to the daemon, it's
  the thing the daemon would sit in front of.** Also note the plan drives Docker,
  which already fronts containerd; switching to raw containerd would *replace*
  `RunscSessionRuntimeV1`'s working Docker path for zero auth gain.

## 4. faasd (openfaas/faasd)

Single Go binary + systemd, containerd + CNI, runs the OpenFaaS gateway stack on one
node. Closest *shape* to our daemon. Sources: repo + README.

- R1 PASS — gateway with basic-auth/token.
- R2 PARTIAL — you deploy only your functions, but anyone with the admin credential
  can deploy any image: the credential is deploy-anything, not scoped to our image/session shapes.
- R3 FAIL — deploy takes whatever image ref the client sends; no server-side admitted-digest gate.
- R4 FAIL — no grant/nonce concept; adding one means forking the gateway.
- R5 **FAIL/PARTIAL** — faasd hardcodes its containerd runtime path (runc); no
  documented runtime-class selection for runsc. Its model is HTTP-invoked functions,
  not long-lived sessions with fs watch + exec + SSE mutation events — our V1
  protocol doesn't map onto invoke semantics.
- R6 PASS — genuinely small single-node surface.
- R7 **FAIL** — faasd CE is now under a **non-commercial personal-use EULA**;
  commercial use requires OpenFaaS Edge licensing. Disqualifying on its own for seneca production.
- **Verdict: reject.** Right size, wrong semantics, wrong license.

## 5. Daytona (daytonaio/daytona)

Was the most promising analog (control plane + runner starting Docker sandboxes with
authed API). Reality check: **public repo now contains only README.md + assets**
(verified via `gh api repos/daytonaio/daytona/contents`); README states development
moved to a private codebase (~June 2026), repo left "as is and without support";
GitHub reports no detectable license file. Last push 2026-07-24 was the README notice.

- R1/R2/R3: historically plausible, now unauditable — the code is gone from the tip.
- R7 **FAIL** — unmaintained public snapshot, unclear license at tip (historically AGPL-3.0).
- **Verdict: reject.** Adopting an abandoned snapshot of a multi-plane platform
  (control plane + DB + runner) for one VM is strictly worse than 1k LOC we own.
  Useful only as a design reference, and even that requires digging old tags.

## 6. E2B infra (e2b-dev/infra)

Apache-2.0 (verified via gh api). Firecracker microVM fleet: orchestrator, envd,
API service, deployed via **Terraform + Nomad + Consul, GCP-first** (AWS beta).

- R5 **FAIL** — Firecracker replaces our runtime story; not a driver for Docker+runsc.
- R6 **FAIL** — Nomad/Consul/Terraform cloud fleet for one VM is absurd surface.
- The auth layer (API keys in their API service) is entangled with their control
  plane and Postgres; nothing extractable is smaller than writing our token codec
  (which the plan already specifies as HMAC subkeys over existing strict schemas).
- **Verdict: reject; pattern reference only** (their envd-in-guest + host orchestrator
  split resembles our daemon/runtime split).

## 7. flintlock (liquidmetal-dev/flintlock)

gRPC/HTTP daemon managing **microVMs** (Firecracker, Cloud Hypervisor) on one host.
MPL-2.0, community-owned post-Weaveworks, moderate activity.

- R5 **FAIL** — manages microVMs, not OCI containers; cannot drive Docker+runsc.
- Auth: basic/token support exists but the repo README doesn't lead with it; either
  way runtime mismatch is fatal.
- **Verdict: reject; keep as the best *pattern* citation** for "single-host daemon,
  typed API, auth, drives a lower-level runtime" — i.e., independent validation that
  the S1 shape is a recognized architecture, not NIH.

## 8. kubernetes-sigs/agent-sandbox (+ k3s)

Apache-2.0, active, pre-1.0 (v0.x). `Sandbox` CRD + controller for singleton stateful
workloads; explicitly delegates isolation to gVisor/Kata via RuntimeClass; auth = the
k8s API (tokens, RBAC, admission webhooks).

- This is the one stack that genuinely covers R1 (k8s authn), R2 (RBAC + admission
  policy can constrain to one image), R3 (ValidatingAdmissionPolicy/Kyverno digest
  pinning), R5 (gVisor RuntimeClass is first-class).
- R4 PARTIAL — no one-time grants; you'd bolt our capability layer in front anyway,
  because k8s ServiceAccount tokens are bearer-reusable.
- R6 **FAIL, confirming the prior judgment** — even k3s brings apiserver, etcd/sqlite,
  controller-manager, scheduler, CNI, kubelet, RuntimeClass config, plus a pre-1.0
  controller, to replace a ~1k-LOC daemon on ONE VM. Our V1 protocol (fs mutation SSE,
  exec serialization, renew/hard-expiry, binding receipts) still has to be implemented
  as a shim on top — the daemon doesn't disappear, it becomes a k8s client.
- **What changes at multi-tenant/fleet:** this judgment inverts. With N boxes,
  N tenants, warm pools (`SandboxWarmPool` CRD exists), scheduling and eviction,
  agent-sandbox on k3s becomes the credible SBX2.x target. Worth naming in the plan
  as the graduation path, not the v1.
- **Verdict: defer, don't adopt for v1.** Prior "too heavy" judgment holds.

## 9. Coder (coder/coder)

coderd control plane + provisionerd + Terraform templates + PostgreSQL; AGPL-3.0 with
enterprise-licensed premium tier; workspaces on Docker/K8s/VMs; huge active project.

- R1 PASS (tokens, identity on every action). R2 PARTIAL (template-constrained
  workspaces, but full RBAC is premium). R3 PARTIAL (pin digest in the Terraform
  template — enforceable, but by template discipline).
- R5 PASS-ish (Docker provider can set runtime runsc in the template).
- R4 FAIL — persistent user/workspace model, no one-time grants.
- R6 **FAIL** — Postgres + Terraform provisioner + a dev-platform's worth of concepts
  for ephemeral per-session sandboxes; also its workspace model (long-lived dev envs,
  agent dials out via WireGuard) is the inverse of our short-lived session model.
- R7 PARTIAL — AGPL-3.0 is workable for an internal service but is not the
  permissive bar, and the features drift premium.
- **Verdict: reject.** Remote-dev platform, not a session-sandbox API.

## 10. Others checked

- **sysbox** (nestybox, Apache-2.0): a *runtime* ("next-generation runc") — competes
  with runsc at R5's layer, offers no remote API. Out of scope by construction.
- **Dagger**: DAG/CI engine with its own containerd-based runner; API is for pipeline
  graphs, not session lifecycle; large surface. Reject.
- GitHub topic sweeps (sandbox/container-api adjacent) surface the same families:
  Firecracker fleets (E2B-likes), k8s CRDs, or code-exec micro-sandboxes (one-shot
  stdin/stdout runners like sandkasten/piston — no session fs/exec/SSE model, no
  narrow authz). Nothing found that does authed + image-pinned + scoped + single-node
  + runtime-agnostic container sessions.

---

## Score matrix

| Candidate | R1 auth | R2 narrow | R3 digest | R4 replay | R5 runsc | R6 one-VM | R7 license |
|---|---|---|---|---|---|---|---|
| docker-socket-proxy | FAIL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| Portainer CE | PASS | FAIL(CE) | FAIL | FAIL | PASS | FAIL | PARTIAL |
| containerd API+mTLS | PARTIAL(DIY) | FAIL | FAIL | FAIL | PASS | PARTIAL | PASS |
| faasd | PASS | PARTIAL | FAIL | FAIL | FAIL | PASS | FAIL(EULA) |
| Daytona | n/a (code pulled) | — | — | — | — | — | FAIL |
| E2B infra | entangled | — | — | — | FAIL | FAIL | PASS |
| flintlock | PARTIAL | — | — | — | FAIL | PASS | PASS(MPL) |
| agent-sandbox+k3s | PASS | PASS | PASS | PARTIAL | PASS | FAIL | PASS |
| Coder | PASS | PARTIAL | PARTIAL | FAIL | PASS | FAIL | PARTIAL(AGPL) |

## Security lesson — the Docker-AuthZ CVE class (grounds "own your security edge")

The recurring failure mode across the adopt candidates above (docker-socket-proxy,
containerd API, faasd, Portainer CE) is the same: they bolt an **external
authorization layer** onto a privileged runtime socket, and the authorization
layer is where the isolation boundary breaks. Primary source, Docker's own
runtime:

- **CVE-2024-41110** (Docker Engine, AuthZ plugin bypass; CVSS 10.0 / critical).
  A specially crafted API request with `Content-Length: 0` caused the Docker
  daemon to **forward the request to an authorization (AuthZ) plugin without its
  body**, so the plugin approved a request whose real (empty-body) effect it never
  saw — bypassing the plugin's access-control decision. It was a regression of an
  earlier 2018 bypass (CVE-2018-15664 class) that had been fixed and reintroduced.
  Sources: Docker Security Advisory GHSA-v23v-6jw2-98fq; Moby commit series fixing
  the AuthZ request-forwarding path in Engine 23.0.14 / 27.1.0.

The lesson for this build: **an authorization plugin/proxy in front of a
root-equivalent runtime socket is a security boundary you do not fully control** —
its correctness depends on the daemon faithfully presenting every request to it,
which the CVE shows the daemon did not. Every "adopt" candidate that scored PASS
on R1 (auth) still routes a privileged socket behind a bolt-on authz layer of
exactly this shape. Our S1 daemon instead **is** the authorization layer and
**never exposes a raw Docker/containerd socket or a "run this spec" verb** — it
exposes only narrow session verbs it constructs server-side. That is the OWN
disposition in the TAKE/ADAPT/OWN/RE-HOST split: own your security edge, never
inherit someone else's authz on your isolation boundary. This is a design
judgment grounded in the CVE class above, not a claim that any surveyed tool
carries the specific CVE.

## Final verdict: **BUILD — the plan stands.**

Nothing covers R1-R3+R5-R6 with a clean R4 seam. The only candidate passing
R1-R3+R5 (agent-sandbox on k3s) fails R6 decisively and still needs our capability
layer and a protocol shim on top. Every right-sized tool (socket-proxy, faasd) fails
the narrowing/digest/replay requirements or the license; every tool that passes the
security requirements is a platform.

The decisive asymmetry: SBX1.4's S1 is not a from-scratch daemon. Protocol client,
strict schemas, binding registry, nonce store, and `RunscSessionRuntimeV1` are merged;
S1 adds an HTTP/SSE shell plus a ~200-line HMAC token codec. Adopting any surveyed
tool discards that merged, reviewed surface, imports 10k-500k LOC of third-party
surface into the host-root trust boundary (the daemon runs as root and calls Docker —
plan's own threat model), and *still* requires custom code for digest admission,
one-time capabilities, and the V1 session semantics (fs watch SSE, exec serialization,
renew/hard-expiry, deterministic sandboxId). That trade is a loss on every axis.

Two actionable side-findings for the plan:
1. Cite flintlock (MPL-2.0, single-host gRPC microVM daemon) as prior art validating
   the "minimal authed daemon over a lower runtime" shape.
2. Name kubernetes-sigs/agent-sandbox (Apache-2.0, gVisor RuntimeClass, WarmPool CRD)
   as the explicit multi-tenant/fleet graduation path — the "too heavy for v1"
   judgment is confirmed for one VM and inverts at SBX2.x scale.
