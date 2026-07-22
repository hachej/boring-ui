> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# D1-006a EU runtime-profile qualification

Date: 2026-07-13  
Bead: `wt-391-forward-ytq`  
Status: hostile isolation suite passed; D1-006 remains blocked on the owner's privileged-execution-model decision.

## Qualified profile

The real EU host ran two concurrent OCI bundles with the same read-only BusyBox
base rootfs and distinct workspace/secret mounts, processes, PID namespaces,
cgroups, and network namespaces. The runtime was the exact content-addressed
`runsc release-20260706.0` binary under `sudo`, with `systrap`, non-root workload
UID/GID `65532:65532`, and no container capabilities.

Each sandbox received a distinct veth namespace and `/30`. Neither namespace
had a bridge or default route. Sandbox B served its positive-control endpoint
on its assigned address; sandbox A could not reach that address. This proves
privileged veth setup and cross-workspace denial for this exact profile. It does
not prove or claim a general production egress policy.

The accepted redacted artifact is
[`evidence/D1-006A-EU-RUNTIME-EVIDENCE.json`](evidence/D1-006A-EU-RUNTIME-EVIDENCE.json):

- profile digest: `sha256:8833d69812d36e693eaa9cb12cb2d4b0f8091be9cf166979737fa4b091f29692`
- test-suite digest: `sha256:3e415af8594d0b8fb93439b65a6cddb1dd51234da1eaf2695f8348cc466f716f`
- evidence digest: `sha256:f67c2cf1848f1304adfd4ee34c76961762cdc505f2971ce2b849de5b2765d1a6`

## Reproduction

Build the package, then run the suite with an owner-approved absolute path to
the candidate binary. The path is an input only and is never serialized:

```bash
pnpm --filter @hachej/boring-sandbox build
sudo -n env BORING_RUNSC_BINARY=<approved-absolute-runsc-path> \
  node packages/boring-sandbox/scripts/qualify-runsc-isolation.mjs
```

The harness copies those exact bytes to a root-owned mode-`0555` ephemeral
execution path, compiles the checked-in hostile probe, emits only the redacted
JSON envelope, and removes its own runtime state. `testSuiteDigest` binds the
harness source, hostile-probe source and compiled bytes, evidence schema and
implementation sources, and the compiled provider entry that executes them.

## Probe result

| Probe | Real outcome |
| --- | --- |
| Positive controls | Both own markers readable; A's assigned-IP endpoint reachable from A before and after attacks; B-only canary and B endpoint readable/reachable from B before attacks. |
| Sibling filesystem | Fixed sibling path and `/workspace/../sibling-workspace/marker` traversal alias absent from A. |
| `/proc` / PID | B's host runtime PID absent from A's `/proc`. |
| Signal / ptrace | A could neither signal nor ptrace B's host runtime PID. |
| Mount / device | A could not mount tmpfs or open `/dev/kvm` or `/dev/mem`. |
| Process escape | A could not open the host canary through `/proc/1/root`. |
| Cross-workspace network | B reached its assigned-IP endpoint; A's request to the same B address failed. |
| Secret | B read its B-only canary; A could not see the secret path. |
| Resource ceilings | Each live runsc sandbox PID was a member of its exact cgroup; both cgroups matched CPU `50000 100000`, memory `134217728`, and PID `64` limits. This proves applied membership/configuration, not a load-stress claim. |
| Post-attack controls | B remained running; its endpoint and canary remained readable. |
| Teardown | Both containers, cgroups, netns, veths, and the ephemeral runtime root were absent before evidence emission. No nftables object was created by this profile. |

## Verification and redaction

The harness verifies the fresh envelope against the freshly observed profile
and suite digest before emitting it. Public verifier tests reject runtime-binary,
platform, privilege-model, host-policy, and test-suite drift. Exact-key parsing
rejects missing or unknown fields without depending on object insertion order.

The host-policy digest binds the active LSM set, AppArmor state, ptrace scope,
effective execution label, user-namespace policy, seccomp actions, IPv4
forwarding, cgroup controllers, and the exact network/runtime execution policy
without emitting those raw facts. The qualification process's effective
AppArmor label was `unconfined`. A production-confined launcher is a material
profile change and requires requalification; this evidence does not claim that
an AppArmor profile constrained the privileged runtime.

The harness also requires a live `sudo` parent, an effective UID of `0`, and
bounded nonzero numeric `SUDO_UID`/`SUDO_GID` values. Direct invocation from a
root shell is rejected instead of being mislabeled as the qualified sudo entry.
The JSON contains no command output, runtime source path, temp/cgroup/netns path,
host PID, canary value, or secret. Hostile command failures are reduced to a
stable error code plus a bounded stage label; runsc stdout/stderr is not emitted.

The earlier structural spike remains relevant: rootless runsc failed while
creating the required veth, while the sudo path was proven. This qualification
now exercises that sudo/veth boundary, but it does not make the commercial or
privilege-risk decision for the owner.

## OPTIONS

1. Approve the evidenced `sudo-root`/systrap profile for D1 v1, conditioned on installing the exact approved runsc digest in a root-owned non-writable production path, exposing only a narrowly scoped launcher, and requiring requalification on any bound profile drift.
2. Keep D1-006 blocked and select another EU runtime profile that proves the same sibling filesystem, process, network, secret, resource, and teardown properties without the sudo-root boundary. Rootless runsc with the required veth is not currently such a profile.

## RECOMMENDATION

Approve option 1 for the v1 EU exit with the stated installation and drift controls, because it is the only currently evidenced profile and keeps the production boundary explicit. Julien remains the decision owner; this document records evidence and a recommendation, not an approval.
