# Lane brief — sandbox isolation for untrusted code

Tracking issue: #1012 (authoritative). This file is the working brief; keep it in sync as the lane executes.

## Today (verified against `origin/main`, 2026-07-31)
Both packages are real and published at 0.1.93: `@hachej/boring-sandbox`, `@hachej/boring-bash`. (`boring-bash`, despite the name, is filesystem/shell *binding* code — pi tool wiring and workspace file/git/search/watch routes — not a sandbox.)

Interface `SandboxProviderV1` (`packages/boring-sandbox/src/shared/providerV1.ts`), capability facts in `providerMatrix.ts`, wiring in `providers/static.ts`.

**Backends that actually execute:**
- `direct` — raw `child_process.spawn`, `hardening: "none"`. Zero isolation, by design.
- `bwrap` — genuine: `--unshare-all`, `--die-with-parent`, `--new-session`, tmpfs root, ro-binds, optional `--cap-drop ALL`.
- `vercel-sandbox` — real remote provider with snapshot/bake/circuit-breaker.

Strongest real path today is full-app's agent worker (`apps/full-app/src/server/agent-worker.ts` + `packages/agent/src/server/worker/*`): bwrap with `dropAllCapabilities`, internal-token auth, `ExecSemaphore`, and `buildExecEnv` scrubbing `*_API_KEY`/`*_TOKEN`/`*_SECRET`/`DATABASE_URL`.

## Two defaults that are true right now, not Wave-4 problems
1. **The CLI defaults to `direct` — no isolation — on every platform**, including Linux with bwrap present. bwrap is opt-in behind `--mode local-sandbox` for boot-cost reasons (`packages/cli/src/server/cli.ts:571-583`). Defensible for a local dev tool the user controls; wrong the moment anything less-trusted runs.
2. **Neither real backend isolates network egress.** bwrap defaults to `--share-net`; the matrix records `networkIsolation: "none"` for both `direct` and `bwrap`.

## Dormant
- **runsc/gVisor does not execute on main.** `providers/runsc/` is preflight + evidence + admission only (`preflight.ts`, `isolationEvidence.ts`, `fleetAdmission.ts`, `qualificationBundle.ts`), with a constant literally named `RUNSC_UNPROVEN_SECURITY_FACTS`.
- **`RemoteWorkerTransportV1` has no implementation anywhere on main** — only the interface and its consumers, so the whole remote-worker/fleet-placement path is unreachable. Carries `RemoteWorkerExecutionCredentialResolverStubV1` with a TODO to reconcile with BYOK.
- No docker provider. Matrix entries `none`/`readonly` are not in `static.ts`.
- `EnvironmentLeaseManager` (`agent-host/environmentLease.ts`) is refcount bookkeeping keyed by `[workspaceScopeId, placementIdentity]` — isolation strength is entirely whatever the provider returns.

## Delta for untrusted code / third-party agents
1. An executing gVisor/Docker backend (exists only in parked #916).
2. The remote-worker transport (TLS identity, bounded reads, sanitized errors).
3. Network egress isolation by default.
4. A safe default mode for the CLI.
5. Resource limits (disk/inode quota, PID/fork-bomb, output flood) — only in #916's Go quota-helper.
6. Credential isolation beyond `buildExecEnv`'s suffix denylist, which is allowlist-inverted and misses non-conforming names. Ties to the BYOK `sandbox-pipe`/`sandbox-tmpfs` delivery stubs — see #1010.
7. Image pinning + restart-surviving replay nonce (deferred to SBX1.4).

## Parked PR #916 does not close this
+8051/-53, session-lifetime Docker+runsc runtime with a Go workload (root supervisor vs UID 65532 tenant, FD-3 credential delivery, `openat2` quotas). **Its own body says do not merge**, and its runsc isolation evidence is stated as **non-admitting** pending SBX1.5.

Refs #391, #916, #861

## Status

Not started. This branch is the lane seed — a draft PR so the lane has a visible home before work begins.
