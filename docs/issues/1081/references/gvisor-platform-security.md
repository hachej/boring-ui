# gVisor Platform Security: systrap vs KVM (for sandbox plan #1220)

> **Superseded outer-boundary recommendation:** this report compares platforms
> *within gVisor* under the old single-tenant premise. Corrected v1 uses a
> Firecracker/KVM microVM boundary. It remains relevant only to an optional
> gVisor-inside-microVM experiment.

**Question:** We run `runsc --platform=systrap` on a rented Linux VM with no `/dev/kvm`. Is that a security compromise vs the KVM platform for untrusted multi-tenant code?

**Bottom line (verdict):** **Systrap is fine. Keep it for v1.** gVisor's own documentation treats the platform choice as a **performance and hardware-compatibility decision, not a security-boundary decision.** The security model — the Sentry intercepts *every* application syscall and re-implements the Linux ABON itself, plus a restrictive seccomp filter around the Sentry — is **identical across ptrace, systrap, and KVM**. The KVM platform does **not** give a stronger isolation guarantee against untrusted guest code; it primarily improves address-space-switch and page-fault performance on bare metal. There is therefore **no security argument to provision a `/dev/kvm`-capable VM for v1** — only a potential performance argument, and systrap is explicitly the modern high-performance default. See caveats in §3/§5.

---

## 1. The three platforms explained

The "platform" is gVisor's mechanism for doing two low-level jobs on behalf of the Sentry (gVisor's userspace kernel): **(a) intercept application system calls** and **(b) manage guest address spaces / page faults**. It is a mechanism layer, not the security policy layer.

| Platform | Syscall interception mechanism | Status |
|---|---|---|
| **ptrace** | `PTRACE_SYSEMU` — the tracer (Sentry) traps every guest syscall; guest code can never execute a host syscall directly. Uses the host for memory mapping/context switching. | **Deprecated.** Docs state it "is no longer supported and is expected to eventually be removed entirely." Universally compatible but slow for syscall-heavy workloads. |
| **systrap** | seccomp `SECCOMP_RET_TRAP`: the kernel sends `SIGSYS` to the triggering thread, handing control to a custom gVisor signal handler that services the syscall. Uses shared memory between guest threads and the `runsc` Sentry for speed. | **Current default and recommended** — "systrap replaced ptrace as the default gVisor platform in mid-2023." Does **not** require host virtualization support, so it runs cleanly inside a VM. |
| **KVM** | Uses the host KVM subsystem. The Sentry acts as **both guest OS and VMM** ("presents no virtualized hardware layer"); leverages CPU virtualization extensions to accelerate address-space switches and page-fault interception. | Supported. "Best performance on bare-metal." Slower than systrap under **nested** virtualization. Requires `/dev/kvm`. |

Source quotes:
- systrap: *"The `systrap` platform relies on `seccomp`'s `SECCOMP_RET_TRAP` feature in order to intercept system calls. This makes the kernel send `SIGSYS` to the triggering thread, which hands over control to gVisor to handle the system call."* — [Platform Guide](https://gvisor.dev/docs/architecture_guide/platforms/)
- KVM: *"gVisor leverages virtualization extensions available on modern processors in order to improve isolation and performance of address space switches."* — [Platform Guide](https://gvisor.dev/docs/architecture_guide/platforms/)
- Default choice framed on performance: *"The choice of platform depends on the context in which `runsc` is executing. In general, when running on bare-metal (not inside a VM), the KVM platform will provide the best performance."* — [Platform Guide](https://gvisor.dev/docs/architecture_guide/platforms/)
- systrap is designed for in-VM use: *"Systrap ... does not require virtualization support from the host, making it well-suited to run inside a virtual machine."* — [Systrap release blog](https://gvisor.dev/blog/2023/04/28/systrap-release/)

---

## 2. Does the platform change the SECURITY boundary? No — same boundary, different speed.

gVisor's security model is defined by the **Sentry**, not by the platform:

- *"the application's direct interactions with the host System API are intercepted by the Sentry, which implements the System API instead."* — [Security model](https://gvisor.dev/docs/architecture_guide/security/)
- *"No system call is passed through directly to the host."*
- The Sentry itself is confined: it talks to the host only through a minimized set of operations (Gofer for filesystem, a minimal host-syscall set that excludes socket creation / file opening, and packet r/w to a virtual NIC), **and systrap additionally applies "a very restrictive seccomp filter"** around the Sentry ([Systrap release blog](https://gvisor.dev/blog/2023/04/28/systrap-release/)).

Crucially, gVisor explicitly rebuts the intuition that a non-KVM platform lets syscalls leak through. On the (now-deprecated) ptrace platform they state: *"all system calls are interpreted and handled by the Sentry itself, who reflects resulting register state back into the tracee before continuing execution in userspace."* ([Security model](https://gvisor.dev/docs/architecture_guide/security/)). systrap enforces the same property via seccomp `SECCOMP_RET_TRAP` — the guest **cannot** issue a host syscall directly under any platform.

The systrap blog reinforces that the attack-surface reduction is a property of the *interception model itself*, not of KVM: *"This minimizes the attack surface of the host kernel, because sandboxed programs simply can't make system calls directly to the host in the first place."* ([Systrap release blog](https://gvisor.dev/blog/2023/04/28/systrap-release/)).

**Conclusion for §2:** The KVM platform does **not** provide a stronger logical isolation guarantee. Both put the Sentry between the guest and the host and both forbid direct host syscalls. The KVM word "isolation" in gVisor's docs refers to **address-space-switch acceleration / page-fault handling via hardware**, i.e. a performance mechanism, not a claim that systrap leaks more.

---

## 3. Known limitations / caveats of the non-KVM (systrap) platform

- **No documented systrap-specific security downgrade.** gVisor's docs never say "prefer KVM for hardening." The systrap release notes emphasize they *"maintain a high bar for security through targeted fuzz-testing for Systrap specifically"* — i.e. systrap is held to the same security bar, and its newer signal/shared-memory machinery was fuzzed precisely to keep it there.
- **Shared-memory implementation surface.** systrap uses memory shared between guest threads and the Sentry for speed. That is a new-ish internal mechanism (2023) versus KVM's older hardware path, so its *implementation* attack surface is a legitimate thing to track — but gVisor guards it with the restrictive seccomp filter and dedicated fuzzing. No public CVE indicates systrap is categorically weaker. [UNVERIFIED: I did not enumerate the gVisor CVE/GHSA list in this pass; recommend a quick scan of github.com/google/gvisor security advisories before finalizing #1220.]
- **Hardware side-channels are a wash between platforms.** gVisor explicitly declines to defend against hardware attacks *regardless of platform*: *"gVisor relies on the host operating system and the platform for defense against hardware-based attacks. Given the nature of these vulnerabilities, there is little defense that gVisor can provide ... this is true even when using hardware virtualization for acceleration, as the host kernel or hypervisor is ultimately responsible."* ([Security model](https://gvisor.dev/docs/architecture_guide/security/)). So switching to KVM does **not** buy you Spectre/side-channel protection.
- **Page-cache cross-tenant side channel is platform-agnostic.** Independent 2026 research (page-cache SCA across containers/VMs) found the shared host page cache is observable across tenants under *both* systrap and KVM isolation boundaries — this is a host-page-cache/gofer-filesystem issue, not a systrap-vs-KVM issue. Mitigation is at the host/filesystem layer (per-tenant backing, cache partitioning), not by changing gVisor platform. Source: [arXiv 2607.17518](https://arxiv.org/html/2607.17518v1). [UNVERIFIED beyond the search abstract — treat as a "track this at the host layer" flag, not a systrap-specific defect.]

---

## 4. Honest verdict for untrusted MULTI-TENANT code

**(a) Equivalently secure to the KVM platform, only slower on bare metal.** For our threat model (untrusted multi-tenant guest code trying to escape to the host or to another tenant), systrap and KVM present the **same Sentry-mediated boundary** and the **same restricted host interface**. gVisor would recommend either platform for multi-tenant untrusted code; it recommends KVM only where bare-metal performance matters, and it now recommends **systrap as the default** — including explicitly for the in-VM case, which is exactly ours.

What actually determines multi-tenant safety in gVisor is **not** the platform but: keeping `runsc` current, the Sentry seccomp confinement, network/filesystem policy (gofer, no host socket/file access), resource limits (DoS is out of gVisor's scope), and host-kernel/firmware patching for side-channels. Those apply identically under systrap.

---

## 5. Implication: should we provision a `/dev/kvm`-capable VM for v1?

**No security requirement to do so.** Because the KVM platform is not a stronger security boundary, there is **no hardening reason** to chase nested-KVM / `/dev/kvm` on the rented VM for v1. gVisor itself notes KVM is *slower than systrap under nested virtualization* — so on a rented (already-virtualized) VM, forcing `--platform=kvm` via nested KVM would likely be **both more operationally fragile and slower**, for zero security gain.

**Recommendation for #1220 v1:**
1. **Keep `runsc --platform=systrap`.** It is the modern default, purpose-built for running inside a VM, and gives the full gVisor security boundary. This is the correct choice, not a compromise.
2. **Put the real hardening effort where it matters** — not on the platform: pin/patch `runsc` and the host kernel/firmware; verify the Sentry runs with its default restrictive seccomp; enforce per-tenant filesystem backing (mitigates the page-cache side channel); set hard resource limits (gVisor does not defend against resource-exhaustion DoS); and confirm no host socket/file passthrough in the gofer config.
3. **Revisit KVM only as a performance lever** if/when we run on **bare metal** with `/dev/kvm` and profiling shows address-space-switch cost dominating. It is a perf optimization, tracked separately from security.
4. **Follow-up (cheap):** scan github.com/google/gvisor GHSA advisories for any systrap-tagged issue before locking v1 [UNVERIFIED — not done in this pass].

---

## Sources
- gVisor Platform Guide — https://gvisor.dev/docs/architecture_guide/platforms/
- gVisor Security Model — https://gvisor.dev/docs/architecture_guide/security/
- gVisor "Releasing Systrap" blog (2023-04-28) — https://gvisor.dev/blog/2023/04/28/systrap-release/
- gVisor "Platform Portability" blog (2020-10-22) — https://gvisor.dev/blog/2020/10/22/platform-portability/
- gVisor Changing Platforms (user guide) — https://gvisor.dev/docs/user_guide/platforms/
- Page-cache SCA cross-tenant research (2026) — https://arxiv.org/html/2607.17518v1 [UNVERIFIED beyond abstract]
