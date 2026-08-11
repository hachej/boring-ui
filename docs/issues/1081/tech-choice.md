# Sovereign Sandbox Service — Technology Decision Record

Status: DECISION RECORD (why we chose what we chose). Date: 2026-08-11.
Scope: the technology choices behind the sovereign sandbox service — issue #1081,
PR #1220 (architecture + plan + API contract reviewed as one gate).

This document is the standalone narrative of **how the sandbox tech-stack was
chosen**: for each major decision it states the Question, the Options considered,
the Evidence (with verbatim primary-source quotes and citations), the Decision,
and the Reasoning. It consolidates the reasoning that is otherwise spread across
the architecture doc, the execution plan, and the version-controlled research in
[`references/`](references/). Every quote below is transcribed verbatim from a
primary source cited in `references/`; anything the research flagged as
unverifiable is carried through as `[UNVERIFIED]`.

**Authorities:** the architecture doc
([`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md))
owns *what the layers are*; the plan ([`plan-sbx14.md`](plan-sbx14.md)) owns
*what ships first*; the API spec ([`api-spec.md`](api-spec.md)) owns *the wire
contract*. This record owns *why*.

---

## The product in one sentence

We are building a **sovereign sandbox service**: a control plane that hands AI
agents isolated, disposable execution environments on infrastructure **we own**
(Swiss/EU bare metal, no US cloud). **Seneca is customer #0** — it dogfoods the
service on our own product and own infra first; once hardened under real traffic,
the same service opens to the public as a sellable, E2B-compatible-but-sovereign
product. The staging is deliberate: **v1** = gVisor on one rented EU VM, single
tenant (Seneca); **v2** = multi-box, multi-tenant, microVM tier, open to the
public.

The decisions below are the technology choices that shape that product.

---

## Decision 1 — Build vs adopt: **BUILD**

### Question
Should the v1 control-plane daemon (the authenticated remote start/exec/stop API
in front of our isolation runtime) be **built** on top of our already-merged V1
protocol, or should we **adopt** an existing open-source container/sandbox
daemon and wrap it?

### Options considered
A remote container-start daemon survey scored ten candidate stacks against seven
hard requirements (`references/build-vs-adopt-survey.md`):

- **R1** authenticated remote start/exec/stop API
- **R2** authorization narrower than raw Docker (our image, our session shapes only)
- **R3** server-side image-digest pinning
- **R4** replay protection / one-time grants (or a clean seam for our nonce layer)
- **R5** drives Docker/containerd with the `runsc` runtime (doesn't replace it)
- **R6** one-VM single-tenant operational surface
- **R7** permissive license + maintained

Candidates: `tecnativa/docker-socket-proxy`, Portainer CE, raw containerd
gRPC + mTLS, faasd, Daytona, `e2b-dev/infra`, flintlock,
`kubernetes-sigs/agent-sandbox` (+ k3s), Coder, plus a sweep of code-exec
micro-sandboxes.

### Evidence
**Nothing cleared R1–R3 + R5–R6 with a clean R4 seam.** The score matrix
(verbatim from the survey):

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

Every *right-sized* tool (socket-proxy, faasd) fails the narrowing/digest/replay
requirements or the license; every tool that passes the security requirements is
a whole platform. faasd is additionally disqualified on license — its CE is now
"under a **non-commercial personal-use EULA**." Daytona's public repo "now
contains only README.md + assets" (development moved private ~June 2026). The one
stack that passes R1–R3 + R5 — `agent-sandbox` on k3s — "**FAIL[s]** R6
decisively" (it brings "apiserver, etcd/sqlite, controller-manager, scheduler,
CNI, kubelet … to replace a ~1k-LOC daemon on ONE VM") and still needs our
capability layer bolted in front.

**The decisive security finding — the Docker-AuthZ CVE class.** The recurring
failure mode across the adopt candidates is that they bolt an *external
authorization layer* onto a privileged runtime socket, and that layer is exactly
where the isolation boundary breaks. Primary source, Docker's own runtime:

> **CVE-2024-41110** (Docker Engine, AuthZ plugin bypass; CVSS 10.0 / critical).
> A specially crafted API request with `Content-Length: 0` caused the Docker
> daemon to **forward the request to an authorization (AuthZ) plugin without its
> body**, so the plugin approved a request whose real (empty-body) effect it never
> saw — bypassing the plugin's access-control decision. It was a regression of an
> earlier 2018 bypass (CVE-2018-15664 class) that had been fixed and reintroduced.
> Sources: Docker Security Advisory GHSA-v23v-6jw2-98fq; Moby commit series fixing
> the AuthZ request-forwarding path in Engine 23.0.14 / 27.1.0.

The lesson: **an authorization plugin/proxy in front of a root-equivalent runtime
socket is a security boundary you do not fully control** — its correctness
depends on the daemon faithfully presenting every request to it, which the CVE
shows the daemon did not. Every "adopt" candidate that scored PASS on R1 still
routes a privileged socket behind a bolt-on authz layer of exactly this shape.

### Decision
**BUILD.** Ship the S1 daemon: an HTTP/SSE server that **is** the authorization
layer and **never exposes a raw Docker/containerd socket or a "run this spec"
verb** — it exposes only narrow session verbs it constructs server-side.

### Reasoning
The decisive asymmetry is that S1 is **not** a from-scratch daemon: the V1
protocol client, strict schemas, binding registry, nonce store, and
`RunscSessionRuntimeV1` are **already merged**. S1 adds "an HTTP/SSE shell plus a
~200-line HMAC token codec." Adopting any surveyed tool would discard that merged,
reviewed surface; import 10k–500k LOC of third-party code into the host-root trust
boundary (the daemon runs as root and calls Docker); and *still* require custom
code for digest admission, one-time capabilities, and V1 session semantics (fs
watch SSE, exec serialization, renew/hard-expiry, deterministic sandboxId). That
trade is a loss on every axis. And the CVE class makes the seductive shortcut —
"just filter the Docker API" — architecturally unsound: you cannot safely own an
isolation boundary through someone else's authz on a socket you don't control.
This is the **OWN** disposition (Decision 6): own your security edge.

Two prior-art notes preserved from the survey: **flintlock** (MPL-2.0, single-host
gRPC microVM daemon) validates that "minimal authed daemon over a lower runtime"
is a recognized architecture, not NIH; **`kubernetes-sigs/agent-sandbox`**
(Apache-2.0, gVisor RuntimeClass, `SandboxWarmPool` CRD) is named as the explicit
**multi-tenant/fleet graduation path** — the "too heavy for one VM" judgment
inverts at SBX2.x scale.

---

## Decision 2 — Isolation primitive: **gVisor (v1), microVM/Firecracker (v2)**

### Question
What is the per-session tenant-isolation boundary — a userspace-kernel container
runtime (gVisor), a hardware-virtualized microVM (Firecracker/KVM), or a
software isolate (V8)?

### Options considered
Three industry-proven models, each read from the vendor's own primary source
(`references/isolation-choices-primary-sources.md`):

1. **V8 isolates** (Cloudflare) — software isolation, no container/VM per tenant.
2. **gVisor** (Modal) — userspace application-kernel; syscall interception.
3. **Firecracker / microVM** (Fly.io, Vercel, E2B) — hardware KVM boundary.

### Evidence
**gVisor — Modal** (source: Modal Docs, Sandbox networking/security guide —
https://modal.com/docs/guide/sandbox-networking):

> "Sandboxes are built on top of gVisor, a container runtime by Google that
> provides strong isolation properties."

> "gVisor has custom logic to prevent Sandboxes from making malicious system
> calls, giving you stronger isolation than most other container runtimes."

> "the blast radius of any malicious code will be limited to the Sandbox
> container itself."

Modal markets 100,000+ concurrent gVisor-isolated sandboxes — direct evidence the
model scales for dense, cost-sensitive, medium-threat multi-tenant execution.
`[UNVERIFIED — modal.com/blog/gvisor-experiments and modal.com/blog/how-modal-works
both 404'd; GPU/nvproxy and cold-start reasoning could not be sourced to a direct
Modal quote.]`

**Firecracker/microVM — Fly.io** (source: Thomas Ptacek, "Sandboxing and Workload
Isolation," The Fly Blog, July 2020 —
https://fly.io/blog/sandboxing-and-workload-isolation/):

> "you're unlikely to have routine exploitable memory corruption flaws in Go code.
> You are sort of likely to have them in the C-language Linux kernel."

> "you're booting an actual, make-menuconfig'd kernel, in all of it's
> memory-unsafe glory. But you're doing it inside a hypervisor where, in the
> Firecracker case, really you're only worried about the integrity of the kvm
> subsystem itself."

Fly is even-handed on gVisor as the alternative:

> "You are probably strictly better off with gVisor than you are with a tuned
> Docker configuration, and I like it a lot. The big downside is performance;
> you'll be looking at a low-double-digits percentage hit, degrading with I/O
> load."

And it names the real operational cost of the microVM path:

> "you need bare metal servers to efficiently do lightweight virtualization; you
> want KVM but without nested virtualization."

**Firecracker corroboration — Vercel** (source: Vercel Docs, "Understanding
Sandboxes" — https://vercel.com/docs/sandbox/concepts):

> "Unlike Docker containers, each sandbox runs in its own Firecracker microVM with
> a dedicated kernel. This provides stronger isolation than container-based
> solutions, which makes sandboxes ideal for running untrusted code."

**V8 isolates — Cloudflare** (source: Zack Bloom, "Cloud Computing without
Containers," The Cloudflare Blog, Nov 2018 —
https://blog.cloudflare.com/cloud-computing-without-containers/) — the weakest
boundary, explicitly language-restricted:

> "An Isolate-based system can't run arbitrary compiled code ... you have to
> either write your code in Javascript (we use a lot of TypeScript), or a language
> which targets WebAssembly like Go or Rust."

**The isolation ladder** the sources line up into (a fair synthesis; no single
source states the rubric verbatim): `containers < gVisor < Firecracker/microVM`
on assurance, inverted on density/cost. Fly's own line captures it: gVisor is
"strictly better off … than a tuned Docker configuration" (containers < gVisor),
while its whole thesis is that pushing complexity "down a layer" into a hypervisor
is safer than trusting "the C-language Linux kernel" (gVisor < microVM).

### Decision
**v1 = gVisor / `runsc`. v2 = microVM / Firecracker as a second, dedicated tier**
(selectable per customer/trust level), behind the same frozen `SandboxProviderV1`
contract.

### Reasoning
The staging follows the trust escalation. v1 runs **Seneca's own agents on
Seneca's own box** — trusted-ish, medium threat. That is exactly where Modal sits:
gVisor gives "stronger isolation than most other container runtimes," limits the
blast radius "to the Sandbox container itself," runs arbitrary Linux, is dense, and
needs **no bare-metal KVM host** — the right tradeoff to *ship fast* on a rented
VM. The documented cost is the syscall/I/O performance tax Fly quantifies
("low-double-digits percentage hit, degrading with I/O load") and the fact that
the boundary is software, not hardware.

**Our economics differ from Modal's**, and this matters. Modal chose gVisor to run
100k+ concurrent sandboxes at density; our v1 driver is not density — it is
*ship-fast on infrastructure we already control*, reusing the SBX1.3 runsc boundary
we already built. Same primitive, different reason.

v2 opens to **untrusted strangers**, which raises the bar. Fly, Vercel, and E2B all
independently chose Firecracker for *untrusted arbitrary code* — the same posture a
public sovereign service demands: a hardware KVM boundary and a tiny memory-safe
Rust VMM, so a guest-kernel compromise is contained to the KVM subsystem rather
than a shared host kernel. The price to budget is Fly's requirement — "bare metal
servers … KVM but without nested virtualization" — which is an infra/sovereignty
cost, not just a code change (and see Decision 7: owning our own metal *removes*
that hosting gate). V8 isolates were rejected outright: the boundary is only as
good as V8, and it "can't run arbitrary compiled code," which agent workloads
require.

Net: a **staged** posture — gVisor now (dense, cheap, Modal-proven, medium threat),
Firecracker microVM for the sovereign v2 (hardware isolation, Fly/Vercel/E2B-proven,
high threat) — not one technology forced to serve both tiers.

---

## Decision 3 — gVisor platform: **systrap (not KVM)**

### Question
On the v1 rented VM (provider-virtualized, no `/dev/kvm`), we run
`runsc --platform=systrap`. Is that a security compromise versus the KVM platform
for untrusted multi-tenant code — i.e., should we chase a `/dev/kvm`-capable / nested
-virt host for v1?

### Options considered
gVisor's three platforms (`references/gvisor-platform-security.md`): **ptrace**
(deprecated), **systrap** (current default, works inside a VM), **KVM** (needs
`/dev/kvm`, best on bare metal).

### Evidence
The platform is a **mechanism** layer, not the security-policy layer. gVisor's
security model is defined by the **Sentry**, not the platform. Primary source
(gVisor Security Model — https://gvisor.dev/docs/architecture_guide/security/):

> "the application's direct interactions with the host System API are intercepted
> by the Sentry, which implements the System API instead."

> "No system call is passed through directly to the host."

systrap enforces the same property via seccomp `SECCOMP_RET_TRAP` and is
purpose-built for the in-VM case (gVisor Platform Guide —
https://gvisor.dev/docs/architecture_guide/platforms/, and Systrap release blog
2023-04-28 — https://gvisor.dev/blog/2023/04/28/systrap-release/):

> "The `systrap` platform relies on `seccomp`'s `SECCOMP_RET_TRAP` feature in order
> to intercept system calls. This makes the kernel send `SIGSYS` to the triggering
> thread, which hands over control to gVisor to handle the system call."

> "Systrap … does not require virtualization support from the host, making it
> well-suited to run inside a virtual machine."

> "This minimizes the attack surface of the host kernel, because sandboxed programs
> simply can't make system calls directly to the host in the first place."

The KVM platform's "isolation" wording refers to **performance**, not a stronger
boundary. The default is framed on performance:

> "The choice of platform depends on the context in which `runsc` is executing. In
> general, when running on bare-metal (not inside a VM), the KVM platform will
> provide the best performance."

And gVisor declines to defend against hardware attacks *regardless of platform*, so
KVM buys no side-channel hardening either:

> "gVisor relies on the host operating system and the platform for defense against
> hardware-based attacks … this is true even when using hardware virtualization for
> acceleration, as the host kernel or hypervisor is ultimately responsible."

### Decision
**Keep `runsc --platform=systrap` for v1.** No security requirement to provision a
`/dev/kvm`-capable VM.

### Reasoning
For our threat model (untrusted guest code trying to escape to the host or another
tenant), systrap and KVM present the **same Sentry-mediated boundary** and the
**same restricted host interface** — the guest cannot issue a host syscall directly
under any platform. KVM is a *performance* lever on bare metal, and gVisor even
notes it is "slower than systrap under nested virtualization," so forcing
`--platform=kvm` via nested KVM on an already-virtualized rented VM would be more
fragile and slower for zero security gain. The real hardening effort belongs
elsewhere: pin/patch `runsc` and the host kernel/firmware, keep the Sentry's
restrictive seccomp, enforce per-tenant filesystem backing (mitigating the
platform-agnostic page-cache side channel), and set hard resource limits (gVisor
does not defend against resource-exhaustion DoS). KVM is revisited only as a
*performance* option if/when we run on bare metal with `/dev/kvm` and profiling
shows address-space-switch cost dominating. `[UNVERIFIED: the gVisor GHSA advisory
list was not enumerated for systrap-tagged issues; a quick scan is recommended
before locking v1.]`

---

## Decision 4 — Managed k8s vs self-hosted daemon (v1): **daemon on a rented Linux VM**

### Question
Can we run the per-session sandbox on a **managed** Kubernetes from a Swiss/EU
provider instead of self-hosting a bespoke daemon (or self-managed k3s)? Hard
requirement: **gVisor/runsc as the isolation boundary** (a `RuntimeClass: gvisor`
+ the `runsc` binary + a modified `containerd` config on each node) plus
digest-pinned admission.

### Options considered
Three Swiss/EU managed-k8s offerings (`references/managed-k8s-ch-eval.md`): **Hikube**
(Hidora, Swiss-sovereign, KubeVirt-based), **Exoscale SKS** (Akenes SA / A1
Telekom Austria — EU-owned, Swiss-operated, real CH zones), **OVH MKS** (French/EU).
Plus `kubernetes-sigs/agent-sandbox` layered on managed k8s.

### Evidence
**The make-or-break gate:** none of the three publicly document gVisor / a custom
`RuntimeClass` / bring-your-own container runtime on their managed worker nodes.

> "**None of the three publicly document gVisor / a custom `RuntimeClass` /
> bring-your-own container runtime on their managed worker nodes.** … On a managed
> k8s the provider owns the node image and the `containerd` configuration;
> installing `runsc` and wiring a `RuntimeClass` requires either (a) writing to
> `/etc/containerd/config.toml` and dropping a binary via a **privileged
> daemonset** that survives node-image upgrades, or (b) a provider-supported
> custom node image / BYO-runtime feature. Neither is advertised by any of the
> three."

Cost is **not** the deciding factor (all roughly €40–90/mo for a minimal cluster).
And `agent-sandbox` does **not** remove the gate — it "explicitly 'delegates
low-level container isolation to secure Sandbox Runtimes (like gVisor or Kata
Containers) through Kubernetes' `RuntimeClass`.'" so it *requires* exactly the
same undocumented capability. Jurisdiction doesn't rescue it either: the strongest
Swiss story (Hikube) is also the least-documented on runtime customization. (One
research correction preserved: Exoscale is **EU-owned, not Akamai/US-acquired** —
the "Akamai" premise was wrong.)

### Decision
**v1 uses the bespoke daemon on self-controlled nodes** (a rented Linux VM, or
self-managed k3s on our own nodes). Managed k8s is a **v2 option, contingent on a
written gVisor-support answer** from a provider.

### Reasoning
SBX1.4's entire security model is `runsc` per session. If the provider owns the
node image and containerd config, we cannot *guarantee* a stable `RuntimeClass:
gvisor` — managed k8s "trades away the one thing this design cannot compromise."
A self-managed VM/k3s node gives us root on the node and full control of
containerd + runsc, which is exactly what the isolation design needs. Managed k8s
would buy only ops convenience (cost is a wash) while costing node-level control.
The single action that would reopen the door is a *written* provider answer to one
question — "Can we install a custom container runtime (gVisor/runsc) via a
`RuntimeClass` and privileged daemonset on managed worker nodes, and will it
survive node-pool upgrades?" — and until that answer exists, v1 proceeds on
self-controlled nodes. The same logic drives the microVM tier toward our own metal
(Decision 7). `[VERIFY WITH PROVIDER — the gVisor-on-managed-nodes question is
unanswered on all three.]`

---

## Decision 5 — Orchestration path: **daemon+placement (v1) → Nomad+Firecracker (v2) → k8s+KubeVirt (enterprise)**

### Question
How does the service scale from one box to a fleet — what schedules and places
sandboxes across nodes?

### Options considered
v1 single-box placement config; Nomad+Consul (E2B's choice); k8s +
`agent-sandbox`/KubeVirt.

### Evidence
E2B's production stack is direct validation of the Nomad+Firecracker path
(`references/e2b-internals-architecture.md`): "The whole platform is scheduled as
**Nomad jobs** across **Consul**-discovered node pools," with a clean three-tier
split — placement/scheduling in `api` (control plane), microVM mechanics in
`orchestrator` (data plane), guest actions in `envd`. The survey independently
named `agent-sandbox` on k8s (with its `SandboxWarmPool`/`SandboxClaim` CRDs) as
the "credible SBX2.x target" once there are "N boxes, N tenants, warm pools …
scheduling and eviction." The managed-k8s eval named **Hikube's KubeVirt
VM-per-session** as a natural boundary for the large/enterprise Swiss-sovereign
tier.

### Decision
- **v1:** the daemon *is* the placer — a constant "the one box" placement config
  (S5's 256-bucket→one-box), **no scheduler written**.
- **v2 (multi-box):** **Nomad + Firecracker**, harvested/adapted from E2B.
- **large/enterprise:** **k8s + KubeVirt** (or `agent-sandbox`) as the graduation
  path where multi-tenant, warm pools, and per-tenant network/quota isolation earn
  their keep.

### Reasoning
Placement is the one thing a single-box v1 must *not* build: the architecture's
discipline guardrail says "ship a constant 'the one box' placer … **Do not write a
scheduler in v1**." When multi-box arrives, Nomad is the reuse sweet spot precisely
because **E2B already proved Nomad+Firecracker in production** and the plumbing is
Apache-2.0 to harvest (Decision 6) — re-growing our own scheduler would be
reinventing what E2B's `orchestrator` already does. At true multi-tenant fleet
scale, k8s inverts from "too heavy" to "the stronger foundation," because
per-tenant isolation (namespace + RBAC + `NetworkPolicy` + `ResourceQuota`), warm
pools (`SandboxWarmPool`), and multi-node scheduling are native rather than
hand-rolled. Because all of this lives **below** the `SandboxProviderV1` contract,
the whole orchestration progression is a backend/ops decision that never touches
Seneca's app code.

---

## Decision 6 — Harvest E2B for v2: **yes — TAKE/ADAPT/OWN/RE-HOST**

### Question
For the v2 microVM tier, do we build Firecracker orchestration from scratch or
harvest `e2b-dev/infra` (Apache-2.0)?

### Options considered
Rebuild from scratch vs. fork-and-adapt E2B vs. adopt E2B wholesale.

### Evidence
`references/e2b-internals-architecture.md` read the actual repo tree. The
genuinely hard, cloud-neutral IP is liftable:

- **`envd`** — the in-microVM guest agent (exec/process, filesystem, port-forward,
  init/auth over vsock/HTTP+gRPC): "**Highly liftable.** Self-contained guest
  agent; only assumes a Linux guest. Best single component to study/harvest." It is
  "E2B's analog of our boring-bash."
- **`orchestrator` microVM core** (`pkg/sandbox`, UFFD snapshot restore, NBD
  rootfs, `cmd/*build`): "**Harvest, high value, high effort.** Cloud-neutral
  (Linux+KVM+Firecracker); storage backend pluggable. The hard-to-rebuild IP."
- **Fast start** = UFFD snapshot restore: "A paused/checkpointed VM's memory is
  restored lazily via userfaultfd; rootfs via **NBD**."

The cloud-weld to strip: "**Nomad+Consul do scheduling, discovery, and health.**
Any extraction must supply our own placement + node registry to replace them," and
E2B's auth is "team/API-key/billing fused to their SaaS." The architecture doc's
disposition split:

| Disposition | What | Why |
|---|---|---|
| **TAKE** | Nomad↔Firecracker job specs; **envd**; UFFD snapshot/restore fast-start | The wheel — hard plumbing E2B already proved. |
| **ADAPT** | E2B `orchestrator`/placement → reference for our Layer-2 scheduler, simplified for our scale | We don't need E2B's full fleet complexity day one. |
| **OWN** | The Layer-1 **auth / capability / nonce** layer | It sits on our security boundary; the Docker-AuthZ CVE lesson — own your security edge. |
| **RE-HOST** | The microVM/Nomad plumbing, redeployed on **CH bare metal** | E2B assumes US cloud; re-hosting sovereign IS the differentiator. |

### Decision
**Harvest E2B maximally for v2**, under the TAKE/ADAPT/OWN/RE-HOST split, and
**re-host it sovereign**. First step is a scoped "E2B extraction spike" (one bead,
no production code): confirm the LICENSE is still Apache-2.0 at the tip (verify —
cf. the Daytona/faasd license traps), map liftable vs. cloud-welded files, produce
a real extraction-effort estimate, and measure the `envd ↔ boring-bash` gap.

### Reasoning
E2B has already solved the hardest microVM-orchestration problems and published
them under a permissive license — rebuilding Firecracker job specs, an in-VM agent,
and UFFD snapshot/restore from scratch would be pure waste. But "E2B did it for us"
must not slide into "adopt E2B wholesale": its stack is welded to GCP/AWS/Cloudflare
and its auth to its SaaS billing model. So we harvest the *plumbing* and **own the
thin sovereign control plane on top** — never inheriting E2B's reusable-key auth on
our isolation boundary (Decision 1's CVE lesson, Decision 9's transport). Two
guardrails: this applies to **v2 only** (v1 is gVisor — E2B's Firecracker is the
wrong primitive to pull forward), and the LICENSE must be re-verified at the tip
before any fork.

---

## Decision 7 — Hosting: **CH/EU sovereign — own bare metal / rented CH VM**

### Question
Where does execution run? Any US cloud in the path, or Swiss/EU infrastructure we
own?

### Options considered
US-cloud PaaS sandboxes (E2B, Vercel Sandbox, Modal, Fly) vs. Swiss/EU providers
(Infomaniak / Hikube / OVH) vs. our own bare metal.

### Evidence
The competitors are structurally US-cloud-locked. Vercel Sandbox pins region
(source: Vercel Docs, "Understanding Sandboxes" —
https://vercel.com/docs/sandbox/concepts): sandboxes "automatically provision in
`iad1` region" (US). E2B is EU-*region*-available but a US company with US-cloud
infra; the architecture doc's contrast: "E2B, Vercel Sandbox, Modal, and Fly are
**US-cloud-locked** — their control planes and fleets assume GCP/AWS/Cloudflare and
**cannot be self-hosted sovereign**." The jurisdiction reasoning is the **CLOUD
Act**: a customer who cannot legally or strategically put agent execution on US
cloud needs infra with "**no US cloud** in the execution path and no US CLOUD Act
exposure." The managed-k8s eval maps the Swiss/EU providers and confirms Exoscale
is EU-owned (not US-acquired), with Hikube the cleanest Swiss-sovereign story.

### Decision
**Host on Swiss/EU infrastructure we own** — a rented CH/EU Linux VM for v1
(Infomaniak / Hikube / OVH class), and **our own bare metal / Cloud Hypervisor +
KVM** for the v2 microVM tier and the enterprise "customer's own metal" tier.

### Reasoning
Sovereignty is the product's reason to exist, not a feature: agents execute on
infrastructure we (and our customers) own, with no US CLOUD Act exposure. This also
*removes* the microVM hosting gate — Fly notes microVMs "need bare metal servers …
KVM but without nested virtualization"; owning the metal means we can run
Firecracker/CH microVMs sovereign, which US-cloud-locked competitors **cannot**
offer on customer-chosen sovereign infra. v1 proves the claim end-to-end (Seneca on
our EU box); the public product sells it; the re-hosting of harvested E2B plumbing
(Decision 6) onto CH metal is "not a limitation we work around — it is the product."

---

## Decision 8 — Daemon language & placement: **Node/TS in `packages/boring-sandbox`**

### Question
What language and where in the repo does the v1 control-plane daemon live?

### Options considered
A new Go service mirroring E2B's stack vs. Node/TypeScript reusing our merged V1
surface.

### Evidence
The plan's E2B-grounded module layout (`plan-sbx14.md` §"v1 structure
recommendation") maps E2B's three tiers onto our existing TypeScript package:

- Control-plane API + placement (E2B `api` + orchestrator scheduling, minus
  Nomad/Consul) → **`packages/boring-sandbox/src/worker/**`** — the S1 daemon:
  HTTP/SSE server, the seven V1 routes, capability+nonce auth, admitted-cohort
  load, single-worker placement config.
- Per-node orchestrator (E2B `orchestrator`) → **`packages/boring-sandbox/src/providers/runsc/**`**
  — `RunscSessionRuntimeV1` driving Docker+runsc; the daemon calls it **in-process**,
  not over gRPC, "because control plane and data plane are the same box in v1."
- Provider seam (E2B's `api↔orchestrator` gRPC `SandboxService`) → **`SandboxProviderV1`**,
  the already-frozen TS contract; Seneca composes the `remote-worker` provider
  through it.
- In-VM guest agent (E2B `envd`) → **`packages/boring-bash`**.

### Decision
**Node/TypeScript, in `packages/boring-sandbox`.** The daemon is the **server-half
of the `remote-worker` provider**, reusing `SandboxProviderV1` and the merged V1
schemas; it calls `RunscSessionRuntimeV1` in-process.

### Reasoning
The entire build-vs-adopt asymmetry (Decision 1) rests on reusing the *already
merged* V1 protocol client, strict schemas, binding registry, nonce store, and
`RunscSessionRuntimeV1` — all TypeScript in `packages/boring-sandbox`. A Go service
would throw that surface away and re-implement it against the same schemas. Because
v1 collapses control plane and data plane onto one box, the E2B `api↔orchestrator`
gRPC boundary is realized as an in-process TS interface call, not a network hop —
we keep the *seam* (so a Firecracker backend swaps in later behind the frozen
contract) without paying for gRPC we don't need at one-box scale. Honest caveat
from the plan: today's `SandboxProviderV1` surface (`create`/`invalidate?`/`close?`
plus the pair's `Sandbox`/`Workspace`/`dispose()`) does **not** yet mirror E2B's
six-RPC `SandboxService` set — aligning it is a v2-entry refactor when the microVM
provider lands, not a v1 fact.

---

## Decision 9 — Transport & auth: **Tailscale-only ingress + capability+nonce (not reusable API keys)**

### Question
How does Seneca reach the daemon over the network, and how is each request
authorized — a reusable API key (E2B's model) or something narrower?

### Options considered
Transport: public HTTPS + firewall allowlist, provider-private network, mTLS, or
Tailscale-only. Auth: E2B-style reusable `X-API-Key` vs. short-lived
capability tokens + single-use nonces.

### Evidence
**Why not reusable keys** — E2B authenticates every request with a "long-lived
reusable API key" (`E2B_API_KEY`, `X-API-Key` header) and a single per-sandbox
bearer `secure_token`; "There is no per-request nonce / capability scoping"
(`references/e2b-internals-architecture.md`, `control-plane-api-spec.md`). Our
model is deliberately finer: each operation is authorized by a capability whose
claims bind `operation`, `workspaceId`, `sandboxId`, `requestDigest` (SHA-256 of
the exact request), issue/expiry, and a **single-use `nonce`** recorded in a
persistent append-only store; max lifetime 5 minutes; replay rejected with
`REMOTE_WORKER_CAPABILITY_REPLAY`. The stated rationale is the Decision-1 CVE
lesson: "the Docker-AuthZ CVE lesson — **own your security edge; never inherit
someone else's reusable-key auth on your isolation boundary** … A leaked E2B key
grants standing access until rotated; a leaked boring capability is already expired
and already consumed."

**Why Tailscale-only** (`plan-sbx14.md` §"transport decision"):

> "The transport decision is **Tailscale-only ingress with HTTPS**: … The provider
> firewall denies public ingress to the worker; a tailnet ACL allows only the named
> seneca node/service identity to reach the worker HTTPS port. … Caddy on the worker
> terminates TLS on the worker's `tailscale0` address … The public interface has no
> HTTP or HTTPS listener."

Tailscale-only is preferred over a firewall allowlist "because v1 must not assume
stable seneca egress IPs." mTLS "was considered and deferred for this single
operator-controlled canary" — Tailscale authenticates node identity and encrypts
the overlay, HTTPS authenticates the service, and request-bound HMAC capabilities
authenticate application requests, so a second cert plane "would increase failure
modes without replacing the static-secret rotation requirement." This also mirrors
E2B's private data-plane assumption.

### Decision
**Tailscale-only ingress** (Caddy TLS on `tailscale0`, daemon on loopback only, no
public listener) plus **capability tokens + single-use nonces** as the request
auth — **not** reusable API keys at the isolation boundary. mTLS deferred until
ingress leaves the tailnet or independent clients are added. The E2B-compatible
public API-key experience is provided by a v2 edge compat shim that **exchanges a
public key for server-side capabilities**, so the key never reaches the isolation
boundary.

### Reasoning
Own the security edge. A reusable key is a standing credential; a request-bound,
single-use, 5-minute capability that is verified against a stored binding cannot be
lifted and replayed against a different call, and is already spent when leaked. That
is a strict security improvement over E2B and a sovereignty selling point. Tailscale
gives node-identity authentication and an encrypted overlay without assuming stable
egress IPs or standing up a second certificate-rotation plane for a single canary —
the right amount of transport security for one operator-controlled tenant, with mTLS
held in reserve for when the trust surface widens. Honest v1 caveat: until the edge
compat shim ships, Seneca holds the daemon's host-root-equivalent static secret and
mints capabilities client-side — so "Seneca is just a normal public consumer" is a
v2 target, not a v1 fact.

---

## Decision 10 — Product path: **dogfood on Seneca → open to public, behind two gates**

### Question
How does the service go from an internal tool to a sellable public product without
either shipping insecurely or over-building v1?

### Options considered
Build the full multi-tenant product up front vs. dogfood a correctly-shaped v1 on
Seneca first and productize behind explicit gates.

### Evidence
The governing dogfood rule (`sandbox-service-architecture.md` §3):

> "**Seneca must consume the sandbox through the SAME wire contract and execution
> path a future public customer would use — the real control-plane API, via the
> existing `SandboxProviderV1` contract over the network daemon — NOT a private
> internal path.**"

The discipline guardrail (§6): "**Interfaces product-grade; guts one-box-simple.**
Every temptation to make a v1 implementation 'product-complete' gets stubbed behind
its interface instead." Two owner-gated graduation gates: the **v1-complete exit
criteria** (six hygiene claims that graduate v1 and authorize *starting* the v2
backlog) and the separate, higher **public-opening gate** — a three-part hard
blocker: (1) the **isolation-tier position** ("untrusted public self-serve requires
the microVM / Firecracker tier plus the continuously-running SBX1.5
evidence-admission gates; shared gVisor is authorized only for trusted/first-party
tenants … until an explicit, written owner risk-acceptance for shared gVisor
lands"), (2) **egress + abuse controls** (v1 is egress-deny-only; a public product
cannot be), and (3) **multi-tenant edge auth / the compat shim** (so no tenant ever
holds the host-root-equivalent secret).

### Decision
**Dogfood on Seneca (own infra) first, then open to the public** — but only after
both the v1-complete exit criteria **and** the three-part public-opening gate hold.
v1 ships product-shaped interfaces with one-box-simple guts; the productization
backlog (multi-tenant auth, quotas/metering/billing, self-serve console, isolation
tiers, egress/abuse controls, SBX1.5 fleet admission) is explicitly v2+.

### Reasoning
Dogfooding hardens the *product's execution path* precisely because the dogfooder
drives the *public wire surface* — every exec/fs/lifecycle bug Seneca hits is a bug
a future customer would have hit. A `Seneca-special` shortcut (a direct Docker call,
a bypassed handshake, an in-process runtime instead of the network daemon) would
harden a private integration nobody will ever sell, so the enforced invariant is
that **no production code path branches on caller identity** and V1-mode combined
with legacy env **fails closed**. Keeping the guts one-box-simple avoids the failure
mode of "building E2B in v1" — sinking the dogfood under a scheduler, a metering
pipeline, and a console nobody uses. The day we flip on the first public tenant, the
only new code is *multi-tenancy*, not *the execution path*. Opening to untrusted
strangers is a genuine trust escalation, so it is gated separately and higher: shared
gVisor is not a self-serve-untrusted default without written owner risk-acceptance;
otherwise the microVM tier plus continuous evidence-admission is required.

---

## Decisions at a glance

| # | Decision | Choice | Primary grounding |
|---|---|---|---|
| 1 | Build vs adopt | **BUILD** the daemon | build-vs-adopt survey (R1–R7); Docker-AuthZ CVE-2024-41110 |
| 2 | Isolation primitive | **gVisor v1 → microVM/Firecracker v2** | Modal, Fly, Vercel, Cloudflare quotes; isolation ladder |
| 3 | gVisor platform | **systrap** (not KVM) | gVisor docs — platform = performance, Sentry = boundary |
| 4 | Managed k8s vs daemon | **daemon on rented Linux VM** | managed-k8s eval — gVisor-on-managed-nodes undocumented ×3 |
| 5 | Orchestration | **daemon+placement → Nomad+Firecracker → k8s+KubeVirt** | E2B Nomad+Firecracker in prod; agent-sandbox at fleet |
| 6 | Harvest E2B (v2) | **yes — TAKE/ADAPT/OWN/RE-HOST**, re-hosted sovereign | e2b-dev/infra internals (Apache-2.0) |
| 7 | Hosting | **CH/EU sovereign — own bare metal / rented CH VM** | CLOUD Act; Vercel iad1-only; E2B US company |
| 8 | Daemon language/placement | **Node/TS in `packages/boring-sandbox`** | reuse merged V1 surface; plan module layout |
| 9 | Transport & auth | **Tailscale-only ingress + capability+nonce** | plan threat model; CVE "own your security edge" lesson |
| 10 | Product path | **dogfood Seneca → public, behind two gates** | architecture §3, §4a, §6 |

---

## Sources

All quotes above are transcribed from the version-controlled research in
[`references/`](references/), which cites the primary sources directly:

- [`references/build-vs-adopt-survey.md`](references/build-vs-adopt-survey.md) —
  R1–R7 survey; CVE-2024-41110 / GHSA-v23v-6jw2-98fq.
- [`references/isolation-choices-primary-sources.md`](references/isolation-choices-primary-sources.md)
  — Modal / Fly / Cloudflare / Vercel / E2B quotes.
- [`references/gvisor-platform-security.md`](references/gvisor-platform-security.md)
  — gVisor Platform Guide, Security Model, Systrap release blog.
- [`references/managed-k8s-ch-eval.md`](references/managed-k8s-ch-eval.md) —
  Hikube / Exoscale / OVH; gVisor-on-managed-nodes gate; jurisdiction.
- [`references/e2b-internals-architecture.md`](references/e2b-internals-architecture.md)
  — `e2b-dev/infra` service topology, envd, UFFD, harvest dispositions.
- [`references/control-plane-api-spec.md`](references/control-plane-api-spec.md) —
  E2B public surface vs. our `remoteWorkerProtocolV1`; capability+nonce divergence.
- Architecture: [`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md).
- Plan: [`plan-sbx14.md`](plan-sbx14.md). API contract: [`api-spec.md`](api-spec.md).
