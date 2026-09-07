# Sandbox Isolation Technology Choices — Primary-Source Evidence

> **Superseded recommendation:** this source collection was assembled for the
> earlier single-tenant model. Its gVisor-v1 recommendation is not authoritative
> for public multi-tenant Seneca; see `sandbox-engine-security-eval.md`.

For decision record PR #1219 (hachej/boring-ui): gVisor-container for v1 vs Firecracker/microVM
for a v2 sovereign service. All quotes below are transcribed verbatim from the cited primary
sources; anything unverifiable is flagged `[UNVERIFIED]`.

---

## 1. Modal — gVisor

**Tech:** gVisor (Google's userspace application-kernel container runtime).

**Quoted rationale (source: Modal Docs, Sandbox networking/security guide — https://modal.com/docs/guide/sandbox-networking):**

> "Sandboxes are built on top of gVisor, a container runtime by Google that provides strong
> isolation properties."

> "gVisor has custom logic to prevent Sandboxes from making malicious system calls, giving you
> stronger isolation than most other container runtimes."

> "Sandboxes are not authorized to access other resources in your Modal workspace the way that
> Modal Functions are [by default]."

> "the blast radius of any malicious code will be limited to the Sandbox container itself."

**Security note:** gVisor's model is syscall interception in userspace — the sandboxed process
never talks directly to the host Linux kernel, shrinking the kernel attack surface. Modal frames
it as "stronger isolation than most other container runtimes," i.e. positioned above plain
containers but explicitly a *container runtime*, not a VM boundary.

**Pros (as stated / industry-corroborated):** density and scale — Modal markets 100,000+
concurrent gVisor-isolated sandboxes; strong syscall filtering without a full guest kernel.

**Cons / limitations:** The classic gVisor tradeoff is performance overhead on syscall-heavy and
I/O-heavy workloads (see Fly's quote below — "low-double-digits percentage hit, degrading with
I/O load"). Not a hardware boundary.

`[UNVERIFIED — modal.com/blog/gvisor-experiments and modal.com/blog/how-modal-works both 404'd.
GPU/nvproxy and cold-start reasoning could NOT be sourced to a direct Modal quote in this
session. Modal's own resources index (modal.com/resources/*) exists but was not fetched for
exact quotes.]`

---

## 2. Fly.io — Firecracker microVMs

**Tech:** Firecracker (Rust KVM-based microVM VMM; powers AWS Lambda/Fargate). Fly Machines.

**Quoted rationale (source: Thomas Ptacek, "Sandboxing and Workload Isolation," The Fly Blog,
July 2020 — https://fly.io/blog/sandboxing-and-workload-isolation/):**

On why hardware virtualization beats sharing the host kernel:

> "you're unlikely to have routine exploitable memory corruption flaws in Go code. You are sort
> of likely to have them in the C-language Linux kernel."

> "you're booting an actual, make-menuconfig'd kernel, in all of it's memory-unsafe glory. But
> you're doing it inside a hypervisor where, in the Firecracker case, really you're only worried
> about the integrity of the kvm subsystem itself."

> "The reason Firecracker (and, if you overlook the C code, kvmtool) can be this simple is that
> they're pushing the system complexity down a layer."

On the defense-in-depth of the VMM itself:

> "The VMM seccomp-bpf's itself down to something like 40 system calls, several, including basic
> things like `fcntl`, `socket`, and `ioctl`, with tight argument filters. Runs itself under an
> external jailer that chroots, namespaces, and drops privileges."

On gVisor as the alternative (notably even-handed):

> "You are probably strictly better off with gVisor than you are with a tuned Docker
> configuration, and I like it a lot. The big downside is performance; you'll be looking at a
> low-double-digits percentage hit, degrading with I/O load."

Hardware requirement (a real operational cost of the microVM path):

> "you need bare metal servers to efficiently do lightweight virtualization; you want KVM but
> without nested virtualization."

**Security note:** The core argument is *isolation via a hardware (KVM) boundary + a tiny,
memory-safe (Rust) VMM*, so a guest kernel compromise is contained to the KVM subsystem rather
than the shared host kernel. This is the strongest of the models surveyed.

**Pros:** Strongest isolation (hardware boundary); minimal attack surface (~40 syscalls, jailer);
full arbitrary-workload support (real Linux kernel per guest); sub-second boot.

**Cons:** Requires bare-metal hosts with KVM (no easy nested virt) — an infra/sovereignty cost;
per-guest kernel memory overhead vs isolates; more moving parts than a single container runtime.

---

## 3. Cloudflare — V8 Isolates (the isolates era)

**Tech:** V8 Isolates (JS-engine-level software isolation; no container/VM per tenant).

> **Currency note (two-era story):** The Nov 2018 quotes below characterize
> Cloudflare's *original* Workers model — V8 isolates only. Cloudflare has since
> shipped **Cloudflare Containers** (announced Developer Week 2025, open beta late
> June 2025 — https://blog.cloudflare.com/cloudflare-containers-coming-2025/ ;
> docs: https://developers.cloudflare.com/containers/ ), a Linux container compute
> model that runs "code written in any programming language, built for any runtime"
> alongside Workers, each container instance paired with a Durable Object sidecar
> for lifecycle/state. So "Cloudflare = isolates only" is no longer accurate. The
> isolates data point below stands as the **isolates primitive** (the boundary we
> are *not* taking — language-restricted, software-only), not a claim about
> Cloudflare's current overall capabilities. The isolation ladder
> (isolates < gVisor < Firecracker) is about isolates-as-a-primitive and is unaffected.

**Quoted rationale — original isolates model (source: Zack Bloom, "Cloud Computing without
Containers," The Cloudflare Blog, Nov 2018 — https://blog.cloudflare.com/cloud-computing-without-containers/):**

Why not containers/VMs:

> "Traditional virtualization and container technologies like Kubernetes would have been
> exceptionally expensive for everyone involved."

> "What we ended up settling on was a technology built by the Google Chrome team to power the
> Javascript engine in that browser, V8: Isolates."

Multi-tenancy / density / cold-start:

> "Fundamentally V8 was designed to be multi-tenant. It was designed to run the code from the many
> tabs in your browser in isolated environments within a single process."

> "Any given Isolate can start around a hundred times faster than I can get a Node process to
> start on my machine."

> "In the Lambda world this amounts to spinning up a new containerized process which can take
> between 500 milliseconds and 10 seconds" (vs) "Isolates start in 5 milliseconds, a duration
> which is imperceptible."

> "A basic Node Lambda running no real code consumes 35 MB of memory. When you can share the
> runtime between all of the Isolates as we do, that drops to around 3 MB."

Security basis and its explicit limitation:

> "The only reason this was possible at all is the open-source nature of V8, and its standing as
> perhaps the most well security tested piece of software on earth."

> "An Isolate-based system can't run arbitrary compiled code ... you have to either write your
> code in Javascript (we use a lot of TypeScript), or a language which targets WebAssembly like
> Go or Rust."

**Security note:** Isolation is *software-level* (each isolate has its own heap, cannot read
another's memory) resting entirely on V8's correctness — a V8 escape breaks the boundary. Extreme
density and ~5ms cold starts are the payoff. Explicitly cannot run arbitrary native binaries.

**Pros:** Best density/cost, near-zero cold start, tiny per-tenant memory.
**Cons:** Weakest boundary (no kernel/hardware isolation); language-restricted (JS/Wasm only);
security is only as good as V8. Not suitable for arbitrary untrusted native code.

---

## 4. Bonus — Vercel Sandbox & E2B (both Firecracker)

### Vercel Sandbox — Firecracker microVMs
**Quoted (source: Vercel Docs, "Understanding Sandboxes" — https://vercel.com/docs/sandbox/concepts):**

> "Unlike Docker containers, each sandbox runs in its own Firecracker microVM with a dedicated
> kernel. This provides stronger isolation than container-based solutions, which makes sandboxes
> ideal for running untrusted code."

> "Each sandbox runs in its own Firecracker microVM with a dedicated kernel, so you can run
> processes that require system-level privileges without affecting other sandboxes or the host.
> These workloads run with `sudo` and are isolated to your sandbox by the microVM boundary."

Their own containers-vs-microVM table states: Docker "Shares host kernel; ... container escapes
are possible"; Vercel Sandbox "Dedicated kernel per sandbox; full VM isolation ... microVM
boundary prevents escapes." Startup: "Milliseconds (Firecracker optimized for fast boot)."
Region note: sandboxes "automatically provision in `iad1` region" (US), corroborating the
US-only characterization.

### E2B — Firecracker microVMs
Verified E2B uses Firecracker; E2B's own comparative blog ("Firecracker vs QEMU" —
https://e2b.dev/blog/firecracker-vs-qemu) characterizes Firecracker as "Fast Boots: Starts VMs
3x faster than QEMU MicroVMs", "Small and Secure: Written in Rust with only 50k lines of code",
"Minimal Memory Usage: Each microVM has less than 5MB RAM overhead," and notes "Companies like
E2B use Firecracker to run AI generated code securely in the cloud."
`[UNVERIFIED — a first-person E2B statement of *why they chose* Firecracker over containers was
not found as a direct quote; the above are the article's characterizations of Firecracker, not a
quoted E2B rationale.]`

---

## Decision framework (as supported by the sources)

No single source states a clean three-way rubric verbatim, but the primary quotes line up into a
consistent spectrum (strength of boundary vs cost/density/latency), which is a fair synthesis:

- **V8 isolates (Cloudflare):** weakest boundary (software, trusts V8), best density + ~5ms cold
  start, language-restricted → for *your own* or Wasm-constrained code at massive scale.
- **gVisor (Modal):** middle — userspace kernel intercepts syscalls, "stronger isolation than
  most container runtimes," runs arbitrary Linux, dense; pays a syscall/I/O performance tax; not
  a hardware boundary → cost-sensitive, dense multi-tenant, *medium* threat model.
- **Firecracker / Kata microVMs (Fly, Vercel, E2B):** strongest — hardware KVM boundary, tiny
  Rust VMM (~40 syscalls + jailer), per-guest kernel; needs bare-metal KVM hosts → high-assurance
  / hardware-isolation, untrusted arbitrary native code.

Fly's own line captures the ordering: gVisor is "strictly better off ... than a tuned Docker
configuration" (so: containers < gVisor), while their whole thesis is that pushing complexity
"down a layer" into a hypervisor (microVM) is safer still than trusting "the C-language Linux
kernel" (so: gVisor < microVM on assurance, at a performance/infra cost).

---

## Mapping to our v1 vs v2

**v1 = gVisor container (ship-fast, Modal-validated).** Our v1 choice sits exactly where Modal
sits: gVisor gives "stronger isolation than most other container runtimes" and limits "the blast
radius ... to the Sandbox container itself," without needing bare-metal KVM hosts. Modal running
100k+ concurrent gVisor sandboxes is direct evidence the model scales for dense, cost-sensitive,
medium-threat multi-tenant execution — the right tradeoff to *ship fast*. Documented cost: the
syscall/I/O performance tax Fly quantifies ("low-double-digits percentage hit, degrading with I/O
load") and the fact that the boundary is software, not hardware.

**v2 = microVM sovereign service (Fly/Vercel/E2B-validated).** For a sovereign, high-assurance
tier, the primary sources uniformly point to Firecracker: hardware KVM boundary, memory-safe Rust
VMM seccomp'd to ~40 syscalls under a jailer, and a dedicated per-tenant kernel so a guest kernel
compromise is contained to the KVM subsystem rather than a shared host kernel. Fly, Vercel, and
E2B all independently chose this for *untrusted arbitrary code* — the same posture a sovereign
service demands. The stated price we should budget for is Fly's requirement: "bare metal servers
... KVM but without nested virtualization" (an infra/sovereignty cost, not just a code change),
plus per-guest kernel memory overhead. Vercel's US-only `iad1` default is a caution that sovereign
region control is an explicit design axis, not free.

Net: the evidence supports a *staged* posture — gVisor now (dense, cheap, Modal-proven, medium
threat), Firecracker microVM for the sovereign v2 (hardware isolation, Fly/Vercel/E2B-proven,
high threat) — rather than one technology for both tiers.
