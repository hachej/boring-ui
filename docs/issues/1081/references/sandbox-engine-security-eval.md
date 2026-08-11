# Sandbox Engine Security Evaluation — Seneca (public multi-tenant, escape-critical)

> Evidence pass for the SBX-14 v1 engine choice. This document does **not** modify
> `plan-sbx14.md` or `tech-choice.md`; it is the citation base that a later rewrite consumes.

## 0. TL;DR

- **Recommended v1 engine: Firecracker microVMs (hardware KVM boundary).**
  Delivery vehicle for "adopt now": **E2B self-hosted infra** (`e2b-dev/infra`, Apache-2.0,
  Firecracker under the hood) as the fastest managed-OSS path, or **Kata Containers with the
  Firecracker/Cloud-Hypervisor backend** if we want an OCI-native, containerd-integrated path.
- **microVM-per-sandbox (KVM) IS necessary** for this deployment. "Escape is critical +
  public multi-tenant" is a strictly harder threat model than the one the primary security paper
  measures (single-tenant). A userspace-kernel engine (gVisor) or a container engine (runc)
  shares the host kernel; a single mediator RCE reaches the host and therefore every co-resident
  tenant. Only hardware virtualization (KVM) gives the cross-tenant hardware boundary the
  requirement demands.
- **Runner-up: gVisor (runsc).** It wins 5-of-6 axes in the paper — but on the paper's
  *single-tenant* model. For Seneca it is **not sufficient as the sole boundary**; its right role is
  a defense-in-depth *inner* layer (gVisor inside a Firecracker microVM), not the tenant boundary.
- **microsandbox (libkrun) is NOT the v1 pick.** It is the fastest to integrate (OCI images,
  MCP, <200 ms boot), but the security paper flags it as the **riskiest residual-bug posture in the
  set** — `mode-0` seccomp (no engine-side filter, 11/14 escape primitives reachable) plus a
  structurally-unmeasured CVE/fuzzing record, on pre-1.0/beta code. Wrong trade for
  escape-critical multi-tenant v1.

---

## 1. Primary evidence base — the security paper

**"AI Code Sandboxes: A Comparative Security Study. Part 1 of 2 — Engine-Level Properties
(Attack Surface, Leakage, Stackability, CVE History, Patch Cadence, Fuzzing)"**, George
Andronchik & Pavel Lokhmakov, arXiv:2606.08433v1 [cs.CR], 7 Jun 2026. License CC BY 4.0.
Companion repo (Apache-2.0): `github.com/orbitalab/RnD-ai-sandboxes-sec-study-part-1`.
PDF: <https://arxiv.org/pdf/2606.08433>

### 1.1 What the paper measures — and its threat model (read this first)

Six Tier-1 axes over **five products mapped to three engine classes**:

| Product | Engine | Class | Lang | Pin model (quoted) |
|---|---|---|---|---|
| **arrakis** | Cloud Hypervisor | microVM | Rust | "Per-release pin … currently v44.0, last bumped 2025-02-04" |
| **e2b** | Firecracker | microVM | Rust | self-hosted default "v1.14.1_458ca91, 399 days since bump"; cloud-hosted "opaque" |
| **microsandbox** | libkrun | microVM (lightweight) | Rust | "Per-release pin, 1–3 month cadence" |
| **gvisor** | runsc (Sentry) | userspace kernel | Go | "Rolling main; the product is upstream" |
| **daytona** | runc | OCI container | Go | "pulls containerd.io from Docker-CE 29.x … runc 1.3.5 bundled" |

**Threat model — critical caveat for us.** The paper is scoped to
**"AISI T0.H2.N2 — a single-tenant operator runs untrusted code … on their own infrastructure.
The operator does not fully trust the code but does trust the infrastructure."** It then states
**"Explicitly out of scope: multi-tenant SaaS (tenant-A vs tenant-B isolation), microarchitectural
side channels, orchestrator/control-plane attacks …"** and warns: **"An operator reading these
portraits with a different threat model needs a different evidence base."**

> **Seneca is exactly that different threat model.** We are the excluded multi-tenant SaaS case.
> The paper's per-axis rankings are load-bearing for *engine quality*, but its top-line
> "gVisor qualifies on the most columns" verdict is a **single-tenant** verdict and does not
> transfer to cross-tenant isolation. We re-weight below.

The paper deliberately computes **no composite score**: "Different operators weight axes
differently … no cross-axis sum is computed."

### 1.2 Quoted per-engine findings

**Axis 1.1 — host attack surface** (four-layer model; measures the mediator L2 footprint on host
kernel L1). Two headline tables:

*Seccomp ceiling (allowed syscalls, per-thread mode):*
- **e2b/Firecracker:** "filter (mode 2), 55 [allowed syscalls], mode2 × 5/5 … Firecracker's
  upstream default filter on every thread."
- **gvisor:** "filter (mode 2), 84, mode2 × 30/30 … runsc Sentry filter on every thread."
- **arrakis/Cloud Hypervisor:** "disabled (mode 0) [leader] … mode0 × 1, mode2 × 32/33 …
  installs seccomp on worker threads … after leader arg parsing." (per-thread read lifts it to
  enforced-filter posture)
- **microsandbox/libkrun:** "disabled (mode 0) … mode0 × 16/16 … **No BPF filter on any msb
  thread.**"
- **daytona/runc:** "disabled (mode 0) … mode0 × 15/15 … No BPF filter on any runc-init thread."

*Primitive reachability — "14 kernel-LPE / container-escape primitives … lower is better":*

| Rank | Product | Reachable / 14 | Quoted basis |
|---|---|---|---|
| best | **gvisor** | **5 / 14** | "84-syscall mode-2 filter + Sentry returns ENOSYS on io_uring_setup, userfaultfd, and quotactl" |
| | **e2b** | **7 / 14** | "Tightest seccomp ceiling in the set (55 syscalls allowlisted) under Firecracker's mode-2 filter applied to all threads" |
| | **microsandbox** | **11 / 14** | "libkrun runs mode-0 across all 16 threads; **no BPF filter on the VMM**; primitives gated only by what the VMM happens not to call" |
| | **daytona** | **11 / 14** | "runc shares the host kernel verbatim … mode-0 across all 15 threads; no engine-side seccomp" |
| worst | **arrakis** | **12 / 14** | "Cloud Hypervisor leader-thread mode-0 plus the live **/dev/kvm ioctl surface reachable to guest userland** (KVM_GET_API_VERSION=12 …)" |

> Note the microsandbox surprise: on raw guest-visible surface libkrun scores **worse** (11/14)
> than gVisor (5/14) and Firecracker (7/14), because it ships **no engine-side seccomp**. The
> KVM hardware boundary still protects the host — but libkrun leans entirely on that one boundary
> with no in-VMM defense-in-depth.

Guest-visible `/dev` entries + guest kernel: "gvisor 15 (synthetic 4.19.0-gvisor)… microsandbox
116 (own 6.12.68)… e2b 128 (own 6.1.158)… arrakis 170 (own 6.12.8+)… **daytona 268
(host kernel 6.8.0-100-generic verbatim)**. … daytona's guest kernel string is bit-for-bit identical
to the host kernel … Every published kernel CVE that requires only userspace triggering applies
inside this sandbox at the same patch level as the host."

arrakis nested-KVM confirmation (product-level finding): "a guest userland process could call
`KVM_CREATE_VM` without privilege escalation, materially expanding the kernel-LPE surface …
nested-virt is enabled in the default image."

**Axis 1.2 — information leakage** (28 probes × 5 products): rollups — "e2b microvm **pass, 0
leaks** … microsandbox microvm **pass, 0** … arrakis microvm **partial, 1** (cpu = host
passthrough) … gvisor **partial, 2** (host RAM total, BIOS product name) … daytona container
**partial, 10** (full shared-kernel signature plus disk identifiers)." Class spread "0 / 0 / 1 / 2 / 10
separates the three engine classes cleanly."

**Axis 1.3 — defense-in-depth stackability** ("not-exposed" = layers you can't attach without
patching product source; fewer is better): "**e2b / microsandbox / arrakis 0 each** … gvisor **1**
(AppArmor cell stripped by runsc) … daytona **5** … concentrated downstream of the runner
hardcoding `Privileged: true`."

**Axis 1.4 — public CVE history** (24-month rollup, 2024-05 → 2026-05; classes: Escape /
HostLeak / HostDoS / InternalEsc):

| Engine | Class | CVEs (window) | Escape-class | Quoted note |
|---|---|---|---|---|
| Firecracker | microVM | 2 | **2** | "both 2026 advisories carry escape-class primitives; the methodology's prior baseline of 'no published hypervisor-escape' is contradicted" — CVE-2026-5747 (virtio-pci OOB write, 8.7 v4), CVE-2026-1386 (jailer symlink host-write, 6.0 v4) |
| Cloud Hypervisor | microVM | 2 | **1** | "CVE-2026-45782 (virtio-block async-I/O UAF, CVSS v4 8.9 high) is the engine's **first published Escape-class advisory**"; GHSA says it "can be escalated to … a full guest-to-host (VM) escape" |
| libkrun | microVM | **0** | 0 | **Excluded from ranking** — "0 published CVEs is the absence of a finding, not the presence of soundness" |
| gVisor (runsc) | userspace kernel | 3 | **0** | "2 HostLeak + 1 InternalEsc, **0 Escape** … consistent with the Sentry intercepting most syscalls before they reach the host kernel" |
| runc | container | 4 | **4** | "endemic to the container class's shared-kernel threat model" — 2025-11-05 procfs/mount-race trio (CVE-2025-52565/52881/31133) + CVE-2024-45310 |
| Linux kernel | shared dep | **~3,500** | — | "two and a half orders of magnitude larger than all five engines combined" |

Per-class kernel transitivity (why microVM ≠ container): "**Container (runc): Full surface. Every
host-kernel CVE reachable from unprivileged userspace applies.** **microVM: Partial via guest
kernel only. Host kernel CVE → escape only if the VMM has its own surface bug.** **Userspace
kernel (gVisor): Minimal. Sentry intercepts most syscalls; host-kernel CVE generally not reachable
via the syscall path.**" Cited verbatim (eBPF-PATROL): "As containerized workloads share the
same kernel, any vulnerability that can be triggered via system calls … can potentially compromise
the host or other co-resident containers."

Structural caveat on eyeballs: "runc 4-in-window against 310k Go LOC + 10.9 years + 13.2k stars;
Firecracker 2-in-window against 85k Rust LOC + 8.6 years + 34.2k stars; libkrun 0 against 72k
Rust LOC + 5.7 years + 2.1k stars … **lower code volume × lower eyeballs is the worst
combination for the '0 CVEs means quality' reading**."

**Axis 1.5 — patch cadence** (downstream lag is the operator-facing signal): "arrakis pin-freeze —
**471+ days on v44.0 across 12 upstream releases**," missing CVE-2026-45782. "e2b orchestrator
default — **399 days unchanged**," leaving CVE-2026-5747 unpatched ≥44d at the default flag.
"daytona … **current** … Docker-CE 29.x pulls runc 1.3.5; all in-window CVEs included."
gVisor "silent-fix-first … the operator receives the fix months before the CVE exists (–165d to
–458d disclosure-to-release lags)."

**Axis 1.6 — upstream fuzzing posture:**
- **gVisor — best:** "continuous syzkaller + in-tree secfuzz library + release-process syzkaller
  smoke test … **yes — syzkaller.appspot.com/gvisor**." Only engine with a public dashboard.
  Corroborated by G-Fuzz (TDSC 2024).
- **Cloud Hypervisor — middle:** "cargo-fuzz workspace … 18 targets … CI fuzz-build job …
  **compile-gate only, no execution** … dashboard: no."
- **runc — middle:** "OSS-Fuzz, 2 targets … narrow JSON/user-parsing surface."
- **Firecracker — worst:** "**none in repo**; `--features fuzzing` is a deterministic-build hook for
  external fuzzers … no fuzz/, no OSS-Fuzz integration … the prior baseline of 'cargo-fuzz +
  OSS-Fuzz / ~60%' was unsupported by any repo artefact."
- **libkrun — worst:** "**none documented**; repo-wide search for fuzz returns 5 hits, all
  GUI-input variables."

**§3.5 — the libkrun structural-unmeasured finding (directly bears on microsandbox):**
"libkrun is the only cell where two axes return absence-of-signal … residual-bug depth is
structurally unmeasured. There is no upstream CVE history to read, no upstream fuzzer to consult,
and no published academic study to cross-check. … **This is the riskiest posture in the set on the
residual-bug axis.**"

**The paper's own portrait verdicts (single-tenant):**
- gvisor: "the closest the set comes to 'qualifies on every column' … the strongest in the set on
  five of six axes."
- e2b: "engine-level posture is strong, but the absence of an upstream fuzzer means residual-bug
  confidence relies on AWS's internal effort (not publicly observable)."
- microsandbox: "**carries the riskiest posture in the residual-bug sense** … the cleanest
  data-leakage posture; the operator … is implicitly trusting that the absence of CVE and fuzzing
  signal reflects vendor diligence rather than absence of search, and is stacking all the hardening
  layers themselves."
- arrakis: engine investment "partially undone by product-level defaults" (live /dev/kvm +
  471-day frozen pin).
- daytona: "the only product … where the host kernel is exposed verbatim … the inverse extreme
  of gvisor."

---

## 2. Per-engine scorecard vs. the 8 Seneca requirements

Requirements: **R1** hardware-grade cross-tenant escape isolation · **R2** adopt-not-build (fast to
ship) · **R3** sub-second start · **R4** self-hosted in EU / bare-metal KVM · **R5** dense packing,
no per-workspace standing VM · **R6** clean base that doesn't block a v2 microVM-fleet build ·
**R7** `SandboxProviderV1`-wrappable (image + limits → create/exec/destroy) · **R8** paper
security rating (multi-tenant re-weighted).

Legend: ✅ strong · 🟡 caveat · ❌ weak.

| Engine (via product) | R1 cross-tenant HW isolation | R2 adopt speed | R3 start latency | R4 EU self-host / KVM | R5 density | R6 v2 path | R7 adapter fit | R8 paper security (multi-tenant re-weight) |
|---|---|---|---|---|---|---|---|---|
| **Firecracker** (E2B infra / direct+jailer) | ✅ KVM microVM, own guest kernel per sandbox | 🟡 E2B infra Nomad+Consul; direct needs jailer wrapper | ✅ ~125 ms cold, snapshot-restore <10s of ms | ✅ needs `/dev/kvm`; bare-metal ideal; E2B bare-metal Linux planned | ✅ 100s–1000s/host (AWS Lambda/Fargate proof) | ✅ **v2 = same engine**, swap orchestrator only | ✅ clean lifecycle API | 🟡 tightest seccomp (55, 7/14) + biggest eyeballs (34.2k★), **but 2× 2026 escape CVEs, no upstream fuzzer** |
| **gVisor** (runsc) | ❌ **shared host kernel via Sentry**; Sentry RCE = host = all tenants | ✅ drop-in OCI runtime | ✅ sub-100 ms | ✅ no KVM required, runs anywhere | ✅ highest density (userspace) | 🟡 becomes inner layer, not boundary | ✅ trivial (runtime shim) | ✅ best on 5/6 axes **but single-tenant scoped**; 0 Escape CVEs, only public fuzzer |
| **Kata Containers** (Firecracker/CH backend) | ✅ KVM microVM per pod, OCI-native | ✅ mature, containerd/CRI integrated | 🟡 ~sub-second (heavier than raw FC) | ✅ bare-metal KVM, EU-friendly | ✅ dense per-pod microVMs | ✅ v2 pluggable VMM | ✅ OCI image in, standard runtime | 🟡 not directly tested; inherits FC/CH engine ratings |
| **Cloud Hypervisor** (arrakis) | ✅ KVM microVM | 🟡 less turnkey product layer | ✅ fast boot | ✅ Rust VMM on KVM | ✅ dense | ✅ viable v2 VMM (in-tree fuzzer +) | 🟡 wrappable | 🟡 in-tree fuzzer (18 targets) **but first escape CVE (8.9) + nested /dev/kvm surface in arrakis image + 471-day frozen pin** |
| **microsandbox** (libkrun) | ✅ KVM microVM (HW boundary intact) | ✅ **fastest** — OCI images, MCP, SDKs, `msb` | ✅ **<200 ms** ("<100 ms on M1") | ✅ KVM on Linux, self-host | ✅ built for density | 🟡 libkrun ≠ FC/CH; v2 swap = engine change | ✅ clean SDK/MCP surface | ❌ **riskiest residual-bug (11/14, mode-0 no seccomp, 0-CVE/0-fuzzer unmeasured), pre-1.0 beta, 2.1k★** |
| **E2B** (self-hosted Firecracker) | ✅ = Firecracker | 🟡 Nomad+Consul cluster; GCP first, bare-metal planned | ✅ = Firecracker | 🟡 bare-metal Linux "planned"; GCP full, AWS beta | ✅ = Firecracker | ✅ = Firecracker | ✅ SDK + REST | 🟡 = Firecracker engine rating |
| **Nabla / unikernels** | ✅ tiny kernel surface | ❌ apps must be re-linked to the unikernel | 🟡 | 🟡 niche | ✅ | ❌ ecosystem dead-endy | ❌ not general OCI code exec | 🟡 tiny surface but paper treats as niche, no live product tested |
| **Plain containers + seccomp** (runc/daytona) | ❌ **host kernel verbatim**, 4 escape CVEs in window | ✅ trivial | ✅ fastest | ✅ | ✅ densest | n/a | ✅ | ❌ worst — 10 leaks, 11/14 primitives, shared-kernel escape endemic |

---

## 3. Ranked recommendation for v1

### Is microVM-per-sandbox (KVM) necessary? — **Yes, unambiguously, for this deployment.**

The requirement is "hardware-grade cross-tenant isolation; a sandbox escape must NOT reach other
tenants." That single sentence disqualifies every **shared-kernel** engine as the *tenant boundary*:

- **runc / plain containers:** the paper shows the guest kernel string is "bit-for-bit identical to the
  host kernel"; 4 Escape-class CVEs in 24 months; eBPF-PATROL quote — a syscall-triggerable
  kernel bug "can potentially compromise the host or **other co-resident containers**." Out.
- **gVisor:** far better (0 Escape CVEs, 5/14 primitives, only continuously-fuzzed engine), but the
  boundary is a **single Go userspace process (the Sentry) on a shared host kernel**. A Sentry RCE
  or a forwarded-syscall kernel bug lands on the host that hosts every tenant. The paper itself
  scopes gVisor's win to the **single-tenant** model and *excludes multi-tenant SaaS*. For
  "cross-tenant/whole-platform compromise is unacceptable," a software boundary that fails-open to
  the shared host is the wrong risk class.

Only **hardware virtualization (KVM)** gives each tenant its **own guest kernel behind a CPU-
enforced boundary**, where — per the paper's transitivity table — a host-kernel CVE becomes an
escape "only if the VMM has its own surface bug." That is the isolation the requirement names.
A cheaper engine does **not** suffice here.

### The pick — ranked

1. **Firecracker microVMs — RECOMMENDED v1 engine.**
   - **Why it wins on R1/R8:** among the three microVM engines it has the **tightest engine-side
     defense-in-depth** (`mode-2` seccomp on *every* thread, 55-syscall allowlist, 7/14 primitives —
     the paper's best microVM result) *and* the **largest eyeballs** (34.2k stars, 8.6 years, AWS
     Lambda + Fargate in production at massive multi-tenant scale). Apache-2.0.
   - **Delivery vehicle for "adopt now" (R2):** **E2B self-hosted** (`e2b-dev/infra`, Terraform,
     Apache-2.0 SDK) is the fastest off-the-shelf Firecracker stack with a create/exec/destroy API
     that maps 1:1 onto `SandboxProviderV1`. If we want to avoid the Nomad+Consul + GCP-first
     footprint, **Kata Containers with the Firecracker backend** is the OCI-native, containerd-
     integrated alternative that runs cleanly on bare-metal KVM.
   - **R3/R5:** ~125 ms cold boot, snapshot-restore in tens of ms, and the density story Firecracker
     was built for (thousands of microVMs per host) — directly satisfies "no per-workspace standing
     VM; pack densely."
   - **R6:** the v2 "build our own microVM fleet + snapshot-fork" plan is the *same engine*. v1→v2
     is a control-plane swap, not an engine migration.

2. **Runner-up: gVisor (runsc)** — but **not as the tenant boundary.** It is the paper's overall
   single-tenant winner (best on 5/6 axes, only public fuzzer, 0 Escape CVEs) and the easiest,
   densest, most portable engine to operate (no KVM needed). Its correct role here is a
   **defense-in-depth inner layer**: run gVisor *inside* the Firecracker microVM. The paper
   observes the strongest combination "microVM × continuous public fuzzer — is unoccupied";
   gVisor-in-Firecracker is precisely how we occupy it — KVM hardware boundary on the outside,
   continuously-fuzzed 5/14-primitive syscall filter on the inside. Defer this to a hardening pass; it
   is not required for a correct v1.

**Why Firecracker over the other microVMs:**
- **over microsandbox/libkrun:** libkrun keeps the KVM boundary but the paper rates it the
  **riskiest residual-bug posture in the set** — `mode-0` (no engine-side seccomp, 11/14 primitives)
  plus a structurally-unmeasured CVE/fuzzing record, on pre-1.0 beta code (2.1k stars). For
  escape-critical multi-tenant v1, "trust the vendor's unobservable diligence" is not an acceptable
  basis. Great for a single-tenant dev sandbox; wrong for Seneca's tenant boundary.
- **over Cloud Hypervisor/arrakis:** CH has the best fuzz *harness* (18 targets) and a valid v2
  future, but the **arrakis product image exposes a live `/dev/kvm` nested-virt ABI to guest
  userland** and sat on a **471-day frozen pin** that missed an 8.9 escape CVE. Those are
  product-level, but they show the adopt-path maturity is behind Firecracker/E2B today.

**Runner-up justification restated:** gVisor loses the top slot *only* because of the threat model.
On the paper's axes it is the strongest engine in the study. If Seneca were single-tenant, gVisor
would be the pick. Because Seneca is public multi-tenant with escape-critical cross-tenant
requirements, a hardware boundary is mandatory and gVisor is demoted to inner-layer hardening.

---

## 4. v1 adopt → v2 build migration note

- **v1 (adopt):** Firecracker via E2B self-hosted infra (or Kata+Firecracker) behind
  `SandboxProviderV1`. We do **not** operate a bespoke VMM fleet; we consume an existing one.
- **v2 (build, for density/scale):** our own Firecracker (or Cloud Hypervisor) fleet with
  **snapshot-fork** — boot a golden guest once, fork copy-on-write clones per task for
  ~single-digit-ms starts and higher packing density.
- **Why v1 doesn't paint us into a corner:** because v1 is **already Firecracker**, the guest image
  format, the KVM boundary, the exec contract, and the `SandboxProviderV1` adapter surface are all
  **unchanged** across the v1→v2 cut. We swap the *orchestrator/control plane* (E2B's
  Nomad+Consul → our snapshot-fork scheduler), not the engine. Cloud Hypervisor remains a
  drop-in VMM alternative for v2 (its in-tree fuzz harness is a plus) without changing the adapter.
  Had we adopted libkrun for v1, v2 would be an **engine** change (different VMM, different
  guest assumptions) — a strictly worse migration. This is a second reason to prefer Firecracker at v1.

The `SandboxProviderV1` contract (create/exec/destroy given image + limits) is the seam that makes
this swap a config/adapter change rather than a rewrite. Keep provider-specific details (E2B REST,
Kata CRI, raw jailer) behind that adapter from day one.

---

## 5. Honest risks of the recommendation (Firecracker)

1. **2026 broke Firecracker's clean escape record.** The paper: "both 2026 advisories carry
   escape-class primitives; the methodology's prior baseline of 'no published hypervisor-escape' is
   contradicted." CVE-2026-5747 (virtio-pci OOB write, CVSS 8.7) and CVE-2026-1386 (jailer
   symlink host-write, 6.0). Neither is a demonstrated end-to-end host RCE ("path from there to host
   RCE still requires gadget construction, ASLR/CFI bypass"), but both cross the host boundary.
   **Mitigation:** strict pin-currency (see #3), keep the jailer chroot minimal, run gVisor-in-FC as
   the inner layer once we harden.

2. **No upstream fuzzer.** The paper downgraded Firecracker's fuzzing posture to "none in repo …
   the prior baseline of 'cargo-fuzz + OSS-Fuzz / ~60%' was unsupported by any repo artefact."
   Residual-bug confidence "relies on AWS's internal effort (not publicly observable)." This is the
   one axis where gVisor is strictly better — and the reason we want gVisor-in-FC eventually.

3. **Pin-freeze is the dominant operator risk, not the engine.** The paper's sharpest finding is that
   *product pin policy* dwarfs engine quality: E2B's self-hosted orchestrator default sat
   **399 days unchanged**, leaving CVE-2026-5747 unpatched ≥44 days at the default flag. If we
   adopt E2B infra we **must own the Firecracker version bump ourselves** and not inherit the
   frozen orchestrator default. Wire CVE-triggered pin bumps into CI.

4. **Ops surface of the adopt vehicle.** E2B self-hosted requires standing up **Nomad + Consul**;
   "GCP is fully supported; AWS is in beta; **Azure and bare-metal Linux are planned**." Our
   target is EU bare-metal KVM — so validate the bare-metal path early, or prefer **Kata+Firecracker**
   (containerd-native, first-class bare-metal) if the E2B bare-metal path isn't ready.

5. **Requires `/dev/kvm`.** Firecracker needs native KVM — fine on our bare-metal hosts, but it
   forecloses nested/managed environments without nested virt. Acceptable given R4 explicitly
   prefers bare-metal KVM.

6. **Side channels are out of scope of the paper and unaddressed by KVM alone.** Spectre/MDS-class
   cross-tenant leakage (Weissman et al. tested Firecracker) is a *microarchitectural* concern the
   study excludes. For a public multi-tenant platform, pair the microVM boundary with
   core-scheduling / sibling-isolation and current microcode as a separate workstream.

---

## Sources

- **Primary:** Andronchik & Lokhmakov, arXiv:2606.08433v1, "AI Code Sandboxes: A Comparative
  Security Study, Part 1" — <https://arxiv.org/pdf/2606.08433> (CC BY 4.0). Companion repo:
  <https://github.com/orbitalab/RnD-ai-sandboxes-sec-study-part-1>.
- microsandbox: <https://github.com/microsandbox/microsandbox> (libkrun+smoltcp, Apache-2.0,
  "boot times under 100 milliseconds" on M1, `allowed_hosts`/`allowed_ports` egress, `cpus`/`memory`
  quotas, MCP server, Rust/Python/TS/Go/Ruby SDKs; **Beta, ~7.3k stars, YC-backed, no snapshot**).
- E2B self-hosted: <https://github.com/e2b-dev/infra> — Firecracker microVMs, Terraform,
  Nomad+Consul; via <https://www.beam.cloud/blog/how-to-self-host-code-sandbox> and
  <https://www.spheron.network/blog/ai-agent-code-execution-sandbox-e2b-daytona-firecracker/>.
- Firecracker / gVisor / Kata isolation comparisons:
  <https://northflank.com/blog/kata-containers-vs-firecracker-vs-gvisor>,
  <https://edera.dev/stories/kata-vs-firecracker-vs-gvisor-isolation-compared>,
  <https://manveerc.substack.com/p/ai-agent-sandboxing-guide> (Firecracker 2026 CVE cluster;
  "Micro-VMs … give each workload its own kernel running on hardware virtualization (KVM) …
  the current gold standard for untrusted code").
- Container-escape / multi-tenant framing:
  <https://www.appsecengineer.com/blog/defending-kubernetes-clusters-against-container-escape-attacks>.
