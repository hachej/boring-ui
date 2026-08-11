# Sandbox Service — Architecture & Vision (dogfood → product)

Owner vision captured 2026-08-11. This is the ARCHITECTURE that sits **above**
the SBX1.4 execution plan (PR #1219, `docs/issues/1081/plan-sbx14.md`). The
plan is the v1 build; this document is the shape of the product that build is
the first slice of. Where the plan and this document disagree on *what a layer
is*, this document wins; where they disagree on *what ships first*, the plan
and `DIRECTION.md` win.

Precedence: owner > `DIRECTION.md` > this file > issue plan folders.

Grounding: every API/architecture/isolation decision here cites version-controlled
evidence in [`../issues/1081/references/`](../issues/1081/references/) (index:
[`references/README.md`](../issues/1081/references/README.md)). The concrete v1
control-plane API shape is §9.

---

## 0. The one-sentence thesis

We are building a **sovereign sandbox service** — a control plane that hands
agents isolated, disposable execution environments on infrastructure we own
(Swiss/EU bare metal, no US cloud). **Seneca is customer #0**: it dogfoods the
service on the owner's own product and own infra first; once stable, the same
service opens to the public as a sellable product.

The service is architected **as a public product from day one**. "Seneca is a
normal consumer of the public surface, not a privileged internal integration"
is the **target framing** — §3 states the honest v1 status: until the §9.4
edge compat shim ships, Seneca holds the static secret and IS a privileged
first-party consumer in the capability-issuance dimension.

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

### v1-complete / start-v2 gate — what "v1 is done" means concretely

These are **v1-hygiene criteria**: meeting them means v1 is complete and the v2
productization backlog (§5) may start. **They are NOT the gate to open the
service to untrusted public strangers** — that is a separate, higher bar in §4a.
Each is owner-gated and a claim we can point at, not a vibe:

1. **Seneca has run production agent traffic on the remote runsc worker for a
   sustained soak** (target: ≥ 4 weeks of real workspaces, no owner-visible
   sandbox regression, no manual daemon babysitting between deploys).
2. **The admission gate is admitting, not just refusing.** A real
   `openat2`-passing runsc cohort exists and a fleet-admission evidence run
   binds the frozen SBX1.4 digests (`fleetAdmissionClaimed: true`) — today it
   is refusal-only (the single biggest v1 blocker; see `sbx14-scoping.md`).
3. **Replay defense survives restart.** Persistent nonce store shipped with
   **transactional global nonce uniqueness across processes/connections**
   (SBX1.4-C / #1167 atomicity — the earlier boot-epoch proposal is subsumed by
   this; V1 stores no epoch column, per plan S2), with both the "consumed nonce
   survives simulated restart" and the concurrent-connection ("exactly one
   accepted, one replay") regressions green.
4. **Image pinning is enforced.** No container starts unless workload + helper
   digests equal the admitted evidence digests (SBX1.4-B), fail-closed with a
   stable code.
5. **The control-plane API is the only path Seneca uses.** No `Seneca-special`
   bypass exists in the codebase, enforced by the concrete invariant in §3: (a)
   no production code path branches on caller identity, and (b) V1-mode combined
   with legacy `BORING_WORKER_BASE_URL` env fails closed (delivered by plan S5).
   Part (b) ships today; part (a)'s automated `check:invariants` rule is **not
   yet implemented by any slice** — until it lands, this criterion is not
   mechanically evaluable and cannot be claimed met (owed work, named in §3).
6. **A qualified-box runbook exists and has been rehearsed once** — provision,
   register, admit, drain, restore — so a second box can be stood up without
   the owner in the loop for every step.

Until 1–6 hold, the service stays single-tenant Seneca-only. Meeting them is
the gate to **start** the v2 productization backlog (§5), **not** a signal to
have built any of it early (§6), and **not** authorization to admit untrusted
public strangers — that requires the separate public-opening gate in **§4a**.

---

## 2. The four-layer architecture

The rule for every layer: **the interface is product-shaped now; the
implementation is v1-minimal.** We get the seam right so v2 is a swap, not a
rewrite.

| Layer | Exists today | v1 implements (minimal) | v2 adds | Reference to harvest | Interface that must be right NOW |
| --- | --- | --- | --- | --- | --- |
| **1. Control-plane API** — auth, capability/nonce, session CRUD. The public product surface. | SBX1.4 daemon (PR #1219): HTTP/SSE, static-secret handshake, nonce store, session lifecycle/fs/exec/renew/events | Single-box daemon, one shared secret, in-process/append-only nonce store | Multi-tenant auth, API keys, quotas, metering, billing, console | E2B `api` service (Apache-2.0) — API shape, session lifecycle verbs | The **wire contract** (session create/exec/fs/renew/events + capability/nonce grant semantics). Adding tenants/keys later must not reshape these verbs. |
| **2. Placement / scheduler** — pick a box for a session. | Nothing (implied single box) | **Config-level seam only** — S5's single-worker config maps all 256 placement buckets to the one admitted EU worker (a constant placement); no `placeSession` code interface ships in S1–S5 | Real scheduler: fleet, warm pools, bin-packing, eviction, per-tier node selection | E2B `orchestrator` + Nomad; `kubernetes-sigs/agent-sandbox` `SandboxWarmPool` CRD | **Honest status:** the placement seam is realized in v1 only as the 256-bucket→one-box *config* (plan S5), NOT as a named `placeSession(request)→box` code interface — no slice builds one. Extracting that interface is a **v2-entry refactor** (the surgery this doc predicts), unless S5 is extended to name the constant placer as a function. Do not claim the code seam exists today. |
| **3. Backend driver** — `SandboxProviderV1` (**EXISTS**). The runtime swap seam. | `packages/boring-sandbox` — `SandboxProviderV1` contract, `runsc` provider, `remote-worker` client/provider split, qualification harness | gVisor / `runsc` provider driving Docker+runsc | Firecracker / microVM provider as a second `SandboxProviderV1` impl | E2B envd + Firecracker job specs; Fly.io Firecracker; Modal gVisor | Already frozen: the `SandboxProviderV1` interface. This is the proven swap seam — v2 adds a provider, does not touch the contract. |
| **4. In-sandbox agent** — the in-guest exec/fs process. | `boring-bash` (in-guest environment) | boring-bash serving fs/exec inside the runsc container | Snapshot/restore fast-start, richer in-guest protocol at microVM scale | E2B **envd** (in-VM agent) — the canonical shape to align to | **Honest status:** the in-guest protocol boundary exists (boring-bash today), but **no S1–S5 slice performs the boring-bash↔envd alignment work** — the alignment *gap* is only measured, not closed, and only in the §5 v2 extraction spike (step 4). Treat "align to envd now" as a **v2-entry deliverable of the extraction spike**, not a v1 slice output. |

### Layer notes

- **Layer 1 is the product.** Everything a public customer touches is this API.
  It is small in v1 (the daemon) but it is *the* surface — so its verbs and its
  capability/nonce grant model are the highest-stakes interface in the whole
  system. Own it completely (§4, §6).
- **Layer 2 is the classic v1 trap.** A scheduler is where E2B, Modal, and Fly
  spend enormous effort. In v1 we have one box, so the *implementation* is a
  constant, realized as S5's 256-bucket→one-box config. **Honest caveat:** the
  named code interface (`placeSession(request) → box`) is aspirational — no S1–S5
  slice ships it; v1 realizes placement as config, and extracting the function is
  a v2-entry refactor (see the §2 table). Either extend S5 to name the constant
  placer as a function, or accept that surgery. Building a real *scheduler* in v1
  is still the failure mode named in §6.
- **Layer 3 is already done right.** The `SandboxProviderV1` extraction (SBX1.x)
  is exactly this pattern: mode ⇄ provider, runtime + sandbox swap as one pair
  (coding-invariant 5). gVisor today, Firecracker tomorrow, contract unchanged.
- **Layer 4 aligns to envd.** boring-bash already exists; the discipline is to
  keep its host↔guest protocol shaped like envd so the same in-guest agent works
  whether the outer isolation is gVisor or a microVM. **Honest caveat:** no v1
  slice performs this alignment — the §5 v2 extraction spike (step 4) only
  *measures* the boring-bash↔envd gap. Treat the alignment as a v2-entry
  deliverable, not a v1 output.

---

## 3. The dogfood governing rule

> **Seneca must consume the sandbox through the SAME wire contract and execution
> path a future public customer would use — the real control-plane API, via the
> existing `SandboxProviderV1` contract over the network daemon — NOT a private
> internal path.**

**What v1 dogfoods, honestly (and what it does NOT):** v1 proves the *wire
contract and execution path* — the same session verbs, the same capability/nonce
handshake mechanics, the same admission gate, the same network daemon. It does
**not** yet prove the *public auth trust position*. In v1 Seneca **holds the
daemon's static shared secret** (which the plan's threat model calls
host-root-equivalent) and **mints its own capabilities client-side**; a public
customer would instead present an API key to an edge **compat shim that mints
capabilities server-side** (§9.4). That shim does not exist in v1, so **in v1
Seneca IS a privileged first-party consumer** in exactly the capability-issuance
dimension §9.4 sells as the differentiator. "Seneca is just a normal public
consumer" is therefore a **v2 target, not a v1 fact** — it becomes true only when
the compat shim (or an internal issuer/verifier split that simulates it) ships
(§4a, §5, §9.4). What v1 *does* guarantee: no code path branches on caller
identity, and V1-mode combined with legacy env fails closed (below).

Dogfooding hardens the *product's execution path* because the dogfooder drives
the *public wire surface*. Every exec/fs/lifecycle bug Seneca hits is a bug a
future customer would have hit. A `Seneca-special` shortcut — a direct Docker
call, a bypass of the capability/nonce handshake, an in-process runtime instead
of the network daemon — would harden a private integration nobody will ever sell.

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
use, any in-process runtime shortcut that skips the network daemon.

**The concrete enforced invariant** (what "grep-enforceable" means here — the
generic phrase alone is not evaluable):

1. **No production code path branches on caller identity.** No `if (isSeneca)` /
   tenant-name special-casing in the daemon request path. This is the property
   criterion 5 (§1) points at; it is checkable by review + a `check:invariants`
   grep for identity-named branches in the Layer-1 request path (the grep pattern
   and its `check:invariants` rule are owed by the slice that adds the check —
   see §1 criterion 5, currently unimplemented and flagged as such).
2. **V1-mode + legacy env fails closed.** The one real bypass in the code today is
   *not* a named `Seneca` flag but a **config-precedence privilege**: Core
   selected the legacy V0 adapter when `BORING_WORKER_BASE_URL` was present
   *before* it resolved `BORING_AGENT_MODE`. **Plan S5 closes this**: production
   startup fails closed when V1 mode is combined with legacy `BORING_WORKER_BASE_URL`
   env, and no precedence rule may silently select V0 (plan S5 "Delta" + its
   automated proof). A plain grep for "Seneca" would never have caught this — it
   is why the invariant is stated as *fail-closed on legacy env*, not *no flag
   named Seneca*.

Half of this invariant (item 2) is delivered by S5 today; item 1's automated
`check:invariants` rule is **not yet implemented by any slice** — until it is,
criterion 5 (§1) cannot be mechanically evaluated and must not be claimed as met.

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

### 4a. The public-opening gate — a SEPARATE, higher bar than v1-complete

The §1 criteria make v1 *complete*; they say **nothing** about the
isolation/tenancy escalation that opening to untrusted strangers requires. Before
the **first untrusted self-serve stranger** is admitted, all of the following
must hold — this is a distinct gate, evaluated *after* the §1 gate, not implied
by it:

1. **Isolation-tier decision (resolving the §4 hedge — now a firm position).**
   **Untrusted public self-serve requires the microVM / Firecracker tier plus the
   continuously-running SBX1.5 evidence-admission gates. Shared gVisor is
   authorized only for trusted / first-party tenants** (Seneca and named design
   partners) until an **explicit, written owner risk-acceptance** for shared
   gVisor lands — and that acceptance is contingent on the operational
   preconditions Modal's dense-gVisor product implies but our v2 backlog does not
   yet carry: a gVisor CVE-response SLO, continuously-running escape canaries
   (today scoped only inside SBX1.5), and an abuse pipeline (item 2). "Likely
   needs the microVM tier" (§4) is hereby resolved to "requires it, absent that
   written acceptance." The v2 "gVisor (shared, dense)" tier in §1 is therefore
   **not** a self-serve-untrusted default until that acceptance exists.
2. **Egress + abuse controls (currently absent from the §5 backlog — added
   here).** v1's posture is egress-denial (probed in S4). A public product cannot
   be egress-deny-only (E2B offers `allow_internet_access`), and the moment
   egress opens, abuse handling is a launch blocker: a network **egress policy**
   (default-deny with per-plan allowlisting), **rate limits / concurrency and
   spend caps per tenant**, and an **abuse-detection story** (anti-crypto-mining,
   outbound port-scanning / spam detection, takedown path). These are added to
   the v2 backlog (§5) explicitly as public-opening blockers, not nice-to-haves.
3. **Multi-tenant auth actually exists.** Per-tenant identity, the edge compat
   shim / server-side capability issuer (§9.4) so no tenant holds the
   host-root-equivalent secret, per-tenant DoS quotas, and tenant-isolation
   testing must all exist and be tested before the first stranger arrives. §1
   criterion 5 asserts a single-path property but requires none of this.

Only when §1 (1–6) **and** §4a (1–3) both hold is the service authorized to open
to untrusted public self-serve. §5 is the build backlog that gets us there.

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
- **Egress policy & abuse controls** — network egress policy (default-deny with
  per-plan allowlisting; E2B-style `allow_internet_access` opt-in), per-tenant
  rate/concurrency/spend caps, and an abuse-detection pipeline (anti-crypto-mining,
  outbound-scan/spam detection, takedown path). **Hard public-opening blocker**
  (§4a-2): v1 is egress-deny-only and a public product cannot be. (v1 = egress
  denied, single trusted tenant.)
- **Multi-tenant edge auth / compat shim** — the edge API-key → server-side
  capability issuer/verifier split (§9.4) so no tenant ever holds the
  host-root-equivalent secret, plus per-tenant DoS quotas and tenant-isolation
  tests. **Hard public-opening blocker** (§4a-3). (v1 = Seneca holds the static
  secret and mints capabilities client-side.)
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
   `build-vs-adopt-survey.md`).
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
- **Layer 2:** ship a constant "the one box" placer — realized in v1 as S5's
  256-bucket→one-box config (the named `placeSession` code interface is a
  v2-entry refactor, not a v1 slice output; see §2). **Do not write a scheduler
  in v1.**
- **Layer 3:** ship only the gVisor provider — the Firecracker provider is a v2
  impl behind the already-frozen contract. **Do not build the microVM tier in v1.**
- **Layer 4:** ship boring-bash as-is (no snapshot/restore fast-start yet). The
  envd-shape alignment is measured by the §5 v2 extraction spike and closed at v2
  entry — no v1 slice performs it.

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

---

## 9. The v1 control-plane API shape (grounded)

This section specifies the Layer-1 (§2) control-plane API concretely. It is
**modeled on E2B's public SDK/API surface** as an **E2B-shaped subset**: it
matches E2B's lifecycle/exec/fs **verb shape**, so an E2B-familiar agent's
minimal loop (create → run command → read/write files → kill) ports with a thin
client — but it is **not a drop-in** for full E2B SDK usage (see the honest
gap list in §9.0). The auth handshake deliberately diverges for our sovereign
security model. GTM framing (§7): *E2B-familiar surface, subset coverage,
migration needs adaptation* — not "drop-in."

**Grounding discipline:** every decision below carries a citation. `[SPEC]`
points at [`../issues/1081/references/control-plane-api-spec.md`](../issues/1081/references/control-plane-api-spec.md)
(the E2B-modeled spec, verified against E2B JS SDK v2.38.2 / Python v2.37.1 and
the public OpenAPI reference); `[E2B-INT]` at
[`../issues/1081/references/e2b-internals-architecture.md`](../issues/1081/references/e2b-internals-architecture.md)
(E2B `infra` source tree); `[SURVEY]` at
[`../issues/1081/references/build-vs-adopt-survey.md`](../issues/1081/references/build-vs-adopt-survey.md)
(Docker-AuthZ CVE / build-vs-adopt); `[ISO]` at
[`../issues/1081/references/isolation-choices-primary-sources.md`](../issues/1081/references/isolation-choices-primary-sources.md)
(competitor isolation quotes). No decision here is ungrounded.

### 9.0 E2B-compatibility posture

- **Posture:** *E2B-SHAPED SUBSET, sovereign infra, stronger auth.* The
  lifecycle/exec/fs verbs match E2B's SDK shape so an E2B-familiar agent's
  minimal loop (create → run command → read/write files → kill) targets our
  surface with a thin client (modeled on E2B `Sandbox`/`commands`/`files`; ref:
  `[SPEC]` §1, §4). The execution then runs on EU bare metal under isolation we
  own — the sovereignty delta E2B structurally cannot offer (ref: §7; `[SPEC]`
  §4 GTM note).
- **What is covered vs. the real gaps (honest, not "drop-in").** Covered in v1:
  the create/exec/fs/renew/kill minimal loop (§9.1–§9.3). **Not** covered — the
  gaps a real E2B migration hits:
  - **Streaming stdout/stderr on the wire** (`onStdout`/`onStderr`, E2B's most-used
    ergonomic) — buffered blob only in v1; streaming is a v1.1 target (§9.2).
  - **Background commands / `sendStdin` / PTY** — no equivalent; v2 (§9.2).
  - **`connect()` / `list()` / `getInfo` / metadata / labels** — no distinct verb;
    v1.1+ (§9.1).
  - **Create-time / per-command `envs` value pass-through** — replaced by
    value-free `credentialRefs` (stronger, but a client code change; v1
    fail-closes non-empty `credentialRefs`) (§9.2).
  - **`getHost(port)` public URLs** — nothing in the protocol; kills dev-server /
    preview use cases in v1; v2 (§9.3).
  - **6 MiB fs transfer cap, no signed-URL bulk path** — streamed bulk is v1.1
    (§9.3).
  - **`@e2b/code-interpreter` `runCode`** — the surface most published E2B agent
    examples use; **not modeled** (v1: never; a `runCode`-style convenience would
    layer over `exec` in a client, not the wire). See §9.2.
  - The **edge API-key compat shim** that makes the E2B SDK's own auth model work
    at all is **unscheduled until v2** (§9.4, §5) — without it, an unmodified E2B
    SDK cannot authenticate against our surface.
  Net: **E2B-familiar verb shape, subset coverage; migration needs adaptation**,
  and full SDK compatibility (streaming + list + shim) is a v1.1→v2 deliverable,
  not a v1 fact.
- **Backend-neutral surface, by design.** E2B's public surface names no
  Firecracker/microVM/KVM terms — all abstractions are neutral
  (`template`/`sandboxID`/`envd`/public URL) even though E2B runs Firecracker
  underneath (ref: `[SPEC]` §1.7; `[E2B-INT]` §1, where microVM lives only in the
  data-plane `orchestrator`, never the `api` contract). We adopt the same
  discipline: our public verbs name no gVisor/Docker/runsc specifics. The one
  leak today is the `isolation: "docker-runsc-systrap"` string in the **health**
  response — the *public* health response should report a *tier*, not the runtime
  (ref: `[SPEC]` §4 backend-neutrality note).
- **Public prefix.** Verbs stay identical to what SBX1.4 built. Every v1 slice
  (and S5's manual proof) ships the internal-daemon `/internal/v1/...` prefix; the
  rename to a stable public `/v1/...` is a **v1.1** routing/naming decision (no
  schema change), owned by the same v1.1 that promotes `fs/events` and streaming
  (§9.6). The architecture describes the target public routes; the internal
  prefix is what exists today (ref: `[SPEC]` §2.1).

### 9.1 Lifecycle endpoints

| Verb + path | Status | Decision & grounding |
| --- | --- | --- |
| `POST /v1/sandboxes` — **create** | HAVE | Modeled on E2B `Sandbox.create()` (ref: `[SPEC]` §1.1, §4). Implemented today as `POST /internal/v1/sandboxes` → `RemoteWorkerCreateResponseSchemaV1` returning `sandboxId`, `runtimeCwd=/workspace`, `leaseExpiresAtMs`, and an authenticated `bindingReceipt` (ref: `[SPEC]` §2.1, §2.4). **Differs from E2B:** the daemon **constructs** the create request server-side from an already-authorized `workspaceId`; it never accepts a caller-supplied workspace identity or a raw container spec (ref: `[SPEC]` §2.4, §3.2 — daemon threat model, `sbx1-own-cloud-provider-plan.md` §H1). E2B accepts a client `templateID`; we accept a template *reference* validated against pinned digests, never raw container params (ref: `[SPEC]` §4). |
| `DELETE /v1/sandboxes/{id}` — **kill** | HAVE | Modeled on E2B `Sandbox.kill()` (ref: `[SPEC]` §1.1). Implemented as `DELETE /internal/v1/sandboxes/{id}` → `{ disposed: true }` (ref: `[SPEC]` §2.1, §2.4). |
| `POST /v1/sandboxes/{id}/renew` — **TTL keepalive** | HAVE | Our equivalent of E2B `setTimeout` / the idle-timeout window (ref: `[SPEC]` §1.1 `setTimeout`, coverage map). `idleTimeoutMs` (≤ 30 min) → new `leaseExpiresAtMs` (ref: `[SPEC]` §2.4). |
| **connect / reconnect** | PARTIAL | E2B has an explicit `Sandbox.connect()` with pause/auto-resume (ref: `[SPEC]` §1.1). We have no distinct verb: a fresh capability is minted per operation against an existing `sandboxId`, and the stored binding record is the source of truth (ref: `[SPEC]` §2.4). Reconnecting an events stream after expiry needs a fresh capability. **Divergence is intentional** — no long-lived connection handle on the isolation boundary. |
| `GET /v1/sandboxes` — **list** | NEW (v1.1+) | E2B `Sandbox.list()` (ref: `[SPEC]` §1.1). Not present in `RemoteWorkerOperationSchemaV1`; deferred so v1 does not become product-complete (guardrail §6; ref: `[SPEC]` §2.4, §5). |
| **getInfo / metadata / labels** | NEW (v1.1+) | E2B `getInfo`/create-time `metadata` (ref: `[SPEC]` §1.1). Not modeled on our create today (create carries `sessionId`, `clientLeaseId`, digests); deferred (ref: `[SPEC]` §2.4). |
| **pause / resume / snapshot / fork** | NEW (v2) | E2B `pause`/`createSnapshot`/`fork` back their UFFD snapshot/restore fast-start (ref: `[SPEC]` §1.1; `[E2B-INT]` §1 orchestrator "UFFD snapshot restore"). v2 only — harvest E2B's proven snapshot plumbing (§5 TAKE row), never build in v1 (guardrail §6). |

### 9.2 Exec / run + streaming

- `POST /v1/sandboxes/{id}/exec` — **HAVE.** Modeled on E2B `commands.run()` →
  exit code + stdout/stderr (ref: `[SPEC]` §1.2, §4). Request (`RemoteWorkerExecRequestV1`):
  `invocationId`, single-string `command` (≤ 64 KiB), optional `cwd`,
  `timeoutMs` (≤ 15 min), `maxOutputBytes` (≤ 4 MiB); response carries
  `stdoutBase64`/`stderrBase64`, `exitCode`, `durationMs`, `truncated` (ref:
  `[SPEC]` §2.2). The in-guest contract is `Sandbox.exec(cmd, opts)` in
  `packages/agent/src/shared/sandbox.ts` (ref: `[SPEC]` §2.2).
- **Streaming stdout/stderr** — PARTIAL, v1.1 target. The in-guest layer already
  has incremental `onStdout`/`onStderr` byte-stream callbacks (`ExecOptions`),
  but the wire `exec` response is a buffered base64 blob — no per-chunk HTTP
  stream yet. Matching E2B's streaming `CommandHandle` needs a streaming exec
  response (ref: `[SPEC]` §1.2, §2.2, coverage map, §5 v1.1).
- **Secret injection differs (stronger).** E2B passes plain create-time `envs`
  and per-command `envs` (ref: `[SPEC]` §1.5). Ours carries **value-free
  `credentialRefs`** resolved host-side, so secret *values* never cross the wire
  or reach the box in the request (ref: `[SPEC]` §2.2, coverage map "envs"). Plain
  `env` in `ExecOptions` is still supported for non-secret vars.
- **background handle / `sendStdin` / PTY** — NEW. E2B `commands.run({background})`,
  `sendStdin`, and `pty.*` have no equivalent in the protocol; deferred to v2
  (ref: `[SPEC]` §1.2, coverage map, §5 v2).
- **`@e2b/code-interpreter` `runCode`** — NOT MODELED (the surface most published
  E2B agent examples actually use). We expose `exec` (a shell command), not a
  language-kernel `runCode`; a `runCode`-style convenience would be a **client-side
  wrapper over `exec`**, never a distinct wire verb. Explicitly out of scope for
  v1/v1.1; revisit only if a concrete customer needs kernel semantics (ref:
  `[SPEC]` coverage map).

### 9.3 Filesystem read/write/list

- `POST /v1/sandboxes/{id}/fs` — **HAVE.** Modeled on E2B `sandbox.files.*`
  (`read`/`write`/`list`/`getInfo`/`exists`/`makeDir`/`rename`/`remove`; ref:
  `[SPEC]` §1.3, §4). Implemented as `RemoteWorkerWorkspaceOperationSchemaV1`, a
  discriminated union on `op`: `readFile`, `readBinaryFile`, `writeFile`,
  `writeBinaryFile`, `readFileWithStat`, `writeFileWithStat`,
  `writeBinaryFileWithStat`, `unlink`, `readdir`, `stat`, `mkdir` (`recursive?`),
  `rename` (`from`/`to`). Text ≤ 6 MiB per transfer; binary carried base64 (ref:
  `[SPEC]` §2.3). E2B `exists` maps to our `stat` (ref: `[SPEC]` coverage map).
- This is a **1:1 map** onto the `Workspace` interface
  (`packages/agent/src/shared/workspace.ts`); paths are workspace-relative and
  **path validation is an adapter concern** (coding-invariant 4; ref: `[SPEC]`
  §2.3).
- `GET /v1/sandboxes/{id}/fs/events` — **HAVE** (SSE), promote to public in v1.1.
  Modeled on E2B `files.watchDir` (ref: `[SPEC]` §1.3). Backed by `Workspace.watch()`
  over an SSE stream of `RemoteWorkerFsEventEnvelopeSchemaV1` (ref: `[SPEC]` §2.1,
  §2.3, §5 v1.1).
- **Bulk / signed-URL upload/download** — PARTIAL. E2B offers signed-URL
  upload/download; we carry binary via base64 ≤ 6 MiB with no streamed multi-MB
  path. Streamed bulk transfer is a v1.1 item (ref: `[SPEC]` §1.3, coverage map,
  §5 v1.1).
- **Ports / `getHost(port)` public URLs** — NEW (v2). E2B exposes per-port public
  URLs (ref: `[SPEC]` §1.4). Nothing in our protocol; a deliberate v1 gap (ref:
  `[SPEC]` §4, §5 v2).

### 9.4 The auth handshake — capability token + single-use nonce (the deliberate divergence)

This is where we **must** differ from E2B, and the divergence is the security
selling point, not a gap.

- **E2B model:** every SDK request carries a **long-lived reusable API key**
  (`E2B_API_KEY`, header `X-API-Key`) (ref: `[SPEC]` §1.6, §3.1).
- **Our model:** every operation is authorized by a **short-lived capability** in
  `x-boring-internal-token` whose claims (`RemoteWorkerCapabilityClaimsSchemaV1`)
  bind `protocolVersion`, `workerId`, `workspaceId`, `operation`, `sandboxId`,
  `requestDigest` (SHA-256 of the exact request), `issuedAtMs`/`expiresAtMs`, and
  a **single-use `nonce`** (ref: `[SPEC]` §3.1). Max lifetime 5 min
  (`REMOTE_WORKER_MAX_CAPABILITY_LIFETIME_MS`); the nonce lives in a persistent
  append-only store, replay is rejected (`REMOTE_WORKER_CAPABILITY_REPLAY`), and
  consumed nonces survive a daemon restart via **transactional global nonce
  uniqueness across processes/connections** (SBX1.4-C / #1167; the boot-epoch
  proposal is intentionally subsumed by transactional uniqueness per plan S2 —
  V1 stores no epoch column; ref: `[SPEC]` §3.1, §1 exit-criteria 3).
- **Why we diverge — a design judgment grounded in the Docker-AuthZ CVE class:**
  *own your security edge; never inherit someone else's reusable-key or bolt-on
  authz on your isolation boundary.* The primary source is CVE-2024-41110 (Docker
  Engine AuthZ-plugin bypass, CVSS 10.0) — an authorization layer bolted in front
  of a root-equivalent runtime socket failed because the daemon forwarded a
  body-less request past it; see `[SURVEY]` "Security lesson — the Docker-AuthZ
  CVE class" for the citation. A leaked E2B key grants standing access until
  rotated; a leaked boring capability is already expired and already consumed
  (ref: `[SURVEY]`; `[SPEC]` §3.1; §5 OWN row). This is the OWN disposition of the
  TAKE/ADAPT/OWN/RE-HOST split (§5) made concrete.
- **v1 auth caveat (stated plainly):** the capability/nonce model is genuinely
  stronger *per request* — but in v1 both the issuer (Seneca) and the verifier
  (the daemon) derive from **one static shared secret the plan's threat model
  calls host-root-equivalent**. A leaked capability is already dead; a leaked
  *secret* is the whole box. The per-request strength is real; the v1 key
  material is not yet multi-tenant. (See §3 and the plan's threat model.)
- **`sandboxId` alone never authorizes.** Every request loads the stored binding
  record by `sandboxId` and compares all binding claims to the independently
  authorized capability *before* touching Workspace, Docker, the invocation
  cache, or the lease timer; no request body or box-reported identity may replace
  the stored binding (ref: `[SPEC]` §3.2, `sbx1-own-cloud-provider-plan.md` §H1).
  Cross-workspace combinations return one stable, non-revealing code
  (`REMOTE_WORKER_SANDBOX_WORKSPACE_MISMATCH`) with zero Docker effect (ref:
  `[SPEC]` §3.2) — satisfying coding-invariant 8 (every error has a stable code).
- **The daemon exposes exec/fs verbs, never a raw Docker/containerd socket** —
  there is no "run this container spec" endpoint (ref: `[SPEC]` §3.2). This is the
  structural opposite of "proxy Docker," and is what makes owning the thin auth
  layer tractable (small surface; ref: §5 OWN row).
- **E2B-compat shim (edge) — the component that equalizes Seneca and a public
  customer, and it is NOT in v1.** A public SDK user cannot present one static
  key at the boundary. The compat shim accepts a public API key **at the edge**
  and **mints per-operation capabilities server-side**; the key never reaches the
  isolation boundary (ref: `[SPEC]` §3.1 trade-off, §4). Until it exists, Seneca
  (holding the static secret and minting capabilities client-side) **is** the
  privileged first-party path in the capability-issuance dimension — see §3. The
  shim is scheduled as a named **v2** deliverable in the productization backlog
  (§5, "Multi-tenant auth & API keys" — the edge issuer/verifier split is part of
  that bead) and is a hard precondition of the public-opening gate (§4a). It
  preserves the E2B-familiar GTM posture (§9.0) without weakening the boundary.

### 9.5 Isolation/tenancy grounding for the API tiers

The API surface is isolation-tier-neutral (§9.0), but the *tier selection* the
Layer-1 API performs is grounded in primary sources:

- **v1 = gVisor / runsc, single-tenant, semi-trusted.** Modal runs *dense
  multi-tenant* production on gVisor: "Sandboxes are built on top of gVisor … that
  provides strong isolation properties" and "stronger isolation than most other
  container runtimes" (ref: `[ISO]` §1 Modal quotes). gVisor is a syscall-
  interception boundary — appropriate for our own agents on our own box (§4).
- **v2 dedicated tier = microVM / Firecracker, untrusted strangers.** Fly.io
  frames Firecracker as hardware-grade isolation for untrusted multi-tenant
  workloads (ref: `[ISO]` — Fly.io Firecracker quotes). Selected per trust level
  by the Layer-1 API, placed by Layer-2, implemented as a second
  `SandboxProviderV1` behind the frozen contract (§4, §2 Layer-3 row).
- The API contract does **not** change across this escalation — only the tier
  string the create call resolves does. `gVisor-v1 → microVM-v2` is a Layer-3
  provider swap, not an API reshape (§4; ref: `[SPEC]` §1.7 backend-neutrality).

### 9.6 The minimal v1 cut (what ships in SBX1.4)

Smallest set to prove the sovereign execution path; everything else is explicitly
deferred so v1 does not become product-complete (guardrail §6; ref: `[SPEC]` §5):

1. `GET  /v1/health` — evidence/qualification/image-digest admission gate.
2. `POST /v1/sandboxes` — create (server-constructed, capability+nonce, binding receipt).
3. `POST /v1/sandboxes/{id}/exec` — run command, exit code, buffered stdout/stderr.
4. `POST /v1/sandboxes/{id}/fs` — read/write/list/stat/mkdir/rename/unlink (+binary).
5. `POST /v1/sandboxes/{id}/renew` — TTL keepalive (idle timeout).
6. `DELETE /v1/sandboxes/{id}` — kill/dispose.
7. Capability + single-use-nonce auth on every call (`x-boring-internal-token`).

**v1.1 near-term:** promote SSE `fs/events` to public; streaming exec response;
`GET /v1/sandboxes` list + create-time `metadata`; streamed bulk transfer.
**v2:** ports/public URLs, background/PTY, multi-tenant keys/quotas/metering,
microVM tier. (All ref: `[SPEC]` §5.)

> **Grounding-coverage note:** every row/bullet in §9 carries a `[SPEC]`/`[E2B-INT]`/
> `[SURVEY]`/`[ISO]` citation. The full E2B-modeled spec (with the verified E2B
> §1 surface and the have/partial/new coverage map) is the driving reference:
> [`../issues/1081/references/control-plane-api-spec.md`](../issues/1081/references/control-plane-api-spec.md).
