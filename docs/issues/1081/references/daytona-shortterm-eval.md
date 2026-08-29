# Daytona (managed/hosted) as a short-term sandbox provider — evaluation

**Context:** Seneca is a public, multi-tenant AI-agent SaaS. We are building a
self-hosted Kata + Firecracker microVM system as the long-term sandbox runtime.
This doc evaluates **Daytona's managed/hosted service** as a *short-term bridge*
behind our own `SandboxProviderV1` abstraction. Escape isolation is the critical
bar: a sandbox escape must not reach other tenants or our control plane.

Date: 2026-08-12. All claims below are quoted with URLs. Vendor pages and
third-party comparisons are labelled as such (competitor blogs like Northflank /
Blaxel are marketing-adjacent and treated as secondary corroboration, not proof).

---

## 1. Requirements table (with quoted evidence)

| Requirement | Verdict | Evidence (quoted) | Source |
| --- | --- | --- | --- |
| **Isolation model** — hardware/microVM cross-tenant isolation for escape-critical multi-tenant | ⚠️ **Weak by default / not proven** | Daytona's own architecture page only claims namespace isolation: *"Each sandbox runs as an isolated instance with its own Linux namespaces for processes, network, filesystem mounts, and inter-process communication"* and *"dedicated vCPU, RAM, and disk resources per sandbox."* It does **not** state microVM/hardware isolation. | [Architecture](https://www.daytona.io/docs/en/architecture/) |
| | | Third-party: *"uses containers (Docker/OCI) by default, which are fast and convenient but share the host system's kernel"*; *"containers share the host kernel, so a sophisticated attack could potentially escape the container and affect the host system."* The article notes it *"does not specify what isolation technology Daytona's managed cloud service actually uses."* | [pixeljets](https://pixeljets.com/blog/ai-sandboxes-daytona-vs-microsandbox/) |
| | | Corroboration: *"Multiple containers share the same kernel, which means kernel vulnerabilities could potentially allow an attacker to escape container boundaries"*; Daytona relies on *"process-level" rather than "hardware-level" security boundaries.* Also references an optional *"gVisor layer [that] provides strong isolation but blocks GPU passthrough."* | [Northflank](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes) |
| **EU data residency** | ✅ EU region exists; ⚠️ residency *guarantee* not documented | Shared regions: United States `us` and Europe `eu`. Region types are Shared (Daytona-managed, all orgs), Dedicated (Daytona-managed, single org), and Custom/BYOC. | [Regions](https://www.daytona.io/docs/en/regions/) |
| | | **Fine print:** the Regions page contains *no explicit statement* on where data physically resides, no EU-only data-residency commitment, and no compliance certifications. GDPR terms exist only via the DPA. | [Regions](https://www.daytona.io/docs/en/regions/), [DPA](https://www.daytona.io/dpa) |
| | | Strongest residency control is BYOC/custom: *"Custom regions are created and managed by your organization... This provides maximum control over data locality, compliance, and infrastructure configuration."* (i.e. you supply the compute.) | [BYOC](https://www.daytona.io/docs/en/bring-your-own-compute/) |
| **Fast to adopt (managed API/SDK)** | ✅ Good | Python + TypeScript/JavaScript SDK. Create from snapshot or image with limits: `daytona.create(CreateSandboxFromImageParams(image="ubuntu:22.04", resources=Resources(cpu=2, memory=4, disk=8)))`. Exec: `sandbox.process.code_run(...)` / `sandbox.process.executeCommand(...)`. Lifecycle: `auto_stop_interval`, `sandbox.stop()/start()`, `sandbox.delete()`. | [Getting started](https://www.daytona.io/docs/en/getting-started/) |
| **Persistence / pause-resume** | ✅ Yes | Sandboxes support stop/start and `auto_stop_interval` (idle minutes). Volumes persist independently of sandbox lifecycle: *"contents persisting independently of the sandbox lifecycle."* | [Getting started](https://www.daytona.io/docs/en/getting-started/), [Volumes](https://www.daytona.io/docs/en/volumes/) |
| **Bring-your-own S3 / external buckets** | ✅ Yes | *"Mount object storage... into a Daytona sandbox as a regular directory"* using *"Mountpoint for Amazon S3 — AWS's official FUSE client."* Supported: Amazon S3, Cloudflare R2, Tigris, Supabase, Google Cloud Storage, Azure Blob, Box, Archil, MesaFS. Credentials passed via `envVars` at create time. | [Mount external storage](https://www.daytona.io/docs/en/mount-external-storage/) |
| **Pricing** | ✅ Transparent, usage-based | *"$0.0504 per vCPU-hour"*, *"$0.0162 per GiB-hour of memory"*, ~*"$0.083 per active hour"* for 1 vCPU/2 GB. Billed per-second while alive; no monthly base fee; $200 free credit; GPU (H100) *"$3.95 per hour"*; *"5 GB of storage included free."* Egress not separately itemised in sources found. | [Northflank pricing](https://northflank.com/blog/ai-sandbox-pricing) (secondary) |

---

## 2. Isolation model — the critical question

**What actually isolates one customer's sandbox from another's on the managed
shared service?** The honest answer from available evidence: **Linux namespaces +
cgroups on a shared host kernel** — i.e. container-grade, process-level isolation,
*not* hardware/microVM isolation — with gVisor available as a stronger (but not
clearly default, and GPU-incompatible) layer.

- Daytona's own docs describe **only** namespace isolation and dedicated
  resource quotas ([Architecture](https://www.daytona.io/docs/en/architecture/)).
  There is **no vendor statement** promising per-tenant microVM or hardware
  isolation on the shared managed tier. Since June 2026 the production codebase
  is closed-source, so the actual runtime cannot be independently verified.
- The Kata/Sysbox/microVM options that appear in the OSS/self-hosted material are
  **opt-in**, and multiple sources note they are not what the default managed
  path uses.
- gVisor (runsc) — a user-space kernel — is the plausible strengthening layer
  Daytona can apply, and it materially raises the escape bar vs plain runc. But:
  (a) it is a syscall-interception boundary, **not** hardware virtualization;
  (b) sources indicate it is not universally applied (it *"blocks GPU
  passthrough"*), so its presence per-sandbox is unconfirmed for our config; and
  (c) *"if you are running multiple untrusted executions inside one runsc
  container, you still need to layer additional controls"*
  ([shayon.dev](https://www.shayon.dev/post/2026/52/lets-discuss-sandbox-isolation/)).

**Bottom line on isolation:** Daytona-managed does **not** give us a documented,
verifiable hardware/microVM cross-tenant boundary equal to our target Kata +
Firecracker design. Against an escape-critical, adversarial, *untrusted-public*
threat model it is a **downgrade** from where we want to be. It is a shared-kernel
(namespaces, possibly + gVisor) boundary.

---

## 3. EU residency

- **Yes**, an `eu` shared region exists, plus Dedicated (single-org, Daytona-run)
  and Custom/BYOC (your compute) region types
  ([Regions](https://www.daytona.io/docs/en/regions/)).
- **But** the docs give no explicit "data stays in the EU" guarantee, no listed
  sub-processor locations, and no compliance certification on the Regions page.
  GDPR obligations live in the [DPA](https://www.daytona.io/dpa) only. For a hard
  EU-sovereignty commitment you would need Dedicated or BYOC and a contractual
  DPA review — the shared `eu` region is a soft residency signal, not a
  sovereignty guarantee. **Confirm in writing with their team before relying on it.**

---

## 4. The June 2026 closed-source pivot

- Confirmed: *"The existing open source repository is not going anywhere. It will
  stay public... We will no longer maintain or update it, but it remains available
  as is."* Active development moved to a private codebase / new GitHub home for
  SDKs and docs ([announcement](https://www.daytona.io/dotfiles/updates/daytona-is-going-closed-source)).
- The **managed service is still operating** (docs, pricing, SDK, regions all
  live and updated in 2026; the announcement directs deployment questions to
  account/security teams). So supportability is fine short-term.
- **Consequence:** we can no longer audit the isolation implementation ourselves —
  we must take the isolation boundary on trust. For an escape-critical product
  that is a real negative, and it compounds the "not-microVM-by-default" concern.
- **Lock-in** is mitigated structurally by wrapping Daytona behind our own
  `SandboxProviderV1` (see §5), so the pivot is a trust/verification risk, not a
  migration-cost risk.

---

## 5. `SandboxProviderV1` adapter sketch

Daytona's SDK maps cleanly onto a create/exec/destroy provider interface.

```ts
// SandboxProviderV1 (our contract) -> Daytona SDK
interface SandboxProviderV1 {
  create(spec): Promise<Handle>;   // -> daytona.create(CreateSandboxFromImageParams{
                                   //      image, resources: Resources{cpu, memory, disk},
                                   //      auto_stop_interval, envVars })
  exec(h, cmd): Promise<Result>;   // -> sandbox.process.executeCommand(cmd)
                                   //    (or sandbox.process.code_run for code)
  writeFile/readFile(h, ...);      // -> sandbox filesystem API (fs upload/download)
  pause(h);   resume(h);           // -> sandbox.stop() / sandbox.start()
  destroy(h);                      // -> sandbox.delete()
}
```

| Requirement | Maps cleanly? | Notes |
| --- | --- | --- |
| create from image + CPU/mem/disk limits | ✅ | `CreateSandboxFromImageParams` + `Resources`. Default caps 4 vCPU / 8 GB / 10 GB disk — confirm ceilings vs our workloads. |
| exec command / run code | ✅ | `process.executeCommand` / `process.code_run`. |
| file I/O | ✅ | FS API present; exact upload/download method names to confirm from SDK reference. |
| timeouts / auto-stop | ✅ | `auto_stop_interval` (idle minutes). Need a hard wall-clock kill too — layer our own. |
| pause/resume, reuse warm | ✅ | `stop()/start()`; warm-sandbox reuse supported. |
| per-tenant S3 as system-of-record | ✅ | Mount external bucket via Mountpoint/FUSE, creds via `envVars`. Our S3-as-SoR model survives on their compute. |
| **hardware isolation guarantee** | ❌ | **Does not map** — the provider contract can't manufacture an isolation guarantee the backend doesn't give. This is the semantic gap, not an API gap. |

**Design guidance:** define `SandboxProviderV1` around the microVM guarantees we
ultimately want (isolation class, egress policy, residency), and record Daytona
as an implementation whose `isolationClass = "shared-kernel"` (or
`"gvisor"` if we can contractually confirm it). That keeps the *capability* honest
in code and lets the app gate which tenants may run on which provider.

---

## 6. Risks (honest)

1. **Isolation-by-default is shared-kernel, not microVM (critical).** No vendor
   guarantee of per-tenant hardware isolation on the managed shared tier; gVisor
   is unconfirmed/opt-in and GPU-incompatible. For untrusted public code this is
   below our escape-critical bar.
2. **Closed-source since June 2026** — the isolation layer is now unauditable; we
   take the boundary entirely on trust at the exact moment we most want to verify it.
3. **EU-residency fine print** — an `eu` region exists but there is no documented
   data-residency/sovereignty guarantee on shared compute; real sovereignty needs
   Dedicated or BYOC + a DPA review.
4. **Vendor lock-in** — mitigated (not eliminated) by `SandboxProviderV1`; SDK is
   Daytona-specific but the surface is small.
5. **Egress cost** — not itemised in the sources found; per-tenant S3 mounts and
   agent traffic could incur data-transfer charges. Confirm before load scaling.
6. **Resource ceilings** — default max 4 vCPU / 8 GB / 10 GB disk per sandbox may
   constrain heavier agent workloads; confirm higher limits on Dedicated.

---

## 7. VERDICT

**Daytona-managed is a viable short-term bridge ONLY for trusted / low-risk early
users — NOT for escape-critical, untrusted, public multi-tenant workloads.**

Why: the whole reason we are building Kata + Firecracker is hardware-level,
per-tenant escape isolation. Daytona's managed shared service, on the available
evidence, isolates tenants with **Linux namespaces on a shared host kernel**
(possibly hardened with gVisor, unconfirmed and GPU-limited) — **process-level,
not hardware-level**. That is a *downgrade* from our target boundary, and the
June 2026 closed-source pivot means we can no longer verify it. Adopting it as the
escape-critical isolation layer would contradict the exact requirement motivating
the self-hosted build.

**Where it fits short-term:**
- ✅ Trusted/design-partner tenants, internal dogfooding, and demos where the
  blast radius of an escape is acceptable — get to market fast with a clean SDK.
- ✅ Everything *around* isolation is a good fit and de-risks our own build:
  clean create/exec/destroy SDK, pause/resume, transparent per-second pricing,
  and **bring-your-own per-tenant S3** (our S3-as-system-of-record model works
  unchanged on their compute).
- ✅ Wrapping it behind `SandboxProviderV1` is low-effort and is the right move
  regardless — it lets us ship on Daytona now and cut over to Kata+Firecracker
  with no app change.

**Conditions before ANY production use:**
1. Get Daytona to state **in writing** the exact runtime and per-tenant isolation
   boundary on the tier we'd use (namespaces only vs gVisor vs Kata), and whether
   escape-critical multi-tenant is contractually supported.
2. Get a **written EU data-residency** commitment (region pinning + sub-processor
   locations) via the DPA; do not rely on the `eu` region label alone.
3. Tag `isolationClass` in `SandboxProviderV1` and **gate untrusted public tenants
   off the shared-kernel provider** until (1) is satisfactory or our
   Kata+Firecracker runtime is ready.

If escape isolation cannot be contractually raised to hardware/microVM level,
Daytona-managed is a **trusted-users-only stopgap**, and the self-hosted
Kata+Firecracker system remains the only path that meets the escape-critical bar.

---

### Sources
- Daytona Architecture — https://www.daytona.io/docs/en/architecture/
- Daytona Regions — https://www.daytona.io/docs/en/regions/
- Daytona Bring Your Own Compute — https://www.daytona.io/docs/en/bring-your-own-compute/
- Daytona Mount External Storage — https://www.daytona.io/docs/en/mount-external-storage/
- Daytona Volumes — https://www.daytona.io/docs/en/volumes/
- Daytona Getting Started (SDK) — https://www.daytona.io/docs/en/getting-started/
- Daytona DPA — https://www.daytona.io/dpa
- Daytona "going closed source" — https://www.daytona.io/dotfiles/updates/daytona-is-going-closed-source
- Northflank: Daytona vs E2B — https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes
- Northflank: AI sandbox pricing — https://northflank.com/blog/ai-sandbox-pricing
- pixeljets: Daytona vs microsandbox — https://pixeljets.com/blog/ai-sandboxes-daytona-vs-microsandbox/
- shayon.dev: Let's discuss sandbox isolation — https://www.shayon.dev/post/2026/52/lets-discuss-sandbox-isolation/
