# Sandbox cost model — managed per-second vs self-hosted bare-metal

**Purpose:** price the sandbox-runtime options for Seneca (vertical AI agents doing
document/data work) under realistic bursty usage, and find the crossover where
self-hosted Kata+Firecracker bare-metal beats the cheapest managed per-second
provider. Companion to
[`managed-sandbox-providers-comparison.md`](managed-sandbox-providers-comparison.md)
(isolation/EU/DX) — this doc is the **money** view.

Date: 2026-08-11. All rates are primary-source quoted with URLs. Where a vendor
does not publish a rate (egress, storage overage) it is flagged as a **gap**, not
guessed. USD/EUR ≈ 1.08.

> **The decider stays isolation.** For untrusted public multi-tenant code an escape
> must not cross tenants. Hardware/microVM (Firecracker/KVM) = ✅ escape-critical;
> gVisor = ⚠️; shared-kernel namespaces = ❌. Cost only decides *among* the
> ✅ options, plus the self-host baseline. Isolation tiers are carried from the
> companion doc and marked in every table below.

---

## 1. Pricing table (exact rates + billing granularity + URLs)

| Provider | Isolation | per-vCPU-hr | per-GiB-RAM-hr | Disk | Egress | GPU | Free credits / base fee | Billing granularity | Stopped/paused billing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **E2B** | ✅ Firecracker | `$0.000014/s` = **$0.0504** | `$0.0000045/GiB/s` = **$0.0162** | 10 GiB (Hobby) / 20 GiB (Pro) free; overage rate **not published** | **not published** | none on managed | Hobby free + one-time **$100** credit; **Pro $150/mo base** + usage | **per-second** while alive | CPU+RAM meter runs the **entire alive duration incl. idle**; on pause, snapshot (fs+mem) storage bills until killed |
| **Blaxel** | ✅ microVM (hypervisor unnamed) | bundled (no separate vCPU line) | **$0.0000115/GB·s** = **$0.0414/GiB-hr** (CPU included) | snapshots $0.20/GB·mo; volumes $0.12/GB·mo; images $0.045/GB·mo | **Included (free)**; gateways free during beta | none listed | **up to $200** credit; **$0 base** | **per-second active**; **idle/suspended time not billed** | compute stops on suspend; only snapshot storage ($0.20/GB·mo) accrues |
| **Modal** | ⚠️ gVisor | Sandbox tier `$0.00003942/core/s` = **$0.142**; standard `$0.0000131/s` = $0.047 | Sandbox tier `$0.00000667/GiB/s` = **$0.024**; standard $0.008 | Volumes $0.09/GiB·mo, 1 TiB/mo free | **not published** | T4 $0.000164/s … H100 $0.001097/s … B300 $0.001972/s | Starter **$30/mo** free; Team $100/mo; **$0 base** | **per-second**, "by the CPU cycle"; min 0.125 core/container | only active compute bills; idle/stopped CPU+RAM = $0; Volume storage bills |
| **Daytona** | ❌ shared-kernel namespaces | **$0.0504** (`$0.000014/s`) | **$0.0162** (`$0.0000045/s`) | **$0.000108/GiB-hr** ≈ $0.079/GiB-mo; 5 GiB free | **not published** | listed, no rate; GPU/ephemeral auto-deleted on stop | **$200** free compute; startups up to $50k; **$0 base** | **per-second** | stopped = **"Billed for reserved disk only"** (disk keeps billing); CPU+RAM stop. Ephemeral+GPU auto-deleted on stop |
| **Fly.io Machines** | ✅ Firecracker | not decomposed cleanly (sold as instance bundles): shared-cpu-1x 256MB **$0.0028/hr**; performance-1x 2GB **$0.0447/hr**; extra RAM ~**$5/GB/mo** (≈$0.00694/GB-hr) | (see vCPU cell) | Volumes **$0.15/GB/mo** (billed attached or not); snapshots $0.08/GB/mo, 10GB free | **region-tiered**: NA/EU **$0.02/GB**, APAC/Oceania/SA $0.04, Africa/India $0.12 | A10 $0.75/hr, L40S $1.25/hr, A100-80 $3.50/hr (GPU deprecation signaled — verify) | no standing free tier; trial "2 VM-hrs or 7 days" | **per-second** while running | CPU+RAM stop when stopped, **but rootfs/volumes keep billing $0.15/GB/mo** |
| **Northflank** | ⚠️/✅ secure microVM/gVisor runtime (tier depends on plan) | **$0.01667/vCPU-hr** | **$0.00833/GB-hr** | **$0.15/GB/mo** SSD | flat **$0.06/GB** (ingress free); inter-zone $0.02/GB | L4 $0.80/hr, A100-40 $1.42, A100-80 $1.76, H100 $2.74/hr | Developer free plan (2 svc, always-on) | **per-second** ("pro-rated to the second"); explicit-region ×1.5–1.75, non-preemptible ×3 | stopped compute stops meter; persistent volumes bill $0.15/GB/mo |

Sources: [e2b.dev/pricing](https://e2b.dev/pricing) · [blaxel.ai/pricing](https://www.blaxel.ai/pricing) · [modal.com/pricing](https://modal.com/pricing) · [daytona.io/pricing](https://www.daytona.io/pricing) + [billing docs](https://www.daytona.io/docs/en/billing/) · [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) · [northflank.com/pricing](https://northflank.com/pricing).

**Gaps to flag before contracting:** E2B & Modal & Daytona do **not** publish an egress
rate (Blaxel free, Fly & Northflank published). Daytona's numeric CPU/RAM/disk
rates could not be read verbatim off the JS-rendered page — they are the
consensus aggregator figures; the *billing-behavior* strings are verbatim. E2B's
storage-overage $/GB-mo is unpublished.

---

## 2. Our usage model and per-provider monthly cost

**Sandbox shape:** 1 vCPU, 2 GB RAM, 5 GB disk. **Bursty & short-lived**: spun up
per task, **auto-stopped after ~60s idle**, so we mostly pay only ACTIVE seconds.
**Avg active compute = 3 min/task.**

**Active sandbox-hours/mo** (the meter that matters under per-second billing):

| Scale | Users × tasks | Tasks/mo | Active minutes | **Active sandbox-hours/mo** |
| --- | --- | --- | --- | --- |
| **A (pilot)** | 50 × 20 | 1,000 | 3,000 | **50** |
| **B (growth)** | 500 × 20 | 10,000 | 30,000 | **500** |
| **C (scale)** | 5,000 × 20 | 100,000 | 300,000 | **5,000** |

### Why per-second billing + idle-auto-stop is the whole game

Naive per-hour billing would round each 3-min task up to a full hour → **20× our
bill** (1,000 tasks × 1 hr = 1,000 hr instead of 50). Every provider here bills
**per-second**, so we pay ~50 hr not ~1,000 hr at scale A. The 60s idle-auto-stop
matters because otherwise the sandbox keeps metering while the user reads output;
on **E2B specifically the CPU+RAM meter runs the entire alive duration including
idle** (until you explicitly pause), so the auto-stop is what keeps E2B honest —
without it E2B's number balloons. Blaxel/Modal don't bill idle compute at all, so
they're more forgiving of a sloppy idle policy. **Gotcha: "stopped" ≠ free** —
Daytona/Fly/Northflank keep billing persistent **disk** on stopped sandboxes; our
ephemeral/auto-delete model avoids that only if we actually delete, not just stop.

### Per-active-sandbox-hour compute cost (1 vCPU + 2 GB RAM)

- **E2B** = 1×$0.0504 + 2×$0.0162 = **$0.0828/hr** (+ $150/mo base)
- **Blaxel** = 2 GB × $0.0414/GiB-hr = **$0.0828/hr** (CPU bundled)
- **Modal (Sandbox tier)** = 1×$0.142 + 2×$0.024 = **$0.190/hr**
- **Daytona** = 1×$0.0504 + 2×$0.0162 + 5 GB×$0.000108 = **$0.0833/hr** (disk while running)
- **Fly.io (shared-cpu-1x + ~2 GB)** ≈ $0.0028 + 1.75 GB×$0.00694 ≈ **~$0.015/hr** (oversubscribed shared CPU; app-platform, not a sandbox SDK)
- **Northflank (base/preemptible)** = 1×$0.01667 + 2×$0.00833 = **$0.0333/hr** (×1.5 explicit-region ≈ $0.050; ×3 non-preemptible ≈ $0.10)

### Monthly cost by scale (compute only; arithmetic shown)

| Provider (isolation) | A = 50 hr | B = 500 hr | C = 5,000 hr |
| --- | --- | --- | --- |
| **E2B** ✅ | 50×0.0828 + 150 = **$154** | 500×0.0828 + 150 = **$191** | 5000×0.0828 + 150 = **$564** |
| **Blaxel** ✅ | 50×0.0828 = **$4.14** | **$41.40** | **$414** |
| **Fly.io** ✅ (shared, caveats) | 50×0.015 = **$0.75** | **$7.50** | **$75** |
| **Modal** ⚠️ gVisor | 50×0.190 = **$9.50** | **$95** | **$950** |
| **Daytona** ❌ shared-kernel | 50×0.0833 = **$4.17** | **$41.65** | **$417** |
| **Northflank** ⚠️/✅ base | 50×0.0333 = **$1.67** | **$16.67** | **$167** |
| **Northflank** (×1.5 region) | **$2.50** | **$25** | **$250** |

**Storage (OUR cost, provider-independent):** avg 2 GB S3/user × **$0.02/GB/mo** EU:
A = 100 GB → **$2/mo**; B = 1 TB → **$20/mo**; C = 10 TB → **$200/mo**. Add this to
every row equally — it does not change the ranking.

**Egress = wildcard.** None of these totals include egress. Agent workloads that
pull large docs/datasets or push artifacts can make egress a real line: Blaxel
includes it (free), Fly/Northflank charge $0.02–$0.06/GB, E2B/Modal/Daytona don't
publish a rate at all. At C, even 1 GB egress/task = 100 TB/mo → **$2,000–6,000/mo**
at $0.02–0.06/GB. **This can dwarf compute** and must be measured, not assumed.

---

## 3. Self-hosted Kata+Firecracker bare-metal

**Reference box (best value in the €150–450 band):** Hetzner **AX102** — AMD Ryzen 9
7950X3D **16c/32t**, **128 GB** DDR5 ECC, 2×1.92 TB NVMe, **unlimited free egress**
on 1 Gbit uplink, €0 setup. **€257.30/mo ≈ $278/mo**
([AX102](https://www.hetzner.com/dedicated-rootserver/ax102/),
[price-adjustment 15-Jun-2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)).
Alt: OVH **ADVANCE-2** (EPYC 4344P 8c/16t, 64 GB, unmetered bandwidth) €219.60/mo ≈ $237.

**Concurrent micro-VM packing (1 vCPU / 2 GB):** RAM is binding. 128 GB − ~16 GB host
= ~112 GB → **~56 micro-VMs** at 2 GB each. CPU: 32 threads, ~2× burst oversubscription
easily covers 56 bursty 1-vCPU guests. **Call it ~50 concurrent** with headroom.

**Capacity in sandbox-hours/mo:** 50 concurrent × 730 hr = 36,500 hr at 100% packing.
Bursty traffic never packs perfectly; at a realistic **30–50% effective utilization**
one box yields **~11,000–18,000 usable active sandbox-hours/mo**.

**Effective $/sandbox-hour is utilization-driven** (the box is a fixed $278/mo whether
idle or full):

| Scale | Active hr/mo | Boxes needed | Self-host $/mo | Effective $/sandbox-hr |
| --- | --- | --- | --- | --- |
| **A** | 50 | 1 (0.4% used) | **$278** | $5.56 — absurdly underused |
| **B** | 500 | 1 (~3% used) | **$278** | $0.556 |
| **C** | 5,000 | 1 (~30–45% used) | **$278** | **$0.056** |

One AX102 absorbs all of scale C (5,000 hr ≪ ~15,000 hr capacity). Self-host cost is
**flat $278/mo** across A/B/C — you pay for the box, not the usage. (Add ops labor,
Kata/Firecracker maintenance, on-call, and redundancy — a second box for HA doubles it
to ~$556/mo. Managed prices bundle that; self-host does not.)

### Crossover point (self-host vs cheapest ✅ hardware-isolated managed)

Cheapest **confirmed hardware-isolated sandbox SDK** = **Blaxel** at $0.0828/hr
(Fly is cheaper but is an app platform on oversubscribed shared CPU, not a
purpose-built sandbox — heavier adapter work, weaker per-task guarantees).

> **Crossover: $278 / $0.0828 = ~3,357 active sandbox-hours/mo ≈ 67,000 tasks/mo.**
> Below that, Blaxel is cheaper; above it, one bare-metal box wins. That lands
> **between scale B and C** (just past growth, before full scale).

Reference crossovers vs other options (one box, $278/mo):
- vs **Northflank base** ($0.0333/hr): 278/0.0333 = **8,348 hr/mo** — Northflank base
  is cheaper than the box even at C ($167 < $278). But base = preemptible/shared;
  the escape-critical secure-runtime tier carries the ×3 multiplier → $0.10/hr →
  crossover **~2,780 hr**, i.e. self-host wins by C.
- vs **Modal Sandbox** ($0.190/hr): crossover **~1,460 hr** — self-host wins early
  (but Modal is gVisor, not escape-critical).
- vs **E2B** ($0.0828 + $150 base): self-host $278 beats E2B by C ($564); E2B's base
  fee alone is $150/mo before a single task.

---

## 4. Bottom line

**Cheapest escape-critical (hardware-isolation) option at each scale:**

| Scale | Winner (✅ hardware-isolated) | Cost/mo | Runner-up |
| --- | --- | --- | --- |
| **A (pilot, 50 hr)** | **Blaxel** | **~$4** (+$2 S3) | Fly ~$0.75 (app-platform caveat); E2B $154 (base fee kills it) |
| **B (growth, 500 hr)** | **Blaxel** | **~$41** (+$20 S3) | Fly ~$7.50; self-host $278 still far worse |
| **C (scale, 5,000 hr)** | **Self-hosted AX102** | **$278 flat** (+$200 S3) | Blaxel $414; gap widens as you grow past C |

**The "$ story" for E2B/Blaxel-managed bridge now → self-host later:**

- At **pilot and growth (A/B)** the managed per-second bill is **trivial** (single to
  low-tens of dollars/mo). Standing up Kata+Firecracker bare-metal here would cost
  **$278–556/mo in fixed hardware plus real ops labor** to serve $4–41 of usage — a
  **7–70× overpay**. Buying the managed bridge is unambiguously correct; the money
  saved is the engineering time not spent on microVM ops.
- **Blaxel is the cheapest confirmed hardware-isolated sandbox SDK** and has **$0 base
  fee + $200 credits + free egress** — it makes A/B **effectively free** and is the
  recommended bridge. **E2B** is the more mature/auditable Firecracker option (OSS
  infra, BYOC) but its **$150/mo base fee** makes it ~40× pricier than Blaxel at pilot;
  choose E2B when auditability/BYOC/EU-residency outweighs the base fee, else Blaxel.
- **The crossover is ~3,350 active sandbox-hours/mo (~67k tasks).** Until you're
  reliably past that — roughly **late-B into C** — managed wins on total cost of
  ownership once you count ops. Self-host becomes compelling at **C and beyond**, where
  one $278 box undercuts Blaxel's $414 and the margin only grows: at 10× scale C
  (50,000 hr) you'd need ~3–5 boxes (~$1,100–1,400/mo) vs Blaxel's **$4,140/mo**.
- **Sequence:** ship on **Blaxel (or E2B) behind our `SandboxProviderV1` adapter**
  now, instrument **active sandbox-hours and egress GB per task**, and trigger the
  self-host build when sustained usage approaches **~3,000 active sandbox-hours/mo**.
  The adapter is what makes the later swap cheap; the meters are what tell you when.

**Honest caveats:** (1) self-host $278 excludes ops labor, HA/redundancy, and
Kata/Firecracker maintenance — managed bundles these, so the real crossover sits
somewhat *later* than the raw $278 line implies. (2) **Egress is unmodeled and can
dominate** at scale — measure it before committing; Blaxel's free egress is a genuine
edge if our agents move large documents. (3) Utilization on one box is assumed
30–50%; poor scheduling pushes effective self-host $/hr up and the crossover right.

---

### Appendix — cost table (print)

```
Active sandbox-hours/mo:    A=50    B=500    C=5,000     (1vCPU/2GB, 3min/task, per-second)

Provider (isolation)          A         B          C        $/active-hr
E2B        ✅ Firecracker    $154      $191       $564      0.0828 +$150 base
Blaxel     ✅ microVM        $4.14     $41.40     $414      0.0828  (cheapest ✅ SDK)
Fly.io     ✅ Firecracker    $0.75     $7.50      $75       ~0.015  (app-platform caveat)
Modal      ⚠️ gVisor         $9.50     $95        $950      0.190
Daytona    ❌ shared-kernel  $4.17     $41.65     $417      0.0833
Northflank ⚠️/✅ base         $1.67     $16.67     $167      0.0333 (×1.5–3 for secure/region)
Self-host  ✅ Kata+FC (1 box) $278      $278       $278      flat  (AX102 16c/128GB)
S3 storage (our cost)         $2        $20        $200      $0.02/GB-mo EU
Egress                        WILDCARD — unmodeled, can dwarf compute at C

CROSSOVER (self-host $278 vs Blaxel $0.0828/hr):
   ~3,357 active sandbox-hours/mo  (~67,000 tasks/mo) — between scale B and C.

BOTTOM LINE:
   A/B  -> Blaxel (hardware-isolated, ~$4 / ~$41, $0 base, free egress)
   C+   -> self-hosted AX102 ($278 flat < Blaxel $414, margin grows)
   Bridge on Blaxel/E2B behind SandboxProviderV1; instrument active-hours + egress;
   build self-host when sustained usage nears ~3,000 sandbox-hours/mo.
```
