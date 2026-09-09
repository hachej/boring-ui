# Managed sandbox providers — short-term bridge comparison

**Context:** Seneca is a public, multi-tenant AI-agent SaaS. We are building a
self-hosted **Kata + Firecracker** microVM sandbox runtime as the long-term
escape-critical isolation layer, wrapped behind our own `SandboxProviderV1`
abstraction. This doc evaluates whether any **managed/hosted** sandbox provider
is a good-enough **short-term bridge** to get to market before the self-host
runtime is ready — or whether we should go straight to self-host.

**The decider is isolation.** For untrusted public multi-tenant code, a sandbox
escape must not reach another tenant or our control plane. We therefore mark each
provider explicitly as **hardware/microVM** (Firecracker/KVM — a separate guest
kernel per tenant) vs **gVisor** (user-space syscall-interception kernel, *not*
hardware virtualization) vs **shared-kernel containers** (namespaces/cgroups on a
shared host kernel).

Date: 2026-08-12. All claims are quoted with URLs. Vendor pages are primary;
competitor blogs and third-party integration docs are labelled **[secondary]**
and used only as corroboration. Daytona baseline is carried from
[`daytona-shortterm-eval.md`](daytona-shortterm-eval.md).

---

## 1. Comparison matrix

### Isolation model (THE decider)

| Provider | Class | Vendor's own isolation statement (quoted) | Source |
| --- | --- | --- | --- |
| **E2B (managed)** | ✅ **Hardware / microVM (Firecracker)** | *"Each sandbox is powered by Firecracker, a microVM made to run untrusted workflows."* (homepage "FULL ISOLATION" callout). *"E2B sandboxes run on an LTS 6.1 Linux kernel."* (per-sandbox kernel). No page uses the literal phrase "hardware isolation"; Firecracker=KVM microVM is the load-bearing claim. | [e2b.dev](https://e2b.dev/), [how-it-works](https://docs.e2b.dev/template/how-it-works) |
| **Blaxel** | ✅ **microVM (claimed); hypervisor not named** | *"microVMs with full access to file system, processes and logs."* Filesystem: base image *"stored as read-only files on host storage using ... EROFS,"* writable layer *"lives entirely in the sandbox's RAM using tmpfs,"* combined via *"OverlayFS."* Resume *"under 25ms."* **Blaxel never names Firecracker/KVM in its own docs** — "microVM" branding + 25ms resume strongly implies a Firecracker-class design but is unconfirmed. | [docs.blaxel.ai/Overview](https://docs.blaxel.ai/Overview), [Sandboxes/Overview](https://docs.blaxel.ai/Sandboxes/Overview) |
| **Modal** | ⚠️ **gVisor (NOT hardware)** | *"Sandboxes are built on top of gVisor, a container runtime by Google that provides strong isolation properties."* *"Compute jobs at Modal are containerized and virtualized using gVisor ... giving you stronger isolation than most other container runtimes."* This is a container-vs-container comparison; Modal never claims VM/hardware isolation. | [sandbox-networking](https://modal.com/docs/guide/sandbox-networking), [security](https://modal.com/docs/guide/security) |
| **Daytona (managed)** | ❌ **Shared-kernel (namespaces), gVisor opt-in/unconfirmed** | *"Each sandbox runs as an isolated instance with its own Linux namespaces ... dedicated vCPU, RAM, and disk resources."* No microVM/hardware claim on the managed shared tier; closed-source since June 2026, so unauditable. | [architecture](https://www.daytona.io/docs/en/architecture/) |

### Remaining rubric axes

| Axis | E2B (managed) | Blaxel | Modal | Daytona (managed) |
| --- | --- | --- | --- | --- |
| **EU residency** | EU gated behind Enterprise/BYOC: *"Data and compute within the EU to comply with data residency regulations and the EU AI Act."* ([enterprise](https://e2b.dev/enterprise)). BYOC = deploy into your own AWS/GCP VPC ([byoc](https://docs.e2b.dev/byoc)). SOC2/DPA not confirmable (trust portal didn't render). | Real EU regions `eu-lon-1` (London), `eu-fra-1` (Frankfurt) ([Regions](https://docs.blaxel.ai/Infrastructure/Regions)). But *"All regions are not necessarily available in self-service."* No published DPA; own blog only *advises* readers to "request the vendor's DPA." No true BYOC — *"On-premise options are limited to private endpoint connectivity and bring-your-own-metal."* | Region pinning via `region=` on `Sandbox.create()`; docs claim EU-scheduled sandbox data "does not leave the EU through Modal's control plane." **SOC 2 Type II confirmed** ([security](https://modal.com/docs/guide/security)). No self-serve DPA text or EU region-code list found. | `eu` shared region exists; no explicit data-residency guarantee, no sub-processor list. Real sovereignty needs Dedicated/BYOC + DPA review. |
| **External S3 mount** | ✅ FUSE: *"we will use the FUSE file system to mount the bucket"* — `s3fs` (S3), `s3fs`+endpoint (R2), `gcsfuse` (GCS); creds via `/root/.passwd-s3fs` or key file. Also Archil ([cloud-buckets](https://docs.e2b.dev/storage/cloud-buckets), [archil](https://docs.e2b.dev/storage/archil)). | ⚠️ First-party **Volumes** are proprietary, single-attach, not external buckets ([Volumes](https://docs.blaxel.ai/Sandboxes/Volumes)). S3/GCS FUSE mount (s3fs/gcsfuse, Debian=S3+GCS, Alpine=S3-only) reported **[secondary]** ([Mastra](https://mastra.ai/reference/workspace/blaxel-sandbox)), not confirmed in a primary Blaxel doc. | ✅ `modal.CloudBucketMount` *"supports AWS S3, Cloudflare R2, and Google Cloud Storage buckets."* Creds via Modal Secrets / temp tokens / OIDC. Caveat: no append/arbitrary-offset writes ([cloud-bucket-mounts](https://modal.com/docs/guide/cloud-bucket-mounts)). | ✅ Mountpoint-for-S3 FUSE; S3/R2/GCS/Azure/etc.; creds via `envVars`. |
| **SDK / adapter fit** | TS (`@e2b/code-interpreter`) + Python. Versioned REST API (`/v2/sandboxes`). Lifecycle pause/resume/timeout/kill documented. Full endpoint map needs OpenAPI pull. | Python + TS SDKs (github.com/blaxel-ai, MIT per search). Exact create/exec/pause/delete signatures **not directly quoted** — SDK-reference page defers to GitHub. Auto scale-to-zero after 5s. | Python first-class; **TS/Go SDKs beta** (`libmodal`, v0.9). Rich `Sandbox.create(image,cpu,memory,gpu,region,idle_timeout,block_network,volumes,...)`, `exec()`, `snapshot_filesystem()`, `terminate()`. | Python + TS. `CreateSandboxFromImageParams(Resources(cpu,memory,disk))`, `process.executeCommand`, `stop/start`, `delete`, `auto_stop_interval`. Maps cleanly. |
| **Persistence** | ✅ Strong: *"both the sandbox's filesystem and memory state will be saved"*; resume to identical state; ~4s/GiB pause, ~1s resume; paused sandboxes persist indefinitely; snapshots + forking exist ([persistence](https://docs.e2b.dev/sandbox/persistence)). | ✅ Strong: *"a snapshot of the entire state (including the complete file system in memory ... files and running processes)"* on standby; resume <25ms. Plus persistent Volumes. | ⚠️ Filesystem snapshots (`snapshot_filesystem`/`snapshot_directory`) + persistent Volumes; full memory pause/resume behind `_experimental_enable_snapshot` — **not GA**. | ✅ stop/start + `auto_stop_interval`; Volumes persist independently. |
| **Pricing** | RAM $0.0000045/GiB/s; CPU $0.000014–$0.000112/s (1–8 vCPU); storage free (10/20 GiB incl.); Hobby $100 credit; Pro $150/mo. **No GPU on managed cloud found**; egress not itemized. | $0.0000115/GB-RAM-s (CPU bundled), ≈$0.083/hr for 2 GB; snapshots $0.20/GB-mo; volumes $0.12/GB-mo; **egress "Included"**; $200 credit. No GPU sandbox price found. | CPU $0.00003942/core-s (=2 vCPU); RAM $0.00000667/GiB-s; GPU T4→B300 per-sec; $30–100/mo free credits. Egress not on pricing page. | $0.0504/vCPU-hr; $0.0162/GiB-hr; $200 credit; H100 $3.95/hr; 5 GB free. |
| **Maturity / OSS / lock-in** | Infra **open source** (`e2b-dev/infra`, Apache-2.0 per [secondary]); BYOC stores templates/snapshots/logs in customer VPC → lowest lock-in. GPU managed = gap. | **Seed stage** ($7.3M, YC S25, First Round); SF. Client SDKs open; **platform proprietary, no true BYOC/air-gap** → real lock-in + company-stage risk. | **Series C, $355M raised, ~$4.65B val** (May 2026) — very well capitalized. Platform proprietary, SDKs open; no self-host → lock-in. | Managed live but **closed-source since June 2026** → isolation unauditable; lock-in mitigated only by our adapter. |

### Other EU-capable managed providers (secondary scan)

> The dedicated deep-dive agent for these was still running at write time; this
> section is a lighter scan and should be hardened with direct vendor-doc quotes
> before being cited in a decision. Directional verdicts:

| Provider | Isolation | EU | S3 mount | Verdict |
| --- | --- | --- | --- | --- |
| **Fly.io Machines** | ✅ **Firecracker microVM** (Fly's core is Firecracker) | Multiple EU regions (`fra`, `ams`, `lhr`, `cdg`, `mad`, etc.) | Volumes; external S3 via app-level FUSE | Hardware-isolated + EU, but Fly is an app-hosting platform, not a purpose-built agent-sandbox SDK — adapter work is heavier (no native exec/snapshot sandbox primitives). Viable-with-effort. |
| **Northflank** | Offers microVM/gVisor secure runtime options for BYOC/managed | EU regions + BYOC | Bucket integrations | Positions as secure multi-tenant sandbox host; worth a primary-doc pass. Trusted-to-viable pending isolation-tier confirmation. |
| **Runloop** | Devbox sandboxes for AI agents (isolation tier needs confirmation) | US-centric; EU unconfirmed | Blueprint/storage | Agent-devbox DX is good but isolation + EU residency unproven — treat as trusted-pilot-only until confirmed. |
| **Beam Cloud** | Container/gVisor-class sandboxes | US-centric | Volumes | Fast DX, but not clearly hardware-isolated nor EU-resident — trusted-pilot-only. |

---

## 2. Ranked verdict (short-term bridge, escape-critical public multi-tenant)

The bar is: **hardware/microVM isolation + real EU residency + external per-tenant
S3 mount + a clean create/exec/pause/delete SDK.** Ranked:

1. **E2B (managed) — TOP CANDIDATE and the only clean fit.** Hardware isolation is
   confirmed from E2B's own words (*"Each sandbox is powered by Firecracker, a
   microVM made to run untrusted workflows"*), EU residency is offered (Enterprise
   region + BYOC-into-your-own-VPC), external S3/R2/GCS FUSE mounts are first-class,
   pause/resume with memory is mature, and the **infra is open source** — so the
   bridge and the eventual self-host converge on the *same* engine (Firecracker),
   de-risking migration. It also matches the existing #1081 plan direction (E2B +
   Firecracker adoption). Caveats: EU is Enterprise-gated (not self-serve), GPU on
   managed cloud is unconfirmed, SOC2/DPA needs direct confirmation.

2. **Blaxel — PROMISING but UNVERIFIED on the two things that matter most.** Owner
   flagged it, and its persistence/DX story is genuinely strong (full memory
   snapshot, <25ms resume, real `eu-fra-1`/`eu-lon-1` regions, egress included,
   $200 credit). **But:** (a) it claims "microVM" yet **never names Firecracker/KVM
   in its own docs** — the escape-critical guarantee is branding, not a verifiable
   statement; (b) external per-tenant S3 mount is only in **secondary** sources, not
   a primary doc; (c) it is **seed-stage** with a proprietary platform and no true
   BYOC/air-gap. Blaxel lands as a **strong-watch / conditional** option: viable as
   an escape-critical bridge **only after** it confirms in writing (i) the hypervisor
   is Firecracker/KVM-class per-tenant, (ii) native external-bucket mounting, and
   (iii) an EU data-plane + DPA. Until then, trusted-pilot-only.

3. **Modal — trusted-pilot-only for THIS use case.** Best-funded and mature DX, real
   S3/R2/GCS mounts, SOC 2 Type II, region pinning. **But its isolation is gVisor —
   a user-space syscall-interception kernel, not hardware virtualization** — and its
   pause/resume is experimental. gVisor raises the bar over plain containers but is a
   **weaker** boundary than Firecracker for adversarial untrusted public multi-tenant
   code. Fine for trusted tenants; below our escape-critical bar as the sole boundary.

4. **Fly.io Machines — hardware-isolated + EU, but wrong shape.** Firecracker +
   EU regions tick the isolation/residency boxes, but it's an app-platform without
   native agent-sandbox exec/snapshot primitives — heavier adapter, so second-tier
   for a *fast* bridge.

5. **Daytona (managed) — trusted-users-only stopgap.** Shared-kernel namespaces by
   default, closed-source/unauditable, soft EU residency. Below the bar (baseline).

6. **Northflank / Runloop / Beam — unconfirmed; trusted-pilot-only** pending
   primary-source isolation + EU verification.

**Where Blaxel lands specifically:** #2 — the most interesting challenger to E2B on
DX/persistence/EU-region breadth, but **not yet adoptable as an escape-critical
boundary** because it will not (in its own docs) confirm the hypervisor or native
S3 mounts. It is a "confirm-then-consider," not a "ship-now."

---

## 3. Recommendation — decisive

**Do not treat a managed provider as a permanent substitute for the self-hosted
Kata + Firecracker runtime. But E2B managed is a good-enough bridge to defer the
*timeline pressure* of the self-host build — and only E2B.**

Concretely:

- **Bridge to market on E2B managed**, wrapped behind `SandboxProviderV1` with
  `isolationClass = "microvm-firecracker"`. It is the single managed option that
  gives confirmed **hardware isolation** from the vendor's own docs, external
  per-tenant S3, mature pause/resume, and — decisively — an **open-source
  Firecracker infra** so the bridge and the endgame share one engine. Migrating
  from E2B-managed → our own Kata+Firecracker is an engine we already understand,
  not a re-platform. This is also consistent with the existing #1081 plan.
- **Gate untrusted public tenants** to `microvm`-class providers only. Modal
  (gVisor) and Daytona/Beam (shared-kernel) may host **trusted design-partner /
  internal** tenants for speed, but must be tagged `isolationClass = "gvisor"` /
  `"shared-kernel"` and blocked from untrusted public workloads.
- **Keep building self-host in parallel** — the managed bridge buys schedule, not a
  reason to stop. The self-host runtime is still the only path that gives us full
  control of the escape boundary, EU sovereignty without Enterprise gating, and
  unit economics at scale.
- **Blaxel: pursue in parallel as a conditional second source** — send the three
  written questions (hypervisor, native S3 mount, EU data-plane + DPA). If it
  confirms Firecracker-class isolation, it becomes a legitimate E2B alternative
  with a better persistence/EU-region story; until then it stays off untrusted
  public traffic.

**Verdict in one line:** *Bridge on E2B managed (only confirmed hardware-isolated,
EU-capable, S3-mounting, open-Firecracker option) behind `SandboxProviderV1`;
keep Kata+Firecracker self-host on the critical path; hold Blaxel as a
confirm-then-adopt second source; keep Modal/Daytona for trusted tenants only.*

---

## 4. Honest risks per top candidate

**E2B (managed)**
1. **EU residency is Enterprise/BYOC-gated**, not a self-serve region toggle — pricing/contract friction, and BYOC shifts ops burden back to us.
2. **GPU on managed cloud is unconfirmed** (appears self-host-only) — blocks GPU agent workloads on the managed bridge.
3. **SOC2/GDPR/DPA not verifiable** from public text — must obtain the security packet before production.
4. Versioned/evolving REST API (v1 endpoints already deprecated) — adapter must track `/v2`.
5. Open-source infra is a strength but the managed SLA/roadmap is still a startup's.

**Blaxel**
1. **Hypervisor unnamed** — the entire escape-critical guarantee rests on unverified "microVM" branding.
2. **External S3 mount unproven** in primary docs — our S3-as-system-of-record model may not be natively supported.
3. **Seed-stage + proprietary + no BYOC/air-gap** — company-continuity and lock-in risk are the highest of the top group.
4. EU regions exist but the **data-plane/telemetry residency + DPA are undocumented**.
5. SDK create/exec/pause/delete signatures unconfirmed — adapter fit is assumed, not verified.

**Modal (trusted-only)**
1. **gVisor, not hardware** — the core disqualifier for untrusted public multi-tenant as a sole boundary.
2. **Pause/resume is experimental** — persistence maturity gap.
3. Proprietary platform, no self-host → lock-in (mitigated by adapter + Series-C stability).

---

### Sources
- E2B: [homepage](https://e2b.dev/), [how-it-works](https://docs.e2b.dev/template/how-it-works), [enterprise](https://e2b.dev/enterprise), [byoc](https://docs.e2b.dev/byoc), [cloud-buckets](https://docs.e2b.dev/storage/cloud-buckets), [archil](https://docs.e2b.dev/storage/archil), [persistence](https://docs.e2b.dev/sandbox/persistence), [pricing](https://e2b.dev/pricing)
- Blaxel: [Overview](https://docs.blaxel.ai/Overview), [Sandboxes/Overview](https://docs.blaxel.ai/Sandboxes/Overview), [Volumes](https://docs.blaxel.ai/Sandboxes/Volumes), [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [pricing](https://blaxel.ai/pricing), [data-residency blog](https://blaxel.ai/blog/ai-sandbox-data-residency-controls-regulated-industries); [secondary] [Mastra BlaxelSandbox](https://mastra.ai/reference/workspace/blaxel-sandbox)
- Modal: [sandbox-networking](https://modal.com/docs/guide/sandbox-networking), [security](https://modal.com/docs/guide/security), [cloud-bucket-mounts](https://modal.com/docs/guide/cloud-bucket-mounts), [Sandbox reference](https://modal.com/docs/reference/modal.Sandbox), [pricing](https://modal.com/pricing), [Series C](https://modal.com/blog/modal-series-c)
- Daytona: see [`daytona-shortterm-eval.md`](daytona-shortterm-eval.md)
- Fly.io Machines: [docs](https://fly.io/docs/machines/)
