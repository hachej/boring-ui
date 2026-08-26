# Managed Kubernetes (CH/EU) evaluation for SBX1.4 sandbox — PR #1219

> **Historical scope:** the original hard requirement below was gVisor/runsc.
> Corrected v1 requires a Firecracker microVM per sandbox on self-controlled
> bare-metal KVM; only the self-controlled-node evidence carries forward.

Question: can we run the per-session AI-agent sandbox on a **managed** Kubernetes
from a Swiss/EU provider instead of self-hosting a bespoke daemon or k3s?
Hard requirement: **gVisor/runsc as the per-session tenant isolation boundary**
(a `RuntimeClass: gvisor` + the `runsc` binary + a modified `containerd` config
on each worker node) plus digest-pinned admission.

Sources fetched (WebSearch budget exhausted; WebFetch on provider pages only):
exoscale.com/sks, exoscale.com/pricing, ovhcloud.com public-cloud/kubernetes +
prices, hikube.cloud + docs.hikube.cloud. Several deep docs URLs 404'd; those
items are marked `[VERIFY WITH PROVIDER]`.

---

## Summary table

| Provider | gVisor / custom runtime on managed nodes | Jurisdiction / residency | Min viable cluster cost (1 CP + 2–3 small nodes) | Cold start / autoscaling |
|---|---|---|---|---|
| **Hikube** (Hidora) | **Undocumented** — no RuntimeClass/gVisor mention. KubeVirt-based, VMs+containers on same fabric → node model may differ. `[VERIFY]` — #1 sales question | **Swiss sovereign** ✅ — 3 Swiss DCs (Gland, Lucerne, Geneva), triple synchronous replication, "data never leaves Switzerland". Operated by Hidora (Swiss, support@hidora.io) | **Pricing not published** `[VERIFY]` — request quote | Native autoscaling advertised; no published latency `[VERIFY]` |
| **Exoscale (SKS)** | **Undocumented** — no RuntimeClass/gVisor/custom-runtime mention. Managed node images; privileged daemonsets likely allowed but installing runsc + rewriting containerd config on managed nodes is **not a documented capability** `[VERIFY]` — #1 sales question | **EU (Austria-owned), Swiss-operated** — brand of **Akenes SA** (Lausanne, CH), owned since 2019 by **A1 Digital / A1 Telekom Austria Group** (ultimately América Móvil, MX). **NOT Akamai** — the task's Akamai assumption is wrong (Akamai bought Linode, not Exoscale). CH zones exist: CH-GVA-2 (Geneva), CH-DK-2 (Zurich); also AT-VIE, DE-FRA, HR-ZAG | Control plane: **Starter = free**; Pro = monthly (99.95% SLA). Nodes: ~€14–15/mo (2 vCPU/2 GB) to ~€29–30/mo (4 vCPU/16 GB "Large"). **~€45–90/mo** for 3 small nodes on free control plane | **Karpenter** real-time autoscaling + instance pools; no published pod-start latency `[VERIFY]` |
| **OVH (MKS)** | **Undocumented for gVisor.** OVH manages the node image + containerd; docs cover daemonset-based node tweaks but **not** a bring-your-own container runtime. Full runsc RuntimeClass install is **not a supported/managed path** `[VERIFY]` — #1 sales question | **EU / French** ✅ (SecNumCloud heritage) — **not Swiss.** Regions: Gravelines/Roubaix/Strasbourg (FR), Frankfurt, Warsaw, London, + non-EU (Canada, Sydney). Pick an EU region for residency | Control plane: **Free** (lifetime, ≤100 nodes) or **Standard $0.099/cluster/hr ≈ $72/mo** (≤500 nodes, SLA). Nodes = standard Public Cloud instances (B3-8 class), billed separately + block storage + floating IPs. **~$40–80/mo** for 3 small nodes on free control plane | Node-pool autoscaling (to 100/500 nodes); no published join/pod-start latency `[VERIFY]` |

---

## Per-provider detail

### 1. gVisor — the make-or-break question

**None of the three publicly document gVisor / a custom `RuntimeClass` / bring-your-own
container runtime on their managed worker nodes.** This is the central risk. On a
managed k8s the provider owns the node image and the `containerd` configuration;
installing `runsc` and wiring a `RuntimeClass` requires either (a) writing to
`/etc/containerd/config.toml` and dropping a binary via a **privileged daemonset**
that survives node-image upgrades, or (b) a provider-supported custom node image /
BYO-runtime feature. Neither is advertised by any of the three.

- **OVH MKS** — most likely to *tolerate* it: it runs standard containerd on
  OpenStack instances and documents daemonset-based node customization, so a
  privileged daemonset that installs runsc *may* work — but it is unsupported,
  fragile across managed node upgrades, and not guaranteed. `[VERIFY WITH PROVIDER]`
- **Exoscale SKS** — managed node images; same daemonset caveat, undocumented. `[VERIFY]`
- **Hikube** — KubeVirt-based fabric (VMs and containers co-scheduled). This is
  interesting: it may make **VM-per-session** (KubeVirt) a natural isolation
  boundary *instead of* gVisor, but gVisor-on-node itself is undocumented. `[VERIFY]`

This single unknown is enough that a managed cluster cannot be assumed to satisfy
the SBX1.4 isolation requirement without a written answer from each vendor.

### 2. Jurisdiction

- **Hikube = the clean Swiss-sovereign story** for the CH-data pitch: Swiss operator
  (Hidora), three Swiss DCs, explicit "data never leaves Switzerland."
- **Exoscale** = Swiss-*operated* (Akenes SA, Lausanne; real CH zones) but
  **Austrian-owned** (A1 Telekom Austria). EU jurisdiction, no US CLOUD Act
  exposure via ownership — the task's "Akamai/US-acquired" premise is **incorrect**.
  Ownership is EU, not US.
- **OVH** = French/EU, strong sovereignty credentials, **but not Swiss** — weaker
  for a strictly "data stays in Switzerland" pitch unless a CH story isn't required.

### 3. Cost (minimal viable cluster)

- **Exoscale**: free Starter control plane + 3× small/large nodes ≈ **€45–90/mo**.
- **OVH**: free control plane (or $72/mo Standard) + 3× B3-class nodes ≈ **$40–80/mo**
  + block storage + floating IP add-ons.
- **Hikube**: **not published** — quote required.

All three are cheap enough that cost is **not** the deciding factor; the gVisor
constraint and jurisdiction are.

### 4. Cold start / density

No provider publishes pod-start or node-join latency. All advertise
cluster/node autoscaling (Exoscale via Karpenter, OVH/Hikube native). For
warm-pool session economics you'd rely on pre-provisioned nodes + pre-pulled
digest-pinned images regardless of provider; expect standard cluster-autoscaler
node joins in the low **minutes**, too slow for on-demand per-session cold start —
so a warm pool is mandatory in every option, managed or bespoke. `[VERIFY]`

---

## VERDICT

**Managed k8s does NOT clearly beat the bespoke-daemon-on-a-VM plan for v1 — keep
the bespoke daemon (or self-managed k3s on your own nodes) as the v1 call.**

Reasoning:
1. **The gVisor boundary is unproven on all three managed offerings.** SBX1.4's
   whole security model is `runsc` per session; if the provider owns the node
   image and containerd config, you cannot guarantee a stable `RuntimeClass:
   gvisor`. A self-managed VM/k3s node gives you root on the node and full control
   of containerd + runsc — exactly what the isolation design needs. Managed k8s
   trades away the one thing this design cannot compromise.
2. **Cost savings are negligible** (~€50–90/mo either way), so managed k8s buys
   only ops convenience, not economics — and it costs you node-level control.
3. **Jurisdiction doesn't rescue it:** the strongest Swiss story (Hikube) is also
   the least-documented on runtime customization.

**If/when you do move to managed k8s (v2+), the ranking is:**
- **Hikube** if the pitch demands true Swiss sovereignty — *and* if you're willing
  to pivot the isolation boundary from gVisor to **KubeVirt VM-per-session** (its
  native model), which may be a stronger boundary than gVisor anyway.
- **OVH MKS** if EU (not strictly Swiss) is acceptable — most likely to tolerate a
  privileged-daemonset runsc install, cheapest, best-documented node customization.
- **Exoscale SKS** as the EU middle ground with real CH zones (correct the Akamai
  misconception in the design doc).

**Action before any managed-k8s decision:** send all three the identical
question — *"Can we install a custom container runtime (gVisor/runsc) via a
`RuntimeClass` and privileged daemonset on managed worker nodes, and will it
survive node-pool upgrades?"* That single answer decides everything. `[VERIFY WITH PROVIDER]`

For **PR #1219 (SBX1.4) v1: proceed with the bespoke daemon / self-controlled
nodes.** Managed k8s is a v2 option contingent on a written gVisor-support answer.

---

# ADDENDUM — Second framing: managed-k8s + `kubernetes-sigs/agent-sandbox` as a MULTI-TENANT sandbox-as-a-service

Source: WebFetch of `github.com/kubernetes-sigs/agent-sandbox` (SIG Apps project).

**What agent-sandbox is:** a CRD + controller for "isolated, stateful, singleton
workloads, ideal for AI agent runtimes." Components:
- **`Sandbox`** — one persistent pod with stable identity, persistent storage,
  lifecycle (create / scheduled-delete / **pause / resume** / deep hibernation).
- **`SandboxTemplate`** — reusable definition to mint many similar sandboxes.
- **`SandboxWarmPool`** — pre-warmed sandboxes for rapid allocation.
- **`SandboxClaim`** — provision from the warm pool (the fast-path grab).

**CRITICAL:** agent-sandbox **does NOT provide isolation itself.** It explicitly
"delegates low-level container isolation to secure Sandbox Runtimes (like gVisor
or Kata Containers) through Kubernetes' `RuntimeClass`." So adopting agent-sandbox
**does not remove the gVisor gate — it depends on exactly the same
`RuntimeClass: gvisor` on managed worker nodes** that Part 1 flagged as
undocumented on all three providers. The gate is identical for internal and
service framings.

## 1. Does managed-k8s + agent-sandbox beat a bespoke daemon for a MULTI-TENANT paid service?

For a real N-customer service (not one internal tenant), **yes — assuming the
gVisor gate clears, k8s+agent-sandbox is the stronger foundation**, because the
things a multi-tenant service needs are exactly what k8s already gives you and a
bespoke daemon would have to reinvent:

- **Per-tenant isolation:** namespace-per-customer + RBAC + `NetworkPolicy` +
  `ResourceQuota`/`LimitRange` is native, declarative, and auditable. A bespoke
  daemon would hand-roll all of this (network segmentation, per-tenant quota
  accounting, RBAC) — high-risk security surface to build yourself.
- **Noisy-neighbor / quotas:** `ResourceQuota` per namespace + pod
  requests/limits + optional node-pool-per-tier. Bespoke = you build the cgroup
  accounting and fairness layer.
- **Warm-pool economics:** `SandboxWarmPool` + `SandboxClaim` gives sub-second
  claims from pre-warmed pods — but warm pods still pin **idle node cost**. This
  is the real cost lever and is *provider-agnostic*: you pay for warm capacity
  either way. k8s just gives you the primitive (pool sizing + autoscaler) instead
  of you writing a warm-pool manager. `[VERIFY]` no published sub-second numbers;
  claim-from-warm-pool is the documented fast path but latency isn't quantified.
- **Multi-node scheduling / autoscaling:** the k8s scheduler + cluster-autoscaler
  spread sandboxes across nodes and grow the fleet — a bespoke single-VM daemon
  does not scale past one box without you building an orchestrator (i.e.
  re-inventing k8s).
- **Operational division of labor:** the provider runs the control plane (etcd,
  API server, upgrades); **we own only** the `Sandbox`/`SandboxTemplate`/
  `WarmPool` CRDs, our **admission policies (digest-pinned) + nonce webhook**, and
  the RuntimeClass wiring. That is a genuinely smaller ops surface than owning a
  bespoke daemon *and* its scaling/isolation machinery — **provided** we don't
  also have to own the node runtime (the gVisor gate again).

**Bespoke daemon wins only for:** single-tenant, single-node, ship-this-week. It
does **not** scale to a multi-tenant product without effectively re-growing into
a k8s-shaped orchestrator.

## 2. The sequencing fork

- **(a) Bespoke daemon for Seneca single-tenant canary now (~2wk, off Vercel fast),
  migrate to managed-k8s+agent-sandbox for the product.**
- **(b) Skip the daemon; build managed-k8s+agent-sandbox as BOTH Seneca's backend
  and the service foundation from day one.**

**Recommendation: (a) — build the bespoke daemon canary now, but time-box it and
treat it as throwaway scaffolding, on ONE condition:** that you fire the gVisor
question at the three providers **this week, in parallel** with daemon work.

Weighing:
- **Wasted daemon effort:** ~2wk is real but bounded, and most of it (nonce
  webhook logic, digest-pinning policy, the SandboxProviderV1 adapter, image
  supply chain) is **reusable** above the k8s boundary — only the node/runtime
  plumbing is thrown away.
- **Time-to-Europe-claim:** the daemon gets Seneca off Vercel and onto CH/EU
  infra in ~2wk regardless of the gVisor answer — you can make the sovereignty
  claim now without betting it on an unverified managed-node capability.
- **Time-to-sellable-product:** (b) is faster to a *sellable multi-tenant* product
  **iff** gVisor works on managed nodes — but if it doesn't, (b) has you building
  the productized service on sand and discovering the blocker after weeks.

**Pick (b) instead only if** a provider gives a *written* "yes, gVisor RuntimeClass
is supported and survives node upgrades" **before** you'd start the daemon — then
the daemon is pure waste and you should jump straight to k8s. **Pick (a)** (the
default) as long as the gVisor answer is outstanding: it de-risks the timeline,
ships the Europe claim now, and keeps the k8s option fully open.

## 3. Gating reminder (restated at the top of the verdict)

**The entire managed-k8s path — internal single-tenant AND multi-tenant service,
with OR without agent-sandbox — is DEAD if gVisor/runsc cannot run on the
provider's managed nodes.** agent-sandbox delegates isolation to a `RuntimeClass`
(gVisor/Kata); it does not remove this dependency, it *requires* it. One written
answer from Hikube / Exoscale / OVH gates every downstream decision. `[VERIFY WITH PROVIDER]`

## 4. The fork is a backend/ops decision, not a product re-architecture

Because **SandboxProviderV1** is the contract Seneca's app code talks to, the
daemon-vs-k8s choice lives **below** that line. Seneca's application is unaffected
by which backend implements the provider — daemon today, managed-k8s+agent-sandbox
later, with the same nonce/digest-pinning semantics surfaced through the contract.
So this fork carries **no product-rearchitecture risk**: it's an infrastructure
and ops sequencing call, and (a) can migrate to (b) behind the contract without
touching app code.
