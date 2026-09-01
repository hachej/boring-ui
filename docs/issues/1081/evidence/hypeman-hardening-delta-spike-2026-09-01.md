# Hypeman non-root and jailer delta spike — 2026-09-01

Status: **executed prototype; not production implementation**

Issue: #1081

Prior evidence: `hypeman-firecracker-spike-2026-09-01.md`

Runtime: Hypeman `v0.3.0`, Firecracker and jailer `v1.14.2`

## Decision gated

Is a hardened Hypeman fork technically credible enough to challenge the
ratified Kata/Firecracker M0 vehicle, and is the required delta a narrow patch
or a substantial owned runtime project?

## Scope

This spike executed two bounded experiments:

1. run the stock Hypeman API and its full network-enabled Firecracker lifecycle
   as a non-root host user with bounded network capabilities;
2. cold-boot the exact Hypeman kernel, initrd, OCI root disk, writable overlay,
   config disk and guest agent through the official Firecracker jailer.

Snapshot, restore, fork and UFFD were deliberately excluded from the jailed
prototype. They require additional path translation and lifecycle work.

## Immutable inputs

- Hypeman release archive SHA-256:
  `0e704787082e2f5744f55e59b6858085c952f695b5e3cf3d5ea081b1d655c15b`.
- Firecracker release archive SHA-256:
  `c9f112a983783f3cf50feea9e69b8ea9eb7475e52159a9585ca9555be630f5a3`.
- Firecracker binary SHA-256:
  `36bccbe85a347307edfce2148f23191e8be55d08d287d9d3a6dccf037bed087e`.
- Jailer binary SHA-256:
  `078705c4b807057b5f9a222c5b81f34efcac83fd2b6226d87ca2251949e88809`.
- Workload remained the digest-pinned Alpine image from the first spike.

Secrets, runtime paths and process IDs are omitted.

## Experiment A — stock API as non-root

The earlier non-root attempt was invalidated by a host detail: `/tmp` is
mounted `nosuid`, so Linux ignored file capabilities there. Moving the unchanged
release binary to a capability-supporting filesystem and granting only
`CAP_NET_ADMIN` and `CAP_NET_BIND_SERVICE` allowed it to start as UID/GID 1000.
A second full network start and HTTPS fetch succeeded after explicitly removing
`CAP_NET_RAW`.

### Executed results

| Probe | Result | Evidence |
| --- | --- | --- |
| API host identity | **PASS** | `hypeman-api` ran as UID/GID 1000, not root. |
| KVM access | **PASS** | Membership in the host `kvm` group was sufficient. |
| Bridge/NAT setup | **PASS** | The non-root API created the dedicated bridge and tagged iptables rules. |
| TAP lifecycle | **PASS** | It created and attached a per-instance TAP through retained `CAP_NET_ADMIN`. |
| Firecracker host identity | **PASS** | Direct child Firecracker ran as UID/GID 1000 with zero effective capabilities. |
| Firecracker self-hardening | **PASS, narrow** | Direct child reported `NoNewPrivs: 1` and seccomp mode 2. |
| Guest network | **PASS** | Guest received `10.231.0.114/24`, installed the expected default route and fetched HTTPS content from `example.com`. |
| Rootless service with no host capabilities | **FAIL** | Runtime TAP, iptables and traffic-control mutation still requires host network privilege. |
| Jailer confinement | **FAIL in stock path** | Stock Hypeman still launched Firecracker directly with a host-visible API socket. |

A production unit should use a dedicated service user, `SupplementaryGroups=kvm`
and systemd ambient/bounding capabilities rather than persistent file
capabilities. `CAP_NET_ADMIN` remains a broad host authority; a later privileged
network helper would reduce that trust surface.

## Experiment B — official jailer with Hypeman assets

The official jailer was started through a privileged launcher. The prototype
materialized only the declared VM resources under a per-instance jail and
translated Firecracker API payloads to these jail-visible paths:

```text
/vmlinux
/initrd
/rootfs.erofs       read-only
/overlay.raw        writable, owned by jail UID
/config.ext4        read-only
/vsock.sock
/firecracker.socket
```

It then configured and started Firecracker through the jail's API socket and
used Hypeman's own Firecracker-vsock and guest gRPC clients to execute inside
the booted VM.

### Executed results

| Probe | Result | Evidence |
| --- | --- | --- |
| Hypeman guest boot through jailer | **PASS** | Kernel, initrd, all three disks and Hypeman init/guest agent booted successfully. |
| Jailed VMM identity | **PASS** | Firecracker ran as UID/GID 65534 with zero effective capabilities. |
| Privilege hardening | **PASS** | VMM reported `NoNewPrivs: 1` and seccomp mode 2. |
| Chroot boundary | **PASS** | `/proc/<vmm>/root` and the prepared jail root had the same device/inode; its mount namespace exposed only `/`. |
| Guest-agent connectivity | **PASS after helper permission step** | Hypeman's client connected through the jailed vsock and executed `id`, `pwd` and a proof command. |
| cgroup v2 placement | **PASS, launcher probe** | Jailer created `/hypeman-spike/fcspike3` with `memory.max=536870912` and `pids.max=64`; its VMM PID was present in that cgroup. |
| API/vsock exposure | **FAIL as automatic integration** | Jailer creates a mode-0700 root and nobody-owned sockets. A privileged helper had to expose the sockets to the non-root API group. |
| Existing absolute paths | **FAIL as automatic integration** | Stock Hypeman sends host-absolute kernel, disk, vsock, serial and snapshot paths, which are invalid after chroot. |
| Snapshot/restore/fork/UFFD | **UNPROVEN** | Snapshot state embeds paths; UFFD uses another host Unix socket/FD path. |

The guest command still ran as root. This experiment hardened the host VMM
boundary only; it did not repair Hypeman's guest execution contract.

## Required production delta

The experiment shows a credible implementation seam, but not a one-line binary
swap. A hardened fork needs:

1. a dedicated non-root API service user with bounded network capabilities;
2. a small root-owned launcher/helper that validates instance identity and
   allowlisted resource paths, creates the jail and cgroup, starts jailer and
   returns stable host socket/process handles;
3. separate host and jail path types, with translation for kernel, initrd,
   disks, serial, vsock, snapshots and UFFD;
4. explicit socket-group ownership instead of opening the jail root;
5. launcher-owned stop, cleanup and debt reconciliation;
6. fail-closed `unsupported` responses for snapshot/fork/UFFD until each path is
   implemented and qualified;
7. the separately required non-root guest exec, output limits, process-tree
   cleanup and tenant-bound authorization work.

The narrow code seam remains
`lib/hypervisor/firecracker/process.go::startProcess`, but path translation
reaches `config.go`, snapshot/fork state and UFFD. Installation/configuration
also needs a dedicated service user and helper contract.

## Effort finding

This is a **substantial maintained fork**, not a narrow hardening patch. A
reasonable prototype-to-qualification estimate is:

- cold-boot jailed launcher and path model: 4–7 engineer-days;
- stop/snapshot/restore/fork/UFFD and cleanup: 6–10 engineer-days;
- systemd/helper hardening, cohort attestation and adversarial host tests: 5–8
  engineer-days;
- secure guest execution contract, independently required: 4–7 engineer-days.

Total: **19–32 engineer-days before full sovereign two-tenant qualification**.
This estimate excludes SeaweedFS, effect-ledger and publication work that
remains Boring-owned under either vehicle.

## Cleanup state

All API, jailer and Firecracker processes were stopped. The test bridge, TAP and
all three tagged iptables rules were removed. Runtime files and empty cgroup
artifacts were retained because project policy forbids deletion without explicit
owner permission. Approximately 732 MiB remains outside the repository.

## Decision

**Technical viability: PASS. Narrow-patch hypothesis: FAIL. M0 admission: FAIL.**

The jailer and non-root service design works on this host with real Hypeman
assets, including guest-agent exec and network egress. The remaining work is
architecturally understandable, but large enough to create a security-sensitive
long-lived fork.

Therefore retain Kata/Firecracker as the ratified M0 vehicle unless the owner
explicitly chooses to own that fork. Reuse or extract Hypeman's lifecycle and
snapshot machinery for the scale-era vehicle remains attractive. If Hypeman is
to challenge M0, the next artifact must be an owner-approved implementation
slice for the privileged launcher plus cold-boot path model—not a provider
adapter.
