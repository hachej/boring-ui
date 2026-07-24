# SBX1.3 — Session-lifetime Docker+runsc worker runtime

Bead: `wt-391-forward-6gd.3`. Branch: `feat/808-sbx1-3-runtime`. Depends on SBX1.1 (#855, V1 protocol/provider) + SBX1.2 (#892, V3 qualification), both on `main`.

## Scope framing (Today → Delta)

**Today (landed on main).**
- `packages/boring-sandbox/src/shared/remoteWorkerProtocolV1.ts` — V1 wire schemas (health/create/exec/fs/renew/delete, capability claims *including a `nonce` field*, binding receipt). Exec request has **no** secret channel yet.
- `providers/remote-worker/*` — client-side provider, binding registry, `requestDigest.ts` (already uses a `canonicalJson` — sorted-keys, drops `undefined`).
- `providers/runsc/*` — structural `preflightRunsc()` (`productionReady:false`), V2/V3 isolation evidence + qualification bundle + fleet-admission validators (SBX1.2). No live container runtime.
- `qualify-docker-runsc-isolation.mjs` — adversarial qualification harness (passed 11/11 on this VPS, runsc `4.19.0-gvisor` confirmed runnable for the current user).

**Delta (SBX1.3 delivers — the worker-side RUNTIME the SBX1.4 daemon will host).** Server-side composable modules under `packages/boring-sandbox/src/providers/runsc/runtime/**` (node:* allowed here; **never** in `src/shared/**`). No HTTP daemon (SBX1.4), no fleet admission (SBX1.5).

## Slices

1. **Typed Docker argv runner.** Pure `buildDockerRunArgv(profile)` / `buildDockerExecArgv` producing an argv array for `/usr/bin/docker`, plus an injected `DockerCommandRunner` that spawns `/usr/bin/docker` with `shell:false`. Tenant values never become flag names, volume sources, labels, names, or shell fragments. Emits the exact V3 launch profile (`--runtime=runsc --user 65532:65532 --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 0.5 --memory 128m --pids-limit 64 --network none --tmpfs /tmp:rw,nosuid,nodev,size=16m --mount type=bind,...rw --label ... <image@sha256> <PID1>`). Finite per-command Docker timeouts.

2. **Workspace path-safety helper (dirfd/openat2, RESOLVE_BENEATH+RESOLVE_NO_MAGICLINKS).** In-container trusted helper holding a dirfd for `/workspace`, doing dirfd-relative `openat2` for every component/rename endpoint; host-side client speaks to it (not host check-then-open). If the qualified kernel/runsc profile cannot provide `openat2`+RESOLVE flags, **admission fails** — no realpath-then-open fallback. Host root/path never serialized in responses/errors. Sibling-traversal + concurrent symlink-swap/rename-race negatives.

3. **Fixed project quota + host reserve.** Root-owned quota helper takes only a validated workspace ID + fixed profile; assigns/checks ext4/XFS project quota (1 GiB + 100k inodes) outside the tenant mount; exposes no arbitrary path/shell. Host emergency reserve = max(10% volume, 10 GiB) tenant cannot consume. One stable quota-exceeded failure to both fs ops and in-container commands; siblings + reserve stay writable.

4. **Workload image + trusted PID1/subreaper + invocation wrapper.** Dockerfile (minimal tool runtime, pinned by digest, non-root 65532). Trusted PID1 supervisor reaps all descendants (incl. double-fork/background) after success/error/abort/timeout; proves clean tenant-process baseline before each invocation; uncertain cleanup ⇒ destroy+recreate container. In-container invocation wrapper receives one bounded JSON stdin envelope, populates child env in memory, runs the command, clears refs on exit.

5. **Warm no-network session container lifecycle.** One `create()` → one `--network none` container reused across invocations for the runtime-binding lease. Idle 30-min TTL timer (not a reconcile loop), 24-h hard lifetime → single-flight retirement through the landed binding owner. Startup bounded sweep of own labeled containers; shutdown drains then removes. Missing/expired ⇒ stable retryable error + retirement, never a side-door recreate.

6. **Purpose-typed NON-MODEL per-invocation secrets (stdin envelope) + model-key negative.** Add a typed secret-reference contract (`sandbox-invocation-secret` vs `model-provider-credential`) in `src/shared` (types/zod only, no node). Extend `RemoteWorkerExecRequestSchemaV1` with a `secretEnv` envelope separate from ordinary `env`. Worker: strict env-name grammar + reserved-name denylist; classification comes **only** from trusted sensitivity metadata (never inferred from `_TOKEN`/`_SECRET`); **rejects** `model-provider-credential` refs (`REMOTE_WORKER_*`); pipes one bounded JSON envelope over stdin to the wrapper; never puts secrets in argv/`docker exec --env`/labels/layers/files/logs; secret-bearing invocation uses a clean container and destroys+recreates it after completion (preserving `/workspace`); never caches a secret-bearing invocation's output for replay (`REMOTE_WORKER_SECRET_INVOCATION_NOT_REPLAYABLE`). This is the host-controlled Tier-1-adjacent path; the deferred Tier-2 in-sandbox tenant-tool injection (`16f.6`) is **out of scope**.

7. **Time/resource/output bounds + dispose/expiry/orphan cleanup.** 30-s default / 15-min max invocation timeout; 4 MiB combined stdout+stderr with truncation facts; one active exec/session + finite daemon-wide concurrency; finite create/fs/exec-grace/renew/dispose/Docker timeouts; body/command/path/env/secret count+value + SSE caps. Timeout: wrapper kills the process **group**, grace, then kill; killing only host-side `docker exec` is insufficient; unproven group death ⇒ destroy container + stable cleanup error.

8. **#855-review GATES (security-critical, must implement).**
   - **Single-use nonce:** a worker-side nonce store records every accepted capability `nonce` and **rejects replays** (`REMOTE_WORKER_*` replay code), bounded by capability lifetime with expiry eviction. Concurrent-replay race is single-flight/atomic.
   - **Request-digest canonicalization:** idempotency/binding digests use `canonicalJson` (sorted keys, stable), **never** `JSON.stringify`, for any Date-bearing / key-order-sensitive body. Add a negative test proving `JSON.stringify` key-order or Date drift would break idempotency but `canonicalJson` does not.

## Invariants
Stable error codes (extend `REMOTE_WORKER_ERROR_CODES_V1` as needed, mapped in the agent `ErrorCode` union); no `node:*`/`Buffer` in `src/shared/**` (use `Uint8Array`); messages never reflect token/secret values, host roots, or the Docker socket.

## Proof / exit
- **Unit fault matrix** for every module (argv builder rejects injection; path helper rejects traversal/race; quota helper; secret envelope grammar/denylist + model-key reject; nonce replay; canonicalization; timeout/output bounds; lifecycle/retirement).
- **Non-admitting real-runsc integration** (runsc IS installed, qualification passed 2026-07-19) for: create, fs, symlink-race, quota-fill, background/double-fork process reaping, non-model-secret delivery + non-leak, model-key negative, timeout group-kill, egress default-deny, teardown. Gated behind a `RUN_RUNSC_INTEGRATION` env so CI without runsc still passes; harness present regardless.
- Explicitly **NOT** claimed: fleet admission, "exact production" cohort freeze (SBX1.4/1.5).

## Deferred (out of scope)
SBX1.4 minimal VPS daemon + V0 retirement; SBX1.5 fleet admission; `16f.6` Tier-2 in-sandbox injection; deep host-side `withRuntimeEnvContributions` migration across agent/core/workspace (SBX1.4 wiring — SBX1.3 lands only the worker-side secret-reference contract + rejection).

## Reviewer
Independent adversarial security review by a **different model** than the executor (delegation-model requirement for security surfaces), attacking isolation/secret/nonce/egress/path/quota properties before done.
