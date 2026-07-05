# TODO-P2 — Scaffold `@hachej/boring-sandbox`, move concrete providers into it, land `resolveMode` in `@hachej/boring-bash`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

**Package re-target (00 open decision 3, RESOLVED; 08 decision 11 — READ THIS FIRST):** concrete providers do **NOT** move to `@hachej/boring-bash/providers`. They move to a **new dedicated package `@hachej/boring-sandbox`** (`packages/boring-sandbox/src/providers`). The three-package stack, top-down: **`@hachej/boring-agent`** (defines ALL contracts, imports neither boring-bash nor boring-sandbox) ← **`@hachej/boring-bash`** (THE RUNTIME: fs bindings/tools/routes/UI + bash tool + runtime modes = the CHOICE of sandbox; **`resolveMode` lives here**; imports boring-sandbox **values** + agent **types**) ← **`@hachej/boring-sandbox`** (sandbox management: providers `direct`/`bwrap`-gVisor/`vercel`-PROXY/`remote-worker`-client, FUSE-S3 mounts, lifecycle; capability facts/types `reported | unknown` live in `boring-sandbox/shared` only; imports agent **types only**). Acyclic: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`. Everywhere below, "move a provider" means move it to `packages/boring-sandbox/src/providers`, and "`resolveMode`" lands in boring-bash.

## Context (read first)

- `docs/issues/391/runtime-refactor/architecture/02-boring-bash-environment.md` — package layers, provider capability matrix, mode↔provider mapping, remote-worker split rules.
- `docs/issues/391/runtime-refactor/INDEX.md` — Phase 2 deliverables/exit; "Do not move providers until Phase 1 injection is complete."
- `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` — decision 11: the three-package `boring-agent`/`boring-bash`/`boring-sandbox` stack and its acyclic import edges.
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — invariant: `@hachej/boring-agent` has **zero value imports** from `@hachej/boring-bash` or `@hachej/boring-sandbox`; open decision 3 (RESOLVED — boring-sandbox); provisioning-ownership rule.

### Preflight checks before coding any bead

Run these before BBP2-000. If the Phase 1 injection seam is absent, STOP and report the missing P1 deliverable; do not add a compatibility shim in agent.

```bash
test -f packages/agent/src/server/createAgent.ts
test ! -d packages/boring-sandbox
node -e "const p=require('./packages/boring-bash/package.json'); const e=Object.keys(p.exports ?? {}); if (!e.includes('./shared') || !e.includes('./server') || e.includes('./modes')) throw new Error('unexpected boring-bash exports: '+e.join(','))"
node -e "const root=require('./package.json'); for (const s of ['lint:invariants','audit:imports','typecheck']) if (!root.scripts?.[s]) throw new Error('missing root script '+s)"
```

### Already landed via issue #416 (do not redo, build on it)

- `packages/boring-bash/` exists (`@hachej/boring-bash@0.1.61`). `package.json` `exports` currently expose only `.`, `./shared`, `./server`.
- `packages/boring-bash/src/shared/index.ts` — filesystem-binding contracts: `FilesystemId`, `FilesystemAccess`, `FilesystemProjection`, `FilesystemBinding`, `BoundFilesystemContext`, `FilesystemBindingResolver`, `PreparedFilesystemBinding`, `FilesystemBindingProvider`, `RuntimeBindingPlan`. Shared is front-safe (no `node:*`, no `Buffer`).
- `packages/boring-bash/src/server/*` — `readonlyProjectionOperations.ts`, `managementProjectionOperations.ts`, `runtimeBindingManager.ts` (`ScopedFilesystemRuntimeBindingManager`, `filesystemRuntimeScopeKey`), `testing/companyContextFixtureProvider.ts` (`FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID`, `COMPANY_CONTEXT_SENTINEL`), `testing/readonlyProjectionConformance.ts` (`checkReadonlyProjectionConformance`). Conformance/leak tests under `src/server/__tests__/`.
- `packages/boring-bash/scripts/check-invariants.mjs` — asserts required exports `.`, `/shared`, `/server`; scans shared for `node:*`/`Buffer`; scans `packages/agent/src` for any `@hachej/boring-bash` **value** import; checks plan-doc wording. Wired into root `pnpm lint:invariants`.
- These contracts are consumed by downstream governance PRs (#476–#501). **Never break or re-shape them.**

### Provider/mode source inventory in `packages/agent` (Phase 2 move targets)

Sandbox implementations:
- `packages/agent/src/server/sandbox/direct/createDirectSandbox.ts` (+ `__tests__/createDirectSandbox.test.ts`, `directSandbox.conformance.test.ts`, `streaming-exec.test.ts`).
- `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts`, `createBwrapSandbox.ts` (+ `__tests__/` incl. `__snapshots__/buildBwrapArgs.test.ts.snap`, `bwrapSandbox.conformance.test.ts`).
- `packages/agent/src/server/sandbox/vercel-sandbox/*` — `FileHandleStore.ts`, `bake.ts`, `circuitBreaker.ts`, `createVercelSandboxExec.ts`, `deploymentSnapshot.ts`, `oidcRefresh.ts`, `packageTemplate.ts`, `periodicSnapshot.ts`, `provisioningAdapter.ts`, `readyStatus.ts`, `resolveSandboxHandle.ts` (+ `__tests__/`).
- `packages/agent/src/server/sandbox/remote-worker/createRemoteWorkerSandbox.ts`, `protocol.ts`, `workerClient.ts` (+ `__tests__/workerClient.test.ts`).
- `packages/agent/src/server/sandbox/snapshots/deploymentSnapshot.ts`; `packages/agent/src/server/sandbox/workspacePythonEnv.ts`.

Runtime mode adapters (map mode id → provider):
- `packages/agent/src/server/runtime/modes/direct.ts`, `local.ts`, `vercel-sandbox.ts`, `remote-worker.ts`, `provisioningAdapter.ts`.
- `packages/agent/src/server/runtime/resolveMode.ts` — `autoDetectMode()`, `hasBwrap()`, `resolveMode()` (builtin union `direct|local|vercel-sandbox`).
- `packages/agent/src/server/runtime/mode.ts` — **type-only** contracts (`RuntimeModeAdapter`, `RuntimeBundle`, `RuntimeBashStrategy`, `RuntimeFilesystemStrategy`, `RuntimeFilesystemBinding`, `getRuntimeBundleStorageRoot`). These stay agent-side per [`../../architecture/00-global-isa.md`](../../architecture/00-global-isa.md) and [`../P1-headless-core/TODO.md`](../P1-headless-core/TODO.md) until Phase 1 injection lands; only concrete adapters/`resolveMode()` move.

Workspace factories bound to providers:
- `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts`, `createVercelSandboxWorkspace.ts`, `createNodeWorkspace.ts` (`getNodeWorkspaceHostRoot`).
- Provider-bound helper dependencies that must not be stranded in agent after moves: `packages/agent/src/server/workspace/paths.ts`, `workspace/nodeWatcher.ts`, `workspace/provision.ts` (`copyTemplate`), `workspace/provisioning/packArtifact.ts` (`packProvisioningArtifact`/`resolveArtifactInstallSource`), `runtime/createServerFileSearch.ts`, and `server/tools/harness/bashToolOptions.ts` (imports `buildBwrapArgs`).

Remote-worker server (app-owned today):
- `apps/full-app/src/server/worker/workspace.ts`, `config.ts`, `exec.ts`, `routes.ts`, `auth.ts`; `apps/full-app/src/server/agent-worker.ts`; smoke `apps/full-app/scripts/remote-worker-smoke.mjs`.
- Current worker health is `GET /internal/health` returning `{ ok: true }`; there is no capability handshake in the worker server today, and P2 must not add one.

### Current public re-exports to treat as compatibility surface

`packages/agent/src/server/index.ts` re-exports (grep-verified): `createDirectSandbox`, `createBwrapSandbox` (+ `BwrapResourceLimits`, `CreateBwrapSandboxOptions`), `createRemoteWorkerModeAdapter` (+ `RemoteWorkerModeAdapterOptions`), `createRemoteWorkerWorkspace`, `createRemoteWorkerSandbox`, `RemoteWorkerClient`/`RemoteWorkerClientError`/`RemoteWorkerClientOptions`, remote-worker protocol types, `createVercelSandboxWorkspace`, `autoDetectMode`/`hasBwrap`/`resolveMode`, `RuntimeBundle` (type).

### Known importers of concrete providers (grep-verified — the migration set)

Value importers of `sandbox/{direct,bwrap,vercel-sandbox,remote-worker}`:
- `packages/agent/src/server/index.ts`
- `packages/agent/src/server/runtime/modes/{direct,local,vercel-sandbox,remote-worker}.ts`
- `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts`

`resolveMode`/`autoDetectMode` importers:
- `packages/agent/src/server/createAgentApp.ts`, `registerAgentRoutes.ts`, `index.ts`, `bin/boring-agent.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/cli/src/server/modeApps.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/agent/scripts/eval-provisioning-agent-vercel.mts`

Additional moved-symbol importers to include in the grep migration set:
- `createRemoteWorkerModeAdapter`: `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, `packages/workspace-playground/src/server/dev.ts`, `apps/full-app/scripts/remote-worker-smoke.mjs`, `packages/agent/src/server/index.ts`.
- `createNodeWorkspace`/`getNodeWorkspaceHostRoot`: direct/local modes, bwrap provider tests, workspace tests, `apps/full-app/src/server/worker/workspace.ts`, `packages/workspace/src/plugins/filesystemPlugin/front/data/__tests__/fetchClient.integration.test.ts`, and agent route/test helpers. Migrate all to `@hachej/boring-sandbox/providers` when the helper moves.
- Remote-worker protocol/provider imports through `@hachej/boring-agent/server`: `apps/full-app/src/server/worker/{auth,config,routes,workspace}.ts` and smoke scripts. Repoint to `@hachej/boring-sandbox/shared`/`providers`.

## Goal / exit criteria

Concrete non-agent-loop providers (direct, bwrap, vercel-sandbox, remote-worker client) live under **`@hachej/boring-sandbox`** (`packages/boring-sandbox/src/providers`), described by a capability matrix; **runtime-mode resolution (`resolveMode`) lands in `@hachej/boring-bash`** (the CHOICE of sandbox). Host/CLI/composition wires provider selection. Exit per [`../../INDEX.md`](../../INDEX.md) Phase 2:

- **`@hachej/boring-sandbox` package exists**, builds, and resolves `boring-sandbox/shared` + `boring-sandbox/providers` subpaths.
- No agent→bash **or** agent→sandbox value import (invariant scan green); the only cross-package value edge is `boring-bash → boring-sandbox`; the only sandbox→agent edge is type-only.
- Current apps still compile after same-PR importer migration (no old-path re-export, no host shim).
- Landed #416 contracts unchanged; governance consumers keep working.
- `direct`/`local`/`vercel-sandbox` behavior + existing tests preserved; `resolveMode` behavior byte-identical after moving to boring-bash.

### This phase is the runtime-mode composition cutover (API-breaking for in-repo composers — the FIRST break)

P2 is where composition **first breaks and gets rewired** — it is the earlier of the two named cutovers (P2 = runtime-mode; P3 = routes/tools). P1 held an end-to-end compatibility promise ("all current HTTP consumers unchanged"), but **that promise ends at P2**: moving the concrete mode adapters + `resolveMode()` out of `packages/agent` means every in-repo composer that resolved a runtime mode must now **inject the resolved runtime adapter** (host-side) instead of importing `resolveMode`, and the agent bin becomes pure-only. External HTTP *callers* still see byte-identical route paths/behavior; the break is in the **composition API**, not the wire surface. **No text may claim the first composition break waits until P3.**

P2 therefore **enumerates and migrates EVERY in-repo composition consumer** — **each relocation slice migrates ALL importers for that slice, deletes the origin exports, and merges atomically after its gates pass** (a slice = one provider family; there are **no shims between slices**) — re-verifying behavior parity after each slice:

- `packages/agent/src/server/createAgentApp.ts` + `registerAgentRoutes.ts` — the Fastify adapter layer takes the resolved runtime adapter **by injection** (Phase-1 seam) instead of importing `resolveMode`; if that seam is not threaded, STOP and report the missing P1 deliverable (do not shim).
- `packages/cli/src/server/modeApps.ts` — imports `@hachej/boring-bash/modes` (mode resolution, which pulls `@hachej/boring-sandbox/providers` values) and resolves the mode host-side (and **now owns the bash-enabled dev-server bin composition** moved from the agent bin — see BBP2-005 / fix 6).
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` — same host-side `@hachej/boring-bash/modes` resolution.
- `packages/agent/src/bin/boring-agent.ts` — becomes **pure-only** (`runtime: 'none'`, no `--mode`, no provider, no `resolveMode`); its bash-enabled composition moves to `packages/cli` in this same PR.
- `packages/agent/src/server/index.ts` — origin value exports of the moved providers/`resolveMode` are **deleted** (BBP2-007), no old-path re-export.

**Exit re-verifies parity post-migration:** after each consumer is migrated, its previously-green behavior (dev server, workspace/CLI/full-app boot, `direct`/`local`/`vercel-sandbox` modes, existing tests + e2e) must pass unchanged. A consumer is "done" only when its migration PR is merged AND its parity checks are re-run green post-cutover.

## Non-negotiables

- **Precondition:** Phase 1 dependency injection (`createAgent()` / injected runtime+tools; see [`../P1-headless-core/TODO.md`](../P1-headless-core/TODO.md)) is complete before providers move. If not, STOP and report — do not move providers.
- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash`. Value flows one-way: host/CLI/composition imports both.
- Do not add re-exports of moved providers from old agent paths — **neither value nor type-only** (value re-exports re-create the cycle; any old-path re-export violates the no-compat policy). Every importer migrates in the same PR; the origin export is deleted in that PR.
- Provisioning-ownership rule (00): provisioning engine + `ProvisionWorkspaceRuntimeOptions` stay agent-side over an injected adapter; boring-bash owns requirement normalizer + provider adapters.
- Preserve path-safety ownership: adapters validate containment; routes/tools never accept raw unchecked host paths.
- Preserve the mode-id vs provider-id distinction: `local` mode → `bwrap` provider (02 table).
- Before any mode file lands in `packages/boring-bash/src/modes`, eliminate all `@hachej/boring-agent` **value** imports it relied on in agent (`ErrorCode`, `safeCapture`, `getEnv`, `createServerFileSearch`, `copyTemplate`, provisioning artifact helpers, provider factories). Move the helper to `boring-bash/modes`, move provider-bound helpers to `boring-sandbox/providers`, or inject it from the host. Type-only imports from `@hachej/boring-agent/server` are allowed only for agent-owned contracts.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree.
- Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do not re-shape or re-export the #416 shared binding contracts or server projection operations.
- Do not collapse mode ids into provider ids.
- Do not move routes/tools/UI (Phases 3/4 own those).

## Beads

### BBP2-000 — Scaffold the `@hachej/boring-sandbox` package [size S]

- **Files create:** `packages/boring-sandbox/package.json` (name `@hachej/boring-sandbox`; `exports` map for `.`, `./shared`, `./providers`; devDeps mirror boring-bash); `packages/boring-sandbox/tsup.config.ts`; `packages/boring-sandbox/tsconfig.json`; `packages/boring-sandbox/src/shared/index.ts` + `src/providers/index.ts` (empty barrels to start); `packages/boring-sandbox/scripts/check-invariants.mjs`.
- **Files touch:** `pnpm-workspace.yaml` (currently already has `packages/*`; verify it covers `packages/boring-sandbox` and do not add a duplicate entry unless the pattern changed); root `package.json` `lint:invariants` chain (currently agent + boring-bash + workspace-plugin invariants; add `pnpm --filter @hachej/boring-sandbox run check:invariants`).
- **Notes:** boring-sandbox imports agent **types only** — its `check-invariants.mjs` must assert (a) no `@hachej/boring-agent` **value** import anywhere in `src/**` (type-only imports allowed), (b) no `@hachej/boring-bash` import of any kind (that edge would create a cycle — bash imports sandbox, never the reverse), (c) `src/shared/**` stays `node:*`/`Buffer`-free (front-safe), `src/providers/**` may use `node:*`. This is the acyclic guarantee's home on the sandbox side.
- **Tests:** package `build`/`typecheck` green; export maps resolve to empty barrels; invariant script passes; a planted `@hachej/boring-agent` value import (or any `@hachej/boring-bash` import) fails it.
- **Acceptance:** the empty `@hachej/boring-sandbox` package exists, builds, and its invariant boundary (types-only agent edge, no bash edge) is enforced.

### BBP2-001 — Provider capability contract in `boring-sandbox/shared` [size S]

- **Files create:** `packages/boring-sandbox/src/providers/index.ts` (populate from BBP2-000 barrel); `packages/boring-sandbox/src/shared/capability.ts`.
- **Files touch:** `packages/boring-sandbox/package.json` (confirm `"./providers"` + `"./shared"` exports → `dist/*`); `packages/boring-sandbox/tsup.config.ts` (add entries); `packages/boring-sandbox/scripts/check-invariants.mjs` (add `"./providers"`/`"./shared"` to `requiredExports`).
- **Notes:** Define `ProviderCapabilities` mirroring 02's matrix: `fs: 'none'|'readonly'|'readwrite'`, `exec: boolean`, `realBash?`, `realBinaries?`, `networkIsolation?: 'none'|'process'|'container'|'microvm'|'provider'`, `watch: boolean`, `search: boolean`, plus `sourceOfTruth: 'sandbox-primary'|'storage-primary'`, `provisioningSupport: boolean`, `providerContractVersion: string`. Add the runtime-image reservation from [`../../architecture/10-sandbox-deployment-eu.md`](../../architecture/10-sandbox-deployment-eu.md): provider config may carry `image?: { ref: string; digest: string }`, but it is honored only when capability fact `runtimeImage: boolean | 'unknown'` is reported/proven. `runsc`/Kata-backed providers can report native OCI support; `bwrap` must either document a host-side image-unpack-to-rootfs path (e.g. podman/umoci/skopeo pull by digest → unpack dir → bwrap chroot-style binds, with UID/GID/whiteout/setuid caveats) or report unsupported/`unknown`; `vercel-sandbox` and `remote-worker` accept image refs only when their provider API/handshake proves support. Unknown support fails closed. **Worker-dependent fields are typed `reported | 'unknown'`** (02 "Worker-dependent capabilities are reported, not declared"): `realBash?: boolean | 'unknown'`, `realBinaries?: boolean | 'unknown'`, `networkIsolation?: <enum> | 'unknown'` (+ any hardening/persistence facts). For fixed providers these hold concrete values; for `remote-worker` they default to `'unknown'` in P2 and are populated **only from the P5 handshake (`TODO-P5` BBP5-008, the sole handshake owner)** — P2 implements no handshake. Define stable error codes for unsupported-requirement and unsafe-fallback, **including a fail-closed error code for when a required capability is `'unknown'`** (the code/type is declared here; the runtime validation that raises it lives in BBP5-008). The `ProviderCapabilities` **type and capability facts/matrix** are front-safe and belong in `boring-sandbox/shared`; provider server code (`node:*`) lives under `boring-sandbox/providers`.
- **Tests:** export-map test imports `boring-sandbox/providers` + `boring-sandbox/shared`; invariant script passes with new subpaths.
- **Acceptance:** `boring-sandbox/providers` + `boring-sandbox/shared` resolve and build; capability type exists; invariants green.

### BBP2-002 — Provider capability matrix values + mode→provider mapping docs [size S]

- **Files create:** `packages/boring-sandbox/src/shared/providerMatrix.ts` (per-provider `ProviderCapabilities` constants for `none`, `readonly`, `direct`, `bwrap`, `vercel-sandbox` — the **fixed** providers; plus the P2 remote-worker base with worker-dependent fields as `'unknown'`); `packages/boring-sandbox/src/providers/README.md` (mode→provider table copied/linked from 02, incl. `local`→`bwrap`, pure→`none`, readonly facade — noting `resolveMode` itself lives in boring-bash and resolves a mode id to one of these boring-sandbox provider values).
- **Notes:** Values must match 02's matrix exactly for the fixed providers. **`remote-worker` gets NO static constant for its worker-dependent fields** — those stay `'unknown'` in P2 (the handshake that reports them is **owned solely by [`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md) BBP5-008**, NOT P2), and **consumers fail closed on `'unknown'`** (a policy requiring an unproven capability is rejected, not assumed). This bead only defines the matrix TYPE + the `'unknown'` typing; the runtime handshake and its fail-closed validation land in BBP5-008. Provide only `remote-worker`'s non-worker-dependent fixed fields (e.g. `fs: 'readwrite'`, `exec: true`) as a partial base; the rest come from the BBP5-008 handshake at runtime.
- **Tests:** `packages/boring-sandbox/src/shared/__tests__/providerMatrix.test.ts` — one assertion per fixed provider row; assert `local`/`bwrap` distinction preserved; assert `none`/`readonly` have `exec:false`; assert `remote-worker` worker-dependent fields are `'unknown'` in the shared matrix (no baked constant). **P2 keeps only the matrix-typing + `'unknown'` assertions.** The "a policy needing worker-dependent fields fails closed" test is owned by **`TODO-P5` BBP5-008 (the sole handshake owner)** — do NOT place it here.
- **Acceptance:** hosts can decide provider-satisfies-requirement without guessing from a name; worker-dependent capability is a reported fact, never a static constant (the fail-closed-on-`'unknown'` runtime validation and its test are owned by BBP5-008, not P2).

### BBP2-003 — Move `direct` + `bwrap` sandbox providers [size M]

- **Files move:**
  - `packages/agent/src/server/sandbox/direct/createDirectSandbox.ts` → `packages/boring-sandbox/src/providers/direct/createDirectSandbox.ts` (+ its `__tests__/*`).
  - `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts` → `packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts`; `createBwrapSandbox.ts` → `packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts` (+ `__tests__/*` incl. snapshot).
  - Provider-bound node workspace helpers move with this slice, because direct/local modes and bwrap tests require them and boring-bash/modes cannot value-import agent: `packages/agent/src/server/workspace/createNodeWorkspace.ts` (`getNodeWorkspaceHostRoot`), `workspace/nodeWatcher.ts`, and the path-containment helpers from `workspace/paths.ts` needed by the moved providers → `packages/boring-sandbox/src/providers/node-workspace/*` (or equivalent provider-private folder exported from `@hachej/boring-sandbox/providers`). Preserve adapter-owned containment validation.
  - `packages/agent/src/server/sandbox/workspacePythonEnv.ts` and `sandbox/snapshots/deploymentSnapshot.ts` → move if imported only by moved providers; otherwise leave and import via type-only/shared seam (verify with grep before moving).
- **Files touch:** `packages/boring-sandbox/src/providers/index.ts` (re-export `createDirectSandbox`, `createBwrapSandbox`, `createNodeWorkspace`, `getNodeWorkspaceHostRoot` + option/limit/workspace types). `packages/agent/src/server/tools/harness/bashToolOptions.ts` currently imports `buildBwrapArgs`; migrate it in this same slice if it still exists after P1/P3 boundaries, or prove it was already moved/deleted. The `Sandbox` interface these implement lives in `packages/agent/src/server/shared/sandbox` — import it **type-only** into boring-sandbox (allowed; only value imports are forbidden by the invariant; but prefer relocating the `Sandbox` type to `boring-sandbox/shared` if it has no agent-value deps — investigate and note decision).
- **Notes:** Keep behavior byte-identical; only change import paths. Adapters keep owning path containment.
- **Tests:** moved conformance tests pass in boring-sandbox (`pnpm --filter @hachej/boring-sandbox run test`).
- **Acceptance:** direct/bwrap providers and node-workspace helpers build+test under boring-sandbox; no behavior change; no moved direct/bwrap/node-workspace importer still reaches `packages/agent/src/server/sandbox/*` or `packages/agent/src/server/workspace/createNodeWorkspace.ts`.

### BBP2-004 — Move `vercel-sandbox` provider [size L]

- **Files move:** all of `packages/agent/src/server/sandbox/vercel-sandbox/*` → `packages/boring-sandbox/src/providers/vercel-sandbox/*` (incl. `provisioningAdapter.ts`, `bake.ts`, `oidcRefresh.ts`, `circuitBreaker.ts`, `FileHandleStore.ts`, `deploymentSnapshot.ts`, `packageTemplate.ts`, `periodicSnapshot.ts`, `readyStatus.ts`, `resolveSandboxHandle.ts`, `createVercelSandboxExec.ts`, + `__tests__/*`).
- **Files move:** `packages/agent/src/server/workspace/createVercelSandboxWorkspace.ts` → `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxWorkspace.ts`; move/port the path-containment helper subset it uses from `workspace/paths.ts` into boring-sandbox providers if not already moved by BBP2-003.
- **Notes:** `provisioningAdapter.ts` here is a **provider adapter** (allowed to move) — distinct from the agent-owned provisioning engine (00 rule). Verify no agent-engine value import remains; if `deploymentSnapshot`/`readyStatus` are shared with agent, split shared types to `boring-sandbox/shared` or keep a type-only seam. The current provider adapter imports artifact-resolution helpers from the agent provisioning area; move the adapter-local artifact materialization helper with the provider or inject it from the agent-owned provisioning engine, but do not leave a boring-sandbox → agent value import. (`vercel-sandbox` is the US-hosted PROXY provider — stays an optional provider behind the capability matrix per invariant 15.)
- **Files touch:** `packages/boring-sandbox/src/providers/index.ts`; every importer of `createVercelSandboxWorkspace` migrates to `@hachej/boring-sandbox/providers`.
- **Tests:** vercel-sandbox unit tests pass under boring-sandbox; `createVercelSandboxWorkspace` still typechecks.
- **Acceptance:** vercel-sandbox provider and its workspace factory are owned by boring-sandbox; no agent-engine value import remains; every importer uses `@hachej/boring-sandbox/providers`.

### BBP2-005 — Land runtime-mode resolution (`resolveMode()` + mode adapters) in `@hachej/boring-bash` [size M]

- **Files move:** `packages/agent/src/server/runtime/modes/{direct,local,vercel-sandbox,remote-worker,provisioningAdapter}.ts` and `runtime/resolveMode.ts` → **`packages/boring-bash/src/modes/*`** (keep filenames) — this is the CHOICE-of-sandbox layer and it lives in **boring-bash (THE RUNTIME)**, not boring-sandbox and not `boring-bash/providers`. Add a `@hachej/boring-bash` `"./modes"` export. Move `runtime/modes/__tests__/*` and `runtime/__tests__/resolveMode.test.ts` with them. The mode adapters **import the concrete provider values from `@hachej/boring-sandbox/providers`** (this is the single legitimate `boring-bash → boring-sandbox` value edge) and resolve a mode id → a boring-sandbox provider.
- **Mode-private helper moves required by the current import graph:** move `packages/agent/src/server/runtime/createServerFileSearch.ts` → `packages/boring-bash/src/modes/createServerFileSearch.ts`; move `packages/agent/src/server/workspace/provision.ts` (`copyTemplate`) → `packages/boring-bash/src/modes/copyTemplate.ts` or inject an equivalent template copier into the mode; move adapter-local provisioning artifact helpers currently pulled from `workspace/provisioning/packArtifact.ts` into `boring-bash/src/modes/provisioningArtifacts.ts` **or** inject them from the agent-owned provisioning engine. The end state is mandatory: `rg "from '@hachej/boring-agent" packages/boring-bash/src/modes` shows only `import type` lines.
- **Files keep (agent, type-only):** `packages/agent/src/server/runtime/mode.ts` stays — it is type-only contracts (`RuntimeModeAdapter`, `RuntimeBundle`). boring-bash mode adapters import these **type-only** from `@hachej/boring-agent/server` (allowed).
- **Files touch (repoint `resolveMode`/`autoDetectMode` value imports):** `packages/agent/src/server/createAgentApp.ts`, `registerAgentRoutes.ts`, `index.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, `packages/cli/src/server/modeApps.ts`, `packages/agent/scripts/eval-provisioning-agent-vercel.mts`, plus any test/helper import found by `rg "resolveMode|autoDetectMode|hasBwrap" packages apps plugins`. These are host/composition/CLI layers → they may import `@hachej/boring-bash/modes` directly (which in turn pulls `@hachej/boring-sandbox` provider values). For `packages/agent/*` callers that must stay bash-free (createAgentApp/registerAgentRoutes are the Fastify adapter layer): inject the resolved adapter from the host instead of importing `resolveMode` — confirm against the Phase-1 injection seam; if injection is not yet threaded there, **STOP and report the missing P1 seam** (do not leave a shim — the seam is a P1 deliverable, not something P2 patches around).
- **Agent bin decision (resolved in THIS same P2 PR — the bin cannot survive P2 unchanged):** the `packages/agent` bin (`packages/agent/src/bin/boring-agent.ts`) today composes a bash-enabled dev server via `createAgentApp({ mode: 'direct', ... })`, which after this move would force the agent bin to resolve a mode → pull `@hachej/boring-bash/modes` (an agent→bash value import — forbidden). Resolution: **the agent bin becomes PURE-ONLY — it composes `runtime: 'none'` (no `mode`, no provider, no `resolveMode`)**, keeping agent value-import-free. Its **bash-enabled composition (the `--mode`/`direct` dev-server + provider wiring) MOVES to `packages/cli`** (the CLI is a host/composition layer allowed to import `@hachej/boring-bash/modes` + `@hachej/boring-sandbox/providers`) in this same PR. Any E2E helper that needs a bash-backed backend targets the CLI-owned entry point, not the agent bin. Remove the `RuntimeModeId`/`--mode` handling from the agent bin.
- **Notes:** `none`/`readonly` must short-circuit the closed provisioning-adapter mode union rather than throw (02 remote-worker split note). Replace agent value imports used by the current mode files (`ErrorCode`, `safeCapture`, `getEnv`/env defaults) with boring-bash-local helpers or host-injected functions before moving; do not import those values from agent.
- **Tests:** moved `resolveMode.test.ts` passes in boring-bash; `pnpm --filter @hachej/boring-agent run test` green; mode/provider mapping test (BBP2-002) covers every current pair; the agent bin composes `runtime: 'none'` and has zero `@hachej/boring-bash`/`@hachej/boring-sandbox` import (invariant scan); the migrated CLI-owned bash dev-server entry starts a `direct`-mode backend for E2E; static grep proves `packages/boring-bash/src/modes/**` has no agent value import.
- **Acceptance:** `resolveMode()` + mode adapters live in **boring-bash** (`boring-bash/modes`), resolving to `@hachej/boring-sandbox` provider values; agent keeps only type-only mode contracts; the agent bin is pure-only (`runtime: 'none'`) and its bash-enabled composition now lives in `packages/cli`.

### BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision [size M]

- **Files move:** `packages/agent/src/server/sandbox/remote-worker/protocol.ts` → `packages/boring-sandbox/src/shared/remoteWorkerProtocol.ts` (front-safe: no `node:*`/`Buffer`; convert bytes to `Uint8Array` if any). `workerClient.ts` + `createRemoteWorkerSandbox.ts` → `packages/boring-sandbox/src/providers/remote-worker/*` (+ `__tests__/workerClient.test.ts`). `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts` → `packages/boring-sandbox/src/providers/remote-worker/createRemoteWorkerWorkspace.ts`.
- **Files touch:** `packages/boring-sandbox/src/shared/index.ts` (export protocol types); `packages/boring-sandbox/src/providers/index.ts` (export client/adapter). `apps/full-app/src/server/worker/{auth,config,routes,workspace}.ts` + `agent-worker.ts` + `apps/full-app/scripts/remote-worker-smoke.mjs`: repoint protocol imports to `@hachej/boring-sandbox/shared` and provider/workspace imports to `@hachej/boring-sandbox/providers`. **Decision to record in `boring-sandbox/src/providers/remote-worker/README.md`:** worker server stays app-owned (recommended, least churn) but imports only shared protocol + provider server contracts — never agent core.
- **P2 MOVES CODE ONLY — no handshake here.** This bead relocates protocol → shared, client/adapter → providers, and repoints imports. It does **NOT** implement the capability handshake, does **NOT** add "reject unknown/missing contract version" logic, and does **NOT** add fail-closed hardening validation. The remote-worker's worker-dependent capability facts stay `'unknown'` after P2 (per BBP2-002; the existing hardcoded `client.health()`/`capabilities:['exec']` behavior is carried over unchanged, only moved). **[`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md) BBP5-008 is the SOLE owner of the real handshake, the reported hardening facts, "reject unknown/missing contract version", and all fail-closed validation** — see it for the report/consume implementation. Do not pre-implement any of that in P2.
- Preserve current worker health behavior: `GET /internal/health` remains `{ ok: true }` in P2. Any richer capability/contract-version response belongs to BBP5-008.
- **Tests:** protocol compat unit test (bytes round-trip after the move); static check `apps/full-app/src/server/worker/*` import graph has no agent-core dep. **No handshake test here** — the handshake reports/rejects/fail-closed tests belong to BBP5-008.
- **Acceptance:** remote-worker protocol provided by `@hachej/boring-sandbox/shared` and client/adapter provided by `@hachej/boring-sandbox/providers/remote-worker` without coupling the worker server to agent core; worker-dependent capabilities remain `'unknown'` (handshake deferred to BBP5-008); no handshake or fail-closed logic added in P2.

### BBP2-007 — Migrate importers + delete origin exports (no compat shims) [size M]

- **Policy (binding — `INDEX.md` "Simplicity & no-compat policy"):** all `@hachej/*` consumers are in-repo, so there is **no** old-path re-export of any kind — **not even type-only**. Every importer migrates to the new path in the **same PR** that moves the provider, and the origin export is deleted in that same PR. Grep is the migration tool; no re-export stub, no host shim that outlives the phase.
- **Notes / strategy (enumerate, migrate, delete):**
  - **Delete the origin value exports:** remove every value re-export listed under "Current public re-exports" (`createDirectSandbox`, `createBwrapSandbox`, `createNodeWorkspace`, `createRemoteWorker*`, `createVercelSandboxWorkspace`, `resolveMode`/`autoDetectMode`/`hasBwrap`) from `packages/agent/src/server/index.ts`. Do NOT replace them with a re-export from `@hachej/boring-bash` (that re-creates the cycle *and* violates the no-compat policy). Provider *types* (`CreateBwrapSandboxOptions`, `RemoteWorkerClientOptions`, protocol types, etc.) are likewise **not** re-exported from agent — consumers import them from `@hachej/boring-sandbox/providers`/`@hachej/boring-sandbox/shared` directly. `RuntimeBundle` and the other `mode.ts` **type-only** contracts stay agent-owned because they never moved (they are agent's own types, not a re-export of a moved thing).
  - **Migrate every importer in the same PR:** the grep-verified importer set is under "Known importers of concrete providers" above (value importers of `sandbox/{direct,bwrap,vercel-sandbox,remote-worker}` and `resolveMode`/`autoDetectMode` importers). Re-run `grep -rn "from '@hachej/boring-agent/server'" packages apps plugins` to catch any that pull the deleted value symbols, and repoint each to `@hachej/boring-sandbox/providers` (concrete providers) or `@hachej/boring-bash/modes` (mode resolution). Host/CLI/composition layers (`packages/cli`, `apps/full-app`, `packages/workspace/*/server`) import `@hachej/boring-bash/modes` (+ `@hachej/boring-sandbox/providers` where they touch providers directly); the Fastify adapter layer (`createAgentApp`/`registerAgentRoutes`) takes the resolved adapter by injection (Phase-1 seam) rather than importing `resolveMode`.
- **Files touch:** `packages/agent/src/server/index.ts` (delete the moved value exports); every downstream importer in the grep-verified set; add migration notes to `packages/boring-sandbox/src/providers/README.md` with before/after snippets for direct/local/vercel/remote-worker + readonly/none.
- **Tests:** static test (extend `scripts/check-invariants.mjs` or `scripts/audit-imports.ts`) proving agent old paths have no boring-bash/sandbox **value** import and no re-export of the moved symbols; apps compile after migration; sample using new imports typechecks. Add grep gates for old relative paths: `rg "server/sandbox/(direct|bwrap|vercel-sandbox|remote-worker)|server/workspace/create(Node|RemoteWorker|VercelSandbox)Workspace|runtime/resolveMode" packages apps plugins` must return no live imports outside moved-file history/tests intentionally updated to new packages.
- **Acceptance:** no package cycle, no old-path re-export (value or type), every importer migrated in-PR; a build fails only if a caller was missed (surfaced as a clear unresolved-import error), never silently shimmed.

### BBP2-008 — Extend invariant scripts for the three-package boundary [size S]

- **Files touch:** `packages/boring-sandbox/scripts/check-invariants.mjs` (from BBP2-000), `packages/boring-bash/scripts/check-invariants.mjs`, and `scripts/audit-imports.ts` (root `FORBIDDEN_PATTERNS`).
- **Notes:** Assert the acyclic layering `agent imports neither; bash may import sandbox; sandbox imports agent types only`:
  - **boring-sandbox** (`check-invariants.mjs`): `requiredExports` includes `"./providers"` + `"./shared"`; `src/providers/**` is not imported by `src/shared/**` (providers may use `node:*`; shared may not); **no `@hachej/boring-agent` value import** anywhere in `src/**` (type-only allowed); **no `@hachej/boring-bash` import of any kind** (that reverse edge is a cycle).
  - **boring-bash** (`check-invariants.mjs`): the existing agent→bash value-import scan still passes; the new `"./modes"` export resolves; boring-bash **may** import `@hachej/boring-sandbox` values (the single legitimate provider edge) — do NOT forbid it.
  - **agent / root** (`audit-imports.ts`): `packages/agent/**` has no value import from `@hachej/boring-bash` **or `@hachej/boring-sandbox`**; `packages/agent/src/server/index.ts` contains no value export of the moved provider symbols (regex allowlist).
- **Tests:** `pnpm --filter @hachej/boring-sandbox run check:invariants` + `pnpm --filter @hachej/boring-bash run check:invariants` pass; a planted agent→bash OR agent→sandbox value import fails; a planted sandbox→bash import fails; a planted sandbox→agent **value** import fails (type-only passes) (manual spot check, revert).
- **Acceptance:** invariants guard all three package edges; `pnpm lint:invariants` + `pnpm audit:imports` (root) stay green.

## Verification — exact commands verified against package.json scripts

```bash
# boring-sandbox package (NEW — scaffolded in BBP2-000; owns the providers)
pnpm --filter @hachej/boring-sandbox run build
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants
pnpm --filter @hachej/boring-sandbox run test

# boring-bash package (owns runtime-mode resolution `resolveMode`; imports boring-sandbox values)
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-bash run test

# agent still builds/tests after provider move + import migration
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run lint:invariants   # bash ../../scripts/check-invariants.sh .
pnpm --filter @hachej/boring-agent run check:isolation

# repo-wide boundary + cycle guards (root package.json)
pnpm lint:invariants        # agent + boring-bash + boring-sandbox + workspace-plugin invariants after BBP2-000
pnpm audit:imports          # tsx scripts/audit-imports.ts
pnpm typecheck              # build:packages then per-pkg typecheck

# current app/composer compile checks after importer migration
pnpm --filter @hachej/boring-ui-cli run typecheck
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter full-app run typecheck
pnpm --filter workspace-playground run typecheck
pnpm --filter full-app run smoke:remote-worker
```

## Review gates

- Phase 1 injection precondition confirmed (or STOP+report).
- `@hachej/boring-sandbox` scaffolded (BBP2-000), builds, and its types-only-agent / no-bash-edge invariant is enforced.
- `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash **and** zero agent→sandbox value imports; the only cross-package value edge is `boring-bash → boring-sandbox`; sandbox→agent is type-only.
- #416 shared contracts / server projection ops / conformance+leak tests unchanged and passing.
- Every moved provider carries its tests and lives in `packages/boring-sandbox/src/providers`; direct/local/vercel-sandbox behavior unchanged; `resolveMode` lands in `boring-bash/modes` with byte-identical behavior.
- Provider-bound workspace/path helpers (`createNodeWorkspace`, `getNodeWorkspaceHostRoot`, `createVercelSandboxWorkspace`, `createRemoteWorkerWorkspace`, containment helpers) moved or injected with their provider slice; no boring-sandbox provider value-imports agent server helpers.
- `packages/boring-bash/src/modes/**` has no `@hachej/boring-agent` value import; only `import type` from agent contracts is allowed.
- Every importer of the moved value symbols migrated in the same PR and the origin exports deleted; no old-path re-export (value or type), no host shim, no cycle.
- Mode-id vs provider-id distinction preserved (`local`→`bwrap`); `resolveMode` (boring-bash) resolves to boring-sandbox provider values.
