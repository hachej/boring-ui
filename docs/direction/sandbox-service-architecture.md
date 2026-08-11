# Sandbox Service — Architecture & Vision (dogfood → product)

Owner vision captured 2026-08-11. This is the ARCHITECTURE that sits **above**
the SBX1.4 execution plan (PR #1219, `docs/issues/1081/plan-sbx14.md`). The
plan is the v1 build; this document is the shape of the product that build is
the first slice of. Where the plan and this document disagree on *what a layer
is*, this document wins; where they disagree on *what ships first*, the plan
and `DIRECTION.md` win.

Precedence: owner > `DIRECTION.md` > this file > issue plan folders.

---

## 0. The one-sentence thesis

We are building a **sovereign sandbox service** — a control plane that hands
agents isolated, disposable execution environments on infrastructure we own
(Swiss/EU bare metal, no US cloud). **Seneca is customer #0**: it dogfoods the
service on the owner's own product and own infra first; once stable, the same
service opens to the public as a sellable product.

The service is architected **as a public product from day one**. Seneca is a
normal consumer of the public surface, not a privileged internal integration.

---

## 1. Vision & staged path

### v1 — Seneca on own infra (dogfood)

- **Isolation:** gVisor / `runsc` (already built and proven in SBX1.3).
- **Topology:** single rented KVM VM, single tenant (Seneca), single box.
- **Control plane:** the SBX1.4 daemon (PR #1219) — the *v1 slice of the
  product's control-plane API*, minimal but shaped correctly.
- **Consumer:** Seneca's agent runtime, via `SandboxProviderV1`
  (`remote-worker` provider) over the real network daemon.
- **Goal:** prove the sovereignty claim end to end — an agent executing on our
  own EU box, isolated by our own runtime, admitted by our own evidence gate —
  and harden it under real Seneca traffic.

### v2 — open to the public (product)

- **Isolation tiers:** gVisor (shared, dense) **and** microVM/Firecracker
  (dedicated, hardware isolation) selectable per customer/trust level.
- **Topology:** multi-box fleet, multi-tenant, real placement/scheduler.
- **Control plane:** the same API surface, now with multi-tenant auth,
  API keys, quotas, metering, billing, self-serve signup + console.
- **Admission:** SBX1.5 fleet-admission automation (evidence-bound box
  qualification, drift policy, CVE game-day) running continuously.

### v1 → v2 exit criteria — what "stable" means concretely

v1 is "stable enough to open to the public" **only when all of the following
hold** (owner-gated; each is a claim we can point at, not a vibe):

1. **Seneca has run production agent traffic on the remote runsc worker for a
   sustained soak** (target: ≥ 4 weeks of real workspaces, no owner-visible
   sandbox regression, no manual daemon babysitting between deploys).
2. **The admission gate is admitting, not just refusing.** A real
   `openat2`-passing runsc cohort exists and a fleet-admission evidence run
   binds the frozen SBX1.4 digests (`fleetAdmissionClaimed: true`) — today it
   is refusal-only (the single biggest v1 blocker; see `sbx14-scoping.md`).
3. **Replay defense survives restart.** Persistent nonce store + boot-epoch
   fencing shipped (SBX1.4-C / #1167 atomicity), with the "consumed nonce
   survives simulated restart" regression green.
4. **Image pinning is enforced.** No container starts unless workload + helper
   digests equal the admitted evidence digests (SBX1.4-B), fail-closed with a
   stable code.
5. **The control-plane API is the only path Seneca uses.** No `Seneca-special`
   bypass exists in the codebase (grep-enforceable; see §3).
6. **A qualified-box runbook exists and has been rehearsed once** — provision,
   register, admit, drain, restore — so a second box can be stood up without
   the owner in the loop for every step.

Until 1–6 hold, the service stays single-tenant Seneca-only. Meeting them is
the gate to start the v2 productization backlog (§5), **not** a signal to have
built any of it early (§6).

---

## 2. The four-layer architecture

The rule for every layer: **the interface is product-shaped now; the
implementation is v1-minimal.** We get the seam right so v2 is a swap, not a
rewrite.

| Layer | Exists today | v1 implements (minimal) | v2 adds | Reference to harvest | Interface that must be right NOW |
| --- | --- | --- | --- | --- | --- |
| **1. Control-plane API** — auth, capability/nonce, session CRUD. The public product surface. | SBX1.4 daemon (PR #1219): HTTP/SSE, static-secret handshake, nonce store, session lifecycle/fs/exec/renew/events | Single-box daemon, one shared secret, in-process/append-only nonce store | Multi-tenant auth, API keys, quotas, metering, billing, console | E2B `api` service (Apache-2.0) — API shape, session lifecycle verbs | The **wire contract** (session create/exec/fs/renew/events + capability/nonce grant semantics). Adding tenants/keys later must not reshape these verbs. |
| **2. Placement / scheduler** — pick a box for a session. | Nothing (implied single box) | **Interface only** — a `null`/single-box placer that always returns "the one box" | Real scheduler: fleet, warm pools, bin-packing, eviction, per-tier node selection | E2B `orchestrator` + Nomad; `kubernetes-sigs/agent-sandbox` `SandboxWarmPool` CRD | The **placement seam** must exist as a named interface the control plane calls, even though v1's impl is a constant. If the control plane assumes "one box" inline, v2 needs surgery. |
| **3. Backend driver** — `SandboxProviderV1` (**EXISTS**). The runtime swap seam. | `packages/boring-sandbox` — `SandboxProviderV1` contract, `runsc` provider, `remote-worker` client/provider split, qualification harness | gVisor / `runsc` provider driving Docker+runsc | Firecracker / microVM provider as a second `SandboxProviderV1` impl | E2B envd + Firecracker job specs; Fly.io Firecracker; Modal gVisor | Already frozen: the `SandboxProviderV1` interface. This is the proven swap seam — v2 adds a provider, does not touch the contract. |
| **4. In-sandbox agent** — the in-guest exec/fs process. | `boring-bash` (in-guest environment) | boring-bash serving fs/exec inside the runsc container | Snapshot/restore fast-start, richer in-guest protocol at microVM scale | E2B **envd** (in-VM agent) — the canonical shape to align to | The **in-guest protocol boundary** (how the daemon talks to the in-guest agent). Align boring-bash to envd's shape now so the microVM tier can reuse the same guest contract. |

### Layer notes

- **Layer 1 is the product.** Everything a public customer touches is this API.
  It is small in v1 (the daemon) but it is *the* surface — so its verbs and its
  capability/nonce grant model are the highest-stakes interface in the whole
  system. Own it completely (§4, §6).
- **Layer 2 is the classic v1 trap.** A scheduler is where E2B, Modal, and Fly
  spend enormous effort. In v1 we have one box, so the *implementation* is a
  constant — but we still declare the interface (`placeSession(request) → box`)
  so v2's real scheduler drops in behind it. Building a real scheduler in v1 is
  the failure mode named in §6.
- **Layer 3 is already done right.** The `SandboxProviderV1` extraction (SBX1.x)
  is exactly this pattern: mode ⇄ provider, runtime + sandbox swap as one pair
  (coding-invariant 5). gVisor today, Firecracker tomorrow, contract unchanged.
- **Layer 4 aligns to envd.** boring-bash already exists; the discipline is to
  keep its host↔guest protocol shaped like envd so the same in-guest agent
  works whether the outer isolation is gVisor or a microVM.

---

## 3. The dogfood governing rule

> **Seneca must consume the sandbox through the SAME API a future public
> customer would use — the real control-plane API, via the existing
> `SandboxProviderV1` contract — NOT a private internal path.**

Dogfooding only hardens the *product* if the dogfooder is a normal consumer of
the *public surface*. Every bug Seneca hits is then a bug a future customer
would have hit. A `Seneca-special` shortcut — a direct Docker call, a bypass of
the capability/nonce handshake, an in-process runtime instead of the network
daemon — would harden a private integration nobody will ever sell.

**Concretely:**

- Seneca points its agent config at the `remote-worker` `SandboxProviderV1`
  provider, which speaks the daemon's wire protocol over the network — the same
  path a public tenant's agent would use.
- Seneca authenticates through the control-plane handshake and receives
  capability/nonce grants like any consumer. No ambient trust because "it's our
  own product."
- Seneca's sessions are admitted by the same evidence/image-pinning gate as any
  session. The gate does not know or care that the caller is Seneca.

**Design smell to hunt for:** any code path reachable only when the caller is
Seneca, any config flag that turns off the handshake/admission for "internal"
use, any in-process runtime shortcut that skips the network daemon. These are
build-time smells — prefer a grep-enforceable invariant (no privileged internal
bypass of Layer 1) over a code review that has to remember the rule.

The payoff: the day we flip on the first public tenant, the only new code is
*multi-tenancy* (§5), not *the execution path* — because Seneca already proved
the execution path as a public consumer.

---

## 4. The isolation escalation — trust drives the isolation bar

The move from v1 to v2 is not just "more boxes." It is a **trust escalation**,
and trust is what sets the isolation bar:

| Step | Who runs code | Trust | Isolation tier | Prior art |
| --- | --- | --- | --- | --- |
| v1 | Seneca's own agents on Seneca's own box | trusted-ish (our product, our infra) | **gVisor / runsc** — dense, our proven SBX1.3 boundary | **Modal** (gVisor = dense multi-tenant) |
| v2 | Untrusted strangers signing up self-serve | **untrusted** | **microVM / Firecracker** — hardware-grade isolation — for the dedicated tier | **Fly.io** (Firecracker = hardware isolation) |

The reasoning, stated plainly: gVisor is a strong syscall-interception boundary
and is entirely appropriate for **single-tenant, semi-trusted** workloads —
Modal runs dense multi-tenant on gVisor and it is a real product. But opening
to **untrusted strangers** raises the bar: the public step likely needs the
**microVM tier** (KVM-backed hardware isolation, Fly's model) for customers who
demand a dedicated boundary, **plus** the **SBX1.5 evidence-admission gates**
running continuously (a box is only in the fleet while it proves its isolation
evidence; drift or a critical CVE fences it).

So the isolation escalation maps cleanly onto the layer-3 swap:
**gVisor-v1 → microVM-v2** is a second `SandboxProviderV1` implementation
behind the frozen contract, selected per isolation tier by the Layer-1 API and
placed by the Layer-2 scheduler.

**Hosting note:** the microVM tier historically implied a cloud that offers
nested virt / bare metal (a hosting gate). **Bare-metal Cloud Hypervisor / KVM
on our own CH hardware removes that gate** — we own the metal, so we can run
Firecracker/CH microVMs sovereign, which US-cloud-locked competitors cannot
offer on customer-chosen sovereign infra. See `managed-k8s-ch-eval.md`: managed
k8s does **not** beat self-controlled nodes for the isolation boundary in v1,
because on managed nodes we don't own containerd/runsc config; the same logic
says we want our own metal for the microVM tier.

---

## 5. What "open to public" adds beyond v1 (the productization backlog)

Everything here is **v2+**. Naming it keeps it *out* of v1 (§6). None of it is
required for the Seneca dogfood.

- **Multi-tenant auth & API keys** — per-customer identity, key issuance/rotation,
  scoping. (v1 = one shared secret for one tenant.)
- **Quotas / metering / billing** — per-customer session caps, usage metering,
  invoicing. (v1 = no metering; one tenant.)
- **Self-serve signup + console** — a web console to sign up, get keys, watch
  sessions, read logs. (v1 = owner provisions Seneca by hand.)
- **Isolation tiers** — gVisor shared / microVM dedicated / VM-per-tenant
  enterprise, selectable per plan. (v1 = gVisor only.)
- **SLA / DPA / support** — contractual commitments, data-processing agreements,
  a support path. (v1 = owner is the only user.)
- **SBX1.5 fleet-admission automation** — continuous evidence-bound box
  qualification, candidate-box gate, startup receipt/freshness, drift policy,
  escape-canary, critical-CVE fence/patch/requalify game-day. (v1 = one manual
  admitting evidence run on one box.)

### v2 build principle — HARVEST E2B MAXIMALLY

**Do not reinvent the wheel. E2B has already done the hard microVM-orchestration
job, and `e2b-dev/infra` is Apache-2.0.** For v2, treat `e2b-dev/infra` as
**the reference implementation to fork-and-adapt**, not a system to rebuild from
scratch. The genuinely hard parts — Firecracker job specs, the in-VM agent,
snapshot/restore fast-start — are solved; lifting them is the point.

But "E2B did it for us" must not slide into "adopt E2B wholesale." E2B's stack
is welded to GCP/AWS/Cloudflare (US cloud) and its auth is welded to its SaaS
billing model. Calibrate with an honest split:

| Disposition | What | Why |
| --- | --- | --- |
| **TAKE** (harvest as-is) | Nomad ↔ Firecracker job specs; **envd** (in-VM exec/fs agent); the UFFD snapshot/restore fast-start | This is the wheel — hard-to-write plumbing E2B already proved. Rebuilding it is waste. |
| **ADAPT** | E2B `orchestrator` / placement logic → reference for our Layer-2 scheduler, **simplified for our scale** | We don't need E2B's full fleet complexity on day one; use it as the design template, not a drop-in. |
| **OWN** (must be ours) | The Layer-1 control-plane **auth / capability / nonce** layer | It sits on **our security boundary** and it is small (~the daemon). E2B's auth is team/API-key/billing fused to their SaaS. The Docker-AuthZ CVE lesson: **own your security edge** — never inherit someone else's auth on your isolation boundary. |
| **RE-HOST** (the sovereignty delta) | The microVM / Nomad **plumbing**, redeployed on **CH bare metal** | E2B assumes US cloud. We take the proven patterns and re-host them sovereign. Not reinventing — **re-hosting**. This IS the differentiator E2B structurally cannot offer. |

**v1 caveat:** "E2B did it" applies to **v2 (Firecracker)**. v1 is **gVisor** —
already built, ship-fast for the Seneca dogfood. E2B's Firecracker stack is the
**wrong primitive for v1**; do not pull it forward. The whole point of v1 is to
ship the sovereign execution path on the isolation we already have.

**Framing for v2:** *harvest E2B's proven microVM orchestration; own the thin
sovereign control plane on top.*

### v2 concrete first step — the "E2B extraction spike"

Before any v2 microVM build, run a scoped spike (one bead / one report, no
production code):

1. Fork `e2b-dev/infra`; **confirm the LICENSE** at the tip is Apache-2.0
   (verify, don't assume — cf. the Daytona/faasd license traps in
   `remote-container-daemon-survey.md`).
2. Map **exactly which files are cleanly liftable** (Firecracker/Nomad job
   specs, envd, UFFD snapshot/restore) **vs. cloud-welded** (GCP/AWS/Cloudflare
   Terraform, their API/Postgres auth-and-billing entanglement).
3. Produce an **extraction-effort estimate**: for each TAKE/ADAPT item, how much
   is a clean lift vs. a rewrite once the US-cloud assumptions are stripped.
4. Confirm the **envd ↔ boring-bash** alignment gap (Layer 4): how far boring-bash
   already matches envd's in-guest shape, and what closing that gap costs.

Output: a go/no-go on "fork-and-adapt E2B for the v2 microVM tier" with a real
number, not a vibe. This is the v2 equivalent of what `sbx14-scoping.md` did
for v1.

---

## 6. Discipline guardrail — do not build E2B in v1

**The failure mode is building E2B in v1.** E2B, Modal, and Fly are large
systems because they are mature multi-tenant products; copying their *guts* into
v1 would sink the Seneca dogfood under a scheduler, a metering pipeline, and a
console nobody is using yet.

**The rule:**

> **Interfaces product-grade; guts one-box-simple. Every temptation to make a
> v1 implementation "product-complete" gets stubbed behind its interface
> instead.**

Applied per layer:

- **Layer 1:** ship the daemon with one shared secret and an append-only nonce
  store — but behind an auth/session interface that multi-tenant keys slot into.
- **Layer 2:** ship a constant "the one box" placer — but behind a real
  `placeSession` interface. **Do not write a scheduler in v1.**
- **Layer 3:** ship only the gVisor provider — the Firecracker provider is a v2
  impl behind the already-frozen contract. **Do not build the microVM tier in v1.**
- **Layer 4:** ship boring-bash — aligned to envd's shape, but no snapshot/restore
  fast-start yet.

If a v1 task starts to look "product-complete," that is the signal to stub it
behind its interface and move the completeness to the v2 backlog (§5).

---

## 7. Sovereignty thread — the differentiator

The whole product's reason to exist is **sovereignty**: agents execute on
infrastructure we (and our customers) own — Swiss / EU bare metal, our own
Cloud Hypervisor / KVM — with **no US cloud** in the execution path and no US
CLOUD Act exposure.

- **v1 proves it.** Seneca runs on the owner's own EU box, isolated by our own
  runtime, admitted by our own evidence. That is the sovereignty claim,
  demonstrated on a real product.
- **The public product sells it.** A customer who cannot legally or
  strategically put their agents' execution on US cloud can put it on our
  sovereign fleet — or, at the enterprise tier, on their own metal.
- **The contrast:** E2B, Vercel Sandbox, Modal, and Fly are **US-cloud-locked**
  — their control planes and fleets assume GCP/AWS/Cloudflare and **cannot be
  self-hosted sovereign**. We harvest their proven *patterns* (§5) but re-host
  them on infrastructure they structurally cannot offer. That re-hosting is not
  a limitation we work around — it is the product.

---

## 8. How PR #1219 (SBX1.4) slots in

PR #1219 is **the v1 slice of the product's control plane (Layer 1)** — it is
not "an internal daemon," it is the first, minimal, correctly-shaped
implementation of the public control-plane API.

- Its five slices (S1 daemon + auth, S2 persistent nonce, S3 image pinning, S4
  box provisioning, S5 Seneca flip) build Layer 1's v1 implementation and wire
  Seneca to it through Layer 3 (`SandboxProviderV1` `remote-worker`).
- Its "internal-first, one-rented-KVM-VM" topology is exactly the v1 row of §1
  — single box, single tenant, gVisor.
- The governing rule (§3) is the constraint on how S5 (the Seneca flip) is
  allowed to land: Seneca must connect **as a consumer of the daemon's public
  API**, not via any bypass.
- Meeting the plan's proof + the §1 exit criteria is what graduates v1 to the
  v2 productization backlog (§5) and the E2B extraction spike.

The plan stays the authority on *what ships first*. This document is the
authority on *what those slices are slices of*.
