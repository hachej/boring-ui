---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: deferred-triggered
updated: 2026-08-11
revision: r2-lean-v1
track: owner
---

# gh-1081 — SBX1.4 v2 hardening plan (deferred, triggered)

> Companion to [`plan-sbx14.md`](plan-sbx14.md) (LEAN V1). This document holds the
> machinery the thermo simplification review (Fable) cut from v1, **not as a junk
> drawer** but as a real, triggered v2 plan: each item states *what it is*, *why
> v1 does not need it*, and an explicit **RE-ENTRY TRIGGER** — the concrete
> condition that turns it back on. Nothing here is speculative gold-plating; every
> item was fully specified in plan r1 and is deferred only because v1's threat
> model (single-tenant Seneca, Tailscale-only ingress, client-is-issuer,
> host-root-equivalent secret) makes it defend a boundary that does not yet exist.

## Why these are deferred, not deleted

v1's key structural fact: **Seneca holds the static secret and mints its own
capabilities client-side** (architecture §3). So in v1 the capability/nonce/
receipt edifice is cryptographically equivalent to `Authorization: Bearer
<secret>`: replaying a capability requires either capturing it on the
WireGuard-encrypted tailnet/loopback (attacker already host-root-equivalent per
the plan's own threat model) or holding the secret (game over). Durable,
transactional, per-tenant-budgeted, dual-secret, rate-limited machinery defends
attacker classes that **cannot exist until the public-opening gate** or a second
tenant/operator. Each item below re-enters exactly when its defended boundary
becomes real.

Cross-link map (v1 §ref ↔ v2 item):

| v1 cut (plan-sbx14.md) | v2 item below | Re-entry trigger |
| --- | --- | --- |
| In-memory nonces; #1167 N/A (Decision 5, "Why in-memory nonces are correct") | [1. Persistent nonce store + #1167 atomicity](#1-persistent-nonce-store--1167-atomicity) | Any durable binding/record persistence **OR** pre-multi-tenant |
| No per-workspace sub-budget (non-goals) | [2. Per-workspace nonce sub-budget](#2-per-workspace-nonce-sub-budget) | 2nd tenant |
| Coordinated-restart rotation (Decision 8) | [3. Dual-secret zero-downtime rotation](#3-dual-secret-zero-downtime-rotation) | Multi-operator / compliance policy |
| No `authRateLimiter.ts` (S1-lite) | [4. Auth rate limiter](#4-auth-rate-limiter) | Any non-Tailscale / public ingress |
| S4-lite manual transcript (no 4-phase formalism) | [5. S3b evidence formalism + fleet-admission automation](#5-s3b-evidence-formalism--fleet-admission-automation) | Public-opening gate / SBX1.5 |
| Single worker URL, no bucket map (S5) | [6. Multi-box placement scheduler](#6-multi-box-placement-scheduler) | Box #2 |
| Requalify-on-change (S5) | [7. Requalification automation](#7-requalification-automation) | Fleet scale |

---

## 1. Persistent nonce store + #1167 atomicity

**What it is.** A production SQLite consumed-nonce store
(`persistentNonceStore.ts`, `/var/lib/boring-worker/security/nonces.sqlite`,
root-owned `0600`) using Node's built-in `node:sqlite` (`DatabaseSync`), replacing
the in-memory `SingleUseNonceStoreV1`. Global-unique nonce PRIMARY KEY as the
replay fence; `PRAGMA journal_mode=WAL` + `synchronous=FULL` asserted at startup;
`busy_timeout` set via `DatabaseSync`, exceed => fail closed; local-fs-only (NFS/
SMB/network block forbidden, `--check` asserts the resolved path + filesystem
type). `consume(nonce, workspaceId, expiresAtMs, nowMs)` runs one `BEGIN
IMMEDIATE` transaction — evict expired, insert (PRIMARY KEY collision = replay),
enforce budgets, commit — so two processes/connections can never both return
`accepted`. This replaces #918 gate (b)'s boot-epoch column with transactional
cross-connection uniqueness. Node pinned `>=22.19.0` with flagless `DatabaseSync`
proven on CI Node and the VM.

**#1167 atomicity.** The day the daemon persists **any** durable state (binding
records or receipts), that persistence and the nonce store must be committed in
**one atomic change** with the restart regression retained — nonce and binding
state share one transaction, and the change cannot be split across PRs. In v1
this is N/A because nothing persists (nothing to make atomic).

**Why v1 doesn't need it.** Durability defends replay of a *captured* capability
across a daemon restart. The only party who can capture one is already on the
encrypted tailnet/loopback (host-root-equivalent) or holds the secret. Single
tenant + client-is-issuer means nonce durability protects nothing real; the
in-memory store dying on restart is fail-closed by construction.

**RE-ENTRY TRIGGER:** **any durable binding/record persistence** (which drags in
#1167 atomicity as one change) **OR the pre-multi-tenant step** (the first move
off single-tenant Seneca, where a captured capability from one tenant must not
survive to replay). Ships with both regressions green: "consumed nonce survives
simulated restart" and concurrent-connection "exactly one accepted, one replay".

**Acceptance when triggered.**

```sql
-- /var/lib/boring-worker/security/nonces.sqlite  (root-owned, 0600)
PRAGMA journal_mode = WAL;      -- asserted 'wal' at startup or fail
PRAGMA synchronous  = FULL;
PRAGMA busy_timeout = <bounded ms>;  -- exceed => fail closed
CREATE TABLE IF NOT EXISTS consumed_nonces (
  nonce         TEXT PRIMARY KEY,      -- replay fence
  workspace_id  TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nonce_ws     ON consumed_nonces(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nonce_expiry ON consumed_nonces(expires_at_ms);
```

Tests: consumed nonce survives simulated restart (reopen same DB → replay);
concurrent independent connections consuming one nonce yield exactly one
`accepted` + one `replay`; open/migrate before listen (unreadable/corrupt/locked
beyond busy-timeout/unmigratable prevents startup; no volatile fallback). Files:
new `persistentNonceStore.ts`; extend
`src/providers/remote-worker/singleUseNonceStore.ts` to the four-arg
`consume(...)` port (in-memory stays as the unit-test double); add the
synchronous injectable nonce-store option to
`RemoteWorkerSandboxBindingRegistryOptionsV1` (line 53), constructed inline today
at line 204 (narrow injection seam). S4 `--check` gains the resolved-DB-path +
filesystem-type assertion.

**E2B grounding.** E2B persists sandbox records in Postgres because its control
plane survives restarts across a fleet; v1 recreates sessions on one box, so the
*only* durable state is the replay nonce (e2b-internals §5, §8 "Postgres or even
SQLite to start"; §5 "Redis-tier state can start as an in-process/SQLite table").
WAL + local-fs-only is the SQLite analog of E2B's real-disk-with-locking
assumption.

---

## 2. Per-workspace nonce sub-budget

**What it is.** A per-workspace active-nonce sub-budget layered on the nonce
store: `consume(nonce, workspaceId, expiresAtMs, nowMs)` enforces a lower
per-workspace maximum under the global maximum, in the same held write lock, so
tenant A cannot exhaust the whole worker maximum and cause
`REMOTE_WORKER_CAPABILITY_NONCE_STORE_EXHAUSTED` for tenant B. Sub-budget
exhaustion reuses the existing stable exhaustion code with no tenant counts or
identifiers leaked.

**Why v1 doesn't need it.** r1's own acceptance test was "tenant A can exhaust
only its sub-budget; tenant B remains accepted" — **there is no tenant B.** This
is multi-tenant fairness engineering in a one-tenant system. It also depends on
item 1's store existing.

**RE-ENTRY TRIGGER:** **the 2nd tenant.** The moment a second workspace/tenant
shares the worker, fairness becomes real and the sub-budget re-enters (with item
1). Acceptance: tenant A exhausts only its sub-budget; tenant B accepted until the
global limit; expired rows release both budgets.

---

## 3. Dual-secret zero-downtime rotation

**What it is.** The daemon accepts one primary and, during rotation, one secondary
static secret from separate root-owned credential files; both derive the same
domain-separated verification key classes; the daemon signs with the configured
primary and accepts valid capabilities/receipts from either during a bounded
overlap (one max capability/receipt lifetime + clock skew). Startup fails if both
files hold the same value or an overlap lacks an explicit expiry. Three-step
choreography: (1) install new as secondary on daemon, restart/drain-check;
(2) switch seneca's issuer to new while its verifier accepts either (daemon still
signs with old primary until step 3), canary; (3) wait out the lifetime, promote
new to primary, drop old, restart/drain-check. Zero canary downtime across a
rotation.

**Why v1 doesn't need it.** One operator, one client, one box: rotation = update
two config values, restart both ends, ~seconds of canary downtime, with
`vercel-sandbox` always available as fallback. On suspected compromise the plan
stops admission first, at which point overlap buys nothing. Zero-downtime overlap
is a real requirement only when a second, independently-administered client
exists.

**RE-ENTRY TRIGGER:** **a multi-operator / compliance policy** (a second,
independently administered client where a coordinated-restart availability gap is
unacceptable, or a compliance regime mandating zero-downtime credential
rotation). ~100–200 LOC + tests + the rollback references that cross an
auth/replay boundary.

---

## 4. Auth rate limiter

**What it is.** `authRateLimiter.ts` — bounded in-memory token buckets for failed
authentication, keyed server-wide and by the forwarded source address (10
failures/min, burst 10) with exponential backoff (1s→30s), applied before token
decoding beyond constant-time verification and before any runtime call; bounded
key count/expiry so random sources cannot create unbounded state. Includes the
forwarded-source-header parsing that rejects the header on any non-loopback hop
(it exists solely to feed this limiter).

**Why v1 doesn't need it.** The tailnet ACL admits exactly one node — Seneca,
which *holds the secret*. There is no public edge to brute-force. Constant-time
comparison (kept in v1) already defeats timing probes, and the connection/session
caps (kept in v1) bound resource abuse from a buggy client. The limiter defends a
public edge the daemon deliberately does not have.

**RE-ENTRY TRIGGER:** **any non-Tailscale / public ingress** (an edge compat shim,
a public listener, or any path where an unauthenticated stranger can reach the
auth check). Belongs at that public edge (api-spec §3.4). ~150–250 LOC + the
slowloris/saturation test surface, plus the forwarded-header trust logic.

---

## 5. S3b evidence formalism + fleet-admission automation

**What it is.** The full r1 S3b harness upgrade and the 4-phase admission ceremony:

- Upgrade the **real** `qualify-docker-runsc-isolation.mjs` from the V2 envelope
  to the production V3 schema, with an explicit `--observe-only` mode (emits real
  profile/cohort-pin inputs + deterministic cohort-spec) and a bound mode
  (`--qualification-bundle=<path>`, `--workload-image=<repo@sha256>`) emitting the
  final V3 evidence with the four V3 controls (own-workspace write, persistence
  across recreate, byte quota, inode quota), refusing placeholder/reference values.
- The CLI/env contract S4's committed transcript depends on: `--observe-only`,
  `--cohort-spec-out=<path>`, `--workload-image=`, `--qualification-bundle=`,
  `BORING_RUNSC_WORKLOAD_IMAGE`, `BORING_RUNSC_WORKSPACE_ROOT`,
  `BORING_RUNSC_USE_INSTALLED_QUOTA_HELPER`, `BORING_BUSYBOX_BINARY`;
  `build-qualification-bundle.mjs <cohort-spec.json>` positional consumer;
  `RUN_RUNSC_INTEGRATION=1` gate.
- The 4-phase admission: (1) observe real profile/pins, (2) build the immutable
  bundle from observations + exact files + image, (3) rerun the harness bound to
  that bundle digest, (4) `verify-fleet-admission-evidence.mjs` accepts the pair.
  Plus the cross-layer dual-field digest-equality choreography
  (`expectedWorkloadImageManifestDigest` ↔ `expectedImageDigest` tested under both
  names) and the deterministic cohort-spec.
- Continuously-running fleet-admission automation: unattended evidence-bound
  admission, drift fence, escape canaries, CVE game-day — SBX1.5.

**Why v1 doesn't need it.** The load-bearing property is *the exact box passed the
committed hostile probe suite (11/11) on the exact pinned image, and the daemon
only ever starts the one pinned digest (S3a)* — deliverable with the existing
integration harness pointed at the external pinned image + real quota helper (two
narrow opt-ins) and a manually reviewed transcript + digests. The
immutable-bundle digest-binding, deterministic cohort-spec, cross-layer
digest-equality tests, and strict verifier choreography are fleet-admission
machinery pulled forward: they exist so *unattended automation* can trust
evidence. v1's admission is one human on one box reading one transcript.
Mechanical drift is still caught by S3a's startup pin + `--check` (fail closed on
digest mismatch).

**RE-ENTRY TRIGGER:** **the public-opening gate / SBX1.5 fleet-admission
automation** — the point where admission must be trusted by unattended machines
instead of a human reading a transcript, or where a second/third box is admitted
without an operator reading each one. Saves most of an M slice (the r1 S3b) + the
4-phase S4 transcript ceremony in v1.

**E2B grounding.** E2B never boots a VM from an unbuilt template; the content-
addressed `create-build` artifact is the trusted identity (e2b-internals §1, §4).
The observe→build→bound→verify ordering is the single-box analog of that
discipline, and continuous evidence-bound admission is E2B's build-pool model
(architecture §5 "SBX1.5 fleet-admission automation").

---

## 6. Multi-box placement scheduler

**What it is.** A real `placeSession(request) → box` interface in the
control-plane daemon with fleet/warm-pool/bin-packing logic, replacing v1's
single worker URL. r1's 256-bucket placement config becomes a bucket map with
more than one distinct value; the v2-entry refactor introduces real buckets and
the scheduler behind the frozen `SandboxProviderV1` seam. This is E2B's
crown-jewel placement weld (`api` scheduling against the Nomad/Consul catalog,
e2b-internals §2, §7) realized as our own control-plane scheduler.

**Why v1 doesn't need it.** 256 buckets → one box is not "the degenerate case of a
scheduler," it's a data structure with exactly one distinct value plus
bucket-assignment validation nobody exercises. The architecture doc already
concedes no `placeSession` interface ships in v1. The seam is the *config file's
existence*, not its cardinality — v1 uses a single worker URL + digests.

**RE-ENTRY TRIGGER:** **box #2** — the first time a second production worker
exists and a request must be *placed* rather than sent to the one box. Likely
delivered via Nomad or the `agent-sandbox` scheduler (architecture §2 Layer-2,
§5; e2b-internals §8 v2 "introduce a real placement/scheduler in the
control-plane daemon"). The bucket map and validation code re-enter with it.

---

## 7. Requalification automation

**What it is.** Automated, scheduled requalification of admitted boxes: a
protected admission CI/cron job that re-runs the full S4 admission on a cadence
(r1 set a 7-day `qualificationMaxAgeMs` + a 6-day manual requal reminder), a drift
fence, and automatic candidate-box registration — so freshness is enforced by
machine, not by an operator's calendar discipline.

**Why v1 doesn't need it.** Re-running full admission weekly forever, on a box
whose kernel/runsc/image change only when the operator changes them, is calendar
ceremony. v1 requalifies **on change** (kernel, Docker, runsc, daemon/provider,
helper, policy, image — the triggers the box actually has) plus `--check` at every
daemon start. If the owner wants a freshness bound, 30 days matches the real risk
better than 7. Undetected in-place drift on an unattended box is the only residual
risk, and there is one box, changed only by the operator.

**RE-ENTRY TRIGGER:** **fleet scale** — enough boxes that per-box operator-driven
requalify-on-change no longer scales and freshness must be machine-enforced across
the fleet (pairs naturally with items 5 and 6). Re-introduces
`qualificationMaxAgeMs` as a fleet policy, the recurring requal job, and automatic
candidate registration.

---

## Relationship to the public-opening gate

Items 1–2 (multi-tenant replay/fairness), 3 (multi-operator rotation), 4 (public
edge limiter), and part of 5 (multi-tenant-trusted admission) are the concrete
build backlog behind the [`plan-sbx14.md`](plan-sbx14.md) **public-opening gate**
(the three-part higher bar) and architecture §5. Items 5–7 (fleet admission,
placement, requal automation) are the SBX1.5 fleet-productization backlog. None
may be built early (architecture §6): each waits for its trigger.
