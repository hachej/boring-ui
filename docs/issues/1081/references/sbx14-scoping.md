# SBX1.4 / SBX1.5 scoping — GO/NO-GO input (2026-08-10)

> **Superseded execution scope:** this document sizes the prior runsc worker.
> The controlling sovereign architecture is in `../sandbox-sovereign-design.md`.
> Keep this file only as historical evidence about the shipped runsc backend.

Sources: bead `wt-391-forward-6gd.4`/`.5` as amended by PR #918 (merged, `bb6e328d3`), the
d3a1bd393 V0-retirement gate, issue #1167 audit hand-offs, merged slices 1-3 code at
origin/main `637999391` (worktree `.worktrees/sbx13-proof`), and today's proof run
(`sbx13-proof.md`, same scratchpad dir).

Size labels: S = ≤1 day / one small PR; M = 2-4 days / one substantial PR; L = ~1 week or
needs splitting.

---

## 1. What SBX1.4 concretely is

Bead text (post-#918): "wire and freeze the minimal VPS daemon and remote pair end to end"
— server-only worker entrypoint; authenticated handshake/evidence/image/bundle checks;
lifecycle/fs/exec/renew/events endpoints; retire legacy V0 remote-worker values
(d3a1bd393 gate); freeze the exact daemon/provider/workload cohort. Plus the two #918
deferred security gates: **(a)** pin workload/helper image to qualified evidence before
`startContainer`; **(b)** persist/boot-epoch the capability nonce so replay can't survive
worker restart or a second process.

Today (delta framing): slices 1-3 already give the whole V1 client side + runsc runtime
**in-process**. `createRemoteWorkerProvider.ts` + `protocolClient.ts` + `pairProxies.ts`
speak the wire protocol; `sessionRuntime.ts` runs real runsc containers;
`singleUseNonceStore.ts` and `bindingRegistry.ts` are **in-memory Maps** (volatile —
that volatility is currently the only thing making post-restart replay fail-closed, per
#1167). What does not exist: any standalone daemon process serving those endpoints over
the network, any persistence, and any check that the image digest handed to
`dockerArgv.ts` matches qualified evidence.

### PR-sized slices

| # | Slice | Size | Notes |
| --- | --- | --- | --- |
| 1.4-A | **Worker daemon entrypoint**: server-only HTTP/SSE process wrapping the existing runtime behind the V1 endpoints (create/fs/exec/renew/events/delete), per-box capability auth handshake, stable errors, systemd-friendly startup | **L** | The core of the bead. Protocol schemas, auth, and runtime all exist; this is wiring + a real process boundary + protocol-conformance tests against the real daemon (lost-delete/404/hard-expiry per bead proof line). Splittable into A1 (daemon skeleton + create/exec) and A2 (fs/events/renew + conformance suite), each M. |
| 1.4-B | **Image pinning gate (#918 gate a)**: before `startContainer` (`sessionRuntime.ts:656`), require workload + helper image digests to equal the digests bound in the admitted qualification evidence/bundle (`fleetAdmission.ts` / `qualificationBundle.ts` already model these fields); fail closed with a stable code | **S-M** | Attach point and evidence schema exist; this is a comparison + plumbing the admitted bundle into the runtime config + negatives. |
| 1.4-C | **Persistent nonce store + boot-epoch (#918 gate b)**: durable single-use nonce set surviving restart, with boot-epoch fencing against a second concurrent process; **must land in the same PR as any binding-record/receipt persistence** and carry the regression test "consumed nonce survives simulated restart" (#1167 constraint 2, hard) | **M** | Today `singleUseNonceStore.ts` (2.1K, in-memory) + `bindingRegistry.ts` (17.5K, in-memory). If binding records stay volatile, only nonces need disk (append-only file or sqlite on the worker volume) — simplest honest shape. Atomicity constraint means: never persist bindings in a separate later PR without this. |
| 1.4-D | **Per-tenant nonce sub-budget** (#1167 finding 1, LOW — cross-tenant availability DoS, not confinement) | **S** | Partition the accepted-nonce budget by tenant/workspace inside the store. Independent of 1.4-C's storage medium but cheapest done with it. |
| 1.4-E | **Retire legacy V0 remote-worker values** (d3a1bd393 gate: "no old runtime-value owner") | **S-M** | Relocate/delete Agent-owned pre-extraction values; mostly mechanical + invariant test. |
| 1.4-F | **Cohort freeze**: pack exact daemon/provider/workload artifact digests for qualification input | **S** | Build/pack script + digest manifest; consumed by 1.5. |

**SBX1.4 total: ~2.5-3 engineer-weeks** (L + M + M + 3×S), naturally 5-6 PRs.

## 2. What SBX1.5 is (coarser grain)

Bead text + #918 appended gate: build the cohort-specific immutable bundle from frozen .4
artifacts; **admitting real-runsc evidence** — openat2 workspace path enforcement,
project-quota disk/inode fill + reserve, fork-bomb/PID-limit, output-flood,
orphan-cleanup-failure — on a cohort where runsc `openat2` works; candidate-box gate;
startup receipt/freshness; drift policy; runbook; escape-canary; critical-CVE
fence/stop/patch/requalify game day.

| Chunk | Size | Notes |
| --- | --- | --- |
| Admitting evidence run + the 5 new adversarial probes on a qualified box | **M** (code) + ops | Harness exists and already emits V3 evidence (today's run: 12 passed, non-admitting). New probes: fork-bomb/PID-limit, output-flood, orphan-cleanup-failure need writing; openat2 + quota-fill probes exist but are blocked by environment only. |
| Bundle build from frozen .4 digests + candidate-box gate + startup receipt/freshness + drift policy | **M** | `qualificationBundle.ts` (8.9K) + `fleetAdmission.ts` (6.4K) exist from SBX1.2; this binds them to real artifacts + a protected disposable CI workflow. |
| Runbook (install/register/systrap/quota/admit/drain/restore) + monitored escape-canary + critical-CVE game day (H1 15/60-min bounds) | **M-L** | Mostly ops/docs + one rehearsal; the game day is calendar time, not code. |

**SBX1.5 total: ~2 engineer-weeks + ops calendar time**, contingent on a qualified box existing.

## 3. Ops items (from today's proof report)

| Item | One-time vs recurring |
| --- | --- |
| Pin/qualify a runsc build whose profile passes the `openat2` preflight (release-20260706.0 returns ENOSYS → session admission is refusal-only today; **single biggest blocker**) | One-time per cohort; recurs on every requalification/CVE patch |
| Provision worker data volume ext4/xfs with `prjquota` | One-time per box, at provision |
| Install quota helper as preconfigured root-owned binary (proof run used the non-admitting source-checkout path) | One-time per box; recurs on helper upgrade |
| Fleet-admission evidence run (`verify-fleet-admission-evidence.mjs` / bundle) on the actual cohort — today explicitly `fleetAdmissionClaimed: false` | Recurring: every cohort change, image change, requalification |
| Real image registry + build/publish pipeline (today: throwaway localhost `registry:2`) | One-time setup; publishing recurs per release |
| EU worker box provisioning + credential-ref wiring against deployed agent | One-time per box |

## 4. Dependencies / ordering

```
runsc-openat2 pin + prjquota + helper install (ops, parallel, start NOW)
        │
1.4-A daemon ──┬── 1.4-B image pinning (needs bundle plumbing, can develop in parallel)
               ├── 1.4-C persistent nonce  ←#1167: ATOMIC with any binding persistence,
               │       └ 1.4-D per-tenant sub-budget      + restart-survival regression test
               ├── 1.4-E V0 retirement (independent, any time)
               └── 1.4-F cohort freeze (last; needs A-C merged)
                        │
1.5 admitting evidence run (needs qualified box + frozen cohort)
        └── bundle/candidate gate → runbook/canary/CVE game day
                        │
1.6 canary + default flip (out of scope here)
```

Hard ordering rules:
- **#1167 atomicity**: no PR may persist binding records/receipts unless the same PR
  persists nonces with the restart regression test. Cheapest compliance: persist nonces
  only (1.4-C), leave bindings volatile.
- 1.4-B before any real tenant traffic — image pinning is part of fail-closed posture.
- 1.5 evidence run cannot start before the ops trio (openat2 runsc, prjquota, root
  helper) — that path is pure environment work and is today's critical path.

## 5. Recommendation — minimal path to "seneca prod agent exec runs on an EU runsc worker"

**GO, with a narrowed 1.4.** Critical path:

1. **Now, in parallel (ops, ~1-2 days + qualification iteration):** provision one EU box —
   prjquota volume, candidate runsc release with working `openat2` (verify with the
   existing preflight), root-owned quota helper, small private registry.
2. **1.4-A daemon** (L, split into two M PRs) — the only genuinely new engineering.
3. **1.4-C persistent nonce + boot-epoch** (M) with the #1167 regression test.
4. **1.4-B image pinning gate** (S-M).
5. **1.4-F freeze + minimal 1.5:** one admitting evidence run on the EU box binding the
   frozen digests, wired through `fleetAdmission.ts` so the provider only admits that box.
6. Point seneca's agent config at the remote-worker provider for a single canary workspace.

**Total estimate: ~3-4 engineer-weeks of PRs + ~1 week ops/qualification wall-clock**,
overlappable to roughly 3-4 calendar weeks for one person.

**Deferrable WITHOUT weakening fail-closed posture** (each stays fail-closed because the
admission gate refuses whatever is missing):
- 1.4-D per-tenant nonce sub-budget — LOW, availability-only; co-located-tenant DoS is moot
  for a single-tenant seneca canary.
- 1.4-E V0 retirement — hygiene, no security edge.
- The three new 1.5 adversarial probes (fork-bomb/output-flood/orphan-cleanup) — PID limits
  and output caps are already enforced by the runtime; the probes are evidence, not
  enforcement. Fine to defer to full 1.5 as long as the run stays labeled non-exhaustive.
- Runbook polish, escape-canary monitoring, CVE game day — required before multi-tenant
  fleet admission (1.5 exit) and before the 1.6 default flip, not before a single
  owner-approved canary box.

**Not deferrable:** daemon auth handshake, image-pinning gate, persistent nonce
(+atomicity rule), the admitting openat2/prjquota evidence run, and digest-bound
single-box admission. Skipping any of these either opens replay-after-restart or means
admitting a box on unproven evidence — exactly what the whole chain exists to prevent.
