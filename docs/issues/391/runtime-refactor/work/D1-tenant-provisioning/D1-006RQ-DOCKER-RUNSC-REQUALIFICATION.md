> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# D1-006rq docker-runsc formal requalification

Date: 2026-07-14
Bead: `wt-391-forward-iku`
Status: hostile isolation suite passed and cold-start latency measured for the
owner-approved `docker run --runtime=runsc` v1 production profile. This
supersedes the direct `sudo`/OCI-bundle profile (`D1-006A`, bead ytq) as the
runtime the D1-006 consumer should adopt; the ytq evidence remains valid as the
historical direct-runsc attestation.

## Why a new profile

`D1-006A` qualified `runsc` invoked directly via OCI bundles under `sudo`
(`privilegeModel: sudo-root`, self-built veth namespaces, self-managed cgroup
paths). The owner has approved **docker-runsc** instead: `docker run
--runtime=runsc`, where `runsc` is registered with the host Docker daemon and
runs **unprivileged** (current user in the `docker` group, no `sudo`).
`docker run --rm --runtime=runsc alpine uname -r` prints `4.19.0-gvisor`, the
gVisor sentinel kernel, proving real gVisor interception.

This is a materially different runtime profile (different launcher, privilege
model, and network topology), so it is attested under its own schema rather than
being relabelled onto the `sudo-root` shape. See "Schema decision" below.

## Qualified profile

The real host ran two concurrent containers through docker with the same
content-addressed image (`alpine:3.20` base + the host's static BusyBox baked in
as `/bin/busybox-full` + the checked-in hostile probe as `/bin/isolation-probe`)
and distinct workspace/secret mounts, PID namespaces, cgroups, and networks. Per
container: `--runtime=runsc`, `--user 65532:65532` (non-root workload),
`--read-only` root, `--cap-drop ALL`, `--security-opt no-new-privileges`, and
docker-translated resource ceilings `--cpus 0.5` / `--memory 128m` /
`--pids-limit 64` (effective cgroup v2 `cpu.max 50000 100000`, `memory.max
134217728`, `pids.max 64`).

Each sandbox joined its own `docker network create --internal` bridge on a
distinct `/30` (`10.253.240.0/30`, `10.253.241.0/30`). `--internal` removes the
default route/gateway and the two networks have no interconnection. Sandbox B
served its positive-control endpoint on its assigned address; sandbox A could
not reach that address. This proves docker-managed network isolation and
cross-workspace denial for this exact profile. It does not prove or claim a
general production egress policy.

`kernelRelease` records the sandbox-observed kernel `4.19.0-gvisor` (not the host
kernel), binding proof of gVisor interception into the profile digest.

The accepted redacted artifact is
[`evidence/D1-006RQ-DOCKER-RUNSC-EVIDENCE.json`](evidence/D1-006RQ-DOCKER-RUNSC-EVIDENCE.json)
(schema v2):

- profile digest: `sha256:9dd50bc9f3c80f9c0315ddfc6197ca3ff58d0ff1af4076f8f64e90b2e39beba7`
- test-suite digest: `sha256:26dcfa77604abcfbab3680f189094d246da6a556e49152d442f889d2363ef74f`
- evidence digest: `sha256:a0976f0e417f02cae595a31436bd6412e67fddd48e8c4de34636db554469109d`

## Reproduction

Build the package, then run the docker-runsc suite (no `sudo` required for the
suite itself; `sudo` is only used by the latency harness to drop page cache):

```bash
pnpm --filter @hachej/boring-sandbox build
# optional cold-start latency, attached to the content-addressed evidence:
node packages/boring-sandbox/scripts/measure-cold-start-latency.mjs \
  --out=docs/issues/391/runtime-refactor/work/D1-tenant-provisioning/evidence/D1-006RQ-DOCKER-RUNSC-LATENCY.json
node packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs \
  --latency=docs/issues/391/runtime-refactor/work/D1-tenant-provisioning/evidence/D1-006RQ-DOCKER-RUNSC-LATENCY.json
```

The harness builds an ephemeral image, creates two `--internal` networks, starts
the two containers, runs all 11 hostile probes, tears everything down (containers,
networks, image, temp dir), and emits only the redacted JSON envelope.
`testSuiteDigest` binds the harness source, the hostile-probe source, the
evidence schema and implementation sources, and the compiled provider entry that
executes them. The BusyBox path is an input only and is never serialized; only
its content digest is.

**The runtime binary and platform are observed, not assumed.** The harness reads
docker's registered runsc runtime from `docker info --format '{{json
.Runtimes}}'`: it digests the binary at the registered `Path` (the exact bytes
docker executes for `--runtime=runsc`) into `runtimeBinaryDigest`, and it reads
`platformMode` from the runtime's registered `--platform=…` arg rather than
hardcoding `systrap`. If `BORING_RUNSC_BINARY` is set it must equal the
registered path or the run aborts, and if the platform is not observable the run
aborts. This closes the drift blind spot where the evidence could attest a
platform or a coincidentally-same host file that is not what production runs.

## Probe result

All 11 probes were executed for real against docker-runsc on this host and
passed. Nothing was skipped.

| Probe | Real outcome | Result |
| --- | --- | --- |
| Positive controls | Both own workspace markers readable; A reached its own assigned-IP endpoint before and after attacks; B's B-only canary and B endpoint readable/reachable from B. | passed |
| `sibling-filesystem-traversal` | Fixed sibling path and `/workspace/../sibling-workspace/marker` traversal alias absent from A. | passed |
| `proc-pid-enumeration` | B's host `docker inspect` sandbox PID absent from A's `/proc`. | passed |
| `cross-sandbox-signal` | A could not `kill(0)`/`SIGTERM` B's host sandbox PID. | passed |
| `cross-sandbox-ptrace` | A could not `PTRACE_ATTACH` B's host sandbox PID. | passed |
| `mount-access` | A could not mount tmpfs inside the sandbox. | passed |
| `device-access` | A could not open `/dev/kvm` or `/dev/mem`. | passed |
| `process-escape` | A could not open the host canary through `/proc/1/root`. | passed |
| `cross-workspace-network` | B reached its assigned-IP endpoint; A's request to B's address failed (`Network is unreachable`). | passed |
| `secret-access` | B read its B-only canary; A had no `/run/secrets` mount and could not see the secret path. | passed |
| `resource-ceilings` | Each live sandbox host PID was a member of its exact docker cgroup scope (`system.slice/docker-<id>.scope`); both scopes matched CPU `50000 100000`, memory `134217728`, and PID `64`. This proves applied membership/configuration, not a load-stress claim. | passed |
| `teardown` | Both containers, their docker networks, the cgroup scopes, and the ephemeral build/image artifacts were absent before evidence emission. | passed |

## Cold-start latency

Wall-clock latency from `docker run` invocation to container exit, workload
`true` (measures engine + sandbox startup, not workload). Image `node:20-slim`
(`sha256:9da6b4e352d0d5c94963eba1832408f5b7b08839cd8be9b6610c05de5118c704`) — a
representative real agent base image. n = 20 per cell, 3 unrecorded warmups per
runtime. "cold" drops the host page cache
(`sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'`) at the head of the batch;
per-run cache drop for a still-resident image is largely theoretical (the kernel
repopulates cache the moment the image bytes are read), so the cold cell is an
honest batch-head-drop measurement, not a claim of a fully cold filesystem per
run. Raw sample arrays are in
[`evidence/D1-006RQ-DOCKER-RUNSC-LATENCY.json`](evidence/D1-006RQ-DOCKER-RUNSC-LATENCY.json).

| Runtime | Cache | n | p50 (ms) | p95 (ms) | mean | min | max | stdev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runsc | warm | 20 | 737.57 | 809.02 | 742.43 | 657.68 | 850.95 | 45.25 |
| runsc | cold | 20 | 754.38 | 854.19 | 753.02 | 631.30 | 1054.37 | 88.47 |
| runc | warm | 20 | 468.58 | 574.13 | 481.41 | 356.25 | 596.05 | 60.87 |
| runc | cold | 20 | 471.98 | 566.42 | 468.56 | 394.50 | 634.07 | 62.58 |

gVisor adds roughly ~270 ms p50 / ~235 ms p95 over runc for this image on this
host (about 1.6x). Cold vs warm is within noise, consistent with the resident-image
caveat above. These are this-host numbers, not a capacity or SLA claim.

## Schema decision

The existing `RuntimeIsolationProfileV1` / `RuntimeIsolationEvidenceV1`
(`schemaVersion: 1`, `domain …:v1`) is a strict closed schema whose literals
(`privilegeModel: "sudo-root"`, `networkPolicy: "isolated-veth-no-default-route"`)
encode the direct-runsc profile. Rather than loosen those literals (which would
weaken the ytq attestation or silently accept a different profile), this bead
adds an **additive** sibling schema, leaving v1 untouched:

- `RuntimeIsolationProfileV2` / `RuntimeIsolationEvidenceV2`
  (`schemaVersion: 2`, `domain …:v2`) with `launcher: "docker-runsc"`,
  `privilegeModel: "docker-runsc-nonroot"`,
  `networkPolicy: "isolated-internal-bridge-no-default-route"`.
- `createDockerRuntimeIsolationEvidence` / `verifyDockerRuntimeIsolationEvidence`
  mirror the v1 create/verify discipline (content-addressed, frozen, redacted,
  round-trip verified, exact-key parsing, order-independent).
- Probe outcomes in v2 are `{ status: "passed" }` or
  `{ status: "unproven", reason }` so an environment that genuinely cannot
  exercise a probe is recorded honestly instead of being forced to `passed`. On
  this host every probe passed, so the committed evidence has no `unproven` entries.
- An optional `coldStartLatency` section (p50/p95/mean/min/max/stdev per
  `{runtime}×{cacheState}` cell, plus image content digest, command, and
  methodology) is bound into the evidence digest.

The v1 evidence file (`evidence/D1-006A-EU-RUNTIME-EVIDENCE.json`) still parses
and verifies against the unchanged v1 parser; both schemas coexist. A future
D1-006 (3vt) consumer should target `RuntimeIsolationEvidenceV2` for the
docker-runsc production runtime.

## Integrity, not authenticity

This evidence is **content-addressed** (three SHA-256 digests over canonical
JSON: profile, test-suite, and whole-envelope), not **signed**. There is no
cryptographic signature and no key. The digests give integrity against
accidental corruption or drift; they give **no** authenticity guarantee against
a deliberately forged blob — anyone can recompute all three digests over a
fabricated envelope. Do not read "digest" as "signature".

**Consumer requirement (binding on D1-006 / 3vt):** the D1-006 consumer MUST
re-run this harness live — re-observe the registered docker-runsc runtime,
re-execute the probes, recompute `testSuiteDigest`, and verify the fresh
envelope — as its qualification gate. It MUST NOT trust the committed
`D1-006RQ-DOCKER-RUNSC-EVIDENCE.json` blob statically as proof of isolation. The
committed blob is a reproducibility record and a schema example, not a
tamper-proof credential; only a live re-run against the real registered runtime
is trustworthy.

## Verification and redaction

The harness verifies the fresh envelope against the freshly observed profile and
suite digest before emitting it. Public verifier tests
(`isolationEvidenceDocker.test.ts`) reject runtime-binary, runtime-version,
kernel, provider-config, host-policy, and test-suite drift, plus
launcher/privilege/network/schema substitutions, malformed latency samples, and
unproven probes missing a reason. Exact-key parsing rejects missing or unknown
fields without depending on object insertion order.

The host-policy digest binds the cgroup controllers, launcher privilege model,
docker-runsc registration, the observed registered runtime platform, network
policy/subnets, IPv4 forwarding, active LSM
set, AppArmor state, ptrace scope, and seccomp actions without emitting those raw
facts. The JSON contains no command output, runtime source path, temp/cgroup
path, host PID, canary value, or secret. Hostile command failures are reduced to
a stable error code plus a bounded stage label.

Unlike the ytq profile, this profile is **unprivileged**: the suite needs no
`sudo` and no root effective UID. The only privileged operation in the whole
requalification is the latency harness dropping page cache, which is not part of
the isolation attestation.

## OPTIONS

1. Approve the evidenced `docker-runsc-nonroot`/systrap profile for D1 v1,
   conditioned on installing the exact approved `runsc` digest as the registered
   docker runtime, pinning the base image digest, and requiring requalification
   on any bound profile drift.
2. Keep D1-006 on the direct `sudo-root` profile from ytq. That profile is still
   valid but carries the sudo/root privilege boundary that docker-runsc removes.

## RECOMMENDATION

Approve option 1 for the v1 exit: docker-runsc proves the same sibling
filesystem, process, network, secret, resource, and teardown isolation
properties as the direct profile while removing the sudo-root privilege boundary,
at a measured ~1.6x cold-start cost over runc that is acceptable for sandboxed
agent workloads. Julien remains the decision owner; this document records
evidence and a recommendation, not an approval.
