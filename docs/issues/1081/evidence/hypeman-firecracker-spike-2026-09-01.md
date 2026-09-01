# Hypeman Firecracker feasibility spike — 2026-09-01

Status: **executed, bounded evidence; does not close sovereign Gate 0**  
Issue: #1081  
Candidate: Kernel Hypeman as an alternative owned microVM lifecycle vehicle  
Runtime tested: Hypeman release `v0.3.0`, Linux amd64  
Source reviewed separately: `kernel/hypeman@2efc0b341a243b6fe5a896e90a318ca9f34d9624`

## Question

Can Hypeman materially replace the plan's Kata/Firecracker lifecycle vehicle or
Phase-4 guest/runtime machinery while preserving the sovereign sandbox
invariants?

## Environment and immutable inputs

- Host: Linux `6.14.0-37-generic`, x86_64.
- `/dev/kvm`: `crw-rw---- root:kvm`; the service user could read and write it.
- Hypeman release archive SHA-256:
  `0e704787082e2f5744f55e59b6858085c952f695b5e3cf3d5ea081b1d655c15b`.
- `hypeman-api` SHA-256:
  `6f0dff19c0b7e784a6efab120f3524561c01e92e3daf2eac67044644bd8f3a61`.
- Runtime-selected Firecracker: `v1.14.2`, SHA-256
  `36bccbe85a347307edfce2148f23191e8be55d08d287d9d3a6dccf037bed087e`.
- Guest kernel metadata: `ch-6.12.8-kernel-3.0-202605291`.
- OCI workload: `docker.io/library/alpine@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e`.
- VM profile: 1 vCPU, 512 MiB RAM, 1 GiB sparse overlay, network disabled.
- Runtime files and credentials were kept outside the repository. No token or
  signing secret is included in this evidence.

The release checksum was verified against the published `checksums.txt` before
execution. `erofs-utils` 1.8.5 was installed as the only missing host package.

## Executed results

| Probe | Result | Evidence |
| --- | --- | --- |
| KVM access | **PASS** | Hypeman reported `Hypervisor access verified`; Firecracker booted successfully. |
| OCI pull and conversion | **PASS** | Alpine became `ready` in 2.650 s and resolved to the digest above. |
| Firecracker create | **PASS** | API returned `201` in 721 ms; internal phase data reported about 1.65 s from create through guest-agent-ready. |
| Distinct guest kernel | **PASS** | Guest reported Linux 6.12.8 while host runs 6.14.0-37. |
| Network-off profile | **PASS, narrow** | Instance metadata reported networking disabled and an outbound IPv4 HTTP attempt failed. Full sovereign egress corpus was not run. |
| Guest file persistence | **PASS** | `/workspace/proof.txt` survived standby and restore. |
| Standby | **PASS** | Running to Standby completed in 973 ms and stopped the Firecracker process. |
| Restore | **PASS** | Standby to Running completed in 151 ms. |
| Running-source fork | **PASS** | Fork returned a running independent VM in 519 ms. Fork mutation changed its overlay while the source retained its original bytes. |
| Hardware boundary multiplicity | **PASS, mechanism only** | Source and fork ran as distinct Firecracker processes with distinct instance directories/sockets. Cross-tenant hostile probes were not run. |
| Host service privilege | **FAIL** | The API and each Firecracker process ran as root. Firecracker was invoked directly as `firecracker --api-sock ...`; no jailer was present. |
| Non-root guest execution | **FAIL** | Guest `id` returned `uid=0(root) gid=0(root)`. |
| Output ceiling | **FAIL** | A single exec returned all requested 6,291,456 bytes. The request/response protocol exposed no output ceiling or truncation fact. |
| Descendant cleanup | **FAIL** | A timed command detached `sleep 79` into a new session. After timeout, the process remained alive as PID-namespace child of PID 1 and also survived standby/restore. |
| Tenant ownership binding | **FAIL** | A JWT with a different `sub` but the same coarse `instance:read/write` scopes read and executed in the first subject's VM. |
| Idempotent create | **FAIL** | Repeating the same create request and name returned another `201` with a different instance ID. Three instances existed afterward. |
| Release TTL | **FAIL / version drift** | The submitted `ttl: 30m` produced no persisted expiry in release v0.3.0. Current main source contains newer TTL implementation, but it was not executed here. |
| SeaweedFS/FUSE | **UNPROVEN** | Not implemented or exercised. |
| Workspace watch/S3 reconciliation | **UNPROVEN** | Hypeman guest protocol has no required inotify/cursor/publication contract. |
| Exact sovereign cohort | **FAIL** | No Kata/containerd/jailer path and no single health response binding host, VMM, jailer, kernel, guest agent, image, storage and policy digests. |

The 512 MiB standby snapshot occupied approximately 513 MiB before restore.

## Reproducible operation outline

The spike used the published server binary with an isolated config/data root:

```text
verify release checksum
grant or supply host network administration privilege
start hypeman-api with default hypervisor = firecracker
POST /images for digest-pinned Alpine
POST /instances with network.enabled=false and fixed resources
WebSocket /instances/{id}/exec for identity, file and adversarial process probes
POST /instances/{id}/standby
POST /instances/{id}/restore
POST /instances/{id}/fork with from_running=true
repeat identical POST /instances to test acquisition replay
mint a second-subject scoped JWT and address the first subject's instance
```

Exact runtime secrets, host paths and process IDs are intentionally omitted.

## Cleanup state

All three test VMs were transitioned to `Stopped`; no Firecracker or Hypeman API
process remains. The uniquely named test bridge was removed. Runtime disks and
configuration were deliberately retained outside the repository because project
policy forbids file deletion without explicit owner permission.

## Interpretation against the sovereign plan

### What Hypeman proves

Hypeman is a serious lifecycle implementation, not merely a provider SDK. Its
executed Firecracker path supplied fast create, standby, restore and
running-source fork with independent writable overlays. This directly overlaps
Phase 2 and the scale plan's snapshot/fork work. It deserves evaluation as a
single-host VMM lifecycle substrate.

### What stock Hypeman does not satisfy

Stock v0.3.0 cannot be admitted for public multi-tenant traffic. Root/unjailed
Firecracker, root guest exec, coarse cross-instance API authority, unbounded
output, surviving descendants and non-idempotent create violate explicit M0 and
Phase-4 requirements. SeaweedFS namespaces, live event reconciliation,
publication safety, accepted-effect receipts, durable nonce/binding authority,
pin/drain and cleanup debt remain Boring-owned work.

### Vehicle decision

The executed result does **not** justify replacing the ratified
`containerd -> Kata -> Firecracker` M0 vehicle. It does justify a bounded
follow-up comparison rather than dismissing Hypeman:

1. estimate and prototype non-root service + Firecracker jailer/equivalent;
2. add fixed server-owned profiles and exact cohort attestation;
3. replace/extend the guest agent with bounded non-root execution and full
   process-tree cleanup;
4. keep Boring's management gateway, effect ledger and SeaweedFS data plane;
5. rerun the two-tenant and 11-hostile-probe qualification suite.

If those changes require a deep long-lived fork, keep Kata for M0 and revisit
Hypeman's VMM/snapshot packages during sovereign scale v2.1. If they are narrow
and maintainable, changing the frozen vehicle requires an explicit owner ruling
before implementation.

## Honest conclusion

**Mechanism feasibility: PASS. Sovereign admission: FAIL.**

Hypeman materially de-risks the lifecycle and snapshot/fork mechanics, but stock
Hypeman is not a safe replacement for the M0 vehicle or Phase-4 daemon. The
highest-value next action is a jailer/non-root hardening delta spike, not a
production provider adapter.
