> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# TODO-P2 — Scaffold `@hachej/boring-sandbox`, move concrete providers into it, land `resolveMode` in `@hachej/boring-bash`

## Binding priority-4 work order (2026-07-11)

- The isolated Sol recut may prepare provider extraction on its own branch.
- Do not merge it before M2/E2 -> T1 -> T2 completes, and do not change D1,
  workspace, or agent contracts to accommodate it.
- Start from #628's structural `productionReady:false` seam. At priority 4,
  extract the provider owner, run the EU isolation/lifecycle/network/limit/
  image/cleanup fact proof, and preserve the already-proven D1 behavior.
- Unknown facts fail closed inside the provider/conformance boundary. There is
  no silent direct fallback and no X1 mount in the provider PR.
- Split X1 mounts after P2 and only for a named native-mount consumer.

## Historical runsc-before-D1 work order — non-dispatchable

The former D1-consumed slice is retained for evidence only:

1. Treat the `@hachej/boring-sandbox` scaffold, #557 publish-pipeline parity,
   and #628 structural runsc preflight as landed prerequisites; do not redo
   them. #628 reports `productionReady: false` and is not provider parity.
2. Run a time-boxed validation spike on the intended EU host before D1 locks:
   record systrap/provider availability, namespace/network enforcement,
   resource limits, digest-pinned image handling, normal/error/abort cleanup,
   authenticated capability facts, and every remaining `unknown`.
3. Add/review only the hardened EU runsc/systrap provider behavior evidenced
   as required by D1,
   including honest capability facts, isolation/limit/cleanup proof, and no
   silent fallback.
4. Keep A1 local development on the existing workspace host: prefer bwrap when
   available and require explicit trusted-local policy for direct execution.
5. Migrate only imports that the runsc slice actually changes, in that slice.

The full direct/bwrap/Vercel/remote-worker provider migration, generic
capability matrix, `resolveMode` cutover, pure-only agent binary, and all-mode
composer rewrite below are post-v1. #548 is superseded by #628 plus the
evidence-led follow-up; #558 is deferred; #564 closes/defers. Do not dispatch the historical
work order below for v1.

## Historical full provider/mode work order — non-dispatchable for v1

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

**Package re-target (00 open decision 3, RESOLVED; 08 decision 11 — READ THIS FIRST):** concrete providers do **NOT** move to `@hachej/boring-bash/providers`. They move to a **new dedicated package `@hachej/boring-sandbox`** (`packages/boring-sandbox/src/providers`). The three-package stack, top-down: **`@hachej/boring-agent`** (defines ALL contracts, imports neither boring-bash nor boring-sandbox) ← **`@hachej/boring-bash`** (THE RUNTIME: fs bindings/tools/routes/UI + bash tool + runtime modes = the CHOICE of sandbox; **`resolveMode` lives here**; imports boring-sandbox **values** + agent **types**) ← **`@hachej/boring-sandbox`** (sandbox management: providers `direct`/`bwrap`-gVisor/`vercel`-PROXY/`remote-worker`-client, FUSE-S3 mounts, lifecycle; capability facts/types `reported | unknown` live in `boring-sandbox/shared` only; imports agent **types only**). Acyclic: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`. Everywhere below, "move a provider" means move it to `packages/boring-sandbox/src/providers`, and "`resolveMode`" lands in boring-bash.

**Amendment (2026-07-08):** provider capability facts feed environment
resolution; they are not mode labels for surfaces to branch on. P2 reports
facts such as filesystem access, exec, image support, mount support, network
isolation, and unknown/reported status. The host/environment resolver turns
those facts into host-owned attachment lifetimes; internal prepared handles stay
behind E1's authorization callback. It flattens auth-gated contributions into
core inputs and supplies methodless
`ResolvedEnvironment[]` projections. New consumers must target those resolved
environment facts, not `runtimeMode` or provider ids. No operation-bearing
environment object enters agent core.

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
- `local`/`vercel-sandbox` behavior + existing tests are preserved. The one
  intentional behavior correction is selection safety: deployed/tenant
  composers fail closed when no approved provider is available, and `direct`
  requires explicit trusted-local policy.

### Post-v1 only: runtime-mode composition cutover

The former all-provider/mode cutover is deferred and has no executable v1
instructions. A future named consumer must re-specify composer migration and
binary ownership from then-current main. It must not revive the pure-only agent
binary or `runtime: 'none'` product path implicitly.

## Non-negotiables

- **Precondition:** Phase 1 dependency injection (`createAgent()` / injected runtime+tools; see [`../P1-headless-core/TODO.md`](../P1-headless-core/TODO.md)) is complete before providers move. If not, STOP and report — do not move providers.
- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash`. Value flows one-way: host/CLI/composition imports both.
- Do not add re-exports of moved providers from old agent paths — **neither value nor type-only** (value re-exports re-create the cycle; any old-path re-export violates the no-compat policy). Every importer migrates in the same PR; the origin export is deleted in that PR.
- Provisioning transition: P2 does not expand or canonize the currently agent-
  located engine/`ProvisionWorkspaceRuntimeOptions`. P5 BBP5-002 atomically
  moves engine, runner contracts, and fingerprints to boring-bash/server and
  deletes the agent origin. P2 moves provider-specific adapters/helpers to
  boring-sandbox or boring-bash as appropriate and adds no compatibility export.
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
- **Notes:** `provisioningAdapter.ts` here is a **provider adapter** (allowed to
  move), distinct from the temporarily agent-located central engine that P5
  removes. Verify no agent-engine value import remains; provider-local artifact
  materialization moves with the provider or is injected by the host-facing
  seam. Do not create an agent compatibility export or make boring-sandbox
  depend on the transitional engine.
- **Files touch:** `packages/boring-sandbox/src/providers/index.ts`; every importer of `createVercelSandboxWorkspace` migrates to `@hachej/boring-sandbox/providers`.
- **Tests:** vercel-sandbox unit tests pass under boring-sandbox; `createVercelSandboxWorkspace` still typechecks.
- **Acceptance:** vercel-sandbox provider and its workspace factory are owned by boring-sandbox; no agent-engine value import remains; every importer uses `@hachej/boring-sandbox/providers`.

### BBP2-009 — Publish-pipeline parity for `@hachej/boring-sandbox` [size S] — **Amendment (2026-07-06); executes BEFORE BBP2-005** (before `@hachej/boring-bash` gains a value dependency on `@hachej/boring-sandbox`)

- **Files touch:** `scripts/audit-publish-manifests.mjs`, `scripts/version.mjs` (version bump list), `scripts/set-ci-package-version.mjs` (CI versioning list), `.github/workflows/ci.yml` (CI publish list), `.github/workflows/release.yml` (release workflow list); `packages/boring-sandbox/package.json` (version).
- **Notes:** `@hachej/boring-bash` is npm-published (cohort-versioned, with the external `@hachej/boring-governance` consumer — see `../../INDEX.md` rule 6 amendment). Before boring-bash gains a **value** dependency on `@hachej/boring-sandbox` (the BBP2-005 `boring-bash → boring-sandbox` edge), sandbox must be publishable too: add `packages/boring-sandbox` to **all five publish lists** (audit script, version bump, CI versioning, CI publish, release workflow), ordered **before** `packages/boring-bash` in each list, and bring it onto the current version cohort (it sits at `0.1.61` vs the `0.1.64` cohort). **Until this bead lands, the published boring-bash must not depend on sandbox.**
- **Tests / verification:** `node scripts/audit-publish-manifests.mjs` passes with sandbox listed; grep gates — `rg -n "boring-sandbox" scripts/audit-publish-manifests.mjs scripts/version.mjs scripts/set-ci-package-version.mjs .github/workflows/ci.yml .github/workflows/release.yml` hits all five, each ordered before `packages/boring-bash`.
- **Acceptance:** `@hachej/boring-sandbox` is in every publish list, ordered before boring-bash, on the current version cohort; BBP2-005 may then add the bash→sandbox value edge.

### BBP2-005 — Land runtime-mode resolution (`resolveMode()` + mode adapters) in `@hachej/boring-bash` [size M]

**Deferred history — do not dispatch.** The old mode relocation and pure-only
binary cutover are removed from v1. Reopen only through a new post-v1 work order
based on a named consumer and then-current import graph.

### BBP2-006 — Split remote-worker: shared protocol → shared, client → providers, server path decision [size M]

This is a separate PR from the mode/composer cutover. Move protocol, client,
provider, and their direct importers without simultaneously rewiring every mode
composer.

- **Files move:** `packages/agent/src/server/sandbox/remote-worker/protocol.ts` → `packages/boring-sandbox/src/shared/remoteWorkerProtocol.ts` (front-safe: no `node:*`/`Buffer`; convert bytes to `Uint8Array` if any). `workerClient.ts` + `createRemoteWorkerSandbox.ts` → `packages/boring-sandbox/src/providers/remote-worker/*` (+ `__tests__/workerClient.test.ts`). `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts` → `packages/boring-sandbox/src/providers/remote-worker/createRemoteWorkerWorkspace.ts`.
- **Files touch:** `packages/boring-sandbox/src/shared/index.ts` (export protocol types); `packages/boring-sandbox/src/providers/index.ts` (export client/adapter). `apps/full-app/src/server/worker/{auth,config,routes,workspace}.ts` + `agent-worker.ts` + `apps/full-app/scripts/remote-worker-smoke.mjs`: repoint protocol imports to `@hachej/boring-sandbox/shared` and provider/workspace imports to `@hachej/boring-sandbox/providers`. **Decision to record in `boring-sandbox/src/providers/remote-worker/README.md`:** worker server stays app-owned (recommended, least churn) but imports only shared protocol + provider server contracts — never agent core.
- **P2 MOVES CODE ONLY — no handshake here.** This bead relocates protocol → shared, client/adapter → providers, and repoints imports. It does **NOT** implement the capability handshake, does **NOT** add "reject unknown/missing contract version" logic, and does **NOT** add fail-closed hardening validation. The remote-worker's worker-dependent capability facts stay `'unknown'` after P2 (per BBP2-002; the existing hardcoded `client.health()`/`capabilities:['exec']` behavior is carried over unchanged, only moved). **[`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md) BBP5-008 is the SOLE owner of the real handshake, the reported hardening facts, "reject unknown/missing contract version", and all fail-closed validation** — see it for the report/consume implementation. Do not pre-implement any of that in P2.
- Preserve current worker health behavior: `GET /internal/health` remains `{ ok: true }` in P2. Any richer capability/contract-version response belongs to BBP5-008.
- **Tests:** protocol compat unit test (bytes round-trip after the move); static check `apps/full-app/src/server/worker/*` import graph has no agent-core dep. **No handshake test here** — the handshake reports/rejects/fail-closed tests belong to BBP5-008.
- **Acceptance:** remote-worker protocol provided by `@hachej/boring-sandbox/shared` and client/adapter provided by `@hachej/boring-sandbox/providers/remote-worker` without coupling the worker server to agent core; worker-dependent capabilities remain `'unknown'` (handshake deferred to BBP5-008); no handshake or fail-closed logic added in P2.

### BBP2-007 — Migrate importers + delete origin exports (no compat shims) [size M]

Stack this after BBP2-006 and merged publish parity. Review mode/composer/CLI
wiring separately from the remote-worker relocation; no cherry-picked publish
commit remains in the branch.

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

### BBP2-010 — Hardened gVisor runsc provider for production v1 [size L]

- **Purpose:** close the gap between a production/sovereign D1 claim and the
  development or unverified providers above. This is the one hardened v1
  execution path; do not build a general scheduler or image catalog.
- **Files create/touch:** add
  `@hachej/boring-sandbox/providers/runsc` and the worker-side host adapter. The
  provider accepts a host-verified OCI bundle/image digest and explicit
  workspace/network/resource policy; it implements the existing Sandbox
  lifecycle exactly once. Image pull/catalog concerns stay outside this bead.
- **Preflight:** prove `runsc` version/contract, `--platform=systrap`, usable
  namespace/cgroup/nftables facilities, digest-pinned OCI bundle, configured
  uid/gid and root paths, and requested limits before readiness. Emit methodless
  reported capability facts; missing or unknown facts fail with stable codes.
- **Isolation policy:** one network namespace per workspace; nftables blocks
  metadata, RFC1918, CGNAT, link-local, ULA, host app/DB networks, and other
  workspaces; apply explicit CPU, memory, pid, and cgroup limits. Mount only
  declared workspace paths. Never place brokered secrets in OCI config, env,
  mounts, command args, logs, or guest-readable files.
- **Lifecycle:** create/start/exec/stop/dispose are idempotent and bounded;
  partial create is reconciled or removed; dispose tears down container,
  namespace, firewall rules, cgroup, and temporary bundle state exactly once.
- **Tests:** fixture/command-runner tests cover plan/failure semantics, but v1
  acceptance also runs provider lifecycle and network/limit/secret probes on a
  preconfigured real EU runsc worker. The probe verifies metadata/private CIDR
  denial, cross-workspace denial, public allowlisted egress, enforced pid/CPU/
  memory limits, digest identity, and absence of a secret canary.
- **Acceptance:** real-target conformance records the verified runsc version,
  systrap platform, image digest, network and limit facts, and cleanup. A mock or
  bwrap/Vercel/direct execution cannot satisfy this bead.

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
- BBP2-010 real-target evidence proves the hardened runsc provider; P5a's
  authenticated worker handshake is still required before D1 may select it
  remotely.
- P2 adds no central provisioning API or compatibility export in agent; P5 is
  the declared owner of the move to boring-bash/server.
