# Blaxel sandbox provider spike

Date: 2026-08-12  
Branch: `spike/blaxel-sandbox`  
Base: `origin/main` at `f25d9d8e2200ae985bcda9562dce8bbb367827a6`  
SDK: `@blaxel/core` 0.3.11

## Verdict

| Question | Result |
| --- | --- |
| Create → exec → filesystem → destroy | **Yes.** One 1 GiB sandbox was created, ran commands, wrote/read/listed `/workspace/blaxel-spike.txt`, resumed after an idle wait, and was deleted successfully. |
| Create latency | **1,560.0 ms** end-to-end through `SandboxInstance.create()`. |
| First operation after idle | **409.4 ms** end-to-end after closing SDK connections and waiting 20 seconds; the inner exec request was 279.5 ms. This is an application-observed wake path, not a pure hypervisor-resume measurement. |
| Isolation | **KVM-backed VM environment; Firecracker unconfirmed.** Guest evidence strongly supports a hardware-isolated microVM and contradicts a plain host-kernel container, but a one-sandbox in-guest probe cannot independently attest that the tenant boundary equals the guest rather than a nested container boundary. Blaxel documents each sandbox as a VM. |
| Agent Drive mount/S3 empirical test | **Blocked before Drive creation.** Workspace features were empty and Drive listing returned HTTP 403: `Drives feature is not enabled for this workspace`. No Drive was left behind. |
| Agent Drive plain-file/S3 semantics | **Yes by documented interface; not empirically confirmed with this workspace.** A mounted path is presented as POSIX files and the same Drive contents are exposed as ordinary S3 keys/bytes. The internal representation is undocumented. |
| Integration fit | **Good, with a thin-but-nontrivial adapter.** Exec, file I/O, native watch/search, lifecycle, snapshots, and Drive mounts exist. `stat`, `rename`, recursive `mkdir`, Boring exec cancellation/output limits, durable handle semantics, and provisioning need adapter work. |

Only one sandbox was created. The script's `finally` block deleted it; Blaxel reported successful deletion in 88.0 ms. The Drive API rejected creation, so there was no Drive to clean up. No credential was printed or written to disk.

## Reproduction

The standalone proof is [`scripts/blaxel-spike.mjs`](scripts/blaxel-spike.mjs). It creates a uniquely named sandbox with a 10-minute TTL as a cleanup backstop, exercises command and filesystem APIs, captures isolation evidence, attempts Agent Drive, waits briefly for standby, exercises the wake path, and deletes all created resources in `finally`.

Run it with credentials held only in the process environment:

```bash
bash -lc 'set -euo pipefail
export VAULT_ADDR=http://127.0.0.1:8200
vault_json=$(vault kv get -format=json secret/agent/blaxel)
export BL_API_KEY=$(jq -er ".data.data.BL_API_KEY" <<<"$vault_json")
export BL_WORKSPACE=$(jq -er ".data.data.BL_WORKSPACE" <<<"$vault_json")
unset vault_json
exec node scripts/blaxel-spike.mjs'
```

The script redacts the credential, workspace, and tenant identifiers from output. It defaults to Agent Drive's required preview region, `us-was-1`. Set `BLAXEL_SPIKE_TEST_DRIVE=0` to skip the Drive attempt.

## Empirical lifecycle and filesystem proof

Observed UTC interval: `2026-08-12T06:52:15.270Z` to `2026-08-12T06:52:40.597Z`.

| Operation | Result | Duration |
| --- | --- | ---: |
| `SandboxInstance.create()` | status `DEPLOYED` | 1,560.0 ms |
| `uname -a` | exit 0 | 469.5 ms |
| `printf 'hi\n'` | exit 0, stdout `hi` | 173.7 ms |
| mkdir + SDK write + SDK read + SDK list | exact read-back match; one 34-byte file listed | 923.0 ms |
| wait with SDK H2 connections closed | 20,000 ms | — |
| `SandboxInstance.get()` + first exec after wait | exit 0, stdout `resumed` | 409.4 ms |
| inner resume exec request | exit 0 | 279.5 ms |
| `sandbox.delete()` | success | 88.0 ms |

The written file was `/workspace/blaxel-spike.txt`; the SDK returned owner/group `root`, permissions `644`, and the exact content written. This proves the `/workspace` root required by Boring can be created and used, although Blaxel's examples commonly use `/blaxel/app` or `/app`.

Resume qualification: Blaxel documents transition to standby at approximately 15 seconds and preservation of memory, filesystem, and processes. The probe closed SDK connections and waited 20 seconds. It deliberately did not poll state because a poll can itself resume the sandbox. Therefore 409.4 ms is the externally observed first-operation latency after a standby-sized idle window, not proof that the control plane had already reported `STANDBY`, and not directly comparable to Blaxel's advertised sub-25 ms internal resume figure.

## Isolation evidence

Verdict: **the observed sandbox environment is a KVM guest, not merely a plain container sharing the physical host kernel. Firecracker specifically is not proven.** The evidence is strongly consistent with Blaxel's documented per-sandbox VM/microVM architecture, but an in-guest probe alone cannot independently attest placement or rule out an additional container boundary inside a shared KVM worker. Treat the hardware-isolation conclusion as high-confidence evidence plus the provider's architecture claim, not remote attestation.

Raw command evidence follows. Tenant-bearing kernel command-line records are omitted; the relevant kernel records below are otherwise verbatim.

```text
$ uname -a
Linux (none) 6.12.75+ #2 SMP PREEMPT_DYNAMIC Thu May 28 15:41:48 UTC 2026 x86_64 Linux

$ systemd-detect-virt
sh: systemd-detect-virt: not found
[exit 127]

$ cat /proc/cpuinfo | grep -i hypervisor
flags        : fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 syscall nx mmxext fxsr_opt pdpe1gb rdtscp lm constant_tsc rep_good nopl xtopology nonstop_tsc cpuid tsc_known_freq pni pclmulqdq ssse3 fma cx16 pcid sse4_1 sse4_2 x2apic movbe popcnt tsc_deadline_timer aes xsave avx f16c rdrand hypervisor lahf_lm cmp_legacy svm cr8_legacy abm sse4a misalignsse 3dnowprefetch osvw topoext perfctr_core ssbd ibrs ibpb stibp vmmcall fsgsbase tsc_adjust bmi1 avx2 smep bmi2 erms invpcid avx512f avx512dq rdseed adx smap avx512ifma clflushopt clwb avx512cd sha_ni avx512bw avx512vl xsaveopt xsavec xgetbv1 xsaves avx512_bf16 clzero xsaveerptr wbnoinvd arat npt lbrv nrip_save tsc_scale vmcb_clean flushbyasid pausefilter pfthreshold v_vmsave_vmload vgif vnmi avx512vbmi umip pku ospke avx512_vbmi2 gfni vaes vpclmulqdq avx512_vnni avx512_bitalg avx512_vpopcntdq rdpid fsrm flush_l1d

$ dmesg 2>/dev/null | grep -iE 'firecracker|kvm|virtio' | grep -vE '^(.*Command line:|.*Kernel command line:)' | head
[    0.000000] Hypervisor detected: KVM
[    0.000000] kvm-clock: Using msrs 4b564d01 and 4b564d00
[    0.000000] kvm-clock: using sched offset of 7521915 cycles
[    0.000003] clocksource: kvm-clock: mask: 0xffffffffffffffff max_cycles: 0x1cd42e4dffb, max_idle_ns: 881590591483 ns
[    0.007290] kvm-guest: APIC: eoi() replaced with kvm_guest_apic_eoi_write()
[    0.007337] Booting paravirtualized kernel on KVM
[    0.008233] kvm-guest: PV spinlocks disabled, single CPU
[    0.018008] clocksource: Switched to clocksource kvm-clock

$ cat /sys/class/dmi/id/product_name 2>/dev/null
[no output; exit 1]

$ hostname
(none)

$ ls /dev | grep -iE 'kvm|vsock'
vsock

$ cat /proc/1/cgroup
[no output; exit 0]

$ mount | head -40
overlay on / type overlay (rw,relatime,lowerdir=/mnt/erofs,upperdir=/mnt/tmp/upper,workdir=/mnt/tmp/work,uuid=on)
ukp-fuse on /uk/libukp type fuse (rw,sync,nosuid,nodev,noexec,noatime,user_id=0,group_id=0,allow_other)
sysfs on /sys type sysfs (rw,relatime)
proc on /proc type proc (rw,relatime)
devtmpfs on /dev type devtmpfs (rw,relatime,size=499252k,nr_inodes=124813,mode=755)
tmpfs on /dev/shm type tmpfs (rw,nosuid,noexec,relatime)
devpts on /dev/pts type devpts (rw,relatime,mode=600,ptmxmode=000)
fs0 on /run/secrets/blaxel.ai/identity type virtiofs (rw,relatime)
```

Why this is decisive:

- The guest sees a `hypervisor` CPU flag and explicit KVM boot records.
- It has its own booted Linux kernel (`6.12.75+`), KVM clock, virtual APIC behavior, vsock device, devtmpfs, and virtiofs mount.
- A plain host-kernel container does not boot its own kernel under KVM. Empty `/proc/1/cgroup` also provides no container-runtime evidence. A sufficiently privileged container nested inside a KVM guest could still observe that guest's kernel evidence, which is why this probe is not a tenant-boundary attestation.
- No captured line names Firecracker. KVM establishes the hardware boundary; it does not identify which userspace VMM launched it.

The root filesystem evidence matches [Blaxel's documented EROFS lower layer plus tmpfs writable upper layer](https://docs.blaxel.ai/Sandboxes/Overview).

## Storage, Agent Drive, and S3

### Empirical result

The script attempted to create one Agent Drive in `us-was-1` before mounting it. Creation was rejected. A follow-up read-only feature/list check returned:

```json
{
  "features": {},
  "driveList": {
    "code": 403,
    "error": "Drives feature is not enabled for this workspace"
  }
}
```

Consequently, this credential/workspace could not empirically test mount → write → direct S3 GET. This is an entitlement blocker, not an SDK or sandbox failure. Agent Drive is currently private preview and limited to `us-was-1` according to the [Agent Drive overview](https://docs.blaxel.ai/Agent-drive/Overview).

### What the official API offers

- `DriveInstance.create({ name, region: 'us-was-1' })` creates a Drive. A running sandbox hot-mounts it with `sandbox.drives.mount({ driveName, mountPath, drivePath, readOnly })`. It can be mounted read-write by multiple sandboxes; subdirectory and read-only mounts are supported.
- Drive is a distributed POSIX filesystem presented through optimized FUSE. Files under the mount persist after sandbox deletion. It differs from a Volume: a Volume is block storage, is attached at sandbox creation, is limited to one sandbox at a time, and currently cannot be detached. See [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) and [Volumes](https://docs.blaxel.ai/Sandboxes/Volumes).
- Every Drive exposes `drive.state.s3Url` as `{endpoint}/{bucket}`. Direct access uses path-style addressing and the Drive region. The docs show normal `aws s3 cp` uploads/downloads to ordinary keys.
- The documented SigV4 credentials are a **service-account API key**, where the access-key ID is the API-key record ID and the secret-access key is the raw secret. Personal API keys and OAuth credentials are not accepted for this flow. Older API keys may need rotation.
- The newer management API also offers `POST /v0/drives/{driveName}/access-token`, producing a short-lived, Drive-scoped Bearer JWT for direct S3 operations. `@blaxel/core` 0.3.11 exposes it as `createDriveAccessToken()`.
- Mount permissions can restrict workload labels, path, and read/read-write mode. However, the current docs warn that these permission rules are **not enforced for the SigV4 S3 path**: a valid service-account API key has full read-write access to every Drive in that workspace. This is an important tenant security caveat.

Plain-file verdict: **the supported interface is plain files/objects, not an opaque chunk store.** Blaxel says a file written beneath the mount is stored on that Drive and exposes the Drive's contents directly to standard S3 clients. The object key corresponds to the Drive-relative file path and S3 GET returns file bytes. The SDK's documented multipart handling for files over 5 MiB is upload transport behavior, not a different object representation. The docs do not describe the physical backend encoding, and this workspace could not perform the requested cross-interface checksum, so the verdict is documented-interface confidence rather than empirical proof.

Useful official sources:

- [Blaxel sandbox overview and lifecycle](https://docs.blaxel.ai/Sandboxes/Overview)
- [Filesystem SDK](https://docs.blaxel.ai/Sandboxes/Filesystem)
- [Agent Drive overview, mounts, S3, and auth](https://docs.blaxel.ai/Agent-drive/Overview)
- [Volumes](https://docs.blaxel.ai/Sandboxes/Volumes)
- [Official TypeScript SDK](https://github.com/blaxel-ai/sdk-typescript)
- [Official Drive integration test](https://github.com/blaxel-ai/sdk-typescript/blob/main/tests/integration/sandbox/drives.test.ts)

## Boring provider integration sketch

The prompt's Vercel workspace path has moved on current `origin/main`. The implementation now lives under `packages/boring-sandbox/src/providers/vercel-sandbox/`; the agent mode is a thin adapter. Blaxel should follow that extracted provider architecture.

### Provider matrix

Add `"blaxel"` to `SandboxProviderId`, `RuntimeModeId`, and `MODE_TO_PROVIDER` in `packages/boring-sandbox/src/shared/providerMatrix.ts`. Start conservatively with:

```ts
blaxel: {
  fs: 'readwrite',
  exec: true,
  realBash: 'unknown',
  realBinaries: true,
  networkIsolation: 'provider',
  watch: true,
  search: true,
  sourceOfTruth: 'sandbox-primary',
  provisioningSupport: false,
  providerContractVersion: PROVIDER_CONTRACT_VERSION,
  runtimeImage: 'unknown',
  hardening: 'provider',
  filesystemPersistence: 'provider',
}
```

Keep `hardening: 'provider'` despite the strong KVM evidence because the probe does not remotely attest the per-tenant boundary; promote it to `microvm` only after Blaxel supplies an architectural guarantee or attestation that the sandbox boundary is the KVM guest. Keep `networkIsolation: 'provider'` until egress/firewall behavior is qualified. Keep `realBash` unknown: the default documented image is Alpine with Node and git, but Bash was not tested or promised. Change `filesystemPersistence` to `durable` only when the provider deliberately mounts an entitled Agent Drive or Volume at `/workspace`; the base writable filesystem is RAM-backed and lifecycle-managed by Blaxel.

### Files and registration

1. Add `packages/boring-sandbox/src/providers/blaxel/` containing:
   - `createBlaxelSandboxProvider.ts`: credential/config resolution, stable sandbox naming/lookup, lifecycle, `WorkspaceSandboxPairV1`, health, invalidation, and idempotent disposal.
   - `createBlaxelSandboxWorkspace.ts`: map Blaxel filesystem/watch APIs onto Boring `Workspace`, rooted at `/workspace`.
   - `createBlaxelSandboxExec.ts`: map process execution/streaming/cancel/timeout/output limits onto Boring `Sandbox.exec`.
   - `index.ts`: public exports.
2. Put `@blaxel/core` in `packages/boring-sandbox/package.json` production dependencies, add the `./providers/blaxel` package export, and add its entry to `packages/boring-sandbox/tsup.config.ts`.
3. Extend `packages/boring-sandbox/src/shared/providerV1.ts` unions and `src/providers/static.ts`; export the provider from `src/providers/index.ts`. Update provider-matrix/static tests and README tables.
4. Add `packages/agent/src/server/runtime/modes/blaxel.ts`, using `createProviderRuntimeModeAdapter({ id: 'blaxel', ... })`, remote Bash/exec, remote-workspace filesystem mapping, and best-effort watcher readiness initially.
5. Extend the agent mode plumbing in `runtime/mode.ts`, `modes/providerAdapter.ts`, `resolveMode.ts`, `shared/config-schema.ts`, and the composition root `packages/agent/host/sandbox.ts`. Remove/update the hard-coded three-mode casts in CLI, Core, and Workspace composition code.
6. Add workspace conformance tests plus exec abort/timeout/output-cap/streaming tests, provider pair cleanup/error normalization tests, and agent config/resolve/host tests.

### Impedance mismatches and decisions

- **`stat` and `rename`:** Blaxel's high-level filesystem SDK has no direct methods. Implement them with safely quoted guest commands (`stat`, `mv`) and normalize results/errors. `ls` can help with metadata but not arbitrary path stat.
- **Recursive mkdir:** SDK `mkdir` has no recursive option. Use safely quoted `mkdir -p` when requested.
- **Binary reads:** `readBinary()` returns a Web `Blob`; convert `await blob.arrayBuffer()` to `Uint8Array`.
- **Exec contract:** Boring needs `AbortSignal`, millisecond timeout, a combined byte cap, truncation state, and byte callbacks. Blaxel takes a command string, timeout in seconds, and string callbacks. Give each command a unique process name; on abort or host timeout call `sandbox.process.kill(name)`; convert timeout units carefully; cap UTF-8 bytes across both streams.
- **Watch semantics:** Blaxel has a stronger native watch API than the Vercel synthetic watcher, but reconnect/gap behavior and rename old-path fidelity need qualification. Share one underlying watcher, deduplicate self-observed events, and emit `resync-required` when fidelity is uncertain. Advertise `fsCapability: 'best-effort'` until proven strong.
- **Path safety:** All caller paths still pass through Boring's adapter-level validation. Never concatenate unvalidated relative paths into guest shell commands.
- **Provider lifecycle:** Do not make normal pair disposal delete the persistent workspace. Use stable names or external IDs keyed by Boring workspace ID plus a handle store/TTL. Separate release/connection cleanup from explicit invalidate/destroy. The spike intentionally deletes because it is disposable.
- **Drive configuration:** `SandboxProviderCreateContextV1` has no vendor storage/mount fields. Drive name/path/read-only configuration must initially be provider construction config/environment, or the contract must grow separately. Drive entitlement and same-region placement must fail with a stable, actionable code.
- **Provisioning:** Leave `provisioningSupport: false` in the stub. Claiming true requires `SandboxProvisioningOperationsV1`, including binary-safe host template upload, runtime cache paths, and install behavior. Blaxel's default base image does not promise Bash, Python, or `uv`.
- **Durability/source of truth:** Without an attached Drive/Volume, Blaxel preserves memory/filesystem through standby but sandbox deletion removes data. Decide whether the production Boring workspace is sandbox-primary ephemeral/provider-managed, Drive-primary durable, or mirrored to external storage before implementing handle eviction.
- **Errors and secrets:** Map auth, feature-disabled, expired/not-found, timeout, and cancellation failures to stable Boring codes. Sanitize Blaxel SDK error objects and guest boot command lines; they can contain workspace/account metadata. Never log `BL_API_KEY`.

## Blockers and next decision

The compute integration is technically viable and a KVM-backed environment is empirically supported. Independent proof that the tenant boundary is exactly the VM would require provider attestation or cross-tenant/platform-level testing beyond this one-sandbox probe. The only blocker to completing the requested storage proof is enabling Agent Drive private preview for the credential's workspace in `us-was-1` (and, for SigV4 specifically, providing a current service-account API-key record ID plus raw secret). Once enabled, rerun the existing script; it already attempts create → hot mount → mounted write/read → Drive-scoped Bearer S3 GET → cleanup.

Before a production provider, choose the durability model and lifecycle ownership. That decision controls whether `/workspace` is the sandbox's provider-persistent RAM snapshot, a one-sandbox Volume, or a shared Agent Drive—and whether `dispose()` releases a binding or destroys data.
